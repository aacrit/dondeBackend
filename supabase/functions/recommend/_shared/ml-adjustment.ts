/**
 * ML Adjustment Layer — Targeted Boost (Version Alpha)
 *
 * Boost-only strategy from boost-table.json — teacher-validated per-query
 * boosts (+3) and cross-query consistent winner boosts (+1).
 * V24: Reduced from +5/+2 to +3/+1 to prevent score inflation when
 * combined with decompression. 0% regression risk (never penalizes).
 *
 * Performance: boost table loaded once at module init (Edge Function cold start).
 * Lookup is O(1) per restaurant — no measurable request latency impact.
 */

// ============================================================================
// TYPES
// ============================================================================

interface BoostTable {
  version: string;
  // Per-query boosts: teacher's top-5 validated picks per query pattern
  query_boosts: Record<string, string[]>;  // canonical_query → [restaurant_id, ...]
  // Cross-query winners: restaurants that consistently rank highly across many queries
  consistent_winners: Record<string, { name: string; avg_score: number; appearances: number }>;
  // Boost amounts
  direct_boost: number;   // +5 for teacher-validated picks
  winner_boost: number;   // +2 for consistent winners
}

// ============================================================================
// BOOST TABLE LOADING — runs once at module initialization (cold start)
// ============================================================================

let boostTable: BoostTable | null = null;

try {
  const boostData = await import("./boost-table.json", { assert: { type: "json" } });
  boostTable = boostData.default as unknown as BoostTable;
} catch {
  // No boost table available — targeted boost disabled
  boostTable = null;
}

// ============================================================================
// TARGETED BOOST
// ============================================================================

/**
 * Compute targeted boost for a restaurant based on teacher-validated data.
 *
 * Strategy 1: Direct teacher boost (+3) — If this restaurant was in teacher's
 *   top-5 for a matching query pattern.
 * Strategy 2: Cross-query winner boost (+1) — If this restaurant is a
 *   consistent winner across many teacher rankings.
 *
 * Returns 0 if no boost applies. NEVER penalizes (boost-only strategy).
 *
 * @param restaurantId - UUID of the restaurant
 * @param queryFingerprint - Canonical form of the query (from computeCanonicalForm)
 * @param queryText - Raw query text for fuzzy matching
 * @returns Boost amount (0, 1, or 3)
 */
export function computeTargetedBoost(
  restaurantId: string,
  queryFingerprint: string,
  queryText: string,
  restaurantCuisineType?: string | null,
  targetCuisines?: string[] | null,
): number {
  if (!boostTable) return 0;

  // V20: Cuisine gate — when query has target_cuisines, skip boost for wrong cuisine.
  // Prevents feedback loop where wrong-cuisine picks get locked in via teacher validation.
  if (targetCuisines?.length && restaurantCuisineType) {
    const restCuisine = restaurantCuisineType.toLowerCase();
    const cuisineMatch = targetCuisines.some(tc => {
      const tl = tc.toLowerCase();
      return restCuisine.includes(tl) || tl.includes(restCuisine);
    });
    if (!cuisineMatch) {
      return 0; // Wrong cuisine — skip boost entirely
    }
  }

  // Strategy 1: Direct teacher boost (+3, reduced from +5 in V24)
  // If this restaurant was in teacher's top-5 for a matching query
  const directBoostIds = boostTable.query_boosts[queryFingerprint] || [];
  if (directBoostIds.includes(restaurantId)) {
    return Math.min(boostTable.direct_boost || 3, 3);
  }

  // Also try normalized query text as key (lowercase, trimmed)
  const normalizedQuery = queryText.toLowerCase().trim();
  const altBoostIds = boostTable.query_boosts[normalizedQuery] || [];
  if (altBoostIds.includes(restaurantId)) {
    return Math.min(boostTable.direct_boost || 3, 3);
  }

  // Strategy 2: Cross-query winner boost (+1, reduced from +2 in V24)
  // If this restaurant is a consistent winner across many teacher rankings
  if (restaurantId in (boostTable.consistent_winners || {})) {
    return Math.min(boostTable.winner_boost || 1, 1);
  }

  // No boost — never penalize (boost-only strategy)
  return 0;
}

/**
 * Check whether a boost table is loaded.
 */
export function isBoostTableLoaded(): boolean {
  return boostTable !== null;
}

/**
 * Check whether ML scoring is available (boost table loaded).
 * Kept for backwards compatibility with index.ts import.
 */
export function isMLModelLoaded(): boolean {
  return boostTable !== null;
}

/**
 * Get boost table metadata for diagnostics.
 */
export function getBoostTableInfo(): { version: string; queryCount: number; winnerCount: number } | null {
  if (!boostTable) return null;
  return {
    version: boostTable.version,
    queryCount: Object.keys(boostTable.query_boosts).length,
    winnerCount: Object.keys(boostTable.consistent_winners).length,
  };
}
