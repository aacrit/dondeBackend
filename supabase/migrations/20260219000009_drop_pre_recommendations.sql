-- Drop pre_recommendations table
-- Pre-generated recommendations removed in favor of live Claude calls for all requests.
-- This improves recommendation quality by using real-time Google reviews and user-specific context.

DROP TABLE IF EXISTS pre_recommendations;
