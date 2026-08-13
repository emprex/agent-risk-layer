import { db, id, nowIso } from './db.js';
import { canonicalJson, intelligenceDigest } from './control-intelligence-core.js';

export const REDTEAM_VERIFICATION_SCOPE = 'integrity_verified_customer_operated';
export const REDTEAM_TRUST_BOUNDARY = 'Integrity-verified redacted outcomes from a customer-operated local/test/staging run. AgentRiskLayer did not independently operate the target or retain raw transcripts.';
const BIND_ROLES = new Set(['admin', 'owner']);
const EVIDENCE_CLASS = 'test_generated';
const SOURCE_TYPE = 'redteam_run';
const SUPERSEDED_TRUST_REASON = 'Legacy verification for this exact retest is superseded by a qualifying integrity-verified customer-operated Red Team evidence binding. The historical descriptor and digest are preserved in the trust revision log.';

function error(message, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode });
}

function clean(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function parse(value, fallback) {
  try { return JSON.parse(value ?? ''); } catch { return fallback; }
}

function time(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function appendLimitation(existing, addition) {
  const current = String(existing || '').trim();
  if (!current) return addition;
  if (current.includes(addition)) return current;
  return `${current} ${addition}`;
}

function targetDescriptor(row) {
  const campaign = parse(row.campaign_json, {});
  const target = campaign?.target || {};
  return {
    mode: clean(target.mode, 40),
    environment: clean(campaign.environment, 40),
    endpointOrigin: clean(target.endpointOrigin, 300),
    endpointPathHash: clean(target.endpointPathHash, 64),
    profile: target.profile == null ? null : clean(target.profile, 120),
  };
}

function resultForCase(row, caseId) {
  const results = parse(row.results_json, []);
  return Array.isArray(results) ? results.find((item) => clean(item?.caseId, 120) === caseId) || null : null;
}

function assertRunIsUsable(row, label) {
  if (!row || Number(row.signature_valid) !== 1) throw error(`${label} red-team run is missing or does not have a valid uploaded signature.`);
  const trust = parse(row.trust_json, {});
  if (trust.evidenceClass !== 'customer-operated-controlled-adversarial-test') {
    throw error(`${label} red-team run does not have the expected customer-operated controlled-test evidence class.`);
  }
  const target = targetDescriptor(row);
  if (target.mode !== 'staging-adapter' || !['local', 'test', 'staging'].includes(target.environment) || !row.authorisation_id) {
    throw error(`${label} red-team run must be an authorised adapter-backed local/test/staging target run, not a simulation.`);
  }
  if (row.retention_expires_at && time(row.retention_expires_at) <= Date.now()) {
    throw error(`${label} red-team run is outside its retained evidence window.`);
  }
  return { trust, target };
}

function sameTarget(left, right) {
  return left.mode === right.mode
    && left.environment === right.environment
    && left.endpointOrigin === right.endpointOrigin
    && left.endpointPathHash === right.endpointPathHash
    && left.profile === right.profile;
}

export function redTeamTrustFromRow(row) {
  if (!row?.redteam_run_id) return null;
  const descriptor = parse(row.descriptor_json, {});
  if (descriptor.verificationScope !== REDTEAM_VERIFICATION_SCOPE) {
    return { state: 'unverified', reason: 'Red-team evidence is missing the required integrity-verification scope.' };
  }
  if (!row.redteam_baseline_run_id || !row.redteam_case_id
      || descriptor.redteamRunId !== row.redteam_run_id
      || descriptor.redteamBaselineRunId !== row.redteam_baseline_run_id
      || descriptor.redteamCaseId !== row.redteam_case_id) {
    return { state: 'unverified', reason: 'Red-team evidence provenance IDs do not match the integrity-bound evidence descriptor.' };
  }
  if (Number(row.redteam_signature_valid) !== 1) {
    return { state: 'unverified', reason: 'The linked red-team retest run no longer has a valid uploaded signature.' };
  }
  if (!row.redteam_bundle_digest || descriptor.sourceDigest !== row.redteam_bundle_digest) {
    return { state: 'unverified', reason: 'The linked red-team retest bundle digest does not match the evidence source digest.' };
  }
  if (Number(row.redteam_baseline_signature_valid) !== 1) {
    return { state: 'unverified', reason: 'The linked red-team failed baseline no longer has a valid uploaded signature.' };
  }
  if (!row.redteam_baseline_bundle_digest || descriptor.baselineBundleDigest !== row.redteam_baseline_bundle_digest) {
    return { state: 'unverified', reason: 'The linked red-team failed baseline digest no longer matches the integrity-bound evidence descriptor.' };
  }
  if ((row.redteam_retention_expires_at && time(row.redteam_retention_expires_at) <= Date.now())
      || (row.redteam_baseline_retention_expires_at && time(row.redteam_baseline_retention_expires_at) <= Date.now())) {
    return { state: 'stale', reason: 'A linked red-team source is outside its retained evidence window.' };
  }
  return {
    state: 'verified',
    reason: null,
    verificationScope: REDTEAM_VERIFICATION_SCOPE,
    trustBoundary: descriptor.trustBoundary || REDTEAM_TRUST_BOUNDARY,
    redteamRunId: row.redteam_run_id,
    redteamBaselineRunId: row.redteam_baseline_run_id,
    redteamCaseId: row.redteam_case_id,
  };
}

async function supersedeInvalidLegacyRetestTrust({ project, snapshot, retest, replacementEvidenceId, userId, createdAt }) {
  const rows = await db.prepare(`SELECT * FROM control_evidence_items
    WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=? AND test_execution_id=?
      AND id<>? AND verification_state='verified' AND retention_status='active' AND redteam_run_id IS NULL AND runtime_event_id IS NULL`)
    .all(project.workspace_id, project.id, snapshot.id, retest.entry_id, retest.id, replacementEvidenceId);
  for (const row of rows) {
    const predatesRetest = time(row.observed_at) != null && time(retest.completed_at) != null && time(row.observed_at) < time(retest.completed_at);
    const artifactOnly = Boolean(row.remediation_artifact_id);
    const approvalOnly = Boolean(row.approval_id);
    if (!predatesRetest && !artifactOnly && !approvalOnly) continue;

    const previousDescriptor = parse(row.descriptor_json, null);
    if (!previousDescriptor || !/^[a-f0-9]{64}$/i.test(String(row.integrity_digest || ''))) {
      throw error('Legacy retest evidence cannot be safely superseded because its previous descriptor or digest is unavailable.');
    }
    const limitations = appendLimitation(row.limitations, SUPERSEDED_TRUST_REASON);
    const nextDescriptor = {
      ...previousDescriptor,
      verificationState: 'stale',
      limitations,
      trustSupersededByEvidenceId: replacementEvidenceId,
      trustSupersededAt: createdAt,
    };
    const nextDigest = intelligenceDigest(nextDescriptor);
    const revisionDescriptor = {
      schema: 'arl.control-evidence-trust-revision.v1',
      workspaceId: project.workspace_id,
      projectId: project.id,
      evidenceId: row.id,
      replacementEvidenceId,
      previousVerificationState: row.verification_state,
      newVerificationState: 'stale',
      reason: SUPERSEDED_TRUST_REASON,
      previousIntegrityDigest: row.integrity_digest,
      actorId: userId,
      createdAt,
    };
    const revisionDigest = intelligenceDigest(revisionDescriptor);
    await db.prepare(`INSERT INTO control_evidence_trust_revisions
      (id,workspace_id,project_id,evidence_id,replacement_evidence_id,previous_verification_state,new_verification_state,reason,previous_descriptor_json,previous_integrity_digest,revision_digest,actor_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id('cetr_'), project.workspace_id, project.id, row.id, replacementEvidenceId, row.verification_state, 'stale', SUPERSEDED_TRUST_REASON,
        row.descriptor_json, row.integrity_digest, revisionDigest, userId, createdAt);
    await db.prepare('UPDATE control_evidence_items SET verification_state=?,descriptor_json=?,integrity_digest=?,limitations=? WHERE id=? AND project_id=?')
      .run('stale', canonicalJson(nextDescriptor), nextDigest, limitations, row.id, project.id);
    await db.prepare(`INSERT INTO security_audit_log
      (id,workspace_id,project_id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id('aud_'), project.workspace_id, project.id, 'user', userId, 'control_intelligence.evidence_trust_superseded', 'control_evidence', row.id,
        JSON.stringify({ replacementEvidenceId, previousVerificationState: row.verification_state, newVerificationState: 'stale', previousIntegrityDigest: row.integrity_digest, newIntegrityDigest: nextDigest, revisionDigest }), createdAt);
  }
}

export async function recordRedTeamEvidenceBinding({ projectId, controlId, userId, input = {} }) {
  const runId = clean(input.redteamRunId, 120);
  const baselineRunId = clean(input.redteamBaselineRunId, 120);
  const caseId = clean(input.redteamCaseId, 120);
  const testExecutionId = clean(input.testExecutionId, 120);
  const findingId = clean(input.findingId, 120);
  const snapshotId = clean(input.systemSnapshotId, 120);
  if (!runId || !baselineRunId || !caseId || !testExecutionId || !findingId || !snapshotId) {
    throw error('Red-team evidence binding requires the retest run, failed baseline run, case, exact retest execution, finding and current snapshot.', 400);
  }
  if (input.confirmAssessmentBinding !== true || input.confirmSnapshotBinding !== true || input.confirmTrustBoundary !== true) {
    throw error('Confirm the assessment/snapshot binding and the customer-operated trust boundary before attaching red-team evidence.', 400);
  }

  let output;
  await db.transaction(async () => {
    const lock = db.kind === 'postgres' ? ' FOR UPDATE OF p' : '';
    const project = await db.prepare(`SELECT p.*,m.role FROM security_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id
      WHERE p.id=? AND m.user_id=? AND m.status='active'${lock}`).get(projectId, userId);
    if (!project || !BIND_ROLES.has(project.role)) throw error('Project not found or permission denied.', 403);

    const snapshot = await db.prepare("SELECT * FROM system_snapshots WHERE id=? AND project_id=? AND workspace_id=? AND status='current'")
      .get(snapshotId, projectId, project.workspace_id);
    if (!snapshot) throw error('Red-team evidence must bind to the exact current system snapshot. Reload and try again.');

    const retest = await db.prepare(`SELECT * FROM control_test_executions
      WHERE id=? AND workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=?
        AND execution_kind='retest' AND result='passed'`).get(testExecutionId, project.workspace_id, projectId, snapshot.id, controlId);
    if (!retest) throw error('Bind red-team evidence only to an executed passed exact retest for this control and snapshot.');
    if (retest.finding_id !== findingId || retest.remediation_id !== findingId) throw error('The retest is not bound to the supplied finding/remediation.');

    const finding = await db.prepare('SELECT * FROM remediation_items WHERE id=? AND project_id=?').get(findingId, projectId);
    if (!finding) throw error('Finding not found for this project.');
    const original = await db.prepare(`SELECT * FROM control_test_executions
      WHERE id=? AND workspace_id=? AND project_id=? AND entry_id=? AND result='failed' AND execution_kind='initial'`)
      .get(retest.retest_of_execution_id, project.workspace_id, projectId, controlId);
    if (!original || original.id !== retest.retest_of_execution_id || original.system_snapshot_id !== retest.original_snapshot_id) {
      throw error('The exact retest does not preserve the original reproduced failure provenance.');
    }
    const implementation = await db.prepare(`SELECT id FROM remediation_evidence_artifacts
      WHERE workspace_id=? AND project_id=? AND remediation_id=? AND lifecycle_state='active' AND invalidated_at IS NULL
      ORDER BY created_at DESC LIMIT 1`).get(project.workspace_id, projectId, finding.id);
    if (!implementation) throw error('Active remediation implementation evidence is required before binding a passing red-team retest.');

    const retestRun = await db.prepare('SELECT * FROM redteam_runs WHERE id=? AND user_id=?').get(runId, project.billing_user_id);
    const baselineRun = await db.prepare('SELECT * FROM redteam_runs WHERE id=? AND user_id=?').get(baselineRunId, project.billing_user_id);
    const retestMeta = assertRunIsUsable(retestRun, 'Retest');
    const baselineMeta = assertRunIsUsable(baselineRun, 'Baseline');
    if (retestRun.assessment_id !== baselineRun.assessment_id) throw error('Baseline and retest runs must belong to the same assessment.');
    if (retestRun.authorisation_id !== baselineRun.authorisation_id) throw error('Baseline and retest runs must use the same Rules of Engagement authorisation.');
    if (!sameTarget(retestMeta.target, baselineMeta.target)) throw error('Baseline and retest runs do not describe the same authorised adapter target.');
    if (retestRun.policy_version !== baselineRun.policy_version) throw error('Baseline and retest runs must use the same red-team policy version for an exact comparison.');
    if (time(retestRun.created_at) <= time(baselineRun.created_at)) throw error('The retest run must be newer than the failed baseline run.');

    const failedCase = resultForCase(baselineRun, caseId);
    const passedCase = resultForCase(retestRun, caseId);
    if (!failedCase || clean(failedCase.outcome, 30) !== 'failed') throw error('The selected baseline case is not a reproduced failed red-team result.');
    if (!passedCase || clean(passedCase.outcome, 30) !== 'passed') throw error('The selected retest case is not a passed red-team result.');
    const failedFingerprint = clean(failedCase.requestFingerprint, 64);
    const passedFingerprint = clean(passedCase.requestFingerprint, 64);
    if (!/^[a-f0-9]{64}$/i.test(failedFingerprint) || failedFingerprint !== passedFingerprint) {
      throw error('Baseline and retest cases must have the same valid request fingerprint.');
    }
    if (clean(failedCase.title, 240) !== clean(passedCase.title, 240)) throw error('Baseline and retest case titles do not match.');

    const assessment = await db.prepare('SELECT id,user_id,name,agent_type FROM assessments WHERE id=? AND user_id=?')
      .get(retestRun.assessment_id, project.billing_user_id);
    if (!assessment) throw error('The red-team assessment is not owned by this project billing identity.');
    if (finding.assessment_id && finding.assessment_id !== assessment.id) throw error('This finding is already bound to a different assessment.');
    if (!finding.assessment_id) {
      await db.prepare('UPDATE remediation_items SET assessment_id=?,updated_at=? WHERE id=? AND project_id=? AND assessment_id IS NULL')
        .run(assessment.id, nowIso(), finding.id, projectId);
    }

    const campaign = parse(retestRun.campaign_json, {});
    const sourceObservedAt = clean(campaign.completedAt, 80) || retestRun.created_at;
    if (time(sourceObservedAt) == null) throw error('The red-team run has no valid completion timestamp.');
    const evidenceId = id('cei_');
    const createdAt = nowIso();
    const limitations = [
      REDTEAM_TRUST_BOUNDARY,
      'The exact project-snapshot association is confirmed by an authorised project admin/owner; AgentRiskLayer does not independently attest that the adapter target is equivalent to any production deployment.',
      clean(input.limitations, 1200),
    ].filter(Boolean).join(' ');
    const descriptor = {
      schema: 'arl.control-evidence.v2',
      workspaceId: project.workspace_id,
      projectId,
      systemSnapshotId: snapshot.id,
      controlId,
      evidenceClass: EVIDENCE_CLASS,
      sourceType: SOURCE_TYPE,
      sourceReference: `Red-team run ${retestRun.id} · case ${caseId} · bundle ${retestRun.bundle_digest}`,
      testExecutionId: retest.id,
      runtimeEventId: null,
      approvalId: null,
      remediationArtifactId: null,
      findingId: finding.id,
      remediationId: finding.id,
      observedAt: sourceObservedAt,
      collectorId: userId,
      sourceDigest: retestRun.bundle_digest,
      sensitivityClassification: 'internal',
      retentionStatus: 'active',
      verificationState: 'verified',
      verificationScope: REDTEAM_VERIFICATION_SCOPE,
      trustBoundary: retestMeta.trust.boundary || REDTEAM_TRUST_BOUNDARY,
      redteamRunId: retestRun.id,
      redteamBaselineRunId: baselineRun.id,
      redteamCaseId: caseId,
      baselineBundleDigest: baselineRun.bundle_digest,
      baselineOutcome: clean(failedCase.outcome, 30),
      retestOutcome: clean(passedCase.outcome, 30),
      requestFingerprint: passedFingerprint,
      responseFingerprint: clean(passedCase.responseFingerprint, 64) || null,
      snapshotBinding: {
        method: 'admin_owner_confirmed_exact_retest',
        assessmentId: assessment.id,
        systemSnapshotDigest: snapshot.content_digest,
        originalTestExecutionId: original.id,
        originalSnapshotId: original.system_snapshot_id,
        confirmationActorId: userId,
        confirmedAt: createdAt,
      },
      limitations,
    };
    const integrityDigest = intelligenceDigest(descriptor);
    await db.prepare(`INSERT INTO control_evidence_items
      (id,workspace_id,project_id,system_snapshot_id,entry_id,test_execution_id,finding_id,evidence_class,source_type,source_reference,runtime_event_id,approval_id,remediation_artifact_id,remediation_id,observed_at,collector_id,integrity_digest,descriptor_json,sensitivity_classification,retention_status,verification_state,limitations,created_at,redteam_run_id,redteam_baseline_run_id,redteam_case_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(evidenceId, project.workspace_id, projectId, snapshot.id, controlId, retest.id, finding.id, EVIDENCE_CLASS, SOURCE_TYPE,
        descriptor.sourceReference, null, null, null, finding.id, descriptor.observedAt, userId, integrityDigest, canonicalJson(descriptor),
        'internal', 'active', 'verified', limitations, createdAt, retestRun.id, baselineRun.id, caseId);

    await supersedeInvalidLegacyRetestTrust({ project, snapshot, retest, replacementEvidenceId: evidenceId, userId, createdAt });

    await db.prepare(`INSERT INTO security_audit_log
      (id,workspace_id,project_id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id('aud_'), project.workspace_id, projectId, 'user', userId, 'control_intelligence.redteam_evidence_bound', 'control_evidence', evidenceId,
        JSON.stringify({ controlId, findingId: finding.id, testExecutionId: retest.id, redteamRunId: retestRun.id, baselineRunId: baselineRun.id, caseId, verificationScope: REDTEAM_VERIFICATION_SCOPE, integrityDigest }), createdAt);

    output = {
      id: evidenceId,
      ...descriptor,
      integrityDigest,
      retentionStatus: 'active',
    };
  });
  return output;
}
