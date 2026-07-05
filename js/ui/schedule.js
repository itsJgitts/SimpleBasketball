// =============================================================================
// ui/schedule.js — the user team's schedule: upcoming games and past results.
// Tapping a completed game opens its full box score (both teams) in a modal.
// =============================================================================
import { el } from '../util.js';
import { store } from '../state.js';
import { registerScreen, navigate, h2, table, btn, btnRow, openModal, closeModal } from './dom.js';

const teamById = (g, tid) => g.teams.find((t) => t.tid === tid);

function boxTable(title, box) {
  const rows = box
    .slice()
    .sort((a, b) => b.pts - a.pts)
    .map((l) => [l.name, l.pos, l.min, l.pts, l.reb, l.ast, l.stl, l.blk, l.tov]);
  return el('div', {}, el('h3', { text: title }),
    table(['Player', 'Pos', 'Min', 'Pts', 'Reb', 'Ast', 'Stl', 'Blk', 'Tov'], rows));
}

function showBox(gid) {
  const g = store.game;
  const r = g.results[gid];
  if (!r) return;
  const home = teamById(g, r.home), away = teamById(g, r.away);
  const box = el('div', {},
    el('h2', { text: `${away.abbrev} ${r.awayScore} @ ${home.abbrev} ${r.homeScore}` }),
    el('p', { class: 'small dim', text: `${r.date || ''} · Win prob (home) ${r.pHome}%` }),
    boxTable(`${away.region} ${away.name}`, r.boxAway),
    boxTable(`${home.region} ${home.name}`, r.boxHome),
    btn('Close', closeModal));
  openModal(box);
}

registerScreen('schedule', {
  render() {
    const g = store.game;
    if (!g) { navigate('menu'); return el('div'); }
    const wrap = el('div', {}, h2('Schedule'));

    const mine = g.schedule.filter((gm) => gm.home === g.userTid || gm.away === g.userTid);
    const rows = mine.map((gm) => {
      const opp = teamById(g, gm.home === g.userTid ? gm.away : gm.home);
      const homeAway = gm.home === g.userTid ? 'vs' : '@';
      if (gm.played) {
        const r = g.results[gm.gid];
        const win = r.winner === g.userTid;
        const mineScore = gm.home === g.userTid ? r.homeScore : r.awayScore;
        const oppScore = gm.home === g.userTid ? r.awayScore : r.homeScore;
        return [gm.date, `${homeAway} ${opp.abbrev}`, `${win ? 'W' : 'L'} ${mineScore}-${oppScore}`];
      }
      return [gm.date, `${homeAway} ${opp.abbrev}`, '—'];
    });

    // Clickable rows open box scores for played games only.
    const playedIdx = mine.map((gm) => gm.played ? gm.gid : null);
    wrap.append(table(['Date', 'Opp', 'Result'], rows, {
      rowMeta: (i) => (mine[i].played ? '' : 'dim'),
      onRow: (i) => { if (playedIdx[i] != null) showBox(playedIdx[i]); },
    }));
    wrap.append(btnRow(btn('Back', () => navigate('home'))));
    return wrap;
  },
});
