ALTER TABLE purchases ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES security_projects(id) ON DELETE SET NULL;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS expected_amount_pence INTEGER;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS expected_currency TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS checkout_mode TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS expected_customer_email TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS binding_state TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS binding_expires_at TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS checkout_created_at TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS binding_verified_at TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS quarantined_at TEXT;

UPDATE purchases
SET binding_state = CASE
  WHEN fulfilment_state='fulfilled' AND access_granted_at IS NOT NULL THEN 'legacy_fulfilled'
  ELSE 'legacy_review_required'
END
WHERE binding_state IS NULL;

ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS processing_started_at TEXT;
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS completed_at TEXT;
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS created_at TEXT;
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS processing_result TEXT;
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS ignored_reason TEXT;
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS recovery_actor_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS recovery_reason TEXT;
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS recovered_at TEXT;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS purchase_id TEXT REFERENCES purchases(id) ON DELETE SET NULL;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_start TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS canceled_at TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS authoritative_state BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_state_source TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS latest_stripe_event_created BIGINT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS latest_stripe_event_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS latest_stripe_event_type TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS latest_stripe_event_state TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS reconciliation_started_at TEXT;

UPDATE subscriptions
SET authoritative_state=FALSE,
    reconciliation_required=FALSE,
    reconciliation_started_at=NULL,
    latest_stripe_event_created=NULL,
    latest_stripe_event_id=NULL,
    latest_stripe_event_type=NULL,
    latest_stripe_event_state=NULL,
    billing_state_source='legacy_reconciliation_required'
WHERE billing_state_source IS NULL
   OR billing_state_source NOT IN
      ('pending_checkout','legacy_reconciliation_required','reconciliation_required','stripe_event','stripe_retrieval');

ALTER TABLE subscriptions ALTER COLUMN billing_state_source SET NOT NULL;

UPDATE stripe_events
SET completed_at=COALESCE(completed_at,processed_at),
    created_at=COALESCE(created_at,processed_at),
    attempt_count=CASE WHEN attempt_count<1 THEN 1 ELSE attempt_count END
WHERE status='processed';

UPDATE stripe_events
SET processing_started_at=COALESCE(processing_started_at,processed_at),
    completed_at=NULL
WHERE status='processing';

UPDATE stripe_events
SET processing_started_at=NULL,
    completed_at=NULL
WHERE status IN ('received','failed');

CREATE TABLE IF NOT EXISTS stripe_event_recoveries (
  id TEXT PRIMARY KEY,
  stripe_event_id TEXT NOT NULL REFERENCES stripe_events(id) ON DELETE RESTRICT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  prior_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  recovered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stripe_subscription_conflicts (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  stripe_created BIGINT NOT NULL,
  prior_event_id TEXT NOT NULL,
  prior_event_type TEXT NOT NULL,
  conflicting_event_id TEXT NOT NULL,
  conflicting_event_type TEXT NOT NULL,
  prior_state TEXT NOT NULL,
  conflicting_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolving_event_id TEXT,
  UNIQUE(subscription_id,prior_event_id,conflicting_event_id),
  CHECK (prior_event_id <> conflicting_event_id),
  CHECK ((resolved_at IS NULL AND resolving_event_id IS NULL) OR
    (resolved_at IS NOT NULL AND resolving_event_id IS NOT NULL))
);

ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_billing_binding_state_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_billing_binding_state_check CHECK (
  binding_state IS NULL OR binding_state IN
    ('legacy_fulfilled','legacy_review_required','pending_creation','pending','verified','quarantined','creation_failed')
) NOT VALID;
ALTER TABLE purchases VALIDATE CONSTRAINT purchases_billing_binding_state_check;

ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_billing_amount_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_billing_amount_check CHECK (
  amount_pence >= 0 AND (expected_amount_pence IS NULL OR expected_amount_pence >= 0)
) NOT VALID;
ALTER TABLE purchases VALIDATE CONSTRAINT purchases_billing_amount_check;

ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_billing_currency_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_billing_currency_check CHECK (
  binding_state IN ('legacy_fulfilled','legacy_review_required') OR
  (currency ~ '^[a-z]{3}$' AND (expected_currency IS NULL OR expected_currency ~ '^[a-z]{3}$'))
) NOT VALID;
ALTER TABLE purchases VALIDATE CONSTRAINT purchases_billing_currency_check;

ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_billing_mode_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_billing_mode_check CHECK (
  checkout_mode IS NULL OR checkout_mode IN ('payment','subscription')
) NOT VALID;
ALTER TABLE purchases VALIDATE CONSTRAINT purchases_billing_mode_check;

ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_billing_timestamps_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_billing_timestamps_check CHECK (
  binding_state IN ('legacy_fulfilled','legacy_review_required') OR
  (binding_state='pending_creation' AND checkout_created_at IS NOT NULL AND binding_expires_at IS NOT NULL AND stripe_session_id IS NULL) OR
  (binding_state='pending' AND checkout_created_at IS NOT NULL AND binding_expires_at IS NOT NULL AND stripe_session_id IS NOT NULL) OR
  (binding_state='verified' AND binding_verified_at IS NOT NULL AND stripe_session_id IS NOT NULL) OR
  (binding_state='quarantined' AND quarantined_at IS NOT NULL) OR
  binding_state='creation_failed' OR binding_state IS NULL
) NOT VALID;
ALTER TABLE purchases VALIDATE CONSTRAINT purchases_billing_timestamps_check;

ALTER TABLE stripe_events DROP CONSTRAINT IF EXISTS stripe_events_billing_state_check;
ALTER TABLE stripe_events ADD CONSTRAINT stripe_events_billing_state_check CHECK (
  status IN ('received','processing','failed','processed')
) NOT VALID;
ALTER TABLE stripe_events VALIDATE CONSTRAINT stripe_events_billing_state_check;

ALTER TABLE stripe_events DROP CONSTRAINT IF EXISTS stripe_events_billing_timestamps_check;
ALTER TABLE stripe_events ADD CONSTRAINT stripe_events_billing_timestamps_check CHECK (
  (status='received' AND processing_started_at IS NULL AND completed_at IS NULL) OR
  (status='processing' AND processing_started_at IS NOT NULL AND completed_at IS NULL) OR
  (status='failed' AND processing_started_at IS NULL AND completed_at IS NULL) OR
  (status='processed' AND processing_started_at IS NULL AND completed_at IS NOT NULL)
) NOT VALID;
ALTER TABLE stripe_events VALIDATE CONSTRAINT stripe_events_billing_timestamps_check;

ALTER TABLE stripe_events DROP CONSTRAINT IF EXISTS stripe_events_billing_recovery_check;
ALTER TABLE stripe_events ADD CONSTRAINT stripe_events_billing_recovery_check CHECK (
  (recovery_actor_id IS NULL AND recovery_reason IS NULL AND recovered_at IS NULL) OR
  (recovery_actor_id IS NOT NULL AND recovery_reason IS NOT NULL AND recovered_at IS NOT NULL)
) NOT VALID;
ALTER TABLE stripe_events VALIDATE CONSTRAINT stripe_events_billing_recovery_check;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_billing_ordering_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_billing_ordering_check CHECK (
  (latest_stripe_event_created IS NULL AND latest_stripe_event_id IS NULL AND latest_stripe_event_type IS NULL AND latest_stripe_event_state IS NULL) OR
  (latest_stripe_event_created IS NOT NULL AND latest_stripe_event_id IS NOT NULL AND latest_stripe_event_type IS NOT NULL AND latest_stripe_event_state IS NOT NULL)
) NOT VALID;
ALTER TABLE subscriptions VALIDATE CONSTRAINT subscriptions_billing_ordering_check;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_billing_authority_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_billing_authority_check CHECK (
  billing_state_source IS NOT NULL AND (
  (
    billing_state_source='pending_checkout'
    AND authoritative_state=FALSE
    AND status='pending'
    AND current_period_start IS NULL AND current_period_end IS NULL
    AND cancel_at_period_end=FALSE AND canceled_at IS NULL
    AND latest_stripe_event_created IS NULL AND latest_stripe_event_id IS NULL
    AND latest_stripe_event_type IS NULL AND latest_stripe_event_state IS NULL
    AND reconciliation_required=FALSE AND reconciliation_started_at IS NULL
  ) OR (
    billing_state_source='legacy_reconciliation_required'
    AND authoritative_state=FALSE
    AND latest_stripe_event_created IS NULL AND latest_stripe_event_id IS NULL
    AND latest_stripe_event_type IS NULL AND latest_stripe_event_state IS NULL
    AND reconciliation_required=FALSE AND reconciliation_started_at IS NULL
  ) OR (
    billing_state_source='reconciliation_required'
    AND authoritative_state=FALSE
    AND status IN ('active','trialing','canceled','cancelled','past_due','unpaid','incomplete','incomplete_expired','paused')
    AND current_period_start IS NOT NULL AND current_period_end IS NOT NULL
    AND latest_stripe_event_created IS NOT NULL AND latest_stripe_event_id IS NOT NULL
    AND latest_stripe_event_type IS NOT NULL AND latest_stripe_event_state IS NOT NULL
    AND reconciliation_required=TRUE AND reconciliation_started_at IS NOT NULL
  ) OR (
    billing_state_source IN ('stripe_event','stripe_retrieval')
    AND authoritative_state=TRUE
    AND status IN ('active','trialing','canceled','cancelled','past_due','unpaid','incomplete','incomplete_expired','paused')
    AND current_period_start IS NOT NULL AND current_period_end IS NOT NULL
    AND latest_stripe_event_created IS NOT NULL AND latest_stripe_event_id IS NOT NULL
    AND latest_stripe_event_type IS NOT NULL AND latest_stripe_event_state IS NOT NULL
    AND reconciliation_required=FALSE AND reconciliation_started_at IS NULL
  ))
) NOT VALID;
ALTER TABLE subscriptions VALIDATE CONSTRAINT subscriptions_billing_authority_check;

CREATE INDEX IF NOT EXISTS idx_purchases_binding
  ON purchases(binding_state,binding_expires_at,updated_at);
CREATE INDEX IF NOT EXISTS idx_stripe_events_processing
  ON stripe_events(status,processing_started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_purchase
  ON subscriptions(purchase_id) WHERE purchase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_order
  ON subscriptions(stripe_subscription_id,latest_stripe_event_created,latest_stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_stripe_event_recoveries_event
  ON stripe_event_recoveries(stripe_event_id,recovered_at);
CREATE INDEX IF NOT EXISTS idx_stripe_subscription_conflicts_open
  ON stripe_subscription_conflicts(subscription_id,stripe_created) WHERE resolved_at IS NULL;
