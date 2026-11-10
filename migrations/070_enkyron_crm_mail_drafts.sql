-- 070: ENKYRON local CRM email drafts, NO send transport.
-- Each draft is manually authored and scoped to one existing opportunity.
-- No SMTP, provider credentials, sent/delivered flags, or prospect auto-promotion.
CREATE TABLE enkyron_crm_mail_drafts (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  recipient_email TEXT,
  subject TEXT NOT NULL DEFAULT '' CHECK (length(subject) <= 200),
  body_text TEXT NOT NULL DEFAULT '' CHECK (length(body_text) <= 20000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_mail_drafts_opportunity_scope
    FOREIGN KEY (workspace_key,opportunity_id)
      REFERENCES enkyron_crm_opportunities(workspace_key,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_mail_drafts_list
  ON enkyron_crm_mail_drafts(workspace_key,updated_at DESC,id DESC);
CREATE INDEX idx_enkyron_mail_drafts_opportunity
  ON enkyron_crm_mail_drafts(workspace_key,opportunity_id,updated_at DESC);
CREATE UNIQUE INDEX idx_enkyron_mail_drafts_workspace_id
  ON enkyron_crm_mail_drafts(workspace_key,id);

-- Record revisions without duplicating recipient/address/body PII in the audit log.
CREATE TABLE enkyron_crm_mail_draft_events (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  event_type TEXT NOT NULL CHECK (event_type IN ('created','edited')),
  content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  actor_local TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_key,draft_id,revision),
  CONSTRAINT enkyron_mail_events_draft_scope
    FOREIGN KEY (workspace_key,draft_id)
      REFERENCES enkyron_crm_mail_drafts(workspace_key,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_mail_draft_events
  ON enkyron_crm_mail_draft_events(workspace_key,draft_id,revision DESC);
CREATE TRIGGER enkyron_crm_mail_draft_events_no_modify
  BEFORE UPDATE OR DELETE ON enkyron_crm_mail_draft_events
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
