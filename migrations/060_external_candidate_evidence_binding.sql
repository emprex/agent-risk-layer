-- 060: External black-box candidate evidence binding.
-- This table is additive and cannot replace authoritative system snapshots
-- or promote observations to verified security findings. No historic row changes.
CREATE TABLE IF NOT EXISTS external_agent_candidate_imports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  system_snapshot_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256)=64),
  roe_sha256 TEXT NOT NULL CHECK (length(roe_sha256)=64),
  observation_sha256 TEXT NOT NULL CHECK (length(observation_sha256)=64),
  target_fingerprint TEXT NOT NULL CHECK (length(target_fingerprint)=64),
  declared_version TEXT NOT NULL,
  version_verified INTEGER NOT NULL DEFAULT 0 CHECK (version_verified=0),
  evidence_state TEXT NOT NULL DEFAULT 'candidate_unreviewed' CHECK (evidence_state='candidate_unreviewed'),
  imported_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, project_id, system_snapshot_id, collection_id),
  UNIQUE (id, workspace_id, project_id, system_snapshot_id),
  FOREIGN KEY (system_snapshot_id, workspace_id, project_id) REFERENCES system_snapshots(id, workspace_id, project_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS external_agent_candidate_control_links (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  system_snapshot_id TEXT NOT NULL,
  control_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  probe_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (import_id, control_id, probe_id),
  UNIQUE (evidence_id),
  FOREIGN KEY (import_id, workspace_id, project_id, system_snapshot_id) REFERENCES external_agent_candidate_imports(id, workspace_id, project_id, system_snapshot_id) ON DELETE RESTRICT,
  FOREIGN KEY (evidence_id, workspace_id, project_id, system_snapshot_id, control_id) REFERENCES control_evidence_items(id, workspace_id, project_id, system_snapshot_id, entry_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_external_candidate_import_by_snapshot
  ON external_agent_candidate_imports(workspace_id, project_id, system_snapshot_id, created_at);
