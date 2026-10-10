import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('active operating instructions agree on static public site and local PostgreSQL authority', () => {
  for (const name of ['README.md','PROJECT_STATUS.md','DEPLOYMENT.md','OPERATIONS_RUNBOOK.md','LAUNCH_CHECKLIST.md']) {
    const content = read(name);
    assert.match(content, /static/i, name + ' must describe the current public static site');
    assert.match(content, /PostgreSQL/i, name + ' must name the authoritative product persistence');
    assert.match(content, /local/i, name + ' must keep the assessment local');
    assert.doesNotMatch(content, /SQLite local capability|PostgreSQL service where the web application requires persistence/i,
      name + ' must not restore an obsolete hosted/local DB claim');
  }
  assert.match(read('PROJECT_STATUS.md'), /KB-025 \/ migration 048/);
  assert.match(read('PROJECT_STATUS.md'), /HOLD remains in force/);
  assert.match(read('README.md'), /SQLite is test-only/);
  assert.match(read('DEPLOYMENT.md'), /Static HTML by itself is not a working intake backend/);
  assert.match(read('OPERATIONS_RUNBOOK.md'), /npm run operator:open/);
  assert.match(read('LAUNCH_CHECKLIST.md'), /no ARL application server/);
});

test('current operator instructions never turn a static or offline preview into active-test authority', () => {
  const runbook = read('OPERATIONS_RUNBOOK.md');
  const deployment = read('DEPLOYMENT.md');
  assert.match(runbook, /written Rules of Engagement/);
  assert.match(runbook, /does not run tests, accept evidence or resolve HOLD/);
  assert.match(deployment, /not permission to run a target test/);
  assert.match(runbook, /LLM is not the security authority/);
  assert.doesNotMatch(runbook, /Render PostgreSQL database to restore/);
});
