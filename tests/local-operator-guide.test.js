import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  operatorHelp,
  collectOperatorDiagnostics,
  formatOperatorDiagnostics
} from '../src/agent/local-operator-guide.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function invoke(...args) {
  return spawnSync(process.execPath, ['bin/arl-operator.mjs', ...args], {
    cwd: root,
    env: {
      ...process.env,
      // No database or target access is permitted for informational commands.
      DATABASE_URL: 'postgresql://SYNTHETIC_PRIVATE_VALUE@127.0.0.1/no_database',
      ARL_OPERATOR_OPEN_DASHBOARD: '1'
    },
    encoding: 'utf8',
    timeout: 5000
  });
}

test('Operator help does not invoke the target-bound assessment runner', () => {
  const result = invoke('--help');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Read-only information commands/);
  assert.match(result.stdout, /refuses an unknown target/);
  assert.doesNotMatch(result.stdout, /may initialise a new assessment/);
  assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_VALUE/);
  assert.doesNotMatch(result.stderr, /DATABASE_URL is required|PREFLIGHT FAILED/);
  assert.match(operatorHelp, /written authorisation/);
});

test('Operator version is available without a PostgreSQL connection', () => {
  const result = invoke('--version');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
  assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_VALUE/);
});

test('Operator doctor reports read-only local status without exposing configuration', () => {
  const result = invoke('doctor');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ARL LOCAL OPERATOR DIAGNOSTICS — READ ONLY/);
  assert.match(result.stdout, /PostgreSQL connection: NOT CHECKED/);
  assert.match(result.stdout, /Assessment target\/snapshot: NOT CHECKED/);
  assert.match(result.stdout, /No assessment workflow, test, database write or network probe was run/);
  assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PRIVATE_VALUE/);
});

test('Informational commands reject extra arguments instead of executing a target', () => {
  const result = invoke('doctor', '/synthetic-target');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: arl-operator/);
  assert.doesNotMatch(result.stderr, /PREFLIGHT FAILED/);
});

test('Doctor only uses two read-only git commands and does not inspect .env contents', () => {
  const calls = [];
  const rootPath = '/synthetic/arl';
  const data = collectOperatorDiagnostics({
    root: rootPath,
    nodeVersion: '24.21.0',
    exists: filename => {
      calls.push(['exists', filename]);
      return true;
    },
    read: (filename, encoding) => {
      calls.push(['read', filename, encoding]);
      return '{"version":"10.1.1","engines":{"node":"24.21.0"}}';
    },
    runGit: (command, args) => {
      calls.push(['git', command, args]);
      return args.includes('rev-parse') ? 'a'.repeat(40) : ' M README.md\n?? scratch.txt\n';
    }
  });
  assert.equal(data.worktreeChanges, 2);
  assert.equal(data.envFilePresent, true);
  assert.equal(data.revision, 'a'.repeat(40));
  assert.deepEqual(calls, [
    ['read', '/synthetic/arl/package.json', 'utf8'],
    ['git', 'git', ['-C', rootPath, 'rev-parse', 'HEAD']],
    ['git', 'git', ['-C', rootPath, 'status', '--porcelain=v1', '--untracked-files=normal']],
    ['exists', '/synthetic/arl/.env']
  ]);
  const output = formatOperatorDiagnostics(data);
  assert.match(output, /Working tree: 2 change\(s\)/);
  assert.match(output, /contents not read/);
  assert.match(output, /24\.21\.0.*MATCH/);
});
