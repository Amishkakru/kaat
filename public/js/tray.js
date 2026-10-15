// The strip between the cloth and your hand: bid controls, the early-end vote and plain-language prompts.

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
    switch (b.dataset.act) {
      case 'bid': act({ t: 'bid', value: Number(b.dataset.value) }); break;
      case 'stepUp': stepBid(1); break;
      case 'stepDown': stepBid(-1); break;
      case 'pass': act({ t: 'pass' }); break;
      case 'claim': act({ t: 'claim' }); break;
      case 'voteYes': act({ t: 'vote', yes: true }); break;
      case 'voteNo': act({ t: 'vote', yes: false }); break;
      case 'resume': act({ t: 'resume' }); break;
      default:
    }
  });
}

/** The stepper's price: the dialled-in bid, moved up to the lowest legal bid if someone has gone past it. */
function stepperValue(legal) {
  const i = legal.findIndex((v) => v >= store.ui.bid);
  store.ui.bid = legal[i < 0 ? legal.length - 1 : i];
  return store.ui.bid;
}

/** One step up or down the ladder (10 up to 200, then 5), never below the lowest legal bid. */
function stepBid(dir) {
  const legal = game()?.bidding?.legal;
  if (!legal?.length) return;
  const i = legal.indexOf(stepperValue(legal)) + dir;
  store.ui.bid = legal[Math.min(legal.length - 1, Math.max(0, i))];
  renderTray();
}

/** Bidding is an open auction with no turns: dial the price with − and +, then bid. */
function auctionHtml(G, me, handPts) {
  const { legal, high } = G.bidding;
  const leader = high ? `${esc(seatName(high.seat))} leads at <b>${high.value}</b>.` : 'Nobody has bid yet.';
  if (legal.length) {
    const value = stepperValue(legal);
    const i = legal.indexOf(value);
    const down = legal[i - 1];
    const up = legal[i + 1];
    return `
      <div class="bidbox" role="group" aria-label="Your bid">
        <div class="stepper">
          <button class="step" type="button" data-act="stepDown" ${down ? `aria-label="Lower the bid to ${down}"` : 'disabled aria-label="Lowest bid"'}>−</button>
          <output class="stepval num" aria-live="polite">${value}</output>
          <button class="step" type="button" data-act="stepUp" ${up ? `aria-label="Raise the bid to ${up}"` : 'disabled aria-label="Highest bid"'}>+</button>
        </div>
        <button class="btn primary bid-main" type="button" data-act="bid" data-value="${value}">Bid</button>
        <button class="btn" type="button" data-act="pass">Pass</button>
      </div>
      <p class="prompt">${leader} Your four cards hold ${handPts} points. Passing is final.</p>`;
  }
  if (high?.seat === me) {
    return `<p class="prompt"><b>You hold the high bid at ${high.value}.</b> If nobody bids higher before the clock runs out, the call is yours.</p>`;
  }
  return `<p class="prompt"><b>You passed.</b> ${leader} Your four cards hold ${handPts} points.</p>`;
}

/** An open vote on ending the round early. Everyone at the table has one vote. */
function voteHtml(G, me) {
  const o = G.claim.open;
  const mine = o.votes[me];
  const by = o.by === me ? '<b>You claim the round.</b>' : `<b>${esc(seatName(o.by))} claims the round.</b>`;
  const answer = mine === null
    ? '<button class="btn primary" type="button" data-act="voteYes">End the round</button><button class="btn" type="button" data-act="voteNo">Play on</button>'
    : `<span class="voted">You voted ${mine ? 'yes' : 'no'}.</span>`;
  return `
    <div class="votebox" role="group" aria-label="Vote on ending the round">
      <p class="prompt">${by} The caller’s side cannot reach ${G.bid}, even with every point still in play.
        <span class="tally"><b>${o.yes}</b> yes, <b>${o.no}</b> no. ${G.claim.need} yes votes end the round.</span></p>
      <div class="vote-actions">${answer}</div>
    </div>`;
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
  const d = G.deadline;
  const clockFor = d && (d.kind || G.turn === d.seat) ? d : null;

  if (G.phase !== 'bidding') store.ui.bid = 0;
  let main = '';
  if (G.phase === 'bidding') {
    main = auctionHtml(G, me, handPts);
  } else if (G.phase === 'calling') {
    main = G.caller === me
      ? '<p class="prompt"><b>You hold the call.</b> Name two friend cards and the cut suit on the table.</p>'
      : `<p class="prompt"><b>${esc(seatName(G.caller))}</b> is naming two friend cards and the cut suit.</p>`;
  } else if (G.phase === 'playing') {
    if (G.claim.open) {
      main = voteHtml(G, me);
    } else if (G.showTrick) {
      const t = G.showTrick;
      main = `<p class="prompt"><b>${esc(seatName(t.winner))}</b> takes the trick${t.points ? ` and ${t.points} points` : ''}.</p>`;
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
    } else {
      main = `<p class="prompt">Waiting for <b>${esc(seatName(G.turn))}</b>.</p>`;
    }
    if (G.claim.canStart) {
      main += `<button class="btn claim" type="button" data-act="claim" title="Your side has taken enough that the caller cannot reach ${G.bid}. Three of the five players must agree to end the round.">Claim the round</button>`;
    }
  } else if (G.phase === 'done') {
    main = ''; // the result sheet covers this row
  }

  const banner = away
    ? '<div class="away-banner"><span>Autopilot is playing your seat.</span><button class="btn small" type="button" data-act="resume">Take over</button></div>'
    : '';
  const clock = clockFor ? `<span class="clock" data-at="${clockFor.at}" data-seat="${clockFor.seat ?? ''}" data-kind="${clockFor.kind ?? 'turn'}"></span>` : '';
  const html = `${banner}<div class="tray-row ${G.claim.open ? 'is-vote' : ''}">${main}${clock}</div>`;
  const held = document.activeElement?.closest?.('#tray [data-act]')?.dataset.act;
  renderIfChanged(root, { html, my: myTurn }, () => {
    root.innerHTML = html;
    if (!held) return;
    // Stepping re-draws the tray; keep the focus on the same button (or on Bid once a limit button switches off).
    (root.querySelector(`[data-act="${held}"]:not(:disabled)`) ?? root.querySelector('[data-act="bid"]'))?.focus();
  });
  tickClock();
}

/** Update the countdown text without re-rendering the tray. */
export function tickClock() {
  const c = $('#tray .clock');
  if (!c) return;
  const left = Math.max(0, Number(c.dataset.at) - serverNow());
  const s = Math.ceil(left / 1000);
  const time = `0:${String(s).padStart(2, '0')}`;
  const kind = c.dataset.kind;
  if (kind === 'auction') c.textContent = `Auction closes ${time}`;
  else if (kind === 'claim') c.textContent = `Vote ends ${time}`;
  else {
    const seat = Number(c.dataset.seat);
    c.textContent = `${seat === store.snap.you ? 'Your time ' : `${seatName(seat)} `}${time}`;
  }
  c.classList.toggle('is-low', s <= 3 || (kind === 'turn' && s <= 5));
}
