-- V9: Review Intelligence table
-- Stores evidence-based dish/cuisine data extracted from Google Reviews
-- via Claude Haiku batch pipeline (weekly). Enables dish-level matching
-- that menu_highlights (AI-predicted from cuisine type) cannot provide.

CREATE TABLE IF NOT EXISTS restaurant_review_intelligence (
  restaurant_id  uuid PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,

  -- Comprehensive dish/food catalog extracted from actual reviews
  dish_catalog       text[] DEFAULT '{}',    -- ALL dishes mentioned: ["deep dish pizza", "thin crust", "garlic bread"]
  popular_dishes     text[] DEFAULT '{}',    -- Mentioned 3+ times with positive context
  cuisine_signals    text[] DEFAULT '{}',    -- Cuisine types reviewers mention: ["Italian", "pizza", "Neapolitan"]

  -- Review-derived quality scores (0-10, from sentiment analysis of reviews)
  review_food_quality     numeric(3,1),  -- "How good is the food according to reviewers?"
  review_service_quality  numeric(3,1),  -- "How good is the service?"
  review_ambiance_quality numeric(3,1),  -- "How's the atmosphere?"
  review_value_score      numeric(3,1),  -- "Is it worth the price?"

  -- Full-text search vector for semantic matching
  review_search_vector    tsvector,      -- Built from dish_catalog + cuisine_signals + popular_dishes

  -- Review metadata
  review_count        integer DEFAULT 0,
  avg_review_rating   numeric(2,1),
  last_analyzed_at    timestamptz DEFAULT now(),
  analysis_version    integer DEFAULT 1
);

COMMENT ON TABLE restaurant_review_intelligence IS
  'V9: Evidence-based dish/cuisine intelligence extracted from Google Reviews via weekly Haiku batch pipeline';

COMMENT ON COLUMN restaurant_review_intelligence.dish_catalog IS
  'Every dish/food item mentioned in customer reviews — evidence-based, not AI-predicted';

COMMENT ON COLUMN restaurant_review_intelligence.popular_dishes IS
  'Dishes mentioned 3+ times with positive sentiment — high confidence menu items';

COMMENT ON COLUMN restaurant_review_intelligence.cuisine_signals IS
  'Cuisine types customers describe in reviews — self-healing for misclassified restaurants';

-- Full-text search index for dish/cuisine matching via ts_rank()
CREATE INDEX IF NOT EXISTS idx_ri_search
  ON restaurant_review_intelligence USING GIN (review_search_vector);

-- Array containment index for exact dish catalog matching
CREATE INDEX IF NOT EXISTS idx_ri_dishes
  ON restaurant_review_intelligence USING GIN (dish_catalog);

-- Array containment index for cuisine signals
CREATE INDEX IF NOT EXISTS idx_ri_cuisine_signals
  ON restaurant_review_intelligence USING GIN (cuisine_signals);

-- RPC for upserting review intelligence with tsvector generation
CREATE OR REPLACE FUNCTION upsert_review_intelligence(
  p_restaurant_id uuid,
  p_dish_catalog text[],
  p_popular_dishes text[],
  p_cuisine_signals text[],
  p_food_quality numeric,
  p_service_quality numeric,
  p_ambiance_quality numeric,
  p_value_score numeric,
  p_search_text text,
  p_review_count integer,
  p_avg_rating numeric,
  p_version integer
)
RETURNS void AS $$
BEGIN
  INSERT INTO restaurant_review_intelligence (
    restaurant_id, dish_catalog, popular_dishes, cuisine_signals,
    review_food_quality, review_service_quality, review_ambiance_quality, review_value_score,
    review_search_vector, review_count, avg_review_rating,
    last_analyzed_at, analysis_version
  ) VALUES (
    p_restaurant_id, p_dish_catalog, p_popular_dishes, p_cuisine_signals,
    p_food_quality, p_service_quality, p_ambiance_quality, p_value_score,
    to_tsvector('english', p_search_text), p_review_count, p_avg_rating,
    now(), p_version
  )
  ON CONFLICT (restaurant_id) DO UPDATE SET
    dish_catalog = EXCLUDED.dish_catalog,
    popular_dishes = EXCLUDED.popular_dishes,
    cuisine_signals = EXCLUDED.cuisine_signals,
    review_food_quality = EXCLUDED.review_food_quality,
    review_service_quality = EXCLUDED.review_service_quality,
    review_ambiance_quality = EXCLUDED.review_ambiance_quality,
    review_value_score = EXCLUDED.review_value_score,
    review_search_vector = EXCLUDED.review_search_vector,
    review_count = EXCLUDED.review_count,
    avg_review_rating = EXCLUDED.avg_review_rating,
    last_analyzed_at = EXCLUDED.last_analyzed_at,
    analysis_version = EXCLUDED.analysis_version;
END;
$$ LANGUAGE plpgsql;
