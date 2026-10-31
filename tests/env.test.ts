import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvironment } from '../server/env.js';

test('Neon env files load pooled and direct URLs while preserving runtime settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parkour-env-'));
  try {
    writeFileSync(
      join(dir, '.env'),
      'DATABASE_URL=base-db\nPORT=3000\nAPP_ORIGIN=https://base.example\n',
    );
    writeFileSync(
      join(dir, '.env.local'),
      'DATABASE_URL=neon-pooled\nDATABASE_URL_UNPOOLED=neon-direct\nPORT=3100\n',
    );
    const env: Record<string, string | undefined> = {
      APP_ORIGIN: 'https://render.example',
      PORT: '3200',
    };
    loadEnvironment(dir, env);
    assert.equal(env.DATABASE_URL, 'neon-pooled');
    assert.equal(env.DATABASE_URL_UNPOOLED, 'neon-direct');
    assert.equal(env.PORT, '3200');
    assert.equal(env.APP_ORIGIN, 'https://render.example');
    loadEnvironment(dir, env);
    assert.equal(env.DATABASE_URL, 'neon-pooled');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('missing env files leave normal development and runtime injection intact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parkour-env-'));
  try {
    const env = { DATABASE_URL: 'injected-db' };
    loadEnvironment(dir, env);
    assert.deepEqual(env, { DATABASE_URL: 'injected-db' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
