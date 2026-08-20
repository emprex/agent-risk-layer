import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { db } from '../src/db.js';
import { createWorkspace } from '../src/workspaces.js';
import {
  PROJECT_KINDS,
  controlPlaneOverview,
  createProjectApiKey,
  createRuntimeApproval,
  createSecurityProject,
} from '../src/control-plane.js';

const uid = (prefix) => `${prefix}${crypto.randomUUID().replaceAll('-', '')}`;
const now = () => new Date().toISOString();

async function createUser() {
  const userId = uid('usr_paid_case_');
  const email = `${userId}@example.test`;
  const timestamp = now();

  await db.prepare(`
    INSERT INTO users
      (id,email,password_hash,email_verified_at,role,created_at)
    VALUES (?,?,?,?,?,?)
  `).run(userId, email, 'test-only', timestamp, 'user', timestamp);

  return { userId, email };
}

async function createAssessment({ userId, paid = false }) {
  const assessmentId = uid('asm_paid_case_');
  const timestamp = now();

  await db.prepare(`
    INSERT INTO assessments
      (id,user_id,name,agent_type,answers_json,score,risk_band,
       result_json,paid_tier,share_token,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    assessmentId,
    userId,
    'Paid remediation test agent',
    'Customer support agent',
    '{}',
    38,
    'Critical',
    '{}',
    paid ? 'pro_report' : 'free',
    uid('share_'),
    timestamp,
    timestamp,
  );

  return assessmentId;
}

async function createFulfilledPurchase({ userId, assessmentId }) {
  const purchaseId = uid('pur_paid_case_');
  const timestamp = now();

  await db.prepare(`
    INSERT INTO purchases
      (id,user_id,assessment_id,product_key,amount_pence,currency,status,
       fulfilment_state,fulfilled_at,access_granted_at,
       binding_state,binding_verified_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    purchaseId,
    userId,
    assessmentId,
    'pro_report',
    9900,
    'gbp',
    'paid',
    'fulfilled',
    timestamp,
    timestamp,
    'verified',
    timestamp,
    timestamp,
    timestamp,
  );

  return purchaseId;
}

test('paid assessment gets an evidence-only remediation scope even when Community runtime slot is occupied', async () => {
  const user = await createUser();
  const workspace = await createWorkspace(user.userId, 'Paid assessment workspace');

  const runtimeProject = await createSecurityProject({
    userId: user.userId,
    workspaceId: workspace.id,
    name: 'Existing Community runtime project',
    environment: 'development',
  });

  assert.equal(runtimeProject.projectKind, PROJECT_KINDS.RUNTIME);

  const assessmentId = await createAssessment({
    userId: user.userId,
    paid: true,
  });

  await createFulfilledPurchase({
    userId: user.userId,
    assessmentId,
  });

  const remediationScope = await createSecurityProject({
    userId: user.userId,
    workspaceId: workspace.id,
    name: 'Paid assessment remediation',
    environment: 'development',
    projectKind: PROJECT_KINDS.ASSESSMENT_CASE,
    assessmentId,
  });

  assert.equal(remediationScope.projectKind, PROJECT_KINDS.ASSESSMENT_CASE);
  assert.equal(remediationScope.runtimeEnabled, false);
  assert.equal(remediationScope.assessmentId, assessmentId);

  const overview = await controlPlaneOverview(user.userId);

  assert.equal(overview.entitlement.projects, 1);
  assert.equal(overview.totals.projects, 1);
  assert.equal(overview.totals.assessmentCases, 1);

  await assert.rejects(
    () => createSecurityProject({
      userId: user.userId,
      workspaceId: workspace.id,
      name: 'Illegal second runtime project',
      environment: 'development',
    }),
    /supports 1 active project/i,
  );

  await assert.rejects(
    () => createProjectApiKey({
      projectId: remediationScope.id,
      userId: user.userId,
      name: 'should-not-exist',
    }),
    /evidence-only/i,
  );

  await assert.rejects(
    () => createRuntimeApproval({
      projectId: remediationScope.id,
      userId: user.userId,
      toolCall: {
        name: 'payment.refund',
        arguments: { customerId: 'synthetic', amount: 129 },
      },
    }),
    /evidence-only/i,
  );
});

test('free assessment cannot create a paid remediation scope', async () => {
  const user = await createUser();
  const workspace = await createWorkspace(user.userId, 'Free assessment workspace');
  const assessmentId = await createAssessment({
    userId: user.userId,
    paid: false,
  });

  await assert.rejects(
    () => createSecurityProject({
      userId: user.userId,
      workspaceId: workspace.id,
      name: 'Unpaid remediation attempt',
      projectKind: PROJECT_KINDS.ASSESSMENT_CASE,
      assessmentId,
    }),
    /fulfilled Security Assessment purchase/i,
  );
});

test('another user cannot use somebody else paid assessment to create a remediation scope', async () => {
  const owner = await createUser();
  const ownerAssessmentId = await createAssessment({
    userId: owner.userId,
    paid: true,
  });

  await createFulfilledPurchase({
    userId: owner.userId,
    assessmentId: ownerAssessmentId,
  });

  const attacker = await createUser();
  const attackerWorkspace = await createWorkspace(
    attacker.userId,
    'Other customer workspace',
  );

  await assert.rejects(
    () => createSecurityProject({
      userId: attacker.userId,
      workspaceId: attackerWorkspace.id,
      name: 'Cross-user remediation attempt',
      projectKind: PROJECT_KINDS.ASSESSMENT_CASE,
      assessmentId: ownerAssessmentId,
    }),
    /fulfilled Security Assessment purchase/i,
  );
});

test('repeated creation for the same paid assessment reuses the same remediation scope', async () => {
  const user = await createUser();
  const workspace = await createWorkspace(user.userId, 'Idempotent assessment workspace');

  const assessmentId = await createAssessment({
    userId: user.userId,
    paid: true,
  });

  await createFulfilledPurchase({
    userId: user.userId,
    assessmentId,
  });

  const first = await createSecurityProject({
    userId: user.userId,
    workspaceId: workspace.id,
    name: 'First remediation creation',
    projectKind: PROJECT_KINDS.ASSESSMENT_CASE,
    assessmentId,
  });

  const second = await createSecurityProject({
    userId: user.userId,
    workspaceId: workspace.id,
    name: 'Second remediation creation',
    projectKind: PROJECT_KINDS.ASSESSMENT_CASE,
    assessmentId,
  });

  assert.equal(second.id, first.id);

  const rows = await db.prepare(`
    SELECT project_id
    FROM owner_assessment_cases
    WHERE assessment_id=?
  `).all(assessmentId);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].project_id, first.id);
});
