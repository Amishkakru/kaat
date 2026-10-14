// Card rendering. Rules and values come from the shared engine module, so the client
// can never disagree with the server about what a card is worth.

import {
  rankOf, suitOf, pointsOf, SUIT_NAME, SUIT_SYMBOL, SUITS,
} from '/engine/cards.js';

export { rankOf, suitOf, pointsOf, SUIT_NAME, SUIT_SYMBOL, SUITS };

const RANK_NAME = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };

export const isRed = (card) => suitOf(card) === 'H' || suitOf(card) === 'D';
export const cardText = (card) => `${rankOf(card)}${SUIT_SYMBOL[suitOf(card)]}`;
export const cardName = (card) => `${RANK_NAME[rankOf(card)] ?? rankOf(card)} of ${SUIT_NAME[suitOf(card)].toLowerCase()}`;

export const suitSvg = (suit, cls = '') =>
  `<svg class="suit ${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="#s-${suit}"/></svg>`;

/** A face-up card. `tag: 'button'` makes it focusable. */
export function cardEl(card, { tag = 'div', cls = '' } = {}) {
  const suit = suitOf(card);
  const rank = rankOf(card);
  const pts = pointsOf(card);
  const node = document.createElement(tag);
  if (tag === 'button') node.type = 'button';
  else node.setAttribute('role', 'img');
  node.className = `card ${isRed(card) ? 'is-red' : 'is-ink'} ${cls}`.trim();
  node.dataset.card = card;
  node.setAttribute('aria-label', cardName(card) + (pts ? `, ${pts} points` : ''));
  const court = rank === 'J' || rank === 'Q' || rank === 'K';
  node.innerHTML = `
    <span class="card-index"><b>${rank}</b>${suitSvg(suit)}</span>
    <span class="card-index card-index-end"><b>${rank}</b>${suitSvg(suit)}</span>
    ${court
    ? `<span class="card-court"><i>${rank}</i>${suitSvg(suit)}</span>`
    : `<span class="card-pip ${rank === 'A' ? 'is-ace' : ''}">${suitSvg(suit)}</span>`}
    ${pts ? `<span class="card-pts ${card === 'QS' ? 'is-big' : ''}">${pts}</span>` : ''}`;
  return node;
}

/** Face-down card, used for the cards other players still hold. */
export const backEl = () => {
  const i = document.createElement('i');
  i.className = 'back';
  return i;
};

/** Stable pseudo-random tilt for a card, so the same card always lands at the same angle. */
export function tilt(card, range = 6) {
  let h = 0;
  for (const ch of card) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return (h % (range * 2 + 1)) - range;
}
