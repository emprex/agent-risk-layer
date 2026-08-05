import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const rawDb = new DatabaseSync(config.databasePath);
rawDb.exec('PRAGMA journal_mode = WAL;');
rawDb.exec('PRAGMA foreign_keys = ON;');
rawDb.exec('PRAGMA busy_timeout = 5000;');
rawDb.exec('PRAGMA synchronous = NORMAL;');

rawDb.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  terms_version TEXT,
  terms_accepted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  score INTEGER NOT NULL,
  risk_band TEXT NOT NULL,
  result_json TEXT NOT NULL,
  paid_tier TEXT NOT NULL DEFAULT 'free',
  access_token TEXT UNIQUE,
  share_token TEXT NOT NULL UNIQUE,
  public_enabled INTEGER NOT NULL DEFAULT 0,
  scoring_version TEXT NOT NULL DEFAULT 'arl-risk-v1.0',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  assessment_id TEXT,
  product_key TEXT NOT NULL,
  amount_pence INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'gbp',
  status TEXT NOT NULL,
  stripe_session_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  project_id TEXT,
  stripe_price_id TEXT,
  expected_amount_pence INTEGER,
  expected_currency TEXT,
  checkout_mode TEXT,
  expected_customer_email TEXT,
  binding_state TEXT,
  binding_expires_at TEXT,
  checkout_created_at TEXT,
  binding_verified_at TEXT,
  quarantined_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES security_projects(id) ON DELETE SET NULL,
  CHECK (amount_pence >= 0 AND (expected_amount_pence IS NULL OR expected_amount_pence >= 0)),
  CHECK (binding_state IS NULL OR binding_state IN
    ('legacy_fulfilled','legacy_review_required','pending_creation','pending','verified','quarantined','creation_failed')),
  CHECK (checkout_mode IS NULL OR checkout_mode IN ('payment','subscription')),
  CHECK (binding_state IN ('legacy_fulfilled','legacy_review_required') OR
    (currency GLOB '[a-z][a-z][a-z]' AND length(currency)=3
      AND (expected_currency IS NULL OR (expected_currency GLOB '[a-z][a-z][a-z]' AND length(expected_currency)=3))))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_key TEXT NOT NULL,
  status TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  purchase_id TEXT UNIQUE,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  canceled_at TEXT,
  authoritative_state INTEGER NOT NULL DEFAULT 0,
  billing_state_source TEXT NOT NULL,
  latest_stripe_event_created INTEGER,
  latest_stripe_event_id TEXT,
  latest_stripe_event_type TEXT,
  latest_stripe_event_state TEXT,
  reconciliation_required INTEGER NOT NULL DEFAULT 0,
  reconciliation_started_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL,
  CHECK (status IN ('pending','active','trialing','canceled','cancelled','past_due','unpaid','incomplete','incomplete_expired','paused')),
  CHECK (authoritative_state IN (0,1)),
  CHECK (reconciliation_required IN (0,1)),
  CHECK (
    (latest_stripe_event_created IS NULL AND latest_stripe_event_id IS NULL AND latest_stripe_event_type IS NULL AND latest_stripe_event_state IS NULL) OR
    (latest_stripe_event_created IS NOT NULL AND latest_stripe_event_id IS NOT NULL AND latest_stripe_event_type IS NOT NULL AND latest_stripe_event_state IS NOT NULL)
  ),
  CHECK (billing_state_source IS NOT NULL AND (
    (billing_state_source='pending_checkout' AND authoritative_state=0 AND status='pending'
      AND current_period_start IS NULL AND current_period_end IS NULL
      AND cancel_at_period_end=0 AND canceled_at IS NULL
      AND latest_stripe_event_created IS NULL AND latest_stripe_event_id IS NULL
      AND latest_stripe_event_type IS NULL AND latest_stripe_event_state IS NULL
      AND reconciliation_required=0 AND reconciliation_started_at IS NULL) OR
    (billing_state_source='legacy_reconciliation_required' AND authoritative_state=0
      AND latest_stripe_event_created IS NULL AND latest_stripe_event_id IS NULL
      AND latest_stripe_event_type IS NULL AND latest_stripe_event_state IS NULL
      AND reconciliation_required=0 AND reconciliation_started_at IS NULL) OR
    (billing_state_source='reconciliation_required' AND authoritative_state=0
      AND status IN ('active','trialing','canceled','cancelled','past_due','unpaid','incomplete','incomplete_expired','paused')
      AND current_period_start IS NOT NULL AND current_period_end IS NOT NULL
      AND latest_stripe_event_created IS NOT NULL AND latest_stripe_event_id IS NOT NULL
      AND latest_stripe_event_type IS NOT NULL AND latest_stripe_event_state IS NOT NULL
      AND reconciliation_required=1 AND reconciliation_started_at IS NOT NULL) OR
    (billing_state_source IN ('stripe_event','stripe_retrieval') AND authoritative_state=1
      AND status IN ('active','trialing','canceled','cancelled','past_due','unpaid','incomplete','incomplete_expired','paused')
      AND current_period_start IS NOT NULL AND current_period_end IS NOT NULL
      AND latest_stripe_event_created IS NOT NULL AND latest_stripe_event_id IS NOT NULL
      AND latest_stripe_event_type IS NOT NULL AND latest_stripe_event_state IS NOT NULL
      AND reconciliation_required=0 AND reconciliation_started_at IS NULL)
  ))
);

CREATE TABLE IF NOT EXISTS stripe_subscription_conflicts (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  stripe_created INTEGER NOT NULL,
  prior_event_id TEXT NOT NULL,
  prior_event_type TEXT NOT NULL,
  conflicting_event_id TEXT NOT NULL,
  conflicting_event_type TEXT NOT NULL,
  prior_state TEXT NOT NULL,
  conflicting_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolving_event_id TEXT,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE RESTRICT,
  UNIQUE(subscription_id,prior_event_id,conflicting_event_id),
  CHECK (prior_event_id <> conflicting_event_id),
  CHECK (
    (resolved_at IS NULL AND resolving_event_id IS NULL) OR
    (resolved_at IS NOT NULL AND resolving_event_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  properties_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed',
  last_error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  processing_started_at TEXT,
  completed_at TEXT,
  created_at TEXT,
  processing_result TEXT,
  ignored_reason TEXT,
  recovery_actor_id TEXT,
  recovery_reason TEXT,
  recovered_at TEXT,
  FOREIGN KEY (recovery_actor_id) REFERENCES users(id) ON DELETE SET NULL,
  CHECK (status IN ('received','processing','failed','processed')),
  CHECK (
    (status='received' AND processing_started_at IS NULL AND completed_at IS NULL) OR
    (status='processing' AND processing_started_at IS NOT NULL AND completed_at IS NULL) OR
    (status='failed' AND processing_started_at IS NULL AND completed_at IS NULL) OR
    (status='processed' AND processing_started_at IS NULL AND completed_at IS NOT NULL)
  ),
  CHECK (
    (recovery_actor_id IS NULL AND recovery_reason IS NULL AND recovered_at IS NULL) OR
    (recovery_actor_id IS NOT NULL AND recovery_reason IS NOT NULL AND recovered_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS stripe_event_recoveries (
  id TEXT PRIMARY KEY,
  stripe_event_id TEXT NOT NULL,
  actor_id TEXT,
  prior_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  recovered_at TEXT NOT NULL,
  FOREIGN KEY (stripe_event_id) REFERENCES stripe_events(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);


CREATE TABLE IF NOT EXISTS inspection_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  authorisation_id TEXT,
  mode TEXT NOT NULL DEFAULT 'simulation',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
);




CREATE TABLE IF NOT EXISTS redteam_authorisations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  target_name TEXT NOT NULL,
  endpoint_origin TEXT,
  environment TEXT NOT NULL,
  authority_basis TEXT NOT NULL,
  authorised_by TEXT NOT NULL,
  authorised_role TEXT NOT NULL,
  emergency_contact TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  permitted_actions_json TEXT NOT NULL DEFAULT '[]',
  prohibited_actions_json TEXT NOT NULL DEFAULT '[]',
  data_classification TEXT NOT NULL,
  retention_days INTEGER NOT NULL DEFAULT 30,
  synthetic_data_only INTEGER NOT NULL DEFAULT 1,
  dry_run_tools_only INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  attestation_text TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS redteam_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  authorisation_id TEXT,
  mode TEXT NOT NULL DEFAULT 'simulation',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
  FOREIGN KEY (authorisation_id) REFERENCES redteam_authorisations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS redteam_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  authorisation_id TEXT,
  schema_version TEXT NOT NULL,
  runner_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  bundle_digest TEXT NOT NULL UNIQUE,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  campaign_json TEXT NOT NULL DEFAULT '{}',
  scope_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  results_json TEXT NOT NULL DEFAULT '[]',
  trust_json TEXT NOT NULL DEFAULT '{}',
  delta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
  FOREIGN KEY (authorisation_id) REFERENCES redteam_authorisations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  scanner_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  bundle_digest TEXT NOT NULL UNIQUE,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  subject_json TEXT NOT NULL DEFAULT '{}',
  scope_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  findings_json TEXT NOT NULL DEFAULT '[]',
  technologies_json TEXT NOT NULL DEFAULT '[]',
  trust_json TEXT NOT NULL DEFAULT '{}',
  delta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mfa_login_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fulfilment_jobs (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(purchase_id, job_type),
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS data_purge_receipts (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  assessment_id TEXT,
  authorisation_id TEXT,
  evidence_type TEXT NOT NULL,
  records_deleted INTEGER NOT NULL DEFAULT 0,
  digests_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL,
  retention_deadline TEXT,
  executed_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE SET NULL,
  FOREIGN KEY (authorisation_id) REFERENCES redteam_authorisations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS operational_alerts (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS beta_invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  used_by TEXT,
  used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (used_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  scim_token_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer',
  status TEXT NOT NULL DEFAULT 'active',
  external_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id,email),
  UNIQUE(workspace_id,external_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workspace_integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_delivery_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS security_projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  billing_user_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'development',
  status TEXT NOT NULL DEFAULT 'active',
  policy_json TEXT NOT NULL DEFAULT '{}',
  policy_version TEXT NOT NULL DEFAULT '1',
  policy_digest TEXT,
  policy_published_at TEXT,
  retention_days INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, slug),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (billing_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS project_api_keys (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (project_id) REFERENCES security_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS runtime_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  api_key_id TEXT,
  request_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'guard',
  decision TEXT NOT NULL,
  observed_decision TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'none',
  rule_ids_json TEXT NOT NULL DEFAULT '[]',
  content_digest TEXT,
  tool_name TEXT,
  argument_digest TEXT,
  evaluation_ms REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  response_json TEXT NOT NULL DEFAULT '{}',
  policy_version TEXT,
  policy_digest TEXT,
  policy_published_at TEXT,
  retest_criteria_id TEXT,
  remediation_id TEXT,
  retest_criteria_digest TEXT,
  retest_satisfied INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, request_id),
  FOREIGN KEY (project_id) REFERENCES security_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (api_key_id) REFERENCES project_api_keys(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS runtime_approvals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  approver_id TEXT,
  tool_name TEXT NOT NULL,
  environment TEXT NOT NULL,
  action_digest TEXT NOT NULL,
  token_digest TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','consumed','revoked')),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_request_id TEXT,
  runtime_event_id TEXT,
  revoked_at TEXT,
  CHECK (length(action_digest) = 64),
  CHECK (length(token_digest) = 64),
  UNIQUE(project_id, consumed_request_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES security_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (approver_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (runtime_event_id) REFERENCES runtime_events(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS asset_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  source_digest TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  assets_json TEXT NOT NULL DEFAULT '[]',
  drift_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES security_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS remediation_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  assessment_id TEXT,
  finding_key TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  owner_email TEXT,
  due_at TEXT,
  verification_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, finding_key),
  FOREIGN KEY (project_id) REFERENCES security_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS remediation_evidence_artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  remediation_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'active',
  content_json TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  invalidated_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES security_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (remediation_id) REFERENCES remediation_items(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS remediation_retest_criteria (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  remediation_id TEXT NOT NULL,
  finding_key TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  expected_decision TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_identity TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  policy_digest TEXT NOT NULL,
  policy_published_at TEXT NOT NULL,
  criteria_digest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  runtime_event_id TEXT,
  result TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES security_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (remediation_id) REFERENCES remediation_items(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (runtime_event_id) REFERENCES runtime_events(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS security_audit_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  project_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES security_projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sales_prospects (
  id TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  website TEXT,
  company_size TEXT,
  buyer_name TEXT,
  buyer_role TEXT,
  buyer_email TEXT,
  buyer_linkedin TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  trigger_signal TEXT,
  agent_use_case TEXT,
  tool_access TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  score INTEGER NOT NULL DEFAULT 0,
  score_reasons_json TEXT NOT NULL DEFAULT '[]',
  stage TEXT NOT NULL DEFAULT 'research',
  estimated_value_pence INTEGER NOT NULL DEFAULT 9900,
  next_action TEXT,
  next_action_at TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sales_messages (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  message_type TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  factual_basis_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  approved_by TEXT,
  approved_at TEXT,
  sent_at TEXT,
  response_outcome TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (prospect_id) REFERENCES sales_prospects(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sales_activities (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  outcome TEXT,
  detail TEXT,
  amount_pence INTEGER,
  occurred_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (prospect_id) REFERENCES sales_prospects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_assessments_user ON assessments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_name_created ON events(name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_reset_tokens(user_id, created_at DESC);


CREATE INDEX IF NOT EXISTS idx_redteam_authorisations_assessment ON redteam_authorisations(assessment_id, status, window_end DESC);
CREATE INDEX IF NOT EXISTS idx_redteam_tokens_expiry ON redteam_tokens(expires_at, used_at);
CREATE INDEX IF NOT EXISTS idx_redteam_runs_assessment ON redteam_runs(assessment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_redteam_runs_user ON redteam_runs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inspection_tokens_expiry ON inspection_tokens(expires_at, used_at);
CREATE INDEX IF NOT EXISTS idx_inspections_assessment ON inspections(assessment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_user ON inspections(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_projects_workspace ON security_projects(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_api_keys_project ON project_api_keys(project_id, revoked_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_events_project_created ON runtime_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_events_project_decision ON runtime_events(project_id, decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_approvals_project_status ON runtime_approvals(project_id, status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_approvals_project_action ON runtime_approvals(project_id, action_digest, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_snapshots_project ON asset_snapshots(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_remediation_project_status ON remediation_items(project_id, status, severity, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_workspace ON security_audit_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_prospects_stage ON sales_prospects(stage, score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_prospects_next_action ON sales_prospects(next_action_at, stage);
CREATE INDEX IF NOT EXISTS idx_sales_messages_prospect ON sales_messages(prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_messages_status ON sales_messages(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_activities_prospect ON sales_activities(prospect_id, occurred_at DESC);


`);

// Safe in-place migrations for databases created by earlier MVP builds.
ensureColumn('users', 'terms_version', 'TEXT');
ensureColumn('users', 'terms_accepted_at', 'TEXT');
ensureColumn('assessments', 'access_token', 'TEXT');
ensureColumn('assessments', 'public_enabled', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('assessments', 'scoring_version', "TEXT NOT NULL DEFAULT 'arl-risk-v1.0'");
ensureColumn('inspections', 'delta_json', "TEXT NOT NULL DEFAULT '{}'");
ensureColumn('redteam_tokens', 'authorisation_id', 'TEXT');
ensureColumn('redteam_tokens', 'mode', "TEXT NOT NULL DEFAULT 'simulation'");
ensureColumn('redteam_runs', 'authorisation_id', 'TEXT');

ensureColumn('users', 'email_verified_at', 'TEXT');
ensureColumn('users', 'mfa_secret_encrypted', 'TEXT');
ensureColumn('users', 'mfa_enabled_at', 'TEXT');
ensureColumn('users', 'mfa_recovery_codes_json', "TEXT NOT NULL DEFAULT '[]'");
ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
ensureColumn('sessions', 'last_seen_at', 'TEXT');
ensureColumn('sessions', 'authenticated_at', 'TEXT');
ensureColumn('sessions', 'mfa_verified', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('purchases', 'fulfilment_state', "TEXT NOT NULL DEFAULT 'received'");
ensureColumn('purchases', 'fulfilment_attempts', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('purchases', 'fulfilment_error', 'TEXT');
ensureColumn('purchases', 'fulfilled_at', 'TEXT');
ensureColumn('purchases', 'access_granted_at', 'TEXT');
ensureColumn('purchases', 'email_state', "TEXT NOT NULL DEFAULT 'pending'");
ensureColumn('purchases', 'email_attempts', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('purchases', 'email_error', 'TEXT');
ensureColumn('purchases', 'email_sent_at', 'TEXT');
ensureColumn('purchases', 'session_json', "TEXT NOT NULL DEFAULT '{}'");
ensureColumn('purchases', 'report_snapshot_json', 'TEXT');
ensureColumn('purchases', 'report_digest', 'TEXT');
ensureColumn('purchases', 'project_id', 'TEXT');
ensureColumn('purchases', 'stripe_price_id', 'TEXT');
ensureColumn('purchases', 'expected_amount_pence', 'INTEGER');
ensureColumn('purchases', 'expected_currency', 'TEXT');
ensureColumn('purchases', 'checkout_mode', 'TEXT');
ensureColumn('purchases', 'expected_customer_email', 'TEXT');
ensureColumn('purchases', 'binding_state', 'TEXT');
ensureColumn('purchases', 'binding_expires_at', 'TEXT');
ensureColumn('purchases', 'checkout_created_at', 'TEXT');
ensureColumn('purchases', 'binding_verified_at', 'TEXT');
ensureColumn('purchases', 'quarantined_at', 'TEXT');
ensureColumn('stripe_events', 'status', "TEXT NOT NULL DEFAULT 'processed'");
ensureColumn('stripe_events', 'last_error', 'TEXT');
ensureColumn('stripe_events', 'attempt_count', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('stripe_events', 'processing_started_at', 'TEXT');
ensureColumn('stripe_events', 'completed_at', 'TEXT');
ensureColumn('stripe_events', 'created_at', 'TEXT');
ensureColumn('stripe_events', 'processing_result', 'TEXT');
ensureColumn('stripe_events', 'ignored_reason', 'TEXT');
ensureColumn('stripe_events', 'recovery_actor_id', 'TEXT');
ensureColumn('stripe_events', 'recovery_reason', 'TEXT');
ensureColumn('stripe_events', 'recovered_at', 'TEXT');
upgradeSubscriptionsLifecycleTable();
ensureColumn('subscriptions', 'purchase_id', 'TEXT');
ensureColumn('subscriptions', 'current_period_start', 'TEXT');
ensureColumn('subscriptions', 'cancel_at_period_end', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('subscriptions', 'canceled_at', 'TEXT');
ensureColumn('subscriptions', 'authoritative_state', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('subscriptions', 'billing_state_source', 'TEXT');
ensureColumn('subscriptions', 'latest_stripe_event_created', 'INTEGER');
ensureColumn('subscriptions', 'latest_stripe_event_id', 'TEXT');
ensureColumn('subscriptions', 'latest_stripe_event_type', 'TEXT');
ensureColumn('subscriptions', 'latest_stripe_event_state', 'TEXT');
ensureColumn('subscriptions', 'reconciliation_required', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('subscriptions', 'reconciliation_started_at', 'TEXT');
ensureColumn('redteam_authorisations', 'legal_hold', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('redteam_runs', 'retention_expires_at', 'TEXT');
ensureColumn('security_projects', 'policy_digest', 'TEXT');
ensureColumn('security_projects', 'policy_published_at', 'TEXT');
ensureColumn('runtime_events', 'policy_version', 'TEXT');
ensureColumn('runtime_events', 'policy_digest', 'TEXT');
ensureColumn('runtime_events', 'policy_published_at', 'TEXT');
ensureColumn('runtime_events', 'retest_criteria_id', 'TEXT');
ensureColumn('runtime_events', 'remediation_id', 'TEXT');
ensureColumn('runtime_events', 'retest_criteria_digest', 'TEXT');
ensureColumn('runtime_events', 'retest_satisfied', 'INTEGER');
ensureColumn('remediation_evidence_artifacts', 'source_type', 'TEXT');
ensureColumn('remediation_evidence_artifacts', 'source_id', 'TEXT');

rawDb.exec(`
CREATE INDEX IF NOT EXISTS idx_fulfilment_jobs_due ON fulfilment_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_purchases_fulfilment ON purchases(fulfilment_state, updated_at);
CREATE INDEX IF NOT EXISTS idx_purchases_binding ON purchases(binding_state,binding_expires_at,updated_at);
CREATE INDEX IF NOT EXISTS idx_stripe_events_processing ON stripe_events(status,processing_started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_purchase ON subscriptions(purchase_id) WHERE purchase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_order ON subscriptions(stripe_subscription_id,latest_stripe_event_created,latest_stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_stripe_event_recoveries_event ON stripe_event_recoveries(stripe_event_id,recovered_at);
CREATE INDEX IF NOT EXISTS idx_stripe_subscription_conflicts_open ON stripe_subscription_conflicts(subscription_id,stripe_created) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limit_buckets(reset_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user ON mfa_login_challenges(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_purge_receipts_user ON data_purge_receipts(user_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON operational_alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beta_invites_status ON beta_invites(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id,status);
CREATE INDEX IF NOT EXISTS idx_workspace_integrations_workspace ON workspace_integrations(workspace_id,status);
CREATE INDEX IF NOT EXISTS idx_remediation_evidence_scope ON remediation_evidence_artifacts(workspace_id,project_id,remediation_id,artifact_type,lifecycle_state);
CREATE UNIQUE INDEX IF NOT EXISTS idx_retest_criteria_event ON remediation_retest_criteria(runtime_event_id) WHERE runtime_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_retest_criteria_scope ON remediation_retest_criteria(workspace_id,project_id,remediation_id,status,expires_at);
`);

// Risk knowledge migrations are intentionally loaded into the test-only SQLite
// adapter so route and tenant-isolation tests exercise the same schema and seed
// content used by PostgreSQL production migrations.
for (const migrationName of [
  '009_risk_knowledge_asset.sql',
  '010_seed_risk_knowledge_v1.sql',
  '011_risk_knowledge_v1_1.sql',
  '012_seed_risk_knowledge_v1_1.sql',
]) {
  const migrationPath = path.resolve(process.cwd(), 'migrations', migrationName);
  if (!fs.existsSync(migrationPath)) throw new Error(`Missing risk knowledge migration: ${migrationName}`);
  rawDb.exec(fs.readFileSync(migrationPath, 'utf8'));
}

if (config.adminEmail) rawDb.prepare(`UPDATE users SET role='superuser' WHERE email=?`).run(config.adminEmail);



// Existing accounts were created before email verification was introduced.
// Preserve access by treating them as verified; all new registrations require verification.
rawDb.prepare(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at)`).run();
rawDb.prepare(`UPDATE sessions SET last_seen_at = COALESCE(last_seen_at, created_at), authenticated_at = COALESCE(authenticated_at, created_at)`).run();
rawDb.prepare(`UPDATE purchases SET fulfilment_state = CASE WHEN fulfilment_state='received' AND status='paid' THEN 'fulfilled' ELSE fulfilment_state END, fulfilled_at = COALESCE(fulfilled_at, CASE WHEN status='paid' THEN updated_at END), access_granted_at = COALESCE(access_granted_at, CASE WHEN status='paid' THEN updated_at END), email_state = CASE WHEN email_state='pending' AND status='paid' THEN 'unknown' ELSE email_state END`).run();
rawDb.prepare(`UPDATE purchases SET binding_state=CASE
  WHEN fulfilment_state='fulfilled' AND access_granted_at IS NOT NULL THEN 'legacy_fulfilled'
  ELSE 'legacy_review_required' END WHERE binding_state IS NULL`).run();
rawDb.prepare(`UPDATE stripe_events SET completed_at=COALESCE(completed_at,processed_at),
  created_at=COALESCE(created_at,processed_at),
  attempt_count=CASE WHEN attempt_count<1 THEN 1 ELSE attempt_count END WHERE status='processed'`).run();
rawDb.prepare(`UPDATE stripe_events SET processing_started_at=COALESCE(processing_started_at,processed_at),
  completed_at=NULL WHERE status='processing'`).run();
rawDb.prepare(`UPDATE stripe_events SET processing_started_at=NULL,completed_at=NULL
  WHERE status IN ('received','failed')`).run();
// Earlier MVP builds reused the public token for private access. Preserve the old
// private links as access tokens and rotate the public token during migration.
const legacyTokenRows = rawDb.prepare(`SELECT id, share_token FROM assessments WHERE access_token IS NULL OR access_token = ''`).all();
for (const row of legacyTokenRows) {
  const nextShareToken = `share_${crypto.randomUUID().replaceAll('-', '')}`;
  rawDb.prepare('UPDATE assessments SET access_token = ?, share_token = ? WHERE id = ?').run(row.share_token, nextShareToken, row.id);
}
rawDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_assessments_access_token ON assessments(access_token);');

function ensureColumn(table, column, definition) {
  const columns = rawDb.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) rawDb.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function upgradeSubscriptionsLifecycleTable() {
  const table = rawDb.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='subscriptions'`).get();
  const definition = String(table?.sql || '');
  if (definition.includes('billing_state_source TEXT NOT NULL')
      && definition.includes('billing_state_source IS NOT NULL')) return;

  const foreignKeysWereEnabled = Number(rawDb.prepare('PRAGMA foreign_keys').get().foreign_keys) === 1;
  rawDb.exec('PRAGMA foreign_keys = OFF;');
  try {
    rawDb.exec('BEGIN IMMEDIATE;');
    rawDb.exec(`
      CREATE TABLE subscriptions_billing_upgrade (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        plan_key TEXT NOT NULL,
        status TEXT NOT NULL,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT UNIQUE,
        purchase_id TEXT UNIQUE,
        current_period_start TEXT,
        current_period_end TEXT,
        cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
        canceled_at TEXT,
        authoritative_state INTEGER NOT NULL DEFAULT 0,
        billing_state_source TEXT NOT NULL,
        latest_stripe_event_created INTEGER,
        latest_stripe_event_id TEXT,
        latest_stripe_event_type TEXT,
        latest_stripe_event_state TEXT,
        reconciliation_required INTEGER NOT NULL DEFAULT 0,
        reconciliation_started_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE SET NULL,
        CHECK (status IN ('pending','active','trialing','canceled','cancelled','past_due','unpaid','incomplete','incomplete_expired','paused')),
        CHECK (authoritative_state IN (0,1)),
        CHECK (reconciliation_required IN (0,1)),
        CHECK (
          (latest_stripe_event_created IS NULL AND latest_stripe_event_id IS NULL AND latest_stripe_event_type IS NULL AND latest_stripe_event_state IS NULL) OR
          (latest_stripe_event_created IS NOT NULL AND latest_stripe_event_id IS NOT NULL AND latest_stripe_event_type IS NOT NULL AND latest_stripe_event_state IS NOT NULL)
        ),
        CHECK (billing_state_source IS NOT NULL AND (
          (billing_state_source='pending_checkout' AND authoritative_state=0 AND status='pending'
            AND current_period_start IS NULL AND current_period_end IS NULL
            AND cancel_at_period_end=0 AND canceled_at IS NULL
            AND latest_stripe_event_created IS NULL AND latest_stripe_event_id IS NULL
            AND latest_stripe_event_type IS NULL AND latest_stripe_event_state IS NULL
            AND reconciliation_required=0 AND reconciliation_started_at IS NULL) OR
          (billing_state_source='legacy_reconciliation_required' AND authoritative_state=0
            AND latest_stripe_event_created IS NULL AND latest_stripe_event_id IS NULL
            AND latest_stripe_event_type IS NULL AND latest_stripe_event_state IS NULL
            AND reconciliation_required=0 AND reconciliation_started_at IS NULL) OR
          (billing_state_source='reconciliation_required' AND authoritative_state=0
            AND status IN ('active','trialing','canceled','cancelled','past_due','unpaid','incomplete','incomplete_expired','paused')
            AND current_period_start IS NOT NULL AND current_period_end IS NOT NULL
            AND latest_stripe_event_created IS NOT NULL AND latest_stripe_event_id IS NOT NULL
            AND latest_stripe_event_type IS NOT NULL AND latest_stripe_event_state IS NOT NULL
            AND reconciliation_required=1 AND reconciliation_started_at IS NOT NULL) OR
          (billing_state_source IN ('stripe_event','stripe_retrieval') AND authoritative_state=1
            AND status IN ('active','trialing','canceled','cancelled','past_due','unpaid','incomplete','incomplete_expired','paused')
            AND current_period_start IS NOT NULL AND current_period_end IS NOT NULL
            AND latest_stripe_event_created IS NOT NULL AND latest_stripe_event_id IS NOT NULL
            AND latest_stripe_event_type IS NOT NULL AND latest_stripe_event_state IS NOT NULL
            AND reconciliation_required=0 AND reconciliation_started_at IS NULL)
        ))
      );
    `);
    const insert = rawDb.prepare(`INSERT INTO subscriptions_billing_upgrade
      (id,user_id,plan_key,status,stripe_customer_id,stripe_subscription_id,purchase_id,current_period_start,current_period_end,
       cancel_at_period_end,canceled_at,authoritative_state,billing_state_source,latest_stripe_event_created,
       latest_stripe_event_id,latest_stripe_event_type,latest_stripe_event_state,reconciliation_required,
       reconciliation_started_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of rawDb.prepare('SELECT * FROM subscriptions').all()) {
      const classified = classifySubscriptionForUpgrade(row);
      insert.run(
        classified.id, classified.user_id, classified.plan_key, classified.status,
        classified.stripe_customer_id ?? null, classified.stripe_subscription_id ?? null, classified.purchase_id ?? null,
        classified.current_period_start ?? null, classified.current_period_end ?? null, Number(classified.cancel_at_period_end || 0),
        classified.canceled_at ?? null, Number(classified.authoritative_state || 0), classified.billing_state_source,
        classified.latest_stripe_event_created ?? null, classified.latest_stripe_event_id ?? null,
        classified.latest_stripe_event_type ?? null, classified.latest_stripe_event_state ?? null,
        Number(classified.reconciliation_required || 0), classified.reconciliation_started_at ?? null,
        classified.created_at, classified.updated_at,
      );
    }
    rawDb.exec(`DROP TABLE subscriptions;
      ALTER TABLE subscriptions_billing_upgrade RENAME TO subscriptions;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_purchase
        ON subscriptions(purchase_id) WHERE purchase_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_order
        ON subscriptions(stripe_subscription_id,latest_stripe_event_created,latest_stripe_event_id);`);
    const violations = rawDb.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error(`SQLite subscription upgrade found ${violations.length} foreign-key violation(s).`);
    rawDb.exec('COMMIT;');
  } catch (error) {
    try { rawDb.exec('ROLLBACK;'); } catch {}
    throw error;
  } finally {
    rawDb.exec(`PRAGMA foreign_keys = ${foreignKeysWereEnabled ? 'ON' : 'OFF'};`);
  }
}

function classifySubscriptionForUpgrade(row) {
  const completeOrder = row.latest_stripe_event_created != null && row.latest_stripe_event_id != null
    && row.latest_stripe_event_type != null && row.latest_stripe_event_state != null;
  const absentOrder = row.latest_stripe_event_created == null && row.latest_stripe_event_id == null
    && row.latest_stripe_event_type == null && row.latest_stripe_event_state == null;
  const source = String(row.billing_state_source || '');
  const pending = source === 'pending_checkout' && Number(row.authoritative_state) === 0 && row.status === 'pending'
    && row.current_period_start == null && row.current_period_end == null && Number(row.cancel_at_period_end || 0) === 0
    && row.canceled_at == null && absentOrder && Number(row.reconciliation_required) === 0
    && row.reconciliation_started_at == null;
  const legacy = source === 'legacy_reconciliation_required' && Number(row.authoritative_state) === 0
    && absentOrder && Number(row.reconciliation_required) === 0 && row.reconciliation_started_at == null;
  const reconciling = source === 'reconciliation_required' && Number(row.authoritative_state) === 0
    && row.status !== 'pending' && row.current_period_start != null && row.current_period_end != null
    && completeOrder && Number(row.reconciliation_required) === 1 && row.reconciliation_started_at != null;
  const authoritative = ['stripe_event', 'stripe_retrieval'].includes(source)
    && Number(row.authoritative_state) === 1 && row.status !== 'pending'
    && row.current_period_start != null && row.current_period_end != null && completeOrder
    && Number(row.reconciliation_required) === 0 && row.reconciliation_started_at == null;
  if (pending || legacy || reconciling || authoritative) return row;
  return {
    ...row,
    authoritative_state: 0,
    billing_state_source: 'legacy_reconciliation_required',
    latest_stripe_event_created: null,
    latest_stripe_event_id: null,
    latest_stripe_event_type: null,
    latest_stripe_event_state: null,
    reconciliation_required: 0,
    reconciliation_started_at: null,
  };
}


export function createSqliteTestDatabase() {
  let transactionTail = Promise.resolve();
  const transactionContext = new AsyncLocalStorage();
  const execute = async (operation) => {
    if (!transactionContext.getStore()) await transactionTail;
    return operation();
  };
  const adapter = {
    kind: 'sqlite-test',
    prepare(sql) {
      const statement = rawDb.prepare(sql);
      return {
        async get(...params) { return execute(() => statement.get(...params)); },
        async all(...params) { return execute(() => statement.all(...params)); },
        async run(...params) {
          const result = await execute(() => statement.run(...params));
          return { changes: Number(result.changes || 0), lastInsertRowid: result.lastInsertRowid ?? null };
        },
      };
    },
    async exec(sql) { return execute(() => rawDb.exec(sql)); },
    async transaction(callback) {
      if (transactionContext.getStore()) return callback(adapter);
      const run = async () => {
        rawDb.exec('BEGIN IMMEDIATE');
        try {
          const result = await transactionContext.run({ active: true }, () => callback(adapter));
          rawDb.exec('COMMIT');
          return result;
        } catch (error) {
          try { rawDb.exec('ROLLBACK'); } catch {}
          throw error;
        }
      };
      const result = transactionTail.then(run, run);
      transactionTail = result.catch(() => undefined);
      return result;
    },
    async close() { rawDb.close(); },
    async healthcheck() { await execute(() => rawDb.prepare('SELECT 1 AS ok').get()); return { ok: true, adapter: 'sqlite-test' }; },
  };
  return adapter;
}
