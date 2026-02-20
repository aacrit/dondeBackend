-- Enrichment V2: Deep restaurant profiles for multi-dimensional ranking
-- Creates a separate 1:1 table to keep core restaurants table clean
-- while adding 35 nuanced fields for world-class recommendation quality

CREATE TABLE IF NOT EXISTS restaurant_deep_profiles (
  restaurant_id uuid PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,

  -- Flavor & Culinary Identity
  flavor_profiles text[],                       -- ["umami-forward", "charred", "herbaceous"]
  signature_dishes jsonb,                       -- [{"dish": "The Smashburger", "why": "double-patty, caramelized onions"}]
  cuisine_subcategory text,                     -- "Neapolitan Pizza" vs just "Italian"
  menu_depth text CHECK (menu_depth IN ('focused', 'moderate', 'extensive')),
  spice_level text CHECK (spice_level IN ('mild', 'moderate', 'hot', 'volcanic')),
  dietary_depth text CHECK (dietary_depth IN ('token', 'solid', 'dedicated')),

  -- Service & Experience Dynamics
  service_style text CHECK (service_style IN (
    'Full Table Service', 'Counter', 'Omakase', 'Family Style',
    'Buffet', 'Tasting Menu', 'Fast Casual', 'Bar Service'
  )),
  meal_pacing text CHECK (meal_pacing IN ('quick_bite', 'relaxed', 'leisurely', 'ceremonial')),
  reservation_difficulty text CHECK (reservation_difficulty IN (
    'walk_in_friendly', 'recommended', 'required', 'hard_to_get'
  )),
  typical_wait_minutes integer,
  group_size_sweet_spot int4range,              -- [2,6) means 2-5 people ideal
  check_average_per_person integer,             -- granular $ amount (vs coarse $/$$/$$$)
  tipping_culture text CHECK (tipping_culture IN ('standard', 'included', 'counter_tip', 'no_tip')),
  kid_friendliness numeric(3,1),                -- 0-10 scale

  -- Atmosphere & Sensory
  music_vibe text CHECK (music_vibe IN (
    'curated-playlist', 'live-jazz', 'live-band', 'DJ', 'no-music', 'ambient', 'tv-sports'
  )),
  decor_style text,                             -- "industrial-chic", "classic-white-tablecloth", etc.
  conversation_friendliness numeric(3,1),       -- 0-10 (0=can't hear, 10=library)
  energy_level numeric(3,1),                    -- 0-10 (0=sleepy, 10=electric)
  seating_options text[],                       -- ["bar", "booth", "communal", "private_room", "patio", "chefs_counter"]
  instagram_worthiness numeric(3,1),            -- 0-10
  seasonal_relevance jsonb,                     -- {"summer": 9, "winter": 6, "spring": 7, "fall": 8}

  -- Cultural & Narrative
  cultural_authenticity numeric(3,1),           -- 0-10
  origin_story text,                            -- "Third-generation family from Oaxaca..."
  crowd_profile text[],                         -- ["young_professionals", "foodies", "date_night_couples"]
  neighborhood_integration text CHECK (neighborhood_integration IN (
    'institution', 'newcomer', 'hidden_local', 'destination', 'tourist_draw'
  )),
  chef_notable boolean DEFAULT false,
  awards_recognition text[],                    -- ["Michelin Bib Gourmand 2025", "James Beard semifinalist"]

  -- Experiential Wow Factors
  wow_factors text[],                           -- ["open_kitchen", "rooftop_skyline_view", "tableside_preparation"]
  date_progression text CHECK (date_progression IN (
    'first_date', 'casual_weeknight', 'anniversary', 'proposal_worthy'
  )),
  best_seat_in_house text,                      -- "Corner booth by the window — ask for table 7"
  ideal_weather text[],                         -- ["warm_sunny", "mild_evening", "any"]
  unique_selling_point text,                    -- "Only place in Chicago doing hand-pulled Lanzhou noodles"

  -- Practical Logistics
  transit_accessibility text CHECK (transit_accessibility IN (
    'L-accessible', 'bus-accessible', 'car-recommended', 'walkable-strip', 'rideshare-recommended'
  )),
  byob_policy text CHECK (byob_policy IN (
    'full_byob', 'byob_wine_only', 'corkage_fee', 'no_byob', 'full_bar'
  )),
  payment_notes text,                           -- "Cash only", "All cards accepted"

  -- Meta
  enriched_at timestamptz DEFAULT now(),
  enrichment_version integer DEFAULT 2,
  enrichment_confidence numeric(3,2)            -- 0.00-1.00: how confident was Claude
);

-- Index for quick lookup during ranking
CREATE INDEX IF NOT EXISTS idx_deep_profiles_restaurant_id
  ON restaurant_deep_profiles(restaurant_id);

-- Partial indexes for common ranking queries
CREATE INDEX IF NOT EXISTS idx_deep_profiles_service_style
  ON restaurant_deep_profiles(service_style) WHERE service_style IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deep_profiles_reservation
  ON restaurant_deep_profiles(reservation_difficulty) WHERE reservation_difficulty IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deep_profiles_byob
  ON restaurant_deep_profiles(byob_policy) WHERE byob_policy IS NOT NULL;

COMMENT ON TABLE restaurant_deep_profiles IS 'V2 enrichment: 35 nuanced fields per restaurant for multi-dimensional ranking. 1:1 with restaurants table.';
