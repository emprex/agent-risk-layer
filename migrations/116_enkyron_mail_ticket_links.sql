-- 116: Explicit, immutable local Mail <-> existing ticket associations.
-- REVIEW ONLY: do not apply to arl_local without separate owner approval,
-- guarded schema preflight, verified backup and disposable DB rehearsal.
-- Never infer client/contact identity from sender or domain.
CREATE TABLE enkyron_mail_ticket_links (
  workspace_key TEXT NOT NULL CHECK(workspace_key ~ '^local:[A-Za-z0-9_.-]{1,80}$'),
  mailbox_key TEXT NOT NULL CHECK(mailbox_key IN ('direction','support')),
  thread_id UUID NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES arl_workbench_tickets(id) ON DELETE RESTRICT,
  ticket_number_at_review TEXT NOT NULL CHECK(char_length(ticket_number_at_review) BETWEEN 3 AND 80),
  client_name_at_review TEXT NOT NULL CHECK(char_length(client_name_at_review) BETWEEN 1 AND 300),
  review_note TEXT NOT NULL CHECK(char_length(btrim(review_note)) BETWEEN 30 AND 1000),
  linked_by TEXT NOT NULL CHECK(char_length(linked_by) BETWEEN 1 AND 80),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(workspace_key,mailbox_key,thread_id,ticket_id),
  FOREIGN KEY(workspace_key,mailbox_key,thread_id)
    REFERENCES enkyron_mail_local_threads(workspace_key,mailbox_key,thread_id)
    ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_mail_ticket_by_ticket
  ON enkyron_mail_ticket_links(workspace_key,ticket_id,linked_at DESC);
CREATE TRIGGER enkyron_mail_ticket_links_immutable
  BEFORE UPDATE OR DELETE ON enkyron_mail_ticket_links
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
