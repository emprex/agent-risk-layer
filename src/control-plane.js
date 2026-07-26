import crypto from 'node:crypto';
import { db, id, nowIso } from './db.js';
import { compileRuntimePolicy, evaluateRuntimeAction } from './runtime-policy.js';
import { inspectContent } from './content-security.js';
import { discoverAiAssets } from './asset-discovery.js';
import { deliverSecurityEventSystem } from './workspaces.js';

export const GUARD_REQUEST_SCHEMA = 'arl.guard.request.v1';
export const GUARD_RESPONSE_SCHEMA = 'arl.guard.response.v1';

export const PLAN_ENTITLEMENTS = Object.freeze({
  community: Object.freeze({ projects: 1, runtimeRequestsPerMonth: 10_000, runtimeRequestsPerMinute: 60, retentionDays: 7, apiKeysPerProject: 2, name: 'Community' }),
  developer_monthly: Object.freeze({ projects: 3, runtimeRequestsPerMonth: 50_000, runtimeRequestsPerMinute: 600, retentionDays: 30, apiKeysPerProject: 5, name: 'Developer' }),
  team_monthly: Object.freeze({ projects: 15, runtimeRequestsPerMonth: 250_000, runtimeRequestsPerMinute: 2_500, retentionDays: 90, apiKeysPerProject: 15, name: 'Team' }),
  agency_monthly: Object.freeze({ projects: 50, runtimeRequestsPerMonth: 1_000_000, runtimeRequestsPerMinute: 10_000, retentionDays: 180, apiKeysPerProject: 30, name: 'Agency' }),
  enterprise: Object.freeze({ projects: 500, runtimeRequestsPerMonth: 10_000_000, runtimeRequestsPerMinute: 30_000, retentionDays: 365, apiKeysPerProject: 100, name: 'Enterprise' }),
});

const PROJECT_ENVIRONMENTS = new Set(['development', 'test', 'staging', 'production']);
const PROJECT_STATUSES = new Set(['active', 'paused', 'archived']);
const REMEDIATION_STATUSES = new Set(['open', 'in_progress', 'ready_for_retest', 'verified', 'accepted_risk', 'closed']);
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const MANAGE_ROLES = new Set(['developer', 'admin', 'owner']);
const REVIEW_ROLES = new Set(['analyst', 'developer', 'admin', 'owner']);

export async function entitlementForUser(userId) {
  const subscription = await db.prepare(`SELECT plan_key,status,current_period_end FROM subscriptions
    WHERE user_id=? AND status IN ('active','trialing') ORDER BY updated_at DESC LIMIT 1`).get(userId);
  const requested = subscription?.plan_key || 'community';
  const key = PLAN_ENTITLEMENTS[requested] ? requested : 'community';
  return { key, ...PLAN_ENTITLEMENTS[key], subscription: subscription || null };
}

export async function createSecurityProject({ userId, workspaceId, name, environment = 'development' }) {
  const membership = await workspaceMembership(workspaceId, userId);
  if (!membership || !MANAGE_ROLES.has(membership.role)) throw forbidden('Workspace developer, admin or owner access is required.');
  const cleanName = clean(name, 100);
  if (cleanName.length < 2) throw badRequest('Project name must contain at least two characters.');
  const cleanEnvironment = PROJECT_ENVIRONMENTS.has(environment) ? environment : 'development';
  const billingUserId = await workspaceBillingUser(workspaceId);
  const entitlement = await entitlementForUser(billingUserId);
  const projectCount = Number((await db.prepare(`SELECT COUNT(*) count FROM security_projects
    WHERE billing_user_id=? AND status!='archived'`).get(billingUserId)).count || 0);
  if (projectCount >= entitlement.projects) throw paymentRequired(`${entitlement.name} supports ${entitlement.projects} active project${entitlement.projects === 1 ? '' : 's'}. Upgrade to add another.`);
  const projectId = id('prj_');
  const timestamp = nowIso();
  const slug = await availableSlug(workspaceId, slugify(cleanName));
  const policy = compileRuntimePolicy(defaultProjectPolicy(cleanEnvironment));
  await db.prepare(`INSERT INTO security_projects
    (id,workspace_id,billing_user_id,created_by,name,slug,environment,status,policy_json,policy_version,retention_days,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'active',?,?,?,?,?)`)
    .run(projectId, workspaceId, billingUserId, userId, cleanName, slug, cleanEnvironment, JSON.stringify(policy), policy.version,
      Math.min(entitlement.retentionDays, cleanEnvironment === 'production' ? 90 : entitlement.retentionDays), timestamp, timestamp);
  await audit({ workspaceId, projectId, actorType: 'user', actorId: userId, action: 'project.created', targetType: 'project', targetId: projectId, metadata: { environment: cleanEnvironment } });
  return getSecurityProject({ projectId, userId });
}

export async function listSecurityProjects(userId) {
  const rows = await db.prepare(`SELECT p.*,m.role,
      (SELECT COUNT(*) FROM project_api_keys k WHERE k.project_id=p.id AND k.revoked_at IS NULL) api_key_count,
      (SELECT COUNT(*) FROM runtime_events e WHERE e.project_id=p.id AND e.created_at>=?) runtime_requests_month,
      (SELECT COUNT(*) FROM runtime_events e WHERE e.project_id=p.id AND e.decision='deny' AND e.created_at>=?) denied_month,
      (SELECT MAX(created_at) FROM runtime_events e WHERE e.project_id=p.id) last_runtime_event_at,
      (SELECT MAX(created_at) FROM asset_snapshots a WHERE a.project_id=p.id) last_inventory_at,
      (SELECT summary_json FROM asset_snapshots a WHERE a.project_id=p.id ORDER BY created_at DESC LIMIT 1) latest_inventory_summary,
      (SELECT COUNT(*) FROM remediation_items r WHERE r.project_id=p.id AND r.status NOT IN ('verified','closed')) open_remediations
    FROM security_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id
    WHERE m.user_id=? AND m.status='active' ORDER BY p.created_at DESC`).all(monthStart(), monthStart(), userId);
  return rows.map(publicProject);
}

export async function getSecurityProject({ projectId, userId }) {
  const access = await projectAccess(projectId, userId);
  if (!access) throw forbidden('Project not found or access denied.');
  const entitlement = await entitlementForUser(access.project.billing_user_id);
  const usage = await projectUsage(projectId);
  return {
    ...publicProject({ ...access.project, role: access.role }),
    permissions: permissionsFor(access.role),
    entitlement: publicEntitlement(entitlement, usage),
    apiKeys: await listProjectApiKeys({ projectId, userId }),
    events: await listRuntimeEvents({ projectId, userId, limit: 50 }),
    inventory: await listAssetSnapshots({ projectId, userId, limit: 10 }),
    remediations: await listRemediationItems({ projectId, userId }),
    audit: await listProjectAudit({ projectId, userId, limit: 40 }),
  };
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
  const entitlement = await entitlementForUser(current.billing_user_id);
  const requestedRetention = patch.retentionDays == null ? Number(current.retention_days) : Number(patch.retentionDays);
  const retentionDays = Math.max(1, Math.min(entitlement.retentionDays, Number.isFinite(requestedRetention) ? Math.trunc(requestedRetention) : entitlement.retentionDays));
  const timestamp = nowIso();
  await db.prepare(`UPDATE security_projects SET name=?,environment=?,status=?,policy_json=?,policy_version=?,retention_days=?,updated_at=? WHERE id=?`)
    .run(name, environment, status, JSON.stringify(policy), policy.version, retentionDays, timestamp, projectId);
  await audit({ workspaceId: current.workspace_id, projectId, actorType: 'user', actorId: userId, action: patch.policy ? 'policy.updated' : 'project.updated', targetType: 'project', targetId: projectId,
    metadata: { environment, status, policyVersion: policy.version, retentionDays } });
  return getSecurityProject({ projectId, userId });
}

export async function createProjectApiKey({ projectId, userId, name = 'Runtime key', expiresAt = null }) {
  const access = await requireProjectRole(projectId, userId, MANAGE_ROLES);
  const entitlement = await entitlementForUser(access.project.billing_user_id);
  const activeCount = Number((await db.prepare(`SELECT COUNT(*) count FROM project_api_keys WHERE project_id=? AND revoked_at IS NULL`).get(projectId)).count || 0);
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
  return { id: keyId, name: clean(name, 100) || 'Runtime key', prefix, token: raw, createdAt: timestamp, expiresAt: cleanExpiry, shownOnce: true };
}

export async function listProjectApiKeys({ projectId, userId }) {
  await requireProjectRole(projectId, userId, new Set(['viewer', 'analyst', 'developer', 'admin', 'owner']));
  return await db.prepare(`SELECT id,name,key_prefix,created_at,expires_at,last_used_at,revoked_at
    FROM project_api_keys WHERE project_id=? ORDER BY created_at DESC`).all(projectId);
}

export async function revokeProjectApiKey({ projectId, keyId, userId }) {
  const access = await requireProjectRole(projectId, userId, MANAGE_ROLES);
  const result = await db.prepare(`UPDATE project_api_keys SET revoked_at=? WHERE id=? AND project_id=? AND revoked_at IS NULL`).run(nowIso(), keyId, projectId);
  if (Number(result.changes) !== 1) throw notFound('Active API key not found.');
  await audit({ workspaceId: access.project.workspace_id, projectId, actorType: 'user', actorId: userId, action: 'api_key.revoked', targetType: 'api_key', targetId: keyId });
  return { ok: true };
}

export async function authenticateProjectApiKey(rawToken) {
  const token = String(rawToken || '').trim();
  if (!/^arl_live_[a-f0-9]{10}_[A-Za-z0-9_-]{32,}$/.test(token)) throw unauthorised('Invalid project API key.');
  const row = await db.prepare(`SELECT k.id api_key_id,k.project_id,k.expires_at,k.revoked_at,p.*
    FROM project_api_keys k JOIN security_projects p ON p.id=k.project_id WHERE k.token_hash=?`).get(digest(token));
  if (!row || row.revoked_at || row.status !== 'active') throw unauthorised('Invalid or inactive project API key.');
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) throw unauthorised('Project API key has expired.');
  return { apiKeyId: row.api_key_id, project: projectColumns(row) };
}

export async function screenGuardRequest({ rawToken, body = {}, authenticated = null }) {
  const auth = authenticated || await authenticateProjectApiKey(rawToken);
  const project = auth.project;
  const requestId = clean(body.request_id || body.requestId || crypto.randomUUID(), 100);
  if (!requestId) throw badRequest('A request identifier is required.');
  const policy = compileRuntimePolicy(parseJson(project.policy_json, {}));
  const started = performance.now();
  const response = await db.transaction(async () => {
    if (db.kind === 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(project.id);
    const existing = await db.prepare(`SELECT response_json FROM runtime_events WHERE project_id=? AND request_id=?`).get(project.id, requestId);
    if (existing) return { ...parseJson(existing.response_json, {}), replayed: true };
    const entitlement = await entitlementForUser(project.billing_user_id);
    const usage = await projectUsage(project.id);
    if (usage.requests >= entitlement.runtimeRequestsPerMonth) throw paymentRequired('Monthly runtime-screening allowance reached. Upgrade or wait for the next billing month.');

    const inputValue = extractInput(body);
    const outputValue = extractOutput(body);
    const toolCall = body.tool_call || body.toolCall || null;
    const inputResult = inputValue == null || policy.inspectInput === false ? null : inspectContent({ direction: 'input', content: inputValue, requestId, maxBytes: policy.maxResponseBytes });
    const outputResult = outputValue == null || policy.inspectOutput === false ? null : inspectContent({ direction: 'output', content: outputValue, requestId, maxBytes: policy.maxResponseBytes });
    const toolResult = toolCall ? evaluateRuntimeAction({ requestId, tool: toolCall.name || toolCall.tool, arguments: toolCall.arguments || toolCall.args,
      context: { ...(body.context || {}), ...(toolCall.context || {}) } }, policy) : null;
    const reasons = normaliseReasons(inputResult, outputResult, toolResult);
    const flagged = reasons.length > 0;
    const enforced = policy.mode === 'enforce';
    const decision = flagged && enforced ? 'deny' : 'allow';
    const observedDecision = flagged ? 'would-deny' : 'allow';
    const severity = highestSeverity(reasons);
    const evaluationMs = roundedMs(performance.now() - started);
    const evidence = {
      inputDigest: inputResult?.evidence?.contentDigest || null,
      outputDigest: outputResult?.evidence?.contentDigest || null,
      argumentDigest: toolResult?.evidence?.argumentDigest || null,
      tool: toolResult?.evidence?.tool || null,
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
      policy: { schema: policy.schema, version: policy.version, mode: policy.mode, failMode: policy.failMode },
      reasons,
      evidence,
      usage: { periodStart: usage.periodStart, requests: usage.requests + 1, limit: entitlement.runtimeRequestsPerMonth },
      evaluationMs,
    };
    const metadata = privacySafeMetadata(body.metadata || {}, body.context || {});
    await db.prepare(`INSERT INTO runtime_events
      (id,project_id,api_key_id,request_id,event_type,decision,observed_decision,severity,rule_ids_json,content_digest,tool_name,argument_digest,evaluation_ms,metadata_json,response_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id('rte_'), project.id, auth.apiKeyId, requestId, 'guard', decision, observedDecision, severity,
      JSON.stringify(reasons.map((item) => item.ruleId)), evidence.inputDigest || evidence.outputDigest, evidence.tool, evidence.argumentDigest, evaluationMs,
      JSON.stringify(metadata), JSON.stringify(response), response.timestamp);
    await db.prepare('UPDATE project_api_keys SET last_used_at=? WHERE id=?').run(response.timestamp, auth.apiKeyId);
    if (decision === 'deny') {
      await audit({ workspaceId: project.workspace_id, projectId: project.id, actorType: 'api_key', actorId: auth.apiKeyId, action: 'runtime.denied', targetType: 'runtime_request', targetId: requestId,
        metadata: { severity, ruleIds: reasons.map((item) => item.ruleId) } });
    }
    return response;
  });
  if (response.decision === 'deny' && !response.replayed) {
    void deliverSecurityEventSystem({ workspaceId: project.workspace_id, event: {
      type: 'runtime_denied', severity: response.severity, title: 'AI runtime action denied',
      projectId: project.id, requestId: response.requestId, decision: response.decision,
      ruleIds: response.reasons.map((item) => item.ruleId), timestamp: response.timestamp,
    } }).catch((error) => console.error('Runtime integration delivery failed:', error.message));
  }
  return response;
}

export async function listRuntimeEvents({ projectId, userId, limit = 100, decision = '' }) {
  await requireProjectRole(projectId, userId, new Set(['viewer', 'analyst', 'developer', 'admin', 'owner']));
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const rows = decision && ['allow', 'deny'].includes(decision)
    ? await db.prepare(`SELECT id,request_id,event_type,decision,observed_decision,severity,rule_ids_json,tool_name,evaluation_ms,metadata_json,created_at
      FROM runtime_events WHERE project_id=? AND decision=? ORDER BY created_at DESC LIMIT ?`).all(projectId, decision, safeLimit)
    : await db.prepare(`SELECT id,request_id,event_type,decision,observed_decision,severity,rule_ids_json,tool_name,evaluation_ms,metadata_json,created_at
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
  const timestamp = nowIso();
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

export async function updateRemediationItem({ projectId, itemId, userId, patch = {} }) {
  const access = await requireProjectRole(projectId, userId, REVIEW_ROLES);
  const current = await db.prepare('SELECT * FROM remediation_items WHERE id=? AND project_id=?').get(itemId, projectId);
  if (!current) throw notFound('Remediation item not found.');
  const status = patch.status == null ? current.status : clean(patch.status, 40).toLowerCase();
  if (!REMEDIATION_STATUSES.has(status)) throw badRequest('Unknown remediation status.');
  const title = patch.title == null ? current.title : clean(patch.title, 240);
  const severity = patch.severity == null ? current.severity : clean(patch.severity, 20).toLowerCase();
  if (!SEVERITIES.has(severity)) throw badRequest('Unknown severity.');
  const ownerEmail = patch.ownerEmail == null ? current.owner_email : (validEmail(patch.ownerEmail) ? clean(patch.ownerEmail, 254).toLowerCase() : null);
  const dueAt = patch.dueAt == null ? current.due_at : validOptionalDate(patch.dueAt);
  const verification = patch.verification == null ? parseJson(current.verification_json, {}) : privacySafeObject(patch.verification, 30);
  await db.prepare(`UPDATE remediation_items SET title=?,severity=?,status=?,owner_email=?,due_at=?,verification_json=?,updated_at=? WHERE id=? AND project_id=?`)
    .run(title, severity, status, ownerEmail, dueAt, JSON.stringify(verification), nowIso(), itemId, projectId);
  await audit({ workspaceId: access.project.workspace_id, projectId, actorType: 'user', actorId: userId, action: 'remediation.updated', targetType: 'remediation', targetId: itemId, metadata: { status, severity } });
  return db.prepare('SELECT * FROM remediation_items WHERE id=?').get(itemId);
}

export async function listRemediationItems({ projectId, userId }) {
  await requireProjectRole(projectId, userId, new Set(['viewer', 'analyst', 'developer', 'admin', 'owner']));
  const rows = await db.prepare(`SELECT * FROM remediation_items WHERE project_id=?
    ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, updated_at DESC`).all(projectId);
  return rows.map((row) => ({ ...row, verification: parseJson(row.verification_json, {}), verification_json: undefined }));
}

export async function controlPlaneOverview(userId) {
  const projects = await listSecurityProjects(userId);
  const projectIds = projects.map((item) => item.id);
  if (!projectIds.length) return { projects: [], totals: { projects: 0, runtimeRequestsMonth: 0, deniedMonth: 0, openRemediations: 0, assets: 0 }, entitlement: await entitlementForUser(userId) };
  return {
    projects,
    totals: {
      projects: projects.filter((item) => item.status !== 'archived').length,
      runtimeRequestsMonth: projects.reduce((sum, item) => sum + Number(item.runtimeRequestsMonth || 0), 0),
      deniedMonth: projects.reduce((sum, item) => sum + Number(item.deniedMonth || 0), 0),
      openRemediations: projects.reduce((sum, item) => sum + Number(item.openRemediations || 0), 0),
      assets: projects.reduce((sum, item) => sum + Number(item.latestInventoryTotal || 0), 0),
    },
    entitlement: await entitlementForUser(userId),
  };
}

export async function purgeExpiredRuntimeEvents() {
  const projects = await db.prepare(`SELECT id,retention_days FROM security_projects WHERE status!='archived'`).all();
  let deleted = 0;
  for (const project of projects) {
    const cutoff = new Date(Date.now() - Math.max(1, Number(project.retention_days || 30)) * 86400000).toISOString();
    const result = await db.prepare('DELETE FROM runtime_events WHERE project_id=? AND created_at<?').run(project.id, cutoff);
    deleted += Number(result.changes || 0);
  }
  return { deleted };
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
  const row = await db.prepare(`SELECT p.*,m.role FROM security_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id
    WHERE p.id=? AND m.user_id=? AND m.status='active'`).get(projectId, userId);
  return row ? { project: row, role: row.role } : null;
}

async function requireProjectRole(projectId, userId, roles) {
  const access = await projectAccess(projectId, userId);
  if (!access || !roles.has(access.role)) throw forbidden('Project not found or permission denied.');
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
    requireApprovalFor: ['write', 'delete', 'send', 'deploy', 'execute', 'payment', 'transfer'],
    blockSecretLikeValues: true, inspectInput: true, inspectOutput: true,
  };
}

function publicProject(row) {
  const policy = parseJson(row.policy_json, {});
  return {
    id: row.id, workspaceId: row.workspace_id, billingUserId: row.billing_user_id, name: row.name, slug: row.slug,
    environment: row.environment, status: row.status, role: row.role, policy, policyVersion: row.policy_version,
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
    policy_json: row.policy_json, policy_version: row.policy_version, retention_days: row.retention_days,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function permissionsFor(role) {
  return { read: true, review: REVIEW_ROLES.has(role), manage: MANAGE_ROLES.has(role), rotateKeys: MANAGE_ROLES.has(role) };
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
function parseJson(value, fallback) { try { return value && typeof value === 'object' ? value : JSON.parse(value); } catch { return fallback; } }
function roundedMs(value) { return Math.round(Number(value || 0) * 1000) / 1000; }
function validEmail(value) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || '').trim()); }
function validOptionalDate(value) { if (!value) return null; const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw badRequest('Due date must be a valid timestamp.'); return new Date(parsed).toISOString(); }
function error(message, statusCode, code) { const value = new Error(message); value.statusCode = statusCode; value.code = code; return value; }
function badRequest(message) { return error(message, 400, 'invalid_request'); }
function unauthorised(message) { return error(message, 401, 'invalid_api_key'); }
function forbidden(message) { return error(message, 403, 'forbidden'); }
function notFound(message) { return error(message, 404, 'not_found'); }
function paymentRequired(message) { return error(message, 402, 'plan_limit'); }
