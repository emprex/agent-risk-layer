-- ENKYRON Mail Phase 1: controlled mailbox filing and audit.
-- Explicit migration only. No historical mail is changed or deleted.
ALTER TABLE enkyron_local_mail_access
  ADD COLUMN can_manage BOOLEAN NOT NULL DEFAULT FALSE;

-- Append-only intent and result: remote provider changes cannot be rolled back
-- by a PostgreSQL transaction; log intent BEFORE the provider request.
CREATE TABLE enkyron_mail_filing_events (
  id UUID PRIMARY KEY,
  operation_id UUID NOT NULL,
  workspace_key TEXT NOT NULL
    CHECK (workspace_key ~ '^local:[A-Za-z0-9_.-]{1,80}$'),
  mailbox_key TEXT NOT NULL CHECK (mailbox_key IN ('direction','support')),
  thread_id UUID NOT NULL,
  source_folder TEXT NOT NULL
    CHECK (source_folder IN ('inbox','archive','spam','trash')),
  target_folder TEXT NOT NULL
    CHECK (target_folder IN ('inbox','archive','spam','trash')),
  event_kind TEXT NOT NULL
    CHECK (event_kind IN ('requested','provider_confirmed','provider_uncertain')),
  actor_local TEXT NOT NULL CHECK (char_length(actor_local) BETWEEN 1 AND 80),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (operation_id,event_kind)
);
CREATE INDEX idx_enkyron_mail_filing_workspace
  ON enkyron_mail_filing_events(workspace_key,mailbox_key,thread_id,occurred_at DESC);
CREATE TRIGGER enkyron_mail_filing_events_immutable
  BEFORE UPDATE OR DELETE ON enkyron_mail_filing_events
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();

-- Provider is the mailbox source of truth. This optional local cache contains
-- only bounded message headers until content encryption and retention are approved.
CREATE TABLE enkyron_mail_thread_index (
  workspace_key TEXT NOT NULL CHECK
    (workspace_key ~ '^local:[A-Za-z0-9_.-]{1,80}$'),
  mailbox_key TEXT NOT NULL CHECK (mailbox_key IN ('direction','support')),
  thread_id UUID NOT NULL,
  folder TEXT NOT NULL CHECK(folder IN ('inbox','archive','spam','trash')),
  subject TEXT NOT NULL DEFAULT '' CHECK (char_length(subject)<=400),
  last_message_at TEXT NOT NULL DEFAULT '' CHECK(char_length(last_message_at)<=64),
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(workspace_key,mailbox_key,thread_id)
);
CREATE INDEX idx_enkyron_mail_thread_index_scope
  ON enkyron_mail_thread_index(workspace_key,mailbox_key,folder,indexed_at DESC);
