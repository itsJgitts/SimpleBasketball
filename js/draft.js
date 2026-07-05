// =============================================================================
// draft.js — NBA draft lottery, draft order, prospect generation, and picking.
//   Lottery: the LOTTERY_TEAMS non-playoff teams get weighted odds (worst 3 tied
//   at 14%) at the top-4 picks, drawn without replacement; the remaining lottery
//   teams and then the playoff teams fill in by inverse regular-season record.
//   Prospects: a synthetic class (DRAFT_ROUNDS * #teams) with ovr/pot scaled up
//   for early picks; each gets real BBGM component ratings so ovr recomputes.
//   State lives on game.draftClass = { season, order:[{tid,round,pick}], picks }.
// =============================================================================
import CONFIG from './config.js';
import { computeStandings } from './standings.js';
import { computeOvr, refreshPlayer, estimatePot } from './ratings.js';
import { autoLineup } from './lineup.js';
import { clamp } from './util.js';

const FIRST_NAMES = ['Jalen', 'DeAndre', 'Marcus', 'Tyrese', 'Cade', 'Malik', 'Amari',
  'Isaiah', 'Keegan', 'Trey', 'Darius', 'Jaden', 'Cam', 'Bennedict', 'Ausar', 'Scoot',
  'Brandon', 'Ochai', 'Jabari', 'Paolo', 'Chet', 'Victor', 'Zion', 'Cooper', 'Emoni'];
const LAST_NAMES = ['Williams', 'Johnson', 'Smith', 'Holmgren', 'Banchero', 'Edwards',
  'Wembanyama', 'Henderson', 'Whitmore', 'Thompson', 'Miller', 'Sharpe', 'Hunter',
  'Carter', 'Green', 'Brown', 'Davis', 'Walker', 'Robinson', 'Bridges', 'Jackson'];
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

// Baseline mid-league ratings row; skill components get shifted to hit a target.
const BASE_ROW = {
  hgt: 55, stre: 50, spd: 55, jmp: 55, endu: 50, ins: 45, dnk: 50, ft: 50,
  tp: 48, oiq: 45, diq: 45, drb: 55, pss: 50, fg: 48, reb: 52,
};
const SKILL_KEYS = ['stre', 'spd', 'jmp', 'endu', 'ins', 'dnk', 'ft', 'tp', 'oiq', 'diq', 'drb', 'pss', 'fg', 'reb'];
const OVR_SENSITIVITY = 0.8709;

// Build a ratings row for `season` whose computeOvr ≈ targetOvr (few iterations).
function ratingsForOvr(targetOvr, hgt, season, R) {
  const prev = { ...BASE_ROW, hgt, season };
  let step = (targetOvr - computeOvr(prev)) / OVR_SENSITIVITY;
  let row = shift(prev, step, R);
  for (let i = 0; i < 6; i++) {
    const realized = computeOvr(row);
    if (Math.abs(realized - targetOvr) <= 0.5) break;
    step += (targetOvr - realized) / OVR_SENSITIVITY;
    row = shift(prev, step, R);
  }
  for (const k of SKILL_KEYS) row[k] = Math.round(clamp(row[k], 0, 100));
  return row;
}
function shift(prev, step, R) {
  const row = { ...prev };
  for (const k of SKILL_KEYS) {
    const jitter = R ? R.randFloat(-3, 3) : 0;
    row[k] = clamp((prev[k] ?? 50) + step + jitter, 0, 100);
  }
  return row;
}

// Real draft prospects loaded from the roster file for the current season:
// waiting free agents (tid -1) flagged isProspect whose draft year is now.
export function realProspects(game) {
  return game.players.filter((p) => p.tid === -1 && p.isProspect && p.draft && p.draft.year === game.season);
}

// Generate `count` synthetic prospects (tid -1 until drafted) whose ceiling
// scales with intended slot: earlier synthetic picks are stronger + higher-pot.
// Used to fill any shortfall when the file has too few real prospects.
export function generateDraftClass(game, R, count) {
  const nTeams = game.teams.length;
  const total = count != null ? count : CONFIG.DRAFT_ROUNDS * nTeams;
  const season = game.season;
  const prospects = [];
  for (let i = 0; i < total; i++) {
    const slotFrac = 1 - i / total; // 1 at #1 overall -> ~0 at last pick
    const [ol, oh] = CONFIG.ROOKIE_OVR_RANGE;
    const [pl, ph] = CONFIG.ROOKIE_POT_RANGE;
    const ovr = clamp(Math.round(R.randFloat(ol, oh) + slotFrac * CONFIG.ROOKIE_TOP_PICK_OVR_BONUS), 0, 99);
    const pot = clamp(Math.round(Math.max(ovr, R.randFloat(pl, ph) + slotFrac * CONFIG.ROOKIE_TOP_PICK_POT_BONUS)), ovr, 99);
    const hgt = R.randInt(CONFIG.ROOKIE_HGT_RANGE[0] - 47, CONFIG.ROOKIE_HGT_RANGE[1] - 47) + 47; // rating scale
    const age = R.randInt(CONFIG.DRAFT_AGE_MIN, CONFIG.DRAFT_AGE_MAX);
    const p = {
      pid: game.nextPid++, tid: -1, name: `${R.choice(FIRST_NAMES)} ${R.choice(LAST_NAMES)}`,
      pos: R.choice(POSITIONS), hgt: R.randInt(CONFIG.ROOKIE_HGT_RANGE[0], CONFIG.ROOKIE_HGT_RANGE[1]),
      weight: R.randInt(CONFIG.ROOKIE_WEIGHT_RANGE[0], CONFIG.ROOKIE_WEIGHT_RANGE[1]),
      born: { year: season - age, loc: '' },
      draft: { round: 0, pick: 0, year: season, tid: -1, originalTid: -1 },
      ratings: [ratingsForOvr(ovr, hgt, season, R)],
      contract: { amount: CONFIG.MIN_SALARY, exp: season + 3 },
      injury: { type: 'Healthy', gamesRemaining: 0 },
      injuryProneness: 0.8 + (game.nextPid % 100) / 125,
      stats: [], isProspect: true,
    };
    refreshPlayer(p, season);
    p.pot = Math.max(p.pot, pot, estimatePot(p.ovr, p.age));
    prospects.push(p);
  }
  return prospects.sort((a, b) => b.pot - a.pot);
}

// Run the lottery: return the tids of the LOTTERY_TEAMS non-playoff teams in the
// order they will pick (top-4 drawn by weighted odds w/o replacement, rest by
// worst record). `lotteryTids` must be pre-sorted worst-record-first.
export function runLottery(lotteryTids, R) {
  const pool = lotteryTids.slice(0, CONFIG.LOTTERY_TEAMS);
  const odds = CONFIG.LOTTERY_ODDS.slice(0, pool.length).map((o) => o);
  const remaining = pool.map((tid, i) => ({ tid, weight: odds[i] }));
  const top = [];
  const topN = Math.min(4, remaining.length);
  for (let n = 0; n < topN; n++) {
    const idx = R.weightedIndex(remaining.map((r) => r.weight));
    top.push(remaining[idx].tid);
    remaining.splice(idx, 1);
  }
  const rest = remaining.map((r) => r.tid); // already worst-first
  return [...top, ...rest];
}

// Determine the full pick order: lottery teams (post-lottery) then playoff teams
// by inverse regular-season record, repeated for each round.
export function draftOrder(game, R, playoffTids) {
  const { list } = computeStandings(game);
  const byRecord = list.slice().sort((a, b) => a.pct - b.pct || a.pf - b.pf); // worst first
  const playoffSet = new Set(playoffTids || []);
  const lotteryTids = byRecord.filter((r) => !playoffSet.has(r.tid)).map((r) => r.tid);
  const lotteryOrder = runLottery(lotteryTids, R);
  const playoffOrder = byRecord.filter((r) => playoffSet.has(r.tid)).map((r) => r.tid);
  const oneRound = [...lotteryOrder, ...playoffOrder];
  const order = [];
  for (let round = 1; round <= CONFIG.DRAFT_ROUNDS; round++) {
    oneRound.forEach((tid, i) => order.push({ tid, round, pick: i + 1, overall: order.length + 1 }));
  }
  return order;
}

// Set up the draft and compute the order. Prefers the real draft class loaded
// from the roster file for this season; if the file has fewer prospects than
// there are picks (or none — e.g. seasons past the file's draft classes), the
// remainder is filled with generated rookies. Stores on game.
export function setupDraft(game, R, playoffTids) {
  const order = draftOrder(game, R, playoffTids);
  const real = realProspects(game).sort((a, b) => b.pot - a.pot || b.ovr - a.ovr);
  const shortfall = Math.max(0, order.length - real.length);
  const generated = generateDraftClass(game, R, shortfall);
  game.players.push(...generated);
  const prospects = [...real, ...generated];
  game.draftClass = { season: game.season, order, prospects: prospects.map((p) => p.pid), picks: [], onClock: 0 };
  game.phase = 'draft';
  return game.draftClass;
}

// Prospects still available (not yet drafted), ranked best-first by potential.
export function availableProspects(game) {
  const dc = game.draftClass;
  if (!dc) return [];
  const picked = new Set(dc.picks.map((pk) => pk.pid));
  return dc.prospects
    .map((pid) => game.players.find((p) => p.pid === pid))
    .filter((p) => p && !picked.has(p.pid))
    .sort((a, b) => b.pot - a.pot || b.ovr - a.ovr);
}

// The pick currently on the clock ({ tid, round, pick, overall }) or null.
export function currentPick(game) {
  const dc = game.draftClass;
  if (!dc || dc.onClock >= dc.order.length) return null;
  return dc.order[dc.onClock];
}

// Make the on-the-clock pick: assign `pid` to the picking team, stamp draft
// info + a rookie contract, rebuild that team's lineup, advance the clock.
export function makePick(game, pid) {
  const slot = currentPick(game);
  if (!slot) throw new Error('The draft is complete.');
  const player = game.players.find((p) => p.pid === pid);
  if (!player) throw new Error('Unknown prospect.');
  if (player.tid !== -1 || !player.isProspect) throw new Error('That player is not an available prospect.');
  player.tid = slot.tid;
  player.draft = { round: slot.round, pick: slot.pick, year: game.season, tid: slot.tid, originalTid: slot.tid };
  player.isProspect = false;
  // Stamp a rookie-scale contract if the prospect arrived without one (real
  // file prospects carry no contract until drafted).
  if (!player.contract) player.contract = { amount: CONFIG.MIN_SALARY, exp: game.season + 3 };
  const team = game.teams.find((t) => t.tid === slot.tid);
  if (team) team.lineup = autoLineup(game.players.filter((p) => p.tid === slot.tid), game.season);
  game.draftClass.picks.push({ overall: slot.overall, round: slot.round, pick: slot.pick, tid: slot.tid, pid });
  game.draftClass.onClock += 1;
  game.transactions.push({ type: 'draft', day: game.day, season: game.season, tid: slot.tid, pid, round: slot.round, pick: slot.pick });
  if (game.draftClass.onClock >= game.draftClass.order.length) game.phase = 'offseason';
  return player;
}

// Auto-pick the best available prospect for the on-the-clock team (AI/skip).
export function autoPick(game) {
  const avail = availableProspects(game);
  if (!avail.length) throw new Error('No prospects remain.');
  return makePick(game, avail[0].pid);
}

// Run every remaining pick automatically (best-available). Optionally stop when
// the given `stopTid` is on the clock so the user can pick. Returns picks made.
export function autoDraftUntil(game, stopTid) {
  const made = [];
  while (currentPick(game)) {
    const slot = currentPick(game);
    if (stopTid != null && slot.tid === stopTid) break;
    made.push(autoPick(game));
  }
  return made;
}

// Convenience: auto-run the entire draft (used for sim-only leagues/tests).
export function simEntireDraft(game, R, playoffTids) {
  if (!game.draftClass) setupDraft(game, R, playoffTids);
  autoDraftUntil(game);
  return game.draftClass;
}
