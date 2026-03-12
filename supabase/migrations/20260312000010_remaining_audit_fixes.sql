-- Remaining audit fixes: final accuracy pass for 100% data quality
-- Covers: cuisine reclassifications, insider tip corrections, origin story fixes
-- Generated 2026-03-12 from DondeAI database quality audit (final pass)

-- ============================================================
-- GIRL & THE GOAT — Fix cuisine_type to "New American"
-- Chef-driven globally-influenced small plates, not generic "American"
-- Deep profile already says "New American Small Plates"
-- ============================================================
UPDATE restaurants SET cuisine_type = 'New American', updated_at = now()
WHERE name = 'Girl & The Goat' AND cuisine_type = 'American';

-- ============================================================
-- LAO SZE CHUAN (Grant Park) — Fix insider tip dish name
-- "Tony's Three-Chili Chicken" is not a standard menu item name
-- The actual dish is "Dry Chili Chicken" or "Three-Pepper Chicken"
-- ============================================================
UPDATE restaurants
SET insider_tip = regexp_replace(
    insider_tip,
    'Tony''s Three-Chili Chicken',
    'Dry Chili Chicken',
    'gi'
),
updated_at = now()
WHERE name ILIKE '%Lao Sze Chuan%'
AND insider_tip ILIKE '%Three-Chili Chicken%';

-- ============================================================
-- BIG STAR — Fix origin story characterization of Wicker Park
-- Big Star opened in 2010 when Wicker Park was already well-established,
-- not "still figuring out what it wanted to be"
-- ============================================================
UPDATE restaurant_deep_profiles
SET origin_story = regexp_replace(
    origin_story,
    'when the neighborhood was still figuring out what it wanted to be',
    'in the heart of Wicker Park''s thriving bar and restaurant scene',
    'gi'
)
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Big Star Wicker Park' LIMIT 1)
AND origin_story ILIKE '%still figuring out%';

-- ============================================================
-- JOE'S SEAFOOD — Remove "historic_building" from wow_factors
-- The Chicago location is in a modern commercial space
-- ============================================================
-- (Already in migration 000009, but adding safety net in case name match differs)
UPDATE restaurant_deep_profiles
SET wow_factors = array_remove(wow_factors, 'historic_building')
WHERE restaurant_id IN (SELECT id FROM restaurants WHERE name ILIKE '%Joe%Seafood%Prime%')
AND 'historic_building' = ANY(wow_factors);

-- ============================================================
-- BIG STAR — Fix cuisine_type "Mexican" → "Tex-Mex"
-- Big Star is a taco-and-whiskey honky-tonk, not traditional Mexican
-- Deep profile says "Tex-Mex Tacos & Cantina"
-- ============================================================
UPDATE restaurants SET cuisine_type = 'Tex-Mex', updated_at = now()
WHERE name = 'Big Star Wicker Park' AND cuisine_type = 'Mexican';

-- ============================================================
-- Smoque BBQ insider tip — Fix slightly embellished "counter seats facing the pit"
-- Smoque is a standard counter-service setup, no theatrical pit view
-- ============================================================
UPDATE restaurants
SET insider_tip = 'Arrive by 11:30am on weekends to beat the line — order the Smoque Combo Plate with brisket and ribs, and don''t skip the mac and cheese.',
updated_at = now()
WHERE name = 'Smoque BBQ'
AND insider_tip ILIKE '%counter seats facing the pit%';

-- ============================================================
-- Additional Cocktail Bar reclassifications (missed in earlier migrations)
-- ============================================================

-- Tied House: has smash burger, charcuterie, small plates, full table service — American gastropub
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'Tied House' AND cuisine_type = 'Cocktail Bar';

-- The Native: grain bowls, breakfast burritos, shakshuka — all-day cafe
UPDATE restaurants SET cuisine_type = 'Brunch', updated_at = now()
WHERE name = 'The Native' AND cuisine_type = 'Cocktail Bar';

-- Martin's Corner: Pilsen neighborhood bar — keep as Cocktail Bar (legitimate)
-- Kumiko: Japanese cocktail bar with bar food — keep as Cocktail Bar (cocktails are the focus)
-- The Aviary: Grant Achatz cocktail experience — keep as Cocktail Bar (definitively a bar)
-- Billy Sunday: cocktail-focused bar — keep as Cocktail Bar
-- The Green Mill: jazz club and cocktail bar — keep as Cocktail Bar
-- The California Clipper: bar with music — keep as Cocktail Bar

-- ============================================================
-- AU CHEVAL — Fix service_style (pure "Counter" is incomplete)
-- Au Cheval has counter, booths, and tables with full service
-- ============================================================
UPDATE restaurant_deep_profiles
SET service_style = 'Full Table Service'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Au Cheval' LIMIT 1)
AND service_style = 'Counter';

-- ============================================================
-- FRONTERA GRILL — Bump date_friendly_score from 6 to 7
-- Frontera is a good date spot (Rick Bayless, craft cocktails, intimate vibe)
-- ============================================================
UPDATE occasion_scores SET date_friendly_score = 7
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Frontera Grill' LIMIT 1)
AND date_friendly_score = 6;

-- ============================================================
-- RPM ITALIAN — Lower family_friendly_score from 6 to 4
-- Upscale fine dining, dim lighting, $$$$ — not family-oriented
-- ============================================================
UPDATE occasion_scores SET family_friendly_score = 4
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'RPM Italian' LIMIT 1)
AND family_friendly_score = 6;
