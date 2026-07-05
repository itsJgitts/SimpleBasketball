// =============================================================================
// progression.js — in-season injuries and end-of-season aging.
//   Injuries: each game a player rolls INJURY_BASE_RATE * proneness to pick up
//   a new injury lasting an exponential-ish number of games; healthy players
//   with an active injury count down one game per team game.
//   Aging: at season rollover, young/high-pot players improve toward their
//   ceiling while older players decline. Applied to the BBGM component ratings
//   so ovr/pot recompute cleanly via refreshPlayer().
// =============================================================================
import CONFIG from './config.js';
import { isHealthy } from './lineup.js';
import { refreshPlayer, latestRatings, playerAge, computeOvr } from './ratings.js';
import { clamp } from './util.js';

// Component keys the aging delta is applied to (height is a fixed trait).
const SKILL_KEYS = ['stre', 'spd', 'jmp', 'endu', 'ins', 'dnk', 'ft', 'tp', 'oiq', 'diq', 'drb', 'pss', 'fg', 'reb'];

const INJURY_TYPES = [
  'Sprained Ankle', 'Strained Hamstring', 'Sore Knee', 'Sprained Wrist',
  'Bruised Quad', 'Sore Back', 'Concussion', 'Sprained Finger',
  'Strained Groin', 'Sore Shoulder', 'Foot Injury', 'Sore Achilles',
];

// Games missed for a new injury: exponential, clamped to [MIN, MAX].
function injuryDuration(R) {
  const mean = CONFIG.INJURY_SEVERITY_MEAN;
  const g = Math.ceil(-mean * Math.log(1 - R.rand()));
  return clamp(g, CONFIG.INJURY_MIN_GAMES, CONFIG.INJURY_MAX_GAMES);
}

// Roll a possible new injury for one player about to play. Mutates p.injury.
export function rollInjury(p, R) {
  if (!isHealthy(p)) return null;
  const rate = CONFIG.INJURY_BASE_RATE * (p.injuryProneness || 1);
  if (R.rand() >= rate) return null;
  const type = R.choice(INJURY_TYPES);
  const games = injuryDuration(R);
  p.injury = { type, gamesRemaining: games };
  return { pid: p.pid, name: p.name, type, games };
}

// Advance injuries for every player on a team that just played a game.
// Players who appeared (had minutes) may pick up a new injury; anyone already
// injured recovers one game. Returns a list of new injuries for reporting.
export function processTeamInjuries(team, playersById, R) {
  const newInjuries = [];
  const minutes = team.lineup.minutes || {};
  for (const pid of Object.keys(minutes)) {
    const p = playersById[pid];
    if (!p) continue;
    if (minutes[pid] > 0) {
      const inj = rollInjury(p, R);
      if (inj) newInjuries.push(inj);
    }
  }
  return newInjuries;
}

// Recover one game off every active injury across all players (call once per
// day/game that a player's team plays). Returns pids that became healthy.
export function recoverInjuries(players) {
  const recovered = [];
  for (const p of players) {
    if (p.injury && p.injury.gamesRemaining > 0) {
      p.injury.gamesRemaining -= 1;
      if (p.injury.gamesRemaining <= 0) {
        p.injury = { type: 'Healthy', gamesRemaining: 0 };
        recovered.push(p.pid);
      }
    }
  }
  return recovered;
}

// Per-season rating delta (in ovr-equivalent points) from age + potential.
// Young players with room to their potential improve; older players decline.
function seasonDelta(p, age) {
  const upside = Math.max(0, p.pot - p.ovr);
  if (age <= CONFIG.PROGRESSION_YOUNG_AGE) {
    const growth = upside * CONFIG.PROGRESSION_POT_SCALE * (1 + (CONFIG.PROGRESSION_YOUNG_AGE - age) * 0.15);
    return clamp(growth, 0, CONFIG.PROGRESSION_MAX_GROWTH);
  }
  if (age >= CONFIG.PROGRESSION_OLD_AGE) {
    const over = age - CONFIG.PROGRESSION_OLD_AGE;
    const decline = 1 + over * 0.8;
    return -clamp(decline, 0, CONFIG.PROGRESSION_MAX_DECLINE);
  }
  // Prime years: mild drift toward potential, near-flat.
  return clamp(upside * CONFIG.PROGRESSION_POT_SCALE * 0.35, 0, CONFIG.PROGRESSION_MAX_GROWTH * 0.5);
}

// The ovr formula's leading component coefficients sum to ~0.8709, so shifting
// every skill by `x` moves ovr by ~0.8709*x. Invert to get a first-guess step.
const OVR_SENSITIVITY = 0.8709;

// Build a candidate ratings row by shifting all skill components by `step`.
function shiftRatings(prev, step, newSeason) {
  const next = { ...prev, season: newSeason };
  for (const k of SKILL_KEYS) {
    if (next[k] !== undefined) next[k] = clamp(next[k] + step, 0, 100);
  }
  return next;
}

// Develop one player into the new season: append a new ratings row whose skill
// components are shifted so the *realized* ovr change matches the intended
// age/potential delta (respecting the growth/decline caps despite the ovr
// formula's non-linearity). Returns { pid, name, before, after, delta }.
export function developPlayer(p, newSeason) {
  const prev = latestRatings(p, newSeason);
  if (!prev) return null;
  const before = p.ovr;
  const age = playerAge(p, newSeason);
  const target = seasonDelta(p, age); // desired ovr change (signed)
  // Proportional correction: nudge the per-skill step until the realized ovr
  // change is within 0.5 of the target (a few iterations converge).
  let step = target / OVR_SENSITIVITY;
  let next = shiftRatings(prev, step, newSeason);
  for (let i = 0; i < 6; i++) {
    const realized = computeOvr(next) - before;
    if (Math.abs(realized - target) <= 0.5) break;
    const denom = Math.abs(step) < 1e-6 ? OVR_SENSITIVITY : (realized / step) || OVR_SENSITIVITY;
    step += (target - realized) / denom;
    next = shiftRatings(prev, step, newSeason);
  }
  for (const k of SKILL_KEYS) if (next[k] !== undefined) next[k] = Math.round(next[k]);
  p.ratings.push(next);
  refreshPlayer(p, newSeason);
  return { pid: p.pid, name: p.name, before, after: p.ovr, delta: p.ovr - before };
}

// Age & develop every player for the upcoming season. Returns a summary list
// of the biggest risers/fallers for the season-summary UI.
export function progressAllPlayers(players, newSeason) {
  const changes = [];
  for (const p of players) {
    const c = developPlayer(p, newSeason);
    if (c) changes.push(c);
  }
  changes.sort((a, b) => b.delta - a.delta);
  return changes;
}
