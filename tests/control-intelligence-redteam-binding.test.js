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

const CONTROL_ID = 'ARL-KB-032';
const FACT = 'input:email';
const CASE_ID = 'RT-PI-002';
const fingerprint = 'a'.repeat(64);
const randomId = (prefix) => `${prefix}${crypto.randomUUID().replaceAll('-', '')}`;
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

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

async function applicableSnapshot(f, summary) {
  const { snapshot } = await createSystemSnapshot({
    projectId: f.project.id,
    userId: f.userId,
    input: { architecture: { summary }, assessmentConfiguration: { architectureFacts: [FACT] }, source: 'test' },
  });
  const detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: CONTROL_ID, userId: f.userId });
  await assessControlApplicability({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      snapshotId: snapshot.id,
      decision: 'applicable',
      reason: 'Untrusted email content reaches this synthetic agent and remains a relevant trust boundary.',
      architectureFactIds: [FACT],
      expectedEvaluationDigest: detail.applicability.evaluationDigest,
    },
  });
  return snapshot;
}

async function lineage(f, { reassessCurrent = true } = {}) {
  const vulnerable = await applicableSnapshot(f, 'Synthetic vulnerable v1');
  const failed = await recordControlTestExecution({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: vulnerable.id,
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
      systemSnapshotId: vulnerable.id,
      testExecutionId: failed.id,
      evidenceClass: 'observed',
      sourceType: 'test_output',
      sourceReference: 'Synthetic v1 failed output',
      limitations: 'Owner-operated synthetic test evidence.',
    },
  });
  const finding = await createControlFinding({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: vulnerable.id,
      testExecutionId: failed.id,
      title: 'Synthetic indirect prompt injection authority failure',
      narrative: 'The synthetic target accepted untrusted email content as authority for a messaging action.',
      impact: 'The test demonstrated an unauthorised messaging-tool request in the synthetic target.',
      affectedAsset: 'synthetic messaging tool',
      impactFacts: { approvalBypass: true },
    },
  });
  const inventory = await recordAssetSnapshot({
    projectId: f.project.id,
    userId: f.userId,
    source: 'control-intelligence-redteam-binding-test',
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
  const current = reassessCurrent
    ? await applicableSnapshot(f, 'Synthetic remediated v2')
    : (await createSystemSnapshot({ projectId: f.project.id, userId: f.userId, input: { architecture: { summary: 'Synthetic remediated v2' }, assessmentConfiguration: { architectureFacts: [FACT] }, source: 'test' } })).snapshot;
  const retest = await recordControlTestExecution({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: current.id,
      result: 'passed',
      executionKind: 'retest',
      retestOfExecutionId: failed.id,
      findingId: finding.id,
      remediationId: finding.id,
      executionMethod: 'guided_exact_retest',
      inputReference: failed.inputReference,
      expectedResult: failed.expectedResult,
      observedResult: 'The same synthetic input produced no messaging action request.',
      limitations: 'One synthetic local trial.',
    },
  });
  return { vulnerable, failed, finding, artifact, current, retest };
}

async function redTeamPair(f) {
  const assessmentId = randomId('asm_');
  const roeId = randomId('roe_');
  const base = Date.now() - 120_000;
  const baselineCreated = new Date(base).toISOString();
  const retestCreated = new Date(base + 60_000).toISOString();
  const retention = new Date(Date.now() + 30 * 86400000).toISOString();
  await db.prepare(`INSERT INTO assessments
    (id,user_id,name,agent_type,answers_json,score,risk_band,result_json,paid_tier,access_token,share_token,public_enabled,scoring_version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'pro',?,?,0,?,?,?)`)
    .run(assessmentId, f.userId, 'Synthetic Red Team assessment', 'Test agent', '{}', 50, 'Moderate', '{}', randomId('access_'), randomId('share_'), 'arl-risk-v3.4', baselineCreated, retestCreated);
  await db.prepare(`INSERT INTO redteam_authorisations
    (id,user_id,assessment_id,target_name,endpoint_origin,environment,authority_basis,authorised_by,authorised_role,emergency_contact,window_start,window_end,permitted_actions_json,prohibited_actions_json,data_classification,retention_days,synthetic_data_only,dry_run_tools_only,status,attestation_text,accepted_at,created_at)
    VALUES (?,?,?,?,NULL,'local','owner',?,?,?,?,?,'[]','[]','synthetic-only',30,1,1,'active','I AUTHORISE CONTROLLED TESTING',?,?)`)
    .run(roeId, f.userId, assessmentId, 'Synthetic local target', 'Test Owner', 'Owner', 'owner@example.test', new Date(base - 60_000).toISOString(), new Date(Date.now() + 3600000).toISOString(), baselineCreated, baselineCreated);

  const campaign = (completedAt) => JSON.stringify({
    environment: 'local',
    startedAt: new Date(Date.parse(completedAt) - 5000).toISOString(),
    completedAt,
    target: { mode: 'staging-adapter', endpointOrigin: 'http://127.0.0.1:8787', endpointPathHash: 'c'.repeat(64), profile: null },
    authorisationId: roeId,
  });
  const trust = JSON.stringify({
    signatureValid: true,
    evidenceClass: 'customer-operated-controlled-adversarial-test',
    boundary: 'Integrity-verified redacted outcomes from a customer-operated local/test/staging run. AgentRiskLayer did not independently operate the target or retain raw transcripts.',
  });
  const baselineId = randomId('rtr_');
  const retestId = randomId('rtr_');
  const baselineDigest = digest(`${assessmentId}:baseline`);
  const retestDigest = digest(`${assessmentId}:retest`);
  const baselineResults = JSON.stringify([{ caseId: CASE_ID, title: 'Indirect injection in synthetic email', severity: 'critical', outcome: 'failed', requestFingerprint: fingerprint, responseFingerprint: 'b'.repeat(64) }]);
  const retestResults = JSON.stringify([{ caseId: CASE_ID, title: 'Indirect injection in synthetic email', severity: 'critical', outcome: 'passed', requestFingerprint: fingerprint, responseFingerprint: 'f'.repeat(64) }]);
  for (const row of [
    { id: baselineId, digest: baselineDigest, campaign: campaign(baselineCreated), results: baselineResults, createdAt: baselineCreated },
    { id: retestId, digest: retestDigest, campaign: campaign(retestCreated), results: retestResults, createdAt: retestCreated },
  ]) {
    await db.prepare(`INSERT INTO redteam_runs
      (id,user_id,assessment_id,authorisation_id,schema_version,runner_version,policy_version,bundle_digest,signature_valid,campaign_json,scope_json,summary_json,results_json,trust_json,delta_json,retention_expires_at,created_at)
      VALUES (?,?,?,?,'arl.redteam.bundle.v1','5.1.0','arl-redteam-policy-2026.09',?,1,?,'{}','{}',?,?,'{}',?,?)`)
      .run(row.id, f.userId, assessmentId, roeId, row.digest, row.campaign, row.results, trust, retention, row.createdAt);
  }
  return { assessmentId, baselineId, retestId, baselineDigest, retestDigest, retestCreated };
}

async function bind(f, chain, runs) {
  return recordControlEvidence({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: chain.current.id,
      testExecutionId: chain.retest.id,
      findingId: chain.finding.id,
      remediationId: chain.finding.id,
      redteamRunId: runs.retestId,
      redteamBaselineRunId: runs.baselineId,
      redteamCaseId: CASE_ID,
      confirmAssessmentBinding: true,
      confirmSnapshotBinding: true,
      confirmTrustBoundary: true,
      limitations: 'Synthetic test-only binding.',
    },
  });
}

test('integrity-verified Red Team baseline/retest pair binds to the exact retest without claiming independent operation', async () => {
  const f = await fixture('redteam-binding');
  const chain = await lineage(f);
  const runs = await redTeamPair(f);
  assert.ok(Date.parse(runs.retestCreated) < Date.parse(chain.retest.completedAt), 'signed source may predate retrospective CI recording');

  const legacy = await recordCoreControlEvidence({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    userId: f.userId,
    input: {
      systemSnapshotId: chain.current.id,
      testExecutionId: chain.retest.id,
      findingId: chain.finding.id,
      remediationId: chain.finding.id,
      remediationArtifactId: chain.artifact.id,
      evidenceClass: 'observed',
      sourceType: 'retest',
      sourceReference: 'Legacy artifact-promoted evidence',
    },
  });
  assert.equal(legacy.verificationState, 'verified');

  const evidence = await bind(f, chain, runs);
  assert.equal(evidence.verificationState, 'verified');
  assert.equal(evidence.verificationScope, 'integrity_verified_customer_operated');
  assert.equal(evidence.redteamRunId, runs.retestId);
  assert.equal(evidence.redteamBaselineRunId, runs.baselineId);
  assert.equal(evidence.redteamCaseId, CASE_ID);
  assert.equal(evidence.requestFingerprint, fingerprint);
  assert.equal(evidence.sourceDigest, runs.retestDigest);
  assert.match(evidence.trustBoundary, /did not independently operate the target/i);
  assert.equal(evidence.observedAt, runs.retestCreated);

  const stored = await db.prepare('SELECT redteam_run_id,redteam_baseline_run_id,redteam_case_id,verification_state FROM control_evidence_items WHERE id=?').get(evidence.id);
  assert.equal(stored.redteam_run_id, runs.retestId);
  assert.equal(stored.redteam_baseline_run_id, runs.baselineId);
  assert.equal(stored.redteam_case_id, CASE_ID);
  assert.equal(stored.verification_state, 'verified');
  assert.equal((await db.prepare('SELECT assessment_id FROM remediation_items WHERE id=?').get(chain.finding.id)).assessment_id, runs.assessmentId);

  const detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: CONTROL_ID, userId: f.userId });
  const bound = detail.evidence.find((item) => item.id === evidence.id);
  const effectiveLegacy = detail.evidence.find((item) => item.id === legacy.id);
  assert.equal(bound.verificationState, 'verified');
  assert.equal(bound.verificationScope, 'integrity_verified_customer_operated');
  assert.match(bound.trustBoundary, /did not independently operate the target/i);
  assert.equal(effectiveLegacy.verificationState, 'stale');
  const revision = await db.prepare('SELECT previous_verification_state,new_verification_state,previous_integrity_digest,replacement_evidence_id FROM control_evidence_trust_revisions WHERE evidence_id=?').get(legacy.id);
  assert.equal(revision.previous_verification_state, 'verified');
  assert.equal(revision.new_verification_state, 'stale');
  assert.equal(revision.previous_integrity_digest, legacy.integrityDigest);
  assert.equal(revision.replacement_evidence_id, evidence.id);
  assert.match(detail.chain.nextAction, /qualifying passed exact retest evidence/i);

  const finding = detail.findings.find((item) => item.id === chain.finding.id);
  const closed = await closeControlFinding({
    projectId: f.project.id,
    controlId: CONTROL_ID,
    findingId: chain.finding.id,
    userId: f.userId,
    input: {
      systemSnapshotId: chain.current.id,
      expectedUpdatedAt: finding.updatedAt,
      limitations: 'Closed only for the exact synthetic RT-PI-002 path; customer-operated run, not independent target attestation.',
    },
  });
  assert.equal(closed.status, 'verified_closed');

  const decision = await recordDeploymentDecision({
    projectId: f.project.id,
    userId: f.userId,
    input: { systemSnapshotId: chain.current.id, rationale: 'Valid replacement evidence must supersede the legacy trust exception for this exact retest.' },
  });
  assert.ok(['hold', 'do_not_deploy', 'proceed'].includes(decision.decision));
});

test('Red Team binding orders recovered evidence by signed campaign completion time, not database ingestion time', async () => {
  const f = await fixture('redteam-recovered-chronology');
  const chain = await lineage(f);
  const runs = await redTeamPair(f);

  const futureBaselineIngestion = new Date(Date.now() + 10 * 60_000).toISOString();
  await db.prepare('UPDATE redteam_runs SET created_at=? WHERE id=?').run(futureBaselineIngestion, runs.baselineId);
  const rows = await db.prepare('SELECT id,created_at,campaign_json FROM redteam_runs WHERE id IN (?,?)').all(runs.baselineId, runs.retestId);
  const baseline = rows.find((row) => row.id === runs.baselineId);
  const retest = rows.find((row) => row.id === runs.retestId);
  assert.ok(Date.parse(retest.created_at) < Date.parse(baseline.created_at), 'database ingestion order is intentionally reversed');
  assert.ok(Date.parse(JSON.parse(retest.campaign_json).completedAt) > Date.parse(JSON.parse(baseline.campaign_json).completedAt), 'signed execution chronology remains baseline then retest');

  const evidence = await bind(f, chain, runs);
  assert.equal(evidence.verificationState, 'verified');
  assert.equal(evidence.redteamRunId, runs.retestId);
  assert.equal(evidence.redteamBaselineRunId, runs.baselineId);
  assert.equal(evidence.observedAt, runs.retestCreated);
});

test('Red Team binding rejects a different request fingerprint instead of treating a non-comparable pass as closure evidence', async () => {
  const f = await fixture('redteam-mismatch');
  const chain = await lineage(f);
  const runs = await redTeamPair(f);
  const row = await db.prepare('SELECT results_json FROM redteam_runs WHERE id=?').get(runs.retestId);
  const changed = JSON.parse(row.results_json);
  changed[0].requestFingerprint = '9'.repeat(64);
  await db.prepare('UPDATE redteam_runs SET results_json=? WHERE id=?').run(JSON.stringify(changed), runs.retestId);
  await assert.rejects(() => bind(f, chain, runs), /same valid request fingerprint/i);
});

test('Red Team evidence is downgraded when its persisted provenance columns no longer match the integrity-bound descriptor', async () => {
  const f = await fixture('redteam-provenance');
  const chain = await lineage(f);
  const runs = await redTeamPair(f);
  const evidence = await bind(f, chain, runs);
  await db.prepare('UPDATE control_evidence_items SET redteam_case_id=? WHERE id=?').run('RT-OTHER-999', evidence.id);
  const detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: CONTROL_ID, userId: f.userId });
  const effective = detail.evidence.find((item) => item.id === evidence.id);
  assert.equal(effective.storedVerificationState, 'verified');
  assert.equal(effective.verificationState, 'unverified');
  assert.match(effective.trustReason, /provenance IDs do not match/i);
});


test('deployment decision treats a verified-closed exact remediation lineage as satisfied without inventing a new applicability revision', async () => {
  const f = await fixture('redteam-closed-lineage-decision');
  const chain = await lineage(f, { reassessCurrent: false });
  const raw = await db.prepare('SELECT applicability_status FROM control_snapshot_evaluations WHERE project_id=? AND system_snapshot_id=? AND entry_id=?').get(f.project.id, chain.current.id, CONTROL_ID);
  assert.equal(raw.applicability_status, 'unknown');
  const rawCounts = await db.prepare(`SELECT SUM(CASE WHEN applicability_status='applicable' THEN 1 ELSE 0 END) applicable, SUM(CASE WHEN applicability_status='unknown' THEN 1 ELSE 0 END) unknown_count FROM control_snapshot_evaluations WHERE project_id=? AND system_snapshot_id=?`).get(f.project.id, chain.current.id);
  const runs = await redTeamPair(f);
  await bind(f, chain, runs);
  const detail = await getControlIntelligenceControl({ projectId: f.project.id, controlId: CONTROL_ID, userId: f.userId });
  const finding = detail.findings.find((item) => item.id === chain.finding.id);
  await closeControlFinding({ projectId: f.project.id, controlId: CONTROL_ID, findingId: chain.finding.id, userId: f.userId, input: { systemSnapshotId: chain.current.id, expectedUpdatedAt: finding.updatedAt, limitations: 'Exact synthetic closure only.' } });
  const decision = await recordDeploymentDecision({ projectId: f.project.id, userId: f.userId, input: { systemSnapshotId: chain.current.id } });
  assert.equal(decision.decision, 'hold');
  assert.equal(decision.summary.applicableControls, Number(rawCounts.applicable) + 1);
  assert.equal(decision.summary.controlsNeedingAssessment, Number(rawCounts.unknown_count) - 1);
  assert.equal(decision.summary.verifiedClosedRemediationControls, 1);
  assert.ok(decision.summary.completedRetests >= 1);
  assert.ok(decision.reasons.includes('material_context_missing'));
  const after = await db.prepare('SELECT applicability_status FROM control_snapshot_evaluations WHERE project_id=? AND system_snapshot_id=? AND entry_id=?').get(f.project.id, chain.current.id, CONTROL_ID);
  assert.equal(after.applicability_status, 'unknown');
});
