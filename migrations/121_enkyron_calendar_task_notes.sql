-- ENKYRON M07 — TASK NOTES — REVIEW ONLY / DO NOT APPLY AUTOMATICALLY
-- Source migration 112 is historical and must remain untouched.
-- arl_local contains real business data. Installation requires explicit
-- owner approval, verified backup and a reviewed deployment procedure.
-- Existing tasks get empty notes, with no invented content or attribution.
ALTER TABLE enkyron_calendar_tasks
  ADD COLUMN notes TEXT NOT NULL DEFAULT ''
    CHECK (char_length(notes) <= 4000);
