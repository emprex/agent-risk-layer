import { db, id, nowIso } from './db.js';

function failure(message, statusCode = 400, code = 'invalid_request') {
  return Object.assign(new Error(message), { statusCode, code });
}

function normalise(value) {
  return String(value || '').trim().toLowerCase();
}

async function lockedOwnerProject(projectId, userId) {
  const lock = db.kind === 'postgres' ? ' FOR UPDATE OF p' : '';
  const row = await db.prepare(`SELECT p.id,p.workspace_id,p.name,p.status,p.billing_user_id,p.created_by,m.role,
      CASE WHEN ac.project_id IS NULL THEN 'runtime' ELSE 'assessment_case' END project_kind
    FROM security_projects p
    JOIN workspace_members m ON m.workspace_id=p.workspace_id
    JOIN users actor ON actor.id=m.user_id
    LEFT JOIN owner_assessment_cases ac ON ac.project_id=p.id AND ac.workspace_id=p.workspace_id
    WHERE p.id=? AND m.user_id=? AND m.status='active'
      AND (ac.project_id IS NULL OR actor.role='superuser')${lock}`).get(projectId, userId);
  if (!row || row.role !== 'owner') {
    throw failure('Only the workspace owner can permanently delete an agent and its linked project.', 403, 'forbidden');
  }
  return row;
}

export async function deleteAgentScope({ projectId, userId, assessmentId, confirmation }) {
  const cleanProjectId = String(projectId || '').trim();
  const cleanAssessmentId = String(assessmentId || '').trim();
  if (!cleanProjectId || !cleanAssessmentId) {
    throw failure('The exact linked project and assessment are required for agent deletion.');
  }

  return db.transaction(async () => {
    const project = await lockedOwnerProject(cleanProjectId, userId);
    const assessment = await db.prepare(`SELECT id,user_id,name,agent_type FROM assessments
      WHERE id=? AND user_id=?`).get(cleanAssessmentId, userId);
    if (!assessment) throw failure('Agent assessment not found.', 404, 'not_found');

    if (String(confirmation ?? '') !== assessment.name) {
      throw failure('Type the exact agent name to confirm permanent deletion.', 400, 'confirmation_mismatch');
    }
    if (normalise(project.name) !== normalise(assessment.name)) {
      throw failure('The selected project does not match this agent. Reload the workspace before deleting anything.', 409, 'scope_mismatch');
    }

    const sameNameProjects = Number((await db.prepare(`SELECT COUNT(*) count FROM security_projects
      WHERE workspace_id=? AND lower(trim(name))=lower(trim(?))`).get(project.workspace_id, assessment.name))?.count || 0);
    if (sameNameProjects !== 1) {
      throw failure('More than one project matches this agent name. Deletion is blocked until the exact project scope is unambiguous.', 409, 'ambiguous_project_scope');
    }

    const activeMembers = Number((await db.prepare(`SELECT COUNT(*) count FROM workspace_members
      WHERE workspace_id=? AND status='active'`).get(project.workspace_id))?.count || 0);
    if (activeMembers > 1) {
      throw failure('This project is in a shared workspace. Agent deletion is blocked so one member cannot erase shared evidence. Remove or transfer shared access through owner operations first.', 409, 'shared_workspace');
    }

    const assessments = await db.prepare(`SELECT id FROM assessments
      WHERE user_id=? AND lower(trim(name))=lower(trim(?)) AND lower(trim(agent_type))=lower(trim(?))
      ORDER BY created_at DESC`).all(userId, assessment.name, assessment.agent_type);
    if (!assessments.length) throw failure('No owned assessment history was found for this agent.', 404, 'not_found');

    const assessmentIds = assessments.map((item) => item.id);
    const placeholders = assessmentIds.map(() => '?').join(',');
    const retainedValidation = Number((await db.prepare(`SELECT COUNT(*) count FROM risk_knowledge_validation_records
      WHERE assessment_id IN (${placeholders})`).get(...assessmentIds))?.count || 0);
    if (retainedValidation > 0) {
      throw failure('This agent is referenced by retained control-validation evidence. Remove or supersede that retained evidence before deleting the source assessment.', 409, 'retained_validation_evidence');
    }

    const projectDelete = await db.prepare('DELETE FROM security_projects WHERE id=?').run(project.id);
    if (Number(projectDelete.changes || 0) !== 1) {
      throw failure('The linked project changed before deletion completed. Reload and try again.', 409, 'concurrent_change');
    }

    let deletedAssessments = 0;
    for (const item of assessments) {
      const result = await db.prepare('DELETE FROM assessments WHERE id=? AND user_id=?').run(item.id, userId);
      deletedAssessments += Number(result.changes || 0);
    }
    if (deletedAssessments !== assessmentIds.length) {
      throw failure('The assessment history changed before deletion completed. No partial deletion was committed.', 409, 'concurrent_change');
    }

    await db.prepare(`INSERT INTO events (id,user_id,name,properties_json,created_at)
      VALUES (?,?,?,?,?)`).run(id('evt_'), userId, 'agent_deleted', JSON.stringify({
      projectId: project.id,
      anchorAssessmentId: assessment.id,
      assessmentCount: deletedAssessments,
      projectKind: project.project_kind,
    }), nowIso());

    return {
      deleted: true,
      projectId: project.id,
      projectDeleted: true,
      assessmentCount: deletedAssessments,
      anchorAssessmentId: assessment.id,
    };
  });
}
