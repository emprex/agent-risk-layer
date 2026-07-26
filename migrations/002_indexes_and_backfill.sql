CREATE INDEX IF NOT EXISTS idx_assessments_user ON assessments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_access_token ON assessments(access_token);
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
CREATE INDEX IF NOT EXISTS idx_fulfilment_jobs_due ON fulfilment_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_purchases_fulfilment ON purchases(fulfilment_state, updated_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limit_buckets(reset_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_tokens(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user ON mfa_login_challenges(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_purge_receipts_user ON data_purge_receipts(user_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON operational_alerts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beta_invites_status ON beta_invites(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id,status);
CREATE INDEX IF NOT EXISTS idx_workspace_integrations_workspace ON workspace_integrations(workspace_id,status);

UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at);
UPDATE sessions SET last_seen_at = COALESCE(last_seen_at, created_at), authenticated_at = COALESCE(authenticated_at, created_at);
UPDATE purchases
SET fulfilment_state = CASE WHEN fulfilment_state='received' AND status='paid' THEN 'fulfilled' ELSE fulfilment_state END,
    fulfilled_at = COALESCE(fulfilled_at, CASE WHEN status='paid' THEN updated_at END),
    access_granted_at = COALESCE(access_granted_at, CASE WHEN status='paid' THEN updated_at END),
    email_state = CASE WHEN email_state='pending' AND status='paid' THEN 'unknown' ELSE email_state END;
