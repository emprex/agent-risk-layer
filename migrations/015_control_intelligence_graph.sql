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
  descriptor_json TEXT NOT NULL,
  UNIQUE(project_id, version_identifier),
  UNIQUE(project_id, content_digest),
  UNIQUE(id,workspace_id,project_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_snapshots_one_current
  ON system_snapshots(project_id) WHERE status='current';

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
  descriptor_json TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (length(content_digest)=64),
  UNIQUE(system_snapshot_id, entry_id),
  UNIQUE(id,workspace_id,project_id,system_snapshot_id,entry_id),
  FOREIGN KEY(system_snapshot_id,workspace_id,project_id) REFERENCES system_snapshots(id,workspace_id,project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS control_test_executions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE RESTRICT,
  evaluation_id TEXT NOT NULL,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  check_id TEXT NOT NULL REFERENCES risk_knowledge_checks(id) ON DELETE RESTRICT,
  check_digest TEXT NOT NULL CHECK (length(check_digest)=64),
  execution_kind TEXT NOT NULL DEFAULT 'initial' CHECK (execution_kind IN ('initial','retest')),
  retest_of_execution_id TEXT REFERENCES control_test_executions(id) ON DELETE RESTRICT,
  remediation_id TEXT REFERENCES remediation_items(id) ON DELETE RESTRICT,
  original_snapshot_id TEXT REFERENCES system_snapshots(id) ON DELETE RESTRICT,
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
  created_at TEXT NOT NULL,
  UNIQUE(id,workspace_id,project_id,system_snapshot_id),
  UNIQUE(id,workspace_id,project_id,system_snapshot_id,entry_id),
  FOREIGN KEY(evaluation_id,workspace_id,project_id,system_snapshot_id,entry_id)
    REFERENCES control_snapshot_evaluations(id,workspace_id,project_id,system_snapshot_id,entry_id) ON DELETE RESTRICT,
  CHECK ((execution_kind='initial' AND retest_of_execution_id IS NULL AND remediation_id IS NULL AND original_snapshot_id IS NULL) OR
         (execution_kind='retest' AND retest_of_execution_id IS NOT NULL AND finding_id IS NOT NULL AND remediation_id IS NOT NULL AND original_snapshot_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS control_evidence_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE RESTRICT,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  test_execution_id TEXT REFERENCES control_test_executions(id) ON DELETE CASCADE,
  finding_id TEXT REFERENCES remediation_items(id) ON DELETE SET NULL,
  evidence_class TEXT NOT NULL CHECK (evidence_class IN ('declared','observed','test_generated','runtime','human_provided','imported')),
  source_type TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  runtime_event_id TEXT REFERENCES runtime_events(id) ON DELETE SET NULL,
  approval_id TEXT REFERENCES runtime_approvals(id) ON DELETE SET NULL,
  remediation_artifact_id TEXT REFERENCES remediation_evidence_artifacts(id) ON DELETE SET NULL,
  remediation_id TEXT REFERENCES remediation_items(id) ON DELETE SET NULL,
  observed_at TEXT NOT NULL,
  collector_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  integrity_digest TEXT NOT NULL CHECK (length(integrity_digest)=64),
  descriptor_json TEXT NOT NULL,
  sensitivity_classification TEXT NOT NULL DEFAULT 'internal',
  retention_status TEXT NOT NULL DEFAULT 'active' CHECK (retention_status IN ('active','expired','legal_hold','deleted_source')),
  verification_state TEXT NOT NULL CHECK (verification_state IN ('declared','unverified','verified','invalid','stale')),
  limitations TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(id,workspace_id,project_id,system_snapshot_id),
  UNIQUE(id,workspace_id,project_id,system_snapshot_id,entry_id),
  FOREIGN KEY(system_snapshot_id,workspace_id,project_id) REFERENCES system_snapshots(id,workspace_id,project_id) ON DELETE RESTRICT,
  FOREIGN KEY(test_execution_id,workspace_id,project_id,system_snapshot_id,entry_id)
    REFERENCES control_test_executions(id,workspace_id,project_id,system_snapshot_id,entry_id) ON DELETE CASCADE
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
  ,supersedes_decision_id TEXT REFERENCES control_deployment_decisions(id) ON DELETE RESTRICT
  ,descriptor_json TEXT NOT NULL
  ,UNIQUE(id,workspace_id,project_id,system_snapshot_id)
  ,FOREIGN KEY(system_snapshot_id,workspace_id,project_id) REFERENCES system_snapshots(id,workspace_id,project_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_control_decisions_one_current
  ON control_deployment_decisions(project_id,system_snapshot_id) WHERE status='current';

CREATE TABLE IF NOT EXISTS deployment_decision_evidence (
  decision_id TEXT NOT NULL REFERENCES control_deployment_decisions(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES control_evidence_items(id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE RESTRICT,
  relationship TEXT NOT NULL CHECK (relationship IN ('supports','blocks','context')),
  PRIMARY KEY(decision_id,evidence_id,relationship),
  FOREIGN KEY(decision_id,workspace_id,project_id,system_snapshot_id) REFERENCES control_deployment_decisions(id,workspace_id,project_id,system_snapshot_id) ON DELETE CASCADE,
  FOREIGN KEY(evidence_id,workspace_id,project_id,system_snapshot_id) REFERENCES control_evidence_items(id,workspace_id,project_id,system_snapshot_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS control_approval_requirements (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL,
  action_digest TEXT NOT NULL CHECK (length(action_digest)=64),
  policy_version TEXT,
  policy_digest TEXT,
  reuse_scope TEXT NOT NULL DEFAULT 'one_time' CHECK (reuse_scope IN ('one_time','bounded_reuse')),
  descriptor_json TEXT NOT NULL,
  requirement_digest TEXT NOT NULL CHECK (length(requirement_digest)=64),
  created_at TEXT NOT NULL,
  UNIQUE(system_snapshot_id,entry_id,action_digest),
  UNIQUE(id,workspace_id,project_id,system_snapshot_id,entry_id),
  FOREIGN KEY(system_snapshot_id,workspace_id,project_id) REFERENCES system_snapshots(id,workspace_id,project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS runtime_control_mappings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  rule_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  policy_digest TEXT NOT NULL CHECK (length(policy_digest)=64),
  descriptor_json TEXT NOT NULL,
  mapping_digest TEXT NOT NULL CHECK (length(mapping_digest)=64),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE(system_snapshot_id,rule_id,entry_id),
  UNIQUE(id,workspace_id,project_id,system_snapshot_id,entry_id),
  FOREIGN KEY(system_snapshot_id,workspace_id,project_id) REFERENCES system_snapshots(id,workspace_id,project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS control_snapshot_runtime_bindings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE RESTRICT,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  runtime_event_id TEXT REFERENCES runtime_events(id) ON DELETE CASCADE,
  approval_id TEXT REFERENCES runtime_approvals(id) ON DELETE CASCADE,
  approval_requirement_id TEXT REFERENCES control_approval_requirements(id) ON DELETE RESTRICT,
  attribution_mapping_id TEXT REFERENCES runtime_control_mappings(id) ON DELETE RESTRICT,
  binding_type TEXT NOT NULL CHECK (binding_type IN ('runtime_decision','exact_action_approval')),
  descriptor_json TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (length(content_digest)=64),
  created_at TEXT NOT NULL,
  CHECK ((runtime_event_id IS NOT NULL AND approval_id IS NULL AND binding_type='runtime_decision') OR
         (runtime_event_id IS NULL AND approval_id IS NOT NULL AND binding_type='exact_action_approval')),
  UNIQUE(runtime_event_id),
  UNIQUE(approval_id),
  UNIQUE(id,workspace_id,project_id,system_snapshot_id,entry_id),
  FOREIGN KEY(system_snapshot_id,workspace_id,project_id) REFERENCES system_snapshots(id,workspace_id,project_id) ON DELETE RESTRICT,
  FOREIGN KEY(approval_requirement_id,workspace_id,project_id,system_snapshot_id,entry_id) REFERENCES control_approval_requirements(id,workspace_id,project_id,system_snapshot_id,entry_id) ON DELETE RESTRICT,
  FOREIGN KEY(attribution_mapping_id,workspace_id,project_id,system_snapshot_id,entry_id) REFERENCES runtime_control_mappings(id,workspace_id,project_id,system_snapshot_id,entry_id) ON DELETE RESTRICT,
  CHECK (entry_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS control_finding_bindings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE CASCADE,
  system_snapshot_id TEXT NOT NULL REFERENCES system_snapshots(id) ON DELETE RESTRICT,
  entry_id TEXT NOT NULL REFERENCES risk_knowledge_entries(id) ON DELETE RESTRICT,
  finding_id TEXT NOT NULL REFERENCES remediation_items(id) ON DELETE RESTRICT,
  source_digest TEXT NOT NULL CHECK (length(source_digest)=64),
  binding_method TEXT NOT NULL CHECK (binding_method IN ('failed_test','authorised_rebind')),
  bound_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  descriptor_json TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (length(content_digest)=64),
  created_at TEXT NOT NULL,
  UNIQUE(finding_id,system_snapshot_id,entry_id),
  UNIQUE(id,workspace_id,project_id,system_snapshot_id,entry_id),
  FOREIGN KEY(system_snapshot_id,workspace_id,project_id) REFERENCES system_snapshots(id,workspace_id,project_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS control_integrity_audit_dedup (
  fingerprint TEXT PRIMARY KEY CHECK (length(fingerprint)=64),
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES security_projects(id) ON DELETE CASCADE,
  record_type TEXT NOT NULL,
  record_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count>0)
);

CREATE INDEX IF NOT EXISTS idx_control_finding_binding_scope ON control_finding_bindings(workspace_id,project_id,system_snapshot_id,entry_id,finding_id);
CREATE INDEX IF NOT EXISTS idx_control_approval_requirement_scope ON control_approval_requirements(workspace_id,project_id,system_snapshot_id,entry_id);
CREATE INDEX IF NOT EXISTS idx_runtime_control_mapping_scope ON runtime_control_mappings(workspace_id,project_id,system_snapshot_id,rule_id,entry_id);
CREATE INDEX IF NOT EXISTS idx_control_integrity_dedup_scope ON control_integrity_audit_dedup(workspace_id,project_id,last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_snapshots_scope ON system_snapshots(workspace_id,project_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_evaluations_scope ON control_snapshot_evaluations(workspace_id,project_id,system_snapshot_id,entry_id);
CREATE INDEX IF NOT EXISTS idx_control_evaluations_status ON control_snapshot_evaluations(project_id,system_snapshot_id,applicability_status,severity_status);
CREATE INDEX IF NOT EXISTS idx_control_test_scope ON control_test_executions(workspace_id,project_id,system_snapshot_id,entry_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_evidence_scope ON control_evidence_items(workspace_id,project_id,system_snapshot_id,entry_id,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_evidence_execution ON control_evidence_items(test_execution_id,verification_state);
CREATE INDEX IF NOT EXISTS idx_control_decisions_scope ON control_deployment_decisions(workspace_id,project_id,system_snapshot_id,status,decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_control_runtime_binding_scope ON control_snapshot_runtime_bindings(workspace_id,project_id,system_snapshot_id,entry_id,created_at DESC);
