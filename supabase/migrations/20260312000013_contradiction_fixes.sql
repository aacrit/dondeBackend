-- Cross-field contradiction fixes from systematic scan
-- Covers: BYOB contradictions, group_size typos, lighting/romantic conflicts
-- Generated 2026-03-12

-- ============================================================
-- LE COLONIAL — Fix group_size_sweet_spot [2,70) → [2,7)
-- Clear data entry error (70 instead of 7)
-- ============================================================
UPDATE restaurant_deep_profiles
SET group_size_sweet_spot = '[2,7)'::int4range
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Le Colonial%' LIMIT 1)
AND group_size_sweet_spot = '[2,70)'::int4range;

-- ============================================================
-- NOBODY'S DARLING — Fix byob_policy (full_byob → full_bar)
-- It's a cocktail bar — cannot be BYOB
-- ============================================================
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Nobody%Darling%' LIMIT 1)
AND byob_policy = 'full_byob';

-- ============================================================
-- ELIXIR ANDERSONVILLE — Fix byob_policy (full_byob → full_bar)
-- It's a cocktail bar — cannot be BYOB
-- ============================================================
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Elixir Andersonville' LIMIT 1)
AND byob_policy = 'full_byob';

-- ============================================================
-- Fix remaining BYOB contradictions for bars/lounges
-- Restaurants with "Bar" in name that are marked full_byob
-- ============================================================

-- Phlavz Bar & Grille — has a bar
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Phlavz%' LIMIT 1)
AND byob_policy = 'full_byob';

-- Farm Bar Lakeview — has a bar
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Farm Bar%' LIMIT 1)
AND byob_policy = 'full_byob';

-- Bar Roma — has a bar
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Bar Roma' LIMIT 1)
AND byob_policy = 'full_byob';

-- BellyBowl Kitchen & Lounge — has a lounge
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%BellyBowl%' LIMIT 1)
AND byob_policy = 'full_byob';

-- D'Nuez - Kitchen + Bar - Pilsen — has a bar
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%D%Nuez%' LIMIT 1)
AND byob_policy = 'full_byob';

-- Truffle Restaurant & Bar — has a bar
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Truffle%Bar%' LIMIT 1)
AND byob_policy = 'full_byob';

-- South Of The Border Restaurant & Bar — has a bar
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%South%Border%Bar%' LIMIT 1)
AND byob_policy = 'full_byob';

-- ============================================================
-- NORTH POND — Fix lighting_ambiance (bright → warm)
-- Fine dining in Arts & Crafts building with natural light from park
-- "warm" better captures the ambiance; romantic_rating=10 is correct
-- ============================================================
UPDATE restaurants SET lighting_ambiance = 'warm', updated_at = now()
WHERE name = 'North Pond' AND lighting_ambiance = 'bright';

-- ============================================================
-- LIGHTING NORMALIZATION
-- Normalize free-text lighting values to controlled vocabulary:
-- bright, warm, dim, moderate, candlelit
-- ============================================================

-- "modern" → "bright" (41 restaurants)
UPDATE restaurants SET lighting_ambiance = 'bright', updated_at = now()
WHERE lighting_ambiance = 'modern';

-- "Bright and casual" → "bright"
UPDATE restaurants SET lighting_ambiance = 'bright', updated_at = now()
WHERE lighting_ambiance ILIKE 'Bright and%';

-- "Warm and inviting" and similar → "warm"
UPDATE restaurants SET lighting_ambiance = 'warm', updated_at = now()
WHERE lighting_ambiance ILIKE 'Warm and%'
OR lighting_ambiance ILIKE 'Warm %';

-- "Dim and%" → "dim"
UPDATE restaurants SET lighting_ambiance = 'dim', updated_at = now()
WHERE lighting_ambiance ILIKE 'Dim and%'
OR lighting_ambiance ILIKE 'Dim %';

-- "candlelit" variations → "dim" (candlelit is a subset of dim)
UPDATE restaurants SET lighting_ambiance = 'dim', updated_at = now()
WHERE lighting_ambiance ILIKE '%candlelit%'
AND lighting_ambiance != 'dim';

-- "intimate" → "dim"
UPDATE restaurants SET lighting_ambiance = 'dim', updated_at = now()
WHERE lighting_ambiance = 'intimate';

-- "natural" → "bright"
UPDATE restaurants SET lighting_ambiance = 'bright', updated_at = now()
WHERE lighting_ambiance = 'natural';

-- "cozy" → "warm"
UPDATE restaurants SET lighting_ambiance = 'warm', updated_at = now()
WHERE lighting_ambiance = 'cozy';

-- "soft" → "warm"
UPDATE restaurants SET lighting_ambiance = 'warm', updated_at = now()
WHERE lighting_ambiance = 'soft';

-- "ambient" → "warm"
UPDATE restaurants SET lighting_ambiance = 'warm', updated_at = now()
WHERE lighting_ambiance = 'ambient';

-- "moody" → "dim"
UPDATE restaurants SET lighting_ambiance = 'dim', updated_at = now()
WHERE lighting_ambiance = 'moody';

-- "rustic" → "warm"
UPDATE restaurants SET lighting_ambiance = 'warm', updated_at = now()
WHERE lighting_ambiance = 'rustic';

-- "industrial" → "moderate"
UPDATE restaurants SET lighting_ambiance = 'moderate', updated_at = now()
WHERE lighting_ambiance = 'industrial';

-- "elegant" → "dim"
UPDATE restaurants SET lighting_ambiance = 'dim', updated_at = now()
WHERE lighting_ambiance = 'elegant';

-- "neon" → "dim"
UPDATE restaurants SET lighting_ambiance = 'dim', updated_at = now()
WHERE lighting_ambiance = 'neon';

-- "vintage" → "warm"
UPDATE restaurants SET lighting_ambiance = 'warm', updated_at = now()
WHERE lighting_ambiance = 'vintage';

-- "eclectic" → "warm"
UPDATE restaurants SET lighting_ambiance = 'warm', updated_at = now()
WHERE lighting_ambiance = 'eclectic';

-- Catch remaining non-standard values → "moderate" as safe default
UPDATE restaurants SET lighting_ambiance = 'moderate', updated_at = now()
WHERE lighting_ambiance NOT IN ('bright', 'warm', 'dim', 'moderate')
AND lighting_ambiance IS NOT NULL;
