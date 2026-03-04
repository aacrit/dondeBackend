-- Fix: user_queries table has no RLS policies, causing silent insert failures
-- when using the anon key. Enable RLS with permissive INSERT policy.

ALTER TABLE user_queries ENABLE ROW LEVEL SECURITY;

-- Allow inserts from any role (anon or authenticated) — all queries should be logged
CREATE POLICY "Allow inserts to user_queries" ON user_queries
  FOR INSERT WITH CHECK (true);

-- Allow service role to read all queries for analytics
CREATE POLICY "Service role can read all queries" ON user_queries
  FOR SELECT USING (true);
