ALTER TABLE runtime_events ADD COLUMN IF NOT EXISTS retest_criteria_id TEXT;
ALTER TABLE runtime_events ADD COLUMN IF NOT EXISTS remediation_id TEXT;
ALTER TABLE runtime_events ADD COLUMN IF NOT EXISTS retest_criteria_digest TEXT;
ALTER TABLE runtime_events ADD COLUMN IF NOT EXISTS retest_satisfied BOOLEAN;

CREATE TABLE IF NOT EXISTS remediation_retest_criteria (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  remediation_id TEXT NOT NULL REFERENCES remediation_items(id) ON DELETE CASCADE,
  finding_key TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  expected_decision TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_identity TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  policy_digest TEXT NOT NULL,
  policy_published_at TEXT NOT NULL,
  criteria_digest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  runtime_event_id TEXT REFERENCES runtime_events(id) ON DELETE SET NULL,
  result TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_retest_criteria_event
  ON remediation_retest_criteria(runtime_event_id) WHERE runtime_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_retest_criteria_scope
  ON remediation_retest_criteria(workspace_id,project_id,remediation_id,status,expires_at);
