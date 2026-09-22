import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function runModule(source, env = {}) {
  return spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', source],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        PRODUCT_STAGE: 'development',
        DATABASE_URL: '',
        ...env
      },
      encoding: 'utf8'
    }
  );
}

test('ARL_LOCAL_MODE environment alone cannot enable SQLite product persistence', () => {
  const result = runModule(
    `
      try {
        await import('./src/db.js');
        console.log('unexpected-db-import-success');
        process.exit(0);
      } catch (error) {
        console.error(error.message);
        process.exit(17);
      }
    `,
    {
      ARL_LOCAL_MODE: '1'
    }
  );

  assert.equal(result.status, 17);
  assert.match(result.stderr, /DATABASE_URL is required/);
  assert.doesNotMatch(
    result.stdout,
    /unexpected-db-import-success/
  );
});

test('explicit in-process local CLI capability enables only the isolated SQLite adapter', () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'arl-product-local-cli-')
  );

  try {
    const localDatabase = path.join(temp, 'local.sqlite');
    const result = runModule(
      `
        const { enableLocalCliMode } =
          await import('./src/agent/local-cli-mode.mjs');
        enableLocalCliMode(process.env);
        const { db } = await import('./src/db.js');
        console.log(db.kind);
        process.exit(0);
      `,
      {
        ARL_LOCAL_MODE: '1',
        ARL_LOCAL_DATABASE_PATH: localDatabase
      }
    );

    assert.equal(
      result.status,
      0,
      `stderr: ${result.stderr}`
    );
    assert.match(result.stdout, /sqlite-test/);
    assert.equal(fs.existsSync(localDatabase), true);
  } finally {
    fs.rmSync(temp, {
      recursive: true,
      force: true
    });
  }
});

test('product-owned local assessment runner is local-only and syntactically valid', () => {
  const runnerPath =
    path.join(root, 'src/agent/arl-local-assessment-runner.mjs');
  const source = fs.readFileSync(runnerPath, 'utf8');

  assert.match(source, /enableLocalCliMode/);
  assert.match(source, /ARL_EXPECTED_TARGET_SHA/);
  assert.doesNotMatch(source, /hosted-operator-client/);
  assert.doesNotMatch(source, /ARL_SERVER_URL/);

  const syntax = spawnSync(
    process.execPath,
    ['--check', runnerPath],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(
    syntax.status,
    0,
    `stderr: ${syntax.stderr}`
  );
});

test('local self-proof is owned by the canonical product repository', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/agent/local-self-proof.mjs'),
    'utf8'
  );

  assert.match(source, /emprex\\\/agent-risk-layer/);
  assert.doesNotMatch(source, /emprex\\\/arl-agent-ai/);
});
