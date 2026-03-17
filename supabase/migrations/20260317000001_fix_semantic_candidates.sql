-- Fix semantic_candidates RPC: r.neighborhood_name → r.neighborhood_id
-- The restaurants table uses neighborhood_id (integer FK), not neighborhood_name (text).
-- Join through neighborhoods table to match by name.

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
  LEFT JOIN neighborhoods n ON n.id = r.neighborhood_id
  WHERE (r.is_active IS NULL OR r.is_active = true)
    AND 1 - (re.embedding <=> p_query_embedding) > p_threshold
    AND (p_neighborhood IS NULL OR n.name = p_neighborhood)
  ORDER BY re.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;
