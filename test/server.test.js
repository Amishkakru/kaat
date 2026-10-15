import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createKaatServer } from '../server/index.js';
import { decide } from '../engine/bots.js';

const TIMEOUT = 15_000;

async function boot() {
  const app = createKaatServer({ port: 0, host: '127.0.0.1', fast: true });
  const port = await app.listen();
  return { app, url: `ws://127.0.0.1:${port}` };
}

/** A tiny protocol client. With `brain: true` it plays its own seat using the bot logic. */
function client(url, { brain = false } = {}) {
  const ws = new WebSocket(url);
  const c = {
    ws, state: null, joined: null, errors: [], states: [], waiters: [],
    brain,
    send: (m) => ws.send(JSON.stringify(m)),
    open: new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }),
    close: () => ws.close(),
    until(pred, label = 'condition') {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), TIMEOUT);
        const check = () => {
          if (c.state && pred(c.state)) { clearTimeout(t); c.waiters = c.waiters.filter((w) => w !== check); resolve(c.state); }
        };
        c.waiters.push(check);
        check();
      });
    },
  };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') c.joined = m;
    if (m.t === 'error') c.errors.push(m);
    if (m.t === 'state') {
      c.state = m.s;
      c.version = m.v;
      c.states.push(m.s);
      if (c.brain) c.think();
      [...c.waiters].forEach((w) => w());
    }
  });
  c.think = () => {
    const g = c.state.game;
    if (!g || c.state.stage !== 'round' || g.showTrick) return;
    const a = decide(g);
    if (!a) return;
    const key = `${c.version}:${a.type}:${a.value ?? a.card ?? a.yes ?? ''}`;
    if (key === c.lastSent) return; // one answer per state is enough
    c.lastSent = key;
    if (a.type === 'bid') c.send({ t: 'bid', value: a.value });
    else if (a.type === 'pass') c.send({ t: 'pass' });
    else if (a.type === 'call') c.send({ t: 'call', friends: a.friends, cut: a.cut });
    else if (a.type === 'claim') c.send({ t: 'claim' });
    else if (a.type === 'vote') c.send({ t: 'vote', yes: a.yes });
    else c.send({ t: 'play', card: a.card });
  };
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('five humans play a full round over WebSockets', async () => {
  const { app, url } = await boot();
  try {
    const host = client(url, { brain: true });
    await host.open;
    host.send({ t: 'create', name: 'Abhinav' });
    await host.until((s) => s.stage === 'lobby', 'lobby');
    const code = host.joined.room;
    assert.match(code, /^[A-Z]{4}$/);

    const others = [];
    for (const name of ['Amish', 'Roshan', 'Shubham', 'Vivek']) {
      const c = client(url, { brain: true });
      await c.open;
      c.send({ t: 'join', room: code, name });
      await c.until((s) => s.stage === 'lobby', 'lobby');
      others.push(c);
    }
    const all = [host, ...others];
    assert.deepEqual(all.map((c) => c.joined.seat), [0, 1, 2, 3, 4]);

    host.send({ t: 'settings', rounds: 1, timers: false });
    others[0].send({ t: 'start' });
    await sleep(30);
    assert.match(others[0].errors.at(-1).msg, /host/i, 'only the host may start');

    host.send({ t: 'start' });
    await Promise.all(all.map((c) => c.until((s) => s.stage === 'between' && s.game?.phase === 'done', 'round end')));

    // Everyone sees the same result, and the scoreboard matches it.
    const results = all.map((c) => c.state.game.result);
    for (const r of results) assert.deepEqual(r, results[0]);
    const r = results[0];
    assert.equal(r.won.reduce((a, b) => a + b, 0), 250 - (r.early?.left ?? 0), 'every point is accounted for, bar those left in play after an early end');
    assert.deepEqual(host.state.scores, r.deltas);

    // Nobody was ever sent another seat's cards.
    for (const c of all) {
      const seat = c.state.you;
      for (const s of c.states) {
        if (!s.game) continue;
        assert.ok(s.game.hand.length <= 8);
        assert.ok(!('friendSeats' in s.game) || s.game.phase === 'done' || s.game.result === null);
        assert.equal(JSON.stringify(s).includes('"second"'), false);
        assert.equal(s.game.seat, seat);
      }
      // the friends were not exposed before the round ended unless their called card was played
      const mid = c.states.filter((s) => s.game && s.game.phase === 'playing' && s.game.tricks.length === 0);
      for (const s of mid) assert.equal(s.game.result, null);
    }

    // Host moves on; with one round the match is over.
    host.send({ t: 'next' });
    await host.until((s) => s.stage === 'over', 'match over');
    host.send({ t: 'rematch' });
    await host.until((s) => s.stage === 'lobby', 'back to lobby');
    all.forEach((c) => c.close());
  } finally {
    await app.close();
  }
});

test('one human plus bots: start fills the empty seats and the round finishes', async () => {
  const { app, url } = await boot();
  try {
    const me = client(url, { brain: true });
    await me.open;
    me.send({ t: 'create', name: 'Solo' });
    await me.until((s) => s.stage === 'lobby');
    me.send({ t: 'settings', rounds: 3, timers: true });
    me.send({ t: 'start' }); // seats are empty, no fillBots flag
    await sleep(30);
    assert.match(me.errors.at(-1).msg, /Fill every seat/);
    me.send({ t: 'start', fillBots: true });
    await me.until((s) => s.stage === 'round', 'round start');
    assert.equal(me.state.seats.filter((s) => s.kind === 'bot').length, 4);
    await me.until((s) => s.stage === 'between' && s.game.phase === 'done', 'round end');
    me.send({ t: 'next' });
    await me.until((s) => s.stage === 'round' && s.roundNo === 2, 'round two');
    assert.equal(me.state.game.startSeat, 1, 'bidding opens one seat later');
    me.close();
  } finally {
    await app.close();
  }
});

test('rejects illegal moves, unknown rooms, a sixth player and late joiners', async () => {
  const { app, url } = await boot();
  try {
    const host = client(url);
    await host.open;
    host.send({ t: 'join', room: 'ZZZZ', name: 'x' });
    await sleep(60);
    assert.equal(host.errors.at(-1).code, 'noroom');

    host.send({ t: 'create', name: 'Host' });
    await host.until((s) => s.stage === 'lobby');
    const code = host.joined.room;
    const guests = [];
    for (let i = 0; i < 4; i++) {
      const c = client(url);
      await c.open;
      c.send({ t: 'join', room: code, name: `G${i}` });
      await c.until((s) => s.stage === 'lobby');
      guests.push(c);
    }
    const sixth = client(url);
    await sixth.open;
    sixth.send({ t: 'join', room: code, name: 'Late' });
    await sleep(40);
    assert.equal(sixth.errors.at(-1).code, 'full');

    host.send({ t: 'settings', rounds: 1, timers: false });
    host.send({ t: 'start' });
    await host.until((s) => s.stage === 'round');

    // After the start, a stranger cannot take a seat.
    const stranger = client(url);
    await stranger.open;
    stranger.send({ t: 'join', room: code, name: 'Stranger' });
    await sleep(40);
    assert.equal(stranger.errors.at(-1).code, 'started');

    // Bad bids, a play during the auction, and a bid after passing.
    const guest = guests[0];
    guest.send({ t: 'bid', value: 175 });
    await sleep(40);
    assert.match(guest.errors.at(-1).msg, /steps of 10/);
    guest.send({ t: 'play', card: guest.state.game.hand[0] });
    await sleep(40);
    assert.ok(guest.errors.at(-1).msg);
    guest.send({ t: 'pass' });
    await guest.until((s) => s.game.bidding.passed[s.you], 'pass recorded');
    guest.send({ t: 'bid', value: 170 });
    await sleep(40);
    assert.match(guest.errors.at(-1).msg, /passed/);
    guest.send({ t: 'vote', yes: true });
    await sleep(40);
    assert.match(guest.errors.at(-1).msg, /no vote/i);
    [host, ...guests, sixth, stranger].forEach((c) => c.close());
  } finally {
    await app.close();
  }
});

test('a dropped player is covered by autopilot and gets their seat back on reconnect', async () => {
  const { app, url } = await boot();
  try {
    const host = client(url, { brain: true });
    await host.open;
    host.send({ t: 'create', name: 'Host' });
    await host.until((s) => s.stage === 'lobby');
    const code = host.joined.room;
    host.send({ t: 'settings', rounds: 1, timers: false });

    let flaky = client(url, { brain: true });
    await flaky.open;
    flaky.send({ t: 'join', room: code, name: 'Flaky' });
    await flaky.until((s) => s.stage === 'lobby');
    const { token, seat } = flaky.joined;
    host.send({ t: 'start', fillBots: true });
    await host.until((s) => s.stage === 'round');

    flaky.close();
    await host.until((s) => s.seats[seat].connected === false, 'seen as offline');
    assert.equal(host.state.seats[seat].auto, true);

    // the round still completes without them
    await host.until((s) => s.stage === 'between', 'round end without the dropped player');

    // reconnect with the token: same seat, auto flag cleared
    flaky = client(url);
    await flaky.open;
    flaky.send({ t: 'join', room: code, name: 'Flaky', token });
    const st = await flaky.until((s) => s.stage === 'between');
    assert.equal(flaky.joined.seat, seat);
    assert.equal(st.you, seat);
    assert.equal(st.seats[seat].connected, true);
    flaky.close();
    host.close();
  } finally {
    await app.close();
  }
});

test('turn timers: an idle human is auto-played, then flagged as away after two strikes', async () => {
  const { app, url } = await boot();
  try {
    const host = client(url, { brain: true }); // the host keeps the table alive
    await host.open;
    host.send({ t: 'create', name: 'Host' });
    await host.until((s) => s.stage === 'lobby');
    const idle = client(url); // never answers
    await idle.open;
    idle.send({ t: 'join', room: host.joined.room, name: 'Idle' });
    await idle.until((s) => s.stage === 'lobby');
    host.send({ t: 'settings', rounds: 1, timers: true });
    host.send({ t: 'start', fillBots: true });
    await host.until((s) => s.stage === 'between', 'round end');
    const timeouts = host.state.game.log.filter((e) => e.type === 'timeout' && e.seat === 1);
    assert.ok(timeouts.length >= 2, 'the idle seat timed out repeatedly');
    assert.ok(host.state.game.log.some((e) => e.type === 'autopilot' && e.seat === 1));
    assert.equal(host.state.seats[1].auto, true);
    // a resume message hands the seat back
    idle.send({ t: 'resume' });
    await host.until((s) => s.seats[1].auto === false, 'seat resumed');
    idle.close();
    host.close();
  } finally {
    await app.close();
  }
});

test('auction over the wire: a human can bid at any moment, and 250 ends it', async () => {
  const { app, url } = await boot();
  try {
    const me = client(url);
    await me.open;
    me.send({ t: 'create', name: 'Bidder' });
    await me.until((s) => s.stage === 'lobby');
    me.send({ t: 'settings', rounds: 1, timers: true });
    me.send({ t: 'start', fillBots: true });
    const open = await me.until((s) => s.game?.phase === 'bidding', 'auction open');
    assert.equal(open.game.deadline.kind, 'auction');
    assert.equal(open.game.turn, null, 'nobody has the turn');
    assert.equal(open.game.bidding.legal[0], 170);
    me.send({ t: 'bid', value: 250 });
    const done = await me.until((s) => s.game?.phase === 'calling', 'auction closed');
    assert.equal(done.game.caller, me.state.you);
    assert.equal(done.game.bid, 250);
    me.close();
  } finally {
    await app.close();
  }
});

test('auction over the wire: bots alone settle it, and the clock closes it', async () => {
  const { app, url } = await boot();
  try {
    const me = client(url);
    await me.open;
    me.send({ t: 'create', name: 'Quiet' });
    await me.until((s) => s.stage === 'lobby');
    me.send({ t: 'settings', rounds: 1, timers: true });
    me.send({ t: 'start', fillBots: true });
    const st = await me.until((s) => s.game && s.game.phase !== 'bidding', 'auction closed by the clock or by passes');
    assert.ok(st.game.bid >= 170 && st.game.bid <= 250);
    assert.ok(st.game.log.some((e) => e.type === 'caller'));
    me.close();
  } finally {
    await app.close();
  }
});

test('the scoring scheme is a host setting, validated, and used for the match', async () => {
  const { app, url } = await boot();
  try {
    const host = client(url, { brain: true });
    await host.open;
    host.send({ t: 'create', name: 'Host' });
    const lobby = await host.until((s) => s.stage === 'lobby');
    assert.equal(lobby.settings.scoring, 'pairwise', 'head to head is the default');
    const guest = client(url, { brain: true });
    await guest.open;
    guest.send({ t: 'join', room: host.joined.room, name: 'Guest' });
    await guest.until((s) => s.stage === 'lobby');
    guest.send({ t: 'settings', scoring: 'classic' });
    await sleep(40);
    assert.match(guest.errors.at(-1).msg, /host/i);
    host.send({ t: 'settings', scoring: 'bogus' });
    await sleep(40);
    assert.equal(host.state.settings.scoring, 'pairwise', 'unknown schemes are ignored');
    host.send({ t: 'settings', scoring: 'classic', rounds: 1, timers: false });
    await host.until((s) => s.settings.scoring === 'classic');
    await guest.until((s) => s.settings.scoring === 'classic');
    host.send({ t: 'start', fillBots: true });
    await host.until((s) => s.stage === 'between' && s.game?.phase === 'done', 'round end');
    assert.equal(host.state.game.scoring, 'classic');
    assert.equal(host.state.game.result.scoring, 'classic');
    guest.close();
    host.close();
  } finally {
    await app.close();
  }
});

test('GET /api/info lists the scoring schemes for the lobby', async () => {
  const { app } = await boot();
  try {
    const port = app.server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/info`);
    const info = await res.json();
    assert.deepEqual(info.schemes.map((x) => x.id), ['classic', 'pairwise', 'margin']);
    assert.ok(info.schemes.every((x) => x.name && x.blurb));
  } finally {
    await app.close();
  }
});
