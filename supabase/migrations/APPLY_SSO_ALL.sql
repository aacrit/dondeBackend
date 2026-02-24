-- =============================================================
-- DondeAI SSO: Combined Migration Script
-- Run this in Supabase Dashboard > SQL Editor > New Query
-- =============================================================
-- Applies all 6 SSO migrations in order:
--   1. user_profiles table
--   2. user_searches table
--   3. user_favorites table
--   4. user_queries auth_user_id column
--   5. Auto-create profile trigger
--   6. link_anonymous_queries RPC
-- =============================================================

-- ---- 1. User Profiles ----
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  anonymous_user_id TEXT,
  preferences JSONB DEFAULT '{}',
  data_migrated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_anonymous_id
  ON user_profiles(anonymous_user_id) WHERE anonymous_user_id IS NOT NULL;

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can read own profile"
    ON user_profiles FOR SELECT USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own profile"
    ON user_profiles FOR UPDATE USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---- 2. User Searches ----
CREATE TABLE IF NOT EXISTS user_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  craving TEXT,
  occasion TEXT,
  neighborhood TEXT,
  price_level TEXT,
  dietary_restrictions TEXT[],
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,
  restaurant_name TEXT,
  cuisine_type TEXT,
  donde_match INTEGER,
  result_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_searches_user
  ON user_searches(user_id, created_at DESC);

ALTER TABLE user_searches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can read own searches"
    ON user_searches FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert own searches"
    ON user_searches FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete own searches"
    ON user_searches FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---- 3. User Favorites ----
CREATE TABLE IF NOT EXISTS user_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES restaurants(id) ON DELETE SET NULL,
  restaurant_name TEXT,
  cuisine_type TEXT,
  neighborhood_name TEXT,
  price_level TEXT,
  google_place_id TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, restaurant_id)
);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user
  ON user_favorites(user_id, created_at DESC);

ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can read own favorites"
    ON user_favorites FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert own favorites"
    ON user_favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete own favorites"
    ON user_favorites FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ---- 4. Link user_queries to auth users ----
ALTER TABLE user_queries ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_queries_auth_user
  ON user_queries(auth_user_id) WHERE auth_user_id IS NOT NULL;


-- ---- 5. Auto-create profile on signup ----
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ---- 6. Link anonymous queries RPC ----
CREATE OR REPLACE FUNCTION link_anonymous_queries(p_auth_user_id UUID, p_anonymous_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE user_queries
  SET auth_user_id = p_auth_user_id
  WHERE user_id = p_anonymous_id
    AND auth_user_id IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- =============================================================
-- Done! All SSO tables, policies, triggers, and RPCs are ready.
-- =============================================================
