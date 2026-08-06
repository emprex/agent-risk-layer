-- Additive applicability revision history for the guided Control Intelligence journey.
-- Migration 015 is deployed and intentionally remains unchanged.
CREATE TABLE IF NOT EXISTS control_applicability_revisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE RESTRICT,
  evaluation_id TEXT NOT NULL,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('applicable','not_applicable','context_required')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  architecture_facts_json TEXT NOT NULL DEFAULT '[]',
  evaluator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  evaluator_role TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  previous_revision_id TEXT REFERENCES control_applicability_revisions(id) ON DELETE RESTRICT,
  descriptor_json TEXT NOT NULL,
  evaluation_digest TEXT NOT NULL CHECK (length(evaluation_digest)=64),
  UNIQUE(id,workspace_id,project_id,system_snapshot_id,entry_id),
  FOREIGN KEY(evaluation_id,workspace_id,project_id,system_snapshot_id,entry_id)
    REFERENCES control_snapshot_evaluations(id,workspace_id,project_id,system_snapshot_id,entry_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_applicability_revision_scope ON control_applicability_revisions(workspace_id,project_id,system_snapshot_id,entry_id,evaluated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_applicability_revision_digest ON control_applicability_revisions(evaluation_id,evaluation_digest);
