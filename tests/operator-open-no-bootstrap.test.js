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


test('operator:open reuses a prepared local snapshot and never creates another', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-open-existing-'));
  const target = path.join(temporary, 'synthetic-target');
  const databasePath = path.join(temporary, 'isolated-test.sqlite');
  fs.mkdirSync(target);

  const git = (...args) => spawnSync('git', ['-C', target, ...args], {
    encoding: 'utf8', timeout: 10_000
  });
  const counts = () => {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      return Object.fromEntries(
        ['users', 'security_projects', 'assessments', 'system_snapshots']
          .map(table => [table, Number(database.prepare(
            `SELECT COUNT(*) AS count FROM ${table}`
          ).get().count)])
      );
    } finally {
      database.close();
    }
  };

  try {
    assert.equal(git('init', '-q').status, 0);
    assert.equal(git('config', 'user.email', 'synthetic@example.invalid').status, 0);
    assert.equal(git('config', 'user.name', 'Synthetic ARL Test').status, 0);
    fs.writeFileSync(path.join(target, 'README.md'), '# Synthetic assessment fixture\\n');
    assert.equal(git('add', 'README.md').status, 0);
    assert.equal(git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic fixture').status, 0);
    const revision = git('rev-parse', 'HEAD').stdout.trim();
    assert.match(revision, /^[a-f0-9]{40}$/);

    const env = {
      ...process.env,
      NODE_ENV: 'test', PRODUCT_STAGE: 'development',
      DATABASE_URL: '', DATABASE_PATH: databasePath,
      ARL_LOCAL_MODE: '1', ARL_AI_ADVISORY: '0',
      ARL_EXPECTED_TARGET_SHA: revision
    };
    // The synthetic preparation step is intentionally transactional.
    const seed = spawnSync(process.execPath, [
      'src/agent/arl-local-assessment-runner.mjs', target, 'Where are we?'
    ], { cwd: root, env, encoding: 'utf8', timeout: 90_000 });
    assert.equal(seed.status, 0, `seed stderr: ${seed.stderr}`);
    const before = counts();
    assert.equal(before.system_snapshots, 1);

    // A new assessment with zero eligible evidence controls still needs a
    // complete operator status view. The browser launcher is stubbed.
    const reportDirectory = path.join(temporary, 'private-reports');
    const fakeBin = path.join(temporary, 'fake-bin');
    fs.mkdirSync(reportDirectory, { mode:0o700 });
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(path.join(fakeBin, 'xdg-open'), '#!/bin/sh\nexit 0\n', { mode:0o755 });
    const opened = spawnSync(process.execPath, [
      'src/agent/arl-local-assessment-runner.mjs', target
    ], {
      cwd: root, encoding: 'utf8', timeout: 90_000,
      env: {
        ...env,
        PATH: fakeBin + path.delimiter + (process.env.PATH || ''),
        ARL_OPERATOR_OPEN_DASHBOARD: '1',
        ARL_REPORT_OUTPUT_DIR: reportDirectory
      }
    });
    assert.equal(opened.status, 0, `open stderr: ${opened.stderr}`);
    assert.match(opened.stdout, /Offline operator review dashboard created/);
    const reportFiles = fs.readdirSync(reportDirectory);
    assert.equal(reportFiles.length,1);
    const html=fs.readFileSync(path.join(reportDirectory,reportFiles[0]),'utf8');
    assert.match(html,/All 108 controls — authoritative snapshot/);
    assert.match(html,/Deployment HOLD/);
    assert.match(html,/All 0 independent controls/);
    assert.deepEqual(counts(), before, 'read-only opener must preserve all canonical identities and snapshots');
    assert.equal(git('status', '--porcelain').stdout.trim(), '');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
