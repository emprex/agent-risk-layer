-- 073: Itemized lines for commercial PROPOSAL DRAFTS only.
-- Existing proposal drafts remain unchanged until explicit operator action.
-- Amounts are integer minor currency units; no VAT rate is inferred.
CREATE TABLE enkyron_crm_proposal_lines (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 25),
  description TEXT NOT NULL CHECK(length(btrim(description)) BETWEEN 5 AND 500),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10000),
  unit_price_minor BIGINT NOT NULL CHECK(unit_price_minor BETWEEN 1 AND 999999999),
  line_total_minor BIGINT GENERATED ALWAYS AS (quantity * unit_price_minor) STORED,
  CONSTRAINT enkyron_proposal_lines_scoped_draft FOREIGN KEY(workspace_key,proposal_id)
    REFERENCES enkyron_crm_proposal_drafts(workspace_key,id) ON DELETE RESTRICT,
  UNIQUE(workspace_key,proposal_id,position)
);
CREATE INDEX idx_enkyron_proposal_lines_ordered
  ON enkyron_crm_proposal_lines(workspace_key,proposal_id,position);
