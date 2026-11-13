-- 085: Human-reviewed contact-to-ticket association; local operator only.
-- Many contacts/ticket and many tickets/contact; never rewrite historical records.
ALTER TABLE enkyron_crm_contacts ADD CONSTRAINT enkyron_crm_contact_company_identity
  UNIQUE(workspace_key,company_id,id);
ALTER TABLE enkyron_crm_ticket_links ADD CONSTRAINT enkyron_crm_ticket_company_identity
  UNIQUE(workspace_key,company_id,ticket_id);
CREATE TABLE enkyron_crm_contact_ticket_links (
 id TEXT PRIMARY KEY,
 workspace_key TEXT NOT NULL,
 company_id TEXT NOT NULL,
 contact_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 review_note TEXT NOT NULL CHECK(length(btrim(review_note)) BETWEEN 20 AND 1000),
 linked_by TEXT NOT NULL,
 linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT enkyron_crm_contact_ticket_once UNIQUE(workspace_key,contact_id,ticket_id),
 FOREIGN KEY(workspace_key,company_id,contact_id)
   REFERENCES enkyron_crm_contacts(workspace_key,company_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_key,company_id,ticket_id)
   REFERENCES enkyron_crm_ticket_links(workspace_key,company_id,ticket_id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_contact_ticket_history
  ON enkyron_crm_contact_ticket_links(workspace_key,contact_id,linked_at DESC);
CREATE TRIGGER enkyron_crm_contact_ticket_no_modify
 BEFORE UPDATE OR DELETE ON enkyron_crm_contact_ticket_links
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
