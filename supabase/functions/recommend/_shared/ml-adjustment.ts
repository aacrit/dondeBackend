/**
 * ML Adjustment Layer — Targeted Boost (Version Alpha)
 *
 * Boost-only strategy from boost-table.json — teacher-validated per-query
 * boosts (+5) and cross-query consistent winner boosts (+2).
 * 0% regression risk (never penalizes).
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
 * Strategy 1: Direct teacher boost (+5) — If this restaurant was in teacher's
 *   top-5 for a matching query pattern.
 * Strategy 2: Cross-query winner boost (+2) — If this restaurant is a
 *   consistent winner across many teacher rankings.
 *
 * Returns 0 if no boost applies. NEVER penalizes (boost-only strategy).
 *
 * @param restaurantId - UUID of the restaurant
 * @param queryFingerprint - Canonical form of the query (from computeCanonicalForm)
 * @param queryText - Raw query text for fuzzy matching
 * @returns Boost amount (0, 2, or 5)
 */
export function computeTargetedBoost(
  restaurantId: string,
  queryFingerprint: string,
  queryText: string,
): number {
  if (!boostTable) return 0;

  // Strategy 1: Direct teacher boost (+5)
  // If this restaurant was in teacher's top-5 for a matching query
  const directBoostIds = boostTable.query_boosts[queryFingerprint] || [];
  if (directBoostIds.includes(restaurantId)) {
    return boostTable.direct_boost || 5;
  }

  // Also try normalized query text as key (lowercase, trimmed)
  const normalizedQuery = queryText.toLowerCase().trim();
  const altBoostIds = boostTable.query_boosts[normalizedQuery] || [];
  if (altBoostIds.includes(restaurantId)) {
    return boostTable.direct_boost || 5;
  }

  // Strategy 2: Cross-query winner boost (+2)
  // If this restaurant is a consistent winner across many teacher rankings
  if (restaurantId in (boostTable.consistent_winners || {})) {
    return boostTable.winner_boost || 2;
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
