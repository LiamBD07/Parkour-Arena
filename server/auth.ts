import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import type { Database } from './db.js';
import { managedAuthEnabled, managedPlayer } from './neon-auth.js';
const scrypt = promisify(scryptCallback);
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function checkPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const compare = Buffer.from(expected, 'hex');
  return key.length === compare.length && timingSafeEqual(key, compare);
}
export async function createSession(db: Database, res: Response, playerId: string) {
  const token = randomBytes(32).toString('base64url');
  const maxAge = 30 * 86400000;
  await db.query('INSERT INTO sessions (token_hash, player_id, expires_at) VALUES ($1,$2,$3)', [
    hash(token),
    playerId,
    new Date(Date.now() + maxAge),
  ]);
  res.cookie('pa_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
    path: '/',
  });
}
export async function sessionPlayer(
  db: Database,
  req: Pick<Request, 'cookies'> & { headers?: Request['headers'] },
): Promise<string | null> {
  if (managedAuthEnabled()) {
    const authorization = req.headers?.authorization;
    if (!authorization?.startsWith('Bearer ')) return null;
    return managedPlayer(db, authorization.slice(7));
  }
  const token = req.cookies?.pa_session;
  if (typeof token !== 'string' || token.length > 100) return null;
  const r = await db.query<{ player_id: string }>(
    'SELECT player_id FROM sessions WHERE token_hash=$1 AND expires_at > NOW()',
    [hash(token)],
  );
  return r.rows[0]?.player_id ?? null;
}
export async function deleteSession(db: Database, req: Request, res: Response) {
  if (typeof req.cookies?.pa_session === 'string')
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [hash(req.cookies.pa_session)]);
  res.clearCookie('pa_session', {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
}
