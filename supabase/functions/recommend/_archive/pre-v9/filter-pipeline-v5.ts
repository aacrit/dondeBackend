/**
 * Donde Match V5 — Hard Filter Pipeline
 *
 * Design principle: "Filter once, score once."
 * Hard filters ELIMINATE candidates. Scoring only RANKS survivors.
 * Never penalize in scoring what was already filtered out.
 *
 * Filter chain (applied in order):
 *   1. Exclude list — previously shown restaurants + "Try Another" rejects
 *   2. Neighborhood — hard filter when != "Anywhere"
 *   3. Price — hard filter when != "Any"; allows ONE level up ($->$$, $$->$$$)
 *   4. Dietary — hard block when dietary_options explicitly contradict; unknowns pass
 *   5. Cuisine — ONLY when cuisine_importance == "high"; matches cuisine_type OR subcategory
 *   6. Open Now — when toggle is ON and Google data is available
 *
 * Relaxation cascade: if < 12 candidates survive, relax cuisine -> price -> neighborhood.
 */

import type { RestaurantProfile } from "./types.ts";
import type { IntentClassificationV2 } from "./intent-classifier.ts";
import type { GooglePlaceData } from "./google-places.ts";
import { DIETARY_KEYWORDS, DIETARY_HIERARCHY } from "./scoring.ts";

// ---------------------------------------------------------------------------
// Types (defined inline to avoid circular deps with types-v5.ts)
// ---------------------------------------------------------------------------

type RelaxableFilter = "cuisine" | "price" | "neighborhood";

export interface FilterPipelineResult {
  candidates: RestaurantProfile[];
  relaxationApplied: RelaxableFilter[];
  excludedCount: number;
  closedCount: number;
}

export interface FilterContext {
  exclude: string[];
  neighborhood: string;
  priceLevel: string;
  dietaryRestrictions: string[];
  cuisineImportance: "high" | "medium" | "low";
  targetCuisines: string[];
  openNow: boolean;
  openNowData?: Map<string, boolean | null>; // restaurant_id -> open_now status from Google
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ordered price tiers for range comparison */
const PRICE_ORDER = ["$", "$$", "$$$", "$$$$"];

/** Minimum candidate pool size before relaxation kicks in */
const RELAXATION_THRESHOLD = 12;

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Run the V5 hard-filter pipeline against a candidate pool.
 *
 * Each filter stage either eliminates restaurants that cannot possibly match
 * the user's request, or passes them through when data is absent (benefit of
 * the doubt). The pipeline tracks which relaxable filters were actually
 * applied so the relaxation cascade can selectively back them off.
 */
export function runFilterPipeline(
  candidates: RestaurantProfile[],
  context: FilterContext,
): FilterPipelineResult {
  const originalCount = candidates.length;

  // ---- Tracking flags for relaxation cascade ----
  let neighborhoodFilterWasApplied = false;
  let priceFilterWasApplied = false;
  let cuisineFilterWasApplied = false;

  // =========================================================================
  // Filter 1: Exclude list
  // Remove previously shown restaurants and "Try Another" rejects.
  // =========================================================================
  let filtered = candidates.filter((r) => !context.exclude.includes(r.id));
  const afterExcludeCount = filtered.length;

  // =========================================================================
  // Filter 2: Neighborhood
  // Hard filter when the user selected a specific neighborhood.
  // =========================================================================
  if (context.neighborhood !== "Anywhere") {
    neighborhoodFilterWasApplied = true;
    filtered = filtered.filter(
      (r) =>
        r.neighborhood_name?.toLowerCase() ===
        context.neighborhood.toLowerCase(),
    );
  }

  // Snapshot after neighborhood + exclude (used if we need to relax neighborhood)
  const afterNeighborhood = filtered;

  // =========================================================================
  // Filter 3: Price
  // Hard filter when the user selected a specific budget tier.
  // Allows ONE level up: a "$" user can still see "$$" restaurants.
  // =========================================================================
  if (context.priceLevel !== "Any") {
    const userIdx = PRICE_ORDER.indexOf(context.priceLevel);
    if (userIdx >= 0) {
      priceFilterWasApplied = true;
      filtered = filtered.filter((r) => {
        if (!r.price_level) return true; // No data -> pass
        const restIdx = PRICE_ORDER.indexOf(r.price_level);
        return restIdx >= 0 && restIdx <= userIdx + 1; // Allow ONE level up
      });
    }
  }

  // =========================================================================
  // Filter 4: Dietary
  // Hard block when the restaurant's dietary_options explicitly contradict
  // the user's restrictions. Restaurants with no dietary data pass through
  // (benefit of the doubt). This filter is NEVER relaxed.
  // =========================================================================
  if (context.dietaryRestrictions.length > 0) {
    filtered = filtered.filter((r) => {
      // No dietary data -> pass (benefit of doubt)
      if (!r.dietary_options || r.dietary_options.length === 0) return true;

      // Check if ANY dietary restriction is supported
      return context.dietaryRestrictions.some((dr) => {
        const keywords = DIETARY_KEYWORDS[dr.toLowerCase()];
        if (!keywords) return true; // Unknown restriction -> pass

        // Direct keyword match
        const directMatch = r.dietary_options!.some((opt) =>
          keywords.some((kw) =>
            opt.toLowerCase().includes(kw.toLowerCase()),
          ),
        );
        if (directMatch) return true;

        // Check hierarchy (e.g., Vegan request -> Vegetarian partial credit)
        const subsumes = DIETARY_HIERARCHY[dr.toLowerCase()];
        if (subsumes) {
          return subsumes.some((sub) => {
            const subKeywords = DIETARY_KEYWORDS[sub];
            if (!subKeywords) return false;
            return r.dietary_options!.some((opt) =>
              subKeywords.some((kw) =>
                opt.toLowerCase().includes(kw.toLowerCase()),
              ),
            );
          });
        }

        return false;
      });
    });
  }

  // Snapshot after dietary (the "safe" baseline — dietary is never relaxed)
  const afterDietary = filtered;

  // =========================================================================
  // Filter 5: Cuisine
  // ONLY applied when cuisine_importance is "high". Matches against
  // cuisine_type (exact, contains) and deep_profile.cuisine_subcategory.
  // =========================================================================
  if (
    context.cuisineImportance === "high" &&
    context.targetCuisines.length > 0
  ) {
    cuisineFilterWasApplied = true;
    filtered = filtered.filter((r) => {
      if (!r.cuisine_type) return false;
      const cuisineLower = r.cuisine_type.toLowerCase();

      // Exact match
      if (context.targetCuisines.some((c) => c.toLowerCase() === cuisineLower))
        return true;

      // Contains match ("Modern Indian" contains "Indian", or vice versa)
      if (
        context.targetCuisines.some(
          (c) =>
            cuisineLower.includes(c.toLowerCase()) ||
            c.toLowerCase().includes(cuisineLower),
        )
      )
        return true;

      // Subcategory match via deep_profile
      const dp = r.deep_profile;
      if (dp?.cuisine_subcategory) {
        const subLower = dp.cuisine_subcategory.toLowerCase();
        if (context.targetCuisines.some((c) => subLower.includes(c.toLowerCase())))
          return true;
      }

      return false;
    });
  }

  // =========================================================================
  // Filter 6: Open Now
  // Applied when the frontend toggle is ON and Google data is available.
  // null/undefined = unknown -> pass; true = open -> pass; false = closed -> eliminate.
  // =========================================================================
  let closedCount = 0;
  if (context.openNow && context.openNowData) {
    const beforeOpen = filtered.length;
    filtered = filtered.filter((r) => {
      const status = context.openNowData!.get(r.id);
      // null = no data -> pass (benefit of doubt)
      // true = confirmed open -> pass
      // false = confirmed closed -> eliminate
      return status !== false;
    });
    closedCount = beforeOpen - filtered.length;
  }

  // =========================================================================
  // Relaxation Cascade
  //
  // If the surviving pool is too small, progressively drop relaxable filters
  // in order of decreasing specificity: cuisine -> price -> neighborhood.
  // Dietary is NEVER relaxed — it's a hard safety constraint.
  // =========================================================================
  const relaxationApplied: RelaxableFilter[] = [];

  // Step 1: Drop cuisine filter
  if (filtered.length < RELAXATION_THRESHOLD && cuisineFilterWasApplied) {
    relaxationApplied.push("cuisine");

    // Re-derive from post-dietary pool (skip cuisine filter, keep everything else)
    let relaxed = afterDietary;

    // Re-apply open-now on the relaxed set
    if (context.openNow && context.openNowData) {
      relaxed = relaxed.filter((r) => {
        const status = context.openNowData!.get(r.id);
        return status !== false;
      });
    }

    filtered = relaxed;
  }

  // Step 2: Drop price filter
  if (filtered.length < RELAXATION_THRESHOLD && priceFilterWasApplied) {
    relaxationApplied.push("price");

    // Re-derive from post-dietary pool without cuisine OR price filters.
    // Start from afterDietary and rewind price.
    // We need to re-apply neighborhood (if it was applied and not relaxed) and open-now.
    let relaxed = afterDietary;

    // Neighborhood was already baked into afterDietary (it ran before price),
    // so we just need to reconstruct without the price filter applied.
    // afterDietary was built on top of the neighborhood-filtered set, so go
    // back to post-exclude and re-apply only neighborhood + dietary.
    const postExclude = candidates.filter(
      (r) => !context.exclude.includes(r.id),
    );

    let pool = postExclude;

    // Re-apply neighborhood (only if not yet relaxed)
    if (
      neighborhoodFilterWasApplied &&
      !relaxationApplied.includes("neighborhood")
    ) {
      pool = pool.filter(
        (r) =>
          r.neighborhood_name?.toLowerCase() ===
          context.neighborhood.toLowerCase(),
      );
    }

    // Re-apply dietary (always)
    if (context.dietaryRestrictions.length > 0) {
      pool = pool.filter((r) => passesDietaryFilter(r, context));
    }

    // Re-apply open-now
    if (context.openNow && context.openNowData) {
      pool = pool.filter((r) => {
        const status = context.openNowData!.get(r.id);
        return status !== false;
      });
    }

    filtered = pool;
  }

  // Step 3: Drop neighborhood filter
  if (filtered.length < RELAXATION_THRESHOLD && neighborhoodFilterWasApplied) {
    relaxationApplied.push("neighborhood");

    // Re-derive from scratch: exclude + dietary + open-now only
    const postExclude = candidates.filter(
      (r) => !context.exclude.includes(r.id),
    );

    let pool = postExclude;

    // Re-apply dietary (always)
    if (context.dietaryRestrictions.length > 0) {
      pool = pool.filter((r) => passesDietaryFilter(r, context));
    }

    // Re-apply open-now
    if (context.openNow && context.openNowData) {
      pool = pool.filter((r) => {
        const status = context.openNowData!.get(r.id);
        return status !== false;
      });
    }

    filtered = pool;
  }

  return {
    candidates: filtered,
    relaxationApplied,
    excludedCount: originalCount - afterExcludeCount,
    closedCount,
  };
}

// ---------------------------------------------------------------------------
// Helper: standalone dietary check (used during relaxation re-runs)
// ---------------------------------------------------------------------------

/**
 * Check if a restaurant passes the dietary filter.
 * Extracted so relaxation re-runs can reuse the same logic.
 */
function passesDietaryFilter(
  r: RestaurantProfile,
  context: FilterContext,
): boolean {
  if (!r.dietary_options || r.dietary_options.length === 0) return true;

  return context.dietaryRestrictions.some((dr) => {
    const keywords = DIETARY_KEYWORDS[dr.toLowerCase()];
    if (!keywords) return true;

    const directMatch = r.dietary_options!.some((opt) =>
      keywords.some((kw) => opt.toLowerCase().includes(kw.toLowerCase())),
    );
    if (directMatch) return true;

    const subsumes = DIETARY_HIERARCHY[dr.toLowerCase()];
    if (subsumes) {
      return subsumes.some((sub) => {
        const subKeywords = DIETARY_KEYWORDS[sub];
        if (!subKeywords) return false;
        return r.dietary_options!.some((opt) =>
          subKeywords.some((kw) =>
            opt.toLowerCase().includes(kw.toLowerCase()),
          ),
        );
      });
    }

    return false;
  });
}
