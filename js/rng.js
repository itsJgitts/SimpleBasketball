// =============================================================================
// rng.js — seeded, serializable pseudo-random number generator (mulberry32).
// The generator's internal state lives in a plain object so it can be saved to
// localStorage / exported with the rest of the game and resumed deterministically.
// =============================================================================

// Hash an arbitrary string/number seed into a 32-bit integer.
export function hashSeed(seed) {
  const str = String(seed);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

// Create a generator bound to a state holder { s: <int> }.
// Calling the returned function advances and persists that state.
export function createRng(stateHolder) {
  return function next() {
    stateHolder.s |= 0;
    stateHolder.s = (stateHolder.s + 0x6d2b79f5) | 0;
    let t = Math.imul(stateHolder.s ^ (stateHolder.s >>> 15), 1 | stateHolder.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A tiny helper bundle built on top of a raw rng() function.
export function rngHelpers(rng) {
  const rand = () => rng();
  const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min; // inclusive
  const randFloat = (min, max) => rand() * (max - min) + min;
  const chance = (p) => rand() < p;
  const choice = (arr) => arr[Math.floor(rand() * arr.length)];
  // Box-Muller normal
  const randNorm = (mean = 0, std = 1) => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + z * std;
  };
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  // Weighted pick: items = [{weight, ...}] returns index.
  const weightedIndex = (weights) => {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = rand() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  };
  return { rand, randInt, randFloat, chance, choice, randNorm, shuffle, weightedIndex };
}
