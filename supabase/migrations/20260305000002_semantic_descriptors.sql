-- V11: Semantic Descriptors for Enhanced Matching
-- Adds scenario-based and conceptual descriptors to review intelligence
-- for matching queries like "pre-game dinner", "where celebrities eat",
-- "something like Girl & the Goat"

ALTER TABLE restaurant_review_intelligence
  ADD COLUMN IF NOT EXISTS semantic_descriptors text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS best_for_scenarios text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS comparable_restaurants text[] DEFAULT '{}';

COMMENT ON COLUMN restaurant_review_intelligence.semantic_descriptors IS
  'V11: Conceptual descriptors — "celebrity hotspot", "pre-theater", "power lunch spot"';

COMMENT ON COLUMN restaurant_review_intelligence.best_for_scenarios IS
  'V11: Scenario-based matching — "anniversary dinner", "client entertainment", "Instagram photos"';

COMMENT ON COLUMN restaurant_review_intelligence.comparable_restaurants IS
  'V11: Similar restaurant references — "if you like Girl & the Goat"';

-- GIN indexes for array containment queries
CREATE INDEX IF NOT EXISTS idx_ri_semantic ON restaurant_review_intelligence USING GIN (semantic_descriptors);
CREATE INDEX IF NOT EXISTS idx_ri_scenarios ON restaurant_review_intelligence USING GIN (best_for_scenarios);
CREATE INDEX IF NOT EXISTS idx_ri_comparable ON restaurant_review_intelligence USING GIN (comparable_restaurants);
