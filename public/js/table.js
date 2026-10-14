// The cloth: five coasters, the trick in the middle, the contract bar and the alliance threads.

import {
  store, game, me, rel, seatName, seatInfo, serverNow, isHost, act,
} from './state.js';
import {
  $, esc, reduced, initial, renderIfChanged, toast,
} from './util.js';
import {
  cardEl, backEl, suitSvg, cardText, tilt, SUIT_NAME,
} from './cards.js';

const seatEls = [];
let sweepTarget = null; // seat that took the trick currently on the cloth

// ------------------------------------------------------------------ seats

export function mountSeats() {
  const root = $('#seats');
  for (let i = 0; i < 5; i++) {
    const el = document.createElement('div');
    el.className = 'seat';
    el.dataset.seat = String(i);
    el.innerHTML = `
      <button class="coaster" type="button">
        <svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
          <circle class="ring-track" cx="32" cy="32" r="30"/>
          <circle class="ring-run" cx="32" cy="32" r="30"/>
        </svg>
        <span class="initial"></span>
      </button>
      <div class="seat-name"></div>
      <div class="seat-meta"></div>
      <div class="seat-tags"></div>
      <div class="backs"></div>
      <div class="bubble" hidden></div>`;
    root.append(el);
    seatEls.push(el);
  }
  root.addEventListener('click', onSeatClick);
}

function onSeatClick(e) {
  const btn = e.target.closest('[data-act]');
  const seatEl = e.target.closest('.seat');
  if (!seatEl) return;
  const seat = Number(seatEl.dataset.seat);
  if (btn) {
    if (btn.dataset.act === 'addBot') act({ t: 'addBot', seat });
    if (btn.dataset.act === 'remove') act({ t: 'removeSeat', seat });
    return;
  }
  // In a live round, tapping another player cycles your private guess about them.
  const G = game();
  if (!G || !['calling', 'playing'].includes(G.phase) || seat === me() || seat === G.caller) return;
  const order = [undefined, 'friend', 'foe'];
  const next = order[(order.indexOf(store.ui.marks[seat]) + 1) % order.length];
  if (next) store.ui.marks[seat] = next; else delete store.ui.marks[seat];
  updateSeats();
  renderThreads();
}

const roleOf = (G, i) => {
  if (!G) return null;
  if (i === G.caller && G.caller !== null) return 'caller';
  if (G.result?.friendSeats.includes(i)) return 'friend';
  if (G.revealed.some((r) => r.seat === i)) return 'friend';
  return null;
};

export function updateSeats() {
  const snap = store.snap;
  if (!snap) return;
  const G = game();
  const inLobby = snap.stage === 'lobby';
  const host = isHost();
  if (G && store.ui.marksRound !== snap.roundNo) { store.ui.marks = {}; store.ui.marksRound = snap.roundNo; }

  seatEls.forEach((el, i) => {
    const info = snap.seats[i];
    const r = rel(i);
    const role = roleOf(G, i);
    const turn = G && !G.result && G.turn === i && G.phase !== 'done';
    const passed = G?.phase === 'bidding' && G.bidding.passed[i];
    const empty = info.kind === 'empty';

    el.className = [
      'seat', `pos${r}`,
      empty && 'is-empty',
      i === me() && 'is-me',
      turn && 'is-turn',
      passed && 'is-out',
      info.kind === 'human' && !info.connected && 'is-offline',
      role && `is-${role}`,
      store.ui.marks[i] && `mark-${store.ui.marks[i]}`,
    ].filter(Boolean).join(' ');

    $('.initial', el).textContent = empty ? '+' : initial(info.name);
    $('.seat-name', el).textContent = empty ? 'Open seat' : info.name;

    // meta line: points taken in play, status in the lobby
    const meta = $('.seat-meta', el);
    if (inLobby) {
      meta.textContent = empty ? '' : info.kind === 'bot' ? 'Bot' : info.connected ? (i === snap.host ? 'Host' : 'Ready') : 'Offline';
    } else if (G) {
      const pts = G.won[i];
      meta.innerHTML = G.phase === 'bidding' || G.phase === 'calling'
        ? (info.auto ? (info.kind === 'bot' ? 'Bot' : 'Autopilot') : '')
        : `<b>${pts}</b> points`;
    }

    // tags
    const tags = $('.seat-tags', el);
    const t = [];
    if (inLobby) {
      if (empty && host) t.push('<button class="chip" type="button" data-act="addBot">Seat a bot</button>');
      if (!empty && host && i !== me()) t.push('<button class="chip chip-quiet" type="button" data-act="remove">Remove</button>');
    } else if (G) {
      if (role === 'caller') t.push(`<span class="tag tag-caller">Caller <b>${G.bid}</b></span>`);
      if (role === 'friend') t.push('<span class="tag tag-friend">Friend</span>');
      if (i === me() && G.holdsCalled.length && role !== 'caller' && !G.result) {
        t.push(`<span class="tag tag-secret">You hold ${esc(G.holdsCalled.map(cardText).join(' and '))}</span>`);
      }
      if (i === me() && G.holdsCalled.length && role === 'caller' && !G.result) {
        t.push(`<span class="tag tag-secret">You hold ${esc(G.holdsCalled.map(cardText).join(' and '))}</span>`);
      }
      if (store.ui.marks[i] && !role) t.push(`<span class="tag tag-guess">Guess: ${store.ui.marks[i] === 'friend' ? 'friend' : 'opponent'}</span>`);
      if (info.kind === 'human' && !info.connected) t.push('<span class="tag tag-away">Offline</span>');
      else if (info.kind === 'human' && info.auto) t.push('<span class="tag tag-away">Autopilot</span>');
    }
    tags.innerHTML = t.join('');

    // the cards they still hold
    const backs = $('.backs', el);
    const n = G && i !== me() && !inLobby ? G.handCounts[i] : 0;
    if (backs.childElementCount !== n) backs.replaceChildren(...Array.from({ length: n }, backEl));

    // bid / pass bubble
    const bubble = $('.bubble', el);
    const last = G?.phase === 'bidding' ? G.bidding.last[i] : null;
    bubble.hidden = last === null || last === undefined;
    if (!bubble.hidden) {
      bubble.textContent = last === 'pass' ? 'Pass' : String(last);
      bubble.classList.toggle('is-pass', last === 'pass');
    }

    // turn timer ring
    const ring = $('.ring-run', el);
    const d = G?.deadline;
    if (d && d.seat === i && turn) {
      const elapsed = Math.max(0, d.ms - (d.at - serverNow()));
      const key = `${d.at}`;
      if (ring.dataset.key !== key) {
        ring.dataset.key = key;
        ring.style.animation = 'none';
        void ring.getBoundingClientRect();
        ring.style.animation = `ring ${d.ms}ms linear -${elapsed}ms forwards`;
      }
    } else if (ring.dataset.key) {
      ring.dataset.key = '';
      ring.style.animation = 'none';
    }

    const btn = $('.coaster', el);
    btn.disabled = inLobby || !G || !['calling', 'playing'].includes(G.phase) || i === me() || i === G.caller;
    btn.setAttribute('aria-label', empty ? 'Open seat' : `${info.name}${btn.disabled ? '' : ', tap to mark a guess about their team'}`);
  });
}

// --------------------------------------------------------------- the trick

const cardsOnCloth = new Map(); // card -> element

const centerOf = (rect, within) => ({
  x: rect.left + rect.width / 2 - within.left,
  y: rect.top + rect.height / 2 - within.top,
});

export function renderTrick() {
  const G = game();
  const root = $('#trick');
  const plays = G?.trick?.plays?.length ? G.trick.plays : G?.showTrick?.plays ?? [];
  const winner = G?.showTrick?.winner ?? null;
  if (G?.showTrick) sweepTarget = G.showTrick.winner;
  const wanted = new Set(plays.map((p) => p.card));

  for (const [card, el] of cardsOnCloth) {
    if (wanted.has(card)) continue;
    cardsOnCloth.delete(card);
    sweepAway(el);
  }
  for (const p of plays) {
    let el = cardsOnCloth.get(p.card);
    if (!el) {
      el = cardEl(p.card, { cls: `in-trick pos${rel(p.seat)}` });
      el.style.setProperty('--tilt', `${tilt(p.card)}deg`);
      el.dataset.seat = String(p.seat);
      root.append(el);
      cardsOnCloth.set(p.card, el);
      flyIn(el, p);
    }
    el.classList.toggle('is-winner', winner === p.seat);
  }
  root.classList.toggle('is-settled', Boolean(G?.showTrick));
}

function flyIn(el, play) {
  if (reduced()) return;
  const cloth = $('#cloth').getBoundingClientRect();
  const dest = el.getBoundingClientRect();
  let from = store.ui.flyFrom[play.card];
  delete store.ui.flyFrom[play.card];
  if (!from) {
    const coaster = $(`.seat[data-seat="${play.seat}"] .coaster`);
    from = coaster?.getBoundingClientRect();
  }
  if (!from) return;
  const a = centerOf(from, cloth);
  const b = centerOf(dest, cloth);
  el.animate(
    [
      { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${play.seat === me() ? 1.5 : 0.6})`, opacity: 0.2 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: 340, easing: 'cubic-bezier(.2,.8,.25,1)' },
  );
}

function sweepAway(el) {
  const target = sweepTarget !== null ? $(`.seat[data-seat="${sweepTarget}"] .coaster`) : null;
  if (reduced() || !target) { el.remove(); return; }
  const cloth = $('#cloth').getBoundingClientRect();
  const a = centerOf(el.getBoundingClientRect(), cloth);
  const b = centerOf(target.getBoundingClientRect(), cloth);
  const anim = el.animate(
    [
      { transform: 'none', opacity: 1 },
      { transform: `translate(${b.x - a.x}px, ${b.y - a.y}px) scale(.55)`, opacity: 0 },
    ],
    { duration: 420, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' },
  );
  anim.onfinish = () => el.remove();
}

export function clearTrick() {
  for (const el of cardsOnCloth.values()) el.remove();
  cardsOnCloth.clear();
}

// ------------------------------------------------------------- inlay + bar

export function renderInlay() {
  const G = game();
  const node = $('#inlay');
  let html = '';
  let sig = 'none';
  if (G?.phase === 'bidding' && G.bidding.high) {
    html = `<div class="inlay-bid"><b>${G.bidding.high.value}</b><span>${esc(seatName(G.bidding.high.seat))}</span></div>`;
    sig = `bid${G.bidding.high.value}${G.bidding.high.seat}`;
  } else if (G?.phase === 'calling') {
    html = `<div class="inlay-bid"><b>${G.bid}</b><span>${esc(seatName(G.caller))} names friends and the cut</span></div>`;
    sig = `call${G.bid}`;
  } else if (G?.cut) {
    html = `<div class="inlay-cut is-${G.cut}">${suitSvg(G.cut)}</div>`;
    sig = `cut${G.cut}`;
  }
  renderIfChanged(node, sig, () => { node.innerHTML = html; });
}

export function renderContract() {
  const G = game();
  const node = $('#contract');
  if (!G || store.snap.stage === 'lobby') { node.innerHTML = ''; return; }
  const snap = store.snap;

  let html = '';
  if (G.phase === 'bidding') {
    const h = G.bidding.high;
    html = `<div class="contract-line">
        <span>${esc(seatName(G.startSeat))} opened the bidding.</span>
        ${h ? `<span>High bid <b class="num">${h.value}</b> by ${esc(seatName(h.seat))}</span>` : '<span>No bid yet. The lowest bid is 170.</span>'}
      </div>`;
  } else if (G.phase === 'calling') {
    html = `<div class="contract-line"><span>${esc(seatName(G.caller))} won the bid at <b class="num">${G.bid}</b>.</span><span>Friends and the cut come next.</span></div>`;
  } else {
    const revealedSeats = G.revealed.map((r) => r.seat);
    const teamSeats = G.result ? G.result.teamSeats : [G.caller, ...revealedSeats];
    const known = teamSeats.reduce((s, x) => s + G.won[x], 0);
    const pct = Math.min(100, Math.round((known / G.bid) * 100));
    const friendChips = G.friendCards.map((c) => {
      const played = G.tricks.some((t) => t.plays.some((p) => p.card === c))
        || (G.trick?.plays ?? []).some((p) => p.card === c)
        || (G.showTrick?.plays ?? []).some((p) => p.card === c);
      const holder = G.revealed.find((r) => r.cards.includes(c));
      const callerHeld = G.callerPlayed.includes(c);
      const status = holder ? `${esc(seatName(holder.seat))} played it` : callerHeld ? 'Played by the caller'
        : G.holdsCalled.includes(c) ? 'In your hand' : played ? 'Played' : 'Not played yet';
      return `<span class="friend-chip ${played ? 'is-played' : ''}" title="${esc(status)}">
          <span class="mini ${/[HD]$/.test(c) ? 'is-red' : 'is-ink'}">${c.slice(0, -1)}${suitSvg(c.slice(-1))}</span>
          <small>${status}</small></span>`;
    }).join('');
    html = `
      <div class="contract-main">
        <div class="need"><span>${esc(seatName(G.caller))} needs</span><b class="num">${G.bid}</b></div>
        <div class="cutmark is-${G.cut}" title="Cut suit: ${SUIT_NAME[G.cut]}">${suitSvg(G.cut)}<small>Cut</small></div>
        <div class="friends"><small>Friend cards</small><div class="friend-chips">${friendChips}</div></div>
      </div>
      <div class="meter" role="img" aria-label="${known} of ${G.bid} points taken by the caller and revealed friends">
        <div class="meter-bar"><i style="width:${pct}%"></i></div>
        <span class="meter-text"><b class="num">${known}</b> of ${G.bid} <small>taken by the caller${revealedSeats.length ? ' and revealed friends' : ''}</small></span>
      </div>`;
  }
  renderIfChanged(node, html, () => { node.innerHTML = html; });
  // Room code and round number live in the header.
  $('#barRound').textContent = snap.roundNo ? `Round ${snap.roundNo} of ${snap.rounds}` : '';
}

// ---------------------------------------------------------------- threads

const threadEls = new Map();

export function renderThreads() {
  const svg = $('#threads');
  const cloth = $('#cloth');
  const G = game();
  const box = cloth.getBoundingClientRect();
  if (!box.width) return;
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);

  const want = new Map();
  if (G && G.caller !== null && G.phase !== 'bidding') {
    const friends = G.result ? G.result.friendSeats : G.revealed.map((r) => r.seat);
    friends.forEach((s) => want.set(`real:${s}`, { a: G.caller, b: s, kind: 'real' }));
    Object.entries(store.ui.marks).forEach(([s, m]) => {
      if (m === 'friend' && !friends.includes(Number(s))) want.set(`guess:${s}`, { a: G.caller, b: Number(s), kind: 'guess' });
    });
  }

  for (const [key, node] of threadEls) {
    if (!want.has(key)) { node.remove(); threadEls.delete(key); }
  }
  const mid = { x: box.width / 2, y: box.height / 2 };
  for (const [key, t] of want) {
    const ca = $(`.seat[data-seat="${t.a}"] .coaster`)?.getBoundingClientRect();
    const cb = $(`.seat[data-seat="${t.b}"] .coaster`)?.getBoundingClientRect();
    if (!ca || !cb) continue;
    const a = centerOf(ca, box);
    const b = centerOf(cb, box);
    // slack thread: bow the line toward the middle of the cloth
    const cx = (a.x + b.x) / 2 + (mid.x - (a.x + b.x) / 2) * 0.35;
    const cy = (a.y + b.y) / 2 + (mid.y - (a.y + b.y) / 2) * 0.35 + 14;
    const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    let node = threadEls.get(key);
    if (!node) {
      node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      node.setAttribute('class', `thread is-${t.kind}`);
      svg.append(node);
      threadEls.set(key, node);
      node.setAttribute('d', d);
      if (t.kind === 'real' && !reduced()) {
        const len = node.getTotalLength();
        node.style.strokeDasharray = String(len);
        node.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 900, easing: 'ease-out' });
        setTimeout(() => { node.style.strokeDasharray = ''; }, 920);
      }
    } else {
      node.setAttribute('d', d);
    }
  }
}

export function hintFollow(G) {
  const lead = G.trick?.plays[0]?.card;
  if (!lead) return;
  toast(`Follow ${SUIT_NAME[lead.slice(-1)].toLowerCase()}: you still hold it.`, { kind: 'warn' });
}
