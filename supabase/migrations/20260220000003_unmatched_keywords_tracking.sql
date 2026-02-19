-- Continuous learning: track unmatched keywords from user queries
-- Enables intent-gap-analysis pipeline to identify missing INTENT_MAP entries

ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS unmatched_keywords text[];

-- GIN index for efficient aggregation of unmatched keywords
CREATE INDEX IF NOT EXISTS idx_user_queries_unmatched
  ON user_queries USING gin(unmatched_keywords)
  WHERE unmatched_keywords IS NOT NULL;
