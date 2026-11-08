-- E07-03B2A: metadata received from an asserted external reviewer.
-- Recorded-by operator and reviewer identity are NOT independently authenticated.
-- An external report receipt is NOT verified legal identity, determined VAT, quote approval or permission to test.
CREATE TABLE enkyron_crm_quote_external_reports (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_revision INTEGER NOT NULL CHECK(proposal_revision >= 1),
  source_review_id TEXT NOT NULL,
  reported_reviewer_name TEXT NOT NULL
    CHECK(length(btrim(reported_reviewer_name)) BETWEEN 3 AND 160),
  reported_reviewer_organisation TEXT
    CHECK(reported_reviewer_organisation IS NULL
      OR length(btrim(reported_reviewer_organisation)) BETWEEN 3 AND 160),
  report_reference TEXT NOT NULL
    CHECK(length(btrim(report_reference)) BETWEEN 3 AND 500),
  report_date DATE NOT NULL,
  issuer_coverage TEXT NOT NULL
    CHECK(issuer_coverage IN ('not_addressed','issues_reported','covered_in_report')),
  buyer_coverage TEXT NOT NULL
    CHECK(buyer_coverage IN ('not_addressed','issues_reported','covered_in_report')),
  tax_coverage TEXT NOT NULL
    CHECK(tax_coverage IN ('not_addressed','issues_reported','covered_in_report')),
  report_outcome TEXT NOT NULL
    CHECK(report_outcome IN ('requires_changes','report_received')),
  review_note TEXT NOT NULL
    CHECK(length(btrim(review_note)) BETWEEN 30 AND 2000),
  entered_by TEXT NOT NULL,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enkyron_external_report_proposal_fk
    FOREIGN KEY(workspace_key,proposal_id)
    REFERENCES enkyron_crm_proposal_drafts(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_external_report_source_fk
    FOREIGN KEY(workspace_key,proposal_id,proposal_revision,source_review_id)
    REFERENCES enkyron_crm_quote_evidence_reviews
      (workspace_key,proposal_id,proposal_revision,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_external_report_once_per_source
    UNIQUE(workspace_key,proposal_id,proposal_revision,source_review_id)
);
CREATE INDEX enkyron_external_reports_history
  ON enkyron_crm_quote_external_reports
  (workspace_key,proposal_id,proposal_revision DESC,entered_at DESC,id DESC);
CREATE TRIGGER enkyron_external_reports_immutable
  BEFORE UPDATE OR DELETE ON enkyron_crm_quote_external_reports
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
