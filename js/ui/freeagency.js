// =============================================================================
// ui/freeagency.js — sign free agents and extend current players. FA list is
// ranked best-first with each player's contract demand (which is cheaper when
// the user team is winning). Current players in the final year of their deal are
// extension-eligible; the header shows the eligible count.
// =============================================================================
import { el, money, fmtPct } from '../util.js';
import { store, saveToLocal, playersOnTeam } from '../state.js';
import {
  rankedFreeAgents, contractDemand, signFreeAgent, canAddPlayer,
  isExtensionEligible, extensionEligibleCount, extensionDemand, extendPlayer,
} from '../freeagency.js';
import { registerScreen, navigate, reRender, toast, h2, table, btn, btnRow, panel, openModal, closeModal, confirmModal, playerName } from './dom.js';

function trySign(pid) {
  const g = store.game;
  const p = g.players.find((x) => x.pid === pid);
  const demand = contractDemand(g, p, g.userTid);
  if (!canAddPlayer(g, g.userTid)) { toast('Roster is full (15).'); return; }
  const box = el('div', {},
    el('h3', { text: `Sign ${p.name}` }),
    el('p', { text: `Ovr ${p.ovr} · Pot ${p.pot} · Age ${p.age}` }),
    el('p', { text: `Asking: ${money(demand.amount)}/yr × ${demand.years} (through ${demand.exp})` }),
    btnRow(
      btn('Offer (accept demand)', () => {
        try { signFreeAgent(g, pid, g.userTid, demand); saveToLocal(); toast(`Signed ${p.name}.`); closeModal(); reRender(); }
        catch (e) { toast(e.message); }
      }),
      btn('Cancel', closeModal),
    ));
  openModal(box);
}

function tryExtend(pid) {
  const g = store.game;
  const p = g.players.find((x) => x.pid === pid);
  const demand = extensionDemand(g, p);
  const box = el('div', {},
    el('h3', { text: `Extend ${p.name}` }),
    el('p', { text: `Current: ${money(p.contract.amount)} through ${p.contract.exp}` }),
    el('p', { text: `Extension: ${money(demand.amount)}/yr × ${demand.years} (through ${demand.exp})` }),
    btnRow(
      btn('Sign extension', () => {
        try { extendPlayer(g, pid, demand); saveToLocal(); toast(`Extended ${p.name}.`); closeModal(); reRender(); }
        catch (e) { toast(e.message); }
      }),
      btn('Cancel', closeModal),
    ));
  openModal(box);
}

registerScreen('freeagency', {
  render() {
    const g = store.game;
    if (!g) { navigate('menu'); return el('div'); }
    const wrap = el('div', {}, h2('Free Agency'));

    const eligible = extensionEligibleCount(g, g.userTid);
    wrap.append(panel(el('div', { class: 'row' },
      el('span', { text: `Roster ${playersOnTeam(g.userTid).length}/15` }),
      el('span', { text: `Extension-eligible: ${eligible}` }))));

    // Extensions section.
    const myElig = playersOnTeam(g.userTid).filter((p) => isExtensionEligible(g, p)).sort((a, b) => b.ovr - a.ovr);
    if (myElig.length) {
      wrap.append(el('h3', { text: `Extensions (${myElig.length})` }));
      const rows = myElig.map((p) => [playerName(p.pid, p.name), p.pos, p.ovr, money(p.contract.amount), p.contract.exp]);
      wrap.append(table(['Player', 'Pos', 'Ovr', 'Salary', 'Exp'], rows, {
        onRow: (i) => tryExtend(myElig[i].pid),
        sortable: true,
        sortKeys: [null, null, null, (_, i) => myElig[i].contract.amount, null],
      }));
    }

    // Free-agent list (cap at 60 for phone performance).
    wrap.append(el('h3', { text: 'Available Free Agents' }));
    const fas = rankedFreeAgents(g).slice(0, 60);
    const demands = fas.map((p) => contractDemand(g, p, g.userTid));
    const rows = fas.map((p, i) => {
      const d = demands[i];
      return [playerName(p.pid, p.name), p.pos, p.ovr, p.pot, p.age, `${money(d.amount)}×${d.years}`];
    });
    wrap.append(table(['Player', 'Pos', 'Ovr', 'Pot', 'Age', 'Asks'], rows, {
      onRow: (i) => trySign(fas[i].pid),
      sortable: true,
      sortKeys: [null, null, null, null, null, (_, i) => demands[i].amount],
    }));

    wrap.append(btnRow(btn('Back', () => navigate('home'))));
    return wrap;
  },
});
