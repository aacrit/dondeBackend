-- Add cuisine_type column for frontend visual theming (emoji, color hue mapping)
-- Required by API contract: restaurant.cuisine_type (string | null)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS cuisine_type text;
