import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const helper = fs.readFileSync(new URL('../public/runtime-retest-copy.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/control-plane.html', import.meta.url), 'utf8');

test('bound retest copy always exposes the exact command visibly', () => {
  assert.match(helper, /Bound retest command/);
  assert.match(helper, /textarea readonly/);
  assert.match(helper, /retestCriteriaId/);
  assert.match(helper, /exactCriteriaCaptured !== true/);
});

test('copy uses clipboard API with a manual fallback instead of failing silently', () => {
  assert.match(helper, /navigator\.clipboard\?\.writeText/);
  assert.match(helper, /document\.execCommand\('copy'\)/);
  assert.match(helper, /Browser clipboard access was blocked/);
  assert.match(helper, /stopImmediatePropagation/);
});

test('visible copy helper loads after the retest workflow helper', () => {
  const workflowIndex = html.indexOf('/runtime-retest-workflow.js?v=20260816.4');
  const copyIndex = html.indexOf('/runtime-retest-copy.js?v=20260816.1');
  assert.ok(workflowIndex >= 0);
  assert.ok(copyIndex > workflowIndex);
});
