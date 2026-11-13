-- 072: Manually priced commercial PROPOSAL DRAFTS for existing opportunities.
-- Never issued/sent; no VAT estimate, invoice, signature or assessment triggered.
CREATE TABLE enkyron_crm_proposal_drafts (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 5 AND 160),
  scope_text TEXT NOT NULL CHECK (length(btrim(scope_text)) BETWEEN 20 AND 5000),
  currency CHAR(3) NOT NULL CHECK (currency IN ('GBP','EUR','USD')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor BETWEEN 1 AND 999999999),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>=1),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_proposal_opportunity_scope
    FOREIGN KEY (workspace_key,opportunity_id)
    REFERENCES enkyron_crm_opportunities(workspace_key,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_proposal_drafts_list
  ON enkyron_crm_proposal_drafts(workspace_key,updated_at DESC,id DESC);
CREATE INDEX idx_enkyron_proposal_drafts_opportunity
  ON enkyron_crm_proposal_drafts(workspace_key,opportunity_id,updated_at DESC,id DESC);
CREATE UNIQUE INDEX idx_enkyron_proposal_draft_workspace_id
  ON enkyron_crm_proposal_drafts(workspace_key,id);

CREATE TABLE enkyron_crm_proposal_draft_events (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision>=1),
  event_type TEXT NOT NULL CHECK (event_type IN ('created','edited')),
  content_sha256 CHAR(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  actor_local TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_key,proposal_id,revision),
  CONSTRAINT enkyron_proposal_event_scoped_draft
    FOREIGN KEY (workspace_key,proposal_id)
    REFERENCES enkyron_crm_proposal_drafts(workspace_key,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_proposal_draft_events
  ON enkyron_crm_proposal_draft_events(workspace_key,proposal_id,revision DESC);
CREATE TRIGGER enkyron_crm_proposal_events_no_modify
  BEFORE UPDATE OR DELETE ON enkyron_crm_proposal_draft_events
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
