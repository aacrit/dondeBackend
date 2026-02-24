-- Migration: RPC to link anonymous user_queries to an authenticated user
-- Called once during data migration when user first signs in

CREATE OR REPLACE FUNCTION link_anonymous_queries(p_auth_user_id UUID, p_anonymous_id TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE user_queries
  SET auth_user_id = p_auth_user_id
  WHERE user_id = p_anonymous_id
    AND auth_user_id IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
