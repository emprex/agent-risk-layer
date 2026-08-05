-- AgentRiskLayer Risk Knowledge Asset
-- Migration 009 follows the verified archive baseline ending at 008_runtime_approval_integrity.sql.
-- Additive only: creates new tables and indexes without rewriting existing customer data.

CREATE TABLE IF NOT EXISTS risk_knowledge_entries (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  knowledge_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','deprecated')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  problem_json TEXT NOT NULL,
  evidence_chain_json TEXT NOT NULL,
  review_json TEXT NOT NULL,
  claims_boundary TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (length(content_digest) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_knowledge_checks (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE CASCADE,
  objective TEXT NOT NULL,
  method TEXT NOT NULL,
  check_types_json TEXT NOT NULL DEFAULT '[]',
  required_evidence_json TEXT NOT NULL DEFAULT '[]',
  pass_condition TEXT NOT NULL,
  fail_condition TEXT NOT NULL,
  limitations TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (length(content_digest) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_knowledge_solutions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE CASCADE,
  control_objective TEXT NOT NULL,
  recommended_remediation TEXT NOT NULL,
  default_owner TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('P0','P1','P2','P3')),
  implementation_principles_json TEXT NOT NULL DEFAULT '[]',
  monitoring TEXT NOT NULL,
  containment TEXT NOT NULL,
  retest_acceptance_json TEXT NOT NULL DEFAULT '[]',
  content_digest TEXT NOT NULL CHECK (length(content_digest) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_knowledge_references (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  version TEXT NOT NULL,
  url TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  use_statement TEXT NOT NULL,
  licence_note TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (length(content_digest) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_knowledge_mappings (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE CASCADE,
  reference_id TEXT REFERENCES risk_knowledge_references(id) ON DELETE SET NULL,
  framework TEXT NOT NULL,
  framework_version TEXT NOT NULL,
  framework_reference TEXT NOT NULL,
  mapping_status TEXT NOT NULL DEFAULT 'informative' CHECK (mapping_status IN ('informative','reviewed','deprecated')),
  mapping_limit TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entry_id, framework, framework_version, framework_reference)
);

-- Polymorphic bridge to existing AgentRiskLayer workflow objects.
-- subject_id remains polymorphic; workspace/project FKs preserve tenant context.
CREATE TABLE IF NOT EXISTS risk_knowledge_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL CHECK (subject_type IN (
    'assessment_finding','inspection_finding','redteam_case','runtime_event',
    'approval','remediation','retest','deployment_decision','evidence_artifact'
  )),
  subject_id TEXT NOT NULL,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  link_role TEXT NOT NULL DEFAULT 'primary' CHECK (link_role IN ('primary','related','control','retest')),
  knowledge_version TEXT NOT NULL,
  entry_digest TEXT NOT NULL CHECK (length(entry_digest) = 64),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, subject_type, subject_id, entry_id, link_role)
);

CREATE INDEX IF NOT EXISTS idx_risk_knowledge_entries_category
  ON risk_knowledge_entries(status, category, title);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_entries_version
  ON risk_knowledge_entries(knowledge_version, status);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_checks_entry
  ON risk_knowledge_checks(entry_id);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_solutions_entry
  ON risk_knowledge_solutions(entry_id);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_mappings_entry
  ON risk_knowledge_mappings(entry_id, framework);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_links_project
  ON risk_knowledge_links(project_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_links_entry
  ON risk_knowledge_links(entry_id, knowledge_version);
