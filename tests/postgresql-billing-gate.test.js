import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL || '';
const expectedDatabase = 'agentrisklayer_billing_gate1_test';
const destructiveGateConfirmation = process.env.ARL_POSTGRES_GATE_CONFIRM || '';

test('real PostgreSQL billing writes use native booleans and serialize ordered events', {
  timeout: 120000,
}, async () => {
  assert.ok(testDatabaseUrl,
    'TEST_DATABASE_URL is required when explicitly running the isolated PostgreSQL write integration test.');
  assert.equal(destructiveGateConfirmation, expectedDatabase,
    `ARL_POSTGRES_GATE_CONFIRM must equal ${expectedDatabase} before this explicit write integration test may reset its isolated schema.`);
  const parsed = new URL(testDatabaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol));
  assert.equal(parsed.pathname.slice(1), expectedDatabase);

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.DATABASE_SSL = 'true';
  process.env.DATABASE_SSL_REJECT_UNAUTHORISED = 'true';
  process.env.DEMO_MODE = 'true';
  process.env.ADMIN_EMAIL = '';

  const { db, initialiseDatabase, nowIso } = await import('../src/db.js');
  const {
    bindPendingCheckoutSession,
    createPendingCheckout,
    fulfilCheckout,
  } = await import('../src/fulfilment.js');
  const { processStripeEvent } = await import('../src/stripe-webhook.js');
  const { claimStripeEvent, completeStripeEvent } = await import('../src/stripe-events.js');
  const { subscriptionAccessDecision } = await import('../src/subscription-access.js');

  const reset = async () => {
    await db.query('DROP SCHEMA public CASCADE');
    await db.query('CREATE SCHEMA public');
  };

  const createOwner = async (label = crypto.randomUUID()) => {
    const userId = `usr_pg_${label}`;
    const email = `pg-${label}@example.test`;
    await db.prepare(`INSERT INTO users (id,email,password_hash,email_verified_at,created_at)
      VALUES (?,?,?,?,?)`).run(userId, email, 'test-only', nowIso(), nowIso());
    return { userId, email };
  };

  const pendingFixture = async (label = crypto.randomUUID()) => {
    const owner = await createOwner(label);
    const pending = await createPendingCheckout({
      userId: owner.userId,
      productKey: 'developer_monthly',
      stripePriceId: 'demo_price_developer_monthly',
      expectedAmountPence: 2900,
      expectedCurrency: 'gbp',
      checkoutMode: 'subscription',
      expectedCustomerEmail: owner.email,
    });
    const session = {
      id: `cs_pg_${label}`,
      mode: 'subscription',
      payment_status: 'paid',
      amount_total: 2900,
      currency: 'gbp',
      customer: `cus_pg_${label}`,
      customer_details: { email: owner.email },
      client_reference_id: owner.userId,
      subscription: `sub_pg_${label}`,
      metadata: {
        purchase_id: pending.id,
        user_id: owner.userId,
        assessment_id: '',
        project_id: '',
        product_key: 'developer_monthly',
        price_id: 'demo_price_developer_monthly',
      },
    };
    await bindPendingCheckoutSession(pending.id, session);
    return { ...owner, pending, session };
  };

  const subscriptionEvent = (value, {
    eventId = `evt_pg_${crypto.randomUUID()}`,
    created,
    type = 'customer.subscription.updated',
    status = type === 'customer.subscription.deleted' ? 'canceled' : 'active',
    periodEnd = created + 86400,
    userId = value.userId,
  }) => ({
    id: eventId,
    created,
    type,
    data: {
      object: {
        id: value.session.subscription,
        customer: value.session.customer,
        status,
        metadata: { user_id: userId, product_key: 'developer_monthly' },
        current_period_start: created - 3600,
        current_period_end: periodEnd,
        cancel_at_period_end: status === 'canceled',
        canceled_at: status === 'canceled' ? created : null,
      },
    },
  });

  const subscription = (value) => db.prepare(
    'SELECT * FROM subscriptions WHERE stripe_subscription_id=?',
  ).get(value.session.subscription);

  await reset();
  try {
    await initialiseDatabase();
    assert.equal((await db.prepare('SELECT current_database() AS name').get()).name, expectedDatabase);

    const pending = await pendingFixture('pending');
    await fulfilCheckout(pending.session, { processEmailNow: false });
    let row = await subscription(pending);
    assert.equal(row.status, 'pending');
    assert.equal(row.authoritative_state, false);
    assert.equal(row.reconciliation_required, false);
    assert.equal(subscriptionAccessDecision(row).allowed, false);

    const base = Math.floor(Date.now() / 1000);
    const active = subscriptionEvent(pending, { eventId: 'evt_pg_active', created: base });
    assert.equal((await processStripeEvent(active)).outcome, 'applied_subscription_state');
    row = await subscription(pending);
    assert.equal(row.authoritative_state, true);
    assert.equal(row.reconciliation_required, false);
    assert.equal(subscriptionAccessDecision(row).allowed, true);

    const invoice = {
      id: 'evt_pg_invoice_failed',
      created: base + 1,
      type: 'invoice.payment_failed',
      data: { object: { subscription: pending.session.subscription, customer: pending.session.customer } },
    };
    assert.equal((await processStripeEvent(invoice)).outcome, 'applied_subscription_state');
    row = await subscription(pending);
    assert.equal(row.status, 'past_due');
    assert.equal(row.authoritative_state, true);
    assert.equal(row.reconciliation_required, false);
    assert.equal(subscriptionAccessDecision(row).allowed, false);

    const conflictCases = [
      ['forward', false],
      ['reverse', true],
    ];
    for (const [label, reverse] of conflictCases) {
      const value = await pendingFixture(`conflict_${label}`);
      await fulfilCheckout(value.session, { processEmailNow: false });
      const created = base + 10;
      const events = [
        subscriptionEvent(value, { eventId: `evt_pg_${label}_active`, created }),
        subscriptionEvent(value, {
          eventId: `evt_pg_${label}_deleted`,
          created,
          type: 'customer.subscription.deleted',
        }),
      ];
      if (reverse) events.reverse();
      assert.equal((await processStripeEvent(events[0])).outcome, 'applied_subscription_state');
      assert.equal((await processStripeEvent(events[1])).outcome, 'reconciliation_required');
      row = await subscription(value);
      assert.equal(row.authoritative_state, false);
      assert.equal(row.reconciliation_required, true);
      assert.equal(subscriptionAccessDecision(row).allowed, false);
      const newer = subscriptionEvent(value, {
        eventId: `evt_pg_${label}_resolution`,
        created: created + 1,
      });
      assert.equal((await processStripeEvent(newer)).outcome, 'applied_subscription_state');
      row = await subscription(value);
      assert.equal(row.authoritative_state, true);
      assert.equal(row.reconciliation_required, false);
      assert.equal(subscriptionAccessDecision(row).allowed, true);
    }

    const ordering = await pendingFixture('ordering');
    await fulfilCheckout(ordering.session, { processEmailNow: false });
    const newer = subscriptionEvent(ordering, {
      eventId: 'evt_pg_order_new',
      created: base + 30,
      type: 'customer.subscription.deleted',
    });
    const older = subscriptionEvent(ordering, {
      eventId: 'evt_pg_order_old',
      created: base + 29,
    });
    const concurrent = await Promise.all([
      processStripeEvent(older),
      processStripeEvent(newer),
    ]);
    assert.ok(concurrent.some((result) => result.outcome === 'applied_subscription_state'));
    row = await subscription(ordering);
    assert.equal(row.latest_stripe_event_id, newer.id);
    assert.equal(row.status, 'canceled');
    assert.equal(subscriptionAccessDecision(row).allowed, false);

    const equivalent = structuredClone(newer);
    equivalent.id = 'evt_pg_order_equivalent';
    assert.equal((await processStripeEvent(equivalent)).outcome, 'ignored_equivalent_state');
    assert.equal((await processStripeEvent(newer)).outcome, 'ignored_duplicate_state');

    const poisoned = await pendingFixture('poisoned');
    await fulfilCheckout(poisoned.session, { processEmailNow: false });
    const beforePoison = await subscription(poisoned);
    const other = await createOwner('other');
    await assert.rejects(
      () => processStripeEvent(subscriptionEvent(poisoned, {
        eventId: 'evt_pg_poisoned',
        created: base + 40,
        userId: other.userId,
      })),
      /does not match/,
    );
    const afterPoison = await subscription(poisoned);
    assert.deepEqual(afterPoison, beforePoison);

    const duplicate = await pendingFixture('duplicate');
    const fulfilments = await Promise.all([
      fulfilCheckout(duplicate.session, { processEmailNow: false }),
      fulfilCheckout(duplicate.session, { processEmailNow: false }),
    ]);
    assert.equal(new Set(fulfilments.map((purchase) => purchase.id)).size, 1);
    assert.equal(Number((await db.prepare(
      'SELECT COUNT(*) count FROM subscriptions WHERE purchase_id=?',
    ).get(duplicate.pending.id)).count), 1);
    assert.equal(Number((await db.prepare(
      'SELECT COUNT(*) count FROM fulfilment_jobs WHERE purchase_id=?',
    ).get(duplicate.pending.id)).count), 1);

    const claimId = 'evt_pg_concurrent_claim';
    const claims = await Promise.all([
      claimStripeEvent(claimId, 'customer.subscription.updated'),
      claimStripeEvent(claimId, 'customer.subscription.updated'),
    ]);
    assert.deepEqual(claims.map((claim) => claim.state).sort(), ['busy', 'claimed']);
    await completeStripeEvent(claimId);
    assert.equal((await claimStripeEvent(claimId, 'customer.subscription.updated')).state, 'completed');
  } finally {
    await reset();
    const remaining = await db.query(`SELECT COUNT(*)::int AS count FROM pg_catalog.pg_tables
      WHERE schemaname NOT IN ('pg_catalog','information_schema')`);
    assert.equal(remaining.rows[0].count, 0);
    await db.close();
  }
});
