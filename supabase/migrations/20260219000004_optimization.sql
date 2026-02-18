-- Migration: Optimization — pre-recommendations table, insider_tip column, RPC function, composite index

-- 1. Pre-generated recommendations table (Claude output — ours to store per Anthropic ToS)
CREATE TABLE IF NOT EXISTS pre_recommendations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    occasion text NOT NULL,
    recommendation text NOT NULL,
    donde_score numeric(3,1) NOT NULL CHECK (donde_score >= 0 AND donde_score <= 10),
    generated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(restaurant_id, occasion)
);

CREATE INDEX IF NOT EXISTS idx_pre_recs_restaurant_occasion
    ON pre_recommendations(restaurant_id, occasion);

-- 2. Insider tip column on restaurants (pre-generated during enrichment)
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS insider_tip text;

-- 3. Composite index for RPC function's common WHERE pattern
CREATE INDEX IF NOT EXISTS idx_restaurants_neighborhood_price_enriched
    ON restaurants(neighborhood_id, price_level)
    WHERE noise_level IS NOT NULL;

-- 4. RPC function: server-side join + filter + rank in one round-trip
CREATE OR REPLACE FUNCTION get_ranked_restaurants(
    p_neighborhood text DEFAULT 'Anywhere',
    p_price_level text DEFAULT 'Any',
    p_occasion text DEFAULT 'Any',
    p_limit int DEFAULT 10
)
RETURNS TABLE (
    id uuid,
    name text,
    address text,
    neighborhood_name text,
    neighborhood_id uuid,
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
    date_friendly_score integer,
    group_friendly_score integer,
    family_friendly_score integer,
    romantic_rating integer,
    business_lunch_score integer,
    solo_dining_score integer,
    hole_in_wall_factor integer,
    tags text[],
    occasion_score integer,
    total_score integer
) AS $$
DECLARE
    v_score_column text;
    v_neighborhood_id uuid;
BEGIN
    -- Map occasion to score column
    v_score_column := CASE p_occasion
        WHEN 'Date Night' THEN 'date_friendly_score'
        WHEN 'Group Hangout' THEN 'group_friendly_score'
        WHEN 'Family Dinner' THEN 'family_friendly_score'
        WHEN 'Business Lunch' THEN 'business_lunch_score'
        WHEN 'Solo Dining' THEN 'solo_dining_score'
        WHEN 'Special Occasion' THEN 'romantic_rating'
        WHEN 'Treat Myself' THEN 'solo_dining_score'
        WHEN 'Adventure' THEN 'hole_in_wall_factor'
        WHEN 'Chill Hangout' THEN 'group_friendly_score'
        ELSE 'date_friendly_score'
    END;

    -- Resolve neighborhood name to ID (if not "Anywhere")
    IF p_neighborhood != 'Anywhere' THEN
        SELECT n.id INTO v_neighborhood_id
        FROM neighborhoods n
        WHERE lower(n.name) = lower(p_neighborhood);
    END IF;

    RETURN QUERY EXECUTE format(
        'SELECT
            r.id, r.name, r.address,
            n.name as neighborhood_name,
            r.neighborhood_id,
            r.google_place_id, r.price_level,
            r.noise_level, r.lighting_ambiance, r.dress_code,
            r.outdoor_seating, r.live_music, r.pet_friendly,
            r.parking_availability, r.cuisine_type, r.best_for_oneliner,
            r.insider_tip,
            COALESCE(os.date_friendly_score, 0)::integer as date_friendly_score,
            COALESCE(os.group_friendly_score, 0)::integer as group_friendly_score,
            COALESCE(os.family_friendly_score, 0)::integer as family_friendly_score,
            COALESCE(os.romantic_rating, 0)::integer as romantic_rating,
            COALESCE(os.business_lunch_score, 0)::integer as business_lunch_score,
            COALESCE(os.solo_dining_score, 0)::integer as solo_dining_score,
            COALESCE(os.hole_in_wall_factor, 0)::integer as hole_in_wall_factor,
            COALESCE(
                ARRAY(SELECT t.tag_text FROM tags t WHERE t.restaurant_id = r.id AND t.tag_text IS NOT NULL AND t.tag_text != ''null''),
                ARRAY[]::text[]
            ) as tags,
            COALESCE(os.%I, 0)::integer as occasion_score,
            (COALESCE(os.date_friendly_score, 0) + COALESCE(os.group_friendly_score, 0) +
             COALESCE(os.family_friendly_score, 0) + COALESCE(os.romantic_rating, 0) +
             COALESCE(os.business_lunch_score, 0) + COALESCE(os.solo_dining_score, 0) +
             COALESCE(os.hole_in_wall_factor, 0))::integer as total_score
        FROM restaurants r
        LEFT JOIN neighborhoods n ON r.neighborhood_id = n.id
        LEFT JOIN occasion_scores os ON os.restaurant_id = r.id
        WHERE r.noise_level IS NOT NULL
            AND ($1 = ''Anywhere'' OR r.neighborhood_id = $2)
            AND ($3 = ''Any'' OR r.price_level = $3)
        ORDER BY COALESCE(os.%I, 0) DESC,
            (COALESCE(os.date_friendly_score, 0) + COALESCE(os.group_friendly_score, 0) +
             COALESCE(os.family_friendly_score, 0) + COALESCE(os.romantic_rating, 0) +
             COALESCE(os.business_lunch_score, 0) + COALESCE(os.solo_dining_score, 0) +
             COALESCE(os.hole_in_wall_factor, 0)) DESC
        LIMIT $4',
        v_score_column, v_score_column
    )
    USING p_neighborhood, v_neighborhood_id, p_price_level, p_limit;
END;
$$ LANGUAGE plpgsql STABLE;
