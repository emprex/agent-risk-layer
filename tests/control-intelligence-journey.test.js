import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveControlJourney } from '../public/control-intelligence-journey.js';

const applicable = { status: 'applicable' };
const snapshot = { id: 'sys_current' };
const failed = {
  id: 'ctx_failed',
  result: 'failed',
  executionKind: 'initial',
  systemSnapshotId: 'sys_current',
  observedResult: 'Synthetic failure reproduced.',
};
const planned = {
  id: 'ctx_planned',
  result: 'planned',
  executionKind: 'initial',
  systemSnapshotId: 'sys_current',
};

function detail(overrides = {}) {
  return {
    applicability: applicable,
    systemSnapshot: snapshot,
    tests: [],
    testHistory: [],
    evidence: [],
    evidenceHistory: [],
    findings: [],
    approvals: [],
    approvalRequirements: [],
    ...overrides,
  };
}

test('a later planned test never masks an existing failed execution', () => {
  const journey = deriveControlJourney(detail({ tests: [planned, failed], testHistory: [planned, failed] }));
  assert.equal(journey.currentStage, 'evidence');
  assert.equal(journey.failedExecution.id, failed.id);
  assert.match(journey.nextAction, /reproduced failure/i);
});

test('failed execution with bound observed evidence advances to finding', () => {
  const journey = deriveControlJourney(detail({
    tests: [planned, failed],
    testHistory: [planned, failed],
    evidence: [{ id: 'cei_1', testExecutionId: failed.id, verificationState: 'unverified', retentionStatus: 'active' }],
  }));
  assert.equal(journey.currentStage, 'finding');
});

test('open finding advances to the first missing remediation substep', () => {
  const journey = deriveControlJourney(detail({
    tests: [failed],
    testHistory: [failed],
    evidence: [{ id: 'cei_1', testExecutionId: failed.id, verificationState: 'unverified', retentionStatus: 'active' }],
    findings: [{ id: 'rem_1', status: 'open' }],
  }), { id: 'rem_1', verification: {} });
  assert.equal(journey.currentStage, 'remediation');
  assert.match(journey.nextAction, /remediation plan/i);
});

test('planned-only test stays in test without creating a finding path', () => {
  const journey = deriveControlJourney(detail({ tests: [planned] }));
  assert.equal(journey.currentStage, 'test');
  assert.ok(journey.notRequiredStages.includes('finding'));
});

test('latest inconclusive completed test remains in test', () => {
  const inconclusive = { ...planned, id: 'ctx_inconclusive', result: 'inconclusive' };
  const journey = deriveControlJourney(detail({ tests: [inconclusive] }));
  assert.equal(journey.currentStage, 'test');
  assert.match(journey.nextAction, /inconclusive/i);
});

test('passed test with only unverified evidence stays in evidence', () => {
  const passed = { ...planned, id: 'ctx_passed', result: 'passed' };
  const journey = deriveControlJourney(detail({
    tests: [passed],
    evidence: [{ id: 'cei_1', testExecutionId: passed.id, verificationState: 'unverified', retentionStatus: 'active' }],
  }));
  assert.equal(journey.currentStage, 'evidence');
  assert.match(journey.nextAction, /verified evidence/i);
});

test('passed test with verified bound evidence can advance to deployment decision', () => {
  const passed = { ...planned, id: 'ctx_passed', result: 'passed' };
  const journey = deriveControlJourney(detail({
    tests: [passed],
    evidence: [{ id: 'cei_1', testExecutionId: passed.id, verificationState: 'verified', retentionStatus: 'active' }],
  }));
  assert.equal(journey.currentStage, 'deployment_decision');
  assert.equal(journey.deploymentImpact, 'satisfied');
});

test('passed exact retest with only unverified evidence keeps closure blocked', () => {
  const oldFailure = { ...failed, systemSnapshotId: 'sys_old', findingId: 'rem_1' };
  const retest = {
    id: 'ctx_retest',
    result: 'passed',
    executionKind: 'retest',
    retestOfExecutionId: oldFailure.id,
    findingId: 'rem_1',
    systemSnapshotId: 'sys_current',
  };
  const journey = deriveControlJourney(detail({
    tests: [retest],
    testHistory: [retest, oldFailure],
    evidence: [{ id: 'cei_retest', testExecutionId: retest.id, verificationState: 'unverified', retentionStatus: 'active' }],
    evidenceHistory: [{ id: 'cei_failure', testExecutionId: oldFailure.id, verificationState: 'unverified', retentionStatus: 'active' }],
    findings: [{ id: 'rem_1', status: 'evidence_attached' }],
  }), { id: 'rem_1', verification: { rootCause: 'x', artifactId: 'art_1' } });
  assert.equal(journey.currentStage, 'retest');
  assert.equal(journey.closureRequired, true);
  assert.equal(journey.closureEvidenceVerified, false);
  assert.match(journey.nextAction, /verify evidence/i);
});

test('passed exact retest needs verified retest evidence before closure review', () => {
  const oldFailure = { ...failed, systemSnapshotId: 'sys_old', findingId: 'rem_1' };
  const retest = {
    id: 'ctx_retest',
    result: 'passed',
    executionKind: 'retest',
    retestOfExecutionId: oldFailure.id,
    findingId: 'rem_1',
    systemSnapshotId: 'sys_current',
  };
  const journey = deriveControlJourney(detail({
    tests: [retest],
    testHistory: [retest, oldFailure],
    evidence: [{ id: 'cei_retest', testExecutionId: retest.id, verificationState: 'verified', retentionStatus: 'active' }],
    evidenceHistory: [{ id: 'cei_failure', testExecutionId: oldFailure.id, verificationState: 'unverified', retentionStatus: 'active' }],
    findings: [{ id: 'rem_1', status: 'evidence_attached' }],
  }), { id: 'rem_1', verification: { rootCause: 'x', artifactId: 'art_1' } });
  assert.equal(journey.currentStage, 'retest');
  assert.equal(journey.closureRequired, true);
  assert.equal(journey.closureEvidenceVerified, true);
  assert.match(journey.nextAction, /close the finding/i);
});

test('a failure bound to a closed finding is not reopened by the browser journey', () => {
  const oldFailure = { ...failed, systemSnapshotId: 'sys_old', findingId: 'rem_closed' };
  const passed = { ...planned, id: 'ctx_passed', result: 'passed' };
  const journey = deriveControlJourney(detail({
    tests: [passed],
    testHistory: [passed, oldFailure],
    evidence: [{ id: 'cei_pass', testExecutionId: passed.id, verificationState: 'verified', retentionStatus: 'active' }],
    findings: [{ id: 'rem_closed', status: 'verified_closed' }],
  }));
  assert.equal(journey.failedExecution, null);
  assert.equal(journey.currentStage, 'deployment_decision');
});
