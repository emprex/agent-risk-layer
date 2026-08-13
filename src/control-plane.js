import crypto from 'node:crypto';
import { db, id, nowIso } from './db.js';
import { config } from './config.js';
import { approvalTokenDigest, issueApproval, runtimeApprovalActionDigest, verifyApproval } from './access-control.js';
import { compileRuntimePolicy, evaluateRuntimeAction, runtimeActionRequiresApproval } from './runtime-policy.js';
import { inspectContent } from './content-security.js';
import { discoverAiAssets } from './asset-discovery.js';
import { deliverSecurityEventSystem } from './workspaces.js';
import { subscriptionAccessDecision } from './subscription-access.js';
import { prepareRiskKnowledgeRuntimeEvidencePurge, prepareRiskKnowledgeSubjectPurge } from './risk-knowledge.js';
import { prepareControlIntelligenceSourcePurge } from './control-intelligence.js';
import { PLAN_ENTITLEMENTS } from './commercial-catalogue.js';

export const GUARD_REQUEST_SCHEMA = 'arl.guard.request.v1';
export const GUARD_RESPONSE_SCHEMA = 'arl.guard.response.v1';
export const GUIDED_PROTECTION_CHECK_SCHEMA = 'arl.guided-protection-check.v1';

export { PLAN_ENTITLEMENTS };

export const PROJECT_KINDS = Object.freeze({ RUNTIME: 'runtime', ASSESSMENT_CASE: 'assessment_case' });

const PROJECT_ENVIRONMENTS = new Set(['development', 'test', 'staging', 'production']);
const PROJECT_STATUSES = new Set(['active', 'paused', 'archived']);
const REMEDIATION_STATUSES = new Set(['open', 'evidence_attached', 'ready_for_retest', 'retested', 'verified_closed', 'accepted_risk', 'evidence_upgrade_required']);
const REMEDIATION_TRANSITIONS = Object.freeze({
  open: new Set(['evidence_attached', 'accepted_risk']),
  evidence_attached: new Set(['open', 'ready_for_retest']),
  ready_for_retest: new Set(['evidence_attached', 'retested']),
  retested: new Set(['ready_for_retest', 'verified_closed']),
  verified_closed: new Set(['open']),
  accepted_risk: new Set(['open']),
  evidence_upgrade_required: new Set(['ready_for_retest', 'open']),
});
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const MANAGE_ROLES = new Set(['developer', 'admin', 'owner']);
const REVIEW_ROLES = new Set(['analyst', 'developer', 'admin', 'owner']);
const APPROVER_ROLES = new Set(['admin', 'owner']);

export async function entitlementForUser(userId) {
  const subscriptions = await db.prepare(`SELECT plan_key,status,current_period_end,authoritative_state,reconciliation_required,updated_at
    FROM subscriptions WHERE user_id=? ORDER BY updated_at DESC`).all(userId);
  const subscription = subscriptions.find((candidate) => subscriptionAccessDecision(candidate).allowed) || null;
  const requested = subscription?.plan_key || 'community';
  const key = PLAN_ENTITLEMENTS[requested] ? requested : 'community';
  return { key, ...PLAN_ENTITLEMENTS[key], subscription: subscription || null };
}

export async function createSecurityProject({ userId, workspaceId, name, environment = 'development', projectKind = PROJECT_KINDS.RUNTIME }) {
  const membership = await workspaceMembership(workspaceId, userId);
  if (!membership || !MANAGE_ROLES.has(membership.role)) throw forbidden('Workspace developer, admin or owner access is required.');
  const cleanName = clean(name, 100);
  if (cleanName.length < 2) throw badRequest('Project name must contain at least two characters.');
  const cleanEnvironment = PROJECT_ENVIRONMENTS.has(environment) ? environment : 'development';
  const normalizedProjectKind = clean(projectKind, 40).toLowerCase() || PROJECT_KINDS.RUNTIME;
  if (!Object.values(PROJECT_KINDS).includes(normalizedProjectKind)) throw badRequest('Unknown project kind.');
  const assessmentCase = normalizedProjectKind === PROJECT_KINDS.ASSESSMENT_CASE;
  if (assessmentCase && (membership.role !== 'owner' || !await isPlatformSuperuser(userId))) {
    throw forbidden('Only the AgentRiskLayer owner may create assessment cases.');
  }
  const billingUserId = await workspaceBillingUser(workspaceId);
  const entitlement = await entitlementForUser(billingUserId);
  if (!assessmentCase) {
    const projectCount = Number((await db.prepare(`SELECT COUNT(*) count FROM security_projects p
      WHERE p.billing_user_id=? AND p.status!='archived'
        AND NOT EXISTS (SELECT 1 FROM owner_assessment_cases c WHERE c.project_id=p.id)`).get(billingUserId)).count || 0);
    if (projectCount >= entitlement.projects) throw paymentRequired(`${entitlement.name} supports ${entitlement.projects} active project${entitlement.projects === 1 ? '' : 's'}. Upgrade to add another.`);
  }
  const projectId = id('prj_');
  const timestamp = nowIso();
  const slug = await availableSlug(workspaceId, slugify(cleanName));
  const policy = compileRuntimePolicy(defaultProjectPolicy(cleanEnvironment));
  const policyDigest = policyIdentityDigest(policy, projectId);
  await db.transaction(async () => {
    await db.prepare(`INSERT INTO security_projects
      (id,workspace_id,billing_user_id,created_by,name,slug,environment,status,policy_json,policy_version,policy_digest,policy_published_at,retention_days,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'active',?,?,?,?,?,?,?)`)
      .run(projectId, workspaceId, billingUserId, userId, cleanName, slug, cleanEnvironment, JSON.stringify(policy), policy.version, policyDigest, timestamp,
        Math.min(entitlement.retentionDays, cleanEnvironment === 'production' ? 90 : entitlement.retentionDays), timestamp, timestamp);
    if (assessmentCase) {
      await db.prepare(`INSERT INTO owner_assessment_cases (project_id,workspace_id,created_by,created_at) VALUES (?,?,?,?)`)
        .run(projectId, workspaceId, userId, timestamp);
    }
    await audit({ workspaceId, projectId, actorType: 'user', actorId: userId, action: 'project.created', targetType: 'project', targetId: projectId,
      metadata: { environment: cleanEnvironment, projectKind: normalizedProjectKind } });
  });
  return getSecurityProject({ projectId, userId });
}

export async function listSecurityProjects(userId) {
  const rows = await db.prepare(`SELECT p.*,m.role,
      CASE WHEN ac.project_id IS NULL THEN 'runtime' ELSE 'assessment_case' END project_kind,
      (SELECT COUNT(*) FROM project_api_keys k WHERE k.project_id=p.id AND k.revoked_at IS NULL) api_key_count,
      (SELECT COUNT(*) FROM runtime_events e WHERE e.project_id=p.id AND e.created_at>=?) runtime_requests_month,
      (SELECT COUNT(*) FROM runtime_events e WHERE e.project_id=p.id AND e.decision='deny' AND e.created_at>=?) denied_month,
      (SELECT MAX(created_at) FROM runtime_events e WHERE e.project_id=p.id) last_runtime_event_at,
      (SELECT MAX(created_at) FROM asset_snapshots a WHERE a.project_id=p.id) last_inventory_at,
      (SELECT summary_json FROM asset_snapshots a WHERE a.project_id=p.id ORDER BY created_at DESC LIMIT 1) latest_inventory_summary,
      (SELECT COUNT(*) FROM remediation_items r WHERE r.project_id=p.id AND r.status NOT IN ('verified','closed','verified_closed','accepted_risk')) open_remediations
    FROM security_projects p
    JOIN workspace_members m ON m.workspace_id=p.workspace_id
    JOIN users actor ON actor.id=m.user_id
    LEFT JOIN owner_assessment_cases ac ON ac.project_id=p.id AND ac.workspace_id=p.workspace_id
    WHERE m.user_id=? AND m.status='active'
      AND (ac.project_id IS NULL OR actor.role='superuser')
    ORDER BY p.created_at DESC`).all(monthStart(), monthStart(), userId);
  return Promise.all(rows.map(async (row) => {
    const keys = await db.prepare('SELECT expires_at,revoked_at FROM project_api_keys WHERE project_id=?').all(row.id);
    return publicProject({ ...row, api_key_count: keys.filter((key) => apiKeyStatus(key) === 'active').length });
  }));
}

export async function getSecurityProject({ projectId, userId }) {
  const access = await projectAccess(projectId, userId);
  if (!access) throw forbidden('Project not found or access denied.');
  const entitlement = await entitlementForUser(access.project.billing_user_id);
  const usage = await projectUsage(projectId);
  const result = {
    ...publicProject({ ...access.project, role: access.role }),
    permissions: permissionsFor(access.role),
    entitlement: publicEntitlement(entitlement, usage),
    apiKeys: await listProjectApiKeys({ projectId, userId }),
    approvals: await listRuntimeApprovals({ projectId, userId, limit: 25 }),
    events: await listRuntimeEvents({ projectId, userId, limit: 50 }),
    inventory: await listAssetSnapshots({ projectId, userId, limit: 10 }),
    remediations: await listRemediationItems({ projectId, userId }),
    audit: await listProjectAudit({ projectId, userId, limit: 40 }),
  };
  result.journey = projectJourney(result);
  return result;
}

export async function updateSecurityProject({ projectId, userId, patch = {} }) {
  const access = await requireProjectRole(projectId, userId, MANAGE_ROLES);
  const current = access.project;
  const name = patch.name == null ? current.name : clean(patch.name, 100);
  if (name.length < 2) throw badRequest('Project name must contain at least two characters.');
  const environment = patch.environment == null ? current.environment : clean(patch.environment, 20).toLowerCase();
  if (!PROJECT_ENVIRONMENTS.has(environment)) throw badRequest('Unknown project environment.');
  const status = patch.status == null ? current.status : clean(patch.status, 20).toLowerCase();
  if (!PROJECT_STATUSES.has(status)) throw badRequest('Unknown project status.');
  const previousPolicy = parseJson(current.policy_json, {});
  const nextVersion = String(Number.parseInt(current.policy_version || '1', 10) + 1);
  const policyInput = patch.policy ? { ...previousPolicy, ...patch.policy, version: nextVersion } : { ...previousPolicy, version: current.policy_version || '1' };
  const policy = compileRuntimePolicy(policyInput);
  const policyDigest = policyIdentityDigest(policy, projectId);
  const entitlement = await entitlementForUser(current.billing_user_id);
  const requestedRetention = patch.retentionDays == null ? Number(current.retention_days) : Number(patch.retentionDays);
  const retentionDays = Math.max(1, Math.min(entitlement.retentionDays, Number.isFinite(requestedRetention) ? Math.trunc(requestedRetention) : entitlement.retentionDays));
  const timestamp = nowIso();
  const policyPublishedAt = patch.policy ? timestamp : current.policy_published_at;
  await db.prepare(`UPDATE security_projects SET name=?,environment=?,status=?,policy_json=?,policy_version=?,policy_digest=?,policy_published_at=?,retention_days=?,updated_at=? WHERE id=?`)
    .run(name, environment, status, JSON.stringify(policy), policy.version, policyDigest, policyPublishedAt, retentionDays, timestamp, projectId);
  await audit({ workspaceId: current.workspace_id, projectId, actorType: 'user', actorId: userId, action: patch.policy ? 'policy.updated' : 'project.updated', targetType: 'project', targetId: projectId,
    metadata: { environment, status, policyVersion: policy.version, retentionDays } });
  return getSecurityProject({ projectId, userId });
}

export async function createProjectApiKey({ projectId, userId, name = 'Runtime key', expiresAt = null }) {
  await assertRuntimeProject({ projectId, userId });
  const access = await requireProjectRole(projectId, userId, MANAGE_ROLES);
  const entitlement = await entitlementForUser(access.project.billing_user_id);
  const existingKeys = await db.prepare('SELECT expires_at,revoked_at FROM project_api_keys WHERE project_id=?').all(projectId);
  const activeCount = existingKeys.filter((key) => apiKeyStatus(key) === 'active').length;
  if (activeCount >= entitlement.apiKeysPerProject) throw paymentRequired(`${entitlement.name} supports ${entitlement.apiKeysPerProject} active API keys per project.`);
  let cleanExpiry = null;
  if (expiresAt) {
    const value = Date.parse(expiresAt);
    if (!Number.isFinite(value) || value <= Date.now() + 60000) throw badRequest('API key expiry must be a future timestamp.');
    cleanExpiry = new Date(value).toISOString();
  }
  const prefix = crypto.randomBytes(5).toString('hex');
  const raw = `arl_live_${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
  const keyId = id('key_');
  const timestamp = nowIso();
  await db.prepare(`INSERT INTO project_api_keys (id,project_id,name,key_prefix,token_hash,created_by,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(keyId, projectId, clean(name, 100) || 'Runtime key', prefix, digest(raw), userId, timestamp, cleanExpiry);
  await audit({ workspaceId: access.project.workspace_id, projectId, actorType: 'user', actorId: userId, action: 'api_key.created', targetType: 'api_key', targetId: keyId, metadata: { prefix, expiresAt: cleanExpiry } });
  return { id: keyId, name: clean(name, 100) || 'Runtime key', prefix, token: raw, createdAt: timestamp, expiresAt: cleanExpiry,
    status: 'active', usable: true, shownOnce: true };
}

export async function listProjectApiKeys({ projectId, userId }) {
  await requireProjectRole(projectId, userId, new Set(['viewer', 'analyst', 'developer', 'admin', 'owner']));
  const rows = await db.prepare(`SELECT id,name,key_prefix,created_at,expires_at,last_used_at,revoked_at
    FROM project_api_keys WHERE project_id=? ORDER BY created_at DESC`).all(projectId);
  return rows.map((key) => ({ ...key, status: apiKeyStatus(key), usable: apiKeyStatus(key) === 'active' }));
}

export async function revokeProjectApiKey({ projectId, keyId, userId }) {
  const access = await requireProjectRole(projectId, userId, MANAGE_ROLES);
  const result = await db.prepare(`UPDATE project_api_keys SET revoked_at=? WHERE id=? AND project_id=? AND revoked_at IS NULL`).run(nowIso(), keyId, projectId);
  if (Number(result.changes) !== 1) throw notFound('Active API key not found.');
  await audit({ workspaceId: access.project.workspace_id, projectId, actorType: 'user', actorId: userId, action: 'api_key.revoked', targetType: 'api_key', targetId: keyId });
  return { ok: true };
}


export async function createRuntimeApproval({ projectId, userId, toolCall, ttlSeconds = 600, controlId = null, systemSnapshotId = null }) {
  await assertRuntimeProject({ projectId, userId });
  if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) throw badRequest('An exact tool call is required for approval.');
  const tool = clean(toolCall.name || toolCall.tool, 200).toLowerCase();
  if (!tool) throw badRequest('Tool identity is required for approval.');
  const args = Object.hasOwn(toolCall, 'arguments') ? toolCall.arguments : (Object.hasOwn(toolCall, 'args') ? toolCall.args : {});
  const approvalId = id('apr_');
  const lifetime = Math.max(30, Math.min(3600, Number(ttlSeconds) || 600));
  let output;
  await db.transaction(async()=>{
  const access = await requireProjectRole(projectId, userId, APPROVER_ROLES, true);
  const actionDigest = runtimeApprovalActionDigest({workspaceId:access.project.workspace_id,projectId:access.project.id,environment:access.project.environment,tool,arguments:args});
  const token = issueApproval({
    approvalId,
    workspaceId: access.project.workspace_id,
    projectId: access.project.id,
    actionDigest,
    tool,
    environment: access.project.environment,
  }, config.sessionSecret, lifetime);
  const verified = verifyApproval(token, { approvalId }, config.sessionSecret);
  if (!verified.valid) throw new Error('New approval failed integrity verification.');
  const issuedAt = verified.approval.issuedAt;
  const expiresAt = verified.approval.expiresAt;
  await db.prepare(`INSERT INTO runtime_approvals
    (id,workspace_id,project_id,approver_id,tool_name,environment,action_digest,token_digest,status,issued_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?, 'active',?,?)`)
    .run(approvalId, access.project.workspace_id, access.project.id, userId, tool, access.project.environment,
      actionDigest, approvalTokenDigest(token), issuedAt, expiresAt);
  const snapshot = await db.prepare("SELECT id FROM system_snapshots WHERE workspace_id=? AND project_id=? AND status='current' ORDER BY created_at DESC LIMIT 1")
    .get(access.project.workspace_id, access.project.id);
  if(systemSnapshotId&&snapshot?.id!==clean(systemSnapshotId,100))throw conflict('The approval snapshot is stale; reload before approving.');
  if(snapshot&&controlId){const entryId=clean(controlId,80);const evaluation=await db.prepare('SELECT id FROM control_snapshot_evaluations WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=?').get(access.project.workspace_id,projectId,snapshot.id,entryId);if(!evaluation)throw notFound('Current snapshot control evaluation not found.');const requirement=await db.prepare('SELECT * FROM control_approval_requirements WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=? AND action_type=?').get(access.project.workspace_id,projectId,snapshot.id,entryId,tool);if(!requirement)throw conflict('No exact server-owned approval requirement exists for this control and snapshot.');const requirementDescriptor=parseJson(requirement.descriptor_json,null);if(!requirementDescriptor||digest(canonicalJson(requirementDescriptor))!==requirement.requirement_digest)throw conflict('Approval requirement integrity verification failed.');const actualScope={action:tool,parameters:args,target:args?.target??null,value:args?.value??args?.amount??null,currency:clean(args?.currency,12).toUpperCase()||null,actor:requirementDescriptor.actor||null,policyVersion:access.project.policy_version,policyDigest:access.project.policy_digest||null};const requiredScope={action:requirementDescriptor.action,parameters:requirementDescriptor.parameters,target:requirementDescriptor.target,value:requirementDescriptor.value,currency:requirementDescriptor.currency,actor:requirementDescriptor.actor,policyVersion:requirementDescriptor.policyVersion,policyDigest:requirementDescriptor.policyDigest};if(canonicalJson(actualScope)!==canonicalJson(requiredScope))throw conflict('Approval exact action, parameters, target, value, currency, actor or policy context does not match the server requirement.');const descriptor={schema:'arl.control-runtime-binding.v2',workspaceId:access.project.workspace_id,projectId,systemSnapshotId:snapshot.id,entryId,approvalId,approvalRequirementId:requirement.id,requirementDigest:requirement.requirement_digest,actionDigest:requirement.action_digest,bindingType:'exact_action_approval',createdAt:issuedAt};await db.prepare(`INSERT INTO control_snapshot_runtime_bindings
    (id,workspace_id,project_id,system_snapshot_id,entry_id,approval_id,approval_requirement_id,binding_type,descriptor_json,content_digest,created_at)
    VALUES (?,?,?,?,?,?,?,'exact_action_approval',?,?,?)`).run(id('crb_'), access.project.workspace_id, access.project.id, snapshot.id,entryId, approvalId,requirement.id,canonicalJson(descriptor),digest(canonicalJson(descriptor)),issuedAt);}
  await audit({ workspaceId: access.project.workspace_id, projectId: access.project.id, actorType: 'user', actorId: userId,
    action: 'runtime_approval.issued', targetType: 'runtime_approval', targetId: approvalId,
    metadata: { tool, environment: access.project.environment, actionDigest, expiresAt } });
  output={
    id: approvalId,
    projectId: access.project.id,
    tool,
    environment: access.project.environment,
    actionDigest,
    status: 'active',
    issuedAt,
    expiresAt,
    token,
    shownOnce: true,
  };
  });
  return output;
}

export async function listRuntimeApprovals({ projectId, userId, limit = 50 }) {
  await requireProjectRole(projectId, userId, new Set(['viewer', 'analyst', 'developer', 'admin', 'owner']));
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await db.prepare(`SELECT id,project_id,approver_id,tool_name,environment,action_digest,status,issued_at,expires_at,
    consumed_at,consumed_request_id,runtime_event_id,revoked_at
    FROM runtime_approvals WHERE project_id=? ORDER BY issued_at DESC LIMIT ?`).all(projectId, safeLimit);
  return rows.map(publicRuntimeApproval);
}

export async function revokeRuntimeApproval({ projectId, approvalId, userId }) {
  const access = await requireProjectRole(projectId, userId, APPROVER_ROLES);
  const timestamp = nowIso();
  const result = await db.prepare(`UPDATE runtime_approvals SET status='revoked',revoked_at=?
    WHERE id=? AND project_id=? AND status='active'`).run(timestamp, approvalId, projectId);
  if (Number(result.changes) !== 1) throw notFound('Active runtime approval not found.');
  await audit({ workspaceId: access.project.workspace_id, projectId, actorType: 'user', actorId: userId,
    action: 'runtime_approval.revoked', targetType: 'runtime_approval', targetId: approvalId });
  return { ok: true, revokedAt: timestamp };
}

export async function authenticateProjectApiKey(rawToken) {
  const token = String(rawToken || '').trim();
  if (!/^arl_live_[a-f0-9]{10}_[A-Za-z0-9_-]{32,}$/.test(token)) throw unauthorised('Invalid project API key.');
  const row = await db.prepare(`SELECT k.id api_key_id,k.project_id,k.expires_at,k.revoked_at,p.*
    FROM project_api_keys k JOIN security_projects p ON p.id=k.project_id WHERE k.token_hash=?`).get(digest(token));
  if (!row || row.status !== 'active' || apiKeyStatus(row) !== 'active') throw unauthorised('Invalid or inactive project API key.');
  return { apiKeyId: row.api_key_id, project: projectColumns(row) };
}

export function apiKeyStatus(key, timestampMs = Date.now()) {
  if (key?.revoked_at) return 'revoked';
  if (key?.expires_at == null) return 'active';
  if (typeof key.expires_at !== 'string' || !key.expires_at.trim()) return 'invalid';
  const expiry = Date.parse(key.expires_at);
  if (!Number.isFinite(expiry)) return 'invalid';
  return expiry <= timestampMs ? 'expired' : 'active';
}

export async function screenGuardRequest({ rawToken, body = {}, authenticated = null, eventType = 'guard', notifyOnDeny = true }) {
  const auth = authenticated || await authenticateProjectApiKey(rawToken);
  const actorType = authenticated?.actorType || 'api_key';
  const actorId = authenticated?.actorId || auth.apiKeyId || null;
  const project = auth.project;
  const requestId = clean(body.request_id || body.requestId || crypto.randomUUID(), 100);
  if (!requestId) throw badRequest('A request identifier is required.');
  const policy = compileRuntimePolicy(parseJson(project.policy_json, {}));
  const authoritativePolicy = {
    projectId: project.id,
    version: String(project.policy_version || ''),
    digest: String(project.policy_digest || ''),
    publishedAt: project.policy_published_at || null,
  };
  const recalculatedDigest = policyIdentityDigest(policy, project.id);
  if (!authoritativePolicy.version || !authoritativePolicy.publishedAt || !safeEqualDigest(authoritativePolicy.digest, recalculatedDigest))
    throw forbidden('Project policy identity is missing or invalid. Republish the policy before recording runtime evidence.');
  const started = performance.now();
  const response = await db.transaction(async () => {
    const retestCriteriaId = clean(body.retestCriteriaId || body.retest_criteria_id || body.retestRegistrationId || body.retest_registration_id, 100);
    if (retestCriteriaId && [
      'retestResult', 'retest_result', 'passed', 'expectedDecision', 'expected_decision',
      'criteriaDigest', 'criteria_digest', 'artifactDigest', 'artifact_digest',
      'findingKey', 'finding_key', 'controlId', 'control_id', 'ruleId', 'rule_id',
      'actionType', 'action_type', 'targetIdentity', 'target_identity',
    ]
      .some((field) => Object.hasOwn(body, field)))
      throw badRequest('Retest criteria, outcome and authoritative digests are server-controlled.');
    const existing = await db.prepare(`SELECT response_json,retest_criteria_id FROM runtime_events WHERE project_id=? AND request_id=?`)
      .get(project.id, requestId);
    if (existing) {
      if (retestCriteriaId && existing.retest_criteria_id !== retestCriteriaId)
        throw conflict('A runtime request cannot be rebound to different retest criteria.');
      return { ...parseJson(existing.response_json, {}), replayed: true };
    }
    const retestCriteria = retestCriteriaId ? await resolveActiveRetestCriteria({ project, criteriaId: retestCriteriaId }) : null;
    const entitlement = await entitlementForUser(project.billing_user_id);
    const usage = await projectUsage(project.id);
    if (usage.requests >= entitlement.runtimeRequestsPerMonth) throw paymentRequired('Monthly runtime-screening allowance reached. Upgrade or wait for the next billing month.');

    const inputValue = extractInput(body);
    const outputValue = extractOutput(body);
    const toolCall = body.tool_call || body.toolCall || null;
    const trustedContext = trustedRuntimeContext(project, body, toolCall);
    const approvalDecision = await resolveRuntimeApproval({ project, body, toolCall, policy, trustedContext });
    const inputResult = inputValue == null || policy.inspectInput === false ? null : inspectContent({ direction: 'input', content: inputValue, requestId, maxBytes: policy.maxResponseBytes });
    const outputResult = outputValue == null || policy.inspectOutput === false ? null : inspectContent({ direction: 'output', content: outputValue, requestId, maxBytes: policy.maxResponseBytes });
    const toolResult = toolCall ? evaluateRuntimeAction({
      requestId,
      tool: toolCall.name || toolCall.tool,
      arguments: toolCallArguments(toolCall),
      context: trustedContext,
      approval: approvalDecision,
    }, policy) : null;
    const reasons = normaliseReasons(inputResult, outputResult, toolResult);
    const flagged = reasons.length > 0;
    const enforced = policy.mode === 'enforce';
    const decision = flagged && enforced ? 'deny' : 'allow';
    const observedDecision = flagged ? 'would-deny' : 'allow';
    const severity = highestSeverity(reasons);
    const runtimeIdentity = runtimeActionIdentity({ projectId: project.id, inputValue, outputValue, toolCall });
    const retestSatisfied = retestCriteria ? criteriaSatisfied(retestCriteria, {
      decision, ruleIds: reasons.map((item) => item.ruleId), ...runtimeIdentity,
    }) : null;
    const shouldConsumeApproval = Boolean(approvalDecision.required && approvalDecision.valid
      && decision === 'allow' && observedDecision === 'allow');
    const evaluationMs = roundedMs(performance.now() - started);
    const evidence = {
      inputDigest: inputResult?.evidence?.contentDigest || null,
      outputDigest: outputResult?.evidence?.contentDigest || null,
      argumentDigest: toolResult?.evidence?.argumentDigest || null,
      tool: toolResult?.evidence?.tool || null,
      approvalActionDigest: approvalDecision.actionDigest || null,
      approvalId: approvalDecision.valid ? approvalDecision.approvalId : null,
      rawContentRetained: false,
      rawArgumentsRetained: false,
    };
    const response = {
      schema: GUARD_RESPONSE_SCHEMA,
      requestId,
      projectId: project.id,
      timestamp: nowIso(),
      decision,
      observedDecision,
      flagged,
      severity,
      policy: { schema: policy.schema, ...authoritativePolicy, mode: policy.mode, failMode: policy.failMode },
      reasons,
      evidence,
      approval: {
        required: approvalDecision.required,
        status: approvalDecision.required
          ? (shouldConsumeApproval ? 'consumed' : approvalDecision.valid ? 'verified-not-consumed' : approvalDecision.reason)
          : 'not-required',
        approvalId: approvalDecision.valid ? approvalDecision.approvalId : null,
        actionDigest: approvalDecision.actionDigest || null,
        singleUse: approvalDecision.required,
      },
      retest: retestCriteria ? {
        criteriaId: retestCriteria.id,
        remediationId: retestCriteria.remediation_id,
        result: retestSatisfied ? 'passed' : 'failed',
      } : null,
      usage: { periodStart: usage.periodStart, requests: usage.requests + 1, limit: entitlement.runtimeRequestsPerMonth },
      evaluationMs,
    };
    const metadata = privacySafeMetadata(body.metadata || {}, body.context || {});
    const runtimeEventId = id('rte_');
    await db.prepare(`INSERT INTO runtime_events
      (id,project_id,api_key_id,request_id,event_type,decision,observed_decision,severity,rule_ids_json,content_digest,tool_name,argument_digest,evaluation_ms,metadata_json,response_json,policy_version,policy_digest,policy_published_at,retest_criteria_id,remediation_id,retest_criteria_digest,retest_satisfied,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(runtimeEventId, project.id, auth.apiKeyId || null, requestId, clean(eventType, 40) || 'guard', decision, observedDecision, severity,
      JSON.stringify(reasons.map((item) => item.ruleId)), evidence.inputDigest || evidence.outputDigest, evidence.tool, evidence.argumentDigest, evaluationMs,
      JSON.stringify(metadata), JSON.stringify(response), authoritativePolicy.version, authoritativePolicy.digest, authoritativePolicy.publishedAt,
      retestCriteria?.id || null, retestCriteria?.remediation_id || null, retestCriteria?.criteria_digest || null,
      retestCriteria ? (retestSatisfied ? 1 : 0) : null, response.timestamp);
    const snapshot = await db.prepare("SELECT id FROM system_snapshots WHERE workspace_id=? AND project_id=? AND status='current' ORDER BY created_at DESC LIMIT 1")
      .get(project.workspace_id, project.id);
    if (snapshot) {
      const remediation=retestCriteria?await db.prepare('SELECT finding_key FROM remediation_items WHERE id=? AND project_id=?').get(retestCriteria.remediation_id,project.id):null;
      let controlId=String(remediation?.finding_key||'').match(/^ARL-KB-\d{3}/)?.[0]||null;let mapping=null;
      if(!controlId&&reasons.length){const ruleIds=reasons.map(item=>item.ruleId);const marks=ruleIds.map(()=>'?').join(',');mapping=await db.prepare(`SELECT * FROM runtime_control_mappings WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND policy_version=? AND policy_digest=? AND rule_id IN (${marks}) ORDER BY rule_id,entry_id LIMIT 1`).get(project.workspace_id,project.id,snapshot.id,authoritativePolicy.version,authoritativePolicy.digest,...ruleIds);if(mapping){const source=parseJson(mapping.descriptor_json,null);if(!source||digest(canonicalJson(source))!==mapping.mapping_digest)throw conflict('Runtime control attribution integrity verification failed.');controlId=mapping.entry_id;}}
      const evaluation=controlId?await db.prepare('SELECT id FROM control_snapshot_evaluations WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=?').get(project.workspace_id,project.id,snapshot.id,controlId):null;
      if(retestCriteria&&!evaluation)throw conflict('Runtime retest cannot be bound to the current control snapshot.');
      if(evaluation){const descriptor={schema:'arl.control-runtime-binding.v2',workspaceId:project.workspace_id,projectId:project.id,systemSnapshotId:snapshot.id,entryId:controlId,runtimeEventId,attributionMappingId:mapping?.id||null,policyVersion:authoritativePolicy.version,policyDigest:authoritativePolicy.digest,ruleIds:reasons.map(item=>item.ruleId),sideEffectOutcome:observedDecision,bindingType:'runtime_decision',createdAt:response.timestamp};
      await db.prepare(`INSERT INTO control_snapshot_runtime_bindings
        (id,workspace_id,project_id,system_snapshot_id,entry_id,runtime_event_id,attribution_mapping_id,binding_type,descriptor_json,content_digest,created_at)
        VALUES (?,?,?,?,?,?,?,'runtime_decision',?,?,?)`).run(id('crb_'),project.workspace_id,project.id,snapshot.id,controlId,runtimeEventId,mapping?.id||null,canonicalJson(descriptor),digest(canonicalJson(descriptor)),response.timestamp);}
    }
    if (shouldConsumeApproval) {
      const consumed = await db.prepare(`UPDATE runtime_approvals
        SET status='consumed',consumed_at=?,consumed_request_id=?,runtime_event_id=?
        WHERE id=? AND project_id=? AND token_digest=? AND status='active' AND revoked_at IS NULL AND expires_at>?`)
        .run(response.timestamp, requestId, runtimeEventId, approvalDecision.approvalId, project.id, approvalDecision.tokenDigest, response.timestamp);
      if (Number(consumed.changes) !== 1) throw conflict('Runtime approval was already consumed, expired or revoked.');
      await audit({ workspaceId: project.workspace_id, projectId: project.id, actorType, actorId,
        action: 'runtime_approval.consumed', targetType: 'runtime_approval', targetId: approvalDecision.approvalId,
        metadata: { requestId, runtimeEventId, tool: evidence.tool, actionDigest: approvalDecision.actionDigest } });
    }
    if (retestCriteria) {
      const consumed = await db.prepare(`UPDATE remediation_retest_criteria
        SET status='completed',consumed_at=?,runtime_event_id=?,result=?
        WHERE id=? AND status='active' AND runtime_event_id IS NULL`).run(
        response.timestamp, runtimeEventId, retestSatisfied ? 'passed' : 'failed', retestCriteria.id);
      if (Number(consumed.changes) !== 1) throw conflict('Retest criteria were already consumed.');
      await audit({ workspaceId: project.workspace_id, projectId: project.id, actorType: 'api_key', actorId: auth.apiKeyId,
        action: 'remediation.retest_executed', targetType: 'remediation_retest_criteria', targetId: retestCriteria.id,
        metadata: { remediationId: retestCriteria.remediation_id, runtimeEventId, result: retestSatisfied ? 'passed' : 'failed' } });
    }
    if (auth.apiKeyId) await db.prepare('UPDATE project_api_keys SET last_used_at=? WHERE id=?').run(response.timestamp, auth.apiKeyId);
    if (decision === 'deny') {
      await audit({ workspaceId: project.workspace_id, projectId: project.id, actorType, actorId, action: 'runtime.denied', targetType: 'runtime_request', targetId: requestId,
        metadata: { severity, ruleIds: reasons.map((item) => item.ruleId), approvalStatus: response.approval.status } });
    }
    return response;
  });
  if (notifyOnDeny && response.decision === 'deny' && !response.replayed) {
    void deliverSecurityEventSystem({ workspaceId: project.workspace_id, event: {
      type: 'runtime_denied', severity: response.severity, title: 'AI runtime action denied',
      projectId: project.id, requestId: response.requestId, decision: response.decision,
      ruleIds: response.reasons.map((item) => item.ruleId), timestamp: response.timestamp,
    } }).catch((error) => console.error('Runtime integration delivery failed:', error.message));
  }
  return response;
}

export async function runGuidedProtectionCheck({ projectId, userId }) {
  await assertRuntimeProject({ projectId, userId });
  const access = await requireProjectRole(projectId, userId, APPROVER_ROLES);
  const sampleTool = 'arl_demo.refund_order';
  const sampleArguments = Object.freeze({ orderId: 'demo_order_4821', amountPence: 17500, currency: 'GBP' });
  const changedArguments = Object.freeze({ ...sampleArguments, amountPence: 17600 });
  const startedAt = nowIso();
  const version = `guided-${Date.now()}`;
  const currentPolicy = parseJson(access.project.policy_json, {});
  const demoPolicy = compileRuntimePolicy({
    ...currentPolicy,
    version,
    mode: 'enforce',
    allowedTools: [...new Set([...(currentPolicy.allowedTools || []), sampleTool])],
    requireApprovalFor: [...new Set([...(currentPolicy.requireApprovalFor || []), sampleTool])],
  });
  const demoProject = projectColumns({
    ...access.project,
    policy_json: JSON.stringify(demoPolicy),
    policy_version: demoPolicy.version,
    policy_digest: policyIdentityDigest(demoPolicy, projectId),
    policy_published_at: startedAt,
  });
  const authenticated = { apiKeyId: null, actorType: 'user', actorId: userId, project: demoProject };
  const requestPrefix = `guided-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const screen = (suffix, toolCall) => screenGuardRequest({
    authenticated,
    eventType: 'guided_demo',
    notifyOnDeny: false,
    body: {
      request_id: `${requestPrefix}-${suffix}`,
      input: 'Fictional customer asks the support agent for a refund.',
      tool_call: toolCall,
      metadata: { application: 'agentrisklayer-guided-check', synthetic: true },
    },
  });

  const withoutApproval = await screen('without-approval', { name: sampleTool, arguments: sampleArguments });
  const approval = await createRuntimeApproval({
    projectId,
    userId,
    toolCall: { name: sampleTool, arguments: sampleArguments },
    ttlSeconds: 300,
  });
  const changedAmount = await screen('changed-amount', {
    name: sampleTool,
    arguments: changedArguments,
    approval_token: approval.token,
  });
  const exactAction = await screen('exact-action', {
    name: sampleTool,
    arguments: sampleArguments,
    approval_token: approval.token,
  });
  const replay = await screen('replay', {
    name: sampleTool,
    arguments: sampleArguments,
    approval_token: approval.token,
  });

  const results = [
    guidedResult('No human approval', 'deny', withoutApproval),
    guidedResult('Changed amount', 'deny', changedAmount),
    guidedResult('Exact approved action', 'allow', exactAction),
    guidedResult('Reused approval', 'deny', replay),
  ];
  const passed = results.every((result) => result.passed);
  await audit({
    workspaceId: access.project.workspace_id,
    projectId,
    actorType: 'user',
    actorId: userId,
    action: 'guided_protection_check.completed',
    targetType: 'project',
    targetId: projectId,
    metadata: { passed, requestIds: results.map((result) => result.requestId), sampleTool },
  });
  return {
    schema: GUIDED_PROTECTION_CHECK_SCHEMA,
    projectId,
    completedAt: nowIso(),
    passed,
    simulation: {
      syntheticData: true,
      externalToolExecuted: false,
      sampleTool,
      sampleArguments,
    },
    approval: {
      id: approval.id,
      actionDigest: approval.actionDigest,
      status: exactAction.approval?.status || 'unknown',
      singleUse: true,
    },
    results,
    limitations: [
      'This guided check evaluates fictional data inside AgentRiskLayer and does not call a customer tool or refund system.',
      'It proves the hosted policy and approval path for this controlled check; it does not prove that a customer agent is integrated correctly.',
    ],
  };
}

function guidedResult(label, expectedDecision, response) {
  return {
    label,
    expectedDecision,
    decision: response.decision,
    approvalStatus: response.approval?.status || 'not-required',
    requestId: response.requestId,
    ruleIds: (response.reasons || []).map((reason) => reason.ruleId),
    passed: response.decision === expectedDecision,
  };
}

export async function listRuntimeEvents({ projectId, userId, limit = 100, decision = '' }) {
  await requireProjectRole(projectId, userId, new Set(['viewer', 'analyst', 'developer', 'admin', 'owner']));
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const rows = decision && ['allow', 'deny'].includes(decision)
    ? await db.prepare(`SELECT id,project_id,request_id,event_type,decision,observed_decision,severity,rule_ids_json,tool_name,evaluation_ms,metadata_json,policy_version,policy_digest,policy_published_at,retest_criteria_id,remediation_id,retest_criteria_digest,retest_satisfied,created_at
      FROM runtime_events WHERE project_id=? AND decision=? ORDER BY created_at DESC LIMIT ?`).all(projectId, decision, safeLimit)
    : await db.prepare(`SELECT id,project_id,request_id,event_type,decision,observed_decision,severity,rule_ids_json,tool_name,evaluation_ms,metadata_json,policy_version,policy_digest,policy_published_at,retest_criteria_id,remediation_id,retest_criteria_digest,retest_satisfied,created_at
      FROM runtime_events WHERE project_id=? ORDER BY created_at DESC LIMIT ?`).all(projectId, safeLimit);
  return rows.map((row) => ({ ...row, ruleIds: parseJson(row.rule_ids_json, []), metadata: parseJson(row.metadata_json, {}), rule_ids_json: undefined, metadata_json: undefined }));
}

export async function recordAssetSnapshot({ projectId, userId, documents, source = 'manual' }) {
  const access = await requireProjectRole(projectId, userId, REVIEW_ROLES);
  const inventory = discoverAiAssets(documents || {});
  const previous = await db.prepare(`SELECT assets_json,source_digest,created_at FROM asset_snapshots WHERE project_id=? ORDER BY created_at DESC LIMIT 1`).get(projectId);
  const drift = compareAssets(previous ? parseJson(previous.assets_json, []) : [], inventory.assets);
  const canonical = JSON.stringify(inventory.assets);
  const sourceDigest = digest(canonical);
  if (previous?.source_digest === sourceDigest) drift.unchangedSnapshot = true;
  const snapshotId = id('inv_');
  const previousTimestamp = Date.parse(previous?.created_at || '');
  const timestamp = new Date(Math.max(Date.now(), Number.isFinite(previousTimestamp) ? previousTimestamp + 1 : 0)).toISOString();
  await db.prepare(`INSERT INTO asset_snapshots (id,project_id,source,source_digest,summary_json,assets_json,drift_json,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(snapshotId, projectId, clean(source, 40) || 'manual', sourceDigest, JSON.stringify(inventory.summary), canonical, JSON.stringify(drift), userId, timestamp);
  await audit({ workspaceId: access.project.workspace_id, projectId, actorType: 'user', actorId: userId, action: 'inventory.snapshot_recorded', targetType: 'asset_snapshot', targetId: snapshotId,
    metadata: { total: inventory.summary.total, added: drift.added.length, removed: drift.removed.length, changed: drift.changed.length } });
  return { id: snapshotId, source, sourceDigest, summary: inventory.summary, assets: inventory.assets, drift, createdAt: timestamp };
}

export async function listAssetSnapshots({ projectId, userId, limit = 20 }) {
  await requireProjectRole(projectId, userId, new Set(['viewer', 'analyst', 'developer', 'admin', 'owner']));
  const rows = await db.prepare(`SELECT id,source,source_digest,summary_json,assets_json,drift_json,created_at
    FROM asset_snapshots WHERE project_id=? ORDER BY created_at DESC LIMIT ?`).all(projectId, Math.max(1, Math.min(100, Number(limit) || 20)));
  return rows.map((row) => ({ id: row.id, source: row.source, sourceDigest: row.source_digest, summary: parseJson(row.summary_json, {}), assets: parseJson(row.assets_json, []), drift: parseJson(row.drift_json, {}), createdAt: row.created_at }));
}

export async function createRemediationItem({ projectId, userId, input = {} }) {
  const access = await requireProjectRole(projectId, userId, REVIEW_ROLES);
  const title = clean(input.title, 240);
  if (title.length < 3) throw badRequest('Remediation title must contain at least three characters.');
  const severity = SEVERITIES.has(input.severity) ? input.severity : 'medium';
  const findingKey = clean(input.findingKey || input.finding_key || `manual-${digest(title).slice(0, 16)}`, 160);
  const ownerEmail = validEmail(input.ownerEmail || input.owner_email) ? clean(input.ownerEmail || input.owner_email, 254).toLowerCase() : null;
  const dueAt = validOptionalDate(input.dueAt || input.due_at);
  const itemId = id('rem_');
  const timestamp = nowIso();
  try {
    await db.prepare(`INSERT INTO remediation_items
      (id,project_id,assessment_id,finding_key,title,severity,status,owner_email,due_at,verification_json,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'open',?,?, '{}',?,?,?)`).run(itemId, projectId, input.assessmentId || null, findingKey, title, severity, ownerEmail, dueAt, userId, timestamp, timestamp);
  } catch (error) {
    if (/unique|constraint/i.test(String(error.message))) throw badRequest('A remediation item already exists for this finding.');
    throw error;
  }
  await audit({ workspaceId: access.project.workspace_id, projectId, actorType: 'user', actorId: userId, action: 'remediation.created', targetType: 'remediation', targetId: itemId, metadata: { severity, findingKey } });
  return db.prepare('SELECT * FROM remediation_items WHERE id=?').get(itemId);
}

export async function registerRemediationEvidenceArtifact({ projectId, itemId, userId, artifactType, sourceId }) {
  const access = await requireProjectRole(projectId, userId, REVIEW_ROLES);
  const remediation = await db.prepare('SELECT id,status,verification_json,created_at FROM remediation_items WHERE id=? AND project_id=?').get(itemId, projectId);
  if (!remediation) throw notFound('Remediation item not found.');
  if (!['implementation', 'retest'].includes(artifactType)) throw badRequest('Evidence artifact type must be implementation or retest.');
  if (artifactType === 'retest') throw badRequest('Retest evidence must be bound to predeclared criteria during runtime execution.');
  const cleanSourceId = clean(sourceId, 100);
  const sourceType = 'asset_snapshot';
  const source = await db.prepare('SELECT id,source,source_digest,summary_json,drift_json,created_at FROM asset_snapshots WHERE id=? AND project_id=?')
    .get(cleanSourceId, projectId);
  if (!source) throw badRequest(`A valid AgentRiskLayer ${sourceType.replace('_', ' ')} from this project is required.`);
  if (artifactType === 'implementation' && (normaliseRemediationStatus(remediation.status) !== 'open'
    || Date.parse(source.created_at) < Date.parse(remediation.created_at)))
    throw badRequest('Implementation evidence must be recorded after this remediation was opened.');
  const canonical = canonicalJson(source);
  const artifactId = id('rea_');
  const timestamp = nowIso();
  const contentDigest = digest(canonical);
  await db.prepare(`INSERT INTO remediation_evidence_artifacts
    (id,workspace_id,project_id,remediation_id,artifact_type,source_type,source_id,lifecycle_state,content_json,content_digest,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,'active',?,?,?,?)`)
    .run(artifactId, access.project.workspace_id, projectId, itemId, artifactType, sourceType, source.id, canonical, contentDigest, userId, timestamp);
  await audit({ workspaceId: access.project.workspace_id, projectId, actorType: 'user', actorId: userId, action: 'remediation.evidence_registered',
    targetType: 'remediation_evidence_artifact', targetId: artifactId, metadata: { remediationId: itemId, artifactType, contentDigest } });
  return { id: artifactId, projectId, remediationId: itemId, artifactType, sourceType, sourceId: source.id,
    lifecycleState: 'active', digest: contentDigest, createdAt: timestamp };
}

export async function beginLegacyRemediationUpgrade({ projectId, itemId, userId, reason = 'Trusted evidence upgrade required' }) {
  const access = await requireProjectRole(projectId, userId, REVIEW_ROLES);
  const current = await db.prepare('SELECT * FROM remediation_items WHERE id=? AND project_id=?').get(itemId, projectId);
  if (!current) throw notFound('Remediation item not found.');
  const verification = parseJson(current.verification_json, {});
  if (current.status === 'evidence_upgrade_required') return publicRemediation(current);
  if (!isLegacyClosedRemediation(current.status, verification)) throw badRequest('Only legacy closed remediation records require this upgrade action.');
  const timestamp = nowIso();
  const history = Array.isArray(verification.history) ? [...verification.history] : [];
  history.push({ action: 'evidence_upgrade_started', actorId: userId, at: timestamp, previousStatus: current.status,
    newStatus: 'evidence_upgrade_required', reason: clean(reason, 240) || 'Trusted evidence upgrade required' });
  const nextVerification = { ...verification, legacyStatus: verification.legacyStatus || current.status, history };
  await db.prepare(`UPDATE remediation_items SET status='evidence_upgrade_required',verification_json=?,updated_at=? WHERE id=? AND project_id=?`)
    .run(JSON.stringify(nextVerification), timestamp, itemId, projectId);
  await audit({ workspaceId: access.project.workspace_id, projectId, actorType: 'user', actorId: userId, action: 'remediation.evidence_upgrade_started',
    targetType: 'remediation', targetId: itemId, metadata: { previousStatus: current.status, newStatus: 'evidence_upgrade_required', reason: clean(reason, 240) } });
  return publicRemediation(await db.prepare('SELECT * FROM remediation_items WHERE id=?').get(itemId));
}

export async function updateRemediationItem({ projectId, itemId, userId, patch = {} }) {
  return db.transaction(() => updateRemediationItemTransaction({ projectId, itemId, userId, patch }));
}

async function updateRemediationItemTransaction({ projectId, itemId, userId, patch = {} }) {
  const access = await requireProjectRole(projectId, userId, REVIEW_ROLES);
  if (db.kind === 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`${projectId}:${itemId}`);
  const current = await db.prepare('SELECT * FROM remediation_items WHERE id=? AND project_id=?').get(itemId, projectId);
  if (!current) throw notFound('Remediation item not found.');
  const currentStatus = normaliseRemediationStatus(current.status);
  const status = patch.status == null ? currentStatus : clean(patch.status, 40).toLowerCase();
  if (!REMEDIATION_STATUSES.has(status)) throw badRequest('Unknown remediation status.');
  if (status !== currentStatus && !REMEDIATION_TRANSITIONS[currentStatus]?.has(status))
    throw badRequest(`Remediation cannot move from ${currentStatus} to ${status}. Complete the required evidence and retest step first.`);
  const title = patch.title == null ? current.title : clean(patch.title, 240);
  const severity = patch.severity == null ? current.severity : clean(patch.severity, 20).toLowerCase();
  if (!SEVERITIES.has(severity)) throw badRequest('Unknown severity.');
  const ownerEmail = patch.ownerEmail == null ? current.owner_email : (validEmail(patch.ownerEmail) ? clean(patch.ownerEmail, 254).toLowerCase() : null);
  const dueAt = patch.dueAt == null ? current.due_at : validOptionalDate(patch.dueAt);
  const previousVerification = parseJson(current.verification_json, {});
  let verification = patch.verification == null ? previousVerification : { ...previousVerification, ...sanitiseVerificationInput(patch.verification) };
  const transitionAt = nowIso();
  if (status === 'open' && status !== currentStatus) {
    const history = Array.isArray(verification.history) ? verification.history : [];
    verification = { history: [...history, { action: 'reopened', actorId: userId, at: transitionAt, previousStatus: current.status, newStatus: 'open' }],
      previousVerification: verification };
  }
  if (status === 'evidence_attached')
    verification = { ...verification, ...(await verifiedArtifactEvidence({ access, projectId, itemId, artifactId: verification.artifactId, artifactType: 'implementation' })) };
  if (status === 'ready_for_retest' && status !== currentStatus) {
    const criteria = await createRetestCriteria({ access, current, userId, input: patch.retestCriteria, createdAt: transitionAt });
    verification = { ...verification, retestCriteriaId: criteria.id, retestCriteriaDigest: criteria.criteriaDigest,
      retestCriteriaCreatedAt: criteria.createdAt, retestCriteriaExpiresAt: criteria.expiresAt };
  }
  if (status === 'retested' && status !== currentStatus) {
    const criteria = await db.prepare(`SELECT * FROM remediation_retest_criteria
      WHERE id=? AND workspace_id=? AND project_id=? AND remediation_id=?`).get(
      verification.retestCriteriaId, access.project.workspace_id, projectId, itemId);
    if (!criteria || criteria.status !== 'completed' || criteria.result !== 'passed' || !criteria.runtime_event_id)
      throw badRequest('A server-derived passed retest is required.');
    const artifact = await createRetestEvidenceArtifact({ access, criteria, userId });
    verification = { ...verification, retestResult: criteria.result, retestArtifactId: artifact.id,
      retestArtifactDigest: artifact.digest, retestArtifactVerifiedAt: transitionAt, retestArtifactEvidenceType: 'verified_artifact',
      retestPolicyVersion: criteria.policy_version, retestPolicyDigest: criteria.policy_digest,
      retestPolicyPublishedAt: criteria.policy_published_at };
    await audit({ workspaceId: access.project.workspace_id, projectId, actorType: 'user', actorId: userId,
      action: 'remediation.retest_evidence_registered', targetType: 'remediation_evidence_artifact', targetId: artifact.id,
      metadata: { remediationId: itemId, criteriaId: criteria.id, runtimeEventId: criteria.runtime_event_id, contentDigest: artifact.digest } });
  }
  if (status === 'verified_closed' && verification.retestResult !== 'passed')
    throw badRequest('Only a passed retest can be verified closed.');
  if (status !== currentStatus) {
    if (status === 'evidence_attached') verification.evidenceAttachedAt = transitionAt;
    if (status === 'ready_for_retest') verification.readyForRetestAt = transitionAt;
    if (status === 'retested') verification.retestedAt = transitionAt;
    if (status === 'verified_closed') verification.verifiedAt = transitionAt;
  }
  await db.prepare(`UPDATE remediation_items SET title=?,severity=?,status=?,owner_email=?,due_at=?,verification_json=?,updated_at=? WHERE id=? AND project_id=?`)
    .run(title, severity, status, ownerEmail, dueAt, JSON.stringify(verification), transitionAt, itemId, projectId);
  await audit({ workspaceId: access.project.workspace_id, projectId, actorType: 'user', actorId: userId, action: 'remediation.updated', targetType: 'remediation', targetId: itemId, metadata: { status, severity } });
  return db.prepare('SELECT * FROM remediation_items WHERE id=?').get(itemId);
}

export async function listRemediationItems({ projectId, userId }) {
  await requireProjectRole(projectId, userId, new Set(['viewer', 'analyst', 'developer', 'admin', 'owner']));
  const rows = await db.prepare(`SELECT * FROM remediation_items WHERE project_id=?
    ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, updated_at DESC`).all(projectId);
  const artifacts = await db.prepare(`SELECT a.id,a.remediation_id,a.artifact_type,a.content_digest,a.source_id,
      e.id source_event_id,e.retest_criteria_id,e.remediation_id event_remediation_id,e.retest_criteria_digest,e.retest_satisfied
    FROM remediation_evidence_artifacts a LEFT JOIN runtime_events e ON e.id=a.source_id AND e.project_id=a.project_id
    WHERE a.project_id=? AND a.lifecycle_state='active' AND a.invalidated_at IS NULL`).all(projectId);
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  return rows.map((row) => {
    const item = publicRemediation(row);
    const implementation = byId.get(item.verification.artifactId);
    const retest = byId.get(item.verification.retestArtifactId);
    item.trustedImplementationEvidence = implementation?.artifact_type === 'implementation'
      && implementation.remediation_id === item.id && safeEqualDigest(implementation.content_digest, item.verification.artifactDigest);
    item.trustedRetestEvidence = retest?.artifact_type === 'retest' && retest.remediation_id === item.id
      && retest.source_event_id && retest.event_remediation_id === item.id && Boolean(retest.retest_satisfied)
      && retest.retest_criteria_id === item.verification.retestCriteriaId
      && safeEqualDigest(retest.retest_criteria_digest, item.verification.retestCriteriaDigest)
      && safeEqualDigest(retest.content_digest, item.verification.retestArtifactDigest);
    return item;
  });
}

async function createRetestCriteria({ access, current, userId, input, createdAt }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('Predeclared retest criteria are required.');
  const ruleId = clean(input.ruleId || input.rule_id, 100);
  const expectedDecision = clean(input.expectedDecision || input.expected_decision, 20).toLowerCase();
  const actionType = clean(input.actionType || input.action_type, 40).toLowerCase();
  const targetIdentity = clean(input.targetIdentity || input.target_identity, 200).toLowerCase();
  if (!ruleId || !['allow', 'deny'].includes(expectedDecision)
    || !['content.input', 'content.output', 'tool'].includes(actionType) || !targetIdentity)
    throw badRequest('Retest criteria require a rule, expected allow/deny decision, supported action type and constrained target.');
  const requestedValidity = input.validityMinutes == null ? 60 : Number(input.validityMinutes);
  if (!Number.isInteger(requestedValidity) || requestedValidity < 1 || requestedValidity > 24 * 60)
    throw badRequest('Retest criteria validity must be a whole number from 1 to 1440 minutes.');
  const validityMinutes = requestedValidity;
  const expiresAt = new Date(Date.parse(createdAt) + validityMinutes * 60000).toISOString();
  const criteria = {
    id: id('rtc_'),
    workspace_id: access.project.workspace_id,
    project_id: current.project_id,
    remediation_id: current.id,
    finding_key: current.finding_key,
    rule_id: ruleId,
    expected_decision: expectedDecision,
    action_type: actionType,
    target_identity: targetIdentity,
    policy_version: access.project.policy_version,
    policy_digest: access.project.policy_digest,
    policy_published_at: access.project.policy_published_at,
    created_at: createdAt,
    expires_at: expiresAt,
  };
  criteria.criteria_digest = retestCriteriaDigest(criteria);
  await db.prepare(`INSERT INTO remediation_retest_criteria
    (id,workspace_id,project_id,remediation_id,finding_key,rule_id,expected_decision,action_type,target_identity,
      policy_version,policy_digest,policy_published_at,criteria_digest,status,created_by,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)`).run(
    criteria.id, criteria.workspace_id, criteria.project_id, criteria.remediation_id, criteria.finding_key, criteria.rule_id,
    criteria.expected_decision, criteria.action_type, criteria.target_identity, criteria.policy_version, criteria.policy_digest,
    criteria.policy_published_at, criteria.criteria_digest, userId, criteria.created_at, criteria.expires_at);
  await audit({ workspaceId: criteria.workspace_id, projectId: criteria.project_id, actorType: 'user', actorId: userId,
    action: 'remediation.retest_criteria_created', targetType: 'remediation_retest_criteria', targetId: criteria.id,
    metadata: { remediationId: current.id, findingKey: current.finding_key, ruleId, expectedDecision, actionType, targetIdentity, expiresAt } });
  return { id: criteria.id, criteriaDigest: criteria.criteria_digest, createdAt, expiresAt };
}

async function createRetestEvidenceArtifact({ access, criteria, userId }) {
  const source = await db.prepare(`SELECT id,request_id,decision,observed_decision,severity,rule_ids_json,policy_version,policy_digest,
    policy_published_at,retest_criteria_id,remediation_id,retest_criteria_digest,retest_satisfied,created_at
    FROM runtime_events WHERE id=? AND project_id=?`).get(criteria.runtime_event_id, criteria.project_id);
  if (!source || source.retest_criteria_id !== criteria.id || source.remediation_id !== criteria.remediation_id
    || !safeEqualDigest(source.retest_criteria_digest, criteria.criteria_digest) || !Boolean(source.retest_satisfied))
    throw badRequest('Bound retest runtime evidence is missing or invalid.');
  const canonical = canonicalJson(source);
  const artifactId = id('rea_');
  const timestamp = nowIso();
  const contentDigest = digest(canonical);
  await db.prepare(`INSERT INTO remediation_evidence_artifacts
    (id,workspace_id,project_id,remediation_id,artifact_type,source_type,source_id,lifecycle_state,content_json,content_digest,created_by,created_at)
    VALUES (?,?,?,?,?,'runtime_event',?,'active',?,?,?,?)`).run(
    artifactId, access.project.workspace_id, criteria.project_id, criteria.remediation_id, 'retest', source.id,
    canonical, contentDigest, userId, timestamp);
  return { id: artifactId, digest: contentDigest };
}

async function verifiedArtifactEvidence({ access, projectId, itemId, artifactId, artifactType, prefix = '' }) {
  const cleanId = clean(artifactId, 100);
  if (!cleanId) throw badRequest(`A registered ${artifactType} evidence artifact is required.`);
  const artifact = await db.prepare(`SELECT * FROM remediation_evidence_artifacts
    WHERE id=? AND workspace_id=? AND project_id=? AND remediation_id=?`).get(cleanId, access.project.workspace_id, projectId, itemId);
  if (!artifact || artifact.artifact_type !== artifactType || artifact.lifecycle_state !== 'active' || artifact.invalidated_at)
    throw badRequest(`Registered ${artifactType} evidence artifact is missing, invalid, or outside this remediation.`);
  const source = artifact.source_type === 'asset_snapshot'
    ? await db.prepare('SELECT id,source,source_digest,summary_json,drift_json,created_at FROM asset_snapshots WHERE id=? AND project_id=?').get(artifact.source_id, projectId)
    : artifact.source_type === 'runtime_event'
      ? await db.prepare(`SELECT id,request_id,decision,observed_decision,severity,rule_ids_json,policy_version,policy_digest,policy_published_at,created_at
          FROM runtime_events WHERE id=? AND project_id=?`).get(artifact.source_id, projectId)
      : null;
  if (!source) throw badRequest('Registered evidence source no longer exists or is outside this project.');
  if (artifactType === 'retest' && (source.policy_version !== access.project.policy_version
    || !safeEqualDigest(source.policy_digest, access.project.policy_digest)
    || source.policy_published_at !== access.project.policy_published_at))
    throw badRequest('Registered retest evidence is not associated with the current published policy.');
  const recalculated = digest(canonicalJson(source));
  if (!safeEqualDigest(artifact.content_digest, recalculated)) throw badRequest('Registered evidence artifact digest verification failed.');
  const key = prefix ? `${prefix}Artifact` : 'artifact';
  return {
    [`${key}Id`]: artifact.id,
    [`${key}Digest`]: artifact.content_digest,
    [`${key}VerifiedAt`]: nowIso(),
    [`${key}EvidenceType`]: 'verified_artifact',
    ...(artifactType === 'retest' ? {
      retestPolicyVersion: source.policy_version,
      retestPolicyDigest: source.policy_digest,
      retestPolicyPublishedAt: source.policy_published_at,
    } : {}),
  };
}

function normaliseRemediationStatus(status) {
  return ({ in_progress: 'open', verified: 'verified_closed', closed: 'verified_closed' })[status] || status;
}

function isLegacyClosedRemediation(status, verification) {
  return ['verified', 'closed', 'verified_closed'].includes(status)
    && verification.retestArtifactEvidenceType !== 'verified_artifact';
}

function publicRemediation(row) {
  const verification = parseJson(row.verification_json, {});
  const legacyUpgradeRequired = isLegacyClosedRemediation(row.status, verification);
  return { ...row, status: row.status === 'evidence_upgrade_required' ? row.status : normaliseRemediationStatus(row.status),
    compatibilityState: legacyUpgradeRequired ? 'evidence_upgrade_required' : null,
    verification, verification_json: undefined };
}

function projectJourney(project) {
  const events = project.events || [];
  const currentPolicyVersion = String(project.policyVersion || '');
  const currentPolicyDigest = String(project.policyDigest || '');
  const policyPublishedMs = Date.parse(project.policyPublishedAt || '');
  const eventMatchesCurrentPolicy = (event) => {
    const eventMs = Date.parse(event.created_at || '');
    return event.project_id === project.id
      && event.policy_version === currentPolicyVersion
      && safeEqualDigest(event.policy_digest, currentPolicyDigest)
      && Number.isFinite(policyPublishedMs)
      && Number.isFinite(eventMs)
      && eventMs >= policyPublishedMs
      && event.policy_published_at === project.policyPublishedAt;
  };
  const hasAllowed = events.some((event) => eventMatchesCurrentPolicy(event) && event.decision === 'allow' && event.observed_decision === 'allow');
  const hasBlocked = events.some((event) => eventMatchesCurrentPolicy(event) && event.decision === 'deny');
  const hasOpenRemediation = (project.remediations || []).some((item) =>
    item.compatibilityState === 'evidence_upgrade_required'
    || !['verified_closed', 'accepted_risk'].includes(normaliseRemediationStatus(item.status)));
  const hasRemediationEvidence = (project.remediations || []).some((item) => {
    const verification = item.verification || {};
    return ['evidence_attached', 'ready_for_retest', 'retested', 'verified_closed'].includes(normaliseRemediationStatus(item.status))
      && verification.artifactEvidenceType === 'verified_artifact'
      && item.trustedImplementationEvidence === true
      && Boolean(verification.artifactId && verification.artifactDigest && verification.artifactVerifiedAt && verification.evidenceAttachedAt);
  });
  const hasRetest = (project.remediations || []).some((item) => {
    const verification = item.verification || {};
    return normaliseRemediationStatus(item.status) === 'verified_closed'
      && verification.retestResult === 'passed'
      && verification.retestArtifactEvidenceType === 'verified_artifact'
      && item.trustedRetestEvidence === true
      && Boolean(verification.retestArtifactId && verification.retestArtifactDigest && verification.retestArtifactVerifiedAt
        && verification.retestedAt && verification.verifiedAt);
  });
  const hasPublishedPolicy = Number(project.policyVersion || 1) > 1;
  const hasActiveKey = (project.apiKeys || []).some((key) => key.status === 'active' && key.usable === true);
  const latestInventory = (project.inventory || [])[0] || null;
  const riskyInventoryDrift = latestInventory?.drift?.deploymentGate === 'review-required';
  const steps = [
    { id: 'project', label: 'Create project', complete: true, href: '#project' },
    { id: 'policy', label: 'Publish policy', complete: hasPublishedPolicy, href: '#policy' },
    { id: 'key', label: 'Issue key', complete: hasActiveKey, href: '#runtime' },
    { id: 'allowed', label: 'Test allowed action', complete: hasAllowed, href: '#runtime' },
    { id: 'blocked', label: 'Test blocked action', complete: hasBlocked, href: '#runtime' },
    { id: 'inventory', label: 'Record inventory', complete: Boolean(latestInventory) && !riskyInventoryDrift, href: '#inventory' },
    { id: 'findings', label: 'Review findings', complete: hasBlocked || hasOpenRemediation, href: '#remediation' },
    { id: 'remediate', label: 'Remediate', complete: hasRemediationEvidence, href: '#remediation' },
    { id: 'retest', label: 'Retest', complete: hasRetest, href: '#remediation' },
  ];
  const next = steps.find((step) => !step.complete) || null;
  const blockingGaps = [];
  if (!hasPublishedPolicy) blockingGaps.push('No reviewed project policy has been published.');
  if (!hasActiveKey) blockingGaps.push('No active project API key is available for runtime enforcement.');
  if (!hasAllowed) blockingGaps.push('No allowed-action control test is recorded.');
  if (!hasBlocked) blockingGaps.push('No enforced blocked-action test is recorded.');
  if (!latestInventory) blockingGaps.push('No inventory evidence is recorded.');
  if (riskyInventoryDrift) blockingGaps.push('The latest inventory contains risky drift requiring review.');
  if (hasOpenRemediation) blockingGaps.push('Remediation work remains open.');
  if (hasBlocked && !hasRemediationEvidence) blockingGaps.push('No verified AgentRiskLayer artifact evidence is recorded.');
  if (hasBlocked && !hasRetest) blockingGaps.push('The blocked-action finding has not completed a verified-artifact passed retest and verified closure.');
  return {
    status: blockingGaps.length ? 'evidence-incomplete' : 'ready-for-deployment-review',
    nextAction: next,
    steps,
    evidenceCollected: steps.filter((step) => step.complete).length,
    blockingGaps,
    deploymentDecision: blockingGaps.length ? 'HOLD FOR EVIDENCE' : 'READY FOR HUMAN DEPLOYMENT REVIEW',
  };
}

export async function controlPlaneOverview(userId) {
  const projects = await listSecurityProjects(userId);
  const runtimeProjects = projects.filter((item) => item.projectKind !== PROJECT_KINDS.ASSESSMENT_CASE);
  const assessmentProjects = projects.filter((item) => item.projectKind === PROJECT_KINDS.ASSESSMENT_CASE && item.status !== 'archived');
  const entitlement = await entitlementForUser(userId);
  return {
    projects,
    totals: {
      projects: runtimeProjects.filter((item) => item.status !== 'archived').length,
      assessmentCases: assessmentProjects.length,
      runtimeRequestsMonth: runtimeProjects.reduce((sum, item) => sum + Number(item.runtimeRequestsMonth || 0), 0),
      deniedMonth: runtimeProjects.reduce((sum, item) => sum + Number(item.deniedMonth || 0), 0),
      openRemediations: runtimeProjects.reduce((sum, item) => sum + Number(item.openRemediations || 0), 0),
      assets: runtimeProjects.reduce((sum, item) => sum + Number(item.latestInventoryTotal || 0), 0),
    },
    entitlement,
    assessmentCases: {
      canCreate: await isPlatformSuperuser(userId),
      ownerOnly: true,
      runtimeEnabled: false,
      count: assessmentProjects.length,
      projects: assessmentProjects,
    },
  };
}

export async function purgeExpiredRuntimeEvents() {
  const projects = await db.prepare(`SELECT id,retention_days FROM security_projects WHERE status!='archived'`).all();
  let deleted = 0;
  let approvalsDeleted = 0;
  for (const project of projects) {
    const cutoff = new Date(Date.now() - Math.max(1, Number(project.retention_days || 30)) * 86400000).toISOString();
    await db.transaction(async () => {
      const approvalRows = await db.prepare(`SELECT id FROM runtime_approvals WHERE project_id=?
        AND (status!='active' OR expires_at<=?)
        AND COALESCE(consumed_at,revoked_at,expires_at)<?`).all(project.id, cutoff, cutoff);
      await prepareRiskKnowledgeSubjectPurge({ projectId: project.id,
        subjects: approvalRows.map((row) => ({ type: 'approval', id: row.id })), reason: 'runtime approval retention expired' });
      await prepareControlIntelligenceSourcePurge({ projectId: project.id, approvalIds: approvalRows.map((row) => row.id) });
      const approvals = await db.prepare(`DELETE FROM runtime_approvals WHERE project_id=?
        AND (status!='active' OR expires_at<=?)
        AND COALESCE(consumed_at,revoked_at,expires_at)<?`).run(project.id, cutoff, cutoff);
      approvalsDeleted += Number(approvals.changes || 0);
      const eventRows = await db.prepare('SELECT id FROM runtime_events WHERE project_id=? AND created_at<?').all(project.id, cutoff);
      await prepareControlIntelligenceSourcePurge({ projectId: project.id, runtimeEventIds: eventRows.map((row) => row.id) });
      await prepareRiskKnowledgeRuntimeEvidencePurge({ projectId: project.id, eventIds: eventRows.map((row) => row.id),
        reason: 'runtime event retention expired' });
      const result = await db.prepare('DELETE FROM runtime_events WHERE project_id=? AND created_at<?').run(project.id, cutoff);
      deleted += Number(result.changes || 0);
    });
  }
  return { deleted, approvalsDeleted };
}

async function projectUsage(projectId) {
  const periodStart = monthStart();
  const row = await db.prepare(`SELECT COUNT(*) requests,
    SUM(CASE WHEN decision='deny' THEN 1 ELSE 0 END) denied,
    AVG(evaluation_ms) average_ms FROM runtime_events WHERE project_id=? AND created_at>=?`).get(projectId, periodStart);
  return { periodStart, requests: Number(row?.requests || 0), denied: Number(row?.denied || 0), averageMs: Number(row?.average_ms || 0) };
}

async function listProjectAudit({ projectId, userId, limit = 50 }) {
  await requireProjectRole(projectId, userId, new Set(['viewer', 'analyst', 'developer', 'admin', 'owner']));
  const rows = await db.prepare(`SELECT id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at
    FROM security_audit_log WHERE project_id=? ORDER BY created_at DESC LIMIT ?`).all(projectId, Math.max(1, Math.min(200, Number(limit) || 50)));
  return rows.map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}), metadata_json: undefined }));
}

async function audit({ workspaceId = null, projectId = null, actorType, actorId = null, action, targetType = null, targetId = null, metadata = {} }) {
  await db.prepare(`INSERT INTO security_audit_log
    (id,workspace_id,project_id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id('aud_'), workspaceId, projectId, actorType, actorId, action, targetType, targetId, JSON.stringify(privacySafeObject(metadata, 60)), nowIso());
}

async function projectAccess(projectId, userId) {
  const row = await db.prepare(`SELECT p.*,m.role,
    CASE WHEN ac.project_id IS NULL THEN 'runtime' ELSE 'assessment_case' END project_kind
    FROM security_projects p
    JOIN workspace_members m ON m.workspace_id=p.workspace_id
    JOIN users actor ON actor.id=m.user_id
    LEFT JOIN owner_assessment_cases ac ON ac.project_id=p.id AND ac.workspace_id=p.workspace_id
    WHERE p.id=? AND m.user_id=? AND m.status='active'
      AND (ac.project_id IS NULL OR actor.role='superuser')`).get(projectId, userId);
  return row ? { project: row, role: row.role } : null;
}

async function requireProjectRole(projectId, userId, roles, lock=false) {
  const access = lock && db.kind==='postgres' ? (()=>db.prepare(`SELECT p.*,m.role,
    CASE WHEN ac.project_id IS NULL THEN 'runtime' ELSE 'assessment_case' END project_kind
    FROM security_projects p
    JOIN workspace_members m ON m.workspace_id=p.workspace_id
    JOIN users actor ON actor.id=m.user_id
    LEFT JOIN owner_assessment_cases ac ON ac.project_id=p.id AND ac.workspace_id=p.workspace_id
    WHERE p.id=? AND m.user_id=? AND m.status='active'
      AND (ac.project_id IS NULL OR actor.role='superuser') FOR UPDATE OF p`).get(projectId,userId).then(row=>row?{project:row,role:row.role}:null))() : projectAccess(projectId, userId);
  const resolved=await access;
  if (!resolved || !roles.has(resolved.role)) throw forbidden('Project not found or permission denied.');
  return resolved;
}

async function isPlatformSuperuser(userId) {
  const row = await db.prepare('SELECT role FROM users WHERE id=?').get(userId);
  return row?.role === 'superuser';
}

async function assertRuntimeProject({ projectId, userId }) {
  const access = await projectAccess(projectId, userId);
  if (!access) throw forbidden('Project not found or permission denied.');
  if ((access.project.project_kind || PROJECT_KINDS.RUNTIME) === PROJECT_KINDS.ASSESSMENT_CASE) {
    throw forbidden('Owner assessment cases are evidence-only and do not provide runtime protection capabilities.');
  }
  return access;
}

async function workspaceMembership(workspaceId, userId) {
  return db.prepare(`SELECT workspace_id,role,status FROM workspace_members WHERE workspace_id=? AND user_id=? AND status='active'`).get(workspaceId, userId);
}

async function workspaceBillingUser(workspaceId) {
  const owner = await db.prepare(`SELECT user_id FROM workspace_members WHERE workspace_id=? AND role='owner' AND status='active' AND user_id IS NOT NULL ORDER BY created_at ASC LIMIT 1`).get(workspaceId);
  if (owner?.user_id) return owner.user_id;
  const workspace = await db.prepare('SELECT created_by FROM workspaces WHERE id=?').get(workspaceId);
  if (!workspace?.created_by) throw badRequest('Workspace billing owner is unavailable.');
  return workspace.created_by;
}

async function availableSlug(workspaceId, base) {
  const cleanBase = base || 'project';
  for (let index = 0; index < 100; index += 1) {
    const value = index ? `${cleanBase}-${index + 1}` : cleanBase;
    if (!await db.prepare('SELECT id FROM security_projects WHERE workspace_id=? AND slug=?').get(workspaceId, value)) return value;
  }
  return `${cleanBase}-${crypto.randomBytes(3).toString('hex')}`;
}

function defaultProjectPolicy(environment) {
  return {
    version: '1', mode: environment === 'development' ? 'monitor' : 'enforce',
    allowedTools: [], deniedTools: ['shell', 'exec', 'terminal', 'delete', 'drop_database'], allowedHosts: [],
    deniedPathPatterns: ['..', '/etc/', '/proc/', '/root/', '.ssh/', '.env', 'credentials'],
    requireApprovalFor: ['write', 'delete', 'send', 'deploy', 'execute', 'payment', 'transfer', 'refund'],
    blockSecretLikeValues: true, inspectInput: true, inspectOutput: true,
  };
}

function publicProject(row) {
  const policy = parseJson(row.policy_json, {});
  const projectKind = row.project_kind === PROJECT_KINDS.ASSESSMENT_CASE ? PROJECT_KINDS.ASSESSMENT_CASE : PROJECT_KINDS.RUNTIME;
  return {
    id: row.id, workspaceId: row.workspace_id, billingUserId: row.billing_user_id, name: row.name, slug: row.slug,
    projectKind, runtimeEnabled: projectKind === PROJECT_KINDS.RUNTIME,
    environment: row.environment, status: row.status, role: row.role, policy, policyVersion: row.policy_version,
    policyDigest: row.policy_digest || null, policyPublishedAt: row.policy_published_at || null,
    retentionDays: Number(row.retention_days || 30), createdAt: row.created_at, updatedAt: row.updated_at,
    apiKeyCount: Number(row.api_key_count || 0), runtimeRequestsMonth: Number(row.runtime_requests_month || 0),
    deniedMonth: Number(row.denied_month || 0), lastRuntimeEventAt: row.last_runtime_event_at || null,
    lastInventoryAt: row.last_inventory_at || null, latestInventoryTotal: Number((parseJson(row.latest_inventory_summary, {}) || {}).total || 0),
    openRemediations: Number(row.open_remediations || 0),
  };
}

function projectColumns(row) {
  return {
    id: row.project_id || row.id, workspace_id: row.workspace_id, billing_user_id: row.billing_user_id,
    created_by: row.created_by, name: row.name, slug: row.slug, environment: row.environment, status: row.status,
    policy_json: row.policy_json, policy_version: row.policy_version, policy_digest: row.policy_digest, policy_published_at: row.policy_published_at,
    retention_days: row.retention_days,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function permissionsFor(role) {
  return { read: true, review: REVIEW_ROLES.has(role), manage: MANAGE_ROLES.has(role), rotateKeys: MANAGE_ROLES.has(role), approveActions: APPROVER_ROLES.has(role) };
}

function publicEntitlement(entitlement, usage) {
  return { key: entitlement.key, name: entitlement.name, projects: entitlement.projects, runtimeRequestsPerMonth: entitlement.runtimeRequestsPerMonth,
    runtimeRequestsPerMinute: entitlement.runtimeRequestsPerMinute, retentionDays: entitlement.retentionDays, apiKeysPerProject: entitlement.apiKeysPerProject, usage };
}

function extractInput(body) {
  if (body.input != null) return body.input;
  if (Array.isArray(body.messages)) return body.messages.filter((message) => String(message?.role || '').toLowerCase() !== 'assistant');
  return null;
}
function extractOutput(body) {
  if (body.output != null) return body.output;
  if (Array.isArray(body.messages)) return [...body.messages].reverse().find((message) => String(message?.role || '').toLowerCase() === 'assistant') || null;
  return null;
}

function toolCallArguments(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') return {};
  if (Object.hasOwn(toolCall, 'arguments')) return toolCall.arguments;
  if (Object.hasOwn(toolCall, 'args')) return toolCall.args;
  return {};
}

function trustedRuntimeContext(project, body, toolCall) {
  const supplied = {
    ...(body?.context && typeof body.context === 'object' && !Array.isArray(body.context) ? body.context : {}),
    ...(toolCall?.context && typeof toolCall.context === 'object' && !Array.isArray(toolCall.context) ? toolCall.context : {}),
  };
  return {
    action: clean(supplied.action, 160),
    environment: clean(project.environment, 40).toLowerCase(),
  };
}

async function resolveRuntimeApproval({ project, body, toolCall, policy, trustedContext }) {
  if (!toolCall) return { required: false, valid: false, reason: 'not-required', actionDigest: null };
  const tool = clean(toolCall.name || toolCall.tool, 200).toLowerCase();
  const args = toolCallArguments(toolCall);
  const required = runtimeActionRequiresApproval(tool, trustedContext, policy);
  if (!required) return { required: false, valid: false, reason: 'not-required', actionDigest: null };
  let actionDigest;
  try {
    actionDigest = runtimeApprovalActionDigest({
      workspaceId: project.workspace_id,
      projectId: project.id,
      environment: project.environment,
      tool,
      arguments: args,
    });
  } catch {
    return { required: true, valid: false, reason: 'action-invalid', actionDigest: null };
  }
  const token = clean(body.approval_token || body.approvalToken || toolCall.approval_token || toolCall.approvalToken, 8192);
  if (!token) return { required: true, valid: false, reason: 'missing', actionDigest };
  const verified = verifyApproval(token, {
    workspaceId: project.workspace_id,
    projectId: project.id,
    actionDigest,
    tool,
    environment: clean(project.environment, 40).toLowerCase(),
  }, config.sessionSecret);
  if (!verified.valid) {
    const reason = verified.reason === 'expired' ? 'expired'
      : String(verified.reason || '').startsWith('binding-') ? 'binding-mismatch'
        : 'invalid';
    return { required: true, valid: false, reason, actionDigest };
  }
  const approvalQuery = `SELECT id,workspace_id,project_id,approver_id,tool_name,environment,action_digest,token_digest,status,
    issued_at,expires_at,consumed_at,consumed_request_id,runtime_event_id,revoked_at
    FROM runtime_approvals WHERE id=? AND project_id=?${db.kind === 'postgres' ? ' FOR UPDATE' : ''}`;
  const row = await db.prepare(approvalQuery).get(verified.approval.approvalId, project.id);
  if (!row || !safeEqualDigest(row.token_digest, approvalTokenDigest(token)))
    return { required: true, valid: false, reason: 'unrecognised', actionDigest };
  const status = runtimeApprovalStatus(row);
  if (status !== 'active')
    return { required: true, valid: false, reason: status === 'consumed' ? 'replayed' : status, actionDigest };
  if (row.workspace_id !== project.workspace_id || row.project_id !== project.id || row.tool_name !== tool
    || row.environment !== clean(project.environment, 40).toLowerCase() || !safeEqualDigest(row.action_digest, actionDigest))
    return { required: true, valid: false, reason: 'ledger-mismatch', actionDigest };
  return {
    required: true,
    valid: true,
    reason: 'verified',
    approvalId: row.id,
    environment: row.environment,
    actionDigest,
    tokenDigest: row.token_digest,
    expiresAt: row.expires_at,
  };
}

function runtimeApprovalStatus(row, timestampMs = Date.now()) {
  if (row?.status === 'consumed' || row?.consumed_at) return 'consumed';
  if (row?.status === 'revoked' || row?.revoked_at) return 'revoked';
  const expiry = Date.parse(row?.expires_at || '');
  if (!Number.isFinite(expiry) || expiry <= timestampMs) return 'expired';
  return row?.status === 'active' ? 'active' : 'invalid';
}

function publicRuntimeApproval(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    approverId: row.approver_id,
    tool: row.tool_name,
    environment: row.environment,
    actionDigest: row.action_digest,
    status: runtimeApprovalStatus(row),
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at || null,
    consumedRequestId: row.consumed_request_id || null,
    runtimeEventId: row.runtime_event_id || null,
    revokedAt: row.revoked_at || null,
  };
}

function normaliseReasons(input, output, tool) {
  const values = [];
  for (const item of input?.findings || []) values.push({ ruleId: item.ruleId, severity: item.severity, title: item.title, surface: 'input' });
  for (const item of output?.findings || []) values.push({ ruleId: item.ruleId, severity: item.severity, title: item.title, surface: 'output' });
  for (const item of tool?.reasons || []) values.push({ ruleId: item.ruleId, severity: item.severity, title: item.message, surface: 'tool' });
  return [...new Map(values.map((item) => [`${item.surface}:${item.ruleId}`, item])).values()];
}
function highestSeverity(reasons) {
  const order = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
  return reasons.reduce((highest, item) => order[item.severity] > order[highest] ? item.severity : highest, 'none');
}
function compareAssets(previous, current) {
  const before = new Map(previous.map((item) => [item.id, item]));
  const after = new Map(current.map((item) => [item.id, item]));
  const added = current.filter((item) => !before.has(item.id));
  const removed = previous.filter((item) => !after.has(item.id));
  const changed = current.filter((item) => before.has(item.id) && digest(JSON.stringify(before.get(item.id))) !== digest(JSON.stringify(item)))
    .map((item) => ({ before: before.get(item.id), after: item }));
  const exposureIncreased = added.filter((item) => item.internetExposed || item.privileged || item.environment === 'production').length
    + changed.filter((item) => (!item.before.internetExposed && item.after.internetExposed) || (!item.before.privileged && item.after.privileged) || (item.before.environment !== 'production' && item.after.environment === 'production')).length;
  return { baseline: previous.length === 0, added, removed, changed, exposureIncreased, deploymentGate: exposureIncreased > 0 ? 'review-required' : 'clear' };
}
function privacySafeMetadata(metadata, context) {
  const combined = { ...privacySafeObject(metadata, 30) };
  for (const key of ['userId', 'user_id', 'sessionId', 'session_id', 'tenantId', 'tenant_id']) {
    const value = metadata?.[key] ?? context?.[key];
    if (value != null) combined[`${key}Digest`] = digest(String(value));
  }
  return combined;
}
function privacySafeObject(input, maxEntries = 40) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const output = {};
  for (const [key, value] of Object.entries(input).slice(0, maxEntries)) {
    const cleanKey = clean(key, 80);
    if (!cleanKey || /secret|password|token|authorization|prompt|content|response|argument/i.test(cleanKey)) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) output[cleanKey] = typeof value === 'string' ? clean(value, 200) : value;
  }
  return output;
}
function monthStart() { const date = new Date(); return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString(); }
function slugify(value) { return clean(value, 100).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }
function clean(value, max) { return String(value ?? '').trim().slice(0, max); }
function digest(value) { return crypto.createHash('sha256').update(String(value ?? '')).digest('hex'); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function policyIdentityDigest(policy, projectId) {
  const { version: _version, ...securityPolicy } = policy || {};
  return digest(canonicalJson({ projectId, policy: securityPolicy }));
}
function safeEqualDigest(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a.toLowerCase(), 'hex'), Buffer.from(b.toLowerCase(), 'hex'));
}
function sanitiseVerificationInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const limits = Object.freeze({
    artifactId: 100,
    reference: 500,
    retestReference: 500,
    notes: 3000,
    rootCause: 2000,
    correctiveAction: 4000,
    targetEnvironment: 500,
    rollbackPlan: 2000,
    validationPlan: 3000,
    changeReference: 500,
    limitations: 3000,
  });
  const output = {};
  for (const [key, maxLength] of Object.entries(limits)) {
    if (!Object.hasOwn(input, key) || input[key] == null || typeof input[key] !== 'string') continue;
    output[key] = clean(input[key], maxLength);
  }
  return output;
}
async function resolveActiveRetestCriteria({ project, criteriaId }) {
  const criteria = await db.prepare(`SELECT * FROM remediation_retest_criteria
    WHERE id=? AND workspace_id=? AND project_id=?`).get(criteriaId, project.workspace_id, project.id);
  if (!criteria || criteria.status !== 'active' || criteria.runtime_event_id) throw badRequest('Retest criteria are missing, inactive or already consumed.');
  const expiry = Date.parse(criteria.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw badRequest('Retest criteria are expired or malformed.');
  if (criteria.policy_version !== project.policy_version || !safeEqualDigest(criteria.policy_digest, project.policy_digest)
    || criteria.policy_published_at !== project.policy_published_at)
    throw badRequest('Retest criteria do not match the current published policy.');
  const authoritativeDigest = retestCriteriaDigest(criteria);
  if (!safeEqualDigest(criteria.criteria_digest, authoritativeDigest)) throw badRequest('Retest criteria integrity verification failed.');
  return criteria;
}
function runtimeActionIdentity({ projectId, inputValue, outputValue, toolCall }) {
  if (toolCall) return { actionType: 'tool', targetIdentity: clean(toolCall.name || toolCall.tool, 200).toLowerCase() };
  if (inputValue != null) return { actionType: 'content.input', targetIdentity: `project:${projectId}` };
  if (outputValue != null) return { actionType: 'content.output', targetIdentity: `project:${projectId}` };
  return { actionType: 'unknown', targetIdentity: `project:${projectId}` };
}
function criteriaSatisfied(criteria, actual) {
  return criteria.expected_decision === actual.decision
    && criteria.action_type === actual.actionType
    && criteria.target_identity === actual.targetIdentity
    && actual.ruleIds.includes(criteria.rule_id);
}
function retestCriteriaDigest(criteria) {
  return digest(canonicalJson({
    id: criteria.id,
    workspaceId: criteria.workspace_id,
    projectId: criteria.project_id,
    remediationId: criteria.remediation_id,
    findingKey: criteria.finding_key,
    ruleId: criteria.rule_id,
    expectedDecision: criteria.expected_decision,
    actionType: criteria.action_type,
    targetIdentity: criteria.target_identity,
    policyVersion: criteria.policy_version,
    policyDigest: criteria.policy_digest,
    policyPublishedAt: criteria.policy_published_at,
    createdAt: criteria.created_at,
    expiresAt: criteria.expires_at,
  }));
}
function parseJson(value, fallback) { try { return value && typeof value === 'object' ? value : JSON.parse(value); } catch { return fallback; } }
function roundedMs(value) { return Math.round(Number(value || 0) * 1000) / 1000; }
function validEmail(value) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || '').trim()); }
function validOptionalDate(value) { if (!value) return null; const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw badRequest('Due date must be a valid timestamp.'); return new Date(parsed).toISOString(); }
function error(message, statusCode, code) { const value = new Error(message); value.statusCode = statusCode; value.code = code; return value; }
function badRequest(message) { return error(message, 400, 'invalid_request'); }
function unauthorised(message) { return error(message, 401, 'invalid_api_key'); }
function forbidden(message) { return error(message, 403, 'forbidden'); }
function notFound(message) { return error(message, 404, 'not_found'); }
function conflict(message) { return error(message, 409, 'conflict'); }
function paymentRequired(message) { return error(message, 402, 'plan_limit'); }
