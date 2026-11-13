-- 076: Operator issuing-company legal/billing profile, NOT CRM customer companies.
-- Append-only revisions, scoped to the current local OS user. No automatic verification.
-- Does not alter historic prospects, clients, proposals, messages, taxes or tickets.
CREATE TABLE enkyron_operator_company_profiles (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  legal_name TEXT NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 2 AND 160),
  trading_name TEXT CHECK (trading_name IS NULL OR length(btrim(trading_name)) BETWEEN 1 AND 160),
  registration_number TEXT CHECK (registration_number IS NULL OR length(btrim(registration_number)) BETWEEN 1 AND 80),
  incorporation_country CHAR(2) NOT NULL CHECK (incorporation_country ~ '^[A-Z]{2}$'),
  registered_office TEXT NOT NULL CHECK (length(btrim(registered_office)) BETWEEN 10 AND 600),
  business_address TEXT CHECK (business_address IS NULL OR length(btrim(business_address)) BETWEEN 1 AND 600),
  company_email TEXT CHECK (company_email IS NULL OR length(btrim(company_email)) <= 254),
  telephone TEXT CHECK (telephone IS NULL OR length(btrim(telephone)) <= 80),
  website TEXT CHECK (website IS NULL OR length(btrim(website)) <= 500),
  vat_status TEXT NOT NULL CHECK (vat_status IN ('unknown','registered','not_registered','application_pending')),
  vat_number TEXT CHECK (vat_number IS NULL OR length(btrim(vat_number)) BETWEEN 1 AND 80),
  vat_effective_date DATE,
  default_currency CHAR(3) NOT NULL CHECK (default_currency IN ('GBP','EUR','USD')),
  billing_contact TEXT CHECK (billing_contact IS NULL OR length(btrim(billing_contact)) <= 300),
  source_reference TEXT NOT NULL CHECK (length(btrim(source_reference)) BETWEEN 3 AND 500),
  verification_notes TEXT NOT NULL CHECK (length(btrim(verification_notes)) BETWEEN 20 AND 2000),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verification_status TEXT NOT NULL DEFAULT 'operator_entered_unverified'
    CHECK (verification_status = 'operator_entered_unverified'),
  UNIQUE(workspace_key,revision),
  CHECK ((vat_status='registered' AND vat_number IS NOT NULL)
      OR (vat_status<>'registered' AND vat_number IS NULL AND vat_effective_date IS NULL))
);
CREATE INDEX idx_enkyron_operator_company_profile_history
  ON enkyron_operator_company_profiles(workspace_key,revision DESC);
CREATE TRIGGER enkyron_operator_company_profile_immutable
  BEFORE UPDATE OR DELETE ON enkyron_operator_company_profiles
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
