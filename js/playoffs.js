// =============================================================================
// playoffs.js — seed 8 teams per conference (standings + tiebreakers), build a
// bracket, and simulate best-of-7 series. Home court goes to the higher seed
// in a 2-2-1-1-1 pattern (higher seed hosts games 1,2,5,7). Conference winners
// meet in the Finals. Playoff games are flagged so they don't affect standings.
// State lives on game.playoffs = { round, conf: { [cid]: [series...] }, finals }.
// =============================================================================
import CONFIG from './config.js';
import { conferenceStandings } from './standings.js';
import { simGame } from './sim.js';

const teamById = (game, tid) => game.teams.find((t) => t.tid === tid);
// Higher seed hosts games (1-based indices) 1,2,5,7; lower seed hosts 3,4,6.
const HOME_FOR_GAME = [true, true, false, false, true, false, true];

function makeSeries(hi, lo) {
  return {
    hi: hi.tid, lo: lo.tid, hiSeed: hi.seed, loSeed: lo.seed,
    hiWins: 0, loWins: 0, games: [], winner: null,
  };
}

// Seed a conference: top PLAYOFF_TEAMS_PER_CONF teams, matched 1v8,4v5,3v6,2v7.
function seedConference(game, cid, coinFn) {
  const ranked = conferenceStandings(game, cid, coinFn)
    .slice(0, CONFIG.PLAYOFF_TEAMS_PER_CONF)
    .map((r, i) => ({ tid: r.tid, seed: i + 1 }));
  const n = ranked.length;
  const pairs = [];
  for (let i = 0; i < n / 2; i++) pairs.push([ranked[i], ranked[n - 1 - i]]);
  // Standard bracket order: (1v8),(4v5),(3v6),(2v7) so winners meet correctly.
  const order = [0, 3, 2, 1].filter((i) => i < pairs.length);
  return order.map((i) => makeSeries(pairs[i][0], pairs[i][1]));
}

// Build the initial bracket from final regular-season standings.
export function seedPlayoffs(game, coinFn) {
  const cids = [...new Set(game.teams.map((t) => t.cid))];
  const conf = {};
  for (const cid of cids) conf[cid] = seedConference(game, cid, coinFn);
  game.playoffs = { round: 1, cids, conf, finals: null, champion: null };
  game.phase = 'playoffs';
  return game.playoffs;
}

// Simulate the remaining games of one best-of-7 series to completion.
export function simSeries(game, series, R) {
  const teamsById = {}; game.teams.forEach((t) => (teamsById[t.tid] = t));
  const playersById = {}; game.players.forEach((p) => (playersById[p.pid] = p));
  const need = Math.ceil(CONFIG.PLAYOFF_SERIES_LENGTH / 2); // 4
  while (series.hiWins < need && series.loWins < need) {
    const idx = series.games.length; // 0-based game number
    const hiHome = HOME_FOR_GAME[idx];
    const home = hiHome ? series.hi : series.lo;
    const away = hiHome ? series.lo : series.hi;
    const gm = { gid: game.nextGid++, day: game.day, date: null, home, away };
    const res = simGame(gm, teamsById, playersById, R);
    res.playoff = true;
    game.results[res.gid] = res;
    if (res.winner === series.hi) series.hiWins++; else series.loWins++;
    series.games.push({ gid: res.gid, home, away, homeScore: res.homeScore, awayScore: res.awayScore, winner: res.winner });
  }
  series.winner = series.hiWins > series.loWins ? series.hi : series.lo;
  return series;
}

// Winner as a seed object for building the next round.
function winnerSeed(series) {
  const won = series.winner === series.hi;
  return { tid: series.winner, seed: won ? series.hiSeed : series.loSeed };
}

// Re-pair the winners of a conference's completed round (higher seed vs lower).
function nextConfRound(seriesList) {
  const winners = seriesList.map(winnerSeed);
  const out = [];
  for (let i = 0; i < winners.length; i += 2) {
    const a = winners[i], b = winners[i + 1];
    if (!b) { out.push(makeSeries(a, a)); continue; }
    const [hi, lo] = a.seed <= b.seed ? [a, b] : [b, a];
    out.push(makeSeries(hi, lo));
  }
  return out;
}

// Simulate every unfinished series in the current round, then advance the
// bracket (next conf round, or set up / play the Finals, or crown a champion).
export function simCurrentRound(game, R) {
  const po = game.playoffs;
  if (!po) throw new Error('Playoffs have not been seeded.');
  if (po.finals && !po.champion) {
    if (!po.finals.winner) simSeries(game, po.finals, R);
    po.champion = po.finals.winner;
    game.phase = 'offseason';
    return po;
  }
  // Play out each conference's current-round series.
  for (const cid of po.cids) for (const s of po.conf[cid]) if (!s.winner) simSeries(game, s, R);
  // Advance each conference; if only one series remains per conf, that produced
  // the conference champion -> build the Finals.
  const confChamps = {};
  let confFinished = true;
  for (const cid of po.cids) {
    if (po.conf[cid].length > 1) {
      po.conf[cid] = nextConfRound(po.conf[cid]);
      confFinished = false;
    } else {
      confChamps[cid] = winnerSeed(po.conf[cid][0]);
    }
  }
  if (confFinished) {
    const seeds = po.cids.map((cid) => confChamps[cid]);
    const [hi, lo] = seeds[0].seed <= seeds[1].seed ? [seeds[0], seeds[1]] : [seeds[1], seeds[0]];
    po.finals = makeSeries(hi, lo);
    po.round = 'finals';
  } else {
    po.round = typeof po.round === 'number' ? po.round + 1 : po.round;
  }
  return po;
}

// Convenience: run the entire postseason to a champion. Returns the tid.
export function simEntirePlayoffs(game, R, coinFn) {
  if (!game.playoffs) seedPlayoffs(game, coinFn);
  let guard = 0;
  while (!game.playoffs.champion && guard++ < 20) simCurrentRound(game, R);
  return game.playoffs.champion;
}

// Human-readable label for a series (for the bracket UI).
export function seriesLabel(game, series) {
  const hi = teamById(game, series.hi), lo = teamById(game, series.lo);
  const h = hi ? `(${series.hiSeed}) ${hi.abbrev}` : '?';
  const l = lo ? `(${series.loSeed}) ${lo.abbrev}` : '?';
  return `${h} ${series.hiWins}-${series.loWins} ${l}`;
}
