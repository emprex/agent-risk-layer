import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [browserSource, serverSource] = await Promise.all([
  readFile(new URL('../public/control-plane.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/control-plane.js', import.meta.url), 'utf8'),
]);

test('assessment remediation owner is explicit and required in the browser', () => {
  assert.match(browserSource, /id="remediationOwner" type="email" required/);
  assert.match(browserSource, /Enter the person responsible for this fix\./);
  assert.match(browserSource, /data-remediation-owner-form/);
  assert.match(browserSource, /repairRemediationOwner/);
});

test('assessment remediation owner is enforced at the server boundary', () => {
  assert.match(serverSource, /input\.assessmentId && !validEmail\(suppliedOwnerEmail\)/);
  assert.match(serverSource, /A valid owner email is required for assessment remediation\./);
  assert.match(serverSource, /patch\.ownerEmail != null && !validEmail\(ownerEmail\)/);
});

test('legacy missing owners can be repaired without recreating remediation', () => {
  assert.match(browserSource, /method: 'PATCH', body: JSON\.stringify\(\{ ownerEmail \}\)/);
  assert.match(browserSource, /Edit details/);
  assert.match(browserSource, /name="severity"/);
  assert.match(browserSource, /JSON\.stringify\(\{ ownerEmail, severity:/);
});
