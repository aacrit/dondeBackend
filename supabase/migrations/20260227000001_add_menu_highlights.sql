-- V6: Add menu_highlights column for broader dish coverage
-- This field stores commonly mentioned menu items from reviews,
-- providing broader coverage than signature_dishes (which only has 3-5 items).
-- Used by the V6 dish-level matching system to differentiate restaurants
-- when users search for specific dishes (e.g., "tandoori chicken").

ALTER TABLE restaurant_deep_profiles
ADD COLUMN IF NOT EXISTS menu_highlights text[] DEFAULT '{}';

COMMENT ON COLUMN restaurant_deep_profiles.menu_highlights IS
  'V6: commonly mentioned menu items from reviews, broader coverage than signature_dishes';
