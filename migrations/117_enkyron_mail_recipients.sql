-- ENKYRON M03-B: professional recipient storage.
-- PROPOSED ONLY: never apply automatically to arl_local.
-- Preserve historical drafts, provider submissions and audit events.
-- Do not infer CC/BCC from historical emails.

ALTER TABLE enkyron_crm_mail_drafts
  ADD COLUMN to_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN cc_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN bcc_recipients JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE enkyron_crm_mail_drafts
  ADD CONSTRAINT enkyron_mail_to_recipients_shape
    CHECK (
      jsonb_typeof(to_recipients) = 'array'
      AND jsonb_array_length(to_recipients) <= 50
    ),
  ADD CONSTRAINT enkyron_mail_cc_recipients_shape
    CHECK (
      jsonb_typeof(cc_recipients) = 'array'
      AND jsonb_array_length(cc_recipients) <= 50
    ),
  ADD CONSTRAINT enkyron_mail_bcc_recipients_shape
    CHECK (
      jsonb_typeof(bcc_recipients) = 'array'
      AND jsonb_array_length(bcc_recipients) <= 50
    ),
  ADD CONSTRAINT enkyron_mail_total_recipients_limit
    CHECK (
      jsonb_array_length(to_recipients)
      + jsonb_array_length(cc_recipients)
      + jsonb_array_length(bcc_recipients) <= 50
    );

-- Backfill only the historical primary To recipient.
-- Keep recipient_email unchanged for legacy UI and send operations.
UPDATE enkyron_crm_mail_drafts
SET to_recipients = jsonb_build_array(recipient_email)
WHERE recipient_email IS NOT NULL
  AND btrim(recipient_email) <> ''
  AND to_recipients = '[]'::jsonb;

-- CC/BCC stay empty for historical drafts.
-- No outgoing send, provider mutation or audit-event rewrite.

-- M03-B: reject non-string recipient elements.
-- Address syntax and cross-field deduplication remain Node responsibilities.
ALTER TABLE enkyron_crm_mail_drafts
  ADD CONSTRAINT enkyron_mail_to_string_elements
    CHECK (NOT jsonb_path_exists(
      to_recipients,
      '$[*] ? (@.type() != "string")'::jsonpath
    )),
  ADD CONSTRAINT enkyron_mail_cc_string_elements
    CHECK (NOT jsonb_path_exists(
      cc_recipients,
      '$[*] ? (@.type() != "string")'::jsonpath
    )),
  ADD CONSTRAINT enkyron_mail_bcc_string_elements
    CHECK (NOT jsonb_path_exists(
      bcc_recipients,
      '$[*] ? (@.type() != "string")'::jsonpath
    ));
