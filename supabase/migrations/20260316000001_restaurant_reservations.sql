-- Project Foxtrot M1: Restaurant reservation platform mapping
-- Stores deep links and platform IDs for Resy, OpenTable, Tock, Yelp, etc.
-- Used by reservation-links.ts to add booking URLs to API responses.

CREATE TABLE restaurant_reservations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE NOT NULL,
  platform TEXT NOT NULL,              -- 'opentable', 'resy', 'tock', 'yelp', 'direct', 'phone'
  platform_id TEXT,                    -- Platform-specific restaurant ID (e.g., OpenTable restref)
  platform_slug TEXT,                  -- URL slug on platform
  booking_url TEXT NOT NULL,           -- Full deep link URL (ready to use)
  url_template TEXT,                   -- URL with {date}, {covers}, {time} placeholders
  is_verified BOOLEAN DEFAULT false,   -- HTTP HEAD validated
  last_verified_at TIMESTAMPTZ,
  priority INTEGER DEFAULT 50,         -- Display priority (lower = preferred)
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(restaurant_id, platform)
);

-- Fast lookup by restaurant_id (only active entries)
CREATE INDEX idx_reservations_restaurant ON restaurant_reservations(restaurant_id) WHERE is_active = true;

-- Platform coverage queries
CREATE INDEX idx_reservations_platform ON restaurant_reservations(platform) WHERE is_active = true;

-- RLS: public read, service role write
ALTER TABLE restaurant_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON restaurant_reservations
  FOR SELECT USING (true);

CREATE POLICY "Service role full access" ON restaurant_reservations
  FOR ALL USING (auth.role() = 'service_role');

-- Priority reference:
-- direct (10) — restaurant's own booking system
-- resy (20) — upscale/chef-driven
-- tock (25) — fine dining/ticketed
-- opentable (30) — broadest coverage
-- yelp (40) — backup/overlap
-- phone (50) — fallback

COMMENT ON TABLE restaurant_reservations IS 'Project Foxtrot: reservation platform links for DondeAI restaurants';
