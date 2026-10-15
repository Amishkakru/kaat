// Right-hand ledger: what happened (bids, calls, tricks) and the running scores.

import { store, game, seatName } from './state.js';
import { $, esc, renderIfChanged, initial } from './util.js';
import { cardText, suitSvg, SUIT_NAME } from './cards.js';

export function mountLedger() {
  $('#ledger').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.tab) { store.ui.tab = t.dataset.tab; renderLedger(); }
    if (t.dataset.act === 'close') { store.ui.ledgerOpen = false; document.getElementById('app').classList.remove('ledger-open'); }
  });
}

const mini = (card) => `<span class="mini ${/[HD]$/.test(card) ? 'is-red' : 'is-ink'}">${card.slice(0, -1)}${suitSvg(card.slice(-1))}</span>`;

function describe(e, G) {
  const n = (s) => `<b>${esc(seatName(s))}</b>`;
  switch (e.type) {
    case 'bid': return { html: `${n(e.seat)} bid <b class="num">${e.value}</b>`, cls: 'bid' };
    case 'pass': return { html: `${n(e.seat)} passed`, cls: 'pass' };
    case 'redeal': {
      const who = e.seats.map((s) => esc(seatName(s)));
      const list = who.length > 1 ? `${who.slice(0, -1).join(', ')} and ${who.at(-1)}` : who[0];
      return { html: `Dealt again: ${list} held no ace, king, queen or jack`, cls: 'note' };
    }
    case 'caller': return {
      html: e.forced ? `Nobody bid. ${n(e.seat)} takes the call at <b class="num">${e.bid}</b>` : `${n(e.seat)} won the auction at <b class="num">${e.bid}</b>`,
      cls: 'key',
    };
    case 'claim': return { html: `${n(e.seat)} claims the round: the caller’s side cannot reach ${G.bid}`, cls: 'vote' };
    case 'vote': return { html: `${n(e.seat)} voted ${e.yes ? 'yes' : 'no'}`, cls: 'vote' };
    case 'claimResult': return {
      html: e.passed
        ? `Claim carried, ${e.yes} yes to ${e.no} no. The round ends early`
        : `Claim failed, ${e.yes} yes to ${e.no} no. Play continues`,
      cls: 'key',
    };
    case 'contract': return {
      html: `${n(e.seat)} named ${e.friends.map(mini).join(' ')} as friends and made ${suitSvg(e.cut, 'inline')} ${SUIT_NAME[e.cut].toLowerCase()} the cut`,
      cls: 'key',
    };
    case 'friend': return { html: `${n(e.seat)} played ${mini(e.card)}: a friend of ${n(G.caller)}`, cls: 'reveal' };
    case 'callerCard': return { html: `${n(e.seat)} played ${mini(e.card)} from their own hand`, cls: 'reveal' };
    case 'timeout': return { html: `${n(e.seat)} ran out of time and was played for`, cls: 'note' };
    case 'autopilot': return { html: `${n(e.seat)} is on autopilot`, cls: 'note' };
    case 'away': return { html: `${n(e.seat)} disconnected`, cls: 'note' };
    case 'back': return { html: `${n(e.seat)} is back`, cls: 'note' };
    case 'end': return {
      html: e.success ? `The caller’s side made its bid with ${e.teamPoints}`
        : `The caller’s side ${e.early ? 'had' : 'fell short with'} ${e.teamPoints} of ${e.bid}${e.early ? ' and cannot reach it' : ''}`,
      cls: 'key',
    };
    case 'trick': {
      const t = G.tricks[e.no - 1];
      if (!t) return null;
      const plays = t.plays.map((p) => `<span class="tc ${p.seat === t.winner ? 'is-win' : ''}"><small>${esc(initial(seatName(p.seat)))}</small>${mini(p.card)}</span>`).join('');
      return {
        html: `<div class="trick-head"><b>Trick ${t.no}</b><span>${esc(seatName(t.winner))} took ${t.points}</span></div><div class="trick-cards">${plays}</div>`,
        cls: 'trick',
      };
    }
    default: return null; // individual card plays are shown on the cloth
  }
}

export function renderLedger() {
  const snap = store.snap;
  const G = game();
  const root = $('#ledger');
  if (!snap || snap.stage === 'lobby') { root.innerHTML = ''; return; }

  const tab = store.ui.tab;
  let body = '';
  if (tab === 'play' && G) {
    const items = G.log.map((e) => ({ e, d: describe(e, G) })).filter((x) => x.d);
    body = !items.length ? '<p class="empty-note">Bids, calls and tricks are recorded here as they happen.</p>' : `<ol class="log">${items.map(({ e, d }) => `<li class="log-${d.cls}" data-id="${e.id}">${d.html}</li>`).join('')}</ol>`;
  } else {
    const rows = [0, 1, 2, 3, 4].map((s) => `
        <tr class="${s === snap.you ? 'is-me' : ''}">
          <th scope="row">${esc(seatName(s))}</th>
          <td class="num">${G ? G.won[s] : 0}</td>
          <td class="num total">${snap.scores?.[s] ?? 0}</td>
        </tr>`).join('');
    const hist = (snap.history ?? []).map((h) => `
        <li><b>Round ${h.round}</b> ${esc(seatName(h.caller))} ${h.success ? 'made' : 'missed'} ${h.bid}
        <small>${h.teamPoints} taken${h.early ? ', ended early' : ''}${h.redeals ? `, dealt again ${h.redeals > 1 ? `${h.redeals} times` : 'once'}` : ''}</small></li>`).join('');
    body = `
      <table class="scores">
        <thead><tr><th>Player</th><th>This round</th><th>Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${hist ? `<ul class="history">${hist}</ul>` : ''}`;
  }

  const html = `
    <div class="ledger-head">
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${tab === 'play'}" data-tab="play">Play</button>
        <button type="button" role="tab" aria-selected="${tab === 'scores'}" data-tab="scores">Scores</button>
      </div>
      <button class="btn quiet small only-narrow" type="button" data-act="close">Close</button>
    </div>
    <div class="ledger-body" tabindex="0">${body}</div>`;

  const body0 = $('.ledger-body', root);
  const stick = !body0 || body0.scrollHeight - body0.scrollTop - body0.clientHeight < 40;
  if (renderIfChanged(root, html, () => { root.innerHTML = html; }) && tab === 'play' && stick) {
    const b = $('.ledger-body', root);
    b.scrollTop = b.scrollHeight;
  }
}

export { cardText };
