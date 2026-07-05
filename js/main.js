// =============================================================================
// main.js — application bootstrap. Wires the persistent shell (topbar toggle,
// nav scrim, shared hidden file input), registers every screen module, and
// boots into the menu. Screen modules self-register on import via registerScreen.
// =============================================================================
import { $ } from './util.js';
import { store, saveToLocal, hasSave } from './state.js';
import { navigate, buildNav, openNav, closeNav, toast, closeModal } from './ui/dom.js';

// Import screens for their registration side-effects.
import './ui/menu.js';
import './ui/home.js';
import './ui/standings.js';
import './ui/schedule.js';
import './ui/lineup.js';
import './ui/trade.js';
import './ui/freeagency.js';
import './ui/playoffs.js';
import './ui/draft.js';

// A single hidden <input type=file> is reused for all uploads. The current
// consumer sets this callback; onchange routes the parsed text/JSON to it.
let fileCallback = null;
export function pickFile(cb) {
  fileCallback = cb;
  const input = $('#fileInput');
  input.value = '';
  input.click();
}

function wireShell() {
  $('#navToggle').addEventListener('click', openNav);
  $('#navScrim').addEventListener('click', closeNav);
  // Tap outside the modal body closes the modal.
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  $('#fileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !fileCallback) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { fileCallback(reader.result, file.name); }
      catch (err) { toast(`Load failed: ${err.message}`); }
    };
    reader.onerror = () => toast('Could not read that file.');
    reader.readAsText(file);
  });

  // Autosave on tab hide / close so progress isn't lost.
  window.addEventListener('visibilitychange', () => { if (document.hidden && store.game) saveToLocal(); });
  window.addEventListener('beforeunload', () => { if (store.game) saveToLocal(); });
}

function boot() {
  wireShell();
  buildNav();
  navigate('menu', { hasSave: hasSave() });
}

boot();
