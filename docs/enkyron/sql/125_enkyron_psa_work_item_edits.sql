-- ENKYRON #621, schema 125: REVIEW ONLY. Do NOT automatically apply.
-- This is NOT stored under migrations/ and does not modify arl_local on pull.
-- Requires a verified backup, manual PostgreSQL schema inspection and
-- explicit operator approval in a later change window.
-- In-place extension: preserves all T01–T19 / T07 work IDs and append-only events.
-- Relaxes only the legacy version=1/2 constraints to allow audited revisions.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='15s';

DO $preflight$
BEGIN
  IF to_regclass('public.enkyron_psa_work_items') IS NULL OR
     to_regclass('public.enkyron_psa_work_item_events') IS NULL THEN
    RAISE EXCEPTION 'PSA #621 requires installed ENK-08 planning tables';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND ((table_name='enkyron_psa_work_items' AND column_name='description')
       OR (table_name='enkyron_psa_work_item_events'
           AND column_name IN ('before_state','after_state')))
  ) THEN
    RAISE EXCEPTION 'PSA #621 schema partially or already installed; review manually';
  END IF;
  -- These exact legacy check names are from reviewed schema 119. Any local
  -- divergence must be resolved by inspection; never silently drop other checks.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.enkyron_psa_work_items'::regclass
       AND conname='enkyron_psa_work_item_state_consistent'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.enkyron_psa_work_item_events'::regclass
       AND conname='enkyron_psa_work_item_events_check'
  ) THEN
    RAISE EXCEPTION 'PSA #621 legacy check names differ; inspect first';
  END IF;
END
$preflight$;

ALTER TABLE public.enkyron_psa_work_items
  ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE public.enkyron_psa_work_items
  ADD CONSTRAINT enkyron_psa_work_item_description_bounded
  CHECK (char_length(description) <= 2000);
ALTER TABLE public.enkyron_psa_work_items
  DROP CONSTRAINT enkyron_psa_work_item_state_consistent;
ALTER TABLE public.enkyron_psa_work_items
  ADD CONSTRAINT enkyron_psa_work_item_state_consistent CHECK (
    (status='open' AND version >= 1 AND completed_by IS NULL AND completed_at IS NULL)
    OR (status='completed' AND version >= 2
        AND completed_by IS NOT NULL AND completed_at IS NOT NULL)
  );

ALTER TABLE public.enkyron_psa_work_item_events
  ADD COLUMN before_state JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.enkyron_psa_work_item_events
  ADD COLUMN after_state JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.enkyron_psa_work_item_events
  DROP CONSTRAINT enkyron_psa_work_item_events_version_check;
ALTER TABLE public.enkyron_psa_work_item_events
  DROP CONSTRAINT enkyron_psa_work_item_events_event_type_check;
ALTER TABLE public.enkyron_psa_work_item_events
  DROP CONSTRAINT enkyron_psa_work_item_events_check;
ALTER TABLE public.enkyron_psa_work_item_events
  ADD CONSTRAINT enkyron_psa_work_item_events_version_check CHECK (version >= 1),
  ADD CONSTRAINT enkyron_psa_work_item_events_event_type_check
    CHECK (event_type IN ('created','updated','completed')),
  ADD CONSTRAINT enkyron_psa_work_item_events_state_check
    CHECK ((event_type='created' AND version=1)
       OR (event_type='updated' AND version>=2)
       OR (event_type='completed' AND version>=2));

-- No old rows are deleted, rewritten with a new ID, or promoted to approved.
-- The original immutable BEFORE UPDATE/DELETE event trigger remains untouched.
COMMIT;
