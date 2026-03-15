-- Learning Flywheel Phase 1: User Taste Profiles
-- Shadow mode — profiles are computed and logged but do not affect scoring

-- ============================================================
-- TABLE: user_taste_profiles
-- Pre-computed taste profile per user, refreshed every 24h
-- ============================================================
CREATE TABLE IF NOT EXISTS user_taste_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Signal counts
  total_signals INTEGER NOT NULL DEFAULT 0,
  search_count INTEGER NOT NULL DEFAULT 0,
  feedback_count INTEGER NOT NULL DEFAULT 0,
  favorite_count INTEGER NOT NULL DEFAULT 0,
  visit_count INTEGER NOT NULL DEFAULT 0,

  -- Cuisine preferences
  cuisine_affinities JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{cuisine: "Italian", score: 0.8}, ...]
  cuisine_avoidances TEXT[] NOT NULL DEFAULT '{}',

  -- Vibe preferences (-1 to +1)
  noise_preference NUMERIC(3,2) NOT NULL DEFAULT 0,
  energy_preference NUMERIC(3,2) NOT NULL DEFAULT 0,
  formality_preference NUMERIC(3,2) NOT NULL DEFAULT 0,

  -- Factor weight multipliers (0.7 to 1.3, default 1.0)
  weight_food NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  weight_vibe NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  weight_service NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  weight_reputation NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  weight_convenience NUMERIC(3,2) NOT NULL DEFAULT 1.0,

  -- Other preferences
  price_affinity NUMERIC(2,1),  -- 1.0 to 4.0 scale
  neighborhood_affinities JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{neighborhood: "Lincoln Park", score: 0.7}, ...]
  discovery_score NUMERIC(3,2) NOT NULL DEFAULT 0.5,  -- 0-1, higher = more adventurous

  -- Timestamps
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',

  -- Constraints
  CONSTRAINT chk_noise_pref CHECK (noise_preference BETWEEN -1 AND 1),
  CONSTRAINT chk_energy_pref CHECK (energy_preference BETWEEN -1 AND 1),
  CONSTRAINT chk_formality_pref CHECK (formality_preference BETWEEN -1 AND 1),
  CONSTRAINT chk_weight_food CHECK (weight_food BETWEEN 0.7 AND 1.3),
  CONSTRAINT chk_weight_vibe CHECK (weight_vibe BETWEEN 0.7 AND 1.3),
  CONSTRAINT chk_weight_service CHECK (weight_service BETWEEN 0.7 AND 1.3),
  CONSTRAINT chk_weight_reputation CHECK (weight_reputation BETWEEN 0.7 AND 1.3),
  CONSTRAINT chk_weight_convenience CHECK (weight_convenience BETWEEN 0.7 AND 1.3),
  CONSTRAINT chk_discovery CHECK (discovery_score BETWEEN 0 AND 1)
);

-- RLS: users can read their own profile; service role manages all
ALTER TABLE user_taste_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own taste profile"
  ON user_taste_profiles FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- FUNCTION: compute_taste_profile(p_user_id)
-- Gathers signals from last 90 days, computes affinities
-- ============================================================
CREATE OR REPLACE FUNCTION compute_taste_profile(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := now() - interval '90 days';
  v_search_count INTEGER := 0;
  v_feedback_count INTEGER := 0;
  v_favorite_count INTEGER := 0;
  v_visit_count INTEGER := 0;
  v_total INTEGER := 0;
  v_cuisine_aff JSONB := '[]'::jsonb;
  v_cuisine_avoid TEXT[] := '{}';
  v_noise NUMERIC := 0;
  v_energy NUMERIC := 0;
  v_formality NUMERIC := 0;
  v_price NUMERIC := NULL;
  v_neighborhood_aff JSONB := '[]'::jsonb;
  v_discovery NUMERIC := 0.5;
  v_w_food NUMERIC := 1.0;
  v_w_vibe NUMERIC := 1.0;
  v_w_service NUMERIC := 1.0;
  v_w_reputation NUMERIC := 1.0;
  v_w_convenience NUMERIC := 1.0;
BEGIN
  -- Count signals
  SELECT count(*) INTO v_search_count
  FROM user_searches WHERE user_id = p_user_id AND created_at >= v_cutoff;

  SELECT count(*) INTO v_feedback_count
  FROM user_queries WHERE auth_user_id = p_user_id::text
    AND claude_relevance_score IS NOT NULL AND created_at >= v_cutoff;

  SELECT count(*) INTO v_favorite_count
  FROM user_favorites WHERE user_id = p_user_id AND created_at >= v_cutoff;

  SELECT count(*) INTO v_visit_count
  FROM user_visits WHERE user_id = p_user_id AND created_at >= v_cutoff;

  v_total := v_search_count + v_feedback_count + v_favorite_count + v_visit_count;

  -- Cuisine affinities: weighted by signal type
  -- Searches: 1.0, likes: 2.0, favorites: 2.5, visits: 3.0, dislikes: -1.5
  WITH cuisine_signals AS (
    SELECT r.cuisine_type AS cuisine, 1.0 AS weight
    FROM user_searches us
    JOIN restaurants r ON r.id = us.restaurant_id
    WHERE us.user_id = p_user_id AND us.created_at >= v_cutoff
      AND r.cuisine_type IS NOT NULL
    UNION ALL
    SELECT r.cuisine_type AS cuisine,
      CASE WHEN uq.claude_relevance_score = 1 THEN 2.0 ELSE -1.5 END AS weight
    FROM user_queries uq
    JOIN restaurants r ON r.id = uq.recommended_restaurant_id
    WHERE uq.auth_user_id = p_user_id::text AND uq.created_at >= v_cutoff
      AND uq.claude_relevance_score IS NOT NULL
      AND r.cuisine_type IS NOT NULL
    UNION ALL
    SELECT r.cuisine_type AS cuisine, 2.5 AS weight
    FROM user_favorites uf
    JOIN restaurants r ON r.id = uf.restaurant_id
    WHERE uf.user_id = p_user_id AND uf.created_at >= v_cutoff
      AND r.cuisine_type IS NOT NULL
    UNION ALL
    SELECT r.cuisine_type AS cuisine, 3.0 AS weight
    FROM user_visits uv
    JOIN restaurants r ON r.id = uv.restaurant_id
    WHERE uv.user_id = p_user_id AND uv.created_at >= v_cutoff
      AND r.cuisine_type IS NOT NULL
  ),
  cuisine_scores AS (
    SELECT cuisine,
      sum(weight) AS raw_score,
      count(*) AS cnt
    FROM cuisine_signals
    WHERE cuisine IS NOT NULL
    GROUP BY cuisine
    ORDER BY sum(weight) DESC
    LIMIT 10
  ),
  max_score AS (
    SELECT GREATEST(max(raw_score), 1) AS ms FROM cuisine_scores
  )
  SELECT jsonb_agg(
    jsonb_build_object('cuisine', cs.cuisine, 'score', round((cs.raw_score / m.ms)::numeric, 2))
    ORDER BY cs.raw_score DESC
  )
  INTO v_cuisine_aff
  FROM cuisine_scores cs, max_score m
  WHERE cs.raw_score > 0
  LIMIT 5;

  -- Cuisine avoidances: cuisines with net negative weight
  WITH disliked AS (
    SELECT r.cuisine_type AS cuisine, sum(-1.5) AS neg_weight
    FROM user_queries uq
    JOIN restaurants r ON r.id = uq.recommended_restaurant_id
    WHERE uq.auth_user_id = p_user_id::text AND uq.created_at >= v_cutoff
      AND uq.claude_relevance_score = 0
      AND r.cuisine_type IS NOT NULL
    GROUP BY r.cuisine_type
    HAVING sum(-1.5) < -2
  )
  SELECT array_agg(cuisine) INTO v_cuisine_avoid FROM disliked;

  -- Neighborhood affinities
  WITH neighborhood_signals AS (
    SELECT n.name AS neighborhood, count(*) AS cnt
    FROM user_searches us
    JOIN restaurants r ON r.id = us.restaurant_id
    JOIN neighborhoods n ON n.id = r.neighborhood_id
    WHERE us.user_id = p_user_id AND us.created_at >= v_cutoff
    GROUP BY n.name
    ORDER BY count(*) DESC
    LIMIT 5
  ),
  max_cnt AS (
    SELECT GREATEST(max(cnt), 1) AS mc FROM neighborhood_signals
  )
  SELECT jsonb_agg(
    jsonb_build_object('neighborhood', ns.neighborhood, 'score', round((ns.cnt::numeric / m.mc), 2))
    ORDER BY ns.cnt DESC
  )
  INTO v_neighborhood_aff
  FROM neighborhood_signals ns, max_cnt m;

  -- Price affinity: weighted average of visited/liked restaurant price levels
  WITH price_signals AS (
    SELECT r.price_level AS pl, 1.0 AS weight
    FROM user_searches us
    JOIN restaurants r ON r.id = us.restaurant_id
    WHERE us.user_id = p_user_id AND us.created_at >= v_cutoff
      AND r.price_level IS NOT NULL
    UNION ALL
    SELECT r.price_level AS pl, 2.0 AS weight
    FROM user_queries uq
    JOIN restaurants r ON r.id = uq.recommended_restaurant_id
    WHERE uq.auth_user_id = p_user_id::text AND uq.created_at >= v_cutoff
      AND uq.claude_relevance_score = 1
      AND r.price_level IS NOT NULL
  )
  SELECT round(sum(
    CASE pl
      WHEN '$' THEN 1 * weight
      WHEN '$$' THEN 2 * weight
      WHEN '$$$' THEN 3 * weight
      WHEN '$$$$' THEN 4 * weight
      ELSE NULL
    END
  ) / NULLIF(sum(weight), 0), 1)
  INTO v_price
  FROM price_signals;

  -- Vibe preferences: compare liked restaurant attributes
  WITH liked_vibes AS (
    SELECT
      dp.noise_level,
      dp.energy_level,
      dp.dress_code
    FROM user_queries uq
    JOIN restaurants r ON r.id = uq.recommended_restaurant_id
    JOIN restaurant_deep_profiles dp ON dp.restaurant_id = r.id
    WHERE uq.auth_user_id = p_user_id::text AND uq.created_at >= v_cutoff
      AND uq.claude_relevance_score = 1
  )
  SELECT
    -- noise: quiet(-1) to loud(+1)
    COALESCE(round(avg(CASE noise_level
      WHEN 'quiet' THEN -0.8
      WHEN 'moderate' THEN 0
      WHEN 'lively' THEN 0.5
      WHEN 'loud' THEN 0.8
      ELSE 0 END)::numeric, 2), 0),
    -- energy: calm(-1) to high(+1)
    COALESCE(round(avg(CASE energy_level
      WHEN 'relaxed' THEN -0.6
      WHEN 'moderate' THEN 0
      WHEN 'upbeat' THEN 0.5
      WHEN 'high energy' THEN 0.8
      ELSE 0 END)::numeric, 2), 0),
    -- formality: casual(-1) to formal(+1)
    COALESCE(round(avg(CASE dress_code
      WHEN 'very casual' THEN -0.8
      WHEN 'casual' THEN -0.4
      WHEN 'smart casual' THEN 0.3
      WHEN 'business casual' THEN 0.5
      WHEN 'formal' THEN 0.8
      ELSE 0 END)::numeric, 2), 0)
  INTO v_noise, v_energy, v_formality
  FROM liked_vibes;

  -- Discovery score: cuisine diversity ratio
  WITH distinct_cuisines AS (
    SELECT count(DISTINCT r.cuisine_type) AS unique_cuisines, count(*) AS total
    FROM user_searches us
    JOIN restaurants r ON r.id = us.restaurant_id
    WHERE us.user_id = p_user_id AND us.created_at >= v_cutoff
      AND r.cuisine_type IS NOT NULL
  )
  SELECT COALESCE(
    round(LEAST(unique_cuisines::numeric / GREATEST(total, 1), 1.0), 2),
    0.5
  )
  INTO v_discovery
  FROM distinct_cuisines;

  -- Factor weights: compare avg factor scores of liked vs all
  -- (placeholder — Phase 3 will compute proper deviations)

  -- UPSERT
  INSERT INTO user_taste_profiles (
    user_id, total_signals, search_count, feedback_count, favorite_count, visit_count,
    cuisine_affinities, cuisine_avoidances,
    noise_preference, energy_preference, formality_preference,
    weight_food, weight_vibe, weight_service, weight_reputation, weight_convenience,
    price_affinity, neighborhood_affinities, discovery_score,
    computed_at, expires_at
  ) VALUES (
    p_user_id, v_total, v_search_count, v_feedback_count, v_favorite_count, v_visit_count,
    COALESCE(v_cuisine_aff, '[]'::jsonb), COALESCE(v_cuisine_avoid, '{}'),
    v_noise, v_energy, v_formality,
    v_w_food, v_w_vibe, v_w_service, v_w_reputation, v_w_convenience,
    v_price, COALESCE(v_neighborhood_aff, '[]'::jsonb), v_discovery,
    now(), now() + interval '24 hours'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_signals = EXCLUDED.total_signals,
    search_count = EXCLUDED.search_count,
    feedback_count = EXCLUDED.feedback_count,
    favorite_count = EXCLUDED.favorite_count,
    visit_count = EXCLUDED.visit_count,
    cuisine_affinities = EXCLUDED.cuisine_affinities,
    cuisine_avoidances = EXCLUDED.cuisine_avoidances,
    noise_preference = EXCLUDED.noise_preference,
    energy_preference = EXCLUDED.energy_preference,
    formality_preference = EXCLUDED.formality_preference,
    weight_food = EXCLUDED.weight_food,
    weight_vibe = EXCLUDED.weight_vibe,
    weight_service = EXCLUDED.weight_service,
    weight_reputation = EXCLUDED.weight_reputation,
    weight_convenience = EXCLUDED.weight_convenience,
    price_affinity = EXCLUDED.price_affinity,
    neighborhood_affinities = EXCLUDED.neighborhood_affinities,
    discovery_score = EXCLUDED.discovery_score,
    computed_at = now(),
    expires_at = now() + interval '24 hours';
END;
$$;
