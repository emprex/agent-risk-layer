-- 084: Versioned manual CRM company/contact corrections with append-only change metadata.
-- Local single-OS-operator scope only. Does not change historic prospects, links,
-- buyer-review snapshots, legal/tax declarations, marketing opt-in or client status.
ALTER TABLE enkyron_crm_companies
  ADD COLUMN record_version INTEGER NOT NULL DEFAULT 1 CHECK(record_version>=1);
ALTER TABLE enkyron_crm_contacts
  ADD COLUMN record_version INTEGER NOT NULL DEFAULT 1 CHECK(record_version>=1);

CREATE TABLE enkyron_crm_record_changes (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('company','contact')),
  resource_id TEXT NOT NULL,
  old_version INTEGER NOT NULL CHECK(old_version>=1),
  new_version INTEGER NOT NULL CHECK(new_version=old_version+1),
  changed_fields TEXT[] NOT NULL CHECK(cardinality(changed_fields) BETWEEN 1 AND 6),
  review_note TEXT NOT NULL CHECK(length(btrim(review_note)) BETWEEN 20 AND 1000),
  actor_local TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_key,resource_kind,resource_id,new_version)
);
CREATE INDEX idx_enkyron_crm_record_changes_history
  ON enkyron_crm_record_changes(workspace_key,resource_kind,resource_id,new_version DESC);
CREATE TRIGGER enkyron_crm_record_changes_immutable
  BEFORE UPDATE OR DELETE ON enkyron_crm_record_changes
  FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
