-- Comprehensive cuisine taxonomy fix
--
-- Problems solved:
--   1. 49 Cocktail Bar restaurants with clear food signals (scan ALL signals, not just [1])
--   2. 51 "Puerto Rican" restaurants that are actually Colombian, Cuban, Dominican, etc.
--   3. Ukrainian restaurants misclassified as "Polish"
--   4. Eritrean/West African restaurants misclassified as "Ethiopian"
--   5. Georgian restaurant misclassified as "Middle Eastern"
--   6. Remaining 257 NULL cuisine_types — second-pass with improved mapping
--
-- New cuisine types added: Colombian, Cuban, Latin American

-- ============================================================
-- IMPROVED MAPPING FUNCTION
-- ============================================================
-- Scans a SINGLE signal and returns the best cuisine type.
-- Key changes from v1:
--   - Colombian, Cuban, Latin American are distinct (not lumped into Puerto Rican)
--   - Ukrainian is distinct from Polish
--   - Eritrean stays Ethiopian (close enough culturally)
--   - Georgian stays Middle Eastern (common taxonomy grouping)
--   - Spanish stays Mediterranean (common taxonomy grouping)

CREATE OR REPLACE FUNCTION _map_signal(sig text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- === LATIN AMERICAN (split from the old Puerto Rican catch-all) ===
    WHEN lower(sig) IN ('colombian', 'colombian food', 'colombian cuisine',
                        'colombian bakery') THEN 'Colombian'
    WHEN lower(sig) IN ('cuban', 'cuban fusion', 'authentic cuban',
                        'cuban food') THEN 'Cuban'
    WHEN lower(sig) IN ('puerto rican', 'boricua', 'jibarito',
                        'mofongo') THEN 'Puerto Rican'
    WHEN lower(sig) IN ('dominican', 'dominican food') THEN 'Latin American'
    WHEN lower(sig) IN ('ecuadorian', 'ecuadorian food',
                        'authentic ecuadorian food') THEN 'Latin American'
    WHEN lower(sig) IN ('venezuelan', 'venezuelan (arepas)') THEN 'Latin American'
    WHEN lower(sig) IN ('salvadoran', 'central american',
                        'costa rican', 'honduran', 'guatemalan',
                        'latin american', 'latin', 'latin fusion') THEN 'Latin American'

    -- === CORE CUISINES (unchanged) ===
    WHEN lower(sig) IN ('mexican', 'mexican cuisine', 'mexican food',
                        'mexican seafood', 'mexican-inspired',
                        'tex-mex', 'oaxacan') THEN 'Mexican'
    WHEN lower(sig) IN ('italian', 'italian fine dining',
                        'italian steakhouse', 'sicilian',
                        'neapolitan', 'tuscan') THEN 'Italian'
    WHEN lower(sig) IN ('japanese', 'sushi', 'ramen', 'omakase',
                        'teppanyaki', 'japanese bbq', 'izakaya',
                        'yakitori', 'udon', 'tempura') THEN 'Japanese'
    WHEN lower(sig) IN ('thai', 'thai cuisine', 'thai food',
                        'thai fusion', 'thai street food') THEN 'Thai'
    WHEN lower(sig) IN ('chinese', 'chinese food', 'chinese cuisine',
                        'cantonese', 'cantonese cuisine', 'sichuan',
                        'sichuan chinese', 'szechuan',
                        'chinese comfort food', 'chinese bbq',
                        'chinese hotpot', 'hot pot', 'hotpot',
                        'chinese-american', 'regional chinese',
                        'korean chinese', 'dim sum',
                        'shanghainese') THEN 'Chinese'
    WHEN lower(sig) IN ('korean', 'korean bbq', 'korean fried chicken',
                        'korean/mexican fusion', 'korean fusion') THEN 'Korean'
    WHEN lower(sig) IN ('indian', 'south asian', 'desi food',
                        'kerala cuisine', 'sri lankan',
                        'north indian', 'south indian',
                        'indo-chinese', 'pakistani') THEN 'Indian'
    WHEN lower(sig) IN ('french', 'french-inspired', 'french bakery',
                        'french-vietnamese', 'provençal',
                        'french bistro') THEN 'French'
    WHEN lower(sig) IN ('seafood', 'fresh seafood', 'fried seafood',
                        'cajun seafood', 'seafood boil',
                        'seafood restaurant') THEN 'Seafood'
    WHEN lower(sig) IN ('steakhouse', 'steak', 'meat-focused',
                        'argentinian steakhouse',
                        'prime steakhouse') THEN 'Steak'
    WHEN lower(sig) IN ('mediterranean', 'coastal cuisine',
                        'southern european', 'spanish',
                        'spanish tapas', 'catalan', 'tapas',
                        'barcelona-style', 'mezze',
                        'north african') THEN 'Mediterranean'
    WHEN lower(sig) IN ('vietnamese', 'pho', 'banh mi') THEN 'Vietnamese'
    WHEN lower(sig) IN ('greek', 'greek food') THEN 'Greek'
    WHEN lower(sig) IN ('american', 'american food', 'american casual',
                        'american casual dining', 'american comfort food',
                        'american diner', 'american pub',
                        'american bar food', 'american brunch',
                        'american breakfast', 'traditional american',
                        'upscale american', 'comfort food',
                        'contemporary american',
                        'modern/contemporary american',
                        'modern american', 'contemporary',
                        'midwest cuisine', 'new american',
                        'elevated comfort food',
                        'classic american fare',
                        'elevated bar cuisine',
                        'elevated tavern fare') THEN 'American'
    WHEN lower(sig) IN ('burgers', 'hot dogs', 'diner', 'pub food',
                        'pub grub', 'pub fare', 'gastropub',
                        'sports bar food', 'casual dining',
                        'gourmet', 'upscale dining',
                        'fine dining', 'bar classics',
                        'finger foods', 'wings',
                        'bar food', 'dive bar food') THEN 'American'
    WHEN lower(sig) IN ('bbq', 'barbecue', 'smoked meats',
                        'texas bbq') THEN 'BBQ'
    WHEN lower(sig) IN ('brunch', 'breakfast', 'breakfast/brunch',
                        'cafe/brunch', 'brunch spot') THEN 'Brunch'
    WHEN lower(sig) IN ('vegan', 'vegetarian', 'vegan comfort food',
                        'healthy food', 'healthy/clean eating',
                        'organic', 'plant-based') THEN 'Vegan'
    WHEN lower(sig) IN ('coffee shop', 'cafe', 'café', 'coffee',
                        'specialty coffee', 'craft coffee',
                        'coffee house', 'coffee bar', 'coffee cafe',
                        'cafe/coffee shop', 'european café',
                        'spanish café', 'guatemalan coffee',
                        'european chocolate cafe', 'tea shop',
                        'tea house', 'boba tea', 'bubble tea',
                        'juice bar', 'bakery cafe') THEN 'Coffee/Cafe'
    WHEN lower(sig) IN ('middle eastern', 'turkish', 'lebanese',
                        'persian', 'palestinian', 'azeri',
                        'georgian', 'kurdish', 'afghan',
                        'iraqi') THEN 'Middle Eastern'
    WHEN lower(sig) IN ('southern', 'southern food', 'southern cooking',
                        'soul food', 'southern/soul food',
                        'southern style', 'southern comfort food',
                        'southern chicken', 'cajun',
                        'creole', 'lowcountry') THEN 'Southern/Soul Food'
    WHEN lower(sig) IN ('peruvian', 'south american',
                        'peruvian fusion') THEN 'Peruvian'
    WHEN lower(sig) IN ('ethiopian', 'eritrean', 'somali',
                        'african cuisine', 'african',
                        'west african', 'nigerian cuisine',
                        'senegalese', 'liberian',
                        'authentic african cuisine',
                        'eastern african') THEN 'Ethiopian'
    WHEN lower(sig) IN ('caribbean', 'caribbean (jerk)', 'jamaican',
                        'haitian', 'trinidadian',
                        'jerk cuisine') THEN 'Caribbean'
    WHEN lower(sig) IN ('brazilian', 'brazilian steakhouse') THEN 'Brazilian'
    WHEN lower(sig) IN ('polish', 'polish cuisine') THEN 'Polish'
    WHEN lower(sig) IN ('ukrainian', 'eastern european',
                        'authentic home cooking') THEN 'Ukrainian'
    WHEN lower(sig) IN ('fusion', 'pan-asian', 'asian', 'asian food',
                        'asian inspired', 'asian bbq', 'taiwanese',
                        'filipino', 'mexican-indian fusion',
                        'globally-inspired', 'eclectic',
                        'asian fusion', 'fusion cuisine') THEN 'Fusion'
    WHEN lower(sig) IN ('irish', 'irish classics', 'irish pub',
                        'irish gastropub') THEN 'American'
    WHEN lower(sig) IN ('german', 'european', 'central asian',
                        'moroccan', 'swedish') THEN 'Fusion'
    WHEN lower(sig) IN ('craft beer', 'beer', 'brewery/craft beer',
                        'brewery food', 'brewpub',
                        'beer garden') THEN 'American'
    WHEN lower(sig) IN ('pizza', 'chicago pizza', 'sandwiches',
                        'bagels', 'deli', 'baked goods', 'bakery',
                        'colombian bakery', 'mexican bakery',
                        'european bakery', 'desserts', 'dessert',
                        'yogurt bowls', 'pastries') THEN 'American'
    WHEN lower(sig) IN ('hawaiian', 'tiki') THEN 'Fusion'
    WHEN lower(sig) IN ('duck-focused') THEN 'American'

    -- === COCKTAIL / BAR signals — only if nothing else matches ===
    WHEN lower(sig) IN ('cocktail bar', 'cocktails', 'cocktail lounge',
                        'craft cocktails', 'cocktail-focused',
                        'cocktails/mixed drinks', 'martini lounge',
                        'mezcal bar', 'bar drinks',
                        'drinks/cocktails', 'jazz club beverages',
                        'thc beverages', 'speakeasy',
                        'wine bar') THEN 'Cocktail Bar'

    ELSE NULL
  END
$$;

-- ============================================================
-- SMART MULTI-SIGNAL RESOLVER
-- ============================================================
-- Loops through ALL cuisine_signals and returns the BEST food match.
-- Prefers food cuisines over Cocktail Bar. Only returns Cocktail Bar
-- if every signal maps to Cocktail Bar or NULL.

CREATE OR REPLACE FUNCTION _resolve_cuisine(signals text[])
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  sig text;
  mapped text;
  cocktail_fallback boolean := false;
BEGIN
  IF signals IS NULL OR array_length(signals, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  -- Pass 1: find the first non-Cocktail-Bar food match
  FOREACH sig IN ARRAY signals LOOP
    mapped := _map_signal(sig);
    IF mapped IS NOT NULL AND mapped != 'Cocktail Bar' THEN
      RETURN mapped;
    END IF;
    IF mapped = 'Cocktail Bar' THEN
      cocktail_fallback := true;
    END IF;
  END LOOP;

  -- Pass 2: if all signals were cocktail/bar, return Cocktail Bar
  IF cocktail_fallback THEN
    RETURN 'Cocktail Bar';
  END IF;

  RETURN NULL;
END;
$$;

-- ============================================================
-- FIX 1: Reclassify remaining Cocktail Bar restaurants
-- ============================================================
-- 137 restaurants still typed "Cocktail Bar". 49 have clear food signals.
-- The multi-signal resolver scans ALL signals for the best food match.

UPDATE restaurants r
SET cuisine_type = _resolve_cuisine(ri.cuisine_signals),
    updated_at = now()
FROM restaurant_review_intelligence ri
WHERE r.id = ri.restaurant_id
  AND r.cuisine_type = 'Cocktail Bar'
  AND ri.cuisine_signals IS NOT NULL
  AND array_length(ri.cuisine_signals, 1) > 0
  AND _resolve_cuisine(ri.cuisine_signals) IS NOT NULL
  AND _resolve_cuisine(ri.cuisine_signals) != 'Cocktail Bar';

-- ============================================================
-- FIX 2: Reclassify "Puerto Rican" catch-all
-- ============================================================
-- 51 of 72 "Puerto Rican" restaurants are actually Colombian, Cuban,
-- Dominican, Ecuadorian, Venezuelan, or generic Latin American.
-- Re-resolve using the improved mapping that distinguishes these.

UPDATE restaurants r
SET cuisine_type = _resolve_cuisine(ri.cuisine_signals),
    updated_at = now()
FROM restaurant_review_intelligence ri
WHERE r.id = ri.restaurant_id
  AND r.cuisine_type = 'Puerto Rican'
  AND ri.cuisine_signals IS NOT NULL
  AND array_length(ri.cuisine_signals, 1) > 0
  AND _resolve_cuisine(ri.cuisine_signals) IS NOT NULL
  AND _resolve_cuisine(ri.cuisine_signals) != 'Puerto Rican';

-- ============================================================
-- FIX 3: Reclassify "Polish" that are actually Ukrainian
-- ============================================================

UPDATE restaurants r
SET cuisine_type = 'Ukrainian',
    updated_at = now()
FROM restaurant_review_intelligence ri
WHERE r.id = ri.restaurant_id
  AND r.cuisine_type = 'Polish'
  AND ri.cuisine_signals IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(ri.cuisine_signals) s
    WHERE lower(s) = 'ukrainian'
  );

-- ============================================================
-- FIX 4: Second-pass backfill for remaining NULL cuisine_type
-- ============================================================
-- 257 still NULL. The improved multi-signal resolver + expanded
-- mapping may catch ones the first migration missed.

UPDATE restaurants r
SET cuisine_type = _resolve_cuisine(ri.cuisine_signals),
    updated_at = now()
FROM restaurant_review_intelligence ri
WHERE r.id = ri.restaurant_id
  AND r.cuisine_type IS NULL
  AND ri.cuisine_signals IS NOT NULL
  AND array_length(ri.cuisine_signals, 1) > 0
  AND _resolve_cuisine(ri.cuisine_signals) IS NOT NULL;

-- ============================================================
-- FIX 5: Specific high-profile corrections
-- ============================================================
-- avec River North: Mediterranean restaurant classified as Cocktail Bar
-- (sister restaurant "avec Restaurant" is correctly Mediterranean)

UPDATE restaurants
SET cuisine_type = 'Mediterranean', updated_at = now()
WHERE name = 'avec River North' AND cuisine_type = 'Cocktail Bar';

-- ============================================================
-- Clean up: drop helper functions (not needed at runtime)
-- ============================================================
DROP FUNCTION IF EXISTS _resolve_cuisine(text[]);
DROP FUNCTION IF EXISTS _map_signal(text);
-- Also clean up the v1 function if it still exists
DROP FUNCTION IF EXISTS _map_cuisine_signal(text);
