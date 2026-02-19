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
  data_source: string;
  accessibility_features: string[] | null;
  ambiance: string[] | null;
  dietary_options: string[] | null;
  good_for: string[] | null;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
  last_data_refresh: string | null;
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
  created_at: string;
}

export interface Tag {
  id: string;
  restaurant_id: string;
  tag_text: string;
  created_at: string;
}

export interface Neighborhood {
  id: string;
  name: string;
  created_at: string;
}

export interface UserQuery {
  id?: string;
  neighborhood_id: string | null;
  occasion: string;
  price_level: string;
  special_request: string;
  recommended_restaurant_id: string | null;
  created_at?: string;
}

export interface RestaurantProfile extends Restaurant {
  neighborhood_name: string;
  date_friendly_score: number | null;
  group_friendly_score: number | null;
  family_friendly_score: number | null;
  romantic_rating: number | null;
  business_lunch_score: number | null;
  solo_dining_score: number | null;
  hole_in_wall_factor: number | null;
  tags: string[];
}

export interface UserRequest {
  special_request?: string;
  occasion?: string;
  neighborhood?: string;
  price_level?: string;
}

export interface ClaudeRecommendation {
  restaurant_index: number;
  recommendation: string;
  insider_tip: string | null;
  donde_match: number;
  sentiment_score: number | null;
  sentiment_breakdown: string | null;
}

export interface ApiResponse {
  success: boolean;
  restaurant?: Record<string, unknown>;
  recommendation?: string;
  insider_tip?: string | null;
  donde_match?: number;
  scores?: Record<string, unknown>;
  tags?: string[];
  timestamp?: string;
}

export interface GooglePlaceSearchResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  geometry?: {
    location: { lat: number; lng: number };
  };
}

export interface GooglePlaceDetails {
  place_id: string;
  name: string;
  formatted_address: string;
  formatted_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  opening_hours?: Record<string, unknown>;
  reviews?: GoogleReview[];
  types?: string[];
  editorial_summary?: { overview?: string };
  geometry?: {
    location: { lat: number; lng: number };
  };
}

export interface GoogleReview {
  rating: number;
  text: string;
  author_name: string;
  time: number;
}
