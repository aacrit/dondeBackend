/**
 * Post-Scoring Filters — Neighborhood + Price Level
 *
 * Applied AFTER reRankV9() scores all candidates and AFTER Google re-ranking,
 * but BEFORE response building. These are hard filters with graceful expansion.
 *
 * Design:
 * - Phase 1: Exact match on neighborhood + price
 * - Phase 2: Expand to adjacent neighborhoods / price tiers if too few candidates
 * - Phase 3: Return best available if still too few (never force empty results)
 *
 * "Anywhere" / "Any" bypass filtering entirely (preserves current behavior).
 */

import type { V9ScoredCandidate } from "./types-v9.ts";
import { logInfo } from "./logger.ts";

// ==========================================
// NEIGHBORHOOD ADJACENCY MAP
// ==========================================
// Based on Chicago geography. Keys are canonical neighborhood names (matching DB).
// Values are arrays of adjacent neighborhoods, ordered roughly by proximity.

const NEIGHBORHOOD_ADJACENCY: Record<string, string[]> = {
  "Andersonville":    ["Edgewater", "Uptown", "Ravenswood", "Lincoln Square"],
  "Avondale":         ["Logan Square", "Irving Park", "North Center", "Bucktown"],
  "Back of the Yards": ["Bridgeport", "Pilsen", "Woodlawn"],
  "Bridgeport":       ["Chinatown", "Pilsen", "Back of the Yards", "South Loop"],
  "Bronzeville":      ["South Loop", "Hyde Park", "Loop"],
  "Bucktown":         ["Wicker Park", "Logan Square", "Ukrainian Village", "Lincoln Park", "Avondale"],
  "Chinatown":        ["Bridgeport", "South Loop", "Pilsen", "Loop"],
  "Edgewater":        ["Andersonville", "Uptown", "Rogers Park"],
  "Fulton Market":    ["West Loop", "Loop", "River North", "Ukrainian Village"],
  "Gold Coast":       ["Old Town", "River North", "Streeterville", "Lincoln Park"],
  "Greektown":        ["West Loop", "Loop", "Little Italy"],
  "Humboldt Park":    ["Ukrainian Village", "Wicker Park", "Logan Square"],
  "Hyde Park":        ["Woodlawn", "Bronzeville", "South Loop"],
  "Irving Park":      ["Avondale", "North Center", "Lincoln Square"],
  "Lakeview":         ["Lincoln Park", "North Center", "Uptown", "Bucktown"],
  "Lincoln Park":     ["Old Town", "Lakeview", "Bucktown", "Gold Coast"],
  "Lincoln Square":   ["Ravenswood", "North Center", "Andersonville", "Irving Park"],
  "Little Italy":     ["Pilsen", "West Loop", "Greektown", "Loop"],
  "Logan Square":     ["Bucktown", "Avondale", "Humboldt Park", "Wicker Park"],
  "Loop":             ["West Loop", "River North", "South Loop", "Streeterville", "Gold Coast"],
  "North Center":     ["Lakeview", "Lincoln Square", "Avondale", "Irving Park", "Ravenswood"],
  "Old Town":         ["Lincoln Park", "Gold Coast", "River North"],
  "Pilsen":           ["Little Italy", "Chinatown", "Bridgeport", "West Loop"],
  "Ravenswood":       ["Lincoln Square", "Andersonville", "North Center"],
  "River North":      ["Gold Coast", "Streeterville", "Loop", "Old Town", "West Loop"],
  "Rogers Park":      ["Edgewater", "Andersonville"],
  "South Loop":       ["Loop", "Chinatown", "Bronzeville", "Bridgeport"],
  "Streeterville":    ["River North", "Gold Coast", "Loop"],
  "Ukrainian Village": ["Wicker Park", "Humboldt Park", "Bucktown", "West Loop"],
  "Uptown":           ["Andersonville", "Edgewater", "Lakeview"],
  "West Loop":        ["Loop", "River North", "Little Italy", "Pilsen", "Greektown", "Ukrainian Village"],
  "Wicker Park":      ["Bucktown", "Ukrainian Village", "Humboldt Park", "Logan Square", "West Loop"],
  "Woodlawn":         ["Hyde Park", "Back of the Yards", "Bronzeville"],
};

// ==========================================
// PRICE ADJACENCY
// ==========================================
// Each tier expands to its immediate neighbor(s).

const PRICE_ADJACENCY: Record<string, string[]> = {
  "$":    ["$$"],
  "$$":   ["$", "$$$"],
  "$$$":  ["$$", "$$$$"],
  "$$$$": ["$$$"],
};

// ==========================================
// FILTER CONFIGURATION
// ==========================================
const MIN_CANDIDATES = 3;       // Minimum good candidates before expansion
const MIN_QUALITY_DM = 55;      // Don't return low-quality matches just because they match the filter

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function isAnywhereOrAny(value: string): boolean {
  const lower = value.toLowerCase();
  return lower === "anywhere" || lower === "any" || lower === "";
}

function getRestaurantNeighborhood(candidate: V9ScoredCandidate): string {
  return candidate.profile.neighborhood_name || "";
}

function getRestaurantPrice(candidate: V9ScoredCandidate): string {
  return candidate.profile.price_level || "";
}

function matchesNeighborhoodExact(candidate: V9ScoredCandidate, targetNeighborhood: string): boolean {
  const restHood = getRestaurantNeighborhood(candidate).toLowerCase();
  return restHood === targetNeighborhood.toLowerCase();
}

function matchesNeighborhoodAdjacent(candidate: V9ScoredCandidate, targetNeighborhood: string): boolean {
  const restHood = getRestaurantNeighborhood(candidate).toLowerCase();
  const adjacent = NEIGHBORHOOD_ADJACENCY[targetNeighborhood] || [];
  return adjacent.some(adj => adj.toLowerCase() === restHood);
}

function matchesPriceExact(candidate: V9ScoredCandidate, targetPrice: string): boolean {
  const restPrice = getRestaurantPrice(candidate);
  return restPrice === targetPrice;
}

function matchesPriceAdjacent(candidate: V9ScoredCandidate, targetPrice: string): boolean {
  const restPrice = getRestaurantPrice(candidate);
  const adjacent = PRICE_ADJACENCY[targetPrice] || [];
  return adjacent.includes(restPrice);
}

// ==========================================
// MAIN FILTER FUNCTION
// ==========================================

export interface PostFilterResult {
  candidates: V9ScoredCandidate[];
  filterApplied: boolean;
  neighborhoodFiltered: boolean;
  priceFiltered: boolean;
  expanded: boolean;
  expansionReason: string | null;
  exactMatchCount: number;
  adjacentMatchCount: number;
}

/**
 * Apply post-scoring neighborhood + price filters with graceful expansion.
 *
 * @param candidates - Scored and sorted candidates from reRankV9 + Google re-rank
 * @param neighborhood - User-selected neighborhood (or "Anywhere")
 * @param priceLevel - User-selected price level (or "Any")
 * @returns Filtered candidates maintaining DM sort order, with metadata
 */
export function applyPostScoringFilters(
  candidates: V9ScoredCandidate[],
  neighborhood: string,
  priceLevel: string,
): PostFilterResult {
  const neighborhoodActive = !isAnywhereOrAny(neighborhood);
  const priceActive = !isAnywhereOrAny(priceLevel);

  // If no filters active, return as-is
  if (!neighborhoodActive && !priceActive) {
    return {
      candidates,
      filterApplied: false,
      neighborhoodFiltered: false,
      priceFiltered: false,
      expanded: false,
      expansionReason: null,
      exactMatchCount: candidates.length,
      adjacentMatchCount: 0,
    };
  }

  // ----------------------------------------------------------------
  // Phase 1: Exact match on both active filters
  // ----------------------------------------------------------------
  const exactMatches = candidates.filter(c => {
    const hoodOk = !neighborhoodActive || matchesNeighborhoodExact(c, neighborhood);
    const priceOk = !priceActive || matchesPriceExact(c, priceLevel);
    return hoodOk && priceOk;
  });

  const qualityExact = exactMatches.filter(c => c.dondeMatch >= MIN_QUALITY_DM);

  if (qualityExact.length >= MIN_CANDIDATES) {
    logInfo("Post-filter: exact match sufficient", {
      neighborhood: neighborhoodActive ? neighborhood : "any",
      price: priceActive ? priceLevel : "any",
      exactCount: qualityExact.length,
    });
    return {
      candidates: qualityExact,
      filterApplied: true,
      neighborhoodFiltered: neighborhoodActive,
      priceFiltered: priceActive,
      expanded: false,
      expansionReason: null,
      exactMatchCount: qualityExact.length,
      adjacentMatchCount: 0,
    };
  }

  // ----------------------------------------------------------------
  // Phase 2: Expand to adjacent neighborhoods + price tiers
  // ----------------------------------------------------------------
  const adjacentMatches = candidates.filter(c => {
    // Must not already be in exact matches
    if (exactMatches.includes(c)) return false;

    const hoodOk = !neighborhoodActive ||
      matchesNeighborhoodExact(c, neighborhood) ||
      matchesNeighborhoodAdjacent(c, neighborhood);
    const priceOk = !priceActive ||
      matchesPriceExact(c, priceLevel) ||
      matchesPriceAdjacent(c, priceLevel);
    return hoodOk && priceOk;
  });

  const qualityAdjacent = adjacentMatches.filter(c => c.dondeMatch >= MIN_QUALITY_DM);

  // Merge: exact matches first (sorted by DM), then adjacent (sorted by DM)
  // Both groups are already sorted by DM since input was sorted
  const merged = [...qualityExact, ...qualityAdjacent];

  if (merged.length >= MIN_CANDIDATES) {
    const reason = qualityExact.length < MIN_CANDIDATES
      ? `Only ${qualityExact.length} exact match(es) with DM>=${MIN_QUALITY_DM}; expanded to adjacent`
      : null;

    logInfo("Post-filter: expanded to adjacent", {
      neighborhood: neighborhoodActive ? neighborhood : "any",
      price: priceActive ? priceLevel : "any",
      exactCount: qualityExact.length,
      adjacentCount: qualityAdjacent.length,
    });

    return {
      candidates: merged,
      filterApplied: true,
      neighborhoodFiltered: neighborhoodActive,
      priceFiltered: priceActive,
      expanded: true,
      expansionReason: reason,
      exactMatchCount: qualityExact.length,
      adjacentMatchCount: qualityAdjacent.length,
    };
  }

  // ----------------------------------------------------------------
  // Phase 3: Not enough even with expansion — return what we have,
  // or fall back to the full candidate list (best available)
  // ----------------------------------------------------------------
  if (merged.length > 0) {
    logInfo("Post-filter: partial match (below threshold)", {
      neighborhood: neighborhoodActive ? neighborhood : "any",
      price: priceActive ? priceLevel : "any",
      mergedCount: merged.length,
      threshold: MIN_CANDIDATES,
    });
    return {
      candidates: merged,
      filterApplied: true,
      neighborhoodFiltered: neighborhoodActive,
      priceFiltered: priceActive,
      expanded: true,
      expansionReason: `Only ${merged.length} candidate(s) found even with expansion; returning best available`,
      exactMatchCount: qualityExact.length,
      adjacentMatchCount: qualityAdjacent.length,
    };
  }

  // No matches at all — return original candidates (best available, unfiltered)
  logInfo("Post-filter: no matches, returning best available", {
    neighborhood: neighborhoodActive ? neighborhood : "any",
    price: priceActive ? priceLevel : "any",
    candidatePool: candidates.length,
  });
  return {
    candidates: candidates.slice(0, Math.max(5, MIN_CANDIDATES)),
    filterApplied: true,
    neighborhoodFiltered: neighborhoodActive,
    priceFiltered: priceActive,
    expanded: true,
    expansionReason: "No neighborhood/price matches found; returning best available from full pool",
    exactMatchCount: 0,
    adjacentMatchCount: 0,
  };
}

// Export adjacency maps for potential use in tests / other modules
export { NEIGHBORHOOD_ADJACENCY, PRICE_ADJACENCY };
