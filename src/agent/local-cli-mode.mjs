import path from 'node:path';
import { fileURLToPath } from 'node:url';

let databasePath = null;
// In-process capability: setting an environment variable on the server cannot
// enable SQLite. Only the CLI entrypoint opts in before importing persistence.
export function enableLocalCliMode(env = process.env) {
  if (env.ARL_LOCAL_MODE !== '1') throw new Error('ARL_LOCAL_MODE=1 is required.');
  databasePath = path.resolve(env.ARL_LOCAL_DATABASE_PATH || fileURLToPath(new URL('../../data/local-assessments.sqlite', import.meta.url)));
}
export function localCliDatabasePath() { return databasePath; }
