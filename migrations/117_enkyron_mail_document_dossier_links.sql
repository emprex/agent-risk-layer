-- M05-B: one original attachment, multiple reviewed dossier references.
-- REVIEW ONLY. Never automatically apply to arl_local.

CREATE TABLE enkyron_mail_document_dossier_links (
  link_id UUID PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  mailbox_key TEXT NOT NULL
    CHECK(mailbox_key IN ('direction','support')),
  message_id UUID NOT NULL,
  attachment_id UUID NOT NULL,
  company_id TEXT,
  ticket_id TEXT,
  filename_at_review TEXT NOT NULL
    CHECK(octet_length(filename_at_review) BETWEEN 1 AND 512),
  content_sha256_at_review TEXT NOT NULL
    CHECK(content_sha256_at_review ~ '^[0-9a-f]{64}$'),
  review_note TEXT NOT NULL
    CHECK(char_length(btrim(review_note)) BETWEEN 20 AND 1000),
  linked_by TEXT NOT NULL
    CHECK(char_length(linked_by) BETWEEN 1 AND 80),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT enkyron_document_one_destination CHECK (
    (company_id IS NOT NULL AND ticket_id IS NULL)
    OR (company_id IS NULL AND ticket_id IS NOT NULL)
  ),

  FOREIGN KEY(workspace_key,mailbox_key,message_id,attachment_id)
    REFERENCES enkyron_mail_attachment_quarantine
    (workspace_key,mailbox_key,message_id,attachment_id)
    ON DELETE RESTRICT,

  FOREIGN KEY(workspace_key,company_id)
    REFERENCES enkyron_crm_companies(workspace_key,id)
    ON DELETE RESTRICT,

  FOREIGN KEY(ticket_id)
    REFERENCES arl_workbench_tickets(id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX enkyron_document_company_unique
ON enkyron_mail_document_dossier_links
(workspace_key,mailbox_key,message_id,attachment_id,company_id)
WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX enkyron_document_ticket_unique
ON enkyron_mail_document_dossier_links
(workspace_key,mailbox_key,message_id,attachment_id,ticket_id)
WHERE ticket_id IS NOT NULL;

CREATE INDEX enkyron_document_by_company
ON enkyron_mail_document_dossier_links
(workspace_key,company_id,linked_at DESC)
WHERE company_id IS NOT NULL;

CREATE INDEX enkyron_document_by_ticket
ON enkyron_mail_document_dossier_links
(workspace_key,ticket_id,linked_at DESC)
WHERE ticket_id IS NOT NULL;

CREATE TRIGGER enkyron_document_links_immutable
BEFORE UPDATE OR DELETE
ON enkyron_mail_document_dossier_links
FOR EACH ROW
EXECUTE FUNCTION enkyron_crm_events_immutable();
