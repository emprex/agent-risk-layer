-- ENKYRON UX-15B1: identity registry only. NO authentication or rights activated.
-- Keep local:emprex and the earlier CRM recorded_by values unchanged.
-- Two application principals may refer to the same human being. They are not
-- two independent human reviewers. No automatic bootstrap or user creation.
CREATE TABLE enkyron_identity_people (
  id UUID PRIMARY KEY,
  workspace_key TEXT NOT NULL CHECK (workspace_key ~ '^local:[A-Za-z0-9_.-]{1,80}$'),
  organization_id TEXT NOT NULL CHECK (char_length(organization_id) BETWEEN 2 AND 160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, workspace_key, organization_id)
);
CREATE TABLE enkyron_identity_principals (
  id UUID PRIMARY KEY,
  person_id UUID NOT NULL,
  workspace_key TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  login_name TEXT NOT NULL CHECK (login_name ~ '^[a-z][a-z0-9._-]{1,79}$'),
  role TEXT NOT NULL CHECK (role IN (
    'service_desk_l1', 'technical_support_l2', 'security_engineer_l3',
    'supervisor_l4', 'organization_owner_l5', 'developer_privileged',
    'client_portal_user'
  )),
  -- A principal row alone is never an enabled account.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (person_id, workspace_key, organization_id)
    REFERENCES enkyron_identity_people (id, workspace_key, organization_id),
  UNIQUE (workspace_key, organization_id, login_name),
  UNIQUE (workspace_key, organization_id, person_id, role)
);
CREATE TABLE enkyron_identity_status_events (
  sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id UUID NOT NULL UNIQUE,
  principal_id UUID NOT NULL REFERENCES enkyron_identity_principals(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('activated', 'disabled', 'revoked')),
  actor_principal_id UUID REFERENCES enkyron_identity_principals(id),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER enkyron_identity_people_immutable
  BEFORE UPDATE OR DELETE ON enkyron_identity_people
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
CREATE TRIGGER enkyron_identity_principals_immutable
  BEFORE UPDATE OR DELETE ON enkyron_identity_principals
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
CREATE TRIGGER enkyron_identity_status_events_immutable
  BEFORE UPDATE OR DELETE ON enkyron_identity_status_events
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();

-- A pending principal has no status event. Authenticated service enforcement
-- is a later requirement, and may not trust any client-supplied principal ID.
CREATE VIEW enkyron_identity_principal_effective AS
  SELECT p.id, p.person_id, p.workspace_key, p.organization_id,
         p.login_name, p.role, p.created_at,
         COALESCE(
           CASE latest.event_type
             WHEN 'activated' THEN 'active'
             WHEN 'disabled' THEN 'disabled'
             WHEN 'revoked' THEN 'revoked'
           END, 'pending') AS effective_status
  FROM enkyron_identity_principals p
  LEFT JOIN LATERAL (
    SELECT event_type
    FROM enkyron_identity_status_events e
    WHERE e.principal_id = p.id
    ORDER BY e.sequence DESC LIMIT 1
  ) latest ON true;
