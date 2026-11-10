-- UX-15A local application display profile, not an authentication credential.
-- Intentionally separate from the Linux actor/workspace_key and the legal issuer profile.
-- A self-declared title or owner role NEVER grants or bypasses permissions.
CREATE TABLE enkyron_operator_personal_profiles (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 120),
  job_title TEXT NOT NULL CHECK (char_length(job_title) BETWEEN 2 AND 100),
  organization_display TEXT NOT NULL CHECK (char_length(organization_display) BETWEEN 2 AND 160),
  work_email TEXT CHECK (work_email IS NULL OR char_length(work_email) BETWEEN 3 AND 254),
  declared_role TEXT NOT NULL DEFAULT 'founder_owner_unverified'
    CHECK (declared_role = 'founder_owner_unverified'),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_key, revision)
);
CREATE INDEX idx_enkyron_operator_personal_profiles_latest
  ON enkyron_operator_personal_profiles (workspace_key, revision DESC);
CREATE TRIGGER enkyron_operator_personal_profiles_immutable
  BEFORE UPDATE OR DELETE ON enkyron_operator_personal_profiles
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
