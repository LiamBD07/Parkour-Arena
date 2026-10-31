import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import Stripe from 'stripe';
import { WebSocket } from 'ws';
import { openDatabase, migrate, type Database } from '../server/db.js';
import { createApplication } from '../server/app.js';
import { attachMatchmaking } from '../server/matchmaking.js';
import { COURSES, type Player } from '../shared/game.js';
import { botReplay } from '../shared/replay.js';

let db: Database,
  server: Server,
  base = '',
  cookie = '',
  player: Player,
  closeArena: () => void;
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = 'memory://';
delete process.env.NEON_AUTH_BASE_URL;
delete process.env.NEON_AUTH_JWKS_URL;
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
else delete process.env.DATABASE_URL;
for (const name of [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_1000',
  'STRIPE_PRICE_2800',
  'STRIPE_PRICE_6500',
])
  delete process.env[name];
async function request(path: string, body?: unknown, session = cookie, origin?: string) {
  const r = await fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(session ? { Cookie: session } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  return { status: r.status, data, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
before(async () => {
  db = await openDatabase();
  await migrate(db);
  server = createServer(createApplication(db, { limits: false }));
  closeArena = attachMatchmaking(server, db);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  closeArena();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
});

test('health check exercises the database; fresh leaderboards contain no invented records', async () => {
  assert.deepEqual((await request('/health')).data, { status: 'ok', database: db.kind });
  assert.deepEqual((await request('/leaderboard?map=skyline')).data.entries, []);
});
test('registration persists a hashed password, starter credits and an opaque HTTP-only session', async () => {
  const r = await request('/auth/register', {
    email: 'runner@example.com',
    username: 'TestRunner',
    password: 'secure-test-passphrase',
  });
  assert.equal(r.status, 201);
  cookie = r.cookie!;
  player = r.data.player;
  assert.equal(player.credits, 500);
  assert.deepEqual(player.owned, ['standard']);
  assert.equal('email' in player, false);
  assert.match(cookie, /^pa_session=/);
  const stored = await db.query<{ password_hash: string }>(
    'SELECT password_hash FROM players WHERE id=$1',
    [player.id],
  );
  assert.notEqual(stored.rows[0].password_hash, 'secure-test-passphrase');
  assert.equal(stored.rows[0].password_hash.split(':')[1].length, 128);
  assert.equal((await request('/me')).data.player.username, 'TestRunner');
});
test('invalid passwords and duplicate registrations fail without creating accounts', async () => {
  assert.equal(
    (
      await request('/auth/register', {
        email: 'bad@example.com',
        username: 'Bad',
        password: 'short',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/auth/register', {
        email: 'runner@example.com',
        username: 'Other',
        password: 'secure-test-passphrase',
      })
    ).status,
    409,
  );
  assert.equal(
    (await request('/auth/login', { email: 'runner@example.com', password: 'incorrect-password' }))
      .status,
    401,
  );
});
test('sign-in works and logout revokes that exact session', async () => {
  const login = await request('/auth/login', {
    email: 'runner@example.com',
    password: 'secure-test-passphrase',
  });
  assert.equal(login.status, 200);
  const temporary = login.cookie!;
  assert.equal((await request('/me', undefined, temporary)).data.player.id, player.id);
  await request('/auth/logout', {}, temporary);
  assert.equal((await request('/me', undefined, temporary)).data.player, null);
});
test('anonymous writes and cross-origin account requests are rejected', async () => {
  assert.equal((await request('/shop/purchase', { itemId: 'lime-trail' }, '')).status, 401);
  assert.equal((await request('/auth/logout', {}, cookie, 'https://evil.example')).status, 403);
});
test('purchase deducts the server price and equipment requires ownership', async () => {
  assert.equal((await request('/locker/equip', { itemId: 'ember' })).status, 403);
  const purchase = await request('/shop/purchase', { itemId: 'lime-trail', price: 0 });
  assert.equal(purchase.status, 200);
  assert.equal(purchase.data.player.credits, 50);
  assert.equal(
    (await request('/locker/equip', { itemId: 'lime-trail' })).data.player.trail,
    'lime-trail',
  );
  assert.equal((await request('/shop/purchase', { itemId: 'ember' })).status, 400);
});
test('concurrent duplicate purchases only charge once', async () => {
  await db.query('UPDATE players SET credits=2000 WHERE id=$1', [player.id]);
  const results = await Promise.all([
    request('/shop/purchase', { itemId: 'carbon' }),
    request('/shop/purchase', { itemId: 'carbon' }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await request('/me')).data.player.credits, 800);
});
test('validated solo run saves a public ghost, earns credits and cannot be submitted twice', async () => {
  const start = await request('/runs/start', { mapId: 'skyline', classId: 'runner' });
  const ticket = start.data.ticket;
  // The test controls its private database clock; no real runner waits are needed here.
  await db.query('UPDATE run_tickets SET started_at=$1 WHERE id=$2', [Date.now() - 32500, ticket]);
  const frames = botReplay(COURSES[0], 32000);
  const finish = await request('/runs/finish', { ticket, time: 32000, frames });
  assert.equal(finish.status, 201, JSON.stringify(finish.data));
  assert.equal(finish.data.reward, 100);
  assert.equal(finish.data.personalBest, true);
  assert.ok(
    finish.data.player.mmr > 1000,
    'solo performance should update the skill estimate used by matchmaking',
  );
  const board = (await request('/leaderboard?map=skyline')).data.entries;
  assert.equal(board.length, 1);
  assert.equal(board[0].username, 'TestRunner');
  const ghost = (await request(`/ghosts/${board[0].id}`)).data;
  assert.equal(ghost.replay.length, frames.length);
  assert.equal(ghost.time, 32000);
  assert.equal((await request('/runs/finish', { ticket, time: 32000, frames })).status, 400);
});
test('impossible paths and a client timer ahead of the server cannot enter the board', async () => {
  const frames = botReplay(COURSES[0], 32000);
  const ticket = (await request('/runs/start', { mapId: 'skyline', classId: 'runner' })).data
    .ticket;
  assert.equal((await request('/runs/finish', { ticket, time: 32000, frames })).status, 400);
  await db.query('UPDATE run_tickets SET started_at=$1 WHERE id=$2', [Date.now() - 32500, ticket]);
  frames[20].p[2] = 140;
  const bad = await request('/runs/finish', { ticket, time: 32000, frames });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /movement limit/);
  assert.equal((await request('/leaderboard?map=skyline')).data.entries.length, 1);
});
test('real-money checkout stays disabled until its credentials and prices are configured', async () => {
  assert.equal((await request('/config')).data.payments, false);
  assert.equal((await request('/payments/checkout', { pack: '1000' })).status, 503);
});
test('signed payment webhooks credit once per checkout; invalid signatures do not credit', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  for (const pack of ['1000', '2800', '6500'])
    process.env[`STRIPE_PRICE_${pack}`] = `price_test_${pack}`;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const before = (await request('/me')).data.player.credits;
  async function webhook(eventId: string, signatureValid = true) {
    const payload = JSON.stringify({
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_checkout',
          payment_status: 'paid',
          metadata: { playerId: player.id, pack: '1000' },
        },
      },
    });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: signatureValid ? process.env.STRIPE_WEBHOOK_SECRET! : 'wrong-secret',
    });
    return fetch(`${base}/api/payments/webhook`, {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
    });
  }
  assert.equal((await webhook('evt_invalid', false)).status, 400);
  assert.equal((await request('/me')).data.player.credits, before);
  assert.equal((await webhook('evt_one')).status, 200);
  assert.equal((await webhook('evt_two')).status, 200);
  assert.equal((await request('/me')).data.player.credits, before + 1000);
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});
test(
  'queue fills with bots, relays rival positions, and reports a human disconnection',
  { timeout: 18000 },
  async () => {
    const sockets: WebSocket[] = [];
    const records: Record<string, unknown>[][] = [[], []];
    try {
      const matches = [0, 1].map(
        (i) =>
          new Promise<Record<string, any>>((resolve, reject) => {
            const ws = new WebSocket(base.replace('http:', 'ws:') + '/arena');
            sockets.push(ws);
            ws.on('error', reject);
            ws.on('message', (data) => {
              const msg = JSON.parse(data.toString());
              records[i].push(msg);
              if (msg.type === 'hello')
                ws.send(
                  JSON.stringify({
                    type: 'join',
                    map: 'harbor',
                    classId: 'runner',
                    region: 'Europe',
                  }),
                );
              if (msg.type === 'matched') resolve(msg);
            });
          }),
      );
      const [a, b] = await Promise.all(matches);
      assert.equal(a.room, b.room);
      assert.equal(a.members.length, 4);
      assert.equal(a.members.filter((m: { bot: boolean }) => m.bot).length, 2);
      sockets[0].send(
        JSON.stringify({ type: 'state', p: [0, 4, 0], yaw: 0, pose: 'run', progress: 0.1 }),
      );
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(records[1].some((m) => m.type === 'state' && m.progress === 0.1));
      sockets[0].close();
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(records[1].some((m) => m.type === 'disconnected'));
    } finally {
      for (const ws of sockets) ws.close();
    }
  },
);
