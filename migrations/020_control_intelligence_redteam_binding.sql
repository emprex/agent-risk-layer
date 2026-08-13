-- Bind integrity-verified customer-operated red-team evidence to an exact
-- Control Intelligence test execution. Existing evidence is never deleted.
-- When a qualifying replacement supersedes legacy invalid verification, the
-- previous descriptor/digest are preserved in an immutable trust revision
-- before the evidence record is marked stale.

ALTER TABLE control_evidence_items
  ADD COLUMN redteam_run_id TEXT REFERENCES redteam_runs(id) ON DELETE SET NULL;

ALTER TABLE control_evidence_items
  ADD COLUMN redteam_baseline_run_id TEXT REFERENCES redteam_runs(id) ON DELETE SET NULL;

ALTER TABLE control_evidence_items
  ADD COLUMN redteam_case_id TEXT;

CREATE INDEX IF NOT EXISTS idx_control_evidence_redteam_run
  ON control_evidence_items(redteam_run_id, redteam_case_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_control_evidence_redteam_exact_binding
  ON control_evidence_items(test_execution_id, redteam_run_id, redteam_case_id)
  WHERE redteam_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS control_evidence_trust_revisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES control_evidence_items(id) ON DELETE RESTRICT,
  replacement_evidence_id TEXT REFERENCES control_evidence_items(id) ON DELETE SET NULL,
  previous_verification_state TEXT NOT NULL,
  new_verification_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  previous_descriptor_json TEXT NOT NULL,
  previous_integrity_digest TEXT NOT NULL CHECK (length(previous_integrity_digest)=64),
  revision_digest TEXT NOT NULL CHECK (length(revision_digest)=64),
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(evidence_id,replacement_evidence_id,new_verification_state)
);

CREATE INDEX IF NOT EXISTS idx_control_evidence_trust_revision_scope
  ON control_evidence_trust_revisions(workspace_id,project_id,evidence_id,created_at DESC);
