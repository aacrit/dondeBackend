import type { RestaurantProfile, ClaudeRecommendation } from "./types.ts";

export function buildSuccessResponse(
  chosen: RestaurantProfile,
  claude: ClaudeRecommendation
): Record<string, unknown> {
  return {
    success: true,
    restaurant: {
      id: chosen.id,
      name: chosen.name,
      address: chosen.address,
      google_place_id: chosen.google_place_id,
      google_rating: chosen.google_rating,
      google_review_count: chosen.google_review_count,
      price_level: chosen.price_level,
      phone: chosen.phone,
      website: chosen.website,
      noise_level: chosen.noise_level,
      lighting_ambiance: chosen.lighting_ambiance,
      dress_code: chosen.dress_code,
      outdoor_seating: chosen.outdoor_seating,
      live_music: chosen.live_music,
      pet_friendly: chosen.pet_friendly,
      parking_availability: chosen.parking_availability,
      sentiment_breakdown: chosen.sentiment_breakdown,
      sentiment_score: chosen.sentiment_score,
      best_for_oneliner: chosen.best_for_oneliner,
      neighborhood_name: chosen.neighborhood_name,
    },
    recommendation: claude.recommendation,
    insider_tip: claude.insider_tip || null,
    donde_score: String(claude.donde_score),
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
  scoreField: string
): Record<string, unknown> {
  // Calculate a donde_score from the occasion score
  const occasionScore =
    (chosen[scoreField as keyof RestaurantProfile] as number) || 5;
  const dondeScore = Math.min(10, Math.max(0, occasionScore));

  return {
    success: true,
    restaurant: {
      id: chosen.id,
      name: chosen.name,
      address: chosen.address,
      google_place_id: chosen.google_place_id,
      google_rating: chosen.google_rating,
      google_review_count: chosen.google_review_count,
      price_level: chosen.price_level,
      phone: chosen.phone,
      website: chosen.website,
      noise_level: chosen.noise_level,
      lighting_ambiance: chosen.lighting_ambiance,
      dress_code: chosen.dress_code,
      outdoor_seating: chosen.outdoor_seating,
      live_music: chosen.live_music,
      pet_friendly: chosen.pet_friendly,
      parking_availability: chosen.parking_availability,
      sentiment_breakdown: chosen.sentiment_breakdown,
      sentiment_score: chosen.sentiment_score,
      best_for_oneliner: chosen.best_for_oneliner,
      neighborhood_name: chosen.neighborhood_name,
    },
    recommendation:
      chosen.best_for_oneliner ||
      "A top pick for your occasion based on our scores!",
    insider_tip: null,
    donde_score: String(dondeScore),
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

export function buildNoResultsResponse(): Record<string, unknown> {
  return {
    success: false,
    recommendation:
      "No restaurants found matching your criteria. Try a different neighborhood or price range!",
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
