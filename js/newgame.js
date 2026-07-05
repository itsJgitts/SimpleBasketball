// =============================================================================
// newgame.js — turn an uploaded BasketBall-GM league file into a ready-to-play
// game. The user picks which franchise to control; startNewGame() parses the
// league, records that choice as game.userTid, and builds the season schedule.
// listSelectableTeams() gives the UI the team list (with a roster preview) so
// the player can choose their team before the game starts.
// =============================================================================
import { parseLeagueFile } from './roster.js';
import { buildSchedule } from './schedule.js';
import { createRng, rngHelpers, hashSeed } from './rng.js';
import { computeOvr } from './ratings.js';

// Lightweight team list for the team-selection screen. Parses the file just
// enough to show each franchise, its rating, and a couple of star players.
// Does NOT build a full game (fast + side-effect free); startNewGame does that.
export function listSelectableTeams(fileObj) {
  if (!fileObj || !Array.isArray(fileObj.players) || !Array.isArray(fileObj.teams)) {
    throw new Error('This does not look like a BasketBall-GM roster file (missing players/teams).');
  }
  const tidCounts = {};
  for (const p of fileObj.players) if (p.tid >= 0) tidCounts[p.tid] = (tidCounts[p.tid] || 0) + 1;
  const activeTids = new Set(Object.keys(tidCounts).map(Number));

  // Best current-ovr player rows per team (for a quick roster preview).
  const byTeam = {};
  for (const raw of fileObj.players) {
    if (raw.tid < 0 || !activeTids.has(raw.tid)) continue;
    const rs = raw.ratings && raw.ratings.length ? raw.ratings[raw.ratings.length - 1] : null;
    const ovr = rs ? computeOvr(rs) : 0;
    const name = raw.name || `${raw.firstName || ''} ${raw.lastName || ''}`.trim() || 'Unknown';
    (byTeam[raw.tid] = byTeam[raw.tid] || []).push({ name, ovr });
  }

  return fileObj.teams
    .filter((t) => activeTids.has(t.tid) && !t.disabled)
    .sort((a, b) => a.tid - b.tid)
    .map((t) => {
      const roster = (byTeam[t.tid] || []).sort((a, b) => b.ovr - a.ovr);
      const top = roster.slice(0, 3);
      const teamOvr = roster.length
        ? Math.round(roster.slice(0, 8).reduce((s, p) => s + p.ovr, 0) / Math.min(8, roster.length))
        : 0;
      return {
        tid: t.tid,
        region: t.region || t.abbrev || `Team ${t.tid}`,
        name: t.name || 'Team',
        abbrev: t.abbrev || `T${t.tid}`,
        rosterSize: roster.length,
        teamOvr,
        topPlayers: top,
      };
    });
}

// Build a brand-new game controlled by `userTid`. `seed` (optional) makes the
// season deterministic; omit it for a random game. Returns the full game state
// with schedule built and ready for the engine. Throws if userTid is invalid.
export function startNewGame(fileObj, userTid, seed) {
  const usedSeed = seed != null && seed !== '' ? seed : Date.now();
  const game = parseLeagueFile(fileObj, usedSeed);

  const chosen = game.teams.find((t) => t.tid === userTid);
  if (!chosen) {
    throw new Error(`Selected team (tid ${userTid}) is not a valid franchise in this league.`);
  }
  game.userTid = userTid;

  // Build the schedule with rng helpers bound to the game's serialized state so
  // the same seed reproduces the same season.
  if (!game.rng) game.rng = { s: hashSeed(usedSeed) };
  const R = rngHelpers(createRng(game.rng));
  buildSchedule(game, R);

  return game;
}
