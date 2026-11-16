-- ENKYRON local-only filing for sent records and unsent drafts.
-- No mail is deleted from the provider or from CRM/audit history.
-- This migration MUST be installed only by a separately approved backed-up process.
CREATE TABLE enkyron_mail_record_filing (
  workspace_key TEXT NOT NULL CHECK (workspace_key ~ '^local:[A-Za-z0-9_.-]{1,80}$'),
  draft_id TEXT NOT NULL,
  folder_key TEXT NOT NULL CHECK(folder_key IN
    ('sent','drafts','archive','spam','trash','hidden')),
  previous_folder TEXT CHECK(previous_folder IN
    ('sent','drafts','archive','spam','trash')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(workspace_key,draft_id),
  FOREIGN KEY(workspace_key,draft_id) REFERENCES enkyron_crm_mail_drafts(workspace_key,id)
    ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_mail_record_filing_folder
  ON enkyron_mail_record_filing(workspace_key,folder_key,updated_at DESC);
CREATE TABLE enkyron_mail_record_filing_events (
  event_id UUID PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  draft_id TEXT,
  operation TEXT NOT NULL CHECK (operation IN ('move','clear_trash')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_local TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER enkyron_mail_record_filing_events_immutable
  BEFORE UPDATE OR DELETE ON enkyron_mail_record_filing_events
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
