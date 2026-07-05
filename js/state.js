// =============================================================================
// state.js — central game store, persistence (localStorage), and JSON I/O.
// The whole game lives in `store.game`. `store.R` holds rng helpers bound to
// the game's serialized rng state so runs are deterministic and resumable.
// =============================================================================
import CONFIG from './config.js';
import { createRng, rngHelpers, hashSeed } from './rng.js';

export const store = {
  game: null,   // the active game state (see roster.buildNewGame for shape)
  R: null,      // rng helpers { rand, randInt, ... } bound to game.rng
};

// (Re)bind the rng helpers to the current game's serialized rng state.
export function bindRng() {
  if (!store.game) return;
  if (!store.game.rng) store.game.rng = { s: hashSeed(Date.now()) };
  store.R = rngHelpers(createRng(store.game.rng));
}

export function setGame(game) {
  store.game = game;
  bindRng();
}

// ---- localStorage ----------------------------------------------------------
export function saveToLocal() {
  if (!store.game) return false;
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(store.game));
    return true;
  } catch (e) {
    console.error('save failed', e);
    return false;
  }
}

export function hasSave() {
  try { return !!localStorage.getItem(CONFIG.STORAGE_KEY); }
  catch { return false; }
}

export function loadFromLocal() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (!raw) return false;
    setGame(JSON.parse(raw));
    return true;
  } catch (e) {
    console.error('load failed', e);
    return false;
  }
}

export function clearLocal() {
  try { localStorage.removeItem(CONFIG.STORAGE_KEY); } catch {}
}

// ---- export / import as a file --------------------------------------------
export function exportJSON() {
  return JSON.stringify(store.game, null, 1);
}

export function downloadSave() {
  const blob = new Blob([exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const season = store.game ? store.game.season : 'game';
  a.href = url;
  a.download = `nba-gm-${season}-day${store.game ? store.game.day : 0}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Import a previously exported save (full game state). Returns true on success.
export function importSaveJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !parsed.teams || !parsed.players || parsed.season === undefined) {
    throw new Error('Not a valid saved game file.');
  }
  setGame(parsed);
  return true;
}

// ---- convenience accessors -------------------------------------------------
export function g() { return store.game; }
export function teamById(tid) { return store.game.teams.find((t) => t.tid === tid); }
export function playerById(pid) { return store.game.players.find((p) => p.pid === pid); }
export function userTeam() { return teamById(store.game.userTid); }
export function playersOnTeam(tid) { return store.game.players.filter((p) => p.tid === tid); }
export function freeAgents() { return store.game.players.filter((p) => p.tid === -1); }
