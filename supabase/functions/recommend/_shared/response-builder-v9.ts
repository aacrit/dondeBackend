/**
 * Donde Match V9 — Response Builder
 *
 * Constructs API responses for the V9 engine.
 * Response shape:
 *   - scoring_v9: V9 scoring breakdown (relevance + quality + factors)
 *   - ranked_queue: Pre-computed top-N results for instant "Try Again"
 *   - match_narrative: Structured "why this match" storytelling data
 *
 * Exports: buildV9SuccessResponse, buildV9FallbackResponse,
 *          buildV9NoResultsResponse, buildV9ErrorResponse,
 *          buildV9RankedQueueItem
 */

import type { RestaurantProfile } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type {
  MatchNarrative,
  ClaudeRecommendation,
  IntentBoost,
  V9ScoreResult,
  V9ScoredCandidate,
  V9ScoringBreakdown,
  V9Factors,
  V9FactorDetails,
  V9FactorConfidence,
  V9QualityWeights,
} from "./types-v9.ts";

// ==========================================
// INTERNAL HELPERS
// ==========================================

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
    neighborhood_name: chosen.neighborhood_name || "Chicago",
    photo_urls: googleData?.photo_urls || [],
    opening_hours: googleData?.opening_hours || null,
    best_times: chosen.best_times || null,
    review_snippets: buildReviewSnippets(googleData),
  };
}

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
    menu_highlights: dp.menu_highlights || null,
    review_value_score: (chosen as any).review_intelligence?.review_value_score ?? null,
    // V11: Semantic enrichment fields for frontend transparency
    semantic_descriptors: (chosen as any).review_intelligence?.semantic_descriptors || null,
    best_for_scenarios: (chosen as any).review_intelligence?.best_for_scenarios || null,
    comparable_restaurants: (chosen as any).review_intelligence?.comparable_restaurants || null,
  };
}

/**
 * Build the V9 scoring breakdown.
 * Includes relevance + quality + individual factor scores for frontend bars.
 */
function buildScoringV9(
  factors: V9Factors,
  weights: V9QualityWeights,
  quality: number,
  relevance: { score: number; type: string; details: string },
  occasionBonus: number,
  dataCompleteness: number,
  factorDetails?: V9FactorDetails,
  factorConfidence?: V9FactorConfidence,
): Record<string, unknown> {
  return {
    // V9-specific fields
    relevance_score: Math.round(relevance.score * 100) / 100,
    relevance_type: relevance.type,
    relevance_details: relevance.details,
    quality_score: Math.round(quality * 10) / 10,
    occasion_bonus: occasionBonus,
    data_completeness: Math.round(dataCompleteness * 100) / 100,
    // Individual factor scores (0-10) — for frontend "Why This Match" bars
    food: Math.round(factors.food * 10) / 10,
    vibe: Math.round(factors.vibe * 10) / 10,
    service: Math.round(factors.service * 10) / 10,
    reputation: Math.round(factors.reputation * 10) / 10,
    convenience: Math.round(factors.convenience * 10) / 10,
    // Weight profile used (frontend expects weights_used)
    weights_used: {
      food: Math.round(weights.food * 100) / 100,
      vibe: Math.round(weights.vibe * 100) / 100,
      service: Math.round(weights.service * 100) / 100,
      reputation: Math.round(weights.reputation * 100) / 100,
      convenience: Math.round(weights.convenience * 100) / 100,
    },
    // Sub-component breakdown per factor (for frontend drill-down)
    factor_details: factorDetails || undefined,
    // Per-factor confidence (drives "limited data" UI notes)
    confidence: factorConfidence || undefined,
  };
}

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
// RANKED QUEUE ITEM BUILDER
// ==========================================

/**
 * Build a recommendation blurb for ranked queue items (Try Again).
 * Enhanced with Donde voice — "we/our" mandate, attitude, concrete details.
 * Targets 90-110 words for blurb quality grading compliance (B- / 80+).
 * These serve as instant fallbacks; the frontend can upgrade to a full Claude
 * blurb via /recommend/blurb on demand.
 */
export function buildQueueBlurb(
  profile: RestaurantProfile,
  narrative: MatchNarrative | undefined,
): string | null {
  const dp = profile.deep_profile;
  const ri = (profile as Record<string, unknown>).review_intelligence as Record<string, unknown> | undefined;
  const parts: string[] = [];

  // 1. Lead with attitude, not data
  if (dp?.unique_selling_point) {
    const usp = dp.unique_selling_point;
    parts.push(usp.endsWith(".") ? usp : usp + ".");
  } else if (profile.best_for_oneliner) {
    const oneliner = profile.best_for_oneliner;
    parts.push(oneliner.endsWith(".") ? oneliner : oneliner + ".");
  }

  // 2. Origin/context sentence — neighborhood + cuisine identity
  const hood = profile.neighborhood_name || "";
  const cuisine = profile.cuisine_type || "";
  if (hood && cuisine) {
    const noiseAdj = profile.noise_level === "Quiet" ? "quiet" : profile.noise_level === "Loud" ? "lively" : "";
    const lightAdj = profile.lighting_ambiance === "dim" ? "dimly lit" : profile.lighting_ambiance === "warm" ? "warm-toned" : "";
    const ambiParts = [noiseAdj, lightAdj].filter(Boolean);
    const ambi = ambiParts.length > 0 ? ambiParts.join(", ") + " " : "";
    parts.push(`Our ${cuisine} pick in ${hood} is a ${ambi}spot worth the trip.`);
  } else if (hood) {
    parts.push(`Our pick in ${hood} is worth the trip.`);
  }

  // 3. Concrete dish detail with "we" voice
  if (dp?.signature_dishes && dp.signature_dishes.length >= 2) {
    const d1 = dp.signature_dishes[0];
    const d2 = dp.signature_dishes[1];
    parts.push(`We'd start with the ${d1.dish} and follow up with the ${d2.dish}.`);
  } else if (dp?.signature_dishes?.[0]) {
    const d1 = dp.signature_dishes[0];
    const why = d1.why ? ` (${d1.why.toLowerCase()})` : "";
    parts.push(`We'd order the ${d1.dish}${why}.`);
  } else if (dp?.menu_highlights && dp.menu_highlights.length >= 2) {
    parts.push(`We'd order the ${dp.menu_highlights[0]} or the ${dp.menu_highlights[1]}.`);
  } else if (dp?.wow_factors?.[0]) {
    const wf = dp.wow_factors[0];
    parts.push(`We love that they have ${typeof wf === "string" ? wf.replace(/_/g, " ") : wf}.`);
  } else if (narrative?.key_signals?.length) {
    const useful = narrative.key_signals.find(s =>
      !s.includes("Strong relevance") && !s.includes("Recognized quality")
    );
    if (useful) parts.push(`We like this one because ${useful.toLowerCase()}.`);
  }

  // 4. Flavor/vibe detail — sensory specificity for grading
  const flavors = dp?.flavor_profiles;
  if (flavors && flavors.length > 0) {
    const flavorStr = flavors.slice(0, 2).map((f: string) => f.replace(/-/g, " ")).join(" and ");
    parts.push(`Expect ${flavorStr} flavors across the menu.`);
  }

  // 5. Crowd/scenario fit — adds relevance + specificity
  const scenarios = ri?.best_for_scenarios as string[] | undefined;
  const crowd = dp?.crowd_profile as string[] | undefined;
  if (scenarios && scenarios.length > 0) {
    const top = scenarios.slice(0, 2).join(" or ").toLowerCase();
    parts.push(`Best for ${top}.`);
  } else if (crowd && crowd.length > 0) {
    const crowdStr = crowd.slice(0, 2).map((c: string) => c.replace(/_/g, " ")).join(" and ");
    parts.push(`Draws a ${crowdStr} crowd.`);
  }

  // 6. Service/practical detail
  if (dp?.reservation_difficulty === "required") {
    parts.push("Reservations are a must here.");
  } else if (dp?.reservation_difficulty === "recommended") {
    parts.push("We recommend making a reservation.");
  } else if (dp?.reservation_difficulty === "walk-in friendly" || dp?.reservation_difficulty === "walk_in_friendly") {
    parts.push("Walk-ins are welcome, no reservation needed.");
  }

  // 7. Best seat tip or seating color
  if (dp?.best_seat_in_house) {
    const seat = dp.best_seat_in_house;
    parts.push(seat.endsWith(".") ? seat : seat + ".");
  }

  // 8. Comparable restaurants — adds specificity via proper nouns
  const comparables = ri?.comparable_restaurants as string[] | undefined;
  if (comparables && comparables.length > 0) {
    const comp = comparables[0];
    parts.push(comp.endsWith(".") ? comp.charAt(0).toUpperCase() + comp.slice(1) : comp.charAt(0).toUpperCase() + comp.slice(1) + ".");
  }

  // 9. Awards — reputation specificity signal
  const awards = dp?.awards_recognition;
  if (awards && awards.length > 0 && !parts.some(p => p.includes(awards[0]))) {
    parts.push(`${awards[0]} recognized.`);
  }

  // 10. Close with price or honest caveat
  if (dp?.check_average_per_person) {
    parts.push(`Around $${dp.check_average_per_person} a head.`);
  } else if (narrative?.weak_spots?.length) {
    const ws = narrative.weak_spots[0];
    parts.push(ws.endsWith(".") ? ws : ws + ".");
  }

  if (parts.length === 0) return null;

  // Join and trim to target range (90-125 words)
  let blurb = parts.join(" ");
  const words = blurb.split(/\s+/);
  if (words.length > 125) {
    // Trim to ~120 words at sentence boundary
    let trimmed = words.slice(0, 120).join(" ");
    const lastPeriod = trimmed.lastIndexOf(".");
    if (lastPeriod > trimmed.length * 0.6) {
      trimmed = trimmed.slice(0, lastPeriod + 1);
    }
    blurb = trimmed;
  }

  return blurb;
}

/**
 * Build a lightweight ranked queue item for "Try Again" pre-caching.
 */
export function buildV9RankedQueueItem(
  candidate: V9ScoredCandidate,
  rank: number,
): Record<string, unknown> {
  const profile = candidate.profile;
  const scoring = buildScoringV9(
    candidate.factors,
    candidate.qualityWeights,
    candidate.quality,
    candidate.relevance,
    candidate.occasionBonus,
    candidate.dataCompleteness,
    candidate.factorDetails,
    candidate.factorConfidence,
  );

  return {
    rank,
    restaurant: buildRestaurantObject(profile, candidate.googleData || null),
    donde_match: candidate.dondeMatch,
    scoring_v9: scoring,
    match_headline: candidate.matchNarrative?.summary || null,
    match_narrative: candidate.matchNarrative || null,
    scores: buildScores(profile),
    tags: profile.tags,
    deep_context: buildDeepContext(profile),
    recommendation: buildQueueBlurb(profile, candidate.matchNarrative) || profile.best_for_oneliner || null,
    insider_tip: profile.insider_tip || null,
  };
}

// ==========================================
// EXPORTED RESPONSE BUILDERS
// ==========================================

/**
 * Build the main V9 success response with ranked queue.
 */
export function buildV9SuccessResponse(
  chosen: RestaurantProfile,
  claude: ClaudeRecommendation,
  googleData: GooglePlaceData | null,
  dondeMatch: number,
  v9Result: V9ScoreResult,
  intentBoost: IntentBoost | null,
  rankedQueue: Record<string, unknown>[],
  qualityCallout?: boolean,
  neighborhoodExpanded?: boolean,
): Record<string, unknown> {
  const scoringV9 = buildScoringV9(
    v9Result.factors,
    v9Result.qualityWeights,
    v9Result.quality,
    v9Result.relevance,
    v9Result.occasionBonus,
    v9Result.dataCompleteness,
    v9Result.factorDetails,
    v9Result.factorConfidence,
  );

  let qualityCalloutMessage: string | null = null;
  if (qualityCallout) {
    qualityCalloutMessage = "This is the best match for your preferences, but it may not be a perfect fit. Consider relaxing your filters for more options.";
  } else if (neighborhoodExpanded) {
    qualityCalloutMessage = "We expanded beyond your requested neighborhood to find a better match.";
  }

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
    match_headline: claude.match_headline || null,
    recommendation: claude.recommendation,
    insider_tip: claude.insider_tip || null,
    donde_match: dondeMatch,
    quality_callout: qualityCalloutMessage,
    scoring_v9: scoringV9,
    match_narrative: v9Result.matchNarrative || null,
    intent_boost: intentBoost,
    ranked_queue: rankedQueue,
    scores: buildScores(chosen),
    tags: chosen.tags,
    deep_context: buildDeepContext(chosen),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a V9 fallback response when Claude fails.
 */
export function buildV9FallbackResponse(
  chosen: RestaurantProfile,
  googleData: GooglePlaceData | null,
  dondeMatch: number,
  v9Result: V9ScoreResult,
  rankedQueue: Record<string, unknown>[],
): Record<string, unknown> {
  const scoringV9 = buildScoringV9(
    v9Result.factors,
    v9Result.qualityWeights,
    v9Result.quality,
    v9Result.relevance,
    v9Result.occasionBonus,
    v9Result.dataCompleteness,
    v9Result.factorDetails,
    v9Result.factorConfidence,
  );
  const blurb = buildQueueBlurb(chosen, v9Result.matchNarrative);
  return {
    success: true,
    restaurant: buildRestaurantObject(chosen, googleData),
    recommendation: blurb || chosen.best_for_oneliner || "A top pick based on our match engine.",
    insider_tip: chosen.insider_tip || null,
    donde_match: dondeMatch,
    scoring_v9: scoringV9,
    match_narrative: v9Result.matchNarrative || null,
    intent_boost: null,
    ranked_queue: rankedQueue,
    scores: buildScores(chosen),
    tags: chosen.tags,
    deep_context: buildDeepContext(chosen),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a V9 no-results response.
 */
export function buildV9NoResultsResponse(
  neighborhood?: string,
  priceLevel?: string
): Record<string, unknown> {
  let message = "We couldn't find a match for that combination.";
  const suggestions: string[] = [];
  if (neighborhood && neighborhood !== "Anywhere") suggestions.push('try "Anywhere" for neighborhood');
  if (priceLevel && priceLevel !== "Any") suggestions.push('try "Any" for budget');
  if (suggestions.length > 0) message += ` You might ${suggestions.join(" or ")}.`;
  return {
    success: false,
    recommendation: message,
    restaurant: {},
    scores: {},
    tags: [],
    scoring_v9: null,
    match_narrative: null,
    intent_boost: null,
    ranked_queue: [],
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a V9 error response.
 */
export function buildV9ErrorResponse(
  error: unknown
): Record<string, unknown> {
  console.error("V9 engine error:", error);
  return {
    success: false,
    recommendation: "The engine took a nap. Try again.",
    restaurant: {},
    scores: {},
    tags: [],
    scoring_v9: null,
    match_narrative: null,
    intent_boost: null,
    ranked_queue: [],
    timestamp: new Date().toISOString(),
  };
}
