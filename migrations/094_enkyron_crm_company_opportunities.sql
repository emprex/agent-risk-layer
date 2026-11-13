-- 094: Direct CRM company + reviewed ticket -> commercial opportunity.
-- Preserve historical prospect opportunities. Never manufacture a legacy prospect.
-- Company/ticket provenance is mandatory for the new path, but proves neither
-- customer identity, contract acceptance nor permission to security-test.
ALTER TABLE enkyron_crm_opportunities
  ALTER COLUMN prospect_id DROP NOT NULL,
  ADD COLUMN company_id TEXT,
  ADD COLUMN source_ticket_id TEXT;

ALTER TABLE enkyron_crm_opportunities
  ADD CONSTRAINT enkyron_opportunity_exactly_one_origin
  CHECK (
    (prospect_id IS NOT NULL AND company_id IS NULL AND source_ticket_id IS NULL)
    OR
    (prospect_id IS NULL AND company_id IS NOT NULL AND source_ticket_id IS NOT NULL)
  ),
  ADD CONSTRAINT enkyron_opportunity_company_fk
  FOREIGN KEY(workspace_key,company_id)
    REFERENCES enkyron_crm_companies(workspace_key,id) ON DELETE RESTRICT,
  ADD CONSTRAINT enkyron_opportunity_source_ticket_fk
  FOREIGN KEY(source_ticket_id)
    REFERENCES arl_workbench_tickets(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX enkyron_opportunity_company_ticket_once
  ON enkyron_crm_opportunities(workspace_key,company_id,source_ticket_id)
  WHERE company_id IS NOT NULL;
CREATE INDEX enkyron_opportunity_company_list
  ON enkyron_crm_opportunities(workspace_key,company_id,updated_at DESC)
  WHERE company_id IS NOT NULL;
