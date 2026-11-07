-- 068: Operator-led follow-up pipeline for historical prospect research.
-- Additive: does not rewrite/import/promote sales_prospects or send emails.
-- One follow-up opportunity per candidate and local OS workspace (not remote RBAC).
CREATE TABLE enkyron_crm_opportunities (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  prospect_id TEXT NOT NULL REFERENCES sales_prospects(id) ON DELETE RESTRICT,
  company_name_at_creation TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'research'
    CHECK (stage IN ('research','qualified','contact_planned','contacted',
                    'discovery','proposal','negotiation','won','lost')),
  next_action TEXT NOT NULL CHECK (length(btrim(next_action)) BETWEEN 5 AND 1000),
  due_date DATE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  owner_local TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_key,prospect_id)
);
CREATE INDEX idx_enkyron_crm_opportunities_due
  ON enkyron_crm_opportunities(workspace_key,due_date,updated_at DESC,id);
CREATE INDEX idx_enkyron_crm_opportunities_stage
  ON enkyron_crm_opportunities(workspace_key,stage,updated_at DESC,id);

CREATE TABLE enkyron_crm_opportunity_events (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES enkyron_crm_opportunities(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','updated')),
  old_stage TEXT,
  new_stage TEXT NOT NULL,
  old_next_action TEXT,
  new_next_action TEXT NOT NULL,
  old_due_date DATE,
  new_due_date DATE,
  actor_local TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_enkyron_crm_opportunity_events
  ON enkyron_crm_opportunity_events(workspace_key,opportunity_id,created_at DESC,id);

-- Events cannot be silently deleted or changed by the ordinary application role.
CREATE TRIGGER enkyron_crm_opportunity_events_no_modify
  BEFORE UPDATE OR DELETE ON enkyron_crm_opportunity_events
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
