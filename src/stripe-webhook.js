import { db, id, nowIso } from './db.js';
import { fulfilCheckout } from './fulfilment.js';

const STRIPE_EVENT_HANDLERS = new Map([
  ['checkout.session.completed', processCheckoutEvent],
  ['checkout.session.async_payment_succeeded', processCheckoutEvent],
  ['customer.subscription.created', applyOrderedSubscriptionEvent],
  ['customer.subscription.updated', applyOrderedSubscriptionEvent],
  ['customer.subscription.deleted', applyOrderedSubscriptionEvent],
  ['invoice.payment_failed', applyOrderedInvoiceFailure],
]);

export const SUPPORTED_STRIPE_EVENTS = new Set(STRIPE_EVENT_HANDLERS.keys());

export async function processStripeEvent(event) {
  const handler = STRIPE_EVENT_HANDLERS.get(event.type);
  if (!handler)
    return { outcome: 'ignored_unsupported', reason: `Unsupported signed Stripe event: ${String(event.type || '').slice(0, 120)}` };
  return handler(event);
}

async function processCheckoutEvent(event) {
  await fulfilCheckout(event.data.object);
  return { outcome: 'fulfilled_checkout' };
}

export async function applyOrderedSubscriptionEvent(event) {
  const order = stripeEventOrder(event);
  const subscription = event?.data?.object || {};
  const subscriptionId = String(subscription.id || '');
  const customerId = String(subscription.customer || '');
  const metadata = subscription.metadata || {};
  const status = String(subscription.status || '').toLowerCase();
  const allowedStatuses = new Set(['active', 'trialing', 'canceled', 'cancelled', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']);
  if (!subscriptionId) throw new Error('Stripe subscription identity is required.');
  return db.transaction(async () => {
    const lock = db.kind === 'postgres' ? ' FOR UPDATE' : '';
    const row = await db.prepare(`SELECT * FROM subscriptions WHERE stripe_subscription_id=?${lock}`).get(subscriptionId);
    if (!row)
      throw new Error('Stripe subscription is not bound to a verified pending purchase.');
    const comparison = compareStripeEventOrder(order, row);
    if (comparison === 'duplicate' || comparison === 'older')
      return {
        outcome: comparison === 'duplicate' ? 'ignored_duplicate_state' : 'ignored_stale',
        reason: comparison === 'duplicate' ? 'Subscription state event was already applied.' : 'Subscription state event has an older Stripe creation timestamp.',
      };
    if (!customerId || !metadata.user_id || !metadata.product_key)
      throw new Error('Stripe subscription customer and binding metadata are required.');
    if (!allowedStatuses.has(status))
      throw new Error('Stripe subscription status is unsupported.');
    if (event.type === 'customer.subscription.deleted' && !['canceled', 'cancelled'].includes(status))
      throw new Error('Deleted Stripe subscription is not in a cancelled state.');
    verifySubscriptionBinding(row, { customerId, metadata });
    const period = authoritativePeriod(subscription);
    const nextState = {
      status,
      periodStart: period.start,
      periodEnd: period.end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ? 1 : 0,
      canceledAt: stripeTimestamp(subscription.canceled_at),
    };
    if (comparison === 'equal_timestamp') {
      if (equivalentSubscriptionState(row, nextState))
        return { outcome: 'ignored_equivalent_state', reason: 'Equal-time event represents the already stored subscription state.' };
      return recordSubscriptionConflict({ row, order, eventType: event.type, proposedState: nextState });
    }
    const updated = await db.prepare(`UPDATE subscriptions SET status=?,current_period_start=?,current_period_end=?,
      cancel_at_period_end=?,canceled_at=?,authoritative_state=1,billing_state_source='stripe_event',
      reconciliation_required=0,reconciliation_started_at=NULL,
      latest_stripe_event_created=?,latest_stripe_event_id=?,latest_stripe_event_type=?,latest_stripe_event_state=?,updated_at=?
      WHERE id=?`).run(status, nextState.periodStart, nextState.periodEnd, nextState.cancelAtPeriodEnd,
        nextState.canceledAt, order.created, order.id, event.type, status, nowIso(), row.id);
    if (Number(updated.changes) !== 1) throw new Error('Stripe subscription state update raced unexpectedly.');
    await resolveSubscriptionConflicts(row.id, order);
    return { outcome: 'applied_subscription_state', state: status };
  });
}

export async function applyOrderedInvoiceFailure(event) {
  const order = stripeEventOrder(event);
  const invoice = event?.data?.object || {};
  const subscriptionId = String(invoice.subscription || invoice.parent?.subscription_details?.subscription || '');
  if (!subscriptionId) throw new Error('Failed invoice does not identify a subscription.');
  return db.transaction(async () => {
    const lock = db.kind === 'postgres' ? ' FOR UPDATE' : '';
    const row = await db.prepare(`SELECT * FROM subscriptions WHERE stripe_subscription_id=?${lock}`).get(subscriptionId);
    if (!row) throw new Error('Failed invoice subscription is not bound to a local purchase.');
    const comparison = compareStripeEventOrder(order, row);
    if (comparison === 'duplicate' || comparison === 'older')
      return {
        outcome: comparison === 'duplicate' ? 'ignored_duplicate_state' : 'ignored_stale',
        reason: comparison === 'duplicate' ? 'Invoice failure event was already applied.' : 'Invoice failure event has an older Stripe creation timestamp.',
      };
    if (invoice.customer && String(invoice.customer) !== String(row.stripe_customer_id || ''))
      throw new Error('Failed invoice customer does not match the stored subscription.');
    const nextState = {
      status: 'past_due',
      periodStart: row.current_period_start,
      periodEnd: row.current_period_end,
      cancelAtPeriodEnd: Number(row.cancel_at_period_end || 0),
      canceledAt: row.canceled_at || null,
    };
    if (comparison === 'equal_timestamp') {
      if (equivalentSubscriptionState(row, nextState))
        return { outcome: 'ignored_equivalent_state', reason: 'Equal-time event represents the already stored subscription state.' };
      return recordSubscriptionConflict({ row, order, eventType: event.type, proposedState: nextState });
    }
    await db.prepare(`UPDATE subscriptions SET status='past_due',authoritative_state=1,billing_state_source='stripe_event',
      reconciliation_required=0,reconciliation_started_at=NULL,
      latest_stripe_event_created=?,latest_stripe_event_id=?,latest_stripe_event_type=?,
      latest_stripe_event_state='past_due',updated_at=? WHERE id=?`)
      .run(order.created, order.id, event.type, nowIso(), row.id);
    await resolveSubscriptionConflicts(row.id, order);
    return { outcome: 'applied_subscription_state', state: 'past_due' };
  });
}

export function compareStripeEventOrder(order, subscription) {
  const latestCreated = subscription.latest_stripe_event_created;
  const latestId = subscription.latest_stripe_event_id;
  if (latestCreated == null || !latestId) return 'newer';
  const numericLatest = Number(latestCreated);
  if (order.created !== numericLatest) return order.created > numericLatest ? 'newer' : 'older';
  if (order.id === latestId) return 'duplicate';
  return 'equal_timestamp';
}

async function recordSubscriptionConflict({ row, order, eventType, proposedState }) {
  const timestamp = nowIso();
  const reason = 'Different Stripe events at the same creation timestamp contain materially conflicting subscription state.';
  await db.prepare(`INSERT INTO stripe_subscription_conflicts
    (id,subscription_id,stripe_created,prior_event_id,prior_event_type,conflicting_event_id,conflicting_event_type,
     prior_state,conflicting_state,reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(subscription_id,prior_event_id,conflicting_event_id) DO NOTHING`)
    .run(id('ssc_'), row.id, order.created, row.latest_stripe_event_id, row.latest_stripe_event_type,
      order.id, eventType, boundedState(row), boundedState(proposedState), reason, timestamp);
  await db.prepare(`UPDATE subscriptions SET authoritative_state=0,billing_state_source='reconciliation_required',
    reconciliation_required=1,reconciliation_started_at=COALESCE(reconciliation_started_at,?),updated_at=? WHERE id=?`)
    .run(timestamp, timestamp, row.id);
  return { outcome: 'reconciliation_required', reason };
}

async function resolveSubscriptionConflicts(subscriptionId, order) {
  await db.prepare(`UPDATE stripe_subscription_conflicts SET resolved_at=?,resolving_event_id=?
    WHERE subscription_id=? AND resolved_at IS NULL AND stripe_created<?`)
    .run(nowIso(), order.id, subscriptionId, order.created);
}

function equivalentSubscriptionState(row, state) {
  return String(row.status || '').toLowerCase() === String(state.status || '').toLowerCase()
    && String(row.current_period_start || '') === String(state.periodStart || '')
    && String(row.current_period_end || '') === String(state.periodEnd || '')
    && Number(row.cancel_at_period_end || 0) === Number(state.cancelAtPeriodEnd || 0)
    && String(row.canceled_at || '') === String(state.canceledAt || '');
}

function boundedState(state) {
  return JSON.stringify({
    status: String(state.status || '').slice(0, 40),
    currentPeriodStart: String(state.current_period_start || state.periodStart || '').slice(0, 40) || null,
    currentPeriodEnd: String(state.current_period_end || state.periodEnd || '').slice(0, 40) || null,
    cancelAtPeriodEnd: Boolean(Number(state.cancel_at_period_end ?? state.cancelAtPeriodEnd ?? 0)),
    canceledAt: String(state.canceled_at || state.canceledAt || '').slice(0, 40) || null,
  });
}

function stripeEventOrder(event) {
  const created = Number(event?.created);
  const id = String(event?.id || '');
  if (!id || !Number.isSafeInteger(created) || created < 0)
    throw new Error('Authoritative Stripe event ID and creation timestamp are required.');
  return { id, created };
}

function authoritativePeriod(subscription) {
  const itemPeriods = Array.isArray(subscription.items?.data)
    ? subscription.items.data.map((item) => ({
        start: Number(item.current_period_start || 0),
        end: Number(item.current_period_end || 0),
      })).filter((item) => item.start && item.end)
    : [];
  const startSeconds = Number(subscription.current_period_start || Math.min(...itemPeriods.map((item) => item.start)));
  const endSeconds = Number(subscription.current_period_end || Math.max(...itemPeriods.map((item) => item.end)));
  if (!Number.isSafeInteger(startSeconds) || !Number.isSafeInteger(endSeconds)
      || startSeconds < 0 || endSeconds <= startSeconds)
    throw new Error('Stripe subscription paid-period boundaries are missing or invalid.');
  return {
    start: new Date(startSeconds * 1000).toISOString(),
    end: new Date(endSeconds * 1000).toISOString(),
  };
}

function stripeTimestamp(value) {
  if (value == null || value === '') return null;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 0)
    throw new Error('Stripe cancellation timestamp is invalid.');
  return new Date(seconds * 1000).toISOString();
}

function verifySubscriptionBinding(row, { customerId, metadata }) {
  if (!row.purchase_id || row.user_id !== metadata.user_id || row.plan_key !== metadata.product_key
      || String(row.stripe_customer_id || '') !== customerId)
    throw new Error('Stripe subscription does not match its verified purchase, user, product or customer binding.');
}
