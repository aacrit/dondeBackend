-- Security Hardening Migration
-- Fixes: permissive RLS on user_visits, unauth'd maintenance_requests INSERT,
-- and missing SET search_path on all SECURITY DEFINER functions.

-- ================================================================
-- 1. user_visits: Fix overly permissive "Read own visits" policy
--    The OR user_id IS NOT NULL clause makes the policy always true
--    for any row with a non-null user_id — effectively public read.
-- ================================================================
DROP POLICY IF EXISTS "Read own visits" ON user_visits;

-- New policy: user can only SELECT rows matching their own identity.
-- Anonymous clients (localStorage UUID) pass user_id as a query filter;
-- the JWT sub claim check handles authenticated users.
-- PostgREST sets request.jwt.claim.sub from the JWT.
CREATE POLICY "Read own visits (restricted)" ON user_visits
  FOR SELECT USING (
    user_id = current_setting('request.jwt.claim.sub', true)
    OR auth.uid()::text = user_id
  );

-- ================================================================
-- 2. maintenance_requests: Restrict INSERT to authenticated users only
--    Previously any anon could trigger pipeline operations.
-- ================================================================
DROP POLICY IF EXISTS "Anon insert maintenance_requests (constrained)" ON maintenance_requests;

CREATE POLICY "Authenticated insert maintenance_requests" ON maintenance_requests
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
    AND operation IS NOT NULL
    AND length(trim(operation)) > 0
    AND status = 'pending'
  );

-- ================================================================
-- 3. Add SET search_path = public to all SECURITY DEFINER functions
--    Prevents search_path injection attacks (CWE-426).
--    Using ALTER FUNCTION to avoid recreating large function bodies.
-- ================================================================

-- handle_new_user() — trigger function for auto-creating user profiles
ALTER FUNCTION handle_new_user() SET search_path = public;

-- link_anonymous_queries(UUID, TEXT) — links anon queries to auth user
ALTER FUNCTION link_anonymous_queries(UUID, TEXT) SET search_path = public;

-- link_anonymous_visits(UUID, TEXT) — links anon visits to auth user
ALTER FUNCTION link_anonymous_visits(UUID, TEXT) SET search_path = public;

-- get_cache_dashboard() — returns cache health metrics
ALTER FUNCTION get_cache_dashboard() SET search_path = public;

-- compute_taste_profile(UUID) — builds user taste profile
ALTER FUNCTION compute_taste_profile(UUID) SET search_path = public;

-- get_taste_dna(UUID) — returns formatted taste DNA profile
ALTER FUNCTION get_taste_dna(UUID) SET search_path = public;

-- blend_taste_profiles(UUID[]) — blends multiple user profiles for group dining
ALTER FUNCTION blend_taste_profiles(UUID[]) SET search_path = public;

-- get_neighborhood_pulse(TEXT, TEXT, INTEGER) — ambient city intelligence
ALTER FUNCTION get_neighborhood_pulse(TEXT, TEXT, INTEGER) SET search_path = public;
