// Plays N all-bot rounds and prints how the game behaves. Usage: npm run simulate -- 2000
import { Round, SEATS } from '../engine/round.js';
import { decide } from '../engine/bots.js';
import { mulberry32 } from '../engine/cards.js';

const N = Number(process.argv[2] ?? 1000);
const bids = {};
let wins = 0, forced = 0, solo = 0, teamPts = 0, calls = 0;

for (let i = 1; i <= N; i++) {
  const r = new Round({ startSeat: i % SEATS, rng: mulberry32(i) });
  const rnd = mulberry32(i * 31 + 7);
  while (r.phase !== 'done') {
    const seat = r.currentActor();
    const a = decide(r.view(seat), rnd);
    const res = a.type === 'bid' ? r.placeBid(seat, a.value)
      : a.type === 'pass' ? r.pass(seat)
        : a.type === 'call' ? r.callContract(seat, a) : r.play(seat, a.card);
    if (!res.ok) throw new Error(`illegal ${a.type} in round ${i}: ${res.error}`);
  }
  const res = r.result;
  bids[res.bid] = (bids[res.bid] ?? 0) + 1;
  if (res.success) wins++;
  if (r.events.find((e) => e.type === 'caller').forced) forced++;
  if (res.friendSeats.length === 0) solo++;
  teamPts += res.teamPoints;
  calls++;
}

const pct = (x) => `${((100 * x) / calls).toFixed(1)}%`;
console.log(`${calls} rounds, all invariants held`);
console.log('winning bids:', Object.entries(bids).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join('  '));
console.log(`caller team made its bid: ${pct(wins)}`);
console.log(`average team points: ${(teamPts / calls).toFixed(1)} of 250`);
console.log(`forced 170 (everyone passed): ${pct(forced)}   caller played alone: ${pct(solo)}`);
