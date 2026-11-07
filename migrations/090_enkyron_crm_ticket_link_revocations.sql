-- E02-05R: append-only revocation of erroneous human-reviewed company-ticket link.
-- Source ticket, original link, contact links and historical decisions remain untouched.
-- A revoked ticket cannot be relinked until a separate audited reassignment flow exists.
CREATE TABLE enkyron_crm_ticket_link_revocations (
 id TEXT PRIMARY KEY,
 workspace_key TEXT NOT NULL,
 link_id TEXT NOT NULL,
 company_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 ticket_client_name_at_review TEXT NOT NULL,
 review_note TEXT NOT NULL CHECK(length(btrim(review_note)) BETWEEN 30 AND 1000),
 revoked_by TEXT NOT NULL,
 revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT enkyron_crm_ticket_revocation_once UNIQUE(workspace_key,ticket_id),
 CONSTRAINT enkyron_crm_ticket_revocation_link_once UNIQUE(workspace_key,link_id),
 FOREIGN KEY(workspace_key,company_id,ticket_id)
  REFERENCES enkyron_crm_ticket_links(workspace_key,company_id,ticket_id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_ticket_revocations_company
 ON enkyron_crm_ticket_link_revocations(workspace_key,company_id,revoked_at DESC);
CREATE TRIGGER enkyron_crm_ticket_link_revocations_immutable
 BEFORE UPDATE OR DELETE ON enkyron_crm_ticket_link_revocations
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
ALTER TABLE enkyron_crm_events DROP CONSTRAINT enkyron_crm_events_event_type_check;
ALTER TABLE enkyron_crm_events ADD CONSTRAINT enkyron_crm_events_event_type_check
 CHECK(event_type IN ('created','linked','updated','corrected'));
