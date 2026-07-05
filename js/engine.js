// =============================================================================
// engine.js — season orchestration. Advances the calendar one day at a time,
// simulating every scheduled game on that day, accumulating per-player season
// stats, and processing injuries (new injuries for players who appeared, and
// recovery for teams that played). Higher-level "advance to X" helpers drive
// the sim controls in the UI. Regular-season play only; playoffs live elsewhere.
// =============================================================================
import CONFIG from './config.js';
import { simGame } from './sim.js';
import { processTeamInjuries } from './progression.js';

// Fast lookups rebuilt per call (teams/players may change via trades/signings).
function indexGame(game) {
  const teamsById = {}; game.teams.forEach((t) => (teamsById[t.tid] = t));
  const playersById = {}; game.players.forEach((p) => (playersById[p.pid] = p));
  return { teamsById, playersById };
}

// Get (or create) a player's stat accumulator row for a season.
function statRow(player, season) {
  let row = player.stats.find((s) => s.season === season && !s.playoffs);
  if (!row) {
    row = { season, playoffs: false, gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };
    player.stats.push(row);
  }
  return row;
}

// Fold one team's box-score lines into the players' season accumulators.
function accumulateBox(box, playersById, season) {
  for (const line of box) {
    const p = playersById[line.pid];
    if (!p) continue;
    const row = statRow(p, season);
    row.gp += 1; row.min += line.min; row.pts += line.pts; row.reb += line.reb;
    row.ast += line.ast; row.stl += line.stl; row.blk += line.blk; row.tov += line.tov;
  }
}

// Recover one game off active injuries for every player on a team that played.
function recoverTeam(team, playersById) {
  for (const pid of Object.keys(team.lineup.minutes || {})) {
    const p = playersById[pid];
    if (p && p.injury && p.injury.gamesRemaining > 0) {
      p.injury.gamesRemaining -= 1;
      if (p.injury.gamesRemaining <= 0) p.injury = { type: 'Healthy', gamesRemaining: 0 };
    }
  }
}

// Simulate every unplayed regular-season game scheduled on `day`.
// Returns { results: [...], injuries: [...] } for that day.
export function simDay(game, day, ctx = indexGame(game)) {
  const { teamsById, playersById } = ctx;
  const R = game.__R; // rng helpers bound by the caller (see runToDay)
  const todays = game.schedule.filter((gm) => gm.day === day && !gm.played);
  const results = [], injuries = [];
  for (const gm of todays) {
    const res = simGame(gm, teamsById, playersById, R);
    game.results[res.gid] = res;
    gm.played = true;
    results.push(res);
    accumulateBox(res.boxHome, playersById, game.season);
    accumulateBox(res.boxAway, playersById, game.season);
    // New injuries occur to players who appeared; then both teams recover a game.
    const home = teamsById[gm.home], away = teamsById[gm.away];
    processTeamInjuries(home, playersById, R).forEach((i) => injuries.push({ ...i, tid: home.tid }));
    processTeamInjuries(away, playersById, R).forEach((i) => injuries.push({ ...i, tid: away.tid }));
    recoverTeam(home, playersById);
    recoverTeam(away, playersById);
  }
  return { results, injuries };
}

// Has the entire regular season been played?
export function regularSeasonComplete(game) {
  return game.schedule.length > 0 && game.schedule.every((gm) => gm.played);
}

// The next day (>= game.day) on which the user's team has an unplayed game,
// or null if none remain.
export function nextUserGameDay(game) {
  const upcoming = game.schedule
    .filter((gm) => !gm.played && gm.day >= game.day && (gm.home === game.userTid || gm.away === game.userTid))
    .map((gm) => gm.day);
  return upcoming.length ? Math.min(...upcoming) : null;
}

// Core driver: advance the calendar until `stop(game, day)` returns true or the
// season ends. `inclusive` controls whether the stop day itself is simulated.
// Returns an aggregate { daysAdvanced, results, injuries }.
export function advanceUntil(game, R, stop, { inclusiveStop = false } = {}) {
  game.__R = R;
  const ctx = indexGame(game);
  const agg = { daysAdvanced: 0, results: [], injuries: [] };
  while (!regularSeasonComplete(game) && game.day < game.numDays) {
    if (stop && stop(game, game.day)) {
      if (inclusiveStop) {
        const d = simDay(game, game.day, ctx);
        agg.results.push(...d.results); agg.injuries.push(...d.injuries);
        agg.daysAdvanced += 1; game.day += 1;
      }
      break;
    }
    const d = simDay(game, game.day, ctx);
    agg.results.push(...d.results); agg.injuries.push(...d.injuries);
    agg.daysAdvanced += 1; game.day += 1;
  }
  delete game.__R;
  return agg;
}

// ---- Convenience advance modes (used by the sim-controls UI) ----------------

// Simulate up to and including the user's next game day (so results are visible).
export function advanceToNextUserGame(game, R) {
  const target = nextUserGameDay(game);
  if (target == null) return advanceToSeasonEnd(game, R);
  return advanceUntil(game, R, (g, d) => d >= target, { inclusiveStop: true });
}

// Simulate the next `n` calendar days.
export function advanceDays(game, R, n) {
  const end = game.day + n;
  return advanceUntil(game, R, (g, d) => d >= end);
}

// Simulate up to (but not through) the trade deadline day.
export function advanceToDeadline(game, R) {
  return advanceUntil(game, R, (g, d) => d >= g.tradeDeadlineDay);
}

// Simulate the remainder of the regular season.
export function advanceToSeasonEnd(game, R) {
  return advanceUntil(game, R, null);
}
