-- AgentRiskLayer Risk Knowledge Asset v1.1
-- Additive operational metadata, structured applicability and project evidence readiness.
-- Migration 011 follows the v1 schema and seed migrations 009 and 010.

CREATE TABLE IF NOT EXISTS risk_knowledge_applicability_rules (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE CASCADE,
  clause_index INTEGER NOT NULL,
  predicate_index INTEGER NOT NULL,
  source_label TEXT NOT NULL,
  clause_match TEXT NOT NULL CHECK (clause_match IN ('all','any','manual')),
  fact_key TEXT,
  operator TEXT NOT NULL DEFAULT 'eq' CHECK (operator IN ('eq','in','exists')),
  expected_value_json TEXT,
  derivation_status TEXT NOT NULL CHECK (derivation_status IN ('derived_from_existing_label','manual_review_required')),
  unknown_behavior TEXT NOT NULL DEFAULT 'include_for_review' CHECK (unknown_behavior IN ('include_for_review','exclude','fail_closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entry_id, clause_index, predicate_index)
);

CREATE TABLE IF NOT EXISTS risk_knowledge_operational_metadata (
  entry_id TEXT PRIMARY KEY REFERENCES risk_knowledge_entries(id) ON DELETE CASCADE,
  test_mode TEXT NOT NULL CHECK (test_mode IN ('automated','hybrid','manual')),
  test_families_json TEXT NOT NULL DEFAULT '[]',
  automation_status TEXT NOT NULL CHECK (automation_status IN ('verified','candidate','unsupported')),
  remediation_effort TEXT NOT NULL CHECK (remediation_effort IN ('low','medium','high','unestimated')),
  evidence_types_json TEXT NOT NULL DEFAULT '[]',
  review_interval_days INTEGER NOT NULL CHECK (review_interval_days BETWEEN 1 AND 730),
  machine_rule_status TEXT NOT NULL CHECK (machine_rule_status IN ('not_defined','candidate','verified','deprecated')),
  machine_rule_json TEXT,
  control_dependencies_json TEXT NOT NULL DEFAULT '[]',
  customer_validation_status TEXT NOT NULL CHECK (customer_validation_status IN ('unvalidated','interview_supported','customer_observed','independently_reviewed')),
  export_capabilities_json TEXT NOT NULL DEFAULT '{}',
  content_digest TEXT NOT NULL CHECK (length(content_digest) = 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Summary state only. Findings, evidence, remediation and retests remain in the existing workflow tables
-- and are connected through risk_knowledge_links.
CREATE TABLE IF NOT EXISTS project_risk_knowledge_states (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  applicability_status TEXT NOT NULL DEFAULT 'unknown' CHECK (applicability_status IN ('unknown','applicable','not_applicable')),
  applicability_reason TEXT NOT NULL DEFAULT '',
  architecture_facts_digest TEXT CHECK (architecture_facts_digest IS NULL OR length(architecture_facts_digest) = 64),
  evidence_state TEXT NOT NULL DEFAULT 'not_assessed' CHECK (evidence_state IN (
    'not_assessed','declared','observed','test_passed','finding_open',
    'remediation_in_progress','retest_passed','risk_accepted','expired'
  )),
  deployment_gate TEXT NOT NULL DEFAULT 'review_required' CHECK (deployment_gate IN ('review_required','hold','do_not_deploy','proceed_candidate')),
  critical_gate_failed INTEGER NOT NULL DEFAULT 0 CHECK (critical_gate_failed IN (0,1)),
  state_reason TEXT NOT NULL DEFAULT '',
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  last_assessed_at TEXT,
  assessed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_risk_knowledge_applicability_fact
  ON risk_knowledge_applicability_rules(fact_key, entry_id);
CREATE INDEX IF NOT EXISTS idx_risk_knowledge_operational_filter
  ON risk_knowledge_operational_metadata(test_mode, automation_status, customer_validation_status);
CREATE INDEX IF NOT EXISTS idx_project_risk_knowledge_state_project
  ON project_risk_knowledge_states(project_id, applicability_status, evidence_state);
CREATE INDEX IF NOT EXISTS idx_project_risk_knowledge_state_gate
  ON project_risk_knowledge_states(project_id, critical_gate_failed, deployment_gate);
