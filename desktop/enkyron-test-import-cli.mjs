import os from 'node:os';
import pg from 'pg';
import {
  previewTestImport,
  recordTestImport
} from './enkyron-test-import.mjs';

const action = process.argv[2];
let raw = '';

for await (const chunk of process.stdin) {
  raw += chunk;
  if (Buffer.byteLength(raw) > 16000)
    throw Error('Request too large');
}

const db = new pg.Pool({
  host: '/var/run/postgresql',
  port: 5432,
  user: os.userInfo().username,
  database: 'arl_local',
  max: 2,
  options: action === 'test-import-preview'
    ? '-c default_transaction_read_only=on -c statement_timeout=15000'
    : '-c statement_timeout=15000 -c lock_timeout=3000'
});

try {
  if (!['test-import-preview', 'test-import-record'].includes(action))
    throw Error('Unsupported operation');

  if (action === 'test-import-record' &&
      (process.env.ENKYRON_UAT_DATABASE ||
       process.env.ENKYRON_UX_PREVIEW_READ_ONLY === '1'))
    throw Error('Write blocked in preview/UAT');

  const input = JSON.parse(raw);

  const result = action === 'test-import-preview'
    ? await previewTestImport(db, input)
    : await recordTestImport(db, input, os.userInfo().username);

  process.stdout.write(JSON.stringify({ok: true, result}) + '\n');
} catch (error) {
  process.stdout.write(
    JSON.stringify({ok: false, error: String(error.message || error)}) + '\n'
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
