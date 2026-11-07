-- 092 E02-04B: reviewed creation of distinct company/contact despite matching identity clues.
-- No schema changes to existing company/contact rows or their permitted relationship state.
CREATE TABLE enkyron_crm_duplicate_reviews (
 id TEXT PRIMARY KEY,
 workspace_key TEXT NOT NULL,
 resource_kind TEXT NOT NULL CHECK(resource_kind IN ('company','contact')),
 resource_id TEXT NOT NULL,
 matched_record_ids TEXT[] NOT NULL
   CHECK(cardinality(matched_record_ids) BETWEEN 1 AND 25),
 review_note TEXT NOT NULL CHECK(length(btrim(review_note)) BETWEEN 30 AND 500),
 actor_local TEXT NOT NULL,
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(workspace_key,resource_kind,resource_id)
);
CREATE INDEX idx_enkyron_crm_duplicate_reviews_history
 ON enkyron_crm_duplicate_reviews(workspace_key,resource_kind,reviewed_at DESC,id DESC);
CREATE TRIGGER enkyron_crm_duplicate_reviews_immutable
 BEFORE UPDATE OR DELETE ON enkyron_crm_duplicate_reviews
 FOR EACH ROW EXECUTE FUNCTION enkyron_crm_events_immutable();
