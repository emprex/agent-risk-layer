import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, id, nowIso } from '../src/db.js';
import { bindPendingCheckoutSession, createPendingCheckout, fulfilCheckout } from '../src/fulfilment.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

async function createAssessment(userId, name) {
  const assessmentId = id('asm_');
  await db.prepare(`INSERT INTO assessments
    (id,user_id,name,agent_type,answers_json,score,risk_band,result_json,paid_tier,access_token,share_token,public_enabled,scoring_version,created_at,updated_at)
    VALUES (?,?,?,'Support agent','{}',20,'Low','{}','free',?,?,0,'test',?,?)`)
    .run(assessmentId, userId, name, id('access_'), id('share_'), nowIso(), nowIso());
  return assessmentId;
}

async function paidFixture() {
  const userId = id('usr_');
  const email = `paid-journey-${crypto.randomUUID()}@example.com`;
  await db.prepare(`INSERT INTO users (id,email,password_hash,email_verified_at,created_at)
    VALUES (?,?,?,?,?)`).run(userId, email, 'test-only', nowIso(), nowIso());
  const assessmentId = await createAssessment(userId, 'Purchased assessment');
  const siblingAssessmentId = await createAssessment(userId, 'Sibling assessment');
  const pending = await createPendingCheckout({
    userId,
    assessmentId,
    productKey: 'pro_report',
    stripePriceId: 'demo_price_pro_report',
    expectedAmountPence: 9900,
    expectedCurrency: 'gbp',
    checkoutMode: 'payment',
    expectedCustomerEmail: email,
  });
  const session = {
    id: `cs_test_${crypto.randomUUID()}`,
    mode: 'payment',
    payment_status: 'paid',
    amount_total: 9900,
    currency: 'gbp',
    customer: `cus_${crypto.randomUUID()}`,
    customer_details: { email },
    client_reference_id: userId,
    subscription: null,
    metadata: {
      purchase_id: pending.id,
      user_id: userId,
      assessment_id: assessmentId,
      project_id: '',
      product_key: 'pro_report',
      price_id: 'demo_price_pro_report',
    },
  };
  await bindPendingCheckoutSession(pending.id, session);
  return { userId, assessmentId, siblingAssessmentId, pending, session };
}

test('successful £99 fulfilment upgrades only the exact purchased assessment', async () => {
  const value = await paidFixture();
  const purchase = await fulfilCheckout(value.session, { processEmailNow: false });
  assert.equal(purchase.fulfilment_state, 'fulfilled');
  assert.equal(purchase.binding_state, 'verified');
  assert.equal((await db.prepare('SELECT paid_tier FROM assessments WHERE id=?').get(value.assessmentId)).paid_tier, 'pro');
  assert.equal((await db.prepare('SELECT paid_tier FROM assessments WHERE id=?').get(value.siblingAssessmentId)).paid_tier, 'free');
});

test('replaying successful fulfilment is idempotent and does not duplicate delivery work', async () => {
  const value = await paidFixture();
  await fulfilCheckout(value.session, { processEmailNow: false });
  await fulfilCheckout(value.session, { processEmailNow: false });
  const count = await db.prepare('SELECT COUNT(*) count FROM fulfilment_jobs WHERE purchase_id=?').get(value.pending.id);
  assert.equal(Number(count.count), 1);
});

test('checkout status and success continuation stay account- and assessment-bound', () => {
  const server = read('server.js');
  const success = read('public/success.js');
  const start = server.indexOf('async function checkoutStatus');
  const end = server.indexOf('async function createBillingPortal', start);
  assert.ok(start >= 0 && end > start);
  const status = server.slice(start, end);
  assert.match(status, /stripe_session_id = \? AND user_id = \?/);
  assert.match(status, /session\.metadata\?\.user_id !== req\.user\.id/);
  assert.match(success, /purchase\?\.assessment_id/);
  assert.match(success, /dashboard\.html\?assessment=/);
  assert.match(success, /Continue this assessment/);
});
