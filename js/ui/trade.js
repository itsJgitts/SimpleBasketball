// =============================================================================
// ui/trade.js — build a 2- or 3-team trade. Pick partner team(s), toggle which
// players/picks each side sends, and (in a 3-team trade) route each asset to the
// team that receives it, then see live validation (salary match, roster limits)
// and the AI verdict before executing. The user's team is always in.
// =============================================================================
import CONFIG from '../config.js';
import { el, money } from '../util.js';
import { store, saveToLocal } from '../state.js';
import { isHealthy } from '../lineup.js';
import { validateTrade, aiEvaluateAll, executeTrade, playersOnTeam, picksOwnedBy, teamPayroll, teamSummary, salaryMatchOk } from '../trade.js';
import { registerScreen, navigate, reRender, toast, h2, table, btn, btnRow, panel, playerName, injMark } from './dom.js';

// Trade being assembled: teams (first = user), a Set of selected asset keys, a
// map of asset key -> chosen destination tid (3-team routing), and the last AI
// verdict (only populated after a rejected Execute attempt).
const state = { partners: [], selected: new Set(), dest: {}, lastVerdict: null };
const assetKey = (kind, id) => `${kind}:${id}`;
const teamById = (g, tid) => g.teams.find((t) => t.tid === tid);

function resetTrade() { state.partners = []; state.selected = new Set(); state.dest = {}; state.lastVerdict = null; }

// The team currently sending an asset key (its owner).
function assetOwner(g, key) {
  const [kind, idStr] = key.split(':');
  const id = Number(idStr);
  return kind === 'player'
    ? (g.players.find((p) => p.pid === id) || {}).tid
    : (g.draftPicks.find((d) => d.dpid === id) || {}).tid;
}

// Default destination for an asset owned by `from`: in a 2-team trade the other
// team; in a 3-team trade, user assets default to the first partner and partner
// assets default to the user (the user can override via the destination picker).
function defaultDest(g, from) {
  return from === g.userTid ? state.partners[0] : g.userTid;
}

// The chosen (or default) destination tid for a selected asset key.
function destFor(g, key) {
  const from = assetOwner(g, key);
  const teams = [g.userTid, ...state.partners];
  const chosen = state.dest[key];
  if (chosen != null && chosen !== from && teams.includes(chosen)) return chosen;
  return defaultDest(g, from);
}

// Build the trade object from current selections + chosen destinations.
function buildTrade(g) {
  const teams = [g.userTid, ...state.partners];
  const assets = [];
  for (const key of state.selected) {
    const [kind, idStr] = key.split(':');
    const id = Number(idStr);
    const from = assetOwner(g, key);
    if (from == null) continue;
    assets.push({ kind, id, from, to: destFor(g, key) });
  }
  return { teams, assets };
}

function assetToggle(kind, id) {
  const key = assetKey(kind, id);
  if (state.selected.has(key)) { state.selected.delete(key); delete state.dest[key]; }
  else state.selected.add(key);
  state.lastVerdict = null; // changing the offer clears any revealed verdict
  reRender();
}

// Set the destination team for a selected asset (used by the 3-team router).
function setDest(key, tid) {
  state.dest[key] = tid;
  state.lastVerdict = null;
  reRender();
}

function teamAssets(g, tid, wrap) {
  const t = teamById(g, tid);
  wrap.append(el('h3', { text: `${t.region} ${t.name} — ${money(teamPayroll(g, tid))}` }));

  // Players as a sortable table; tapping a row toggles it into the trade.
  const players = playersOnTeam(g, tid).slice().sort((a, b) => b.ovr - a.ovr);
  const rows = players.map((p) => {
    const sel = state.selected.has(assetKey('player', p.pid));
    return [playerName(p.pid, `${sel ? '✓ ' : ''}${injMark(p)}${p.name}`), p.pos, p.ovr, money(p.contract.amount), isHealthy(p) ? '' : 'INJ'];
  });
  wrap.append(table(['Player', 'Pos', 'Ovr', 'Salary', ''], rows, {
    onRow: (i) => assetToggle('player', players[i].pid),
    rowMeta: (i) => (state.selected.has(assetKey('player', players[i].pid)) ? 'me' : ''),
    sortable: true,
    sortKeys: [null, null, null, (_, i) => players[i].contract.amount, null],
  }));

  // Draft picks stay as toggle buttons (few, and not tabular).
  picksOwnedBy(g, tid).forEach((dp) => {
    const sel = state.selected.has(assetKey('pick', dp.dpid));
    wrap.append(btn(`${sel ? '✓ ' : ''}${pickLabel(g, dp)}`, () => assetToggle('pick', dp.dpid), { class: sel ? 'selected' : '' }));
  });
}

// A label for a draft pick, noting the original team when it isn't the current
// owner's own pick (e.g. "2027 R1 pick (from CLE)").
function pickLabel(g, dp) {
  const base = `${dp.season} R${dp.round} pick`;
  if (dp.originalTid == null || dp.originalTid === dp.tid) return base;
  const orig = teamById(g, dp.originalTid);
  return orig ? `${base} (from ${orig.abbrev})` : base;
}

// A human label for a selected asset key (player name or pick description).
function assetLabel(g, key) {
  const [kind, idStr] = key.split(':');
  const id = Number(idStr);
  if (kind === 'player') { const p = g.players.find((x) => x.pid === id); return p ? p.name : '?'; }
  const dp = g.draftPicks.find((d) => d.dpid === id);
  return dp ? pickLabel(g, dp) : '?';
}

// Whether a player asset is being routed to `tid` (picks never affect rosters).
function playerAssetToTeam(g, key, tid) {
  return key.startsWith('player:') && destFor(g, key) === tid;
}

// Projected roster size for `tid` under the current selections + routing. Uses
// the live buildTrade so it always reflects the user's chosen destinations.
function projectedRoster(g, tid) {
  return teamSummary(g, buildTrade(g), tid).rosterAfter;
}

// In a 3-team trade, let the user choose which team receives each asset. Each
// asset can go to either of the two teams that are not its sender. A per-team
// summary line flags any team that would break the [MIN, MAX] roster limits or
// fail salary matching, and any destination button that would push its team
// over the roster max is disabled.
function routingPanel(g) {
  const teams = [g.userTid, ...state.partners];
  if (teams.length < 3 || !state.selected.size) return null;
  const box = el('div', {}, el('h3', { text: 'Route assets' }),
    el('p', { class: 'small dim', text: 'Choose which team receives each asset.' }));

  // Per-team summary under the current routing: projected roster and salary
  // match. Roster breaks and salary-match failures are flagged with .warn.
  const summaryRow = el('div', { class: 'btn-row' });
  const trade = buildTrade(g);
  teams.forEach((tid) => {
    const t = teamById(g, tid);
    const s = teamSummary(g, trade, tid);
    const rosterBad = s.rosterAfter > CONFIG.ROSTER_MAX || s.rosterAfter < CONFIG.ROSTER_MIN;
    const salaryBad = !salaryMatchOk(s.salaryOut, s.salaryIn);
    const txt = `${t.abbrev} ${s.rosterAfter}/${CONFIG.ROSTER_MAX}${salaryBad ? ' $!' : ''}`;
    summaryRow.append(el('span', { class: (rosterBad || salaryBad) ? 'warn' : 'small dim', text: txt }));
  });
  box.append(summaryRow);

  for (const key of state.selected) {
    const from = assetOwner(g, key);
    if (from == null) continue;
    const fromT = teamById(g, from);
    const dest = destFor(g, key);
    const isPlayer = key.startsWith('player:');
    const row = el('div', { class: 'row' },
      el('span', {}, playerName2(g, key), el('span', { class: 'dim', text: ` (${fromT ? fromT.abbrev : '?'}) →` })));
    const btns = el('div', { class: 'btn-row' });
    teams.filter((tid) => tid !== from).forEach((tid) => {
      const t = teamById(g, tid);
      // Would routing this player here push the destination over the max? Only
      // count the +1 if this asset isn't already routed there.
      const already = playerAssetToTeam(g, key, tid);
      const overMax = isPlayer && !already && projectedRoster(g, tid) + 1 > CONFIG.ROSTER_MAX;
      const label = overMax ? `${t.abbrev} !` : t.abbrev;
      btns.append(btn(label, () => setDest(key, tid), {
        class: (tid === dest ? 'selected inline' : 'inline'),
        disabled: overMax && tid !== dest,
      }));
    });
    box.append(el('div', {}, row, btns));
  }
  return panel(box);
}

// Player-name link for a routing row (falls back to a plain label for picks).
function playerName2(g, key) {
  const [kind, idStr] = key.split(':');
  if (kind === 'player') return playerName(Number(idStr), assetLabel(g, key));
  return el('span', { text: assetLabel(g, key) });
}

// A plain-text summary of the proposed trade: for each team in the deal, the
// assets it gives up and the assets it receives. Returns a mono-box node, or
// null when nothing is selected yet.
function tradeSummary(g) {
  const trade = buildTrade(g);
  if (!trade.assets.length) return null;
  const teams = [g.userTid, ...state.partners];
  const lines = [];
  for (const tid of teams) {
    const t = teamById(g, tid);
    const gives = trade.assets.filter((a) => a.from === tid).map((a) => assetLabel(g, assetKey(a.kind, a.id)));
    const gets = trade.assets.filter((a) => a.to === tid).map((a) => assetLabel(g, assetKey(a.kind, a.id)));
    lines.push(`${t.abbrev}`);
    lines.push(`  gives:    ${gives.length ? gives.join(', ') : '—'}`);
    lines.push(`  receives: ${gets.length ? gets.join(', ') : '—'}`);
  }
  return el('div', { class: 'mono-box', text: lines.join('\n') });
}

registerScreen('trade', {
  // Discard any half-built trade when leaving so it doesn't linger on return.
  onLeave() { resetTrade(); },
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
        // Drop selected assets (and any routing) from teams no longer in the trade.
        for (const key of [...state.selected]) {
          const from = assetOwner(g, key);
          if (from !== g.userTid && !state.partners.includes(from)) { state.selected.delete(key); delete state.dest[key]; }
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

    // In a 3-team trade, show the per-asset destination router.
    const router = routingPanel(g);
    if (router) wrap.append(router);

    // Validation only — the AI verdict/outcome is hidden until the user presses
    // "Execute Trade". Legality feedback is shown so the user knows the trade is
    // valid, but not whether the other teams will accept.
    const trade = buildTrade(g);
    const check = validateTrade(g, trade);
    const verdictBox = el('div', {});
    // Human-readable summary of who sends/receives what.
    const summary = tradeSummary(g);
    if (summary) { verdictBox.append(el('h3', { text: 'Trade Summary' })); verdictBox.append(summary); }
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
