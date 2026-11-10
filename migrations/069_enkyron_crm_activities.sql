-- 069: operator-recorded commercial activity notes for ENKYRON follow-ups.
-- This is NOT a mailbox and never asserts independent proof of an outgoing email.
-- Original prospects, tickets, opportunities and historical events remain untouched.
-- Composite foreign key enforces the local-workspace boundary.
CREATE UNIQUE INDEX idx_enkyron_crm_opportunity_workspace_id
  ON enkyron_crm_opportunities(workspace_key,id);

CREATE TABLE enkyron_crm_activities (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  activity_type TEXT NOT NULL CHECK (
    activity_type IN ('note','call_note','meeting_note','email_note','task_note')
  ),
  detail TEXT NOT NULL CHECK (length(btrim(detail)) BETWEEN 10 AND 2000),
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT enkyron_crm_activity_scoped_opportunity
    FOREIGN KEY (workspace_key,opportunity_id)
      REFERENCES enkyron_crm_opportunities(workspace_key,id) ON DELETE RESTRICT
);
CREATE INDEX idx_enkyron_crm_activity_timeline
  ON enkyron_crm_activities(workspace_key,opportunity_id,recorded_at DESC,id DESC);

-- Notes are append-only. Corrections must be new, explicitly attributable records.
CREATE TRIGGER enkyron_crm_activities_no_modify
  BEFORE UPDATE OR DELETE ON enkyron_crm_activities
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
