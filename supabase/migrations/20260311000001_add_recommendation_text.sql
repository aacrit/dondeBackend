-- Add recommendation_text column to persist blurb for quality auditing
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS recommendation_text text;
