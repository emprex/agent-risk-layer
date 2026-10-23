import { createHash } from 'node:crypto';
import { db, id, nowIso } from '../db.js';
import { canonicalJson, intelligenceDigest, createSystemSnapshot } from '../control-intelligence.js';
import { parseExternalManifest, validateExternalRoe } from './external-agent-assessment.mjs';
import {
  EXTERNAL_SNAPSHOT_SOURCE,
  EXTERNAL_TARGET_BINDING_SCHEMA,
  externalCandidateSnapshotInput
} from './external-agent-authoritative-import.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const REASSESSMENT_REASON =
  'External target version or material scope changed. Prior applicability and severity do not transfer; independent reassessment required.';

function gate(ok, message) {
  if (!ok) throw new Error('External target handoff blocked: ' + message);
}

export function prepareExternalTargetHandoff({
  priorSnapshot, manifestRaw, roeRaw, operator,
  expectedCurrentSnapshotId, reason, nowMs = Date.now()
}) {
  const parsed = parseExternalManifest(manifestRaw);
  validateExternalRoe(roeRaw, parsed, operator, true, nowMs);
  gate(typeof reason === 'string' && reason.trim().length >= 40 &&
    reason.trim().length <= 800,
  'operator must provide a specific 40-800 character scope-change reason');
  gate(priorSnapshot?.id === expectedCurrentSnapshotId &&
    priorSnapshot?.source === EXTERNAL_SNAPSHOT_SOURCE &&
    priorSnapshot?.status === 'current',
  'exact current external snapshot identity is required');

  const old = JSON.parse(priorSnapshot.assessment_configuration_json)?.targetBinding;
  gate(old?.schema === EXTERNAL_TARGET_BINDING_SCHEMA &&
    old?.source === 'external_https' &&
    old?.versionVerified === false,
  'current target must be external and unverified');
  gate(old.endpoint === parsed.manifest.target.endpoint,
    'endpoint changed; create a separately reviewed project and scope');
  const targetFingerprint = sha(JSON.stringify([
    parsed.manifest.target.name, parsed.manifest.target.endpoint,
    parsed.manifest.target.version
  ]));
  gate(
    old.targetFingerprint !== targetFingerprint ||
    old.manifestSha256 !== parsed.sha256,
    'no material version or manifest change: current snapshot must be reused'
  );
  const prepared = {
    candidateOnly: true,
    versionVerified: false,
    permissionsIndependentlyVerified: false,
    securityVerdict: 'none',
    endpoint: parsed.manifest.target.endpoint,
    declaredVersion: parsed.manifest.target.version,
    targetFingerprint,
    manifestSha256: parsed.sha256
  };
  const snapshotInput = externalCandidateSnapshotInput(prepared);
  snapshotInput.expectedCurrentSnapshotId = priorSnapshot.id;
  snapshotInput.assessmentConfiguration.initialContext = {
    ...snapshotInput.assessmentConfiguration.initialContext,
    previousSnapshotId: priorSnapshot.id,
    materialChangeReasonSha256: sha(reason.trim()),
    reassessmentRequired: true,
    priorEvidenceReused: false
  };
  return {
    previousSnapshotId: priorSnapshot.id,
    previousDeclaredVersion: old.declaredVersion,
    nextDeclaredVersion: parsed.manifest.target.version,
    changedVersion: old.declaredVersion !== parsed.manifest.target.version,
    changedManifest: old.manifestSha256 !== parsed.sha256,
    targetFingerprint,
    manifestSha256: parsed.sha256,
    reasonSha256: sha(reason.trim()),
    snapshotInput,
    authority: 'none',
    previousEvidenceReusable: false,
    deploymentDecision: 'hold'
  };
}

// Internal authenticated operator-context service, not a public identity-taking CLI.
// The transition records a new snapshot BEFORE any separate fresh candidate import.
// Old evidence remains historical and never becomes current-snapshot evidence.
export async function transitionExternalTarget({
  projectId, userId, manifestRaw, roeRaw, operator,
  expectedCurrentSnapshotId, reason, acknowledgeMaterialChange = false
}) {
  gate(acknowledgeMaterialChange === true,
    'explicit material-change acknowledgement is required');
  gate(typeof projectId === 'string' && /^prj_[a-f0-9]{32}$/.test(projectId) &&
    typeof userId === 'string' && /^usr_[a-f0-9]{32}$/.test(userId),
    'trusted project and operator identity required');
  gate(db.kind === 'postgres', 'PostgreSQL is required');
  return db.transaction(async () => {
    const project = await db.prepare(
      "SELECT p.id,p.workspace_id,p.environment,p.status,m.role " +
      "FROM security_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id " +
      "WHERE p.id=? AND m.user_id=? AND m.status='active' FOR UPDATE OF p"
    ).get(projectId, userId);
    gate(project && ['owner', 'admin'].includes(project.role) &&
      project.environment === 'staging' && project.status === 'active',
      'active staging project owner/admin required');

    const current = await db.prepare(
      "SELECT id,source,status,assessment_configuration_json FROM system_snapshots " +
      "WHERE workspace_id=? AND project_id=? AND status='current'"
    ).get(project.workspace_id, projectId);
    const plan = prepareExternalTargetHandoff({
      priorSnapshot: current, manifestRaw, roeRaw, operator,
      expectedCurrentSnapshotId, reason
    });
    const created = await createSystemSnapshot({
      projectId, userId, input: plan.snapshotInput
    });
    gate(created.created === true &&
      created.snapshot.status === 'current' &&
      created.snapshot.id !== current.id,
      'new material target requires a newly created current snapshot');

    // The existing generic snapshot engine copies project-level applicability and
    // risk context. For external changed versions those are stale assertions.
    // Reset all new snapshot evaluation descriptors and hashes transactionally.
    const rows = await db.prepare(
      'SELECT id,entry_id,descriptor_json FROM control_snapshot_evaluations ' +
      'WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? ORDER BY entry_id'
    ).all(project.workspace_id, projectId, created.snapshot.id);
    gate(rows.length === 108 &&
      new Set(rows.map(row => row.entry_id)).size === 108,
      'complete canonical 108-control snapshot is required');

    const evaluatedAt = nowIso();
    for (const row of rows) {
      const original = JSON.parse(row.descriptor_json);
      const descriptor = {
        ...original,
        applicabilityStatus: 'unknown',
        applicabilityReason: REASSESSMENT_REASON,
        contextualSeverity: null,
        severityStatus: 'not_evaluated',
        evaluatorId: null,
        decisionMethod: 'external_material_change_reassessment',
        evaluatedAt
      };
      const changed = await db.prepare(
        'UPDATE control_snapshot_evaluations SET applicability_status=?, ' +
        'applicability_reason=?, contextual_severity=NULL, ' +
        'severity_status=?, evaluator_id=NULL, decision_method=?, ' +
        'evaluated_at=?, descriptor_json=?, content_digest=? ' +
        'WHERE id=? AND workspace_id=? AND project_id=? AND system_snapshot_id=?'
      ).run(
        'unknown', REASSESSMENT_REASON, 'not_evaluated',
        'external_material_change_reassessment', evaluatedAt,
        canonicalJson(descriptor), intelligenceDigest(descriptor),
        row.id, project.workspace_id, projectId, created.snapshot.id
      );
      gate(Number(changed.changes) === 1,
        'evaluation reset must be complete and atomic');
    }
    // Never create, replace or approve a decision in this handoff.
    const metadata = {
      oldSnapshotId: current.id,
      newSnapshotId: created.snapshot.id,
      oldDeclaredVersion: plan.previousDeclaredVersion,
      newDeclaredVersion: plan.nextDeclaredVersion,
      changedVersion: plan.changedVersion,
      changedManifest: plan.changedManifest,
      newManifestSha256: plan.manifestSha256,
      reasonSha256: plan.reasonSha256,
      evaluationsReset: 108,
      previousEvidenceReused: false
    };
    await db.prepare(
      'INSERT INTO security_audit_log ' +
      '(id,workspace_id,project_id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(
      id('aud_'), project.workspace_id, projectId, 'user', userId,
      'external_agent.material_target_change',
      'system_snapshot', created.snapshot.id, JSON.stringify(metadata), nowIso()
    );
    return {
      schema: 'arl.external-agent-target-handoff.v1',
      projectId, ...metadata,
      priorCandidateEvidenceState: 'historical_only',
      nextCandidateEvidenceState: 'not_collected',
      applicability: 'unknown',
      controlsRequiringReassessment: 108,
      evidenceAccepted: false,
      findingsConfirmed: 0,
      deploymentDecision: 'hold',
      humanReviewRequired: true,
      versionVerified: false
    };
  });
}
