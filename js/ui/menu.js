// =============================================================================
// ui/menu.js — main menu (New / Continue / Upload roster / Import save) and the
// new-game team-selection screen. Uploading a roster stores it, then shows the
// team list from listSelectableTeams(); picking a team calls startNewGame().
// =============================================================================
import { el, money } from '../util.js';
import { store, setGame, saveToLocal, loadFromLocal, hasSave, importSaveJSON } from '../state.js';
import { listSelectableTeams, startNewGame } from '../newgame.js';
import { registerScreen, navigate, toast, h1, h2, btn, table } from './dom.js';
import { pickFile } from '../main.js';

// The most recently uploaded roster file (kept until a team is chosen).
let pendingRoster = null;

registerScreen('menu', {
  render() {
    const wrap = el('div', {},
      h1('SIMPLE BASKETBALL'),
      el('p', { class: 'dim', text: 'A 1-bit basketball management sim.' }));
    const list = el('div', { class: 'menu-list' });

    if (hasSave()) {
      list.append(btn('Continue', () => {
        if (loadFromLocal()) navigate('home'); else toast('No saved game found.');
      }));
    }
    list.append(btn('New Game (upload roster)', () => {
      pickFile((text) => {
        pendingRoster = JSON.parse(text);
        const teams = listSelectableTeams(pendingRoster); // validates shape
        toast(`Loaded ${teams.length} teams.`);
        navigate('teamSelect');
      });
    }));
    list.append(btn('Import Saved Game', () => {
      pickFile((text) => { importSaveJSON(text); saveToLocal(); navigate('home'); });
    }));
    wrap.append(list);
    wrap.append(el('p', { class: 'small dim', text: 'Upload a BasketBall-GM league JSON to begin. Everything is stored locally in your browser.' }));
    return wrap;
  },
});

registerScreen('teamSelect', {
  render() {
    if (!pendingRoster) { navigate('menu'); return el('div'); }
    const teams = listSelectableTeams(pendingRoster).sort((a, b) => b.teamOvr - a.teamOvr);
    const wrap = el('div', {}, h2('Choose Your Team'),
      el('p', { class: 'small dim', text: 'Tap a team to start. You can trade, sign, draft and sim from there.' }));

    const rows = teams.map((t) => [
      `${t.region} ${t.name}`,
      t.abbrev,
      t.teamOvr,
      t.rosterSize,
      t.topPlayers.map((p) => p.name).join(', '),
    ]);
    wrap.append(table(['Team', 'Abv', 'Ovr', 'N', 'Top players'], rows, {
      onRow: (i) => startWith(teams[i].tid),
    }));
    wrap.append(btn('Back', () => navigate('menu')));
    return wrap;
  },
});

function startWith(tid) {
  try {
    const game = startNewGame(pendingRoster, tid);
    setGame(game);
    saveToLocal();
    pendingRoster = null;
    const t = store.game.teams.find((x) => x.tid === tid);
    toast(`Now managing ${t.region} ${t.name}.`);
    navigate('home');
  } catch (e) {
    toast(`Could not start: ${e.message}`);
  }
}
