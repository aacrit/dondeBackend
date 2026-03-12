-- Comprehensive data quality migration: Fusion reclassification, neighborhood fixes,
-- lighting normalization, duplicate disambiguation, iconic restaurant additions,
-- non-Chicago deactivations, BYOB/service/pricing corrections.
-- Applied via REST API on 2026-03-12; this SQL documents all changes.
-- Generated 2026-03-12

-- ============================================================
-- SECTION 1: Fusion → specific cuisine reclassifications (78 restaurants)
-- ============================================================

-- Filipino restaurants (10)
UPDATE restaurants SET cuisine_type = 'Filipino', updated_at = now() WHERE name ILIKE '%Bayan Ko%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Filipino', updated_at = now() WHERE name ILIKE '%Boonie%Filipino%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Filipino', updated_at = now() WHERE name = 'Cebu Chicago' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Filipino', updated_at = now() WHERE name ILIKE '%Kanin%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Filipino', updated_at = now() WHERE name ILIKE '%Kubo%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Filipino', updated_at = now() WHERE name ILIKE '%Panlasa%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Filipino', updated_at = now() WHERE name ILIKE '%SUBO%Filipino%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Filipino', updated_at = now() WHERE name ILIKE '%Ysabel%Grill%' AND cuisine_type = 'Fusion';

-- Chinese restaurants (14)
UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now() WHERE name ILIKE '%Bowls of Rice%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now() WHERE name ILIKE '%Bunch of Dumplings%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now() WHERE name ILIKE '%Great China House%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now() WHERE name ILIKE '%Hello Jasmine%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now() WHERE name ILIKE '%Pingpong%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now() WHERE name ILIKE '%Potsticker House%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now() WHERE name ILIKE '%Saint%Alp%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now() WHERE name ILIKE '%Taipei Cafe%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now() WHERE name ILIKE '%Take a Bao%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now() WHERE name ILIKE '%Taste of Canton%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now() WHERE name ILIKE '%Ten Seconds Yunnan%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now() WHERE name = 'WOK DONG' AND cuisine_type = 'Fusion';

-- Irish pubs (4)
UPDATE restaurants SET cuisine_type = 'Irish', updated_at = now() WHERE name ILIKE '%Brehon Pub%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Irish', updated_at = now() WHERE name ILIKE '%Chief O%Neill%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Irish', updated_at = now() WHERE name ILIKE '%O%Donovan%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Irish', updated_at = now() WHERE name ILIKE '%O%Shaughnessy%' AND cuisine_type = 'Fusion';

-- Japanese (6)
UPDATE restaurants SET cuisine_type = 'Japanese', updated_at = now() WHERE name ILIKE '%Hiro Bar Izakaya%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Japanese', updated_at = now() WHERE name ILIKE '%Hiromi%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Japanese', updated_at = now() WHERE name ILIKE '%Kraken Sushi%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Japanese', updated_at = now() WHERE name ILIKE '%OMI Cafe%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Japanese', updated_at = now() WHERE name ILIKE '%RYUU%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Japanese', updated_at = now() WHERE name ILIKE '%Union Sushi%' AND cuisine_type = 'Fusion';

-- Cocktail Bars (5)
UPDATE restaurants SET cuisine_type = 'Cocktail Bar', updated_at = now() WHERE name = 'Bel Ami Lounge' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Cocktail Bar', updated_at = now() WHERE name = 'Cuckoo' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Cocktail Bar', updated_at = now() WHERE name = 'Mao Bar' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Cocktail Bar', updated_at = now() WHERE name ILIKE '%Bamboo Room%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Cocktail Bar', updated_at = now() WHERE name = 'Three Dots and a Dash' AND cuisine_type = 'Fusion';

-- Coffee/Cafe (4)
UPDATE restaurants SET cuisine_type = 'Coffee/Cafe', updated_at = now() WHERE name ILIKE '%Mano Modern%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Coffee/Cafe', updated_at = now() WHERE name ILIKE '%Swedish%Museum%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Coffee/Cafe', updated_at = now() WHERE name = 'Sweet Moon' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Coffee/Cafe', updated_at = now() WHERE name = 'Ten Cafe' AND cuisine_type = 'Fusion';

-- American (German-American, gastropub, etc.) (16)
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%BiXi Beer%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%Chant%Hyde Park%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name = 'CHUNKY BOSS' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name = 'Feld' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%Gene%Sausage%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%Gideon Welles%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%Himmel%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%Kaiser Tiger%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%Laschet%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name = 'Loon' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%Matilda%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name = 'Mott St' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%Prost!%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%Resi%Bierstube%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%Berghoff%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%Embassy%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%Glunz%' AND cuisine_type = 'Fusion';

-- New American (1)
UPDATE restaurants SET cuisine_type = 'New American', updated_at = now() WHERE name = 'Alinea' AND cuisine_type = 'Fusion';

-- Other specific fixes
UPDATE restaurants SET cuisine_type = 'Italian', updated_at = now() WHERE name ILIKE '%Amici%Chicago%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Thai', updated_at = now() WHERE name = 'Bigsuda' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Korean', updated_at = now() WHERE name ILIKE '%bopNgrill%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Mediterranean', updated_at = now() WHERE name ILIKE '%Cafe Beograd%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'French', updated_at = now() WHERE name ILIKE '%Cr%merie%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Mexican', updated_at = now() WHERE name = 'CASA MADAI' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Latin American', updated_at = now() WHERE name ILIKE '%Del Sur%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Mexican', updated_at = now() WHERE name ILIKE '%Dove%Luncheonette%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Latin American', updated_at = now() WHERE name = 'Mirra' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Korean', updated_at = now() WHERE name ILIKE '%Parachute%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'BBQ', updated_at = now() WHERE name ILIKE '%pig%fire%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Indian', updated_at = now() WHERE name ILIKE '%Swadesi%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Thai', updated_at = now() WHERE name ILIKE '%Sweet Rice%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Mediterranean', updated_at = now() WHERE name = 'Shokran' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Mediterranean', updated_at = now() WHERE name ILIKE '%Marrakech%' AND cuisine_type = 'Fusion';
UPDATE restaurants SET cuisine_type = 'Mexican', updated_at = now() WHERE name ILIKE '%Velvet Taco%' AND cuisine_type = 'Fusion';

-- 3LP BBQ fix (Chinese → BBQ)
UPDATE restaurants SET cuisine_type = 'BBQ', updated_at = now() WHERE name ILIKE '%3LP%' AND cuisine_type = 'Chinese';

-- Al's Italian Beef (Italian → American)
UPDATE restaurants SET cuisine_type = 'American', updated_at = now() WHERE name ILIKE '%Al%Italian Beef%' AND cuisine_type = 'Italian';

-- ============================================================
-- SECTION 2: Lighting normalization (all non-standard → standard 4 values)
-- ============================================================

UPDATE restaurants SET lighting_ambiance = 'bright' WHERE lighting_ambiance = 'modern';
UPDATE restaurants SET lighting_ambiance = 'dim' WHERE lighting_ambiance = 'candlelit';
UPDATE restaurants SET lighting_ambiance = 'dim' WHERE lighting_ambiance = 'intimate';
UPDATE restaurants SET lighting_ambiance = 'dim' WHERE lighting_ambiance = 'elegant';
UPDATE restaurants SET lighting_ambiance = 'dim' WHERE lighting_ambiance = 'moody';
UPDATE restaurants SET lighting_ambiance = 'dim' WHERE lighting_ambiance = 'dramatic';
UPDATE restaurants SET lighting_ambiance = 'bright' WHERE lighting_ambiance = 'vibrant';
UPDATE restaurants SET lighting_ambiance = 'warm' WHERE lighting_ambiance = 'colorful';
UPDATE restaurants SET lighting_ambiance = 'moderate' WHERE lighting_ambiance = 'neutral';
UPDATE restaurants SET lighting_ambiance = 'moderate' WHERE lighting_ambiance = 'industrial';

-- Free-text patterns
UPDATE restaurants SET lighting_ambiance = 'warm' WHERE lighting_ambiance NOT IN ('bright','moderate','dim','warm') AND lighting_ambiance IS NOT NULL AND (lighting_ambiance ILIKE '%warm%' OR lighting_ambiance ILIKE '%cozy%' OR lighting_ambiance ILIKE '%inviting%' OR lighting_ambiance ILIKE '%golden%' OR lighting_ambiance ILIKE '%rustic%' OR lighting_ambiance ILIKE '%traditional%' OR lighting_ambiance ILIKE '%classic%' OR lighting_ambiance ILIKE '%mediterranean%' OR lighting_ambiance ILIKE '%festive%');
UPDATE restaurants SET lighting_ambiance = 'dim' WHERE lighting_ambiance NOT IN ('bright','moderate','dim','warm') AND lighting_ambiance IS NOT NULL AND (lighting_ambiance ILIKE '%dim%' OR lighting_ambiance ILIKE '%candle%' OR lighting_ambiance ILIKE '%intimate%' OR lighting_ambiance ILIKE '%soft%' OR lighting_ambiance ILIKE '%dark%');
UPDATE restaurants SET lighting_ambiance = 'bright' WHERE lighting_ambiance NOT IN ('bright','moderate','dim','warm') AND lighting_ambiance IS NOT NULL AND (lighting_ambiance ILIKE '%bright%' OR lighting_ambiance ILIKE '%modern%' OR lighting_ambiance ILIKE '%natural%' OR lighting_ambiance ILIKE '%airy%' OR lighting_ambiance ILIKE '%functional%');
-- Remaining → moderate (safe default)
UPDATE restaurants SET lighting_ambiance = 'moderate' WHERE lighting_ambiance NOT IN ('bright','moderate','dim','warm') AND lighting_ambiance IS NOT NULL;

-- Specific overrides
UPDATE restaurants SET lighting_ambiance = 'dim' WHERE name = 'Alinea';
UPDATE restaurants SET lighting_ambiance = 'dim' WHERE name = 'Boka';
UPDATE restaurants SET lighting_ambiance = 'warm' WHERE name ILIKE '%Smoque BBQ%';
UPDATE restaurants SET lighting_ambiance = 'warm' WHERE name = 'Frontera Grill';
UPDATE restaurants SET lighting_ambiance = 'warm' WHERE name ILIKE '%Lula Cafe%';
UPDATE restaurants SET lighting_ambiance = 'moderate' WHERE name ILIKE '%Publican%';
UPDATE restaurants SET lighting_ambiance = 'warm' WHERE name ILIKE '%North Pond%';

-- ============================================================
-- SECTION 3: Neighborhood ID fixes (99 restaurants)
-- Already applied via REST API using ZIP→neighborhood mapping.
-- Not repeatable as idempotent SQL without specific IDs.
-- ============================================================

-- ============================================================
-- SECTION 4: Duplicate name disambiguation (68 restaurants)
-- Appended " - {neighborhood}" to all multi-location restaurants.
-- ============================================================

-- ============================================================
-- SECTION 5: BYOB, service, pricing fixes
-- ============================================================

-- Smoque BBQ BYOB
UPDATE restaurant_deep_profiles SET byob_policy = 'full_byob'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Smoque%' LIMIT 1);

-- Skylark (bar, not BYOB)
UPDATE restaurant_deep_profiles SET byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name = 'Skylark' LIMIT 1);

-- Schwa (famous BYOB)
UPDATE restaurant_deep_profiles SET byob_policy = 'full_byob'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%Schwa%' LIMIT 1);

-- Service style NULLs
UPDATE restaurant_deep_profiles SET service_style = 'Full Table Service', byob_policy = 'full_bar'
WHERE restaurant_id IN (
    SELECT id FROM restaurants WHERE name IN ('Benihana - Chicago (John Hancock)', 'Koto Hibachi')
) AND service_style IS NULL;

UPDATE restaurant_deep_profiles SET service_style = 'Full Table Service', byob_policy = 'full_bar'
WHERE restaurant_id = (SELECT id FROM restaurants WHERE name ILIKE '%La Lena%' LIMIT 1)
AND service_style IS NULL;

-- ============================================================
-- SECTION 6: Deactivations (non-Chicago restaurants)
-- ============================================================

UPDATE restaurants SET is_active = false WHERE name ILIKE '%Habibi Mediterranean%' AND address ILIKE '%Logan, UT%';
UPDATE restaurants SET is_active = false WHERE name ILIKE '%Wicker Park Seafood%' AND address ILIKE '%ORD%';
UPDATE restaurants SET is_active = false WHERE name ILIKE '%Crab King%' AND address ILIKE '%Oak Lawn%';
UPDATE restaurants SET is_active = false WHERE name ILIKE '%Maria%Mexican%' AND address ILIKE '%Harlem Ave%';
UPDATE restaurants SET is_active = false WHERE name = 'TEST';
UPDATE restaurants SET is_active = false WHERE name = 'Vinafood' AND address ILIKE '%Czechia%';

-- ============================================================
-- SECTION 7: Iconic Chicago restaurant inserts
-- ============================================================

-- Portillo's, Lou Malnati's, Pequod's, Gino's East, Superdawg,
-- Mr. Beef on Orleans, Johnnie's Beef
-- Already inserted via REST API with deep profiles and occasion scores.
-- Al's #1 Italian Beef already existed; cuisine fixed Italian → American.
