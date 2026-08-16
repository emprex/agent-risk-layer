import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, nowIso } from '../src/db.js';
import { createWorkspace } from '../src/workspaces.js';
import {
  createProjectApiKey,
  createSecurityProject,
  getSecurityProject,
  screenGuardRequest,
  updateSecurityProject,
} from '../src/control-plane.js';

async function fixture() {
  const userId = `usr_${crypto.randomUUID().replaceAll('-', '')}`;
  const timestamp = nowIso();
  await db.prepare('INSERT INTO users (id,email,password_hash,created_at,email_verified_at) VALUES (?,?,?,?,?)')
    .run(userId, `journey-${crypto.randomUUID()}@example.com`, 'test-only', timestamp, timestamp);
  const workspace = await createWorkspace(userId, 'Runtime journey evidence');
  const project = await createSecurityProject({
    userId,
    workspaceId: workspace.id,
    name: `Runtime ${crypto.randomUUID()}`,
    environment: 'staging',
  });
  const published = await updateSecurityProject({
    projectId: project.id,
    userId,
    patch: { policy: { mode: 'enforce', allowedTools: ['crm.read'] } },
  });
  const key = await createProjectApiKey({ projectId: project.id, userId, name: 'Journey key' });
  return { userId, project: published, key };
}

test('real current-policy allow evidence completes Test allowed action even when timestamp text is equivalent but not identical', async () => {
  const { userId, project, key } = await fixture();
  const response = await screenGuardRequest({
    rawToken: key.token,
    body: {
      request_id: `allowed-${crypto.randomUUID()}`,
      input: 'Customer request and retrieved context',
      tool_call: { name: 'crm.read', arguments: { customer_id: 'cust_123' } },
      metadata: { application: 'support-agent' },
    },
  });
  assert.equal(response.decision, 'allow');
  assert.equal(response.observedDecision, 'allow');

  const equivalentTimestamp = project.policyPublishedAt.replace(/Z$/, '+00:00');
  assert.notEqual(equivalentTimestamp, project.policyPublishedAt);
  assert.equal(Date.parse(equivalentTimestamp), Date.parse(project.policyPublishedAt));
  await db.prepare('UPDATE runtime_events SET policy_published_at=? WHERE project_id=? AND request_id=?')
    .run(equivalentTimestamp, project.id, response.requestId);

  let state = await getSecurityProject({ projectId: project.id, userId });
  assert.equal(state.journey.steps.find((step) => step.id === 'allowed')?.complete, true);
  assert.equal(state.journey.blockingGaps.includes('No allowed-action control test is recorded.'), false);

  await db.prepare('UPDATE runtime_events SET policy_digest=? WHERE project_id=? AND request_id=?')
    .run('0'.repeat(64), project.id, response.requestId);
  state = await getSecurityProject({ projectId: project.id, userId });
  assert.equal(state.journey.steps.find((step) => step.id === 'allowed')?.complete, false);
  assert.equal(state.journey.blockingGaps.includes('No allowed-action control test is recorded.'), true);
});
