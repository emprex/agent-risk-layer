import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const helper = fs.readFileSync(new URL('../public/runtime-retest-persistent.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/control-plane.html', import.meta.url), 'utf8');

test('active bound retest action is mounted outside dynamic Runtime root', () => {
  assert.match(helper, /controlPlaneRoot/);
  assert.match(helper, /insertAdjacentElement\('beforebegin'/);
  assert.match(helper, /Continue the active bound retest/);
  assert.match(helper, /data-copy-bound-retest/);
});

test('persistent action uses only exact captured criteria', () => {
  assert.match(helper, /exactCriteriaCaptured/);
  assert.match(helper, /criteriaId/);
  assert.match(helper, /\['tool', 'content\.input', 'content\.output'\]/);
  assert.doesNotMatch(helper, /remediationTitle/);
  assert.doesNotMatch(helper, /includes\(['"]shell['"]\)/);
});

test('persistent action reconciles server criteria id directly from current project', () => {
  assert.match(helper, /reconcileFromServer/);
  assert.match(helper, /new URLSearchParams\(location\.search\)\.get\('projectId'\)/);
  assert.match(helper, /\/api\/projects\//);
  assert.match(helper, /verification\?\.retestCriteriaId/);
  assert.match(helper, /existing\?\.exactCriteriaCaptured !== true/);
});

test('Runtime loads current persistent retest action helper', () => {
  assert.match(html, /runtime-retest-persistent\.js\?v=20260816\.2/);
});
