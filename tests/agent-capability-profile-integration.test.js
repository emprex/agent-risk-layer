import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, nowIso } from '../src/db.js';
import { createWorkspace } from '../src/workspaces.js';
import { createSecurityProject } from '../src/control-plane.js';
import { applyProjectRiskKnowledgeProfile } from '../src/risk-knowledge.js';
import { createSystemSnapshot, recordDeploymentDecision } from '../src/control-intelligence.js';
import { normaliseCapabilityProfile, deriveCapabilityFacts } from '../public/agent-capability-profile.js';

const randomId = (prefix) => `${prefix}${crypto.randomUUID().replaceAll('-', '')}`;

async function fixture() {
  const userId = randomId('usr_');
  const timestamp = nowIso();
  await db.prepare('INSERT INTO users (id,email,password_hash,email_verified_at,created_at) VALUES (?,?,?,?,?)')
    .run(userId, `capability-${crypto.randomUUID()}@example.test`, 'test-only', timestamp, timestamp);
  const workspace = await createWorkspace(userId, 'Capability profile workspace');
  const project = await createSecurityProject({ userId, workspaceId: workspace.id, name: 'Capability profile agent', environment: 'test' });
  await applyProjectRiskKnowledgeProfile({ workspaceId: workspace.id, projectId: project.id, architectureFacts: { uses_tools: true, is_production: false }, userId });
  return { userId, workspace, project };
}

function configuration(profile, manualArchitectureFacts = ['tool:read']) {
  return {
    profile: 'ARL-RKA-1.2.0',
    environment: 'development',
    confirmed: true,
    manualArchitectureFacts,
    architectureFacts: [...new Set([...manualArchitectureFacts, ...deriveCapabilityFacts(profile)])].sort(),
    capabilityProfile: normaliseCapabilityProfile(profile),
  };
}

test('material capability changes create a new immutable snapshot and stale prior decisions', async () => {
  const f = await fixture();
  const firstProfile = normaliseCapabilityProfile({
    autonomy: 'bounded',
    memory: 'session',
    toolDiscovery: 'static',
    delegation: 'none',
    triggerMode: 'user',
    inputChannels: ['text'],
  });
  const first = await createSystemSnapshot({
    projectId: f.project.id,
    userId: f.userId,
    input: {
      architecture: { summary: 'Bounded support agent', components: [] },
      autonomyLevel: firstProfile.autonomy,
      assessmentConfiguration: configuration(firstProfile),
      source: 'test',
    },
  });
  assert.equal(first.created, true);
  assert.deepEqual(first.snapshot.assessmentConfiguration.capabilityProfile, firstProfile);
  assert.equal(first.snapshot.autonomyLevel, 'bounded');
  assert.ok(first.snapshot.assessmentConfiguration.architectureFacts.includes('input:user_messages'));

  const decision = await recordDeploymentDecision({
    projectId: f.project.id,
    userId: f.userId,
    input: { systemSnapshotId: first.snapshot.id, rationale: 'Capability assessment remains incomplete.' },
  });
  assert.equal(decision.decision, 'hold');

  const changedProfile = normaliseCapabilityProfile({
    ...firstProfile,
    autonomy: 'adaptive',
    memory: 'persistent',
    toolDiscovery: 'mcp',
    delegation: 'multi_agent',
    triggerMode: 'event',
  });
  const second = await createSystemSnapshot({
    projectId: f.project.id,
    userId: f.userId,
    input: {
      architecture: { summary: 'Support agent with persistent memory and event-driven autonomy', components: [] },
      autonomyLevel: changedProfile.autonomy,
      assessmentConfiguration: configuration(changedProfile),
      source: 'capability_profile_update',
      expectedCurrentSnapshotId: first.snapshot.id,
    },
  });

  assert.equal(second.created, true);
  assert.notEqual(second.snapshot.id, first.snapshot.id);
  assert.notEqual(second.snapshot.contentDigest, first.snapshot.contentDigest);
  assert.deepEqual(second.snapshot.assessmentConfiguration.capabilityProfile, changedProfile);
  assert.ok(second.snapshot.assessmentConfiguration.architectureFacts.includes('authority:autonomous'));
  assert.ok(second.snapshot.assessmentConfiguration.architectureFacts.includes('input:memory'));
  assert.equal((await db.prepare('SELECT status FROM system_snapshots WHERE id=?').get(first.snapshot.id)).status, 'superseded');
  assert.equal((await db.prepare('SELECT status FROM control_deployment_decisions WHERE id=?').get(decision.id)).status, 'stale');
  assert.equal((await db.prepare('SELECT COUNT(*) count FROM control_snapshot_evaluations WHERE system_snapshot_id=? AND stale_at IS NOT NULL').get(first.snapshot.id)).count, 108);
});

test('capability profile remains declaration context and nested secret-like fields are rejected', async () => {
  const f = await fixture();
  const profile = normaliseCapabilityProfile({ memory: 'unknown', autonomy: 'unknown' });
  const { snapshot } = await createSystemSnapshot({
    projectId: f.project.id,
    userId: f.userId,
    input: {
      architecture: { summary: 'Agent with unresolved capability context', components: [] },
      autonomyLevel: profile.autonomy,
      assessmentConfiguration: configuration(profile, []),
      source: 'test',
    },
  });
  assert.equal(snapshot.assessmentConfiguration.capabilityProfile.evidenceState, 'declared');
  assert.equal(snapshot.assessmentConfiguration.capabilityProfile.memory, 'unknown');
  assert.deepEqual(snapshot.assessmentConfiguration.architectureFacts, []);
  await assert.rejects(() => createSystemSnapshot({
    projectId: f.project.id,
    userId: f.userId,
    input: {
      architecture: { summary: 'Unsafe capability payload', components: [] },
      assessmentConfiguration: { capabilityProfile: { apiKey: 'must-not-store' } },
      source: 'test',
      expectedCurrentSnapshotId: snapshot.id,
    },
  }), /Sensitive field/i);
});
