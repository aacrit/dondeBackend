-- Learning Flywheel Phase 1: Add shadow_personalization_boost column to user_queries
-- This column logs what the personalization boost WOULD have been (shadow mode).
-- Column is nullable — NULL means no taste profile or insufficient data.

ALTER TABLE user_queries
  ADD COLUMN IF NOT EXISTS shadow_personalization_boost NUMERIC(4,2);

COMMENT ON COLUMN user_queries.shadow_personalization_boost IS
  'Learning Flywheel Phase 1: shadow-mode personalization boost that WOULD have been applied. Range -5 to +5. NULL = no taste profile.';
