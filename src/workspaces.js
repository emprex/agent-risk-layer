import crypto from 'node:crypto';
import { db, id, insertEvent, nowIso } from './db.js';
import { ROLE_PERMISSIONS, authoriseWorkspaceAction } from './access-control.js';
import { buildSecurityNotification, signWebhookPayload } from './enterprise-security.js';
const ROLES = Object.freeze(Object.keys(ROLE_PERMISSIONS));
export async function createWorkspace(userId, name) {
    const cleanName = String(name || '').trim().slice(0, 100);
    if (cleanName.length < 2)
        throw new Error('Workspace name must contain at least two characters.');
    const workspaceId = id('ws_');
    const createdAt = nowIso();
    await db.transaction(async () => {
        await db.prepare('INSERT INTO workspaces (id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?)')
            .run(workspaceId, cleanName, userId, createdAt, createdAt);
        await db.prepare(`INSERT INTO workspace_members (id,workspace_id,user_id,email,role,status,created_at,updated_at)
      SELECT ?,?,id,email,'owner','active',?,? FROM users WHERE id=?`).run(id('wsm_'), workspaceId, createdAt, createdAt, userId);
    });
    await insertEvent('workspace_created', userId, { workspaceId });
    return await getWorkspace(workspaceId, userId);
}
export async function listWorkspaces(userId) {
    return await db.prepare(`SELECT w.id,w.name,w.created_at,w.updated_at,m.role,m.status,
      (SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id=w.id AND wm.status='active') member_count
    FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
    WHERE m.user_id=? AND m.status='active' ORDER BY w.created_at DESC`).all(userId);
}
export async function getWorkspace(workspaceId, userId) {
    const membership = await membershipFor(workspaceId, userId);
    if (!membership)
        throw forbidden('Workspace not found or access denied.');
    const workspace = await db.prepare('SELECT id,name,created_at,updated_at FROM workspaces WHERE id=?').get(workspaceId);
    return {
        ...workspace,
        role: membership.role,
        permissions: ROLE_PERMISSIONS[membership.role],
        members: await db.prepare(`SELECT id,user_id,email,display_name,role,status,external_id,created_at,updated_at
      FROM workspace_members WHERE workspace_id=? ORDER BY created_at`).all(workspaceId),
        integrations: await db.prepare(`SELECT id,type,name,status,created_at,updated_at,last_delivery_at,last_error
      FROM workspace_integrations WHERE workspace_id=? ORDER BY created_at`).all(workspaceId),
    };
}
export async function upsertMember({ workspaceId, actorId, email, role = 'viewer', displayName = '', externalId = '', active = true }) {
    await requireAction(workspaceId, actorId, 'member:*');
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail))
        throw new Error('A valid member email is required.');
    if (!ROLES.includes(role))
        throw new Error('Unknown workspace role.');
    const existing = externalId
        ? await db.prepare('SELECT * FROM workspace_members WHERE workspace_id=? AND external_id=?').get(workspaceId, externalId) : await db.prepare('SELECT * FROM workspace_members WHERE workspace_id=? AND email=?').get(workspaceId, cleanEmail);
    const user = await db.prepare('SELECT id FROM users WHERE email=?').get(cleanEmail);
    const timestamp = nowIso();
    if (existing) {
        if (existing.role === 'owner' && (!active || role !== 'owner') && await ownerCount(workspaceId) <= 1)
            throw new Error('A workspace must retain at least one active owner.');
        await db.prepare(`UPDATE workspace_members SET user_id=?,email=?,display_name=?,role=?,status=?,external_id=?,updated_at=? WHERE id=?`)
            .run(user?.id || null, cleanEmail, String(displayName || '').slice(0, 120), role, active ? 'active' : 'deprovisioned', externalId || null, timestamp, existing.id);
    }
    else {
        await db.prepare(`INSERT INTO workspace_members (id,workspace_id,user_id,email,display_name,role,status,external_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id('wsm_'), workspaceId, user?.id || null, cleanEmail, String(displayName || '').slice(0, 120), role, active ? 'active' : 'deprovisioned', externalId || null, timestamp, timestamp);
    }
    await insertEvent(active ? 'workspace_member_upserted' : 'workspace_member_deprovisioned', actorId, { workspaceId, email: cleanEmail, role });
    return await getWorkspace(workspaceId, actorId);
}
export async function createScimToken(workspaceId, actorId) {
    await requireAction(workspaceId, actorId, 'member:*');
    const raw = `scim_${crypto.randomBytes(32).toString('base64url')}`;
    await db.prepare('UPDATE workspaces SET scim_token_hash=?,updated_at=? WHERE id=?').run(digest(raw), nowIso(), workspaceId);
    await insertEvent('scim_token_rotated', actorId, { workspaceId });
    return raw;
}
export async function authenticateScim(workspaceId, rawToken) {
    const row = await db.prepare('SELECT scim_token_hash FROM workspaces WHERE id=?').get(workspaceId);
    if (!row?.scim_token_hash || !safeEqual(row.scim_token_hash, digest(rawToken)))
        throw forbidden('Invalid SCIM token.');
    return row;
}
export async function provisionScimUser(workspaceId, input) {
    const email = String(input.userName || input.emails?.[0]?.value || '').trim().toLowerCase();
    const role = String(input.roles?.[0]?.value || input.role || 'viewer').toLowerCase();
    return await upsertMemberSystem({ workspaceId, email, role, displayName: input.displayName, externalId: input.externalId || input.id, active: input.active !== false });
}
export async function configureIntegration({ workspaceId, actorId, type, name, endpoint, secret }) {
    await requireAction(workspaceId, actorId, 'policy:*');
    if (!['generic', 'slack', 'jira'].includes(type))
        throw new Error('Unsupported integration type.');
    const url = new URL(String(endpoint || ''));
    if (url.protocol !== 'https:')
        throw new Error('Integration endpoint must use HTTPS.');
    if (String(secret || '').length < 32)
        throw new Error('Integration signing secret must contain at least 32 characters.');
    const integrationId = id('int_');
    const timestamp = nowIso();
    await db.prepare(`INSERT INTO workspace_integrations (id,workspace_id,type,name,endpoint,secret,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?, 'active',?,?)`).run(integrationId, workspaceId, type, String(name || type).slice(0, 100), url.toString(), String(secret), timestamp, timestamp);
    await insertEvent('workspace_integration_created', actorId, { workspaceId, integrationId, type });
    return { id: integrationId, workspaceId, type, name: String(name || type), endpoint: url.origin, status: 'active' };
}
export async function deliverSecurityEvent({ workspaceId, actorId, event, fetchImpl = fetch }) {
    await requireAction(workspaceId, actorId, 'event:*');
    const results = await deliverSecurityEventInternal({ workspaceId, event, fetchImpl });
    await insertEvent('workspace_security_event_delivered', actorId, { workspaceId, delivered: results.filter((item) => item.delivered).length, total: results.length });
    return results;
}
export async function deliverSecurityEventSystem({ workspaceId, event, fetchImpl = fetch }) {
    const results = await deliverSecurityEventInternal({ workspaceId, event, fetchImpl });
    await insertEvent('workspace_security_event_delivered', null, { workspaceId, delivered: results.filter((item) => item.delivered).length, total: results.length, actor: 'system' });
    return results;
}
async function deliverSecurityEventInternal({ workspaceId, event, fetchImpl }) {
    const integrations = await db.prepare(`SELECT * FROM workspace_integrations WHERE workspace_id=? AND status='active'`).all(workspaceId);
    const results = [];
    for (const integration of integrations) {
        const payload = buildSecurityNotification({ ...event, workspaceId }, integration.type);
        const signed = signWebhookPayload(payload, integration.secret);
        try {
            const response = await fetchImpl(integration.endpoint, { method: 'POST', redirect: 'error', headers: {
                    'content-type': 'application/json', 'user-agent': 'AgentRiskLayer/8.0',
                    'x-agentrisk-timestamp': String(signed.timestamp), 'x-agentrisk-signature': signed.signature,
                }, body: signed.body });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            await db.prepare('UPDATE workspace_integrations SET last_delivery_at=?,last_error=NULL,updated_at=? WHERE id=?').run(nowIso(), nowIso(), integration.id);
            results.push({ id: integration.id, delivered: true });
        }
        catch (error) {
            await db.prepare('UPDATE workspace_integrations SET last_error=?,updated_at=? WHERE id=?').run(String(error.message).slice(0, 500), nowIso(), integration.id);
            results.push({ id: integration.id, delivered: false, error: String(error.message) });
        }
    }
    return results;
}
async function upsertMemberSystem({ workspaceId, email, role, displayName, externalId, active }) {
    if (!ROLES.includes(role))
        throw new Error('Unknown workspace role.');
    const existing = await db.prepare('SELECT * FROM workspace_members WHERE workspace_id=? AND (external_id=? OR email=?)').get(workspaceId, externalId || '', email);
    const timestamp = nowIso();
    if (existing?.role === 'owner' && !active && await ownerCount(workspaceId) <= 1)
        throw new Error('A workspace must retain at least one active owner.');
    const user = await db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (existing)
        await db.prepare(`UPDATE workspace_members SET user_id=?,email=?,display_name=?,role=?,status=?,external_id=?,updated_at=? WHERE id=?`)
            .run(user?.id || null, email, String(displayName || '').slice(0, 120), role, active ? 'active' : 'deprovisioned', externalId || null, timestamp, existing.id);
    else
        await db.prepare(`INSERT INTO workspace_members (id,workspace_id,user_id,email,display_name,role,status,external_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id('wsm_'), workspaceId, user?.id || null, email, String(displayName || '').slice(0, 120), role, active ? 'active' : 'deprovisioned', externalId || null, timestamp, timestamp);
    return await db.prepare('SELECT id,user_id,email,display_name,role,status,external_id FROM workspace_members WHERE workspace_id=? AND email=?').get(workspaceId, email);
}
async function membershipFor(workspaceId, userId) {
    return await db.prepare(`SELECT workspace_id workspaceId,user_id userId,role,status FROM workspace_members
    WHERE workspace_id=? AND user_id=? AND status='active'`).get(workspaceId, userId);
}
async function requireAction(workspaceId, userId, action) {
    const membership = await membershipFor(workspaceId, userId);
    const result = authoriseWorkspaceAction(membership, action, { workspaceId });
    if (!result.allowed)
        throw forbidden('Workspace permission denied.');
    return membership;
}
async function ownerCount(workspaceId) { return (await db.prepare(`SELECT COUNT(*) count FROM workspace_members WHERE workspace_id=? AND role='owner' AND status='active'`).get(workspaceId)).count; }
function digest(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function safeEqual(left, right) {
    try {
        return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
    }
    catch {
        return false;
    }
}
function forbidden(message) { const error = new Error(message); error.statusCode = 403; return error; }
