-- Backfill cuisine_type for restaurants with NULL values using review intelligence.
-- 1806 restaurants have NULL cuisine_type. Review intelligence has cuisine_signals
-- that can be mapped to canonical cuisine_type values.
--
-- Strategy: Match the FIRST recognized cuisine signal (array is ordered by relevance).
-- Only updates restaurants where cuisine_type IS NULL and review intelligence exists.

-- Step 1: Direct signal-to-cuisine mapping via review intelligence
-- Uses a priority-ordered scan of cuisine_signals array elements
UPDATE restaurants r
SET cuisine_type = mapping.cuisine_type
FROM (
  SELECT DISTINCT ON (ri.restaurant_id)
    ri.restaurant_id,
    CASE
      -- Exact matches to existing cuisine_type values
      WHEN lower(signal.val) IN ('mexican', 'authentic mexican', 'traditional mexican', 'contemporary mexican', 'mexican street food') THEN 'Mexican'
      WHEN lower(signal.val) IN ('italian', 'classic italian', 'southern italian', 'northern italian') THEN 'Italian'
      WHEN lower(signal.val) IN ('japanese', 'sushi', 'ramen', 'izakaya', 'nigiri', 'omakase', 'yakitori', 'udon', 'tempura') THEN 'Japanese'
      WHEN lower(signal.val) IN ('chinese', 'sichuan', 'szechuan', 'cantonese', 'dim sum', 'shanghainese', 'hunan') THEN 'Chinese'
      WHEN lower(signal.val) IN ('thai') THEN 'Thai'
      WHEN lower(signal.val) IN ('vietnamese', 'pho', 'banh mi') THEN 'Vietnamese'
      WHEN lower(signal.val) IN ('korean', 'korean bbq', 'korean fried chicken') THEN 'Korean'
      WHEN lower(signal.val) IN ('indian', 'south asian', 'south indian', 'north indian', 'indo-chinese') THEN 'Indian'
      WHEN lower(signal.val) IN ('french', 'bistro', 'brasserie', 'french bistro') THEN 'French'
      WHEN lower(signal.val) IN ('mediterranean', 'turkish', 'lebanese') THEN 'Mediterranean'
      WHEN lower(signal.val) IN ('middle eastern', 'persian', 'israeli') THEN 'Middle Eastern'
      WHEN lower(signal.val) IN ('greek') THEN 'Greek'
      WHEN lower(signal.val) IN ('ethiopian', 'eritrean') THEN 'Ethiopian'
      WHEN lower(signal.val) IN ('peruvian') THEN 'Peruvian'
      WHEN lower(signal.val) IN ('brazilian', 'brazilian steakhouse') THEN 'Brazilian'
      WHEN lower(signal.val) IN ('caribbean', 'jamaican', 'cuban', 'haitian', 'reggae') THEN 'Caribbean'
      WHEN lower(signal.val) IN ('puerto rican', 'boricua') THEN 'Puerto Rican'
      WHEN lower(signal.val) IN ('seafood') THEN 'Seafood'
      WHEN lower(signal.val) IN ('steak', 'steakhouse') THEN 'Steak'
      WHEN lower(signal.val) IN ('bbq', 'barbecue', 'smoked meats') THEN 'BBQ'
      WHEN lower(signal.val) IN ('southern', 'soul food', 'southern comfort food') THEN 'Southern/Soul Food'
      WHEN lower(signal.val) IN ('vegan', 'plant-based') THEN 'Vegan'
      WHEN lower(signal.val) IN ('brunch', 'breakfast and brunch') THEN 'Brunch'
      WHEN lower(signal.val) IN ('cocktail bar', 'cocktails', 'craft cocktails', 'speakeasy', 'wine bar', 'lounge') THEN 'Cocktail Bar'
      WHEN lower(signal.val) IN ('coffee shop', 'café', 'cafe', 'specialty coffee', 'coffeehouse') THEN 'Coffee/Cafe'
      WHEN lower(signal.val) IN ('asian', 'asian fusion', 'pan-asian') THEN 'Asian'
      WHEN lower(signal.val) IN ('fusion', 'eclectic', 'global', 'new american', 'farm-to-table') THEN 'Fusion'
      WHEN lower(signal.val) IN ('american', 'american comfort food', 'comfort food', 'diner', 'pub food', 'bar food', 'gastropub') THEN 'American'
      WHEN lower(signal.val) IN ('craft beer', 'brewery', 'brewpub', 'taproom', 'beer garden') THEN 'Brewery/Beer Bar'
      WHEN lower(signal.val) IN ('polish', 'eastern european') THEN 'Polish'
      WHEN lower(signal.val) IN ('filipino', 'hawaiian') THEN 'Filipino'
      WHEN lower(signal.val) IN ('nepalese', 'nepali', 'tibetan', 'momos', 'dumplings') THEN 'Nepalese'
      WHEN lower(signal.val) IN ('african', 'west african', 'nigerian', 'ghanaian', 'senegalese') THEN 'African'
      WHEN lower(signal.val) IN ('latin american', 'latin', 'colombian', 'salvadoran', 'guatemalan', 'honduran', 'ecuadorian') THEN 'Latin American'
      WHEN lower(signal.val) IN ('tacos') THEN 'Mexican'
      WHEN lower(signal.val) IN ('pasta', 'pizza') THEN 'Italian'
      WHEN lower(signal.val) IN ('dive bar') THEN 'Cocktail Bar'
      ELSE NULL
    END AS cuisine_type,
    signal.ord
  FROM restaurant_review_intelligence ri,
    LATERAL jsonb_array_elements_text(ri.cuisine_signals) WITH ORDINALITY AS signal(val, ord)
  WHERE ri.cuisine_signals IS NOT NULL
    AND jsonb_array_length(ri.cuisine_signals) > 0
  ORDER BY ri.restaurant_id, signal.ord
) mapping
WHERE r.id = mapping.restaurant_id
  AND r.cuisine_type IS NULL
  AND mapping.cuisine_type IS NOT NULL;

-- Step 2: Name-based overrides for known categories
-- Breweries identified by name (catches any missed by review intelligence)
UPDATE restaurants
SET cuisine_type = 'Brewery/Beer Bar'
WHERE cuisine_type IS NULL
  AND (name ILIKE '%brewery%' OR name ILIKE '%brewpub%' OR name ILIKE '%taproom%');

-- Fix misclassified breweries (classified as "Cocktail Bar" but are actually breweries)
UPDATE restaurants
SET cuisine_type = 'Brewery/Beer Bar'
WHERE name ILIKE '%brewery%'
  AND cuisine_type = 'Cocktail Bar';
