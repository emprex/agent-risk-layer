-- 082: Invoice DRAFT REGISTER only. Nothing in this table is issued or payable.
-- Immutable local-operator-scoped snapshots of source billing worksheet / evidence.
-- VAT treatment, VAT amount, invoice total and invoice number intentionally absent/NULL.
CREATE TABLE enkyron_crm_invoice_drafts (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  source_worksheet_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_revision INTEGER NOT NULL CHECK (proposal_revision >= 1),
  source_approval_id TEXT NOT NULL,
  issuer_profile_id TEXT NOT NULL,
  buyer_review_id TEXT NOT NULL,
  terms_id TEXT NOT NULL,
  tax_review_id TEXT NOT NULL,
  issuer_legal_name TEXT NOT NULL CHECK(length(btrim(issuer_legal_name)) BETWEEN 2 AND 160),
  issuer_registration_number TEXT,
  issuer_registered_office TEXT NOT NULL CHECK(length(btrim(issuer_registered_office)) BETWEEN 10 AND 600),
  buyer_legal_name TEXT NOT NULL CHECK(length(btrim(buyer_legal_name)) BETWEEN 2 AND 160),
  buyer_registered_address TEXT NOT NULL CHECK(length(btrim(buyer_registered_address)) BETWEEN 10 AND 600),
  service_description TEXT NOT NULL CHECK(length(btrim(service_description)) BETWEEN 5 AND 160),
  currency CHAR(3) NOT NULL CHECK(currency IN ('GBP','EUR','USD')),
  proposed_fee_minor BIGINT NOT NULL CHECK(proposed_fee_minor BETWEEN 1 AND 999999999),
  vat_treatment TEXT NOT NULL DEFAULT 'undetermined'
    CHECK(vat_treatment='undetermined'),
  vat_amount_minor BIGINT CHECK(vat_amount_minor IS NULL),
  invoice_total_minor BIGINT CHECK(invoice_total_minor IS NULL),
  invoice_number TEXT CHECK(invoice_number IS NULL),
  issued_at TIMESTAMPTZ CHECK(issued_at IS NULL),
  preparation_note TEXT NOT NULL CHECK(length(btrim(preparation_note)) BETWEEN 30 AND 1500),
  status TEXT NOT NULL DEFAULT 'unissued_tax_review_required'
    CHECK(status='unissued_tax_review_required'),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_invoice_draft_worksheet_unique UNIQUE(workspace_key,source_worksheet_id),
  CONSTRAINT enkyron_invoice_draft_source_worksheet
    FOREIGN KEY(source_worksheet_id)
    REFERENCES enkyron_crm_billing_worksheets(id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_invoice_draft_proposal
    FOREIGN KEY(workspace_key,proposal_id)
    REFERENCES enkyron_crm_proposal_drafts(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_invoice_draft_issuer
    FOREIGN KEY(issuer_profile_id)
    REFERENCES enkyron_operator_company_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_invoice_draft_buyer
    FOREIGN KEY(buyer_review_id)
    REFERENCES enkyron_crm_proposal_buyer_reviews(id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_invoice_drafts_list
  ON enkyron_crm_invoice_drafts(workspace_key,recorded_at DESC,id DESC);
CREATE TRIGGER enkyron_invoice_draft_immutable
  BEFORE UPDATE OR DELETE ON enkyron_crm_invoice_drafts
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
