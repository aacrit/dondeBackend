-- Project Foxtrot: Add Yelp-sourced attribute columns to restaurant_deep_profiles
-- These columns are populated by the yelp-attributes-enrichment pipeline.
-- wheelchair_accessible: from Yelp business attributes
-- alcohol_type: full_bar, beer_and_wine, none (from Yelp attributes)
-- delivery_available: from Yelp transactions[] array
-- takeout_available: from Yelp transactions[] array

ALTER TABLE restaurant_deep_profiles
  ADD COLUMN IF NOT EXISTS wheelchair_accessible BOOLEAN,
  ADD COLUMN IF NOT EXISTS alcohol_type TEXT,
  ADD COLUMN IF NOT EXISTS delivery_available BOOLEAN,
  ADD COLUMN IF NOT EXISTS takeout_available BOOLEAN;

COMMENT ON COLUMN restaurant_deep_profiles.wheelchair_accessible IS 'Yelp: wheelchair accessible (from business attributes)';
COMMENT ON COLUMN restaurant_deep_profiles.alcohol_type IS 'Yelp: alcohol type — full_bar, beer_and_wine, none';
COMMENT ON COLUMN restaurant_deep_profiles.delivery_available IS 'Yelp: delivery available (from transactions[])';
COMMENT ON COLUMN restaurant_deep_profiles.takeout_available IS 'Yelp: takeout available (from transactions[])';
