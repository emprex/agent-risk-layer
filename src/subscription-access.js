const ACCESS_STATUSES = new Set(['active', 'trialing']);
const CANCELLED_STATUSES = new Set(['canceled', 'cancelled']);
const BLOCKING_STATUSES = new Set(['past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']);

export function subscriptionAccessDecision(subscription, timestampMs = Date.now()) {
  if (!subscription) return { allowed: false, reason: 'missing' };
  if (Boolean(subscription.reconciliation_required)) return { allowed: false, reason: 'reconciliation_required' };
  if (!Boolean(subscription.authoritative_state)) return { allowed: false, reason: 'pending_authoritative_state' };
  const status = String(subscription.status || '').toLowerCase();
  const periodEnd = Date.parse(subscription.current_period_end || '');
  if (!Number.isFinite(periodEnd)) return { allowed: false, reason: 'invalid_period_end' };
  if (periodEnd <= timestampMs) return { allowed: false, reason: 'period_ended' };
  if (ACCESS_STATUSES.has(status)) return { allowed: true, reason: status };
  if (CANCELLED_STATUSES.has(status)) return { allowed: false, reason: 'cancelled' };
  return { allowed: false, reason: BLOCKING_STATUSES.has(status) ? status : 'inactive' };
}

export function subscriptionBlocksCheckout(subscription, timestampMs = Date.now()) {
  if (!subscription) return false;
  const status = String(subscription.status || '').toLowerCase();
  if (status === 'pending') return true;
  if (ACCESS_STATUSES.has(status) || BLOCKING_STATUSES.has(status))
    return true;
  return CANCELLED_STATUSES.has(status) && subscriptionAccessDecision(subscription, timestampMs).allowed;
}

export function subscriptionBlocksAccountDeletion(subscription) {
  if (!subscription) return false;
  const status = String(subscription.status || '').toLowerCase();
  return status === 'pending' || ACCESS_STATUSES.has(status) || BLOCKING_STATUSES.has(status);
}
