-- 078: proposal buyer identity review; local operator, append-only and explicitly linked.
-- No modification of historical CRM, proposals, customer status or assessments.
CREATE TABLE enkyron_crm_proposal_buyer_reviews(
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_revision INTEGER NOT NULL CHECK(proposal_revision>=1),
  company_id TEXT NOT NULL,
  legal_name TEXT NOT NULL CHECK(length(btrim(legal_name)) BETWEEN 2 AND 160),
  registered_address TEXT NOT NULL CHECK(length(btrim(registered_address)) BETWEEN 10 AND 600),
  source_reference TEXT NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 3 AND 500),
  review_note TEXT NOT NULL CHECK(length(btrim(review_note)) BETWEEN 30 AND 2000),
  review_status TEXT NOT NULL DEFAULT 'operator_documented_unverified'
    CHECK(review_status='operator_documented_unverified'),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_buyer_review_proposal_scope
    FOREIGN KEY(workspace_key,proposal_id)
    REFERENCES enkyron_crm_proposal_drafts(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_buyer_review_company_scope
    FOREIGN KEY(workspace_key,company_id)
    REFERENCES enkyron_crm_companies(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_buyer_review_once_per_revision
    UNIQUE(workspace_key,proposal_id,proposal_revision)
);
CREATE INDEX idx_enkyron_buyer_review_history
  ON enkyron_crm_proposal_buyer_reviews(workspace_key,proposal_id,recorded_at DESC,id DESC);
CREATE TRIGGER enkyron_buyer_review_immutable
  BEFORE UPDATE OR DELETE ON enkyron_crm_proposal_buyer_reviews
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
