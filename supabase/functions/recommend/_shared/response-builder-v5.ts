/**
 * Donde Match V5 — Response Builder
 *
 * Constructs API responses for the V5 engine. Replaces the legacy
 * response-builder.ts with V5-specific response shapes:
 *   - 5-factor scoring (food, vibe, service, reputation, convenience)
 *   - Intent boost metadata
 *   - Filter relaxation tracking
 *   - Typed V5ScoringBreakdown with confidence and factor details
 *
 * Exports: buildV5SuccessResponse, buildV5FallbackResponse,
 *          buildV5NoResultsResponse, buildV5ErrorResponse
 */

import type { RestaurantProfile } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type {
  V5Factors,
  V5Weights,
  V5FactorConfidence,
  V5SubComponent,
  V5DondeMatchResult,
  V5ClaudeRecommendation,
  V5ScoringBreakdown,
} from "./types-v5.ts";

// ==========================================
// INTERNAL HELPERS
// ==========================================

/**
 * Build the restaurant object shared across all V5 response types.
 * Merges DB profile with live Google data and optional sentiment.
 */
function buildRestaurantObject(
  chosen: RestaurantProfile,
  googleData: GooglePlaceData | null,
  sentimentData?: {
    breakdown: string | null;
    score: number | null;
    summary: string | null;
    positive: number | null;
    negative: number | null;
    neutral: number | null;
  }
): Record<string, unknown> {
  return {
    id: chosen.id,
    name: googleData?.name || chosen.name,
    address: googleData?.address || chosen.address,
    google_place_id: chosen.google_place_id,
    google_rating: googleData?.google_rating || null,
    google_review_count: googleData?.google_review_count || null,
    price_level: chosen.price_level,
    phone: googleData?.phone || null,
    website: googleData?.website || null,
    noise_level: chosen.noise_level,
    cuisine_type: chosen.cuisine_type || null,
    lighting_ambiance: chosen.lighting_ambiance,
    dress_code: chosen.dress_code,
    outdoor_seating: chosen.outdoor_seating,
    live_music: chosen.live_music,
    pet_friendly: chosen.pet_friendly,
    parking_availability: chosen.parking_availability,
    dietary_options: chosen.dietary_options || null,
    sentiment_breakdown: sentimentData?.breakdown || null,
    sentiment_score: sentimentData?.score || null,
    sentiment_summary: sentimentData?.summary || null,
    sentiment_positive: sentimentData?.positive ?? null,
    sentiment_negative: sentimentData?.negative ?? null,
    sentiment_neutral: sentimentData?.neutral ?? null,
    best_for_oneliner: chosen.best_for_oneliner,
    neighborhood_name: chosen.neighborhood_name,
    photo_urls: googleData?.photo_urls || [],
    opening_hours: googleData?.opening_hours || null,
    review_snippets: buildReviewSnippets(googleData),
  };
}

/**
 * Extract top 2 high-rated review snippets for social proof.
 * Filters for 4+ star reviews with meaningful length, then truncates to 120 chars.
 */
function buildReviewSnippets(
  googleData: GooglePlaceData | null
): Array<{ text: string; rating: number }> {
  if (!googleData?.reviews || googleData.reviews.length === 0) return [];
  return googleData.reviews
    .filter((r) => r.rating >= 4 && r.text.length >= 20)
    .sort((a, b) => b.rating - a.rating || b.text.length - a.text.length)
    .slice(0, 2)
    .map((r) => ({
      text: r.text.length > 120 ? r.text.slice(0, 117) + "..." : r.text,
      rating: r.rating,
    }));
}

/**
 * Build deep context from the restaurant's deep profile.
 * Returns null if no deep profile exists, otherwise exposes all 31 enrichment fields.
 */
function buildDeepContext(
  chosen: RestaurantProfile
): Record<string, unknown> | null {
  const dp = chosen.deep_profile;
  if (!dp) return null;
  return {
    signature_dishes: dp.signature_dishes || null,
    service_style: dp.service_style || null,
    reservation_difficulty: dp.reservation_difficulty || null,
    byob_policy: dp.byob_policy || null,
    best_seat_in_house: dp.best_seat_in_house || null,
    unique_selling_point: dp.unique_selling_point || null,
    wow_factors: dp.wow_factors || null,
    seasonal_relevance: dp.seasonal_relevance || null,
    origin_story: dp.origin_story || null,
    awards_recognition: dp.awards_recognition || null,
    conversation_friendliness: dp.conversation_friendliness || null,
    energy_level: dp.energy_level || null,
    cultural_authenticity: dp.cultural_authenticity || null,
    cuisine_subcategory: dp.cuisine_subcategory || null,
    decor_style: dp.decor_style || null,
    music_vibe: dp.music_vibe || null,
    meal_pacing: dp.meal_pacing || null,
    date_progression: dp.date_progression || null,
    crowd_profile: dp.crowd_profile || null,
    neighborhood_integration: dp.neighborhood_integration || null,
    typical_wait_minutes: dp.typical_wait_minutes || null,
    check_average_per_person: dp.check_average_per_person || null,
    transit_accessibility: dp.transit_accessibility || null,
    seating_options: dp.seating_options || null,
    instagram_worthiness: dp.instagram_worthiness || null,
    kid_friendliness: dp.kid_friendliness || null,
    group_size_sweet_spot: dp.group_size_sweet_spot || null,
    ideal_weather: dp.ideal_weather || null,
    flavor_profiles: dp.flavor_profiles || null,
    spice_level: dp.spice_level || null,
    chef_notable: dp.chef_notable || null,
  };
}

/**
 * Build the V5 scoring breakdown from a V5DondeMatchResult.
 * Rounds factor scores to 1 decimal and weights to 2 decimals.
 * Optionally includes factor_details sub-component breakdown.
 */
function buildScoringV5(v5Result: V5DondeMatchResult): V5ScoringBreakdown {
  const {
    factors,
    weights,
    confidence,
    dataCompleteness,
    weightShiftReasons,
    factorDetails,
  } = v5Result;

  const result: V5ScoringBreakdown = {
    food: Math.round(factors.food * 10) / 10,
    vibe: Math.round(factors.vibe * 10) / 10,
    service: Math.round(factors.service * 10) / 10,
    reputation: Math.round(factors.reputation * 10) / 10,
    convenience: Math.round(factors.convenience * 10) / 10,
    weights_used: {
      food: Math.round(weights.food * 100) / 100,
      vibe: Math.round(weights.vibe * 100) / 100,
      service: Math.round(weights.service * 100) / 100,
      reputation: Math.round(weights.reputation * 100) / 100,
      convenience: Math.round(weights.convenience * 100) / 100,
    },
    weight_shift_reasons: weightShiftReasons,
    confidence: {
      food: confidence.food,
      vibe: confidence.vibe,
      service: confidence.service,
      reputation: confidence.reputation,
      convenience: confidence.convenience,
    },
    data_completeness: Math.round(dataCompleteness * 100) / 100,
  };

  // Include sub-component details when available (for inline explanation cards)
  if (factorDetails) {
    const roundedDetails: Record<
      string,
      Record<string, { score: number; max: number; signal: string }>
    > = {};
    for (const [factorKey, subComponents] of Object.entries(factorDetails)) {
      roundedDetails[factorKey] = {};
      for (const [subKey, sub] of Object.entries(subComponents)) {
        roundedDetails[factorKey][subKey] = {
          score: Math.round(sub.score * 10) / 10,
          max: Math.round(sub.max * 10) / 10,
          signal: sub.signal,
        };
      }
    }
    result.factor_details = roundedDetails;
  }

  return result;
}

/**
 * Build occasion scores object from the restaurant profile.
 * These are the 7 occasion-fit dimensions (0-10 scale).
 */
function buildScores(chosen: RestaurantProfile): Record<string, unknown> {
  return {
    date_friendly_score: chosen.date_friendly_score,
    group_friendly_score: chosen.group_friendly_score,
    family_friendly_score: chosen.family_friendly_score,
    romantic_rating: chosen.romantic_rating,
    business_lunch_score: chosen.business_lunch_score,
    solo_dining_score: chosen.solo_dining_score,
    hole_in_wall_factor: chosen.hole_in_wall_factor,
  };
}

// ==========================================
// EXPORTED RESPONSE BUILDERS
// ==========================================

/**
 * Build the main V5 success response.
 * Used when Claude successfully generates a recommendation with V5 scoring.
 */
export function buildV5SuccessResponse(
  chosen: RestaurantProfile,
  claude: V5ClaudeRecommendation,
  googleData: GooglePlaceData | null,
  dondeMatch: number,
  v5Result: V5DondeMatchResult,
  intentBoost: {
    active: boolean;
    reason: string;
    boost_points: number;
    base_score: number;
    original_engine_rank: number;
  } | null,
  relaxationApplied: string[]
): Record<string, unknown> {
  return {
    success: true,
    restaurant: buildRestaurantObject(chosen, googleData, {
      breakdown: null,
      score: claude.sentiment_score || null,
      summary: claude.sentiment_summary || null,
      positive: null,
      negative: null,
      neutral: null,
    }),
    recommendation: claude.recommendation,
    insider_tip: claude.insider_tip || null,
    donde_match: dondeMatch,
    scoring_v5: buildScoringV5(v5Result),
    intent_boost: intentBoost
      ? {
          active: intentBoost.active,
          reason: intentBoost.reason,
          boost_points: intentBoost.boost_points,
          base_score: intentBoost.base_score,
          original_engine_rank: intentBoost.original_engine_rank,
        }
      : null,
    relaxation_applied: relaxationApplied,
    scores: buildScores(chosen),
    tags: chosen.tags,
    deep_context: buildDeepContext(chosen),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a V5 fallback response when Claude fails to generate a recommendation.
 * Uses the restaurant's best_for_oneliner or a generic fallback message.
 * No intent boost is applied in fallback mode.
 */
export function buildV5FallbackResponse(
  chosen: RestaurantProfile,
  googleData: GooglePlaceData | null,
  dondeMatch: number,
  v5Result: V5DondeMatchResult,
  relaxationApplied: string[]
): Record<string, unknown> {
  return {
    success: true,
    restaurant: buildRestaurantObject(chosen, googleData),
    recommendation:
      chosen.best_for_oneliner || "A top pick based on our match engine.",
    insider_tip: chosen.insider_tip || null,
    donde_match: dondeMatch,
    scoring_v5: buildScoringV5(v5Result),
    intent_boost: null,
    relaxation_applied: relaxationApplied,
    scores: buildScores(chosen),
    tags: chosen.tags,
    deep_context: buildDeepContext(chosen),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a V5 no-results response with actionable suggestions.
 * Suggests broadening neighborhood or budget filters when applicable.
 */
export function buildV5NoResultsResponse(
  neighborhood?: string,
  priceLevel?: string
): Record<string, unknown> {
  let message = "We couldn't find a match for that combination.";
  const suggestions: string[] = [];
  if (neighborhood && neighborhood !== "Anywhere")
    suggestions.push('try "Anywhere" for neighborhood');
  if (priceLevel && priceLevel !== "Any")
    suggestions.push('try "Any" for budget');
  if (suggestions.length > 0)
    message += ` You might ${suggestions.join(" or ")}.`;
  return {
    success: false,
    recommendation: message,
    restaurant: {},
    scores: {},
    tags: [],
    scoring_v5: null,
    intent_boost: null,
    relaxation_applied: [],
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a V5 error response for unexpected failures.
 * Logs the error server-side and returns a friendly message to the client.
 */
export function buildV5ErrorResponse(
  error: unknown
): Record<string, unknown> {
  console.error("V5 engine error:", error);
  return {
    success: false,
    recommendation: "The engine took a nap. Try again.",
    restaurant: {},
    scores: {},
    tags: [],
    scoring_v5: null,
    intent_boost: null,
    relaxation_applied: [],
    timestamp: new Date().toISOString(),
  };
}
