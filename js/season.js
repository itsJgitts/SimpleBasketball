// =============================================================================
// season.js — offseason rollover into the next season. After the draft: expire
// contracts (players whose deal is up become free agents), age & develop every
// player, clear last season's results/playoffs, advance the season counter, and
// build a fresh schedule. Returns a summary for the season-transition screen.
// =============================================================================
import CONFIG from './config.js';
import { buildSchedule } from './schedule.js';
import { progressAllPlayers } from './progression.js';
import { autoLineup } from './lineup.js';
import { refreshPlayer, marketValue } from './ratings.js';

// The set of playoff team ids for a completed season: top PLAYOFF_TEAMS_PER_CONF
// of each conference by final record. Used to build the draft order.
import { conferenceStandings } from './standings.js';
export function playoffTids(game, coinFn) {
  const cids = [...new Set(game.teams.map((t) => t.cid))];
  const tids = [];
  for (const cid of cids) {
    conferenceStandings(game, cid, coinFn)
      .slice(0, CONFIG.PLAYOFF_TEAMS_PER_CONF)
      .forEach((r) => tids.push(r.tid));
  }
  return tids;
}

// Move players whose contract has expired (exp <= current season) to free
// agency. Rookies just drafted have exp in the future so they are retained.
function expireContracts(game) {
  let released = 0;
  for (const p of game.players) {
    if (p.tid < 0) continue;
    if (p.contract && p.contract.exp <= game.season) { p.tid = -1; released++; }
  }
  return released;
}

// AI teams below the roster minimum sign the best available free agents until
// they reach ROSTER_MIN. Contracts are market-rate for the new season. Returns
// the number of signings made across the league.
function fillRosters(game) {
  const freeAgentPool = () => game.players
    .filter((p) => p.tid === -1)
    .sort((a, b) => b.ovr - a.ovr);
  let signings = 0;
  for (const t of game.teams) {
    let size = game.players.filter((p) => p.tid === t.tid).length;
    while (size < CONFIG.ROSTER_MIN) {
      const fa = freeAgentPool()[0];
      if (!fa) break;
      fa.tid = t.tid;
      fa.contract = { amount: Math.max(CONFIG.MIN_SALARY, marketValue(fa.ovr)), exp: game.season + 2 };
      signings++; size++;
    }
  }
  return signings;
}

// Roll the game into its next season. Assumes the draft (if any) is done.
// `R` = rng helpers (bound to game.rng) used to build the new schedule.
export function startNextSeason(game, R) {
  const prevSeason = game.season;
  const released = expireContracts(game);
  game.season += 1;

  // Age & develop everyone (young rise, old decline) into the new season.
  const changes = progressAllPlayers(game.players, game.season);
  game.players.forEach((p) => refreshPlayer(p, game.season));

  // Refill any under-manned rosters from the free-agent pool (AI signings).
  const signings = fillRosters(game);

  // Reset per-season play state.
  game.results = {};
  game.playoffs = null;
  game.draftClass = null;
  game.day = 0;
  game.phase = 'regular';
  game.schedule = [];

  // Rebuild lineups (rosters changed via FA/draft) and a new schedule.
  for (const t of game.teams) {
    t.lineup = autoLineup(game.players.filter((p) => p.tid === t.tid), game.season);
  }
  buildSchedule(game, R);

  const risers = changes.slice(0, 5);
  const fallers = changes.slice(-5).reverse();
  return { prevSeason, newSeason: game.season, released, signings, risers, fallers };
}
