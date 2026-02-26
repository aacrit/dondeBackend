-- Migration: User visits ("I'm Going Here!") and app feedback tables
-- user_visits: tracks strong intent signal — user declares they're going to a restaurant
-- user_app_feedback: stores user-submitted app feedback (category + free text)

-- ================================================================
-- 1. user_visits table
-- ================================================================
CREATE TABLE IF NOT EXISTS user_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,                                    -- anonymous UUID (from localStorage)
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,
  restaurant_name TEXT,                            -- denormalized for display
  cuisine_type TEXT,
  neighborhood_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent duplicate visits for the same restaurant per anonymous user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_visits_unique_anon
  ON user_visits(user_id, restaurant_id) WHERE auth_user_id IS NULL;

-- Prevent duplicate visits for the same restaurant per authenticated user
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_visits_unique_auth
  ON user_visits(auth_user_id, restaurant_id) WHERE auth_user_id IS NOT NULL;

-- Lookup indexes
CREATE INDEX IF NOT EXISTS idx_user_visits_user
  ON user_visits(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_visits_auth
  ON user_visits(auth_user_id, created_at DESC) WHERE auth_user_id IS NOT NULL;

-- RLS
ALTER TABLE user_visits ENABLE ROW LEVEL SECURITY;

-- Anon insert/select (PostgREST with anon key)
CREATE POLICY "Anon can insert visits"
  ON user_visits FOR INSERT WITH CHECK (true);

CREATE POLICY "Anon can read visits by user_id"
  ON user_visits FOR SELECT USING (true);

-- ================================================================
-- 2. user_app_feedback table
-- ================================================================
CREATE TABLE IF NOT EXISTS user_app_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,                                    -- anonymous UUID
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  category TEXT NOT NULL,                          -- 'recommendation', 'experience', 'feature', 'restaurant_info', 'other'
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_app_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert app feedback"
  ON user_app_feedback FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can read own feedback"
  ON user_app_feedback FOR SELECT
  USING (auth.uid() = auth_user_id);

-- ================================================================
-- 3. RPC: Link anonymous visits to authenticated user on sign-in
-- ================================================================
CREATE OR REPLACE FUNCTION link_anonymous_visits(p_auth_user_id UUID, p_anonymous_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE user_visits
  SET auth_user_id = p_auth_user_id
  WHERE user_id = p_anonymous_id
    AND auth_user_id IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
