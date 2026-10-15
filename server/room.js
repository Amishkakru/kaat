// A table: five seats, a match, turn timers, bot autopilot and per-seat snapshots.
// The server is the only place the full deal exists; clients only ever get `round.view(seat)`.

import crypto from 'node:crypto';
import { Match, SEATS } from '../engine/round.js';
import { decide } from '../engine/bots.js';
import { DEFAULT_SCHEME, isScheme } from '../engine/scoring.js';

export const DEFAULT_SETTINGS = { rounds: 5, timers: true, scoring: DEFAULT_SCHEME };
export const ROUND_CHOICES = [1, 3, 5, 8];

const BOT_NAMES = ['Mira', 'Dev', 'Zoya', 'Kabir', 'Anaya', 'Rohan', 'Tara', 'Veer', 'Isha', 'Neel'];

// The auction clock: `auctionOpen` before the first bid, then `auctionBid` after every bid ("going once").
// `claim` is how long the table has to vote on ending a round early; it runs even with turn timers off.
export const REAL_TIMING = {
  botMin: 700,
  botMax: 1400,
  auctionBotMin: 1500,
  auctionBotMax: 3500,
  trickPause: 2300,
  limits: {
    auctionOpen: 25_000, auctionBid: 9_000, calling: 60_000, playing: 30_000, claim: 20_000,
  },
};
export const FAST_TIMING = {
  botMin: 5,
  botMax: 15,
  auctionBotMin: 5,
  auctionBotMax: 15,
  trickPause: 30,
  limits: {
    auctionOpen: 400, auctionBid: 250, calling: 600, playing: 500, claim: 300,
  },
};

const AWAY_AFTER = 2; // consecutive timeouts before a seat is put on autopilot
const clean = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 16);

export class Room {
  constructor(code, { timing = REAL_TIMING } = {}) {
    this.code = code;
    this.timing = timing;
    this.settings = { ...DEFAULT_SETTINGS };
    this.seats = Array.from({ length: SEATS }, () => ({ kind: 'empty' }));
    this.stage = 'lobby'; // lobby | round | between | over
    this.match = null;
    this.log = [];
    this.cursor = 0;
    this.pauseUntil = 0;
    this.showTrick = null;
    this.deadline = null;
    this.timers = [];
    this.auction = null; // { at, ms }: when the auction closes if nobody bids again
    this.claimAt = 0; // when the open early-end vote runs out
    this.version = 0;
    this.lastSeen = Date.now();
  }

  // ------------------------------------------------------------ seats

  isAuto(i) {
    const s = this.seats[i];
    return s.kind === 'bot' || (s.kind === 'human' && (!s.connected || s.afk >= AWAY_AFTER));
  }

  humansOnline() {
    return this.seats.some((s) => s.kind === 'human' && s.connected);
  }

  /** The first connected human runs the table. */
  hostSeat() {
    const online = this.seats.findIndex((s) => s.kind === 'human' && s.connected);
    if (online >= 0) return online;
    const any = this.seats.findIndex((s) => s.kind === 'human');
    return any >= 0 ? any : 0;
  }

  uniqueName(base, except = -1) {
    const taken = new Set(this.seats.map((s, i) => (i === except || s.kind === 'empty' ? null : s.name.toLowerCase())));
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    return name;
  }

  join(ws, { name, token } = {}) {
    this.lastSeen = Date.now();
    const known = token ? this.seats.findIndex((s) => s.kind === 'human' && s.token === token) : -1;
    if (known >= 0) {
      const seat = this.seats[known];
      if (!this.humansOnline()) this.rearmClocks(); // the table was held while everyone was away
      if (seat.ws && seat.ws !== ws) { try { seat.ws.close(4000, 'replaced'); } catch { /* already closed */ } }
      seat.ws = ws;
      seat.connected = true;
      seat.afk = 0;
      this.push({ type: 'back', seat: known });
      this.afterChange();
      return { seat: known, token: seat.token };
    }
    if (this.stage !== 'lobby') return { error: 'started', msg: 'This table has already started. Ask the host to begin a new match.' };
    let i = this.seats.findIndex((s) => s.kind === 'empty');
    if (i < 0) i = this.seats.findIndex((s) => s.kind === 'bot'); // a person takes a bot's chair
    if (i < 0) return { error: 'full', msg: 'All five seats are taken.' };
    const newToken = crypto.randomUUID();
    this.seats[i] = {
      kind: 'human',
      name: this.uniqueName(clean(name) || `Player ${i + 1}`, i),
      token: newToken, ws, connected: true, afk: 0,
    };
    this.afterChange();
    return { seat: i, token: newToken };
  }

  detach(ws) {
    const i = this.seats.findIndex((s) => s.kind === 'human' && s.ws === ws);
    if (i < 0) return;
    this.seats[i].ws = null;
    this.seats[i].connected = false;
    this.lastSeen = Date.now();
    if (this.stage !== 'lobby') this.push({ type: 'away', seat: i });
    this.afterChange();
  }

  // ----------------------------------------------------------- dispatch

  /** Handle a message from the human at `seat`. Returns an error string or null. */
  handle(seat, msg) {
    this.lastSeen = Date.now();
    const me = this.seats[seat];
    const host = seat === this.hostSeat();
    switch (msg.t) {
      case 'settings': {
        if (!host || this.stage !== 'lobby') return 'Only the host can change settings, before the match starts.';
        if (ROUND_CHOICES.includes(msg.rounds)) this.settings.rounds = msg.rounds;
        if (typeof msg.timers === 'boolean') this.settings.timers = msg.timers;
        if (isScheme(msg.scoring)) this.settings.scoring = msg.scoring;
        break;
      }
      case 'addBot': {
        if (!host || this.stage !== 'lobby') return 'Only the host can seat bots, before the match starts.';
        const i = Number.isInteger(msg.seat) ? msg.seat : this.seats.findIndex((s) => s.kind === 'empty');
        if (i < 0 || i >= SEATS || this.seats[i].kind !== 'empty') return 'That seat is not empty.';
        this.seatBot(i);
        break;
      }
      case 'removeSeat': {
        if (!host || this.stage !== 'lobby') return 'Only the host can free a seat, before the match starts.';
        const i = msg.seat;
        if (!Number.isInteger(i) || i < 0 || i >= SEATS || this.seats[i].kind === 'empty') return 'That seat is already empty.';
        if (i === seat) return 'You cannot remove yourself.';
        const s = this.seats[i];
        if (s.kind === 'human' && s.ws) { try { s.ws.close(4001, 'removed'); } catch { /* closed */ } }
        this.seats[i] = { kind: 'empty' };
        break;
      }
      case 'start': {
        if (!host) return 'Only the host can start the match.';
        if (this.stage !== 'lobby') return 'The match has already started.';
        if (!msg.fillBots && this.seats.some((s) => s.kind === 'empty')) return 'Fill every seat, or start with bots in the empty ones.';
        this.seats.forEach((s, i) => { if (s.kind === 'empty') this.seatBot(i); });
        this.match = new Match({ rounds: this.settings.rounds, scoring: this.settings.scoring });
        this.beginRound();
        break;
      }
      case 'next': {
        if (!host) return 'Only the host can continue.';
        if (this.stage !== 'between' || Date.now() < this.pauseUntil) return 'The round is not over yet.';
        if (this.match.finished) this.stage = 'over';
        else this.beginRound();
        break;
      }
      case 'rematch': {
        if (!host) return 'Only the host can reset the table.';
        if (this.stage !== 'over') return 'The match is not over.';
        this.match = null;
        this.log = [];
        this.stage = 'lobby';
        break;
      }
      case 'resume': {
        me.afk = 0;
        break;
      }
      case 'bid': case 'pass': case 'call': case 'play': case 'claim': case 'vote': {
        if (this.stage !== 'round') return 'There is no round in play.';
        if (msg.t === 'play' && Date.now() < this.pauseUntil) return 'The trick is still being cleared.';
        me.afk = 0;
        const res = this.apply(seat, msg);
        if (!res.ok) return res.error;
        return null;
      }
      default:
        return 'Unknown action.';
    }
    this.afterChange();
    return null;
  }

  seatBot(i) {
    const used = new Set(this.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${i + 1}`;
    this.seats[i] = { kind: 'bot', name };
  }

  beginRound() {
    this.match.startRound();
    this.stage = 'round';
    this.log = [];
    this.cursor = 0;
    this.showTrick = null;
    this.pauseUntil = 0;
    this.claimAt = 0;
    const { auctionOpen } = this.timing.limits;
    this.auction = { at: Date.now() + auctionOpen, ms: auctionOpen };
    this.pullEvents(); // a redeal is announced before anyone has acted
  }

  // -------------------------------------------------------------- engine

  apply(seat, action) {
    const round = this.match.round;
    const kind = action.t ?? action.type;
    let res;
    if (kind === 'bid') res = round.placeBid(seat, action.value);
    else if (kind === 'pass') res = round.pass(seat);
    else if (kind === 'call') res = round.callContract(seat, { friends: action.friends, cut: action.cut });
    else if (kind === 'claim') res = round.startClaim(seat);
    else if (kind === 'vote') res = round.vote(seat, action.yes === true);
    else res = round.play(seat, action.card);
    if (res.ok) this.afterEngine();
    return res;
  }

  push(event) {
    this.log.push({ id: this.log.length, ...event });
  }

  /** Copy the engine's new events into the table log and return them. */
  pullEvents() {
    const round = this.match.round;
    const fresh = round.events.slice(this.cursor);
    this.cursor = round.events.length;
    for (const e of fresh) this.push(e);
    return fresh;
  }

  afterEngine() {
    const round = this.match.round;
    const fresh = this.pullEvents();
    const now = Date.now();

    // Every bid restarts the short "going once" clock. A new vote gets its own countdown.
    if (fresh.some((e) => e.type === 'bid')) {
      const ms = this.timing.limits.auctionBid;
      this.auction = { at: now + ms, ms };
    }
    if (fresh.some((e) => e.type === 'claim')) this.claimAt = now + this.timing.limits.claim;

    if (fresh.some((e) => e.type === 'trick')) {
      const t = round.tricks.at(-1);
      this.pauseUntil = Date.now() + this.timing.trickPause;
      this.showTrick = { no: t.no, plays: t.plays, winner: t.winner, points: t.points };
    }
    if (round.phase === 'done') {
      this.match.settle();
      this.stage = 'between';
    }
    this.afterChange();
  }

  // ------------------------------------------------------ scheduling + io

  afterChange() {
    this.schedule();
    this.broadcast();
  }

  /** The auction and vote clocks are wall-clock deadlines, so give them their full time back after a pause. */
  rearmClocks() {
    const now = Date.now();
    if (this.auction) this.auction.at = now + this.auction.ms;
    if (this.match?.round?.claim) this.claimAt = now + this.timing.limits.claim;
  }

  after(ms, fn) {
    this.timers.push(setTimeout(fn, Math.max(0, ms)));
  }

  clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /** Set the timers for whatever happens next. Called after every change, so it starts from scratch each time. */
  schedule() {
    this.clearTimers();
    this.deadline = null;
    if (this.stage !== 'round' && this.stage !== 'between') return;
    if (!this.humansOnline()) return; // nobody is watching: hold the table
    const now = Date.now();
    if (now < this.pauseUntil) {
      this.after(this.pauseUntil - now + 5, () => this.endPause());
      return;
    }
    if (this.stage !== 'round') return;
    const round = this.match.round;
    if (round.phase === 'bidding') return this.scheduleAuction(round, now);
    if (round.claim) return this.scheduleClaim(round, now);

    const actor = round.currentActor();
    if (actor === null) return undefined;
    const { botMin, botMax, limits } = this.timing;
    if (this.isAuto(actor)) {
      this.after(botMin + Math.random() * (botMax - botMin), () => this.autopilot(actor, false));
    } else if (this.settings.timers) {
      const ms = limits[round.phase];
      this.deadline = { seat: actor, at: now + ms, ms };
      this.after(ms, () => this.autopilot(actor, true));
    }
    return undefined;
  }

  /** Open auction: every automatic seat that is still in thinks for a moment, and the clock runs down after each bid. */
  scheduleAuction(round, now) {
    const { auctionBotMin, auctionBotMax } = this.timing;
    if (this.settings.timers && this.auction) {
      this.deadline = { seat: null, kind: 'auction', at: this.auction.at, ms: this.auction.ms };
      this.after(this.auction.at - now, () => this.closeAuction());
    }
    for (let s = 0; s < SEATS; s++) {
      if (!this.isAuto(s) || !round.canPass(s)) continue; // passed out, or already holding the high bid
      this.after(auctionBotMin + Math.random() * (auctionBotMax - auctionBotMin), () => this.autopilot(s, false));
    }
  }

  /** Early-end vote: automatic seats answer quickly, and whoever has not voted by the deadline counts as no. */
  scheduleClaim(round, now) {
    const { botMin, botMax, limits } = this.timing;
    this.deadline = { seat: null, kind: 'claim', at: this.claimAt, ms: limits.claim };
    this.after(this.claimAt - now, () => this.closeClaim());
    for (let s = 0; s < SEATS; s++) {
      if (!this.isAuto(s) || round.claim.votes[s] !== null) continue;
      this.after(botMin + Math.random() * (botMax - botMin), () => this.autopilot(s, false));
    }
  }

  closeAuction() {
    if (this.stage !== 'round') return;
    const round = this.match.round;
    if (round.phase === 'bidding' && round.closeBidding().ok) this.afterEngine();
    else this.afterChange();
  }

  closeClaim() {
    if (this.stage !== 'round') return;
    const round = this.match.round;
    if (round.claim && round.closeClaim().ok) this.afterEngine();
    else this.afterChange();
  }

  endPause() {
    this.showTrick = null;
    this.afterChange();
  }

  autopilot(seat, timedOut) {
    if (this.stage !== 'round') return undefined;
    const round = this.match.round;
    const open = round.phase === 'bidding' || Boolean(round.claim); // no single seat has the turn
    if (!open && round.currentActor() !== seat) return this.afterChange();
    if (timedOut && !open) {
      const s = this.seats[seat];
      s.afk = (s.afk ?? 0) + 1;
      this.push({ type: 'timeout', seat });
      if (s.afk === AWAY_AFTER) this.push({ type: 'autopilot', seat });
    }
    let res = { ok: false, error: 'no decision' };
    try {
      const action = decide(round.view(seat));
      if (action) res = this.apply(seat, action);
      else if (open) return this.afterChange(); // nothing for this seat to do
    } catch (err) {
      console.error('autopilot error:', err);
    }
    if (!res.ok) {
      console.error(`autopilot fell back (${res.error})`);
      const move = this.safeMove(round, seat);
      if (move) this.apply(seat, move);
      else this.afterChange();
    }
    return undefined;
  }

  /** Last-resort legal move so a bug in a bot can never stall or crash a table. */
  safeMove(round, seat) {
    if (round.phase === 'bidding') return round.canPass(seat) ? { type: 'pass' } : null;
    if (round.claim) return round.claim.votes[seat] === null ? { type: 'vote', yes: false } : null;
    if (round.phase === 'calling') return { type: 'call', friends: round.callableCards().slice(0, 2), cut: 'S' };
    return { type: 'play', card: round.legalCards(seat)[0] };
  }

  snapshotFor(i) {
    const now = Date.now();
    const snap = {
      now,
      room: this.code,
      you: i,
      host: this.hostSeat(),
      settings: { ...this.settings },
      stage: this.stage,
      seats: this.seats.map((s, idx) => ({
        kind: s.kind,
        name: s.name ?? '',
        connected: s.kind === 'human' ? s.connected : s.kind === 'bot',
        auto: s.kind === 'empty' ? false : this.isAuto(idx),
      })),
      game: null,
    };
    if (this.match) {
      const m = this.match;
      snap.scores = [...m.scores];
      snap.history = m.history;
      snap.roundNo = m.roundNo;
      snap.rounds = m.rounds;
    }
    if (this.match?.round && this.stage !== 'lobby') {
      const v = this.match.round.view(i);
      const holding = this.stage === 'between' && now < this.pauseUntil;
      if (holding) { v.phase = 'playing'; v.result = null; v.turn = null; }
      snap.game = {
        ...v,
        showTrick: this.showTrick,
        deadline: this.deadline,
        log: this.log.slice(-120),
      };
    }
    return snap;
  }

  broadcast() {
    this.version += 1;
    this.seats.forEach((s, i) => {
      if (s.kind !== 'human' || !s.ws || s.ws.readyState !== 1) return;
      s.ws.send(JSON.stringify({ t: 'state', v: this.version, s: this.snapshotFor(i) }));
    });
  }

  dispose() {
    this.clearTimers();
  }
}
