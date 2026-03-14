-- ============================================================================
-- DondeCache: Persistent Query Cache + Pre-Warming
-- ============================================================================

-- Table: query_cache — stores quality-gated recommendation responses
CREATE TABLE IF NOT EXISTS query_cache (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key             text UNIQUE NOT NULL,
  intent_fingerprint    text NOT NULL,
  canonical_form        text NOT NULL,
  special_request       text NOT NULL,
  occasion              text DEFAULT 'Any',
  neighborhood          text DEFAULT 'Anywhere',
  price_level           text DEFAULT 'Any',
  response_body         jsonb NOT NULL,
  ranked_queue          jsonb,
  primary_restaurant_id uuid REFERENCES restaurants(id),
  donde_match           integer,
  score_fit_score       integer NOT NULL,
  blurb_quality_score   integer NOT NULL,
  hit_count             integer DEFAULT 0,
  last_hit_at           timestamptz,
  source                text DEFAULT 'organic',
  engine_version        text DEFAULT '11.0.0',
  expires_at            timestamptz NOT NULL,
  created_at            timestamptz DEFAULT now(),

  -- Quality gate: only B-/80+ entries allowed
  CONSTRAINT chk_score_fit_min CHECK (score_fit_score >= 80),
  CONSTRAINT chk_blurb_quality_min CHECK (blurb_quality_score >= 80)
);

-- Indexes for multi-level lookup
CREATE INDEX IF NOT EXISTS idx_query_cache_fingerprint ON query_cache (intent_fingerprint);
CREATE INDEX IF NOT EXISTS idx_query_cache_canonical ON query_cache (canonical_form);
CREATE INDEX IF NOT EXISTS idx_query_cache_expires ON query_cache (expires_at);
CREATE INDEX IF NOT EXISTS idx_query_cache_restaurant ON query_cache (primary_restaurant_id);
CREATE INDEX IF NOT EXISTS idx_query_cache_hit_count ON query_cache (hit_count DESC);

-- Table: warming_runs — tracks pre-warming pipeline executions
CREATE TABLE IF NOT EXISTS warming_runs (
  run_id            text PRIMARY KEY,
  mode              text NOT NULL,
  budget_dollars    numeric(6,2) NOT NULL,
  budget_used       numeric(6,2) DEFAULT 0,
  total_queries     integer DEFAULT 0,
  cached_count      integer DEFAULT 0,
  skipped_count     integer DEFAULT 0,
  failed_count      integer DEFAULT 0,
  avg_donde_match   numeric(4,1),
  avg_score_fit     numeric(4,1),
  avg_blurb_quality numeric(4,1),
  started_at        timestamptz DEFAULT now(),
  completed_at      timestamptz
);

-- Add cache_hit tracking columns to user_queries
ALTER TABLE user_queries
  ADD COLUMN IF NOT EXISTS cache_hit boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cache_hit_level integer;

-- ============================================================================
-- RPC: get_cache_dashboard() — returns cache health metrics for CEO dashboard
-- ============================================================================
CREATE OR REPLACE FUNCTION get_cache_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  v_cache_size integer;
  v_total_24h integer;
  v_hits_24h integer;
  v_hit_rate numeric;
  v_savings numeric;
  v_avg_hit_latency numeric;
  v_avg_miss_latency numeric;
  v_top_uncached jsonb;
  v_last_warming jsonb;
BEGIN
  -- Active cache entries (not expired)
  SELECT count(*) INTO v_cache_size
  FROM query_cache WHERE expires_at > now();

  -- Hit rate from user_queries (last 24h)
  SELECT count(*) INTO v_total_24h
  FROM user_queries WHERE created_at > now() - interval '24 hours';

  SELECT count(*) INTO v_hits_24h
  FROM user_queries WHERE created_at > now() - interval '24 hours' AND cache_hit = true;

  v_hit_rate := CASE WHEN v_total_24h > 0 THEN round((v_hits_24h::numeric / v_total_24h) * 100, 1) ELSE 0 END;
  v_savings := round(v_hits_24h * 0.074, 2);

  -- Avg latency for hits vs misses
  SELECT round(avg(response_time_ms), 0) INTO v_avg_hit_latency
  FROM user_queries WHERE created_at > now() - interval '24 hours' AND cache_hit = true;

  SELECT round(avg(response_time_ms), 0) INTO v_avg_miss_latency
  FROM user_queries WHERE created_at > now() - interval '24 hours' AND (cache_hit = false OR cache_hit IS NULL);

  -- Top 10 uncached queries (most repeated queries not in cache)
  SELECT coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_uncached
  FROM (
    SELECT special_request, count(*) as frequency
    FROM user_queries
    WHERE created_at > now() - interval '30 days'
      AND (cache_hit = false OR cache_hit IS NULL)
      AND special_request IS NOT NULL
      AND length(special_request) > 2
    GROUP BY special_request
    HAVING count(*) >= 2
    ORDER BY count(*) DESC
    LIMIT 10
  ) t;

  -- Last warming run
  SELECT row_to_json(w)::jsonb INTO v_last_warming
  FROM (
    SELECT run_id, mode, budget_used, total_queries, cached_count, failed_count,
           avg_donde_match, avg_score_fit, avg_blurb_quality, started_at, completed_at
    FROM warming_runs
    ORDER BY started_at DESC
    LIMIT 1
  ) w;

  result := jsonb_build_object(
    'cache_size', v_cache_size,
    'total_queries_24h', v_total_24h,
    'cache_hits_24h', v_hits_24h,
    'hit_rate_24h', v_hit_rate,
    'savings_24h_dollars', v_savings,
    'avg_hit_latency_ms', coalesce(v_avg_hit_latency, 0),
    'avg_miss_latency_ms', coalesce(v_avg_miss_latency, 0),
    'top_uncached_queries', v_top_uncached,
    'last_warming_run', v_last_warming
  );

  RETURN result;
END;
$$;

-- ============================================================================
-- Trigger: Invalidate cache when restaurant data changes
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_invalidate_cache_restaurant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only invalidate if relevant fields changed
  IF OLD.name IS DISTINCT FROM NEW.name
     OR OLD.cuisine_type IS DISTINCT FROM NEW.cuisine_type
     OR OLD.is_active IS DISTINCT FROM NEW.is_active
     OR OLD.price_level IS DISTINCT FROM NEW.price_level
     OR OLD.neighborhood_id IS DISTINCT FROM NEW.neighborhood_id
  THEN
    DELETE FROM query_cache WHERE primary_restaurant_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_cache_restaurant ON restaurants;
CREATE TRIGGER trg_invalidate_cache_restaurant
  AFTER UPDATE ON restaurants
  FOR EACH ROW
  EXECUTE FUNCTION fn_invalidate_cache_restaurant();

-- ============================================================================
-- Trigger: Invalidate cache when deep profile enrichment changes
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_invalidate_cache_enrichment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.enrichment_version IS DISTINCT FROM NEW.enrichment_version THEN
    DELETE FROM query_cache
    WHERE primary_restaurant_id = NEW.restaurant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_cache_enrichment ON restaurant_deep_profiles;
CREATE TRIGGER trg_invalidate_cache_enrichment
  AFTER UPDATE ON restaurant_deep_profiles
  FOR EACH ROW
  EXECUTE FUNCTION fn_invalidate_cache_enrichment();

-- ============================================================================
-- RLS policies for query_cache
-- ============================================================================
ALTER TABLE query_cache ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "service_role_full_access" ON query_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Anon can read cache (for Edge Function cache lookups)
CREATE POLICY "anon_read_cache" ON query_cache
  FOR SELECT TO anon USING (true);

-- RLS for warming_runs
ALTER TABLE warming_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_warming_runs" ON warming_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_warming_runs" ON warming_runs
  FOR SELECT TO anon USING (true);
