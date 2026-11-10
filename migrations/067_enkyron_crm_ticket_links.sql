-- 067: ENKYRON local CRM company <-> Client Desk ticket associations.
-- Additive: never mutate historical arl_workbench_tickets or infer identity from client_name.
-- One ticket -> one company per local workspace; one company -> many tickets.
-- Source ticket remains the authoritative Client Desk record.
CREATE TABLE enkyron_crm_ticket_links (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  company_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES arl_workbench_tickets(id) ON DELETE RESTRICT,
  ticket_client_name_at_review TEXT NOT NULL,
  review_note TEXT NOT NULL CHECK (length(btrim(review_note)) BETWEEN 20 AND 1000),
  linked_by TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_crm_ticket_once UNIQUE (workspace_key,ticket_id),
  CONSTRAINT enkyron_crm_ticket_company_scope FOREIGN KEY (workspace_key,company_id)
    REFERENCES enkyron_crm_companies(workspace_key,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_ticket_company
  ON enkyron_crm_ticket_links(workspace_key,company_id,linked_at DESC);

-- Append-only association and rationale; corrections need a separate audited flow.
CREATE TRIGGER enkyron_crm_ticket_links_no_modify
  BEFORE UPDATE OR DELETE ON enkyron_crm_ticket_links
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
