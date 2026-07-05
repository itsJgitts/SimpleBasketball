// =============================================================================
// ui/playoffs.js — seed + view the bracket and sim it round by round. Uses the
// same heads/tails coin tiebreaker convention as the standings screen. When a
// champion is crowned, routes on to the draft (offseason) phase.
// =============================================================================
import { el } from '../util.js';
import { store, saveToLocal } from '../state.js';
import { seedPlayoffs, simCurrentRound, seriesLabel } from '../playoffs.js';
import { registerScreen, navigate, reRender, toast, h2, btn, btnRow, panel } from './dom.js';

function coinFn(a, b) { return ((a.tid + b.tid) % 2 === 0) ? -1 : 1; }
const teamById = (g, tid) => g.teams.find((t) => t.tid === tid);

registerScreen('playoffs', {
  render() {
    const g = store.game;
    if (!g) { navigate('menu'); return el('div'); }
    const wrap = el('div', {}, h2('Playoffs'));

    // Seed the bracket the first time we arrive after the regular season.
    if (!g.playoffs) {
      seedPlayoffs(g, coinFn);
      saveToLocal();
    }
    const po = g.playoffs;

    if (po.champion) {
      const champ = teamById(g, po.champion);
      wrap.append(panel(
        el('h3', { text: 'CHAMPIONS' }),
        el('p', { text: `${champ.region} ${champ.name}` })));
      wrap.append(btn('Proceed to Draft', () => navigate('draft')));
      return wrap;
    }

    // Render current-round series per conference (or the Finals).
    if (po.finals) {
      wrap.append(el('h3', { text: 'NBA Finals' }));
      wrap.append(el('div', { class: 'mono-box', text: seriesLabel(g, po.finals) }));
    } else {
      for (const cid of po.cids) {
        const cname = (g.confs && g.confs.find((c) => c.cid === cid)) ? g.confs.find((c) => c.cid === cid).name : `Conference ${cid}`;
        wrap.append(el('h3', { text: `${cname} — Round ${po.round}` }));
        wrap.append(el('div', { class: 'mono-box', text: po.conf[cid].map((s) => seriesLabel(g, s)).join('\n') }));
      }
    }

    wrap.append(btnRow(
      btn('Sim Round', () => {
        simCurrentRound(g, store.R);
        saveToLocal();
        if (g.playoffs.champion) {
          const champ = teamById(g, g.playoffs.champion);
          toast(`${champ.abbrev} win the title!`);
        }
        reRender();
      }),
      btn('Dashboard', () => navigate('home')),
    ));
    return wrap;
  },
});
