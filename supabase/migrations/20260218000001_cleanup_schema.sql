-- Migration: Clean up redundant columns and tables
-- Preserves data by merging before dropping

-- Step 1: Merge dietary text columns into dietary_options array
UPDATE restaurants
SET dietary_options = COALESCE(dietary_options, '{}')
  || CASE WHEN vegetarian_options IS NOT NULL AND vegetarian_options != ''
       THEN ARRAY['Vegetarian'] ELSE '{}' END
  || CASE WHEN vegan_options IS NOT NULL AND vegan_options != ''
       THEN ARRAY['Vegan'] ELSE '{}' END
  || CASE WHEN gluten_free_options IS NOT NULL AND gluten_free_options != ''
       THEN ARRAY['Gluten-Free'] ELSE '{}' END
WHERE vegetarian_options IS NOT NULL
   OR vegan_options IS NOT NULL
   OR gluten_free_options IS NOT NULL;

-- Step 2: Preserve editors_note into best_for_oneliner where missing
UPDATE restaurants
SET best_for_oneliner = editors_note
WHERE best_for_oneliner IS NULL AND editors_note IS NOT NULL;

-- Step 3: Drop redundant columns from restaurants
ALTER TABLE restaurants
  DROP COLUMN IF EXISTS yelp_business_id,
  DROP COLUMN IF EXISTS yelp_rating,
  DROP COLUMN IF EXISTS yelp_review_count,
  DROP COLUMN IF EXISTS yelp_sentiment_summary,
  DROP COLUMN IF EXISTS vegetarian_options,
  DROP COLUMN IF EXISTS vegan_options,
  DROP COLUMN IF EXISTS gluten_free_options,
  DROP COLUMN IF EXISTS review_count,
  DROP COLUMN IF EXISTS editors_note,
  DROP COLUMN IF EXISTS ai_enriched,
  DROP COLUMN IF EXISTS ai_enriched_at,
  DROP COLUMN IF EXISTS accepts_reservations,
  DROP COLUMN IF EXISTS typical_wait_time;

-- Step 4: Drop is_seed from satellite tables
ALTER TABLE occasion_scores DROP COLUMN IF EXISTS is_seed;
ALTER TABLE tags DROP COLUMN IF EXISTS is_seed;
ALTER TABLE user_queries DROP COLUMN IF EXISTS is_seed;

-- Step 5: Drop unused table
DROP TABLE IF EXISTS cuisine_types;
