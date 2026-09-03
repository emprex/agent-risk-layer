import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const backend = fs.readFileSync(path.join(root, 'src', 'control-plane.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public', 'redteam-remediation-cards.js'), 'utf8');

test('Red Team remediation closure is server-gated by exact retained before-after evidence', () => {
  for (const marker of [
    'redTeamClosureRequest',
    'closeRedTeamRemediation',
    'Baseline and retest must use the same Rules of Engagement.',
    'Baseline and retest must describe the same authorised adapter target.',
    'Baseline and retest must use the same Red Team policy version.',
    'The exact Red Team retest must be newer than the remediation record.',
    'Every retained trial for the exact Red Team retest case must pass.',
    'Baseline and retest must have the same valid request fingerprint.',
    'A newer Red Team result exists for this exact case.',
    'remediation.redteam_exact_retest_accepted',
    "retestEvidenceClass: 'bounded_customer_operated_exact_retest'",
  ]) assert.ok(backend.includes(marker), marker);
});

test('Red Team server closure refuses to turn unrelated evidence into verification', () => {
  assert.match(backend, /expectedFindingSuffix/);
  assert.match(backend, /redteam-\$\{caseId\}/);
  assert.match(backend, /trust\.evidenceClass !== 'customer-operated-controlled-adversarial-test'/);
  assert.match(backend, /target\.mode !== 'staging-adapter'/);
  assert.match(backend, /retention_expires_at/);
  assert.match(backend, /Closure applies only to this exact bounded Red Team case/);
});

test('client requires accountable review before exact retest closes a finding', () => {
  assert.match(client, /Accountable closure review/);
  assert.match(client, /Accept exact retest evidence and close finding/);
  assert.match(client, /redTeamClosure/);
  assert.match(client, /same case, Rules of Engagement, authorised target, policy version and request fingerprint/i);
  assert.match(client, /It is not proof of unrelated controls, production equivalence or a deployment decision/);
  assert.match(client, /Verified closed/);
});
