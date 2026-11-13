-- ENKYRON Mail: standalone messages remain within the existing local CRM draft ledger.
-- No automatic mail transport or mail accounts are created by this migration.
-- Existing company / opportunity drafts and their history are untouched.
ALTER TABLE enkyron_crm_mail_drafts
  DROP CONSTRAINT enkyron_crm_mail_exactly_one_parent,
  ADD CONSTRAINT enkyron_crm_mail_max_one_parent
    CHECK (NOT (opportunity_id IS NOT NULL AND company_id IS NOT NULL)),
  ADD COLUMN mailbox_key TEXT NOT NULL DEFAULT 'direction'
    CHECK (mailbox_key IN ('direction','support'));

-- Mail permissions are recorded in PostgreSQL for the single local workstation.
-- No identity is inferred from a self-declared profile. Provisioning is explicit
-- in the local migration command after a verified backup.
CREATE TABLE enkyron_local_mail_access (
  workspace_key TEXT NOT NULL CHECK (workspace_key ~ '^local:[A-Za-z0-9_.-]{1,80}$'),
  mailbox_key TEXT NOT NULL CHECK (mailbox_key IN ('direction','support')),
  role TEXT NOT NULL CHECK (role = 'organization_owner_l5'),
  can_read BOOLEAN NOT NULL DEFAULT TRUE,
  can_send BOOLEAN NOT NULL DEFAULT TRUE,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_key,mailbox_key)
);

-- One outbound attempt per draft revision; once initiated, no automatic retry.
-- Idempotency key is persisted BEFORE any provider request. A network error
-- has an uncertain outcome and must not be silently resent.
CREATE TABLE enkyron_mail_send_attempts (
  id UUID PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL CHECK(draft_revision >= 1),
  mailbox_key TEXT NOT NULL CHECK(mailbox_key IN ('direction','support')),
  recipient_email TEXT NOT NULL,
  payload_sha256 CHAR(64) NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key UUID NOT NULL UNIQUE,
  outcome TEXT NOT NULL DEFAULT 'prepared'
    CHECK(outcome IN ('prepared','accepted','uncertain')),
  provider_message_id TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (workspace_key,draft_id,draft_revision),
  FOREIGN KEY(workspace_key,draft_id)
    REFERENCES enkyron_crm_mail_drafts(workspace_key,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_mail_send_attempts_workspace
  ON enkyron_mail_send_attempts(workspace_key,recorded_at DESC);
