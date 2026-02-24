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
    // 1D: Additional deep context fields for frontend rendering
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

/** Build the restaurant object (shared across all response types) */
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
    // F1: Restaurant photos from Google Places
    photo_urls: googleData?.photo_urls || [],
    // F2: Business hours from Google Places
    opening_hours: googleData?.opening_hours || null,
    // I5: Review snippets from Google Places (top 2, high-rated, truncated)
    review_snippets: buildReviewSnippets(googleData),
  };
}

/** I5: Extract top 2 review snippets for social proof */
function buildReviewSnippets(googleData: GooglePlaceData | null): Array<{ text: string; rating: number }> {
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

/** Build scores object (shared) */
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
    restaurant: buildRestaurantObject(chosen, googleData, {
      breakdown: claude.sentiment_breakdown || null,
      score: claude.sentiment_score || null,
      summary: claude.sentiment_summary || null,
      positive: claude.sentiment_positive ?? null,
      negative: claude.sentiment_negative ?? null,
      neutral: claude.sentiment_neutral ?? null,
    }),
    recommendation: claude.recommendation,
    insider_tip: claude.insider_tip || null,
    donde_match: dondeMatch,
    scores: buildScores(chosen),
    tags: chosen.tags,
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
    restaurant: buildRestaurantObject(chosen, googleData),
    recommendation:
      chosen.best_for_oneliner ||
      "A top pick for your occasion based on our scores!",
    insider_tip: null,
    donde_match: dondeMatch,
    scores: buildScores(chosen),
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

  // V3: Dynamic openers using deep profile when available
  let opener: string;
  if (dp?.origin_story && (occasion === "Adventure" || occasion === "Special Occasion")) {
    opener = `There's a spot in ${neighborhood} with a story. ${dp.origin_story.split('.')[0]}.`;
  } else if (dp?.unique_selling_point && occasion === "Adventure") {
    opener = `${dp.unique_selling_point}. We think that's worth the trip.`;
  } else if (dp?.neighborhood_integration === "hidden_local") {
    opener = `The locals in ${neighborhood} know about ${chosen.name}. Now you do too.`;
  } else {
    const occasionHooks: Record<string, string[]> = {
      "Date Night": [
        `For the kind of date where the restaurant does half the work, ${chosen.name} delivers.`,
        `We've sent a lot of first dates to ${chosen.name} in ${neighborhood}. They tend to turn into second ones.`,
        `The lighting at ${chosen.name} does half the work. The food does the rest.`,
      ],
      "Group Hangout": [
        `Rally the crew. ${chosen.name} is built for the kind of dinner that runs long.`,
        `${chosen.name} is our pick when everyone needs to be happy. It works every time.`,
        `Big group energy and a menu everyone can agree on. That's ${chosen.name}.`,
      ],
      "Family Dinner": [
        `Adults enjoy it. Kids don't lose it. ${chosen.name} passes the real test.`,
        `We've brought our own families to ${chosen.name}. It works.`,
        `Family dinner that doesn't feel like a compromise. ${chosen.name} nails it.`,
      ],
      "Business Lunch": [
        `${chosen.name} reads well on a corporate card, and the food backs it up.`,
        `Quiet enough to talk, good enough to impress. That's ${chosen.name}.`,
        `For a lunch that says "we take this seriously," ${chosen.name} is the call.`,
      ],
      "Solo Dining": [
        `Just you and a really good plate. ${chosen.name} makes solo dining feel intentional.`,
        `A seat at the bar, zero rush, and food worth paying attention to. That's ${chosen.name}.`,
        `${chosen.name} is the kind of spot where eating alone is a feature, not a compromise.`,
      ],
      "Special Occasion": [
        `When the night actually matters, we'd put our money on ${chosen.name}.`,
        `This isn't a "let's just go somewhere" kind of night. ${chosen.name} is the answer.`,
        `We don't pull this card often. ${chosen.name} in ${neighborhood} is worth it.`,
      ],
      "Treat Myself": [
        `You deserve this. ${chosen.name} is the kind of self-care that tastes good.`,
        `Treating yourself? ${chosen.name} is the move.`,
        `Solo indulgence done right. ${chosen.name} gets it.`,
      ],
      "Adventure": [
        `This isn't your usual pick. That's the whole point. ${chosen.name} is a find.`,
        `We love sending people to ${chosen.name}. The reaction is always the same: "How did I not know about this?"`,
        `If you want to eat something you've never tried, ${chosen.name} is where you start.`,
      ],
      "Chill Hangout": [
        `No agenda, no dress code, no stress. Just ${chosen.name} doing its thing.`,
        `For a low-key hang, ${chosen.name} nails it.`,
        `Show up whenever. Stay as long as you want. ${chosen.name} doesn't rush you.`,
      ],
    };
    const hooks = occasionHooks[occasion] || [`${chosen.name} is our pick for this one.`];
    opener = hooks[Math.floor(Math.random() * hooks.length)];
  }

  // Build the middle sentence from real metadata + deep profile
  // V3: Use natural language instead of database field names
  const noiseDesc = noise === "quiet" ? "quiet enough to hear each other"
    : noise === "loud" ? "loud in the best way"
    : "just the right amount of buzz";
  const cuisineLabel = dp?.cuisine_subcategory?.toLowerCase() || cuisine;

  const vibeDetails: string[] = [];
  vibeDetails.push(`It's a ${cuisineLabel} spot in ${neighborhood}, ${noiseDesc}`);
  if (lighting !== "warm") vibeDetails[0] += ` with ${lighting} lighting`;
  if (dress !== "casual") vibeDetails.push(`you'll want to dress ${dress}`);

  const onelinerText = chosen.best_for_oneliner ? ` ${chosen.best_for_oneliner}.` : "";
  const featureText = features.length > 0 ? ` Plus, ${features.join(" and ")}.` : "";

  const recommendation = `${opener} ${vibeDetails[0]}.${onelinerText}${featureText}${vibeDetails.length > 1 ? ` ${vibeDetails.slice(1).join(". ")}.` : ""}`;

  let insiderTip = chosen.insider_tip || null;
  if (dp?.best_seat_in_house) {
    insiderTip = dp.best_seat_in_house;
  } else if (dp?.signature_dishes && Array.isArray(dp.signature_dishes) && dp.signature_dishes.length > 0) {
    const dish = dp.signature_dishes[0];
    insiderTip = `Go for the ${dish.dish}. ${dish.why}.`;
  }

  return {
    success: true,
    restaurant: buildRestaurantObject(chosen, googleData),
    recommendation,
    insider_tip: insiderTip,
    donde_match: dondeMatch,
    scores: buildScores(chosen),
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
    recommendation: "The engine took a nap. Try again.",
    restaurant: {},
    scores: {},
    tags: [],
    timestamp: new Date().toISOString(),
  };
}
