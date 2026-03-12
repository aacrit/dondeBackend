-- Batch B audit fixes: spot-check findings from 15-restaurant deep review
-- Covers: Uncle Mike's, Galit, Superkhana, Aba, Cindy's, Chez Joel, Fat Chris's
-- Generated 2026-03-12

-- ============================================================
-- UNCLE MIKE'S PLACE — CRITICAL: Entire profile is wrong
-- The record describes a Wicker Park dive bar, NOT the Filipino breakfast
-- institution at 1700 W Grand Ave. Fix the most critical fields.
-- ============================================================

-- Fix cuisine_type (Fusion → Filipino)
UPDATE restaurants SET cuisine_type = 'Filipino', updated_at = now()
WHERE name ILIKE '%Uncle Mike%Place%' AND cuisine_type = 'Fusion';

-- Fix lighting (dim → bright; it's a breakfast diner)
UPDATE restaurants SET lighting_ambiance = 'bright', updated_at = now()
WHERE name ILIKE '%Uncle Mike%Place%' AND lighting_ambiance = 'dim';

-- Fix byob_policy (full_bar → no_byob; it's a breakfast diner, no bar)
UPDATE restaurant_deep_profiles SET byob_policy = 'no_byob'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Uncle Mike%Place%' LIMIT 1)
AND byob_policy = 'full_bar';

-- Fix service_style (Bar Service → Counter; it's a diner)
UPDATE restaurant_deep_profiles SET service_style = 'Counter'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Uncle Mike%Place%' LIMIT 1)
AND service_style = 'Bar Service';

-- Fix check_average ($12 → $18)
UPDATE restaurant_deep_profiles SET check_average_per_person = 18
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Uncle Mike%Place%' LIMIT 1)
AND check_average_per_person = 12;

-- Fix kid_friendliness (5 → 9; family-friendly Filipino diner)
UPDATE restaurant_deep_profiles SET kid_friendliness = 9
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Uncle Mike%Place%' LIMIT 1)
AND kid_friendliness = 5;

-- Remove wrong wow_factors (speakeasy_vibe is absurd for a breakfast diner)
UPDATE restaurant_deep_profiles
SET wow_factors = array_remove(array_remove(wow_factors, 'speakeasy_vibe'), 'unique_decor')
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Uncle Mike%Place%' LIMIT 1)
AND ('speakeasy_vibe' = ANY(wow_factors) OR 'unique_decor' = ANY(wow_factors));

-- Remove ALL hallucinated signature dishes (every single one is wrong)
-- Uncle Mike's serves: Longanisa, Tocino, Baby Bangus, Skirt Steak, garlic rice platters
UPDATE restaurant_deep_profiles
SET signature_dishes = '[
    {"dish": "Longanisa Breakfast", "why": "Filipino sweet sausage with garlic rice and eggs — the quintessential Uncle Mike''s order"},
    {"dish": "Tocino", "why": "Sweet cured pork belly, a Filipino breakfast staple"},
    {"dish": "Baby Bangus", "why": "Milkfish, a Filipino delicacy rarely found in Chicago"},
    {"dish": "Skirt Steak and Eggs", "why": "Hearty breakfast plate, generous portion"}
]'::jsonb
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Uncle Mike%Place%' LIMIT 1);

-- ============================================================
-- GALIT — Fix awards (Bib Gourmand → Michelin Star)
-- Galit has a full Michelin Star since 2022, NOT Bib Gourmand
-- ============================================================
UPDATE restaurant_deep_profiles
SET awards_recognition = ARRAY['Michelin Star', 'James Beard Rising Star Chef 2017 (Zach Engel)']
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Galit' LIMIT 1);

-- Fix lighting (dim → warm; described as "warm and inviting")
UPDATE restaurants SET lighting_ambiance = 'warm', updated_at = now()
WHERE name = 'Galit' AND lighting_ambiance = 'dim';

-- Fix check_average ($65 → $95; prix fixe is $85-$105)
UPDATE restaurant_deep_profiles SET check_average_per_person = 95
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Galit' LIMIT 1)
AND check_average_per_person = 65;

-- Fix origin_story Bib Gourmand reference
UPDATE restaurant_deep_profiles
SET origin_story = regexp_replace(origin_story, 'Bib Gourmand', 'Michelin star', 'gi')
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Galit' LIMIT 1)
AND origin_story ILIKE '%Bib Gourmand%';

-- ============================================================
-- SUPERKHANA INTERNATIONAL — Fix byob_policy (no_byob → full_bar)
-- Has cocktails, beer, wine, and happy hour
-- ============================================================
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Superkhana%' LIMIT 1)
AND byob_policy = 'no_byob';

-- Fix check_average ($16 → $30)
UPDATE restaurant_deep_profiles SET check_average_per_person = 30
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Superkhana%' LIMIT 1)
AND check_average_per_person = 16;

-- ============================================================
-- ABA — Fix outdoor_seating (false → true)
-- Famous for year-round rooftop patio; insider_tip references it
-- ============================================================
UPDATE restaurants SET outdoor_seating = true, updated_at = now()
WHERE name = 'Aba' AND outdoor_seating = false;

-- ============================================================
-- CINDY'S ROOFTOP — Fix outdoor_seating (null → true)
-- It's literally a rooftop bar/restaurant
-- ============================================================
UPDATE restaurants SET outdoor_seating = true, updated_at = now()
WHERE name ILIKE '%Cindy%Rooftop%' AND (outdoor_seating IS NULL OR outdoor_seating = false);

-- Fix check_average ($45 → $65)
UPDATE restaurant_deep_profiles SET check_average_per_person = 65
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Cindy%Rooftop%' LIMIT 1)
AND check_average_per_person = 45;

-- ============================================================
-- CHEZ JOEL — Fix byob_policy (corkage_fee → full_bar)
-- Has a full bar and wine list; corkage is secondary
-- ============================================================
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Chez Joel%' LIMIT 1)
AND byob_policy = 'corkage_fee';

-- Fix outdoor_seating (null → true; famous garden patio)
UPDATE restaurants SET outdoor_seating = true, updated_at = now()
WHERE name ILIKE '%Chez Joel%' AND (outdoor_seating IS NULL OR outdoor_seating = false);

-- Fix check_average ($32 → $45)
UPDATE restaurant_deep_profiles SET check_average_per_person = 45
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Chez Joel%' LIMIT 1)
AND check_average_per_person = 32;

-- ============================================================
-- FAT CHRIS'S PIZZA — Fix cuisine_type (American → Pizza)
-- It's specifically a Detroit-style pizza shop
-- ============================================================
UPDATE restaurants SET cuisine_type = 'Pizza', updated_at = now()
WHERE name ILIKE '%Fat Chris%' AND cuisine_type = 'American';
