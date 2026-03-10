-- Ensure anon role can read and insert gauntlet data
-- RLS policies existed but base GRANTs were missing, causing silent failures

GRANT SELECT, INSERT ON gauntlet_runs TO anon;
GRANT SELECT, INSERT ON gauntlet_runs TO authenticated;

GRANT SELECT, INSERT ON gauntlet_results TO anon;
GRANT SELECT, INSERT ON gauntlet_results TO authenticated;
