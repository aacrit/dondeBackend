-- Fix: user_queries table has critical schema issues:
-- 1. id column has no DEFAULT gen_random_uuid(), so all inserts fail silently
-- 2. user_id and dietary_restrictions columns are missing
-- 3. anon role lacks GRANT SELECT
-- 4. All of this means the table is always empty

-- Fix id column: add DEFAULT gen_random_uuid()
ALTER TABLE user_queries ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Add missing columns that the Edge Function tries to insert
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS dietary_restrictions TEXT[];
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS feedback TEXT;

-- Grant access to anon and authenticated roles
GRANT SELECT ON user_queries TO anon;
GRANT SELECT ON user_queries TO authenticated;

-- Drop the ambiguously-named policy and recreate with clear naming
DROP POLICY IF EXISTS "Service role can read all queries" ON user_queries;
DROP POLICY IF EXISTS "anon_read_user_queries" ON user_queries;
CREATE POLICY "anon_read_user_queries" ON user_queries
  FOR SELECT USING (true);
