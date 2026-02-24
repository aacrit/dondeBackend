-- Migration: User profiles table for SSO authentication
-- Extends auth.users with app-specific data

CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  anonymous_user_id TEXT,  -- links to legacy dondeai-user-id for data migration
  preferences JSONB DEFAULT '{}',  -- future: dietary prefs, favorite neighborhoods
  data_migrated_at TIMESTAMPTZ,  -- null until localStorage migration completed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for anonymous ID lookup during migration
CREATE INDEX IF NOT EXISTS idx_user_profiles_anonymous_id ON user_profiles(anonymous_user_id) WHERE anonymous_user_id IS NOT NULL;

-- RLS: users can only read and update their own profile
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id);
