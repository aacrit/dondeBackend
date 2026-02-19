-- Enhanced RPC function for recommendation engine
-- Enhancements: 1 (Any occasion neutral), 5 (dietary/array fields), 15 (neighborhood desc), 20 (is_active filter)

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
    trending_score numeric
) AS $$
DECLARE
    v_score_column text;
    v_neighborhood_id uuid;
    v_use_total boolean := false;
BEGIN
    -- Map occasion to score column
    -- Enhancement 1: "Any" uses total_score instead of date_friendly_score
    IF p_occasion = 'Any' THEN
        v_use_total := true;
        v_score_column := 'date_friendly_score'; -- placeholder, not used for ORDER BY when v_use_total
    ELSE
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
    END IF;

    -- Resolve neighborhood name to ID (if not "Anywhere")
    IF p_neighborhood != 'Anywhere' THEN
        SELECT n.id INTO v_neighborhood_id
        FROM neighborhoods n
        WHERE lower(n.name) = lower(p_neighborhood);

        -- If neighborhood not found, return empty set immediately
        IF v_neighborhood_id IS NULL THEN
            RETURN;
        END IF;
    END IF;

    -- Enhancement 1: Use different ORDER BY for "Any" occasion
    IF v_use_total THEN
        RETURN QUERY
        SELECT
            r.id, r.name, r.address,
            n.name as neighborhood_name,
            r.neighborhood_id,
            n.description as neighborhood_description,
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
            -- For "Any", occasion_score is the average (total/7)
            ((COALESCE(os.date_friendly_score, 0) + COALESCE(os.group_friendly_score, 0) +
              COALESCE(os.family_friendly_score, 0) + COALESCE(os.romantic_rating, 0) +
              COALESCE(os.business_lunch_score, 0) + COALESCE(os.solo_dining_score, 0) +
              COALESCE(os.hole_in_wall_factor, 0)) / 7)::integer as occasion_score,
            (COALESCE(os.date_friendly_score, 0) + COALESCE(os.group_friendly_score, 0) +
             COALESCE(os.family_friendly_score, 0) + COALESCE(os.romantic_rating, 0) +
             COALESCE(os.business_lunch_score, 0) + COALESCE(os.solo_dining_score, 0) +
             COALESCE(os.hole_in_wall_factor, 0))::integer as total_score,
            COALESCE(rp.trending_score, 0)::numeric as trending_score
        FROM restaurants r
        LEFT JOIN neighborhoods n ON r.neighborhood_id = n.id
        LEFT JOIN occasion_scores os ON os.restaurant_id = r.id
        LEFT JOIN restaurant_popularity rp ON rp.restaurant_id = r.id
        WHERE r.noise_level IS NOT NULL
            AND (r.is_active IS NULL OR r.is_active = true)
            AND (p_neighborhood = 'Anywhere' OR r.neighborhood_id = v_neighborhood_id)
            AND (p_price_level = 'Any' OR r.price_level = p_price_level)
        ORDER BY
            -- For "Any": sort by total_score (well-rounded restaurants first)
            (COALESCE(os.date_friendly_score, 0) + COALESCE(os.group_friendly_score, 0) +
             COALESCE(os.family_friendly_score, 0) + COALESCE(os.romantic_rating, 0) +
             COALESCE(os.business_lunch_score, 0) + COALESCE(os.solo_dining_score, 0) +
             COALESCE(os.hole_in_wall_factor, 0)) DESC,
            random()
        LIMIT p_limit;
    ELSE
        RETURN QUERY EXECUTE format(
            'SELECT
                r.id, r.name, r.address,
                n.name as neighborhood_name,
                r.neighborhood_id,
                n.description as neighborhood_description,
                r.google_place_id, r.price_level,
                r.noise_level, r.lighting_ambiance, r.dress_code,
                r.outdoor_seating, r.live_music, r.pet_friendly,
                r.parking_availability, r.cuisine_type, r.best_for_oneliner,
                r.insider_tip,
                r.best_times,
                r.dietary_options,
                r.good_for,
                r.ambiance,
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
                COALESCE(
                    ARRAY(SELECT t.tag_category FROM tags t WHERE t.restaurant_id = r.id AND t.tag_category IS NOT NULL),
                    ARRAY[]::text[]
                ) as tag_categories,
                COALESCE(os.%I, 0)::integer as occasion_score,
                (COALESCE(os.date_friendly_score, 0) + COALESCE(os.group_friendly_score, 0) +
                 COALESCE(os.family_friendly_score, 0) + COALESCE(os.romantic_rating, 0) +
                 COALESCE(os.business_lunch_score, 0) + COALESCE(os.solo_dining_score, 0) +
                 COALESCE(os.hole_in_wall_factor, 0))::integer as total_score,
                COALESCE(rp.trending_score, 0)::numeric as trending_score
            FROM restaurants r
            LEFT JOIN neighborhoods n ON r.neighborhood_id = n.id
            LEFT JOIN occasion_scores os ON os.restaurant_id = r.id
            LEFT JOIN restaurant_popularity rp ON rp.restaurant_id = r.id
            WHERE r.noise_level IS NOT NULL
                AND (r.is_active IS NULL OR r.is_active = true)
                AND ($1 = ''Anywhere'' OR r.neighborhood_id = $2)
                AND ($3 = ''Any'' OR r.price_level = $3)
            ORDER BY COALESCE(os.%I, 0) DESC,
                (COALESCE(os.date_friendly_score, 0) + COALESCE(os.group_friendly_score, 0) +
                 COALESCE(os.family_friendly_score, 0) + COALESCE(os.romantic_rating, 0) +
                 COALESCE(os.business_lunch_score, 0) + COALESCE(os.solo_dining_score, 0) +
                 COALESCE(os.hole_in_wall_factor, 0)) DESC,
                random()
            LIMIT $4',
            v_score_column, v_score_column
        )
        USING p_neighborhood, v_neighborhood_id, p_price_level, p_limit;
    END IF;
END;
$$ LANGUAGE plpgsql VOLATILE;
