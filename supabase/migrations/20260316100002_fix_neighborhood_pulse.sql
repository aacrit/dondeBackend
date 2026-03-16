-- Fix get_neighborhood_pulse RPC: replace r.google_rating references
-- The google_rating column was dropped in migration 20260219000001_google_compliance.sql
-- per Google Maps Platform ToS. Replace with review intelligence avg_review_rating
-- from restaurant_review_intelligence table as a quality tiebreaker.

CREATE OR REPLACE FUNCTION get_neighborhood_pulse(
  p_neighborhood TEXT DEFAULT NULL,
  p_time_of_day TEXT DEFAULT NULL,   -- breakfast/lunch/dinner/late_night
  p_day_of_week INTEGER DEFAULT NULL -- 0=Sunday, 6=Saturday
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  v_neighborhood TEXT;
  v_time TEXT;
  v_season TEXT;
  v_month INTEGER;
  v_hour INTEGER;
  v_day INTEGER;
BEGIN
  -- Determine season from current month (Chicago time)
  v_month := EXTRACT(MONTH FROM NOW() AT TIME ZONE 'America/Chicago');
  v_season := CASE
    WHEN v_month IN (3, 4, 5) THEN 'spring'
    WHEN v_month IN (6, 7, 8) THEN 'summer'
    WHEN v_month IN (9, 10, 11) THEN 'fall'
    ELSE 'winter'
  END;

  -- Derive current hour and day of week in Chicago time
  v_hour := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'America/Chicago');
  v_day := COALESCE(p_day_of_week,
    EXTRACT(DOW FROM NOW() AT TIME ZONE 'America/Chicago')::INTEGER);

  -- Determine time of day from provided value or current hour
  v_time := COALESCE(p_time_of_day,
    CASE
      WHEN v_hour BETWEEN 6 AND 10 THEN 'breakfast'
      WHEN v_hour BETWEEN 11 AND 14 THEN 'lunch'
      WHEN v_hour BETWEEN 15 AND 20 THEN 'dinner'
      ELSE 'late_night'
    END);

  -- Pick neighborhood: use provided, or select one with high seasonal
  -- relevance + restaurant density for the current season
  v_neighborhood := COALESCE(p_neighborhood, (
    SELECT n.name
    FROM neighborhoods n
    JOIN restaurants r ON r.neighborhood_id = n.id
    JOIN restaurant_deep_profiles rdp ON rdp.restaurant_id = r.id
    WHERE r.is_active = true
      AND rdp.seasonal_relevance IS NOT NULL
      AND rdp.energy_level IS NOT NULL
    GROUP BY n.name
    ORDER BY
      AVG(
        COALESCE((rdp.seasonal_relevance ->> v_season)::NUMERIC, 5)
      ) DESC,
      AVG(rdp.energy_level) DESC,
      COUNT(*) DESC
    LIMIT 1
    OFFSET (FLOOR(RANDOM() * 3))  -- rotate among top 3
  ));

  -- If still NULL (no deep profiles), fall back to a popular neighborhood
  IF v_neighborhood IS NULL THEN
    SELECT n.name INTO v_neighborhood
    FROM neighborhoods n
    JOIN restaurants r ON r.neighborhood_id = n.id
    WHERE r.is_active = true
    GROUP BY n.name
    ORDER BY COUNT(*) DESC
    LIMIT 1;
  END IF;

  -- Select a contextually appropriate restaurant from that neighborhood
  -- Priority: seasonal relevance + energy match + review intelligence rating
  SELECT json_build_object(
    'neighborhood', v_neighborhood,
    'time_of_day', v_time,
    'season', v_season,
    'day_of_week', v_day,
    'restaurant_name', r.name,
    'restaurant_id', r.id,
    'cuisine_type', r.cuisine_type,
    'price_level', r.price_level,
    'avg_review_rating', ri.avg_review_rating,
    'best_for_oneliner', r.best_for_oneliner,
    'energy_level', rdp.energy_level,
    'crowd_profile', rdp.crowd_profile,
    'wow_factor', CASE
      WHEN rdp.wow_factors IS NOT NULL AND array_length(rdp.wow_factors, 1) > 0
      THEN rdp.wow_factors[1]
      ELSE NULL
    END,
    'best_times', r.best_times,
    'neighborhood_integration', rdp.neighborhood_integration,
    'signature_dish', CASE
      WHEN rdp.signature_dishes IS NOT NULL
        AND jsonb_array_length(rdp.signature_dishes) > 0
      THEN rdp.signature_dishes -> 0 ->> 'dish'
      ELSE NULL
    END,
    'service_style', rdp.service_style,
    'outdoor_seating', r.outdoor_seating,
    'noise_level', r.noise_level,
    'ambiance', r.ambiance
  ) INTO result
  FROM restaurants r
  JOIN neighborhoods n ON r.neighborhood_id = n.id
  JOIN restaurant_deep_profiles rdp ON rdp.restaurant_id = r.id
  LEFT JOIN restaurant_review_intelligence ri ON ri.restaurant_id = r.id
  WHERE n.name = v_neighborhood
    AND r.is_active = true
    AND rdp.energy_level IS NOT NULL
  ORDER BY
    -- Seasonal relevance bonus
    COALESCE((rdp.seasonal_relevance ->> v_season)::NUMERIC, 5) DESC,
    -- Energy match: breakfast=low, dinner=high, late_night=high
    ABS(rdp.energy_level - CASE v_time
      WHEN 'breakfast' THEN 4
      WHEN 'lunch' THEN 6
      WHEN 'dinner' THEN 7
      WHEN 'late_night' THEN 8
      ELSE 6
    END) ASC,
    -- Quality tiebreaker: use review intelligence avg_review_rating instead of dropped google_rating
    COALESCE(ri.avg_review_rating, 0) DESC
  LIMIT 1
  OFFSET (FLOOR(RANDOM() * 2));  -- slight randomness among top picks

  RETURN result;
END;
$$;

-- Re-grant execute permissions
GRANT EXECUTE ON FUNCTION get_neighborhood_pulse(TEXT, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION get_neighborhood_pulse(TEXT, TEXT, INTEGER) TO authenticated;
