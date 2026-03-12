-- Final straggler fixes from audit completion
-- Generated 2026-03-12

-- ============================================================
-- PIECE PIZZERIA AND BREWERY — Fix cuisine_type (American → Pizza)
-- New Haven-style pizza brewery, not generic American
-- ============================================================
UPDATE restaurants SET cuisine_type = 'Pizza', updated_at = now()
WHERE name ILIKE '%Piece%Pizzeria%' AND cuisine_type = 'American';

-- ============================================================
-- GALIT — Fix service_style (Tasting Menu → Full Table Service)
-- Galit offers a 4-course prix fixe "choose your own adventure" format,
-- not a traditional sequential tasting menu
-- ============================================================
UPDATE restaurant_deep_profiles SET service_style = 'Full Table Service'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Galit' LIMIT 1)
AND service_style = 'Tasting Menu';

-- ============================================================
-- EL MILAGRO — Remove suspect "unique_decor" wow_factor
-- It's a no-frills cafeteria inside a tortilla factory
-- ============================================================
UPDATE restaurant_deep_profiles
SET wow_factors = array_remove(wow_factors, 'unique_decor')
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%El Milagro%' LIMIT 1)
AND 'unique_decor' = ANY(wow_factors);
