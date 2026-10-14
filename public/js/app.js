// Wires the connection to the views. Every server message is a full snapshot of what this seat may see.

import {
  store, game, seatName, isHost,
} from './state.js';
import { $, toast, esc } from './util.js';
import { connect, loadSession, saveSession, clearSession } from './net.js';
import {
  mountSeats, updateSeats, renderTrick, renderInlay, renderContract, renderThreads, clearTrick,
} from './table.js';
import { mountHand, renderHand } from './hand.js';
import { mountTray, renderTray, tickClock } from './tray.js';
import { mountSheet, renderSheet, inviteLink } from './sheet.js';
import { mountLedger, renderLedger } from './ledger.js';
import { mountEntry, showError, setBusy } from './entry.js';
import { mountRules } from './rules.js';

const app = $('#app');
let pendingName = '';
let lastRound = -1;
let lastStage = null;

store.session = loadSession();

const net = connect({
  onMessage: onMessage,
  onStatus(status, code) {
    store.status = status;
    $('#conn').hidden = status === 'open';
    if (status === 'open') {
      // After a reconnect or a page refresh, take the same seat back.
      if (store.session) net.send({ t: 'join', room: store.session.room, token: store.session.token, name: store.session.name });
    } else if (code === 4001) {
      leaveTable('The host removed you from the table.');
    }
  },
});
store.send = net.send;

fetch('/api/info').then((r) => r.json()).then((info) => { store.info = info; if (store.snap) render(); }).catch(() => {});

function onMessage(m) {
  switch (m.t) {
    case 'joined':
      store.session = { room: m.room, token: m.token, seat: m.seat, name: pendingName || store.session?.name || '' };
      saveSession(store.session);
      history.replaceState(null, '', `/?room=${m.room}`);
      break;
    case 'state':
      store.clockOffset = m.s.now - Date.now();
      store.snap = m.s;
      setBusy(false);
      render();
      break;
    case 'error':
      if (!store.snap) {
        setBusy(false);
        if (m.code === 'noroom' || m.code === 'started' || m.code === 'full') {
          clearSession();
          store.session = null;
        }
        showError(m.msg);
      } else {
        toast(m.msg, { kind: 'warn' });
      }
      break;
    default:
  }
}

function leaveTable(message) {
  clearSession();
  store.session = null;
  store.snap = null;
  clearTrick();
  history.replaceState(null, '', '/');
  app.dataset.view = 'entry';
  showError(message);
}

function render() {
  const snap = store.snap;
  if (!snap) return;
  const view = snap.stage === 'lobby' ? 'lobby' : 'game';
  app.dataset.view = view;

  if (snap.roundNo !== lastRound || (lastStage !== snap.stage && snap.stage === 'lobby')) {
    clearTrick();
    store.ui.friends = [];
    store.ui.cut = null;
    store.ui.bid = null;
    lastRound = snap.roundNo ?? -1;
  }
  lastStage = snap.stage;

  const room = $('#barRoom');
  room.hidden = false;
  room.innerHTML = `<span>Table</span> <b>${esc(snap.room)}</b>`;
  $('#barRound').textContent = snap.roundNo && snap.stage !== 'lobby' ? `Round ${snap.roundNo} of ${snap.rounds}` : '';
  document.title = snap.stage === 'lobby' ? `Kaat ${snap.room}` : `${game()?.turn === snap.you ? 'Your turn. ' : ''}Kaat ${snap.room}`;

  updateSeats();
  renderContract();
  renderInlay();
  renderTrick();
  renderHand();
  renderTray();
  renderSheet();
  renderLedger();
  renderThreads();
}

// ---------------------------------------------------------------- startup

mountSeats();
mountHand();
mountTray();
mountSheet();
mountLedger();
mountRules();
mountEntry({
  onCreate(name) {
    pendingName = name;
    setBusy(true);
    net.send({ t: 'create', name });
  },
  onJoin(name, room) {
    pendingName = name;
    setBusy(true);
    net.send({ t: 'join', room, name });
  },
});

// Resuming a refreshed tab: show a quiet "rejoining" state instead of the form.
if (store.session) {
  setBusy(true);
  app.dataset.view = 'entry';
}

$('#btnLedger').addEventListener('click', () => {
  store.ui.ledgerOpen = !store.ui.ledgerOpen;
  app.classList.toggle('ledger-open', store.ui.ledgerOpen);
});

new ResizeObserver(() => { if (store.snap) renderThreads(); }).observe($('#cloth'));
setInterval(tickClock, 250);

// Handy for debugging in the console and for the browser tests.
window.kaat = { store, game, seatName, isHost, inviteLink };
