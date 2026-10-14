// Your hand. Cards are kept as persistent elements so hover, focus and the deal animation survive updates.

import { store, game, act } from './state.js';
import { $, touchOnly, toast, reduced } from './util.js';
import { cardEl, suitOf } from './cards.js';
import { hintFollow } from './table.js';

const nodes = new Map();

export function mountHand() {
  $('#hand').addEventListener('click', onClick);
}

export function renderHand() {
  const G = game();
  const root = $('#hand');
  const want = G && store.snap.stage !== 'lobby' ? G.hand : [];
  const myTurn = Boolean(G && G.phase === 'playing' && G.turn === G.seat && !G.showTrick);
  const legal = new Set(G?.legal ?? []);
  const wantSet = new Set(want);

  for (const [card, el] of nodes) {
    if (wantSet.has(card)) continue;
    store.ui.flyFrom[card] = el.getBoundingClientRect();
    el.remove();
    nodes.delete(card);
  }

  let prevSuit = null;
  let fresh = 0;
  want.forEach((card, idx) => {
    let el = nodes.get(card);
    if (!el) {
      el = cardEl(card, { tag: 'button', cls: 'in-hand' });
      nodes.set(card, el);
      if (!reduced()) {
        el.style.setProperty('--deal', `${fresh++ * 70}ms`);
        el.classList.add('is-dealt');
        el.addEventListener('animationend', () => el.classList.remove('is-dealt'), { once: true });
      }
    }
    const suit = suitOf(card);
    el.classList.toggle('suit-start', idx > 0 && suit !== prevSuit);
    prevSuit = suit;
    el.style.setProperty('--i', String(idx - (want.length - 1) / 2));
    el.classList.toggle('is-playable', myTurn && legal.has(card));
    el.classList.toggle('is-blocked', myTurn && !legal.has(card));
    el.classList.toggle('is-called', Boolean(G?.friendCards.includes(card)));
    el.classList.toggle('is-selected', myTurn && store.ui.selected === card);
    el.setAttribute('aria-disabled', String(!(myTurn && legal.has(card))));
    if (root.children[idx] !== el) root.insertBefore(el, root.children[idx] ?? null);
  });
  if (!myTurn) store.ui.selected = null;
  root.classList.toggle('is-active', myTurn);
  root.dataset.n = String(want.length);
}

function onClick(e) {
  const el = e.target.closest('.card');
  const G = game();
  if (!el || !G || G.phase !== 'playing') return;
  const card = el.dataset.card;
  if (G.turn !== G.seat || G.showTrick) { toast(G.showTrick ? 'The trick is being cleared.' : 'Wait for your turn.'); return; }
  if (!G.legal.includes(card)) {
    hintFollow(G);
    el.animate([{ translate: '0 0' }, { translate: '-4px 0' }, { translate: '4px 0' }, { translate: '0 0' }], { duration: 180 });
    return;
  }
  if (touchOnly() && store.ui.selected !== card) {
    store.ui.selected = card; // first tap lifts the card, second tap plays it
    renderHand();
    return;
  }
  store.ui.selected = null;
  act({ t: 'play', card });
}
