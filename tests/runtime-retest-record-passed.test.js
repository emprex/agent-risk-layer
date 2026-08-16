import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const helper = fs.readFileSync(new URL('../public/runtime-retest-record-passed.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/control-plane.html', import.meta.url), 'utf8');

test('passed retest action is derived from server audit and bound runtime evidence', () => {
  assert.match(helper, /remediation\.retest_executed/);
  assert.match(helper, /metadata\?\.result/);
  assert.match(helper, /retest_criteria_id/);
  assert.match(helper, /remediation_id/);
  assert.match(helper, /retest_satisfied/);
});

test('record action sends the normal server-authoritative retested transition', () => {
  assert.match(helper, /status: 'retested'/);
  assert.match(helper, /Record passed retest/);
  assert.doesNotMatch(helper, /verification\s*:/);
});

test('Runtime loads the prominent passed retest action helper', () => {
  assert.match(html, /runtime-retest-record-passed\.js\?v=20260816\.1/);
});
