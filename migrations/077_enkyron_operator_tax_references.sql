-- 077: Separate HMRC Corporation Tax references from VAT.
-- Additive, nullable, append-only issuer profile fields; old revisions remain intact.
-- No existing data or historic migration checksum is modified.
ALTER TABLE enkyron_operator_company_profiles
  ADD COLUMN company_utr TEXT,
  ADD COLUMN tax_office_number TEXT;

ALTER TABLE enkyron_operator_company_profiles
  ADD CONSTRAINT enkyron_company_utr_format
    CHECK (company_utr IS NULL OR company_utr ~ '^[0-9]{10}$'),
  ADD CONSTRAINT enkyron_tax_office_number_format
    CHECK (tax_office_number IS NULL OR tax_office_number ~ '^[0-9]{3}$');
