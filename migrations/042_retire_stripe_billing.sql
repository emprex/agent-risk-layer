-- Retire the former self-service Stripe/billing data model.
-- Historical migrations remain immutable so existing databases can advance safely.
DROP TABLE IF EXISTS fulfilment_jobs CASCADE;
DROP TABLE IF EXISTS stripe_event_recoveries CASCADE;
DROP TABLE IF EXISTS stripe_subscription_conflicts CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS stripe_events CASCADE;
DROP TABLE IF EXISTS purchases CASCADE;
