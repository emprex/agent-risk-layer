-- E07-01: manual probability estimate for an existing commercial opportunity.
-- Unknown is NULL: never auto-infer chances of a sale from workflow stage or LLM.
-- Historical opportunities/events are untouched and retain unknown probability.
ALTER TABLE enkyron_crm_opportunities
  ADD COLUMN probability_percent INTEGER
    CHECK(probability_percent BETWEEN 0 AND 100);
ALTER TABLE enkyron_crm_opportunity_events
  ADD COLUMN old_probability_percent INTEGER
    CHECK(old_probability_percent BETWEEN 0 AND 100),
  ADD COLUMN new_probability_percent INTEGER
    CHECK(new_probability_percent BETWEEN 0 AND 100);
