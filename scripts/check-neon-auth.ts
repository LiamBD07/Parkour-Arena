import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createAuthClient } from '@neon/auth';
import { BetterAuthVanillaAdapter } from '@neon/auth/vanilla/adapters';
import { loadEnvironment } from '../server/env.js';

loadEnvironment();
const baseUrl = process.env.NEON_AUTH_BASE_URL;
const email = process.env.NEON_TEST_EMAIL;
if (!baseUrl || !email) {
  console.error(
    'LIVE NEON AUTH NOT RUN: deploy Auth and set NEON_AUTH_BASE_URL and a fresh NEON_TEST_EMAIL.',
  );
  process.exit(2);
}
if (new URL(baseUrl).protocol !== 'https:') {
  console.error('LIVE NEON AUTH NOT RUN: an actual HTTPS Neon Auth endpoint is required.');
  process.exit(2);
}
const password = process.env.NEON_TEST_PASSWORD || `Aa0!${randomBytes(24).toString('base64url')}`;
const cookies = new Map<string, string>();
// Node fetch has no browser cookie jar. Provider cookies remain in memory on its exact origin.
const serviceFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const headers = new Headers(init?.headers);
  if (url.origin === new URL(baseUrl).origin) {
    headers.set('Origin', process.env.APP_ORIGIN || 'http://localhost:3000');
    if (cookies.size)
      headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
  }
  const response = await fetch(input, { ...init, headers });
  if (url.origin === new URL(baseUrl).origin)
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0],
        eq = pair.indexOf('=');
      if (eq < 1) continue;
      const key = pair.slice(0, eq),
        value = pair.slice(eq + 1);
      if (!value || /max-age=0(?:;|$)/i.test(cookie)) cookies.delete(key);
      else cookies.set(key, value);
    }
  return response;
};
const makeClient = () =>
  createAuthClient(baseUrl, {
    adapter: BetterAuthVanillaAdapter({ fetchOptions: { customFetchImpl: serviceFetch } }),
  });
try {
  const client = makeClient();
  const signup = await client.signUp.email({ email, password, name: 'Parkour Auth Smoke' });
  assert.ok(
    !signup.error && signup.data?.user?.id,
    'Managed signup failed; check that the email is fresh and email/password signup is enabled.',
  );
  const userId = signup.data.user.id;
  const restored = await makeClient().getSession();
  assert.equal(
    restored.data?.user.id,
    userId,
    'User created, but no session was restored. Complete required email verification before sign-in.',
  );
  console.log(
    'LIVE NEON AUTH PASS: SDK signup created a user and a new SDK client read the same current user.',
  );
  assert.ok(!(await client.signOut()).error, 'Managed sign-out failed.');
  assert.equal((await makeClient().getSession()).data?.user ?? null, null);
  assert.ok(
    !(await makeClient().signIn.email({ email, password })).error,
    'Managed sign-in failed.',
  );
  assert.equal((await makeClient().getSession()).data?.user.id, userId);
  console.log(
    'LIVE NEON AUTH PASS: sign-out, sign-in and session restoration. No credentials or tokens logged.',
  );
} catch (error) {
  // Never dump fetch errors, request objects, tokens or user credentials.
  console.error(
    'LIVE NEON AUTH FAILED:',
    error instanceof assert.AssertionError
      ? error.message.split('\n')[0]
      : 'Provider request failed. Check authentication, trusted origins and network access.',
  );
  process.exitCode = 1;
}
