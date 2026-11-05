-- 064: ENKYRON Client Desk assignment and non-destructive archival.
-- Existing tickets remain visible and unassigned; historical rows are preserved.
ALTER TABLE arl_workbench_tickets
  ADD COLUMN IF NOT EXISTS assigned_to TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by TEXT,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- The old event table remains authoritative. Extend the existing enum-like
-- CHECK, without rewriting or deleting recorded event rows.
ALTER TABLE arl_workbench_ticket_events
  DROP CONSTRAINT IF EXISTS arl_workbench_ticket_events_event_type_check;

ALTER TABLE arl_workbench_ticket_events
  ADD CONSTRAINT arl_workbench_ticket_events_event_type_check
  CHECK (event_type IN (
    'created','status_changed','note_added',
    'assigned','unassigned','archived'
  ));

CREATE INDEX IF NOT EXISTS idx_arl_ticket_unarchived
  ON arl_workbench_tickets (updated_at DESC,id DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_arl_ticket_owner
  ON arl_workbench_tickets (assigned_to,updated_at DESC)
  WHERE archived_at IS NULL;
