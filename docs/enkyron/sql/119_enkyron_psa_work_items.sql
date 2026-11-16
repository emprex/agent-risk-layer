-- ENK-08 work items: REVIEW ONLY, deliberately outside migrations/.
-- Requires separately reviewed 118 planning schema. Never auto-apply to arl_local.
-- Tasks and milestones are internal work; completion is NOT contract acceptance.
CREATE TABLE enkyron_psa_work_items (
  id UUID PRIMARY KEY,
  workspace_key TEXT NOT NULL CHECK(workspace_key ~ '^local:[A-Za-z0-9_.-]{1,80}$'),
  mission_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('task','milestone')),
  title TEXT NOT NULL CHECK(char_length(btrim(title)) BETWEEN 5 AND 200),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  request_id UUID NOT NULL,
  content_sha256 CHAR(64) NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by TEXT NOT NULL CHECK(created_by ~ '^[A-Za-z0-9_.-]{1,80}$'),
  completed_by TEXT CHECK(completed_by ~ '^[A-Za-z0-9_.-]{1,80}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(workspace_key,id),
  UNIQUE(workspace_key,mission_id,id),
  UNIQUE(workspace_key,request_id),
  FOREIGN KEY(workspace_key,mission_id)
    REFERENCES enkyron_psa_missions(workspace_key,id) ON DELETE RESTRICT,
  CONSTRAINT enkyron_psa_work_item_state_consistent CHECK (
    (status='open' AND version=1 AND completed_by IS NULL AND completed_at IS NULL)
    OR (status='completed' AND version=2 AND completed_by IS NOT NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX enkyron_psa_work_items_by_mission
  ON enkyron_psa_work_items(workspace_key,mission_id,status,due_date,id);

CREATE TABLE enkyron_psa_work_item_events (
  id UUID PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  mission_id UUID NOT NULL,
  item_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK(version IN (1,2)),
  event_type TEXT NOT NULL CHECK(event_type IN ('created','completed')),
  request_id UUID NOT NULL,
  content_sha256 CHAR(64) NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  actor_local TEXT NOT NULL CHECK(actor_local ~ '^[A-Za-z0-9_.-]{1,80}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_key,item_id,version),
  UNIQUE(workspace_key,request_id),
  FOREIGN KEY(workspace_key,mission_id,item_id)
    REFERENCES enkyron_psa_work_items(workspace_key,mission_id,id) ON DELETE RESTRICT,
  CHECK ((event_type='created' AND version=1)
      OR (event_type='completed' AND version=2))
);
CREATE INDEX enkyron_psa_work_item_events_history
  ON enkyron_psa_work_item_events(workspace_key,item_id,version);
CREATE TRIGGER enkyron_psa_work_item_events_immutable
  BEFORE UPDATE OR DELETE ON enkyron_psa_work_item_events
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
