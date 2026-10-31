import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureAppOrigin } from '../server/config.js';

test('Render production startup uses its assigned URL for all origin checks', () => {
  const env = {
    NODE_ENV: 'production',
    RENDER_EXTERNAL_URL: 'https://parkour-example.onrender.com/',
    APP_ORIGIN: '',
  };
  assert.equal(configureAppOrigin(env), 'https://parkour-example.onrender.com');
  assert.equal(env.APP_ORIGIN, 'https://parkour-example.onrender.com');
});
test('an explicit custom domain takes precedence over the Render hostname', () => {
  assert.equal(
    configureAppOrigin({
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://arena.example.com',
      RENDER_EXTERNAL_URL: 'https://parkour-example.onrender.com',
    }),
    'https://arena.example.com',
  );
});
test('production rejects insecure, missing and non-origin URLs', () => {
  for (const origin of [
    '',
    'http://arena.example.com',
    'https://arena.example.com/path',
    'https://user:password@arena.example.com',
  ]) {
    assert.throws(() => configureAppOrigin({ NODE_ENV: 'production', APP_ORIGIN: origin }));
  }
  assert.equal(configureAppOrigin({}), 'http://localhost:3000');
});
