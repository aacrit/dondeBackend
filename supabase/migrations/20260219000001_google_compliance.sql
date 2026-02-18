-- Google API Compliance Migration
-- Removes all Google-sourced data from persistent storage.
-- Per Google Maps Platform ToS Section 3.2.3, only place_id can be stored.
-- Review-derived data (AI summaries, sentiment) also removed per "no derivative works" clause.

-- Drop Google-sourced columns
ALTER TABLE restaurants
  DROP COLUMN IF EXISTS google_rating,
  DROP COLUMN IF EXISTS google_review_count,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS website,
  DROP COLUMN IF EXISTS hours_of_operation,
  DROP COLUMN IF EXISTS google_review_summary,
  DROP COLUMN IF EXISTS sentiment_breakdown,
  DROP COLUMN IF EXISTS sentiment_score,
  DROP COLUMN IF EXISTS has_red_flags,
  DROP COLUMN IF EXISTS review_last_fetched_at,
  DROP COLUMN IF EXISTS review_analysis_version;

-- Drop the partial index that referenced google_review_summary
DROP INDEX IF EXISTS idx_restaurants_review_summary_not_null;
