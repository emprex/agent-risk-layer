-- 103 / E09-05+07: issued invoices and manually recorded payments.
-- Separate from the existing immutable unissued draft snapshots (082/083).
-- No invoice is issued when this migration is installed.
CREATE TABLE enkyron_crm_invoice_number_sequences (
  workspace_key TEXT NOT NULL,
  issue_year INTEGER NOT NULL CHECK(issue_year BETWEEN 2020 AND 2200),
  last_value INTEGER NOT NULL CHECK(last_value BETWEEN 1 AND 999999),
  PRIMARY KEY(workspace_key,issue_year)
);
CREATE TABLE enkyron_crm_issued_invoices (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  source_draft_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  issue_date DATE NOT NULL,
  supply_date DATE NOT NULL,
  due_date DATE NOT NULL CHECK(due_date>=issue_date),
  issuer_legal_name TEXT NOT NULL,
  issuer_registered_office TEXT NOT NULL,
  issuer_registration_number TEXT,
  issuer_company_email TEXT NOT NULL,
  issuer_vat_status TEXT NOT NULL CHECK(issuer_vat_status IN ('registered','not_registered')),
  issuer_vat_number TEXT,
  buyer_legal_name TEXT NOT NULL,
  buyer_registered_address TEXT NOT NULL,
  service_description TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_revision INTEGER NOT NULL CHECK(proposal_revision>=1),
  currency CHAR(3) NOT NULL CHECK(currency='GBP'),
  line_items JSONB NOT NULL CHECK(jsonb_typeof(line_items)='array' AND jsonb_array_length(line_items) BETWEEN 1 AND 25),
  subtotal_minor BIGINT NOT NULL CHECK(subtotal_minor BETWEEN 1 AND 999999999),
  vat_rate_percent INTEGER NOT NULL CHECK(vat_rate_percent IN (0,20)),
  vat_amount_minor BIGINT NOT NULL CHECK(vat_amount_minor>=0),
  total_minor BIGINT NOT NULL CHECK(total_minor=subtotal_minor+vat_amount_minor),
  customer_reference TEXT,
  payment_terms TEXT NOT NULL,
  issuance_basis TEXT NOT NULL CHECK(length(btrim(issuance_basis)) BETWEEN 10 AND 1000),
  issued_by TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_issued_invoice_draft_scope
    FOREIGN KEY(workspace_key,source_draft_id)
    REFERENCES enkyron_crm_invoice_drafts(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_issued_invoice_draft_unique UNIQUE(workspace_key,source_draft_id),
  CONSTRAINT enkyron_issued_invoice_number_unique UNIQUE(workspace_key,invoice_number),
  CONSTRAINT enkyron_issued_invoice_tax_consistency CHECK (
    (issuer_vat_status='not_registered' AND issuer_vat_number IS NULL
      AND vat_rate_percent=0 AND vat_amount_minor=0)
    OR
    (issuer_vat_status='registered' AND issuer_vat_number IS NOT NULL
      AND vat_rate_percent=20 AND vat_amount_minor=(subtotal_minor*20+50)/100)
  )
);
CREATE INDEX enkyron_issued_invoices_by_workspace
  ON enkyron_crm_issued_invoices(workspace_key,issued_at DESC,id DESC);
CREATE TRIGGER enkyron_issued_invoices_immutable
  BEFORE UPDATE OR DELETE ON enkyron_crm_issued_invoices
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();

CREATE TABLE enkyron_crm_invoice_payments (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK(amount_minor>0),
  paid_on DATE NOT NULL,
  payment_reference TEXT NOT NULL CHECK(length(btrim(payment_reference)) BETWEEN 3 AND 200),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_payment_invoice_scope
    FOREIGN KEY(workspace_key,invoice_id)
    REFERENCES enkyron_crm_issued_invoices(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_payment_reference_unique UNIQUE(workspace_key,invoice_id,payment_reference)
);
CREATE INDEX enkyron_invoice_payments_by_invoice
  ON enkyron_crm_invoice_payments(workspace_key,invoice_id,recorded_at DESC,id DESC);
CREATE TRIGGER enkyron_invoice_payments_immutable
  BEFORE UPDATE OR DELETE ON enkyron_crm_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
