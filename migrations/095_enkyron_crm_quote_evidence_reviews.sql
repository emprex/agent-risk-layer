-- E07-03B1: operator evidence references for independent quote release review.
-- NEVER a verified identity, tax determination, quote approval or issue permission.
-- Append-only lineage for an exact proposal revision, with one first record and
-- at most one successor per predecessor, including under concurrency.
CREATE TABLE enkyron_crm_quote_evidence_reviews (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_revision INTEGER NOT NULL CHECK(proposal_revision>=1),
  previous_review_id TEXT,
  review_state TEXT NOT NULL CHECK(review_state IN
    ('needs_changes','submitted_for_independent_review')),
  issuer_source_reference TEXT CHECK(issuer_source_reference IS NULL
    OR length(btrim(issuer_source_reference)) BETWEEN 3 AND 500),
  buyer_source_reference TEXT CHECK(buyer_source_reference IS NULL
    OR length(btrim(buyer_source_reference)) BETWEEN 3 AND 500),
  tax_source_reference TEXT CHECK(tax_source_reference IS NULL
    OR length(btrim(tax_source_reference)) BETWEEN 3 AND 500),
  review_note TEXT NOT NULL CHECK(length(btrim(review_note)) BETWEEN 30 AND 2000),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_quote_evidence_proposal_scope
    FOREIGN KEY(workspace_key,proposal_id)
    REFERENCES enkyron_crm_proposal_drafts(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_quote_evidence_self_identity
    UNIQUE(workspace_key,proposal_id,proposal_revision,id),
  CONSTRAINT enkyron_quote_evidence_previous_scope
    FOREIGN KEY(workspace_key,proposal_id,proposal_revision,previous_review_id)
    REFERENCES enkyron_crm_quote_evidence_reviews
      (workspace_key,proposal_id,proposal_revision,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_quote_evidence_distinct
    CHECK(previous_review_id IS NULL OR previous_review_id<>id),
  CONSTRAINT enkyron_quote_evidence_submitted_refs
    CHECK(review_state='needs_changes' OR (
      issuer_source_reference IS NOT NULL AND
      buyer_source_reference IS NOT NULL AND
      tax_source_reference IS NOT NULL))
);
CREATE UNIQUE INDEX enkyron_quote_evidence_first_once
  ON enkyron_crm_quote_evidence_reviews(workspace_key,proposal_id,proposal_revision)
  WHERE previous_review_id IS NULL;
CREATE UNIQUE INDEX enkyron_quote_evidence_successor_once
  ON enkyron_crm_quote_evidence_reviews(workspace_key,proposal_id,proposal_revision,previous_review_id)
  WHERE previous_review_id IS NOT NULL;
CREATE INDEX enkyron_quote_evidence_history
  ON enkyron_crm_quote_evidence_reviews(workspace_key,proposal_id,
    proposal_revision DESC,recorded_at DESC,id DESC);
CREATE TRIGGER enkyron_quote_evidence_immutable
  BEFORE UPDATE OR DELETE ON enkyron_crm_quote_evidence_reviews
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
