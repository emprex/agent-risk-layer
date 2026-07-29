ALTER TABLE security_projects ADD COLUMN IF NOT EXISTS policy_digest TEXT;
ALTER TABLE security_projects ADD COLUMN IF NOT EXISTS policy_published_at TEXT;

ALTER TABLE runtime_events ADD COLUMN IF NOT EXISTS policy_version TEXT;
ALTER TABLE runtime_events ADD COLUMN IF NOT EXISTS policy_digest TEXT;
ALTER TABLE runtime_events ADD COLUMN IF NOT EXISTS policy_published_at TEXT;

CREATE TABLE IF NOT EXISTS remediation_evidence_artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  remediation_id TEXT NOT NULL REFERENCES remediation_items(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'active',
  content_json TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  invalidated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_remediation_evidence_scope
  ON remediation_evidence_artifacts(workspace_id,project_id,remediation_id,artifact_type,lifecycle_state);

-- Existing policy JSON and remediation records deliberately remain untouched.
-- Application reads fail closed until a policy is republished and legacy
-- remediation evidence is upgraded through a newly registered artifact/retest.
