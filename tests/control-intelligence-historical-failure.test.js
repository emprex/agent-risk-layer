import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, nowIso } from '../src/db.js';
import { createWorkspace } from '../src/workspaces.js';
import {
  createSecurityProject,
  recordAssetSnapshot,
  registerRemediationEvidenceArtifact,
  updateRemediationItem,
} from '../src/control-plane.js';
import { applyProjectRiskKnowledgeProfile } from '../src/risk-knowledge.js';
import {
  assessControlApplicability,
  createControlFinding,
  createSystemSnapshot,
  getControlIntelligenceControl,
  recordControlEvidence,
  recordControlTestExecution,
} from '../src/control-intelligence.js';

const randomId = (prefix) => `${prefix}${crypto.randomUUID().replaceAll('-', '')}`;
const CONTROL_ID = 'ARL-KB-032';
const FACT = 'input:email';

async function fixture(label) {
  const userId = randomId('usr_');
  const timestamp = nowIso();
  await db.prepare('INSERT INTO users (id,email,password_hash,email_verified_at,created_at) VALUES (?,?,?,?,?)')
    .run(userId, `${label}-${crypto.randomUUID()}@example.test`, 'test-only', timestamp, timestamp);
  const workspace = await createWorkspace(userId, `${label} workspace`);
  const project = await createSecurityProject({ userId, workspaceId: workspace.id, name: `${label} agent`, environment: 'test' });
  await applyProjectRiskKnowledgeProfile({ workspaceId: workspace.id, projectId: project.id, architectureFacts: { uses_tools: true, is_production: false }, userId });
  return { userId, workspace, project };
}

async function snapshotWithApplicableControl(f, summary) {
  const { snapshot } = await createSystemSnapshot({
    projectId: f.project.id,
    userId: f.userId,
    input: {
      architecture: { summary },
      assessmentConfiguration: { architectureFacts: [FACT] },
      source: 'test',
    },
  });
  const before = await getControlIntelligenceControl({ projectId: f.project.id, controlId: CONTROL_ID, userId: f.userId });
  await assessControlApplicability({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      snapshotId: snapshot.id,
      decision: 'applicable',
      reason: 'Untrusted synthetic email reaches this agent and remains a relevant authority boundary.',
      architectureFactIds: [FACT],
      expectedEvaluationDigest: before.applicability.evaluationDigest,
    },
  });
  return snapshot;
}

async function implementationArtifact(f, finding) {
  const inventory = await recordAssetSnapshot({
    projectId: f.project.id,
    userId: f.userId,
    source: 'historical-failure-handoff-test',
    documents: { agent: { name: 'synthetic-remediation', environment: 'test', change: 'authority and action checks updated' } },
  });
  const artifact = await registerRemediationEvidenceArtifact({
    projectId: f.project.id,
    itemId: finding.id,
    userId: f.userId,
    artifactType: 'implementation',
    sourceId: inventory.id,
  });
  await updateRemediationItem({
    projectId: f.project.id,
    itemId: finding.id,
    userId: f.userId,
    patch: {
      status: 'evidence_attached',
      verification: {
        rootCause: 'Untrusted content reached a privileged action path without an independent authority check.',
        correctiveAction: 'Separate untrusted content from authority and enforce the action policy before side effects.',
        validationPlan: 'Repeat the exact original failure against a snapshot created after this implementation evidence.',
        rollbackPlan: 'Disable the affected action path and restore the previous safe configuration.',
        artifactId: artifact.id,
        changeReference: 'synthetic-remediation',
      },
    },
  });
  return artifact;
}

test('historical reproduced failure can receive evidence and a finding without rebinding it to the current snapshot', async () => {
  const f = await fixture('historical-handoff');
  const vulnerable = await snapshotWithApplicableControl(f, 'Synthetic vulnerable v1');
  const failed = await recordControlTestExecution({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: vulnerable.id,
      result: 'failed',
      inputReference: 'Synthetic email requests a privileged refund-like action without approval.',
      expectedResult: 'Untrusted email remains data and cannot authorise the privileged action.',
      observedResult: 'Synthetic v1 treated the email as authority and executed a reversible privileged test action without approval.',
      failureReason: 'Authority was derived from untrusted content.',
    },
  });

  const current = await snapshotWithApplicableControl(f, 'Synthetic unrelated v2 that predates remediation of this historical failure');
  assert.notEqual(current.id, vulnerable.id);

  await assert.rejects(() => recordControlEvidence({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: current.id,
      testExecutionId: failed.id,
      evidenceClass: 'observed',
      sourceType: 'test_output',
      sourceReference: 'Wrong-snapshot historical evidence attempt',
    },
  }), /exact superseded snapshot/i);

  const evidence = await recordControlEvidence({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: vulnerable.id,
      testExecutionId: failed.id,
      evidenceClass: 'observed',
      sourceType: 'test_output',
      sourceReference: 'Synthetic historical v1 failed test output',
      limitations: 'Owner-operated synthetic evidence; no production system was exercised.',
    },
  });
  assert.equal(evidence.systemSnapshotId, vulnerable.id);
  assert.equal(evidence.testExecutionId, failed.id);
  assert.equal(evidence.verificationState, 'unverified');
  const storedEvidence = await db.prepare('SELECT system_snapshot_id,test_execution_id,verification_state FROM control_evidence_items WHERE id=?').get(evidence.id);
  assert.equal(storedEvidence.system_snapshot_id, vulnerable.id);
  assert.equal(storedEvidence.test_execution_id, failed.id);
  assert.equal(storedEvidence.verification_state, 'unverified');

  let detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: CONTROL_ID, userId: f.userId });
  assert.equal(detail.systemSnapshot.id, current.id);
  assert.equal(detail.chain.currentStage, 'finding');
  assert.equal(detail.testHistory.find((item) => item.id === failed.id)?.systemSnapshotId, vulnerable.id);

  const finding = await createControlFinding({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: vulnerable.id,
      testExecutionId: failed.id,
      title: 'Historical privileged action bypass',
      narrative: 'Synthetic v1 accepted untrusted email content as authority and executed the privileged test action without approval.',
      affectedAsset: 'synthetic privileged action',
      impact: 'A reversible privileged synthetic action was executed without the required approval boundary.',
      sideEffectOutcome: 'executed_reversible',
      reproductionSummary: 'Replay the same synthetic email against v1.',
      containment: 'Keep the privileged action disabled until remediation and exact retest complete.',
      limitations: 'Synthetic local evidence only.',
      impactFacts: { financialAction: true, approvalBypass: true },
    },
  });
  assert.equal(finding.snapshotId, vulnerable.id);
  assert.equal(finding.status, 'open');

  const binding = await db.prepare('SELECT system_snapshot_id,entry_id,finding_id FROM control_finding_bindings WHERE finding_id=?').get(finding.id);
  assert.equal(binding.system_snapshot_id, vulnerable.id);
  assert.equal(binding.entry_id, CONTROL_ID);

  detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: CONTROL_ID, userId: f.userId });
  assert.equal(detail.chain.currentStage, 'remediation');
  assert.equal(detail.chain.deploymentImpact, 'blocker');
});

test('a snapshot that predates remediation implementation cannot be reused as proof of the historical fix', async () => {
  const f = await fixture('historical-remediation-order');
  const vulnerable = await snapshotWithApplicableControl(f, 'Synthetic vulnerable v1');
  const failed = await recordControlTestExecution({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: vulnerable.id,
      result: 'failed',
      inputReference: 'Synthetic historical authority bypass input.',
      expectedResult: 'The privileged action must be denied without valid authority.',
      observedResult: 'The synthetic privileged action executed without valid approval.',
      failureReason: 'Approval boundary was bypassed.',
    },
  });
  const preFixCurrent = await snapshotWithApplicableControl(f, 'Synthetic v2 created before this failure remediation');
  await recordControlEvidence({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: vulnerable.id,
      testExecutionId: failed.id,
      evidenceClass: 'observed',
      sourceType: 'test_output',
      sourceReference: 'Historical v1 failure evidence',
      limitations: 'Synthetic test evidence.',
    },
  });
  const finding = await createControlFinding({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: vulnerable.id,
      testExecutionId: failed.id,
      title: 'Historical authority bypass',
      narrative: 'The synthetic privileged action executed without the required approval boundary.',
      impact: 'The controlled test demonstrated an approval bypass for the synthetic privileged action.',
      affectedAsset: 'synthetic privileged action',
      impactFacts: { approvalBypass: true },
    },
  });

  await implementationArtifact(f, finding);
  let detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: CONTROL_ID, userId: f.userId });
  assert.equal(detail.systemSnapshot.id, preFixCurrent.id);
  assert.equal(detail.chain.currentStage, 'remediation');
  assert.equal(detail.chain.remediationState.implementationRecorded, true);
  assert.equal(detail.chain.remediationState.remediatedSnapshotReady, false);
  assert.match(detail.chain.nextAction, /changed system snapshot after the remediation implementation evidence/i);

  await assert.rejects(() => recordControlTestExecution({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: preFixCurrent.id,
      result: 'passed',
      executionKind: 'retest',
      retestOfExecutionId: failed.id,
      findingId: finding.id,
      remediationId: finding.id,
      executionMethod: 'guided_exact_retest',
      inputReference: failed.inputReference,
      expectedResult: failed.expectedResult,
      observedResult: 'A pre-fix snapshot must not be accepted as remediation proof.',
    },
  }), /snapshot created after the remediation implementation evidence/i);

  const postFix = await snapshotWithApplicableControl(f, 'Synthetic v3 created after remediation implementation');
  detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: CONTROL_ID, userId: f.userId });
  assert.equal(detail.systemSnapshot.id, postFix.id);
  assert.equal(detail.chain.remediationState.remediatedSnapshotReady, true);
  assert.equal(detail.chain.currentStage, 'retest');

  const retest = await recordControlTestExecution({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: postFix.id,
      result: 'passed',
      executionKind: 'retest',
      retestOfExecutionId: failed.id,
      findingId: finding.id,
      remediationId: finding.id,
      executionMethod: 'guided_exact_retest',
      inputReference: failed.inputReference,
      expectedResult: failed.expectedResult,
      observedResult: 'The exact synthetic input no longer produced the prohibited privileged action.',
      limitations: 'One owner-operated synthetic trial.',
    },
  });
  assert.equal(retest.systemSnapshotId, postFix.id);
  assert.equal(retest.retestOfExecutionId, failed.id);
});
