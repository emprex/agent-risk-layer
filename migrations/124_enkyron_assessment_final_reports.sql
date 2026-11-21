-- ENKYRON: immutable, ticket-linked final report archive. Explicit operator action only.
-- Does not alter ARL tests, findings, evidence, Work Notes, mission status or M03.
CREATE TABLE IF NOT EXISTS enkyron_assessment_final_reports (
  report_id TEXT PRIMARY KEY CHECK (report_id ~ '^rpt_[a-f0-9]{32}$'),
  ticket_id TEXT NOT NULL REFERENCES arl_workbench_tickets(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES security_projects(id) ON DELETE RESTRICT,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE RESTRICT,
  ticket_number TEXT NOT NULL,
  source_commit TEXT NOT NULL CHECK (source_commit ~ '^[a-f0-9]{40}$'),
  file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 4 AND 255),
  mime_type TEXT NOT NULL DEFAULT 'application/pdf' CHECK (mime_type = 'application/pdf'),
  confidentiality TEXT NOT NULL DEFAULT 'confidential' CHECK (confidentiality = 'confidential'),
  document_kind TEXT NOT NULL DEFAULT 'final_security_assessment_report'
    CHECK (document_kind = 'final_security_assessment_report'),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1000 AND 25000000),
  content BYTEA NOT NULL,
  archived_by TEXT NOT NULL CHECK (length(archived_by) BETWEEN 1 AND 80),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_final_report_actual_size CHECK (octet_length(content) = byte_length),
  CONSTRAINT enkyron_final_report_once UNIQUE (ticket_id, content_sha256)
);
CREATE INDEX IF NOT EXISTS enkyron_assessment_final_reports_by_ticket
  ON enkyron_assessment_final_reports (ticket_id, archived_at DESC);
-- Refuse silent replacement or deletion of a submitted final report.
CREATE OR REPLACE FUNCTION enkyron_final_report_immutable_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Final report archive is immutable; corrections require a new report record';
END;
$$;
DROP TRIGGER IF EXISTS enkyron_final_report_immutable ON enkyron_assessment_final_reports;
CREATE TRIGGER enkyron_final_report_immutable
BEFORE UPDATE OR DELETE ON enkyron_assessment_final_reports
FOR EACH ROW EXECUTE FUNCTION enkyron_final_report_immutable_guard();
