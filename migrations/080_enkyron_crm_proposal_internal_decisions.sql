-- 080: Immutable operator-only internal decisions for proposal DRAFT revisions.
-- An internal approval does not authorise issue/send/invoicing/legal or tax status.
-- No mutations of proposal/buyer/tax/terms history.
CREATE TABLE enkyron_crm_proposal_internal_decisions(
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_revision INTEGER NOT NULL CHECK (proposal_revision>=1),
  decision TEXT NOT NULL CHECK (decision IN ('needs_changes','internal_draft_approved')),
  review_note TEXT NOT NULL CHECK (length(btrim(review_note)) BETWEEN 30 AND 2000),
  issuer_profile_id TEXT,
  buyer_review_id TEXT,
  terms_id TEXT,
  tax_review_id TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_internal_decision_once_per_revision
    UNIQUE(workspace_key,proposal_id,proposal_revision),
  CONSTRAINT enkyron_internal_decision_scoped_proposal
    FOREIGN KEY(workspace_key,proposal_id)
    REFERENCES enkyron_crm_proposal_drafts(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_internal_decision_scoped_issuer
    FOREIGN KEY(issuer_profile_id)
    REFERENCES enkyron_operator_company_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_internal_decision_scoped_buyer
    FOREIGN KEY(buyer_review_id)
    REFERENCES enkyron_crm_proposal_buyer_reviews(id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_internal_decision_scoped_terms
    FOREIGN KEY(terms_id)
    REFERENCES enkyron_crm_proposal_commercial_terms(id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_internal_decision_scoped_tax
    FOREIGN KEY(tax_review_id)
    REFERENCES enkyron_crm_proposal_tax_reviews(id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_internal_decision_approved_refs
    CHECK (decision='needs_changes' OR
      (issuer_profile_id IS NOT NULL AND buyer_review_id IS NOT NULL AND
       terms_id IS NOT NULL AND tax_review_id IS NOT NULL))
);
CREATE INDEX idx_enkyron_internal_decisions_history
 ON enkyron_crm_proposal_internal_decisions(workspace_key,proposal_id,proposal_revision DESC);
CREATE TRIGGER enkyron_internal_decisions_immutable
 BEFORE UPDATE OR DELETE ON enkyron_crm_proposal_internal_decisions
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
