// Card model for Kaat: a 40-card deck (2, 3 and 4 removed), 250 points in play.
// A card is a string: rank + suit letter, e.g. "10H", "QS", "AD".

export const SUITS = ['S', 'H', 'C', 'D'];
export const SUIT_NAME = { S: 'Spades', H: 'Hearts', C: 'Clubs', D: 'Diamonds' };
export const SUIT_SYMBOL = { S: '♠', H: '♥', C: '♣', D: '♦' };
export const RANKS = ['5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i]));

export const TOTAL_POINTS = 250;
export const UNCALLABLE = 'AS'; // the ace of spades can never be named as a friend

export const suitOf = (card) => card.slice(-1);
export const rankOf = (card) => card.slice(0, -1);

/** Point value: Q♠ 60, aces 20, kings 15, other queens 10, jacks 5, everything else 0. */
export function pointsOf(card) {
  if (card === 'QS') return 60;
  switch (rankOf(card)) {
    case 'A': return 20;
    case 'K': return 15;
    case 'Q': return 10;
    case 'J': return 5;
    default: return 0;
  }
}

export const makeDeck = () => SUITS.flatMap((s) => RANKS.map((r) => r + s));
const DECK_SET = new Set(makeDeck());
export const isCard = (c) => typeof c === 'string' && DECK_SET.has(c);

/** Positive when `a` outranks `b` (both must be the same suit to be meaningful). */
export const compareRank = (a, b) => RANK_VALUE[rankOf(a)] - RANK_VALUE[rankOf(b)];

export function shuffle(items, rng = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Small seeded generator so tests and simulations are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Group by suit (cut suit first when known), high to low inside a suit. */
export function sortHand(hand, cut = null) {
  const order = cut ? [cut, ...SUITS.filter((s) => s !== cut)] : SUITS;
  return [...hand].sort((a, b) => {
    const sa = order.indexOf(suitOf(a));
    const sb = order.indexOf(suitOf(b));
    return sa !== sb ? sa - sb : compareRank(b, a);
  });
}
