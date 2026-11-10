-- 066: human-reviewed legacy prospect -> structured CRM company associations.
-- A legacy prospect may link to at most one CRM company per LOCAL operator.
-- Several distinct prospect records can link to one company after explicit review.
-- No contact creation, message send, client promotion, or legacy row mutation.
CREATE TABLE enkyron_crm_prospect_links (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  prospect_id TEXT NOT NULL REFERENCES sales_prospects(id) ON DELETE RESTRICT,
  company_id TEXT NOT NULL,
  source_digest CHAR(64) NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  review_note TEXT NOT NULL CHECK (length(btrim(review_note)) BETWEEN 20 AND 1000),
  linked_by TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_crm_prospect_once UNIQUE (workspace_key,prospect_id),
  CONSTRAINT enkyron_crm_link_company_scope FOREIGN KEY (workspace_key,company_id)
    REFERENCES enkyron_crm_companies(workspace_key,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_prospect_links_company
  ON enkyron_crm_prospect_links(workspace_key,company_id,linked_at DESC);

-- Association and the human's recorded rationale are append-only.
CREATE TRIGGER enkyron_crm_prospect_links_no_modify
  BEFORE UPDATE OR DELETE ON enkyron_crm_prospect_links
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
