// One round of Kaat: deal 4, bid at auction, call friends + cut, deal 4, eight tricks, score.
// Pure logic. Every mutating method returns { ok: true } or { ok: false, error }.

import {
  SUITS, TOTAL_POINTS, makeDeck, shuffle, suitOf, pointsOf, compareRank, sortHand, isCard, isFace, UNCALLABLE,
} from './cards.js';
import { scoreRound, isScheme, DEFAULT_SCHEME } from './scoring.js';

export const SEATS = 5;
export const DEAL_FIRST = 4;
export const HAND_SIZE = 8;
export const MIN_BID = 170;
export const MAX_BID = 250;
export const BID_STEP = 10;
export const CLAIM_VOTES = 3; // yes votes, out of five seats, that end a round early
const MAX_REDEALS = 30; // a safety stop; the chance of reaching it is about 1 in 10 billion

const fail = (error) => ({ ok: false, error });
const OK = Object.freeze({ ok: true });
const zeros = () => Array(SEATS).fill(0);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export class Round {
  constructor({ startSeat = 0, rng = Math.random, scoring = DEFAULT_SCHEME } = {}) {
    this.scoring = isScheme(scoring) ? scoring : DEFAULT_SCHEME;

    // Anyone dealt four cards with no ace, king, queen or jack makes the table deal again.
    this.redeals = []; // [{ seats }]: who held a hand without a face card, one entry per extra deal
    let deck;
    let first;
    for (let tries = 0; ; tries++) {
      deck = shuffle(makeDeck(), rng);
      first = Array.from({ length: SEATS }, (_, s) => deck.slice(s * DEAL_FIRST, (s + 1) * DEAL_FIRST));
      const empty = first.flatMap((h, s) => (h.some(isFace) ? [] : [s]));
      if (!empty.length || tries >= MAX_REDEALS) break;
      this.redeals.push({ seats: empty });
    }
    const secondFrom = SEATS * DEAL_FIRST;
    this.first = first;
    this.second = Array.from({ length: SEATS }, (_, s) => deck.slice(secondFrom + s * DEAL_FIRST, secondFrom + (s + 1) * DEAL_FIRST));
    this.hands = this.first.map((h) => [...h]);
    this.dealt = null; // full 8-card hands, set once the second deal happens

    this.phase = 'bidding'; // bidding -> calling -> playing -> done
    this.startSeat = startSeat; // only used to break the tie when nobody bids
    this.bidding = {
      high: null, // { seat, value, forced? }
      passed: Array(SEATS).fill(false),
      last: Array(SEATS).fill(null), // a number, 'pass' or null
    };

    this.caller = null;
    this.bid = null;
    this.cut = null;
    this.friendCards = [];
    this.friendSeats = []; // private until the round ends: non-caller seats holding a called card

    this.trick = null; // { leader, turn, plays: [{ seat, card }] }
    this.tricks = []; // completed: { no, leader, plays, winner, points }
    this.won = zeros(); // card points taken by each seat
    this.wonTricks = zeros();
    this.revealed = []; // public: [{ seat, cards }] friends exposed by playing a called card
    this.callerPlayed = []; // called cards the caller played from their own hand

    this.claim = null; // an open vote to end the round early: { by, votes: [true|false|null x5] }
    this.claimLog = []; // finished votes: { by, yes, no, passed, tricks }
    this.claimBlock = -1; // after a failed vote, no new claim until another trick has been played

    this.result = null;
    this.events = [];
    this.redeals.forEach((r, i) => this.emit({ type: 'redeal', seats: [...r.seats], count: i + 1 }));
  }

  emit(event) {
    this.events.push({ n: this.events.length, ...event });
  }

  /** Whose move it is. Bidding is an open auction, so nobody in particular has the turn. */
  currentActor() {
    if (this.phase === 'calling') return this.caller;
    if (this.phase === 'playing') return this.trick.turn;
    return null;
  }

  // ---------------------------------------------------------------- bidding

  #bidMin() {
    return this.bidding.high ? this.bidding.high.value + BID_STEP : MIN_BID;
  }

  /** Bids `seat` may make right now. Empty once they have passed or while they hold the high bid. */
  legalBids(seat) {
    if (this.phase !== 'bidding' || this.bidding.passed[seat] || this.bidding.high?.seat === seat) return [];
    const out = [];
    for (let v = this.#bidMin(); v <= MAX_BID; v += BID_STEP) out.push(v);
    return out;
  }

  canPass(seat) {
    return this.phase === 'bidding' && !this.bidding.passed[seat] && this.bidding.high?.seat !== seat;
  }

  /** Anyone may bid at any time. The first bid at a price stands; later bids must go higher. */
  placeBid(seat, value) {
    if (this.phase !== 'bidding') return fail('Bidding is closed.');
    if (this.bidding.passed[seat]) return fail('You have passed, so you are out of this auction.');
    if (this.bidding.high?.seat === seat) return fail('You already hold the high bid.');
    const legal = this.legalBids(seat);
    if (!legal.includes(value)) {
      if (this.bidding.high && Number.isInteger(value) && value <= this.bidding.high.value) {
        return fail(`${this.bidding.high.value} is already bid. Bid ${legal[0]} or more.`);
      }
      return fail(`Bid ${legal[0]} to ${MAX_BID} in steps of ${BID_STEP}.`);
    }
    this.bidding.high = { seat, value };
    this.bidding.last[seat] = value;
    this.emit({ type: 'bid', seat, value });
    if (value === MAX_BID) this.#award(seat, false); // nobody can outbid the ceiling
    return OK;
  }

  /** Leaving the auction is final. The high bidder cannot leave. */
  pass(seat) {
    if (this.phase !== 'bidding') return fail('Bidding is closed.');
    if (this.bidding.passed[seat]) return fail('You have already passed.');
    if (this.bidding.high?.seat === seat) return fail('You hold the high bid, so you cannot pass.');
    this.bidding.passed[seat] = true;
    this.bidding.last[seat] = 'pass';
    this.emit({ type: 'pass', seat });
    const active = [...Array(SEATS).keys()].filter((s) => !this.bidding.passed[s]);
    if (active.length === 1) this.#award(active[0], !this.bidding.high);
    return OK;
  }

  /**
   * End the auction now (the server calls this when the clock runs out). The high bidder wins.
   * With no bids at all, the last seat in order from the opening seat takes the call at 170.
   */
  closeBidding() {
    if (this.phase !== 'bidding') return fail('Bidding is closed.');
    if (this.bidding.high) return this.#award(this.bidding.high.seat, false);
    const order = Array.from({ length: SEATS }, (_, i) => (this.startSeat + i) % SEATS);
    const standing = order.filter((s) => !this.bidding.passed[s]);
    return this.#award(standing.at(-1), true);
  }

  #award(seat, forced) {
    if (forced) this.bidding.high = { seat, value: MIN_BID, forced: true };
    this.caller = this.bidding.high.seat;
    this.bid = this.bidding.high.value;
    this.phase = 'calling';
    this.emit({ type: 'caller', seat: this.caller, bid: this.bid, forced });
    return OK;
  }

  // ---------------------------------------------------------------- calling

  /** Cards the caller may name as friends: not the A♠, and not any of their own first four. */
  callableCards() {
    if (this.caller === null) return [];
    const own = new Set(this.first[this.caller]);
    return makeDeck().filter((c) => c !== UNCALLABLE && !own.has(c));
  }

  callContract(seat, { friends, cut } = {}) {
    if (this.phase !== 'calling') return fail('There is nothing to call right now.');
    if (seat !== this.caller) return fail('Only the caller names friends and the cut.');
    if (!Array.isArray(friends) || friends.length !== 2) return fail('Name exactly two friend cards.');
    if (!friends.every(isCard)) return fail('Unknown card.');
    if (friends[0] === friends[1]) return fail('The two friend cards must be different.');
    if (friends.includes(UNCALLABLE)) return fail('The ace of spades cannot be called.');
    const own = this.first[seat];
    if (friends.some((c) => own.includes(c))) return fail('You cannot call a card from your own first four.');
    if (!SUITS.includes(cut)) return fail('Pick a cut suit.');

    this.cut = cut;
    this.friendCards = [...friends];
    this.hands = this.first.map((h, s) => [...h, ...this.second[s]]);
    this.dealt = this.hands.map((h) => [...h]);
    this.friendSeats = [...Array(SEATS).keys()].filter(
      (s) => s !== this.caller && friends.some((c) => this.dealt[s].includes(c)),
    );
    this.phase = 'playing';
    this.trick = { leader: this.caller, turn: this.caller, plays: [] };
    this.emit({ type: 'contract', seat, bid: this.bid, cut, friends: [...friends] });
    return OK;
  }

  // ------------------------------------------------------------------- play

  legalCards(seat) {
    if (this.phase !== 'playing' || this.claim || this.trick.turn !== seat) return [];
    const hand = this.hands[seat];
    if (this.trick.plays.length === 0) return [...hand];
    const lead = suitOf(this.trick.plays[0].card);
    const follow = hand.filter((c) => suitOf(c) === lead);
    return follow.length ? follow : [...hand];
  }

  play(seat, card) {
    if (this.phase !== 'playing') return fail('No trick is in progress.');
    if (this.claim) return fail('Play is paused while the table votes on ending the round.');
    if (seat !== this.trick.turn) return fail('It is not your turn.');
    if (!this.hands[seat].includes(card)) return fail('That card is not in your hand.');
    if (!this.legalCards(seat).includes(card)) {
      return fail(`You must follow ${this.trick.plays[0] ? suitOf(this.trick.plays[0].card) : ''} if you can.`);
    }

    this.hands[seat] = this.hands[seat].filter((c) => c !== card);
    this.trick.plays.push({ seat, card });
    this.emit({ type: 'play', seat, card, trick: this.tricks.length + 1 });
    this.#noteCalledCard(seat, card);

    if (this.trick.plays.length === SEATS) this.#resolveTrick();
    else this.trick.turn = (seat + 1) % SEATS;
    return OK;
  }

  #noteCalledCard(seat, card) {
    if (!this.friendCards.includes(card)) return;
    if (seat === this.caller) {
      this.callerPlayed.push(card);
      this.emit({ type: 'callerCard', seat, card });
      return;
    }
    let entry = this.revealed.find((r) => r.seat === seat);
    if (!entry) {
      entry = { seat, cards: [] };
      this.revealed.push(entry);
    }
    entry.cards.push(card);
    this.emit({ type: 'friend', seat, card });
  }

  /** Highest cut card wins; with no cut card, the highest card of the suit that was led. */
  trickWinner(plays) {
    const lead = suitOf(plays[0].card);
    const cuts = plays.filter((p) => suitOf(p.card) === this.cut);
    const pool = cuts.length && lead !== this.cut ? cuts : plays.filter((p) => suitOf(p.card) === lead);
    return pool.reduce((best, p) => (compareRank(p.card, best.card) > 0 ? p : best)).seat;
  }

  #resolveTrick() {
    const plays = this.trick.plays;
    const winner = this.trickWinner(plays);
    const points = plays.reduce((total, p) => total + pointsOf(p.card), 0);
    this.won[winner] += points;
    this.wonTricks[winner] += 1;
    const done = { no: this.tricks.length + 1, leader: this.trick.leader, plays, winner, points };
    this.tricks.push(done);
    this.emit({ type: 'trick', no: done.no, winner, points });
    if (this.tricks.length === HAND_SIZE) this.#finish();
    else this.trick = { leader: winner, turn: winner, plays: [] };
  }

  // ------------------------------------------------------------ early finish

  teamSeats() {
    return [this.caller, ...this.friendSeats];
  }

  /** True once every called card has been played, which makes the whole caller side public. */
  friendsOut() {
    if (this.phase !== 'playing') return false;
    const played = new Set([...this.tricks, this.trick].flatMap((t) => t.plays.map((p) => p.card)));
    return this.friendCards.every((c) => played.has(c));
  }

  pointsLeft() {
    return TOTAL_POINTS - sum(this.won);
  }

  /** Public once the friends are out: the caller's side cannot reach its bid even if it takes every point left. */
  claimPossible() {
    if (!this.friendsOut()) return false;
    const taken = sum(this.teamSeats().map((s) => this.won[s]));
    return taken + this.pointsLeft() < this.bid;
  }

  /** Only the opposition can claim, and only when the claim is provably true. */
  canClaim(seat) {
    if (this.phase !== 'playing') return fail('There is no round in progress.');
    if (this.claim) return fail('A vote is already open.');
    if (!this.friendsOut()) return fail('You can claim the round once both friend cards have been played.');
    if (this.teamSeats().includes(seat)) return fail('Only the opponents can claim the round.');
    if (this.tricks.length <= this.claimBlock) return fail('Play another trick before claiming again.');
    if (!this.claimPossible()) return fail('The caller’s side can still reach its bid.');
    return OK;
  }

  startClaim(seat) {
    const ok = this.canClaim(seat);
    if (!ok.ok) return ok;
    this.claim = { by: seat, votes: Array(SEATS).fill(null) };
    this.claim.votes[seat] = true;
    this.emit({ type: 'claim', seat });
    return OK;
  }

  /** Every seat has one vote. Three yes votes end the round with the opposition winning. */
  vote(seat, yes) {
    if (!this.claim) return fail('There is no vote open.');
    if (this.claim.votes[seat] !== null) return fail('You have already voted.');
    this.claim.votes[seat] = Boolean(yes);
    this.emit({ type: 'vote', seat, yes: Boolean(yes) });
    this.#tally(false);
    return OK;
  }

  /** The server calls this when the voting time is up; anyone who has not voted counts as no. */
  closeClaim() {
    if (!this.claim) return fail('There is no vote open.');
    this.#tally(true);
    return OK;
  }

  #tally(expired) {
    const { by, votes } = this.claim;
    const yes = votes.filter((v) => v === true).length;
    const no = votes.filter((v) => v === false).length;
    const pending = SEATS - yes - no;
    if (yes >= CLAIM_VOTES) {
      this.#settleClaim(by, yes, no, true);
      this.#finish({ by, yes, no });
    } else if (expired || yes + pending < CLAIM_VOTES) {
      this.#settleClaim(by, yes, no, false);
    }
  }

  #settleClaim(by, yes, no, passed) {
    this.claimLog.push({ by, yes, no, passed, tricks: this.tricks.length });
    this.emit({ type: 'claimResult', by, yes, no, passed });
    this.claim = null;
    if (!passed) this.claimBlock = this.tricks.length;
  }

  #claimView(seat) {
    const open = this.claim
      ? {
        by: this.claim.by,
        votes: [...this.claim.votes],
        yes: this.claim.votes.filter((v) => v === true).length,
        no: this.claim.votes.filter((v) => v === false).length,
      }
      : null;
    return {
      possible: this.claimPossible(),
      canStart: this.phase === 'playing' && this.canClaim(seat).ok,
      open,
      need: CLAIM_VOTES,
      log: this.claimLog.map((c) => ({ ...c })),
    };
  }

  // ----------------------------------------------------------------- finish

  /** `early` is set when the opposition's claim carried a vote; unplayed points then count for the caller's side. */
  #finish(early = null) {
    const team = this.teamSeats();
    const taken = sum(team.map((s) => this.won[s]));
    const left = this.pointsLeft();
    const best = early ? taken + left : taken; // the most the caller's side could have reached
    const scored = scoreRound({
      scheme: this.scoring, seats: SEATS, bid: this.bid, caller: this.caller, friendSeats: this.friendSeats, teamPoints: best,
    });
    this.result = {
      caller: this.caller,
      bid: this.bid,
      cut: this.cut,
      friendCards: [...this.friendCards],
      friendSeats: [...this.friendSeats],
      teamSeats: team,
      teamPoints: taken,
      best,
      success: scored.success,
      scoring: scored.scheme,
      stake: scored.stake,
      margin: scored.margin,
      unit: scored.unit,
      deltas: scored.deltas,
      won: [...this.won],
      early: early ? { ...early, tricks: this.tricks.length, left } : null,
    };
    this.phase = 'done';
    this.trick = null;
    this.emit({
      type: 'end', success: scored.success, teamPoints: taken, bid: this.bid, early: Boolean(early),
    });
  }

  // ------------------------------------------------------------------- view

  /** Everything `seat` is allowed to know. This is the only thing sent to clients and bots. */
  view(seat) {
    const own = this.dealt ? this.dealt[seat] : this.first[seat];
    return {
      seat,
      phase: this.phase,
      startSeat: this.startSeat,
      scoring: this.scoring,
      redeals: this.redeals.map((r) => ({ seats: [...r.seats] })),
      hand: sortHand(this.hands[seat], this.cut),
      handCounts: this.hands.map((h) => h.length),
      firstHand: [...this.first[seat]],
      bidding: {
        high: this.bidding.high ? { ...this.bidding.high } : null,
        passed: [...this.bidding.passed],
        last: [...this.bidding.last],
        legal: this.legalBids(seat),
        canPass: this.canPass(seat),
      },
      caller: this.caller,
      bid: this.bid,
      cut: this.cut,
      friendCards: [...this.friendCards],
      holdsCalled: this.friendCards.filter((c) => own.includes(c)), // your own knowledge only
      callable: this.phase === 'calling' && seat === this.caller ? this.callableCards() : [],
      turn: this.currentActor(),
      legal: this.legalCards(seat),
      trick: this.trick ? { leader: this.trick.leader, turn: this.trick.turn, plays: this.trick.plays.map((p) => ({ ...p })) } : null,
      tricks: this.tricks.map((t) => ({ ...t, plays: t.plays.map((p) => ({ ...p })) })),
      won: [...this.won],
      wonTricks: [...this.wonTricks],
      revealed: this.revealed.map((r) => ({ seat: r.seat, cards: [...r.cards] })),
      callerPlayed: [...this.callerPlayed],
      claim: this.#claimView(seat),
      result: this.result ? { ...this.result } : null,
    };
  }
}

/** Several rounds with a running scoreboard. Bidding opens one seat later each round. */
export class Match {
  constructor({ rounds = 5, rng = Math.random, scoring = DEFAULT_SCHEME } = {}) {
    this.rounds = rounds;
    this.rng = rng;
    this.scoring = isScheme(scoring) ? scoring : DEFAULT_SCHEME;
    this.scores = zeros();
    this.history = [];
    this.roundNo = 0;
    this.round = null;
    this.settled = false;
  }

  startRound() {
    this.roundNo += 1;
    this.settled = false;
    this.round = new Round({ startSeat: (this.roundNo - 1) % SEATS, rng: this.rng, scoring: this.scoring });
    return this.round;
  }

  /** Add a finished round to the scoreboard. Safe to call repeatedly. */
  settle() {
    if (this.settled || !this.round || this.round.phase !== 'done') return false;
    const r = this.round.result;
    r.deltas.forEach((d, s) => { this.scores[s] += d; });
    this.history.push({
      round: this.roundNo, caller: r.caller, bid: r.bid, cut: r.cut,
      teamPoints: r.teamPoints, success: r.success, deltas: [...r.deltas], early: Boolean(r.early),
      redeals: this.round.redeals.length,
    });
    this.settled = true;
    return true;
  }

  get finished() {
    return this.round?.phase === 'done' && this.roundNo >= this.rounds;
  }
}
