CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  terms_version TEXT,
  terms_accepted_at TEXT,
  email_verified_at TEXT,
  mfa_secret_encrypted TEXT,
  mfa_enabled_at TEXT,
  mfa_recovery_codes_json TEXT NOT NULL DEFAULT '[]',
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  authenticated_at TEXT,
  mfa_verified INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
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
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL,
  product_key TEXT NOT NULL,
  amount_pence INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'gbp',
  status TEXT NOT NULL,
  stripe_session_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  fulfilment_state TEXT NOT NULL DEFAULT 'received',
  fulfilment_attempts INTEGER NOT NULL DEFAULT 0,
  fulfilment_error TEXT,
  fulfilled_at TEXT,
  access_granted_at TEXT,
  email_state TEXT NOT NULL DEFAULT 'pending',
  email_attempts INTEGER NOT NULL DEFAULT 0,
  email_error TEXT,
  email_sent_at TEXT,
  session_json TEXT NOT NULL DEFAULT '{}',
  report_snapshot_json TEXT,
  report_digest TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL,
  status TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  current_period_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  properties_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed',
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS inspection_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  authorisation_id TEXT,
  mode TEXT NOT NULL DEFAULT 'simulation',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redteam_authorisations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
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
  legal_hold INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS redteam_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  authorisation_id TEXT REFERENCES redteam_authorisations(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'simulation',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redteam_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  authorisation_id TEXT REFERENCES redteam_authorisations(id) ON DELETE SET NULL,
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
  retention_expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
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
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mfa_login_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
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
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(purchase_id, job_type)
);

CREATE TABLE IF NOT EXISTS data_purge_receipts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL,
  authorisation_id TEXT REFERENCES redteam_authorisations(id) ON DELETE SET NULL,
  evidence_type TEXT NOT NULL,
  records_deleted INTEGER NOT NULL DEFAULT 0,
  digests_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL,
  retention_deadline TEXT,
  executed_at TEXT NOT NULL
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
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  used_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scim_token_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer',
  status TEXT NOT NULL DEFAULT 'active',
  external_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id,email),
  UNIQUE(workspace_id,external_id)
);

CREATE TABLE IF NOT EXISTS workspace_integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_delivery_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
