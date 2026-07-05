// =============================================================================
// sim.js — simulate a single game.
//   power = minutes-weighted ovr of the 8-man rotation (injured -> replacement)
//   P(home win) = 1 / (1 + 10^(-(powerDiff + HCA) / LOGISTIC_SCALE))
//   winner = single Bernoulli draw; final score sampled from pace x ORtg and
//   nudged so the drawn winner wins; team totals distributed into a box score.
// =============================================================================
import CONFIG from './config.js';
import { posToSlot } from './nbaTeams.js';
import { isHealthy } from './lineup.js';
import { clamp } from './util.js';

// Minutes-weighted ovr of a team's top-8 rotation (injured filled at replacement).
export function powerRating(team, playersById) {
  const rot = Object.entries(team.lineup.minutes || {})
    .filter(([, m]) => m > 0)
    .map(([pid, m]) => ({ p: playersById[pid], m }))
    .filter((x) => x.p)
    .sort((a, b) => b.m - a.m)
    .slice(0, CONFIG.ROTATION_SIZE);
  let num = 0, denom = 0;
  for (const { p, m } of rot) {
    const ovr = isHealthy(p) ? p.ovr : CONFIG.REPLACEMENT_OVR;
    num += ovr * m; denom += m;
  }
  return denom ? num / denom : CONFIG.REPLACEMENT_OVR;
}

// Distribute an integer total across pids by weights (sum stays exact).
function distributeInt(pids, weights, total) {
  const out = {}; let assigned = 0;
  const tw = pids.reduce((s, p) => s + (weights[p] || 0), 0) || 1;
  pids.forEach((p) => { out[p] = Math.max(0, Math.round((weights[p] / tw) * total)); assigned += out[p]; });
  let diff = total - assigned, i = 0;
  while (diff !== 0 && pids.length) {
    const p = pids[i % pids.length];
    const nv = out[p] + (diff > 0 ? 1 : -1);
    if (nv >= 0) { out[p] = nv; diff += diff > 0 ? -1 : 1; }
    i++; if (i > pids.length * 50) break;
  }
  return out;
}

const REB_BONUS = { PG: 0.4, SG: 0.5, SF: 0.9, PF: 1.5, C: 1.8 };
const AST_BONUS = { PG: 2.0, SG: 1.2, SF: 0.9, PF: 0.5, C: 0.5 };

// Build one team's box score lines given its point total.
function teamBox(team, playersById, teamPts, R) {
  const rot = Object.entries(team.lineup.minutes || {})
    .map(([pid, m]) => ({ p: playersById[pid], m }))
    .filter((x) => x.p && x.m > 0 && isHealthy(x.p));
  const pids = rot.map((x) => x.p.pid);
  const wPts = {}, wReb = {}, wAst = {}, wDef = {};
  rot.forEach(({ p, m }) => {
    const slot = posToSlot(p.pos);
    wPts[p.pid] = p.ovr * m;
    wReb[p.pid] = m * (1 + REB_BONUS[slot]);
    wAst[p.pid] = m * (0.5 + AST_BONUS[slot]);
    wDef[p.pid] = m;
  });
  const reb = Math.max(30, Math.round(R.randNorm(CONFIG.TEAM_REB_MEAN, CONFIG.TEAM_REB_STD)));
  const ast = Math.max(12, Math.round(R.randNorm(CONFIG.TEAM_AST_MEAN, CONFIG.TEAM_AST_STD)));
  const stl = Math.max(2, Math.round(R.randNorm(CONFIG.TEAM_STL_MEAN, CONFIG.TEAM_STL_STD)));
  const blk = Math.max(1, Math.round(R.randNorm(CONFIG.TEAM_BLK_MEAN, CONFIG.TEAM_BLK_STD)));
  const tov = Math.max(4, Math.round(R.randNorm(CONFIG.TEAM_TOV_MEAN, CONFIG.TEAM_TOV_STD)));
  const dPts = distributeInt(pids, wPts, teamPts);
  const dReb = distributeInt(pids, wReb, reb);
  const dAst = distributeInt(pids, wAst, ast);
  const dStl = distributeInt(pids, wDef, stl);
  const dBlk = distributeInt(pids, wReb, blk);
  const dTov = distributeInt(pids, wAst, tov);
  return rot.map(({ p, m }) => ({
    pid: p.pid, name: p.name, pos: p.pos, min: m,
    pts: dPts[p.pid], reb: dReb[p.pid], ast: dAst[p.pid],
    stl: dStl[p.pid], blk: dBlk[p.pid], tov: dTov[p.pid],
  }));
}

// Sample a plausible point total for a team given its power rating.
function samplePoints(power, R) {
  const pace = R.randNorm(CONFIG.BASE_PACE, CONFIG.PACE_VARIANCE);
  const base = (pace * CONFIG.BASE_ORTG) / 100;
  const adj = (power - CONFIG.LEAGUE_AVG_POWER) * CONFIG.SCORE_POINTS_PER_POWER;
  return base + adj + R.randNorm(0, CONFIG.SCORE_STDDEV * CONFIG.SIM_VARIANCE);
}

// Simulate one scheduled game. Returns a result/box-score object.
export function simGame(gm, teamsById, playersById, R) {
  const home = teamsById[gm.home], away = teamsById[gm.away];
  const hp = powerRating(home, playersById), ap = powerRating(away, playersById);
  const pDiff = hp - ap + CONFIG.HCA;
  const pHome = 1 / (1 + Math.pow(10, -pDiff / CONFIG.LOGISTIC_SCALE));
  const homeWins = R.rand() < pHome;

  let hs = Math.round(samplePoints(hp, R));
  let as = Math.round(samplePoints(ap, R));
  hs = clamp(hs, 78, 158); as = clamp(as, 78, 158);
  if (hs === as) hs += 1; // no ties
  // Enforce the Bernoulli winner by orienting the margin.
  if (homeWins !== hs > as) { const t = hs; hs = as; as = t; }

  return {
    gid: gm.gid, day: gm.day, date: gm.date, home: gm.home, away: gm.away,
    homeScore: hs, awayScore: as, winner: homeWins ? gm.home : gm.away,
    pHome: Math.round(pHome * 100),
    boxHome: teamBox(home, playersById, hs, R),
    boxAway: teamBox(away, playersById, as, R),
  };
}
