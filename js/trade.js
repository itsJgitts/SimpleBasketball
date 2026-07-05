// =============================================================================
// trade.js — 2- and 3-team trades of players and draft picks.
//   A trade is a set of asset movements between the participating teams. It is
//   legal when, for EACH team: outgoing salary matches incoming (125% + $100k),
//   the resulting roster stays within [ROSTER_MIN, ROSTER_MAX], and the team
//   both sends and receives at least one asset. AI teams accept when the value
//   they receive (adjusted for positional need) is >= threshold of what they
//   give up. Execution reassigns tids / pick ownership and rebuilds lineups.
//
//   Trade shape:
//     { teams: [tidA, tidB, ...],
//       assets: [{ from, to, kind: 'player'|'pick', id }] }   // id = pid | dpid
// =============================================================================
import CONFIG from './config.js';
import { playerValue } from './ratings.js';
import { posToSlot, SLOTS } from './nbaTeams.js';
import { autoLineup } from './lineup.js';
import { winPct } from './standings.js';

// ---- Lookups ---------------------------------------------------------------
export function playersOnTeam(game, tid) { return game.players.filter((p) => p.tid === tid); }
export function picksOwnedBy(game, tid) { return game.draftPicks.filter((dp) => dp.tid === tid); }
const teamById = (game, tid) => game.teams.find((t) => t.tid === tid);
const playerById = (game, pid) => game.players.find((p) => p.pid === pid);
const pickById = (game, dpid) => game.draftPicks.find((dp) => dp.dpid === dpid);

// Team payroll ($k) = sum of contracts of players currently on the team.
export function teamPayroll(game, tid) {
  return playersOnTeam(game, tid).reduce((s, p) => s + (p.contract ? p.contract.amount : 0), 0);
}

// ---- Asset valuation -------------------------------------------------------
// Value of a draft pick: interpolate 1st-round value by the *original* team's
// current win% (worse team => higher pick => more value), flat-ish for 2nds,
// then discount picks in future seasons.
export function pickValue(game, dp) {
  let base;
  if (dp.round <= 1) {
    const wp = winPct(game, dp.originalTid); // 0..1, lower = better pick
    const t = 1 - Math.min(1, Math.max(0, wp)); // 1 for worst team
    base = CONFIG.PICK_VALUE_ROUND1_BOTTOM + t * (CONFIG.PICK_VALUE_ROUND1_TOP - CONFIG.PICK_VALUE_ROUND1_BOTTOM);
  } else {
    base = CONFIG.PICK_VALUE_ROUND2;
  }
  const yearsOut = Math.max(0, (dp.season || game.season) - game.season);
  return base * Math.pow(CONFIG.PICK_VALUE_FUTURE_DISCOUNT, yearsOut);
}

// Pick value is on a different scale (points) than playerValue; scale it down so
// picks and players are comparable in the fairness check.
const PICK_TO_PLAYER_VALUE = 1 / 12;

export function assetValue(game, asset) {
  if (asset.kind === 'player') {
    const p = playerById(game, asset.id);
    return p ? playerValue(p, game.season) : 0;
  }
  const dp = pickById(game, asset.id);
  return dp ? pickValue(game, dp) * PICK_TO_PLAYER_VALUE : 0;
}

// Salary ($k) an asset carries (picks carry none).
function assetSalary(game, asset) {
  if (asset.kind !== 'player') return 0;
  const p = playerById(game, asset.id);
  return p && p.contract ? p.contract.amount : 0;
}

// ---- Per-team trade summary ------------------------------------------------
// For one team: what it sends/receives, salary out/in, value out/in, roster net.
export function teamSummary(game, trade, tid) {
  const out = trade.assets.filter((a) => a.from === tid);
  const inc = trade.assets.filter((a) => a.to === tid);
  const players = playersOnTeam(game, tid).length;
  const playersOut = out.filter((a) => a.kind === 'player').length;
  const playersIn = inc.filter((a) => a.kind === 'player').length;
  return {
    tid, out, inc,
    salaryOut: out.reduce((s, a) => s + assetSalary(game, a), 0),
    salaryIn: inc.reduce((s, a) => s + assetSalary(game, a), 0),
    valueOut: out.reduce((s, a) => s + assetValue(game, a), 0),
    valueIn: inc.reduce((s, a) => s + assetValue(game, a), 0),
    rosterAfter: players - playersOut + playersIn,
  };
}

// ---- Salary matching -------------------------------------------------------
// A team's incoming salary must be within 125% + $100k of what it sends out.
// (Applied symmetrically as "outgoing must absorb incoming" for each side.)
export function salaryMatchOk(salaryOut, salaryIn) {
  const cap = salaryOut * CONFIG.TRADE_SALARY_MATCH_PCT + CONFIG.TRADE_SALARY_MATCH_FLAT;
  return salaryIn <= cap;
}

// ---- Validation ------------------------------------------------------------
// Returns { ok, errors: [...], summaries: { tid: summary } }.
export function validateTrade(game, trade) {
  const errors = [];
  const teams = trade.teams || [];
  if (teams.length < 2 || teams.length > 3) errors.push('A trade must involve 2 or 3 teams.');
  if (!trade.assets || trade.assets.length === 0) errors.push('No assets in the trade.');
  const summaries = {};
  for (const tid of teams) {
    const t = teamById(game, tid);
    if (!t) { errors.push(`Unknown team ${tid}.`); continue; }
    const s = teamSummary(game, trade, tid);
    summaries[tid] = s;
    const label = `${t.region} ${t.name}`;
    if (s.out.length === 0) errors.push(`${label} sends no assets.`);
    if (s.inc.length === 0) errors.push(`${label} receives no assets.`);
    if (s.rosterAfter < CONFIG.ROSTER_MIN) errors.push(`${label} would fall below ${CONFIG.ROSTER_MIN} players.`);
    if (s.rosterAfter > CONFIG.ROSTER_MAX) errors.push(`${label} would exceed ${CONFIG.ROSTER_MAX} players.`);
    if (!salaryMatchOk(s.salaryOut, s.salaryIn)) {
      errors.push(`${label} incoming salary exceeds the 125% + $100k match limit.`);
    }
  }
  // Every asset's from/to must be participating teams, and from must own it.
  for (const a of trade.assets || []) {
    if (!teams.includes(a.from) || !teams.includes(a.to)) errors.push('Asset moves outside the participating teams.');
    if (a.from === a.to) errors.push('An asset cannot be traded to its own team.');
    if (a.kind === 'player') {
      const p = playerById(game, a.id);
      if (!p || p.tid !== a.from) errors.push('A traded player is not on the sending team.');
    } else {
      const dp = pickById(game, a.id);
      if (!dp || dp.tid !== a.from) errors.push('A traded pick is not owned by the sending team.');
    }
  }
  return { ok: errors.length === 0, errors, summaries };
}

// ---- Positional needs ------------------------------------------------------
// Count quality players (ovr >= 55) per slot; a slot is a "need" if at/under
// TRADE_POSITION_NEED_COUNT and a "surplus" if at/over TRADE_POSITION_SURPLUS_COUNT.
export function positionProfile(game, tid) {
  const counts = {}; SLOTS.forEach((s) => (counts[s] = 0));
  for (const p of playersOnTeam(game, tid)) if (p.ovr >= 55) counts[posToSlot(p.pos)]++;
  const needs = new Set(), surplus = new Set();
  for (const s of SLOTS) {
    if (counts[s] <= CONFIG.TRADE_POSITION_NEED_COUNT) needs.add(s);
    if (counts[s] >= CONFIG.TRADE_POSITION_SURPLUS_COUNT) surplus.add(s);
  }
  return { counts, needs, surplus };
}

// Value a team assigns to an incoming asset, boosted when it fills a positional
// need. Picks get no positional adjustment.
function subjectiveIncomingValue(game, tid, asset, profile) {
  const base = assetValue(game, asset);
  if (asset.kind !== 'player') return base;
  const p = playerById(game, asset.id);
  if (!p) return base;
  return profile.needs.has(posToSlot(p.pos)) ? base * (1 + CONFIG.TRADE_POSITIONAL_NEED_BONUS) : base;
}

// ---- AI evaluation ---------------------------------------------------------
// Does team `tid` (an AI team) accept the trade? Uses subjective value in vs
// objective value out and the fairness threshold. Returns { accept, ratio, ... }.
export function aiEvaluate(game, trade, tid) {
  const s = teamSummary(game, trade, tid);
  const profile = positionProfile(game, tid);
  const valueIn = s.inc.reduce((acc, a) => acc + subjectiveIncomingValue(game, tid, a, profile), 0);
  const valueOut = s.valueOut;
  const ratio = valueOut <= 0.001 ? (valueIn > 0 ? Infinity : 1) : valueIn / valueOut;
  return { tid, accept: ratio >= CONFIG.TRADE_FAIRNESS_THRESHOLD, ratio, valueIn, valueOut };
}

// Evaluate every non-user team in the trade. Returns { accepted, verdicts: [] }.
export function aiEvaluateAll(game, trade) {
  const verdicts = (trade.teams || [])
    .filter((tid) => tid !== game.userTid)
    .map((tid) => aiEvaluate(game, trade, tid));
  return { accepted: verdicts.every((v) => v.accept), verdicts };
}

// ---- Execution -------------------------------------------------------------
// Apply a validated + accepted trade: move players' tid, reassign pick owners,
// rebuild affected lineups, and log the transaction. Returns the trade.
export function executeTrade(game, trade) {
  const check = validateTrade(game, trade);
  if (!check.ok) throw new Error(`Illegal trade: ${check.errors[0]}`);
  for (const a of trade.assets) {
    if (a.kind === 'player') {
      const p = playerById(game, a.id);
      if (p) p.tid = a.to;
    } else {
      const dp = pickById(game, a.id);
      if (dp) dp.tid = a.to;
    }
  }
  for (const tid of trade.teams) {
    const t = teamById(game, tid);
    if (t) t.lineup = autoLineup(playersOnTeam(game, tid), game.season);
  }
  game.transactions.push({
    type: 'trade', day: game.day, season: game.season,
    teams: trade.teams.slice(), assets: trade.assets.map((a) => ({ ...a })),
  });
  return trade;
}
