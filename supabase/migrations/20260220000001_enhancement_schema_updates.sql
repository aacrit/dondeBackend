-- Consolidated schema migration for recommendation engine enhancements
-- Covers: Enhancements 1, 5, 11, 12, 13, 15, 18, 20

-- Enhancement 12: Time-of-day awareness
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS best_times text[];

-- Enhancement 13: Richer query logging
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS donde_match integer;
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS exclude_count integer DEFAULT 0;
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS was_fallback boolean DEFAULT false;
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS response_time_ms integer;
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS claude_relevance_score numeric(3,1);

-- Enhancement 15: Neighborhood character context
ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS description text;

UPDATE neighborhoods SET description = 'Vibrant Mexican-American neighborhood known for street art, authentic taquerias, and a growing foodie scene with affordable BYOB spots' WHERE name = 'Pilsen';
UPDATE neighborhoods SET description = 'Trendy nightlife hub with craft cocktail bars, indie restaurants, and a hipster-chic dining scene mixing vintage and modern' WHERE name = 'Wicker Park';
UPDATE neighborhoods SET description = 'Artsy and eclectic neighborhood with diverse global cuisine, cozy cafes, late-night eats, and a strong independent restaurant culture' WHERE name = 'Logan Square';
UPDATE neighborhoods SET description = 'Classic Chicago neighborhood with upscale dining, charming bistros, lakefront views, and family-friendly restaurants along tree-lined streets' WHERE name = 'Lincoln Park';
UPDATE neighborhoods SET description = 'Chicago''s premier dining destination packed with celebrity chef restaurants, Michelin stars, and cutting-edge culinary concepts' WHERE name = 'West Loop';
UPDATE neighborhoods SET description = 'Residential neighborhood with a mix of casual eateries, brunch spots, and neighborhood bars bridging Wicker Park and Logan Square vibes' WHERE name = 'Bucktown';
UPDATE neighborhoods SET description = 'Intellectual neighborhood near University of Chicago with diverse international cuisine, cozy cafes, and culturally rich dining options' WHERE name = 'Hyde Park';
UPDATE neighborhoods SET description = 'Authentic Chinese dining enclave with dim sum houses, bakeries, and traditional Cantonese and Szechuan restaurants' WHERE name = 'Chinatown';
UPDATE neighborhoods SET description = 'Historic Italian neighborhood with old-school red-sauce joints, Taylor Street classics, and modern Italian-American dining' WHERE name = 'Little Italy';
UPDATE neighborhoods SET description = 'Diverse and welcoming neighborhood known for Swedish heritage, international restaurants, BYOB gems, and LGBTQ-friendly dining' WHERE name = 'Andersonville';
UPDATE neighborhoods SET description = 'Upscale downtown neighborhood with steakhouses, rooftop bars, tourist-friendly dining, and high-energy nightlife restaurants' WHERE name = 'River North';
UPDATE neighborhoods SET description = 'Charming residential area with neighborhood bistros, intimate wine bars, and classic Chicago taverns near Lincoln Park' WHERE name = 'Old Town';
UPDATE neighborhoods SET description = 'Lively neighborhood with Wrigleyville sports bars, diverse ethnic restaurants, and a vibrant LGBTQ dining scene on Halsted' WHERE name = 'Lakeview';
UPDATE neighborhoods SET description = 'Industrial-turned-trendy corridor with innovative restaurants, food halls, and the spillover energy of the West Loop dining scene' WHERE name = 'Fulton Market';

-- Enhancement 18: Tag taxonomy with categories
ALTER TABLE tags ADD COLUMN IF NOT EXISTS tag_category text;

-- Enhancement 20: Closed-restaurant detection
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- Enhancement 11: Query analytics — restaurant popularity table
CREATE TABLE IF NOT EXISTS restaurant_popularity (
  restaurant_id uuid PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  recommendation_count_7d integer DEFAULT 0,
  recommendation_count_30d integer DEFAULT 0,
  query_demand_score numeric(4,2) DEFAULT 0,
  trending_score numeric(4,2) DEFAULT 0,
  computed_at timestamptz DEFAULT now()
);

-- Index for popularity lookups during ranking
CREATE INDEX IF NOT EXISTS idx_restaurant_popularity_trending ON restaurant_popularity(trending_score DESC);

-- Index for is_active filtering
CREATE INDEX IF NOT EXISTS idx_restaurants_is_active ON restaurants(is_active) WHERE is_active = true;
