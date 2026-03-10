-- Add source column to user_queries to distinguish test traffic from production
-- 'website' = production user queries (default)
-- 'command-center' = test queries from the admin dashboard
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'website';

-- Index for filtering by source in analytics
CREATE INDEX IF NOT EXISTS idx_user_queries_source ON user_queries(source) WHERE source IS NOT NULL;
