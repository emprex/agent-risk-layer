-- 075: Permit short official-source acronyms in manual proposal tax reviews.
-- Examples: ICO (3), HMRC (4). No past reviews or VAT decisions are changed.
ALTER TABLE enkyron_crm_proposal_tax_reviews
  DROP CONSTRAINT reference_bound;
ALTER TABLE enkyron_crm_proposal_tax_reviews
  ADD CONSTRAINT reference_bound
  CHECK (source_reference IS NULL OR
    length(btrim(source_reference)) BETWEEN 3 AND 500);
