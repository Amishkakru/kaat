import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDeck, pointsOf, TOTAL_POINTS, mulberry32, suitOf, sortHand,
} from '../engine/cards.js';
import { Round, Match, SEATS, MAX_BID } from '../engine/round.js';
import { decide } from '../engine/bots.js';

const rng = (seed) => mulberry32(seed);

/** Run a whole round with bots in every seat; returns the finished Round. */
function playOut(round, r = Math.random) {
  let guard = 0;
  while (round.phase !== 'done') {
    assert.ok(++guard < 200, 'round did not terminate');
    const seat = round.currentActor();
    const action = decide(round.view(seat), r);
    assert.ok(action, `bot returned nothing in phase ${round.phase}`);
    let res;
    if (action.type === 'bid') res = round.placeBid(seat, action.value);
    else if (action.type === 'pass') res = round.pass(seat);
    else if (action.type === 'call') res = round.callContract(seat, action);
    else res = round.play(seat, action.card);
    assert.ok(res.ok, `bot made an illegal ${action.type}: ${res.error}`);
  }
  return round;
}

/** Skip bidding: seat 0 is the caller at 170. */
function toCalling(round) {
  round.placeBid(round.startSeat, 170);
  for (let i = 0; i < 4; i++) round.pass(round.currentActor());
  return round;
}

test('deck: 40 cards, no 2-4, exactly 250 points', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 40);
  assert.equal(new Set(deck).size, 40);
  assert.ok(!deck.some((c) => /^[234][SHCD]$/.test(c)));
  assert.equal(deck.reduce((n, c) => n + pointsOf(c), 0), TOTAL_POINTS);
  assert.equal(pointsOf('QS'), 60);
  assert.equal(pointsOf('QH'), 10);
  assert.equal(pointsOf('AD'), 20);
  assert.equal(pointsOf('KC'), 15);
  assert.equal(pointsOf('JS'), 5);
  assert.equal(pointsOf('10S'), 0);
});

test('deal: four cards each first, eight each after the call, no card twice', () => {
  const r = new Round({ rng: rng(1) });
  assert.deepEqual(r.hands.map((h) => h.length), [4, 4, 4, 4, 4]);
  assert.equal(new Set(r.hands.flat()).size, 20);
  toCalling(r);
  const callable = r.callableCards();
  const res = r.callContract(r.caller, { friends: callable.slice(0, 2), cut: 'H' });
  assert.ok(res.ok, res.error);
  assert.deepEqual(r.hands.map((h) => h.length), [8, 8, 8, 8, 8]);
  assert.equal(new Set(r.hands.flat()).size, 40);
});

test('bidding: opens at 170, raises by 10, passed seats stay out', () => {
  const r = new Round({ startSeat: 0, rng: rng(2) });
  assert.deepEqual(r.legalBids(0)[0], 170);
  assert.equal(r.placeBid(1, 170).ok, false, 'wrong turn');
  assert.equal(r.placeBid(0, 160).ok, false, 'below minimum');
  assert.equal(r.placeBid(0, 175).ok, false, 'off-step');
  assert.ok(r.placeBid(0, 170).ok);
  assert.equal(r.legalBids(1)[0], 180);
  assert.equal(r.placeBid(1, 170).ok, false, 'must beat the high bid');
  assert.ok(r.pass(1).ok);
  assert.ok(r.placeBid(2, 200).ok);
  assert.ok(r.pass(3).ok);
  assert.ok(r.pass(4).ok);
  // Seat 0 is next (seat 1 passed and is skipped for good)
  assert.equal(r.bidding.turn, 0);
  assert.ok(r.pass(0).ok);
  assert.equal(r.phase, 'calling');
  assert.equal(r.caller, 2);
  assert.equal(r.bid, 200);
});

test('bidding: 250 closes immediately', () => {
  const r = new Round({ startSeat: 3, rng: rng(3) });
  assert.ok(r.placeBid(3, 200).ok);
  assert.ok(r.placeBid(4, MAX_BID).ok);
  assert.equal(r.phase, 'calling');
  assert.equal(r.caller, 4);
  assert.equal(r.bid, 250);
});

test('bidding: if everyone passes, the last seat is forced to take 170', () => {
  const r = new Round({ startSeat: 1, rng: rng(4) });
  for (let i = 0; i < 4; i++) assert.ok(r.pass(r.currentActor()).ok);
  assert.equal(r.phase, 'calling');
  assert.equal(r.caller, 0); // seats 1,2,3,4 passed; seat 0 is left
  assert.equal(r.bid, 170);
  assert.equal(r.events.at(-1).forced, true);
});

test('calling: A♠, own first-four cards, duplicates and bad input are rejected', () => {
  const r = toCalling(new Round({ startSeat: 0, rng: rng(5) }));
  const own = r.first[r.caller];
  const ok = r.callableCards();
  assert.ok(!ok.includes('AS'));
  assert.ok(own.every((c) => !ok.includes(c)));
  assert.equal(ok.length, 40 - new Set([...own, 'AS']).size, 'callable = deck minus A♠ minus your first four');
  assert.equal(r.callContract(1, { friends: [ok[0], ok[1]], cut: 'S' }).ok, false, 'only the caller');
  assert.equal(r.callContract(r.caller, { friends: ['AS', ok[0]], cut: 'S' }).ok, false, 'A♠');
  assert.equal(r.callContract(r.caller, { friends: [own[0], ok[0]], cut: 'S' }).ok, false, 'own card');
  assert.equal(r.callContract(r.caller, { friends: [ok[0], ok[0]], cut: 'S' }).ok, false, 'duplicate');
  assert.equal(r.callContract(r.caller, { friends: [ok[0]], cut: 'S' }).ok, false, 'one card');
  assert.equal(r.callContract(r.caller, { friends: [ok[0], ok[1]], cut: 'X' }).ok, false, 'bad suit');
  assert.equal(r.phase, 'calling');
  assert.ok(r.callContract(r.caller, { friends: [ok[0], ok[1]], cut: 'D' }).ok);
  assert.equal(r.phase, 'playing');
  assert.equal(r.trick.turn, r.caller, 'caller leads trick one');
});

test('follow suit is enforced; a void hand may play anything', () => {
  const r = new Round({ rng: rng(6) });
  Object.assign(r, { phase: 'playing', caller: 0, bid: 170, cut: 'H', friendCards: ['AD', 'KD'] });
  r.hands = [['5S', '6H'], ['7S', '8S'], ['9D', '10D'], ['JC', 'QC'], ['5C', '6C']];
  r.trick = { leader: 0, turn: 0, plays: [] };
  assert.ok(r.play(0, '5S').ok);
  assert.deepEqual(r.legalCards(1), ['7S', '8S']);
  assert.equal(r.play(1, '8S').ok, true);
  assert.deepEqual(r.legalCards(2).sort(), ['10D', '9D'], 'void in spades: free choice');
  assert.equal(r.play(2, '9D').ok, true);
});

test('trick winner: highest of led suit, any cut beats it, higher cut beats lower cut', () => {
  const r = new Round({ rng: rng(7) });
  r.cut = 'H';
  const T = (...pairs) => pairs.map(([seat, card]) => ({ seat, card }));
  assert.equal(r.trickWinner(T([0, '5S'], [1, 'AS'], [2, 'KS'], [3, 'AD'], [4, '9S'])), 1, 'highest spade; ace of another suit does nothing');
  assert.equal(r.trickWinner(T([0, 'AS'], [1, '5H'], [2, 'KS'], [3, 'QS'], [4, '9S'])), 1, 'a cut beats the ace');
  assert.equal(r.trickWinner(T([0, 'AS'], [1, '5H'], [2, '9H'], [3, 'QS'], [4, '9S'])), 2, 'higher cut wins');
  assert.equal(r.trickWinner(T([0, '6H'], [1, 'AH'], [2, 'KS'], [3, 'QS'], [4, '9S'])), 1, 'cut suit led');
  assert.equal(r.trickWinner(T([0, '6D'], [1, '5S'], [2, '7C'], [3, '5C'], [4, '5D'])), 0, 'lead suit with no cut');
});

test('a friend is exposed when their called card is played; the caller playing it exposes no one', () => {
  const r = new Round({ rng: rng(8) });
  Object.assign(r, { phase: 'playing', caller: 0, bid: 170, cut: 'H', friendCards: ['AD', 'KD'] });
  r.hands = [['KD', '5S'], ['AD', '6S'], ['9C', '7S'], ['JC', '8S'], ['5C', '9S']];
  r.friendSeats = [1];
  r.trick = { leader: 0, turn: 0, plays: [] };
  r.play(0, 'KD'); // the caller holds one called card himself
  assert.deepEqual(r.callerPlayed, ['KD']);
  assert.equal(r.revealed.length, 0);
  r.play(1, 'AD');
  assert.deepEqual(r.revealed, [{ seat: 1, cards: ['AD'] }]);
  assert.ok(r.events.some((e) => e.type === 'friend' && e.seat === 1 && e.card === 'AD'));
});

test('views never leak other hands, the second deal or the hidden friends', () => {
  const r = toCalling(new Round({ startSeat: 0, rng: rng(9) }));
  const caller = r.caller;
  const before = r.view(1);
  assert.equal(before.hand.length, 4);
  assert.equal(JSON.stringify(before).includes('friendSeats'), false);
  const c = r.callableCards();
  r.callContract(caller, { friends: [c[0], c[1]], cut: 'C' });
  for (let s = 0; s < SEATS; s++) {
    const v = r.view(s);
    assert.deepEqual(v.hand.sort(), [...r.hands[s]].sort());
    assert.equal(v.result, null);
    assert.ok(!('hands' in v) && !('second' in v) && !('friendSeats' in v));
    for (const card of v.holdsCalled) assert.ok(r.dealt[s].includes(card));
  }
  assert.deepEqual(r.view(caller).callable, [], 'callable list is for the calling phase only');
});

test('fuzz: 600 seeded all-bot rounds keep every invariant', () => {
  let forced = 0;
  const bids = new Map();
  for (let seed = 1; seed <= 600; seed++) {
    const r = new Round({ startSeat: seed % SEATS, rng: rng(seed) });
    playOut(r, rng(seed * 7919));
    assert.equal(r.tricks.length, 8);
    assert.equal(r.won.reduce((a, b) => a + b, 0), TOTAL_POINTS, `points lost in seed ${seed}`);
    const played = r.tricks.flatMap((t) => t.plays.map((p) => p.card));
    assert.equal(new Set(played).size, 40, `a card repeated in seed ${seed}`);
    assert.ok(r.tricks.every((t) => t.plays.length === 5));
    assert.ok(r.hands.every((h) => h.length === 0));
    // each trick's leader is the previous winner; the caller leads the first
    assert.equal(r.tricks[0].leader, r.caller);
    for (let i = 1; i < 8; i++) assert.equal(r.tricks[i].leader, r.tricks[i - 1].winner);
    // scoring
    const res = r.result;
    assert.equal(res.success, res.teamPoints >= res.bid);
    assert.equal(res.won.reduce((a, b) => a + b, 0), TOTAL_POINTS);
    assert.equal(res.deltas[res.caller], (res.success ? 2 : -2) * res.stake);
    // everybody who played a called card (other than the caller) was exposed
    for (const s of res.friendSeats) {
      const playedCalled = r.tricks.flatMap((t) => t.plays).some((p) => p.seat === s && r.friendCards.includes(p.card));
      assert.ok(playedCalled, 'a friend always plays their called card by the end');
      assert.ok(r.revealed.some((x) => x.seat === s));
    }
    if (r.events.find((e) => e.type === 'caller').forced) forced++;
    bids.set(r.bid, (bids.get(r.bid) ?? 0) + 1);
  }
  assert.ok(bids.size >= 3, 'bots should produce a spread of bids');
  assert.ok(forced < 300, 'forced 170s should not dominate');
});

test('match: scores accumulate, bidding opens one seat later each round', () => {
  const m = new Match({ rounds: 3, rng: rng(11) });
  const starts = [];
  let total = Array(SEATS).fill(0);
  for (let i = 0; i < 3; i++) {
    const r = m.startRound();
    starts.push(r.startSeat);
    playOut(r, rng(100 + i));
    assert.ok(m.settle());
    assert.equal(m.settle(), false, 'settle is idempotent');
    total = total.map((t, s) => t + r.result.deltas[s]);
  }
  assert.deepEqual(starts, [0, 1, 2]);
  assert.deepEqual(m.scores, total);
  assert.equal(m.history.length, 3);
  assert.equal(m.finished, true);
});

test('hand sorting groups by suit with the cut first', () => {
  const sorted = sortHand(['5S', 'AH', '9S', 'KH', '6C'], 'C');
  assert.deepEqual(sorted, ['6C', '9S', '5S', 'AH', 'KH']);
  assert.ok(sorted.every(Boolean) && suitOf(sorted[0]) === 'C');
});
