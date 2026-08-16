import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { db } from '../src/db.js';
import { createWorkspace, upsertMember } from '../src/workspaces.js';
import {
  authenticateProjectApiKey,
  createProjectApiKey,
  createSecurityProject,
  recordAssetSnapshot,
  screenGuardRequest,
} from '../src/control-plane.js';
import { deleteAgentScope } from '../src/agent-deletion.js';

async function createUser(prefix = 'agent-delete') {
  const userId = `usr_${crypto.randomUUID().replaceAll('-', '')}`;
  const email = `${prefix}-${crypto.randomUUID()}@example.com`;
  const timestamp = new Date().toISOString();
  await db.prepare('INSERT INTO users (id,email,password_hash,created_at,email_verified_at) VALUES (?,?,?,?,?)')
    .run(userId, email, 'test-only', timestamp, timestamp);
  return { userId, email };
}

async function createAssessment({ userId, name, agentType = 'Customer support agent', createdAt = new Date().toISOString() }) {
  const assessmentId = `asm_${crypto.randomUUID().replaceAll('-', '')}`;
  await db.prepare(`INSERT INTO assessments
    (id,user_id,name,agent_type,answers_json,score,risk_band,result_json,paid_tier,access_token,share_token,public_enabled,scoring_version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    assessmentId, userId, name, agentType, '{}', 17, 'Low', JSON.stringify({ score: 17, riskBand: 'Low', headline: 'Test only' }),
    'free', `access_${crypto.randomUUID().replaceAll('-', '')}`, `share_${crypto.randomUUID().replaceAll('-', '')}`, 0,
    'arl-risk-v3.4', createdAt, createdAt,
  );
  return assessmentId;
}

async function deletionFixture() {
  const owner = await createUser();
  const workspace = await createWorkspace(owner.userId, 'Deletion test workspace');
  const project = await createSecurityProject({
    userId: owner.userId,
    workspaceId: workspace.id,
    name: 'Disposable Support Agent',
    environment: 'development',
  });
  const currentAssessmentId = await createAssessment({ userId: owner.userId, name: 'Disposable Support Agent' });
  const olderAssessmentId = await createAssessment({
    userId: owner.userId,
    name: 'disposable support agent',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const unrelatedAssessmentId = await createAssessment({ userId: owner.userId, name: 'Northstar Support Agent' });
  const key = await createProjectApiKey({ projectId: project.id, userId: owner.userId, name: 'Disposable key' });
  await screenGuardRequest({ rawToken: key.token, body: { request_id: `delete-test-${crypto.randomUUID()}`, input: 'Synthetic safe request.' } });
  await recordAssetSnapshot({ projectId: project.id, userId: owner.userId, source: 'deletion-test', documents: {
    services: [{ name: 'support-agent', type: 'agent', model: 'gpt-5', environment: 'development', tools: ['crm.read'] }],
  } });
  return { owner, workspace, project, currentAssessmentId, olderAssessmentId, unrelatedAssessmentId, key };
}

test('agent deletion requires exact name confirmation and leaves state unchanged on mismatch', async () => {
  const fixture = await deletionFixture();
  await assert.rejects(() => deleteAgentScope({
    projectId: fixture.project.id,
    userId: fixture.owner.userId,
    assessmentId: fixture.currentAssessmentId,
    confirmation: 'Disposable support agent',
  }), /exact agent name/i);
  assert.ok(await db.prepare('SELECT id FROM security_projects WHERE id=?').get(fixture.project.id));
  assert.ok(await db.prepare('SELECT id FROM assessments WHERE id=?').get(fixture.currentAssessmentId));
});

test('agent deletion is owner-only and blocks shared-workspace evidence erasure', async () => {
  const fixture = await deletionFixture();
  const developer = await createUser('agent-delete-member');
  await upsertMember({ workspaceId: fixture.workspace.id, actorId: fixture.owner.userId, email: developer.email, role: 'developer' });

  await assert.rejects(() => deleteAgentScope({
    projectId: fixture.project.id,
    userId: developer.userId,
    assessmentId: fixture.currentAssessmentId,
    confirmation: 'Disposable Support Agent',
  }), /only the workspace owner/i);

  await assert.rejects(() => deleteAgentScope({
    projectId: fixture.project.id,
    userId: fixture.owner.userId,
    assessmentId: fixture.currentAssessmentId,
    confirmation: 'Disposable Support Agent',
  }), /shared workspace/i);

  assert.ok(await db.prepare('SELECT id FROM security_projects WHERE id=?').get(fixture.project.id));
  assert.ok(await db.prepare('SELECT id FROM assessments WHERE id=?').get(fixture.currentAssessmentId));
});

test('agent deletion removes exact agent scope, revokes keys by cascade and preserves unrelated agents', async () => {
  const fixture = await deletionFixture();
  const result = await deleteAgentScope({
    projectId: fixture.project.id,
    userId: fixture.owner.userId,
    assessmentId: fixture.currentAssessmentId,
    confirmation: 'Disposable Support Agent',
  });

  assert.equal(result.deleted, true);
  assert.equal(result.projectDeleted, true);
  assert.equal(result.assessmentCount, 2);
  assert.equal(await db.prepare('SELECT id FROM security_projects WHERE id=?').get(fixture.project.id), undefined);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) count FROM assessments WHERE user_id=? AND lower(trim(name))=lower(trim(?))').get(
    fixture.owner.userId, 'Disposable Support Agent'))?.count || 0), 0);
  assert.ok(await db.prepare('SELECT id FROM assessments WHERE id=?').get(fixture.unrelatedAssessmentId));
  assert.equal(Number((await db.prepare('SELECT COUNT(*) count FROM project_api_keys WHERE project_id=?').get(fixture.project.id))?.count || 0), 0);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) count FROM runtime_events WHERE project_id=?').get(fixture.project.id))?.count || 0), 0);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) count FROM asset_snapshots WHERE project_id=?').get(fixture.project.id))?.count || 0), 0);
  await assert.rejects(() => authenticateProjectApiKey(fixture.key.token), /invalid project API key|invalid or inactive/i);

  const deletionEvent = await db.prepare(`SELECT properties_json FROM events WHERE user_id=? AND name='agent_deleted'
    ORDER BY created_at DESC LIMIT 1`).get(fixture.owner.userId);
  assert.equal(JSON.parse(deletionEvent.properties_json).assessmentCount, 2);
  assert.equal(JSON.parse(deletionEvent.properties_json).projectId, fixture.project.id);
});

test('dashboard exposes bounded agent deletion without invoking account deletion', () => {
  const html = fs.readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../public/agent-deletion.js', import.meta.url), 'utf8');
  const controlPlane = fs.readFileSync(new URL('../src/control-plane.js', import.meta.url), 'utf8');
  assert.match(html, /agent-deletion\.js/);
  assert.match(ui, /Delete agent/);
  assert.match(ui, /Type the exact agent name to confirm/);
  assert.match(ui, /Payment and billing records are retained/);
  assert.match(ui, /deleteAgent: true/);
  assert.doesNotMatch(ui, /\/api\/account\/delete/);
  assert.match(controlPlane, /patch\.deleteAgent === true/);
  assert.match(controlPlane, /deleteAgentScope/);
});
