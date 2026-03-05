# Backend Features

Last updated: 2026-03-05

## Edge Function (V9 — active)

### Scoring Engine
- [x] V9 Relevance × Quality scoring (5 factors: Food, Vibe, Service, Reputation, Convenience)
- [x] Relevance gating via review intelligence (dish_catalog, cuisine_signals, popular_dishes)
- [x] Query-type-aware weight profiles (no weight-shift rules)
- [x] Self-healing: NULL cuisine_type → fallback to cuisine_signals (1806/2719 restaurants)
- [x] Match Narrative: structured "why this match" data (strongest_factor, key_signals, summary)
- [x] Ranked Queue: pre-computed top 5 results → instant Try Again on frontend
- [x] Post-Google re-score: all candidates re-scored with real Google data
- [x] Stretched Google rating (3.5→0, 5.0→10 for reputation factor)
- [x] OccasionBonus (±5 points)
- [x] Cuisine mismatch cap at 65 (post-Claude guard rail)

### Pipeline & Infrastructure
- [x] Deterministic intent classification (~80% zero-cost, Claude fallback ~15%)
- [x] Intent Boost — Claude may elevate lower-ranked candidate (5-25 points, guard rails)
- [x] Dietary hard filter (safety-critical, never relaxed)
- [x] Full-text search on reviews via `p_query` in `get_candidates_v9` RPC
- [x] 5-min in-memory response cache (100 entries, LRU eviction)
- [x] 30/min/IP rate limiting (soft enforcement)
- [x] Input sanitization + prompt injection defense
- [x] Tiered fallback (JSON parse → regex recovery → template → one-liner)
- [x] Slop detection (40+ banned patterns) + em dash detection
- [x] Word count guardrail (target 100-120 words)
- [x] Closed restaurant auto-substitution
- [x] Fire-and-forget query logging
- [x] Parallel execution: intent + RPC + feedback fetch; Google top-5

## Data Pipelines

- [x] Restaurant discovery (Google Places, 14 neighborhoods)
- [x] Enrichment V1 (ambiance, dietary, insider_tip)
- [x] Enrichment V2 (35-field deep profiles)
- [x] Occasion scoring (7 dimensions, 0-10 scale)
- [x] Tag generation (3-6 per restaurant)
- [x] Analytics/trending (daily aggregation)
- [x] Active status validation
- [x] Enrichment gap audit (read-only)
- [x] Tips/stories backfill (Claude Sonnet 4)
- [x] Full dataset re-enrichment

## Auth & User Features

- [x] JWT extraction from Authorization header
- [x] SSO user detection (Supabase Auth)
- [x] `user_profiles` auto-created via trigger on auth.users
- [x] `user_searches` — server-side search history (auto-saved for auth users)
- [x] `user_favorites` — server-side bookmarks
- [x] Enhanced feedback for auth users (50 vs 20 entries)
- [x] Anonymous query linking via `user_id` + `auth_user_id`
- [ ] Apple SSO (awaiting developer enrollment)
- [ ] Social providers (demand-driven)

## Database

- [x] 10 tables, 27 migrations
- [x] RPC `get_candidates_v9` (full-text search + review intelligence)
- [x] RPC `get_ranked_restaurants` (legacy, 49 return columns)
- [x] RLS policies on auth tables
- [x] Google compliance (only `google_place_id` stored)
- [x] restaurant_deep_profiles (38 enrichment fields)
- [x] restaurant_popularity (trending scores)
- [x] Keyword dictionaries (28 cuisines, 19 tags, 3 boolean features)
