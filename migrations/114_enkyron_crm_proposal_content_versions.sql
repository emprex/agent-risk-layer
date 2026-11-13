-- ENK-04: immutable full-content snapshots of operator-reviewed proposal revisions.
-- Existing proposals and their 072 hash-only event rows remain untouched.
-- No backfill, no overwrite, no issued quote/contract and no user-data seed.
-- The guarded correction route archives the current revision BEFORE editing,
-- then appends the new revision. Both snapshots and event rows are immutable.
CREATE TABLE enkyron_crm_proposal_content_versions (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision>=1),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 5 AND 160),
  scope_text TEXT NOT NULL CHECK (length(btrim(scope_text)) BETWEEN 20 AND 5000),
  currency CHAR(3) NOT NULL CHECK (currency IN ('GBP','EUR','USD')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor BETWEEN 1 AND 999999999),
  content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  source_event_id TEXT NOT NULL,
  snapshot_kind TEXT NOT NULL CHECK (
    snapshot_kind IN ('pre_edit_archive','reviewed_revision')
  ),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_key,proposal_id,revision),
  CONSTRAINT enkyron_proposal_content_version_scoped_draft
    FOREIGN KEY (workspace_key,proposal_id)
    REFERENCES enkyron_crm_proposal_drafts(workspace_key,id)
    ON DELETE RESTRICT,
  CONSTRAINT enkyron_proposal_content_version_event
    FOREIGN KEY (source_event_id)
    REFERENCES enkyron_crm_proposal_draft_events(id)
    ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_proposal_content_versions_history
  ON enkyron_crm_proposal_content_versions
  (workspace_key,proposal_id,revision DESC);
CREATE TRIGGER enkyron_proposal_content_versions_no_modify
  BEFORE UPDATE OR DELETE ON enkyron_crm_proposal_content_versions
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
