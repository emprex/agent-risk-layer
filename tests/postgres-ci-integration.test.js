import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createPostgresDatabase } from '../src/db-adapters/postgres.js';
import { runMigrations } from '../src/migrations.js';

const root = path.resolve(import.meta.dirname, '..');
const url = process.env.ARL_CI_POSTGRES_URL || '';

// This test must never accept a real workstation or hosted customer DB.
// GitHub Actions supplies a disposable postgres:16 service just for this job.
function ephemeralCiUrl() {
  assert.equal(process.env.CI, 'true', 'The live PostgreSQL smoke test runs only in CI.');
  const parsed = new URL(url);
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol));
  assert.ok(['localhost','127.0.0.1'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/arl_ci');
  assert.equal(parsed.username, 'arl_ci');
  assert.equal(parsed.search, '');
  return url;
}

test('ephemeral PostgreSQL applies real migrations idempotently and bootstraps a frozen local Operator assessment', {
  skip: !url && 'Only the dedicated CI PostgreSQL service is authorized.',
  timeout: 150_000
}, async () => {
  const connectionString = ephemeralCiUrl();
  const config = {
    databaseUrl: connectionString,
    databasePoolMax: 3,
    databaseIdleTimeoutMs: 5_000,
    databaseConnectTimeoutMs: 10_000,
    databaseSsl: false,
    databaseSslRejectUnauthorized: true,
    nodeEnv: 'test',
    databaseStatementTimeoutMs: 60_000,
    databaseLockTimeoutMs: 10_000
  };
  const db = await createPostgresDatabase(config);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-ci-postgres-target-'));
  const target = path.join(temp, 'target');
  const git = args => spawnSync('git', ['-C', target, ...args], {
    encoding: 'utf8',
    timeout: 10_000
  });

  try {
    // This is a dedicated empty CI database; never drop or reset a customer DB.
    const files = fs.readdirSync(path.join(root, 'migrations'))
      .filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
    const first = await runMigrations(db);
    assert.deepEqual(first.applied, files);
    assert.deepEqual(first.skipped, []);
    const repeated = await runMigrations(db);
    assert.deepEqual(repeated.skipped, files);
    assert.deepEqual(repeated.applied, []);

    const migrations = await db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get();
    assert.equal(Number(migrations.count), files.length);
    const catalogue = await db.prepare('SELECT COUNT(*) AS count FROM risk_knowledge_entries').get();
    assert.equal(Number(catalogue.count), 108);

    // The retired hosted billing tables must not survive the full migration chain.
    const retired = await db.prepare(
      "SELECT to_regclass('public.purchases') AS purchases, to_regclass('public.subscriptions') AS subscriptions"
    ).get();
    assert.equal(retired.purchases, null);
    assert.equal(retired.subscriptions, null);

    fs.mkdirSync(target);
    assert.equal(git(['init', '-q']).status, 0);
    assert.equal(git(['config', 'user.email', 'synthetic-ci@example.invalid']).status, 0);
    assert.equal(git(['config', 'user.name', 'ARL Synthetic CI']).status, 0);
    fs.writeFileSync(path.join(target,'README.md'), '# Synthetic, no customer target or credentials\n');
    assert.equal(git(['add', '.']).status, 0);
    assert.equal(git(['-c','commit.gpgsign=false','commit','-qm','Synthetic CI target']).status, 0);
    const revision = git(['rev-parse','HEAD']).stdout.trim();
    assert.match(revision,/^[a-f0-9]{40}$/);
    assert.equal(git(['status','--porcelain']).stdout.trim(), '');

    const result = spawnSync(process.execPath, [
      'src/agent/arl-local-assessment-runner.mjs',
      target,
      'Where are we?'
    ], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PRODUCT_STAGE: 'development',
        ARL_LOCAL_MODE: '1',
        ARL_AI_ADVISORY: '0',
        DATABASE_URL: connectionString,
        ARL_EXPECTED_TARGET_SHA: revision
      },
      encoding: 'utf8',
      timeout: 90_000
    });

    assert.equal(result.status,0,
      'Local Operator PostgreSQL preflight failed:\n' +
      result.stdout.slice(-6_000) + '\n' + result.stderr.slice(-6_000));
    assert.match(result.stdout,/ARL LOCAL ASSESSMENT ANSWER/);
    assert.doesNotMatch(result.stdout,/deployment (?:authorised|approved)|release approved/i);

    const owners = await db.prepare('SELECT COUNT(*) AS count FROM users WHERE email LIKE ?').get('%@local.invalid');
    assert.equal(Number(owners.count),1);
    const snapshots = await db.prepare('SELECT COUNT(*) AS count FROM system_snapshots').get();
    assert.ok(Number(snapshots.count)>=1);
    const decisions = await db.prepare('SELECT COUNT(*) AS count FROM control_deployment_decisions').get();
    assert.equal(Number(decisions.count),0,
      'Synthetic Operator bootstrapping must not write a deployment decision.');
  } finally {
    await db.close();
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
