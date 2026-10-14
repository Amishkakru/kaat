// Landing page: name, create a table or join one with a code.

import { store } from './state.js';
import { $, esc } from './util.js';
import { cardEl } from './cards.js';

const NAME_KEY = 'kaat.name';

export function mountEntry({ onCreate, onJoin }) {
  const form = $('#entryForm');
  const fan = $('#entryFan');
  const hero = ['9S', 'JC', 'QS', 'KD', 'AH'];
  hero.forEach((card, i) => {
    const el = cardEl(card, { cls: 'fan-card' });
    el.style.setProperty('--r', `${(i - 2) * 13}deg`);
    el.style.setProperty('--x', `${(i - 2) * 46}px`);
    el.style.setProperty('--y', `${Math.abs(i - 2) * 14}px`);
    if (card === 'QS') el.classList.add('is-hero');
    fan.append(el);
  });

  try { $('#nameInput').value = localStorage.getItem(NAME_KEY) ?? ''; } catch { /* storage blocked */ }

  const params = new URLSearchParams(location.search);
  const invited = (params.get('room') ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (invited.length === 4) {
    $('#codeInput').value = invited;
    form.dataset.mode = 'invite';
    $('.lede', form).innerHTML = `You have been invited to table <b class="code-inline">${esc(invited)}</b>. Enter your name to take a seat.`;
    $('#btnJoin').classList.add('primary');
  }

  $('#codeInput').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#nameInput').value.trim();
    const code = $('#codeInput').value.trim().toUpperCase();
    const intent = e.submitter?.dataset.intent ?? (code ? 'join' : 'create');
    showError('');
    if (!name) { showError('Enter your name first.'); $('#nameInput').focus(); return; }
    try { localStorage.setItem(NAME_KEY, name); } catch { /* storage blocked */ }
    if (intent === 'join') {
      if (code.length !== 4) { showError('Table codes have four letters.'); $('#codeInput').focus(); return; }
      onJoin(name, code);
    } else {
      onCreate(name);
    }
  });
}

export function showError(msg) {
  const p = $('#entryError');
  p.textContent = msg;
  p.hidden = !msg;
}

export function setBusy(busy) {
  $('#entryForm').classList.toggle('is-busy', busy);
  $('#entryForm').querySelectorAll('button').forEach((b) => { b.disabled = busy; });
  if (!store.snap) showError('');
}
