-- 081: Non-issuing pre-billing worksheets, immutable and operator scoped.
-- No invoice number, issue date, VAT treatment, payment, journal entry or customer acceptance.
-- Priced snapshots require an internal content approval for the exact proposal revision.
CREATE TABLE enkyron_crm_billing_worksheets(
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_revision INTEGER NOT NULL CHECK(proposal_revision>=1),
  source_approval_id TEXT NOT NULL,
  issuer_profile_id TEXT NOT NULL,
  buyer_review_id TEXT NOT NULL,
  terms_id TEXT NOT NULL,
  tax_review_id TEXT NOT NULL,
  proposal_title TEXT NOT NULL CHECK(length(btrim(proposal_title)) BETWEEN 5 AND 160),
  currency CHAR(3) NOT NULL CHECK(currency IN ('GBP','EUR','USD')),
  proposed_fee_minor BIGINT NOT NULL CHECK(proposed_fee_minor BETWEEN 1 AND 999999999),
  preparation_note TEXT NOT NULL CHECK(length(btrim(preparation_note)) BETWEEN 30 AND 1500),
  status TEXT NOT NULL DEFAULT 'internal_prebilling_only'
    CHECK(status='internal_prebilling_only'),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_billing_worksheet_unique
    UNIQUE(workspace_key,proposal_id,proposal_revision),
  CONSTRAINT enkyron_billing_worksheet_proposal_fk
    FOREIGN KEY(workspace_key,proposal_id)
    REFERENCES enkyron_crm_proposal_drafts(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_billing_worksheet_internal_approval_fk
    FOREIGN KEY(source_approval_id)
    REFERENCES enkyron_crm_proposal_internal_decisions(id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_billing_worksheet_issuer_fk
    FOREIGN KEY(issuer_profile_id)
    REFERENCES enkyron_operator_company_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_billing_worksheet_buyer_fk
    FOREIGN KEY(buyer_review_id)
    REFERENCES enkyron_crm_proposal_buyer_reviews(id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_billing_worksheet_terms_fk
    FOREIGN KEY(terms_id)
    REFERENCES enkyron_crm_proposal_commercial_terms(id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_billing_worksheet_tax_fk
    FOREIGN KEY(tax_review_id)
    REFERENCES enkyron_crm_proposal_tax_reviews(id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_billing_worksheet_history
 ON enkyron_crm_billing_worksheets(workspace_key,proposal_id,proposal_revision DESC);
CREATE TRIGGER enkyron_billing_worksheet_immutable
 BEFORE UPDATE OR DELETE ON enkyron_crm_billing_worksheets
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
