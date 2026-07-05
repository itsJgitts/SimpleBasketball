// =============================================================================
// roster.js — parse an uploaded BasketBall-GM league file into our game state.
// Handles: active-team detection, player normalization, ovr/pot derivation,
// roster trimming to the cap, conference/division layout, and future picks.
// =============================================================================
import CONFIG from './config.js';
import { getGameAttr, DEFAULT_CONFS, DEFAULT_DIVS, ABBREV_ALIGNMENT } from './nbaTeams.js';
import { refreshPlayer, marketValue } from './ratings.js';
import { autoLineup } from './lineup.js';
import { hashSeed } from './rng.js';

// Deterministic injury-proneness in [1/spread .. spread] from a player id.
function pronenessFromPid(pid) {
  const spread = CONFIG.INJURY_PRONENESS_SPREAD;
  const r = ((Math.imul(pid + 1, 2654435761) >>> 0) % 1000) / 1000; // 0..1
  return 1 / spread + r * (spread - 1 / spread);
}

// Map the BBGM per-season stat rows onto our accumulator shape so the career
// modal can show real history. BBGM stores rebounds split as orb+drb and totals
// per season; we keep season totals (the modal divides by gp for per-game).
function mapStats(rawStats) {
  return (rawStats || [])
    .filter((s) => s && s.gp > 0)
    .map((s) => ({
      season: s.season,
      playoffs: !!s.playoffs,
      tid: s.tid,
      gp: s.gp || 0,
      min: s.min || 0,
      pts: s.pts || 0,
      reb: (s.orb || 0) + (s.drb || 0),
      ast: s.ast || 0,
      stl: s.stl || 0,
      blk: s.blk || 0,
      tov: s.tov || 0,
    }));
}

function normalizePlayer(raw, pid, season) {
  const name = raw.name || `${raw.firstName || ''} ${raw.lastName || ''}`.trim() || 'Unknown';
  const contract = raw.contract && raw.contract.amount
    ? { amount: raw.contract.amount, exp: raw.contract.exp || season + 1 }
    : null;
  const p = {
    pid,
    tid: raw.tid,
    name,
    pos: raw.pos || 'SF',
    hgt: raw.hgt || 78,
    weight: raw.weight || 210,
    born: raw.born && raw.born.year ? { year: raw.born.year, loc: raw.born.loc || '' } : { year: season - 24, loc: '' },
    draft: raw.draft || { round: 0, pick: 0, year: season, tid: raw.tid, originalTid: raw.tid },
    ratings: (raw.ratings || []).map((r) => ({ ...r })),
    contract,
    injury: raw.injury && raw.injury.type ? { type: raw.injury.type, gamesRemaining: raw.injury.gamesRemaining || 0 } : { type: 'Healthy', gamesRemaining: 0 },
    injuryProneness: pronenessFromPid(pid),
    stats: mapStats(raw.stats), // real history from the file; sim appends to it
  };
  refreshPlayer(p, season);
  if (!p.contract) {
    // Synthesize a market-rate deal for players missing contract data.
    p.contract = { amount: Math.max(CONFIG.MIN_SALARY, marketValue(p.ovr)), exp: season + 2 };
  }
  return p;
}

// Trim each team to ROSTER_MAX by ovr; extras become free agents (tid -1).
function trimRosters(players) {
  const byTeam = {};
  for (const p of players) {
    if (p.tid < 0) continue;
    (byTeam[p.tid] = byTeam[p.tid] || []).push(p);
  }
  for (const tid of Object.keys(byTeam)) {
    const list = byTeam[tid].sort((a, b) => b.ovr - a.ovr);
    for (let i = CONFIG.ROSTER_MAX; i < list.length; i++) list[i].tid = -1;
  }
}

export function parseLeagueFile(fileObj, seed) {
  if (!fileObj || !Array.isArray(fileObj.players) || !Array.isArray(fileObj.teams)) {
    throw new Error('This does not look like a BasketBall-GM roster file (missing players/teams).');
  }
  const ga = fileObj.gameAttributes;
  const season = getGameAttr(ga, 'season', 9999) || fileObj.startingSeason || CONFIG.DEFAULT_SEASON;
  const salaryCap = getGameAttr(ga, 'salaryCap', season) || CONFIG.SALARY_CAP;
  const confs = getGameAttr(ga, 'confs', season) || DEFAULT_CONFS;
  const divs = getGameAttr(ga, 'divs', season) || DEFAULT_DIVS;

  // Which team ids actually field players (the active league).
  const tidCounts = {};
  for (const p of fileObj.players) if (p.tid >= 0) tidCounts[p.tid] = (tidCounts[p.tid] || 0) + 1;
  const activeTids = new Set(Object.keys(tidCounts).map(Number));

  // Normalize players: keep active rostered players, free agents (tid -1), and
  // future draft prospects (BBGM tid -2 with a draft year >= this season). Drop
  // retired players (tid -3) and any deeper negative sentinel.
  const players = [];
  let pid = 0;
  for (const raw of fileObj.players) {
    const isProspect = raw.tid === -2 && raw.draft && raw.draft.year >= season;
    if (raw.tid <= -2 && !isProspect) continue; // retired / unusable
    if (raw.tid >= 0 && !activeTids.has(raw.tid)) continue;
    const p = normalizePlayer(raw, pid++, season);
    if (isProspect) {
      // Prospects wait in the pool as free agents (tid -1) but are flagged so
      // they stay out of free agency until their draft year (see draft.js).
      p.tid = -1;
      p.isProspect = true;
      p.draft = { ...p.draft, year: raw.draft.year };
      p.contract = null;
    }
    players.push(p);
  }
  trimRosters(players);

  // Build the active teams with metadata + auto lineup.
  const teams = fileObj.teams
    .filter((t) => activeTids.has(t.tid) && !t.disabled)
    .sort((a, b) => a.tid - b.tid)
    .map((t) => {
      const align = ABBREV_ALIGNMENT[t.abbrev];
      const cid = t.cid !== undefined ? t.cid : (align ? align[0] : 0);
      const did = t.did !== undefined ? t.did : (align ? align[1] : 0);
      const roster = players.filter((p) => p.tid === t.tid);
      return {
        tid: t.tid, cid, did,
        region: t.region || t.abbrev, name: t.name || 'Team', abbrev: t.abbrev || `T${t.tid}`,
        colors: t.colors || ['#ffffff', '#000000', '#ffffff'],
        strategy: t.strategy || 'rebuilding',
        lineup: autoLineup(roster, season),
      };
    });

  // Future draft picks available to trade (this season and beyond).
  let dpidNext = 0;
  const draftPicks = (fileObj.draftPicks || [])
    .filter((dp) => dp.season >= season && activeTids.has(dp.tid))
    .map((dp) => ({ dpid: dpidNext++, tid: dp.tid, originalTid: dp.originalTid, round: dp.round, season: dp.season, pick: 0 }));

  return {
    meta: { createdAt: Date.now(), leagueName: 'NBA', appVersion: 1 },
    rng: { s: hashSeed(seed != null ? seed : Date.now()) },
    season, phase: 'regular', day: 0,
    userTid: null,
    salaryCap, minSalary: CONFIG.MIN_SALARY, maxSalary: CONFIG.MAX_SALARY,
    confs, divs,
    teams, players, draftPicks,
    schedule: [], results: {}, playoffs: null, draftClass: null,
    transactions: [], history: [],
    nextPid: pid, nextGid: 0, nextDpid: dpidNext,
  };
}
