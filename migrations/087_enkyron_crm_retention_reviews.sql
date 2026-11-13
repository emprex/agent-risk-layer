-- 087: Append-only contact retention-review metadata. No data lifecycle action.
-- Records an operator's assessment, NOT a legally approved retention period or hold.
CREATE TABLE enkyron_crm_retention_reviews (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  company_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  purpose_code TEXT NOT NULL CHECK(purpose_code IN (
    'prospect_research','service_delivery','support','compliance_records','other')),
  hold_check TEXT NOT NULL CHECK(hold_check IN (
    'not_assessed','potential_hold','none_identified')),
  next_review_on DATE NOT NULL,
  review_note TEXT NOT NULL CHECK(length(btrim(review_note)) BETWEEN 30 AND 500),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_key,company_id,contact_id)
    REFERENCES enkyron_crm_contacts(workspace_key,company_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_retention_reviews_contact
  ON enkyron_crm_retention_reviews(workspace_key,company_id,contact_id,recorded_at DESC,id DESC);
CREATE TRIGGER enkyron_crm_retention_reviews_immutable
 BEFORE UPDATE OR DELETE ON enkyron_crm_retention_reviews
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
