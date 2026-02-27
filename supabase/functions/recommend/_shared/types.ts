export interface UserRequest {
  special_request?: string;
  occasion?: string;
  neighborhood?: string;
  price_level?: string;
  exclude?: string[];
  dietary_restrictions?: string[];
  user_id?: string;
  feedback?: { restaurant_id: string; feedback: "like" | "dislike" };
  time_of_day?: string; // B2: Client-provided time context (breakfast, lunch, dinner, late_night)
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
  /** V6: Commonly mentioned menu items from reviews — broader coverage than signature_dishes */
  menu_highlights: string[] | null;
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

/** V3 five-factor scoring breakdown (legacy, kept for transition) */
export interface V3Factors {
  food: number;       // 0-10
  setting: number;    // 0-10
  atmosphere: number; // 0-10
  reputation: number; // 0-10
  convenience: number; // 0-10
}

/** V3 dynamic weights (sum to 1.0) (legacy, kept for transition) */
export interface V3Weights {
  food: number;
  setting: number;
  atmosphere: number;
  reputation: number;
  convenience: number;
}

/** V3 scoring breakdown for API response (legacy, kept for transition) */
export interface V3ScoringBreakdown {
  food_match: number;
  setting_fit: number;
  atmosphere: number;
  reputation: number;
  convenience: number;
  weights_used: V3Weights;
  data_completeness: number;
}

// ==========================================
// V4 TYPES — Dynamic-Weight Geometric Mean
// ==========================================

/** V4 five-factor scoring: renamed from V3 for clarity */
export interface V4Factors {
  foodQuality: number;   // 0-10 (was: food)
  vibe: number;          // 0-10 (was: atmosphere)
  service: number;       // 0-10 (was: setting)
  reputation: number;    // 0-10 (unchanged)
  convenience: number;   // 0-10 (unchanged)
}

/** V4 dynamic weights (sum to 1.0) */
export interface V4Weights {
  foodQuality: number;
  vibe: number;
  service: number;
  reputation: number;
  convenience: number;
}

/** Confidence level per factor — drives Bayesian regression toward 5.5 */
export type ConfidenceLevel = "high" | "medium" | "low";

/** V4 confidence per factor */
export interface V4FactorConfidence {
  foodQuality: ConfidenceLevel;
  vibe: ConfidenceLevel;
  service: ConfidenceLevel;
  reputation: ConfidenceLevel;
  convenience: ConfidenceLevel;
}

/** V4 sub-component detail (same shape as V3, reused) */
export interface V4SubComponent {
  score: number;      // actual points earned
  max: number;        // maximum possible points for this layer
  signal: string;     // brief human-readable explanation
}

/** V4 factor result with sub-components and confidence */
export interface V4FactorResult {
  score: number;           // 0-10 raw score
  confidence: ConfidenceLevel;
  dataPoints: number;
  maxDataPoints: number;
  details?: Record<string, V4SubComponent>;
}

/** V4 scoring breakdown for API response */
export interface V4ScoringBreakdown {
  food_quality: number;
  vibe: number;
  service: number;
  reputation: number;
  convenience: number;
  weights_used: V4Weights;
  weight_shift_reasons: string[];
  confidence: V4FactorConfidence;
  data_completeness: number;
  factor_details?: Record<string, Record<string, V4SubComponent>>;
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
