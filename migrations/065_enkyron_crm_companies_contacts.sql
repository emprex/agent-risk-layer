-- 065: ENKYRON local CRM foundation. No legacy prospect/ticket changes or imports.
-- One local OS operator only: workspace_key is NOT remote authentication/RBAC.
-- Later distributed deployments MUST replace local authority with authenticated tenant policy.
CREATE TABLE enkyron_crm_companies (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  legal_name TEXT,
  sector TEXT,
  city TEXT,
  country TEXT,
  website TEXT,
  relationship_state TEXT NOT NULL DEFAULT 'prospect'
    CHECK (relationship_state IN ('prospect','client','former_client','inactive')),
  source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual','legacy_prospect_verified')),
  legacy_prospect_id TEXT REFERENCES sales_prospects(id) ON DELETE RESTRICT,
  owner_local TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_key,id),
  UNIQUE (workspace_key,legacy_prospect_id),
  CHECK (source_type <> 'legacy_prospect_verified' OR legacy_prospect_id IS NOT NULL)
);

CREATE TABLE enkyron_crm_contacts (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  company_id TEXT NOT NULL,
  full_name TEXT NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 160),
  job_title TEXT,
  email TEXT,
  phone TEXT,
  relationship_state TEXT NOT NULL DEFAULT 'unverified'
    CHECK (relationship_state IN ('unverified','confirmed','inactive')),
  marketing_permission TEXT NOT NULL DEFAULT 'unknown'
    CHECK (marketing_permission IN ('unknown','opt_in','opt_out')),
  owner_local TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (workspace_key,company_id)
    REFERENCES enkyron_crm_companies(workspace_key,id) ON DELETE RESTRICT
);

CREATE TABLE enkyron_crm_events (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('company','contact')),
  resource_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','linked','updated')),
  actor_local TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_enkyron_crm_company_search
  ON enkyron_crm_companies(workspace_key,name,id);
CREATE INDEX idx_enkyron_crm_contact_company
  ON enkyron_crm_contacts(workspace_key,company_id,full_name,id);
CREATE INDEX idx_enkyron_crm_events_resource
  ON enkyron_crm_events(workspace_key,resource_kind,resource_id,created_at DESC);

-- CRM audit history is append-only even if the same local SQL role tries to edit it.
CREATE FUNCTION enkyron_crm_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ENKYRON CRM events cannot be changed or deleted';
END;
$$;
CREATE TRIGGER enkyron_crm_events_no_modify
  BEFORE UPDATE OR DELETE ON enkyron_crm_events
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
