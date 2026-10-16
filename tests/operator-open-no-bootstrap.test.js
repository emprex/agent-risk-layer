import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('operator:open refuses a missing local assessment without bootstrapping security state', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-open-no-bootstrap-'));
  const target = path.join(temporary, 'target');
  const databasePath = path.join(temporary, 'isolated-test.sqlite');
  fs.mkdirSync(target);

  try {
    const result = spawnSync(process.execPath, [
      'src/agent/arl-local-assessment-runner.mjs', target
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 90_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PRODUCT_STAGE: 'development',
        DATABASE_URL: '',
        DATABASE_PATH: databasePath,
        ARL_LOCAL_MODE: '1',
        ARL_OPERATOR_OPEN_DASHBOARD: '1',
        ARL_AI_ADVISORY: '0',
        ARL_EXPECTED_TARGET_SHA: ''
      }
    });

    assert.equal(result.status, 2, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /No existing local assessment for this target/);
    assert.doesNotMatch(result.stdout, /dashboard created|deployment authorised/i);
    assert.ok(fs.existsSync(databasePath), 'isolated SQLite test adapter should be initialised');

    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      for (const table of ['users', 'security_projects', 'assessments', 'system_snapshots']) {
        const count = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
        assert.equal(Number(count.count), 0, `${table} must remain unchanged`);
      }
    } finally {
      database.close();
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
