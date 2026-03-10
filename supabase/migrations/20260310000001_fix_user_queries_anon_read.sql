-- Fix: Command Center Live tab shows 0 queries because anon role
-- cannot SELECT from user_queries. The existing policy
-- "Service role can read all queries" may not grant anon access
-- despite USING(true), because the table may lack GRANT SELECT for anon.
--
-- Pattern follows gauntlet_tracking.sql which works correctly.

GRANT SELECT ON user_queries TO anon;
GRANT SELECT ON user_queries TO authenticated;

-- Drop the ambiguously-named policy and recreate with clear naming
DROP POLICY IF EXISTS "Service role can read all queries" ON user_queries;
CREATE POLICY "anon_read_user_queries" ON user_queries
  FOR SELECT USING (true);
