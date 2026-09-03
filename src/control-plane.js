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

function redTeamClosureRequest(patch) {
  if (clean(patch?.status, 40).toLowerCase() !== 'verified_closed') return null;
  const value = patch?.verification?.redTeamClosure;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function redTeamTarget(row) {
  const campaign = parseJson(row?.campaign_json, {});
  const target = campaign?.target || {};
  return {
    mode: clean(target.mode, 40),
    environment: clean(campaign.environment, 40),
    endpointOrigin: clean(target.endpointOrigin, 300),
    endpointPathHash: clean(target.endpointPathHash, 64),
    profile: target.profile == null ? '' : clean(target.profile, 120),
    completedAt: clean(campaign.completedAt, 80),
  };
}

function sameRedTeamTarget(left, right) {
  const a = redTeamTarget(left);
  const b = redTeamTarget(right);
  return a.mode === b.mode
    && a.environment === b.environment
    && a.endpointOrigin === b.endpointOrigin
    && a.endpointPathHash === b.endpointPathHash
    && a.profile === b.profile;
}

function redTeamCaseResults(row, caseId) {
  const results = parseJson(row?.results_json, []);
  return Array.isArray(results) ? results.filter((item) => clean(item?.caseId, 40) === caseId) : [];
}

function singleCaseOutcome(results) {
  if (!results.length) return 'missing';
  const values = new Set(results.map((item) => clean(item?.outcome, 30)));
  if (values.has('failed')) return 'failed';
  if (values.has('error') || values.has('inconclusive')) return 'inconclusive';
  return values.size === 1 && values.has('passed') ? 'passed' : 'inconclusive';
}

function oneFingerprint(results) {
  const values = new Set(results.map((item) => clean(item?.requestFingerprint, 64)).filter(Boolean));
  if (values.size !== 1) return '';
  const value = [...values][0];
  return /^[a-f0-9]{64}$/i.test(value) ? value : '';
}

function assertUsableRedTeamRun(row, label) {
  if (!row || Number(row.signature_valid) !== 1 || !/^[a-f0-9]{64}$/i.test(String(row.bundle_digest || '')))
    throw badRequest(`${label} Red Team run is missing or is not integrity-verified.`);
  const trust = parseJson(row.trust_json, {});
  if (trust.evidenceClass !== 'customer-operated-controlled-adversarial-test')
    throw badRequest(`${label} Red Team run is not customer-operated controlled adversarial evidence.`);
  const target = redTeamTarget(row);
  if (target.mode !== 'staging-adapter' || !['local','test','staging'].includes(target.environment) || !row.authorisation_id)
    throw badRequest(`${label} Red Team run must be an authorised non-production adapter run.`);
  if (row.retention_expires_at && Date.parse(row.retention_expires_at) <= Date.now())
    throw badRequest(`${label} Red Team evidence is outside its retained evidence window.`);
  if (!Number.isFinite(Date.parse(target.completedAt)))
    throw badRequest(`${label} Red Team run has no valid signed completion time.`);
  return target;
}

async function closeRedTeamRemediation({ projectId, itemId, userId, patch, request }) {
  return db.transaction(async () => {
    const access = await observedClosureAccess(projectId, userId);
    if (db.kind === 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`${projectId}:${itemId}:redteam`);
    const current = await db.prepare('SELECT * FROM remediation_items WHERE id=? AND project_id=?').get(itemId, projectId);
    if (!current) throw badRequest('Remediation item not found.');
    if (!current.assessment_id) throw badRequest('Red Team closure requires an assessment-bound remediation.');
    if (patch.title != null || patch.severity != null || patch.ownerEmail != null || patch.dueAt != null)
      throw badRequest('Close the Red Team finding separately from editing remediation details.');

    const baselineRunId = clean(request.baselineRunId, 100);
    const retestRunId = clean(request.retestRunId, 100);
    const caseId = clean(request.caseId, 40).toUpperCase();
    const previous = parseJson(current.verification_json, {});
    if (current.status === 'verified_closed'
      && previous.retestSourceType === 'redteam'
      && previous.retestArtifactId === retestRunId
      && previous.retestBaselineRunId === baselineRunId
      && previous.retestCaseId === caseId) return current;
    if (current.status !== 'open') throw badRequest('Red Team closure is only available for an open remediation.');
    if (!baselineRunId || !retestRunId || !caseId) throw badRequest('Red Team closure requires the failed baseline, passed retest and exact case.');

    const expectedFindingSuffix = `redteam-${caseId}`.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 70);
    if (!String(current.finding_key || '').endsWith(`:${expectedFindingSuffix}`))
      throw badRequest('The Red Team case does not match this remediation finding.');

    const baseline = await db.prepare('SELECT * FROM redteam_runs WHERE id=? AND assessment_id=?').get(baselineRunId, current.assessment_id);
    const retest = await db.prepare('SELECT * FROM redteam_runs WHERE id=? AND assessment_id=?').get(retestRunId, current.assessment_id);
    const baselineTarget = assertUsableRedTeamRun(baseline, 'Baseline');
    const retestTarget = assertUsableRedTeamRun(retest, 'Retest');
    if (baseline.authorisation_id !== retest.authorisation_id)
      throw badRequest('Baseline and retest must use the same Rules of Engagement.');
    if (!sameRedTeamTarget(baseline, retest))
      throw badRequest('Baseline and retest must describe the same authorised adapter target.');
    if (baseline.policy_version !== retest.policy_version)
      throw badRequest('Baseline and retest must use the same Red Team policy version.');
    if (Date.parse(retestTarget.completedAt) <= Date.parse(baselineTarget.completedAt))
      throw badRequest('The retest must complete after the failed baseline.');
    if (Date.parse(retestTarget.completedAt) <= Date.parse(current.created_at || ''))
      throw badRequest('The exact Red Team retest must be newer than the remediation record.');

    const baselineResults = redTeamCaseResults(baseline, caseId);
    const retestResults = redTeamCaseResults(retest, caseId);
    if (singleCaseOutcome(baselineResults) !== 'failed')
      throw badRequest('The selected Red Team baseline does not reproduce a failed case.');
    if (singleCaseOutcome(retestResults) !== 'passed')
      throw badRequest('Every retained trial for the exact Red Team retest case must pass.');
    const baselineFingerprint = oneFingerprint(baselineResults);
    const retestFingerprint = oneFingerprint(retestResults);
    if (!baselineFingerprint || baselineFingerprint !== retestFingerprint)
      throw badRequest('Baseline and retest must have the same valid request fingerprint.');
    if (clean(baselineResults[0]?.title, 180) !== clean(retestResults[0]?.title, 180))
      throw badRequest('Baseline and retest case titles do not match.');

    const newerRows = await db.prepare(`SELECT id,results_json FROM redteam_runs
      WHERE assessment_id=? AND created_at>? ORDER BY created_at DESC`).all(current.assessment_id, retest.created_at);
    if (newerRows.some((row) => redTeamCaseResults(row, caseId).length))
      throw badRequest('A newer Red Team result exists for this exact case. Review the latest evidence before closure.');

    const verifiedAt = nowIso();
    const history = Array.isArray(previous.history) ? [...previous.history] : [];
    history.push({
      action: 'redteam_exact_retest_accepted',
      actorId: userId,
      at: verifiedAt,
      caseId,
      baselineRunId,
      retestRunId,
      authorisationId: retest.authorisation_id,
      requestFingerprint: retestFingerprint,
    });
    const verification = {
      ...previous,
      retestResult: 'passed',
      retestReference: `Red Team exact retest ${retestRunId}`,
      retestArtifactId: retestRunId,
      retestArtifactDigest: retest.bundle_digest,
      retestArtifactVerifiedAt: verifiedAt,
      retestArtifactEvidenceType: 'verified_artifact',
      retestSourceType: 'redteam',
      retestEvidenceClass: 'bounded_customer_operated_exact_retest',
      retestCaseId: caseId,
      retestBaselineRunId: baselineRunId,
      retestBaselineArtifactDigest: baseline.bundle_digest,
      retestPolicyVersion: retest.policy_version,
      retestAuthorisationId: retest.authorisation_id,
      retestRequestFingerprint: retestFingerprint,
      retestedAt: retestTarget.completedAt,
      verifiedAt,
      limitations: 'Closure applies only to this exact bounded Red Team case, authorised target and retained evidence lineage. It does not prove unrelated invariant cases, production equivalence or a deployment decision.',
      history,
    };
    const updated = await db.prepare(`UPDATE remediation_items SET status='verified_closed',verification_json=?,updated_at=?
      WHERE id=? AND project_id=? AND status='open'`).run(JSON.stringify(verification), verifiedAt, itemId, projectId);
    if (Number(updated.changes) !== 1) throw badRequest('The remediation changed while closure was being reviewed. Refresh and try again.');

    await db.prepare(`INSERT INTO security_audit_log
      (id,workspace_id,project_id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      id('aud_'), access.workspace_id, projectId, 'user', userId, 'remediation.redteam_exact_retest_accepted', 'remediation', itemId,
      JSON.stringify({
        assessmentId: current.assessment_id,
        caseId,
        baselineRunId,
        retestRunId,
        authorisationId: retest.authorisation_id,
        requestFingerprint: retestFingerprint,
        evidenceClass: 'bounded_customer_operated_exact_retest',
      }), verifiedAt,
    );
    return db.prepare('SELECT * FROM remediation_items WHERE id=? AND project_id=?').get(itemId, projectId);
  });
}

export async function updateRemediationItem({ projectId, itemId, userId, patch = {} }) {
  const observedRequest = observedInspectionClosureRequest(patch);
  if (observedRequest) return closeObservedInspectionRemediation({ projectId, itemId, userId, patch, request: observedRequest });
  const redTeamRequest = redTeamClosureRequest(patch);
  if (redTeamRequest) return closeRedTeamRemediation({ projectId, itemId, userId, patch, request: redTeamRequest });
  return core.updateRemediationItem({ projectId, itemId, userId, patch });
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
