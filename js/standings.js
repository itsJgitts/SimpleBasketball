// =============================================================================
// standings.js — compute standings from played results and apply NBA-style
// tiebreakers: head-to-head -> division record -> conference record -> coin flip.
// The coin flip is provided by a callback so the UI can let the user call it.
// =============================================================================
import { pct } from './util.js';

function emptyRec(team) {
  return {
    tid: team.tid, cid: team.cid, did: team.did, abbrev: team.abbrev,
    region: team.region, name: team.name,
    w: 0, l: 0, homeW: 0, homeL: 0, awayW: 0, awayL: 0,
    divW: 0, divL: 0, confW: 0, confL: 0, pf: 0, pa: 0,
    streak: 0, h2h: {}, resultsSeq: [],
  };
}

function bump(h2h, opp, win) {
  if (!h2h[opp]) h2h[opp] = { w: 0, l: 0 };
  h2h[opp][win ? 'w' : 'l']++;
}

// Build a { byTid, list } snapshot from all completed games in game.results.
export function computeStandings(game) {
  const byTid = {};
  const cidOf = {}, didOf = {};
  game.teams.forEach((t) => { byTid[t.tid] = emptyRec(t); cidOf[t.tid] = t.cid; didOf[t.tid] = t.did; });
  for (const gid of Object.keys(game.results)) {
    const r = game.results[gid];
    if (r.playoff) continue; // regular-season standings only
    const h = byTid[r.home], a = byTid[r.away];
    if (!h || !a) continue;
    const homeWin = r.winner === r.home;
    h.pf += r.homeScore; h.pa += r.awayScore; a.pf += r.awayScore; a.pa += r.homeScore;
    h[homeWin ? 'w' : 'l']++; a[homeWin ? 'l' : 'w']++;
    h[homeWin ? 'homeW' : 'homeL']++; a[homeWin ? 'awayL' : 'awayW']++;
    bump(h.h2h, a.tid, homeWin); bump(a.h2h, h.tid, !homeWin);
    if (cidOf[r.home] === cidOf[r.away]) { h[homeWin ? 'confW' : 'confL']++; a[homeWin ? 'confL' : 'confW']++; }
    if (didOf[r.home] === didOf[r.away]) { h[homeWin ? 'divW' : 'divL']++; a[homeWin ? 'divL' : 'divW']++; }
    h.streak = homeWin ? Math.max(1, h.streak + 1) : Math.min(-1, h.streak - 1);
    a.streak = homeWin ? Math.min(-1, a.streak - 1) : Math.max(1, a.streak + 1);
    h.resultsSeq.push(homeWin ? 'W' : 'L'); a.resultsSeq.push(homeWin ? 'L' : 'W');
  }
  const list = Object.values(byTid);
  list.forEach((r) => { r.pct = pct(r.w, r.l); });
  return { byTid, list };
}

// Compare two teams (return <0 if a ranks ahead). coinFn(a,b) -> tid winner.
export function compareTeams(a, b, coinFn) {
  if (b.pct !== a.pct) return b.pct - a.pct;
  // 1) head-to-head win %
  const hA = a.h2h[b.tid] || { w: 0, l: 0 };
  const hB = b.h2h[a.tid] || { w: 0, l: 0 };
  if (hA.w + hA.l > 0) {
    const d = pct(hB.w, hB.l) - pct(hA.w, hA.l);
    if (d !== 0) return d;
  }
  // 2) division record (only meaningful if same division)
  if (a.did === b.did) {
    const d = pct(b.divW, b.divL) - pct(a.divW, a.divL);
    if (d !== 0) return d;
  }
  // 3) conference record
  const dc = pct(b.confW, b.confL) - pct(a.confW, a.confL);
  if (dc !== 0) return dc;
  // 4) coin flip
  const winner = coinFn ? coinFn(a, b) : (a.tid < b.tid ? a.tid : b.tid);
  return winner === a.tid ? -1 : 1;
}

export function sortTeams(recs, coinFn) {
  return recs.slice().sort((a, b) => compareTeams(a, b, coinFn));
}

// Conference standings (array of records, seeded 1..n).
export function conferenceStandings(game, cid, coinFn) {
  const { list } = computeStandings(game);
  return sortTeams(list.filter((r) => r.cid === cid), coinFn);
}

export function winPct(game, tid) {
  const { byTid } = computeStandings(game);
  return byTid[tid] ? byTid[tid].pct : 0.5;
}
