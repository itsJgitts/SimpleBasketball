// =============================================================================
// nbaTeams.js — position constants, default conference/division layout, and a
// helper to resolve BBGM's season-versioned gameAttributes (confs/divs/etc.).
// These defaults are only used as a fallback when the uploaded file omits them.
// =============================================================================

// Canonical lineup slots (starters are one per slot).
export const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];

// Map any BBGM position string to a canonical starting slot.
const POS_TO_SLOT = {
  PG: 'PG', SG: 'SG', SF: 'SF', PF: 'PF', C: 'C',
  G: 'SG', GF: 'SF', F: 'PF', FC: 'C',
};
export function posToSlot(pos) {
  return POS_TO_SLOT[pos] || 'SF';
}

// Default modern NBA conferences/divisions (fallback only).
export const DEFAULT_CONFS = [
  { cid: 0, name: 'Eastern Conference' },
  { cid: 1, name: 'Western Conference' },
];
export const DEFAULT_DIVS = [
  { cid: 0, did: 0, name: 'Atlantic' },
  { cid: 0, did: 1, name: 'Central' },
  { cid: 0, did: 2, name: 'Southeast' },
  { cid: 1, did: 3, name: 'Southwest' },
  { cid: 1, did: 4, name: 'Northwest' },
  { cid: 1, did: 5, name: 'Pacific' },
];

// Fallback abbrev -> {cid, did} for the 30 modern teams, used only if a team
// record is missing cid/did.
export const ABBREV_ALIGNMENT = {
  BOS: [0, 0], BRK: [0, 0], NYK: [0, 0], PHI: [0, 0], TOR: [0, 0],
  CHI: [0, 1], CLE: [0, 1], DET: [0, 1], IND: [0, 1], MIL: [0, 1],
  ATL: [0, 2], CHA: [0, 2], CHO: [0, 2], MIA: [0, 2], ORL: [0, 2], WAS: [0, 2],
  DAL: [1, 3], HOU: [1, 3], MEM: [1, 3], NOP: [1, 3], SAS: [1, 3],
  DEN: [1, 4], MIN: [1, 4], OKC: [1, 4], POR: [1, 4], UTA: [1, 4],
  GSW: [1, 5], LAC: [1, 5], LAL: [1, 5], PHO: [1, 5], SAC: [1, 5],
};

// BBGM stores some gameAttributes as [{start, value}, ...] keyed by season.
// Resolve the value effective for `season` (largest start <= season).
export function resolveVersioned(attr, season) {
  if (attr === undefined || attr === null) return undefined;
  if (!Array.isArray(attr)) return attr; // plain value
  if (attr.length && typeof attr[0] === 'object' && 'value' in attr[0]) {
    let best = attr[0];
    for (const entry of attr) {
      const start = entry.start === null || entry.start === undefined ? -Infinity : entry.start;
      if (start <= season) best = entry;
    }
    return best.value;
  }
  return attr;
}

// Pull a possibly-versioned attribute out of a gameAttributes dict or array.
export function getGameAttr(ga, key, season) {
  if (!ga) return undefined;
  if (Array.isArray(ga)) {
    const found = ga.find((x) => x.key === key);
    return found ? resolveVersioned(found.value, season) : undefined;
  }
  return resolveVersioned(ga[key], season);
}
