// =============================================================================
// lineup.js — pure lineup helpers: auto-generate a depth chart + minutes, and
// validate that assigned minutes sum to exactly TOTAL_TEAM_MINUTES (240).
// Starters (one per slot), bench order, and per-player minutes are stored on
// team.lineup. UI wiring lives in ui/lineup.js.
// =============================================================================
import CONFIG from './config.js';
import { SLOTS, posToSlot } from './nbaTeams.js';
import { refreshPlayer } from './ratings.js';
import { clamp } from './util.js';

// Is a player available to play (not injured this game)?
export function isHealthy(p) {
  return !p.injury || p.injury.gamesRemaining <= 0 || p.injury.type === 'Healthy';
}

// Distribute `total` minutes across ranked pids, weighted by weight[pid],
// capped at maxEach per player, returning integer minutes that sum to `total`.
function distributeMinutes(pids, weights, total, maxEach) {
  const mins = {};
  pids.forEach((pid) => (mins[pid] = 0));
  const totalW = pids.reduce((s, pid) => s + weights[pid], 0) || 1;
  let assigned = 0;
  pids.forEach((pid) => {
    const m = clamp(Math.round((weights[pid] / totalW) * total), 0, maxEach);
    mins[pid] = m; assigned += m;
  });
  // Fix rounding drift so the sum is exactly `total`.
  let diff = total - assigned;
  let i = 0;
  while (diff !== 0 && pids.length) {
    const pid = pids[i % pids.length];
    const step = diff > 0 ? 1 : -1;
    const nv = mins[pid] + step;
    if (nv >= 0 && nv <= maxEach) { mins[pid] = nv; diff -= step; }
    i++;
    if (i > pids.length * (maxEach + 2)) break;
  }
  return mins;
}

// Build a full lineup {starters, bench, minutes} from a team's players.
export function autoLineup(players, season) {
  players.forEach((p) => refreshPlayer(p, season));
  const healthy = players.filter(isHealthy).sort((a, b) => b.ovr - a.ovr);
  const pool = healthy.length >= CONFIG.LINEUP_SLOTS ? healthy
    : players.slice().sort((a, b) => b.ovr - a.ovr); // fall back if too injured

  const used = new Set();
  const starters = {};
  for (const slot of SLOTS) {
    const cand = pool.find((p) => !used.has(p.pid) && posToSlot(p.pos) === slot);
    const pick = cand || pool.find((p) => !used.has(p.pid));
    if (pick) { starters[slot] = pick.pid; used.add(pick.pid); }
    else starters[slot] = null;
  }
  const bench = pool.filter((p) => !used.has(p.pid)).map((p) => p.pid);

  // Minutes: top ROTATION players share 240, weighted by ovr, starters favored.
  const ordered = [...SLOTS.map((s) => starters[s]).filter((x) => x != null), ...bench];
  const rotation = ordered.slice(0, Math.max(CONFIG.ROTATION_SIZE, CONFIG.LINEUP_SLOTS));
  const weights = {};
  rotation.forEach((pid, idx) => {
    const p = players.find((x) => x.pid === pid);
    const starterBonus = idx < CONFIG.LINEUP_SLOTS ? 12 : 0;
    weights[pid] = (p ? p.ovr : 40) + starterBonus;
  });
  const minutes = {};
  players.forEach((p) => (minutes[p.pid] = 0));
  Object.assign(minutes, distributeMinutes(rotation, weights, CONFIG.TOTAL_TEAM_MINUTES, CONFIG.MINUTES_PER_GAME));
  return { starters, bench, minutes };
}

// Total minutes currently assigned in a lineup.
export function totalMinutes(lineup) {
  return Object.values(lineup.minutes || {}).reduce((s, m) => s + (m || 0), 0);
}

// Validate: exactly TOTAL_TEAM_MINUTES and no player over MINUTES_PER_GAME.
export function validateLineup(lineup) {
  const total = totalMinutes(lineup);
  const over = Object.values(lineup.minutes || {}).some((m) => m > CONFIG.MINUTES_PER_GAME);
  return {
    ok: total === CONFIG.TOTAL_TEAM_MINUTES && !over,
    total,
    target: CONFIG.TOTAL_TEAM_MINUTES,
    over,
  };
}

// Players with minutes > 0, sorted high to low (used by the sim as the rotation).
export function activeRotation(team, playersById) {
  return Object.entries(team.lineup.minutes || {})
    .filter(([, m]) => m > 0)
    .map(([pid, m]) => ({ p: playersById[pid], min: m }))
    .filter((x) => x.p)
    .sort((a, b) => b.min - a.min);
}

// ---- Manual editing (called by the lineup UI) ------------------------------
// Set the starter for `slot` to `pid`. If `pid` already starts elsewhere or is
// on the bench, swap so no player appears twice. Mutates and returns lineup.
export function setStarter(lineup, slot, pid) {
  if (!SLOTS.includes(slot)) throw new Error(`Unknown slot ${slot}.`);
  const prev = lineup.starters[slot];
  // If pid currently starts in another slot, swap the two starters.
  const otherSlot = SLOTS.find((s) => s !== slot && lineup.starters[s] === pid);
  if (otherSlot) {
    lineup.starters[otherSlot] = prev;
  } else {
    // pid is on the bench: move the displaced starter to the bench in its place.
    lineup.bench = lineup.bench.filter((x) => x !== pid);
    if (prev != null) lineup.bench.unshift(prev);
  }
  lineup.starters[slot] = pid;
  return lineup;
}

// Move a bench player up or down in the rotation order. dir = -1 (up) | +1.
export function moveBench(lineup, pid, dir) {
  const i = lineup.bench.indexOf(pid);
  if (i < 0) return lineup;
  const j = clamp(i + dir, 0, lineup.bench.length - 1);
  if (i === j) return lineup;
  [lineup.bench[i], lineup.bench[j]] = [lineup.bench[j], lineup.bench[i]];
  return lineup;
}

// Set one player's minutes and rebalance the remaining rotation players so the
// team total stays exactly TOTAL_TEAM_MINUTES (240). Players at 0 stay at 0.
export function setMinutes(lineup, pid, value) {
  const mins = lineup.minutes;
  if (mins[pid] === undefined) throw new Error('Player not in lineup.');
  const target = CONFIG.TOTAL_TEAM_MINUTES;
  mins[pid] = clamp(Math.round(value), 0, CONFIG.MINUTES_PER_GAME);
  // Rebalance the *other* rotation players (those with minutes) proportionally.
  const others = Object.keys(mins).filter((k) => Number(k) !== pid && mins[k] > 0);
  let remaining = target - mins[pid];
  const otherTotal = others.reduce((s, k) => s + mins[k], 0) || 1;
  let assigned = 0;
  others.forEach((k) => { mins[k] = clamp(Math.round(mins[k] / otherTotal * remaining), 0, CONFIG.MINUTES_PER_GAME); assigned += mins[k]; });
  // Fix drift on the others so the grand total is exactly `target`.
  let diff = remaining - assigned;
  let i = 0;
  while (diff !== 0 && others.length) {
    const k = others[i % others.length];
    const step = diff > 0 ? 1 : -1;
    const nv = mins[k] + step;
    if (nv >= 0 && nv <= CONFIG.MINUTES_PER_GAME) { mins[k] = nv; diff -= step; }
    i++;
    if (i > others.length * (CONFIG.MINUTES_PER_GAME + 2)) break;
  }
  return lineup;
}
