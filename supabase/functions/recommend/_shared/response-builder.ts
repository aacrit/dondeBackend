import type { RestaurantProfile, ClaudeRecommendation, PreRecommendation } from "./types.ts";
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

export function buildPreGeneratedResponse(
  chosen: RestaurantProfile,
  preRec: PreRecommendation,
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
    recommendation: preRec.recommendation,
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
