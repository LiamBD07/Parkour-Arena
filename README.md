# Parkour Arena

A playable browser parkour game built with React, Three.js, TypeScript and an Express server. One Render service hosts the game, API and multiplayer signalling. Neon PostgreSQL stores accounts, sessions, inventory, run replays and leaderboards.

## Run locally

Use Node **24.19.0** (see `.node-version`).

```sh
npm ci
npm run dev
```

The development server listens on port **3000**. No accounts with an external provider or secrets are needed for local development. Without `DATABASE_URL`, the server creates an embedded PostgreSQL database using PGlite in `.data/postgres/`. Accounts and progress survive restarts. This directory is ignored by Git. Embedded mode is refused in production so a deployment cannot silently lose account data.

Optional settings live in `.env`; copy `.env.example` and set only the values you need. Never commit `.env` or credentials. The app loads `.env` itself; shell exports also work. Keep the inherited TLS trust and proxy settings in managed environments.

```sh
npm test          # Movement, accounts, purchases, replay validation, Stripe and matchmaking
npm run typecheck
npm run build    # TypeScript + Vite client + bundled Node server
npm run db:migrate
```

The test suite normally uses a private in-memory database. To exercise the native PostgreSQL driver, set `TEST_DATABASE_URL` to a **new, empty, disposable** PostgreSQL database when running `npm test`. This is intentionally separate from `DATABASE_URL`; never point it at real application data. Tests create fixtures in that database.

The normal server startup runs the same repeatable database migrations before it listens. A running service is healthy when `GET /api/health` returns HTTP 200 and `{"status":"ok",...}`. This endpoint actually queries the database.

## Play

Choose a course and a class, then start a solo time trial or queue for a four-runner open race. Practice works without signing in. Create an account to save runs online and receive 500 starter credits.

| Control              | Action                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| WASD / arrow keys    | Move relative to the view                                                                       |
| Click course + mouse | Capture cursor and look                                                                         |
| Shift                | Sprint                                                                                          |
| Space                | Jump (edge grace and input buffering included)                                                  |
| C                    | Slide/crouch under low beams                                                                    |
| E                    | Hold to wall run alongside amber high-friction walls                                            |
| X                    | Dive and roll on landing                                                                        |
| F                    | Flip in the air: complete the rotation to earn a landing boost; land early for a brief recovery |
| Q                    | Class ability                                                                                   |
| P / Escape           | Pause; the run timer continues                                                                  |

Touch devices have a movement stick, a look area and action buttons. Keyboard and mouse are recommended for precise movement. WebGL 2 is required; select Performance quality in Settings on slower hardware.

The courses are **Skyline Circuit**, **The Foundry**, and **Harbor Run**, with different lateral layouts and environments. Follow the chevrons through four checkpoint gates. Falling restores the last checkpoint without resetting the clock. Orange hinged platforms start dropping after a short delay and reset for another attempt.

All classes share base movement. Runner has a temporary sprint boost (12s cooldown), Traceur has an enhanced kick near grip walls (10s), and Acrobat has an additional airborne jump (14s). All classes and courses are free. These are initial balance values for playtesting.

## Ghosts, records and progression

- Solo runs record position, orientation and pose about ten times per second. Race your local personal best automatically, or select an actual player's ghost from the leaderboard.
- The leaderboard contains each player's fastest saved time on the selected course, with an optional class filter. A guide ghost is a labelled synthetic practice opponent and is never seeded into public rankings.
- Signed-in solo runs receive single-use server tickets. The server checks elapsed time, sample bounds, continuity, movement limits and checkpoint order before saving a result. It rejects duplicate submissions. These are basic integrity checks, **not an authoritative anti-cheat system**; a determined client can forge a physically plausible replay. Treat this version's leaderboard as a beta feature, not a prize or esports system.
- A validated solo finish grants 100 credits for each of the first 20 finishes in a rolling 24-hour period. A run started as a guest remains local even if you sign in afterward.
- Outfit and trail purchases use server-side catalogue prices, transactions and ownership checks. Credits cannot go negative; duplicate purchases cannot double-charge. Outfits and trails render on your runner. Cosmetics do not alter movement.

## Real-time races

The WebSocket queue groups up to four players by course, timezone-region preference and estimated skill rating. It widens region preference after six seconds and fills empty slots with labelled bots after twelve seconds. Timezone region is a coarse preference, not measured geographic distance or a latency guarantee. New players start with a provisional rating of 1000. Validated solo results estimate skill against a 24.5-second course reference, bounded to 600–1800. The first result establishes the estimate; later finishes blend 25% of the new estimate with 75% of the previous rating. Bot pace follows the same rating curve. This is an initial matchmaking estimate, with no separate competitive multiplayer ladder or seasonal ranking resets. Open races are casual and never enter the solo leaderboard.

WebRTC data channels exchange low-frequency positions directly where connectivity permits. The same-origin WebSocket connection relays state when a direct connection cannot be established, so restrictive NAT does not require exposing TURN credentials. STUN defaults to `stun:stun.l.google.com:19302` and is configurable. Peer connections reveal network addresses to participants, as normal for WebRTC. Bot speed is derived from lobby MMR. A disconnected human's rival becomes a synthetic bot at the current race clock. Race state is ephemeral and is lost on a server restart; progress stored in PostgreSQL is retained.

Run **one Render instance** for this version: the lobby registry lives in process memory. Multiple instances need a shared matchmaking coordinator (e.g. Redis), room routing and cross-instance signalling. Relay traffic and hosting may incur costs; P2P does not make an uptime or zero-cost guarantee. Free Render services can sleep, and free provider quotas can change.

## Deploy on Render with Neon

1. Put this code on the `main` branch of `LiamBD07/Parkour-Arena` in GitHub. No credentials belong in the repository.
2. Create a PostgreSQL project at [Neon](https://console.neon.tech/), ideally in the same region as Render. From Connect, copy the **pooled connection string** for the application database and role. Keep `sslmode=require` (and any provider-supplied channel binding setting). The driver keeps certificate validation enabled.
3. In [Render](https://dashboard.render.com/), create a **Blueprint** from that GitHub repository. The included [`render.yaml`](render.yaml) defines a single Node web service in Frankfurt, a frozen-lockfile build and the health check.
4. In Render's secure environment settings, set `DATABASE_URL` to the Neon connection string. Set `APP_ORIGIN` to the service's exact public HTTPS origin, e.g. `https://your-service.onrender.com`, with no trailing slash. This is a public setting used for same-origin protection and checkout return URLs, not a secret. For the first deployment, Render shows the assigned service URL; add it and redeploy if necessary.
5. Deploy. Startup connects to PostgreSQL and runs migrations. Verify `/api/health`, register a runner, refresh to confirm session persistence, finish a solo run, and check its leaderboard ghost. A stopped or unreachable Neon database makes the health check fail instead of showing false readiness.

Render builds with `npm ci --include=dev && npm run build` and starts with `npm start`. Production refuses to start without an HTTPS `APP_ORIGIN` or a usable `DATABASE_URL`. One host and one origin mean there is no separate frontend CORS configuration. Cookies are HttpOnly, SameSite=Lax and Secure in production. Passwords are salted with scrypt; raw session tokens are stored only in cookies, and their hashes are stored in the database. Authentication and API requests are rate limited. Writes reject foreign browser origins. Enable provider backups and use an appropriate Neon database role for your release.

This repository includes deployment configuration, **not a provisioned Render service or Neon project**. The local database is for development and is not automatically uploaded to Neon.

## Optional real-money credit purchases

Credit purchases remain visibly disabled until Stripe is configured. You can earn credits and use the cosmetic shop without payments.

1. In Stripe, create three one-time Prices in your chosen currency for packs of 1,000, 2,800 and 6,500 credits. Choose the actual cash prices in Stripe; the game displays the final price on Stripe's hosted checkout.
2. Add `STRIPE_SECRET_KEY`, `STRIPE_PRICE_1000`, `STRIPE_PRICE_2800` and `STRIPE_PRICE_6500` to Render's secure environment settings. Use **test-mode** keys and prices first.
3. Add a Stripe webhook pointing to `https://<your-service>/api/payments/webhook`. Subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Set its signing secret as `STRIPE_WEBHOOK_SECRET` in Render and redeploy.
4. Complete a test checkout. Confirm credits are delivered by the verified webhook. Replaying an event must not grant credits again. The browser success redirect never grants currency.
5. Before enabling live payments, establish your prices, refund/support process, terms, privacy notice, account recovery/email verification and applicable selling requirements. This MVP has no email delivery, password-reset or refund/revocation UI. Stripe receipts and payment management remain in Stripe.

The server chooses pack IDs, configured prices and player IDs; it never accepts a cash price or credit quantity from the client. A unique checkout ID makes fulfillment idempotent across different event IDs and retries. Live payment processing requires your actual Stripe account and has not been exercised by automated tests.

## Project layout

| Directory             | Purpose                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| `src/`                | React interface, 3D renderer, keyboard/touch input and WebRTC client                    |
| `src/game/physics.ts` | Fixed-step movement and collisions; unit tested without WebGL                           |
| `shared/`             | Course layouts, classes, cosmetic catalogue, replay interpolation and bot routes        |
| `server/`             | API, password/session auth, PostgreSQL migrations, lobby/signalling and Stripe webhooks |
| `tests/`              | Isolated database integration tests and movement/replay tests                           |

No external art assets or Google Fonts requests are required at runtime. The logo, course illustrations, character geometry and architectural textures are generated in this repository; fonts are served from the installed Fontsource packages. The visual target is a grounded industrial browser prototype, with procedural graphics rather than production photoreal character assets.

Cloud tasks already provide an isolated checkout. Use `/workspace/Parkour-Arena` directly; do not create a separate Git worktree unless explicitly requested. After restoring a cloud snapshot, dependencies and build artifacts may persist, but server processes do not: start `npm run dev` again and verify the health endpoint.
