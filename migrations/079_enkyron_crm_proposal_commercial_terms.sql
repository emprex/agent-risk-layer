-- 079: MANUAL commercial terms for each proposal revision (not issued or legally approved).
-- Additive, no changes to proposal pricing, buyer links, VAT decisions or historic documents.
CREATE TABLE enkyron_crm_proposal_commercial_terms (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_revision INTEGER NOT NULL CHECK(proposal_revision>=1),
  valid_until DATE NOT NULL,
  payment_terms TEXT NOT NULL CHECK(length(btrim(payment_terms)) BETWEEN 15 AND 1000),
  delivery_terms TEXT NOT NULL CHECK(length(btrim(delivery_terms)) BETWEEN 15 AND 1000),
  exclusions TEXT NOT NULL CHECK(length(btrim(exclusions)) BETWEEN 15 AND 2000),
  assumptions TEXT NOT NULL CHECK(length(btrim(assumptions)) BETWEEN 15 AND 2000),
  source_reference TEXT NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 3 AND 500),
  review_status TEXT NOT NULL DEFAULT 'operator_draft_unapproved'
    CHECK(review_status='operator_draft_unapproved'),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_commercial_terms_proposal_scope
    FOREIGN KEY(workspace_key,proposal_id)
    REFERENCES enkyron_crm_proposal_drafts(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_commercial_terms_revision_unique
    UNIQUE(workspace_key,proposal_id,proposal_revision)
);
CREATE INDEX idx_enkyron_commercial_terms_history
  ON enkyron_crm_proposal_commercial_terms(
    workspace_key,proposal_id,proposal_revision DESC
  );
CREATE TRIGGER enkyron_commercial_terms_immutable
  BEFORE UPDATE OR DELETE ON enkyron_crm_proposal_commercial_terms
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
