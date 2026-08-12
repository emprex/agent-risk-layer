-- Bind integrity-verified customer-operated red-team evidence to an exact
-- Control Intelligence test execution without rewriting existing evidence.
-- The foreign keys preserve the uploaded run identity; trust scope remains
-- explicit in the evidence descriptor.

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
