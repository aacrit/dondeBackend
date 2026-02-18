-- Migration: Add indexes for recommendation engine query patterns

-- Recommendation engine filters by neighborhood
CREATE INDEX IF NOT EXISTS idx_restaurants_neighborhood
  ON restaurants(neighborhood_id);

-- Recommendation engine requires google_review_summary IS NOT NULL
CREATE INDEX IF NOT EXISTS idx_restaurants_review_summary_not_null
  ON restaurants(id)
  WHERE google_review_summary IS NOT NULL;

-- Occasion scores looked up by restaurant_id
CREATE INDEX IF NOT EXISTS idx_occasion_scores_restaurant
  ON occasion_scores(restaurant_id);

-- Tags looked up by restaurant_id
CREATE INDEX IF NOT EXISTS idx_tags_restaurant
  ON tags(restaurant_id);

-- Pipeline: enrichment finds restaurants needing enrichment
CREATE INDEX IF NOT EXISTS idx_restaurants_needs_enrichment
  ON restaurants(id)
  WHERE noise_level IS NULL;

-- Pipeline: review summarization finds restaurants without summaries
CREATE INDEX IF NOT EXISTS idx_restaurants_needs_review_summary
  ON restaurants(id)
  WHERE google_review_summary IS NULL;

-- Pipeline: sentiment analysis finds restaurants without sentiment
CREATE INDEX IF NOT EXISTS idx_restaurants_needs_sentiment
  ON restaurants(id)
  WHERE sentiment_breakdown IS NULL;

-- Discovery pipeline: prevent duplicate google_place_id inserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_google_place_id
  ON restaurants(google_place_id)
  WHERE google_place_id IS NOT NULL;

-- Analytics: user queries by time
CREATE INDEX IF NOT EXISTS idx_user_queries_created
  ON user_queries(created_at DESC);
