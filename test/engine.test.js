import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDeck, pointsOf, TOTAL_POINTS, mulberry32, suitOf, sortHand, isFace,
} from '../engine/cards.js';
import {
  Round, Match, SEATS, MAX_BID, CLAIM_VOTES,
} from '../engine/round.js';
import { decide, runAuction } from '../engine/bots.js';
import { scoreRound, SCHEMES, DEFAULT_SCHEME } from '../engine/scoring.js';

const rng = (seed) => mulberry32(seed);

/** Run a whole round with bots in every seat; returns the finished Round. Bots claim and vote when they can. */
function playOut(round, r = Math.random) {
  runAuction(round);
  let guard = 0;
  while (round.phase !== 'done') {
    assert.ok(++guard < 200, 'round did not terminate');
    if (round.claim) {
      for (let s = 0; s < SEATS; s++) {
        const vote = decide(round.view(s), r);
        if (vote) assert.ok(round.vote(s, vote.yes).ok);
      }
      continue;
    }
    const seat = round.currentActor();
    const action = decide(round.view(seat), r);
    assert.ok(action, `bot returned nothing in phase ${round.phase}`);
    let res;
    if (action.type === 'call') res = round.callContract(seat, action);
    else if (action.type === 'claim') res = round.startClaim(seat);
    else res = round.play(seat, action.card);
    assert.ok(res.ok, `bot made an illegal ${action.type}: ${res.error}`);
  }
  return round;
}

/** Skip the auction: the opening seat is the caller at 170. */
function toCalling(round) {
  round.placeBid(round.startSeat, 170);
  for (let s = 0; s < SEATS; s++) if (s !== round.startSeat) round.pass(s);
  return round;
}

/** A round parked mid-play with a known position, for the early-end vote tests. Seat 0 called, seat 1 is the friend. */
function midPlay({ won, bid = 200 }) {
  const r = new Round({ rng: rng(21) });
  Object.assign(r, {
    phase: 'playing', caller: 0, bid, cut: 'H', friendCards: ['AD', 'KD'], friendSeats: [1], won,
  });
  r.hands = Array.from({ length: SEATS }, () => ['5S', '6S']);
  r.tricks = [{
    no: 1, leader: 0, winner: 0, points: 35, plays: ['KD', 'AD', '5C', '6C', '7C'].map((card, seat) => ({ seat, card })),
  }];
  r.trick = { leader: 0, turn: 0, plays: [] };
  return r;
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

test('auction: anyone can bid any time, and the first bid at a price stands', () => {
  const r = new Round({ startSeat: 0, rng: rng(2) });
  assert.deepEqual(r.legalBids(3).slice(0, 2), [170, 180], 'no turn order: seat 3 may open');
  assert.equal(r.placeBid(3, 160).ok, false, 'below minimum');
  assert.equal(r.placeBid(3, 175).ok, false, 'off-step');
  assert.ok(r.placeBid(3, 180).ok);
  const late = r.placeBid(1, 180);
  assert.equal(late.ok, false, 'a second bid at the same price is refused');
  assert.match(late.error, /180 is already bid/);
  assert.equal(r.placeBid(1, 170).ok, false, 'and so is a lower one');
  assert.deepEqual(r.legalBids(1)[0], 190);
  assert.ok(r.placeBid(1, 210).ok, 'jump bids are fine');
  assert.equal(r.bidding.high.seat, 1);
  assert.equal(r.bidding.high.value, 210);
  assert.equal(r.phase, 'bidding');
});

test('auction: you cannot outbid yourself, and passing is final', () => {
  const r = new Round({ startSeat: 0, rng: rng(2) });
  r.placeBid(2, 170);
  assert.equal(r.placeBid(2, 180).ok, false, 'already the high bidder');
  assert.equal(r.pass(2).ok, false, 'the high bidder cannot pass');
  assert.deepEqual(r.legalBids(2), []);
  assert.ok(r.pass(1).ok);
  assert.equal(r.pass(1).ok, false);
  assert.equal(r.placeBid(1, 190).ok, false, 'passed seats stay out');
  assert.deepEqual(r.view(1).bidding.legal, []);
  assert.equal(r.view(1).bidding.canPass, false);
  assert.equal(r.view(3).bidding.canPass, true);
  r.pass(3); r.pass(4);
  assert.equal(r.phase, 'bidding', 'seat 0 has not passed yet');
  assert.ok(r.pass(0).ok);
  assert.equal(r.phase, 'calling');
  assert.equal(r.caller, 2);
  assert.equal(r.bid, 170);
});

test('auction: the high bidder wins when the clock runs out, and 250 ends it at once', () => {
  const r = new Round({ startSeat: 0, rng: rng(3) });
  r.placeBid(1, 200);
  r.placeBid(4, 220);
  assert.ok(r.closeBidding().ok);
  assert.equal(r.caller, 4);
  assert.equal(r.bid, 220);
  assert.equal(r.closeBidding().ok, false, 'already closed');
  const q = new Round({ startSeat: 3, rng: rng(3) });
  q.placeBid(3, 200);
  assert.ok(q.placeBid(4, MAX_BID).ok);
  assert.equal(q.phase, 'calling');
  assert.equal(q.caller, 4);
  assert.equal(q.bid, 250);
});

test('auction: if nobody bids, the last seat standing takes 170', () => {
  const r = new Round({ startSeat: 1, rng: rng(4) });
  for (const s of [1, 2, 3, 4]) assert.ok(r.pass(s).ok);
  assert.equal(r.phase, 'calling');
  assert.equal(r.caller, 0);
  assert.equal(r.bid, 170);
  assert.equal(r.events.at(-1).forced, true);

  // The clock running out with no bid and no passes: the last seat in order from the opening seat.
  const q = new Round({ startSeat: 1, rng: rng(4) });
  q.pass(0);
  assert.ok(q.closeBidding().ok);
  assert.equal(q.caller, 4);
  assert.equal(q.events.at(-1).forced, true);
});

test('auction: bots settle on a winner from any opening seat', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = new Round({ startSeat: seed % SEATS, rng: rng(seed) });
    runAuction(r);
    assert.equal(r.phase, 'calling');
    assert.ok(r.bid >= 170 && r.bid <= MAX_BID && r.bid % 10 === 0);
  }
});

test('redeal: no hand is ever dealt without an ace, king, queen or jack', () => {
  let redealt = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const r = new Round({ rng: rng(seed) });
    for (const hand of r.first) assert.ok(hand.some(isFace), `seed ${seed} kept a hand with no face card`);
    assert.equal(r.events.filter((e) => e.type === 'redeal').length, r.redeals.length);
    if (r.redeals.length) {
      redealt++;
      assert.ok(r.redeals.every((d) => d.seats.length > 0), 'each redeal names who had nothing');
      assert.equal(r.view(0).redeals.length, r.redeals.length);
    }
  }
  assert.ok(redealt > 100 && redealt < 300, `about half of the deals need redoing, got ${redealt}/400`);
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
  let early = 0;
  const bids = new Map();
  for (let seed = 1; seed <= 600; seed++) {
    const scoring = Object.keys(SCHEMES)[seed % 3];
    const r = new Round({ startSeat: seed % SEATS, rng: rng(seed), scoring });
    playOut(r, rng(seed * 7919));
    const res = r.result;
    const played = r.tricks.flatMap((t) => t.plays.map((p) => p.card));
    assert.equal(new Set(played).size, played.length, `a card repeated in seed ${seed}`);
    assert.ok(r.tricks.every((t) => t.plays.length === 5));
    // each trick's leader is the previous winner; the caller leads the first
    assert.equal(r.tricks[0].leader, r.caller);
    for (let i = 1; i < r.tricks.length; i++) assert.equal(r.tricks[i].leader, r.tricks[i - 1].winner);
    if (res.early) {
      early++;
      assert.ok(res.early.yes >= CLAIM_VOTES, 'an early end needs three yes votes');
      assert.equal(res.success, false, 'only the opposition can claim, so the caller side loses');
      assert.ok(res.best < res.bid, 'even with every point left, the caller side falls short');
      assert.equal(res.best, res.teamPoints + res.early.left);
      assert.ok(r.tricks.length < 8);
    } else {
      assert.equal(r.tricks.length, 8);
      assert.equal(res.won.reduce((a, b) => a + b, 0), TOTAL_POINTS, `points lost in seed ${seed}`);
      assert.ok(r.hands.every((h) => h.length === 0));
      assert.equal(res.success, res.teamPoints >= res.bid);
    }
    // scoring: every scheme but classic is zero-sum, and the caller always carries the biggest share
    if (scoring !== 'classic') assert.equal(res.deltas.reduce((a, b) => a + b, 0), 0, `seed ${seed} (${scoring}) is not zero-sum`);
    const sign = res.success ? 1 : -1;
    assert.ok(res.deltas[res.caller] * sign > 0);
    assert.ok(res.deltas.every((d, s) => s === res.caller || Math.abs(d) <= Math.abs(res.deltas[res.caller])
      || res.teamSeats.length === 1));
    // everybody who played a called card (other than the caller) was exposed
    for (const s of res.friendSeats) {
      const playedCalled = r.tricks.flatMap((t) => t.plays).some((p) => p.seat === s && r.friendCards.includes(p.card));
      if (!res.early) assert.ok(playedCalled, 'a friend always plays their called card by the end');
      if (playedCalled) assert.ok(r.revealed.some((x) => x.seat === s));
    }
    if (r.events.find((e) => e.type === 'caller').forced) forced++;
    bids.set(r.bid, (bids.get(r.bid) ?? 0) + 1);
  }
  assert.ok(bids.size >= 3, 'bots should produce a spread of bids');
  assert.ok(forced < 300, 'forced 170s should not dominate');
  assert.ok(early > 0, 'bots do end some rounds early');
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

// ------------------------------------------------------------------ scoring

test('scoring: classic keeps the old stake rules', () => {
  const win = scoreRound({
    scheme: 'classic', bid: 200, caller: 0, friendSeats: [1], teamPoints: 220,
  });
  assert.equal(win.stake, 4);
  assert.deepEqual(win.deltas, [8, 4, -4, -4, -4]);
  const lose = scoreRound({
    scheme: 'classic', bid: 170, caller: 2, friendSeats: [], teamPoints: 100,
  });
  assert.deepEqual(lose.deltas, [1, 1, -2, 1, 1]);
});

test('scoring: head to head settles each opponent with each member of the caller side', () => {
  const win = scoreRound({
    scheme: 'pairwise', bid: 200, caller: 0, friendSeats: [1], teamPoints: 220,
  });
  assert.deepEqual(win.deltas, [24, 12, -12, -12, -12]);
  const twoFriends = scoreRound({
    scheme: 'pairwise', bid: 170, caller: 0, friendSeats: [1, 2], teamPoints: 100,
  });
  assert.deepEqual(twoFriends.deltas, [-4, -2, -2, 4, 4]);
  const solo = scoreRound({
    scheme: 'pairwise', bid: 200, caller: 0, friendSeats: [], teamPoints: 140,
  });
  assert.deepEqual(solo.deltas, [-32, 8, 8, 8, 8], 'a caller who plays alone risks more');
});

test('scoring: margin raises the stake by 1 per 20 points past or short of the bid, capped at 3', () => {
  const at = (teamPoints) => scoreRound({
    scheme: 'margin', bid: 200, caller: 0, friendSeats: [1], teamPoints,
  });
  assert.equal(at(200).margin, 0);
  assert.equal(at(219).margin, 0);
  assert.equal(at(220).margin, 1);
  assert.equal(at(250).margin, 2);
  assert.equal(at(140).margin, 3, 'short by 60');
  assert.equal(at(0).margin, 3, 'capped');
  assert.deepEqual(at(220).deltas, [30, 15, -15, -15, -15]);
});

test('scoring: every zero-sum scheme balances for every bid, team shape and result', () => {
  for (const scheme of ['pairwise', 'margin']) {
    for (let bid = 170; bid <= 250; bid += 10) {
      for (const friendSeats of [[], [3], [3, 4]]) {
        for (const teamPoints of [0, 90, bid - 10, bid, bid + 10, 250]) {
          const { deltas } = scoreRound({
            scheme, bid, caller: 1, friendSeats, teamPoints,
          });
          assert.equal(deltas.reduce((a, b) => a + b, 0), 0);
        }
      }
    }
  }
  assert.ok(SCHEMES[DEFAULT_SCHEME]);
});

test('scoring: an unknown scheme falls back to the default, and the match applies its scheme', () => {
  assert.equal(new Round({ rng: rng(1), scoring: 'nonsense' }).scoring, DEFAULT_SCHEME);
  const m = new Match({ rounds: 1, rng: rng(31), scoring: 'classic' });
  const r = playOut(m.startRound(), rng(32));
  assert.equal(r.result.scoring, 'classic');
  m.settle();
  assert.deepEqual(m.scores, r.result.deltas);
});

// ------------------------------------------------------------- early finish

test('claim: only the opposition, only once the friends are out, only when the bid is out of reach', () => {
  const lost = midPlay({ won: [20, 15, 100, 60, 50] }); // team has 35 and only 5 points are left in play: 40 < 200
  assert.equal(lost.view(2).claim.possible, true);
  assert.equal(lost.view(2).claim.canStart, true);
  assert.equal(lost.view(0).claim.canStart, false, 'the caller cannot claim');
  assert.equal(lost.view(1).claim.canStart, false, 'neither can the revealed friend');
  assert.match(lost.startClaim(1).error, /Only the opponents/);

  const live = midPlay({ won: [100, 50, 20, 20, 10] }); // 150 + 50 left = 200: still reachable
  assert.equal(live.view(2).claim.possible, false);
  assert.match(live.startClaim(2).error, /can still reach/);

  const hidden = midPlay({ won: [20, 15, 100, 60, 50] });
  hidden.tricks[0].plays = hidden.tricks[0].plays.filter((p) => p.card !== 'AD'); // the second friend card is still unplayed
  assert.equal(hidden.view(2).claim.possible, false, 'nothing is offered before the friends are out');
  assert.match(hidden.startClaim(2).error, /both friend cards/);
});

test('claim: three yes votes end the round, scored as a loss for the caller side', () => {
  const r = midPlay({ won: [20, 15, 100, 60, 50] });
  assert.ok(r.startClaim(2).ok);
  assert.equal(r.claim.votes[2], true, 'the claimer votes yes');
  assert.match(r.play(0, '5S').error, /paused/);
  assert.deepEqual(r.legalCards(0), []);
  assert.equal(r.startClaim(3).ok, false, 'one vote at a time');
  assert.ok(r.vote(3, true).ok);
  assert.equal(r.vote(3, false).ok, false, 'one vote each');
  assert.equal(r.phase, 'playing', 'two yes votes are not enough');
  assert.ok(r.vote(0, true).ok); // the caller agrees it is lost
  assert.equal(r.phase, 'done');
  const res = r.result;
  assert.equal(res.success, false);
  assert.equal(res.teamPoints, 35);
  assert.equal(res.best, 40, 'the caller side is credited with every point still in play');
  assert.equal(res.early.by, 2);
  assert.equal(res.early.yes, 3);
  assert.equal(res.early.left, 5);
  assert.equal(res.deltas.reduce((a, b) => a + b, 0), 0);
  assert.ok(res.deltas[0] < 0 && res.deltas[2] > 0);
  assert.ok(r.events.some((e) => e.type === 'claimResult' && e.passed));
});

test('claim: it fails on three no votes, on a timeout, or when yes can no longer reach three', () => {
  const r = midPlay({ won: [20, 15, 100, 60, 50] });
  r.startClaim(2);
  r.vote(0, false);
  assert.ok(r.claim, 'still open: yes could reach three');
  r.vote(1, false);
  assert.ok(r.claim, 'one seat has not voted yet, so yes could still reach three');
  r.vote(3, false);
  assert.equal(r.claim, null, 'two yes at most can remain, so it fails now');
  assert.equal(r.phase, 'playing');
  assert.equal(r.claimLog.at(-1).passed, false);
  assert.match(r.startClaim(4).error, /another trick/, 'no re-claiming within the same trick count');
  assert.ok(r.play(0, '5S').ok, 'play resumes');
  r.tricks.push({ no: 2, leader: 0, winner: 2, points: 0, plays: [] }); // a trick later
  assert.ok(r.canClaim(4).ok);

  const t = midPlay({ won: [20, 15, 100, 60, 50] });
  t.startClaim(2);
  t.vote(3, true);
  assert.ok(t.closeClaim().ok, 'the vote runs out with two yes and three silent');
  assert.equal(t.phase, 'playing');
  assert.equal(t.claim, null);
});

test('claim: views expose the vote to everyone and leak nothing before the friends are out', () => {
  const r = midPlay({ won: [20, 15, 100, 60, 50] });
  r.startClaim(4);
  r.vote(1, false);
  for (let s = 0; s < SEATS; s++) {
    const c = r.view(s).claim;
    assert.equal(c.open.by, 4);
    assert.deepEqual(c.open.votes, [null, false, null, null, true]);
    assert.equal(c.need, 3);
    assert.equal(c.canStart, false);
  }
  const fresh = new Round({ rng: rng(40) });
  toCalling(fresh);
  assert.deepEqual(fresh.view(2).claim, {
    possible: false, canStart: false, open: null, need: 3, log: [],
  });
});

test('bots vote yes on a true claim and start one when they are on the opposing side', () => {
  const r = midPlay({ won: [20, 15, 100, 60, 50] });
  r.trick.turn = 2;
  assert.deepEqual(decide(r.view(2)), { type: 'claim' }, 'the opponent whose turn it is claims');
  assert.equal(decide(r.view(0)), null, 'the caller has no turn and nothing to do');
  r.trick.turn = 3;
  assert.equal(decide(r.view(3)).type, 'claim');
  r.startClaim(2);
  assert.deepEqual(decide(r.view(3)), { type: 'vote', yes: true });
  assert.equal(decide(r.view(2)), null, 'the claimer has already voted');
});
