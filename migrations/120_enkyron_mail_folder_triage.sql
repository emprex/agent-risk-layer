-- ENKYRON Mail folder triage: keep canonical sent/draft audit histories immutable.
-- Explicit backed-up local-only migration; never auto-run on application launch.
CREATE TABLE enkyron_mail_outbound_locations (
  workspace_key TEXT NOT NULL CHECK(workspace_key ~ '^local:[A-Za-z0-9_.-]{1,80}$'),
  record_kind TEXT NOT NULL CHECK(record_kind IN ('sent','drafts')),
  record_id TEXT NOT NULL CHECK(record_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'),
  mailbox_key TEXT NOT NULL CHECK(mailbox_key IN ('direction','support')),
  folder_key TEXT NOT NULL CHECK(folder_key ~ '^[a-z0-9_-]{1,64}$'),
  previous_folder TEXT NOT NULL CHECK(previous_folder ~ '^[a-z0-9_-]{1,64}$'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(workspace_key,record_kind,record_id)
);
CREATE INDEX enkyron_mail_outbound_locations_folder_idx
 ON enkyron_mail_outbound_locations(workspace_key,folder_key,mailbox_key,updated_at DESC);

CREATE TABLE enkyron_mail_folder_events (
  id UUID PRIMARY KEY,
  workspace_key TEXT NOT NULL CHECK(workspace_key ~ '^local:[A-Za-z0-9_.-]{1,80}$'),
  record_kind TEXT CHECK(record_kind IN ('sent','drafts','inbox')),
  record_id UUID,
  mailbox_key TEXT CHECK(mailbox_key IN ('direction','support')),
  event_kind TEXT NOT NULL CHECK(event_kind IN ('outbound_moved','trash_emptied')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_local TEXT NOT NULL CHECK(char_length(actor_local) BETWEEN 1 AND 80),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX enkyron_mail_folder_events_scope_idx
 ON enkyron_mail_folder_events(workspace_key,occurred_at DESC);
CREATE TRIGGER enkyron_mail_folder_events_immutable
 BEFORE UPDATE OR DELETE ON enkyron_mail_folder_events FOR EACH ROW
 EXECUTE FUNCTION enkyron_crm_events_immutable();
