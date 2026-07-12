// =============================================================================
// ui/extensions.js — in-season contract extensions. Lists the user team's
// extension-eligible players (those in the final window of their deal) and lets
// the user offer a custom salary/years package. The player accepts when the
// total offered value is at least CONTRACT_ACCEPT_RATIO of their demand.
// =============================================================================
import { el, money } from '../util.js';
import { store, saveToLocal, playersOnTeam } from '../state.js';
import {
  isExtensionEligible, extensionEligibleCount, extensionDemand,
  extendPlayer, offerAccepted,
} from '../freeagency.js';
import { offerModal } from './freeagency.js';
import { registerScreen, navigate, reRender, toast, h2, table, btn, btnRow, panel, playerName } from './dom.js';

// Offer a custom extension to `pid`. The demand is the extension the player
// wants; the deal signed uses the offered amount over the offered years,
// starting the season after their current contract ends.
function tryExtend(pid) {
  const g = store.game;
  const p = g.players.find((x) => x.pid === pid);
  const demand = extensionDemand(g, p);
  offerModal({
    title: `Extend ${p.name}`,
    subtitle: `${p.pos} · ovr ${p.ovr} · age ${p.age} · now ${money(p.contract.amount)} through ${p.contract.exp}`,
    demand,
    onSubmit: ({ amount, years }) => {
      const res = offerAccepted({ amount, years }, demand);
      if (!res.accept) { toast(`${p.name} rejects that extension.`); return; }
      const startSeason = Math.max(g.season + 1, p.contract.exp + 1);
      const deal = { amount, years, exp: startSeason + years - 1 };
      try { extendPlayer(g, pid, deal); saveToLocal(); toast(`Extended ${p.name}.`); reRender(); }
      catch (e) { toast(e.message); }
    },
  });
}

registerScreen('extensions', {
  render() {
    const g = store.game;
    if (!g) { navigate('menu'); return el('div'); }
    const wrap = el('div', {}, h2('Extensions'));

    const eligible = extensionEligibleCount(g, g.userTid);
    wrap.append(panel(el('div', { class: 'row' },
      el('span', { text: `Roster ${playersOnTeam(g.userTid).length}/15` }),
      el('span', { text: `Extension-eligible: ${eligible}` }))));

    const myElig = playersOnTeam(g.userTid)
      .filter((p) => isExtensionEligible(g, p))
      .sort((a, b) => b.ovr - a.ovr);

    if (!myElig.length) {
      wrap.append(el('p', { class: 'dim', text: 'No players are extension-eligible right now.' }));
    } else {
      const demands = myElig.map((p) => extensionDemand(g, p));
      const rows = myElig.map((p, i) => {
        const d = demands[i];
        return [playerName(p.pid, p.name), p.pos, p.ovr, p.age, money(p.contract.amount), `${money(d.amount)}×${d.years}`];
      });
      wrap.append(table(['Player', 'Pos', 'Ovr', 'Age', 'Salary', 'Wants'], rows, {
        onRow: (i) => tryExtend(myElig[i].pid),
        sortable: true,
        sortKeys: [null, null, null, null, (_, i) => myElig[i].contract.amount, (_, i) => demands[i].amount * demands[i].years],
      }));
      wrap.append(el('p', { class: 'small dim', text: 'Tap a player to make a custom extension offer.' }));
    }

    wrap.append(btnRow(btn('Back', () => navigate('home'))));
    return wrap;
  },
});
