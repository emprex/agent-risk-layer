-- 104: company-first CRM journal and unsent drafts.
-- Each entry belongs either to an explicit company or a commercial opportunity.
-- Historic opportunity-owned records remain unchanged; no backfill or inferred links.
-- Nothing here can send email, change consent, or authorize ARL assessments.
ALTER TABLE enkyron_crm_activities
  ALTER COLUMN opportunity_id DROP NOT NULL,
  ADD COLUMN company_id TEXT,
  ADD CONSTRAINT enkyron_crm_activity_exactly_one_parent
    CHECK ((opportunity_id IS NOT NULL) <> (company_id IS NOT NULL)),
  ADD CONSTRAINT enkyron_crm_activity_company_scope
    FOREIGN KEY(workspace_key,company_id)
    REFERENCES enkyron_crm_companies(workspace_key,id) ON DELETE RESTRICT;

CREATE INDEX idx_enkyron_crm_company_activities
  ON enkyron_crm_activities(workspace_key,company_id,recorded_at DESC,id DESC)
  WHERE company_id IS NOT NULL;

ALTER TABLE enkyron_crm_mail_drafts
  ALTER COLUMN opportunity_id DROP NOT NULL,
  ADD COLUMN company_id TEXT,
  ADD CONSTRAINT enkyron_crm_mail_exactly_one_parent
    CHECK ((opportunity_id IS NOT NULL) <> (company_id IS NOT NULL)),
  ADD CONSTRAINT enkyron_crm_mail_company_scope
    FOREIGN KEY(workspace_key,company_id)
    REFERENCES enkyron_crm_companies(workspace_key,id) ON DELETE RESTRICT;

CREATE INDEX idx_enkyron_crm_company_mail_drafts
  ON enkyron_crm_mail_drafts(workspace_key,company_id,updated_at DESC,id DESC)
  WHERE company_id IS NOT NULL;
