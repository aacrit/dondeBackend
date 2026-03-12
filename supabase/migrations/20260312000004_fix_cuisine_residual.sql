-- Residual cuisine fixes after taxonomy migration
--
-- 1. avec River North: resolver picked Middle Eastern from signal[2] because
--    "Mediterranean-inspired" wasn't an exact match. Fix explicitly.
-- 2. 48 remaining NULLs have signals with slight wording variants
--    (e.g. "Indian cuisine" vs "Indian", "Korean food" vs "Korean").
--    Use pattern-matching resolver instead of exact match.

-- ============================================================
-- PATTERN-MATCHING SIGNAL RESOLVER
-- ============================================================
-- Uses ILIKE patterns to catch variations like "Indian cuisine",
-- "Korean food", "authentic Chinese", etc.

CREATE OR REPLACE FUNCTION _fuzzy_map_signal(sig text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN sig ILIKE '%mexican%' THEN 'Mexican'
    WHEN sig ILIKE '%italian%' THEN 'Italian'
    WHEN sig ILIKE '%japanese%' THEN 'Japanese'
    WHEN sig ILIKE '%chinese%' OR sig ILIKE '%cantonese%'
         OR sig ILIKE '%sichuan%' OR sig ILIKE '%szechuan%'
         OR sig ILIKE '%shanghainese%' OR sig ILIKE '%dim sum%' THEN 'Chinese'
    WHEN sig ILIKE '%korean%' THEN 'Korean'
    WHEN sig ILIKE '%indian%' OR sig ILIKE '%hyderabadi%'
         OR sig ILIKE '%pakistani%' THEN 'Indian'
    WHEN sig ILIKE '%thai%' THEN 'Thai'
    WHEN sig ILIKE '%french%' OR sig ILIKE '%bistro%'
         OR sig ILIKE '%provençal%' THEN 'French'
    WHEN sig ILIKE '%vietnamese%' OR sig ILIKE '%pho %'
         OR sig ILIKE '%banh mi%' THEN 'Vietnamese'
    WHEN sig ILIKE '%greek%' THEN 'Greek'
    WHEN sig ILIKE '%ethiopian%' OR sig ILIKE '%eritrean%'
         OR sig ILIKE '%somali%' OR sig ILIKE '%west african%'
         OR sig ILIKE '%nigerian%' OR sig ILIKE '%senegalese%' THEN 'Ethiopian'
    WHEN sig ILIKE '%mediterranean%' OR sig ILIKE '%spanish%'
         OR sig ILIKE '%tapas%' OR sig ILIKE '%catalan%' THEN 'Mediterranean'
    WHEN sig ILIKE '%seafood%' THEN 'Seafood'
    WHEN sig ILIKE '%steakhouse%' OR sig ILIKE '%steak %' THEN 'Steak'
    WHEN sig ILIKE '%colombian%' THEN 'Colombian'
    WHEN sig ILIKE '%cuban%' THEN 'Cuban'
    WHEN sig ILIKE '%puerto rican%' OR sig ILIKE '%boricua%'
         OR sig ILIKE '%jibarito%' THEN 'Puerto Rican'
    WHEN sig ILIKE '%dominican%' OR sig ILIKE '%ecuadorian%'
         OR sig ILIKE '%venezuelan%' OR sig ILIKE '%salvadoran%'
         OR sig ILIKE '%honduran%' OR sig ILIKE '%central american%'
         OR sig ILIKE '%costa rican%' OR sig ILIKE '%latin%' THEN 'Latin American'
    WHEN sig ILIKE '%peruvian%' THEN 'Peruvian'
    WHEN sig ILIKE '%caribbean%' OR sig ILIKE '%jamaican%'
         OR sig ILIKE '%haitian%' OR sig ILIKE '%jerk %' THEN 'Caribbean'
    WHEN sig ILIKE '%brazilian%' THEN 'Brazilian'
    WHEN sig ILIKE '%polish%' THEN 'Polish'
    WHEN sig ILIKE '%ukrainian%' THEN 'Ukrainian'
    WHEN sig ILIKE '%armenian%' OR sig ILIKE '%turkish%'
         OR sig ILIKE '%lebanese%' OR sig ILIKE '%persian%'
         OR sig ILIKE '%middle eastern%' OR sig ILIKE '%palestinian%'
         OR sig ILIKE '%georgian%' OR sig ILIKE '%afghan%'
         OR sig ILIKE '%uzbek%' OR sig ILIKE '%kazakh%' THEN 'Middle Eastern'
    WHEN sig ILIKE '%nepalese%' OR sig ILIKE '%nepali%'
         OR sig ILIKE '%sri lankan%' OR sig ILIKE '%south asian%' THEN 'Indian'
    WHEN sig ILIKE '%portuguese%' THEN 'Mediterranean'
    WHEN sig ILIKE '%bbq%' OR sig ILIKE '%barbecue%' THEN 'BBQ'
    WHEN sig ILIKE '%southern%' OR sig ILIKE '%soul food%'
         OR sig ILIKE '%cajun%' OR sig ILIKE '%creole%' THEN 'Southern/Soul Food'
    WHEN sig ILIKE '%sushi%' OR sig ILIKE '%ramen%'
         OR sig ILIKE '%omakase%' THEN 'Japanese'
    WHEN sig ILIKE '%hot dog%' OR sig ILIKE '%diner%'
         OR sig ILIKE '%burger%' OR sig ILIKE '%comfort food%'
         OR sig ILIKE '%pub food%' OR sig ILIKE '%pub %'
         OR sig ILIKE '%american%' OR sig ILIKE '%gastropub%' THEN 'American'
    WHEN sig ILIKE '%vegan%' OR sig ILIKE '%vegetarian%'
         OR sig ILIKE '%plant-based%' THEN 'Vegan'
    WHEN sig ILIKE '%coffee%' OR sig ILIKE '%café%'
         OR sig ILIKE '%cafe%' OR sig ILIKE '%tea %'
         OR sig ILIKE '%boba%' OR sig ILIKE '%bubble tea%'
         OR sig ILIKE '%matcha%' OR sig ILIKE '%juice bar%' THEN 'Coffee/Cafe'
    WHEN sig ILIKE '%brunch%' OR sig ILIKE '%breakfast%' THEN 'Brunch'
    WHEN sig ILIKE '%healthy%' OR sig ILIKE '%açaí%'
         OR sig ILIKE '%acai%' OR sig ILIKE '%bowls%'
         OR sig ILIKE '%salad%' OR sig ILIKE '%wellness%' THEN 'Vegan'
    WHEN sig ILIKE '%ice cream%' OR sig ILIKE '%dessert%'
         OR sig ILIKE '%bakery%' OR sig ILIKE '%pastri%'
         OR sig ILIKE '%creamery%' OR sig ILIKE '%gluten-free%' THEN 'Coffee/Cafe'
    WHEN sig ILIKE '%craft beer%' OR sig ILIKE '%beer bar%'
         OR sig ILIKE '%brewery%' OR sig ILIKE '%beer%' THEN 'American'
    WHEN sig ILIKE '%taiwanese%' OR sig ILIKE '%filipino%'
         OR sig ILIKE '%indonesian%' OR sig ILIKE '%asian%'
         OR sig ILIKE '%fusion%' OR sig ILIKE '%tasting menu%'
         OR sig ILIKE '%avant-garde%' OR sig ILIKE '%nordic%'
         OR sig ILIKE '%bosnian%' THEN 'Fusion'
    WHEN sig ILIKE '%wine bar%' THEN 'Cocktail Bar'
    WHEN sig ILIKE '%cocktail%' OR sig ILIKE '%speakeasy%'
         OR sig ILIKE '%lounge%' THEN 'Cocktail Bar'
    ELSE NULL
  END
$$;

-- Same multi-signal resolver logic but using fuzzy matching
CREATE OR REPLACE FUNCTION _fuzzy_resolve(signals text[])
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  sig text;
  mapped text;
  cocktail_fallback boolean := false;
BEGIN
  IF signals IS NULL OR array_length(signals, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  FOREACH sig IN ARRAY signals LOOP
    mapped := _fuzzy_map_signal(sig);
    IF mapped IS NOT NULL AND mapped != 'Cocktail Bar' THEN
      RETURN mapped;
    END IF;
    IF mapped = 'Cocktail Bar' THEN
      cocktail_fallback := true;
    END IF;
  END LOOP;
  IF cocktail_fallback THEN
    RETURN 'Cocktail Bar';
  END IF;
  RETURN NULL;
END;
$$;

-- ============================================================
-- FIX 1: avec River North → Mediterranean
-- ============================================================

UPDATE restaurants
SET cuisine_type = 'Mediterranean', updated_at = now()
WHERE name = 'avec River North' AND cuisine_type = 'Middle Eastern';

-- ============================================================
-- FIX 2: Remaining NULLs via fuzzy pattern matching
-- ============================================================

UPDATE restaurants r
SET cuisine_type = _fuzzy_resolve(ri.cuisine_signals),
    updated_at = now()
FROM restaurant_review_intelligence ri
WHERE r.id = ri.restaurant_id
  AND r.cuisine_type IS NULL
  AND ri.cuisine_signals IS NOT NULL
  AND array_length(ri.cuisine_signals, 1) > 0
  AND _fuzzy_resolve(ri.cuisine_signals) IS NOT NULL;

-- ============================================================
-- Clean up
-- ============================================================
DROP FUNCTION IF EXISTS _fuzzy_resolve(text[]);
DROP FUNCTION IF EXISTS _fuzzy_map_signal(text);
