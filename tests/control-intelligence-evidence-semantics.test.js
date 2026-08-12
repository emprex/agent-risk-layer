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
  closeControlFinding,
  createControlFinding,
  createSystemSnapshot,
  getControlIntelligenceControl,
  recordControlEvidence,
  recordControlTestExecution,
  recordDeploymentDecision,
} from '../src/control-intelligence.js';
import { recordControlEvidence as recordCoreControlEvidence } from '../src/control-intelligence-core.js';

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
      reason: 'Untrusted email content reaches this synthetic agent and remains a relevant trust boundary.',
      architectureFactIds: [FACT],
      expectedEvaluationDigest: before.applicability.evaluationDigest,
    },
  });
  return snapshot;
}

async function vulnerableFinding(f) {
  const snapshot = await snapshotWithApplicableControl(f, 'Synthetic vulnerable v1');
  const failed = await recordControlTestExecution({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: snapshot.id,
      result: 'failed',
      inputReference: 'Synthetic email attempts to instruct a messaging action.',
      expectedResult: 'Untrusted email remains data and cannot authorise the action.',
      observedResult: 'Synthetic target requested the messaging action without valid parameter-bound approval.',
      failureReason: 'Untrusted content crossed the authority boundary.',
    },
  });
  await recordControlEvidence({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: snapshot.id,
      testExecutionId: failed.id,
      evidenceClass: 'observed',
      sourceType: 'test_output',
      sourceReference: 'Synthetic v1 failed test output',
      limitations: 'Owner-operated synthetic test evidence.',
    },
  });
  const finding = await createControlFinding({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: snapshot.id,
      testExecutionId: failed.id,
      title: 'Synthetic indirect prompt injection authority failure',
      narrative: 'The synthetic target accepted untrusted email content as authority for a messaging action.',
      impact: 'The test demonstrated an unauthorised messaging-tool request in the synthetic target.',
      affectedAsset: 'synthetic messaging tool',
      impactFacts: { approvalBypass: true },
    },
  });
  return { snapshot, failed, finding };
}

async function implementationArtifact(f, finding) {
  const inventory = await recordAssetSnapshot({
    projectId: f.project.id,
    userId: f.userId,
    source: 'control-intelligence-evidence-semantics-test',
    documents: { agent: { name: 'synthetic-v2', environment: 'test', change: 'untrusted input no longer grants messaging authority' } },
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
    patch: { status: 'evidence_attached', verification: { artifactId: artifact.id, changeReference: 'synthetic-v2' } },
  });
  return artifact;
}

async function passedRetest(f, lineage) {
  const artifact = await implementationArtifact(f, lineage.finding);
  const current = await snapshotWithApplicableControl(f, 'Synthetic remediated v2');
  const retest = await recordControlTestExecution({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: current.id,
      result: 'passed',
      executionKind: 'retest',
      retestOfExecutionId: lineage.failed.id,
      findingId: lineage.finding.id,
      remediationId: lineage.finding.id,
      executionMethod: 'guided_exact_retest',
      inputReference: lineage.failed.inputReference,
      expectedResult: lineage.failed.expectedResult,
      observedResult: 'The same synthetic input produced no messaging action request.',
      limitations: 'One synthetic local trial.',
    },
  });
  return { artifact, current, retest };
}

test('implementation artifacts cannot verify a test-bound retest observation or backdate it', async () => {
  const f = await fixture('artifact-trust');
  const lineage = await vulnerableFinding(f);
  const { artifact, current, retest } = await passedRetest(f, lineage);

  const evidence = await recordControlEvidence({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: current.id,
      testExecutionId: retest.id,
      findingId: lineage.finding.id,
      remediationId: lineage.finding.id,
      remediationArtifactId: artifact.id,
      evidenceClass: 'observed',
      sourceType: 'retest',
      sourceReference: 'Owner-entered exact retest result',
      limitations: 'Synthetic customer-operated retest.',
    },
  });

  assert.equal(evidence.verificationState, 'unverified');
  assert.equal(evidence.remediationArtifactId, null);
  assert.equal(evidence.observedAt, retest.completedAt);
  assert.match(evidence.limitations, /implementation artifact proves that a change artifact exists/i);
  const stored = await db.prepare('SELECT verification_state,remediation_artifact_id,observed_at FROM control_evidence_items WHERE id=?').get(evidence.id);
  assert.equal(stored.verification_state, 'unverified');
  assert.equal(stored.remediation_artifact_id, null);
  assert.equal(stored.observed_at, retest.completedAt);

  await assert.rejects(() => recordControlEvidence({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: current.id,
      testExecutionId: retest.id,
      evidenceClass: 'observed',
      sourceType: 'retest',
      sourceReference: 'Impossible backdated retest observation',
      observedAt: new Date(Date.parse(retest.completedAt) - 60_000).toISOString(),
    },
  }), /cannot precede completion of the linked test/i);
});

test('legacy artifact-only verified retest evidence is treated as unverified and cannot close or support deployment', async () => {
  const f = await fixture('legacy-artifact-trust');
  const lineage = await vulnerableFinding(f);
  const { artifact, current, retest } = await passedRetest(f, lineage);

  const legacy = await recordCoreControlEvidence({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: current.id,
      testExecutionId: retest.id,
      findingId: lineage.finding.id,
      remediationId: lineage.finding.id,
      remediationArtifactId: artifact.id,
      evidenceClass: 'observed',
      sourceType: 'retest',
      sourceReference: 'Legacy artifact-promoted retest evidence',
    },
  });
  assert.equal(legacy.verificationState, 'verified', 'the regression fixture reproduces the legacy stored state');
  assert.ok(Date.parse(legacy.observedAt) <= Date.parse(retest.completedAt));

  const detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: CONTROL_ID, userId: f.userId });
  const effective = detail.evidence.find((item) => item.id === legacy.id);
  assert.equal(effective.storedVerificationState, 'verified');
  assert.equal(effective.verificationState, 'unverified');
  assert.match(effective.trustReason, /implementation artifact|predates completion/i);
  assert.equal(detail.chain.currentStage, 'retest');
  assert.match(detail.chain.nextAction, /verify evidence/i);
  assert.ok(detail.chain.notRequiredStages.includes('approval'));

  await assert.rejects(() => closeControlFinding({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    findingId: lineage.finding.id,
    userId: f.userId,
    input: { systemSnapshotId: current.id, expectedUpdatedAt: detail.findings.find((item) => item.id === lineage.finding.id).updatedAt, limitations: 'Synthetic one-trial retest.' },
  }), /source that actually proves the exact retest outcome/i);

  await assert.rejects(() => recordDeploymentDecision({
    projectId: f.project.id,
    userId: f.userId,
    input: { systemSnapshotId: current.id, rationale: 'Legacy verification semantics must not support a decision.' },
  }), /legacy evidence whose stored verification is not valid/i);
});
