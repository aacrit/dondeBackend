-- Migration: Link user_queries to authenticated users
-- ON DELETE SET NULL anonymizes analytics data rather than deleting it

ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Index for looking up authenticated user's query history
CREATE INDEX IF NOT EXISTS idx_user_queries_auth_user ON user_queries(auth_user_id) WHERE auth_user_id IS NOT NULL;
