CREATE TABLE IF NOT EXISTS security_projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  billing_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'development',
  status TEXT NOT NULL DEFAULT 'active',
  policy_json TEXT NOT NULL DEFAULT '{}',
  policy_version TEXT NOT NULL DEFAULT '1',
  retention_days INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS project_api_keys (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS runtime_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  api_key_id TEXT REFERENCES project_api_keys(id) ON DELETE SET NULL,
  request_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'guard',
  decision TEXT NOT NULL,
  observed_decision TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'none',
  rule_ids_json TEXT NOT NULL DEFAULT '[]',
  content_digest TEXT,
  tool_name TEXT,
  argument_digest TEXT,
  evaluation_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(project_id, request_id)
);

CREATE TABLE IF NOT EXISTS asset_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  source_digest TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  assets_json TEXT NOT NULL DEFAULT '[]',
  drift_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS remediation_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL,
  finding_key TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  owner_email TEXT,
  due_at TEXT,
  verification_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, finding_key)
);

CREATE TABLE IF NOT EXISTS security_audit_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES security_projects(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_projects_workspace ON security_projects(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_api_keys_project ON project_api_keys(project_id, revoked_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_events_project_created ON runtime_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_events_project_decision ON runtime_events(project_id, decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_snapshots_project ON asset_snapshots(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_remediation_project_status ON remediation_items(project_id, status, severity, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_workspace ON security_audit_log(workspace_id, created_at DESC);
