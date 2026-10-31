import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import express from 'express';
import { openDatabase, migrate } from './db.js';
import { createApplication } from './app.js';
import { attachMatchmaking } from './matchmaking.js';
import { configureAppOrigin } from './config.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const port = Number(process.env.PORT || 3000);
configureAppOrigin(process.env);
const db = await openDatabase();
await migrate(db);
const app = createApplication(db);
const server = createServer(app);
const stopMatchmaking = attachMatchmaking(server, db);
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist/client'), { maxAge: '1h', index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/client/index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
server.listen(port, '0.0.0.0', () =>
  console.log(`Parkour Arena listening on port ${port} · ${db.kind} database`),
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  stopMatchmaking();
  server.close();
  await db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
