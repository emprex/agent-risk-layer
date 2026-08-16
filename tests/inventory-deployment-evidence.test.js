import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db } from '../src/db.js';
import { createWorkspace } from '../src/workspaces.js';
import { createSecurityProject, getSecurityProject, recordAssetSnapshot } from '../src/control-plane.js';

async function createUser() {
  const userId = `usr_${crypto.randomUUID().replaceAll('-', '')}`;
  const email = `inventory-gate-${crypto.randomUUID()}@example.com`;
  const timestamp = new Date().toISOString();
  await db.prepare('INSERT INTO users (id,email,password_hash,created_at,email_verified_at) VALUES (?,?,?,?,?)')
    .run(userId, email, 'test-only', timestamp, timestamp);
  return { userId, email };
}

async function fixture() {
  const { userId } = await createUser();
  const workspace = await createWorkspace(userId, 'Inventory evidence gate');
  const project = await createSecurityProject({ userId, workspaceId: workspace.id, name: 'Inventory evidence agent', environment: 'staging' });
  return { userId, project };
}

test('unknown privilege or internet exposure remains an evidence blocker, not a finding', async () => {
  const { userId, project } = await fixture();
  const unknown = await recordAssetSnapshot({
    projectId: project.id,
    userId,
    source: 'test-manifest',
    documents: {
      name: 'support-agent',
      type: 'agent',
      environment: 'staging',
      tools: [{ kind: 'tool', name: 'crm.read' }],
    },
  });
  assert.equal(unknown.summary.evidenceComplete, false);

  let state = await getSecurityProject({ projectId: project.id, userId });
  assert.equal(state.journey.deploymentDecision, 'HOLD FOR EVIDENCE');
  assert.equal(state.journey.steps.find((step) => step.id === 'inventory').complete, false);
  assert.ok(state.journey.blockingGaps.includes('Privilege or internet-exposure evidence is incomplete.'));
  assert.equal(state.remediations.length, 0, 'unknown inventory evidence must not create a remediation/finding');

  const complete = await recordAssetSnapshot({
    projectId: project.id,
    userId,
    source: 'test-manifest',
    documents: {
      name: 'support-agent',
      type: 'agent',
      environment: 'staging',
      public: false,
      privileged: false,
      tools: [{ kind: 'tool', name: 'crm.read', public: false, privileged: false }],
    },
  });
  assert.equal(complete.summary.evidenceComplete, true);

  state = await getSecurityProject({ projectId: project.id, userId });
  assert.equal(state.journey.steps.find((step) => step.id === 'inventory').complete, true);
  assert.ok(!state.journey.blockingGaps.includes('Privilege or internet-exposure evidence is incomplete.'));
  assert.equal(state.remediations.length, 0);
});

test('legacy inventory summaries without evidence-completeness metadata are treated conservatively', async () => {
  const { userId, project } = await fixture();
  const snapshot = await recordAssetSnapshot({
    projectId: project.id,
    userId,
    source: 'legacy-shape',
    documents: {
      name: 'support-agent',
      type: 'agent',
      environment: 'staging',
      public: false,
      privileged: false,
    },
  });
  const legacySummary = { ...snapshot.summary };
  delete legacySummary.evidenceComplete;
  delete legacySummary.internetExposureUnknown;
  delete legacySummary.privilegeUnknown;
  await db.prepare('UPDATE asset_snapshots SET summary_json=? WHERE id=? AND project_id=?')
    .run(JSON.stringify(legacySummary), snapshot.id, project.id);

  const state = await getSecurityProject({ projectId: project.id, userId });
  assert.equal(state.journey.steps.find((step) => step.id === 'inventory').complete, false);
  assert.ok(state.journey.blockingGaps.includes('Privilege or internet-exposure evidence is incomplete.'));
  assert.equal(state.remediations.length, 0);
});
