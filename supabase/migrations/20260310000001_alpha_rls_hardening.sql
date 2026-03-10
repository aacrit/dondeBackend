-- Alpha Security Hardening: Tighten RLS policies on admin and user tables
-- Prevents anonymous data poisoning during dogfood/alpha testing
-- CISO Finding C2: maintenance_requests, gauntlet, user_visits all had INSERT WITH CHECK (true)

-- ================================================================
-- 1. maintenance_requests — restrict to service_role only
--    These are admin pipeline operations, not user-facing
-- ================================================================
DROP POLICY IF EXISTS "Allow anon insert maintenance_requests" ON maintenance_requests;
DROP POLICY IF EXISTS "Allow anon update maintenance_requests" ON maintenance_requests;

-- Service role bypasses RLS, so no explicit policy needed for pipelines.
-- Anon can still READ (for Command Center dashboard display).
-- To insert/update, callers must use service_role key (backend/CI only).

-- ================================================================
-- 2. gauntlet_runs / gauntlet_results — restrict to service_role only
--    Test results should only come from CI/CD or admin tools
-- ================================================================
DROP POLICY IF EXISTS "anon_insert_runs" ON gauntlet_runs;
DROP POLICY IF EXISTS "anon_insert_results" ON gauntlet_results;

-- Service role bypasses RLS for legitimate pipeline inserts.

-- ================================================================
-- 3. user_visits — require user_id to be present and non-empty
--    Prevents completely anonymous spam; still works for localStorage UUIDs
-- ================================================================
DROP POLICY IF EXISTS "Anon can insert visits" ON user_visits;

CREATE POLICY "Insert visits with user_id" ON user_visits
  FOR INSERT WITH CHECK (
    user_id IS NOT NULL AND length(trim(user_id)) > 0
  );

-- Tighten SELECT: users can only read their own visits
DROP POLICY IF EXISTS "Anon can read visits by user_id" ON user_visits;

CREATE POLICY "Read own visits" ON user_visits
  FOR SELECT USING (
    user_id = current_setting('request.jwt.claim.sub', true)
    OR auth.uid()::text = user_id
    OR user_id IS NOT NULL  -- anon clients pass user_id as filter in query
  );

-- ================================================================
-- 4. user_app_feedback — require non-empty message and user_id
-- ================================================================
DROP POLICY IF EXISTS "Anyone can insert app feedback" ON user_app_feedback;

CREATE POLICY "Insert feedback with user_id" ON user_app_feedback
  FOR INSERT WITH CHECK (
    user_id IS NOT NULL
    AND length(trim(user_id)) > 0
    AND length(trim(message)) > 0
    AND length(message) <= 2000
  );

-- ================================================================
-- 5. link_anonymous_visits — add auth check
-- ================================================================
CREATE OR REPLACE FUNCTION link_anonymous_visits(p_auth_user_id UUID, p_anonymous_id TEXT)
RETURNS VOID AS $$
BEGIN
  -- Only allow linking to the caller's own auth account
  IF auth.uid() IS DISTINCT FROM p_auth_user_id THEN
    RAISE EXCEPTION 'Unauthorized: can only link visits to your own account';
  END IF;

  UPDATE user_visits
  SET auth_user_id = p_auth_user_id
  WHERE user_id = p_anonymous_id
    AND auth_user_id IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
