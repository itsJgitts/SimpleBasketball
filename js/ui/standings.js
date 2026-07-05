// =============================================================================
// ui/standings.js — conference standings tables with NBA tiebreakers. The final
// tiebreaker is a coin flip: the user chooses heads/tails via a modal, and the
// choice decides the ordering deterministically for that render.
// =============================================================================
import { fmtPct } from '../util.js';
import { store } from '../state.js';
import { conferenceStandings } from '../standings.js';
import { registerScreen, navigate, h2, table, btn, btnRow, openModal, closeModal } from './dom.js';

// The user's stored coin call for this session (true=heads). When a coin flip is
// actually needed, we resolve it consistently; default heads until asked.
let coinCall = true;

// coinFn(a, b) is called by sortTeams as the final tiebreaker. We return a
// deterministic winner based on the user's heads/tails call XOR pairing parity.
function coinFn(a, b) {
  const parity = ((a.tid + b.tid) % 2 === 0);
  const aWins = coinCall ? parity : !parity;
  return aWins ? -1 : 1;
}

function askCoin() {
  const box = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = 'Tiebreaker coin flip — call it:';
  box.append(p);
  const row = document.createElement('div');
  row.className = 'btn-row';
  row.append(
    btn('Heads', () => { coinCall = true; closeModal(); navigate('standings'); }),
    btn('Tails', () => { coinCall = false; closeModal(); navigate('standings'); }),
  );
  box.append(row);
  openModal(box);
}

registerScreen('standings', {
  render() {
    const g = store.game;
    if (!g) { navigate('menu'); return document.createElement('div'); }
    const wrap = document.createElement('div');
    wrap.append(h2('Standings'));

    const cids = [...new Set(g.teams.map((t) => t.cid))].sort((a, b) => a - b);
    const confName = (g.confs && g.confs.length) ? (cid) => (g.confs.find((c) => c.cid === cid) || {}).name || `Conf ${cid}` : (cid) => `Conf ${cid}`;

    for (const cid of cids) {
      const recs = conferenceStandings(g, cid, coinFn);
      const rows = recs.map((r, i) => [
        `${i + 1}. ${r.region} ${r.name}`, r.w, r.l, fmtPct(r.pct),
        `${r.confW}-${r.confL}`, `${r.divW}-${r.divL}`,
        (r.streak > 0 ? `W${r.streak}` : r.streak < 0 ? `L${-r.streak}` : '-'),
      ]);
      const sub = document.createElement('h3');
      sub.textContent = confName(cid);
      wrap.append(sub);
      wrap.append(table(['Team', 'W', 'L', 'Pct', 'Conf', 'Div', 'Strk'], rows, {
        rowMeta: (i) => (recs[i].tid === g.userTid ? 'me' : ''),
      }));
    }

    wrap.append(btnRow(
      btn(`Coin call: ${coinCall ? 'Heads' : 'Tails'}`, askCoin),
      btn('Back', () => navigate('home')),
    ));
    return wrap;
  },
});
