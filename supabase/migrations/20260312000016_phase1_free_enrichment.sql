-- ============================================================
-- Phase 1: Free Enrichment — SQL-only data quality boost ($0 cost)
-- ============================================================
-- 1. Bootstrap signature_dishes from popular_dishes (review intelligence → deep profiles)
-- 2. Generate best_for_scenarios from occasion scores + cuisine + price
-- 3. Hardcode insider_tip for 7 iconic Chicago restaurants
-- ============================================================

-- ============================================================
-- PART 1: Bootstrap signature_dishes from popular_dishes
-- ============================================================
-- popular_dishes (text[]) in restaurant_review_intelligence contains
-- dishes mentioned 3+ times with positive sentiment in Google reviews.
-- signature_dishes (jsonb) in restaurant_deep_profiles expects [{dish, why}].
--
-- This backfills signature_dishes for restaurants that have popular_dishes
-- data but NULL/empty signature_dishes in their deep profile.
-- ============================================================

UPDATE restaurant_deep_profiles dp
SET signature_dishes = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'dish', dish_name,
      'why', 'Frequently praised in reviews'
    )
  )
  FROM unnest(ri.popular_dishes) AS dish_name
),
enriched_at = NOW()
FROM restaurant_review_intelligence ri
WHERE ri.restaurant_id = dp.restaurant_id
  AND ri.popular_dishes IS NOT NULL
  AND array_length(ri.popular_dishes, 1) > 0
  AND (dp.signature_dishes IS NULL
       OR dp.signature_dishes = '[]'::jsonb
       OR dp.signature_dishes = 'null'::jsonb);


-- ============================================================
-- PART 2: Generate best_for_scenarios from occasion scores
-- ============================================================
-- best_for_scenarios (text[]) in restaurant_review_intelligence is used
-- by V11 semantic matching in get_candidates_v11 RPC.
--
-- We derive scenarios from high occasion scores (>=7), cuisine type,
-- and price level — no AI needed for this 80% coverage.
-- ============================================================

UPDATE restaurant_review_intelligence ri
SET best_for_scenarios = derived.scenarios
FROM (
  SELECT
    r.id AS restaurant_id,
    array_remove(ARRAY[
      -- Occasion-based scenarios (score >= 7 triggers inclusion)
      CASE WHEN os.date_friendly_score >= 7 THEN 'date night' END,
      CASE WHEN os.date_friendly_score >= 8 THEN 'first date' END,
      CASE WHEN os.romantic_rating >= 7 THEN 'romantic dinner' END,
      CASE WHEN os.romantic_rating >= 8 THEN 'anniversary dinner' END,
      CASE WHEN os.group_friendly_score >= 7 THEN 'group dinner' END,
      CASE WHEN os.group_friendly_score >= 8 THEN 'birthday dinner' END,
      CASE WHEN os.family_friendly_score >= 7 THEN 'family dinner' END,
      CASE WHEN os.family_friendly_score >= 8 THEN 'kids birthday' END,
      CASE WHEN os.business_lunch_score >= 7 THEN 'business lunch' END,
      CASE WHEN os.business_lunch_score >= 8 THEN 'client entertainment' END,
      CASE WHEN os.solo_dining_score >= 7 THEN 'solo dining' END,
      CASE WHEN os.solo_dining_score >= 8 THEN 'working lunch' END,
      CASE WHEN os.hole_in_wall_factor >= 7 THEN 'hidden gem' END,
      CASE WHEN os.hole_in_wall_factor >= 8 THEN 'foodie adventure' END,

      -- Price-based scenarios
      CASE WHEN r.price_level = '$' THEN 'cheap eats' END,
      CASE WHEN r.price_level = '$' THEN 'quick bite' END,
      CASE WHEN r.price_level = '$$$$' THEN 'special occasion splurge' END,
      CASE WHEN r.price_level = '$$$$' THEN 'celebration dinner' END,

      -- Cuisine-based common scenarios
      CASE WHEN r.cuisine_type = 'Italian' AND os.romantic_rating >= 6 THEN 'romantic Italian dinner' END,
      CASE WHEN r.cuisine_type = 'Japanese' AND r.price_level IN ('$$$', '$$$$') THEN 'omakase experience' END,
      CASE WHEN r.cuisine_type = 'Mexican' AND os.group_friendly_score >= 6 THEN 'taco night' END,
      CASE WHEN r.cuisine_type IN ('American', 'BBQ') AND os.group_friendly_score >= 7 THEN 'casual hangout' END,
      CASE WHEN r.cuisine_type = 'Steakhouse' AND os.business_lunch_score >= 6 THEN 'power lunch' END,
      CASE WHEN r.cuisine_type = 'Steakhouse' AND os.romantic_rating >= 6 THEN 'steak dinner' END,

      -- Deep profile cross-reference scenarios
      CASE WHEN dp.chef_notable = true THEN 'chef-driven dining' END,
      CASE WHEN dp.instagram_worthiness >= 8 THEN 'instagram-worthy spot' END,
      CASE WHEN dp.cultural_authenticity >= 8 THEN 'authentic cultural experience' END,
      CASE WHEN dp.byob_policy = 'full_byob' THEN 'BYOB dinner' END
    ], NULL) AS scenarios
  FROM restaurants r
  JOIN occasion_scores os ON os.restaurant_id = r.id
  LEFT JOIN restaurant_deep_profiles dp ON dp.restaurant_id = r.id
  WHERE r.is_active = true
) derived
WHERE ri.restaurant_id = derived.restaurant_id
  AND (ri.best_for_scenarios IS NULL
       OR ri.best_for_scenarios = '{}'
       OR array_length(ri.best_for_scenarios, 1) IS NULL);

-- Also backfill for restaurants that have review intelligence rows but
-- no best_for_scenarios yet. For restaurants WITHOUT a review intelligence
-- row, we insert one with just the scenarios.
INSERT INTO restaurant_review_intelligence (restaurant_id, best_for_scenarios)
SELECT
  r.id,
  array_remove(ARRAY[
    CASE WHEN os.date_friendly_score >= 7 THEN 'date night' END,
    CASE WHEN os.romantic_rating >= 7 THEN 'romantic dinner' END,
    CASE WHEN os.romantic_rating >= 8 THEN 'anniversary dinner' END,
    CASE WHEN os.group_friendly_score >= 7 THEN 'group dinner' END,
    CASE WHEN os.group_friendly_score >= 8 THEN 'birthday dinner' END,
    CASE WHEN os.family_friendly_score >= 7 THEN 'family dinner' END,
    CASE WHEN os.business_lunch_score >= 7 THEN 'business lunch' END,
    CASE WHEN os.solo_dining_score >= 7 THEN 'solo dining' END,
    CASE WHEN os.hole_in_wall_factor >= 7 THEN 'hidden gem' END,
    CASE WHEN r.price_level = '$' THEN 'cheap eats' END,
    CASE WHEN r.price_level = '$$$$' THEN 'special occasion splurge' END,
    CASE WHEN dp.chef_notable = true THEN 'chef-driven dining' END,
    CASE WHEN dp.cultural_authenticity >= 8 THEN 'authentic cultural experience' END,
    CASE WHEN dp.byob_policy = 'full_byob' THEN 'BYOB dinner' END
  ], NULL)
FROM restaurants r
JOIN occasion_scores os ON os.restaurant_id = r.id
LEFT JOIN restaurant_deep_profiles dp ON dp.restaurant_id = r.id
WHERE r.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM restaurant_review_intelligence ri2
    WHERE ri2.restaurant_id = r.id
  )
ON CONFLICT (restaurant_id) DO NOTHING;


-- ============================================================
-- PART 3: Insider tips for 7 iconic Chicago restaurants
-- ============================================================
-- These are the most-queried restaurants in Chicago. A good insider
-- tip directly improves the user experience (shown in API response).
-- ============================================================

UPDATE restaurants SET insider_tip = 'Order online for pickup to skip the notoriously long lines — the Italian beef dipped with hot peppers is the move.' WHERE name = 'Portillo''s' AND insider_tip IS NULL;
UPDATE restaurants SET insider_tip = 'The Malnati Chicago Classic with buttercrust is the signature — order it well-done for extra crispy edges.' WHERE name = 'Lou Malnati''s Pizzeria' AND insider_tip IS NULL;
UPDATE restaurants SET insider_tip = 'The caramelized crust is legendary — sit at the bar for faster service and a front-row view of the pan pizza action.' WHERE name = 'Pequod''s Pizza' AND insider_tip IS NULL;
UPDATE restaurants SET insider_tip = 'Write your name on the wall while you wait — the Supreme deep dish and the Meaty Legend are the crowd favorites.' WHERE name = 'Gino''s East' AND insider_tip IS NULL;
UPDATE restaurants SET insider_tip = 'Pull up to the original 1948 drive-in for the full experience — the Superdawg and Superburger are the classics.' WHERE name = 'Superdawg Drive-In' AND insider_tip IS NULL;
UPDATE restaurants SET insider_tip = 'Cash only — get the Italian beef dipped with hot giardiniera. Jay Leno and Obama ate here. Expect to stand.' WHERE name = 'Mr. Beef on Orleans' AND insider_tip IS NULL;
UPDATE restaurants SET insider_tip = 'Cash only, no seats — get the combo (Italian beef + Italian sausage) dipped. Arrive before 2pm to avoid sellouts.' WHERE name = 'Johnnie''s Beef' AND insider_tip IS NULL;

-- Also update Al's #1 Italian Beef which was already in the DB
UPDATE restaurants SET insider_tip = 'The original since 1938 — get the combo dipped with sweet and hot peppers at the Little Italy location for the real deal.' WHERE name ILIKE 'Al''s #1%' AND insider_tip IS NULL;
