import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, FAST_TIMING } from '../server/room.js';

// Rooms are driven directly with stand-in sockets, so the vote plumbing can be tested from a known position.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, label, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await sleep(5);
  }
  throw new Error(`timed out waiting for ${label}`);
};
const fakeSocket = () => ({
  readyState: 1, sent: [], send(m) { this.sent.push(m); }, close() {},
});

/** A started table with `humans` people (the rest bots), parked mid-play: seat 1 called, seat 2 is the revealed friend. */
function parked(humans) {
  const room = new Room('TEST', { timing: FAST_TIMING });
  for (let i = 0; i < humans; i++) room.join(fakeSocket(), { name: `P${i}` });
  room.handle(0, { t: 'settings', rounds: 1, timers: false });
  assert.equal(room.handle(0, { t: 'start', fillBots: true }), null);
  room.clearTimers();
  const r = room.match.round;
  Object.assign(r, {
    phase: 'playing', caller: 1, bid: 200, cut: 'H', friendCards: ['AD', 'KD'], friendSeats: [2], won: [60, 20, 15, 100, 50],
  });
  r.hands = Array.from({ length: 5 }, () => ['5S', '6S']);
  r.tricks = [{
    no: 1, leader: 1, winner: 1, points: 35, plays: ['5C', 'KD', 'AD', '6C', '7C'].map((card, seat) => ({ seat, card })),
  }];
  r.trick = { leader: 3, turn: 3, plays: [] };
  room.stage = 'round';
  room.cursor = r.events.length;
  return { room, round: r };
}

test('room: bots vote yes on a claim and the round ends early with the scoreboard updated', async () => {
  const { room, round } = parked(1);
  assert.equal(room.handle(0, { t: 'claim' }), null);
  assert.ok(round.claim, 'the vote is open');
  assert.equal(room.deadline.kind, 'claim');
  await until(() => room.stage === 'between', 'the round to end early');
  assert.equal(round.result.early.by, 0);
  assert.ok(round.result.early.yes >= 3);
  assert.deepEqual(room.match.scores, round.result.deltas);
  assert.ok(room.log.some((e) => e.type === 'claim'));
  assert.ok(room.log.some((e) => e.type === 'claimResult' && e.passed));
  room.dispose();
});

test('room: a vote nobody answers runs out, counts as no, and play carries on', async () => {
  const { room, round } = parked(5);
  assert.equal(room.handle(0, { t: 'claim' }), null);
  assert.ok(round.claim);
  assert.match(room.handle(3, { t: 'play', card: '5S' }), /paused/);
  await until(() => round.claim === null, 'the vote to expire');
  assert.equal(round.phase, 'playing');
  assert.equal(room.stage, 'round');
  assert.equal(round.claimLog.at(-1).passed, false);
  assert.equal(room.handle(3, { t: 'play', card: '5S' }), null, 'play resumes');
  room.dispose();
});

test('room: three humans voting yes ends it without waiting for the clock', async () => {
  const { room, round } = parked(5);
  room.handle(0, { t: 'claim' });
  room.handle(3, { t: 'vote', yes: true });
  assert.equal(round.phase, 'playing');
  room.handle(4, { t: 'vote', yes: true });
  assert.equal(round.phase, 'done');
  assert.equal(room.stage, 'between');
  assert.match(room.handle(2, { t: 'vote', yes: false }), /no round in play/);
  room.dispose();
});

test('room: only the opposition can start a claim', () => {
  const { room } = parked(5);
  assert.match(room.handle(1, { t: 'claim' }), /Only the opponents/);
  assert.match(room.handle(2, { t: 'claim' }), /Only the opponents/);
  assert.equal(room.handle(4, { t: 'claim' }), null);
  room.dispose();
});

test('room: the auction clock restarts on every bid and closes the auction when it runs out', async () => {
  const room = new Room('CLOCK', { timing: FAST_TIMING });
  assert.equal(room.join(fakeSocket(), { name: 'Solo' }).seat, 0);
  room.handle(0, { t: 'settings', rounds: 1, timers: true });
  room.handle(0, { t: 'start', fillBots: true });
  assert.equal(room.auction.ms, FAST_TIMING.limits.auctionOpen);
  const opening = room.auction.at;
  assert.equal(room.handle(0, { t: 'bid', value: 170 }), null);
  assert.equal(room.auction.ms, FAST_TIMING.limits.auctionBid, 'a bid switches to the short clock');
  assert.ok(room.auction.at < opening, 'and the deadline moves');
  assert.equal(room.deadline.kind, 'auction');
  await until(() => room.match.round.phase !== 'bidding', 'the clock to close the auction');
  assert.ok(room.match.round.bid >= 170);
  room.dispose();
});

test('room: coming back to a held table gives the clocks their full time again', () => {
  const room = new Room('HELD', { timing: FAST_TIMING });
  const first = room.join(fakeSocket(), { name: 'Solo' });
  room.handle(0, { t: 'settings', rounds: 1, timers: true });
  room.handle(0, { t: 'start', fillBots: true });
  room.detach(room.seats[0].ws);
  room.auction.at = Date.now() - 10_000; // the deadline passed while everyone was away
  room.join(fakeSocket(), { name: 'Solo', token: first.token });
  assert.ok(room.auction.at > Date.now(), 'the auction was not closed behind their back');
  assert.equal(room.match.round.phase, 'bidding');
  room.dispose();
});
