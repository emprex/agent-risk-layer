-- 106: operator-reported external sends of existing local CRM drafts.
-- No transport, OAuth, provider verification, delivery proof or customer consent.
-- Preserve the original draft, revision and all revision hashes.
CREATE TABLE enkyron_crm_mail_manual_sends (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL CHECK(draft_revision >= 1),
  provider TEXT NOT NULL CHECK(provider IN ('gmail','other')),
  provider_message_id TEXT NOT NULL CHECK(length(provider_message_id) BETWEEN 8 AND 200),
  sender_email TEXT NOT NULL CHECK(length(sender_email) BETWEEN 3 AND 254),
  recipient_email TEXT NOT NULL CHECK(length(recipient_email) BETWEEN 3 AND 254),
  sent_at TIMESTAMPTZ NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_key,draft_id),
  UNIQUE(workspace_key,provider,provider_message_id),
  CONSTRAINT enkyron_manual_send_scoped_draft
    FOREIGN KEY(workspace_key,draft_id)
    REFERENCES enkyron_crm_mail_drafts(workspace_key,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_mail_manual_sends
  ON enkyron_crm_mail_manual_sends(workspace_key,recorded_at DESC,id DESC);
CREATE TRIGGER enkyron_crm_mail_manual_sends_no_modify
  BEFORE UPDATE OR DELETE ON enkyron_crm_mail_manual_sends
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
