import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const inspector = readFileSync(new URL('../public/inspector.js', import.meta.url), 'utf8');

test('Inspector command uses the selected assessment environment instead of hard-coded production', () => {
  assert.match(inspector, /assessmentEnvironment/);
  assert.match(inspector, /const environment=assessmentEnvironment\(selected\)/);
  assert.match(inspector, /--environment \$\{environment\}/);
  assert.doesNotMatch(inspector, /--environment production --upload/);
  assert.match(inspector, /Assessment environment:/);
});
