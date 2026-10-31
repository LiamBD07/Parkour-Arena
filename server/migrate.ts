import { openDatabase, migrate } from './db.js';
import { loadEnvironment } from './env.js';
loadEnvironment();
const db = await openDatabase({ migrations: true });
try {
  await migrate(db);
  console.log(`Database migrations complete (${db.kind}).`);
} finally {
  await db.close();
}
