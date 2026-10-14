// Panels that sit on the cloth: lobby, the caller's friend + cut sheet, round result, final standings.

import {
  store, game, me, seatName, isHost, act,
} from './state.js';
import {
  $, esc, renderIfChanged, initial, copyText, toast,
} from './util.js';
import {
  suitSvg, SUITS, SUIT_NAME, SUIT_SYMBOL, pointsOf, cardText, cardName,
} from './cards.js';

const RANK_ROW = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5'];

export function mountSheet() {
  const root = $('#sheet');
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
}

export function renderSheet() {
  const snap = store.snap;
  const G = game();
  const root = $('#sheet');
  let html = '';
  let kind = '';

  if (snap.stage === 'lobby') { kind = 'lobby'; html = lobbyHtml(snap); }
  else if (snap.stage === 'over') { kind = 'over'; html = overHtml(snap); }
  else if (G?.phase === 'calling' && G.caller === me()) { kind = 'call'; html = callHtml(G); }
  else if (G?.phase === 'done' && G.result) { kind = 'result'; html = resultHtml(snap, G); }

  root.hidden = !html;
  root.dataset.kind = kind;
  $('#cloth').classList.toggle('has-sheet', Boolean(html) && kind !== 'lobby');
  if (!html) { store.ui.cut = null; store.ui.friends = []; return; }
  renderIfChanged(root, html, () => { root.innerHTML = html; });
}

// ---------------------------------------------------------------- lobby

export function inviteLink(room) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const lan = store.info?.lan?.[0];
  const host = local && lan ? `${lan}:${store.info.port}` : location.host;
  return `${location.protocol}//${host}/?room=${room}`;
}

function lobbyHtml(snap) {
  const host = isHost();
  const seated = snap.seats.filter((s) => s.kind !== 'empty').length;
  const empty = 5 - seated;
  const rounds = [1, 3, 5, 8];
  const hostName = esc(snap.seats[snap.host]?.name ?? 'the host');
  return `
    <div class="sheet-panel lobby">
      <h2>Table</h2>
      <div class="code" aria-label="Table code ${snap.room.split('').join(' ')}">${snap.room}</div>
      <div class="invite">
        <input readonly aria-label="Invite link" value="${esc(inviteLink(snap.room))}">
        <button class="btn small" type="button" data-act="copy">Copy link</button>
        ${typeof navigator.share === 'function' ? '<button class="btn small" type="button" data-act="share">Share</button>' : ''}
      </div>
      <p class="sub">${seated} of 5 seats taken. Send the link to friends anywhere, or give them the code to enter on the home page. Empty seats are filled with bots.</p>
      <div class="setting">
        <span id="roundsLabel">Rounds</span>
        <div class="seg" role="radiogroup" aria-labelledby="roundsLabel">
          ${rounds.map((n) => `<button type="button" role="radio" aria-checked="${snap.settings.rounds === n}" class="${snap.settings.rounds === n ? 'is-on' : ''}" data-rounds="${n}" ${host ? '' : 'disabled'}>${n}</button>`).join('')}
        </div>
      </div>
      <div class="setting">
        <span id="timerLabel">Turn timers</span>
        <div class="seg" role="radiogroup" aria-labelledby="timerLabel">
          <button type="button" role="radio" aria-checked="${snap.settings.timers}" class="${snap.settings.timers ? 'is-on' : ''}" data-timers="1" ${host ? '' : 'disabled'}>On</button>
          <button type="button" role="radio" aria-checked="${!snap.settings.timers}" class="${!snap.settings.timers ? 'is-on' : ''}" data-timers="0" ${host ? '' : 'disabled'}>Off</button>
        </div>
      </div>
      <div class="lobby-foot">
        ${host
    ? `<button class="btn primary big" type="button" data-act="start">${empty ? `Start with ${empty} bot${empty > 1 ? 's' : ''}` : 'Start match'}</button>`
    : `<p class="sub">Waiting for ${hostName} to start the match.</p>`}
      </div>
    </div>`;
}

// ----------------------------------------------------------------- call

function callHtml(G) {
  const own = new Set(G.firstHand);
  const picked = store.ui.friends;
  const cut = store.ui.cut;
  const rows = SUITS.map((s) => {
    const cells = RANK_ROW.map((r) => {
      const c = r + s;
      const barred = c === 'AS';
      const mine = own.has(c);
      const on = picked.includes(c);
      const pts = pointsOf(c);
      const why = barred ? 'The ace of spades cannot be called' : mine ? 'In your own hand' : '';
      return `<button type="button" class="pick ${on ? 'is-picked' : ''} ${mine ? 'is-own' : ''} ${barred ? 'is-barred' : ''}"
          data-pick="${c}" ${barred || mine ? 'disabled' : ''} aria-pressed="${on}"
          aria-label="${cardName(c)}${pts ? `, ${pts} points` : ''}${why ? `. ${why}` : ''}" title="${why || cardName(c)}">
          <b>${r}</b>${pts ? `<i>${pts}</i>` : ''}</button>`;
    }).join('');
    return `<div class="call-row is-${s} ${/[HD]/.test(s) ? 'is-red' : 'is-ink'}">
        <button type="button" class="cut-btn ${cut === s ? 'is-picked' : ''}" data-cut="${s}" aria-pressed="${cut === s}" aria-label="Cut suit: ${SUIT_NAME[s]}">
          ${suitSvg(s)}<small>${cut === s ? 'Cut' : ''}</small></button>
        ${cells}</div>`;
  }).join('');
  const ready = picked.length === 2 && cut;
  const worth = picked.reduce((s, c) => s + pointsOf(c), 0);
  return `
    <div class="sheet-panel call">
      <h2>Name your friends and the cut</h2>
      <p class="sub">You need <b>${G.bid}</b> points. <span class="more">Whoever holds a friend card joins your team and stays hidden until they play it.</span> Tap a suit to make it the cut.</p>
      <div class="call-grid">${rows}</div>
      <div class="call-foot">
        <div class="summary">
          <span>Cut ${cut ? `<b class="${/[HD]/.test(cut) ? 'is-red' : ''}">${SUIT_SYMBOL[cut]} ${SUIT_NAME[cut]}</b>` : '<em>not chosen</em>'}</span>
          <span>Friends ${picked.length ? `<b>${picked.map((c) => cardText(c)).join('  ')}</b>` : '<em>pick two cards</em>'}${picked.length === 2 ? ` <small>(${worth} points between them)</small>` : ''}</span>
        </div>
        <button class="btn primary" type="button" data-act="confirm" ${ready ? '' : 'disabled'}>Confirm call</button>
      </div>
    </div>`;
}

// --------------------------------------------------------------- result

function resultHtml(snap, G) {
  const r = G.result;
  const callerName = esc(seatName(r.caller));
  const host = isHost();
  const pct = (n) => `${(n / 250) * 100}%`;
  const order = [r.caller, ...r.friendSeats, ...[0, 1, 2, 3, 4].filter((s) => !r.teamSeats.includes(s))];
  const cardsOf = (s) => G.revealed.find((x) => x.seat === s)?.cards ?? [];
  const lastRound = snap.roundNo >= snap.rounds;
  const rows = order.map((s) => {
    const role = s === r.caller ? 'Caller' : r.friendSeats.includes(s) ? `Friend, ${cardsOf(s).map(cardText).join(' ')}` : 'Opponent';
    const d = r.deltas[s];
    return `<li class="${r.teamSeats.includes(s) ? 'is-team' : ''}">
        <span class="mono">${esc(initial(seatName(s)))}</span>
        <span class="who"><b>${esc(seatName(s))}${s === me() ? ' (you)' : ''}</b><small>${esc(role)}</small></span>
        <span class="num">${G.won[s]}</span>
        <span class="delta ${d >= 0 ? 'is-up' : 'is-down'}">${d >= 0 ? '+' : '−'}${Math.abs(d)}</span>
        <span class="num total">${snap.scores[s]}</span>
      </li>`;
  }).join('');
  const soloNote = r.friendSeats.length === 0 ? '<p class="sub">Both friend cards were in the caller’s own hand, so the caller played alone.</p>' : '';
  return `
    <div class="sheet-panel result">
      <h2>${callerName} ${r.success ? 'made the call' : 'fell short'}</h2>
      <p class="sub">The caller’s side took <b>${r.teamPoints}</b> of the <b>${r.bid}</b> points it needed. ${r.success ? 'It wins the round.' : 'The opponents win the round.'}</p>
      <div class="split" role="img" aria-label="Caller side ${r.teamPoints} points, opponents ${250 - r.teamPoints} points, bid ${r.bid}">
        <div class="split-team" style="width:${pct(r.teamPoints)}"><span>${r.teamPoints}</span></div>
        <div class="split-opp" style="width:${pct(250 - r.teamPoints)}"><span>${250 - r.teamPoints}</span></div>
        <div class="split-bid" style="left:${pct(r.bid)}"><small>Bid ${r.bid}</small></div>
      </div>
      ${soloNote}
      <ul class="board">
        <li class="board-head"><span></span><span></span><span>Points</span><span>Round</span><span>Total</span></li>
        ${rows}
      </ul>
      ${host
    ? `<button class="btn primary big" type="button" data-act="next">${lastRound ? 'See final standings' : 'Next round'}</button>`
    : `<p class="sub">Waiting for ${esc(seatName(snap.host))} to continue.</p>`}
    </div>`;
}

function overHtml(snap) {
  const host = isHost();
  const ranked = [0, 1, 2, 3, 4].map((s) => ({ s, v: snap.scores[s] })).sort((a, b) => b.v - a.v);
  const top = ranked[0].v;
  const rows = ranked.map((x, i) => `
      <li class="${x.v === top ? 'is-team' : ''}">
        <span class="rank">${i + 1}</span>
        <span class="who"><b>${esc(seatName(x.s))}${x.s === me() ? ' (you)' : ''}</b></span>
        <span class="num total">${x.v}</span>
      </li>`).join('');
  const names = ranked.filter((x) => x.v === top).map((x) => esc(seatName(x.s))).join(' and ');
  return `
    <div class="sheet-panel result">
      <h2>${names} ${ranked.filter((x) => x.v === top).length > 1 ? 'lead' : 'leads'} after ${snap.rounds} round${snap.rounds > 1 ? 's' : ''}</h2>
      <ul class="board standings">${rows}</ul>
      ${host
    ? '<button class="btn primary big" type="button" data-act="rematch">Play again</button>'
    : `<p class="sub">Waiting for ${esc(seatName(snap.host))} to set up the next match.</p>`}
    </div>`;
}

// ------------------------------------------------------------- handlers

function onClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  const ui = store.ui;
  if (t.dataset.rounds) return act({ t: 'settings', rounds: Number(t.dataset.rounds) });
  if (t.dataset.timers) return act({ t: 'settings', timers: t.dataset.timers === '1' });
  if (t.dataset.cut) { ui.cut = t.dataset.cut; return rerenderSheet(); }
  if (t.dataset.pick) {
    const c = t.dataset.pick;
    ui.friends = ui.friends.includes(c) ? ui.friends.filter((x) => x !== c) : [...ui.friends, c].slice(-2);
    return rerenderSheet();
  }
  switch (t.dataset.act) {
    case 'copy': {
      const input = $('.invite input');
      return copyText(input.value, input).then((ok) => toast(ok ? 'Invite link copied.' : 'Select the link and copy it.'));
    }
    case 'share': {
      const room = store.snap.room;
      return navigator.share({ title: 'Kaat', text: `Join my Kaat table. Code ${room}.`, url: inviteLink(room) }).catch(() => {}); // cancelling the sheet is not an error
    }
    case 'start': return act({ t: 'start', fillBots: true });
    case 'confirm': return act({ t: 'call', friends: ui.friends, cut: ui.cut });
    case 'next': return act({ t: 'next' });
    case 'rematch': return act({ t: 'rematch' });
    default: return undefined;
  }
}

function onChange() {}

function rerenderSheet() {
  renderSheet();
}
