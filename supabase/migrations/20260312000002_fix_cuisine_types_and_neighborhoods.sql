-- Fix #1: Reclassify "Cocktail Bar" restaurants using cuisine_signals from review intelligence
-- Fix #2: Backfill NULL cuisine_type from cuisine_signals (saves API cost vs re-enrichment)
-- Fix #3: Merge 5 duplicate neighborhoods (Pilsen, Wicker Park, Lincoln Park, West Loop, River North)

-- ============================================================
-- CUISINE SIGNAL → CUISINE TYPE MAPPING FUNCTION
-- ============================================================
-- Maps the raw first cuisine_signal string to a valid DondeAI cuisine_type.
-- Uses case-insensitive matching with fallback patterns.

CREATE OR REPLACE FUNCTION _map_cuisine_signal(signal text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- Exact matches (most common signals)
    WHEN lower(signal) IN ('mexican', 'mexican cuisine', 'mexican food', 'mexican seafood') THEN 'Mexican'
    WHEN lower(signal) IN ('italian', 'italian fine dining', 'italian steakhouse') THEN 'Italian'
    WHEN lower(signal) IN ('japanese', 'sushi', 'ramen', 'omakase', 'teppanyaki', 'japanese bbq') THEN 'Japanese'
    WHEN lower(signal) IN ('thai', 'thai cuisine', 'thai food', 'thai fusion') THEN 'Thai'
    WHEN lower(signal) IN ('chinese', 'chinese food', 'chinese cuisine', 'cantonese', 'cantonese cuisine',
                           'sichuan', 'sichuan chinese', 'szechuan', 'chinese comfort food',
                           'chinese bbq', 'chinese hotpot', 'hot pot', 'hotpot', 'chinese-american',
                           'regional chinese', 'korean chinese') THEN 'Chinese'
    WHEN lower(signal) IN ('korean', 'korean bbq', 'korean fried chicken', 'korean/mexican fusion') THEN 'Korean'
    WHEN lower(signal) IN ('indian', 'south asian', 'desi food', 'kerala cuisine', 'sri lankan') THEN 'Indian'
    WHEN lower(signal) IN ('french', 'french-inspired', 'french bakery', 'french-vietnamese') THEN 'French'
    WHEN lower(signal) IN ('seafood', 'fresh seafood', 'fried seafood', 'cajun seafood') THEN 'Seafood'
    WHEN lower(signal) IN ('steakhouse', 'steak', 'meat-focused') THEN 'Steak'
    WHEN lower(signal) IN ('mediterranean', 'coastal cuisine', 'southern european') THEN 'Mediterranean'
    WHEN lower(signal) IN ('vietnamese') THEN 'Vietnamese'
    WHEN lower(signal) IN ('greek') THEN 'Greek'
    WHEN lower(signal) IN ('american', 'american food', 'american casual', 'american casual dining',
                           'american comfort food', 'american diner', 'american pub', 'american bar food',
                           'american brunch', 'american breakfast', 'traditional american',
                           'upscale american', 'comfort food', 'contemporary american',
                           'modern/contemporary american', 'contemporary', 'midwest cuisine',
                           'burgers', 'hot dogs', 'diner', 'pub food', 'pub grub', 'pub fare',
                           'gastropub', 'sports bar food', 'casual dining', 'gourmet',
                           'upscale dining', 'fine dining') THEN 'American'
    WHEN lower(signal) IN ('bbq', 'barbecue') THEN 'BBQ'
    WHEN lower(signal) IN ('brunch', 'breakfast', 'breakfast/brunch', 'cafe/brunch') THEN 'Brunch'
    WHEN lower(signal) IN ('vegan', 'vegetarian', 'vegan comfort food', 'healthy food',
                           'healthy/clean eating', 'organic') THEN 'Vegan'
    WHEN lower(signal) IN ('coffee shop', 'cafe', 'café', 'coffee', 'specialty coffee',
                           'craft coffee', 'coffee house', 'coffee bar', 'coffee cafe',
                           'cafe/coffee shop', 'european café', 'spanish café',
                           'guatemalan coffee', 'european chocolate cafe', 'tea shop',
                           'tea house', 'boba tea', 'bubble tea', 'juice bar') THEN 'Coffee/Cafe'
    WHEN lower(signal) IN ('middle eastern', 'turkish', 'lebanese', 'persian', 'palestinian',
                           'azeri', 'georgian') THEN 'Middle Eastern'
    WHEN lower(signal) IN ('southern', 'southern food', 'southern cooking', 'soul food',
                           'southern/soul food', 'southern style', 'southern comfort food',
                           'southern chicken', 'cajun', 'southern/soul food') THEN 'Southern/Soul Food'
    WHEN lower(signal) IN ('peruvian', 'south american') THEN 'Peruvian'
    WHEN lower(signal) IN ('ethiopian', 'eritrean', 'somali', 'african cuisine', 'african',
                           'west african', 'nigerian cuisine', 'senegalese', 'liberian') THEN 'Ethiopian'
    WHEN lower(signal) IN ('caribbean', 'caribbean (jerk)', 'jamaican', 'reggae') THEN 'Caribbean'
    WHEN lower(signal) IN ('brazilian') THEN 'Brazilian'
    WHEN lower(signal) IN ('polish', 'ukrainian', 'polish-colombian fusion') THEN 'Polish'
    WHEN lower(signal) IN ('puerto rican', 'cuban', 'dominican', 'central american',
                           'costa rican', 'salvadoran', 'ecuadorian', 'colombian',
                           'colombian food', 'latin american', 'latin') THEN 'Puerto Rican'
    WHEN lower(signal) IN ('fusion', 'pan-asian', 'asian', 'asian food', 'asian inspired',
                           'asian bbq', 'taiwanese', 'filipino', 'mexican-indian fusion') THEN 'Fusion'
    WHEN lower(signal) IN ('spanish', 'spanish tapas') THEN 'Mediterranean'
    WHEN lower(signal) IN ('german', 'irish pub', 'irish gastropub', 'european',
                           'central asian', 'moroccan', 'swedish') THEN 'Fusion'
    WHEN lower(signal) IN ('craft beer', 'beer', 'brewery/craft beer', 'brewery food',
                           'brewpub', 'beer garden') THEN 'American'
    WHEN lower(signal) IN ('pizza', 'chicago pizza', 'sandwiches', 'bagels', 'deli',
                           'baked goods', 'bakery', 'colombian bakery', 'mexican bakery',
                           'european bakery', 'desserts', 'dessert', 'yogurt bowls') THEN 'American'
    -- Bar/cocktail signals — only classify as Cocktail Bar if clearly bar-focused
    WHEN lower(signal) IN ('cocktail bar', 'cocktails', 'cocktail lounge', 'craft cocktails',
                           'cocktail-focused', 'cocktails/mixed drinks', 'martini lounge',
                           'mezcal bar', 'tiki', 'bar drinks', 'drinks/cocktails',
                           'jazz club beverages', 'thc beverages') THEN 'Cocktail Bar'
    WHEN lower(signal) IN ('bar food', 'dive bar', 'dive bar food') THEN 'American'
    -- Fallback: NULL if we can't map it
    ELSE NULL
  END
$$;

-- ============================================================
-- FIX #1: Reclassify 261 "Cocktail Bar" restaurants
-- ============================================================
-- These were misclassified because the re-enrichment pipeline mapped
-- Google "bar" type to "Cocktail Bar" when no specific restaurant type existed.
-- Use cuisine_signals[1] from review intelligence as ground truth.
-- (cuisine_signals is text[], Postgres arrays are 1-indexed)

UPDATE restaurants r
SET cuisine_type = _map_cuisine_signal(ri.cuisine_signals[1]),
    updated_at = now()
FROM restaurant_review_intelligence ri
WHERE r.id = ri.restaurant_id
  AND r.cuisine_type = 'Cocktail Bar'
  AND ri.cuisine_signals IS NOT NULL
  AND array_length(ri.cuisine_signals, 1) > 0
  AND _map_cuisine_signal(ri.cuisine_signals[1]) IS NOT NULL
  AND _map_cuisine_signal(ri.cuisine_signals[1]) != 'Cocktail Bar';

-- ============================================================
-- FIX #2: Backfill NULL cuisine_type from cuisine_signals
-- ============================================================
-- 1,806 restaurants have NULL cuisine_type. Use cuisine_signals[1]
-- from review intelligence as ground truth. Zero API cost.
-- (cuisine_signals is text[], Postgres arrays are 1-indexed)

UPDATE restaurants r
SET cuisine_type = _map_cuisine_signal(ri.cuisine_signals[1]),
    updated_at = now()
FROM restaurant_review_intelligence ri
WHERE r.id = ri.restaurant_id
  AND r.cuisine_type IS NULL
  AND ri.cuisine_signals IS NOT NULL
  AND array_length(ri.cuisine_signals, 1) > 0
  AND _map_cuisine_signal(ri.cuisine_signals[1]) IS NOT NULL;

-- ============================================================
-- FIX #3: Merge 5 duplicate neighborhoods
-- ============================================================
-- Keep the first (alphabetically by ID) UUID for each name, reassign restaurants.

-- Pilsen: keep fee79b01, merge ff99dac1
UPDATE restaurants SET neighborhood_id = 'fee79b01-ceff-4755-8291-3a08190da0cd'
WHERE neighborhood_id = 'ff99dac1-716d-47a8-af0b-300c0c0be410';
DELETE FROM neighborhoods WHERE id = 'ff99dac1-716d-47a8-af0b-300c0c0be410';

-- Wicker Park: keep 462906ef, merge 731e0bb2
UPDATE restaurants SET neighborhood_id = '462906ef-c5c1-4376-b439-474756b38698'
WHERE neighborhood_id = '731e0bb2-7903-4526-adc3-cce45a3d0677';
DELETE FROM neighborhoods WHERE id = '731e0bb2-7903-4526-adc3-cce45a3d0677';

-- Lincoln Park: keep acbcd031, merge af702230
UPDATE restaurants SET neighborhood_id = 'acbcd031-160f-406c-978b-18ac932d1471'
WHERE neighborhood_id = 'af702230-ab6d-4370-ab5e-b7d395beefa6';
DELETE FROM neighborhoods WHERE id = 'af702230-ab6d-4370-ab5e-b7d395beefa6';

-- West Loop: keep 8100f6c7, merge a0ea4cdd
UPDATE restaurants SET neighborhood_id = '8100f6c7-c4f7-46ce-b4c3-dedbfdd680fb'
WHERE neighborhood_id = 'a0ea4cdd-9a1f-41d9-b6cb-ba8f760199f5';
DELETE FROM neighborhoods WHERE id = 'a0ea4cdd-9a1f-41d9-b6cb-ba8f760199f5';

-- River North: keep e4f2562f, merge f3c9df16
UPDATE restaurants SET neighborhood_id = 'e4f2562f-6e8d-4df6-9803-1a95e20a58ae'
WHERE neighborhood_id = 'f3c9df16-adfb-4e66-b2ee-e980607c640c';
DELETE FROM neighborhoods WHERE id = 'f3c9df16-adfb-4e66-b2ee-e980607c640c';

-- Clean up: drop the helper function (not needed at runtime)
DROP FUNCTION IF EXISTS _map_cuisine_signal(text);
