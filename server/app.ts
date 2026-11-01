import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { z } from 'zod';
import { POSES } from '../shared/movement.js';
import {
  COURSES,
  ITEMS,
  ratingForRun,
  type GhostFrame,
  type Player,
  type Course,
} from '../shared/game.js';
import type { Database } from './db.js';
import { ManagedAuthError, managedAuthEnabled, managedIdentity } from './neon-auth.js';
import {
  hashPassword,
  checkPassword,
  createSession,
  sessionPlayer,
  deleteSession,
} from './auth.js';

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const mapSchema = z.enum(['skyline', 'foundry', 'harbor']);
const classSchema = z.enum(['runner', 'traceur', 'acrobat']);
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase().trim()),
  password: z.string().min(10, 'Use at least 10 characters.').max(128),
});
const frameSchema = z.object({
  t: z.number().int().min(0).max(600000),
  p: z.tuple([
    z.number().min(-70).max(70),
    z.number().min(-20).max(45),
    z.number().min(-20).max(240),
  ]),
  yaw: z.number().min(-100).max(100),
  pose: z.enum(POSES),
  phase: z.number().min(0).max(1).optional(),
  wallSide: z.number().min(-1).max(1).optional(),
});
const packs: Record<string, number> = { '1000': 1000, '2800': 2800, '6500': 6500 };
export const paymentsEnabled = () =>
  Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    Object.keys(packs).every((p) => process.env[`STRIPE_PRICE_${p}`]),
  );

export async function getPlayer(db: Database, id: string): Promise<Player> {
  const { rows } = await db.query<{
    id: string;
    username: string;
    credits: number;
    mmr: number;
    equipped: string;
    trail: string | null;
    runs: string;
    best: number | null;
  }>(
    `SELECT p.id,p.username,p.credits,p.mmr,p.equipped,p.trail,
    (SELECT COUNT(*) FROM runs WHERE player_id=p.id) AS runs,
    (SELECT MIN(time_ms) FROM runs WHERE player_id=p.id) AS best FROM players p WHERE p.id=$1`,
    [id],
  );
  if (!rows[0]) throw new HttpError(401, 'Please sign in again.');
  const owned = await db.query<{ item_id: string }>(
    'SELECT item_id FROM inventory WHERE player_id=$1',
    [id],
  );
  return { ...rows[0], runs: Number(rows[0].runs), owned: owned.rows.map((r) => r.item_id) };
}

export function validateReplay(frames: GhostFrame[], time: number, course: Course): string | null {
  if (frames.length < 20 || frames[0].t > 200 || Math.abs(frames.at(-1)!.t - time) > 250)
    return 'Replay does not match the run timer.';
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  if (dist(frames[0].p, course.start) > 4) return 'The run must begin at the start line.';
  let cp = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const next = course.checkpoints[cp + 1];
    if (
      next &&
      Math.abs(f.p[2] - next.p[2]) < 5 &&
      Math.abs(f.p[0] - next.p[0]) < 8 &&
      Math.abs(f.p[1] - next.p[1]) < 4
    )
      cp++;
    if (i === 0) continue;
    const prev = frames[i - 1];
    const dt = (f.t - prev.t) / 1000;
    if (dt <= 0 || dt > 1) return 'Replay has missing or invalid frames.';
    const speed = Math.hypot(f.p[0] - prev.p[0], f.p[2] - prev.p[2]) / dt;
    const respawn = prev.p[1] < -5 && dist(f.p, course.checkpoints[cp].p) < 3;
    if (speed > 29 && !respawn) return 'Replay exceeds the movement limit.';
    if (Math.abs(f.p[1] - prev.p[1]) / dt > 65 && !respawn)
      return 'Replay exceeds the vertical movement limit.';
  }
  if (cp !== course.checkpoints.length - 1)
    return 'Pass through every checkpoint before finishing.';
  const finish = course.checkpoints.at(-1)!.p;
  if (Math.abs(frames.at(-1)!.p[2] - finish[2]) > 6)
    return 'Replay does not finish at the finish line.';
  return null;
}

// The checkout ID is the idempotency key, so different Stripe events cannot grant the same pack twice.
export async function creditCheckout(db: Database, checkout: Stripe.Checkout.Session) {
  const playerId = checkout.metadata?.playerId;
  const pack = checkout.metadata?.pack;
  if (checkout.payment_status !== 'paid' || !playerId || !pack || !packs[pack]) return;
  await db.transaction(async (q) => {
    const inserted = await q(
      'INSERT INTO payment_events (checkout_id,player_id,credits) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING checkout_id',
      [checkout.id, playerId, packs[pack]],
    );
    if (inserted.rows.length)
      await q('UPDATE players SET credits=credits+$1 WHERE id=$2', [packs[pack], playerId]);
  });
}

export function createApplication(db: Database, options: { limits?: boolean } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production'
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'blob:'],
                connectSrc: [
                  "'self'",
                  'wss:',
                  ...(process.env.NEON_AUTH_BASE_URL
                    ? [new URL(process.env.NEON_AUTH_BASE_URL).origin]
                    : []),
                ],
                workerSrc: ["'self'", 'blob:'],
                fontSrc: ["'self'"],
              },
            }
          : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.post(
    '/api/payments/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
    async (req, res) => {
      if (!paymentsEnabled()) {
        res.status(503).json({ error: 'Payments are not configured.' });
        return;
      }
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          req.headers['stripe-signature'] as string,
          process.env.STRIPE_WEBHOOK_SECRET!,
        );
      } catch {
        res.status(400).json({ error: 'Invalid webhook signature.' });
        return;
      }
      try {
        if (
          event.type === 'checkout.session.completed' ||
          event.type === 'checkout.session.async_payment_succeeded'
        )
          await creditCheckout(db, event.data.object as Stripe.Checkout.Session);
        res.json({ received: true });
      } catch {
        res.status(500).json({ error: 'Credit delivery failed. Stripe will retry.' });
      }
    },
  );
  app.use(express.json({ limit: '1600kb' }), cookieParser());
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const expected = (process.env.APP_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
      if (origin && origin !== expected) {
        res.status(403).json({ error: 'This request came from another site.' });
        return;
      }
      if (req.get('sec-fetch-site') === 'cross-site') {
        res.status(403).json({ error: 'Cross-site request blocked.' });
        return;
      }
    }
    next();
  });
  if (options.limits !== false) {
    app.use(
      '/api',
      rateLimit({
        windowMs: 60000,
        limit: 150,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Too many requests. Try again in a minute.' },
      }),
    );
    app.use(
      '/api/auth',
      rateLimit({
        windowMs: 900000,
        limit: 30,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
      }),
    );
  }
  const requirePlayer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = await sessionPlayer(db, req);
      if (!id) throw new HttpError(401, 'Sign in to save your progress.');
      res.locals.playerId = id;
      next();
    } catch (e) {
      next(e);
    }
  };
  app.get('/api/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', database: db.kind });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.get('/api/config', (_req, res) =>
    res.json({
      payments: paymentsEnabled(),
      multiplayer: true,
      stun: process.env.STUN_URL || 'stun:stun.l.google.com:19302',
      neonAuthUrl: process.env.NEON_AUTH_BASE_URL || null,
    }),
  );
  app.get('/api/me', async (req, res) => {
    const id = await sessionPlayer(db, req);
    res.json({ player: id ? await getPlayer(db, id) : null });
  });
  app.post('/api/auth/register', async (req, res) => {
    if (managedAuthEnabled()) throw new HttpError(409, 'Use Neon managed signup in the app.');
    const input = credentials
      .extend({
        username: z
          .string()
          .trim()
          .min(3)
          .max(18)
          .regex(/^[a-zA-Z0-9_]+$/, 'Use letters, numbers and underscores.'),
      })
      .parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const id = randomUUID();
    try {
      await db.transaction(async (q) => {
        await q('INSERT INTO players (id,email,username,password_hash) VALUES ($1,$2,$3,$4)', [
          id,
          input.email,
          input.username,
          passwordHash,
        ]);
        await q('INSERT INTO inventory (player_id,item_id) VALUES ($1,$2)', [id, 'standard']);
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new HttpError(409, 'That email or runner name is already registered.');
      throw e;
    }
    await createSession(db, res, id);
    res.status(201).json({ player: await getPlayer(db, id) });
  });
  app.post('/api/auth/login', async (req, res) => {
    if (managedAuthEnabled()) throw new HttpError(409, 'Use Neon managed sign-in in the app.');
    const input = credentials.parse(req.body);
    const result = await db.query<{ id: string; password_hash: string }>(
      'SELECT id,password_hash FROM players WHERE email=$1',
      [input.email],
    );
    // A real scrypt computation also runs for unknown accounts to reduce timing differences.
    const stored = result.rows[0]?.password_hash || `${'0'.repeat(32)}:${'0'.repeat(128)}`;
    const valid = await checkPassword(input.password, stored);
    if (!result.rows[0] || !valid) throw new HttpError(401, 'Email or password is incorrect.');
    await createSession(db, res, result.rows[0].id);
    res.json({ player: await getPlayer(db, result.rows[0].id) });
  });
  app.post('/api/auth/logout', async (req, res) => {
    if (managedAuthEnabled())
      throw new HttpError(409, 'Sign out using the Neon Auth SDK in the app.');
    await deleteSession(db, req, res);
    res.json({ ok: true });
  });
  app.post('/api/auth/link-legacy', async (req, res) => {
    if (!managedAuthEnabled()) throw new HttpError(400, 'Managed Auth is not enabled.');
    const { password } = z.object({ password: z.string().min(1).max(128) }).parse(req.body);
    const bearer = req.headers.authorization;
    if (!bearer?.startsWith('Bearer ')) throw new HttpError(401, 'Sign into Neon first.');
    const identity = await managedIdentity(bearer.slice(7));
    const old = await db.query<{ id: string; password_hash: string; neon_user_id: string | null }>(
      'SELECT id,password_hash,neon_user_id FROM players WHERE email=$1',
      [identity.email],
    );
    const account = old.rows[0];
    if (!account || account.neon_user_id || !(await checkPassword(password, account.password_hash)))
      throw new HttpError(
        401,
        'The previous Parkour Arena password is incorrect or this runner is already linked.',
      );
    await db.transaction(async (q) => {
      const changed = await q(
        "UPDATE players SET neon_user_id=$1,password_hash='managed-neon' WHERE id=$2 AND neon_user_id IS NULL RETURNING id",
        [identity.id, account.id],
      );
      if (!changed.rows.length)
        throw new HttpError(409, 'This runner was already linked. Please sign in again.');
      await q('DELETE FROM sessions WHERE player_id=$1', [account.id]);
    });
    res.json({ player: await getPlayer(db, account.id) });
  });
  app.post('/api/shop/purchase', requirePlayer, async (req, res) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.body);
    const item = ITEMS.find((i) => i.id === itemId);
    if (!item || !item.price) throw new HttpError(400, 'Choose an item from the shop.');
    await db.transaction(async (q) => {
      const r = await q<{ credits: number }>('SELECT credits FROM players WHERE id=$1 FOR UPDATE', [
        res.locals.playerId,
      ]);
      const owned = await q('SELECT item_id FROM inventory WHERE player_id=$1 AND item_id=$2', [
        res.locals.playerId,
        itemId,
      ]);
      if (owned.rows.length) throw new HttpError(409, 'You already own this item.');
      if (r.rows[0].credits < item.price)
        throw new HttpError(400, 'Not enough credits. Earn more by finishing solo runs.');
      await q('UPDATE players SET credits=credits-$1 WHERE id=$2', [
        item.price,
        res.locals.playerId,
      ]);
      await q('INSERT INTO inventory (player_id,item_id) VALUES ($1,$2)', [
        res.locals.playerId,
        itemId,
      ]);
    });
    res.json({ player: await getPlayer(db, res.locals.playerId) });
  });
  app.post('/api/locker/equip', requirePlayer, async (req, res) => {
    const { itemId } = z.object({ itemId: z.string().nullable() }).parse(req.body);
    const item = ITEMS.find((i) => i.id === itemId);
    if (itemId && !item) throw new HttpError(400, 'Unknown cosmetic.');
    if (itemId) {
      const owned = await db.query('SELECT 1 FROM inventory WHERE player_id=$1 AND item_id=$2', [
        res.locals.playerId,
        itemId,
      ]);
      if (!owned.rows.length) throw new HttpError(403, 'You do not own this cosmetic.');
    }
    await db.query(
      `UPDATE players SET ${item?.kind === 'skin' ? 'equipped' : 'trail'}=$1 WHERE id=$2`,
      [itemId, res.locals.playerId],
    );
    res.json({ player: await getPlayer(db, res.locals.playerId) });
  });
  app.get('/api/leaderboard', async (req, res) => {
    const map = mapSchema.parse(req.query.map || 'skyline');
    const classId = req.query.class ? classSchema.parse(req.query.class) : null;
    const { rows } = await db.query(
      `SELECT id,username,time_ms AS time,class_id AS "classId",equipped AS skin,created_at AS "createdAt" FROM (
      SELECT r.id,p.username,r.time_ms,r.class_id,p.equipped,r.created_at,
      ROW_NUMBER() OVER (PARTITION BY r.player_id ORDER BY r.time_ms ASC,r.created_at ASC) AS place
      FROM runs r JOIN players p ON p.id=r.player_id WHERE map_id=$1 AND course_version=$2 ${classId ? 'AND class_id=$3' : ''}
    ) ranked WHERE place=1 ORDER BY time_ms ASC,created_at ASC LIMIT 50`,
      classId
        ? [map, COURSES.find((c) => c.id === map)!.version, classId]
        : [map, COURSES.find((c) => c.id === map)!.version],
    );
    res.json({ entries: rows });
  });
  app.get('/api/ghosts/:id', async (req, res) => {
    const { rows } = await db.query(
      'SELECT r.id,r.map_id AS "mapId",r.course_version AS "courseVersion",r.class_id AS "classId",r.time_ms AS time,r.replay,p.username,p.equipped AS skin FROM runs r JOIN players p ON p.id=r.player_id WHERE r.id=$1',
      [req.params.id],
    );
    if (!rows[0]) throw new HttpError(404, 'This ghost is no longer available.');
    if (rows[0].courseVersion !== COURSES.find((c) => c.id === rows[0].mapId)?.version)
      throw new HttpError(409, 'This ghost uses an earlier course layout. Choose a current run.');
    res.json(rows[0]);
  });
  app.post('/api/runs/start', requirePlayer, async (req, res) => {
    const input = z.object({ mapId: mapSchema, classId: classSchema }).parse(req.body);
    const id = randomUUID();
    await db.query(
      'INSERT INTO run_tickets (id,player_id,map_id,class_id,started_at,course_version) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        id,
        res.locals.playerId,
        input.mapId,
        input.classId,
        Date.now(),
        COURSES.find((c) => c.id === input.mapId)!.version,
      ],
    );
    res.json({ ticket: id });
  });
  app.post('/api/runs/finish', requirePlayer, async (req, res) => {
    const input = z
      .object({
        ticket: z.uuid(),
        time: z.number().int().min(8000).max(600000),
        frames: z.array(frameSchema).min(20).max(6001),
      })
      .parse(req.body);
    const runId = randomUUID();
    const result = await db.transaction(async (q) => {
      // Serialize this player's finishes so simultaneous tickets cannot bypass the daily reward cap.
      await q('SELECT id FROM players WHERE id=$1 FOR UPDATE', [res.locals.playerId]);
      const r = await q<{
        map_id: string;
        class_id: string;
        started_at: string;
        used: boolean;
        course_version: number;
      }>('SELECT * FROM run_tickets WHERE id=$1 AND player_id=$2 FOR UPDATE', [
        input.ticket,
        res.locals.playerId,
      ]);
      const ticket = r.rows[0];
      if (!ticket || ticket.used)
        throw new HttpError(400, 'This run has already been saved or has expired.');
      const elapsed = Date.now() - Number(ticket.started_at);
      if (elapsed < input.time - 500 || elapsed > 900000)
        throw new HttpError(400, 'Run timer validation failed. Restart the course.');
      const course = COURSES.find((c) => c.id === ticket.map_id)!;
      if (ticket.course_version !== course.version)
        throw new HttpError(409, 'The course changed. Refresh and start a new run.');
      const problem = validateReplay(input.frames, input.time, course);
      if (problem) throw new HttpError(400, problem);
      const previous = await q<{ best: number | null }>(
        'SELECT MIN(time_ms) AS best FROM runs WHERE player_id=$1 AND map_id=$2 AND course_version=$3',
        [res.locals.playerId, ticket.map_id, course.version],
      );
      await q(
        'INSERT INTO runs (id,player_id,map_id,class_id,time_ms,replay,course_version) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          runId,
          res.locals.playerId,
          ticket.map_id,
          ticket.class_id,
          input.time,
          JSON.stringify(input.frames),
          course.version,
        ],
      );
      await q('UPDATE run_tickets SET used=TRUE WHERE id=$1', [input.ticket]);
      const today = await q<{ count: string }>(
        "SELECT COUNT(*) FROM runs WHERE player_id=$1 AND created_at > NOW() - INTERVAL '1 day'",
        [res.locals.playerId],
      );
      const reward = Number(today.rows[0].count) <= 20 ? 100 : 0;
      const total = await q<{ count: string }>('SELECT COUNT(*) FROM runs WHERE player_id=$1', [
        res.locals.playerId,
      ]);
      const measured = ratingForRun(input.time, course.target);
      await q(
        'UPDATE players SET credits=credits+$1,mmr=CASE WHEN $2 THEN $3::integer ELSE ROUND(mmr*.75+$3::integer*.25)::integer END WHERE id=$4',
        [reward, Number(total.rows[0].count) === 1, measured, res.locals.playerId],
      );
      return {
        reward,
        personalBest: previous.rows[0].best === null || input.time < previous.rows[0].best,
      };
    });
    res
      .status(201)
      .json({ id: runId, ...result, player: await getPlayer(db, res.locals.playerId) });
  });
  app.post('/api/payments/checkout', requirePlayer, async (req, res) => {
    const { pack } = z.object({ pack: z.enum(['1000', '2800', '6500']) }).parse(req.body);
    if (!paymentsEnabled())
      throw new HttpError(
        503,
        'Credit purchases are not enabled. You can still earn credits by playing.',
      );
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const origin = (process.env.APP_ORIGIN || '').replace(/\/$/, '');
    if (!origin.startsWith('https://'))
      throw new HttpError(503, 'Secure checkout requires an HTTPS application origin.');
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: process.env[`STRIPE_PRICE_${pack}`]!, quantity: 1 }],
      client_reference_id: res.locals.playerId,
      metadata: { playerId: res.locals.playerId, pack },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });
    res.json({ url: session.url });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ManagedAuthError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues[0]?.message || 'Invalid input.' });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const status = (error as { status?: number }).status;
    if (status === 400 || status === 413) {
      res
        .status(status)
        .json({ error: status === 413 ? 'Request is too large.' : 'Invalid JSON request.' });
      return;
    }
    console.error('API operation failed:', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
