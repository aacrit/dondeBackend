-- Gauntlet Run History & Improvement Tracking
-- Stores test runs and per-query results for historical comparison

-- ─── gauntlet_runs: one row per test run ────────────────────────────────────

CREATE TABLE gauntlet_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  dataset_hash TEXT NOT NULL,
  dataset_size INT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'full',
  atlas_version TEXT,

  -- Denormalized summary
  total INT NOT NULL,
  successful INT NOT NULL,
  passed_60 INT NOT NULL,
  passed_80 INT NOT NULL,
  passed_90 INT NOT NULL DEFAULT 0,
  avg_dm NUMERIC(5,1) NOT NULL,
  gap_count INT NOT NULL,
  avg_response_ms INT DEFAULT 0,

  -- Breakdown (JSONB)
  category_stats JSONB,
  gap_type_stats JSONB,
  factor_averages JSONB,

  -- Delta vs previous comparable run
  prev_run_id TEXT,
  delta_avg_dm NUMERIC(5,1),
  delta_passed_60 INT,
  delta_gap_count INT,

  notes TEXT
);

CREATE INDEX idx_gauntlet_runs_dataset ON gauntlet_runs(dataset_hash, created_at DESC);
CREATE INDEX idx_gauntlet_runs_created ON gauntlet_runs(created_at DESC);

-- ─── gauntlet_results: one row per query per run ────────────────────────────

CREATE TABLE gauntlet_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL REFERENCES gauntlet_runs(run_id) ON DELETE CASCADE,
  query_id TEXT NOT NULL,
  query TEXT NOT NULL,
  tier INT,
  category TEXT,

  donde_match INT NOT NULL,
  relevance_type TEXT,
  food NUMERIC(3,1),
  vibe NUMERIC(3,1),
  service NUMERIC(3,1),
  reputation NUMERIC(3,1),
  convenience NUMERIC(3,1),
  response_time_ms INT,

  score_pass BOOLEAN,
  gap_type TEXT,
  gap_severity TEXT,
  restaurant_name TEXT,

  prev_dm INT,
  delta_dm INT,

  UNIQUE(run_id, query_id)
);

CREATE INDEX idx_gauntlet_results_run ON gauntlet_results(run_id);
CREATE INDEX idx_gauntlet_results_query ON gauntlet_results(query_id, run_id);

-- ─── RPCs ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_run_comparison(p_run_a TEXT, p_run_b TEXT)
RETURNS TABLE(
  query_id TEXT, query TEXT, category TEXT,
  dm_a INT, dm_b INT, delta INT,
  gap_a TEXT, gap_b TEXT,
  restaurant_a TEXT, restaurant_b TEXT
) LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(a.query_id, b.query_id),
    COALESCE(a.query, b.query),
    COALESCE(a.category, b.category),
    a.donde_match, b.donde_match,
    COALESCE(b.donde_match, 0) - COALESCE(a.donde_match, 0),
    a.gap_type, b.gap_type,
    a.restaurant_name, b.restaurant_name
  FROM gauntlet_results a
  FULL OUTER JOIN gauntlet_results b ON a.query_id = b.query_id AND b.run_id = p_run_b
  WHERE a.run_id = p_run_a OR b.run_id = p_run_b
  ORDER BY COALESCE(b.donde_match, 0) - COALESCE(a.donde_match, 0);
$$;

CREATE OR REPLACE FUNCTION get_query_history(p_query_id TEXT)
RETURNS TABLE(
  run_id TEXT, created_at TIMESTAMPTZ, donde_match INT,
  gap_type TEXT, restaurant_name TEXT
) LANGUAGE sql STABLE AS $$
  SELECT r.run_id, gr.created_at, r.donde_match, r.gap_type, r.restaurant_name
  FROM gauntlet_results r
  JOIN gauntlet_runs gr ON gr.run_id = r.run_id
  WHERE r.query_id = p_query_id
  ORDER BY gr.created_at;
$$;

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE gauntlet_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gauntlet_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_runs" ON gauntlet_runs FOR SELECT USING (true);
CREATE POLICY "anon_read_results" ON gauntlet_results FOR SELECT USING (true);
