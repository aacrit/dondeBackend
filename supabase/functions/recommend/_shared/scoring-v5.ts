/**
 * Donde Match V5.0 — Stretched-Reputation Geometric Mean Scoring Engine
 *
 * Five human-intuitive factors: Food, Vibe, Service, Reputation, Convenience
 * Each factor scores 1-10. Dynamic weights driven by 3-layer + pool-size system (sum to 1.0).
 * Donde Score = (Product of Factor_i ^ Weight_i) x 10
 *
 * Key V5 innovations over V4:
 * - Google Rating stretched linear: clamp((rating - 4.0) / 0.9 * 10, 0, 10)
 *   Each 0.1 increment = 1.1 points. 4.7 vs 4.3 = 4.5 point spread.
 *   This is the DOMINANT sublayer in Reputation (65% weight).
 * - Reputation factor restructured: 4 sublayers with Google as L1 dominant.
 * - Convenience simplified: no price/neighborhood penalties (now hard-filtered).
 * - Food simplified: no dietary penalty (now hard-filtered). Keeps user feedback + rejection signals.
 * - Weight engine: 3-layer adaptive + candidate pool adaptation (weight-config-v5.ts).
 * - Confidence system unchanged from V4 (regression toward 5.5 prior).
 */

import type { RestaurantProfile } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { IntentClassificationV2 } from "./intent-classifier.ts";
import type {
  V5Factors,
  V5Weights,
  V5FactorConfidence,
  V5SubComponent,
  V5FactorResult,
  V5DondeMatchResult,
  V5DondeMatchInputs,
  V5RejectionSignals,
  V5UserFeedbackSignals,
} from "./types-v5.ts";
import type { ConfidenceLevel } from "./types.ts";

// Reuse V3 factor computations (well-tested through 6 expert review cycles)
import {
  computeFoodMatch,
  computeSettingFit,
  computeAtmosphere,
  computeConvenience,
} from "./scoring-v3.ts";
import type { V3SubComponent } from "./scoring-v3.ts";

// V5 weight engine
import { computeV5Weights } from "./weight-config-v5.ts";

// Shared dictionaries
import { CUISINE_KEYWORDS, DIETARY_KEYWORDS, DIETARY_HIERARCHY } from "./scoring.ts";

// ==========================================
// CONFIDENCE CONSTANTS
// ==========================================

const CONFIDENCE_MULTIPLIER: Record<ConfidenceLevel, number> = {
  high: 1.0,
  medium: 0.75,
  low: 0.5,
};

/** Regression target for uncertain data — pulls low-confidence scores toward neutral */
const CONFIDENCE_PRIOR = 5.5;

/** Minimum factor score to prevent geometric mean zero-collapse */
const FACTOR_FLOOR = 1.0;

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
// CONFIDENCE COMPUTATION (per factor)
// ==========================================

function computeFoodConfidence(
  profile: RestaurantProfile,
  intent: IntentClassificationV2 | null,
): ConfidenceLevel {
  const dp = profile.deep_profile;
  const enrichConf = dp?.enrichment_confidence ?? 0;

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

// ==========================================
// V5 REPUTATION FACTOR (new — stretched Google Rating)
// ==========================================

/**
 * V5 Reputation Factor — 4 sublayers, Google Rating as dominant sublayer.
 *
 * L1: Google Rating (0-10) — stretched linear, confidence-gated. 65% weight.
 *     Formula: clamp((rating - 4.0) / 0.9 * 10, 0, 10)
 *     Each 0.1 star increment = 1.1 points.
 *     4.0 = 0, 4.45 = 5, 4.9 = 10.
 *     Review count gates confidence (same thresholds as V3).
 *
 * L2: Review sentiment (0-2) — from Claude sentiment analysis of Google reviews.
 *
 * L3: Awards/recognition (0-1.5) — chef_notable, awards_recognition.
 *
 * L4: Community signal (0-1.5) — trending_score, cultural_authenticity.
 *
 * Normalization: reputation = min(10, (L1 * 0.65 + L2 + L3 + L4) / max_possible * 10)
 */
function computeReputationV5(
  profile: RestaurantProfile,
  googleData: GooglePlaceData | null,
  sentimentScore?: number | null,
  sentimentNegative?: number | null,
): V5FactorResult {
  let dataPoints = 0;
  let maxDataPoints = 0;
  const details: Record<string, V5SubComponent> = {};
  const dp = profile.deep_profile;

  // ---- L1: Google Rating (0-10 scale, stretched linear) ----
  maxDataPoints++;
  let googleScore = 0;
  if (googleData && googleData.google_rating != null) {
    dataPoints++;
    const rating = googleData.google_rating;
    const reviewCount = googleData.google_review_count || 0;

    // V5 stretch: linear mapping from 4.0-4.9 to 0-10
    // clamp((rating - 4.0) / 0.9 * 10, 0, 10)
    // Each 0.1 star = 1.11 points. 4.3 vs 4.7 = 4.44 point spread.
    const rawGoogleScore = Math.max(0, Math.min(10, (rating - 4.0) / 0.9 * 10));

    // Review count confidence gate (same thresholds as V3)
    const reviewConfidence = reviewCount >= 200 ? 1.0
      : reviewCount >= 50 ? 0.9
      : reviewCount >= 10 ? 0.8
      : 0.7;

    googleScore = rawGoogleScore * reviewConfidence;
    details.google = {
      score: googleScore,
      max: 10,
      signal: `${rating}\u2605 (${reviewCount} reviews, conf=${reviewConfidence})`,
    };
  } else {
    // No Google data: neutral midpoint
    googleScore = 5.0;
    details.google = { score: 5.0, max: 10, signal: "No Google data (neutral)" };
  }

  // ---- L2: Review sentiment (0-2) ----
  maxDataPoints++;
  let sentScore = 0;
  if (sentimentScore != null) {
    dataPoints++;
    sentScore = (sentimentScore / 10) * 2;
    // Penalize high negative sentiment
    if (sentimentNegative != null && sentimentNegative > 30) {
      sentScore -= Math.min(1.5, ((sentimentNegative - 30) / 40) * 1.5);
    }
    sentScore = Math.max(0, sentScore);
    details.sentiment = {
      score: sentScore,
      max: 2,
      signal: `Sentiment ${sentimentScore}/10`,
    };
  } else {
    // No sentiment data: neutral default
    sentScore = 1.0;
    details.sentiment = { score: 1.0, max: 2, signal: "No sentiment data" };
  }

  // ---- L3: Awards/recognition (0-1.5) ----
  maxDataPoints++;
  let awardsScore = 0;
  let awardsUsed = false;
  if (dp) {
    if (dp.chef_notable) {
      awardsScore += 0.75;
      awardsUsed = true;
    }
    if (dp.awards_recognition && dp.awards_recognition.length > 0) {
      awardsScore += 0.75;
      awardsUsed = true;
    }
    if (awardsUsed) {
      dataPoints++;
      awardsScore = Math.min(1.5, awardsScore);
    }
  }
  if (!awardsUsed) {
    awardsScore = 0;
    details.awards = { score: 0, max: 1.5, signal: "No awards data" };
  } else {
    details.awards = {
      score: awardsScore,
      max: 1.5,
      signal: dp?.awards_recognition?.join(", ") || (dp?.chef_notable ? "Notable chef" : "Recognized"),
    };
  }

  // ---- L4: Community signal (0-1.5) ----
  maxDataPoints++;
  let communityScore = 0;
  let communityUsed = false;
  if (dp) {
    // Trending score contribution
    if (profile.trending_score != null && profile.trending_score >= 7) {
      communityScore += 0.75;
      communityUsed = true;
    }
    // Cultural authenticity contribution
    if (dp.cultural_authenticity != null && dp.cultural_authenticity >= 7) {
      communityScore += 0.75;
      communityUsed = true;
    }
    if (communityUsed) {
      dataPoints++;
      communityScore = Math.min(1.5, communityScore);
    }
  }
  if (!communityUsed) {
    communityScore = 0;
    details.community = { score: 0, max: 1.5, signal: "No community data" };
  } else {
    const signals: string[] = [];
    if (profile.trending_score != null && profile.trending_score >= 7) signals.push("Trending");
    if (dp?.cultural_authenticity != null && dp.cultural_authenticity >= 7) signals.push("Culturally authentic");
    details.community = {
      score: communityScore,
      max: 1.5,
      signal: signals.join(", ") || "Community signal",
    };
  }

  // ---- Normalization: reputation = min(10, (L1 * 0.65 + L2 + L3 + L4) / max_possible * 10) ----
  // max_possible = 10 * 0.65 + 2 + 1.5 + 1.5 = 6.5 + 2 + 1.5 + 1.5 = 11.5
  const MAX_POSSIBLE = 10 * 0.65 + 2 + 1.5 + 1.5; // 11.5
  const rawReputation = googleScore * 0.65 + sentScore + awardsScore + communityScore;
  const reputation = Math.min(10, Math.max(0, (rawReputation / MAX_POSSIBLE) * 10));

  return {
    score: reputation,
    confidence: computeReputationConfidence(googleData),
    dataPoints,
    maxDataPoints,
    details,
  };
}

// ==========================================
// V5 CONVENIENCE FACTOR (simplified — no price/neighborhood penalties)
// ==========================================

/**
 * V5 Convenience Factor — wraps V3's computeConvenience but WITHOUT
 * the price mismatch penalty and neighborhood mismatch penalty that V4 absorbed.
 *
 * In V5, price and neighborhood are hard-filtered in the filter pipeline,
 * so the Convenience factor only measures timing, reservation accessibility,
 * and practical conveniences.
 */
function computeConvenienceV5(
  profile: RestaurantProfile,
  intent: IntentClassificationV2 | null,
  clientTimeOfDay?: string | null,
  specialRequest?: string,
): V5FactorResult {
  // Use V3's well-tested convenience computation directly.
  // V3 computes timing fit, reservation accessibility, wait time, payment notes,
  // BYOB matching, and parking — all of which remain relevant in V5.
  // The price/neighborhood penalties were added in V4's convenienceAbsorbedAdjustment,
  // which we deliberately skip here.
  const v3Result = computeConvenience(profile, intent, clientTimeOfDay, specialRequest);

  return {
    score: v3Result.score,
    confidence: "high", // Convenience always has high confidence
    dataPoints: v3Result.dataPoints,
    maxDataPoints: v3Result.maxDataPoints,
    details: v3Result.details ? convertDetails(v3Result.details) : undefined,
  };
}

// ==========================================
// V5 FOOD ABSORBED ADJUSTMENT (lighter than V4)
// ==========================================

/**
 * V5 Food Factor adjustments — lighter than V4.
 *
 * Changes from V4:
 * - REMOVED: dietary incompatibility penalty (dietary is now a hard filter in V5)
 * - KEPT: user feedback (liked/disliked cuisine)
 * - KEPT: rejection signals (avoidCuisines)
 * - KEPT: disliked restaurant penalty
 */
function foodAbsorbedAdjustmentV5(
  rawScore: number,
  profile: RestaurantProfile,
  userFeedback?: V5UserFeedbackSignals | null,
  rejectionSignals?: V5RejectionSignals,
): number {
  let adjusted = rawScore;

  // User feedback: liked/disliked cuisines
  if (userFeedback && profile.cuisine_type) {
    if (userFeedback.likedCuisines.includes(profile.cuisine_type)) {
      adjusted += 0.8; // Familiarity bonus
    }
    if (userFeedback.dislikedCuisines.includes(profile.cuisine_type)) {
      adjusted -= 1.0; // Dislike penalty (strong signal)
    }
  }

  // Rejection avoidCuisines — inferred avoidance from "Try Another" cycles
  if (rejectionSignals && profile.cuisine_type) {
    if (rejectionSignals.avoidCuisines.includes(profile.cuisine_type)) {
      // Only apply if not already penalized by dislikedCuisines
      const alreadyPenalized = userFeedback?.dislikedCuisines.includes(profile.cuisine_type);
      if (!alreadyPenalized) {
        adjusted -= 0.5; // Inferred avoidance (lighter than explicit dislike)
      }
    }
  }

  // User previously disliked this specific restaurant
  if (userFeedback?.dislikedRestaurantIds.includes(profile.id)) {
    adjusted -= 1.5; // Strong signal
  }

  return adjusted;
}

// ==========================================
// V5 DONDE MATCH (full pipeline)
// ==========================================

/**
 * Compute the V5 Donde Match score for a single restaurant profile.
 *
 * Pipeline:
 * 1. Compute raw factor scores (reuse V3 for Food, Setting/Service, Atmosphere/Vibe)
 * 2. Compute V5 Reputation (stretched Google Rating) and V5 Convenience (no price/neighborhood)
 * 3. Apply absorbed food adjustments (no dietary penalty — hard filtered)
 * 4. Compute per-factor confidence
 * 5. Apply confidence regression + floor at 1.0
 * 6. Compute dynamic weights (3-layer + pool-size)
 * 7. Geometric mean -> Donde Score
 * 8. Data completeness
 * 9. Collect sub-component details
 */
export function computeV5DondeMatch(
  profile: RestaurantProfile,
  inputs: V5DondeMatchInputs,
): V5DondeMatchResult {
  // ==========================================
  // Step 1: Compute raw factor scores
  // ==========================================

  const foodResult = computeFoodMatch(
    profile, inputs.intent, inputs.dietaryRestrictions, inputs.specialRequest,
  );
  const settingResult = computeSettingFit(profile, inputs.occasion, inputs.intent);
  const atmosphereResult = computeAtmosphere(
    profile, inputs.occasion, inputs.intent, inputs.specialRequest,
  );
  const reputationResult = computeReputationV5(
    profile, inputs.googleData, inputs.sentimentScore, inputs.sentimentNegative,
  );
  const convenienceResult = computeConvenienceV5(
    profile, inputs.intent, inputs.clientTimeOfDay, inputs.specialRequest,
  );

  // ==========================================
  // Step 2: Absorb food adjustments (lighter than V4 — no dietary penalty)
  // ==========================================

  const adjustedFood = foodAbsorbedAdjustmentV5(
    foodResult.score,
    profile,
    inputs.userFeedback,
    inputs.rejectionSignals,
  );

  // ==========================================
  // Step 3: Compute confidence per factor
  // ==========================================

  const confidence: V5FactorConfidence = {
    food: computeFoodConfidence(profile, inputs.intent),
    vibe: computeVibeConfidence(profile, atmosphereResult.dataPoints, atmosphereResult.maxDataPoints),
    service: computeServiceConfidence(profile),
    reputation: computeReputationConfidence(inputs.googleData),
    convenience: "high", // Convenience always has high confidence
  };

  // ==========================================
  // Step 4: Apply confidence regression + floor at 1.0
  // ==========================================

  const factors: V5Factors = {
    food: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(adjustedFood, confidence.food))),
    vibe: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(atmosphereResult.score, confidence.vibe))),
    service: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(settingResult.score, confidence.service))),
    reputation: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(reputationResult.score, confidence.reputation))),
    convenience: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(convenienceResult.score, confidence.convenience))),
  };

  // ==========================================
  // Step 5: Compute dynamic weights (3-layer + pool-size)
  // ==========================================

  const { weights, appliedRules } = computeV5Weights(
    inputs.occasion,
    inputs.intent,
    confidence,
    inputs.candidatePoolSize ?? 15,
    inputs.clientTimeOfDay,
  );

  // ==========================================
  // Step 6: Geometric mean
  // Donde Score = (Product of Factor_i ^ Weight_i) x 10
  // ==========================================

  const geometricMean =
    Math.pow(factors.food, weights.food) *
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

  const factorDetails: Record<string, Record<string, V5SubComponent>> = {};
  if (foodResult.details) factorDetails.food = convertDetails(foodResult.details);
  if (settingResult.details) factorDetails.service = convertDetails(settingResult.details);
  if (atmosphereResult.details) factorDetails.vibe = convertDetails(atmosphereResult.details);
  if (reputationResult.details) factorDetails.reputation = reputationResult.details;
  if (convenienceResult.details) factorDetails.convenience = convenienceResult.details;

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
// V5 RE-RANK
// ==========================================

/**
 * Re-rank a list of restaurant profiles using V5 scoring.
 *
 * Used during the ranking phase before Claude pick. Google data is not yet
 * available at this stage, so reputation scores will be based on DB data only.
 * Price and neighborhood are already hard-filtered, so we pass neutral values.
 */
export function reRankV5(
  profiles: RestaurantProfile[],
  occasion: string,
  specialRequest: string,
  intent: IntentClassificationV2 | null,
  dietaryRestrictions?: string[],
  candidatePoolSize?: number,
  clientTimeOfDay?: string | null,
): Array<{ profile: RestaurantProfile; result: V5DondeMatchResult }> {
  const scored = profiles.map(profile => {
    const result = computeV5DondeMatch(profile, {
      occasion,
      specialRequest,
      neighborhood: "Anywhere",  // Already filtered
      priceLevel: "Any",         // Already filtered
      googleData: null,          // Not yet available at ranking time
      intent,
      dietaryRestrictions,
      candidatePoolSize: candidatePoolSize ?? profiles.length,
      clientTimeOfDay,
    });
    return { profile, result };
  });

  scored.sort((a, b) => b.result.dondeMatch - a.result.dondeMatch);
  return scored;
}

// ==========================================
// HELPERS
// ==========================================

/** Convert V3SubComponent records to V5SubComponent records (same shape, re-typed) */
function convertDetails(
  details: Record<string, V3SubComponent>,
): Record<string, V5SubComponent> {
  const result: Record<string, V5SubComponent> = {};
  for (const [key, sub] of Object.entries(details)) {
    result[key] = { score: sub.score, max: sub.max, signal: sub.signal };
  }
  return result;
}
