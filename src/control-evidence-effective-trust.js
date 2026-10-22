// Shared effective evidence trust policy for operator review and deployment readiness.
// The stored verification state is immutable history, NOT necessarily current trust.
import { db } from './db.js';
import { redTeamTrustFromRow } from './control-redteam-trust-policy.js';

export const IMPLEMENTATION_TRUST_LIMIT = 'A remediation implementation artifact proves that a change artifact exists; it does not verify the observed test or retest outcome.';
export const APPROVAL_TRUST_LIMIT = 'An approval record verifies the approval event; by itself it does not verify the observed test or retest outcome.';
const TEMPORAL_TRUST_LIMIT = 'Evidence cannot verify a test outcome when its observed timestamp predates completion of the linked test.';


function parseTime(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function effectiveEvidenceTrust(row) {
  const storedState = row?.verification_state || row?.verificationState || 'unverified';
  if (storedState !== 'verified') return { state: storedState, reason: null };

  if (row?.redteam_run_id || row?.redteamRunId) {
    return redTeamTrustFromRow(row) || { state: 'unverified', reason: 'The linked red-team evidence could not be validated.' };
  }

  const observedAt = parseTime(row.observed_at || row.observedAt);
  const completedAt = parseTime(row.completed_at || row.completedAt);
  if (row.test_execution_id || row.testExecutionId) {
    if (completedAt != null && (observedAt == null || observedAt < completedAt)) {
      return { state: 'unverified', reason: TEMPORAL_TRUST_LIMIT };
    }
    const runtimeId = row.runtime_event_id || row.runtimeEventId;
    const approvalId = row.approval_id || row.approvalId;
    const artifactId = row.remediation_artifact_id || row.remediationArtifactId;
    if (artifactId && !runtimeId) return { state: 'unverified', reason: IMPLEMENTATION_TRUST_LIMIT };
    if (approvalId && !runtimeId) return { state: 'unverified', reason: APPROVAL_TRUST_LIMIT };
  }

  const artifactId = row.remediation_artifact_id || row.remediationArtifactId;
  const runtimeId = row.runtime_event_id || row.runtimeEventId;
  const approvalId = row.approval_id || row.approvalId;
  if (artifactId && !runtimeId && !approvalId) {
    return { state: 'unverified', reason: IMPLEMENTATION_TRUST_LIMIT };
  }
  return { state: 'verified', reason: null };
}

export async function evidenceTrustRows(projectId, snapshotId, controlId = null) {
  if (!projectId || !snapshotId) return [];
  const controlFilter = controlId ? ' AND e.entry_id=?' : '';
  const params = controlId ? [projectId, snapshotId, controlId] : [projectId, snapshotId];
  return db.prepare(`SELECT e.id,e.entry_id,e.verification_state,e.retention_status,e.remediation_artifact_id,e.runtime_event_id,e.approval_id,e.observed_at,e.test_execution_id,e.descriptor_json,
      e.redteam_run_id,e.redteam_baseline_run_id,e.redteam_case_id,t.completed_at,
      r.signature_valid AS redteam_signature_valid,r.bundle_digest AS redteam_bundle_digest,r.retention_expires_at AS redteam_retention_expires_at,
      rb.signature_valid AS redteam_baseline_signature_valid,rb.bundle_digest AS redteam_baseline_bundle_digest,rb.retention_expires_at AS redteam_baseline_retention_expires_at
    FROM control_evidence_items e
    LEFT JOIN control_test_executions t ON t.id=e.test_execution_id AND t.project_id=e.project_id
    LEFT JOIN redteam_runs r ON r.id=e.redteam_run_id
    LEFT JOIN redteam_runs rb ON rb.id=e.redteam_baseline_run_id
    WHERE e.project_id=? AND e.system_snapshot_id=?${controlFilter}`)
    .all(...params);
}
