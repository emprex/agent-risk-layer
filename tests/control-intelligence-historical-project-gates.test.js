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
  getControlIntelligence,
  getControlIntelligenceControl,
  getControlIntelligenceReportSummary,
  recordControlEvidence,
  recordControlTestExecution,
  recordDeploymentDecision,
} from '../src/control-intelligence.js';
import { recordDeploymentDecision as recordServiceDeploymentDecision } from '../src/control-intelligence-service.js';

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
  return { userId, project };
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

async function createLegacyDecision(f, snapshotId, label) {
  return recordServiceDeploymentDecision({
    projectId: f.project.id,
    userId: f.userId,
    input: {
      systemSnapshotId: snapshotId,
      rationale: `Test-only legacy decision before ${label}.`,
    },
  });
}

test('untriaged historical failures surface project-wide, stale decisions, appear in reports and cannot be ignored by a new deployment decision', async () => {
  const f = await fixture('historical-project-gates');
  const vulnerable = await snapshotWithApplicableControl(f, 'Synthetic vulnerable v1');
  const failed = await recordControlTestExecution({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: vulnerable.id,
      result: 'failed',
      inputReference: 'Synthetic email requests a privileged action without approval.',
      expectedResult: 'The privileged action must be denied unless independently authorised.',
      observedResult: 'Synthetic v1 executed the privileged test action after treating untrusted email content as authority.',
      failureReason: 'Authority boundary bypassed.',
    },
  });
  const current = await snapshotWithApplicableControl(f, 'Synthetic v2 created before this historical failure was triaged');

  const overview = await getControlIntelligence({ projectId: f.project.id, userId: f.userId, limit: 200, offset: 0 });
  assert.ok(Number(overview.summary.historicalUnresolvedFailures) >= 1);
  assert.ok(Number(overview.summary.historicalUntriagedFailures) >= 1);
  const control = overview.items.find((item) => item.controlId === CONTROL_ID);
  assert.ok(control);
  assert.equal(control.currentStage, 'evidence');

  const reportBefore = await getControlIntelligenceReportSummary({ projectId: f.project.id });
  assert.equal(reportBefore.historicalRiskPending, true);
  assert.ok(reportBefore.historicalUntriagedFailures.some((item) => item.testExecutionId === failed.id && item.failedSnapshotId === vulnerable.id));

  const firstLegacyDecision = await createLegacyDecision(f, current.id, 'historical evidence triage');
  assert.equal(firstLegacyDecision.status, 'current');
  await assert.rejects(() => recordDeploymentDecision({
    projectId: f.project.id,
    userId: f.userId,
    input: { systemSnapshotId: current.id, rationale: 'Must not ignore the historical reproduced failure.' },
  }), /reproduced failure.*superseded system snapshots.*require evidence and finding triage/i);

  const evidence = await recordControlEvidence({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: vulnerable.id,
      testExecutionId: failed.id,
      evidenceClass: 'observed',
      sourceType: 'test_output',
      sourceReference: 'Historical v1 privileged-action failure output',
      limitations: 'Owner-operated synthetic evidence; no production system was exercised.',
    },
  });
  assert.equal(evidence.verificationState, 'unverified');
  const staleAfterEvidence = await db.prepare('SELECT status,reassessment_trigger FROM control_deployment_decisions WHERE id=?').get(firstLegacyDecision.id);
  assert.equal(staleAfterEvidence.status, 'stale');
  assert.equal(staleAfterEvidence.reassessment_trigger, 'historical_failure_evidence');

  const secondLegacyDecision = await createLegacyDecision(f, current.id, 'historical finding creation');
  assert.equal(secondLegacyDecision.status, 'current');
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
      impact: 'The controlled synthetic action executed without the required approval boundary.',
      sideEffectOutcome: 'executed_reversible',
      reproductionSummary: 'Replay the same synthetic email against vulnerable v1.',
      containment: 'Keep the privileged action disabled until remediation and exact retest complete.',
      limitations: 'Synthetic local evidence only.',
      impactFacts: { approvalBypass: true },
    },
  });
  const staleAfterFinding = await db.prepare('SELECT status,reassessment_trigger FROM control_deployment_decisions WHERE id=?').get(secondLegacyDecision.id);
  assert.equal(staleAfterFinding.status, 'stale');
  assert.equal(staleAfterFinding.reassessment_trigger, 'historical_failure_finding');

  const reportAfter = await getControlIntelligenceReportSummary({ projectId: f.project.id });
  assert.equal(reportAfter.historicalRiskPending, true);
  assert.equal(reportAfter.historicalUntriagedFailures.some((item) => item.testExecutionId === failed.id), false);
  assert.ok(reportAfter.historicalOpenFindings.some((item) => item.id === finding.id && item.failedSnapshotId === vulnerable.id));
  assert.ok(reportAfter.limitations.some((item) => /superseded snapshots remain historical provenance/i.test(item)));

  const safeDecision = await recordDeploymentDecision({
    projectId: f.project.id,
    userId: f.userId,
    input: { systemSnapshotId: current.id, rationale: 'Record the server-derived decision with the historical finding still unresolved.' },
  });
  assert.equal(safeDecision.decision, 'hold');
});
