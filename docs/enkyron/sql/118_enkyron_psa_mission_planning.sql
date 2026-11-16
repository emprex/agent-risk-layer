-- ENK-08: additive local PSA MISSION PLANNING only. REVIEW ONLY; NOT DEPLOYED.
-- This migration must never be auto-applied to arl_local while preflight is STOP.
-- No existing CRM, assessment, task, mail, invoice or contract data is changed.
-- An opportunity's stage (including won) never proves a signed SOW or test authority.

-- Keep a durable same-workspace + same-company foreign key for linked opportunities.
-- This also prevents later relocation of a linked opportunity across companies.
CREATE UNIQUE INDEX enkyron_crm_opportunities_psa_company_scope
  ON enkyron_crm_opportunities(workspace_key, company_id, id);

CREATE TABLE enkyron_psa_missions (
  id UUID PRIMARY KEY,
  workspace_key TEXT NOT NULL
    CHECK(workspace_key ~ '^local:[A-Za-z0-9_.-]{1,80}$'),
  company_id TEXT NOT NULL,
  opportunity_id TEXT,
  title TEXT NOT NULL CHECK(char_length(btrim(title)) BETWEEN 5 AND 160),
  description TEXT NOT NULL CHECK(char_length(btrim(description)) BETWEEN 20 AND 2000),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'planning' CHECK(status = 'planning'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  request_id UUID NOT NULL,
  content_sha256 CHAR(64) NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by TEXT NOT NULL CHECK(created_by ~ '^[A-Za-z0-9_.-]{1,80}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_key, id),
  UNIQUE(workspace_key, request_id),
  FOREIGN KEY(workspace_key, company_id)
    REFERENCES enkyron_crm_companies(workspace_key, id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_key, company_id, opportunity_id)
    REFERENCES enkyron_crm_opportunities(workspace_key, company_id, id) ON DELETE RESTRICT
);
CREATE INDEX enkyron_psa_mission_company_list
  ON enkyron_psa_missions(workspace_key, company_id, created_at DESC, id);
CREATE INDEX enkyron_psa_mission_workspace_list
  ON enkyron_psa_missions(workspace_key, created_at DESC, id);

CREATE TABLE enkyron_psa_mission_events (
  id UUID PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  mission_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  event_type TEXT NOT NULL CHECK(event_type = 'created'),
  request_id UUID NOT NULL,
  content_sha256 CHAR(64) NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  actor_local TEXT NOT NULL CHECK(actor_local ~ '^[A-Za-z0-9_.-]{1,80}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_key,mission_id,version),
  UNIQUE(workspace_key,request_id),
  FOREIGN KEY(workspace_key,mission_id)
    REFERENCES enkyron_psa_missions(workspace_key,id) ON DELETE RESTRICT
);
CREATE INDEX enkyron_psa_mission_events_lookup
  ON enkyron_psa_mission_events(workspace_key,mission_id,version);
CREATE TRIGGER enkyron_psa_mission_events_immutable
  BEFORE UPDATE OR DELETE ON enkyron_psa_mission_events
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
