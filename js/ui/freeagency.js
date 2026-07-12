// =============================================================================
// ui/freeagency.js — roster management + signings + (postseason) restricted
// free agency. Shows the user team's full roster with salaries and a Drop
// action, the ranked free-agent pool with custom salary/years offers, and — in
// the postseason — an offer-sheet section for other teams' expiring players.
// =============================================================================
import CONFIG from '../config.js';
import { el, money } from '../util.js';
import { store, saveToLocal, playersOnTeam } from '../state.js';
import {
  rankedFreeAgents, contractDemand, signFreeAgent, canAddPlayer,
  releasePlayer, canReleasePlayer, offerAccepted,
  restrictedFreeAgents, rfaOfferAccepted, signRestrictedFreeAgent,
} from '../freeagency.js';
import { injuryLabel } from '../lineup.js';
import { registerScreen, navigate, reRender, toast, h2, table, btn, btnRow, panel, openModal, closeModal, confirmModal, playerName, injMark } from './dom.js';

// Shared custom-offer modal used by signings, extensions and RFA offer sheets.
// Renders salary ($k/yr) and years inputs pre-filled with the player's demand,
// shows the demand for reference, and calls onSubmit({ amount, years }). Exported
// so ui/extensions.js can reuse the exact same UI.
export function offerModal({ title, subtitle, demand, okText = 'Make Offer', onSubmit }) {
  const amountInput = el('input', { type: 'number', min: CONFIG.MIN_SALARY, max: CONFIG.MAX_SALARY, value: demand.amount });
  const yearsInput = el('input', { type: 'number', min: CONFIG.CONTRACT_MIN_YEARS, max: CONFIG.CONTRACT_MAX_YEARS, value: demand.years });
  const box = el('div', {}, el('h3', { text: title }));
  if (subtitle) box.append(el('p', { class: 'small dim', text: subtitle }));
  box.append(el('p', { text: `Wants: ${money(demand.amount)}/yr × ${demand.years}` }));
  box.append(el('label', { text: 'Salary ($k/yr)' }), amountInput);
  box.append(el('label', { text: `Years (${CONFIG.CONTRACT_MIN_YEARS}–${CONFIG.CONTRACT_MAX_YEARS})` }), yearsInput);
  box.append(btnRow(
    btn(okText, () => {
      const amount = Math.round(Number(amountInput.value));
      const years = Math.round(Number(yearsInput.value));
      if (!(amount > 0) || !(years > 0)) { toast('Enter a salary and years.'); return; }
      closeModal();
      onSubmit({ amount, years });
    }),
    btn('Cancel', closeModal),
  ));
  openModal(box);
}

// Offer a custom deal to a free agent.
function trySign(pid) {
  const g = store.game;
  const p = g.players.find((x) => x.pid === pid);
  if (!canAddPlayer(g, g.userTid)) { toast('Roster is full (15).'); return; }
  const demand = contractDemand(g, p, g.userTid);
  offerModal({
    title: `Sign ${p.name}`,
    subtitle: `${p.pos} · ovr ${p.ovr} · pot ${p.pot} · age ${p.age}`,
    demand,
    onSubmit: ({ amount, years }) => {
      const res = offerAccepted({ amount, years }, demand);
      if (!res.accept) { toast(`${p.name} rejects that offer.`); return; }
      const deal = { amount, years, exp: g.season + years };
      try { signFreeAgent(g, pid, g.userTid, deal); saveToLocal(); toast(`Signed ${p.name}.`); reRender(); }
      catch (e) { toast(e.message); }
    },
  });
}

// Confirm-and-cut a player from the user roster to free agency.
async function tryDrop(pid) {
  const g = store.game;
  const p = g.players.find((x) => x.pid === pid);
  if (!canReleasePlayer(g, g.userTid)) { toast(`Cannot drop below roster minimum (${CONFIG.ROSTER_MIN}).`); return; }
  const ok = await confirmModal(`Drop ${p.name}? They become a free agent and their salary comes off your cap.`, { okText: 'Drop' });
  if (!ok) return;
  try { releasePlayer(g, pid, g.userTid); saveToLocal(); toast(`Dropped ${p.name}.`); reRender(); }
  catch (e) { toast(e.message); }
}

// Offer sheet for a restricted free agent on another team. The current team
// "matches" (offer rejected) unless the offer beats the demand by the premium.
function tryRfaOffer(pid) {
  const g = store.game;
  const p = g.players.find((x) => x.pid === pid);
  if (!canAddPlayer(g, g.userTid)) { toast('Roster is full (15).'); return; }
  const demand = contractDemand(g, p, g.userTid);
  const cur = g.teams.find((t) => t.tid === p.tid);
  offerModal({
    title: `Offer Sheet — ${p.name}`,
    subtitle: `${p.pos} · ovr ${p.ovr} · age ${p.age} · ${cur ? cur.abbrev : '?'}`,
    demand,
    okText: 'Send Offer Sheet',
    onSubmit: ({ amount, years }) => {
      const res = rfaOfferAccepted({ amount, years }, demand);
      if (!res.accept) { toast(`${cur ? cur.abbrev : 'Their team'} matches — ${p.name} stays put.`); return; }
      const deal = { amount, years, exp: g.season + years };
      try { signRestrictedFreeAgent(g, pid, g.userTid, deal); saveToLocal(); toast(`Signed ${p.name} to an offer sheet.`); reRender(); }
      catch (e) { toast(e.message); }
    },
  });
}

// Injury column text for a player ('' when healthy).
const injText = (g, p) => injuryLabel(g, p);

registerScreen('freeagency', {
  render() {
    const g = store.game;
    if (!g) { navigate('menu'); return el('div'); }
    const isPost = g.phase !== 'regular';
    const wrap = el('div', {}, h2('Free Agency'));

    wrap.append(panel(el('div', { class: 'row' },
      el('span', { text: `Roster ${playersOnTeam(g.userTid).length}/${CONFIG.ROSTER_MAX}` }),
      el('span', { class: 'dim', text: isPost ? 'Postseason' : `Day ${g.day}` }))));

    // Full roster with salaries + drop.
    wrap.append(el('h3', { text: 'My Roster' }));
    const roster = playersOnTeam(g.userTid).slice().sort((a, b) => b.ovr - a.ovr);
    const rRows = roster.map((p) => [
      playerName(p.pid, `${injMark(p)}${p.name}`), p.pos, p.ovr,
      money(p.contract ? p.contract.amount : 0), p.contract ? p.contract.exp : '—',
      injText(g, p) || 'OK', btn('Drop', (e) => { e.stopPropagation(); tryDrop(p.pid); }, { class: 'inline' }),
    ]);
    wrap.append(table(['Player', 'Pos', 'Ovr', 'Salary', 'Exp', 'Status', ''], rRows, {
      sortable: true,
      sortKeys: [null, null, null, (_, i) => (roster[i].contract ? roster[i].contract.amount : 0), null, null, null],
    }));

    // Postseason: offer sheets for other teams' restricted free agents.
    if (isPost) {
      wrap.append(el('h3', { text: 'Restricted Free Agents (other teams)' }));
      const rfas = restrictedFreeAgents(g, g.userTid).slice(0, 60);
      if (!rfas.length) {
        wrap.append(el('p', { class: 'dim', text: 'No restricted free agents available.' }));
      } else {
        const rfaRows = rfas.map((p) => {
          const t = g.teams.find((x) => x.tid === p.tid);
          return [playerName(p.pid, `${injMark(p)}${p.name}`), t ? t.abbrev : '?', p.pos, p.ovr, p.age, money(p.contract.amount)];
        });
        wrap.append(table(['Player', 'Team', 'Pos', 'Ovr', 'Age', 'Salary'], rfaRows, {
          onRow: (i) => tryRfaOffer(rfas[i].pid),
          sortable: true,
          sortKeys: [null, null, null, null, null, (_, i) => rfas[i].contract.amount],
        }));
        wrap.append(el('p', { class: 'small dim', text: 'Tap a player to send an offer sheet; their team may match.' }));
      }
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
