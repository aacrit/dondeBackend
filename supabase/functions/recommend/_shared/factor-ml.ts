/**
 * Per-Factor ML Adjustment Layer — Shadow + Selective Activation
 *
 * Computes per-factor ML adjustments (+/- 2.0 points) for each of the 5 quality
 * factors (food, vibe, service, reputation, convenience) using trained linear models.
 *
 * Shadow mode: all factors compute and log adjustments. Only factors with
 * `active: true` in FACTOR_ML_CONFIG actually modify scores.
 *
 * Service is activated first (lowest weight = lowest risk). All others start in
 * shadow-only mode.
 *
 * The placeholder model (factor-models.json) has zero weights and zero bias,
 * so all adjustments are 0 until a trained model is deployed.
 *
 * Performance: model loaded once at module init (Edge Function cold start).
 * Inference is sub-millisecond per restaurant.
 */

// ============================================================================
// TYPES
// ============================================================================

interface FactorModel {
  weights: Record<string, number>;
  bias: number;
}

interface FactorModels {
  version: string;
  factors: {
    food: FactorModel;
    vibe: FactorModel;
    service: FactorModel;
    reputation: FactorModel;
    convenience: FactorModel;
  };
}

export interface FactorMLResult {
  raw: number;
  adjusted: number;
  delta: number;
  active: boolean;
  shadow: boolean;
}

// ============================================================================
// MODEL LOADING — runs once at module initialization (cold start)
// ============================================================================

let factorModels: FactorModels | null = null;

try {
  const data = await import("./factor-models.json", { assert: { type: "json" } });
  factorModels = data.default as unknown as FactorModels;
} catch {
  // No model available — factor ML adjustment disabled (expected in dev/test)
  factorModels = null;
}

// ============================================================================
// PER-FACTOR SHADOW/ACTIVE FLAGS
// ============================================================================

/**
 * Per-factor configuration for ML adjustments.
 * - shadow: whether to compute and log adjustments (for monitoring)
 * - active: whether to actually apply adjustments to the score
 *
 * Service is activated first because it has the lowest weight in most
 * query profiles, making it the lowest-risk factor to adjust.
 */
const FACTOR_ML_CONFIG = {
  food:        { shadow: true, active: false },
  vibe:        { shadow: true, active: false },
  service:     { shadow: true, active: true },   // Service activated first (lowest risk)
  reputation:  { shadow: true, active: false },
  convenience: { shadow: true, active: false },
};

type FactorName = keyof typeof FACTOR_ML_CONFIG;

// ============================================================================
// FEATURE EXTRACTION
// ============================================================================

/**
 * Build a feature vector for a specific factor.
 *
 * Features include the raw factor score, all other factor scores (cross-factor
 * signals), relevance type indicators, and context signals like dondeMatch
 * and scoreFit.
 */
function buildFactorFeatures(
  factor: string,
  rawFactors: { food: number; vibe: number; service: number; reputation: number; convenience: number },
  relevanceType: string,
  category: string,
  dondeMatch: number,
  scoreFit: number,
): Record<string, number> {
  const features: Record<string, number> = {};

  // Primary factor score
  features[`${factor}_score`] = rawFactors[factor as keyof typeof rawFactors] ?? 0;

  // Cross-factor signals (other factor scores provide context)
  for (const [name, value] of Object.entries(rawFactors)) {
    if (name !== factor) {
      features[`other_${name}`] = value;
    }
  }

  // Relevance type one-hot encoding
  const relevanceTypes = ["dish", "cuisine", "vibe", "reputation", "semantic", "open_ended"];
  for (const rt of relevanceTypes) {
    features[`rel_${rt}`] = relevanceType === rt ? 1 : 0;
  }

  // Category indicator (from query classification)
  features.category_hash = category ? (category.length % 10) / 10 : 0;

  // Overall score context
  features.donde_match = dondeMatch / 100;
  features.score_fit = scoreFit / 100;

  return features;
}

// ============================================================================
// INFERENCE
// ============================================================================

/**
 * Compute per-factor ML adjustments for all 5 quality factors.
 *
 * For each factor:
 * 1. Extract features from the raw factor scores + context
 * 2. Compute a linear adjustment (weights * features + bias)
 * 3. Clamp the adjustment to [-2.0, +2.0]
 * 4. Apply the adjustment only if the factor is in active mode
 *
 * Returns a record with per-factor results showing raw, adjusted, delta, and
 * whether the adjustment was actually applied.
 *
 * With the placeholder model (zero weights, zero bias), all deltas are 0
 * and no scores change — safe no-op.
 */
export function computeFactorMLAdjustments(
  rawFactors: { food: number; vibe: number; service: number; reputation: number; convenience: number },
  relevanceType: string,
  category: string,
  dondeMatch: number,
  scoreFit: number,
): Record<string, FactorMLResult> {
  if (!factorModels) return {};

  const results: Record<string, FactorMLResult> = {};

  for (const [factor, model] of Object.entries(factorModels.factors)) {
    const features = buildFactorFeatures(factor, rawFactors, relevanceType, category, dondeMatch, scoreFit);

    // Linear model: bias + sum(weight_i * feature_i)
    let adjustment = model.bias;
    for (const [fname, fval] of Object.entries(features)) {
      adjustment += (model.weights[fname] || 0) * fval;
    }

    // Clamp to +/- 2.0 points
    adjustment = Math.max(-2.0, Math.min(2.0, Math.round(adjustment * 100) / 100));

    const config = FACTOR_ML_CONFIG[factor as FactorName];
    const raw = rawFactors[factor as keyof typeof rawFactors];
    // Apply adjustment, keeping factor score in [0, 10]
    const adjusted = Math.max(0, Math.min(10, raw + adjustment));

    results[factor] = {
      raw,
      adjusted: config.active ? adjusted : raw,
      delta: adjustment,
      active: config.active,
      shadow: config.shadow,
    };
  }

  return results;
}

// ============================================================================
// DIAGNOSTICS
// ============================================================================

/**
 * Check whether a factor model is loaded and available for inference.
 */
export function isFactorMLLoaded(): boolean {
  return factorModels !== null;
}

/**
 * Get factor model metadata for diagnostics.
 */
export function getFactorMLModelInfo(): { version: string; factors: string[] } | null {
  if (!factorModels) return null;
  return {
    version: factorModels.version,
    factors: Object.keys(factorModels.factors),
  };
}
