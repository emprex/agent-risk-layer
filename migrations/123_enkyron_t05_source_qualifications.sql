-- 123: T05 append-only human source qualification for EXISTING ARL candidate evidence.
-- This is a review ledger, NOT an evidence-trust promotion or control verdict.
-- No existing assessment, evidence, notes, master revision or applicability row is modified.
CREATE TABLE enkyron_t05_source_qualifications (
  id UUID PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES arl_workbench_tickets(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE RESTRICT,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL,
  target_sha TEXT NOT NULL CHECK (target_sha ~ '^[a-f0-9]{40}$'),
  control_id TEXT NOT NULL CHECK (control_id ~ '^ARL-KB-(00[1-9]|0[1-9][0-9]|10[0-8])$'),
  candidate_id TEXT NOT NULL REFERENCES control_evidence_items(id) ON DELETE RESTRICT,
  criterion_number INTEGER NOT NULL CHECK (criterion_number BETWEEN 1 AND 40),
  projection_sha256 TEXT NOT NULL CHECK (projection_sha256 ~ '^[a-f0-9]{64}$'),
  disposition TEXT NOT NULL CHECK (disposition IN
    ('static_observation', 'evidence_gap', 'authorised_test_required')),
  source_path TEXT,
  source_start_line INTEGER,
  source_end_line INTEGER,
  source_excerpt_sha256 TEXT,
  rationale TEXT NOT NULL CHECK (length(btrim(rationale)) BETWEEN 40 AND 2000),
  limitations TEXT NOT NULL CHECK (length(btrim(limitations)) BETWEEN 20 AND 1600),
  review_digest TEXT NOT NULL CHECK (review_digest ~ '^[a-f0-9]{64}$'),
  supersedes_id UUID REFERENCES enkyron_t05_source_qualifications(id) ON DELETE RESTRICT,
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enkyron_t05_source_required CHECK (
    (disposition = 'static_observation' AND source_path IS NOT NULL
      AND source_start_line > 0 AND source_end_line >= source_start_line
      AND source_excerpt_sha256 ~ '^[a-f0-9]{64}$')
    OR (disposition <> 'static_observation' AND source_path IS NULL
      AND source_start_line IS NULL AND source_end_line IS NULL
      AND source_excerpt_sha256 IS NULL)
  ),
  UNIQUE(ticket_id, candidate_id, criterion_number, review_digest),
  UNIQUE(supersedes_id)
);
CREATE INDEX enkyron_t05_candidate_latest
  ON enkyron_t05_source_qualifications
    (ticket_id, candidate_id, criterion_number, recorded_at DESC, id DESC);
-- Reuse the existing immutable-event trigger; no UPDATE or DELETE is supported.
CREATE TRIGGER enkyron_t05_source_qualifications_immutable
  BEFORE UPDATE OR DELETE ON enkyron_t05_source_qualifications
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
