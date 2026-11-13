-- E07-04B1: human-entered immutable SOW drafts. No approvals, contracts or tests.
-- Additive migration: no pre-existing row is changed, no records seeded.
CREATE TABLE enkyron_crm_sow_draft_versions (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_revision INTEGER NOT NULL CHECK(proposal_revision>=1),
  sow_revision INTEGER NOT NULL CHECK(sow_revision>=1),
  in_scope TEXT NOT NULL CHECK(length(btrim(in_scope)) BETWEEN 20 AND 3000),
  out_of_scope TEXT NOT NULL CHECK(length(btrim(out_of_scope)) BETWEEN 20 AND 3000),
  deliverables TEXT NOT NULL CHECK(length(btrim(deliverables)) BETWEEN 20 AND 3000),
  acceptance_criteria TEXT NOT NULL CHECK(length(btrim(acceptance_criteria)) BETWEEN 20 AND 3000),
  target_inventory TEXT NOT NULL CHECK(length(btrim(target_inventory)) BETWEEN 20 AND 3000),
  dependencies TEXT NOT NULL CHECK(length(btrim(dependencies)) BETWEEN 20 AND 3000),
  review_note TEXT NOT NULL CHECK(length(btrim(review_note)) BETWEEN 30 AND 1000),
  status TEXT NOT NULL DEFAULT 'operator_draft_unapproved'
    CHECK(status='operator_draft_unapproved'),
  content_sha256 CHAR(64) NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_sow_draft_scoped_proposal
    FOREIGN KEY(workspace_key,proposal_id)
    REFERENCES enkyron_crm_proposal_drafts(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_sow_draft_revision_unique
    UNIQUE(workspace_key,proposal_id,proposal_revision,sow_revision)
);
CREATE INDEX enkyron_sow_draft_history ON enkyron_crm_sow_draft_versions
 (workspace_key,proposal_id,proposal_revision DESC,sow_revision DESC);
CREATE TRIGGER enkyron_sow_draft_versions_immutable
 BEFORE UPDATE OR DELETE ON enkyron_crm_sow_draft_versions
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
