import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/control-plane.js', import.meta.url), 'utf8');

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
