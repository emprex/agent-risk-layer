import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const helper = fs.readFileSync(new URL('../public/runtime-retest-authoritative.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/control-plane.html', import.meta.url), 'utf8');

test('retest recovery uses the active server criteria id and matching audit event', () => {
  assert.match(helper, /verification\?\.retestCriteriaId/);
  assert.match(helper, /remediation\.retest_criteria_created/);
  assert.match(helper, /target_id/);
  assert.match(helper, /metadata\?\.remediationId/);
  assert.match(helper, /criteriaSource: 'server-audit'/);
});

test('retest recovery requires all four exact criteria values and never infers from title', () => {
  assert.match(helper, /ruleId/);
  assert.match(helper, /expectedDecision/);
  assert.match(helper, /actionType/);
  assert.match(helper, /targetIdentity/);
  assert.doesNotMatch(helper, /remediationTitle/);
  assert.doesNotMatch(helper, /includes\(['"]shell['"]\)/);
});

test('Runtime loads authoritative criteria recovery before copy and persistent helpers', () => {
  const authoritative = html.indexOf('runtime-retest-authoritative.js');
  const copy = html.indexOf('runtime-retest-copy.js');
  const persistent = html.indexOf('runtime-retest-persistent.js');
  assert.ok(authoritative > -1 && copy > authoritative && persistent > copy);
});
