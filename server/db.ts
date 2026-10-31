import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';

export interface Database {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (q: Database['query']) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'postgres' | 'embedded';
}
export async function openDatabase(options: { migrations?: boolean } = {}): Promise<Database> {
  const connectionString = options.migrations
    ? process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
    : process.env.DATABASE_URL;
  if (connectionString) {
    const pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', () =>
      console.error('Database pool connection failed. Check Neon availability.'),
    );
    await pool.query('SELECT 1');
    return {
      kind: 'postgres',
      query: async <T>(sql: string, params?: unknown[]) => ({
        rows: (await pool.query(sql, params)).rows as T[],
      }),
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const result = await fn(async <T>(sql: string, params?: unknown[]) => ({
            rows: (await c.query(sql, params)).rows as T[],
          }));
          await c.query('COMMIT');
          return result;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
  }
  if (process.env.NODE_ENV === 'production')
    throw new Error('DATABASE_URL is required in production. Add your Neon pooled connection URL.');
  const path = process.env.DATABASE_PATH || resolve('.data/postgres');
  if (path !== 'memory://') await mkdir(path, { recursive: true });
  const db = new PGlite(path);
  await db.waitReady;
  return {
    kind: 'embedded',
    query: <T>(sql: string, params?: unknown[]) => db.query<T>(sql, params),
    transaction: (fn) =>
      db.transaction((tx) => fn(<T>(sql: string, params?: unknown[]) => tx.query<T>(sql, params))),
    close: () => db.close(),
  };
}
export async function migrate(db: Database) {
  // A transaction makes repeatable startup safe on both PostgreSQL and the local PGlite database.
  await db.transaction(async (q) => {
    await q(`CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, credits INTEGER NOT NULL DEFAULT 500 CHECK (credits >= 0),
      mmr INTEGER NOT NULL DEFAULT 1000, equipped TEXT NOT NULL DEFAULT 'standard', trail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await q('ALTER TABLE players ADD COLUMN IF NOT EXISTS neon_user_id TEXT');
    await q('CREATE UNIQUE INDEX IF NOT EXISTS players_neon_user_idx ON players(neon_user_id)');
    await q(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    )`);
    await q(`CREATE TABLE IF NOT EXISTS inventory (
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE, item_id TEXT NOT NULL,
      PRIMARY KEY (player_id, item_id)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS run_tickets (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), map_id TEXT NOT NULL,
      class_id TEXT NOT NULL, started_at BIGINT NOT NULL, used BOOLEAN NOT NULL DEFAULT FALSE
    )`);
    await q(`CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), map_id TEXT NOT NULL,
      class_id TEXT NOT NULL, time_ms INTEGER NOT NULL, replay JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await q('CREATE INDEX IF NOT EXISTS runs_map_time_idx ON runs(map_id, time_ms)');
    await q('CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at)');
    await q(`CREATE TABLE IF NOT EXISTS payment_events (
      checkout_id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
      credits INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await q('DELETE FROM sessions WHERE expires_at < NOW()');
    await q('DELETE FROM run_tickets WHERE started_at < $1', [Date.now() - 86400000]);
  });
}
