-- ENK-08: internal manual Time Entries. REVIEW DRAFT ONLY outside migrations/.
-- Requires 118 missions + 119 work items in the same verified schema.
-- This is NOT payroll, a client-approved timesheet, invoicing or authority to test.
CREATE TABLE enkyron_psa_time_entries (
  id UUID PRIMARY KEY,
  workspace_key TEXT NOT NULL CHECK(workspace_key ~ '^local:[A-Za-z0-9_.-]{1,80}$'),
  mission_id UUID NOT NULL,
  work_item_id UUID,
  work_date DATE NOT NULL
    CHECK(work_date BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'),
  minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 720),
  note TEXT NOT NULL CHECK(char_length(btrim(note)) BETWEEN 10 AND 500),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status='draft'),
  billing_state TEXT NOT NULL DEFAULT 'not_billable' CHECK(billing_state='not_billable'),
  request_id UUID NOT NULL,
  content_sha256 CHAR(64) NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by TEXT NOT NULL CHECK(created_by ~ '^[A-Za-z0-9_.-]{1,80}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_key,id),
  UNIQUE(workspace_key,mission_id,id),
  UNIQUE(workspace_key,request_id),
  FOREIGN KEY(workspace_key,mission_id)
    REFERENCES enkyron_psa_missions(workspace_key,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_key,mission_id,work_item_id)
    REFERENCES enkyron_psa_work_items(workspace_key,mission_id,id) ON DELETE RESTRICT
);
CREATE INDEX enkyron_psa_time_entries_by_mission
  ON enkyron_psa_time_entries(workspace_key,mission_id,work_date DESC,id);

-- Immutable time entries: corrections, if added later, must be audited as
-- new revision/correction records and must not silently overwrite history.
CREATE TRIGGER enkyron_psa_time_entries_immutable
  BEFORE UPDATE OR DELETE ON enkyron_psa_time_entries
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();

CREATE TABLE enkyron_psa_time_events (
  id UUID PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  mission_id UUID NOT NULL,
  time_entry_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type='logged'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version=1),
  request_id UUID NOT NULL,
  content_sha256 CHAR(64) NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  actor_local TEXT NOT NULL CHECK(actor_local ~ '^[A-Za-z0-9_.-]{1,80}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_key,time_entry_id,version),
  UNIQUE(workspace_key,request_id),
  FOREIGN KEY(workspace_key,mission_id,time_entry_id)
    REFERENCES enkyron_psa_time_entries(workspace_key,mission_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER enkyron_psa_time_events_immutable
  BEFORE UPDATE OR DELETE ON enkyron_psa_time_events
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
