-- V10: Enhanced Retrieval RPC
-- Improvements over V9:
-- 1. Cuisine-aware candidate boost (p_target_cuisines) — prioritizes matching restaurants
-- 2. Tag-aware retrieval (p_target_tags) — boosts restaurants with matching tags
-- 3. Reputation signals in ordering — awards, chef_notable, trending
-- 4. Dynamic candidate pool via p_limit (caller can request 80 for vibe queries)
-- 5. Better neighborhood matching with cuisine+tag cross-signals

CREATE OR REPLACE FUNCTION get_candidates_v10(
  p_query text DEFAULT NULL,
  p_neighborhood text DEFAULT 'Anywhere',
  p_price_level text DEFAULT 'Any',
  p_occasion text DEFAULT 'Any',
  p_limit int DEFAULT 50,
  p_exclude uuid[] DEFAULT '{}',
  p_target_cuisines text[] DEFAULT '{}',
  p_target_tags text[] DEFAULT '{}'
)
RETURNS TABLE (
  -- Core restaurant fields (same as v9)
  id uuid,
  name text,
  address text,
  neighborhood_name text,
  neighborhood_id uuid,
  neighborhood_description text,
  google_place_id text,
  price_level text,
  noise_level text,
  lighting_ambiance text,
  dress_code text,
  outdoor_seating boolean,
  live_music boolean,
  pet_friendly boolean,
  parking_availability text,
  cuisine_type text,
  best_for_oneliner text,
  insider_tip text,
  best_times text[],
  dietary_options text[],
  good_for text[],
  ambiance text[],
  -- Occasion scores
  date_friendly_score integer,
  group_friendly_score integer,
  family_friendly_score integer,
  romantic_rating integer,
  business_lunch_score integer,
  solo_dining_score integer,
  hole_in_wall_factor integer,
  tags text[],
  tag_categories text[],
  occasion_score integer,
  total_score integer,
  trending_score numeric,
  -- Deep profile fields
  dp_flavor_profiles text[],
  dp_signature_dishes jsonb,
  dp_cuisine_subcategory text,
  dp_menu_depth text,
  dp_spice_level text,
  dp_dietary_depth text,
  dp_service_style text,
  dp_meal_pacing text,
  dp_reservation_difficulty text,
  dp_typical_wait_minutes integer,
  dp_group_size_sweet_spot int4range,
  dp_check_average_per_person integer,
  dp_tipping_culture text,
  dp_kid_friendliness numeric,
  dp_music_vibe text,
  dp_decor_style text,
  dp_conversation_friendliness numeric,
  dp_energy_level numeric,
  dp_seating_options text[],
  dp_instagram_worthiness numeric,
  dp_seasonal_relevance jsonb,
  dp_cultural_authenticity numeric,
  dp_origin_story text,
  dp_crowd_profile text[],
  dp_neighborhood_integration text,
  dp_chef_notable boolean,
  dp_awards_recognition text[],
  dp_wow_factors text[],
  dp_date_progression text,
  dp_best_seat_in_house text,
  dp_ideal_weather text[],
  dp_unique_selling_point text,
  dp_transit_accessibility text,
  dp_byob_policy text,
  dp_payment_notes text,
  dp_enrichment_confidence numeric,
  dp_menu_highlights text[],
  -- Review intelligence fields
  ri_dish_catalog text[],
  ri_popular_dishes text[],
  ri_cuisine_signals text[],
  ri_review_food_quality numeric,
  ri_review_service_quality numeric,
  ri_review_ambiance_quality numeric,
  ri_review_value_score numeric,
  ri_text_rank real
) AS $$
DECLARE
  v_neighborhood_id uuid;
  v_has_cuisine_filter boolean;
  v_has_tag_filter boolean;
BEGIN
  v_has_cuisine_filter := array_length(p_target_cuisines, 1) IS NOT NULL AND array_length(p_target_cuisines, 1) > 0;
  v_has_tag_filter := array_length(p_target_tags, 1) IS NOT NULL AND array_length(p_target_tags, 1) > 0;

  -- Resolve neighborhood name to ID (if specified)
  IF p_neighborhood != 'Anywhere' THEN
    SELECT n.id INTO v_neighborhood_id
    FROM neighborhoods n
    WHERE lower(n.name) = lower(p_neighborhood);
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.name, r.address,
    n.name AS neighborhood_name,
    r.neighborhood_id,
    n.description AS neighborhood_description,
    r.google_place_id, r.price_level,
    r.noise_level, r.lighting_ambiance, r.dress_code,
    r.outdoor_seating, r.live_music, r.pet_friendly,
    r.parking_availability, r.cuisine_type, r.best_for_oneliner,
    r.insider_tip,
    r.best_times,
    r.dietary_options,
    r.good_for,
    r.ambiance,
    COALESCE(os.date_friendly_score, 0)::integer,
    COALESCE(os.group_friendly_score, 0)::integer,
    COALESCE(os.family_friendly_score, 0)::integer,
    COALESCE(os.romantic_rating, 0)::integer,
    COALESCE(os.business_lunch_score, 0)::integer,
    COALESCE(os.solo_dining_score, 0)::integer,
    COALESCE(os.hole_in_wall_factor, 0)::integer,
    COALESCE(
      ARRAY(SELECT t.tag_text FROM tags t WHERE t.restaurant_id = r.id AND t.tag_text IS NOT NULL AND t.tag_text != 'null'),
      ARRAY[]::text[]
    ),
    COALESCE(
      ARRAY(SELECT t.tag_category FROM tags t WHERE t.restaurant_id = r.id AND t.tag_category IS NOT NULL),
      ARRAY[]::text[]
    ),
    -- Occasion score
    CASE
      WHEN p_occasion = 'Date Night' THEN COALESCE(os.date_friendly_score, 0)
      WHEN p_occasion = 'Group Hangout' THEN COALESCE(os.group_friendly_score, 0)
      WHEN p_occasion = 'Family Dinner' THEN COALESCE(os.family_friendly_score, 0)
      WHEN p_occasion = 'Business Lunch' THEN COALESCE(os.business_lunch_score, 0)
      WHEN p_occasion = 'Solo Dining' THEN COALESCE(os.solo_dining_score, 0)
      WHEN p_occasion = 'Special Occasion' THEN COALESCE(os.romantic_rating, 0)
      WHEN p_occasion = 'Treat Myself' THEN COALESCE(os.solo_dining_score, 0)
      WHEN p_occasion = 'Adventure' THEN COALESCE(os.hole_in_wall_factor, 0)
      WHEN p_occasion = 'Chill Hangout' THEN COALESCE(os.group_friendly_score, 0)
      ELSE ((COALESCE(os.date_friendly_score, 0) + COALESCE(os.group_friendly_score, 0) +
             COALESCE(os.family_friendly_score, 0) + COALESCE(os.romantic_rating, 0) +
             COALESCE(os.business_lunch_score, 0) + COALESCE(os.solo_dining_score, 0) +
             COALESCE(os.hole_in_wall_factor, 0)) / 7)
    END::integer,
    (COALESCE(os.date_friendly_score, 0) + COALESCE(os.group_friendly_score, 0) +
     COALESCE(os.family_friendly_score, 0) + COALESCE(os.romantic_rating, 0) +
     COALESCE(os.business_lunch_score, 0) + COALESCE(os.solo_dining_score, 0) +
     COALESCE(os.hole_in_wall_factor, 0))::integer,
    COALESCE(rp.trending_score, 0)::numeric,
    -- Deep profile fields
    dp.flavor_profiles,
    dp.signature_dishes,
    dp.cuisine_subcategory,
    dp.menu_depth,
    dp.spice_level,
    dp.dietary_depth,
    dp.service_style,
    dp.meal_pacing,
    dp.reservation_difficulty,
    dp.typical_wait_minutes,
    dp.group_size_sweet_spot,
    dp.check_average_per_person,
    dp.tipping_culture,
    dp.kid_friendliness,
    dp.music_vibe,
    dp.decor_style,
    dp.conversation_friendliness,
    dp.energy_level,
    dp.seating_options,
    dp.instagram_worthiness,
    dp.seasonal_relevance,
    dp.cultural_authenticity,
    dp.origin_story,
    dp.crowd_profile,
    dp.neighborhood_integration,
    dp.chef_notable,
    dp.awards_recognition,
    dp.wow_factors,
    dp.date_progression,
    dp.best_seat_in_house,
    dp.ideal_weather,
    dp.unique_selling_point,
    dp.transit_accessibility,
    dp.byob_policy,
    dp.payment_notes,
    dp.enrichment_confidence,
    dp.menu_highlights,
    -- Review intelligence fields
    ri.dish_catalog,
    ri.popular_dishes,
    ri.cuisine_signals,
    ri.review_food_quality,
    ri.review_service_quality,
    ri.review_ambiance_quality,
    ri.review_value_score,
    -- Full-text search rank
    CASE WHEN p_query IS NOT NULL AND ri.review_search_vector IS NOT NULL
         THEN ts_rank(ri.review_search_vector, plainto_tsquery('english', p_query))
         ELSE 0.0
    END::real AS ri_text_rank
  FROM restaurants r
  LEFT JOIN neighborhoods n ON r.neighborhood_id = n.id
  LEFT JOIN occasion_scores os ON os.restaurant_id = r.id
  LEFT JOIN restaurant_popularity rp ON rp.restaurant_id = r.id
  LEFT JOIN restaurant_deep_profiles dp ON dp.restaurant_id = r.id
  LEFT JOIN restaurant_review_intelligence ri ON ri.restaurant_id = r.id
  WHERE r.noise_level IS NOT NULL
    AND (r.is_active IS NULL OR r.is_active = true)
    AND r.id != ALL(p_exclude)
  ORDER BY
    -- V10 PRIMARY: Cuisine match boost (100 points for exact match, 80 for review intelligence match)
    CASE WHEN v_has_cuisine_filter THEN
      CASE
        WHEN r.cuisine_type IS NOT NULL AND lower(r.cuisine_type) = ANY(SELECT lower(unnest(p_target_cuisines))) THEN 100
        WHEN ri.cuisine_signals IS NOT NULL AND ri.cuisine_signals && p_target_cuisines THEN 80
        WHEN r.cuisine_type IS NOT NULL AND EXISTS (
          SELECT 1 FROM unnest(p_target_cuisines) tc
          WHERE lower(r.cuisine_type) LIKE '%' || lower(tc) || '%'
             OR lower(tc) LIKE '%' || lower(r.cuisine_type) || '%'
        ) THEN 60
        ELSE 0
      END
    ELSE 0
    END DESC,
    -- V10 SECONDARY: Tag match boost (for vibe queries)
    CASE WHEN v_has_tag_filter THEN
      (SELECT COUNT(*)::integer FROM tags t
       WHERE t.restaurant_id = r.id
         AND t.tag_text IS NOT NULL
         AND lower(t.tag_text) = ANY(SELECT lower(unnest(p_target_tags))))
    ELSE 0
    END DESC,
    -- V10 TERTIARY: Review intelligence text match
    CASE WHEN p_query IS NOT NULL AND ri.review_search_vector IS NOT NULL
         THEN ts_rank(ri.review_search_vector, plainto_tsquery('english', p_query))
         ELSE 0.0
    END DESC,
    -- V10 QUATERNARY: Reputation signals (awards + chef + trending)
    (CASE WHEN dp.chef_notable = true THEN 10 ELSE 0 END +
     CASE WHEN dp.awards_recognition IS NOT NULL AND array_length(dp.awards_recognition, 1) > 0 THEN 15 ELSE 0 END +
     CASE WHEN COALESCE(rp.trending_score, 0) >= 7 THEN 5 ELSE 0 END) DESC,
    -- Neighborhood preference
    CASE WHEN v_neighborhood_id IS NOT NULL AND r.neighborhood_id = v_neighborhood_id
         THEN 1 ELSE 0
    END DESC,
    -- Total occasion score as tiebreaker
    (COALESCE(os.date_friendly_score, 0) + COALESCE(os.group_friendly_score, 0) +
     COALESCE(os.family_friendly_score, 0) + COALESCE(os.romantic_rating, 0) +
     COALESCE(os.business_lunch_score, 0) + COALESCE(os.solo_dining_score, 0) +
     COALESCE(os.hole_in_wall_factor, 0)) DESC,
    random()
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql VOLATILE;
