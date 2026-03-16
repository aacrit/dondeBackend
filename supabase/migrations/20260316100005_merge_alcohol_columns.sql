-- Resolve alcohol_type vs byob_policy column duplication on restaurant_deep_profiles.
--
-- Background: byob_policy was added in 20260221000001_enrichment_v2.sql with values:
--   full_byob, byob_wine_only, corkage_fee, no_byob, full_bar
-- alcohol_type was added in 20260316000002_add_yelp_attributes.sql with values:
--   full_bar, beer_and_wine, none
--
-- This migration populates alcohol_type from existing byob_policy data where
-- alcohol_type is currently NULL, so both columns are consistent:
--   byob_policy = 'full_bar'                                    → alcohol_type = 'full_bar'
--   byob_policy IN ('full_byob','byob_wine_only','corkage_fee') → alcohol_type = 'beer_and_wine'
--   byob_policy = 'no_byob'                                     → alcohol_type = 'none'
--
-- byob_policy is retained because it carries BYOB-specific semantics (corkage fee,
-- wine-only BYOB) used by the scoring engine's BYOB constraint enforcement.
-- alcohol_type is the canonical "what alcohol is served" field from Yelp attributes.

UPDATE restaurant_deep_profiles
SET alcohol_type = CASE
  WHEN byob_policy = 'full_bar' THEN 'full_bar'
  WHEN byob_policy IN ('full_byob', 'byob_wine_only', 'corkage_fee') THEN 'beer_and_wine'
  WHEN byob_policy = 'no_byob' THEN 'none'
END
WHERE alcohol_type IS NULL
  AND byob_policy IS NOT NULL;
