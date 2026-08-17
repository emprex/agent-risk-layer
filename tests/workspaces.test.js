import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dbPath = path.join(root, 'data', `workspaces-${process.pid}-${crypto.randomBytes(8).toString('hex')}.sqlite`);
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = dbPath;

const { db } = await import('../src/db.js');
const { authenticateScim, configureIntegration, createScimToken, createWorkspace, deliverSecurityEvent, getWorkspace, provisionScimUser, upsertMember } = await import('../src/workspaces.js');

let userSequence = 0;
async function user(email) {
    userSequence += 1;
    const id = `usr_workspace_${process.pid}_${userSequence}_${crypto.randomBytes(8).toString('hex')}`;
    await db.prepare('INSERT INTO users (id,email,password_hash,created_at,email_verified_at) VALUES (?,?,?,?,?)')
        .run(id, email, 'test', new Date().toISOString(), new Date().toISOString());
    return id;
}

test.after(async () => {
    try { await db.close(); } catch {}
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
});

test('workspace roles enforce boundaries and preserve an owner', async () => {
    const owner = await user(`owner-${crypto.randomUUID()}@example.com`);
    const viewer = await user(`viewer-${crypto.randomUUID()}@example.com`);
    const workspace = await createWorkspace(owner, 'Assurance team');
    const email = (await db.prepare('SELECT email FROM users WHERE id=?').get(viewer)).email;
    await upsertMember({ workspaceId: workspace.id, actorId: owner, email, role: 'viewer' });
    assert.equal((await getWorkspace(workspace.id, viewer)).role, 'viewer');
    await assert.rejects(async () => await upsertMember({ workspaceId: workspace.id, actorId: viewer, email: 'other@example.com', role: 'admin' }), /permission denied/i);
    const ownerEmail = (await db.prepare('SELECT email FROM users WHERE id=?').get(owner)).email;
    await assert.rejects(async () => await upsertMember({ workspaceId: workspace.id, actorId: owner, email: ownerEmail, role: 'admin' }), /retain at least one active owner/i);
});

test('concurrent owner demotions cannot leave a workspace ownerless', async () => {
    const owner = await user(`owner-race-${crypto.randomUUID()}@example.com`);
    const secondOwner = await user(`second-owner-${crypto.randomUUID()}@example.com`);
    const workspace = await createWorkspace(owner, 'Owner race team');
    const firstEmail = (await db.prepare('SELECT email FROM users WHERE id=?').get(owner)).email;
    const secondEmail = (await db.prepare('SELECT email FROM users WHERE id=?').get(secondOwner)).email;
    await upsertMember({ workspaceId: workspace.id, actorId: owner, email: secondEmail, role: 'owner' });
    await Promise.allSettled([
        upsertMember({ workspaceId: workspace.id, actorId: owner, email: firstEmail, role: 'viewer' }),
        upsertMember({ workspaceId: workspace.id, actorId: owner, email: secondEmail, role: 'viewer' }),
    ]);
    const count = await db.prepare(`SELECT COUNT(*) count FROM workspace_members WHERE workspace_id=? AND role='owner' AND status='active'`).get(workspace.id);
    assert.equal(Number(count.count), 1);
});

test('SCIM token provisions and deprovisions users without removing the last owner', async () => {
    const owner = await user(`scim-${crypto.randomUUID()}@example.com`);
    const workspace = await createWorkspace(owner, 'SCIM team');
    const token = await createScimToken(workspace.id, owner);
    await assert.doesNotReject(async () => await authenticateScim(workspace.id, token));
    await assert.rejects(async () => await authenticateScim(workspace.id, `${token}x`), /Invalid SCIM token/);
    let member = await provisionScimUser(workspace.id, { externalId: 'idp-42', userName: 'MEMBER@example.com', active: true, role: 'analyst' });
    assert.equal(member.status, 'active');
    member = await provisionScimUser(workspace.id, { externalId: 'idp-42', userName: 'member@example.com', active: false, role: 'analyst' });
    assert.equal(member.status, 'deprovisioned');
    await assert.rejects(async () => await provisionScimUser(workspace.id, { userName: 'not-an-email', active: true, role: 'viewer' }), /valid member email/i);
    const ownerRow = await db.prepare('SELECT external_id,email FROM workspace_members WHERE workspace_id=? AND user_id=?').get(workspace.id, owner);
    await assert.rejects(async () => await provisionScimUser(workspace.id, {
        externalId: ownerRow.external_id || ownerRow.email,
        userName: ownerRow.email,
        active: true,
        role: 'viewer',
    }), /retain at least one active owner/i);
});

test('SCIM rejects conflicting external-id and email identities', async () => {
    const owner = await user(`scim-conflict-${crypto.randomUUID()}@example.com`);
    const workspace = await createWorkspace(owner, 'SCIM conflict team');
    await provisionScimUser(workspace.id, { externalId: 'idp-a', userName: 'member-a@example.com', active: true, role: 'analyst' });
    await provisionScimUser(workspace.id, { externalId: 'idp-b', userName: 'member-b@example.com', active: true, role: 'analyst' });
    await assert.rejects(async () => await provisionScimUser(workspace.id, { externalId: 'idp-a', userName: 'member-b@example.com', active: true, role: 'analyst' }), /SCIM identity conflict/i);
});

test('signed integration delivery records success and rejects embedded endpoint credentials', async () => {
    const owner = await user(`integration-${crypto.randomUUID()}@example.com`);
    const workspace = await createWorkspace(owner, 'Operations team');
    await assert.rejects(() => configureIntegration({ workspaceId: workspace.id, actorId: owner, type: 'generic', name: 'Bad endpoint', endpoint: 'https://user:password@hooks.example.com/security', secret: 'integration-secret-with-at-least-32-characters' }), /embedded credentials/i);
    await configureIntegration({ workspaceId: workspace.id, actorId: owner, type: 'slack', name: 'SOC alerts', endpoint: 'https://hooks.example.com/security', secret: 'integration-secret-with-at-least-32-characters' });
    let delivered;
    const results = await deliverSecurityEvent({
        workspaceId: workspace.id,
        actorId: owner,
        event: { severity: 'critical', title: 'Unsafe action blocked', decision: 'deny' },
        fetchImpl: async (url, request) => { delivered = { url, request }; return { ok: true, status: 200 }; },
    });
    assert.equal(results[0].delivered, true);
    assert.match(delivered.request.headers['x-agentrisk-signature'], /^v1=/);
    assert.ok(delivered.request.signal instanceof AbortSignal);
    assert.equal(Object.hasOwn((await getWorkspace(workspace.id, owner)).integrations[0], 'secret'), false);
});
