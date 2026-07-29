import { db, id, insertEvent, nowIso } from './db.js';

export async function claimStripeEvent(eventId, eventType, now = nowIso()) {
  if (!eventId || !eventType) throw new Error('Stripe event identity is required.');
  return db.transaction(async () => {
    await db.prepare(`INSERT INTO stripe_events
      (id,event_type,processed_at,status,last_error,attempt_count,processing_started_at,completed_at,created_at)
      VALUES (?,?,?,'received',NULL,0,NULL,NULL,?)
      ON CONFLICT(id) DO NOTHING`).run(eventId, eventType, now, now);
    const lock = db.kind === 'postgres' ? ' FOR UPDATE' : '';
    const row = await db.prepare(`SELECT * FROM stripe_events WHERE id=?${lock}`).get(eventId);
    if (!row) throw new Error('Stripe event claim could not be loaded.');
    if (row.event_type !== eventType) throw new Error('Stripe event type does not match its stored identity.');
    if (row.status === 'processed')
      return { state: 'completed', event: row };
    if (row.status === 'processing')
      return { state: 'busy', event: row };
    const claimed = await db.prepare(`UPDATE stripe_events SET status='processing',attempt_count=attempt_count+1,
      processing_started_at=?,processed_at=?,last_error=NULL,processing_result=NULL,ignored_reason=NULL
      WHERE id=? AND status!='processed'`).run(now, now, eventId);
    if (Number(claimed.changes) !== 1) return { state: 'busy', event: row };
    return { state: 'claimed', event: await db.prepare('SELECT * FROM stripe_events WHERE id=?').get(eventId) };
  });
}

export async function completeStripeEvent(eventId, result = {}, now = nowIso()) {
  const outcome = String(result.outcome || 'processed').slice(0, 80);
  const ignoredReason = outcome.startsWith('ignored_') ? String(result.reason || '').slice(0, 500) : null;
  const update = await db.prepare(`UPDATE stripe_events SET status='processed',completed_at=?,processed_at=?,
    processing_started_at=NULL,last_error=NULL,processing_result=?,ignored_reason=?
    WHERE id=? AND status='processing'`).run(now, now, outcome, ignoredReason, eventId);
  if (Number(update.changes) !== 1) throw new Error('Stripe event was not in a claimable processing state.');
}

export async function failStripeEvent(eventId, error, now = nowIso()) {
  await db.prepare(`UPDATE stripe_events SET status='failed',last_error=?,processed_at=?,
    processing_started_at=NULL WHERE id=? AND status='processing'`)
    .run(String(error?.message || error || 'Unknown Stripe event failure').slice(0, 1000), now, eventId);
}

export async function recoverAbandonedStripeEvent({
  eventId, actorId, reason, workerStoppedConfirmed, now = nowIso(),
}) {
  const boundedEventId = String(eventId || '').trim();
  const boundedReason = String(reason || '').trim();
  if (!boundedEventId || boundedEventId.length > 200 || !/^[A-Za-z0-9_.-]+$/.test(boundedEventId))
    throw recoveryError('A valid exact Stripe event ID is required.');
  if (!actorId) throw recoveryError('Recovery actor is required.');
  if (!boundedReason || boundedReason.length > 500)
    throw recoveryError('A recovery reason between 1 and 500 characters is required.');
  if (workerStoppedConfirmed !== true)
    throw recoveryError('Confirm that the original worker is no longer running.');
  return db.transaction(async () => {
    const lock = db.kind === 'postgres' ? ' FOR UPDATE' : '';
    const row = await db.prepare(`SELECT * FROM stripe_events WHERE id=?${lock}`).get(boundedEventId);
    if (!row) throw recoveryError('Stripe event was not found.', 404);
    if (row.status !== 'processing')
      throw recoveryError(`Only processing events can be recovered; current state is ${row.status}.`, 409);
    const changed = await db.prepare(`UPDATE stripe_events SET status='failed',processing_started_at=NULL,
      processed_at=?,last_error='Operator marked the prior worker abandoned.',processing_result='operator_recovered',
      recovery_actor_id=?,recovery_reason=?,recovered_at=?
      WHERE id=? AND status='processing'`).run(now, actorId, boundedReason, now, boundedEventId);
    if (Number(changed.changes) !== 1)
      throw recoveryError('Stripe event changed concurrently and was not recovered.', 409);
    await db.prepare(`INSERT INTO stripe_event_recoveries
      (id,stripe_event_id,actor_id,prior_state,reason,recovered_at) VALUES (?,?,?,?,?,?)`)
      .run(id('ser_'), boundedEventId, actorId, 'processing', boundedReason, now);
    await insertEvent('stripe_event_operator_recovery', actorId, {
      stripeEventId: boundedEventId, priorState: 'processing', reason: boundedReason, recoveredAt: now,
    });
    return db.prepare('SELECT * FROM stripe_events WHERE id=?').get(boundedEventId);
  });
}

function recoveryError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
