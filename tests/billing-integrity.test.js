import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, id, nowIso } from '../src/db.js';
import {
  bindPendingCheckoutSession,
  createPendingCheckout,
  fulfilCheckout,
} from '../src/fulfilment.js';
import {
  claimStripeEvent,
  completeStripeEvent,
  failStripeEvent,
  recoverAbandonedStripeEvent,
} from '../src/stripe-events.js';
import { processStripeEvent } from '../src/stripe-webhook.js';
import { entitlementForUser, PLAN_ENTITLEMENTS } from '../src/control-plane.js';
import { createRedTeamToken } from '../src/redteam.js';
import {
  subscriptionAccessDecision,
  subscriptionBlocksAccountDeletion,
  subscriptionBlocksCheckout,
} from '../src/subscription-access.js';

async function fixture() {
  const userId = id('usr_');
  const email = `billing-${crypto.randomUUID()}@example.com`;
  await db.prepare(`INSERT INTO users (id,email,password_hash,email_verified_at,created_at)
    VALUES (?,?,?,?,?)`).run(userId, email, 'test-only', nowIso(), nowIso());
  const assessmentId = id('asm_');
  await db.prepare(`INSERT INTO assessments
    (id,user_id,name,agent_type,answers_json,score,risk_band,result_json,paid_tier,access_token,share_token,public_enabled,scoring_version,created_at,updated_at)
    VALUES (?,?,?,'Support agent','{}',50,'High','{}','free',?,?,0,'test',?,?)`)
    .run(assessmentId, userId, 'Billing integrity assessment', id('access_'), id('share_'), nowIso(), nowIso());
  return { userId, email, assessmentId };
}

async function pendingFixture(productKey = 'pro_report') {
  const owner = await fixture();
  const recurring = productKey !== 'pro_report';
  const amount = recurring ? 2900 : 9900;
  const price = `demo_price_${productKey}`;
  const pending = await createPendingCheckout({
    userId: owner.userId,
    assessmentId: recurring ? null : owner.assessmentId,
    productKey,
    stripePriceId: price,
    expectedAmountPence: amount,
    expectedCurrency: 'gbp',
    checkoutMode: recurring ? 'subscription' : 'payment',
    expectedCustomerEmail: owner.email,
  });
  const session = {
    id: `cs_test_${crypto.randomUUID()}`,
    mode: recurring ? 'subscription' : 'payment',
    payment_status: 'paid',
    amount_total: amount,
    currency: 'gbp',
    customer: `cus_${crypto.randomUUID()}`,
    customer_details: { email: owner.email },
    client_reference_id: owner.userId,
    subscription: recurring ? `sub_${crypto.randomUUID()}` : null,
    metadata: {
      purchase_id: pending.id,
      user_id: owner.userId,
      assessment_id: recurring ? '' : owner.assessmentId,
      project_id: '',
      product_key: productKey,
      price_id: price,
    },
  };
  await bindPendingCheckoutSession(pending.id, session);
  return { ...owner, pending, session };
}

function subscriptionEvent(value, {
  id = `evt_${crypto.randomUUID()}`,
  created = Math.floor(Date.now() / 1000),
  type = 'customer.subscription.updated',
  status = type === 'customer.subscription.deleted' ? 'canceled' : 'active',
  periodStart = created - 3600,
  periodEnd = created + 86400,
} = {}) {
  return {
    id, created, type,
    data: { object: {
      id: value.session.subscription,
      customer: value.session.customer,
      status,
      metadata: { user_id: value.userId, product_key: 'developer_monthly' },
      current_period_start: periodStart,
      current_period_end: periodEnd,
      cancel_at_period_end: status === 'canceled',
      canceled_at: status === 'canceled' ? created : null,
    } },
  };
}

async function assertNoAccessForUser(userId) {
  const subscriptions = await db.prepare('SELECT * FROM subscriptions WHERE user_id=?').all(userId);
  assert.equal(subscriptions.some((row) => subscriptionAccessDecision(row).allowed), false);
  const upgraded = await db.prepare("SELECT COUNT(*) count FROM assessments WHERE user_id=? AND paid_tier!='free'").get(userId);
  assert.equal(Number(upgraded.count), 0);
}

test('a correctly bound one-off purchase grants only its intended entitlement', async () => {
  const value = await pendingFixture();
  const purchase = await fulfilCheckout(value.session, { processEmailNow: false });
  assert.equal(purchase.binding_state, 'verified');
  assert.equal(purchase.fulfilment_state, 'fulfilled');
  assert.equal((await db.prepare('SELECT paid_tier FROM assessments WHERE id=?').get(value.assessmentId)).paid_tier, 'pro');
});

test('both supported Checkout event types invoke verified one-off fulfilment', async () => {
  for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded']) {
    const value = await pendingFixture();
    const result = await processStripeEvent({
      id: `evt_${crypto.randomUUID()}`, created: Math.floor(Date.now() / 1000), type,
      data: { object: value.session },
    });
    assert.equal(result.outcome, 'fulfilled_checkout');
    assert.equal((await db.prepare('SELECT paid_tier FROM assessments WHERE id=?').get(value.assessmentId)).paid_tier, 'pro');
  }
});

test('subscription Checkout creates only a non-entitled pending binding', async () => {
  const value = await pendingFixture('developer_monthly');
  await fulfilCheckout(value.session, { processEmailNow: false });
  const subscription = await db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id=?').get(value.session.subscription);
  assert.equal(subscription.status, 'pending');
  assert.equal(Boolean(subscription.authoritative_state), false);
  assert.equal(subscription.billing_state_source, 'pending_checkout');
  assert.equal(subscription.current_period_start, null);
  assert.equal(subscription.current_period_end, null);
  assert.equal(subscription.purchase_id, value.pending.id);
  await assertNoAccessForUser(value.userId);
});

test('customer.subscription.created establishes access only for a verified bound purchase', async () => {
  const value = await pendingFixture('developer_monthly');
  await fulfilCheckout(value.session, { processEmailNow: false });
  const event = subscriptionEvent(value, { type: 'customer.subscription.created' });
  assert.equal((await processStripeEvent(event)).outcome, 'applied_subscription_state');
  const subscription = await db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id=?').get(value.session.subscription);
  assert.equal(subscription.status, 'active');
  assert.equal(Boolean(subscription.authoritative_state), true);
  assert.equal(subscription.billing_state_source, 'stripe_event');
  assert.equal(subscription.latest_stripe_event_id, event.id);
  assert.equal(subscriptionAccessDecision(subscription).allowed, true);
});

test('poisoned or unbound subscription events cannot create provisional access', async () => {
  const value = await pendingFixture('developer_monthly');
  const event = subscriptionEvent(value, { type: 'customer.subscription.created' });
  await assert.rejects(() => processStripeEvent(event), /not bound/);
  await assertNoAccessForUser(value.userId);
  await fulfilCheckout(value.session, { processEmailNow: false });
  event.data.object.customer = 'cus_wrong';
  await assert.rejects(() => processStripeEvent(event), /does not match/);
  await assertNoAccessForUser(value.userId);
});

test('underpaid, wrong-price, product, currency, amount and mode sessions fail closed', async () => {
  for (const mutate of [
    (session) => { session.amount_total -= 1; },
    (session) => { session.metadata.price_id = 'price_wrong'; },
    (session) => { session.metadata.product_key = 'developer_monthly'; },
    (session) => { session.currency = 'usd'; },
    (session) => { session.amount_total += 1; },
    (session) => { session.mode = 'subscription'; },
    (session) => { session.payment_status = 'unpaid'; },
    (session) => { session.customer = ''; },
    (session) => { delete session.metadata.price_id; },
  ]) {
    const value = await pendingFixture();
    mutate(value.session);
    await assert.rejects(() => fulfilCheckout(value.session, { processEmailNow: false }), /does not match|not paid|missing/);
    const purchase = await db.prepare('SELECT * FROM purchases WHERE id=?').get(value.pending.id);
    assert.equal(purchase.binding_state, 'quarantined');
    assert.notEqual((await db.prepare('SELECT paid_tier FROM assessments WHERE id=?').get(value.assessmentId)).paid_tier, 'pro');
    assert.equal(Number((await db.prepare('SELECT COUNT(*) count FROM subscriptions WHERE user_id=?').get(value.userId)).count), 0);
  }
});

test('a stored price outside the current server catalogue is quarantined', async () => {
  const owner = await fixture();
  const pending = await createPendingCheckout({
    userId: owner.userId, assessmentId: owner.assessmentId, productKey: 'pro_report',
    stripePriceId: 'price_not_in_catalogue', expectedAmountPence: 9900, expectedCurrency: 'gbp',
    checkoutMode: 'payment', expectedCustomerEmail: owner.email,
  });
  const session = {
    id: `cs_test_${crypto.randomUUID()}`, mode: 'payment', payment_status: 'paid', amount_total: 9900, currency: 'gbp',
    customer: `cus_${crypto.randomUUID()}`, customer_details: { email: owner.email }, client_reference_id: owner.userId,
    metadata: { purchase_id: pending.id, user_id: owner.userId, assessment_id: owner.assessmentId, project_id: '',
      product_key: 'pro_report', price_id: 'price_not_in_catalogue' },
  };
  await bindPendingCheckoutSession(pending.id, session);
  await assert.rejects(() => fulfilCheckout(session, { processEmailNow: false }), /not current in the server catalogue/);
  assert.equal((await db.prepare('SELECT binding_state FROM purchases WHERE id=?').get(pending.id)).binding_state, 'quarantined');
});

test('wrong user, customer, assessment and missing pending purchase cannot grant access', async () => {
  for (const mutate of [
    (session) => { session.id = `cs_wrong_${crypto.randomUUID()}`; },
    (session) => { session.metadata.user_id = 'usr_other'; },
    (session) => { session.client_reference_id = 'usr_other'; },
    (session) => { session.customer = 'cus_other'; },
    (session) => { session.customer_details.email = 'other@example.com'; },
    (session) => { session.metadata.assessment_id = 'asm_other'; },
    (session) => { session.metadata.purchase_id = 'pay_missing'; },
  ]) {
    const value = await pendingFixture();
    mutate(value.session);
    await assert.rejects(() => fulfilCheckout(value.session, { processEmailNow: false }), /does not match|missing/);
    assert.notEqual((await db.prepare('SELECT paid_tier FROM assessments WHERE id=?').get(value.assessmentId)).paid_tier, 'pro');
  }
});

test('expired pending purchases cannot grant access', async () => {
  const value = await pendingFixture();
  await db.prepare("UPDATE purchases SET binding_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
    .run(value.pending.id);
  await assert.rejects(() => fulfilCheckout(value.session, { processEmailNow: false }), /expired/);
  const purchase = await db.prepare('SELECT binding_state,fulfilment_state FROM purchases WHERE id=?').get(value.pending.id);
  assert.equal(purchase.binding_state, 'quarantined');
  assert.equal(purchase.fulfilment_state, 'failed');
  assert.equal((await db.prepare('SELECT paid_tier FROM assessments WHERE id=?').get(value.assessmentId)).paid_tier, 'free');
});

test('client-controlled metadata cannot change entitlement', async () => {
  const value = await pendingFixture();
  value.session.metadata.product_key = 'agency_monthly';
  value.session.metadata.price_id = 'price_agency';
  await assert.rejects(() => fulfilCheckout(value.session, { processEmailNow: false }), /does not match/);
  assert.equal((await db.prepare('SELECT paid_tier FROM assessments WHERE id=?').get(value.assessmentId)).paid_tier, 'free');
});

test('completed and concurrent duplicate deliveries are idempotent', async () => {
  const value = await pendingFixture();
  const outcomes = await Promise.allSettled([
    fulfilCheckout(value.session, { processEmailNow: false }),
    fulfilCheckout(value.session, { processEmailNow: false }),
  ]);
  assert.ok(outcomes.some((outcome) => outcome.status === 'fulfilled'));
  const purchase = await db.prepare('SELECT * FROM purchases WHERE id=?').get(value.pending.id);
  assert.equal(purchase.fulfilment_state, 'fulfilled');
  assert.equal((await db.prepare('SELECT COUNT(*) count FROM fulfilment_jobs WHERE purchase_id=?').get(purchase.id)).count, 1);
  assert.equal((await fulfilCheckout(value.session, { processEmailNow: false })).id, purchase.id);
});

test('failed Stripe events are reclaimable while completed events remain duplicates', async () => {
  for (const eventType of ['customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed']) {
    const eventId = `evt_${crypto.randomUUID()}`;
    const first = await claimStripeEvent(eventId, eventType);
    assert.equal(first.state, 'claimed');
    await failStripeEvent(eventId, new Error('temporary database failure'));
    const failed = await db.prepare('SELECT * FROM stripe_events WHERE id=?').get(eventId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.completed_at, null);
    const retry = await claimStripeEvent(eventId, eventType);
    assert.equal(retry.state, 'claimed');
    assert.equal(Number(retry.event.attempt_count), 2);
    await completeStripeEvent(eventId);
    const duplicate = await claimStripeEvent(eventId, eventType);
    assert.equal(duplicate.state, 'completed');
  }
});

test('failed subscription updates, deletions and payment failures are retried through real handlers', async () => {
  for (const [eventType, eventStatus, expectedStatus] of [
    ['customer.subscription.updated', 'active', 'active'],
    ['customer.subscription.deleted', 'canceled', 'canceled'],
    ['invoice.payment_failed', null, 'past_due'],
  ]) {
    const owner = await pendingFixture('developer_monthly');
    await fulfilCheckout(owner.session, { processEmailNow: false });
    const event = eventType === 'invoice.payment_failed'
      ? { id: `evt_${crypto.randomUUID()}`, created: Math.floor(Date.now() / 1000), type: eventType,
          data: { object: { subscription: owner.session.subscription, customer: owner.session.customer } } }
      : subscriptionEvent(owner, { type: eventType, status: eventStatus });
    if (eventType === 'invoice.payment_failed') {
      await processStripeEvent(subscriptionEvent(owner, {
        id: `evt_${crypto.randomUUID()}`, created: event.created - 1,
        type: 'customer.subscription.created', status: 'active',
      }));
    }
    assert.equal((await claimStripeEvent(event.id, event.type)).state, 'claimed');
    await failStripeEvent(event.id, new Error('temporary processing failure'));
    const failed = await db.prepare('SELECT * FROM stripe_events WHERE id=?').get(event.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.completed_at, null, 'a failed event must not be recorded as successful');
    assert.equal((await claimStripeEvent(event.id, event.type)).state, 'claimed');
    await processStripeEvent(event);
    await completeStripeEvent(event.id);
    assert.equal((await db.prepare('SELECT status FROM subscriptions WHERE stripe_subscription_id=?').get(owner.session.subscription)).status, expectedStatus);
    assert.equal((await db.prepare('SELECT status FROM stripe_events WHERE id=?').get(event.id)).status, 'processed');
  }
});

test('subscription event ordering prevents strictly older access changes', async () => {
  const scenarios = [
    {
      events: (value, base) => [
        subscriptionEvent(value, { id: 'evt_active_1', created: base, status: 'active' }),
        subscriptionEvent(value, { id: 'evt_deleted_2', created: base + 2, type: 'customer.subscription.deleted' }),
        subscriptionEvent(value, { id: 'evt_active_retry', created: base, status: 'active' }),
      ],
      expected: 'canceled',
    },
    {
      events: (value, base) => [
        subscriptionEvent(value, { id: 'evt_invoice_initial', created: base - 1, status: 'active' }),
        { id: 'evt_invoice_1', created: base, type: 'invoice.payment_failed',
          data: { object: { subscription: value.session.subscription, customer: value.session.customer } } },
        subscriptionEvent(value, { id: 'evt_cancel_2', created: base + 2, type: 'customer.subscription.deleted' }),
        subscriptionEvent(value, { id: 'evt_old_active', created: base + 1, status: 'active' }),
      ],
      expected: 'canceled',
    },
    {
      events: (value, base) => [
        subscriptionEvent(value, { id: 'evt_new_active', created: base + 2, status: 'active' }),
        subscriptionEvent(value, { id: 'evt_old_deleted', created: base, type: 'customer.subscription.deleted' }),
      ],
      expected: 'active',
    },
  ];
  for (const scenario of scenarios) {
    const value = await pendingFixture('developer_monthly');
    await fulfilCheckout(value.session, { processEmailNow: false });
    const events = scenario.events(value, Math.floor(Date.now() / 1000));
    const outcomes = [];
    for (const event of events) outcomes.push((await processStripeEvent(event)).outcome);
    const row = await db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id=?').get(value.session.subscription);
    assert.equal(row.status, scenario.expected);
    assert.ok(outcomes.includes('ignored_stale'));
  }
});

test('equal-time material conflicts fail closed in both arrival orders and newer state reconciles', async () => {
  const cases = [
    {
      name: 'active versus cancelled',
      first: (value, created) => subscriptionEvent(value, { id: `evt_${crypto.randomUUID()}`, created, status: 'active' }),
      second: (value, created) => subscriptionEvent(value, { id: `evt_${crypto.randomUUID()}`, created, type: 'customer.subscription.deleted' }),
    },
    {
      name: 'active versus past_due',
      first: (value, created) => subscriptionEvent(value, { id: `evt_${crypto.randomUUID()}`, created, status: 'active' }),
      second: (value, created) => subscriptionEvent(value, { id: `evt_${crypto.randomUUID()}`, created, status: 'past_due' }),
    },
    {
      name: 'active versus unpaid',
      first: (value, created) => subscriptionEvent(value, { id: `evt_${crypto.randomUUID()}`, created, status: 'active' }),
      second: (value, created) => subscriptionEvent(value, { id: `evt_${crypto.randomUUID()}`, created, status: 'unpaid' }),
    },
    {
      name: 'conflicting period boundary',
      first: (value, created) => subscriptionEvent(value, { id: `evt_${crypto.randomUUID()}`, created, status: 'active', periodEnd: created + 86400 }),
      second: (value, created) => subscriptionEvent(value, { id: `evt_${crypto.randomUUID()}`, created, status: 'active', periodEnd: created + 172800 }),
    },
  ];
  for (const scenario of cases) {
    for (const reverse of [false, true]) {
      const value = await pendingFixture('developer_monthly');
      await fulfilCheckout(value.session, { processEmailNow: false });
      const created = Math.floor(Date.now() / 1000);
      const events = [scenario.first(value, created), scenario.second(value, created)];
      if (reverse) events.reverse();
      assert.equal((await processStripeEvent(events[0])).outcome, 'applied_subscription_state', scenario.name);
      assert.equal((await processStripeEvent(events[1])).outcome, 'reconciliation_required', scenario.name);
      let row = await db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id=?').get(value.session.subscription);
      assert.equal(Boolean(row.reconciliation_required), true, scenario.name);
      assert.equal(Boolean(row.authoritative_state), false, scenario.name);
      assert.equal(row.billing_state_source, 'reconciliation_required', scenario.name);
      assert.equal(subscriptionAccessDecision(row).allowed, false, scenario.name);
      const entitlement = await entitlementForUser(value.userId);
      assert.equal(entitlement.key, 'community', scenario.name);
      assert.deepEqual({
        projects: entitlement.projects,
        apiKeys: entitlement.apiKeysPerProject,
        retention: entitlement.retentionDays,
        monthly: entitlement.runtimeRequestsPerMonth,
        minute: entitlement.runtimeRequestsPerMinute,
      }, {
        projects: PLAN_ENTITLEMENTS.community.projects,
        apiKeys: PLAN_ENTITLEMENTS.community.apiKeysPerProject,
        retention: PLAN_ENTITLEMENTS.community.retentionDays,
        monthly: PLAN_ENTITLEMENTS.community.runtimeRequestsPerMonth,
        minute: PLAN_ENTITLEMENTS.community.runtimeRequestsPerMinute,
      }, scenario.name);
      const conflict = await db.prepare(`SELECT * FROM stripe_subscription_conflicts
        WHERE subscription_id=? AND resolved_at IS NULL`).get(row.id);
      assert.ok(conflict, scenario.name);
      assert.deepEqual(new Set([conflict.prior_event_id, conflict.conflicting_event_id]),
        new Set(events.map((event) => event.id)), scenario.name);
      assert.equal(Number(conflict.stripe_created), created, scenario.name);
      assert.ok(conflict.prior_state);
      assert.match(conflict.reason, /conflicting subscription state/);

      const newer = subscriptionEvent(value, {
        id: `evt_${crypto.randomUUID()}`, created: created + 1, status: 'active', periodEnd: created + 172800,
      });
      assert.equal((await processStripeEvent(newer)).outcome, 'applied_subscription_state');
      row = await db.prepare('SELECT * FROM subscriptions WHERE id=?').get(row.id);
      assert.equal(Boolean(row.reconciliation_required), false);
      assert.equal(Boolean(row.authoritative_state), true);
      assert.equal(row.billing_state_source, 'stripe_event');
      assert.equal(subscriptionAccessDecision(row).allowed, true);
      assert.equal((await entitlementForUser(value.userId)).key, 'developer_monthly');
      const resolved = await db.prepare('SELECT * FROM stripe_subscription_conflicts WHERE id=?').get(conflict.id);
      assert.ok(resolved.resolved_at);
      assert.equal(resolved.resolving_event_id, newer.id);
    }
  }
});

test('equal-time equivalent state and exact event duplicates are idempotent without reconciliation', async () => {
  const value = await pendingFixture('developer_monthly');
  await fulfilCheckout(value.session, { processEmailNow: false });
  const created = Math.floor(Date.now() / 1000);
  const first = subscriptionEvent(value, { id: `evt_${crypto.randomUUID()}`, created, status: 'active' });
  const equivalent = structuredClone(first);
  equivalent.id = `evt_${crypto.randomUUID()}`;
  assert.equal((await processStripeEvent(first)).outcome, 'applied_subscription_state');
  assert.equal((await processStripeEvent(first)).outcome, 'ignored_duplicate_state');
  assert.equal((await processStripeEvent(equivalent)).outcome, 'ignored_equivalent_state');
  const row = await db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id=?').get(value.session.subscription);
  assert.equal(Boolean(row.reconciliation_required), false);
  assert.equal(Boolean(row.authoritative_state), true);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) count FROM stripe_subscription_conflicts WHERE subscription_id=?').get(row.id)).count), 0);
});

test('stale subscription events are completed with an explicit auditable outcome', async () => {
  const value = await pendingFixture('developer_monthly');
  await fulfilCheckout(value.session, { processEmailNow: false });
  const base = Math.floor(Date.now() / 1000);
  await processStripeEvent(subscriptionEvent(value, { id: 'evt_state_new', created: base + 2, status: 'active' }));
  const stale = subscriptionEvent(value, { id: 'evt_state_old', created: base, type: 'customer.subscription.deleted' });
  delete stale.data.object.current_period_start;
  delete stale.data.object.current_period_end;
  assert.equal((await claimStripeEvent(stale.id, stale.type)).state, 'claimed');
  const result = await processStripeEvent(stale);
  assert.equal(result.outcome, 'ignored_stale');
  await completeStripeEvent(stale.id, result);
  const audit = await db.prepare('SELECT * FROM stripe_events WHERE id=?').get(stale.id);
  assert.equal(audit.status, 'processed');
  assert.equal(audit.processing_result, 'ignored_stale');
  assert.match(audit.ignored_reason, /older Stripe creation timestamp/);
});

test('concurrent conflicting subscription events serialize to authoritative Stripe order', async () => {
  const value = await pendingFixture('developer_monthly');
  await fulfilCheckout(value.session, { processEmailNow: false });
  const base = Math.floor(Date.now() / 1000);
  const older = subscriptionEvent(value, { id: 'evt_concurrent_old', created: base, status: 'active' });
  const newer = subscriptionEvent(value, { id: 'evt_concurrent_new', created: base + 1, type: 'customer.subscription.deleted' });
  await Promise.all([processStripeEvent(newer), processStripeEvent(older)]);
  const row = await db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id=?').get(value.session.subscription);
  assert.equal(row.status, 'canceled');
  assert.equal(row.latest_stripe_event_id, newer.id);
  assert.equal(subscriptionAccessDecision(row, Date.parse(row.current_period_end) + 1).allowed, false);
});

test('unsupported and misspelled events are explicitly ignored without access changes', async () => {
  const owner = await fixture();
  for (const type of ['charge.dispute.created', 'customer.subscription.update']) {
    const result = await processStripeEvent({ id: `evt_${crypto.randomUUID()}`, created: 1, type, data: { object: {} } });
    assert.equal(result.outcome, 'ignored_unsupported');
    assert.match(result.reason, new RegExp(type.replaceAll('.', '\\.')));
  }
  await assertNoAccessForUser(owner.userId);
});

test('an in-progress Stripe event prevents concurrent workers', async () => {
  const eventId = `evt_${crypto.randomUUID()}`;
  assert.equal((await claimStripeEvent(eventId, 'customer.subscription.updated')).state, 'claimed');
  assert.equal((await claimStripeEvent(eventId, 'customer.subscription.updated')).state, 'busy');
  await failStripeEvent(eventId, new Error('retry requested'));
});

test('abandoned event recovery is explicit, audited and makes the event retryable', async () => {
  const actor = await fixture();
  const eventId = `evt_${crypto.randomUUID()}`;
  await claimStripeEvent(eventId, 'customer.subscription.updated');
  await assert.rejects(() => recoverAbandonedStripeEvent({
    eventId, actorId: actor.userId, reason: '', workerStoppedConfirmed: true,
  }), /reason/);
  await assert.rejects(() => recoverAbandonedStripeEvent({
    eventId, actorId: actor.userId, reason: 'Worker ownership not established', workerStoppedConfirmed: false,
  }), /Confirm/);
  const recovered = await recoverAbandonedStripeEvent({
    eventId, actorId: actor.userId, reason: 'Process termination confirmed by platform logs', workerStoppedConfirmed: true,
  });
  assert.equal(recovered.status, 'failed');
  assert.equal(recovered.recovery_actor_id, actor.userId);
  assert.equal(recovered.recovery_reason, 'Process termination confirmed by platform logs');
  assert.ok(recovered.recovered_at);
  const audit = await db.prepare('SELECT * FROM stripe_event_recoveries WHERE stripe_event_id=?').get(eventId);
  assert.equal(audit.actor_id, actor.userId);
  assert.equal(audit.prior_state, 'processing');
  assert.equal(audit.reason, recovered.recovery_reason);
  assert.ok(audit.recovered_at);
  assert.equal((await claimStripeEvent(eventId, 'customer.subscription.updated')).state, 'claimed');
  await completeStripeEvent(eventId, { outcome: 'applied_subscription_state' });
  assert.equal((await claimStripeEvent(eventId, 'customer.subscription.updated')).state, 'completed');
  await assert.rejects(() => recoverAbandonedStripeEvent({
    eventId, actorId: actor.userId, reason: 'Must not reset completed', workerStoppedConfirmed: true,
  }), /current state is processed/);

  const failedId = `evt_${crypto.randomUUID()}`;
  await claimStripeEvent(failedId, 'invoice.payment_failed');
  await failStripeEvent(failedId, new Error('handler failure'));
  await assert.rejects(() => recoverAbandonedStripeEvent({
    eventId: failedId, actorId: actor.userId, reason: 'Must not reset failed', workerStoppedConfirmed: true,
  }), /current state is failed/);
});

test('worker completion and operator recovery cannot overwrite each other', async () => {
  const actor = await fixture();
  for (let index = 0; index < 4; index += 1) {
    const eventId = `evt_${crypto.randomUUID()}`;
    await claimStripeEvent(eventId, 'customer.subscription.updated');
    const outcomes = await Promise.allSettled([
      completeStripeEvent(eventId, { outcome: 'applied_subscription_state' }),
      recoverAbandonedStripeEvent({
        eventId, actorId: actor.userId, reason: `Confirmed abandoned worker ${index}`, workerStoppedConfirmed: true,
      }),
    ]);
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
    const row = await db.prepare('SELECT * FROM stripe_events WHERE id=?').get(eventId);
    assert.ok(['processed', 'failed'].includes(row.status));
    if (row.status === 'processed') {
      assert.equal(row.recovered_at, null);
      assert.equal(Number((await db.prepare('SELECT COUNT(*) count FROM stripe_event_recoveries WHERE stripe_event_id=?').get(eventId)).count), 0);
    } else {
      assert.ok(row.recovered_at);
      assert.equal(Number((await db.prepare('SELECT COUNT(*) count FROM stripe_event_recoveries WHERE stripe_event_id=?').get(eventId)).count), 1);
    }
  }
});

test('active cancellation-at-period-end remains entitled but actual cancelled status fails closed', () => {
  const now = Date.now();
  const future = new Date(now + 1).toISOString();
  const exact = new Date(now).toISOString();
  assert.equal(subscriptionAccessDecision({
    authoritative_state: 1, status: 'active', cancel_at_period_end: 1, current_period_end: future,
  }, now).allowed, true);
  assert.equal(subscriptionAccessDecision({ authoritative_state: 1, status: 'canceled', current_period_end: future }, now).allowed, false);
  assert.equal(subscriptionAccessDecision({ authoritative_state: 1, status: 'cancelled', current_period_end: future }, now).allowed, false);
  assert.equal(subscriptionAccessDecision({ authoritative_state: 1, status: 'cancelled', current_period_end: exact }, now).allowed, false);
  assert.equal(subscriptionAccessDecision({ authoritative_state: 1, status: 'canceled', current_period_end: null }, now).allowed, false);
  assert.equal(subscriptionAccessDecision({ authoritative_state: 1, status: 'active', current_period_end: exact }, now).allowed, false);
  assert.equal(subscriptionAccessDecision({ authoritative_state: 0, status: 'active', current_period_end: future }, now).allowed, false);
  assert.equal(subscriptionAccessDecision({ authoritative_state: 1, reconciliation_required: 1, status: 'active', current_period_end: future }, now).allowed, false);
  for (const status of ['past_due', 'unpaid', 'incomplete', 'paused'])
    assert.equal(subscriptionAccessDecision({ authoritative_state: 1, status, current_period_end: future }, now).allowed, false);
  assert.equal(subscriptionBlocksCheckout({ status: 'past_due', current_period_end: future }, now), true);
  assert.equal(subscriptionBlocksCheckout({ authoritative_state: 1, status: 'canceled', current_period_end: future }, now), false);
  assert.equal(subscriptionBlocksCheckout({ authoritative_state: 1, status: 'canceled', current_period_end: exact }, now), false);
  assert.equal(subscriptionBlocksAccountDeletion({ status: 'active', current_period_end: future }), true);
  assert.equal(subscriptionBlocksAccountDeletion({ status: 'past_due', current_period_end: future }), true);
  assert.equal(subscriptionBlocksAccountDeletion({ status: 'canceled', current_period_end: future }), false);
});

test('assessment, control-plane and red-team consumers share actual-cancellation denial', async () => {
  const value = await pendingFixture('developer_monthly');
  await fulfilCheckout(value.session, { processEmailNow: false });
  const created = Math.floor(Date.now() / 1000);
  const active = subscriptionEvent(value, { id: `evt_${crypto.randomUUID()}`, created, status: 'active' });
  active.data.object.cancel_at_period_end = true;
  assert.equal((await processStripeEvent(active)).outcome, 'applied_subscription_state');
  let subscription = await db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id=?').get(value.session.subscription);
  assert.equal(subscriptionAccessDecision(subscription).allowed, true);
  assert.equal((await entitlementForUser(value.userId)).key, 'developer_monthly');
  assert.ok((await createRedTeamToken({ userId: value.userId, assessmentId: value.assessmentId, mode: 'simulation' })).token);

  const cancelled = subscriptionEvent(value, {
    id: `evt_${crypto.randomUUID()}`, created: created + 1, type: 'customer.subscription.deleted',
    periodEnd: created + 86400,
  });
  assert.equal((await processStripeEvent(cancelled)).outcome, 'applied_subscription_state');
  subscription = await db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id=?').get(value.session.subscription);
  assert.equal(subscriptionAccessDecision(subscription).allowed, false);
  assert.equal((await entitlementForUser(value.userId)).key, 'community');
  await assert.rejects(
    () => createRedTeamToken({ userId: value.userId, assessmentId: value.assessmentId, mode: 'simulation' }),
    /paid security assessment or active Developer, Team, or Agency subscription/,
  );
});

test('SQLite billing lifecycle constraints reject malformed states', async () => {
  await assert.rejects(() => db.prepare(`INSERT INTO stripe_events
    (id,event_type,processed_at,status,attempt_count,created_at)
    VALUES (?,'test.invalid',?,'invented',0,?)`).run(`evt_${crypto.randomUUID()}`, nowIso(), nowIso()), /CHECK constraint/);
  const owner = await fixture();
  await assert.rejects(() => db.prepare(`INSERT INTO purchases
    (id,user_id,assessment_id,product_key,amount_pence,currency,status,stripe_session_id,stripe_customer_id,
     project_id,stripe_price_id,expected_amount_pence,expected_currency,checkout_mode,expected_customer_email,
     binding_state,binding_expires_at,checkout_created_at,created_at,updated_at)
    VALUES (?,?,?,'pro_report',-1,'GBP','pending',NULL,NULL,NULL,'demo_price_pro_report',-1,'GBP','invented',?,
      'invented',?,?,?,?)`).run(id('pay_'), owner.userId, owner.assessmentId, owner.email,
      new Date(Date.now() + 86400000).toISOString(), nowIso(), nowIso(), nowIso()), /CHECK constraint/);

  const timestamp = nowIso();
  const future = new Date(Date.now() + 86400000).toISOString();
  const subscriptionId = () => `subrec_invalid_${crypto.randomUUID()}`;
  const stripeId = () => `sub_invalid_${crypto.randomUUID()}`;
  const insertState = (values) => db.prepare(`INSERT INTO subscriptions
    (id,user_id,plan_key,status,stripe_subscription_id,current_period_start,current_period_end,
     authoritative_state,billing_state_source,latest_stripe_event_created,latest_stripe_event_id,
     latest_stripe_event_type,latest_stripe_event_state,reconciliation_required,reconciliation_started_at,
     created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...values);
  const base = ({ status = 'active', source = 'stripe_event', authoritative = 1,
    periodStart = timestamp, periodEnd = future, orderCreated = 1, orderId = 'evt_state',
    orderType = 'customer.subscription.updated', orderState = status, reconciliation = 0, reconciliationStarted = null } = {}) => [
    subscriptionId(), owner.userId, 'developer_monthly', status, stripeId(), periodStart, periodEnd,
    authoritative, source, orderCreated, orderId, orderType, orderState, reconciliation,
    reconciliationStarted, timestamp, timestamp,
  ];

  await assert.rejects(() => insertState(base({
    status: 'active', source: 'pending_checkout', authoritative: 0,
    periodStart: null, periodEnd: null, orderCreated: null, orderId: null, orderType: null, orderState: null,
  })), /CHECK constraint/);
  await assert.rejects(() => insertState(base({
    status: 'pending', source: 'pending_checkout', authoritative: 0,
  })), /CHECK constraint/);
  await assert.rejects(() => insertState(base({
    source: 'reconciliation_required', authoritative: 0,
  })), /CHECK constraint/);
  await assert.rejects(() => insertState(base({
    source: 'reconciliation_required', authoritative: 0, reconciliation: 1,
  })), /CHECK constraint/);
  await assert.rejects(() => insertState(base({
    source: 'legacy_reconciliation_required', authoritative: 1,
  })), /CHECK constraint/);
  await assert.rejects(() => insertState(base({
    source: 'stripe_event', authoritative: 1, orderState: null,
  })), /CHECK constraint/);

  const pendingId = subscriptionId();
  await insertState([
    pendingId, owner.userId, 'developer_monthly', 'pending', stripeId(), null, null,
    0, 'pending_checkout', null, null, null, null, 0, null, timestamp, timestamp,
  ]);
  await assert.rejects(() => db.prepare(`INSERT INTO stripe_subscription_conflicts
    (id,subscription_id,stripe_created,prior_event_id,prior_event_type,conflicting_event_id,
     conflicting_event_type,prior_state,conflicting_state,reason,created_at,resolved_at,resolving_event_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(
      id('ssc_'), pendingId, 1, 'evt_prior', 'customer.subscription.updated', 'evt_conflict',
      'customer.subscription.deleted', '{}', '{}', 'contradictory resolution', timestamp, timestamp,
    ), /CHECK constraint/);

  const legacyId = subscriptionId();
  await insertState([
    legacyId, owner.userId, 'developer_monthly', 'active', stripeId(), timestamp, 'malformed-preserved',
    0, 'legacy_reconciliation_required', null, null, null, null, 0, null, timestamp, timestamp,
  ]);
  assert.equal((await db.prepare('SELECT billing_state_source FROM subscriptions WHERE id=?').get(legacyId)).billing_state_source,
    'legacy_reconciliation_required');
});
