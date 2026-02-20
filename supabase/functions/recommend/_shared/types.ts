export interface UserRequest {
  special_request?: string;
  occasion?: string;
  neighborhood?: string;
  price_level?: string;
  exclude?: string[];
}

/** Restaurant data stored in DB (compliant — only place_id + our own content) */
export interface Restaurant {
  id: string;
  name: string;
  address: string;
  neighborhood_id: string | null;
  google_place_id: string | null;
  price_level: string | null;
  noise_level: string | null;
  lighting_ambiance: string | null;
  dress_code: string | null;
  outdoor_seating: boolean | null;
  live_music: boolean | null;
  pet_friendly: boolean | null;
  parking_availability: string | null;
  cuisine_type: string | null;
  best_for_oneliner: string | null;
  insider_tip: string | null;
  best_times: string[] | null;
  dietary_options: string[] | null;
  good_for: string[] | null;
  ambiance: string[] | null;
  is_active: boolean | null;
}

export interface OccasionScores {
  id: string;
  restaurant_id: string;
  date_friendly_score: number | null;
  group_friendly_score: number | null;
  family_friendly_score: number | null;
  romantic_rating: number | null;
  business_lunch_score: number | null;
  solo_dining_score: number | null;
  hole_in_wall_factor: number | null;
}

export interface Tag {
  id: string;
  restaurant_id: string;
  tag_text: string;
  tag_category: string | null;
}

export interface Neighborhood {
  id: string;
  name: string;
  description: string | null;
}

/** V2 Deep Profile — 35 nuanced enrichment fields from restaurant_deep_profiles */
export interface DeepProfile {
  // Flavor & Culinary Identity
  flavor_profiles: string[] | null;
  signature_dishes: Array<{ dish: string; why: string }> | null;
  cuisine_subcategory: string | null;
  menu_depth: string | null;
  spice_level: string | null;
  dietary_depth: string | null;
  // Service & Experience Dynamics
  service_style: string | null;
  meal_pacing: string | null;
  reservation_difficulty: string | null;
  typical_wait_minutes: number | null;
  group_size_sweet_spot: string | null; // int4range serialized as string "[2,6)"
  check_average_per_person: number | null;
  tipping_culture: string | null;
  kid_friendliness: number | null;
  // Atmosphere & Sensory
  music_vibe: string | null;
  decor_style: string | null;
  conversation_friendliness: number | null;
  energy_level: number | null;
  seating_options: string[] | null;
  instagram_worthiness: number | null;
  seasonal_relevance: Record<string, number> | null;
  // Cultural & Narrative
  cultural_authenticity: number | null;
  origin_story: string | null;
  crowd_profile: string[] | null;
  neighborhood_integration: string | null;
  chef_notable: boolean | null;
  awards_recognition: string[] | null;
  // Experiential Wow Factors
  wow_factors: string[] | null;
  date_progression: string | null;
  best_seat_in_house: string | null;
  ideal_weather: string[] | null;
  unique_selling_point: string | null;
  // Practical Logistics
  transit_accessibility: string | null;
  byob_policy: string | null;
  payment_notes: string | null;
  // Meta
  enrichment_confidence: number | null;
}

/** Merged profile used for ranking (DB data + scores + tags + deep profile) */
export interface RestaurantProfile extends Restaurant {
  neighborhood_name: string;
  neighborhood_description: string | null;
  date_friendly_score: number | null;
  group_friendly_score: number | null;
  family_friendly_score: number | null;
  romantic_rating: number | null;
  business_lunch_score: number | null;
  solo_dining_score: number | null;
  hole_in_wall_factor: number | null;
  tags: string[];
  tag_categories: string[];
  occasion_score: number | null;
  total_score: number | null;
  trending_score: number | null;
  // V2 deep profile (null if not yet enriched)
  deep_profile: DeepProfile | null;
}

/** V2 multi-dimensional scoring breakdown */
export interface ScoringDimensions {
  occasionFit: number;
  cravingMatch: number;
  vibeAlignment: number;
  practicalFit: number;
  discoveryValue: number;
}

/** V2 dynamic weights per scoring dimension */
export interface DimensionWeights {
  occasion: number;
  craving: number;
  vibe: number;
  practical: number;
  discovery: number;
}

export interface ClaudeRecommendation {
  restaurant_index: number;
  recommendation: string;
  insider_tip: string | null;
  relevance_score: number;
  sentiment_score: number | null;
  sentiment_breakdown: string | null;
  sentiment_summary: string | null;
  sentiment_positive: number | null;
  sentiment_negative: number | null;
  sentiment_neutral: number | null;
}
