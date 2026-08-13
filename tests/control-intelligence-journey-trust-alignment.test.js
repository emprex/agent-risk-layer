import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveControlJourney } from '../public/control-intelligence-journey.js';

function baseDetail(overrides = {}) {
  return {
    applicability: { status: 'applicable' },
    systemSnapshot: { id: 'sys_v2' },
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

test('existing finding preserves completed failure-evidence stage after evidence lifecycle changes', () => {
  const failed = {
    id: 'ctx_v1_failed',
    result: 'failed',
    executionKind: 'initial',
    systemSnapshotId: 'sys_v1',
    observedResult: 'Synthetic v1 requested the prohibited messaging tool without approval.',
  };
  const retest = {
    id: 'ctx_v2_retest',
    result: 'passed',
    executionKind: 'retest',
    retestOfExecutionId: failed.id,
    findingId: 'rem_1',
    systemSnapshotId: 'sys_v2',
    observedResult: 'Synthetic v2 did not request the prohibited messaging tool.',
  };
  const journey = deriveControlJourney(baseDetail({
    tests: [retest],
    testHistory: [retest, failed],
    evidence: [
      {
        id: 'cei_verified_pair',
        testExecutionId: retest.id,
        verificationState: 'verified',
        verificationScope: 'integrity_verified_customer_operated',
        retentionStatus: 'active',
      },
      {
        id: 'cei_legacy_retest',
        testExecutionId: retest.id,
        verificationState: 'stale',
        retentionStatus: 'active',
      },
    ],
    // The original failure evidence can be historical/stale after a snapshot change.
    // The finding itself could only have been created after the server accepted active
    // observed evidence for the reproduced failure, so the browser must not rewind.
    evidenceHistory: [],
    findings: [{ id: 'rem_1', status: 'evidence_attached' }],
  }), {
    id: 'rem_1',
    verification: {
      rootCause: 'Untrusted content was treated as authority.',
      artifactId: 'art_v2',
    },
  });

  assert.equal(journey.currentStage, 'retest');
  assert.equal(journey.stageStates.evidence, 'complete');
  assert.equal(journey.stageStates.finding, 'complete');
  assert.equal(journey.stageStates.remediation, 'complete');
  assert.equal(journey.closureRequired, true);
  assert.equal(journey.closureEvidenceVerified, true);
  assert.match(journey.nextAction, /close the finding/i);
});

test('failed test without a finding still requires observed failure evidence', () => {
  const failed = {
    id: 'ctx_failed_without_evidence',
    result: 'failed',
    executionKind: 'initial',
    systemSnapshotId: 'sys_v2',
    observedResult: 'Synthetic failure reproduced.',
  };
  const journey = deriveControlJourney(baseDetail({
    tests: [failed],
    testHistory: [failed],
  }));

  assert.equal(journey.currentStage, 'evidence');
  assert.equal(journey.stageStates.evidence, 'current');
  assert.equal(journey.stageStates.finding, 'blocked');
  assert.match(journey.nextAction, /reproduced failure/i);
});
