// The strip between the cloth and your hand: bid controls and plain-language prompts.

import {
  store, game, seatName, serverNow, act,
} from './state.js';
import { $, esc, renderIfChanged } from './util.js';
import { suitOf, pointsOf, SUIT_NAME, suitSvg } from './cards.js';

export function mountTray() {
  const root = $('#tray');
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const G = game();
    const legal = G?.bidding.legal ?? [];
    const bid = store.ui.bid;
    switch (b.dataset.act) {
      case 'dec': store.ui.bid = legal[Math.max(0, legal.indexOf(bid) - 1)]; renderTray(); break;
      case 'inc': store.ui.bid = legal[Math.min(legal.length - 1, legal.indexOf(bid) + 1)]; renderTray(); break;
      case 'max': store.ui.bid = legal.at(-1); renderTray(); break;
      case 'bid': act({ t: 'bid', value: bid }); break;
      case 'pass': act({ t: 'pass' }); break;
      case 'resume': act({ t: 'resume' }); break;
      default:
    }
  });
  root.addEventListener('keydown', (e) => {
    if (!$('.bidbox', root)) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); $('[data-act="inc"]', root)?.click(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); $('[data-act="dec"]', root)?.click(); }
  });
}

export function renderTray() {
  const snap = store.snap;
  const G = game();
  const root = $('#tray');
  if (!G || snap.stage === 'lobby') { root.innerHTML = ''; return; }

  const me = snap.you;
  const myTurn = G.turn === me && !G.showTrick;
  const handPts = G.firstHand.reduce((s, c) => s + pointsOf(c), 0);
  const away = snap.seats[me].auto && snap.seats[me].kind === 'human';
  const clockFor = G.deadline && G.turn === G.deadline.seat ? G.deadline : null;

  let main = '';
  let sig = {};
  if (G.phase === 'bidding') {
    const legal = G.bidding.legal;
    if (myTurn && legal.length) {
      if (!legal.includes(store.ui.bid)) store.ui.bid = legal[0];
      const high = G.bidding.high;
      main = `
        <div class="bidbox" role="group" aria-label="Your bid">
          <button class="step" type="button" data-act="dec" aria-label="Lower the bid" ${store.ui.bid === legal[0] ? 'disabled' : ''}>−</button>
          <output class="bidval" aria-live="polite">${store.ui.bid}</output>
          <button class="step" type="button" data-act="inc" aria-label="Raise the bid" ${store.ui.bid === legal.at(-1) ? 'disabled' : ''}>+</button>
          <button class="btn primary" type="button" data-act="bid">Bid ${store.ui.bid}</button>
          <button class="btn" type="button" data-act="pass">Pass</button>
          ${legal.length > 2 ? `<button class="btn quiet" type="button" data-act="max">Go to ${legal.at(-1)}</button>` : ''}
        </div>
        <p class="prompt">${high ? `High bid ${high.value} by ${esc(seatName(high.seat))}.` : 'Opening bid is 170.'} Your four cards hold ${handPts} points. Passing is final for this round.</p>`;
      sig = { b: store.ui.bid, legal: [legal[0], legal.at(-1)] };
    } else {
      main = `<p class="prompt"><b>${esc(seatName(G.turn))}</b> is bidding. Your four cards hold ${handPts} points.</p>`;
      sig = { t: G.turn };
    }
  } else if (G.phase === 'calling') {
    main = G.caller === me
      ? '<p class="prompt"><b>You hold the call.</b> Name two friend cards and the cut suit on the table.</p>'
      : `<p class="prompt"><b>${esc(seatName(G.caller))}</b> is naming two friend cards and the cut suit.</p>`;
  } else if (G.phase === 'playing') {
    if (G.showTrick) {
      const t = G.showTrick;
      main = `<p class="prompt"><b>${esc(seatName(t.winner))}</b> takes the trick${t.points ? ` and ${t.points} points` : ''}.</p>`;
      sig = { w: t.winner, no: t.no };
    } else if (myTurn) {
      const lead = G.trick.plays[0]?.card;
      if (!lead) {
        main = '<p class="prompt"><b>Your lead.</b> Play any card.</p>';
      } else {
        const ls = suitOf(lead);
        const has = G.hand.some((c) => suitOf(c) === ls);
        main = has
          ? `<p class="prompt"><b>Your turn.</b> Follow ${SUIT_NAME[ls].toLowerCase()} ${suitSvg(ls, 'inline')}</p>`
          : `<p class="prompt"><b>Your turn.</b> You hold no ${SUIT_NAME[ls].toLowerCase()}. Play any card; a ${SUIT_NAME[G.cut].toLowerCase()} ${suitSvg(G.cut, 'inline')} cuts.</p>`;
      }
      sig = { lead: G.trick.plays[0]?.card ?? null, my: true };
    } else {
      main = `<p class="prompt">Waiting for <b>${esc(seatName(G.turn))}</b>.</p>`;
      sig = { t: G.turn };
    }
  } else if (G.phase === 'done') {
    main = '<p class="prompt">Round complete.</p>';
  }

  const banner = away
    ? '<div class="away-banner"><span>Autopilot is playing your seat.</span><button class="btn small" type="button" data-act="resume">Take over</button></div>'
    : '';
  const clock = clockFor ? `<span class="clock" data-at="${clockFor.at}" data-seat="${clockFor.seat}"></span>` : '';
  const html = `${banner}<div class="tray-row">${main}${clock}</div>`;
  renderIfChanged(root, { html, my: myTurn }, () => { root.innerHTML = html; });
  tickClock();
}

/** Update the countdown text without re-rendering the tray. */
export function tickClock() {
  const c = $('#tray .clock');
  if (!c) return;
  const left = Math.max(0, Number(c.dataset.at) - serverNow());
  const s = Math.ceil(left / 1000);
  const mine = Number(c.dataset.seat) === store.snap.you;
  c.textContent = `${mine ? 'Your time ' : `${seatName(Number(c.dataset.seat))} `}0:${String(s).padStart(2, '0')}`;
  c.classList.toggle('is-low', s <= 5);
}
