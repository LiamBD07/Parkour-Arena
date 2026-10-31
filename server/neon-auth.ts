import { createHash, randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, errors } from 'jose';
import type { Database } from './db.js';

export class ManagedAuthError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export const managedAuthEnabled = () => Boolean(process.env.NEON_AUTH_BASE_URL);
let keys: ReturnType<typeof createRemoteJWKSet> | undefined;
let keysUrl = '';
export async function managedIdentity(token: string) {
  const base = process.env.NEON_AUTH_BASE_URL;
  const jwks = process.env.NEON_AUTH_JWKS_URL;
  if (!base || !jwks)
    throw new ManagedAuthError(
      503,
      'Neon Auth is not fully configured. Deploy Auth and pull its environment variables.',
    );
  if (!token || token.length > 12000) throw new ManagedAuthError(401, 'Please sign in again.');
  if (keysUrl !== jwks) {
    keys = createRemoteJWKSet(new URL(jwks));
    keysUrl = jwks;
  }
  try {
    const { payload } = await jwtVerify(token, keys!, {
      issuer: new URL(base).origin,
      algorithms: ['EdDSA'],
      requiredClaims: ['sub', 'exp'],
    });
    if (!payload.sub || typeof payload.email !== 'string' || !payload.email.includes('@'))
      throw new ManagedAuthError(401, 'The Neon session has no usable user identity.');
    return {
      id: payload.sub,
      email: payload.email.toLowerCase(),
      name: typeof payload.name === 'string' ? payload.name : 'Runner',
    };
  } catch (e) {
    if (e instanceof ManagedAuthError) throw e;
    if (e instanceof errors.JOSEError)
      throw new ManagedAuthError(401, 'Your session expired or is invalid. Please sign in again.');
    throw new ManagedAuthError(503, 'Cannot verify the Neon session right now. Please try again.');
  }
}
export async function managedPlayer(db: Database, token: string) {
  const identity = await managedIdentity(token);
  const known = await db.query<{ id: string }>('SELECT id FROM players WHERE neon_user_id=$1', [
    identity.id,
  ]);
  if (known.rows[0]) return known.rows[0].id;
  // A signed identity never silently takes over an existing local account by matching its email.
  // The user must prove possession of that account's old password through link-legacy.
  const suffix = createHash('sha256').update(identity.id).digest('hex').slice(0, 7);
  const name = identity.name.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 10) || 'Runner';
  return db.transaction(async (q) => {
    const created = await q<{ id: string }>(
      `INSERT INTO players (id,email,username,password_hash,neon_user_id)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
      [randomUUID(), identity.email, `${name}_${suffix}`, 'managed-neon', identity.id],
    );
    const id =
      created.rows[0]?.id ||
      (await q<{ id: string }>('SELECT id FROM players WHERE neon_user_id=$1', [identity.id]))
        .rows[0]?.id;
    if (!id)
      throw new ManagedAuthError(
        409,
        'This email has an existing runner. Link it using your previous Parkour Arena password to keep your progress.',
        'LINK_LEGACY_ACCOUNT',
      );
    await q('INSERT INTO inventory (player_id,item_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
      id,
      'standard',
    ]);
    return id;
  });
}
