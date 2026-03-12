-- Add score fit and blurb quality grading columns to user_queries
-- Mirrors gauntlet_results grading for live production monitoring

ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS score_fit_score INT;
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS score_fit_grade TEXT;
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS blurb_quality_score INT;
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS blurb_quality_grade TEXT;
