-- Cultural landmark audit fixes: cuisine corrections for well-known Chicago restaurants
-- Discovered during comprehensive spot-check audit on 2026-03-12

-- ============================================================
-- 1. Kasama: Fusion → Filipino (only Michelin-starred Filipino in the US)
-- ============================================================
UPDATE restaurants SET cuisine_type = 'Filipino', updated_at = now()
WHERE name = 'Kasama' AND cuisine_type = 'Fusion';

-- ============================================================
-- 2. Lula Cafe: Brunch → American (New American farm-to-table restaurant)
-- ============================================================
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'Lula Cafe' AND cuisine_type = 'Brunch';

-- ============================================================
-- 3. Ghareeb Nawaz: Indian → Pakistani (both locations)
-- ============================================================
UPDATE restaurants SET cuisine_type = 'Pakistani', updated_at = now()
WHERE name ILIKE '%Ghareeb Nawaz%' AND cuisine_type = 'Indian';

-- ============================================================
-- 4. Parachute HiFi: Korean → Fusion (Korean-American concept)
-- ============================================================
UPDATE restaurants SET cuisine_type = 'Fusion', updated_at = now()
WHERE name = 'Parachute HiFi' AND cuisine_type = 'Korean';

-- ============================================================
-- 5. Birrieria Zaragoza: Fix wrong address (Broadway → Pulaski Rd)
-- ============================================================
UPDATE restaurants SET address = '4852 S Pulaski Rd, Chicago, IL 60632', updated_at = now()
WHERE name ILIKE '%Birrieria Zaragoza%' AND address ILIKE '%Broadway%';

-- ============================================================
-- 6. Kasama: Fix check_average ($35 → $75 blended avg)
-- ============================================================
UPDATE restaurant_deep_profiles SET check_average_per_person = 75
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Kasama' LIMIT 1);

-- ============================================================
-- 7. Kasama: Fix James Beard award description
-- ============================================================
UPDATE restaurant_deep_profiles
SET awards_recognition = ARRAY['Michelin Star', 'James Beard Award - Best Chef: Great Lakes 2023 (Tim Flores & Genie Kwon)']
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Kasama' LIMIT 1);

-- ============================================================
-- 8. Birrieria Zaragoza: Add missing James Beard Award
-- ============================================================
UPDATE restaurant_deep_profiles
SET awards_recognition = ARRAY['James Beard America''s Classics Award 2015']
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Birrieria Zaragoza%' LIMIT 1)
AND (awards_recognition IS NULL OR array_length(awards_recognition, 1) = 0);

-- ============================================================
-- 9. Avec River North: Remove false "river_view" wow factor
-- ============================================================
UPDATE restaurant_deep_profiles
SET wow_factors = array_remove(wow_factors, 'river_view')
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'avec River North' LIMIT 1)
AND 'river_view' = ANY(wow_factors);

-- ============================================================
-- 10. Lula Cafe: Fix reservation_difficulty (hard_to_get → recommended)
-- ============================================================
UPDATE restaurant_deep_profiles
SET reservation_difficulty = 'recommended'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Lula Cafe' LIMIT 1)
AND reservation_difficulty = 'hard_to_get';
