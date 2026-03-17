-- ============================================================================
-- pgvector Embeddings: Semantic Retrieval for Restaurant Recommendations
-- ============================================================================
-- Adds vector embedding tables for restaurants and queries, enabling
-- approximate nearest neighbor search via pgvector's HNSW index.
--
-- New tables:
--   restaurant_embeddings — 384-dim vectors per restaurant (all-MiniLM-L6-v2)
--   query_embeddings      — cached query vectors for common searches
--
-- New function:
--   semantic_candidates() — ANN search with optional neighborhood filter
--
-- See also: scripts/pipelines/generate-embeddings.ts (embedding pipeline)
-- ============================================================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Restaurant embeddings table
CREATE TABLE restaurant_embeddings (
  restaurant_id UUID PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  embedding vector(384),  -- all-MiniLM-L6-v2 output dimension
  text_hash TEXT,          -- MD5 of source text for staleness detection
  model_version TEXT DEFAULT 'all-MiniLM-L6-v2',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- HNSW index for approximate nearest neighbor search
CREATE INDEX idx_restaurant_embeddings_hnsw
  ON restaurant_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Query embedding cache (pre-computed for common queries)
CREATE TABLE query_embeddings (
  query_hash TEXT PRIMARY KEY,
  canonical_query TEXT NOT NULL,
  embedding vector(384),
  model_version TEXT DEFAULT 'all-MiniLM-L6-v2',
  hit_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_query_embeddings_hnsw
  ON query_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Semantic candidate search function
CREATE OR REPLACE FUNCTION semantic_candidates(
  p_query_embedding vector(384),
  p_neighborhood TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_threshold FLOAT DEFAULT 0.3
)
RETURNS TABLE (restaurant_id UUID, similarity FLOAT, restaurant_name TEXT)
LANGUAGE sql STABLE
AS $$
  SELECT re.restaurant_id,
         1 - (re.embedding <=> p_query_embedding) AS similarity,
         r.name AS restaurant_name
  FROM restaurant_embeddings re
  JOIN restaurants r ON r.id = re.restaurant_id
  WHERE (r.is_active IS NULL OR r.is_active = true)
    AND 1 - (re.embedding <=> p_query_embedding) > p_threshold
    AND (p_neighborhood IS NULL OR r.neighborhood_name = p_neighborhood)
  ORDER BY re.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

-- RLS policies
ALTER TABLE restaurant_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon read restaurant_embeddings" ON restaurant_embeddings FOR SELECT USING (true);
CREATE POLICY "Service role manage restaurant_embeddings" ON restaurant_embeddings FOR ALL USING (true);
CREATE POLICY "Anon read query_embeddings" ON query_embeddings FOR SELECT USING (true);
CREATE POLICY "Service role manage query_embeddings" ON query_embeddings FOR ALL USING (true);
