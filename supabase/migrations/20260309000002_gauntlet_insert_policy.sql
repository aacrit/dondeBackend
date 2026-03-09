-- Allow Command Center (anon) to insert gauntlet runs and results
-- The existing migration only created SELECT policies

CREATE POLICY "anon_insert_runs" ON gauntlet_runs FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_insert_results" ON gauntlet_results FOR INSERT WITH CHECK (true);
