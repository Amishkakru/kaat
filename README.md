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
npm run simulate     # 1000 bot-only rounds with summary stats; pass a number for more
KAAT_FAST=1 npm start   # bots, pauses and timers run near-instantly, for testing
```

## The rules as built

- 40 cards: the 2s, 3s and 4s are removed. 250 points in play: Q♠ 60, aces 20, kings 15, other queens 10, jacks 5.
- Each player gets 4 cards, then bidding runs from 170 to 250 in steps of 10. The first bidder opens at 170 or passes. A pass is final. A bid of 250 ends bidding at once.
- The winner (the caller) names two friend cards and a cut suit. A friend card cannot be the A♠ or one of the caller's own first four cards. Then everyone gets 4 more cards.
- Whoever holds a friend card is on the caller's team, hidden until they play it. The caller may hold one or both.
- Eight tricks. The caller leads the first; each trick winner leads the next. Follow suit if you can. The highest cut card wins; with no cut card, the highest card of the led suit wins.
- The caller's team wins the round when its trick points reach the bid.

### Choices I made where the chat didn't say

| Question | What the game does |
|---|---|
| Everyone passes | The last seat to act is forced to take the call at 170 |
| Scoring | Stake = (bid − 160) / 10, so 170 is 1 and 250 is 9. On success the caller gains 2 × stake and every other player loses 1 × stake. On failure it is reversed. |
| Match length | 5 rounds by default (1, 3, 5 or 8 in the lobby) |
| Who bids first | Rotates one seat each round |
| Timers | Bidding 25 s, calling 60 s, playing 30 s. Two timeouts in a row hand your seat to autopilot until you press Resume. The host can switch timers off. |

All of these live in `engine/round.js` and `server/room.js` if you want to change them.

## How it's put together

```
engine/   rules and bots, plain JS with no I/O; cards.js is also served to the browser
server/   HTTP static server + WebSocket rooms (seats, reconnect, timers, autopilot); guard.js holds the public-internet limits
public/   vanilla JS modules, one stylesheet, bundled fonts
test/     node:test suites
```

- The server is the only authority. Each player receives a view that contains only what their seat may see, so other hands never reach the browser.
- Refreshing the page or losing the connection returns you to the same seat (a token is kept per browser tab, so two tabs can be two players).
- Bots see exactly what a human at their seat would see. They estimate a bid from hand strength, call their highest-point cards, and infer allies and opponents as the cards are played.

## Fonts

Bodoni Moda and Hanken Grotesk, both under the SIL Open Font License. Licence texts are in `public/fonts/`.
