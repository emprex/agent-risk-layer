import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'public', 'observed-remediation-cards.js'), 'utf8');

test('resolved Inspector findings remain visible as retest evidence instead of disappearing', () => {
  assert.match(source, /resolvedFindings/);
  assert.match(source, /baselineInspectionId/);
  assert.match(source, /Retest evidence available/);
  assert.match(source, /no longer reports/);
  assert.match(source, /not automatic closure/);
});

test('observed retest handoff keeps verification evidence-first', () => {
  assert.match(source, /Keep the remediation open until an accountable review accepts the bounded retest evidence and records closure/);
  assert.match(source, /ruleWasResolved/);
  assert.match(source, /remediationForFinding/);
  assert.doesNotMatch(source, /status\s*=\s*['"]verified_closed['"]/);
});
