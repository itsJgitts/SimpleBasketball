// =============================================================================
// ui/draft.js — the draft board. On arrival the class is generated and the pick
// order set (lottery for non-playoff teams, then playoff teams by inverse
// record). Auto-drafts up to the user's pick; the user picks a prospect from the
// board. When the draft ends, rolls the league into the next season.
// =============================================================================
import { el } from '../util.js';
import { store, saveToLocal, userTeam } from '../state.js';
import {
  setupDraft, availableProspects, currentPick, makePick, autoDraftUntil, autoPick,
} from '../draft.js';
import { startNextSeason, playoffTids } from '../season.js';
import { registerScreen, navigate, reRender, toast, h2, table, btn, btnRow, panel, playerName } from './dom.js';

function coinFn(a, b) { return ((a.tid + b.tid) % 2 === 0) ? -1 : 1; }
const teamById = (g, tid) => g.teams.find((t) => t.tid === tid);

function ensureDraft(g) {
  if (g.draftClass) return;
  const poTids = playoffTids(g, coinFn);
  setupDraft(g, store.R, poTids);
  // Auto-run up to the user's first pick so they aren't waiting through picks.
  autoDraftUntil(g, g.userTid);
  saveToLocal();
}

function rollover(g) {
  const summary = startNextSeason(g, store.R);
  saveToLocal();
  const box = el('div', {},
    h2(`Season ${summary.newSeason}`),
    el('p', { text: `${summary.released} players hit free agency; ${summary.signings} signed to fill rosters.` }),
    el('p', { class: 'small dim', text: 'Top risers: ' + summary.risers.map((c) => `${c.name} +${c.delta}`).join(', ') }),
    el('p', { class: 'small dim', text: 'Top fallers: ' + summary.fallers.map((c) => `${c.name} ${c.delta}`).join(', ') }),
    btn('Start Season', () => navigate('home')));
  return box;
}

registerScreen('draft', {
  render() {
    const g = store.game;
    if (!g) { navigate('menu'); return el('div'); }
    ensureDraft(g);

    const wrap = el('div', {}, h2(`${g.season} Draft`));
    const cp = currentPick(g);

    // Draft complete -> offer season rollover.
    if (!cp) { wrap.append(rollover(g)); return wrap; }

    const onClockTeam = teamById(g, cp.tid);
    const userOnClock = cp.tid === g.userTid;
    wrap.append(panel(
      el('p', { text: `Pick ${cp.overall} (R${cp.round}.${cp.pick})` }),
      el('p', { text: userOnClock ? 'You are on the clock.' : `${onClockTeam.region} ${onClockTeam.name} on the clock.` })));

    // Recent picks.
    const recent = g.draftClass.picks.slice(-6).reverse().map((pk) => {
      const t = teamById(g, pk.tid);
      const p = g.players.find((x) => x.pid === pk.pid);
      return `#${pk.overall} ${t.abbrev} — ${p ? p.name : '?'}`;
    });
    if (recent.length) wrap.append(el('div', { class: 'mono-box', text: recent.join('\n') }));

    // Board of available prospects (top 40).
    const avail = availableProspects(g).slice(0, 40);
    const rows = avail.map((p) => [playerName(p.pid, p.name), p.pos, p.ovr, p.pot, p.age]);
    wrap.append(el('h3', { text: 'Best Available' }));
    wrap.append(table(['Prospect', 'Pos', 'Ovr', 'Pot', 'Age'], rows, {
      onRow: (i) => {
        if (!userOnClock) { toast('Not your pick yet — sim to your pick.'); return; }
        try {
          const p = makePick(g, avail[i].pid);
          toast(`Drafted ${p.name}.`);
          autoDraftUntil(g, g.userTid); // advance to the user's next pick
          saveToLocal();
          reRender();
        } catch (e) { toast(e.message); }
      },
    }));

    wrap.append(btnRow(
      btn(userOnClock ? 'Auto-pick for me' : 'Sim to my pick', () => {
        // If the user is on the clock, auto-pick best available for them once.
        if (userOnClock && availableProspects(g).length) autoPick(g);
        // Then sim AI picks until the user is on the clock again or draft ends.
        autoDraftUntil(g, g.userTid);
        saveToLocal();
        reRender();
      }),
      btn('Sim Entire Draft', () => { autoDraftUntil(g); saveToLocal(); reRender(); }),
    ));
    return wrap;
  },
});
