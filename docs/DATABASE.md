# Database Schema

Last updated: 2026-03-13

## Overview

| Table | Rows | Relationship | Purpose |
|-------|------|-------------|---------|
| `restaurants` | 2,719 (all active) | — | Core restaurant data (28 cols) |
| `restaurant_deep_profiles` | 2,719 | 1:1 with restaurants | V2 enrichment data (38 cols) |
| `occasion_scores` | 2,719 | 1:1 with restaurants | 7-dimension occasion scoring |
| `neighborhoods` | 33 | 1:N → restaurants | Chicago neighborhood lookup |
| `tags` | ~15,500 | N:1 → restaurants | Restaurant tags (~5.7 per restaurant) |
| `restaurant_popularity` | — | 1:1 with restaurants | Trending/recommendation counts |
| `user_profiles` | — | 1:1 with auth.users | Authenticated user preferences |
| `user_searches` | — | N:1 → user_profiles | Server-side search history |
| `user_favorites` | — | N:1 → user_profiles, restaurants | Saved bookmarks |
| `user_queries` | — | N:1 → restaurants | Query logging + feedback + blurb audit |
| `user_visits` | — | N:1 → restaurants | Restaurant visit tracking |
| `user_app_feedback` | — | — | User feedback messages |
| `gauntlet_runs` | — | — | Command Center test run summaries |
| `gauntlet_results` | — | N:1 → gauntlet_runs | Individual test results per run |
| `maintenance_requests` | — | — | Pipeline operation queue |

## Entity Relationships

```
neighborhoods (33)
  |
  | 1:N (neighborhood_id)
  v
restaurants (2,719 — all active)
  |--- 1:1 ---> restaurant_deep_profiles (2,719)
  |--- 1:1 ---> occasion_scores (2,719)
  |--- 1:1 ---> restaurant_popularity
  |--- 1:N ---> tags (~15,500)
  |--- 1:N ---> user_favorites
  |--- 1:N ---> user_queries

user_profiles
  |--- 1:N ---> user_favorites
  |--- 1:N ---> user_searches
  |--- 1:N ---> user_queries
```

## restaurants (28 columns)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `name` | text | |
| `address` | text | |
| `neighborhood_id` | uuid | FK → neighborhoods, ON DELETE CASCADE |
| `google_place_id` | text | For live Google Places API calls |
| `price_level` | text | $, $$, $$$, $$$$ |
| `noise_level` | text | quiet, moderate, loud |
| `lighting_ambiance` | text | bright, moderate, dim |
| `dress_code` | text | casual, smart casual, formal |
| `outdoor_seating` | boolean | |
| `live_music` | boolean | |
| `pet_friendly` | boolean | |
| `parking_availability` | text | |
| `best_for_oneliner` | text | Short tagline |
| `cuisine_type` | text | Primary cuisine |
| `insider_tip` | text | Actionable tip (15-25 words) |
| `best_times` | text[] | |
| `accessibility_features` | text[] | |
| `ambiance` | text[] | |
| `dietary_options` | text[] | vegetarian, vegan, gluten free, etc. |
| `good_for` | text[] | |
| `is_active` | boolean | Soft delete flag |
| `is_seed` | boolean | Original seed data |
| `data_source` | text | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `last_data_refresh` | timestamptz | |

## restaurant_deep_profiles (38 columns)

1:1 with restaurants. Full interface: `_shared/types.ts` → `DeepProfile`.

| Column | Type | Notes |
|--------|------|-------|
| `restaurant_id` | uuid | PK, FK → restaurants, ON DELETE CASCADE |
| `flavor_profiles` | text[] | e.g., ["smoky", "umami"] |
| `signature_dishes` | jsonb | Array of {dish, description} |
| `cuisine_subcategory` | text | e.g., "Neapolitan", "Sichuan" |
| `menu_depth` | text | shallow, moderate, deep |
| `spice_level` | text | mild, medium, hot, very hot |
| `dietary_depth` | text | How well dietary needs served |
| `service_style` | text | full service, counter, fast casual |
| `meal_pacing` | text | quick, moderate, leisurely |
| `reservation_difficulty` | text | walk-in, recommended, required, hard |
| `typical_wait_minutes` | integer | |
| `group_size_sweet_spot` | text | e.g., "2-4" |
| `check_average_per_person` | integer | USD |
| `tipping_culture` | text | |
| `kid_friendliness` | numeric | 0-10 |
| `music_vibe` | text | none, background, live, DJ |
| `decor_style` | text | |
| `conversation_friendliness` | numeric | 0-10 |
| `energy_level` | numeric | 0-10 |
| `seating_options` | text[] | bar, booth, patio, counter |
| `instagram_worthiness` | numeric | 0-10 |
| `seasonal_relevance` | jsonb | {spring, summer, fall, winter} scores |
| `cultural_authenticity` | numeric | 0-10 |
| `origin_story` | text | 2-4 sentence founding narrative |
| `crowd_profile` | text[] | e.g., ["young professionals"] |
| `neighborhood_integration` | text | |
| `chef_notable` | boolean | |
| `awards_recognition` | text[] | |
| `wow_factors` | text[] | Unique selling points |
| `date_progression` | text | |
| `best_seat_in_house` | text | |
| `ideal_weather` | text[] | |
| `unique_selling_point` | text | |
| `transit_accessibility` | text | |
| `byob_policy` | text | |
| `payment_notes` | text | |
| `enriched_at` | timestamptz | |
| `enrichment_version` | integer | Current: 2 |
| `enrichment_confidence` | numeric | 0.00-1.00 |

## occasion_scores (7 dimensions, 0-10 scale)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `restaurant_id` | uuid | FK → restaurants, UNIQUE |
| `date_friendly_score` | integer | 0-10 |
| `group_friendly_score` | integer | 0-10 |
| `family_friendly_score` | integer | 0-10 |
| `romantic_rating` | integer | 0-10 |
| `business_lunch_score` | integer | 0-10 |
| `solo_dining_score` | integer | 0-10 |
| `hole_in_wall_factor` | integer | 0-10 |

## tags

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `restaurant_id` | uuid | FK → restaurants |
| `tag_text` | text | e.g., "handmade pasta", "date night" |
| `tag_category` | text | feature, vibe, cuisine, dietary |

## neighborhoods (33 Chicago areas)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `name` | text | e.g., "Wicker Park", "Logan Square", "Pilsen" |
| `description` | text | Neighborhood character |

## restaurant_popularity

| Column | Type |
|--------|------|
| `restaurant_id` | uuid (PK, FK) |
| `recommendation_count_7d` | integer |
| `recommendation_count_30d` | integer |
| `query_demand_score` | numeric |
| `trending_score` | numeric |

## Auth Tables

**user_profiles:** `id` (uuid, PK = auth.users.id), `email`, `phone`, `created_at`, `updated_at`. Auto-created via trigger on auth.users insert.

**user_searches:** `id`, `user_id` (FK), `craving`, `occasion`, `neighborhood`, `price_level`, `dietary_restrictions`, `restaurant_id`, `restaurant_name`, `cuisine_type`, `donde_match`, `result_snapshot` (jsonb), `created_at`.

**user_favorites:** `id`, `user_id` (FK), `restaurant_id` (FK), `created_at`, `removed_at`.

**user_queries:** `id`, `user_id`, `auth_user_id`, `recommended_restaurant_id` (FK), `occasion`, `price_level`, `special_request`, `neighborhood_id`, `donde_match`, `exclude_count`, `was_fallback`, `response_time_ms`, `unmatched_keywords`, `dietary_restrictions`, `feedback`, `created_at`, `source` (text, default 'website' — distinguishes 'command-center' test traffic), `recommendation_text` (text — persisted blurb for quality auditing).

**user_visits:** `id`, `user_id`, `auth_user_id`, `restaurant_id`, `visited_at`, `created_at`. RLS: insert requires non-empty user_id; select limited to own visits.

**user_app_feedback:** `id`, `user_id`, `message`, `created_at`. RLS: insert requires non-empty user_id and message (max 2000 chars).

**gauntlet_runs:** `run_id` (text PK), `mode`, `total`, `passed_60`, `passed_80`, `avg_dm`, `gap_count`, `delta_avg_dm`, `avg_response_ms`, `dataset_hash`, `avg_score_fit` (NUMERIC(5,1) — Average score fit across run), `avg_blurb_quality` (NUMERIC(5,1) — Average blurb quality across run), `grade_pass_count` (INT — Number passing all 3 criteria), `grade_distribution` (JSONB — Distribution of letter grades), `created_at`. Stores Command Center test run summaries.

**gauntlet_results:** `id`, `run_id` (FK → gauntlet_runs), `query`, `category`, `donde_match`, `gap_type`, `gap_severity`, `restaurant_name`, `food`, `vibe`, `service`, `reputation`, `convenience`, `relevance_type`, `prev_dm`, `delta_dm`, `query_id`, `score_fit_score` (INT — Score fit grade numeric 0-100), `score_fit_grade` (TEXT — Score fit letter grade e.g. A+, A, B+), `blurb_quality_score` (INT — Blurb quality grade numeric 0-100), `blurb_quality_grade` (TEXT — Blurb quality letter grade), `created_at`. Individual test results per run.

**maintenance_requests:** `id`, `operation` (text), `status` (text, default 'pending'), `params` (jsonb), `result` (jsonb), `created_at`, `updated_at`. RLS: anon insert constrained to valid operations + pending status; only service_role can update.

## RPC: get_ranked_restaurants

```sql
get_ranked_restaurants(
  p_neighborhood text DEFAULT 'Anywhere',
  p_price_level text DEFAULT 'Any',
  p_occasion text DEFAULT 'Any',
  p_limit int DEFAULT 10,
  p_target_cuisine text DEFAULT NULL
)
```

**Joins:** restaurants LEFT JOIN neighborhoods, occasion_scores, restaurant_popularity, restaurant_deep_profiles

**Filters:** `noise_level IS NOT NULL` (must be enriched), `is_active = true`, neighborhood (unless Anywhere), price (unless Any)

**Ordering:** Cuisine boost (if target provided) → occasion score DESC → `random()` tiebreaker

**Returns:** 49 columns (core + occasion scores + all deep profile fields + tags[] + trending_score)

**Occasion → Column mapping:**

| Occasion | Column |
|----------|--------|
| Date Night | date_friendly_score |
| Group Hangout | group_friendly_score |
| Family Dinner | family_friendly_score |
| Special Occasion | 70% romantic + 30% date |
| Business Lunch | business_lunch_score |
| Solo Dining / Treat Myself | solo_dining_score |
| Adventure | hole_in_wall_factor |
| Chill Hangout | group_friendly_score |
| Any | average of all 7 |

## Migrations

61 SQL files in `supabase/migrations/` (2026-02-18 to 2026-03-12). Applied via `supabase db push` or Dashboard SQL Editor. Recent additions: cuisine taxonomy fixes (4 migrations), deep audit fixes (6 migrations — cuisine reclassifications, hallucinated data removal, pricing/logistics corrections, cross-field consistency, contradiction fixes), comprehensive data quality audit, phase 1 free enrichment, gauntlet grading columns, cuisine type analytics fixes, auto-merge CI/CD, gauntlet tracking tables, maintenance requests, RLS hardening, source column on user_queries, recommendation_text persistence.
