// =============================================================================
// ui/trade.js — build a 2- or 3-team trade. Pick partner team(s), toggle which
// players/picks each side sends, then see live validation (salary match, roster
// limits) and the AI verdict before executing. The user's team is always in.
// =============================================================================
import { el, money } from '../util.js';
import { store, saveToLocal } from '../state.js';
import { validateTrade, aiEvaluateAll, executeTrade, playersOnTeam, picksOwnedBy, teamPayroll } from '../trade.js';
import { registerScreen, navigate, reRender, toast, h2, table, btn, btnRow, panel } from './dom.js';

// Trade being assembled: teams (first = user), a Set of selected asset keys,
// and the last AI verdict (only populated after a rejected Execute attempt).
const state = { partners: [], selected: new Set(), lastVerdict: null };
const assetKey = (kind, id) => `${kind}:${id}`;
const teamById = (g, tid) => g.teams.find((t) => t.tid === tid);

function resetTrade() { state.partners = []; state.selected = new Set(); state.lastVerdict = null; }

// Build the trade object from current selections.
function buildTrade(g) {
  const teams = [g.userTid, ...state.partners];
  const assets = [];
  for (const key of state.selected) {
    const [kind, idStr] = key.split(':');
    const id = Number(idStr);
    const from = kind === 'player'
      ? (g.players.find((p) => p.pid === id) || {}).tid
      : (g.draftPicks.find((d) => d.dpid === id) || {}).tid;
    if (from == null) continue;
    // Default destination: the user gets partner assets; partners get user assets.
    const to = from === g.userTid ? state.partners[0] : g.userTid;
    assets.push({ kind, id, from, to });
  }
  return { teams, assets };
}

function assetToggle(kind, id) {
  const key = assetKey(kind, id);
  if (state.selected.has(key)) state.selected.delete(key); else state.selected.add(key);
  state.lastVerdict = null; // changing the offer clears any revealed verdict
  reRender();
}

function teamAssets(g, tid, wrap) {
  const t = teamById(g, tid);
  wrap.append(el('h3', { text: `${t.region} ${t.name} — ${money(teamPayroll(g, tid))}` }));

  // Players as a sortable table; tapping a row toggles it into the trade.
  const players = playersOnTeam(g, tid).slice().sort((a, b) => b.ovr - a.ovr);
  const rows = players.map((p) => {
    const sel = state.selected.has(assetKey('player', p.pid));
    return [`${sel ? '✓ ' : ''}${p.name}`, p.pos, p.ovr, money(p.contract.amount)];
  });
  wrap.append(table(['Player', 'Pos', 'Ovr', 'Salary'], rows, {
    onRow: (i) => assetToggle('player', players[i].pid),
    rowMeta: (i) => (state.selected.has(assetKey('player', players[i].pid)) ? 'me' : ''),
    sortable: true,
    sortKeys: [null, null, null, (_, i) => players[i].contract.amount],
  }));

  // Draft picks stay as toggle buttons (few, and not tabular).
  picksOwnedBy(g, tid).forEach((dp) => {
    const sel = state.selected.has(assetKey('pick', dp.dpid));
    wrap.append(btn(`${sel ? '✓ ' : ''}${dp.season} R${dp.round} pick`, () => assetToggle('pick', dp.dpid), { class: sel ? 'selected' : '' }));
  });
}

registerScreen('trade', {
  render() {
    const g = store.game;
    if (!g) { navigate('menu'); return el('div'); }
    const wrap = el('div', {}, h2('Trade'));

    // Partner selection.
    wrap.append(el('h3', { text: 'Trade with' }));
    const others = g.teams.filter((t) => t.tid !== g.userTid).sort((a, b) => a.abbrev.localeCompare(b.abbrev));
    const partnerRow = el('div', { class: 'btn-row' });
    others.forEach((t) => {
      const on = state.partners.includes(t.tid);
      partnerRow.append(btn(t.abbrev, () => {
        if (on) state.partners = state.partners.filter((x) => x !== t.tid);
        else if (state.partners.length < 2) state.partners.push(t.tid);
        else { toast('Max 3 teams total.'); return; }
        // Drop selected assets from teams no longer in the trade.
        for (const key of [...state.selected]) {
          const [kind, idStr] = key.split(':'); const id = Number(idStr);
          const from = kind === 'player' ? (g.players.find((p) => p.pid === id) || {}).tid : (g.draftPicks.find((d) => d.dpid === id) || {}).tid;
          if (from !== g.userTid && !state.partners.includes(from)) state.selected.delete(key);
        }
        state.lastVerdict = null; // changing teams clears any revealed verdict
        reRender();
      }, { class: on ? 'selected inline' : 'inline' }));
    });
    wrap.append(partnerRow);

    if (!state.partners.length) {
      wrap.append(el('p', { class: 'dim', text: 'Pick 1–2 partner teams to begin.' }));
      wrap.append(btnRow(btn('Back', () => navigate('home'))));
      return wrap;
    }

    // Asset pickers for user + each partner.
    for (const tid of [g.userTid, ...state.partners]) {
      const block = el('div', {});
      teamAssets(g, tid, block);
      wrap.append(panel(block));
    }

    // Validation only — the AI verdict/outcome is hidden until the user presses
    // "Execute Trade". Legality feedback is shown so the user knows the trade is
    // valid, but not whether the other teams will accept.
    const trade = buildTrade(g);
    const check = validateTrade(g, trade);
    const verdictBox = el('div', {});
    if (!check.ok) {
      verdictBox.append(el('p', { class: 'dim', text: check.errors[0] }));
    } else {
      // If a previous "Execute" attempt was rejected, reveal that verdict now.
      if (state.lastVerdict) {
        state.lastVerdict.verdicts.forEach((v) => {
          const t = teamById(g, v.tid);
          verdictBox.append(el('p', { text: `${t.abbrev}: ${v.accept ? 'ACCEPTS' : 'REJECTS'} (ratio ${v.ratio === Infinity ? '∞' : v.ratio.toFixed(2)})` }));
        });
      } else {
        verdictBox.append(el('p', { class: 'dim', text: 'Trade is legal. Press Execute to send the offer.' }));
      }
      verdictBox.append(btn('Execute Trade', () => {
        const ai = aiEvaluateAll(g, trade);
        if (!ai.accepted) {
          state.lastVerdict = ai;
          toast('The other side rejects this offer.');
          reRender();
          return;
        }
        try { executeTrade(g, trade); saveToLocal(); resetTrade(); toast('Trade complete.'); reRender(); }
        catch (e) { toast(e.message); }
      }));
    }
    wrap.append(panel(verdictBox));

    wrap.append(btnRow(
      btn('Clear', () => { resetTrade(); reRender(); }),
      btn('Back', () => { resetTrade(); navigate('home'); }),
    ));
    return wrap;
  },
});
