-- ENKYRON Mail R02: the local client is authoritative for organization,
-- labels, message copies, calendar, and tasks. Resend remains transport.
-- Only applies by a separate guarded backed-up migration. No provider moves.
CREATE TABLE enkyron_mail_local_folders (
  workspace_key TEXT NOT NULL CHECK(workspace_key ~ '^local:[A-Za-z0-9_.-]{1,80}$'),
  folder_key TEXT NOT NULL CHECK(folder_key ~ '^[a-z0-9_-]{1,64}$'),
  name TEXT NOT NULL CHECK(char_length(name) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(workspace_key,folder_key),
  UNIQUE(workspace_key,name)
);
CREATE TABLE enkyron_mail_local_threads (
  workspace_key TEXT NOT NULL CHECK(workspace_key ~ '^local:[A-Za-z0-9_.-]{1,80}$'),
  mailbox_key TEXT NOT NULL CHECK(mailbox_key IN ('direction','support')),
  thread_id UUID NOT NULL,
  provider_folder TEXT NOT NULL DEFAULT 'inbox'
    CHECK(provider_folder IN ('inbox','archive','spam','trash')),
  folder_key TEXT NOT NULL DEFAULT 'inbox' CHECK(char_length(folder_key) BETWEEN 1 AND 64),
  subject TEXT NOT NULL DEFAULT '' CHECK(char_length(subject)<=400),
  last_message_at TEXT NOT NULL DEFAULT '' CHECK(char_length(last_message_at)<=64),
  unread BOOLEAN NOT NULL DEFAULT TRUE,
  flagged BOOLEAN NOT NULL DEFAULT FALSE,
  crm_company_id UUID,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(workspace_key,mailbox_key,thread_id)
);
CREATE INDEX idx_enkyron_mail_local_threads_folder
  ON enkyron_mail_local_threads(workspace_key,folder_key,last_message_at DESC);
CREATE TABLE enkyron_mail_local_messages (
  workspace_key TEXT NOT NULL,
  mailbox_key TEXT NOT NULL,
  thread_id UUID NOT NULL,
  message_id UUID NOT NULL,
  sender TEXT NOT NULL DEFAULT '' CHECK(char_length(sender)<=254),
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT NOT NULL DEFAULT '' CHECK(char_length(subject)<=400),
  body_text TEXT NOT NULL DEFAULT '' CHECK(char_length(body_text)<=20000),
  html_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL DEFAULT '' CHECK(char_length(created_at)<=64),
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(workspace_key,mailbox_key,message_id),
  FOREIGN KEY(workspace_key,mailbox_key,thread_id) REFERENCES enkyron_mail_local_threads
   (workspace_key,mailbox_key,thread_id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_mail_local_messages_thread ON enkyron_mail_local_messages
  (workspace_key,mailbox_key,thread_id,created_at);
CREATE TABLE enkyron_mail_local_labels (
  workspace_key TEXT NOT NULL,
  label_id UUID NOT NULL,
  name TEXT NOT NULL CHECK(char_length(name) BETWEEN 1 AND 50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(workspace_key,label_id),
  UNIQUE(workspace_key,name)
);
CREATE TABLE enkyron_mail_thread_labels (
  workspace_key TEXT NOT NULL,
  mailbox_key TEXT NOT NULL,
  thread_id UUID NOT NULL,
  label_id UUID NOT NULL,
  PRIMARY KEY(workspace_key,mailbox_key,thread_id,label_id),
  FOREIGN KEY(workspace_key,mailbox_key,thread_id) REFERENCES enkyron_mail_local_threads
    (workspace_key,mailbox_key,thread_id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_key,label_id) REFERENCES enkyron_mail_local_labels
    (workspace_key,label_id) ON DELETE RESTRICT
);
CREATE TABLE enkyron_mail_local_events (
  id UUID PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  mailbox_key TEXT,
  thread_id UUID,
  event_kind TEXT NOT NULL CHECK(event_kind IN
    ('folder_created','label_created','thread_moved','thread_labeled',
     'thread_unlabeled','thread_flagged','thread_unflagged',
     'calendar_created','calendar_updated','task_created','task_completed')),
  actor_local TEXT NOT NULL CHECK(char_length(actor_local) BETWEEN 1 AND 80),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_enkyron_mail_local_events_scope ON enkyron_mail_local_events
 (workspace_key,occurred_at DESC);
CREATE TRIGGER enkyron_mail_local_events_immutable
  BEFORE UPDATE OR DELETE ON enkyron_mail_local_events FOR EACH ROW
  EXECUTE FUNCTION enkyron_crm_events_immutable();
CREATE TABLE enkyron_calendar_events (
  workspace_key TEXT NOT NULL,
  event_id UUID NOT NULL,
  title TEXT NOT NULL CHECK(char_length(title) BETWEEN 1 AND 200),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/London'
    CHECK(char_length(timezone) BETWEEN 1 AND 64),
  location TEXT NOT NULL DEFAULT '' CHECK(char_length(location)<=254),
  notes TEXT NOT NULL DEFAULT '' CHECK(char_length(notes)<=4000),
  crm_company_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(workspace_key,event_id),
  CHECK(ends_at > starts_at)
);
CREATE INDEX idx_enkyron_calendar_events_range ON enkyron_calendar_events
 (workspace_key,starts_at,ends_at);
CREATE TABLE enkyron_calendar_tasks (
  workspace_key TEXT NOT NULL,
  task_id UUID NOT NULL,
  title TEXT NOT NULL CHECK(char_length(title) BETWEEN 1 AND 200),
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  crm_company_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(workspace_key,task_id)
);
CREATE INDEX idx_enkyron_calendar_tasks_due ON enkyron_calendar_tasks
 (workspace_key,due_at);
