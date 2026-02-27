/**
 * Donde Match V8 — Type Definitions
 *
 * V8 replaces V7's geometric mean + tiebreaker architecture with:
 * - Arithmetic weighted mean for base quality
 * - Intent alignment baked into the score as a multiplier
 * - 12 consolidated weight-shift rules (down from 28)
 * - Single confidence function (replaces dual system)
 *
 * Backward compatible: V8ScoredCandidate is a superset of V7ScoredCandidate.
 */

import type { RestaurantProfile, ConfidenceLevel } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { IntentClassificationV2 } from "./intent-classifier.ts";
import type {
  V7MatchNarrative,
  V7RejectionSignals,
  V7UserFeedbackSignals,
  V7SubComponent,
} from "./types-v7.ts";

// ==========================================
// V8 FACTOR TYPES
// ==========================================

/** V8 five-factor scores: Food, Vibe, Service, Reputation, Convenience */
export interface V8Factors {
  food: number;        // 0-10
  vibe: number;        // 0-10
  service: number;     // 0-10
  reputation: number;  // 0-10
  convenience: number; // 0-10
}

/** V8 dynamic weights (sum to 1.0) */
export interface V8Weights {
  food: number;
  vibe: number;
  service: number;
  reputation: number;
  convenience: number;
}

/** Sub-component detail within a factor */
export interface V8SubComponent {
  score: number;
  max: number;
  signal: string;
}

// ==========================================
// V8 INTENT ALIGNMENT
// ==========================================

export interface V8IntentAlignment {
  /** Overall intent alignment score 0-1.0 */
  score: number;
  /** Cuisine alignment score 0-1.0 */
  cuisine: number;
  /** Dish alignment score 0-1.0 */
  dish: number;
  /** Vibe alignment score 0-1.0 */
  vibe: number;
  /** Constraint alignment score 0-1.0 */
  constraints: number;
  /** Whether any intent signals were active (if false, multiplier = 1.0) */
  hasActiveSignals: boolean;
}

// ==========================================
// V8 SCORING ENGINE TYPES
// ==========================================

export interface V8DondeMatchInputs {
  occasion: string;
  specialRequest: string;
  neighborhood: string;
  priceLevel: string;
  googleData: GooglePlaceData | null;
  sentimentScore?: number | null;
  sentimentNegative?: number | null;
  intent: IntentClassificationV2 | null;
  rejectionSignals?: V7RejectionSignals;
  userFeedback?: V7UserFeedbackSignals | null;
  clientTimeOfDay?: string | null;
  dietaryRestrictions?: string[];
  candidatePoolSize?: number;
}

export interface V8DondeMatchResult {
  dondeMatch: number;
  /** Pre-intent-multiplier score (0-100) */
  baseQuality: number;
  /** Intent multiplier applied: 0.70-1.00 (or 1.0 for open queries) */
  intentMultiplier: number;
  factors: V8Factors;
  weights: V8Weights;
  intentAlignment: V8IntentAlignment;
  matchNarrative: V7MatchNarrative;
  dataCompleteness: number;
  weightShiftReasons: string[];
  factorDetails: Record<string, Record<string, V8SubComponent>>;
}

// ==========================================
// V8 WEIGHT TYPES
// ==========================================

export interface V8WeightShiftRule {
  condition: V8WeightShiftCondition;
  deltas: Partial<V8Weights>;
  label: string;
}

export interface V8WeightShiftCondition {
  occasion?: string[];
  cuisineImportance?: "high" | "low";
  emotionalIntent?: string[];
  spontaneous?: boolean;
  vibeKeywords?: string[];
  targetTags?: string[];
  targetCuisineIsBar?: boolean;
  dishLevelIntent?: boolean;
}

// ==========================================
// V8 SCORED CANDIDATE
// ==========================================

export interface V8ScoredCandidate {
  profile: RestaurantProfile;
  dondeMatch: number;
  baseQuality: number;
  intentMultiplier: number;
  factors: V8Factors;
  weights: V8Weights;
  intentAlignment: V8IntentAlignment;
  matchNarrative: V7MatchNarrative;
  dataCompleteness: number;
  weightShiftReasons: string[];
  factorDetails: Record<string, Record<string, V8SubComponent>>;
  googleData?: GooglePlaceData | null;
}

// ==========================================
// V8 SCORING BREAKDOWN (API response shape)
// ==========================================

export interface V8ScoringBreakdown {
  food: number;
  vibe: number;
  service: number;
  reputation: number;
  convenience: number;
  base_quality: number;
  intent_multiplier: number;
  weights_used: {
    food: number;
    vibe: number;
    service: number;
    reputation: number;
    convenience: number;
  };
  weight_shift_reasons: string[];
  data_completeness: number;
  intent_alignment: {
    score: number;
    cuisine: number;
    dish: number;
    vibe: number;
    constraints: number;
    has_active_signals: boolean;
  };
  factor_details?: Record<string, Record<string, V8SubComponent>>;
}
