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

test('observed retest handoff keeps closure an explicit accountable action', () => {
  assert.match(source, /Keep the remediation open until an accountable review accepts the bounded retest evidence and records closure/);
  assert.match(source, /ruleWasResolved/);
  assert.match(source, /remediationForFinding/);
  assert.match(source, /Accountable closure review/);
  assert.match(source, /Accept retest evidence and close finding/);
  assert.match(source, /observedInspectionClosure/);
  assert.match(source, /status: 'verified_closed'/);
  assert.match(source, /does not prove runtime behaviour or unrelated controls/);
});

test('observed remediation cards never bind closure to a runtime or different assessment project', () => {
  assert.match(source, /project\?\.projectKind !== 'assessment_case'/);
  assert.match(source, /project\?\.assessmentId !== assessmentId/);
});
