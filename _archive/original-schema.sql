-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.cuisine_types (
  id uuid NOT NULL,
  name text,
  created_at timestamp with time zone DEFAULT now(),
  is_seed boolean DEFAULT false,
  CONSTRAINT cuisine_types_pkey PRIMARY KEY (id)
);
CREATE TABLE public.neighborhoods (
  id uuid NOT NULL,
  name text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT neighborhoods_pkey PRIMARY KEY (id)
);
CREATE TABLE public.occasion_scores (
  id uuid NOT NULL,
  restaurant_id uuid,
  date_friendly_score integer,
  group_friendly_score integer,
  family_friendly_score integer,
  romantic_rating integer,
  business_lunch_score integer,
  solo_dining_score integer,
  hole_in_wall_factor integer,
  created_at timestamp with time zone DEFAULT now(),
  is_seed boolean DEFAULT false,
  CONSTRAINT occasion_scores_pkey PRIMARY KEY (id),
  CONSTRAINT occasion_scores_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);
CREATE TABLE public.restaurants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text,
  address text,
  neighborhood_id uuid,
  google_place_id text,
  yelp_business_id text,
  google_rating numeric,
  google_review_count integer,
  yelp_rating numeric,
  yelp_review_count integer,
  price_level text,
  accepts_reservations boolean,
  typical_wait_time text,
  hours_of_operation jsonb,
  phone text,
  website text,
  noise_level text,
  lighting_ambiance text,
  dress_code text,
  outdoor_seating boolean,
  live_music boolean,
  pet_friendly boolean,
  parking_availability text,
  vegetarian_options text,
  vegan_options text,
  gluten_free_options text,
  google_review_summary jsonb,
  yelp_sentiment_summary text,
  sentiment_breakdown text,
  editors_note text,
  best_for_oneliner text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  last_data_refresh timestamp with time zone,
  is_seed boolean DEFAULT false,
  data_source text DEFAULT 'unknown'::text,
  accessibility_features ARRAY,
  ai_enriched ARRAY,
  ai_enriched_at ARRAY,
  ambiance ARRAY,
  dietary_options ARRAY,
  good_for ARRAY,
  review_last_fetched_at timestamp with time zone,
  review_analysis_version text DEFAULT 'v1'::text,
  review_count integer DEFAULT 0,
  sentiment_score numeric,
  has_red_flags boolean DEFAULT false,
  CONSTRAINT restaurants_pkey PRIMARY KEY (id),
  CONSTRAINT restaurants_neighborhood_id_fkey FOREIGN KEY (neighborhood_id) REFERENCES public.neighborhoods(id)
);
CREATE TABLE public.tags (
  id uuid NOT NULL,
  restaurant_id uuid,
  tag_text text,
  created_at timestamp with time zone DEFAULT now(),
  is_seed boolean DEFAULT false,
  CONSTRAINT tags_pkey PRIMARY KEY (id),
  CONSTRAINT tags_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id)
);
CREATE TABLE public.user_queries (
  id uuid NOT NULL,
  neighborhood_id uuid,
  occasion text,
  price_level text,
  special_request text,
  recommended_restaurant_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  is_seed boolean DEFAULT false,
  CONSTRAINT user_queries_pkey PRIMARY KEY (id),
  CONSTRAINT user_queries_neighborhood_id_fkey FOREIGN KEY (neighborhood_id) REFERENCES public.neighborhoods(id),
  CONSTRAINT user_queries_recommended_restaurant_id_fkey FOREIGN KEY (recommended_restaurant_id) REFERENCES public.restaurants(id)
);
