// =============================================================================
// schedule.js — build an 82-game schedule following NBA matchup logic:
//   * 4 games vs each of 4 division opponents            (16)
//   * 3-4 games vs 10 non-division conference opponents  (36: six x4 + four x3)
//   * 2 games vs each of 15 other-conference opponents   (30)
// Home/away is balanced to ~41/41. Games are laid out on calendar days so no
// team plays twice in a day; the trade deadline sits ~62% through the season.
// =============================================================================
import CONFIG from './config.js';

const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const SEASON_START = [9, 22]; // Oct 22 (month is 0-based: 9 = October)

// Symmetric matchup counts: how many times each pair meets.
function matchupCounts(teams, R) {
  const counts = new Map();
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i], b = teams[j];
      let c;
      if (a.cid !== b.cid) c = 2;              // inter-conference
      else if (a.did === b.did) c = 4;         // same division
      else c = 3;                              // same conf, other division (base)
      counts.set(key(a.tid, b.tid), c);
    }
  }
  // Upgrade six non-division same-conference opponents per team 3 -> 4, using a
  // configuration-model pairing (retry until every team hits +6, else accept).
  for (const cid of [...new Set(teams.map((t) => t.cid))]) {
    const conf = teams.filter((t) => t.cid === cid);
    let ok = false;
    for (let attempt = 0; attempt < 200 && !ok; attempt++) {
      const need = {}; conf.forEach((t) => (need[t.tid] = 6));
      const upgraded = new Set();
      const stubs = R.shuffle(conf.flatMap((t) => Array(6).fill(t.tid)));
      const pending = [];
      for (const s of stubs) pending.push(s);
      // greedy match stubs
      const list = R.shuffle(conf.map((t) => t.tid));
      for (const a of list) {
        while (need[a] > 0) {
          const partner = R.shuffle(conf.map((t) => t))
            .find((t) => t.tid !== a && need[t.tid] > 0 && !upgraded.has(key(a, t.tid))
              && teams.find((x) => x.tid === a).did !== t.did);
          if (!partner) break;
          upgraded.add(key(a, partner.tid));
          need[a]--; need[partner.tid]--;
        }
      }
      ok = conf.every((t) => need[t.tid] === 0);
      if (ok) for (const k of upgraded) counts.set(k, 4);
    }
  }
  return counts;
}

// Produce ordered game objects (home/away balanced).
function buildGames(teams, counts, R) {
  const homeCount = {}; teams.forEach((t) => (homeCount[t.tid] = 0));
  const games = [];
  for (const t of R.shuffle(teams.slice())) {
    for (const u of teams) {
      if (u.tid <= t.tid) continue;
      const c = counts.get(key(t.tid, u.tid)) || 0;
      const half = Math.floor(c / 2);
      for (let i = 0; i < half; i++) { games.push([t.tid, u.tid]); games.push([u.tid, t.tid]); }
      if (c % 2 === 1) { // odd extra game: give home to whoever has fewer
        const [h, a] = homeCount[t.tid] <= homeCount[u.tid] ? [t.tid, u.tid] : [u.tid, t.tid];
        games.push([h, a]); homeCount[h]++;
      }
    }
  }
  return R.shuffle(games);
}

// Lay games onto day slots so no team plays twice per day.
function layoutDays(games, teams) {
  const dayOf = [];
  const busy = []; // busy[day] = Set of tids
  const gamesPerDay = [];
  const cap = CONFIG.MAX_GAMES_PER_DAY;
  for (const [h, a] of games) {
    let d = 0;
    while (true) {
      if (!busy[d]) { busy[d] = new Set(); gamesPerDay[d] = 0; }
      if (!busy[d].has(h) && !busy[d].has(a) && gamesPerDay[d] < cap) {
        busy[d].add(h); busy[d].add(a); gamesPerDay[d]++; dayOf.push(d); break;
      }
      d++;
    }
  }
  return dayOf;
}

function dateForDay(day) {
  const d = new Date(2024, SEASON_START[0], SEASON_START[1]);
  d.setDate(d.getDate() + day);
  return d.toISOString().slice(0, 10);
}

// Build and attach the schedule to a game object. `R` = rng helpers.
export function buildSchedule(game, R) {
  const teams = game.teams;
  const counts = matchupCounts(teams, R);
  const games = buildGames(teams, counts, R);
  const dayOf = layoutDays(games, teams);
  let gid = game.nextGid || 0;
  game.schedule = games.map(([home, away], i) => ({
    gid: gid++, day: dayOf[i], home, away, date: dateForDay(dayOf[i]), played: false,
  })).sort((x, y) => x.day - y.day || x.gid - y.gid);
  game.nextGid = gid;
  const numDays = Math.max(...dayOf) + 1;
  game.numDays = numDays;
  game.tradeDeadlineDay = Math.round(numDays * 0.62);
  return game.schedule;
}
