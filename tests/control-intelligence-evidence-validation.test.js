import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../public/control-intelligence-control.html', import.meta.url), 'utf8');
const validator = readFileSync(new URL('../public/control-intelligence-evidence-validation.js', import.meta.url), 'utf8');

test('control evidence form blocks blank evidence records', () => {
  assert.match(page, /control-intelligence-evidence-validation\.js/);
  for (const id of ['#evidenceTitle', '#evidenceObserved', '#evidenceReference']) {
    assert.match(validator, new RegExp(id.replace('#', '#')));
  }
  assert.match(validator, /field\.required = true/);
  assert.match(validator, /String\(field\.value \|\| ''\)\.trim\(\)/);
  assert.match(validator, /event\.stopImmediatePropagation\(\)/);
  assert.match(validator, /is required before evidence can be recorded/);
});
