import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { db, nowIso } from '../src/db.js';
import { createWorkspace } from '../src/workspaces.js';
import { createSecurityProject } from '../src/control-plane.js';
import { applyProjectRiskKnowledgeProfile } from '../src/risk-knowledge.js';
import {
  assessControlApplicability,
  createSystemSnapshot,
  getControlIntelligenceControl
} from '../src/control-intelligence.js';
import { getDerivedDeploymentReadiness } from '../src/control-intelligence-core.js';

const randomId = prefix => prefix + crypto.randomUUID().replaceAll('-', '');

test('KB-010: a partial assessment containing only N/A controls cannot imply deployment proceed', async () => {
  const userId = randomId('usr_');
  const timestamp = nowIso();
  await db.prepare(
    'INSERT INTO users (id,email,password_hash,email_verified_at,created_at) VALUES (?,?,?,?,?)'
  ).run(userId, randomId('readiness-') + '@example.test', 'test-only', timestamp, timestamp);

  const workspace = await createWorkspace(userId, 'Synthetic KB-010 readiness case');
  const project = await createSecurityProject({
    userId, workspaceId: workspace.id, name: 'Synthetic N/A only controls', environment: 'test'
  });
  await applyProjectRiskKnowledgeProfile({
    workspaceId: workspace.id, projectId: project.id,
    architectureFacts: { uses_tools: false, is_production: false }, userId
  });
  const {snapshot} = await createSystemSnapshot({
    projectId: project.id, userId,
    input: {
      architecture: {summary: 'Synthetic tool-free agent used only to verify readiness calculation.'},
      assessmentConfiguration: {architectureFacts: ['identity:user']},
      source: 'test'
    }
  });

  const initial = await getDerivedDeploymentReadiness({projectId: project.id, userId});
  assert.equal(initial.decision, 'hold');

  const controlId = 'ARL-KB-032';
  const current = await getControlIntelligenceControl({projectId: project.id, controlId, userId});
  await assessControlApplicability({
    projectId: project.id, controlId, userId,
    input: {
      snapshotId: snapshot.id,
      decision: 'not_applicable',
      reason: 'No untrusted email input or corresponding tool authority is configured for this synthetic agent.',
      architectureFactIds: ['identity:user'],
      expectedEvaluationDigest: current.applicability.evaluationDigest
    }
  });

  const readiness = await getDerivedDeploymentReadiness({projectId: project.id, userId});
  assert.equal(readiness.summary.applicableControls, 0);
  assert.ok(readiness.summary.excludedUnreviewedControls > 0);
  assert.equal(readiness.decision, 'hold');
  assert.ok(readiness.reasons.includes('no_applicable_controls_verified'));
  assert.equal(readiness.humanReviewRequired, true);
});
