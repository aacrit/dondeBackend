-- Comprehensive audit fixes: ALL findings from 3-batch fact-check of 40+ restaurants
-- Covers: lighting, pricing, BYOB, wait times, chef attribution, hallucinated data,
--         additional Cocktail Bar reclassifications, and deep profile corrections
-- Generated 2026-03-12 from DondeAI database quality audit

-- ============================================================
-- AU CHEVAL — 8 fixes (most errors in batch)
-- ============================================================

-- Fix lighting (bright → dim; it's famously dark/moody, deep profile says "dimly-lit-diner-noir")
UPDATE restaurants SET lighting_ambiance = 'dim', updated_at = now()
WHERE name = 'Au Cheval' AND lighting_ambiance = 'bright';

-- Fix BYOB policy (Au Cheval has a full bar with cocktails and whiskey)
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Au Cheval' LIMIT 1)
AND byob_policy = 'no_byob';

-- Fix reservation difficulty (famous for extreme waits, now on Resy)
UPDATE restaurant_deep_profiles SET reservation_difficulty = 'hard_to_get'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Au Cheval' LIMIT 1)
AND reservation_difficulty = 'walk_in_friendly';

-- Fix typical wait (30 → 90 min; peak waits are 1-2+ hours)
UPDATE restaurant_deep_profiles SET typical_wait_minutes = 90
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Au Cheval' LIMIT 1)
AND typical_wait_minutes = 30;

-- Fix check average ($22 → $30)
UPDATE restaurant_deep_profiles SET check_average_per_person = 30
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Au Cheval' LIMIT 1)
AND check_average_per_person = 22;

-- Fix hole_in_wall_factor (2 → 5; dark cramped diner, but famous/expensive)
UPDATE occasion_scores SET hole_in_wall_factor = 5
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Au Cheval' LIMIT 1)
AND hole_in_wall_factor = 2;

-- ============================================================
-- SMOQUE BBQ — 3 fixes
-- ============================================================

-- Fix price level ($$ → $; counter-service BBQ at $15-20/person)
UPDATE restaurants SET price_level = '$', updated_at = now()
WHERE name = 'Smoque BBQ' AND price_level = '$$';

-- Fix BYOB (Smoque is BYOB with no corkage fee — well-known feature)
UPDATE restaurant_deep_profiles SET byob_policy = 'byob_allowed'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Smoque BBQ' LIMIT 1)
AND byob_policy = 'no_byob';

-- Remove hallucinated wow_factors
UPDATE restaurant_deep_profiles
SET wow_factors = array_remove(array_remove(wow_factors, 'unique_decor'), 'live_cooking_show')
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Smoque BBQ' LIMIT 1)
AND ('unique_decor' = ANY(wow_factors) OR 'live_cooking_show' = ANY(wow_factors));

-- ============================================================
-- FRONTERA GRILL — 2 fixes
-- ============================================================

-- Fix price level ($$ → $$$; entrees $22-35, dinner $50-70/person)
UPDATE restaurants SET price_level = '$$$', updated_at = now()
WHERE name = 'Frontera Grill' AND price_level = '$$';

-- Fix check average ($24 → $48)
UPDATE restaurant_deep_profiles SET check_average_per_person = 48
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Frontera Grill' LIMIT 1)
AND check_average_per_person = 24;

-- ============================================================
-- RPM ITALIAN — 4 fixes
-- ============================================================

-- Fix lighting (bright → dim; dramatically lit room)
UPDATE restaurants SET lighting_ambiance = 'dim', updated_at = now()
WHERE name = 'RPM Italian' AND lighting_ambiance = 'bright';

-- Fix dress code (Casual → Smart Casual; polished upscale dining room)
UPDATE restaurants SET dress_code = 'Smart Casual', updated_at = now()
WHERE name = 'RPM Italian' AND dress_code = 'Casual';

-- Fix price level ($$$ → $$$$; pasta $24-38, mains $40-65)
UPDATE restaurants SET price_level = '$$$$', updated_at = now()
WHERE name = 'RPM Italian' AND price_level = '$$$';

-- Fix check average ($42 → $70)
UPDATE restaurant_deep_profiles SET check_average_per_person = 70
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'RPM Italian' LIMIT 1)
AND check_average_per_person = 42;

-- ============================================================
-- GIBSONS BAR & STEAKHOUSE — Remove hallucinated wow_factors
-- ============================================================
UPDATE restaurant_deep_profiles
SET wow_factors = array_remove(array_remove(wow_factors, 'celebrity_chef'), 'historic_building')
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Gibsons Bar & Steakhouse' LIMIT 1)
AND ('celebrity_chef' = ANY(wow_factors) OR 'historic_building' = ANY(wow_factors));

-- ============================================================
-- BIG STAR WICKER PARK — 2 fixes
-- ============================================================

-- Fix live_music (Big Star programs live honky-tonk/country regularly)
UPDATE restaurants SET live_music = true, updated_at = now()
WHERE name = 'Big Star Wicker Park' AND live_music = false;

-- Fix chef_notable (Paul Kahan / One Off Hospitality, James Beard winner)
UPDATE restaurant_deep_profiles SET chef_notable = true
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Big Star Wicker Park' LIMIT 1)
AND chef_notable = false;

-- ============================================================
-- JOE'S SEAFOOD — 2 fixes
-- ============================================================

-- Fix chef_notable (Joe's has no celebrity chef; it's a legacy brand)
UPDATE restaurant_deep_profiles SET chef_notable = false
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Joe%Seafood%' LIMIT 1)
AND chef_notable = true;

-- Remove hallucinated celebrity_chef wow_factor
UPDATE restaurant_deep_profiles
SET wow_factors = array_remove(wow_factors, 'celebrity_chef')
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Joe%Seafood%' LIMIT 1)
AND 'celebrity_chef' = ANY(wow_factors);

-- ============================================================
-- GIRL & THE GOAT — Fix outdoor_seating (has patio, esp. post-COVID Randolph St)
-- ============================================================
UPDATE restaurants SET outdoor_seating = true, updated_at = now()
WHERE name = 'Girl & The Goat' AND outdoor_seating = false;

-- ============================================================
-- LULA CAFE — Additional fixes (cuisine already fixed in migration 000007)
-- ============================================================

-- Fix lighting (bright → warm; cozy neighborhood cafe)
UPDATE restaurants SET lighting_ambiance = 'warm', updated_at = now()
WHERE name = 'Lula Cafe' AND lighting_ambiance = 'bright';

-- Fix typical wait (45 → 20; 45 only realistic for walk-in brunch)
UPDATE restaurant_deep_profiles SET typical_wait_minutes = 20
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Lula Cafe' LIMIT 1)
AND typical_wait_minutes = 45;

-- Fix hole_in_wall_factor (7 → 5; casual but not a hole-in-the-wall)
UPDATE occasion_scores SET hole_in_wall_factor = 5
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Lula Cafe' LIMIT 1)
AND hole_in_wall_factor = 7;

-- ============================================================
-- SMOQUE BBQ — Fix lighting (bright → warm; casual but warm atmosphere)
-- ============================================================
UPDATE restaurants SET lighting_ambiance = 'warm', updated_at = now()
WHERE name = 'Smoque BBQ' AND lighting_ambiance = 'bright';

-- ============================================================
-- FRONTERA GRILL — Fix lighting (bright → warm; rich, warm dining room)
-- ============================================================
UPDATE restaurants SET lighting_ambiance = 'warm', updated_at = now()
WHERE name = 'Frontera Grill' AND lighting_ambiance = 'bright';

-- ============================================================
-- Additional Cocktail Bar reclassifications (food-forward spots from batch 1)
-- ============================================================

-- Nobody's Darling: serves "solid smash burger" — American gastropub
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name ILIKE '%Nobody%Darling%' AND cuisine_type = 'Cocktail Bar';

-- Electric Funeral: "smoked wings" — American bar food
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'Electric Funeral' AND cuisine_type = 'Cocktail Bar';

-- Quality Time: "loaded fries and craft cocktail" — American
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'Quality Time' AND cuisine_type = 'Cocktail Bar';

-- The Charleston: "kitchen that punches above" — American gastropub
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'The Charleston' AND cuisine_type = 'Cocktail Bar';

-- The Press Room: "quality food without tasting-menu theater" — American
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'The Press Room' AND cuisine_type = 'Cocktail Bar';

-- Lone Wolf: "smash burger alongside craft cocktail" — American
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'Lone Wolf' AND cuisine_type = 'Cocktail Bar';

-- Remedy: "Remedy Burger at brunch" — Brunch
UPDATE restaurants SET cuisine_type = 'Brunch', updated_at = now()
WHERE name = 'Remedy' AND cuisine_type = 'Cocktail Bar';

-- The Getaway: "smash burger" — American
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'The Getaway' AND cuisine_type = 'Cocktail Bar';

-- Larry's at The Lawrence House: "proper burger" — American
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name ILIKE '%Larry%Lawrence%' AND cuisine_type = 'Cocktail Bar';

-- The Double Urban Tavern: "great burgers, local drafts" — American
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'The Double Urban Tavern' AND cuisine_type = 'Cocktail Bar';

-- ============================================================
-- RPM STEAK — Fix chef_notable (Lettuce Entertain You / Rancic family)
-- ============================================================
UPDATE restaurant_deep_profiles SET chef_notable = true
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'RPM Steak' LIMIT 1)
AND chef_notable = false;

-- ============================================================
-- goosefoot — Fix hole_in_wall_factor (7 → 3; refined tasting menu at $$$$)
-- ============================================================
UPDATE occasion_scores SET hole_in_wall_factor = 3
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%goosefoot%' LIMIT 1)
AND hole_in_wall_factor = 7;

-- ============================================================
-- Jibaritos y Mas — Remove questionable "historic_building" wow_factor
-- ============================================================
UPDATE restaurant_deep_profiles
SET wow_factors = array_remove(wow_factors, 'historic_building')
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Jibaritos%' LIMIT 1)
AND 'historic_building' = ANY(wow_factors);

-- ============================================================
-- MingHin Cuisine (all locations) — Fix dim sum cart service myth
-- MingHin uses order-from-menu system, not rolling carts
-- ============================================================
UPDATE restaurants SET insider_tip = 'Arrive before 11am on weekends for the best dim sum selection — order the har gow and siu mai from the checklist menu before the crowds build.', updated_at = now()
WHERE name ILIKE '%MingHin%' AND insider_tip ILIKE '%cart%';

UPDATE restaurant_deep_profiles
SET origin_story = regexp_replace(origin_story, 'cart[- ]service|steamer baskets arrive in waves|cart service ritual', 'checklist-based ordering system', 'gi')
WHERE restaurant_id IN (SELECT id FROM restaurants WHERE name ILIKE '%MingHin%')
AND origin_story ILIKE '%cart%';

-- ============================================================
-- MingHin Streeterville — Remove hallucinated "Hand-Pulled Noodles" from signature_dishes
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (elem->>'dish' ILIKE '%Hand-Pulled Noodle%')
)
WHERE restaurant_id IN (SELECT id FROM restaurants WHERE name ILIKE '%MingHin%Streeterville%')
AND signature_dishes::text ILIKE '%Hand-Pulled Noodle%';

-- ============================================================
-- Au Cheval — Remove hallucinated signature dishes (Smash Burger, Cheese Curds, Hot Dog, Root Beer Float)
-- Au Cheval makes thick diner-style patties, NOT smash burgers. Small Cheval does smash-style.
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (
        elem->>'dish' ILIKE '%Smash Burger%'
        OR elem->>'dish' ILIKE '%Cheese Curds%'
        OR elem->>'dish' ILIKE '%Hot Dog%'
        OR elem->>'dish' ILIKE '%Root Beer Float%'
    )
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Au Cheval' LIMIT 1)
AND signature_dishes::text ILIKE '%Smash Burger%';

-- ============================================================
-- RPM Italian — Remove hallucinated "Margherita Pizza" and "Fettuccine Alfredo"
-- RPM Italian does not serve pizza
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (
        elem->>'dish' ILIKE '%Margherita Pizza%'
        OR elem->>'dish' ILIKE '%Fettuccine Alfredo%'
    )
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'RPM Italian' LIMIT 1)
AND (signature_dishes::text ILIKE '%Margherita Pizza%' OR signature_dishes::text ILIKE '%Fettuccine Alfredo%');

-- ============================================================
-- Birrieria Zaragoza — Remove hallucinated dishes (Birria de Pollo, Birria Vegetariana, Chiles Rellenos de Birria)
-- Zaragoza has a very focused menu of traditional birria (goat and beef only)
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (
        elem->>'dish' ILIKE '%Birria de Pollo%'
        OR elem->>'dish' ILIKE '%Birria Vegetariana%'
        OR elem->>'dish' ILIKE '%Chiles Rellenos de Birria%'
    )
)
WHERE restaurant_id IN (SELECT id FROM restaurants WHERE name ILIKE '%Birrieria Zaragoza%')
AND (signature_dishes::text ILIKE '%Birria de Pollo%' OR signature_dishes::text ILIKE '%Birria Vegetariana%');
