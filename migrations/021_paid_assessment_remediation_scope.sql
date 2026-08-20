-- Bind customer remediation scopes to one exact fulfilled Security Assessment.
-- Existing NULL-bound rows remain internal owner assessment cases.

ALTER TABLE owner_assessment_cases
  ADD COLUMN assessment_id TEXT REFERENCES assessments(id) ON DELETE CASCADE;

ALTER TABLE owner_assessment_cases
  ADD COLUMN purchase_id TEXT REFERENCES purchases(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX idx_owner_assessment_cases_assessment
  ON owner_assessment_cases(assessment_id)
  WHERE assessment_id IS NOT NULL;

CREATE INDEX idx_owner_assessment_cases_purchase
  ON owner_assessment_cases(purchase_id)
  WHERE purchase_id IS NOT NULL;
