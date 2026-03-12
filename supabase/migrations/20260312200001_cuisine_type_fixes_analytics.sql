-- Analytics Expert audit: Fix cuisine_type misclassifications
-- These restaurants were incorrectly labeled "Cocktail Bar" or "unknown"
-- causing scoring failures in golden dataset and V10 baseline tests.
-- Source: V10 baseline results (2026-03-05) and golden dataset analysis.

-- === Fix "Cocktail Bar" misclassifications ===
-- These restaurants serve food as their primary offering but were labeled as bars

UPDATE restaurants SET cuisine_type = 'Japanese', updated_at = now()
WHERE name = 'Momotaro' AND (cuisine_type = 'Cocktail Bar' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'Vietnamese/French', updated_at = now()
WHERE name = 'Le Colonial Chicago' AND (cuisine_type = 'Cocktail Bar' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'Lula Cafe' AND (cuisine_type = 'Cocktail Bar' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'Mexican', updated_at = now()
WHERE name = 'Manchamanteles' AND (cuisine_type = 'Cocktail Bar' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'Mexican/Cocktail Bar', updated_at = now()
WHERE name = 'Fuego Logan Square' AND (cuisine_type = 'Cocktail Bar' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'American', updated_at = now()
WHERE name = 'The Perch Kitchen and Tap' AND (cuisine_type = 'Cocktail Bar' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'Japanese/Thai', updated_at = now()
WHERE name = 'Indie Cafe Sushi Thai' AND (cuisine_type = 'Cocktail Bar' OR cuisine_type IS NULL);

-- === Fix "unknown" cuisine_type ===
-- These restaurants have well-known cuisine types identifiable from their names

UPDATE restaurants SET cuisine_type = 'Ethiopian', updated_at = now()
WHERE name = 'Awash Ethiopian Restaurant' AND (cuisine_type = 'unknown' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'Polish', updated_at = now()
WHERE name = 'Staropolska Restaurant' AND (cuisine_type = 'unknown' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'Southern/Soul Food', updated_at = now()
WHERE name = 'Soul Vibez Signature' AND (cuisine_type = 'unknown' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'Mexican', updated_at = now()
WHERE name = 'Birrieria Zaragoza' AND (cuisine_type = 'unknown' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'Chinese', updated_at = now()
WHERE name = 'Union Dumpling House' AND (cuisine_type = 'unknown' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'Nepalese/Tibetan', updated_at = now()
WHERE name = 'Himalayan Sherpa kitchen' AND (cuisine_type = 'unknown' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'Indian/Nepalese', updated_at = now()
WHERE name LIKE 'Nepal House%' AND (cuisine_type = 'unknown' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'Vietnamese', updated_at = now()
WHERE name = 'Phodega' AND (cuisine_type = 'unknown' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'Italian/Pizza', updated_at = now()
WHERE name = 'Happy Camper Pizza' AND (cuisine_type = 'unknown' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'French', updated_at = now()
WHERE name LIKE 'Chez Jo%l%' AND (cuisine_type = 'unknown' OR cuisine_type IS NULL);

UPDATE restaurants SET cuisine_type = 'Armenian/Mediterranean', updated_at = now()
WHERE name = 'Sayat Nova Armenian Restaurant' AND (cuisine_type = 'unknown' OR cuisine_type IS NULL);
