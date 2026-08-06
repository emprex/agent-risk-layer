-- AgentRiskLayer Control Intelligence Graph v1.
-- Additive relational bindings over existing projects, controls, runtime evidence,
-- approvals, remediation and retest records. No existing record is rewritten.

CREATE TABLE IF NOT EXISTS system_snapshots (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  version_identifier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded')),
  architecture_json TEXT NOT NULL,
  models_json TEXT NOT NULL DEFAULT '[]',
  tools_json TEXT NOT NULL DEFAULT '[]',
  identities_json TEXT NOT NULL DEFAULT '[]',
  data_sources_json TEXT NOT NULL DEFAULT '[]',
  network_access_json TEXT NOT NULL DEFAULT '[]',
  autonomy_level TEXT NOT NULL DEFAULT 'unknown',
  approval_configuration_json TEXT NOT NULL DEFAULT '{}',
  runtime_policy_version TEXT,
  runtime_policy_digest TEXT,
  assessment_configuration_json TEXT NOT NULL DEFAULT '{}',
  content_digest TEXT NOT NULL CHECK (length(content_digest)=64),
  source TEXT NOT NULL DEFAULT 'manual',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, version_identifier),
  UNIQUE(project_id, content_digest)
);

CREATE TABLE IF NOT EXISTS control_snapshot_evaluations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  control_profile_version TEXT NOT NULL,
  entry_digest TEXT NOT NULL CHECK (length(entry_digest)=64),
  applicability_status TEXT NOT NULL CHECK (applicability_status IN ('unknown','applicable','not_applicable')),
  applicability_reason TEXT NOT NULL,
  contextual_severity TEXT CHECK (contextual_severity IN ('low','medium','high','critical')),
  severity_status TEXT NOT NULL CHECK (severity_status IN ('not_evaluated','evaluated','not_applicable','insufficient_information')),
  evaluator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  decision_method TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  stale_at TEXT,
  UNIQUE(system_snapshot_id, entry_id)
);

CREATE TABLE IF NOT EXISTS control_test_executions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE RESTRICT,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  check_id TEXT NOT NULL REFERENCES risk_knowledge_checks(id) ON DELETE RESTRICT,
  check_digest TEXT NOT NULL CHECK (length(check_digest)=64),
  execution_method TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('planned','passed','failed','inconclusive')),
  expected_result TEXT NOT NULL,
  observed_result TEXT NOT NULL,
  input_reference TEXT,
  limitations TEXT NOT NULL DEFAULT '',
  failure_reason TEXT,
  finding_id TEXT REFERENCES remediation_items(id) ON DELETE SET NULL,
  executor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  content_digest TEXT NOT NULL CHECK (length(content_digest)=64),
  descriptor_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS control_evidence_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE RESTRICT,
  entry_id TEXT REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  test_execution_id TEXT REFERENCES control_test_executions(id) ON DELETE CASCADE,
  finding_id TEXT REFERENCES remediation_items(id) ON DELETE SET NULL,
  evidence_class TEXT NOT NULL CHECK (evidence_class IN ('declared','observed','test_generated','runtime','human_provided','imported')),
  source_type TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  runtime_event_id TEXT REFERENCES runtime_events(id) ON DELETE SET NULL,
  approval_id TEXT REFERENCES runtime_approvals(id) ON DELETE SET NULL,
  remediation_artifact_id TEXT REFERENCES remediation_evidence_artifacts(id) ON DELETE SET NULL,
  observed_at TEXT NOT NULL,
  collector_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  integrity_digest TEXT NOT NULL CHECK (length(integrity_digest)=64),
  descriptor_json TEXT NOT NULL,
  sensitivity_classification TEXT NOT NULL DEFAULT 'internal',
  retention_status TEXT NOT NULL DEFAULT 'active' CHECK (retention_status IN ('active','expired','legal_hold','deleted_source')),
  verification_state TEXT NOT NULL CHECK (verification_state IN ('declared','unverified','verified','invalid','stale')),
  limitations TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS control_deployment_decisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE RESTRICT,
  control_profile_version TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('proceed','hold','do_not_deploy')),
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','stale','expired')),
  rationale TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  decision_method TEXT NOT NULL,
  decision_maker_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  decision_digest TEXT NOT NULL CHECK (length(decision_digest)=64),
  decided_at TEXT NOT NULL,
  expires_at TEXT,
  reassessment_trigger TEXT
);

CREATE TABLE IF NOT EXISTS deployment_decision_evidence (
  decision_id TEXT NOT NULL REFERENCES control_deployment_decisions(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES control_evidence_items(id) ON DELETE RESTRICT,
  relationship TEXT NOT NULL CHECK (relationship IN ('supports','blocks','context')),
  PRIMARY KEY(decision_id,evidence_id,relationship)
);

CREATE TABLE IF NOT EXISTS control_snapshot_runtime_bindings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE RESTRICT,
  entry_id TEXT REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  runtime_event_id TEXT REFERENCES runtime_events(id) ON DELETE CASCADE,
  approval_id TEXT REFERENCES runtime_approvals(id) ON DELETE CASCADE,
  binding_type TEXT NOT NULL CHECK (binding_type IN ('runtime_decision','exact_action_approval')),
  created_at TEXT NOT NULL,
  CHECK ((runtime_event_id IS NOT NULL AND approval_id IS NULL AND binding_type='runtime_decision') OR
         (runtime_event_id IS NULL AND approval_id IS NOT NULL AND binding_type='exact_action_approval')),
  UNIQUE(runtime_event_id),
  UNIQUE(approval_id)
);

CREATE INDEX IF NOT EXISTS idx_system_snapshots_scope ON system_snapshots(workspace_id,project_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_evaluations_scope ON control_snapshot_evaluations(workspace_id,project_id,system_snapshot_id,entry_id);
CREATE INDEX IF NOT EXISTS idx_control_evaluations_status ON control_snapshot_evaluations(project_id,system_snapshot_id,applicability_status,severity_status);
CREATE INDEX IF NOT EXISTS idx_control_test_scope ON control_test_executions(workspace_id,project_id,system_snapshot_id,entry_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_evidence_scope ON control_evidence_items(workspace_id,project_id,system_snapshot_id,entry_id,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_evidence_execution ON control_evidence_items(test_execution_id,verification_state);
CREATE INDEX IF NOT EXISTS idx_control_decisions_scope ON control_deployment_decisions(workspace_id,project_id,system_snapshot_id,status,decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_runtime_binding_scope ON control_snapshot_runtime_bindings(workspace_id,project_id,system_snapshot_id,entry_id,created_at DESC);
