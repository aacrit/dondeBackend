/**
 * Donde Match V7 — Type Definitions
 *
 * Consolidated types for the V7 integrated scoring + ranking + UI system.
 * Replaces types-v5.ts as the single source of truth.
 *
 * V7 key additions over V5:
 * - RankedQueue: Pre-computed top-N results for instant "Try Again"
 * - MatchNarrative: Structured storytelling data for the UI match deep-dive
 * - IntentAlignment: Explicit metric tracking how well a restaurant matches user intent
 * - 6-tier scoring: Outstanding Match → Best Available
 * - Factor confidence propagated to UI for transparency
 *
 * Backward compatibility: V7ScoredCandidate is a superset of V5ScoredCandidate
 * (adds `rank`, `intentAlignment`, `matchNarrative`).
 */

import type { RestaurantProfile, ConfidenceLevel } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { IntentClassificationV2 } from "./intent-classifier.ts";

// ==========================================
// V7 FACTOR TYPES
// ==========================================

/** V7 five-factor scores: Food, Vibe, Service, Reputation, Convenience */
export interface V7Factors {
  food: number;        // 0-10
  vibe: number;        // 0-10
  service: number;     // 0-10
  reputation: number;  // 0-10
  convenience: number; // 0-10
}

/** V7 dynamic weights (sum to 1.0) */
export interface V7Weights {
  food: number;
  vibe: number;
  service: number;
  reputation: number;
  convenience: number;
}

/** Confidence per V7 factor */
export interface V7FactorConfidence {
  food: ConfidenceLevel;
  vibe: ConfidenceLevel;
  service: ConfidenceLevel;
  reputation: ConfidenceLevel;
  convenience: ConfidenceLevel;
}

/** Sub-component detail within a factor */
export interface V7SubComponent {
  score: number;      // actual points earned
  max: number;        // maximum possible points for this layer
  signal: string;     // brief human-readable explanation
}

/** Factor result with sub-components and confidence */
export interface V7FactorResult {
  score: number;           // 0-10 raw score
  confidence: ConfidenceLevel;
  dataPoints: number;
  maxDataPoints: number;
  details?: Record<string, V7SubComponent>;
}

// ==========================================
// V7 WEIGHT TYPES
// ==========================================

export interface V7WeightShiftCondition {
  occasion?: string[];
  cuisineImportance?: "high" | "medium" | "low";
  emotionalIntent?: string;
  priceSensitive?: boolean;
  spontaneous?: boolean;
  planned?: boolean;
  dateType?: string;
  groupSizeHint?: string;
  timeOfDay?: string;
  vibeKeywords?: string[];
  targetTags?: string[];
  targetCuisineIsBar?: boolean;
  dishLevelIntent?: boolean;
}

export interface V7WeightShiftRule {
  condition: V7WeightShiftCondition;
  deltas: Partial<V7Weights>;
  label?: string;
  /** V7: Maximum additive contribution from this rule to any single factor */
  cap?: number;
}

// ==========================================
// V7 INTENT ALIGNMENT
// ==========================================

/** V7: Explicit intent alignment scoring — how well does this restaurant match what the user asked for */
export interface V7IntentAlignment {
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
}

// ==========================================
// V7 MATCH NARRATIVE (UI match story)
// ==========================================

/**
 * V7: Tells the story of WHY this match works for the user.
 * Used by the frontend to render the match deep-dive / "why this pick" card.
 *
 * The narrative is computed after scoring and combines factor data,
 * intent alignment, and comparison context into a structured story.
 */
export interface V7MatchNarrative {
  /** The single strongest factor driving this match (e.g., "food", "vibe") */
  strongest_factor: string;
  /** Human-readable label for the strongest factor (e.g., "Exceptional Food Quality") */
  strongest_factor_label: string;

  /** Top 2-3 key signals that make this a good match — short, punchy strings */
  key_signals: string[];

  /**
   * How this restaurant compares to others in the ranked queue.
   * Set during reRankV7 when pool context is available.
   * e.g., "12 points ahead of next option"
   */
  comparison_context: string | null;

  /**
   * One-sentence narrative summary combining strongest factor + key signals.
   * Ready to render directly in the UI.
   */
  summary: string;

  /** Optional: which factor(s) are holding this match back */
  weak_spots: string[];

  /** Optional: confidence caveat when data is sparse */
  confidence_caveat: string | null;
}

// ==========================================
// V7 INTENT BOOST
// ==========================================

/** Intent Boost — Claude's discretionary override */
export interface IntentBoost {
  active: boolean;
  reason: string;          // <=8 words, e.g., "Serves authentic Chai"
  boost_points: number;    // 5-25 points added to DondeScore
  base_score: number;      // DondeScore before boost
  original_engine_rank: number; // Where the boosted candidate ranked before boost
}

// ==========================================
// V7 SCORING ENGINE TYPES
// ==========================================

export interface V7DondeMatchInputs {
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

export interface V7DondeMatchResult {
  dondeMatch: number;
  factors: V7Factors;
  weights: V7Weights;
  confidence: V7FactorConfidence;
  /** V7: How well this restaurant matches what the user actually asked for */
  intentAlignment: V7IntentAlignment;
  /** V7: Structured narrative for the UI match story */
  matchNarrative?: V7MatchNarrative;
  dataCompleteness: number;
  weightShiftReasons: string[];
  factorDetails?: Record<string, Record<string, V7SubComponent>>;
}

/** Rejection signals from previous "Try Another" cycles */
export interface V7RejectionSignals {
  avoidCuisines: string[];
  avoidPriceLevels: string[];
  avoidRestaurantIds: string[];
}

/** User feedback signals from like/dislike history */
export interface V7UserFeedbackSignals {
  likedCuisines: string[];
  dislikedCuisines: string[];
  likedRestaurantIds: string[];
  dislikedRestaurantIds: string[];
}

// ==========================================
// V7 FILTER PIPELINE TYPES
// ==========================================

export interface V7FilterContext {
  exclude: string[];
  neighborhood: string;
  priceLevel: string;
  dietaryRestrictions: string[];
  cuisineImportance: "high" | "medium" | "low";
  targetCuisines: string[];
  openNow: boolean;
}

export interface V7FilterResult {
  candidates: RestaurantProfile[];
  relaxationApplied: string[];
  originalCount: number;
  afterFilterCount: number;
}

// ==========================================
// V7 RANKED QUEUE (Pre-computed results for instant "Try Again")
// ==========================================

/**
 * A single item in the pre-computed ranked queue.
 *
 * Contains all the data the frontend needs to render a recommendation card
 * WITHOUT re-querying the scoring engine. When the user taps "Try Again",
 * the next item is popped from the queue and rendered instantly.
 */
export interface V7RankedQueueItem {
  /** Position in the ranked queue (1-based: 1 = top pick) */
  rank: number;
  /** Restaurant profile data — lightweight shape for the frontend */
  restaurant: Record<string, unknown>;
  /** Pre-generated AI recommendation blurb */
  recommendation: string;
  /** Match headline (e.g., "Your Perfect Date Night Spot") */
  match_headline: string | null;
  /** Insider tip */
  insider_tip: string | null;
  /** DondeMatch score for this restaurant (0-100) */
  donde_match: number;
  /** V7 scoring breakdown */
  scoring_v7: V7ScoringBreakdown;
  /** V7 match narrative — the "why this pick" story */
  match_narrative: V7MatchNarrative | null;
  /** Occasion scores (7 dimensions) */
  scores: Record<string, number>;
  /** Deep context data (signature dishes, service style, etc.) */
  deep_context: Record<string, unknown> | null;
  /** Restaurant tags */
  tags: string[];
  /** Intent boost info if applicable */
  intent_boost: IntentBoost | null;
}

// ==========================================
// V7 RESPONSE TYPES
// ==========================================

export interface V7ScoringBreakdown {
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
  intent_alignment?: {
    score: number;
    cuisine: number;
    dish: number;
    vibe: number;
    constraints: number;
  };
  factor_details?: Record<string, Record<string, V7SubComponent>>;
}

/** V7 Claude recommendation output (parsed from JSON response) */
export interface V7ClaudeRecommendation {
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

/**
 * Scored candidate ready for Claude prompt.
 *
 * Backward compatible with V5ScoredCandidate — all V5 fields are present.
 * V7 adds: rank, intentAlignment, matchNarrative.
 */
export interface V7ScoredCandidate {
  profile: RestaurantProfile;
  dondeMatch: number;
  factors: V7Factors;
  weights: V7Weights;
  confidence: V7FactorConfidence;
  /** V7: How well this restaurant matches what the user actually asked for */
  intentAlignment: V7IntentAlignment;
  /** V7: Structured narrative for the UI match story */
  matchNarrative: V7MatchNarrative;
  dataCompleteness: number;
  weightShiftReasons: string[];
  factorDetails?: Record<string, Record<string, V7SubComponent>>;
  googleData?: GooglePlaceData | null;
}

// ==========================================
// V7 SCORE TIERS
// ==========================================

/**
 * V7 score tiers — 6 tiers for finer-grained tone modulation.
 *
 * 90+    Outstanding Match
 * 80-89  Excellent Match
 * 70-79  Strong Pick
 * 60-69  Solid Option
 * 50-59  Worth a Try
 * <50    Best Available
 */
export type V7ScoreTier =
  | "outstanding_match"
  | "excellent_match"
  | "strong_pick"
  | "solid_option"
  | "worth_a_try"
  | "best_available";

export function getScoreTier(score: number): V7ScoreTier {
  if (score >= 90) return "outstanding_match";
  if (score >= 80) return "excellent_match";
  if (score >= 70) return "strong_pick";
  if (score >= 60) return "solid_option";
  if (score >= 50) return "worth_a_try";
  return "best_available";
}

export function getScoreTierLabel(tier: V7ScoreTier): string {
  switch (tier) {
    case "outstanding_match": return "Outstanding Match";
    case "excellent_match": return "Excellent Match";
    case "strong_pick": return "Strong Pick";
    case "solid_option": return "Solid Option";
    case "worth_a_try": return "Worth a Try";
    case "best_available": return "Best Available";
  }
}
