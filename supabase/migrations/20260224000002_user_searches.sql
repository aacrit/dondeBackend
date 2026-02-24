-- Migration: User search history table
-- Replaces 3-item localStorage dondeai-history with unlimited server-side history

CREATE TABLE IF NOT EXISTS user_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  craving TEXT,
  occasion TEXT,
  neighborhood TEXT,
  price_level TEXT,
  dietary_restrictions TEXT[],
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,
  restaurant_name TEXT,  -- denormalized for display without JOIN
  cuisine_type TEXT,     -- denormalized for display
  donde_match INTEGER,
  result_snapshot JSONB,  -- minimal result data for re-display
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Primary lookup: user's searches by recency
CREATE INDEX IF NOT EXISTS idx_user_searches_user ON user_searches(user_id, created_at DESC);

-- RLS: users can only access their own searches
ALTER TABLE user_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own searches"
  ON user_searches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own searches"
  ON user_searches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own searches"
  ON user_searches FOR DELETE
  USING (auth.uid() = user_id);
