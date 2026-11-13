-- ENK-04: bind each immutable full-text archive to the EXACT immutable
-- proposal event: same workspace, proposal, revision, event ID and content hash.
-- Additive migration following 114. Never alter 114 (already applied in UAT).
-- No backfill, event rewrite, delete, external send, or data seed.
-- A pre-existing mismatched archive causes VALIDATE to fail, rolling back
-- this migration rather than silently accepting or "repairing" its history.
--
-- Before any future non-CI deployment: independent read-only inventory,
-- checksum review, backup, migration plan and operator approval are mandatory.

CREATE UNIQUE INDEX enkyron_proposal_event_archive_link_key
  ON enkyron_crm_proposal_draft_events
  (workspace_key, proposal_id, revision, id, content_sha256);

ALTER TABLE enkyron_crm_proposal_content_versions
  ADD CONSTRAINT enkyron_proposal_archive_event_exact_fk
  FOREIGN KEY (workspace_key, proposal_id, revision, source_event_id, content_sha256)
  REFERENCES enkyron_crm_proposal_draft_events
    (workspace_key, proposal_id, revision, id, content_sha256)
  ON DELETE RESTRICT
  NOT VALID;

-- Validate all existing archives; any mismatch aborts the transaction.
ALTER TABLE enkyron_crm_proposal_content_versions
  VALIDATE CONSTRAINT enkyron_proposal_archive_event_exact_fk;
