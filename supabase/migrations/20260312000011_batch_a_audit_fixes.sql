-- Batch A audit fixes: spot-check findings from 15-restaurant deep review
-- Covers: Alinea, Schwa, Dove's, Twin Anchors, Publican, Boka, Momotaro,
--         Bavette's, Monteverde, Tied House, Wildberry
-- Generated 2026-03-12

-- ============================================================
-- ALINEA — Fix cuisine_type "Fusion" → "American"
-- Alinea is Grant Achatz's molecular gastronomy / progressive American;
-- "Fusion" is misleading. Using "American" since subcategory captures specifics.
-- ============================================================
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'Alinea' AND cuisine_type = 'Fusion';

-- ============================================================
-- ALINEA — Fix lighting_ambiance
-- Alinea's dining rooms are dimly lit with dramatic lighting
-- ============================================================
UPDATE restaurants SET lighting_ambiance = 'dim', updated_at = now()
WHERE name = 'Alinea' AND lighting_ambiance NOT IN ('dim');

-- ============================================================
-- ALINEA — Fix check_average ($250 → $395)
-- Gallery menu is ~$395 per person as of 2025
-- ============================================================
UPDATE restaurant_deep_profiles SET check_average_per_person = 395
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Alinea' LIMIT 1)
AND check_average_per_person < 395;

-- ============================================================
-- ALINEA — Remove hallucinated signature dishes
-- Keep only verified: Helium Balloon, Black Truffle Explosion, Edible Table Dessert
-- Remove generic AI-generated course descriptions
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (
        elem->>'dish' ILIKE '%Antisquid%'
        OR elem->>'dish' ILIKE '%Deconstructed Vegetable%'
        OR elem->>'dish' ILIKE '%Liquid Nitrogen%'
        OR elem->>'dish' ILIKE '%Edible Soil%'
        OR elem->>'dish' ILIKE '%Smoked Fish Course%'
        OR elem->>'dish' ILIKE '%Fermented Vegetable%'
        OR elem->>'dish' ILIKE '%Citrus Acid%'
        OR elem->>'dish' ILIKE '%Mushroom Umami%'
        OR elem->>'dish' ILIKE '%Floral and Herb%'
    )
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Alinea' LIMIT 1)
AND signature_dishes::text ILIKE '%Antisquid%';

-- ============================================================
-- ALINEA — Remove questionable "live_cooking_show" wow_factor
-- ============================================================
UPDATE restaurant_deep_profiles
SET wow_factors = array_remove(wow_factors, 'live_cooking_show')
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Alinea' LIMIT 1)
AND 'live_cooking_show' = ANY(wow_factors);

-- ============================================================
-- DOVE'S LUNCHEONETTE — Fix cuisine_type "Fusion" → "Mexican"
-- Dove's is a Mexican-inspired diner/luncheonette, not generic "Fusion"
-- ============================================================
UPDATE restaurants SET cuisine_type = 'Mexican', updated_at = now()
WHERE name ILIKE '%Dove%Luncheonette%' AND cuisine_type = 'Fusion';

-- ============================================================
-- DOVE'S LUNCHEONETTE — Fix lighting "bright" → "warm"
-- Vintage diner with warm, retro lighting
-- ============================================================
UPDATE restaurants SET lighting_ambiance = 'warm', updated_at = now()
WHERE name ILIKE '%Dove%Luncheonette%' AND lighting_ambiance = 'bright';

-- ============================================================
-- DOVE'S LUNCHEONETTE — Remove hallucinated signature dishes
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (
        elem->>'dish' ILIKE '%Chiles Rellenos%'
        OR elem->>'dish' ILIKE '%Chiles en Nogada%'
        OR elem->>'dish' ILIKE '%Barbacoa Tacos%'
        OR elem->>'dish' ILIKE '%Churros with Chocolate%'
        OR elem->>'dish' ILIKE '%Quesadilla de Flor%'
    )
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Dove%Luncheonette%' LIMIT 1)
AND (signature_dishes::text ILIKE '%Chiles Rellenos%'
     OR signature_dishes::text ILIKE '%Chiles en Nogada%');

-- ============================================================
-- SCHWA — CRITICAL: Fix byob_policy "full_bar" → "full_byob"
-- Schwa is famously BYOB — one of its defining features
-- The insider_tip even says "Schwa is BYOB" while byob_policy says full_bar
-- ============================================================
UPDATE restaurant_deep_profiles SET byob_policy = 'full_byob'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Schwa' LIMIT 1)
AND byob_policy = 'full_bar';

-- ============================================================
-- SCHWA — Fix dress_code "Business Casual" → "Casual"
-- Schwa is famously casual for fine dining (jeans and t-shirts are the norm)
-- ============================================================
UPDATE restaurants SET dress_code = 'Casual', updated_at = now()
WHERE name = 'Schwa' AND dress_code = 'Business Casual';

-- ============================================================
-- SCHWA — Remove hallucinated generic signature dishes
-- Keep only verified: Quail Egg Raviolo
-- Remove generic course descriptions
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (
        elem->>'dish' ILIKE '%Tasting Menu Course%'
        OR elem->>'dish' ILIKE '%Foie Gras Preparation%'
        OR elem->>'dish' ILIKE '%Deconstructed Dessert%'
        OR elem->>'dish' ILIKE '%Charred Vegetable Composition%'
        OR elem->>'dish' ILIKE '%Bone Marrow Preparation%'
        OR elem->>'dish' ILIKE '%Delicate Fish Course%'
        OR elem->>'dish' ILIKE '%Charred Meat Course%'
        OR elem->>'dish' ILIKE '%Edible Flowers%'
        OR elem->>'dish' ILIKE '%Smoked Fish Preparation%'
        OR elem->>'dish' ILIKE '%Vegetable Terrine%'
    )
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Schwa' LIMIT 1)
AND signature_dishes::text ILIKE '%Tasting Menu Course%';

-- ============================================================
-- TWIN ANCHORS — Fix origin_story year (1954 → 1932)
-- Twin Anchors opened in 1932, not 1954. Core part of their identity.
-- ============================================================
UPDATE restaurant_deep_profiles
SET origin_story = regexp_replace(origin_story, '1954', '1932', 'g')
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Twin Anchors' LIMIT 1)
AND origin_story ILIKE '%1954%';

-- ============================================================
-- TWIN ANCHORS — Remove hallucinated signature dishes
-- Twin Anchors is a rib joint, not a Kansas City BBQ place
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (
        elem->>'dish' ILIKE '%Burnt Ends%'
        OR elem->>'dish' ILIKE '%Smoked Turkey%'
        OR elem->>'dish' ILIKE '%Beef Brisket%'
        OR elem->>'dish' ILIKE '%Smoked Chicken%'
    )
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Twin Anchors' LIMIT 1)
AND signature_dishes::text ILIKE '%Burnt Ends%';

-- ============================================================
-- THE PUBLICAN — Fix lighting "bright" → "moderate"
-- Beer-hall ambiance with moderate/warm lighting
-- ============================================================
UPDATE restaurants SET lighting_ambiance = 'moderate', updated_at = now()
WHERE name = 'The Publican' AND lighting_ambiance = 'bright';

-- ============================================================
-- THE PUBLICAN — Remove hallucinated signature dishes
-- The Publican is not a BBQ restaurant
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (
        elem->>'dish' ILIKE '%Smoked Brisket%'
        OR elem->>'dish' ILIKE '%Clams Casino%'
    )
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'The Publican' LIMIT 1)
AND (signature_dishes::text ILIKE '%Smoked Brisket%' OR signature_dishes::text ILIKE '%Clams Casino%');

-- ============================================================
-- BOKA — Fix lighting "warm" → "dim"
-- Boka is a dimly lit fine dining room
-- ============================================================
UPDATE restaurants SET lighting_ambiance = 'dim', updated_at = now()
WHERE name = 'Boka' AND lighting_ambiance = 'warm';

-- ============================================================
-- BOKA — Remove hallucinated generic signature dishes
-- Nearly all are AI-generated category descriptions, not real dishes
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (
        elem->>'dish' ILIKE '%Tasting Menu Opener%'
        OR elem->>'dish' ILIKE '%Pastry Finale%'
        OR elem->>'dish' ILIKE '%Seasonal Fish Course%'
        OR elem->>'dish' ILIKE '%Charred Vegetable Medley%'
        OR elem->>'dish' ILIKE '%Hand-Rolled Pasta%'
    )
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Boka' LIMIT 1)
AND signature_dishes::text ILIKE '%Tasting Menu Opener%';

-- ============================================================
-- MOMOTARO — Fix awards_recognition (Bib Gourmand → Michelin Star)
-- Momotaro received a Michelin star
-- ============================================================
UPDATE restaurant_deep_profiles
SET awards_recognition = array_replace(awards_recognition, 'Michelin Bib Gourmand', 'Michelin Star')
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Momotaro' LIMIT 1)
AND 'Michelin Bib Gourmand' = ANY(awards_recognition);

-- ============================================================
-- MOMOTARO — Remove hallucinated/wrong signature dishes
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (
        elem->>'dish' ILIKE '%Hamachi Jalapeno Roll%'
        OR elem->>'dish' ILIKE '%Edamame with Sea Salt%'
        OR elem->>'dish' ILIKE '%Matcha Panna Cotta%'
        OR elem->>'dish' ILIKE '%Japanese Whisky%'
        OR elem->>'dish' ILIKE '%Sake Cocktail%'
    )
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Momotaro' LIMIT 1)
AND (signature_dishes::text ILIKE '%Hamachi Jalapeno%' OR signature_dishes::text ILIKE '%Whisky Cocktail%');

-- ============================================================
-- MOMOTARO — Remove false "celebrity_chef" wow_factor
-- Momotaro is a Boka Group restaurant, no single celebrity chef
-- ============================================================
UPDATE restaurant_deep_profiles
SET wow_factors = array_remove(wow_factors, 'celebrity_chef')
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Momotaro' LIMIT 1)
AND 'celebrity_chef' = ANY(wow_factors);

-- ============================================================
-- MOMOTARO — Fix check_average ($55 → $80)
-- ============================================================
UPDATE restaurant_deep_profiles SET check_average_per_person = 80
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Momotaro' LIMIT 1)
AND check_average_per_person = 55;

-- ============================================================
-- BAVETTE'S — Fix reservation_difficulty "required" → "hard_to_get"
-- Bavette's is notoriously hard to book
-- ============================================================
UPDATE restaurant_deep_profiles SET reservation_difficulty = 'hard_to_get'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Bavette%' LIMIT 1)
AND reservation_difficulty = 'required';

-- ============================================================
-- BAVETTE'S — Remove hallucinated signature dishes
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (
        elem->>'dish' ILIKE '%Beef Cheeks Bourguignon%'
        OR elem->>'dish' ILIKE '%Foie Gras Terrine%'
    )
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Bavette%' LIMIT 1)
AND signature_dishes::text ILIKE '%Beef Cheeks Bourguignon%';

-- ============================================================
-- MONTEVERDE — Fix byob_policy "corkage_fee" → "full_bar"
-- Monteverde has a full wine and cocktail program
-- ============================================================
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Monteverde' LIMIT 1)
AND byob_policy = 'corkage_fee';

-- ============================================================
-- MONTEVERDE — Remove hallucinated signature dishes
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (
        elem->>'dish' ILIKE '%Pappardelle al Cinghiale%'
        OR elem->>'dish' ILIKE '%Branzino al Forno%'
        OR elem->>'dish' ILIKE '%Osso Buco%'
        OR elem->>'dish' ILIKE '%Gnocchi al Tartufo%'
    )
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Monteverde' LIMIT 1)
AND (signature_dishes::text ILIKE '%Pappardelle al Cinghiale%' OR signature_dishes::text ILIKE '%Osso Buco%');

-- ============================================================
-- TIED HOUSE — Fix price_level "$$$" → "$$"
-- Tied House is a casual brewery restaurant
-- ============================================================
UPDATE restaurants SET price_level = '$$', updated_at = now()
WHERE name = 'Tied House' AND price_level = '$$$';

-- ============================================================
-- TIED HOUSE — Fix dress_code "Smart Casual" → "Casual"
-- It's a brewery
-- ============================================================
UPDATE restaurants SET dress_code = 'Casual', updated_at = now()
WHERE name = 'Tied House' AND dress_code = 'Smart Casual';

-- ============================================================
-- WILDBERRY PANCAKES — Fix typical_wait_minutes (30 → 60)
-- Notorious for 1hr+ weekend waits
-- ============================================================
UPDATE restaurant_deep_profiles SET typical_wait_minutes = 60
WHERE restaurant_id IN (SELECT id FROM restaurants WHERE name ILIKE '%Wildberry%')
AND typical_wait_minutes = 30;
