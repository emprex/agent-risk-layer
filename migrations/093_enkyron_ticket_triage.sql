-- 093 E03-01/02: human-entered, append-only ticket triage records.
-- No automatic risk assessment, SLA, customer authorisation or contract creation.
-- The existing ticket and its historical notes/events are never rewritten.
CREATE TABLE enkyron_ticket_triage_reviews (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES arl_workbench_tickets(id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK (request_type IN (
    'commercial_question','assessment_request','security_incident',
    'support_request','change_request','consultation'
  )),
  impact TEXT NOT NULL CHECK (impact IN ('low','medium','high')),
  urgency TEXT NOT NULL CHECK (urgency IN ('low','medium','high')),
  priority TEXT NOT NULL CHECK (priority IN ('low','normal','high','critical')),
  review_note TEXT NOT NULL CHECK (length(btrim(review_note)) BETWEEN 30 AND 500),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_enkyron_ticket_triage_history
  ON enkyron_ticket_triage_reviews(ticket_id,recorded_at DESC,id DESC);
CREATE TRIGGER enkyron_ticket_triage_reviews_immutable
  BEFORE UPDATE OR DELETE ON enkyron_ticket_triage_reviews
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
