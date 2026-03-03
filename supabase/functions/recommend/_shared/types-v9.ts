/**
 * Donde Match V9 — Type Definitions
 *
 * V9 replaces V8's weighted-mean + intent-multiplier architecture with:
 * - Score = Relevance(0-1) × Quality(0-100)
 * - Relevance is a GATE (dish > cuisine > vibe > open_ended)
 * - Quality is the RANK (food, reputation, vibe, service, convenience)
 * - Review Intelligence provides evidence-based dish/cuisine data
 * - No weight-shift rules — query type selects quality weight profile
 *
 * Backward compatible: V9ScoredCandidate can be converted to V7/V8 response shapes.
 */

import type { RestaurantProfile, DeepProfile } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { IntentClassificationV2 } from "./intent-classifier.ts";
import type {
  V7MatchNarrative,
  V7RejectionSignals,
  V7UserFeedbackSignals,
} from "./types-v7.ts";

// ==========================================
// REVIEW INTELLIGENCE TYPES
// ==========================================

/** Review intelligence data from restaurant_review_intelligence table */
export interface ReviewIntelligence {
  dish_catalog: string[];
  popular_dishes: string[];
  cuisine_signals: string[];
  review_food_quality: number | null;
  review_service_quality: number | null;
  review_ambiance_quality: number | null;
  review_value_score: number | null;
}

// ==========================================
// V9 CANDIDATE (from get_candidates_v9 RPC)
// ==========================================

/** Restaurant candidate with review intelligence from V9 RPC */
export interface V9Candidate extends RestaurantProfile {
  /** Review intelligence from restaurant_review_intelligence table */
  review_intelligence: ReviewIntelligence | null;
  /** Full-text search rank from ts_rank() — 0 to ~1 */
  ri_text_rank: number;
  /** Deep profile menu highlights (AI-predicted, used as fallback) */
  dp_menu_highlights: string[] | null;
}

// ==========================================
// V9 RELEVANCE TYPES
// ==========================================

/** The type of relevance match */
export type V9RelevanceType = "dish" | "cuisine" | "vibe" | "open_ended";

/** Relevance computation result */
export interface V9Relevance {
  /** Relevance score 0-1.0 — the GATE */
  score: number;
  /** What type of match this is */
  type: V9RelevanceType;
  /** Human-readable explanation */
  details: string;
}

// ==========================================
// V9 QUALITY TYPES
// ==========================================

/** Quality weight profile — how much each factor matters for this query type */
export interface V9QualityWeights {
  food: number;
  reputation: number;
  vibe: number;
  service: number;
  convenience: number;
}

// ==========================================
// V9 SCORING ENGINE TYPES
// ==========================================

/** All inputs needed to compute V9 score */
export interface V9ScoringContext {
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
}

/** V9 score result */
export interface V9ScoreResult {
  /** Final DondeMatch score (0-99) */
  dondeMatch: number;
  /** Relevance computation (the GATE) */
  relevance: V9Relevance;
  /** Quality score (0-100, the RANK) */
  quality: number;
  /** Quality weights used for this query type */
  qualityWeights: V9QualityWeights;
  /** Occasion bonus (±5 tiebreaker) */
  occasionBonus: number;
  /** Match narrative for UI */
  matchNarrative: V7MatchNarrative;
  /** Data completeness 0-1.0 */
  dataCompleteness: number;
}

// ==========================================
// V9 SCORED CANDIDATE
// ==========================================

export interface V9ScoredCandidate {
  profile: RestaurantProfile;
  dondeMatch: number;
  relevance: V9Relevance;
  quality: number;
  qualityWeights: V9QualityWeights;
  occasionBonus: number;
  matchNarrative: V7MatchNarrative;
  dataCompleteness: number;
  googleData?: GooglePlaceData | null;
  reviewIntelligence?: ReviewIntelligence | null;
}

// ==========================================
// V9 SCORING BREAKDOWN (API response shape)
// ==========================================

export interface V9ScoringBreakdown {
  relevance_score: number;
  relevance_type: V9RelevanceType;
  relevance_details: string;
  quality_score: number;
  occasion_bonus: number;
  quality_weights: V9QualityWeights;
  data_completeness: number;
}

// ==========================================
// V9 THRESHOLDS
// ==========================================

export const V9_THRESHOLDS = {
  /** Below this, expand beyond requested neighborhood */
  NEIGHBORHOOD_EXPANSION: 45,
  /** Below this, show "may not be a perfect fit" message */
  QUALITY_CALLOUT: 35,
  /** Below this, respond with "no good matches" */
  MINIMUM_VIABLE_MATCH: 20,
  /** Hard floor for relevance — below 10%, restaurant is definitively wrong */
  RELEVANCE_GATE: 0.10,
} as const;
