import { db } from './db.js';

const MAX_ID_LENGTH = 160;

function cleanId(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > MAX_ID_LENGTH) return '';
  return text;
}

function resolved({ workspaceId, projectId, subjectType, subjectId, row }) {
  if (!row) return null;
  return {
    authorized: true,
    workspaceId,
    projectId,
    subjectType,
    subjectId,
  };
}

/**
 * Resolve a risk-knowledge link target through authoritative AgentRiskLayer data.
 * Unsupported or not-yet-project-bound subject types fail closed.
 */
export async function resolveRiskKnowledgeSubject({ workspaceId, projectId, subjectType, subjectId }) {
  const safeWorkspaceId = cleanId(workspaceId);
  const safeProjectId = cleanId(projectId);
  const safeSubjectId = cleanId(subjectId);
  if (!safeWorkspaceId || !safeProjectId || !safeSubjectId) return null;

  let row = null;
  switch (subjectType) {
    case 'runtime_event':
      row = await db.prepare(`SELECT e.id FROM runtime_events e
        JOIN security_projects p ON p.id=e.project_id
        WHERE e.id=? AND e.project_id=? AND p.workspace_id=?`).get(safeSubjectId, safeProjectId, safeWorkspaceId);
      break;
    case 'approval':
      row = await db.prepare(`SELECT id FROM runtime_approvals
        WHERE id=? AND project_id=? AND workspace_id=?`).get(safeSubjectId, safeProjectId, safeWorkspaceId);
      break;
    case 'remediation':
      row = await db.prepare(`SELECT r.id FROM remediation_items r
        JOIN security_projects p ON p.id=r.project_id
        WHERE r.id=? AND r.project_id=? AND p.workspace_id=?`).get(safeSubjectId, safeProjectId, safeWorkspaceId);
      break;
    case 'retest':
      row = await db.prepare(`SELECT c.id FROM remediation_retest_criteria c
        JOIN runtime_events e ON e.id=c.runtime_event_id AND e.project_id=c.project_id
        WHERE c.id=? AND c.project_id=? AND c.workspace_id=? AND c.status='completed'
          AND c.result='passed' AND e.retest_satisfied=1 AND e.retest_criteria_id=c.id`).get(safeSubjectId, safeProjectId, safeWorkspaceId);
      break;
    case 'evidence_artifact': {
      const artifact = await db.prepare(`SELECT id,artifact_type,source_type,source_id FROM remediation_evidence_artifacts
        WHERE id=? AND project_id=? AND workspace_id=? AND lifecycle_state='active' AND invalidated_at IS NULL`)
        .get(safeSubjectId, safeProjectId, safeWorkspaceId);
      if (!artifact) break;
      if (artifact.source_type === 'asset_snapshot') {
        row = await db.prepare('SELECT id FROM asset_snapshots WHERE id=? AND project_id=?').get(artifact.source_id, safeProjectId);
      } else if (artifact.source_type === 'runtime_event') {
        row = artifact.artifact_type === 'retest'
          ? await db.prepare(`SELECT id FROM runtime_events WHERE id=? AND project_id=? AND retest_satisfied=1`).get(artifact.source_id, safeProjectId)
          : await db.prepare('SELECT id FROM runtime_events WHERE id=? AND project_id=?').get(artifact.source_id, safeProjectId);
      }
      break;
    }
    case 'assessment_finding':
      // The current repository stores finding identity on remediation_items.
      // Use only the exact project-scoped finding_key; never trust a caller's
      // assessment or workspace assertion.
      row = await db.prepare(`SELECT r.finding_key FROM remediation_items r
        JOIN security_projects p ON p.id=r.project_id
        WHERE r.finding_key=? AND r.project_id=? AND p.workspace_id=?`).get(safeSubjectId, safeProjectId, safeWorkspaceId);
      break;
    default:
      // inspection_finding, redteam_case and deployment_decision do not yet
      // have an authoritative project-bound record in this repository version.
      return null;
  }

  return resolved({ workspaceId: safeWorkspaceId, projectId: safeProjectId, subjectType, subjectId: safeSubjectId, row });
}
