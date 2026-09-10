import { db } from '../db.js';

export async function resolveSnapshotBoundActiveRemediation({
  projectId,
  systemSnapshotId
} = {}) {
  if (!projectId || !systemSnapshotId) {
    return {
      available: false,
      reason: 'authoritative_remediation_context_required'
    };
  }

  const rows = await db.prepare(`
    SELECT DISTINCT
      r.id AS finding_id,
      r.status AS finding_status,
      b.entry_id AS control_id
    FROM remediation_items r
    JOIN control_finding_bindings b
      ON b.finding_id=r.id
     AND b.project_id=r.project_id
    WHERE r.project_id=?
      AND b.system_snapshot_id=?
      AND r.status NOT IN (
        'verified_closed',
        'accepted_risk'
      )
    ORDER BY r.updated_at DESC,r.id
  `).all(
    projectId,
    systemSnapshotId
  );

  if (rows.length === 0) {
    return {
      available: false,
      reason:
        'active_authoritative_remediation_not_found'
    };
  }

  if (rows.length !== 1) {
    return {
      available: false,
      reason:
        'active_authoritative_remediation_ambiguous',
      candidateCount: rows.length
    };
  }

  return {
    available: true,
    findingId: rows[0].finding_id,
    findingStatus: rows[0].finding_status,
    controlId: rows[0].control_id
  };
}
