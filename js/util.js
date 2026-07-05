// =============================================================================
// util.js — small pure helpers used across the app (math + formatting + DOM).
// =============================================================================

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const round = (x, d = 0) => { const f = 10 ** d; return Math.round(x * f) / f; };
export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);
export const mean = (arr, f = (x) => x) => (arr.length ? sum(arr, f) / arr.length : 0);
export const clone = (obj) => JSON.parse(JSON.stringify(obj));

// Money is stored in $thousands (BBGM convention). Format for display.
export function money(thousands) {
  if (thousands == null) return '$0';
  const m = thousands / 1000;
  if (m >= 1) return `$${round(m, 1)}M`;
  return `$${round(thousands, 0)}K`;
}

// Percentage helper for records etc.
export function pct(w, l) {
  const g = w + l;
  return g === 0 ? 0 : w / g;
}
export function fmtPct(x) {
  return (x >= 1 ? '1.000' : x.toFixed(3).replace(/^0/, ''));
}

// ---- DOM helpers -----------------------------------------------------------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Build an element from a tag, props, and children.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

// Escape text for safe innerHTML use.
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Ordinal number (1st, 2nd, 3rd).
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
