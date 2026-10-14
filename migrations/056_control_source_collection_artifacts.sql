-- Issue #427: complete deterministic collection artifact, separate from bounded control observations.
-- Historical evidence and deployment decisions are deliberately untouched.
CREATE TABLE IF NOT EXISTS control_source_collection_artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  system_snapshot_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  target_revision TEXT NOT NULL,
  input_reference TEXT NOT NULL,
  collection_sha256 TEXT NOT NULL,
  collection_json TEXT NOT NULL,
  collector_schema TEXT NOT NULL,
  retention_status TEXT NOT NULL DEFAULT 'active' CHECK (retention_status IN ('active','retained_hold','expired')),
  retention_expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, project_id, system_snapshot_id, entry_id, target_revision, input_reference)
);
CREATE INDEX IF NOT EXISTS idx_source_collection_artifact_scope
  ON control_source_collection_artifacts (workspace_id, project_id, system_snapshot_id, entry_id, created_at);
