-- ENKYRON Mail E04-05/E04-06A: additive, local-first content archive.
-- Reuses arl_local, schema 112 and existing message identifiers.
-- Never changes historical tables, messages, provider folders or approvals.
-- Stored HTML is inert source, NEVER executable web content or model instructions.
-- Attachment bytes are never released without a separate scanner approval flow.
CREATE TABLE enkyron_mail_full_messages (
  workspace_key TEXT NOT NULL,
  mailbox_key TEXT NOT NULL CHECK(mailbox_key IN ('direction','support')),
  thread_id UUID NOT NULL,
  message_id UUID NOT NULL,
  rfc_message_id TEXT NOT NULL DEFAULT '' CHECK(octet_length(rfc_message_id)<=998),
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound','unknown')),
  sender TEXT NOT NULL CHECK(octet_length(sender)<=2048),
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(recipients)='array'),
  cc JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(cc)='array'),
  bcc JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(bcc)='array'),
  reply_to JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(reply_to)='array'),
  body_text_full TEXT,
  body_html_inert TEXT,
  provider_sha256 TEXT NOT NULL CHECK(provider_sha256 ~ '^[0-9a-f]{64}$'),
  archive_state TEXT NOT NULL CHECK(archive_state IN ('complete','incomplete')),
  source_type TEXT NOT NULL DEFAULT 'resend_inbox_email_get'
    CHECK(source_type='resend_inbox_email_get'),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(workspace_key,mailbox_key,message_id),
  FOREIGN KEY(workspace_key,mailbox_key,message_id) REFERENCES enkyron_mail_local_messages
    (workspace_key,mailbox_key,message_id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_key,mailbox_key,thread_id) REFERENCES enkyron_mail_local_threads
    (workspace_key,mailbox_key,thread_id) ON DELETE RESTRICT,
  CHECK (body_text_full IS NULL OR octet_length(body_text_full)<=2097152),
  CHECK (body_html_inert IS NULL OR octet_length(body_html_inert)<=2097152)
);
CREATE INDEX idx_enkyron_mail_full_messages_thread ON enkyron_mail_full_messages
  (workspace_key,mailbox_key,thread_id,captured_at);

CREATE TABLE enkyron_mail_attachment_quarantine (
  workspace_key TEXT NOT NULL,
  mailbox_key TEXT NOT NULL CHECK(mailbox_key IN ('direction','support')),
  message_id UUID NOT NULL,
  attachment_id UUID NOT NULL,
  original_filename TEXT NOT NULL DEFAULT '' CHECK(octet_length(original_filename)<=512),
  content_type TEXT NOT NULL DEFAULT '' CHECK(octet_length(content_type)<=256),
  declared_size BIGINT CHECK(declared_size IS NULL OR declared_size BETWEEN 0 AND 26214400),
  content_bytes BYTEA,
  content_sha256 TEXT,
  safety_state TEXT NOT NULL DEFAULT 'metadata_only'
    CHECK(safety_state IN ('metadata_only','quarantined_unscanned','blocked')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(workspace_key,mailbox_key,message_id,attachment_id),
  FOREIGN KEY(workspace_key,mailbox_key,message_id) REFERENCES enkyron_mail_local_messages
    (workspace_key,mailbox_key,message_id) ON DELETE RESTRICT,
  CHECK (content_bytes IS NULL OR octet_length(content_bytes)<=26214400),
  CHECK ((content_bytes IS NULL AND content_sha256 IS NULL
          AND safety_state IN ('metadata_only','blocked'))
      OR (content_bytes IS NOT NULL AND content_sha256 ~ '^[0-9a-f]{64}$'
          AND safety_state IN ('quarantined_unscanned','blocked')))
);
-- This migration intentionally does NOT grant access, expose file content,
-- schedule downloads, execute virus scans, or mark any attachment as safe.
