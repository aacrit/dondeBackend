/**
 * Donde Match V5 — Type Definitions
 *
 * V5 engine types for 5-factor scoring, intent boost, and dynamic weights.
 * All types prefixed with V5 to avoid collision with legacy types.
 */

import type { RestaurantProfile, DeepProfile, ConfidenceLevel } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { IntentClassificationV2 } from "./intent-classifier.ts";

// ==========================================
// V5 FACTOR TYPES
// ==========================================

/** V5 five-factor scores: Food, Vibe, Service, Reputation, Convenience */
export interface V5Factors {
  food: number;        // 0-10
  vibe: number;        // 0-10
  service: number;     // 0-10
  reputation: number;  // 0-10
  convenience: number; // 0-10
}

/** V5 dynamic weights (sum to 1.0) */
export interface V5Weights {
  food: number;
  vibe: number;
  service: number;
  reputation: number;
  convenience: number;
}

/** Confidence per V5 factor */
export interface V5FactorConfidence {
  food: ConfidenceLevel;
  vibe: ConfidenceLevel;
  service: ConfidenceLevel;
  reputation: ConfidenceLevel;
  convenience: ConfidenceLevel;
}

/** Sub-component detail within a factor */
export interface V5SubComponent {
  score: number;      // actual points earned
  max: number;        // maximum possible points for this layer
  signal: string;     // brief human-readable explanation
}

/** Factor result with sub-components and confidence */
export interface V5FactorResult {
  score: number;           // 0-10 raw score
  confidence: ConfidenceLevel;
  dataPoints: number;
  maxDataPoints: number;
  details?: Record<string, V5SubComponent>;
}

// ==========================================
// V5 WEIGHT TYPES
// ==========================================

export interface V5WeightShiftCondition {
  occasion?: string[];
  cuisineImportance?: "high" | "medium" | "low";
  emotionalIntent?: string;
  priceSensitive?: boolean;
  spontaneous?: boolean;
  planned?: boolean;
  dateType?: string;
  groupSizeHint?: string;
  timeOfDay?: string;
  /** True if any of these keywords appear in intent.vibe_keywords */
  vibeKeywords?: string[];
  /** True if intent.target_cuisines contains a bar/cocktail venue type */
  targetCuisineIsBar?: boolean;
}

export interface V5WeightShiftRule {
  condition: V5WeightShiftCondition;
  deltas: Partial<V5Weights>;
  label?: string;
}

// ==========================================
// V5 INTENT BOOST
// ==========================================

/** Intent Boost — Claude's discretionary override */
export interface IntentBoost {
  active: boolean;
  reason: string;          // ≤8 words, e.g., "Serves authentic Chai"
  boost_points: number;    // 5-25 points added to DondeScore
  base_score: number;      // DondeScore before boost
  original_engine_rank: number; // Where the boosted candidate ranked before boost
}

// ==========================================
// V5 SCORING ENGINE TYPES
// ==========================================

export interface V5DondeMatchInputs {
  occasion: string;
  specialRequest: string;
  neighborhood: string;
  priceLevel: string;
  googleData: GooglePlaceData | null;
  sentimentScore?: number | null;
  sentimentNegative?: number | null;
  intent: IntentClassificationV2 | null;
  rejectionSignals?: V5RejectionSignals;
  userFeedback?: V5UserFeedbackSignals | null;
  clientTimeOfDay?: string | null;
  dietaryRestrictions?: string[];
  candidatePoolSize?: number;  // NEW: for pool-size adaptation
}

export interface V5DondeMatchResult {
  dondeMatch: number;
  factors: V5Factors;
  weights: V5Weights;
  confidence: V5FactorConfidence;
  dataCompleteness: number;
  weightShiftReasons: string[];
  factorDetails?: Record<string, Record<string, V5SubComponent>>;
}

/** Rejection signals from previous "Try Another" cycles */
export interface V5RejectionSignals {
  avoidCuisines: string[];
  avoidPriceLevels: string[];
  avoidRestaurantIds: string[];
}

/** User feedback signals from like/dislike history */
export interface V5UserFeedbackSignals {
  likedCuisines: string[];
  dislikedCuisines: string[];
  likedRestaurantIds: string[];
  dislikedRestaurantIds: string[];
}

// ==========================================
// V5 FILTER PIPELINE TYPES
// ==========================================

export interface V5FilterContext {
  exclude: string[];
  neighborhood: string;
  priceLevel: string;
  dietaryRestrictions: string[];
  cuisineImportance: "high" | "medium" | "low";
  targetCuisines: string[];
  openNow: boolean;
}

export interface V5FilterResult {
  candidates: RestaurantProfile[];
  relaxationApplied: string[];
  originalCount: number;
  afterFilterCount: number;
}

// ==========================================
// V5 RESPONSE TYPES
// ==========================================

export interface V5ScoringBreakdown {
  food: number;
  vibe: number;
  service: number;
  reputation: number;
  convenience: number;
  weights_used: {
    food: number;
    vibe: number;
    service: number;
    reputation: number;
    convenience: number;
  };
  weight_shift_reasons: string[];
  confidence: {
    food: ConfidenceLevel;
    vibe: ConfidenceLevel;
    service: ConfidenceLevel;
    reputation: ConfidenceLevel;
    convenience: ConfidenceLevel;
  };
  data_completeness: number;
  factor_details?: Record<string, Record<string, V5SubComponent>>;
}

/** V5 Claude recommendation output (parsed from JSON response) */
export interface V5ClaudeRecommendation {
  restaurant_index: number;
  recommendation: string;
  insider_tip: string | null;
  intent_boost: boolean;
  boost_reason: string | null;
  boost_points: number;
  sentiment_score: number | null;
  sentiment_summary: string | null;
}

/** Scored candidate ready for Claude prompt */
export interface V5ScoredCandidate {
  profile: RestaurantProfile;
  dondeMatch: number;
  factors: V5Factors;
  weights: V5Weights;
  confidence: V5FactorConfidence;
  dataCompleteness: number;
  weightShiftReasons: string[];
  factorDetails?: Record<string, Record<string, V5SubComponent>>;
  googleData?: GooglePlaceData | null;
}

/** Score tiers for tone modulation */
export type V5ScoreTier = "perfect_match" | "strong_pick" | "solid_option" | "worth_a_try" | "best_available";

export function getScoreTier(score: number): V5ScoreTier {
  if (score >= 88) return "perfect_match";
  if (score >= 75) return "strong_pick";
  if (score >= 60) return "solid_option";
  if (score >= 45) return "worth_a_try";
  return "best_available";
}

export function getScoreTierLabel(tier: V5ScoreTier): string {
  switch (tier) {
    case "perfect_match": return "Perfect Match";
    case "strong_pick": return "Strong Pick";
    case "solid_option": return "Solid Option";
    case "worth_a_try": return "Worth a Try";
    case "best_available": return "Best Available";
  }
}
