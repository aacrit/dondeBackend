/**
 * ML Adjustment Layer — Active with A/B Testing (Phase 2)
 *
 * Computes ML-based score adjustments (+/- 5 points) from a pre-trained model.
 * In A/B test mode: 50% of requests get ML-adjusted scores, 50% get pure rules.
 * The `ml_scoring` response field shows group assignment and adjustments.
 *
 * Supports two model types:
 * - linear_adjustment: weighted sum of features (simple, interpretable)
 * - xgboost_ranker: decision tree ensemble (from xgboost-inference.ts pattern)
 *
 * The placeholder model (ml-model.json) has zero weights, so predictMLAdjustment()
 * returns 0 for all inputs until a trained model is deployed.
 *
 * Performance: model loaded once at module init (Edge Function cold start).
 * Inference is <1ms per restaurant — no measurable request latency impact.
 */

// ============================================================================
// TYPES
// ============================================================================

interface TreeNode {
  feature?: number;
  threshold?: number;
  left?: number;
  right?: number;
  leaf_value?: number;
}

interface MLModel {
  model_type: "xgboost_ranker" | "linear_adjustment";
  version: string;
  feature_names: string[];
  // Linear model fields
  weights?: Record<string, number>;
  bias?: number;
  // XGBoost fields
  trees?: TreeNode[][];
  training_metrics?: Record<string, unknown> | null;
}

interface MLShadowScore {
  restaurant_id: string;
  restaurant_name: string;
  rule_dm: number;
  ml_adjustment: number;
  ml_dm: number;
}

// ============================================================================
// MODEL LOADING — runs once at module initialization (cold start)
// ============================================================================

let mlModel: MLModel | null = null;

try {
  // Dynamic import of JSON — Deno supports import assertions for JSON modules
  const modelData = await import("./ml-model.json", { assert: { type: "json" } });
  mlModel = modelData.default as unknown as MLModel;
} catch {
  // No model available — ML adjustment disabled (expected in dev/test)
  mlModel = null;
}

// ============================================================================
// FEATURE EXTRACTION
// ============================================================================

/**
 * Extract ML features from a scored restaurant candidate + intent.
 *
 * Feature vector must match the order in ml-model.json `feature_names`:
 * [relevance_score, rel_dish, rel_cuisine, rel_vibe, rel_reputation, rel_semantic,
 *  rel_open_ended, food, vibe, service, reputation, convenience, data_completeness,
 *  quality_score, price_numeric, query_words, has_cuisine, has_dish, has_vibe,
 *  has_neighborhood, high_reviews, trending]
 */
export function extractMLFeatures(
  restaurant: Record<string, unknown>,
  scoringResult: Record<string, unknown>,
  intent: Record<string, unknown>,
): number[] {
  const relevanceType = (scoringResult.relevance as Record<string, unknown>)?.type
    || scoringResult.relevance_type
    || "";
  const factors = (scoringResult.factors as Record<string, number>) || scoringResult;
  const relevanceScore = Number(
    (scoringResult.relevance as Record<string, unknown>)?.score
    ?? scoringResult.relevance_score
    ?? 0,
  );

  // Price level to numeric
  const priceStr = String(restaurant.price_level || "$$");
  const priceNumeric = priceStr === "$" ? 1 : priceStr === "$$" ? 2 : priceStr === "$$$" ? 3 : priceStr === "$$$$" ? 4 : 2;

  // Query word count from special_request
  const specialRequest = String(intent.special_request || intent.specialRequest || "");
  const queryWords = specialRequest.trim() ? specialRequest.trim().split(/\s+/).length : 0;

  // Review count from restaurant
  const reviewCount = Number(restaurant.google_review_count || 0);

  // Trending score from relevance details
  const relevanceDetails = (scoringResult.relevance as Record<string, unknown>)?.details
    || scoringResult.relevance_details;
  const trendingScore = typeof relevanceDetails === "object" && relevanceDetails !== null
    ? Number((relevanceDetails as Record<string, unknown>).trending_score || 0)
    : 0;

  // Target arrays from intent
  const targetCuisines = intent.target_cuisines as string[] | undefined;
  const dishLevelIntent = Boolean(intent.dish_level_intent);
  const targetVibes = intent.target_vibes as string[] | undefined;
  const targetNeighborhood = Boolean(intent.target_neighborhood);

  return [
    relevanceScore,
    relevanceType === "dish" ? 1 : 0,
    relevanceType === "cuisine" ? 1 : 0,
    relevanceType === "vibe" ? 1 : 0,
    relevanceType === "reputation" ? 1 : 0,
    relevanceType === "semantic" ? 1 : 0,
    relevanceType === "open_ended" ? 1 : 0,
    Number(factors.food || 0),
    Number(factors.vibe || 0),
    Number(factors.service || 0),
    Number(factors.reputation || 0),
    Number(factors.convenience || 0),
    Number(scoringResult.dataCompleteness ?? scoringResult.data_completeness ?? 0),
    Number(scoringResult.quality ?? scoringResult.quality_score ?? 0),
    priceNumeric,
    queryWords,
    (targetCuisines && targetCuisines.length > 0) ? 1 : 0,
    dishLevelIntent ? 1 : 0,
    (targetVibes && targetVibes.length > 0) ? 1 : 0,
    targetNeighborhood ? 1 : 0,
    reviewCount > 500 ? 1 : 0,
    trendingScore > 7 ? 1 : 0,
  ];
}

// ============================================================================
// INFERENCE
// ============================================================================

/**
 * Traverse a flat-array decision tree to find the leaf value.
 * Nodes are stored as an array where each node has:
 * - feature: index into feature vector
 * - threshold: split value
 * - left/right: child node indices
 * - leaf_value: prediction (only on leaf nodes)
 */
function traverseTree(nodes: TreeNode[], features: number[]): number {
  let nodeIdx = 0;
  // Safety limit to prevent infinite loops on malformed trees
  for (let step = 0; step < 100; step++) {
    const node = nodes[nodeIdx];
    if (node === undefined) return 0;
    if (node.leaf_value !== undefined) return node.leaf_value;
    const featureVal = features[node.feature ?? 0] ?? 0;
    if (featureVal < (node.threshold ?? 0)) {
      nodeIdx = node.left ?? 0;
    } else {
      nodeIdx = node.right ?? 0;
    }
  }
  return 0; // Fallback if tree is too deep
}

/**
 * Predict the ML adjustment for a single feature vector.
 *
 * Returns a value clamped to [-5, +5] representing the score nudge.
 * With the placeholder model (zero weights, no trees), always returns 0.
 */
export function predictMLAdjustment(features: number[]): number {
  if (!mlModel) return 0;

  let rawPrediction: number;

  if (mlModel.model_type === "linear_adjustment" && mlModel.weights) {
    rawPrediction = mlModel.bias || 0;
    mlModel.feature_names.forEach((name, i) => {
      rawPrediction += (mlModel!.weights![name] || 0) * (features[i] || 0);
    });
  } else if (mlModel.model_type === "xgboost_ranker" && mlModel.trees) {
    rawPrediction = 0;
    for (const tree of mlModel.trees) {
      rawPrediction += traverseTree(tree, features);
    }
  } else {
    return 0;
  }

  // Clamp to +/- 5 points, round to 1 decimal
  return Math.max(-5, Math.min(5, Math.round(rawPrediction * 10) / 10));
}

// ============================================================================
// SHADOW SCORING — computes adjustments without applying them
// ============================================================================

/**
 * Compute ML shadow scores for a batch of scored candidates.
 *
 * Returns an array showing what the ML model WOULD adjust for each restaurant.
 * In Phase 1 (shadow mode), these adjustments are logged but never applied.
 *
 * @param scoredCandidates - Array of V9ScoredCandidate objects (from reRankV9)
 * @param intent - The classified intent object
 * @returns Array of shadow scores (empty if no model loaded)
 */
export function computeMLShadowScores(
  scoredCandidates: Record<string, unknown>[],
  intent: Record<string, unknown>,
): MLShadowScore[] {
  if (!mlModel) return [];

  return scoredCandidates.map((candidate) => {
    const restaurant = (candidate.profile || candidate.restaurant || candidate) as Record<string, unknown>;
    const scoringResult = candidate as Record<string, unknown>;

    const features = extractMLFeatures(restaurant, scoringResult, intent);
    const adjustment = predictMLAdjustment(features);
    const ruleDM = Number(candidate.dondeMatch || 0);

    return {
      restaurant_id: String(restaurant.id || ""),
      restaurant_name: String(restaurant.name || ""),
      rule_dm: ruleDM,
      ml_adjustment: adjustment,
      ml_dm: Math.max(0, Math.min(99, ruleDM + adjustment)),
    };
  });
}

/**
 * Check whether an ML model is loaded and available for inference.
 */
export function isMLModelLoaded(): boolean {
  return mlModel !== null;
}

/**
 * Get model metadata for diagnostics.
 */
export function getMLModelInfo(): { version: string; type: string; features: number } | null {
  if (!mlModel) return null;
  return {
    version: mlModel.version,
    type: mlModel.model_type,
    features: mlModel.feature_names.length,
  };
}

// ============================================================================
// A/B TEST CONFIGURATION
// ============================================================================

/** Percentage of traffic that gets ML-adjusted scores (0-100). Set to 0 to disable. */
const ML_AB_TEST_PERCENTAGE = 50;

/** Determines A/B group for this request. Stable per-request, not per-isolate. */
export function getMLABGroup(): "ml" | "rules" {
  if (!mlModel) return "rules";
  if (ML_AB_TEST_PERCENTAGE <= 0) return "rules";
  if (ML_AB_TEST_PERCENTAGE >= 100) return "ml";
  return Math.random() * 100 < ML_AB_TEST_PERCENTAGE ? "ml" : "rules";
}

/**
 * Apply ML adjustments to actual DondeMatch scores.
 * Only call this for requests in the "ml" A/B group.
 * Adjustments are clamped to +/- 5 points.
 *
 * @returns Array of adjustments that were applied
 */
export function applyMLAdjustments(
  scoredCandidates: Record<string, unknown>[],
  intent: Record<string, unknown>,
): MLShadowScore[] {
  if (!mlModel) return [];

  const results: MLShadowScore[] = [];

  for (const candidate of scoredCandidates) {
    const restaurant = (candidate.profile || candidate.restaurant || candidate) as Record<string, unknown>;
    const scoringResult = candidate as Record<string, unknown>;

    const features = extractMLFeatures(restaurant, scoringResult, intent);
    const adjustment = predictMLAdjustment(features);

    if (adjustment !== 0) {
      const ruleDM = Number(candidate.dondeMatch || 0);
      const mlDM = Math.max(0, Math.min(99, ruleDM + adjustment));

      // Actually modify the score
      (candidate as Record<string, number>).dondeMatch = mlDM;

      results.push({
        restaurant_id: String(restaurant.id || ""),
        restaurant_name: String(restaurant.name || ""),
        rule_dm: ruleDM,
        ml_adjustment: adjustment,
        ml_dm: mlDM,
      });
    }
  }

  return results;
}
