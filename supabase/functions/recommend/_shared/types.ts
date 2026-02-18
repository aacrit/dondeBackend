export interface UserRequest {
  special_request?: string;
  occasion?: string;
  neighborhood?: string;
  price_level?: string;
}

export interface Restaurant {
  id: string;
  name: string;
  address: string;
  neighborhood_id: string | null;
  google_place_id: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  price_level: string | null;
  phone: string | null;
  website: string | null;
  noise_level: string | null;
  lighting_ambiance: string | null;
  dress_code: string | null;
  outdoor_seating: boolean | null;
  live_music: boolean | null;
  pet_friendly: boolean | null;
  parking_availability: string | null;
  google_review_summary: Record<string, unknown> | null;
  sentiment_breakdown: string | null;
  sentiment_score: number | null;
  best_for_oneliner: string | null;
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
}

export interface Neighborhood {
  id: string;
  name: string;
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

export interface ClaudeRecommendation {
  restaurant_index: number;
  recommendation: string;
  insider_tip: string | null;
  donde_score: number;
}
