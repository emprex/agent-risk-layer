-- 088: Reviewed CSV-new-record import, with append-only batch and row provenance.
-- No merge, overwrite, authority/consent promotion or automatic outreach.
-- Imported company source_type must be distinguishable from manual entry.
ALTER TABLE enkyron_crm_companies
  DROP CONSTRAINT enkyron_crm_companies_source_type_check;
ALTER TABLE enkyron_crm_companies
  ADD CONSTRAINT enkyron_crm_companies_source_type_check
    CHECK(source_type IN ('manual','legacy_prospect_verified','csv_reviewed_import'));

CREATE TABLE enkyron_crm_csv_import_batches (
 id TEXT PRIMARY KEY,
 workspace_key TEXT NOT NULL,
 source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 source_company_id TEXT NOT NULL,
 destination_company_id TEXT NOT NULL,
 imported_contact_count INTEGER NOT NULL CHECK(imported_contact_count BETWEEN 0 AND 500),
 review_note TEXT NOT NULL CHECK(length(btrim(review_note)) BETWEEN 30 AND 500),
 imported_by TEXT NOT NULL,
 imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(workspace_key,id,destination_company_id),
 UNIQUE(workspace_key,source_sha256),
 UNIQUE(workspace_key,source_company_id),
 FOREIGN KEY(workspace_key,destination_company_id)
   REFERENCES enkyron_crm_companies(workspace_key,id) ON DELETE RESTRICT
);
CREATE TABLE enkyron_crm_csv_import_contacts (
 id TEXT PRIMARY KEY,
 workspace_key TEXT NOT NULL,
 batch_id TEXT NOT NULL,
 destination_company_id TEXT NOT NULL,
 source_contact_id TEXT NOT NULL,
 destination_contact_id TEXT NOT NULL,
 UNIQUE(workspace_key,source_contact_id),
 UNIQUE(workspace_key,destination_contact_id),
 FOREIGN KEY(workspace_key,batch_id,destination_company_id)
   REFERENCES enkyron_crm_csv_import_batches(workspace_key,id,destination_company_id)
   ON DELETE RESTRICT,
 FOREIGN KEY(workspace_key,destination_company_id,destination_contact_id)
   REFERENCES enkyron_crm_contacts(workspace_key,company_id,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_csv_batch_history
 ON enkyron_crm_csv_import_batches(workspace_key,imported_at DESC,id DESC);
CREATE TRIGGER enkyron_crm_csv_batch_immutable
 BEFORE UPDATE OR DELETE ON enkyron_crm_csv_import_batches
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
CREATE TRIGGER enkyron_crm_csv_items_immutable
 BEFORE UPDATE OR DELETE ON enkyron_crm_csv_import_contacts
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
