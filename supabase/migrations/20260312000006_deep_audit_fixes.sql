-- Deep audit fixes: deactivate garbage data, fix cuisine misclassifications, fix non-Chicago entry
-- Discovered during comprehensive database quality audit on 2026-03-12

-- ============================================================
-- 1. CRITICAL: Deactivate TEST restaurant (garbage data)
-- ============================================================
UPDATE restaurants SET is_active = false, updated_at = now()
WHERE name = 'TEST';

-- ============================================================
-- 2. CRITICAL: Deactivate non-Chicago restaurant (Vinafood in Plzen, Czechia)
-- ============================================================
UPDATE restaurants SET is_active = false, updated_at = now()
WHERE name = 'Vinafood' AND address ILIKE '%Czechia%';

-- ============================================================
-- 3. Fix Maple & Ash: American → Steak (premier Chicago steakhouse)
-- ============================================================
UPDATE restaurants SET cuisine_type = 'Steak', updated_at = now()
WHERE name = 'Maple & Ash' AND cuisine_type = 'American';

-- ============================================================
-- 4. Fix Han 202: "Asian" (too vague) → Chinese (in Bridgeport/Chinatown)
-- ============================================================
UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now()
WHERE name = 'Han 202 Restaurant' AND cuisine_type = 'Asian';

-- ============================================================
-- 5. Fix Lady Gregory's: American → Irish (it's an Irish pub)
-- ============================================================
UPDATE restaurants SET cuisine_type = 'Irish', updated_at = now()
WHERE name ILIKE '%Lady Gregory%' AND cuisine_type = 'American';

-- ============================================================
-- 6. Fix Cocktail Bar misclassifications (food-forward restaurants)
-- ============================================================

-- Taxim is a famous Greek restaurant, not a cocktail bar
UPDATE restaurants SET cuisine_type = 'Greek', updated_at = now()
WHERE name = 'Taxim' AND cuisine_type = 'Cocktail Bar';

-- Le Piano serves Crêpes Suzette — it's a French bistro
UPDATE restaurants SET cuisine_type = 'French', updated_at = now()
WHERE name = 'Le Piano' AND cuisine_type = 'Cocktail Bar';

-- Inkwell serves pasta — it's a restaurant
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'Inkwell' AND cuisine_type = 'Cocktail Bar';

-- Sparrow serves Pan-Seared Salmon, "fireplace-lit dinner" — restaurant
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'Sparrow' AND cuisine_type = 'Cocktail Bar';

-- Bokeh is described as "date-night restaurant" with "culinary craft"
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'Bokeh' AND cuisine_type = 'Cocktail Bar';

-- Clara has "tasting-menu ambition" — food-forward restaurant
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'Clara' AND cuisine_type = 'Cocktail Bar';

-- Love Street serves house-made pasta — Italian bistro
UPDATE restaurants SET cuisine_type = 'Italian', updated_at = now()
WHERE name = 'Love Street' AND cuisine_type = 'Cocktail Bar';

-- Bernard's: chocolate soufflé, "dinner is the entire evening" — French/American
UPDATE restaurants SET cuisine_type = 'French', updated_at = now()
WHERE name ILIKE 'Bernard%s' AND cuisine_type = 'Cocktail Bar';

-- The Nook Andersonville: Eggs Benedict, morning cafe — Brunch
UPDATE restaurants SET cuisine_type = 'Brunch', updated_at = now()
WHERE name = 'The Nook Andersonville' AND cuisine_type = 'Cocktail Bar';

-- The Meadowlark: "market-driven food", grain bowls — American
UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'The Meadowlark' AND cuisine_type = 'Cocktail Bar';

-- Lemon: "lemon ricotta pancakes", brunch-forward
UPDATE restaurants SET cuisine_type = 'Brunch', updated_at = now()
WHERE name = 'Lemon' AND cuisine_type = 'Cocktail Bar';

-- The Barrel: "barrel-smoked meats" + "street-style tacos" — BBQ/Mexican
UPDATE restaurants SET cuisine_type = 'Mexican', updated_at = now()
WHERE name = 'The Barrel' AND cuisine_type = 'Cocktail Bar';

-- Apero: "food-literate diner", "weeknight dinner" — Mediterranean
UPDATE restaurants SET cuisine_type = 'Mediterranean', updated_at = now()
WHERE name = 'Apero' AND cuisine_type = 'Cocktail Bar';
