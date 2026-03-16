-- Fix remaining 29 restaurants with NULL cuisine_type by backfilling
-- from restaurant_review_intelligence.cuisine_signals[1].
-- The scoring engine falls back to cuisine_signals when cuisine_type is NULL
-- (self-healing), but having a proper cuisine_type improves RPC filtering
-- and avoids the fallback overhead on every request.

UPDATE restaurants
SET cuisine_type = (
  SELECT cuisine_signals[1]
  FROM restaurant_review_intelligence
  WHERE restaurant_id = restaurants.id
)
WHERE cuisine_type IS NULL
  AND EXISTS (
    SELECT 1
    FROM restaurant_review_intelligence
    WHERE restaurant_id = restaurants.id
      AND cuisine_signals IS NOT NULL
      AND array_length(cuisine_signals, 1) > 0
  );
