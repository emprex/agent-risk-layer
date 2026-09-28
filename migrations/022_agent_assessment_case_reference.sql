ALTER TABLE security_projects
  ADD COLUMN IF NOT EXISTS agent_assessment_reference TEXT;

DROP INDEX IF EXISTS idx_security_projects_repository_identity_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_projects_repository_identity_case_active
  ON security_projects(
    workspace_id,
    repository_identity_digest,
    COALESCE(agent_assessment_reference, '')
  )
  WHERE repository_identity_digest IS NOT NULL
    AND status != 'archived';

CREATE INDEX IF NOT EXISTS idx_security_projects_agent_assessment_reference
  ON security_projects(agent_assessment_reference)
  WHERE agent_assessment_reference IS NOT NULL;
