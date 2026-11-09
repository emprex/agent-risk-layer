-- 100: A CRM company can originate a commercial opportunity WITHOUT a service ticket.
-- Preserve 094 legacy company+ticket opportunities and historic prospect opportunities.
-- No historical data is modified by this schema migration.
ALTER TABLE enkyron_crm_opportunities
  DROP CONSTRAINT enkyron_opportunity_exactly_one_origin;
ALTER TABLE enkyron_crm_opportunities
  ADD CONSTRAINT enkyron_opportunity_exactly_one_origin
  CHECK (
    (prospect_id IS NOT NULL AND company_id IS NULL AND source_ticket_id IS NULL)
    OR (prospect_id IS NULL AND company_id IS NOT NULL)
  );
-- For now one direct outreach opportunity per company/workspace; preserves existing
-- distinct ticket and prospect opportunities. A later multi-deal feature must add
-- an explicit deal identifier before relaxing this uniqueness contract.
CREATE UNIQUE INDEX enkyron_opportunity_company_direct_once
 ON enkyron_crm_opportunities(workspace_key, company_id)
 WHERE company_id IS NOT NULL AND source_ticket_id IS NULL;

-- Immutable review of a historical mistakenly ticket-backed commercial origin.
-- Source tickets and their event history are not deleted or silently rewritten.
CREATE TABLE enkyron_crm_opportunity_origin_corrections (
 id TEXT PRIMARY KEY,
 workspace_key TEXT NOT NULL,
 opportunity_id TEXT NOT NULL,
 old_source_ticket_id TEXT NOT NULL,
 company_id TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 30 AND 1000),
 actor_local TEXT NOT NULL,
 corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(workspace_key, opportunity_id),
 FOREIGN KEY(workspace_key,opportunity_id)
  REFERENCES enkyron_crm_opportunities(workspace_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_key,company_id)
  REFERENCES enkyron_crm_companies(workspace_key,id) ON DELETE RESTRICT,
 FOREIGN KEY(old_source_ticket_id)
  REFERENCES arl_workbench_tickets(id) ON DELETE RESTRICT
);
CREATE TRIGGER enkyron_crm_opportunity_origin_corrections_no_modify
 BEFORE UPDATE OR DELETE ON enkyron_crm_opportunity_origin_corrections
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
