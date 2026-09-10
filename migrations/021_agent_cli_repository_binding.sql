ALTER TABLE security_projects ADD COLUMN IF NOT EXISTS repository_identity_digest TEXT;
ALTER TABLE security_projects ADD COLUMN IF NOT EXISTS repository_identity_source TEXT;
ALTER TABLE security_projects ADD COLUMN IF NOT EXISTS agent_assessment_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_projects_repository_identity_active
  ON security_projects(workspace_id, repository_identity_digest)
  WHERE repository_identity_digest IS NOT NULL AND status != 'archived';

CREATE INDEX IF NOT EXISTS idx_security_projects_agent_assessment
  ON security_projects(agent_assessment_id)
  WHERE agent_assessment_id IS NOT NULL;
