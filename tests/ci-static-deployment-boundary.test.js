import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('CI does not deploy the local assessment product', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /postgres:16-alpine/);
  assert.match(workflow, /POSTGRES_DB: arl_ci/);
  assert.doesNotMatch(workflow, /render deploy|terraform apply|ssh .*deploy/i);
  assert.equal(fs.existsSync(path.join(root, 'render.yaml')), false);
});
