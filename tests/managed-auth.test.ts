import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { openDatabase, migrate, type Database } from '../server/db.js';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/auth.js';

// These are local signature/authorization tests, not claims of a live Neon signup.
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = 'memory://';
delete process.env.DATABASE_URL;
let db: Database, apiServer: Server, jwksServer: Server, base: string, issuer: string;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
async function token(
  subject: string,
  email: string,
  options: { expired?: boolean; issuer?: string; key?: typeof privateKey } = {},
) {
  return new SignJWT({ email, name: 'ManagedRunner' })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
    .setSubject(subject)
    .setIssuer(options.issuer || issuer)
    .setIssuedAt()
    .setExpirationTime(options.expired ? Math.floor(Date.now() / 1000) - 30 : '5m')
    .sign(options.key || privateKey);
}
async function request(path: string, bearer?: string, body?: unknown, cookie?: string) {
  const r = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}
before(async () => {
  const pair = await generateKeyPair('EdDSA');
  privateKey = pair.privateKey;
  const key = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'EdDSA', use: 'sig' };
  jwksServer = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ keys: [key] }));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}`;
  process.env.NEON_AUTH_BASE_URL = issuer + '/neondb/auth';
  process.env.NEON_AUTH_JWKS_URL = issuer + '/jwks';
  db = await openDatabase();
  await migrate(db);
  apiServer = createServer(createApplication(db, { limits: false }));
  await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => apiServer.close(() => resolve()));
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  await db.close();
});
test('managed mode exposes only public Auth URL and disables legacy password endpoints', async () => {
  const config = await request('/api/config');
  assert.equal(config.body.neonAuthUrl, process.env.NEON_AUTH_BASE_URL);
  assert.equal('DATABASE_URL' in config.body, false);
  assert.equal(
    (
      await request('/api/auth/register', undefined, {
        email: 'x@example.com',
        password: 'test-password',
        username: 'Unsafe',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request('/api/auth/login', undefined, {
        email: 'x@example.com',
        password: 'test-password',
      })
    ).status,
    409,
  );
});
test('a valid signed identity gets one player profile, then restores the same inventory and balance', async () => {
  const jwt = await token('neon-real-subject-fixture', 'managed@example.invalid');
  const first = await request('/api/me', jwt);
  assert.equal(first.status, 200);
  assert.equal(first.body.player.credits, 500);
  const id = first.body.player.id;
  const purchased = await request('/api/shop/purchase', jwt, { itemId: 'lime-trail' });
  assert.equal(purchased.status, 200);
  assert.equal(purchased.body.player.credits, 50);
  const renewed = await token('neon-real-subject-fixture', 'managed@example.invalid');
  const restored = await request('/api/me', renewed);
  assert.equal(restored.body.player.id, id);
  assert.equal(restored.body.player.credits, 50);
  assert.ok(restored.body.player.owned.includes('lime-trail'));
  const count = await db.query<{ count: string }>(
    'SELECT COUNT(*) FROM players WHERE neon_user_id=$1',
    ['neon-real-subject-fixture'],
  );
  assert.equal(Number(count.rows[0].count), 1);
});
test('wrong issuer, expired and forged JWTs cannot authenticate or spend credits', async () => {
  const attacker = await generateKeyPair('EdDSA');
  for (const jwt of [
    await token('a', 'a@example.invalid', { issuer: 'https://wrong.example' }),
    await token('a', 'a@example.invalid', { expired: true }),
    await token('a', 'a@example.invalid', { key: attacker.privateKey }),
    'not-a-jwt',
  ]) {
    assert.equal((await request('/api/shop/purchase', jwt, { itemId: 'lime-trail' })).status, 401);
  }
  assert.equal(
    (
      await request(
        '/api/shop/purchase',
        undefined,
        { itemId: 'lime-trail' },
        'pa_session=legacy-cookie',
      )
    ).status,
    401,
  );
});
test('matching emails never auto-link old accounts; proof of the old password preserves progress', async () => {
  await db.query(
    'INSERT INTO players (id,email,username,password_hash,credits) VALUES ($1,$2,$3,$4,$5)',
    [
      'old-player',
      'previous@example.invalid',
      'ExistingRunner',
      await hashPassword('previous-runner-password'),
      1900,
    ],
  );
  await db.query('INSERT INTO inventory (player_id,item_id) VALUES ($1,$2)', [
    'old-player',
    'carbon',
  ]);
  const jwt = await token('new-managed-owner', 'previous@example.invalid');
  const conflict = await request('/api/me', jwt);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'LINK_LEGACY_ACCOUNT');
  assert.equal(
    (await request('/api/auth/link-legacy', jwt, { password: 'wrong-password' })).status,
    401,
  );
  const linked = await request('/api/auth/link-legacy', jwt, {
    password: 'previous-runner-password',
  });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.player.id, 'old-player');
  assert.equal(linked.body.player.credits, 1900);
  const current = await request('/api/me', jwt);
  assert.ok(current.body.player.owned.includes('carbon'));
});
test('missing verification settings fail closed', async () => {
  const jwks = process.env.NEON_AUTH_JWKS_URL;
  delete process.env.NEON_AUTH_JWKS_URL;
  try {
    assert.equal((await request('/api/me', await token('x', 'x@example.invalid'))).status, 503);
  } finally {
    process.env.NEON_AUTH_JWKS_URL = jwks;
  }
});
