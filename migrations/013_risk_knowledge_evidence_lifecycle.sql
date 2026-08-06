-- ARL-RKA-1.2 additive validation, predicate provenance and contextual risk records.
CREATE TABLE IF NOT EXISTS risk_knowledge_validation_records (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE CASCADE,
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('candidate','internally_reviewed','customer_exercised','independently_reviewed','verified_automation','deprecated','retired')),
  knowledge_version TEXT NOT NULL,
  reviewer_name TEXT,
  reviewer_organisation TEXT,
  reviewed_at TEXT,
  evidence_reference TEXT,
  assessment_id TEXT REFERENCES assessments(id) ON DELETE RESTRICT,
  supersedes_id TEXT REFERENCES risk_knowledge_validation_records(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK (lifecycle_status NOT IN ('customer_exercised','independently_reviewed','verified_automation') OR (reviewed_at IS NOT NULL AND evidence_reference IS NOT NULL)),
  CHECK (lifecycle_status <> 'customer_exercised' OR assessment_id IS NOT NULL),
  CHECK (lifecycle_status <> 'independently_reviewed' OR reviewer_name IS NOT NULL OR reviewer_organisation IS NOT NULL),
  UNIQUE(entry_id, knowledge_version)
);

CREATE TABLE IF NOT EXISTS risk_knowledge_predicate_registry (
  fact_key TEXT PRIMARY KEY,
  classification TEXT NOT NULL CHECK (classification IN ('user-answerable','derived-from-answer','system-observed','project-metadata-derived','manual-review-only')),
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  display_condition_json TEXT NOT NULL DEFAULT '{}',
  justification TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_risk_context (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  asset_sensitivity TEXT NOT NULL DEFAULT 'unknown',
  reachable_systems_json TEXT NOT NULL DEFAULT '[]',
  action_impact TEXT NOT NULL DEFAULT 'unknown',
  data_classification TEXT NOT NULL DEFAULT 'unknown',
  user_population TEXT NOT NULL DEFAULT 'unknown',
  exploitability TEXT NOT NULL DEFAULT 'unknown',
  reversibility TEXT NOT NULL DEFAULT 'unknown',
  exposure TEXT NOT NULL DEFAULT 'unknown',
  compensating_controls_json TEXT NOT NULL DEFAULT '[]',
  observed_evidence_json TEXT NOT NULL DEFAULT '[]',
  residual_risk TEXT NOT NULL DEFAULT 'unknown',
  project_severity TEXT NOT NULL DEFAULT 'unassessed' CHECK (project_severity IN ('unassessed','low','medium','high','critical')),
  rationale TEXT NOT NULL DEFAULT '',
  assessed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  assessed_at TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, entry_id)
);

CREATE TABLE IF NOT EXISTS risk_knowledge_entry_classification (
  entry_id TEXT PRIMARY KEY REFERENCES risk_knowledge_entries(id) ON DELETE CASCADE,
  default_severity TEXT NOT NULL CHECK (default_severity IN ('low','medium','high','critical')),
  active_state TEXT NOT NULL CHECK (active_state IN ('draft','active','deprecated')),
  review_date TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_risk_knowledge_validation_status ON risk_knowledge_validation_records(lifecycle_status, reviewed_at, entry_id);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_validation_version ON risk_knowledge_validation_records(knowledge_version, entry_id);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_predicate_class ON risk_knowledge_predicate_registry(classification, active, fact_key);
CREATE INDEX IF NOT EXISTS idx_project_risk_context_scope ON project_risk_context(workspace_id, project_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_project_risk_context_severity ON project_risk_context(project_id, project_severity);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_active_review ON risk_knowledge_entries(status, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_severity ON risk_knowledge_entry_classification(active_state, default_severity, entry_id);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_review_date ON risk_knowledge_entry_classification(review_date, entry_id);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_owner ON risk_knowledge_solutions(default_owner, entry_id);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_framework ON risk_knowledge_mappings(framework, framework_version, entry_id);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_test_mode ON risk_knowledge_operational_metadata(test_mode, entry_id);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_project_links ON risk_knowledge_links(project_id, entry_id, knowledge_version);
