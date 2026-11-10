-- 083 ENKYRON manual pre-issue documentary review; NOT an invoice issuance workflow.
-- All records append-only. Old proposal/invoice/billing data never mutated.
CREATE UNIQUE INDEX idx_enkyron_invoice_drafts_workspace_id
  ON enkyron_crm_invoice_drafts(workspace_key,id);
CREATE TABLE enkyron_crm_invoice_issue_reviews (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  invoice_draft_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('needs_changes','documents_logged')),
  supply_date DATE,
  customer_authorisation_reference TEXT CHECK(customer_authorisation_reference IS NULL
    OR length(btrim(customer_authorisation_reference)) BETWEEN 3 AND 500),
  tax_evidence_reference TEXT CHECK(tax_evidence_reference IS NULL
    OR length(btrim(tax_evidence_reference)) BETWEEN 3 AND 500),
  payment_terms_reference TEXT CHECK(payment_terms_reference IS NULL
    OR length(btrim(payment_terms_reference)) BETWEEN 3 AND 500),
  review_note TEXT NOT NULL CHECK(length(btrim(review_note)) BETWEEN 30 AND 2000),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_invoice_issue_review_draft_scope
    FOREIGN KEY(workspace_key,invoice_draft_id)
    REFERENCES enkyron_crm_invoice_drafts(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_invoice_review_complete_documentation
    CHECK(outcome='needs_changes' OR (
      supply_date IS NOT NULL AND customer_authorisation_reference IS NOT NULL
      AND tax_evidence_reference IS NOT NULL AND payment_terms_reference IS NOT NULL))
);
CREATE INDEX idx_enkyron_invoice_issue_reviews_history
  ON enkyron_crm_invoice_issue_reviews(workspace_key,invoice_draft_id,recorded_at DESC,id DESC);
CREATE TRIGGER enkyron_invoice_issue_reviews_immutable
  BEFORE UPDATE OR DELETE ON enkyron_crm_invoice_issue_reviews
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
