-- 114: Versioned ENKYRON technical scope and permission review.
-- Documentary review ONLY: a row does not create canonical active-test authorisation.
-- Do not rewrite ticket intake, canonical snapshots, prior Master or control verdicts.
CREATE TABLE enkyron_ticket_scope_reviews (
  id UUID PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES arl_workbench_tickets(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE RESTRICT,
  assessment_id TEXT NOT NULL,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE RESTRICT,
  target_sha TEXT NOT NULL CHECK (target_sha ~ '^[0-9a-f]{40}$'),
  decision TEXT NOT NULL CHECK (decision IN (
    'scope_draft','read_only_scope_reviewed','active_test_authorisation_pending'
  )),
  technical_owner TEXT NOT NULL CHECK (char_length(btrim(technical_owner)) BETWEEN 2 AND 160),
  owner_authority_basis TEXT NOT NULL CHECK (char_length(btrim(owner_authority_basis)) BETWEEN 20 AND 1000),
  included_scope TEXT NOT NULL CHECK (char_length(btrim(included_scope)) BETWEEN 30 AND 3000),
  excluded_scope TEXT NOT NULL CHECK (char_length(btrim(excluded_scope)) BETWEEN 15 AND 2000),
  environment TEXT NOT NULL CHECK (char_length(btrim(environment)) BETWEEN 5 AND 500),
  permitted_methods TEXT NOT NULL CHECK (char_length(btrim(permitted_methods)) BETWEEN 20 AND 2000),
  prohibited_methods TEXT NOT NULL CHECK (char_length(btrim(prohibited_methods)) BETWEEN 20 AND 2000),
  rules_of_engagement TEXT NOT NULL CHECK (char_length(btrim(rules_of_engagement)) BETWEEN 40 AND 3000),
  owner_permission_reference TEXT NOT NULL DEFAULT '' CHECK (char_length(owner_permission_reference) <= 500),
  rationale TEXT NOT NULL CHECK (char_length(btrim(rationale)) BETWEEN 30 AND 1200),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(ticket_id,revision)
);
CREATE INDEX enkyron_ticket_scope_reviews_latest ON
  enkyron_ticket_scope_reviews(ticket_id,revision DESC);
CREATE TRIGGER enkyron_ticket_scope_reviews_immutable
  BEFORE UPDATE OR DELETE ON enkyron_ticket_scope_reviews
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
