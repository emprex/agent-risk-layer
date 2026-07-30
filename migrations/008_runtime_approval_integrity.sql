CREATE TABLE IF NOT EXISTS runtime_approvals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  approver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  environment TEXT NOT NULL,
  action_digest TEXT NOT NULL,
  token_digest TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_request_id TEXT,
  runtime_event_id TEXT REFERENCES runtime_events(id) ON DELETE SET NULL,
  revoked_at TEXT,
  CHECK (status IN ('active','consumed','revoked')),
  CHECK (length(action_digest) = 64),
  CHECK (length(token_digest) = 64)
);

CREATE INDEX IF NOT EXISTS idx_runtime_approvals_project_status
  ON runtime_approvals(project_id, status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_approvals_project_action
  ON runtime_approvals(project_id, action_digest, issued_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_approvals_consumed_request
  ON runtime_approvals(project_id, consumed_request_id)
  WHERE consumed_request_id IS NOT NULL;
