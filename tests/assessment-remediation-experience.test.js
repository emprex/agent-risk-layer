import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [source, intelligenceSource] = await Promise.all([
  readFile(new URL('../public/control-plane.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/control-intelligence.js', import.meta.url), 'utf8'),
]);

test('assessment remediation offers one calm bulk planning action', () => {
  assert.match(source, /Create the complete remediation plan/);
  assert.match(source, /Assign the remaining/);
  assert.match(source, /Assign \$\{remaining\.length\} remaining fix/);
  assert.match(source, /This records responsibility only/);
  assert.match(source, /defaultRemediationOwner/);
});

test('bulk planning remains assessment-bound and does not create proof', () => {
  assert.match(source, /assessmentId,/);
  assert.match(source, /findingKey: remediationFindingKey\(assessmentId, finding\)/);
  assert.doesNotMatch(source, /createBulkRemediations[\s\S]{0,1800}verified_closed/);
});

test('completion state distinguishes assignment, evidence, retest and verification', () => {
  assert.match(source, /Remediation plan created/);
  assert.match(source, /with evidence/);
  assert.match(source, /verified closed/);
  assert.match(source, /Assignment is not proof of implementation/);
  assert.match(source, /Start this fix/);
});

test('remediations are chunked into priority groups', () => {
  assert.match(source, /remediationGroup\('Do first'/);
  assert.match(source, /remediationGroup\('Harden next'/);
});

test('assessment fixes provide control-specific implementation playbooks', () => {
  assert.match(source, /const assessmentPlaybooks = Object\.freeze/);
  for (let index = 1; index <= 17; index += 1) {
    assert.match(source, new RegExp(`'F-${String(index).padStart(2, '0')}'`));
  }
  assert.match(source, /What done looks like/);
  assert.match(source, /Capture the right proof/);
  assert.match(source, /Copy checklist/);
});

test('assessment fixes do not use the generic inventory snapshot evidence prompt', () => {
  assert.match(source, /An inventory snapshot is not accepted unless it proves this exact control/);
  assert.match(source, /Record matching evidence in Control Intelligence/);
  assert.match(source, /assessmentGuide \|\|/);
});

test('evidence handoff preserves the exact assessment fix and provides a focused foundation', () => {
  assert.match(source, /assessment: assessmentId, finding: findingId, remediation: item\.id/);
  assert.match(intelligenceSource, /Create the evidence foundation once/);
  assert.match(intelligenceSource, /left anything not confirmed as unknown/);
  assert.match(intelligenceSource, /Create foundation and continue/);
  assert.match(intelligenceSource, /handoffQuery/);
  assert.match(intelligenceSource, /Return to remediation plan/);
});
