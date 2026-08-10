import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { db } from '../src/db.js';
import { createWorkspace, upsertMember } from '../src/workspaces.js';
import {
  PROJECT_KINDS,
  controlPlaneOverview,
  createProjectApiKey,
  createRuntimeApproval,
  createSecurityProject,
  getSecurityProject,
  listSecurityProjects,
  runGuidedProtectionCheck,
} from '../src/control-plane.js';
import { createSystemSnapshot } from '../src/control-intelligence.js';

async function createUser(role = 'user') {
  const userId = `usr_case_${crypto.randomUUID().replaceAll('-', '')}`;
  const email = `${userId}@example.test`;
  const timestamp = new Date().toISOString();
  await db.prepare('INSERT INTO users (id,email,password_hash,email_verified_at,role,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, email, 'test-only', timestamp, role, timestamp);
  return { userId, email };
}

test('superuser can create an evidence-only assessment case without weakening the Community runtime project limit', async () => {
  const owner = await createUser('superuser');
  const workspace = await createWorkspace(owner.userId, 'Owner assessment workspace');
  const runtimeProject = await createSecurityProject({ userId: owner.userId, workspaceId: workspace.id, name: 'Production Evidence Verification', environment: 'development' });
  assert.equal(runtimeProject.projectKind, PROJECT_KINDS.RUNTIME);
  assert.equal(runtimeProject.runtimeEnabled, true);

  const assessmentCase = await createSecurityProject({ userId: owner.userId, workspaceId: workspace.id, name: 'CLARA Security Assessment', environment: 'development', projectKind: PROJECT_KINDS.ASSESSMENT_CASE });
  assert.equal(assessmentCase.projectKind, PROJECT_KINDS.ASSESSMENT_CASE);
  assert.equal(assessmentCase.runtimeEnabled, false);

  const overview = await controlPlaneOverview(owner.userId);
  assert.equal(overview.entitlement.projects, 1);
  assert.equal(overview.totals.projects, 1);
  assert.equal(overview.totals.assessmentCases, 1);
  assert.equal(overview.assessmentCases.canCreate, true);
  assert.equal(overview.assessmentCases.runtimeEnabled, false);
  assert.equal(overview.assessmentCases.projects[0].id, assessmentCase.id);

  await assert.rejects(
    () => createSecurityProject({ userId: owner.userId, workspaceId: workspace.id, name: 'Second runtime agent', environment: 'development' }),
    /supports 1 active project/i,
  );
  await assert.rejects(() => createProjectApiKey({ projectId: assessmentCase.id, userId: owner.userId }), /evidence-only/i);
  await assert.rejects(() => createRuntimeApproval({ projectId: assessmentCase.id, userId: owner.userId, toolCall: { name: 'file.write', arguments: { path: 'safe.txt' } } }), /evidence-only/i);
  await assert.rejects(() => runGuidedProtectionCheck({ projectId: assessmentCase.id, userId: owner.userId }), /evidence-only/i);

  const snapshotResult = await createSystemSnapshot({ projectId: assessmentCase.id, userId: owner.userId, input: {
    architecture: { summary: 'CLARA exact build with local file, process and Python execution authority.', components: [] },
    assessmentConfiguration: { architectureFacts: ['tool:file', 'tool:code_execution', 'identity:user'], environment: 'development', confirmed: true },
    source: 'guided_customer_review',
  } });
  assert.equal(snapshotResult.snapshot.projectId, assessmentCase.id);
  assert.match(snapshotResult.snapshot.contentDigest, /^[a-f0-9]{64}$/);
});

test('assessment cases are restricted to the platform superuser and hidden from ordinary workspace members', async () => {
  const owner = await createUser('superuser');
  const workspace = await createWorkspace(owner.userId, 'Isolated assessment workspace');
  const runtimeProject = await createSecurityProject({ userId: owner.userId, workspaceId: workspace.id, name: 'Normal protected agent', environment: 'development' });
  const assessmentCase = await createSecurityProject({ userId: owner.userId, workspaceId: workspace.id, name: 'Private design partner case', projectKind: PROJECT_KINDS.ASSESSMENT_CASE });

  const member = await createUser('user');
  await upsertMember({ workspaceId: workspace.id, actorId: owner.userId, email: member.email, role: 'admin' });
  const visible = await listSecurityProjects(member.userId);
  assert.ok(visible.some((item) => item.id === runtimeProject.id));
  assert.ok(!visible.some((item) => item.id === assessmentCase.id));
  await assert.rejects(() => getSecurityProject({ projectId: assessmentCase.id, userId: member.userId }), /access denied|not found/i);

  const ordinaryOwner = await createUser('user');
  const ordinaryWorkspace = await createWorkspace(ordinaryOwner.userId, 'Ordinary workspace');
  await assert.rejects(
    () => createSecurityProject({ userId: ordinaryOwner.userId, workspaceId: ordinaryWorkspace.id, name: 'Improper case', projectKind: PROJECT_KINDS.ASSESSMENT_CASE }),
    /only the AgentRiskLayer owner/i,
  );
  const ordinaryOverview = await controlPlaneOverview(ordinaryOwner.userId);
  assert.equal(ordinaryOverview.assessmentCases.canCreate, false);
});

test('owner assessment case UI and API contract keep evidence cases separate from runtime projects', () => {
  const client = fs.readFileSync(new URL('../public/control-plane.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('../src/control-plane.js', import.meta.url), 'utf8');
  assert.match(client, /Owner-only assessment workspace/);
  assert.match(client, /projectKind: 'assessment_case'/);
  assert.match(client, /cannot issue runtime keys, runtime approvals or protection quota/i);
  assert.match(server, /projectKind: body\.projectKind/);
  assert.match(source, /Only the AgentRiskLayer owner may create assessment cases/);
  assert.match(source, /evidence-only and do not provide runtime protection capabilities/);
});
