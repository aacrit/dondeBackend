/**
 * Donde Match V7 — Consolidated Scoring Engine
 *
 * Single source of truth for Donde Match scoring. Consolidates proven V3 factor
 * computations with V5's geometric mean architecture and adds V7 innovations:
 *
 * 1. Intent Alignment Score (0.0–1.0): Measures how well a restaurant matches
 *    the user's explicit signals. Used as a scoring multiplier (0.85x–1.15x)
 *    that amplifies differentiation between candidates.
 *
 * 2. Calibrated Multiplier: Replaces fixed ×12 with a data-completeness-aware
 *    multiplier (11x–13x). Data-rich restaurants get a slight advantage.
 *
 * 3. Factor-Specific Confidence Priors: Replaces the universal 5.5 prior with
 *    per-factor priors (Food: 5.0, Reputation: 6.0, etc.).
 *
 * 4. Enhanced Cuisine Mismatch Penalty: Graduated penalty for high-importance
 *    cuisine mismatches (cap at 60, not 65).
 *
 * 5. Match Narrative: Generates structured "why this match" storytelling data
 *    for the UI's factor deep dive.
 *
 * Factor computations reused from V3 (6 expert review cycles):
 *   - computeFoodMatch (scoring-v3.ts)
 *   - computeSettingFit (scoring-v3.ts)
 *   - computeAtmosphere (scoring-v3.ts)
 *   - computeConvenience (scoring-v3.ts)
 *
 * Reputation computation from V5 (stretched Google Rating).
 *
 * Replaces: scoring-v5.ts, scoring-v3.ts (factor wrappers), scoring.ts (scoring functions)
 */

import type { RestaurantProfile } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { IntentClassificationV2 } from "./intent-classifier.ts";
import type { ConfidenceLevel } from "./types.ts";
import type {
  V7Factors,
  V7Weights,
  V7FactorConfidence,
  V7SubComponent,
  V7FactorResult,
  V7DondeMatchResult,
  V7DondeMatchInputs,
  V7RejectionSignals,
  V7UserFeedbackSignals,
  V7MatchNarrative,
  V7IntentAlignment,
  V7ScoredCandidate,
} from "./types-v7.ts";

// Reuse V3 factor computations (proven through 6 expert review cycles)
import {
  computeFoodMatch,
  computeSettingFit,
  computeAtmosphere,
  computeConvenience,
} from "./scoring-v3.ts";
import type { V3SubComponent } from "./scoring-v3.ts";

// V7 weight engine
import { computeV7Weights } from "./weight-config-v7.ts";

// Shared dictionaries
import { CUISINE_KEYWORDS, DIETARY_KEYWORDS, DIETARY_HIERARCHY } from "./scoring.ts";

// ==========================================
// V7 CONFIDENCE SYSTEM
// ==========================================

const CONFIDENCE_MULTIPLIER: Record<ConfidenceLevel, number> = {
  high: 1.0,
  medium: 0.75,
  low: 0.5,
};

/**
 * V7: Factor-specific confidence priors.
 * Replaces the universal 5.5 prior from V5 with calibrated per-factor defaults.
 * Rationale:
 *   Food 5.0 — most restaurants have decent food, but not exceptional
 *   Vibe 5.5 — true neutral
 *   Service 5.5 — true neutral
 *   Reputation 6.0 — Google selection bias means listed restaurants tend to be decent
 *   Convenience 5.0 — practical factors vary widely
 */
const CONFIDENCE_PRIORS: Record<string, number> = {
  food: 5.5,
  vibe: 5.5,
  service: 5.5,
  reputation: 5.5,  // V7.2: match V5 universal prior (6.0 inflated reputation)
  convenience: 5.5,
};

/** Minimum factor score to prevent geometric mean zero-collapse */
const FACTOR_FLOOR = 1.0;

/**
 * V7: Regress a raw factor score toward a factor-specific prior based on confidence.
 * High confidence: no adjustment
 * Medium: 75% raw + 25% prior
 * Low: 50% raw + 50% prior
 */
function adjustForConfidence(rawScore: number, confidence: ConfidenceLevel, factor: string): number {
  const mult = CONFIDENCE_MULTIPLIER[confidence];
  const prior = CONFIDENCE_PRIORS[factor] ?? 5.5;
  return rawScore * mult + prior * (1 - mult);
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
  if (enrichConf >= 0.5 && intent?.cuisine_importance === "high") return "high";
  if (enrichConf >= 0.5 && profile.cuisine_type) return "high";
  if (enrichConf >= 0.3 || profile.cuisine_type) return "medium";
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
  if (enrichConf >= 0.5 && dataRatio >= 0.65) return "high";
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
// V7 INTENT ALIGNMENT SCORE
// ==========================================

/**
 * V7 Intent Alignment: Measures how well a restaurant matches the user's
 * explicit signals. Returns a score from 0.0 (no alignment) to 1.0 (perfect).
 *
 * Components:
 *   Cuisine alignment (0-0.4): Does the restaurant match requested cuisines?
 *   Dish alignment (0-0.25): Does the restaurant have the specific dish?
 *   Vibe alignment (0-0.2): Does the restaurant match vibe keywords/tags?
 *   Constraint alignment (0-0.15): Does the restaurant meet practical constraints?
 *
 * This score becomes a multiplier: DondeScore *= (0.85 + 0.30 * intentAlignment)
 * Range: 0.85x (no alignment) to 1.15x (perfect alignment).
 */
function computeIntentAlignment(
  profile: RestaurantProfile,
  intent: IntentClassificationV2 | null,
  specialRequest: string,
  foodFactorDetails?: Record<string, V7SubComponent>,
): V7IntentAlignment {
  if (!intent) {
    return { score: 0.5, cuisine: 0.5, dish: 0, vibe: 0.5, constraints: 0.5 };
  }

  const dp = profile.deep_profile;
  let cuisineAlignment = 0;
  let dishAlignment = 0;
  let vibeAlignment = 0;
  let constraintAlignment = 0;

  // --- Cuisine alignment (0-1.0) ---
  const targetCuisines = intent.target_cuisines || [];
  if (targetCuisines.length > 0 && profile.cuisine_type) {
    const cuisineLower = profile.cuisine_type.toLowerCase();
    const exactMatch = targetCuisines.some(c => c.toLowerCase() === cuisineLower);
    const containsMatch = !exactMatch && targetCuisines.some(c =>
      cuisineLower.includes(c.toLowerCase()) || c.toLowerCase().includes(cuisineLower)
    );
    if (exactMatch) cuisineAlignment = 1.0;
    else if (containsMatch) cuisineAlignment = 0.7;
    else if (dp?.cuisine_subcategory) {
      const subLower = dp.cuisine_subcategory.toLowerCase();
      if (targetCuisines.some(c => subLower.includes(c.toLowerCase()))) cuisineAlignment = 0.6;
      else cuisineAlignment = 0.15;
    } else {
      cuisineAlignment = 0.1;
    }
  } else if (targetCuisines.length === 0) {
    cuisineAlignment = 0.5; // No cuisine filter → neutral
  }

  // --- Dish alignment (0-1.0) ---
  if (intent.dish_level_intent && dp?.signature_dishes?.length) {
    const dishQuery = intent.dish_level_intent.toLowerCase();
    const exactDish = dp.signature_dishes.some(d =>
      dishQuery.includes(d.dish.toLowerCase()) || d.dish.toLowerCase().includes(dishQuery)
    );
    if (exactDish) dishAlignment = 1.0;
    else {
      const words = dishQuery.split(/\s+/).filter(w => w.length > 3);
      const wordMatch = dp.signature_dishes.some(d =>
        words.some(w => d.dish.toLowerCase().includes(w))
      );
      dishAlignment = wordMatch ? 0.4 : 0;
    }
  } else if (intent.dish_level_intent) {
    // Has dish intent but restaurant has no dish data
    dishAlignment = 0;
  } else {
    // No dish intent → neutral
    dishAlignment = 0.5;
  }

  // Check menu_highlights as fallback for dish alignment
  if (intent.dish_level_intent && dishAlignment < 0.4 && dp?.menu_highlights?.length) {
    const dishQuery = intent.dish_level_intent.toLowerCase();
    const highlightMatch = dp.menu_highlights.some(item =>
      dishQuery.includes(item.toLowerCase()) || item.toLowerCase().includes(dishQuery)
    );
    if (highlightMatch) dishAlignment = Math.max(dishAlignment, 0.6);
  }

  // --- Vibe alignment (0-1.0) ---
  const vibeKeywords = intent.vibe_keywords || [];
  const targetTags = intent.target_tags || [];
  const vibeSignals = [...vibeKeywords, ...targetTags];

  if (vibeSignals.length > 0) {
    let vibeHits = 0;
    const tagStrings = (profile.tags || []).map(t =>
      (typeof t === "string" ? t : (t as { name?: string }).name || "").toLowerCase()
    );

    for (const signal of vibeSignals) {
      const sigLower = signal.toLowerCase();
      // Check tags
      if (tagStrings.some(ts => ts.includes(sigLower))) { vibeHits++; continue; }
      // Check deep profile
      if (dp?.decor_style?.toLowerCase().includes(sigLower)) { vibeHits++; continue; }
      if (dp?.music_vibe?.toLowerCase().includes(sigLower)) { vibeHits++; continue; }
    }

    vibeAlignment = vibeSignals.length > 0 ? Math.min(1.0, vibeHits / vibeSignals.length) : 0.5;
  } else {
    vibeAlignment = 0.5; // No vibe signals → neutral
  }

  // --- Constraint alignment (0-1.0) ---
  const constraints = intent.practical_constraints || [];
  if (constraints.length > 0) {
    let constraintHits = 0;
    const requestLower = specialRequest.toLowerCase();

    for (const constraint of constraints) {
      if (constraint === "outdoor_preferred" && profile.outdoor_seating) { constraintHits++; continue; }
      if (constraint === "pet_friendly" && profile.pet_friendly) { constraintHits++; continue; }
      if (constraint === "byob" && dp?.byob_policy?.toLowerCase().includes("byob")) { constraintHits++; continue; }
      if (constraint === "walk_in" && dp?.reservation_difficulty === "walk_in_friendly") { constraintHits++; continue; }
      if (constraint === "quiet_environment" && profile.noise_level === "Quiet") { constraintHits++; continue; }
      if (constraint === "parking_needed" && profile.parking_availability &&
        !/none|no /i.test(profile.parking_availability)) { constraintHits++; continue; }
    }

    constraintAlignment = constraints.length > 0 ? Math.min(1.0, constraintHits / constraints.length) : 0.5;
  } else {
    constraintAlignment = 0.5;
  }

  // Weighted composite
  const hasCuisine = targetCuisines.length > 0;
  const hasDish = !!intent.dish_level_intent;
  const hasVibe = vibeSignals.length > 0;
  const hasConstraints = constraints.length > 0;

  // Dynamic weighting: weight each component by whether user expressed that signal
  let totalWeight = 0;
  let weightedSum = 0;

  if (hasCuisine) { weightedSum += cuisineAlignment * 0.40; totalWeight += 0.40; }
  if (hasDish) { weightedSum += dishAlignment * 0.25; totalWeight += 0.25; }
  if (hasVibe) { weightedSum += vibeAlignment * 0.20; totalWeight += 0.20; }
  if (hasConstraints) { weightedSum += constraintAlignment * 0.15; totalWeight += 0.15; }

  const score = totalWeight > 0 ? weightedSum / totalWeight : 0.5;

  return { score, cuisine: cuisineAlignment, dish: dishAlignment, vibe: vibeAlignment, constraints: constraintAlignment };
}

// ==========================================
// V7 REPUTATION FACTOR (from V5, unchanged)
// ==========================================

function computeReputationV7(
  profile: RestaurantProfile,
  googleData: GooglePlaceData | null,
  sentimentScore?: number | null,
  sentimentNegative?: number | null,
): V7FactorResult {
  let dataPoints = 0;
  let maxDataPoints = 0;
  const details: Record<string, V7SubComponent> = {};
  const dp = profile.deep_profile;

  // L1: Google Rating (0-10, stretched linear)
  maxDataPoints++;
  let googleScore = 0;
  if (googleData && googleData.google_rating != null) {
    dataPoints++;
    const rating = googleData.google_rating;
    const reviewCount = googleData.google_review_count || 0;
    const rawGoogleScore = Math.max(0, Math.min(10, (rating - 3.5) / 1.5 * 10));
    const reviewConfidence = reviewCount >= 200 ? 1.0
      : reviewCount >= 50 ? 0.9
      : reviewCount >= 10 ? 0.8
      : 0.7;
    googleScore = rawGoogleScore * reviewConfidence;
    details.google = { score: googleScore, max: 10, signal: `${rating}\u2605 (${reviewCount} reviews)` };
  } else {
    googleScore = 5.0;
    details.google = { score: 5.0, max: 10, signal: "No Google data" };
  }

  // L2: Review sentiment (0-2)
  maxDataPoints++;
  let sentScore = 0;
  if (sentimentScore != null) {
    dataPoints++;
    sentScore = (sentimentScore / 10) * 2;
    if (sentimentNegative != null && sentimentNegative > 30) {
      sentScore -= Math.min(1.5, ((sentimentNegative - 30) / 40) * 1.5);
    }
    sentScore = Math.max(0, sentScore);
    details.sentiment = { score: sentScore, max: 2, signal: `Sentiment ${sentimentScore}/10` };
  } else {
    sentScore = 1.0;
    details.sentiment = { score: 1.0, max: 2, signal: "No sentiment data" };
  }

  // L3: Awards/recognition (0-1.5)
  maxDataPoints++;
  let awardsScore = 0;
  let awardsUsed = false;
  if (dp) {
    if (dp.chef_notable) { awardsScore += 0.75; awardsUsed = true; }
    if (dp.awards_recognition && dp.awards_recognition.length > 0) { awardsScore += 0.75; awardsUsed = true; }
    if (awardsUsed) { dataPoints++; awardsScore = Math.min(1.5, awardsScore); }
  }
  details.awards = awardsUsed
    ? { score: awardsScore, max: 1.5, signal: dp?.awards_recognition?.join(", ") || (dp?.chef_notable ? "Notable chef" : "Recognized") }
    : { score: 0, max: 1.5, signal: "No awards data" };

  // L4: Community signal (0-1.5)
  maxDataPoints++;
  let communityScore = 0;
  let communityUsed = false;
  if (dp) {
    if (profile.trending_score != null && profile.trending_score >= 7) { communityScore += 0.75; communityUsed = true; }
    if (dp.cultural_authenticity != null && dp.cultural_authenticity >= 7) { communityScore += 0.75; communityUsed = true; }
    if (communityUsed) { dataPoints++; communityScore = Math.min(1.5, communityScore); }
  }
  details.community = communityUsed
    ? { score: communityScore, max: 1.5, signal: [
        profile.trending_score != null && profile.trending_score >= 7 ? "Trending" : null,
        dp?.cultural_authenticity != null && dp.cultural_authenticity >= 7 ? "Culturally authentic" : null,
      ].filter(Boolean).join(", ") || "Community signal" }
    : { score: 0, max: 1.5, signal: "No community data" };

  // Normalization: adaptive denominator
  const adaptiveMax = 10 * 0.65 + 2
    + (awardsUsed ? 1.5 : 0)
    + (communityUsed ? 1.5 : 0);
  const effectiveDenom = Math.max(adaptiveMax, 8.5);
  const rawReputation = googleScore * 0.65 + sentScore + awardsScore + communityScore;
  const reputation = Math.min(10, Math.max(0, (rawReputation / effectiveDenom) * 10));

  return {
    score: reputation,
    confidence: computeReputationConfidence(googleData),
    dataPoints,
    maxDataPoints,
    details,
  };
}

// ==========================================
// V7 CONVENIENCE FACTOR (from V5, unchanged)
// ==========================================

function computeConvenienceV7(
  profile: RestaurantProfile,
  intent: IntentClassificationV2 | null,
  clientTimeOfDay?: string | null,
  specialRequest?: string,
): V7FactorResult {
  const v3Result = computeConvenience(profile, intent, clientTimeOfDay, specialRequest);
  const v7Score = Math.min(10, v3Result.score + 1);

  return {
    score: v7Score,
    confidence: "high",
    dataPoints: v3Result.dataPoints,
    maxDataPoints: v3Result.maxDataPoints,
    details: v3Result.details ? convertDetails(v3Result.details) : undefined,
  };
}

// ==========================================
// V7 FOOD ABSORBED ADJUSTMENT
// ==========================================

function foodAbsorbedAdjustmentV7(
  rawScore: number,
  profile: RestaurantProfile,
  userFeedback?: V7UserFeedbackSignals | null,
  rejectionSignals?: V7RejectionSignals,
): number {
  let adjusted = rawScore;

  if (userFeedback && profile.cuisine_type) {
    if (userFeedback.likedCuisines.includes(profile.cuisine_type)) adjusted += 0.8;
    if (userFeedback.dislikedCuisines.includes(profile.cuisine_type)) adjusted -= 1.0;
  }

  if (rejectionSignals && profile.cuisine_type) {
    if (rejectionSignals.avoidCuisines.includes(profile.cuisine_type)) {
      const alreadyPenalized = userFeedback?.dislikedCuisines.includes(profile.cuisine_type);
      if (!alreadyPenalized) adjusted -= 0.5;
    }
  }

  if (userFeedback?.dislikedRestaurantIds.includes(profile.id)) adjusted -= 1.5;

  return adjusted;
}

// ==========================================
// V7 MATCH NARRATIVE GENERATION
// ==========================================

/**
 * Generate a human-readable match narrative explaining WHY this restaurant
 * was chosen. Powers the UI's "why this match" storytelling.
 */
function generateMatchNarrative(
  factors: V7Factors,
  weights: V7Weights,
  intent: IntentClassificationV2 | null,
  intentAlignment: V7IntentAlignment,
  factorDetails: Record<string, Record<string, V7SubComponent>>,
  profile: RestaurantProfile,
): V7MatchNarrative {
  // Find strongest factor by weighted contribution
  const contributions: Array<{ factor: string; contribution: number; score: number }> = [
    { factor: "food", contribution: factors.food * weights.food, score: factors.food },
    { factor: "vibe", contribution: factors.vibe * weights.vibe, score: factors.vibe },
    { factor: "service", contribution: factors.service * weights.service, score: factors.service },
    { factor: "reputation", contribution: factors.reputation * weights.reputation, score: factors.reputation },
    { factor: "convenience", contribution: factors.convenience * weights.convenience, score: factors.convenience },
  ];
  contributions.sort((a, b) => b.contribution - a.contribution);

  const strongest = contributions[0];
  const weakest = contributions[contributions.length - 1];

  // Generate factor label
  const FACTOR_LABELS: Record<string, Record<string, string>> = {
    food: { high: "Outstanding Cuisine Match", medium: "Good Food Fit", low: "Decent Menu" },
    vibe: { high: "Perfect Atmosphere", medium: "Good Vibe Match", low: "Adequate Setting" },
    service: { high: "Excellent Service Fit", medium: "Good Service Match", low: "Standard Service" },
    reputation: { high: "Highly Regarded", medium: "Well Reviewed", low: "Decent Reputation" },
    convenience: { high: "Very Convenient", medium: "Reasonably Convenient", low: "Some Tradeoffs" },
  };

  const tier = strongest.score >= 8 ? "high" : strongest.score >= 6 ? "medium" : "low";
  const strongestLabel = FACTOR_LABELS[strongest.factor]?.[tier] || "Strong Match";

  // Collect key signals from factor details
  const keySignals: string[] = [];
  const strongDetails = factorDetails[strongest.factor];
  if (strongDetails) {
    const topSubs = Object.entries(strongDetails)
      .sort(([, a], [, b]) => (b.score / Math.max(b.max, 0.01)) - (a.score / Math.max(a.max, 0.01)))
      .slice(0, 2);
    for (const [, sub] of topSubs) {
      if (sub.score > 0 && sub.signal && sub.signal !== "No data") {
        keySignals.push(sub.signal);
      }
    }
  }

  // Add intent-specific signals
  if (intentAlignment.cuisine >= 0.7 && intent?.target_cuisines?.length) {
    keySignals.unshift(`Matches ${intent.target_cuisines[0]} cuisine`);
  }
  if (intentAlignment.dish >= 0.7 && intent?.dish_level_intent) {
    keySignals.unshift(`Has ${intent.dish_level_intent} on menu`);
  }

  // Limit to 3 signals
  const trimmedSignals = keySignals.slice(0, 3);

  // Build summary
  let summary = `${strongestLabel}`;
  if (trimmedSignals.length > 0) {
    summary += ` — ${trimmedSignals[0].toLowerCase()}`;
  }

  // Identify weak spots
  const weakSpots: string[] = [];
  if (weakest.score < 5) {
    const weakLabel = weakest.factor.charAt(0).toUpperCase() + weakest.factor.slice(1);
    weakSpots.push(`Lower ${weakLabel.toLowerCase()} score`);
  }

  // Confidence caveat
  let confidenceCaveat: string | null = null;
  const dp = profile.deep_profile;
  if (!dp || (dp.enrichment_confidence ?? 0) < 0.3) {
    confidenceCaveat = "Limited data available — score may update with more information";
  }

  return {
    strongest_factor: strongest.factor,
    strongest_factor_label: strongestLabel,
    key_signals: trimmedSignals,
    comparison_context: null, // Set later when we have pool context
    summary,
    weak_spots: weakSpots,
    confidence_caveat: confidenceCaveat,
  };
}

// ==========================================
// V7 DONDE MATCH (full pipeline)
// ==========================================

/**
 * Compute the V7 Donde Match score for a single restaurant profile.
 *
 * Pipeline:
 * 1. Compute raw factor scores (V3 for Food/Setting/Atmosphere, V7 for Reputation/Convenience)
 * 2. Apply food absorbed adjustments
 * 3. Compute per-factor confidence
 * 4. Apply V7 factor-specific confidence regression + floor at 1.0
 * 5. Compute intent alignment score
 * 6. Compute dynamic weights (V7 5-layer)
 * 7. Geometric mean → Donde Score with calibrated multiplier and intent alignment
 * 8. Apply cuisine mismatch cap
 * 9. Generate match narrative
 */
export function computeV7DondeMatch(
  profile: RestaurantProfile,
  inputs: V7DondeMatchInputs,
): V7DondeMatchResult {
  // ==========================================
  // Step 1: Compute raw factor scores
  // ==========================================

  const foodResult = computeFoodMatch(
    profile, inputs.intent, inputs.dietaryRestrictions, inputs.specialRequest,
  );
  const settingResult = computeSettingFit(profile, inputs.occasion, inputs.intent);
  let atmosphereResult = computeAtmosphere(
    profile, inputs.occasion, inputs.intent, inputs.specialRequest,
  );

  // V7: Cold-start atmosphere override (same as V5: 4.0 → 5.5)
  if (atmosphereResult.dataPoints === 0) {
    atmosphereResult = { ...atmosphereResult, score: 5.5 };
  }

  const reputationResult = computeReputationV7(
    profile, inputs.googleData, inputs.sentimentScore, inputs.sentimentNegative,
  );
  const convenienceResult = computeConvenienceV7(
    profile, inputs.intent, inputs.clientTimeOfDay, inputs.specialRequest,
  );

  // ==========================================
  // Step 2: Absorb food adjustments
  // ==========================================

  const adjustedFood = foodAbsorbedAdjustmentV7(
    foodResult.score, profile, inputs.userFeedback, inputs.rejectionSignals,
  );

  // ==========================================
  // Step 3: Compute confidence per factor
  // ==========================================

  const confidence: V7FactorConfidence = {
    food: computeFoodConfidence(profile, inputs.intent),
    vibe: computeVibeConfidence(profile, atmosphereResult.dataPoints, atmosphereResult.maxDataPoints),
    service: computeServiceConfidence(profile),
    reputation: computeReputationConfidence(inputs.googleData),
    convenience: "high",
  };

  // ==========================================
  // Step 4: V7 factor-specific confidence regression + floor
  // ==========================================

  const factors: V7Factors = {
    food: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(adjustedFood, confidence.food, "food"))),
    vibe: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(atmosphereResult.score, confidence.vibe, "vibe"))),
    service: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(settingResult.score, confidence.service, "service"))),
    reputation: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(reputationResult.score, confidence.reputation, "reputation"))),
    convenience: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(convenienceResult.score, confidence.convenience, "convenience"))),
  };

  // ==========================================
  // Step 5: Collect sub-component details
  // ==========================================

  const factorDetails: Record<string, Record<string, V7SubComponent>> = {};
  if (foodResult.details) factorDetails.food = convertDetails(foodResult.details);
  if (settingResult.details) factorDetails.service = convertDetails(settingResult.details);
  if (atmosphereResult.details) factorDetails.vibe = convertDetails(atmosphereResult.details);
  if (reputationResult.details) factorDetails.reputation = reputationResult.details;
  if (convenienceResult.details) factorDetails.convenience = convenienceResult.details;

  // ==========================================
  // Step 6: Compute intent alignment
  // ==========================================

  const intentAlignment = computeIntentAlignment(
    profile, inputs.intent, inputs.specialRequest, factorDetails.food,
  );

  // ==========================================
  // Step 7: Compute dynamic weights (V7 5-layer)
  // ==========================================

  const { weights, appliedRules } = computeV7Weights(
    inputs.occasion,
    inputs.intent,
    confidence,
    inputs.candidatePoolSize ?? 15,
    inputs.clientTimeOfDay,
  );

  // ==========================================
  // Step 8: Geometric mean with V7 calibrated multiplier + intent alignment
  // ==========================================

  const geometricMean =
    Math.pow(factors.food, weights.food) *
    Math.pow(factors.vibe, weights.vibe) *
    Math.pow(factors.service, weights.service) *
    Math.pow(factors.reputation, weights.reputation) *
    Math.pow(factors.convenience, weights.convenience);

  // V7.2: Fixed ×12 multiplier (matching V5 exactly).
  // Intent alignment is used ONLY for ranking tiebreaking and UI narrative,
  // NOT as a score modifier. V7.0/V7.1 intent multipliers caused regression
  // because the restaurant pool often lacks matching cuisines, penalizing
  // all candidates equally and lowering scores across the board.
  const totalDataPoints = foodResult.dataPoints + settingResult.dataPoints
    + atmosphereResult.dataPoints + reputationResult.dataPoints + convenienceResult.dataPoints;
  const totalMaxPoints = foodResult.maxDataPoints + settingResult.maxDataPoints
    + atmosphereResult.maxDataPoints + reputationResult.maxDataPoints + convenienceResult.maxDataPoints;
  const dataCompleteness = totalMaxPoints > 0 ? totalDataPoints / totalMaxPoints : 0;

  const multiplier = 12;

  let dondeMatch = Math.round(geometricMean * multiplier);

  // ==========================================
  // Step 9: Cuisine mismatch cap
  // ==========================================

  if (inputs.intent?.cuisine_importance === "high" && inputs.intent.target_cuisines.length > 0) {
    const targetCuisines = inputs.intent.target_cuisines;
    if (profile.cuisine_type) {
      const cuisineLower = profile.cuisine_type.toLowerCase();
      const isExactMatch = targetCuisines.some(c => c.toLowerCase() === cuisineLower);
      const isContainsMatch = !isExactMatch && targetCuisines.some(c =>
        cuisineLower.includes(c.toLowerCase()) || c.toLowerCase().includes(cuisineLower)
      );
      const isSubMatch = !isExactMatch && !isContainsMatch && profile.deep_profile?.cuisine_subcategory &&
        targetCuisines.some(c =>
          profile.deep_profile!.cuisine_subcategory!.toLowerCase().includes(c.toLowerCase())
        );

      if (!isExactMatch && !isContainsMatch && !isSubMatch) {
        // Hard cuisine mismatch with high importance → cap at 60
        dondeMatch = Math.min(dondeMatch, 60);
      }
    } else {
      // No cuisine type but user wants specific cuisine → cap at 65
      dondeMatch = Math.min(dondeMatch, 65);
    }
  }

  dondeMatch = Math.min(99, Math.max(0, dondeMatch));

  // ==========================================
  // Step 10: Generate match narrative
  // ==========================================

  const matchNarrative = generateMatchNarrative(
    factors, weights, inputs.intent, intentAlignment, factorDetails, profile,
  );

  return {
    dondeMatch,
    factors,
    weights,
    confidence,
    dataCompleteness,
    weightShiftReasons: appliedRules,
    factorDetails,
    intentAlignment,
    matchNarrative,
  };
}

// ==========================================
// V7 RE-RANK
// ==========================================

/**
 * Re-rank a list of restaurant profiles using V7 scoring.
 * Returns sorted array (highest score first) with full scoring results.
 */
export function reRankV7(
  profiles: RestaurantProfile[],
  occasion: string,
  specialRequest: string,
  intent: IntentClassificationV2 | null,
  dietaryRestrictions?: string[],
  candidatePoolSize?: number,
  clientTimeOfDay?: string | null,
): Array<{ profile: RestaurantProfile; result: V7DondeMatchResult }> {
  const scored = profiles.map(profile => {
    const result = computeV7DondeMatch(profile, {
      occasion,
      specialRequest,
      neighborhood: "Anywhere",
      priceLevel: "Any",
      googleData: null,
      intent,
      dietaryRestrictions,
      candidatePoolSize: candidatePoolSize ?? profiles.length,
      clientTimeOfDay,
    });
    return { profile, result };
  });

  // V7: Sort by DondeMatch with intent alignment tiebreaker.
  // When two restaurants are within 5 points, prefer better intent alignment.
  scored.sort((a, b) => {
    const scoreDiff = b.result.dondeMatch - a.result.dondeMatch;
    if (Math.abs(scoreDiff) <= 5) {
      const intentDiff = b.result.intentAlignment.score - a.result.intentAlignment.score;
      if (Math.abs(intentDiff) > 0.15) return intentDiff > 0 ? 1 : -1;
    }
    return scoreDiff;
  });

  // Add comparison context to match narratives
  if (scored.length >= 2) {
    const topScore = scored[0].result.dondeMatch;
    for (let i = 0; i < scored.length; i++) {
      const gap = topScore - scored[i].result.dondeMatch;
      if (i === 0 && scored.length > 1) {
        scored[i].result.matchNarrative.comparison_context =
          `${topScore - scored[1].result.dondeMatch} points ahead of next option`;
      } else if (gap > 0) {
        scored[i].result.matchNarrative.comparison_context =
          `${gap} points behind top pick`;
      }
    }
  }

  return scored;
}

// ==========================================
// HELPERS
// ==========================================

function convertDetails(
  details: Record<string, V3SubComponent>,
): Record<string, V7SubComponent> {
  const result: Record<string, V7SubComponent> = {};
  for (const [key, sub] of Object.entries(details)) {
    result[key] = { score: sub.score, max: sub.max, signal: sub.signal };
  }
  return result;
}
