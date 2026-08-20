import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const backend = fs.readFileSync(path.join(root, 'src', 'control-plane.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'src', 'control-plane-core.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public', 'observed-remediation-cards.js'), 'utf8');

test('control-plane facade preserves the complete core implementation', () => {
  assert.match(backend, /export \* from '.\/control-plane-core\.js'/);
  assert.match(core, /export async function screenGuardRequest/);
  assert.match(core, /export async function updateRemediationItem/);
});

test('observed Inspector closure is server-gated by latest before-after evidence', () => {
  for (const marker of [
    'observedInspectionClosureRequest',
    'latest integrity-verified inspection',
    'delta.baselineInspectionId',
    'resolvedFindings',
    'inspectionFindingActive(baselineFindings, requestedRuleId)',
    'inspectionFindingActive(latestFindings, requestedRuleId)',
    'remediation.observed_retest_accepted',
    "retestEvidenceClass: 'bounded_static_retest'",
  ]) assert.ok(backend.includes(marker), marker);
});

test('observed Inspector closure requires the exact assessment-bound case', () => {
  assert.match(backend, /CASE WHEN ac\.project_id IS NULL THEN 'runtime' ELSE 'assessment_case' END project_kind/);
  assert.match(backend, /access\.project_kind !== 'assessment_case'/);
  assert.match(backend, /access\.assessment_id !== current\.assessment_id/);
  assert.match(backend, /requires the exact assessment-bound remediation scope/);
});

test('client closure requires explicit accountable action and preserves bounded claims', () => {
  assert.match(client, /Accountable closure review/);
  assert.match(client, /Accept retest evidence and close finding/);
  assert.match(client, /observedInspectionClosure/);
  assert.match(client, /does not prove runtime behaviour or unrelated controls/);
  assert.match(client, /Verified closed/);
});
