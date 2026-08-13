import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deriveControlJourney } from '../public/control-intelligence-journey.js';

const failed = {
  id: 'ctx_v1_historical_failure',
  result: 'failed',
  executionKind: 'initial',
  systemSnapshotId: 'sys_v1',
  observedResult: 'Synthetic v1 executed a prohibited privileged action.',
  expectedResult: 'The action must be denied without valid authority.',
};

function detail(overrides = {}) {
  return {
    applicability: { status: 'applicable' },
    systemSnapshot: { id: 'sys_v2' },
    tests: [],
    testHistory: [failed],
    evidence: [],
    evidenceHistory: [],
    findings: [],
    approvals: [],
    approvalRequirements: [],
    chain: {},
    ...overrides,
  };
}

test('browser journey advances historical failure from historical evidence without rewriting its snapshot', () => {
  const journey = deriveControlJourney(detail({
    evidenceHistory: [{
      id: 'cei_v1',
      testExecutionId: failed.id,
      systemSnapshotId: failed.systemSnapshotId,
      verificationState: 'unverified',
      retentionStatus: 'active',
    }],
  }));
  assert.equal(journey.currentStage, 'finding');
  assert.equal(journey.failedExecution.id, failed.id);
  assert.equal(journey.failedExecution.systemSnapshotId, 'sys_v1');
  assert.ok(journey.completedStages.includes('evidence'));
});

test('server remediation chronology prevents browser from treating a pre-fix snapshot as remediated', () => {
  const finding = { id: 'rem_hist', status: 'evidence_attached' };
  const remediationRecord = {
    id: finding.id,
    verification: {
      rootCause: 'Untrusted data crossed the authority boundary.',
      correctiveAction: 'Enforce an independent action policy.',
      validationPlan: 'Repeat the exact failure.',
      artifactId: 'art_fix',
    },
  };
  const blocked = deriveControlJourney(detail({
    findings: [finding],
    evidenceHistory: [{ id: 'cei_v1', testExecutionId: failed.id, verificationState: 'unverified', retentionStatus: 'active' }],
    chain: { remediationState: { implementationRecorded: true, remediatedSnapshotReady: false } },
  }), remediationRecord);
  assert.equal(blocked.currentStage, 'remediation');
  assert.equal(blocked.remediation.implementationSaved, true);
  assert.equal(blocked.remediation.remediatedSnapshot, false);
  assert.match(blocked.nextAction, /changed system snapshot after the implementation evidence/i);

  const ready = deriveControlJourney(detail({
    systemSnapshot: { id: 'sys_v3' },
    findings: [finding],
    evidenceHistory: [{ id: 'cei_v1', testExecutionId: failed.id, verificationState: 'unverified', retentionStatus: 'active' }],
    chain: { remediationState: { implementationRecorded: true, remediatedSnapshotReady: true } },
  }), remediationRecord);
  assert.equal(ready.currentStage, 'retest');
});

test('changed remediation snapshot does not rewind an unresolved historical finding to applicability', () => {
  const finding = { id: 'rem_hist', status: 'evidence_attached' };
  const remediationRecord = {
    id: finding.id,
    verification: {
      rootCause: 'Untrusted data crossed the authority boundary.',
      correctiveAction: 'Require exact action authorisation.',
      validationPlan: 'Repeat the exact historical failure.',
      artifactId: 'art_fix',
    },
  };

  const journey = deriveControlJourney(detail({
    applicability: {},
    systemSnapshot: { id: 'sys_v3' },
    findings: [finding],
    evidenceHistory: [{
      id: 'cei_v1',
      testExecutionId: failed.id,
      systemSnapshotId: failed.systemSnapshotId,
      verificationState: 'unverified',
      retentionStatus: 'active',
    }],
    chain: { remediationState: { implementationRecorded: true, remediatedSnapshotReady: true } },
  }), remediationRecord);

  assert.equal(journey.currentStage, 'retest');
  assert.equal(journey.failedExecution.id, failed.id);
  assert.equal(journey.finding.id, finding.id);
  assert.ok(journey.completedStages.includes('applicability'));
  assert.ok(journey.completedStages.includes('remediation'));
  assert.match(journey.nextAction, /exact original failure/i);
});

test('a changed snapshot without an unresolved failure still requires a fresh applicability decision', () => {
  const journey = deriveControlJourney(detail({
    applicability: {},
    tests: [],
    testHistory: [],
    evidence: [],
    evidenceHistory: [],
    findings: [],
    chain: {},
  }));

  assert.equal(journey.currentStage, 'applicability');
  assert.ok(!journey.completedStages.includes('applicability'));
});

test('historical evidence and finding submissions use the failed execution snapshot, not the current snapshot', () => {
  const source = fs.readFileSync(new URL('../public/control-intelligence-control.js', import.meta.url), 'utf8');
  assert.match(source, /systemSnapshotId:\s*execution\.systemSnapshotId\s*\|\|\s*data\.systemSnapshot\.id/);
  assert.match(source, /systemSnapshotId:\s*failed\.systemSnapshotId\s*\|\|\s*data\.systemSnapshot\.id/);
  assert.match(source, /Historical failure provenance/);
});
