import { openDatabase, migrate } from './db.js';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const db = await openDatabase();
try {
  await migrate(db);
  console.log(`Database migrations complete (${db.kind}).`);
} finally {
  await db.close();
}
