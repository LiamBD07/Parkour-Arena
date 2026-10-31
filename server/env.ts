import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/** Shell settings win, followed by Neon-generated .env.local, then .env defaults. */
export function loadEnvironment(
  directory = process.cwd(),
  target: Record<string, string | undefined> = process.env,
) {
  for (const name of ['.env.local', '.env']) {
    const path = resolve(directory, name);
    if (!existsSync(path)) continue;
    const values = parseEnv(readFileSync(path, 'utf8'));
    for (const [key, value] of Object.entries(values)) {
      if (target[key] === undefined) target[key] = value;
    }
  }
}
