// Plays N all-bot rounds and prints how the game behaves. Usage: npm run simulate -- 2000 [classic|pairwise|margin]
import { Round, SEATS } from '../engine/round.js';
import { decide, runAuction } from '../engine/bots.js';
import { mulberry32 } from '../engine/cards.js';
import { DEFAULT_SCHEME } from '../engine/scoring.js';

const N = Number(process.argv[2] ?? 1000);
const scoring = process.argv[3] ?? DEFAULT_SCHEME;
const bids = {};
let wins = 0, forced = 0, solo = 0, teamPts = 0, redealt = 0, redeals = 0, early = 0, tricks = 0;
let swing = 0, biggest = 0;

for (let i = 1; i <= N; i++) {
  const r = new Round({ startSeat: i % SEATS, rng: mulberry32(i), scoring });
  const rnd = mulberry32(i * 31 + 7);
  runAuction(r);
  while (r.phase !== 'done') {
    if (r.claim) {
      for (let s = 0; s < SEATS; s++) {
        const v = decide(r.view(s), rnd);
        if (v) r.vote(s, v.yes);
      }
      continue;
    }
    const seat = r.currentActor();
    const a = decide(r.view(seat), rnd);
    const res = a.type === 'call' ? r.callContract(seat, a)
      : a.type === 'claim' ? r.startClaim(seat) : r.play(seat, a.card);
    if (!res.ok) throw new Error(`illegal ${a.type} in round ${i}: ${res.error}`);
  }
  const res = r.result;
  bids[res.bid] = (bids[res.bid] ?? 0) + 1;
  if (res.success) wins++;
  if (r.events.find((e) => e.type === 'caller').forced) forced++;
  if (res.friendSeats.length === 0) solo++;
  if (res.early) early++;
  if (r.redeals.length) redealt++;
  redeals += r.redeals.length;
  teamPts += res.teamPoints;
  tricks += r.tricks.length;
  swing += Math.abs(res.deltas[res.caller]);
  biggest = Math.max(biggest, Math.abs(res.deltas[res.caller]));
}

const pct = (x) => `${((100 * x) / N).toFixed(1)}%`;
console.log(`${N} rounds, all invariants held (scoring: ${scoring})`);
console.log('winning bids:', Object.entries(bids).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join('  '));
console.log(`caller team made its bid: ${pct(wins)}`);
console.log(`average team points: ${(teamPts / N).toFixed(1)} of 250`);
console.log(`forced 170 (everyone passed): ${pct(forced)}   caller played alone: ${pct(solo)}`);
console.log(`deals redone for a hand with no face card: ${pct(redealt)} of rounds, ${(redeals / N).toFixed(2)} extra deals per round`);
console.log(`ended early by vote: ${pct(early)}   average tricks played: ${(tricks / N).toFixed(2)} of 8`);
console.log(`caller's swing per round: average ${(swing / N).toFixed(1)}, largest ${biggest}`);
