/**
 * Donde Match V4.0 — Dynamic-Weight Geometric Mean Scoring Engine
 *
 * Five human-intuitive factors: Food Quality, Vibe, Service, Reputation, Convenience
 * Each factor scores 1-10. Dynamic weights driven by parsed intent (sum to 1.0).
 * Donde Score = (Π Factor_i ^ Weight_i) × 10
 *
 * Key changes from V3.6:
 * - Geometric mean replaces power-law scaling — transparent, linear, penalizes dealbreakers naturally
 * - All post-composite adjustments absorbed INTO factors (no more post-hoc layer)
 * - Dynamic weights driven by configurable rules (weight-config.ts), not hardcoded if/else
 * - Confidence scoring per factor — regresses toward 5.5 for uncertain data
 * - Factor renaming: food→foodQuality, setting→service, atmosphere→vibe
 *
 * Removed from V3.6:
 * - Power-law scaling (pow(x, 0.73) * 116)
 * - Quality match bonus (+0.8 max)
 * - Claude relevance modulation (±0.5)
 * - Factor decorrelation (setting/atmo, food/rep overlap)
 * - Post-composite deal-breaker penalties → absorbed into Convenience/Food factors
 * - Post-composite personalization → absorbed into Food factor
 */

import type {
  RestaurantProfile,
  V4Factors,
  V4Weights,
  V4FactorConfidence,
  V4SubComponent,
  V4FactorResult,
  ConfidenceLevel,
} from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { IntentClassification, IntentClassificationV2 } from "./intent-classifier.ts";
import type { V3SubComponent } from "./scoring-v3.ts";

// Re-use existing factor computation functions from V3 (well-tested through 6 expert review cycles)
import {
  computeFoodMatch,
  computeSettingFit,
  computeAtmosphere,
  computeReputation,
  computeConvenience,
} from "./scoring-v3.ts";

// V4 weight engine
import { computeV4Weights, type V4Weights as WeightConfigWeights } from "./weight-config.ts";

// Shared dictionaries
import {
  CUISINE_KEYWORDS,
  DIETARY_KEYWORDS,
  DIETARY_HIERARCHY,
  type RejectionSignals,
  type UserFeedbackSignals,
} from "./scoring.ts";

// ==========================================
// CONFIDENCE MULTIPLIERS
// ==========================================

const CONFIDENCE_MULTIPLIER: Record<ConfidenceLevel, number> = {
  high: 1.0,
  medium: 0.75,
  low: 0.5,
};

const CONFIDENCE_PRIOR = 5.5; // Regression target for uncertain data
const FACTOR_FLOOR = 1.0;     // Minimum factor score (prevents geometric mean zero-collapse)

// ==========================================
// CONFIDENCE COMPUTATION
// ==========================================

function computeFoodConfidence(
  profile: RestaurantProfile,
  intent: IntentClassificationV2 | null,
): ConfidenceLevel {
  const dp = profile.deep_profile;
  const enrichConf = dp?.enrichment_confidence ?? 0;

  // enrichment_confidence is a 0-1 ratio (data completeness)
  // High: good enrichment + explicit cuisine intent
  if (enrichConf >= 0.5 && intent?.cuisine_importance === "high") return "high";
  if (enrichConf >= 0.5 && profile.cuisine_type) return "high";

  // Medium: some enrichment or basic DB data
  if (enrichConf >= 0.3 || profile.cuisine_type) return "medium";

  // Low: no enrichment, no cuisine type
  return "low";
}

function computeVibeConfidence(
  profile: RestaurantProfile,
  vibeDataPoints: number,
  vibeMaxDataPoints: number,
): ConfidenceLevel {
  const dp = profile.deep_profile;
  const enrichConf = dp?.enrichment_confidence ?? 0;
  const dataRatio = vibeMaxDataPoints > 0 ? vibeDataPoints / vibeMaxDataPoints : 0;

  if (enrichConf >= 0.5 && dataRatio >= 0.5) return "high";
  if (enrichConf >= 0.3 || dataRatio >= 0.3) return "medium";
  return "low";
}

function computeServiceConfidence(
  profile: RestaurantProfile,
): ConfidenceLevel {
  const dp = profile.deep_profile;
  const enrichConf = dp?.enrichment_confidence ?? 0;
  const hasOccasionScores = (profile.date_friendly_score ?? 0) > 0
    || (profile.group_friendly_score ?? 0) > 0
    || (profile.family_friendly_score ?? 0) > 0;

  if (enrichConf >= 0.5 && hasOccasionScores) return "high";
  if (enrichConf >= 0.3 || hasOccasionScores) return "medium";
  return "low";
}

function computeReputationConfidence(
  googleData: GooglePlaceData | null,
): ConfidenceLevel {
  if (!googleData) return "low";
  const count = googleData.google_review_count || 0;
  if (count >= 200) return "high";
  if (count >= 10) return "medium";
  return "low";
}

// Convenience always has high confidence (DB + filter data is reliable)
function computeConvenienceConfidence(): ConfidenceLevel {
  return "high";
}

// ==========================================
// CONFIDENCE ADJUSTMENT
// ==========================================

/**
 * Regress a raw factor score toward CONFIDENCE_PRIOR based on confidence level.
 * High confidence: no adjustment (multiplier 1.0)
 * Medium confidence: 75% raw + 25% prior
 * Low confidence: 50% raw + 50% prior
 */
function adjustForConfidence(rawScore: number, confidence: ConfidenceLevel): number {
  const mult = CONFIDENCE_MULTIPLIER[confidence];
  return rawScore * mult + CONFIDENCE_PRIOR * (1 - mult);
}

// ==========================================
// ABSORBED DEAL-BREAKER ADJUSTMENTS
// ==========================================

const PRICE_ORDER = ["$", "$$", "$$$", "$$$$"];

/**
 * Adjustments absorbed from the old applyDealBreakerPenalties() into the Food Quality factor.
 * - Dietary incompatibility penalty
 * - User liked/disliked cuisine
 * - Rejection avoidCuisines
 */
function foodQualityAbsorbedAdjustment(
  rawScore: number,
  profile: RestaurantProfile,
  dietaryRestrictions?: string[],
  userFeedback?: UserFeedbackSignals | null,
  rejectionSignals?: RejectionSignals,
): number {
  let adjusted = rawScore;

  // Dietary incompatibility (was in applyDealBreakerPenalties, scaled from composite to factor)
  // Original: -2.5 on composite for no dietary data, -2.0 for no match, -0.8 for partial
  // Factor scale: divide by ~2 since factor contributes ~30% of composite
  if (dietaryRestrictions && dietaryRestrictions.length > 0) {
    if (profile.dietary_options && profile.dietary_options.length > 0) {
      const anyMatch = dietaryRestrictions.some(dr => {
        const keywords = DIETARY_KEYWORDS[dr.toLowerCase()];
        if (!keywords) return false;
        return profile.dietary_options!.some(opt =>
          keywords.some(kw => opt.toLowerCase().includes(kw.toLowerCase()))
        );
      });
      if (!anyMatch) {
        // Check hierarchy (Vegan → Vegetarian partial credit)
        let hasHierarchyMatch = false;
        for (const dr of dietaryRestrictions) {
          const subsumes = DIETARY_HIERARCHY[dr.toLowerCase()];
          if (subsumes) {
            hasHierarchyMatch = subsumes.some(sub => {
              const subValues = DIETARY_KEYWORDS[sub];
              if (!subValues) return false;
              return profile.dietary_options!.some(opt =>
                subValues.some(sv => opt.toLowerCase().includes(sv.toLowerCase()))
              );
            });
            if (hasHierarchyMatch) break;
          }
        }
        if (hasHierarchyMatch) {
          adjusted -= 0.5; // Partial match penalty (was -0.8 on composite)
        } else {
          adjusted -= 1.5; // No match at all (was -2.0 on composite)
        }
      }
    } else {
      // No dietary data at all — risky for dietary-restricted users
      adjusted -= 2.0; // (was -2.5 on composite)
    }
  }

  // User feedback: liked/disliked cuisines (was in applyPersonalization)
  if (userFeedback && profile.cuisine_type) {
    if (userFeedback.likedCuisines.includes(profile.cuisine_type)) {
      adjusted += 0.8; // Familiarity bonus (was +1.0 on composite, scaled to factor)
    }
    if (userFeedback.dislikedCuisines.includes(profile.cuisine_type)) {
      adjusted -= 1.0; // Dislike penalty (was -1.0 on composite, kept same — strong signal)
    }
  }

  // Rejection avoidCuisines (was in applyPersonalization)
  if (rejectionSignals && profile.cuisine_type) {
    if (rejectionSignals.avoidCuisines.includes(profile.cuisine_type)) {
      // Only apply if not already penalized by dislikedCuisines
      const alreadyPenalized = userFeedback?.dislikedCuisines.includes(profile.cuisine_type);
      if (!alreadyPenalized) {
        adjusted -= 0.5; // Inferred avoidance (was -0.7 on composite, reduced for factor)
      }
    }
  }

  // User previously disliked this specific restaurant
  if (userFeedback?.dislikedRestaurantIds.includes(profile.id)) {
    adjusted -= 1.5; // Strong signal (was -2.0 on composite)
  }

  return adjusted;
}

/**
 * Adjustments absorbed from the old applyDealBreakerPenalties() into the Convenience factor.
 * - Price mismatch penalty
 * - Neighborhood mismatch penalty
 * - Rejection avoidPriceLevels
 */
function convenienceAbsorbedAdjustment(
  rawScore: number,
  profile: RestaurantProfile,
  priceLevel: string,
  neighborhood: string,
  rejectionSignals?: RejectionSignals,
): number {
  let adjusted = rawScore;

  // Price mismatch (was in applyDealBreakerPenalties, scaled for factor)
  let priceAlreadyPenalized = false;
  if (priceLevel && priceLevel !== "Any" && profile.price_level) {
    const userIdx = PRICE_ORDER.indexOf(priceLevel);
    const restIdx = PRICE_ORDER.indexOf(profile.price_level);
    if (userIdx >= 0 && restIdx >= 0) {
      const gap = restIdx - userIdx;
      if (gap >= 3) { adjusted -= 3.0; priceAlreadyPenalized = true; }
      else if (gap === 2) { adjusted -= 1.5; priceAlreadyPenalized = true; }
      else if (gap === 1) { adjusted -= 0.5; priceAlreadyPenalized = true; }
    }
  }

  // Neighborhood mismatch (was in applyDealBreakerPenalties)
  if (neighborhood && neighborhood !== "Anywhere" && profile.neighborhood_name) {
    if (profile.neighborhood_name.toLowerCase() !== neighborhood.toLowerCase()) {
      adjusted -= 0.6; // Same as V3.6 value
    }
  }

  // Rejection avoidPriceLevels (was in applyPersonalization)
  if (rejectionSignals && profile.price_level) {
    if (rejectionSignals.avoidPriceLevels.includes(profile.price_level)) {
      if (!priceAlreadyPenalized) {
        adjusted -= 1.0; // (was -1.5 on composite, reduced for factor)
      }
    }
  }

  return adjusted;
}

// ==========================================
// V4 DONDE MATCH (full pipeline)
// ==========================================

export interface V4DondeMatchInputs {
  occasion: string;
  specialRequest: string;
  neighborhood: string;
  priceLevel: string;
  googleData: GooglePlaceData | null;
  sentimentScore?: number | null;
  sentimentNegative?: number | null;
  intent: IntentClassification | IntentClassificationV2 | null;
  rejectionSignals?: RejectionSignals;
  userFeedback?: UserFeedbackSignals | null;
  clientTimeOfDay?: string | null;
  dietaryRestrictions?: string[];
}

export interface V4DondeMatchResult {
  dondeMatch: number;
  factors: V4Factors;
  weights: V4Weights;
  confidence: V4FactorConfidence;
  dataCompleteness: number;
  weightShiftReasons: string[];
  factorDetails?: Record<string, Record<string, V4SubComponent>>;
}

export function computeV4DondeMatch(
  profile: RestaurantProfile,
  inputs: V4DondeMatchInputs
): V4DondeMatchResult {
  const v2Intent = inputs.intent && "flavor_preferences" in inputs.intent
    ? inputs.intent as IntentClassificationV2
    : null;

  // ==========================================
  // Step 1: Compute raw factor scores (reuse V3 factor functions)
  // ==========================================

  const foodResult = computeFoodMatch(profile, inputs.intent, inputs.dietaryRestrictions, inputs.specialRequest);
  const settingResult = computeSettingFit(profile, inputs.occasion, inputs.intent);
  const atmosphereResult = computeAtmosphere(profile, inputs.occasion, inputs.intent, inputs.specialRequest);
  const reputationResult = computeReputation(profile, inputs.googleData, inputs.sentimentScore, inputs.sentimentNegative);
  const convenienceResult = computeConvenience(profile, inputs.intent, inputs.clientTimeOfDay, inputs.specialRequest);

  // ==========================================
  // Step 2: Absorb deal-breaker/personalization adjustments into factors
  // ==========================================

  const adjustedFood = foodQualityAbsorbedAdjustment(
    foodResult.score,
    profile,
    inputs.dietaryRestrictions,
    inputs.userFeedback,
    inputs.rejectionSignals,
  );

  const adjustedConvenience = convenienceAbsorbedAdjustment(
    convenienceResult.score,
    profile,
    inputs.priceLevel,
    inputs.neighborhood,
    inputs.rejectionSignals,
  );

  // ==========================================
  // Step 3: Compute confidence per factor
  // ==========================================

  const confidenceFood = computeFoodConfidence(profile, v2Intent);
  const confidenceVibe = computeVibeConfidence(profile, atmosphereResult.dataPoints, atmosphereResult.maxDataPoints);
  const confidenceService = computeServiceConfidence(profile);
  const confidenceReputation = computeReputationConfidence(inputs.googleData);
  const confidenceConvenience = computeConvenienceConfidence();

  const confidence: V4FactorConfidence = {
    foodQuality: confidenceFood,
    vibe: confidenceVibe,
    service: confidenceService,
    reputation: confidenceReputation,
    convenience: confidenceConvenience,
  };

  // ==========================================
  // Step 4: Apply confidence regression + floor at 1.0
  // ==========================================

  const rawFactors = {
    foodQuality: adjustedFood,
    vibe: atmosphereResult.score,
    service: settingResult.score,
    reputation: reputationResult.score,
    convenience: adjustedConvenience,
  };

  const factors: V4Factors = {
    foodQuality: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(rawFactors.foodQuality, confidenceFood))),
    vibe: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(rawFactors.vibe, confidenceVibe))),
    service: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(rawFactors.service, confidenceService))),
    reputation: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(rawFactors.reputation, confidenceReputation))),
    convenience: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(rawFactors.convenience, confidenceConvenience))),
  };

  // ==========================================
  // Step 5: Compute dynamic weights
  // ==========================================

  const { weights: dynamicWeights, appliedRules } = computeV4Weights(inputs.occasion, v2Intent);

  const weights: V4Weights = {
    foodQuality: dynamicWeights.foodQuality,
    vibe: dynamicWeights.vibe,
    service: dynamicWeights.service,
    reputation: dynamicWeights.reputation,
    convenience: dynamicWeights.convenience,
  };

  // ==========================================
  // Step 6: Geometric mean
  // Donde Score = (Π Factor_i ^ Weight_i) × 10
  // ==========================================

  const geometricMean =
    Math.pow(factors.foodQuality, weights.foodQuality) *
    Math.pow(factors.vibe, weights.vibe) *
    Math.pow(factors.service, weights.service) *
    Math.pow(factors.reputation, weights.reputation) *
    Math.pow(factors.convenience, weights.convenience);

  const dondeMatch = Math.min(99, Math.max(0, Math.round(geometricMean * 10)));

  // ==========================================
  // Step 7: Data completeness
  // ==========================================

  const totalDataPoints = foodResult.dataPoints + settingResult.dataPoints
    + atmosphereResult.dataPoints + reputationResult.dataPoints + convenienceResult.dataPoints;
  const totalMaxPoints = foodResult.maxDataPoints + settingResult.maxDataPoints
    + atmosphereResult.maxDataPoints + reputationResult.maxDataPoints + convenienceResult.maxDataPoints;
  const dataCompleteness = totalMaxPoints > 0 ? totalDataPoints / totalMaxPoints : 0;

  // ==========================================
  // Step 8: Collect sub-component details for UI drill-down
  // ==========================================

  const factorDetails: Record<string, Record<string, V4SubComponent>> = {};
  if (foodResult.details) factorDetails.food_quality = convertSubComponents(foodResult.details);
  if (settingResult.details) factorDetails.service = convertSubComponents(settingResult.details);
  if (atmosphereResult.details) factorDetails.vibe = convertSubComponents(atmosphereResult.details);
  if (reputationResult.details) factorDetails.reputation = convertSubComponents(reputationResult.details);
  if (convenienceResult.details) factorDetails.convenience = convertSubComponents(convenienceResult.details);

  return {
    dondeMatch,
    factors,
    weights,
    confidence,
    dataCompleteness,
    weightShiftReasons: appliedRules,
    factorDetails,
  };
}

// ==========================================
// V4 RE-RANK (uses geometric mean for ranking)
// ==========================================

export function reRankV4(
  profiles: RestaurantProfile[],
  occasion: string,
  specialRequest: string,
  rejectionSignals?: RejectionSignals,
  intent?: IntentClassification | IntentClassificationV2 | null,
  userFeedback?: UserFeedbackSignals | null,
  clientTimeOfDay?: string | null,
  dietaryRestrictions?: string[]
): RestaurantProfile[] {
  const scored = profiles.map(p => {
    const { dondeMatch } = computeV4DondeMatch(p, {
      occasion,
      specialRequest,
      neighborhood: "Anywhere",  // Don't penalize at ranking time
      priceLevel: "Any",         // Don't penalize at ranking time
      googleData: null,          // Not available yet
      intent: intent ?? null,
      rejectionSignals,
      userFeedback,
      clientTimeOfDay,
      dietaryRestrictions,
    });
    return { profile: p, score: dondeMatch };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.profile);
}

// ==========================================
// DEAL-BREAKER GATES (kept from V3 — pre-scoring filter)
// ==========================================

// Re-export from scoring-v3.ts (gates are still useful pre-scoring)
export { applyDealBreakerGates } from "./scoring-v3.ts";

// ==========================================
// HELPERS
// ==========================================

/** Convert V3SubComponent to V4SubComponent (same shape, just re-typed) */
function convertSubComponents(
  details: Record<string, V3SubComponent>
): Record<string, V4SubComponent> {
  const result: Record<string, V4SubComponent> = {};
  for (const [key, sub] of Object.entries(details)) {
    result[key] = { score: sub.score, max: sub.max, signal: sub.signal };
  }
  return result;
}
