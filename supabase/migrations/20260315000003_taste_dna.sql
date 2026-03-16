-- ============================================================================
-- Taste DNA: Profile visualization + Group Blend RPCs
-- Depends on: 20260315000001_user_taste_profiles.sql (table + compute_taste_profile)
-- ============================================================================

-- ============================================================
-- RPC: get_taste_dna(p_user_id UUID)
-- Returns a formatted "Taste DNA" profile for the user.
-- Auto-computes if profile is missing or expired (24h TTL).
-- ============================================================
CREATE OR REPLACE FUNCTION get_taste_dna(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_profile user_taste_profiles%ROWTYPE;
  v_archetype TEXT;
  v_top_cuisines JSONB;
  v_top_cuisine_score NUMERIC;
  v_top_cuisine_pct NUMERIC;
  v_cuisine_count INTEGER;
  v_top_neighborhood TEXT;
  v_top_neighborhood_pct NUMERIC;
  v_price_label TEXT;
  v_result JSONB;
BEGIN
  -- Fetch existing profile
  SELECT * INTO v_profile
  FROM user_taste_profiles
  WHERE user_id = p_user_id;

  -- If missing or expired, recompute
  IF v_profile IS NULL OR v_profile.expires_at < now() THEN
    PERFORM compute_taste_profile(p_user_id);
    SELECT * INTO v_profile
    FROM user_taste_profiles
    WHERE user_id = p_user_id;
  END IF;

  -- If still null (no data at all), return minimal profile
  IF v_profile IS NULL THEN
    RETURN jsonb_build_object(
      'archetype', 'The Newcomer',
      'archetype_description', 'Your taste journey is just beginning',
      'top_cuisines', '[]'::jsonb,
      'vibe_profile', jsonb_build_object('noise', 0, 'energy', 0, 'formality', 0),
      'price_sweet_spot', 'Any',
      'neighborhood_home', NULL,
      'discovery_score', 0,
      'total_signals', 0,
      'cuisine_breadth', 0,
      'has_data', false
    );
  END IF;

  -- Extract top cuisines (already sorted by score in compute_taste_profile)
  v_top_cuisines := COALESCE(v_profile.cuisine_affinities, '[]'::jsonb);
  v_cuisine_count := jsonb_array_length(v_top_cuisines);

  -- Get top cuisine percentage of total signals
  IF v_cuisine_count > 0 AND v_profile.total_signals > 0 THEN
    v_top_cuisine_score := COALESCE((v_top_cuisines->0->>'score')::numeric, 0);
    -- Approximate: if top cuisine score is >0.5 of normalized 1.0, it dominates
    v_top_cuisine_pct := v_top_cuisine_score;
  ELSE
    v_top_cuisine_pct := 0;
  END IF;

  -- Get top neighborhood
  IF jsonb_array_length(COALESCE(v_profile.neighborhood_affinities, '[]'::jsonb)) > 0 THEN
    v_top_neighborhood := v_profile.neighborhood_affinities->0->>'neighborhood';
    v_top_neighborhood_pct := COALESCE((v_profile.neighborhood_affinities->0->>'score')::numeric, 0);
  ELSE
    v_top_neighborhood := NULL;
    v_top_neighborhood_pct := 0;
  END IF;

  -- Price label
  v_price_label := CASE
    WHEN v_profile.price_affinity IS NULL THEN 'Any'
    WHEN v_profile.price_affinity <= 1.5 THEN '$'
    WHEN v_profile.price_affinity <= 2.5 THEN '$$'
    WHEN v_profile.price_affinity <= 3.5 THEN '$$$'
    ELSE '$$$$'
  END;

  -- Determine archetype (priority order — first match wins)
  v_archetype := CASE
    -- The Explorer: tries many cuisines, high discovery
    WHEN v_profile.discovery_score > 0.7 AND v_cuisine_count >= 5
      THEN 'The Explorer'
    -- The Loyalist: one cuisine dominates (>50% of signals)
    WHEN v_top_cuisine_pct > 0.50 AND v_cuisine_count <= 3
      THEN 'The Loyalist'
    -- The Adventurer: decent discovery, no single cuisine dominates
    WHEN v_profile.discovery_score > 0.5 AND v_top_cuisine_pct < 0.30
      THEN 'The Adventurer'
    -- The Connoisseur: upscale tastes, formal preference
    WHEN COALESCE(v_profile.price_affinity, 0) > 3
      AND v_profile.formality_preference > 0.3
      THEN 'The Connoisseur'
    -- The Local: one neighborhood dominates visits
    WHEN v_top_neighborhood_pct > 0.40
      THEN 'The Local'
    -- Default
    ELSE 'The Foodie'
  END;

  -- Build result
  v_result := jsonb_build_object(
    'archetype', v_archetype,
    'archetype_description', CASE v_archetype
      WHEN 'The Explorer' THEN 'Always chasing the next flavor frontier'
      WHEN 'The Loyalist' THEN 'You know what you love and own it'
      WHEN 'The Adventurer' THEN 'No cuisine is off-limits for you'
      WHEN 'The Connoisseur' THEN 'You savor the finer things'
      WHEN 'The Local' THEN 'Your neighborhood is your dining room'
      WHEN 'The Foodie' THEN 'A well-rounded palate with great taste'
      ELSE 'Your taste journey is just beginning'
    END,
    'top_cuisines', v_top_cuisines,
    'vibe_profile', jsonb_build_object(
      'noise', v_profile.noise_preference,
      'energy', v_profile.energy_preference,
      'formality', v_profile.formality_preference
    ),
    'price_sweet_spot', v_price_label,
    'neighborhood_home', v_top_neighborhood,
    'neighborhood_affinities', COALESCE(v_profile.neighborhood_affinities, '[]'::jsonb),
    'discovery_score', v_profile.discovery_score,
    'total_signals', v_profile.total_signals,
    'cuisine_breadth', v_cuisine_count,
    'cuisine_avoidances', to_jsonb(COALESCE(v_profile.cuisine_avoidances, '{}'::text[])),
    'has_data', v_profile.total_signals > 0,
    'computed_at', v_profile.computed_at,
    'signal_breakdown', jsonb_build_object(
      'searches', v_profile.search_count,
      'feedback', v_profile.feedback_count,
      'favorites', v_profile.favorite_count,
      'visits', v_profile.visit_count
    )
  );

  RETURN v_result;
END;
$fn$;


-- ============================================================
-- RPC: blend_taste_profiles(p_user_ids UUID[])
-- Blends multiple user taste profiles for group dining.
-- Returns a combined profile with compatibility score.
-- ============================================================
CREATE OR REPLACE FUNCTION blend_taste_profiles(p_user_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_count INTEGER;
  v_profiles user_taste_profiles[];
  v_profile user_taste_profiles;
  v_uid UUID;
  v_idx INTEGER := 0;

  -- Aggregates
  v_noise_sum NUMERIC := 0;
  v_energy_sum NUMERIC := 0;
  v_formality_sum NUMERIC := 0;
  v_min_price NUMERIC := 4;
  v_total_signals INTEGER := 0;

  -- Cuisine blending
  v_cuisine_map JSONB := '{}'::jsonb;
  v_cuisine_name TEXT;
  v_cuisine_score NUMERIC;
  v_cuisine_user_count INTEGER;
  v_blended_cuisines JSONB := '[]'::jsonb;

  -- Neighborhood blending
  v_neighborhood_map JSONB := '{}'::jsonb;
  v_neighborhood_name TEXT;
  v_neighborhood_user_count INTEGER;
  v_common_neighborhoods JSONB := '[]'::jsonb;

  -- Compatibility
  v_compatibility NUMERIC := 100;
  v_noise_range NUMERIC;
  v_energy_range NUMERIC;
  v_formality_range NUMERIC;
  v_noise_min NUMERIC := 1;
  v_noise_max NUMERIC := -1;
  v_energy_min NUMERIC := 1;
  v_energy_max NUMERIC := -1;
  v_formality_min NUMERIC := 1;
  v_formality_max NUMERIC := -1;
  v_cuisine_overlap INTEGER := 0;
  v_total_unique_cuisines INTEGER := 0;

  -- Try something new
  v_try_new JSONB := '[]'::jsonb;
  v_all_cuisines TEXT[];

  v_result JSONB;
  v_elem JSONB;
  v_i INTEGER;
BEGIN
  v_count := array_length(p_user_ids, 1);

  IF v_count IS NULL OR v_count < 2 THEN
    RETURN jsonb_build_object(
      'error', 'At least 2 user IDs required',
      'compatibility_score', 0
    );
  END IF;

  IF v_count > 8 THEN
    RETURN jsonb_build_object(
      'error', 'Maximum 8 users for group blend',
      'compatibility_score', 0
    );
  END IF;

  -- Ensure all profiles exist and are fresh
  FOREACH v_uid IN ARRAY p_user_ids LOOP
    SELECT * INTO v_profile
    FROM user_taste_profiles
    WHERE user_id = v_uid;

    IF v_profile IS NULL OR v_profile.expires_at < now() THEN
      PERFORM compute_taste_profile(v_uid);
      SELECT * INTO v_profile
      FROM user_taste_profiles
      WHERE user_id = v_uid;
    END IF;

    IF v_profile IS NULL THEN
      CONTINUE;
    END IF;

    v_idx := v_idx + 1;

    -- Accumulate vibe averages
    v_noise_sum := v_noise_sum + v_profile.noise_preference;
    v_energy_sum := v_energy_sum + v_profile.energy_preference;
    v_formality_sum := v_formality_sum + v_profile.formality_preference;
    v_total_signals := v_total_signals + v_profile.total_signals;

    -- Track vibe ranges for compatibility
    v_noise_min := LEAST(v_noise_min, v_profile.noise_preference);
    v_noise_max := GREATEST(v_noise_max, v_profile.noise_preference);
    v_energy_min := LEAST(v_energy_min, v_profile.energy_preference);
    v_energy_max := GREATEST(v_energy_max, v_profile.energy_preference);
    v_formality_min := LEAST(v_formality_min, v_profile.formality_preference);
    v_formality_max := GREATEST(v_formality_max, v_profile.formality_preference);

    -- Track minimum price (accommodate the most budget-conscious)
    IF v_profile.price_affinity IS NOT NULL THEN
      v_min_price := LEAST(v_min_price, v_profile.price_affinity);
    END IF;

    -- Aggregate cuisine affinities: track each cuisine across users
    IF v_profile.cuisine_affinities IS NOT NULL THEN
      FOR v_i IN 0..jsonb_array_length(v_profile.cuisine_affinities) - 1 LOOP
        v_elem := v_profile.cuisine_affinities->v_i;
        v_cuisine_name := v_elem->>'cuisine';
        v_cuisine_score := COALESCE((v_elem->>'score')::numeric, 0);

        IF v_cuisine_map ? v_cuisine_name THEN
          -- Increment count and add score
          v_cuisine_map := jsonb_set(v_cuisine_map, ARRAY[v_cuisine_name],
            jsonb_build_object(
              'score_sum', COALESCE((v_cuisine_map->v_cuisine_name->>'score_sum')::numeric, 0) + v_cuisine_score,
              'user_count', COALESCE((v_cuisine_map->v_cuisine_name->>'user_count')::integer, 0) + 1
            )
          );
        ELSE
          v_cuisine_map := v_cuisine_map || jsonb_build_object(
            v_cuisine_name,
            jsonb_build_object('score_sum', v_cuisine_score, 'user_count', 1)
          );
        END IF;
      END LOOP;
    END IF;

    -- Aggregate neighborhood affinities
    IF v_profile.neighborhood_affinities IS NOT NULL THEN
      FOR v_i IN 0..jsonb_array_length(v_profile.neighborhood_affinities) - 1 LOOP
        v_elem := v_profile.neighborhood_affinities->v_i;
        v_neighborhood_name := v_elem->>'neighborhood';

        IF v_neighborhood_map ? v_neighborhood_name THEN
          v_neighborhood_map := jsonb_set(v_neighborhood_map, ARRAY[v_neighborhood_name],
            to_jsonb(COALESCE((v_neighborhood_map->>v_neighborhood_name)::integer, 0) + 1)
          );
        ELSE
          v_neighborhood_map := v_neighborhood_map || jsonb_build_object(v_neighborhood_name, 1);
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- No valid profiles found
  IF v_idx = 0 THEN
    RETURN jsonb_build_object(
      'error', 'No taste profiles found for provided users',
      'compatibility_score', 0
    );
  END IF;

  -- Build blended cuisines: only include cuisines that at least 2 users share
  -- (or if only 2 users, include shared ones)
  SELECT jsonb_agg(
    jsonb_build_object(
      'cuisine', k,
      'score', round(((v_cuisine_map->k->>'score_sum')::numeric / (v_cuisine_map->k->>'user_count')::integer)::numeric, 2),
      'shared_by', (v_cuisine_map->k->>'user_count')::integer
    )
    ORDER BY ((v_cuisine_map->k->>'score_sum')::numeric / (v_cuisine_map->k->>'user_count')::integer) DESC
  )
  INTO v_blended_cuisines
  FROM jsonb_object_keys(v_cuisine_map) k
  WHERE (v_cuisine_map->k->>'user_count')::integer >= LEAST(2, v_idx);

  -- Count cuisine overlap for compatibility
  SELECT count(*)
  INTO v_cuisine_overlap
  FROM jsonb_object_keys(v_cuisine_map) k
  WHERE (v_cuisine_map->k->>'user_count')::integer >= LEAST(2, v_idx);

  SELECT count(*)
  INTO v_total_unique_cuisines
  FROM jsonb_object_keys(v_cuisine_map) k;

  -- Build common neighborhoods (at least 2 users)
  SELECT jsonb_agg(
    jsonb_build_object('neighborhood', k, 'shared_by', (v_neighborhood_map->>k)::integer)
    ORDER BY (v_neighborhood_map->>k)::integer DESC
  )
  INTO v_common_neighborhoods
  FROM jsonb_object_keys(v_neighborhood_map) k
  WHERE (v_neighborhood_map->>k)::integer >= LEAST(2, v_idx);

  -- Build "try something new" suggestions: cuisines only 1 user has
  SELECT jsonb_agg(
    jsonb_build_object(
      'cuisine', k,
      'score', round(((v_cuisine_map->k->>'score_sum')::numeric)::numeric, 2)
    )
    ORDER BY (v_cuisine_map->k->>'score_sum')::numeric DESC
  )
  INTO v_try_new
  FROM jsonb_object_keys(v_cuisine_map) k
  WHERE (v_cuisine_map->k->>'user_count')::integer = 1;

  -- Compute compatibility score (0-100)
  -- Penalize for vibe disagreement (each axis up to -15 points)
  v_noise_range := v_noise_max - v_noise_min;       -- 0 to 2
  v_energy_range := v_energy_max - v_energy_min;
  v_formality_range := v_formality_max - v_formality_min;

  v_compatibility := v_compatibility
    - LEAST(v_noise_range * 7.5, 15)      -- noise disagreement penalty
    - LEAST(v_energy_range * 7.5, 15)     -- energy disagreement penalty
    - LEAST(v_formality_range * 7.5, 15); -- formality disagreement penalty

  -- Bonus for cuisine overlap
  IF v_total_unique_cuisines > 0 THEN
    v_compatibility := v_compatibility
      - LEAST((1.0 - v_cuisine_overlap::numeric / v_total_unique_cuisines) * 30, 30);
  END IF;

  -- Clamp to 0-100
  v_compatibility := GREATEST(LEAST(round(v_compatibility), 100), 0);

  -- Build result
  v_result := jsonb_build_object(
    'compatibility_score', v_compatibility,
    'group_size', v_idx,
    'common_ground', jsonb_build_object(
      'cuisines', COALESCE(v_blended_cuisines, '[]'::jsonb),
      'neighborhoods', COALESCE(v_common_neighborhoods, '[]'::jsonb)
    ),
    'try_something_new', COALESCE(v_try_new, '[]'::jsonb),
    'blended_vibe', jsonb_build_object(
      'noise', round((v_noise_sum / v_idx)::numeric, 2),
      'energy', round((v_energy_sum / v_idx)::numeric, 2),
      'formality', round((v_formality_sum / v_idx)::numeric, 2)
    ),
    'price_sweet_spot', CASE
      WHEN v_min_price <= 1.5 THEN '$'
      WHEN v_min_price <= 2.5 THEN '$$'
      WHEN v_min_price <= 3.5 THEN '$$$'
      ELSE '$$$$'
    END,
    'total_signals', v_total_signals,
    'blended_at', now()
  );

  RETURN v_result;
END;
$fn$;


-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_taste_dna(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_taste_dna(UUID) TO anon;
GRANT EXECUTE ON FUNCTION blend_taste_profiles(UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION blend_taste_profiles(UUID[]) TO anon;
