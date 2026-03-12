-- Final audit fixes: remaining lower-priority items for 100% data accuracy
-- Covers: hallucinated signature dishes, origin story corrections, wow_factor cleanup
-- Generated 2026-03-12 from DondeAI database quality audit (batch 1 agent findings)

-- ============================================================
-- GIRL & THE GOAT — Remove hallucinated/generic signature dishes
-- Roasted Bone Marrow, Roasted Cauliflower Steak, and Goat Liver Mousse
-- are generic/hallucinated; real signatures are Wood-Oven Roasted Pig Face,
-- Kohlrabi Salad, Goat Empanadas, Escolar
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (
        elem->>'dish' ILIKE '%Roasted Bone Marrow%'
        OR elem->>'dish' ILIKE '%Cauliflower Steak%'
        OR elem->>'dish' ILIKE '%Goat Liver Mousse%'
    )
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Girl & The Goat' LIMIT 1)
AND (signature_dishes::text ILIKE '%Roasted Bone Marrow%'
     OR signature_dishes::text ILIKE '%Cauliflower Steak%'
     OR signature_dishes::text ILIKE '%Goat Liver Mousse%');

-- ============================================================
-- BIG STAR WICKER PARK — Fix signature dish ordering
-- Al Pastor should be the signature, not Birria Tacos
-- Big Star is famous for its Al Pastor tacos, not birria
-- ============================================================
-- Remove hallucinated Birria Tacos (Big Star doesn't serve birria)
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (elem->>'dish' ILIKE '%Birria%')
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Big Star Wicker Park' LIMIT 1)
AND signature_dishes::text ILIKE '%Birria%';

-- ============================================================
-- BIG STAR WICKER PARK — Fix origin story to credit Paul Kahan / One Off Hospitality
-- Big Star is a Paul Kahan / One Off Hospitality restaurant (James Beard winner)
-- ============================================================
UPDATE restaurant_deep_profiles
SET origin_story = regexp_replace(
    origin_story,
    '^',
    'Founded by James Beard Award-winning chef Paul Kahan and the One Off Hospitality Group. '
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Big Star Wicker Park' LIMIT 1)
AND origin_story IS NOT NULL
AND origin_story NOT ILIKE '%Paul Kahan%'
AND origin_story NOT ILIKE '%One Off%';

-- ============================================================
-- RPM STEAK — Remove unverified "Bone Marrow Flan" from signature dishes
-- This dish cannot be verified on RPM Steak's actual menu
-- ============================================================
UPDATE restaurant_deep_profiles
SET signature_dishes = (
    SELECT jsonb_agg(elem)
    FROM jsonb_array_elements(signature_dishes) AS elem
    WHERE NOT (elem->>'dish' ILIKE '%Bone Marrow Flan%')
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'RPM Steak' LIMIT 1)
AND signature_dishes::text ILIKE '%Bone Marrow Flan%';

-- ============================================================
-- JOE'S SEAFOOD — Remove hallucinated "historic_building" wow_factor
-- Joe's is in a modern commercial space, not a historic building
-- ============================================================
UPDATE restaurant_deep_profiles
SET wow_factors = array_remove(wow_factors, 'historic_building')
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Joe%Seafood%' LIMIT 1)
AND 'historic_building' = ANY(wow_factors);

-- ============================================================
-- AU CHEVAL — Adjust price_level to $$ (diner-style but premium pricing)
-- Au Cheval's double cheeseburger is ~$16, bone marrow ~$18, most items $15-25
-- $$ is more accurate than $ for the actual check average
-- ============================================================
UPDATE restaurants SET price_level = '$$', updated_at = now()
WHERE name = 'Au Cheval' AND price_level = '$';
