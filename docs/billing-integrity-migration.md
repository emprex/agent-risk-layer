# Billing integrity migration

Migration `007_billing_integrity.sql` adds an authoritative pending-Checkout binding to existing purchase rows and a retryable processing lifecycle to Stripe event rows. It is additive and runs inside the existing PostgreSQL migration transaction.

New Checkout flows create a pending purchase before redirecting to Stripe. The row binds the authenticated user, optional assessment/project, internal product, configured Stripe price, expected amount and currency, mode, customer email, session ID, creation time and expiry. Fulfilment is permitted only after a Stripe-signed paid session matches every stored field and the current server catalogue.

Subscription Checkout creates a non-entitled `pending` subscription binding. It does not invent a billing period. Access begins only after a signed, purchase-bound `customer.subscription.created` or later supported subscription event supplies valid Stripe period boundaries. Subscription state stores the latest Stripe event `created` value, event ID, type and resulting state. Older events are ignored and exact event-ID duplicates are idempotent. Stripe event IDs are identity values, not chronological evidence.

Different events with the same Stripe `created` second are compared only for state equivalence. Equivalent snapshots are safely ignored. Material differences in status, cancellation data or paid-period boundaries create a redacted `stripe_subscription_conflicts` audit record and put the subscription into `reconciliation_required`. That state is non-authoritative and denies assessment and all commercial control-plane entitlements. A strictly newer valid signed subscription event resolves the conflict and records the resolving event ID. Arrival order cannot select an entitled final state for an equal-time conflict.

Existing fulfilled purchases and their entitlements are preserved as `legacy_fulfilled`; they are not silently re-verified. Existing incomplete purchases become `legacy_review_required` and are excluded from automatic fulfilment until an operator resolves them. No historical record is deleted.

All pre-migration subscription rows retain their original status, customer/subscription identifiers and paid-period fields, but are classified `legacy_reconciliation_required` with `authoritative_state=false`. The migration cannot prove their provenance from stored legacy data alone, so even apparently active, trialing or not-yet-expired rows fail closed. This may temporarily reduce existing customers to Community entitlements until a current, correctly bound Stripe subscription event is replayed or an operator performs controlled server-side Stripe retrieval and applies the result through the same ordered state handler. Missing, malformed, expired, pending and incomplete legacy rows remain non-entitled; the migration never invents periods or ordering history.

The local SQLite adapter upgrades an earlier unconstrained `subscriptions` table with an atomic table rebuild. Before copying, every row is checked against the complete lifecycle classification. A row with absent, unknown or internally inconsistent lifecycle metadata is copied as non-authoritative `legacy_reconciliation_required`; its identifiers, status and period evidence are preserved, while untrusted ordering and reconciliation assertions are cleared. The replacement table requires a non-null recognized source and the same supported lifecycle combinations as PostgreSQL. The transaction recreates subscription indexes and runs `PRAGMA foreign_key_check` before commit. Foreign-key enforcement is restored after either commit or rollback. A failed copy rolls back the schema transaction, leaving the original table and unrelated database content intact; repeated startup detects the constrained table and does not rebuild it again.

Stripe events now record received, processing, failed and processed states, attempt count, processing time, completion time, explicit processing outcome and the last bounded error. Completed, stale and intentionally unsupported events remain idempotent. A failed event can be claimed on a later Stripe retry, while an in-progress event rejects concurrent execution.

There is currently no HTTP reconciliation endpoint that accepts subscription state from an operator or browser. That would create a new self-assertion boundary. Controlled reconciliation must retrieve the subscription using the server-held Stripe credential outside database locks, verify its stored purchase/customer/subscription binding, and apply it as `stripe_retrieval` through the ordered transaction. Until that trusted retrieval workflow is available, replaying a strictly newer signed Stripe subscription event is the supported resolution path. Never paste Stripe payloads into the recovery endpoint.

Subscription access follows the published cancellation policy: `active` and `trialing` subscriptions require a valid future paid-period boundary. An active or trialing subscription with `cancel_at_period_end=true` retains access until that boundary because its actual Stripe status remains entitled. Once Stripe reports `canceled` or `cancelled`, access ends immediately even if the supplied period end is later. `past_due`, `unpaid`, `incomplete`, paused, malformed and expired records fail closed. Billing-attention states continue to block starting a second subscription.

## Abandoned event recovery

There is no automatic processing lease takeover. Before recovery, an operator must establish from platform instance state and logs that the worker which claimed the exact event ID is no longer running. A verified superuser with production MFA then calls:

`POST /api/admin/stripe-events/{exact-event-id}/recover`

with a bounded `reason` and `workerStoppedConfirmed: true`. The reason must contain operational evidence, not Stripe payloads, credentials or personal/payment data. The operation locks and rechecks the event and permits only `processing → failed`. It records actor, reason, prior state and recovery time in both the recovery table and security event log. Completed, already-failed, missing or concurrently changed events are rejected. Stripe can then retry the failed event normally. Never use this operation merely because an event is slow.

## Required stop-the-world production cutover

This release does **not** claim zero-downtime compatibility. An already-running old binary cannot understand a new database flag and can still execute its former metadata-only webhook path. Use this cutover:

1. Set `BILLING_WEBHOOK_MODE=maintenance` on the new configuration and pause Stripe webhook delivery or route the webhook endpoint to a controlled 503 maintenance response.
2. Stop or drain every old application instance and confirm from the hosting control plane that no old worker can receive webhooks.
3. Record the cutover time and take and verify a PostgreSQL backup.
4. Deploy the new application in maintenance mode. Its startup transaction applies migration 007 under the migration advisory lock before listening.
5. Verify migration checksum, all billing constraints and indexes, readiness, and that the webhook endpoint returns 503 without creating a `stripe_events` row.
6. Set `BILLING_WEBHOOK_MODE=enabled`, restart only the new version, and resume Stripe webhook delivery.
7. Replay or allow Stripe to retry queued events. Verify explicit outcomes, pending-subscription conversion, access boundaries and operational alerts.

The rollback point is the verified backup immediately before migration. Application rollback without schema rollback is structurally possible because the migration is additive, but the old application must not be allowed to process billing webhooks. If application rollback is required, return to maintenance mode first and keep Stripe delivery paused. Dropping columns would destroy Checkout bindings, ordering data and retry history; schema rollback therefore requires restoring the backup and reconciling every Stripe event after the backup time.

Migration 007 is uncommitted and absent from commit `c513b27`; repository history therefore provides evidence that its checksum has not shipped from this branch. Once applied anywhere, do not rewrite it because checksum verification will reject the change.
