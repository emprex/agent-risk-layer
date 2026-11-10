-- 086: append-only local CRM privacy request intake. No automatic erasure/export.
-- Received date and category only: identity, legal basis and deadlines require review.
CREATE TABLE enkyron_crm_privacy_requests (
 id TEXT PRIMARY KEY,
 workspace_key TEXT NOT NULL,
 company_id TEXT NOT NULL,
 contact_id TEXT NOT NULL,
 request_kind TEXT NOT NULL CHECK(request_kind IN
  ('access','rectification','erasure','restriction','objection','portability')),
 source_channel TEXT NOT NULL CHECK(source_channel IN
  ('email','phone','post','in_person','other')),
 received_on DATE NOT NULL,
 processing_state TEXT NOT NULL DEFAULT 'pending_human_review'
  CHECK(processing_state='pending_human_review'),
 recorded_by TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_key,company_id,contact_id)
  REFERENCES enkyron_crm_contacts(workspace_key,company_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_privacy_requests
 ON enkyron_crm_privacy_requests(workspace_key,company_id,contact_id,recorded_at DESC);
CREATE TRIGGER enkyron_crm_privacy_no_modify
 BEFORE UPDATE OR DELETE ON enkyron_crm_privacy_requests
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
