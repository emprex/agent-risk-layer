-- E02-05S: one reviewed reassignment AFTER a recorded revocation.
-- No rewrite of original company link, ticket, contact, or audit evidence.
-- A second reassignment needs a separate future reviewed correction model.
ALTER TABLE enkyron_crm_ticket_link_revocations
 ADD CONSTRAINT enkyron_crm_revocation_lineage
 UNIQUE (workspace_key,ticket_id,id);
CREATE TABLE enkyron_crm_ticket_reassignments (
 id TEXT PRIMARY KEY,
 workspace_key TEXT NOT NULL,
 ticket_id TEXT NOT NULL REFERENCES arl_workbench_tickets(id) ON DELETE RESTRICT,
 revocation_id TEXT NOT NULL,
 source_company_id TEXT NOT NULL,
 destination_company_id TEXT NOT NULL,
 ticket_client_name_at_review TEXT NOT NULL,
 destination_version_at_review INTEGER NOT NULL CHECK(destination_version_at_review>=1),
 review_note TEXT NOT NULL CHECK(length(btrim(review_note)) BETWEEN 30 AND 1000),
 assigned_by TEXT NOT NULL,
 assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT enkyron_crm_reassignment_once UNIQUE(workspace_key,ticket_id),
 CONSTRAINT enkyron_crm_reassignment_target UNIQUE(workspace_key,destination_company_id,ticket_id),
 CONSTRAINT enkyron_crm_reassignment_distinct CHECK(source_company_id<>destination_company_id),
 CONSTRAINT enkyron_crm_reassignment_prior_revocation FOREIGN KEY(workspace_key,ticket_id,revocation_id)
  REFERENCES enkyron_crm_ticket_link_revocations(workspace_key,ticket_id,id) ON DELETE RESTRICT,
 CONSTRAINT enkyron_crm_reassignment_source FOREIGN KEY(workspace_key,source_company_id,ticket_id)
  REFERENCES enkyron_crm_ticket_links(workspace_key,company_id,ticket_id) ON DELETE RESTRICT,
 CONSTRAINT enkyron_crm_reassignment_company FOREIGN KEY(workspace_key,destination_company_id)
  REFERENCES enkyron_crm_companies(workspace_key,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_reassignment_company
 ON enkyron_crm_ticket_reassignments(workspace_key,destination_company_id,assigned_at DESC);

-- New contact assertions attach to the actual reassignment, never the old company.
CREATE TABLE enkyron_crm_reassigned_contact_ticket_links (
 id TEXT PRIMARY KEY,
 workspace_key TEXT NOT NULL,
 destination_company_id TEXT NOT NULL,
 contact_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 review_note TEXT NOT NULL CHECK(length(btrim(review_note)) BETWEEN 20 AND 1000),
 linked_by TEXT NOT NULL,
 linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT enkyron_crm_reassigned_contact_once UNIQUE(workspace_key,contact_id,ticket_id),
 CONSTRAINT enkyron_crm_reassigned_contact_scope FOREIGN KEY(workspace_key,destination_company_id,contact_id)
  REFERENCES enkyron_crm_contacts(workspace_key,company_id,id) ON DELETE RESTRICT,
 CONSTRAINT enkyron_crm_reassigned_contact_association FOREIGN KEY(workspace_key,destination_company_id,ticket_id)
  REFERENCES enkyron_crm_ticket_reassignments(workspace_key,destination_company_id,ticket_id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_reassigned_contact_history
 ON enkyron_crm_reassigned_contact_ticket_links(workspace_key,contact_id,linked_at DESC);
CREATE TRIGGER enkyron_crm_reassignments_immutable
 BEFORE UPDATE OR DELETE ON enkyron_crm_ticket_reassignments
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
CREATE TRIGGER enkyron_crm_reassigned_contact_immutable
 BEFORE UPDATE OR DELETE ON enkyron_crm_reassigned_contact_ticket_links
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();

-- Canonical current company association, distinct from immutable lineage.
CREATE VIEW enkyron_crm_effective_ticket_links AS
 SELECT l.workspace_key,l.company_id,l.ticket_id,l.linked_by,l.linked_at,l.review_note
 FROM enkyron_crm_ticket_links l
 WHERE NOT EXISTS (
  SELECT 1 FROM enkyron_crm_ticket_link_revocations rv
  WHERE rv.workspace_key=l.workspace_key AND rv.ticket_id=l.ticket_id)
 UNION ALL
 SELECT ra.workspace_key,ra.destination_company_id AS company_id,ra.ticket_id,
  ra.assigned_by AS linked_by,ra.assigned_at AS linked_at,ra.review_note
 FROM enkyron_crm_ticket_reassignments ra;
