-- Rename donde_score to donde_match in pre_recommendations table
-- Changes semantics from 0-10 quality score to 60-99 match confidence percentage
ALTER TABLE pre_recommendations
  RENAME COLUMN donde_score TO donde_match;

-- Update the check constraint for the new percentage range
ALTER TABLE pre_recommendations
  DROP CONSTRAINT IF EXISTS pre_recommendations_donde_score_check;

ALTER TABLE pre_recommendations
  ADD CONSTRAINT pre_recommendations_donde_match_check
  CHECK (donde_match >= 60 AND donde_match <= 99);
