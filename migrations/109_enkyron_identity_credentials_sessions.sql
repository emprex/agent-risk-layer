-- ENKYRON UX-15B2: credential and session storage contract only.
-- Intentionally NO bootstrap records, default passwords, activation, SQL grants,
-- or direct integration with the existing single-operator ENKYRON bridge.
-- A future privileged authentication service must control every write, bind
-- credentials to a verified principal, enforce MFA replay/lockout transactionally,
-- verify session status and scope on every request, and maintain audit events.
-- Merely inserting a row does not produce a trusted application identity.

CREATE TABLE enkyron_identity_credentials (
  principal_id UUID PRIMARY KEY REFERENCES enkyron_identity_principals(id),
  password_hash TEXT NOT NULL
    CHECK (password_hash LIKE 'scrypt-enkyron-v1$16384$8$1$%'
      AND char_length(password_hash) BETWEEN 100 AND 250),
  totp_secret_encrypted TEXT NOT NULL
    CHECK (totp_secret_encrypted LIKE 'v1.%'
      AND char_length(totp_secret_encrypted) BETWEEN 60 AND 450),
  key_version INTEGER NOT NULL DEFAULT 1 CHECK (key_version >= 1),
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  -- Atomic compare-and-update of this value MUST be enforced by the auth
  -- service to prevent reuse of a valid time-based one-time password.
  last_totp_counter BIGINT NOT NULL DEFAULT -1 CHECK (last_totp_counter >= -1),
  failed_attempts INTEGER NOT NULL DEFAULT 0
    CHECK (failed_attempts BETWEEN 0 AND 1000000),
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE enkyron_identity_sessions (
  id UUID PRIMARY KEY,
  principal_id UUID NOT NULL REFERENCES enkyron_identity_principals(id),
  -- HMAC-SHA256 digest of random 256-bit token; plaintext is never stored.
  token_digest TEXT NOT NULL UNIQUE
    CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  credential_version INTEGER NOT NULL CHECK (credential_version >= 1),
  mfa_verified BOOLEAN NOT NULL CHECK (mfa_verified IS TRUE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at
    AND expires_at <= created_at + INTERVAL '12 hours'),
  CHECK (last_seen_at >= created_at AND last_seen_at <= expires_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX idx_enkyron_identity_sessions_principal
  ON enkyron_identity_sessions (principal_id, expires_at DESC);

-- Append-only security events with no password, TOTP value or bearer token.
CREATE TABLE enkyron_identity_auth_events (
  id UUID PRIMARY KEY,
  principal_id UUID REFERENCES enkyron_identity_principals(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'credential_enrolled', 'login_denied', 'mfa_denied',
    'mfa_replay_denied', 'login_success', 'session_revoked',
    'password_rotated', 'mfa_rotated', 'account_locked', 'account_unlocked'
  )),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_enkyron_identity_auth_events_principal
  ON enkyron_identity_auth_events (principal_id, occurred_at DESC);
CREATE TRIGGER enkyron_identity_auth_events_immutable
  BEFORE UPDATE OR DELETE ON enkyron_identity_auth_events
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
