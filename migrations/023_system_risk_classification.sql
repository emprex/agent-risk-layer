-- ARL-KB-004
-- Human system-level risk classification bound to the exact system snapshot.
-- This is intentionally separate from project_risk_context, which stores
-- contextual severity for individual controls.

CREATE TABLE IF NOT EXISTS system_risk_classifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE RESTRICT,
  snapshot_digest TEXT NOT NULL CHECK (length(snapshot_digest)=64),

  declared_risk_tier TEXT NOT NULL
    CHECK (declared_risk_tier IN ('low','medium','high','critical')),

  impact_required_tier TEXT NOT NULL
    CHECK (impact_required_tier IN ('low','medium','high','critical')),

  decision TEXT NOT NULL
    CHECK (decision IN ('aligned','underclassified')),

  maximum_credible_impact_json TEXT NOT NULL,
  evidence_references_json TEXT NOT NULL,

  rationale TEXT NOT NULL,
  limitations TEXT NOT NULL DEFAULT '',

  classification_method TEXT NOT NULL,
  classification_method_version TEXT NOT NULL,

  reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TEXT NOT NULL,

  supersedes_classification_id TEXT
    REFERENCES system_risk_classifications(id) ON DELETE RESTRICT,

  status TEXT NOT NULL DEFAULT 'current'
    CHECK (status IN ('current','superseded')),

  descriptor_json TEXT NOT NULL,
  classification_digest TEXT NOT NULL
    CHECK (length(classification_digest)=64)
);

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_system_risk_classification_current
ON system_risk_classifications(system_snapshot_id)
WHERE status='current';

CREATE INDEX IF NOT EXISTS
  idx_system_risk_classification_project
ON system_risk_classifications(
  workspace_id,
  project_id,
  system_snapshot_id,
  reviewed_at DESC
);
