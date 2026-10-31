# Parkour Arena

A playable browser parkour game built with React, Three.js, TypeScript and an Express server. One Render service hosts the game, API and multiplayer signalling. Neon PostgreSQL stores accounts, sessions, inventory, run replays and leaderboards.

## Run locally

Use Node **24.19.0** (see `.node-version`).

```sh
npm ci
npm run dev
```

The development server listens on port **3000**. No accounts with an external provider or secrets are needed for local development. Without `DATABASE_URL`, the server creates an embedded PostgreSQL database using PGlite in `.data/postgres/`. Accounts and progress survive restarts. This directory is ignored by Git. Embedded mode is refused in production so a deployment cannot silently lose account data.

Optional settings live in `.env`; copy `.env.example` and set only the values you need. Never commit `.env` or credentials. The app loads `.env.local` (the Neon CLI default) followed by `.env`; existing process environment values take precedence over both files. Keep the inherited TLS trust and proxy settings in managed environments.

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
4. When Render asks for `DATABASE_URL`, paste the pooled connection string from Neon's Connect panel. Supply `NEON_AUTH_BASE_URL` and `NEON_AUTH_JWKS_URL` from the successful Neon deployment as well. The app automatically uses Render's assigned HTTPS URL (`RENDER_EXTERNAL_URL`) for origin checks and checkout return URLs. You do not need to guess or enter the service hostname. If you later use a custom domain, set `APP_ORIGIN` explicitly to that HTTPS origin, without a trailing slash.
5. Deploy. Startup connects to PostgreSQL and runs migrations. Verify `/api/health`, register a runner, refresh to confirm session persistence, finish a solo run, and check its leaderboard ghost. A stopped or unreachable Neon database makes the health check fail instead of showing false readiness.

Render builds with `npm ci --include=dev && npm run build` and starts with `npm start`. Production requires a usable `DATABASE_URL` and an HTTPS origin supplied by Render or an explicit `APP_ORIGIN` override. One host and one origin mean there is no separate frontend CORS configuration. Cookies are HttpOnly, SameSite=Lax and Secure in production. When managed Auth is configured, the browser uses the Neon Auth SDK for email/password signup, sign-in, session restoration and sign-out. The API verifies signed Neon JWTs before reading or changing player data. Without managed Auth configuration, local development retains the previous scrypt and hashed-session implementation. Authentication and API requests are rate limited. Writes reject foreign browser origins. Enable provider backups and use an appropriate Neon database role for your release.

This repository includes deployment configuration, **not a provisioned Render service or Neon project**. The local database is for development and is not automatically uploaded to Neon.

## Neon CLI setup

The repository includes `neon.ts` declaring Postgres and managed Better Auth (`auth: true`). The long-running Render server retains its `pg` pool and application-owned player, inventory and leaderboard tables. Neon owns the managed identity and session tables.

```sh
npm i -g neon@latest
neon login
neon init -y --org-id <organization-id> --project-id <project-id> --branch production --services postgres,auth
neon deploy
npm run build
npm run dev
```

The project link is stored locally in the ignored `.neon` file. `neon deploy` must successfully authenticate and reach the Neon API before it can reconcile services and pull database credentials. Review the plan against an existing project before accepting changes, especially any existing Neon Auth configuration. This app explicitly declares `auth: true`. No Data API or additional Neon services are required.

The CLI writes `.env.local` by default, or updates `.env` if it exists. The server and migration command load both, with runtime settings taking precedence, followed by `.env.local`, then `.env`. App traffic uses pooled `DATABASE_URL`. When `DATABASE_URL_UNPOOLED` is supplied, schema migrations use that direct connection, including during server startup; the pool remains for normal queries. Both files and `.neon` are ignored by Git. Keep them private.

After deployment, verify `/api/health` reports `database: "postgres"`, register and sign in, purchase/equip a cosmetic, and save a solo run and its ghost. A health response of `database: "embedded"` only verifies local development. Cloud deployments and live Neon integration are not verified by a successful local build or the offline project link alone.

## Managed email signup and live verification

After `neon deploy` succeeds, `.env.local` (or `.env`) contains `NEON_AUTH_BASE_URL` and `NEON_AUTH_JWKS_URL`. The server loads both at runtime. It exposes only the public Auth base URL through `/api/config`, so no `VITE_*` alias or embedded Auth secret is needed. The React dialog calls `@neon/auth`'s `signUp.email`, `signIn.email` and `getSession`; sign-out uses the SDK. API requests carry the SDK's short-lived JWT, verified against the deployed branch's JWKS and issuer. The current SDK's type export omits the `.token()` helper, so token retrieval uses the SDK's typed `$fetch('/token')` method for the same JWT plugin endpoint. The same token is sent in a WebSocket join message, never in its URL.

With `NEON_AUTH_BASE_URL` set, legacy password endpoints and legacy session-cookie access are disabled. The first verified Neon identity creates one player profile with starter credits. Matching an existing email never automatically takes over its player: the UI asks for the old Parkour Arena password, then links the existing player ID, inventory, run history and credits. Existing records are retained. Password hashes cannot be moved into managed Auth; an existing player creates a Neon login first and proves the old account password to link it.

Set the two Auth URLs on Render and register its exact HTTPS origin on the selected branch:

```sh
neon neon-auth domain add https://your-service.onrender.com
```

Localhost is normally pre-approved; inspect `neon neon-auth domain allow-localhost get` if it is rejected. Match the branch's email-verification setting. If verification is required, complete it before expecting a signed-in session. Shared SMTP supports verification codes; production email delivery needs Neon's SMTP configuration. No app-owned Better Auth server or Better Auth schema migrations are installed.

A real-provider smoke test is explicit and separate from local tests:

```sh
NEON_TEST_EMAIL=your-fresh-test-inbox@example.com npm run check:neon-auth
```

Use a fresh email address you control. The test generates a password in memory (or uses a securely configured `NEON_TEST_PASSWORD`), calls the actual HTTPS Neon Auth SDK, and reads the current user through a new SDK client with the received cookies. It then signs out and signs back in and checks session restoration. It creates a real user in the linked provider and leaves that test record there. It never prints passwords, cookies, tokens or full provider errors. If verification blocks session creation, the test reports failure instead of claiming success. Missing Auth configuration exits with status 2 and `LIVE NEON AUTH NOT RUN`.

`npm test` uses isolated local databases and locally signed JWT fixtures for authorization, signature rejection and account-linking checks. Those tests do **not** prove that managed Auth was deployed or a real Neon user was created. Complete the real-provider test and a browser reload/protected-action check before claiming live signup works. Cookies on a separate Auth origin also depend on browser cookie policy; verify on the target browser and hosting domain.

## Optional real-money credit purchases

Credit purchases remain visibly disabled until Stripe is configured. You can earn credits and use the cosmetic shop without payments.

1. In Stripe, create three one-time Prices in your chosen currency for packs of 1,000, 2,800 and 6,500 credits. Choose the actual cash prices in Stripe; the game displays the final price on Stripe's hosted checkout.
2. Add `STRIPE_SECRET_KEY`, `STRIPE_PRICE_1000`, `STRIPE_PRICE_2800` and `STRIPE_PRICE_6500` to Render's secure environment settings. Use **test-mode** keys and prices first.
3. Add a Stripe webhook pointing to `https://<your-service>/api/payments/webhook`. Subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Set its signing secret as `STRIPE_WEBHOOK_SECRET` in Render and redeploy.
4. Complete a test checkout. Confirm credits are delivered by the verified webhook. Replaying an event must not grant credits again. The browser success redirect never grants currency.
5. Before enabling live payments, establish your prices, refund/support process, terms, privacy notice, account recovery/email verification and applicable selling requirements. Managed Auth supports email delivery when configured on Neon; this MVP has no password-reset or refund/revocation UI. Stripe receipts and payment management remain in Stripe.

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
