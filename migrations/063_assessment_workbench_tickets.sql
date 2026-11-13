-- 063: Local assessment ticket workspace. Planning records, NOT automatic security assessments.
CREATE SEQUENCE IF NOT EXISTS arl_ticket_number_sequence;

CREATE TABLE IF NOT EXISTS arl_workbench_tickets (
  id TEXT PRIMARY KEY,
  ticket_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL,
  system_owner TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('git','mcp','api','file','other')),
  target_reference TEXT NOT NULL,
  scope_text TEXT NOT NULL,
  permission_reference TEXT NOT NULL DEFAULT '',
  assessor_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','scoping','in_progress','waiting','pending_review','resolved','closed')),
  linked_project_id TEXT REFERENCES security_projects(id) ON DELETE RESTRICT,
  linked_assessment_id TEXT REFERENCES assessments(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS arl_workbench_notes (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES arl_workbench_tickets(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual','tech','control')),
  source_id TEXT,
  source_revision TEXT,
  source_digest TEXT,
  entered_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_type='manual' OR (source_id IS NOT NULL AND source_revision IS NOT NULL AND source_digest IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS arl_workbench_ticket_events (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES arl_workbench_tickets(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','status_changed','note_added')),
  detail TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arl_workbench_ticket_status
  ON arl_workbench_tickets (status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_arl_workbench_ticket_recent
  ON arl_workbench_tickets (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_arl_workbench_notes_ticket
  ON arl_workbench_notes (ticket_id,created_at);
CREATE INDEX IF NOT EXISTS idx_arl_workbench_events_ticket
  ON arl_workbench_ticket_events (ticket_id,created_at);
CREATE INDEX IF NOT EXISTS idx_arl_workbench_ticket_search
  ON arl_workbench_tickets USING GIN
  (to_tsvector('english', title || ' ' || client_name || ' ' || target_reference));
CREATE INDEX IF NOT EXISTS idx_arl_technical_knowledge_search
  ON technical_knowledge_sheets USING GIN
  (to_tsvector('english', title || ' ' || content_markdown));
