import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, nowIso } from '../src/db.js';
import { createWorkspace } from '../src/workspaces.js';
import { createSecurityProject } from '../src/control-plane.js';
import { applyProjectRiskKnowledgeProfile } from '../src/risk-knowledge.js';
import {
  assessControlApplicability,
  createControlFinding,
  createSystemSnapshot,
  getControlIntelligenceControl,
  recordControlEvidence,
  recordControlTestExecution,
  recordDeploymentDecision,
} from '../src/control-intelligence.js';
import { recordControlTestExecution as recordCoreControlTestExecution } from '../src/control-intelligence-core.js';

const randomId = (prefix) => `${prefix}${crypto.randomUUID().replaceAll('-', '')}`;

async function fixture(label) {
  const userId = randomId('usr_');
  const timestamp = nowIso();
  await db.prepare('INSERT INTO users (id,email,password_hash,email_verified_at,created_at) VALUES (?,?,?,?,?)')
    .run(userId, `${label}-${crypto.randomUUID()}@example.test`, 'test-only', timestamp, timestamp);
  const workspace = await createWorkspace(userId, `${label} workspace`);
  const project = await createSecurityProject({ userId, workspaceId: workspace.id, name: `${label} agent`, environment: 'test' });
  await applyProjectRiskKnowledgeProfile({ workspaceId: workspace.id, projectId: project.id, architectureFacts: { uses_tools: true, is_production: false }, userId });
  return { userId, project };
}

async function applicableControl(f, controlId, fact) {
  const { snapshot } = await createSystemSnapshot({
    projectId: f.project.id,
    userId: f.userId,
    input: {
      architecture: { summary: 'Synthetic guided assessment agent' },
      assessmentConfiguration: { architectureFacts: [fact] },
      source: 'test',
    },
  });
  const before = await getControlIntelligenceControl({ projectId: f.project.id, controlId, userId: f.userId });
  await assessControlApplicability({
    projectId: f.project.id,
    controlId,
    userId: f.userId,
    input: {
      snapshotId: snapshot.id,
      decision: 'applicable',
      reason: 'The confirmed architecture includes this control-relevant capability.',
      architectureFactIds: [fact],
      expectedEvaluationDigest: before.applicability.evaluationDigest,
    },
  });
  return snapshot;
}

test('failed guided test advances on bound unverified observed evidence without promoting trust', async () => {
  const f = await fixture('failure-handoff');
  const snapshot = await applicableControl(f, 'ARL-KB-059', 'tool:code_execution');
  const failed = await recordControlTestExecution({
    projectId: f.project.id,
    controlId: 'ARL-KB-059',
    userId: f.userId,
    input: {
      systemSnapshotId: snapshot.id,
      result: 'failed',
      observedResult: 'Synthetic code wrote a reversible test file outside the expected control path.',
      expectedResult: 'State-changing code must be contained or denied before side effects.',
    },
  });

  let detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: 'ARL-KB-059', userId: f.userId });
  assert.equal(detail.chain.currentStage, 'evidence');
  await assert.rejects(() => createControlFinding({
    projectId: f.project.id,
    controlId: 'ARL-KB-059',
    userId: f.userId,
    input: {
      systemSnapshotId: snapshot.id,
      testExecutionId: failed.id,
      title: 'Synthetic containment failure',
      narrative: 'The synthetic mutation bypassed the expected execution control.',
      impact: 'A reversible test file was created outside the expected control path.',
    },
  }), /Attach active observed evidence/i);

  const evidence = await recordControlEvidence({
    projectId: f.project.id,
    controlId: 'ARL-KB-059',
    userId: f.userId,
    input: {
      systemSnapshotId: snapshot.id,
      testExecutionId: failed.id,
      evidenceClass: 'observed',
      sourceType: 'test_output',
      sourceReference: 'Synthetic owner-executed test output',
      limitations: 'Owner-executed synthetic evidence; not independently verified.',
    },
  });
  assert.equal(evidence.verificationState, 'unverified');

  detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: 'ARL-KB-059', userId: f.userId });
  assert.equal(detail.chain.currentStage, 'finding');
  assert.ok(detail.chain.completedStages.includes('evidence'));
  assert.equal(detail.evidence.find((item) => item.id === evidence.id).verificationState, 'unverified');

  const finding = await createControlFinding({
    projectId: f.project.id,
    controlId: 'ARL-KB-059',
    userId: f.userId,
    input: {
      systemSnapshotId: snapshot.id,
      testExecutionId: failed.id,
      title: 'Synthetic containment failure',
      narrative: 'The synthetic mutation bypassed the expected execution control.',
      impact: 'A reversible test file was created outside the expected control path.',
      affectedAsset: 'synthetic local filesystem',
      sideEffectOutcome: 'executed_reversible',
      reproductionSummary: 'Execute the harmless synthetic write through the code tool.',
      containment: 'Restrict the code tool until remediation and exact retest.',
    },
  });
  assert.equal(finding.status, 'open');

  detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: 'ARL-KB-059', userId: f.userId });
  assert.equal(detail.chain.currentStage, 'remediation');
  const decision = await recordDeploymentDecision({ projectId: f.project.id, userId: f.userId, input: { systemSnapshotId: snapshot.id, rationale: 'Unverified failure evidence and open finding remain unresolved.' } });
  assert.equal(decision.decision, 'hold');
  assert.equal(decision.summary.controlsWithObservedEvidence, 0);
});

test('a later planned test cannot mask an existing reproduced failure', async () => {
  const f = await fixture('failure-plan-mask');
  const snapshot = await applicableControl(f, 'ARL-KB-031', 'input:user_messages');
  const failed = await recordControlTestExecution({
    projectId: f.project.id,
    controlId: 'ARL-KB-031',
    userId: f.userId,
    input: {
      systemSnapshotId: snapshot.id,
      result: 'failed',
      inputReference: 'Synthetic direct instruction override.',
      expectedResult: 'The instruction must not change authority.',
      observedResult: 'The synthetic target changed authority and attempted the prohibited action.',
      failureReason: 'Authority changed from untrusted content.',
    },
  });

  await assert.rejects(() => recordControlTestExecution({
    projectId: f.project.id,
    controlId: 'ARL-KB-031',
    userId: f.userId,
    input: {
      systemSnapshotId: snapshot.id,
      result: 'planned',
      inputReference: 'A second plan must not hide the failure.',
    },
  }), /reproduced failure is already recorded/i);

  // Recreate the legacy state that existed before the guard so the read-path repair is regression tested.
  await recordCoreControlTestExecution({
    projectId: f.project.id,
    controlId: 'ARL-KB-031',
    userId: f.userId,
    input: {
      systemSnapshotId: snapshot.id,
      result: 'planned',
      inputReference: 'Legacy later plan recorded after the failure.',
      expectedResult: 'The original failure still controls the journey.',
    },
  });

  let detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: 'ARL-KB-031', userId: f.userId });
  assert.equal(detail.chain.currentStage, 'evidence');
  assert.match(detail.chain.nextAction, /failed test|failure/i);

  await recordControlEvidence({
    projectId: f.project.id,
    controlId: 'ARL-KB-031',
    userId: f.userId,
    input: {
      systemSnapshotId: snapshot.id,
      testExecutionId: failed.id,
      evidenceClass: 'observed',
      sourceType: 'test_output',
      sourceReference: 'Legacy-mask regression evidence',
      limitations: 'Synthetic test evidence.',
    },
  });

  detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: 'ARL-KB-031', userId: f.userId });
  assert.equal(detail.chain.currentStage, 'finding');
  assert.ok(detail.chain.completedStages.includes('evidence'));
});

test('inconclusive guided test stays in the test stage', async () => {
  const f = await fixture('inconclusive-handoff');
  const snapshot = await applicableControl(f, 'ARL-KB-031', 'input:user_messages');
  await recordControlTestExecution({
    projectId: f.project.id,
    controlId: 'ARL-KB-031',
    userId: f.userId,
    input: {
      systemSnapshotId: snapshot.id,
      result: 'inconclusive',
      observedResult: 'The synthetic attempt did not establish either safe denial or policy bypass.',
    },
  });
  const detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: 'ARL-KB-031', userId: f.userId });
  assert.equal(detail.chain.currentStage, 'test');
  assert.match(detail.chain.nextAction, /inconclusive test/i);
  assert.ok(detail.chain.notRequiredStages.includes('finding'));
});
