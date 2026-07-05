// =============================================================================
// ui/lineup.js — roster + lineup editor for the user team. Shows starters by
// slot (tap to reassign; tap the minutes button to edit their minutes), bench
// order (move up/down), and per-player minutes (edit; totals stay locked at 240
// via setMinutes). Auto button restores the computed lineup. Player rows show
// ovr/pot/age/contract and injury status.
// =============================================================================
import { el, money } from '../util.js';
import { store, saveToLocal, userTeam, playersOnTeam } from '../state.js';
import { SLOTS, posToSlot } from '../nbaTeams.js';
import { autoLineup, setStarter, moveBench, setMinutes, validateLineup, isHealthy } from '../lineup.js';
import { extensionEligibleCount, releasePlayer, canReleasePlayer } from '../freeagency.js';
import { registerScreen, navigate, reRender, toast, h2, table, btn, btnRow, panel, openModal, closeModal, confirmModal, playerName } from './dom.js';

const pById = (g, pid) => g.players.find((p) => p.pid === pid);

function pickStarter(slot) {
  const g = store.game;
  const team = userTeam();
  const roster = playersOnTeam(g.userTid).slice().sort((a, b) => b.ovr - a.ovr);
  const box = el('div', {}, el('h3', { text: `Set starter — ${slot}` }));
  const rows = roster.map((p) => [
    playerName(p.pid, p.name), p.pos, p.ovr, isHealthy(p) ? 'OK' : 'INJ',
  ]);
  box.append(table(['Player', 'Pos', 'Ovr', ''], rows, {
    onRow: (i) => { setStarter(team.lineup, slot, roster[i].pid); saveToLocal(); closeModal(); reRender(); },
    sortable: true,
  }));
  box.append(btn('Cancel', closeModal));
  openModal(box);
}

function editMinutes(pid) {
  const g = store.game;
  const team = userTeam();
  const p = pById(g, pid);
  const box = el('div', {}, el('h3', { text: `Minutes — ${p.name}` }));
  const input = el('input', { type: 'number', min: 0, max: 48, value: team.lineup.minutes[pid] || 0 });
  box.append(el('label', { text: 'Minutes (0–48). Others rebalance to keep 240.' }), input);
  box.append(btnRow(
    btn('Save', () => { setMinutes(team.lineup, pid, Number(input.value)); saveToLocal(); closeModal(); reRender(); }),
    btn('Cancel', closeModal),
  ));
  openModal(box);
}

// Confirm-and-cut a player from the user roster to free agency.
async function tryDrop(pid) {
  const g = store.game;
  const p = pById(g, pid);
  if (!canReleasePlayer(g, g.userTid)) { toast(`Cannot drop below roster minimum.`); return; }
  const ok = await confirmModal(`Drop ${p.name}? They become a free agent and their salary comes off your cap.`, { okText: 'Drop' });
  if (!ok) return;
  try { releasePlayer(g, pid, g.userTid); saveToLocal(); toast(`Dropped ${p.name}.`); reRender(); }
  catch (e) { toast(e.message); }
}

// Modal listing the whole roster so any player (starter or bench) can be cut.
function dropPlayerMenu() {
  const g = store.game;
  const roster = playersOnTeam(g.userTid).slice().sort((a, b) => b.ovr - a.ovr);
  const box = el('div', {}, el('h3', { text: 'Drop a Player' }));
  const rows = roster.map((p) => [playerName(p.pid, p.name), p.pos, p.ovr, money(p.contract ? p.contract.amount : 0)]);
  box.append(table(['Player', 'Pos', 'Ovr', 'Salary'], rows, {
    onRow: (i) => { closeModal(); tryDrop(roster[i].pid); },
    sortable: true,
    sortKeys: [null, null, null, (_, i) => (roster[i].contract ? roster[i].contract.amount : 0)],
  }));
  box.append(btn('Cancel', closeModal));
  openModal(box);
}

registerScreen('roster', {
  render() {
    const g = store.game;
    if (!g) { navigate('menu'); return el('div'); }
    const team = userTeam();
    const L = team.lineup;
    const wrap = el('div', {}, h2(`${team.abbrev} Roster`));

    const eligible = extensionEligibleCount(g, g.userTid);
    wrap.append(panel(
      el('div', { class: 'row' },
        el('span', { text: `Players ${playersOnTeam(g.userTid).length}` }),
        el('span', { text: `Extension-eligible: ${eligible}` })),
    ));

    // Starters by slot. The Min cell is a button that edits minutes (stopping
    // propagation so it doesn't also trigger the starter picker on the row).
    wrap.append(el('h3', { text: 'Starters' }));
    const starterRows = SLOTS.map((slot) => {
      const p = pById(g, L.starters[slot]);
      const minCell = p
        ? btn(`${L.minutes[p.pid] || 0}m`, (e) => { e.stopPropagation(); editMinutes(p.pid); }, { class: 'inline' })
        : '';
      return [slot, p ? playerName(p.pid, p.name, { linkClick: true }) : '—', p ? p.ovr : '', minCell];
    });
    wrap.append(table(['Slot', 'Player', 'Ovr', 'Min'], starterRows, {
      onRow: (i) => pickStarter(SLOTS[i]),
      sortable: true,
      sortKeys: [null, null, null, (_, i) => { const p = pById(g, L.starters[SLOTS[i]]); return p ? (L.minutes[p.pid] || 0) : -1; }],
    }));

    // Bench with move + minutes controls.
    wrap.append(el('h3', { text: 'Bench' }));
    const benchWrap = el('div', {});
    L.bench.forEach((pid) => {
      const p = pById(g, pid);
      if (!p) return;
      benchWrap.append(panel(
        el('div', { class: 'row' },
          el('span', {}, playerName(pid, p.name, { linkClick: true }), el('span', { text: ` · ${p.pos} · ovr ${p.ovr}${isHealthy(p) ? '' : ' · INJ'}` })),
          el('span', { text: `${L.minutes[pid] || 0}m` })),
        el('div', { class: 'btn-row' },
          btn('▲', () => { moveBench(L, pid, -1); saveToLocal(); reRender(); }, { class: 'inline' }),
          btn('▼', () => { moveBench(L, pid, 1); saveToLocal(); reRender(); }, { class: 'inline' }),
          btn('Minutes', () => editMinutes(pid), { class: 'inline' }),
          btn('Drop', () => tryDrop(pid), { class: 'inline' })),
      ));
    });
    wrap.append(benchWrap);

    const v = validateLineup(L);
    wrap.append(el('p', { class: v.ok ? 'small' : 'small dim', text: `Total minutes: ${v.total}/${v.target}${v.ok ? ' ✓' : ''}` }));

    wrap.append(btnRow(
      btn('Auto Lineup', () => { team.lineup = autoLineup(playersOnTeam(g.userTid), g.season); saveToLocal(); reRender(); }),
      btn('Drop Player', dropPlayerMenu),
      btn('Back', () => navigate('home')),
    ));
    return wrap;
  },
});
