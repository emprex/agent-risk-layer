import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { db } from '../src/db.js';
import { createWorkspace } from '../src/workspaces.js';
import {
  PROJECT_KINDS,
  controlPlaneOverview,
  createProjectApiKey,
  createSecurityProject,
} from '../src/control-plane.js';

const uid = (prefix) => `${prefix}${crypto.randomUUID().replaceAll('-', '')}`;
const now = () => new Date().toISOString();

test('platform superuser can preview the exact free assessment remediation journey without granting paid or runtime entitlement', async () => {
  const userId = uid('usr_owner_preview_');
  const timestamp = now();
  await db.prepare(`INSERT INTO users (id,email,password_hash,email_verified_at,role,created_at)
    VALUES (?,?,?,?,?,?)`).run(userId, `${userId}@example.test`, 'test-only', timestamp, 'superuser', timestamp);
  const workspace = await createWorkspace(userId, 'Owner journey preview workspace');
  const assessmentId = uid('asm_owner_preview_');
  await db.prepare(`INSERT INTO assessments
    (id,user_id,name,agent_type,answers_json,score,risk_band,result_json,paid_tier,share_token,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      assessmentId, userId, 'Atlas Lite - local guarded v1.1', 'Local guarded agent', '{}', 41, 'High', '{}',
      'free', uid('share_'), timestamp, timestamp,
    );

  const before = await controlPlaneOverview(userId);
  assert.equal(before.assessmentCases.canCreate, true);

  const scope = await createSecurityProject({
    userId,
    workspaceId: workspace.id,
    name: 'Atlas Lite - local guarded v1.1',
    environment: 'development',
    projectKind: PROJECT_KINDS.ASSESSMENT_CASE,
    assessmentId,
  });

  assert.equal(scope.projectKind, PROJECT_KINDS.ASSESSMENT_CASE);
  assert.equal(scope.assessmentId, assessmentId);
  assert.equal(scope.runtimeEnabled, false);

  const assessment = await db.prepare('SELECT paid_tier FROM assessments WHERE id=?').get(assessmentId);
  assert.equal(assessment.paid_tier, 'free');
  const purchases = await db.prepare('SELECT COUNT(*) count FROM purchases WHERE assessment_id=?').get(assessmentId);
  assert.equal(Number(purchases.count), 0);

  await assert.rejects(
    () => createProjectApiKey({ projectId: scope.id, userId, name: 'must-not-exist' }),
    /evidence-only/i,
  );
});
