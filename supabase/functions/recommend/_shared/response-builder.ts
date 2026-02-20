import type { RestaurantProfile, ClaudeRecommendation, ScoringDimensions, DimensionWeights } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";

/** Build deep_context from deep profile (V2 optional response field) */
function buildDeepContext(chosen: RestaurantProfile): Record<string, unknown> | null {
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
  };
}

/** Build V2 scoring breakdown (optional response field) */
function buildScoringV2(
  dimensions?: ScoringDimensions,
  weights?: DimensionWeights
): Record<string, unknown> | null {
  if (!dimensions || !weights) return null;
  return {
    occasion_fit: dimensions.occasionFit,
    craving_match: dimensions.cravingMatch,
    vibe_alignment: dimensions.vibeAlignment,
    practical_fit: dimensions.practicalFit,
    discovery_value: dimensions.discoveryValue,
    weights_used: weights,
  };
}

export function buildSuccessResponse(
  chosen: RestaurantProfile,
  claude: ClaudeRecommendation,
  googleData: GooglePlaceData | null,
  dondeMatch: number,
  dimensions?: ScoringDimensions,
  weights?: DimensionWeights
): Record<string, unknown> {
  return {
    success: true,
    restaurant: {
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
      sentiment_breakdown: claude.sentiment_breakdown || null,
      sentiment_score: claude.sentiment_score || null,
      best_for_oneliner: chosen.best_for_oneliner,
      neighborhood_name: chosen.neighborhood_name,
    },
    recommendation: claude.recommendation,
    insider_tip: claude.insider_tip || null,
    donde_match: dondeMatch,
    scores: {
      date_friendly_score: chosen.date_friendly_score,
      group_friendly_score: chosen.group_friendly_score,
      family_friendly_score: chosen.family_friendly_score,
      romantic_rating: chosen.romantic_rating,
      business_lunch_score: chosen.business_lunch_score,
      solo_dining_score: chosen.solo_dining_score,
      hole_in_wall_factor: chosen.hole_in_wall_factor,
    },
    tags: chosen.tags,
    // V2 additions (backward-compatible — frontend can ignore)
    deep_context: buildDeepContext(chosen),
    scoring_v2: buildScoringV2(dimensions, weights),
    timestamp: new Date().toISOString(),
  };
}

export function buildFallbackResponse(
  chosen: RestaurantProfile,
  googleData: GooglePlaceData | null,
  dondeMatch: number
): Record<string, unknown> {
  return {
    success: true,
    restaurant: {
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
      sentiment_breakdown: null,
      sentiment_score: null,
      best_for_oneliner: chosen.best_for_oneliner,
      neighborhood_name: chosen.neighborhood_name,
    },
    recommendation:
      chosen.best_for_oneliner ||
      "A top pick for your occasion based on our scores!",
    insider_tip: null,
    donde_match: dondeMatch,
    scores: {
      date_friendly_score: chosen.date_friendly_score,
      group_friendly_score: chosen.group_friendly_score,
      family_friendly_score: chosen.family_friendly_score,
      romantic_rating: chosen.romantic_rating,
      business_lunch_score: chosen.business_lunch_score,
      solo_dining_score: chosen.solo_dining_score,
      hole_in_wall_factor: chosen.hole_in_wall_factor,
    },
    tags: chosen.tags,
    deep_context: buildDeepContext(chosen),
    timestamp: new Date().toISOString(),
  };
}

// V2: Template-based recommendation enhanced with deep profile data
export function buildTemplateResponse(
  chosen: RestaurantProfile,
  googleData: GooglePlaceData | null,
  dondeMatch: number,
  occasion: string
): Record<string, unknown> {
  const cuisine = chosen.cuisine_type || "restaurant";
  const neighborhood = chosen.neighborhood_name || "Chicago";
  const noise = chosen.noise_level?.toLowerCase() || "moderate";
  const lighting = chosen.lighting_ambiance?.toLowerCase() || "warm";
  const dress = chosen.dress_code?.toLowerCase() || "casual";
  const dp = chosen.deep_profile;

  // Build feature highlights
  const features: string[] = [];
  if (chosen.outdoor_seating) features.push("outdoor seating");
  if (chosen.live_music) features.push("live music");
  if (chosen.pet_friendly) features.push("it's pet-friendly");
  if (dp?.byob_policy === "full_byob") features.push("it's BYOB");

  // V2: Dynamic openers using deep profile when available
  let opener: string;
  if (dp?.origin_story && (occasion === "Adventure" || occasion === "Special Occasion")) {
    opener = `There's a spot in ${neighborhood} with a story — ${dp.origin_story.split('.')[0].toLowerCase()}.`;
  } else if (dp?.unique_selling_point && occasion === "Adventure") {
    opener = `${dp.unique_selling_point} — and we think that's worth the trip.`;
  } else if (dp?.neighborhood_integration === "hidden_local") {
    opener = `The locals in ${neighborhood} know about ${chosen.name}. Now you do too.`;
  } else {
    // Occasion-aware openers (V2 — more variety than V1)
    const occasionHooks: Record<string, string[]> = {
      "Date Night": [
        `For the kind of date night where the restaurant does half the work, ${chosen.name} delivers.`,
        `${chosen.name} in ${neighborhood} — where date nights actually feel like date nights.`,
      ],
      "Group Hangout": [
        `Rally the group to ${chosen.name} — it's built for the kind of dinner that runs long.`,
        `${chosen.name} is our pick when you're rolling deep and everyone needs to be happy.`,
      ],
      "Family Dinner": [
        `For a family dinner where the adults actually enjoy themselves too, ${chosen.name} works.`,
        `${chosen.name} threads the needle — great food AND kid-approved.`,
      ],
      "Business Lunch": [
        `${chosen.name} reads well on a corporate card and the food backs it up.`,
        `For a lunch that says "we take this seriously," ${chosen.name} is the call.`,
      ],
      "Solo Dining": [
        `Just you and a really good plate — ${chosen.name} makes solo dining feel intentional.`,
        `${chosen.name} is the kind of spot where eating alone is a feature, not a compromise.`,
      ],
      "Special Occasion": [
        `When the night actually matters, we'd put our money on ${chosen.name}.`,
        `${chosen.name} — for the nights that deserve better than "let's just go somewhere."`,
      ],
      "Treat Myself": [
        `You deserve this. ${chosen.name} is the kind of self-care that actually tastes good.`,
        `Treating yourself? ${chosen.name} is the move.`,
      ],
      "Adventure": [
        `If you're ready to try something you didn't know you were looking for, ${chosen.name} is it.`,
        `This isn't your usual pick — that's the whole point. ${chosen.name} is a genuine find.`,
      ],
      "Chill Hangout": [
        `No agenda, no dress code, no stress — just ${chosen.name} doing its thing.`,
        `For a low-key hang, ${chosen.name} nails the vibe.`,
      ],
    };
    const hooks = occasionHooks[occasion] || [`${chosen.name} is our pick for this one.`];
    opener = hooks[Math.floor(Math.random() * hooks.length)];
  }

  // Build the middle sentence from real metadata + deep profile
  const vibeDetails: string[] = [];
  if (dp?.cuisine_subcategory) {
    vibeDetails.push(`It's a ${noise} ${dp.cuisine_subcategory.toLowerCase()} spot in ${neighborhood}`);
  } else {
    vibeDetails.push(`It's a ${noise} ${cuisine} spot in ${neighborhood}`);
  }
  if (lighting !== "warm") vibeDetails[0] += ` with ${lighting} lighting`;
  if (dress !== "casual") vibeDetails.push(`dress code is ${dress}`);

  // One-liner and features
  const onelinerText = chosen.best_for_oneliner ? ` ${chosen.best_for_oneliner}.` : "";
  const featureText = features.length > 0 ? ` Plus, ${features.join(" and ")}.` : "";

  const recommendation = `${opener} ${vibeDetails[0]}.${onelinerText}${featureText}${vibeDetails.length > 1 ? ` The ${vibeDetails.slice(1).join(", ")}.` : ""}`;

  // V2: Enhanced insider tip from deep profile
  let insiderTip = chosen.insider_tip || null;
  if (dp?.best_seat_in_house) {
    insiderTip = dp.best_seat_in_house;
  } else if (dp?.signature_dishes && Array.isArray(dp.signature_dishes) && dp.signature_dishes.length > 0) {
    const dish = dp.signature_dishes[0];
    insiderTip = `Go for the ${dish.dish} — ${dish.why}.`;
  }

  return {
    success: true,
    restaurant: {
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
      sentiment_breakdown: null,
      sentiment_score: null,
      best_for_oneliner: chosen.best_for_oneliner,
      neighborhood_name: chosen.neighborhood_name,
    },
    recommendation,
    insider_tip: insiderTip,
    donde_match: dondeMatch,
    scores: {
      date_friendly_score: chosen.date_friendly_score,
      group_friendly_score: chosen.group_friendly_score,
      family_friendly_score: chosen.family_friendly_score,
      romantic_rating: chosen.romantic_rating,
      business_lunch_score: chosen.business_lunch_score,
      solo_dining_score: chosen.solo_dining_score,
      hole_in_wall_factor: chosen.hole_in_wall_factor,
    },
    tags: chosen.tags,
    deep_context: buildDeepContext(chosen),
    timestamp: new Date().toISOString(),
  };
}

export function buildNoResultsResponse(
  neighborhood?: string,
  priceLevel?: string
): Record<string, unknown> {
  let message = "We couldn't find a match for that combination.";
  const suggestions: string[] = [];
  if (neighborhood && neighborhood !== "Anywhere") {
    suggestions.push(`try "Anywhere" for neighborhood`);
  }
  if (priceLevel && priceLevel !== "Any") {
    suggestions.push(`try "Any" for budget`);
  }
  if (suggestions.length > 0) {
    message += ` You might ${suggestions.join(" or ")}.`;
  }
  return {
    success: false,
    recommendation: message,
    restaurant: {},
    scores: {},
    tags: [],
    timestamp: new Date().toISOString(),
  };
}

export function buildErrorResponse(error: unknown): Record<string, unknown> {
  console.error("Recommendation engine error:", error);
  return {
    success: false,
    recommendation: "The engine took a nap — try again.",
    restaurant: {},
    scores: {},
    tags: [],
    timestamp: new Date().toISOString(),
  };
}
