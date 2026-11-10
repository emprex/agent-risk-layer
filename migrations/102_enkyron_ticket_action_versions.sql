-- 102 / E03-04A: operator-authored ticket action checklist, immutable revisions.
-- Neither a task nor its completion grants assessment, commercial or testing authority.
-- Existing ticket, note and event rows are untouched.
CREATE TABLE enkyron_ticket_action_versions (
  event_id UUID PRIMARY KEY,
  action_id UUID NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES arl_workbench_tickets(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 5 AND 160),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 1500),
  due_on DATE,
  state TEXT NOT NULL CHECK (state IN ('todo','blocked','done')),
  rationale TEXT NOT NULL CHECK (length(btrim(rationale)) BETWEEN 10 AND 500),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(action_id, revision)
);
CREATE INDEX enkyron_ticket_action_versions_ticket_recent
  ON enkyron_ticket_action_versions(ticket_id, action_id, revision DESC);
CREATE TRIGGER enkyron_ticket_action_versions_immutable
  BEFORE UPDATE OR DELETE ON enkyron_ticket_action_versions
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
