-- 105: CRM company-level dated follow-ups; no artificial commercial opportunity.
-- Additive, isolated to the local OS operator workspace. No emails are sent.
CREATE TABLE enkyron_crm_company_followups (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  company_id TEXT NOT NULL,
  action_text TEXT NOT NULL CHECK (length(btrim(action_text)) BETWEEN 5 AND 1000),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','completed','cancelled')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_crm_company_followup_unique_scope UNIQUE(workspace_key,id),
  CONSTRAINT enkyron_crm_company_followup_parent
    FOREIGN KEY(workspace_key,company_id)
    REFERENCES enkyron_crm_companies(workspace_key,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_company_followups_due
  ON enkyron_crm_company_followups(workspace_key,status,due_date,id);
CREATE INDEX idx_enkyron_crm_company_followups_parent
  ON enkyron_crm_company_followups(workspace_key,company_id,due_date,id);
CREATE TABLE enkyron_crm_company_followup_events (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  followup_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  event_type TEXT NOT NULL CHECK(event_type IN ('created','updated')),
  old_action_text TEXT,
  new_action_text TEXT NOT NULL,
  old_due_date DATE,
  new_due_date DATE NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  actor_local TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_key,followup_id,version),
  CONSTRAINT enkyron_crm_company_followup_event_parent
    FOREIGN KEY(workspace_key,followup_id)
    REFERENCES enkyron_crm_company_followups(workspace_key,id)
    ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_company_followup_events
  ON enkyron_crm_company_followup_events(workspace_key,followup_id,version);
CREATE TRIGGER enkyron_crm_company_followup_events_no_modify
  BEFORE UPDATE OR DELETE ON enkyron_crm_company_followup_events
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
