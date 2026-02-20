-- Migration: Add unique constraint on occasion_scores.restaurant_id
-- Required for upsert operations in regenerate-occasion-scores pipeline

-- Step 1: Remove duplicate restaurant_id rows (keep the most recently created one)
DELETE FROM occasion_scores a
  USING occasion_scores b
  WHERE a.restaurant_id = b.restaurant_id
    AND a.created_at < b.created_at;

-- Step 2: Handle exact timestamp ties (keep the row with the larger id)
DELETE FROM occasion_scores a
  USING occasion_scores b
  WHERE a.restaurant_id = b.restaurant_id
    AND a.created_at = b.created_at
    AND a.id < b.id;

-- Step 3: Add the unique constraint
ALTER TABLE occasion_scores
  ADD CONSTRAINT occasion_scores_restaurant_id_key UNIQUE (restaurant_id);
