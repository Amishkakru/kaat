# Kaat

A five-player bidding trick game with hidden friends and a secret cut suit. One small Node server, one dependency, no build step. Play alone against bots, or put it online and send friends a link.

## Put it online

Kaat needs a host that keeps a Node process running and allows WebSockets. Static hosts and serverless functions (Vercel, Netlify, Cloudflare Pages) will not work. The repo is ready for Render with no changes:

1. Put this folder on GitHub (a private repo is fine).
   ```bash
   git init && git add . && git commit -m "Kaat"
   gh repo create kaat --private --source=. --push
   ```
2. In the Render dashboard choose **New > Blueprint**, pick the repo, and apply. `render.yaml` sets everything up in the Singapore region.
3. Open the `https://kaat-….onrender.com` address Render gives you, create a table, and use **Share** or **Copy link** to invite friends.

What to expect on Render's free plan (checked against Render's docs, October 2026):

- The service sleeps after 15 minutes with no HTTP request or WebSocket message, and takes about a minute to wake. While a game is being played it stays awake.
- Tables live in the server's memory. A sleep, restart or redeploy ends every table in progress, and players are returned to the home screen.
- Render may restart a free service at any time.

For a table that never sleeps, change `plan: free` to `plan: starter` in `render.yaml`. Fly.io, Railway, Google Cloud Run or any VPS also work through the included `Dockerfile`. Run exactly one instance, because tables are not shared between instances.

| Setting | Purpose |
|---|---|
| `PORT` | Set by the host. Defaults to 3000. |
| `ALLOWED_ORIGINS` | Only needed if the page is served from a different address than the server, or the host rewrites the `Host` header. Comma-separated, `*` allows any. The server logs a line naming the origin it refused. |

Built in for public use: a `/healthz` check, a strict content security policy, gzip and caching for static files, and the client address read from `X-Forwarded-For` only when the request arrives from a private proxy address. Limits per network address: 30 new tables an hour, 50 open connections, 30 wrong table codes per 10 minutes. Each connection is limited to 15 messages a second, and the server holds at most 300 tables. Browsers on other websites cannot open a socket to your server.

## Run it locally

```bash
npm install
npm start
```

The terminal prints a `localhost` address and a same-Wi-Fi address. Open one, enter a name, and choose **Create a table**. Needs Node 20 or newer.

```bash
npm test             # engine, fuzz, hosting and WebSocket tests
npm run simulate     # 1000 bot-only rounds with summary stats; add a number, and classic, pairwise or margin
KAAT_FAST=1 npm start   # bots, pauses and timers run near-instantly, for testing
```

## The rules as built

- 40 cards: the 2s, 3s and 4s are removed. 250 points in play: Q♠ 60, aces 20, kings 15, other queens 10, jacks 5.
- Each player gets 4 cards. If anyone holds no ace, king, queen or jack, the table is dealt again until every hand has one. About half of all deals need this, and the table is told who triggered it.
- Bidding is an open auction with no turns. Anyone can bid at any moment, from 170 to 250 in steps of 10, and can jump straight to a higher number. The first bid at a price stands; a later bid at the same price is refused. A pass is final and the high bidder cannot pass. The auction ends when everyone else has passed, when someone bids 250, or when the clock runs out after the last bid.
- The winner (the caller) names two friend cards and a cut suit. A friend card cannot be the A♠ or one of the caller's own first four cards. Then everyone gets 4 more cards.
- Whoever holds a friend card is on the caller's team, hidden until they play it. The caller may hold one or both.
- Eight tricks. The caller leads the first; each trick winner leads the next. Follow suit if you can. The highest cut card wins; with no cut card, the highest card of the led suit wins.
- The caller's team wins the round when its trick points reach the bid.
- Once both friend cards have been played, an opponent can claim the round if the caller's side can no longer reach its bid even by taking every point still in play. All five players vote, three yes votes end the round, and a vote nobody answers counts as no. A failed vote blocks another claim until the next trick. An early end is scored as a loss for the caller, crediting the caller's side with every unplayed point.

### Scoring

The base stake is (bid − 160) / 10, so 170 is 1 and 250 is 9. The host picks how it is paid out in the lobby. Head to head is the default.

| Scheme | How it pays | Balanced? |
|---|---|---|
| Classic | Caller ±2 stakes, each friend ±1, each opponent the opposite ±1. | Only when the caller has exactly one friend |
| Head to head | Each opponent settles with each member of the caller's side: 2 stakes to the caller, 1 to each friend. The opponents pay if the caller wins and collect if the caller falls short. | Always zero-sum |
| Margin | Head to head, and the stake goes up by 1 for every full 20 points the caller's side finished past the bid or short of it, up to +3. | Always zero-sum |

Worked examples, scores listed as caller, friend, then each opponent:

| Round | Classic | Head to head | Margin |
|---|---|---|---|
| Bid 200 (stake 4), one friend, caller's side makes 220 | +8, +4, −4 | +24, +12, −12 | +30, +15, −15 |
| Bid 200, caller plays alone, caller's side makes 140 | −8, +4 | −32, +8 | −56, +14 |

### Choices I made where the chat didn't say

| Question | What the game does |
|---|---|
| Everyone passes, or nobody bids before the clock runs out | The last seat in order from the round's opening seat takes the call at 170 |
| What counts as a face card for the redeal | Ace, king, queen or jack: the cards that carry points |
| Match length | 5 rounds by default (1, 3, 5 or 8 in the lobby) |
| Which seat is the opening seat | Rotates one seat each round. It only matters when nobody bids. |
| Timers | Auction 25 s before the first bid and 9 s after each bid, calling 60 s, playing 30 s, early-end vote 20 s. Two timeouts in a row hand your seat to autopilot until you press Resume. The host can switch turn timers off; the auction clock then stops, but a vote still expires. |

The rules live in `engine/round.js` and `engine/scoring.js`, the timers in `server/room.js`.

## How it's put together

```
engine/   rules and bots, plain JS with no I/O; cards.js is also served to the browser
server/   HTTP static server + WebSocket rooms (seats, reconnect, timers, autopilot); guard.js holds the public-internet limits
public/   vanilla JS modules, one stylesheet, bundled fonts
test/     node:test suites
```

- The server is the only authority. Each player receives a view that contains only what their seat may see, so other hands never reach the browser.
- Refreshing the page or losing the connection returns you to the same seat (a token is kept per browser tab, so two tabs can be two players).
- Bots see exactly what a human at their seat would see. They keep raising the auction by the minimum while the price is within what their hand is worth, call their highest-point cards, infer allies and opponents as the cards are played, and agree to a claim that is provably true.

## Fonts

Bodoni Moda and Hanken Grotesk, both under the SIL Open Font License. Licence texts are in `public/fonts/`.
