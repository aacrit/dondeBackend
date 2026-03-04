/**
 * Donde Match V9 — Type Definitions
 *
 * V9 is the active scoring engine. All prior versions (V3-V8) are archived.
 *
 * Architecture:
 * - Score = Relevance(0-1) × Quality(0-100) + OccasionBonus(±5)
 * - Relevance is a GATE (dish > cuisine > vibe > open_ended)
 * - Quality is the RANK (food, reputation, vibe, service, convenience)
 * - Review Intelligence provides evidence-based dish/cuisine data
 * - No weight-shift rules — query type selects quality weight profile
 */

import type { RestaurantProfile, ConfidenceLevel } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { IntentClassificationV2 } from "./intent-classifier.ts";

// ==========================================
// SHARED TYPES (formerly in types-v7.ts)
// ==========================================

/**
 * Match narrative — tells the story of WHY this match works.
 * Used by the frontend to render the match deep-dive / "why this pick" card.
 */
export interface MatchNarrative {
  /** The single strongest factor driving this match (e.g., "food", "vibe") */
  strongest_factor: string;
  /** Human-readable label for the strongest factor (e.g., "Exceptional Food Quality") */
  strongest_factor_label: string;
  /** Top 2-3 key signals that make this a good match — short, punchy strings */
  key_signals: string[];
  /** How this restaurant compares to others in the ranked queue */
  comparison_context: string | null;
  /** One-sentence narrative summary combining strongest factor + key signals */
  summary: string;
  /** Optional: which factor(s) are holding this match back */
  weak_spots: string[];
  /** Optional: confidence caveat when data is sparse */
  confidence_caveat: string | null;
}

/** Rejection signals from previous "Try Another" cycles */
export interface RejectionSignals {
  avoidCuisines: string[];
  avoidPriceLevels: string[];
  avoidRestaurantIds: string[];
}

/** User feedback signals from like/dislike history */
export interface UserFeedbackSignals {
  likedCuisines: string[];
  dislikedCuisines: string[];
  likedRestaurantIds: string[];
  dislikedRestaurantIds: string[];
}

/** Intent Boost — Claude's discretionary override */
export interface IntentBoost {
  active: boolean;
  reason: string;
  boost_points: number;
  base_score: number;
  original_engine_rank: number;
}

/** Claude recommendation output (parsed from JSON response) */
export interface ClaudeRecommendation {
  restaurant_index: number;
  match_headline: string | null;
  recommendation: string;
  insider_tip: string | null;
  intent_boost: boolean;
  boost_reason: string | null;
  boost_points: number;
  sentiment_score: number | null;
  sentiment_summary: string | null;
}

/** A single item in the pre-computed ranked queue */
export interface RankedQueueItem {
  rank: number;
  restaurant: Record<string, unknown>;
  recommendation: string;
  match_headline: string | null;
  insider_tip: string | null;
  donde_match: number;
  scoring_v9: V9ScoringBreakdown;
  match_narrative: MatchNarrative | null;
  scores: Record<string, number>;
  deep_context: Record<string, unknown> | null;
  tags: string[];
  intent_boost: IntentBoost | null;
}

/**
 * Score tiers — 6 tiers for UI tone modulation.
 *
 * 90+    Outstanding Match
 * 80-89  Excellent Match
 * 70-79  Strong Pick
 * 60-69  Solid Option
 * 50-59  Worth a Try
 * <50    Best Available
 */
export type ScoreTier =
  | "outstanding_match"
  | "excellent_match"
  | "strong_pick"
  | "solid_option"
  | "worth_a_try"
  | "best_available";

export function getScoreTier(score: number): ScoreTier {
  if (score >= 90) return "outstanding_match";
  if (score >= 80) return "excellent_match";
  if (score >= 70) return "strong_pick";
  if (score >= 60) return "solid_option";
  if (score >= 50) return "worth_a_try";
  return "best_available";
}

export function getScoreTierLabel(tier: ScoreTier): string {
  switch (tier) {
    case "outstanding_match": return "Outstanding Match";
    case "excellent_match": return "Excellent Match";
    case "strong_pick": return "Strong Pick";
    case "solid_option": return "Solid Option";
    case "worth_a_try": return "Worth a Try";
    case "best_available": return "Best Available";
  }
}

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
// V9 SUB-COMPONENT DETAILS (for frontend drill-down)
// ==========================================

/** V9 sub-component detail within a factor */
export interface V9SubComponent {
  /** Points earned */
  score: number;
  /** Maximum possible points */
  max: number;
  /** Human-readable explanation */
  signal: string;
}

/** V9 per-factor details map (factorKey -> subKey -> V9SubComponent) */
export type V9FactorDetails = Record<string, Record<string, V9SubComponent>>;

/** Per-factor confidence (derived from data availability) */
export type V9FactorConfidence = Record<string, "high" | "medium" | "low">;

/** Return type for instrumented compute*Quality functions */
export interface V9QualityResult {
  score: number;
  details: Record<string, V9SubComponent>;
  confidence: "high" | "medium" | "low";
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
  rejectionSignals?: RejectionSignals;
  userFeedback?: UserFeedbackSignals | null;
  clientTimeOfDay?: string | null;
  dietaryRestrictions?: string[];
}

/** Individual factor scores (0-10 each) — for UI "Why This Match" bars */
export interface V9Factors {
  food: number;
  vibe: number;
  service: number;
  reputation: number;
  convenience: number;
}

/** V9 score result */
export interface V9ScoreResult {
  /** Final DondeMatch score (0-99) */
  dondeMatch: number;
  /** Relevance computation (the GATE) */
  relevance: V9Relevance;
  /** Quality score (0-100, the RANK) */
  quality: number;
  /** Individual factor scores (0-10 each) */
  factors: V9Factors;
  /** Quality weights used for this query type */
  qualityWeights: V9QualityWeights;
  /** Occasion bonus (±5 tiebreaker) */
  occasionBonus: number;
  /** Match narrative for UI */
  matchNarrative: MatchNarrative;
  /** Data completeness 0-1.0 */
  dataCompleteness: number;
  /** Sub-component breakdown per factor (for frontend drill-down) */
  factorDetails: V9FactorDetails;
  /** Per-factor confidence (drives "limited data" UI notes) */
  factorConfidence: V9FactorConfidence;
}

// ==========================================
// V9 SCORED CANDIDATE
// ==========================================

export interface V9ScoredCandidate {
  profile: RestaurantProfile;
  dondeMatch: number;
  relevance: V9Relevance;
  quality: number;
  factors: V9Factors;
  qualityWeights: V9QualityWeights;
  occasionBonus: number;
  matchNarrative: MatchNarrative;
  dataCompleteness: number;
  factorDetails: V9FactorDetails;
  factorConfidence: V9FactorConfidence;
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
  /** Individual factor scores (0-10) — for frontend "Why This Match" bars */
  food: number;
  vibe: number;
  service: number;
  reputation: number;
  convenience: number;
  /** Alias for quality_weights (frontend expects weights_used) */
  weights_used: V9QualityWeights;
  /** Sub-component breakdown per factor (for frontend drill-down) */
  factor_details?: V9FactorDetails;
  /** Per-factor confidence (drives "limited data" UI notes) */
  confidence?: V9FactorConfidence;
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
