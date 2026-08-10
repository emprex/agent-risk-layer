-- Owner-only evidence assessment cases.
-- These projects reuse the existing tenant/project evidence model but are deliberately
-- excluded from runtime project entitlements and cannot issue runtime credentials.
CREATE TABLE IF NOT EXISTS owner_assessment_cases (
  project_id TEXT PRIMARY KEY REFERENCES security_projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_owner_assessment_cases_workspace
  ON owner_assessment_cases(workspace_id, created_at DESC);
