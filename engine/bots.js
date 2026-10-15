// Autopilot for empty seats, disconnected players and timeouts.
// A bot only ever receives `round.view(seat)`, the same information a human at that seat has.

import {
  SUITS, makeDeck, suitOf, rankOf, pointsOf, compareRank, RANK_VALUE,
} from './cards.js';
import { SEATS } from './round.js';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const minBy = (xs, key) => xs.reduce((best, x) => (key(x) < key(best) ? x : best));
const maxBy = (xs, key) => xs.reduce((best, x) => (key(x) > key(best) ? x : best));

/**
 * Returns { type: 'bid', value } | { type: 'pass' } | { type: 'call', friends, cut } | { type: 'play', card }
 * | { type: 'claim' } | { type: 'vote', yes }, or null when this seat has nothing to do right now.
 * The auction and the early-end vote have no single turn, so they are checked first.
 */
export function decide(view, rng = Math.random) {
  if (view.phase === 'bidding') return decideBid(view);
  if (view.phase === 'playing' && view.claim.open) return decideVote(view);
  if (view.turn !== view.seat) return null;
  if (view.phase === 'calling') return decideCall(view, rng);
  if (view.phase === 'playing') return view.claim.canStart ? { type: 'claim' } : decidePlay(view);
  return null;
}

/** Plays an auction through with bots only, seats acting in order from the opening seat. For tests and simulation. */
export function runAuction(round) {
  for (let laps = 0; round.phase === 'bidding' && laps < 50; laps++) {
    for (let i = 0; i < SEATS && round.phase === 'bidding'; i++) {
      const seat = (round.startSeat + i) % SEATS;
      const a = decide(round.view(seat));
      if (a?.type === 'bid') round.placeBid(seat, a.value);
      else if (a?.type === 'pass') round.pass(seat);
    }
  }
  if (round.phase === 'bidding') round.closeBidding();
}

// ---------------------------------------------------------------- bidding

/** The same hand always gets the same nudge, so a bot's limit holds steady while the auction runs. */
function handTemperament(hand) {
  let h = 7;
  for (const ch of [...hand].sort().join('')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 17) - 8;
}

/** Bid the minimum raise while it is within reach; pass once the price goes past what the hand is worth. */
function decideBid(v) {
  const { legal, canPass } = v.bidding;
  if (!legal.length) return canPass ? { type: 'pass' } : null;
  const hand = v.firstHand;
  const pts = sum(hand.map(pointsOf));
  const longest = Math.max(...SUITS.map((s) => hand.filter((c) => suitOf(c) === s).length));
  // Fitted on 6,000 simulated rounds: suit length and the A♠ predict the team's final points far
  // better than the points showing in the first four cards.
  const estimate = 134 + 0.24 * pts + 12.4 * longest + (hand.includes('AS') ? 12 : 0) + handTemperament(hand);
  const ceiling = Math.floor(estimate / 10) * 10;
  return legal[0] <= ceiling ? { type: 'bid', value: legal[0] } : { type: 'pass' };
}

/** The claim is only ever started when it is provably true, so a bot agrees. */
function decideVote(v) {
  return v.claim.open.votes[v.seat] === null ? { type: 'vote', yes: v.claim.possible } : null;
}

// ---------------------------------------------------------------- calling

function decideCall(v, rng) {
  const hand = v.firstHand;
  const strength = (s) => {
    const inSuit = hand.filter((c) => suitOf(c) === s);
    return inSuit.length * 100 + sum(inSuit.map(pointsOf)) + rng();
  };
  const cut = maxBy(SUITS, strength);
  const friends = [...v.callable]
    .map((c) => ({ c, score: pointsOf(c) + (suitOf(c) === cut ? 6 : 0) + rng() * 2 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.c);
  return { type: 'call', friends, cut };
}

// ---------------------------------------------------------------- playing

function beats(a, b, lead, cut) {
  const sa = suitOf(a);
  const sb = suitOf(b);
  if (sa === sb) return compareRank(a, b) > 0;
  if (sa === cut) return true;
  if (sb === cut) return false;
  return sa === lead;
}

function decidePlay(v) {
  const { legal, cut } = v;
  if (legal.length === 1) return { type: 'play', card: legal[0] };

  const played = new Set([
    ...v.tricks.flatMap((t) => t.plays.map((p) => p.card)),
    ...(v.trick ? v.trick.plays.map((p) => p.card) : []),
  ]);
  const mine = new Set(v.hand);
  const unseen = makeDeck().filter((c) => !played.has(c) && !mine.has(c));
  const isMaster = (card) => !unseen.some((u) => suitOf(u) === suitOf(card) && compareRank(u, card) > 0);
  const relation = relationFn(v, played);

  // How much we want to hold on to a card: points, then the cut suit, then rank.
  const keep = (c) => pointsOf(c) * 10 + (suitOf(c) === cut ? 40 : 0) + RANK_VALUE[rankOf(c)];
  const play = (card) => ({ type: 'play', card });

  const plays = v.trick.plays;
  if (plays.length === 0) return play(chooseLead(legal, cut, isMaster, keep));

  const lead = suitOf(plays[0].card);
  const winning = plays.reduce((best, p) => (beats(p.card, best.card, lead, cut) ? p : best));
  const trickPoints = sum(plays.map((p) => pointsOf(p.card)));
  const last = plays.length === 4;
  const allyWinning = relation(winning.seat) === 'ally';
  const canFollow = legal.every((c) => suitOf(c) === lead);

  if (canFollow) {
    if (allyWinning) {
      const safe = last || (suitOf(winning.card) === cut && isMaster(winning.card));
      return play(safe ? dumpPoints(legal, keep) : minBy(legal, keep));
    }
    const winners = legal.filter((c) => beats(c, winning.card, lead, cut));
    if (winners.length) {
      const cheapest = minBy(winners, (c) => RANK_VALUE[rankOf(c)]);
      const worthIt = trickPoints > 0 || last || pointsOf(cheapest) === 0;
      return play(worthIt ? cheapest : minBy(legal, keep));
    }
    return play(minBy(legal, keep));
  }

  // Void in the led suit: cut, support a partner, or throw the cheapest card.
  if (allyWinning) {
    const safe = last || (suitOf(winning.card) === cut && isMaster(winning.card));
    const offCut = legal.filter((c) => suitOf(c) !== cut);
    return play(safe && offCut.length ? dumpPoints(offCut, keep) : minBy(legal, keep));
  }
  const cuts = legal.filter((c) => suitOf(c) === cut);
  if (cuts.length && trickPoints > 0) {
    const winners = suitOf(winning.card) === cut
      ? cuts.filter((c) => compareRank(c, winning.card) > 0)
      : cuts;
    if (winners.length) return play(minBy(winners, (c) => RANK_VALUE[rankOf(c)]));
  }
  return play(minBy(legal, keep));
}

function dumpPoints(cards, keep) {
  const pointed = cards.filter((c) => pointsOf(c) > 0);
  return pointed.length ? maxBy(pointed, (c) => pointsOf(c) * 100 - RANK_VALUE[rankOf(c)]) : minBy(cards, keep);
}

function chooseLead(legal, cut, isMaster, keep) {
  const masters = legal.filter(isMaster);
  if (masters.length) {
    const offCut = masters.filter((c) => suitOf(c) !== cut);
    const pool = offCut.length ? offCut : masters;
    return maxBy(pool, (c) => pointsOf(c) * 100 + RANK_VALUE[rankOf(c)]);
  }
  const offCut = legal.filter((c) => suitOf(c) !== cut);
  return minBy(offCut.length ? offCut : legal, keep);
}

/** What this seat can honestly infer about another seat: 'ally' | 'foe' | 'unk'. */
function relationFn(v, played) {
  const me = v.seat;
  const revealed = new Set(v.revealed.map((r) => r.seat));
  const unaccounted = v.friendCards.filter((c) => !played.has(c) && !v.hand.includes(c));
  const iAmCaller = me === v.caller;
  const iAmFriend = !iAmCaller && v.holdsCalled.length > 0;
  return (seat) => {
    if (seat === me) return 'ally';
    if (iAmCaller) return revealed.has(seat) ? 'ally' : unaccounted.length === 0 ? 'foe' : 'unk';
    if (iAmFriend) {
      if (seat === v.caller || revealed.has(seat)) return 'ally';
      return unaccounted.length === 0 ? 'foe' : 'unk';
    }
    if (seat === v.caller || revealed.has(seat)) return 'foe';
    return unaccounted.length === 0 ? 'ally' : 'unk';
  };
}
