// One round of Kaat: deal 4, bid, call friends + cut, deal 4, eight tricks, score.
// Pure logic. Every mutating method returns { ok: true } or { ok: false, error }.

import {
  SUITS, makeDeck, shuffle, suitOf, pointsOf, compareRank, sortHand, isCard, UNCALLABLE,
} from './cards.js';

export const SEATS = 5;
export const DEAL_FIRST = 4;
export const HAND_SIZE = 8;
export const MIN_BID = 170;
export const MAX_BID = 250;
export const BID_STEP = 10;

const fail = (error) => ({ ok: false, error });
const OK = Object.freeze({ ok: true });
const zeros = () => Array(SEATS).fill(0);

export class Round {
  constructor({ startSeat = 0, rng = Math.random } = {}) {
    const deck = shuffle(makeDeck(), rng);
    const slice = (from, s) => deck.slice(from + s * DEAL_FIRST, from + (s + 1) * DEAL_FIRST);
    this.first = Array.from({ length: SEATS }, (_, s) => slice(0, s));
    this.second = Array.from({ length: SEATS }, (_, s) => slice(SEATS * DEAL_FIRST, s));
    this.hands = this.first.map((h) => [...h]);
    this.dealt = null; // full 8-card hands, set once the second deal happens

    this.phase = 'bidding'; // bidding -> calling -> playing -> done
    this.startSeat = startSeat;
    this.bidding = {
      turn: startSeat,
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

    this.result = null;
    this.events = [];
  }

  emit(event) {
    this.events.push({ n: this.events.length, ...event });
  }

  currentActor() {
    if (this.phase === 'bidding') return this.bidding.turn;
    if (this.phase === 'calling') return this.caller;
    if (this.phase === 'playing') return this.trick.turn;
    return null;
  }

  // ---------------------------------------------------------------- bidding

  legalBids(seat) {
    if (this.phase !== 'bidding' || this.bidding.turn !== seat) return [];
    const min = this.bidding.high ? this.bidding.high.value + BID_STEP : MIN_BID;
    const out = [];
    for (let v = min; v <= MAX_BID; v += BID_STEP) out.push(v);
    return out;
  }

  placeBid(seat, value) {
    if (this.phase !== 'bidding') return fail('Bidding is closed.');
    if (seat !== this.bidding.turn) return fail('It is not your turn to bid.');
    if (!this.legalBids(seat).includes(value)) {
      const legal = this.legalBids(seat);
      return fail(`Bid ${legal[0]} to ${MAX_BID} in steps of ${BID_STEP}.`);
    }
    this.bidding.high = { seat, value };
    this.bidding.last[seat] = value;
    this.emit({ type: 'bid', seat, value });
    if (value === MAX_BID) {
      this.#closeBidding(seat); // nobody can outbid the ceiling
    } else {
      this.bidding.turn = this.#nextActive(seat);
    }
    return OK;
  }

  pass(seat) {
    if (this.phase !== 'bidding') return fail('Bidding is closed.');
    if (seat !== this.bidding.turn) return fail('It is not your turn to bid.');
    this.bidding.passed[seat] = true;
    this.bidding.last[seat] = 'pass';
    this.emit({ type: 'pass', seat });
    const active = [...Array(SEATS).keys()].filter((s) => !this.bidding.passed[s]);
    if (active.length === 1) this.#closeBidding(active[0]);
    else this.bidding.turn = this.#nextActive(seat);
    return OK;
  }

  #nextActive(from) {
    for (let i = 1; i <= SEATS; i++) {
      const s = (from + i) % SEATS;
      if (!this.bidding.passed[s]) return s;
    }
    return from;
  }

  #closeBidding(seat) {
    let forced = false;
    if (!this.bidding.high) {
      // Everyone else passed without a bid: the last seat standing takes the minimum.
      this.bidding.high = { seat, value: MIN_BID, forced: true };
      forced = true;
    }
    this.caller = this.bidding.high.seat;
    this.bid = this.bidding.high.value;
    this.phase = 'calling';
    this.emit({ type: 'caller', seat: this.caller, bid: this.bid, forced });
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
    if (this.phase !== 'playing' || this.trick.turn !== seat) return [];
    const hand = this.hands[seat];
    if (this.trick.plays.length === 0) return [...hand];
    const lead = suitOf(this.trick.plays[0].card);
    const follow = hand.filter((c) => suitOf(c) === lead);
    return follow.length ? follow : [...hand];
  }

  play(seat, card) {
    if (this.phase !== 'playing') return fail('No trick is in progress.');
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
    const points = plays.reduce((sum, p) => sum + pointsOf(p.card), 0);
    this.won[winner] += points;
    this.wonTricks[winner] += 1;
    const done = { no: this.tricks.length + 1, leader: this.trick.leader, plays, winner, points };
    this.tricks.push(done);
    this.emit({ type: 'trick', no: done.no, winner, points });
    if (this.tricks.length === HAND_SIZE) this.#finish();
    else this.trick = { leader: winner, turn: winner, plays: [] };
  }

  #finish() {
    const team = [this.caller, ...this.friendSeats];
    const teamPoints = team.reduce((sum, s) => sum + this.won[s], 0);
    const success = teamPoints >= this.bid;
    const stake = (this.bid - 160) / BID_STEP; // 170 -> 1 ... 250 -> 9
    const deltas = [...Array(SEATS).keys()].map((s) => {
      const onTeam = team.includes(s);
      const wins = onTeam ? success : !success;
      const weight = s === this.caller ? 2 : 1;
      return (wins ? 1 : -1) * weight * stake;
    });
    this.result = {
      caller: this.caller,
      bid: this.bid,
      cut: this.cut,
      friendCards: [...this.friendCards],
      friendSeats: [...this.friendSeats],
      teamSeats: team,
      teamPoints,
      success,
      stake,
      deltas,
      won: [...this.won],
    };
    this.phase = 'done';
    this.trick = null;
    this.emit({ type: 'end', success, teamPoints, bid: this.bid });
  }

  // ------------------------------------------------------------------- view

  /** Everything `seat` is allowed to know. This is the only thing sent to clients and bots. */
  view(seat) {
    const own = this.dealt ? this.dealt[seat] : this.first[seat];
    return {
      seat,
      phase: this.phase,
      startSeat: this.startSeat,
      hand: sortHand(this.hands[seat], this.cut),
      handCounts: this.hands.map((h) => h.length),
      firstHand: [...this.first[seat]],
      bidding: {
        turn: this.bidding.turn,
        high: this.bidding.high ? { ...this.bidding.high } : null,
        passed: [...this.bidding.passed],
        last: [...this.bidding.last],
        legal: this.legalBids(seat),
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
      result: this.result ? { ...this.result } : null,
    };
  }
}

/** Several rounds with a running scoreboard. Bidding opens one seat later each round. */
export class Match {
  constructor({ rounds = 5, rng = Math.random } = {}) {
    this.rounds = rounds;
    this.rng = rng;
    this.scores = zeros();
    this.history = [];
    this.roundNo = 0;
    this.round = null;
    this.settled = false;
  }

  startRound() {
    this.roundNo += 1;
    this.settled = false;
    this.round = new Round({ startSeat: (this.roundNo - 1) % SEATS, rng: this.rng });
    return this.round;
  }

  /** Add a finished round to the scoreboard. Safe to call repeatedly. */
  settle() {
    if (this.settled || !this.round || this.round.phase !== 'done') return false;
    const r = this.round.result;
    r.deltas.forEach((d, s) => { this.scores[s] += d; });
    this.history.push({
      round: this.roundNo, caller: r.caller, bid: r.bid, cut: r.cut,
      teamPoints: r.teamPoints, success: r.success, deltas: [...r.deltas],
    });
    this.settled = true;
    return true;
  }

  get finished() {
    return this.round?.phase === 'done' && this.roundNo >= this.rounds;
  }
}
