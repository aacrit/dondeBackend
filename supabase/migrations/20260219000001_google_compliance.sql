-- Google API Compliance Migration
-- Removes all Google-sourced data from persistent storage.
-- Per Google Maps Platform ToS Section 3.2.3, only place_id can be stored.
-- Review-derived data (AI summaries, sentiment) also removed per "no derivative works" clause.

-- Drop legacy triggers and views that depend on columns being removed
DROP TRIGGER IF EXISTS trigger_update_sentiment_score ON restaurants;
DROP VIEW IF EXISTS restaurants_needing_review_update;

-- Drop Google-sourced columns (CASCADE removes any remaining dependents)
ALTER TABLE restaurants
  DROP COLUMN IF EXISTS google_rating CASCADE,
  DROP COLUMN IF EXISTS google_review_count CASCADE,
  DROP COLUMN IF EXISTS phone CASCADE,
  DROP COLUMN IF EXISTS website CASCADE,
  DROP COLUMN IF EXISTS hours_of_operation CASCADE,
  DROP COLUMN IF EXISTS google_review_summary CASCADE,
  DROP COLUMN IF EXISTS sentiment_breakdown CASCADE,
  DROP COLUMN IF EXISTS sentiment_score CASCADE,
  DROP COLUMN IF EXISTS has_red_flags CASCADE,
  DROP COLUMN IF EXISTS review_last_fetched_at CASCADE,
  DROP COLUMN IF EXISTS review_analysis_version CASCADE;

-- Drop partial indexes that referenced dropped columns (may already be gone via CASCADE)
DROP INDEX IF EXISTS idx_restaurants_review_summary_not_null;
DROP INDEX IF EXISTS idx_restaurants_needs_review_summary;
DROP INDEX IF EXISTS idx_restaurants_needs_sentiment;

-- Drop any remaining legacy functions that referenced dropped columns
DROP FUNCTION IF EXISTS update_sentiment_score() CASCADE;
