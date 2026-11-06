-- 074: Append-only international VAT/tax diligence per draft proposal.
-- Reviews are human records, NOT fiscal rulings, registrations, invoices or tax rates.
-- Existing proposals, prices, PDF exports and contacts remain unchanged.
CREATE TABLE enkyron_crm_proposal_tax_reviews (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_revision INTEGER NOT NULL CHECK (proposal_revision >= 1),
  buyer_type TEXT NOT NULL CHECK (buyer_type IN ('unknown','business','consumer')),
  buyer_country CHAR(2),
  service_mode TEXT NOT NULL CHECK (service_mode IN
    ('unknown','human_led_advisory','automated_digital','mixed_or_other')),
  business_evidence TEXT,
  location_evidence TEXT,
  uk_vat_registration TEXT NOT NULL CHECK (uk_vat_registration IN
    ('unknown','registered','not_registered','application_pending')),
  overseas_withholding TEXT NOT NULL CHECK (overseas_withholding IN
    ('not_checked','potential_issue','reviewed_manually')),
  review_notes TEXT NOT NULL CHECK (length(btrim(review_notes)) BETWEEN 30 AND 2000),
  source_reference TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tax_review_scoped_proposal
    FOREIGN KEY (workspace_key,proposal_id)
    REFERENCES enkyron_crm_proposal_drafts(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT buyer_location_evidence_required
    CHECK (buyer_country IS NULL OR
       (length(buyer_country)=2 AND buyer_country ~ '^[A-Z]{2}$'
        AND length(btrim(COALESCE(location_evidence,''))) BETWEEN 10 AND 1000)),
  CONSTRAINT business_requires_evidence
    CHECK (buyer_type <> 'business' OR
       length(btrim(COALESCE(business_evidence,''))) BETWEEN 10 AND 1000),
  CONSTRAINT business_evidence_bound
    CHECK (business_evidence IS NULL OR length(btrim(business_evidence)) BETWEEN 10 AND 1000),
  CONSTRAINT location_evidence_bound
    CHECK (location_evidence IS NULL OR length(btrim(location_evidence)) BETWEEN 10 AND 1000),
  CONSTRAINT reference_bound
    CHECK (source_reference IS NULL OR length(btrim(source_reference)) BETWEEN 5 AND 500)
);
CREATE INDEX idx_enkyron_tax_review_history
  ON enkyron_crm_proposal_tax_reviews
  (workspace_key,proposal_id,recorded_at DESC,id DESC);
CREATE TRIGGER enkyron_tax_review_immutable
  BEFORE UPDATE OR DELETE ON enkyron_crm_proposal_tax_reviews
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
