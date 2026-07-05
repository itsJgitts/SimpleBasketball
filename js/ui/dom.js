// =============================================================================
// ui/dom.js — shared UI plumbing: the screen router, nav drawer, topbar status
// line, modal + toast, and small render helpers. Screens register a renderer
// and are shown via navigate(); each renderer returns a DOM node for #screen.
// =============================================================================
import { $, el, esc } from '../util.js';
import { store, saveToLocal } from '../state.js';

// Registered screens: name -> ({ nav?, render }) . nav entries appear in drawer.
const SCREENS = {};
let current = null;

export function registerScreen(name, def) { SCREENS[name] = def; }

// ---- Navigation ------------------------------------------------------------
export function navigate(name, params = {}) {
  const def = SCREENS[name];
  if (!def) { console.error('no screen', name); return; }
  current = name;
  const host = $('#screen');
  host.innerHTML = '';
  host.append(def.render(params));
  host.scrollTop = 0;
  window.scrollTo(0, 0);
  closeNav();
  refreshTopbar();
}

export function reRender(params = {}) { if (current) navigate(current, params); }
export function currentScreen() { return current; }

// ---- Topbar + nav drawer ---------------------------------------------------
const NAV_ITEMS = [
  ['home', 'Dashboard'], ['standings', 'Standings'], ['schedule', 'Schedule'],
  ['roster', 'Roster / Lineup'], ['trade', 'Trade'], ['freeagency', 'Free Agency'],
];

export function refreshTopbar() {
  const g = store.game;
  const bar = $('#topbar');
  if (!g) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const team = g.teams.find((t) => t.tid === g.userTid);
  const phase = g.phase === 'regular' ? `Day ${g.day}` : g.phase.toUpperCase();
  const tname = team ? team.abbrev : '—';
  $('#statusLine').textContent = `${tname} · ${g.season} · ${phase}`;
}

export function buildNav() {
  const drawer = $('#navDrawer');
  drawer.innerHTML = '';
  for (const [name, label] of NAV_ITEMS) {
    drawer.append(el('button', { onclick: () => navigate(name) }, label));
  }
  drawer.append(el('hr'));
  drawer.append(el('button', { onclick: () => { import('../state.js').then((m) => m.downloadSave()); } }, 'Download Save'));
  drawer.append(el('button', { onclick: () => { saveToLocal(); toast('Saved.'); } }, 'Save'));
  drawer.append(el('button', { onclick: () => navigate('menu') }, 'Main Menu'));
}

export function openNav() { $('#navDrawer').classList.remove('hidden'); $('#navScrim').classList.remove('hidden'); }
export function closeNav() { $('#navDrawer').classList.add('hidden'); $('#navScrim').classList.add('hidden'); }

// ---- Modal + toast ---------------------------------------------------------
export function openModal(node) {
  const body = $('#modalBody');
  body.innerHTML = '';
  body.append(node);
  $('#modal').classList.remove('hidden');
}
export function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }

let toastTimer = null;
export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---- Render helpers --------------------------------------------------------
// Build a table from headers + row arrays. Each cell is a string/number or a
// DOM node. `rowMeta(i)` -> css class; `onRow(i)` makes rows clickable.
function cellNode(c) {
  if (c == null) return el('td', { text: '' });
  if (c.nodeType) return el('td', {}, c);
  return el('td', { text: String(c) });
}

// Default per-column sort value: the number a cell represents, else its text
// lower-cased for a stable string compare. Handles DOM cells via textContent.
function defaultSortValue(cell) {
  if (cell == null) return '';
  const s = cell.nodeType ? cell.textContent : String(cell);
  const num = Number(s.replace(/[^0-9.+-]/g, ''));
  if (s.trim() !== '' && Number.isFinite(num) && /[0-9]/.test(s)) return num;
  return s.toLowerCase();
}

// Build a table. Options:
//   rowMeta(i)  -> css class for original row i
//   onRow(i)    -> click handler receiving the original row index
//   sortable    -> if truthy, header clicks sort the rows
//   sortKeys    -> optional array of (cells, i) => value overriding the sort
//                  value per column; falls back to defaultSortValue otherwise
// Sorting reorders the tbody in place; onRow/rowMeta always get the ORIGINAL
// index so callers can keep indexing their own data arrays.
export function table(headers, rows, { rowMeta, onRow, sortable, sortKeys } = {}) {
  const tbody = el('tbody', {});
  // Current sort: column index and direction (1 asc, -1 desc); -1 col = none.
  const sortState = { col: -1, dir: 1 };

  const valueFor = (col, cells, i) => (
    sortKeys && sortKeys[col] ? sortKeys[col](cells, i) : defaultSortValue(cells[col])
  );

  function renderBody() {
    tbody.innerHTML = '';
    let order = rows.map((_, i) => i);
    if (sortState.col >= 0) {
      const col = sortState.col;
      order = order.slice().sort((ia, ib) => {
        const va = valueFor(col, rows[ia], ia);
        const vb = valueFor(col, rows[ib], ib);
        let cmp;
        if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
        else cmp = String(va).localeCompare(String(vb));
        return cmp * sortState.dir || (ia - ib);
      });
    }
    for (const i of order) {
      const tr = el('tr', { class: (rowMeta && rowMeta(i)) || '' }, ...rows[i].map(cellNode));
      if (onRow) { tr.classList.add('clickable'); tr.addEventListener('click', () => onRow(i)); }
      tbody.append(tr);
    }
  }

  const indicators = [];
  const ths = headers.map((label, col) => {
    const th = el('th', { text: label });
    if (sortable) {
      th.classList.add('sortable');
      const indicator = el('span', { class: 'sort-ind', text: '' });
      indicators[col] = indicator;
      th.append(indicator);
      th.addEventListener('click', () => {
        if (sortState.col === col) sortState.dir *= -1;
        else { sortState.col = col; sortState.dir = 1; }
        ths.forEach((h) => h.classList.remove('sorted'));
        indicators.forEach((ind) => { ind.textContent = ''; });
        th.classList.add('sorted');
        indicator.textContent = sortState.dir === 1 ? ' ▲' : ' ▼';
        renderBody();
      });
    }
    return th;
  });

  renderBody();
  const thead = el('thead', {}, el('tr', {}, ...ths));
  return el('div', { class: 'table-wrap' }, el('table', {}, thead, tbody));
}

export function panel(...children) { return el('div', { class: 'panel' }, ...children); }
export function h1(text) { return el('h1', { text }); }
export function h2(text) { return el('h2', { text }); }
export function btn(label, onclick, opts = {}) {
  return el('button', { onclick, class: opts.class || '', ...(opts.disabled ? { disabled: true } : {}) }, label);
}
export function btnRow(...buttons) { return el('div', { class: 'btn-row' }, ...buttons); }

// Confirm dialog rendered in the modal; resolves true/false.
export function confirmModal(message, { okText = 'Confirm', cancelText = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    const box = el('div', {},
      el('p', { text: message }),
      el('div', { class: 'btn-row' },
        btn(okText, () => { closeModal(); resolve(true); }),
        btn(cancelText, () => { closeModal(); resolve(false); })));
    openModal(box);
  });
}
export { el, esc };
