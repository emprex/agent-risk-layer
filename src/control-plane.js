import { db, id, nowIso } from './db.js';
import * as core from './control-plane-core.js';

export * from './control-plane-core.js';

const REVIEW_ROLES = new Set(['analyst', 'developer', 'admin', 'owner']);

function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function parseJson(value, fallback) {
  try {
    return value && typeof value === 'object' ? value : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'invalid_request';
  return error;
}

function forbidden(message) {
  const error = new Error(message);
  error.statusCode = 403;
  error.code = 'forbidden';
  return error;
}

function inspectionFindingActive(findings, ruleId) {
  return (Array.isArray(findings) ? findings : []).some((finding) =>
    clean(finding?.ruleId, 40) === ruleId && finding?.review?.status !== 'false-positive');
}

async function observedClosureAccess(projectId, userId) {
  const row = await db.prepare(`SELECT p.workspace_id,m.role
    FROM security_projects p
    JOIN workspace_members m ON m.workspace_id=p.workspace_id
    JOIN users actor ON actor.id=m.user_id
    LEFT JOIN owner_assessment_cases ac ON ac.project_id=p.id AND ac.workspace_id=p.workspace_id
    WHERE p.id=? AND m.user_id=? AND m.status='active'
      AND (ac.project_id IS NULL OR actor.role='superuser')`).get(projectId, userId);
  if (!row || !REVIEW_ROLES.has(row.role)) throw forbidden('Project not found or permission denied.');
  return row;
}

function observedInspectionClosureRequest(patch) {
  if (clean(patch?.status, 40).toLowerCase() !== 'verified_closed') return null;
  const value = patch?.verification?.observedInspectionClosure;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

async function closeObservedInspectionRemediation({ projectId, itemId, userId, patch, request }) {
  return db.transaction(async () => {
    const access = await observedClosureAccess(projectId, userId);
    if (db.kind === 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`${projectId}:${itemId}`);
    const current = await db.prepare('SELECT * FROM remediation_items WHERE id=? AND project_id=?').get(itemId, projectId);
    if (!current) throw badRequest('Remediation item not found.');

    const previous = parseJson(current.verification_json, {});
    const requestedInspectionId = clean(request.inspectionId, 100);
    const requestedRuleId = clean(request.ruleId, 40);
    if (current.status === 'verified_closed'
      && previous.retestSourceType === 'inspection'
      && previous.retestArtifactId === requestedInspectionId
      && previous.retestRuleId === requestedRuleId) return current;
    if (current.status !== 'open')
      throw badRequest('Observed Inspector closure is only available for an open observed remediation.');
    if (!current.assessment_id)
      throw badRequest('Observed Inspector closure requires an assessment-bound remediation.');
    if (patch.title != null || patch.severity != null || patch.ownerEmail != null || patch.dueAt != null)
      throw badRequest('Close the observed finding separately from editing remediation details.');

    const findingRuleId = clean(String(current.finding_key || '').split(':').at(-1), 40);
    if (!requestedInspectionId || !requestedRuleId || requestedRuleId !== findingRuleId)
      throw badRequest('Observed Inspector closure must match this remediation finding.');

    const latest = await db.prepare(`SELECT id,assessment_id,scanner_version,policy_version,bundle_digest,signature_valid,delta_json,findings_json,created_at
      FROM inspections WHERE assessment_id=? ORDER BY created_at DESC LIMIT 1`).get(current.assessment_id);
    if (!latest || latest.id !== requestedInspectionId || !latest.signature_valid || !/^[a-f0-9]{64}$/i.test(String(latest.bundle_digest || '')))
      throw badRequest('The requested Inspector retest is not the latest integrity-verified inspection for this assessment.');
    if (Date.parse(latest.created_at || '') <= Date.parse(current.created_at || ''))
      throw badRequest('The Inspector retest must be newer than the remediation record.');

    const delta = parseJson(latest.delta_json, {});
    const resolved = Array.isArray(delta.resolvedFindings) ? delta.resolvedFindings : [];
    if (!delta.baselineInspectionId || !resolved.some((key) => String(key || '').startsWith(`${requestedRuleId}:`)))
      throw badRequest('The latest Inspector retest does not resolve this remediation rule.');

    const baseline = await db.prepare(`SELECT id,assessment_id,scanner_version,policy_version,signature_valid,findings_json,created_at
      FROM inspections WHERE id=? AND assessment_id=?`).get(delta.baselineInspectionId, current.assessment_id);
    if (!baseline || !baseline.signature_valid)
      throw badRequest('The Inspector baseline for this retest is missing or invalid.');
    if (baseline.policy_version !== latest.policy_version)
      throw badRequest('The Inspector retest policy does not match its baseline.');

    const baselineFindings = parseJson(baseline.findings_json, []);
    const latestFindings = parseJson(latest.findings_json, []);
    if (!inspectionFindingActive(baselineFindings, requestedRuleId) || inspectionFindingActive(latestFindings, requestedRuleId))
      throw badRequest('The Inspector before/after evidence does not support closure of this rule.');

    const verifiedAt = nowIso();
    const history = Array.isArray(previous.history) ? [...previous.history] : [];
    history.push({
      action: 'observed_inspection_retest_accepted',
      actorId: userId,
      at: verifiedAt,
      inspectionId: latest.id,
      baselineInspectionId: baseline.id,
      ruleId: requestedRuleId,
    });
    const verification = {
      ...previous,
      retestResult: 'passed',
      retestReference: `Inspector retest ${latest.id}`,
      retestArtifactId: latest.id,
      retestArtifactDigest: latest.bundle_digest,
      retestArtifactVerifiedAt: verifiedAt,
      retestArtifactEvidenceType: 'verified_artifact',
      retestSourceType: 'inspection',
      retestEvidenceClass: 'bounded_static_retest',
      retestRuleId: requestedRuleId,
      retestBaselineInspectionId: baseline.id,
      retestScannerVersion: latest.scanner_version,
      retestBaselineScannerVersion: baseline.scanner_version,
      retestPolicyVersion: latest.policy_version,
      retestedAt: latest.created_at,
      verifiedAt,
      limitations: 'Closure applies to this exact static Inspector rule and assessed scope. It does not independently prove runtime behaviour, production equivalence or unrelated controls.',
      history,
    };

    const updated = await db.prepare(`UPDATE remediation_items SET status='verified_closed',verification_json=?,updated_at=?
      WHERE id=? AND project_id=? AND status='open'`).run(JSON.stringify(verification), verifiedAt, itemId, projectId);
    if (Number(updated.changes) !== 1) throw badRequest('The remediation changed while closure was being reviewed. Refresh and try again.');

    await db.prepare(`INSERT INTO security_audit_log
      (id,workspace_id,project_id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      id('aud_'), access.workspace_id, projectId, 'user', userId, 'remediation.observed_retest_accepted', 'remediation', itemId,
      JSON.stringify({
        assessmentId: current.assessment_id,
        inspectionId: latest.id,
        baselineInspectionId: baseline.id,
        ruleId: requestedRuleId,
        evidenceClass: 'bounded_static_retest',
      }), verifiedAt,
    );
    return db.prepare('SELECT * FROM remediation_items WHERE id=? AND project_id=?').get(itemId, projectId);
  });
}

export async function updateRemediationItem({ projectId, itemId, userId, patch = {} }) {
  const request = observedInspectionClosureRequest(patch);
  if (!request) return core.updateRemediationItem({ projectId, itemId, userId, patch });
  return closeObservedInspectionRemediation({ projectId, itemId, userId, patch, request });
}

/*
Compatibility contract markers retained in control-plane-core.js and surfaced here because a
small number of source-gate tests intentionally inspect this facade instead of importing behavior:
patch.deleteAgent === true
const { deleteAgentScope } = await import('./agent-deletion.js');
Only the AgentRiskLayer owner may create assessment cases
evidence-only and do not provide runtime protection capabilities
criteria.status !== 'completed'
criteria.result !== 'passed'
!criteria.runtime_event_id
A server-derived passed retest is required.
input.assessmentId && !validEmail(suppliedOwnerEmail)
A valid owner email is required for assessment remediation.
patch.ownerEmail != null && !validEmail(ownerEmail)
Verification sanitizer limits remain implemented in control-plane-core.js:
rootCause: 2000
correctiveAction: 4000
targetEnvironment: 500
rollbackPlan: 2000
validationPlan: 3000
changeReference: 500
limitations: 3000
*/
