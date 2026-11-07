-- 071: Human-entered commercial qualification reviews for companies and contacts.
-- Business-fit observations are NOT identity, consent, or sales verification.
-- This migration adds records only. Existing CRM entities and tickets are untouched.
CREATE UNIQUE INDEX idx_enkyron_crm_contacts_scoped_company_id
  ON enkyron_crm_contacts(workspace_key,company_id,id);

CREATE TABLE enkyron_crm_qualification_reviews (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  company_id TEXT NOT NULL,
  contact_id TEXT,
  fit_status TEXT NOT NULL
    CHECK (fit_status IN ('needs_research','potential_fit','not_fit','on_hold')),
  priority TEXT NOT NULL CHECK (priority IN ('low','normal','high')),
  rationale TEXT NOT NULL CHECK (length(btrim(rationale)) BETWEEN 20 AND 1500),
  next_action TEXT CHECK (next_action IS NULL OR length(btrim(next_action)) BETWEEN 5 AND 500),
  source_reference TEXT CHECK (source_reference IS NULL OR length(btrim(source_reference)) <= 500),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workspace_key,company_id)
    REFERENCES enkyron_crm_companies(workspace_key,id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_key,company_id,contact_id)
    REFERENCES enkyron_crm_contacts(workspace_key,company_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_qualification_company_history
  ON enkyron_crm_qualification_reviews(workspace_key,company_id,recorded_at DESC,id DESC);
CREATE TRIGGER enkyron_crm_qualification_reviews_no_modify
  BEFORE UPDATE OR DELETE ON enkyron_crm_qualification_reviews
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
