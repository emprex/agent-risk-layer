import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyBoundedCheckEvidence, classifyEvidencePlan } from '../public/evidence-plan-outcomes.js';

const check = {
  id: 'approval-binding',
  title: 'Verify exact-action approval binding',
  caseId: 'RT-PI-008',
};

function run({ id='rtr_1', outcome='passed', roe='roe_1', fingerprint='a'.repeat(64), completed='2026-09-03T12:00:00.000Z', policy='policy-1', targetOrigin='https://test.example.com', mode='staging-adapter', signature=true, evidenceClass='customer-operated-controlled-adversarial-test' } = {}) {
  return {
    id,
    assessmentId: 'asm_1',
    authorisationId: roe,
    signatureValid: signature,
    policyVersion: policy,
    createdAt: completed,
    trust: { evidenceClass },
    campaign: {
      completedAt: completed,
      environment: 'staging',
      target: { mode, endpointOrigin: targetOrigin, endpointPathHash: 'b'.repeat(64), profile: null },
    },
    results: [{ caseId: 'RT-PI-008', title: 'Refund approval binding', severity: 'critical', outcome, requestFingerprint: fingerprint, confidence: 'high' }],
  };
}

test('simulation and invalid-signature runs are ignored as target evidence', () => {
  const simulation = run({ mode: 'simulation' });
  const unsigned = run({ id:'rtr_2', signature:false });
  const result = classifyBoundedCheckEvidence(check, [simulation, unsigned]);
  assert.equal(result.state, 'open');
  assert.equal(result.finding, false);
});

test('authorised failed adapter case becomes a confirmed evidence-backed failure', () => {
  const result = classifyBoundedCheckEvidence(check, [run({ outcome:'failed' })]);
  assert.equal(result.state, 'confirmed-failure');
  assert.equal(result.finding, true);
  assert.equal(result.verified, false);
});

test('inconclusive result never becomes a finding', () => {
  const result = classifyBoundedCheckEvidence(check, [run({ outcome:'inconclusive' })]);
  assert.equal(result.state, 'inconclusive');
  assert.equal(result.finding, false);
  assert.equal(result.verified, false);
});

test('passing probe without a reproduced failed baseline is supporting evidence only', () => {
  const result = classifyBoundedCheckEvidence(check, [run({ outcome:'passed' })]);
  assert.equal(result.state, 'supporting-pass');
  assert.equal(result.verified, false);
});

test('exact retest requires same ROE, target, policy, fingerprint and chronology', () => {
  const baseline = run({ id:'rtr_base', outcome:'failed', completed:'2026-09-03T10:00:00.000Z' });
  const retest = run({ id:'rtr_retest', outcome:'passed', completed:'2026-09-03T11:00:00.000Z' });
  const result = classifyBoundedCheckEvidence(check, [retest, baseline]);
  assert.equal(result.state, 'exact-retest-supported');
  assert.equal(result.baselineRun.id, 'rtr_base');
  assert.equal(result.latestRun.id, 'rtr_retest');
  assert.equal(result.verified, false);
});

test('changed fingerprint, ROE, target or policy does not qualify as exact retest', () => {
  const baseline = run({ id:'rtr_base', outcome:'failed', completed:'2026-09-03T10:00:00.000Z' });
  for (const retest of [
    run({ id:'rtr_fp', completed:'2026-09-03T11:00:00.000Z', fingerprint:'c'.repeat(64) }),
    run({ id:'rtr_roe', completed:'2026-09-03T11:00:00.000Z', roe:'roe_2' }),
    run({ id:'rtr_target', completed:'2026-09-03T11:00:00.000Z', targetOrigin:'https://other.example.com' }),
    run({ id:'rtr_policy', completed:'2026-09-03T11:00:00.000Z', policy:'policy-2' }),
  ]) {
    assert.equal(classifyBoundedCheckEvidence(check, [retest, baseline]).state, 'supporting-pass');
  }
});

test('evidence plan never converts bounded evidence into automatic deployment approval', () => {
  const baseline = run({ id:'rtr_base', outcome:'failed', completed:'2026-09-03T10:00:00.000Z' });
  const retest = run({ id:'rtr_retest', outcome:'passed', completed:'2026-09-03T11:00:00.000Z' });
  const outcome = classifyEvidencePlan({ checks:[check], manual:[] }, [retest, baseline]);
  assert.equal(outcome.completeForProceed, false);
  assert.match(outcome.limitation, /does not infer.*deployment approval/i);
});

test('Inspector hydrates full Red Team runs before classification', () => {
  const source = fs.readFileSync(new URL('../public/inspector-evidence-outcomes.js', import.meta.url), 'utf8');
  assert.match(source, /\/api\/redteam\/runs\/\$\{encodeURIComponent\(summary\.id\)\}/);
  assert.match(source, /classifyEvidencePlan\(plan, fullRuns\)/);
});

test('confirmed Red Team remediation is explicitly evidence-backed but not verified by assignment', () => {
  const source = fs.readFileSync(new URL('../public/redteam-remediation-gate.js', import.meta.url), 'utf8');
  assert.match(source, /source === 'redteam'/);
  assert.match(source, /Creating this remediation records ownership only\. It does not claim the fix is implemented or verified\./);
  assert.match(source, /item\.outcome === 'failed'/);
});

test('result journey never auto-records Proceed from a passing test', () => {
  const source = fs.readFileSync(new URL('../public/result-evidence-journey.js', import.meta.url), 'utf8');
  assert.match(source, /accountable human must still review the full evidence chain/i);
  assert.match(source, /does not automatically record Proceed/i);
  assert.doesNotMatch(source, /decision:\s*['"]proceed['"]/i);
});

test('exact retest context locks the original active Rules of Engagement or blocks', () => {
  const source = fs.readFileSync(new URL('../public/redteam-evidence-context.js', import.meta.url), 'utf8');
  assert.match(source, /select\.disabled = true/);
  assert.match(source, /Exact retest lineage cannot be preserved by silently creating a new authorisation/);
  assert.match(source, /create\.disabled = true/);
});
