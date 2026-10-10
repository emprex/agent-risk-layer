import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');

test('CI artifact names are explicitly synthetic', () => {
  assert.match(ci, /npm run demo:operator/);
  assert.match(ci, /name: arl-operator-dashboard-synthetic-demo/);
  assert.match(ci, /runner\.temp \}\}\/arl-operator-demo\/\*\.html/);
  assert.match(ci, /name: unit-test-log/);
  assert.doesNotMatch(ci, /contents:\s*write|write-all/);
});
