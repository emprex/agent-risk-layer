-- Repair stale customer-facing names on assessment-bound evidence-only cases.
-- The assessment record is the canonical identity for a paid assessment case.
-- This changes project metadata only; remediation, inspection, retest and audit history remain untouched.

UPDATE security_projects
SET name = (
  SELECT a.name
  FROM owner_assessment_cases c
  JOIN assessments a ON a.id = c.assessment_id
  WHERE c.project_id = security_projects.id
),
updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM owner_assessment_cases c
  JOIN assessments a ON a.id = c.assessment_id
  WHERE c.project_id = security_projects.id
    AND c.assessment_id IS NOT NULL
    AND a.name <> security_projects.name
);
