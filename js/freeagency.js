// =============================================================================
// freeagency.js — sign free agents and extend current players.
//   A player's asking price starts at market value (from ovr) and is nudged by
//   a deterministic per-player willingness spread; players give a discount to
//   join a winning team (scaled by how far the team's win% is above .500, up to
//   CONTRACT_MAX_GOOD_TEAM_DISCOUNT). Years asked scale with age (younger => more
//   years). Signings enforce the roster max; extensions apply to players in the
//   final EXTENSION_WINDOW_YEARS of their deal.
// =============================================================================
import CONFIG from './config.js';
import { marketValue, refreshPlayer } from './ratings.js';
import { autoLineup } from './lineup.js';
import { winPct } from './standings.js';
import { clamp, round } from './util.js';

const teamById = (game, tid) => game.teams.find((t) => t.tid === tid);
export function playersOnTeam(game, tid) { return game.players.filter((p) => p.tid === tid); }
// Signable free agents: tid -1 and NOT an undrafted prospect (prospects wait in
// the pool until their draft year and enter the league via the draft).
export function freeAgents(game) { return game.players.filter((p) => p.tid === -1 && !p.isProspect); }
export function teamPayroll(game, tid) {
  return playersOnTeam(game, tid).reduce((s, p) => s + (p.contract ? p.contract.amount : 0), 0);
}

// Deterministic willingness multiplier in [1-spread .. 1+spread] from pid, so a
// player asks a consistent amount across the session (no RNG churn in the UI).
function willingness(pid) {
  const spread = CONFIG.CONTRACT_WILLINGNESS_DISCOUNT;
  const r = ((Math.imul(pid + 7, 40503) >>> 0) % 1000) / 1000; // 0..1
  return 1 - spread + r * (2 * spread);
}

// Discount a player grants for signing with a winning team (0..MAX).
function goodTeamDiscount(game, tid) {
  const wp = winPct(game, tid); // 0..1
  const above = clamp((wp - 0.5) / 0.5, 0, 1); // 0 at .500, 1 at 1.000
  return above * CONFIG.CONTRACT_MAX_GOOD_TEAM_DISCOUNT;
}

// Years a player wants: young players want long deals, vets want short.
function yearsDemanded(age) {
  if (age <= 25) return clamp(4, CONFIG.CONTRACT_MIN_YEARS, CONFIG.CONTRACT_MAX_YEARS);
  if (age <= 29) return clamp(3, CONFIG.CONTRACT_MIN_YEARS, CONFIG.CONTRACT_MAX_YEARS);
  if (age <= 33) return clamp(2, CONFIG.CONTRACT_MIN_YEARS, CONFIG.CONTRACT_MAX_YEARS);
  return CONFIG.CONTRACT_MIN_YEARS;
}

// What a player asks from team `tid`: { amount ($k/yr), years, exp }.
export function contractDemand(game, player, tid) {
  refreshPlayer(player, game.season);
  const base = marketValue(player.ovr);
  const raw = base * willingness(player.pid) * (1 - goodTeamDiscount(game, tid));
  const amount = clamp(Math.round(raw), CONFIG.MIN_SALARY, CONFIG.MAX_SALARY);
  const years = yearsDemanded(player.age);
  return { amount, years, exp: game.season + years };
}

// Can team `tid` add one more player under the roster cap?
export function canAddPlayer(game, tid) {
  return playersOnTeam(game, tid).length < CONFIG.ROSTER_MAX;
}

// Projected payroll (informational; used by UI to warn about the cap). Over the
// cap is allowed here (Bird-style), we only hard-enforce the roster size.
export function projectedPayroll(game, tid, addAmount = 0) {
  return teamPayroll(game, tid) + addAmount;
}

// Sign a free agent to `tid` at the given (accepted) contract. Returns the
// player. Throws if the player is not a free agent or the roster is full.
export function signFreeAgent(game, pid, tid, contract) {
  const player = game.players.find((p) => p.pid === pid);
  if (!player) throw new Error('Unknown player.');
  if (player.tid !== -1 || player.isProspect) throw new Error(`${player.name} is not a free agent.`);
  if (!canAddPlayer(game, tid)) throw new Error(`Roster is full (max ${CONFIG.ROSTER_MAX}).`);
  const deal = contract || contractDemand(game, player, tid);
  player.tid = tid;
  player.contract = { amount: deal.amount, exp: deal.exp };
  const team = teamById(game, tid);
  if (team) team.lineup = autoLineup(playersOnTeam(game, tid), game.season);
  game.transactions.push({
    type: 'sign', day: game.day, season: game.season,
    tid, pid, amount: deal.amount, exp: deal.exp,
  });
  return player;
}

// ---- Release / cut ---------------------------------------------------------
// Can team `tid` drop a player without falling below the roster minimum?
export function canReleasePlayer(game, tid) {
  return playersOnTeam(game, tid).length > CONFIG.ROSTER_MIN;
}

// Waive a rostered player to free agency: clears their contract (salary comes
// off the team's cap) and rebuilds the team's lineup. Throws if the player
// isn't on `tid` or the roster is already at the minimum. Returns the player.
export function releasePlayer(game, pid, tid) {
  const player = game.players.find((p) => p.pid === pid);
  if (!player) throw new Error('Unknown player.');
  if (player.tid !== tid) throw new Error(`${player.name} is not on this roster.`);
  if (!canReleasePlayer(game, tid)) throw new Error(`Cannot drop below the roster minimum (${CONFIG.ROSTER_MIN}).`);
  player.tid = -1;
  player.contract = null;
  const team = teamById(game, tid);
  if (team) team.lineup = autoLineup(playersOnTeam(game, tid), game.season);
  game.transactions.push({
    type: 'release', day: game.day, season: game.season, tid, pid,
  });
  return player;
}

// ---- Extensions ------------------------------------------------------------
// A player is extension-eligible when their contract expires within the
// extension window (final EXTENSION_WINDOW_YEARS of the deal).
export function isExtensionEligible(game, player) {
  if (!player.contract) return false;
  return player.contract.exp - game.season <= CONFIG.EXTENSION_WINDOW_YEARS;
}

// Count of extension-eligible players on a team (for the UI indicator badge).
export function extensionEligibleCount(game, tid) {
  return playersOnTeam(game, tid).filter((p) => isExtensionEligible(game, p)).length;
}

// The extension a current player asks for: market-based with a small loyalty
// discount, starting the season after the current deal ends.
export function extensionDemand(game, player) {
  refreshPlayer(player, game.season);
  const base = marketValue(player.ovr);
  const amount = clamp(Math.round(base * willingness(player.pid) * 0.97), CONFIG.MIN_SALARY, CONFIG.MAX_SALARY);
  const years = yearsDemanded(player.age);
  const startSeason = Math.max(game.season + 1, player.contract.exp + 1);
  return { amount, years, exp: startSeason + years - 1 };
}

// Apply an extension to a rostered player. Throws if ineligible.
export function extendPlayer(game, pid, contract) {
  const player = game.players.find((p) => p.pid === pid);
  if (!player) throw new Error('Unknown player.');
  if (player.tid < 0) throw new Error('Only rostered players can be extended.');
  if (!isExtensionEligible(game, player)) throw new Error(`${player.name} is not extension-eligible yet.`);
  const deal = contract || extensionDemand(game, player);
  player.contract = { amount: deal.amount, exp: deal.exp };
  game.transactions.push({
    type: 'extend', day: game.day, season: game.season,
    tid: player.tid, pid, amount: deal.amount, exp: deal.exp,
  });
  return player;
}

// Free agents sorted best-first (for the FA list UI).
export function rankedFreeAgents(game) {
  return freeAgents(game)
    .map((p) => { refreshPlayer(p, game.season); return p; })
    .sort((a, b) => b.ovr - a.ovr);
}
