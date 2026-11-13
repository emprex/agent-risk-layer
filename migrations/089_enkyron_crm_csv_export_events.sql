-- 089: Append-only CSV export attempt and outcome metadata, local workspace only.
-- No filenames, paths, contact values, exported bytes or consent in this register.
CREATE TABLE enkyron_crm_csv_export_events (
 id TEXT PRIMARY KEY,
 workspace_key TEXT NOT NULL,
 export_id TEXT NOT NULL,
 company_id TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('started','completed','failed')),
 company_record_version INTEGER NOT NULL CHECK(company_record_version>=1),
 expected_contact_count INTEGER NOT NULL CHECK(expected_contact_count BETWEEN 0 AND 500),
 file_sha256 TEXT,
 file_bytes INTEGER,
 record_count INTEGER,
 failure_category TEXT,
 recorded_by TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_key,company_id)
  REFERENCES enkyron_crm_companies(workspace_key,id) ON DELETE RESTRICT,
 UNIQUE(workspace_key,export_id,event_type),
 CHECK(event_type <> 'started' OR id=export_id),
 CHECK(
  (event_type='started' AND file_sha256 IS NULL AND file_bytes IS NULL
    AND record_count IS NULL AND failure_category IS NULL)
  OR
  (event_type='completed' AND file_sha256 ~ '^[0-9a-f]{64}$'
    AND file_bytes BETWEEN 1 AND 1048576
    AND record_count BETWEEN 1 AND 501 AND failure_category IS NULL)
  OR
  (event_type='failed' AND file_sha256 IS NULL AND file_bytes IS NULL
    AND record_count IS NULL AND failure_category IN
     ('file_error','verification_error','unknown'))
 )
);
CREATE UNIQUE INDEX idx_enkyron_crm_csv_export_terminal
 ON enkyron_crm_csv_export_events(workspace_key,export_id)
 WHERE event_type IN ('completed','failed');
CREATE INDEX idx_enkyron_crm_csv_export_history
 ON enkyron_crm_csv_export_events(workspace_key,company_id,recorded_at DESC,id DESC);
CREATE TRIGGER enkyron_crm_csv_export_events_immutable
 BEFORE UPDATE OR DELETE ON enkyron_crm_csv_export_events
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
