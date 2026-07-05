// =============================================================================
// ui/home.js — dashboard + sim controls. Shows the user team snapshot, next
// game, recent results, and the advance buttons (game / week / month / deadline
// / end-of-season). When the regular season completes it offers to start the
// playoffs; playoff/draft/offseason phases route to their own screens.
// =============================================================================
import { el, money } from '../util.js';
import { store, saveToLocal, userTeam, playersOnTeam } from '../state.js';
import {
  advanceToNextUserGame, advanceDays, advanceToDeadline, advanceToSeasonEnd,
  regularSeasonComplete, nextUserGameDay,
} from '../engine.js';
import { computeStandings } from '../standings.js';
import { registerScreen, navigate, reRender, toast, h2, btn, btnRow, table, panel } from './dom.js';

function sim(fn) {
  const g = store.game;
  const agg = fn(g, store.R);
  saveToLocal();
  const inj = agg.injuries.length ? ` · ${agg.injuries.length} injuries` : '';
  toast(`Simmed ${agg.daysAdvanced} day(s), ${agg.results.length} games${inj}.`);
  if (regularSeasonComplete(g) && g.phase === 'regular') g.phase = 'regularDone';
  reRender();
}

function userResults(g, n) {
  const out = [];
  for (const gm of g.schedule) {
    if (!gm.played) continue;
    if (gm.home !== g.userTid && gm.away !== g.userTid) continue;
    const r = g.results[gm.gid];
    if (!r) continue;
    const home = g.teams.find((t) => t.tid === r.home), away = g.teams.find((t) => t.tid === r.away);
    const win = r.winner === g.userTid;
    out.push(`${win ? 'W' : 'L'} ${away.abbrev} ${r.awayScore} @ ${home.abbrev} ${r.homeScore}`);
  }
  return out.slice(-n).reverse();
}

registerScreen('home', {
  render() {
    const g = store.game;
    if (!g) { navigate('menu'); return el('div'); }
    const team = userTeam();
    const wrap = el('div', {}, h2(`${team.region} ${team.name}`));

    // Phase-specific primary action.
    if (g.phase === 'playoffs') wrap.append(panel(el('p', { text: 'Playoffs are underway.' }), btn('Go to Playoffs', () => navigate('playoffs'))));
    else if (g.phase === 'draft') wrap.append(panel(el('p', { text: 'It is draft time.' }), btn('Go to Draft', () => navigate('draft'))));
    else if (g.phase === 'regularDone' || regularSeasonComplete(g)) {
      wrap.append(panel(el('p', { text: 'Regular season complete.' }), btn('Start Playoffs', () => navigate('playoffs'))));
    }

    // Record + next game.
    const { byTid } = computeStandings(g);
    const rec = byTid[g.userTid];
    const payroll = playersOnTeam(g.userTid).reduce((s, p) => s + (p.contract ? p.contract.amount : 0), 0);
    wrap.append(panel(
      el('div', { class: 'row' }, el('span', { text: `Record ${rec.w}-${rec.l}` }), el('span', { text: `Payroll ${money(payroll)}` })),
      el('div', { class: 'row' }, el('span', { text: `Cap ${money(g.salaryCap)}` }), el('span', { class: 'dim', text: `Deadline day ${g.tradeDeadlineDay}` })),
    ));

    if (g.phase === 'regular' && !regularSeasonComplete(g)) {
      const nextDay = nextUserGameDay(g);
      const nextGm = g.schedule.find((gm) => !gm.played && gm.day === nextDay && (gm.home === g.userTid || gm.away === g.userTid));
      if (nextGm) {
        const opp = g.teams.find((t) => t.tid === (nextGm.home === g.userTid ? nextGm.away : nextGm.home));
        const homeAway = nextGm.home === g.userTid ? 'vs' : '@';
        wrap.append(el('p', { text: `Next: ${homeAway} ${opp.region} ${opp.name} (day ${nextGm.day})` }));
      }
      wrap.append(btnRow(
        btn('Sim to Next Game', () => sim(advanceToNextUserGame)),
        btn('Sim Week', () => sim((game, R) => advanceDays(game, R, 7))),
      ));
      wrap.append(btnRow(
        btn('Sim Month', () => sim((game, R) => advanceDays(game, R, 30))),
        btn('Sim to Deadline', () => sim(advanceToDeadline)),
      ));
      wrap.append(btn('Sim to Season End', () => sim(advanceToSeasonEnd)));
    }

    // Recent results.
    const recent = userResults(g, 6);
    if (recent.length) {
      wrap.append(el('h3', { text: 'Recent' }));
      wrap.append(el('div', { class: 'mono-box', text: recent.join('\n') }));
    }

    // Quick links.
    wrap.append(el('h3', { text: 'Manage' }));
    wrap.append(btnRow(
      btn('Standings', () => navigate('standings')),
      btn('Schedule', () => navigate('schedule')),
    ));
    wrap.append(btnRow(
      btn('Roster', () => navigate('roster')),
      btn('Trade', () => navigate('trade')),
      btn('Free Agency', () => navigate('freeagency')),
    ));
    return wrap;
  },
});
