-- ENKYRON CRM: deterministic analytical classification.
-- Preserve original job_title and contact identity.
-- No updates to CRM records or historical prospect research.

CREATE VIEW enkyron_crm_contact_roles_v1 AS
WITH source AS (
  SELECT
    id, workspace_key, company_id, full_name, job_title,
    lower(btrim(coalesce(job_title, ''))) AS role_text,
    lower(btrim(full_name)) AS name_text
  FROM enkyron_crm_contacts
),
classified AS (
  SELECT
    id, workspace_key, company_id, full_name, job_title,
    CASE
      WHEN role_text ~ '^(general.*enquir|shared company inbox|product support)$'
        OR name_text ~ '^(general enquir.*|general business|lona support)$'
      THEN 'shared_inbox'
      ELSE 'person'
    END AS contact_kind,
    array_remove(ARRAY[
      CASE WHEN role_text LIKE '%founder%'
        THEN 'founder' END,
      CASE WHEN role_text ~ '(^|[^a-z])ceo([^a-z]|$)|chief executive officer'
        THEN 'ceo' END,
      CASE WHEN role_text ~ '(^|[^a-z])cto([^a-z]|$)|chief technology officer'
        AND role_text !~ 'former[[:space:]-]+cto'
        THEN 'cto' END,
      CASE WHEN role_text ~ 'scientist|research'
        THEN 'research' END,
      CASE WHEN role_text ~ 'strateg'
        THEN 'strategy' END,
      CASE WHEN role_text ~ '(^|[^a-z])gtm([^a-z]|$)|go.to.market'
        THEN 'go_to_market' END,
      CASE WHEN role_text LIKE '%sales%'
        THEN 'sales' END,
      CASE WHEN role_text LIKE '%marketing%'
        THEN 'marketing' END,
      CASE WHEN role_text LIKE '%product%'
        AND role_text NOT LIKE '%product support%'
        THEN 'product' END,
      CASE WHEN role_text ~ 'operat|founding ops'
        THEN 'operations' END,
      CASE WHEN role_text LIKE '%security%'
        THEN 'security' END,
      CASE WHEN role_text ~ 'engineer'
        THEN 'engineering' END,
      CASE WHEN role_text LIKE '%developer%'
        THEN 'developer' END,
      CASE WHEN role_text LIKE '%technician%'
        THEN 'technician' END,
      CASE WHEN role_text LIKE '%advisor%'
        THEN 'advisor' END,
      CASE WHEN role_text LIKE '%support%'
        THEN 'support' END,
      CASE WHEN role_text LIKE '%corporate representative%'
        THEN 'corporate_representative' END,
      CASE WHEN role_text ~ 'enquir|shared company inbox'
        THEN 'general_enquiries' END
    ]::text[], NULL) AS role_codes
  FROM source
)
SELECT *,
  CASE WHEN cardinality(role_codes) = 0
    THEN 'needs_review'
    ELSE 'classified'
  END AS classification_status
FROM classified;
