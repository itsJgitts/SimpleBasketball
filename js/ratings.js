// =============================================================================
// ratings.js — derive ovr/pot from BBGM's 15 component ratings (no invented
// fields), estimate potential, market salary, age curve, and overall value.
// =============================================================================
import CONFIG from './config.js';
import { clamp, round } from './util.js';

// BBGM's official basketball ovr formula (component ratings -> 0..100).
export function computeOvr(r) {
  let x =
    0.159 * (r.hgt - 47.5) + 0.0777 * (r.stre - 50.2) + 0.123 * (r.spd - 50.8) +
    0.051 * (r.jmp - 48.7) + 0.0632 * (r.endu - 39.9) + 0.0126 * (r.ins - 42.4) +
    0.0286 * (r.dnk - 49.5) + 0.0202 * (r.ft - 47.0) + 0.0726 * (r.tp - 47.1) +
    0.133 * (r.oiq - 46.8) + 0.159 * (r.diq - 46.7) + 0.059 * (r.drb - 54.8) +
    0.062 * (r.pss - 51.3) + 0.01 * (r.fg - 47.0) + 0.01 * (r.reb - 51.4) + 48.5;
  let f;
  if (x >= 68) f = 8;
  else if (x >= 50) f = 4 + (x - 50) * (4 / 18);
  else if (x >= 42) f = -5 + (x - 42) * (9 / 8);
  else if (x >= 31) f = -5 - (42 - x) * (5 / 11);
  else f = -10;
  return clamp(Math.round(x + f), 0, 100);
}

// Estimate potential ceiling from current ovr + age. Young players get upside;
// players at/after peak have pot ~= ovr. Derived only from real ratings + age.
export function estimatePot(ovr, age) {
  const yearsToPeak = clamp(CONFIG.PEAK_AGE - age, 0, 8);
  const room = clamp(88 - ovr, 0, 45);
  const pot = ovr + yearsToPeak * room * 0.06;
  return clamp(Math.round(pot), ovr, 99);
}

// The ratings row effective for a given season (prefer exact match, else last).
export function latestRatings(player, season) {
  const rs = player.ratings;
  if (!rs || !rs.length) return null;
  const exact = rs.filter((r) => r.season !== undefined && r.season <= season);
  return (exact.length ? exact[exact.length - 1] : rs[rs.length - 1]);
}

export function playerAge(player, season) {
  const by = player.born && player.born.year ? player.born.year : season - 25;
  return season - by;
}

// Recompute and cache derived fields on a player for the given season.
export function refreshPlayer(player, season) {
  const r = latestRatings(player, season);
  player.ovr = r ? computeOvr(r) : 0;
  player.age = playerAge(player, season);
  player.pot = r ? estimatePot(player.ovr, player.age) : player.ovr;
  return player;
}

// Market salary ($k/yr) as a function of ovr, via piecewise-linear anchors.
export function marketValue(ovr) {
  const a = CONFIG.MARKET_OVR_ANCHORS;
  if (ovr <= a[0].ovr) return a[0].salary;
  if (ovr >= a[a.length - 1].ovr) return a[a.length - 1].salary;
  for (let i = 1; i < a.length; i++) {
    if (ovr <= a[i].ovr) {
      const t = (ovr - a[i - 1].ovr) / (a[i].ovr - a[i - 1].ovr);
      return Math.round(a[i - 1].salary + t * (a[i].salary - a[i - 1].salary));
    }
  }
  return a[a.length - 1].salary;
}

// Age curve multiplier (peak ~ CONFIG.PEAK_AGE). Youth penalized lightly (their
// upside is captured by pot); post-peak decline penalized more heavily.
export function ageFactor(age) {
  const d = age - CONFIG.PEAK_AGE;
  const w = CONFIG.AGE_CURVE_WIDTH;
  const pen = d <= 0
    ? (Math.abs(d) / w) * CONFIG.AGE_CURVE_MAX_PENALTY * 0.4
    : (d / w) * CONFIG.AGE_CURVE_MAX_PENALTY;
  return clamp(1 - pen, 1 - CONFIG.AGE_CURVE_MAX_PENALTY, 1);
}

// Overall trade/FA value: weighted mix of ovr, upside, and contract surplus,
// scaled by the age curve. Returns a scalar (~ ovr magnitude).
export function playerValue(player, season) {
  if (player.ovr === undefined || player.age === undefined) refreshPlayer(player, season);
  const w = CONFIG.VALUE_WEIGHTS;
  const upside = Math.max(0, player.pot - player.ovr);
  const amount = player.contract ? player.contract.amount : CONFIG.MIN_SALARY;
  const surplus = marketValue(player.ovr) - amount; // $k/yr saved vs market
  const surplusUnits = surplus / 2000; // convert $k to value points
  const base = w.ovr * player.ovr + w.pot * upside + w.contract * surplusUnits;
  return round(Math.max(0, base * ageFactor(player.age)), 2);
}
