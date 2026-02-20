import type { RestaurantProfile, ClaudeRecommendation } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";

export function buildSuccessResponse(
  chosen: RestaurantProfile,
  claude: ClaudeRecommendation,
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
    timestamp: new Date().toISOString(),
  };
}

// Enhancement 19 Tier 4: Template-based recommendation when Claude is unavailable
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

  // Build feature highlights
  const features: string[] = [];
  if (chosen.outdoor_seating) features.push("outdoor seating");
  if (chosen.live_music) features.push("live music");
  if (chosen.pet_friendly) features.push("it's pet-friendly");

  // Occasion-aware openers
  const occasionHooks: Record<string, string> = {
    "Date Night": `We'd send you to ${chosen.name} for date night.`,
    "Group Hangout": `${chosen.name} is our pick when you're rolling with a group.`,
    "Family Dinner": `For a family dinner that works for everyone, we like ${chosen.name}.`,
    "Business Lunch": `${chosen.name} hits the mark for a business lunch.`,
    "Solo Dining": `When it's just you, we'd point you to ${chosen.name}.`,
    "Special Occasion": `For a night that matters, we'd book ${chosen.name}.`,
    "Treat Myself": `Treating yourself? We'd head to ${chosen.name}.`,
    "Adventure": `If you're up for something different, ${chosen.name} is the move.`,
    "Chill Hangout": `For a low-key hang, we like ${chosen.name}.`,
  };
  const opener = occasionHooks[occasion] || `We'd send you to ${chosen.name}.`;

  // Build the middle sentence from real metadata
  const vibeDetails: string[] = [];
  vibeDetails.push(`It's a ${noise} ${cuisine} spot in ${neighborhood}`);
  if (lighting !== "warm") vibeDetails[0] += ` with ${lighting} lighting`;
  if (dress !== "casual") vibeDetails.push(`dress code is ${dress}`);

  // One-liner and features
  const onelinerText = chosen.best_for_oneliner ? ` ${chosen.best_for_oneliner}.` : "";
  const featureText = features.length > 0 ? ` Plus, ${features.join(" and ")}.` : "";

  const recommendation = `${opener} ${vibeDetails[0]}.${onelinerText}${featureText}${vibeDetails.length > 1 ? ` The ${vibeDetails.slice(1).join(", ")}.` : ""}`;

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
    insider_tip: chosen.insider_tip || null,
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
