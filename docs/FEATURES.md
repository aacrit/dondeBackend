# Backend Features

Last updated: 2026-03-12

## Edge Function (V11 — active, files retain V9 naming)

### Scoring Engine
- [x] V11 Relevance × Quality scoring (5 factors: Food, Vibe, Service, Reputation, Convenience)
- [x] Relevance gating via review intelligence (dish_catalog, cuisine_signals, popular_dishes)
- [x] Semantic concept matching via `computeSemanticRelevance()` (40+ concepts)
- [x] Query expansion engine (`expandQueryConcepts()`) with cross-cuisine dish synonyms (150+)
- [x] LLM-enhanced intent classification with semantic_tags, similar_to, mood, implicit_cuisines
- [x] 6 query-type-aware weight profiles (dish, cuisine, vibe, reputation, open_ended, multi_signal)
- [x] Dynamic vibe relevance floor (0.45 for 3+ signals)
- [x] Composite RPC scoring (V11) — all signals scored simultaneously
- [x] Dynamic candidate pool: 100 for complex/semantic queries (was 50/80)
- [x] Self-healing: NULL cuisine_type → fallback to cuisine_signals (29/2,719 restaurants — down from 1,806)
- [x] Match Narrative: structured "why this match" data (strongest_factor, key_signals, summary)
- [x] Ranked Queue: pre-computed top 5 results → instant Try Again on frontend
- [x] Post-Google re-score: all candidates re-scored with real Google data
- [x] Stretched Google rating (3.5→0, 5.0→10 for reputation factor)
- [x] Confidence-weighted quality: CONFIDENCE_MEAN=55, confidenceFactor 0.80-1.0
- [x] OccasionBonus (±5 points)
- [x] Cuisine mismatch cap at 65 (post-Claude guard rail)

### Blurb Generation
- [x] Claude Haiku 4.5 blurb generation (100-120 words, single API call)
- [x] 5 literary personas (Camus, Yoshimoto, Lahiri, Gibran, García Márquez) by cuisine
- [x] 9 occasion registers (Date Night, Solo, Group, Family, Business, Special, Treat, Adventure, Chill)
- [x] 5 score-tier tone directives (Perfect Match → Best Available)
- [x] Blurb-only endpoint (POST /recommend/blurb) for Try Again regeneration
- [x] Template-based queue blurbs (no API call for items #2-#8)

### Pipeline & Infrastructure
- [x] Deterministic intent classification (~80% zero-cost, Claude fallback ~15%)
- [x] Intent Boost — Claude may elevate lower-ranked candidate (5-35 points, guard rails)
- [x] Dietary hard filter (safety-critical, never relaxed)
- [x] Semantic tag search in RPC via `p_semantic_tags`
- [x] V11 RPC with fallback chain (V11 → V10 → V9)
- [x] 5-min in-memory response cache (100 entries, LRU, stale-while-revalidate at 15 min)
- [x] 30/min/IP rate limiting (soft enforcement)
- [x] Input sanitization + prompt injection defense
- [x] Tiered fallback (JSON parse → regex recovery → template → one-liner)
- [x] Quality guardrails: slop detection (67 banned patterns), em dash stripping, word count, voice mandate
- [x] Closed restaurant auto-substitution
- [x] Fire-and-forget query logging
- [x] Parallel execution: intent + RPC + feedback fetch; Google top-5

## Data Pipelines

- [x] Restaurant discovery (Google Places, 14 neighborhoods)
- [x] Enrichment V1 (ambiance, dietary, insider_tip)
- [x] Enrichment V2 (35-field deep profiles)
- [x] Review intelligence enrichment (V11 semantic descriptors, scenarios, wow_factors)
- [x] Occasion scoring (7 dimensions, 0-10 scale)
- [x] Tag generation (3-6 per restaurant)
- [x] Analytics/trending (daily aggregation)
- [x] Active status validation
- [x] Enrichment gap audit (read-only)
- [x] Tips/stories backfill (Claude Sonnet 4)
- [x] Full dataset re-enrichment
- [x] Maintenance worker (5-min cron, polls maintenance_requests table)

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

- [x] 10 tables, 43 migrations
- [x] RPC `get_candidates_v11` (composite scoring with semantic tags, fallback V10 → V9)
- [x] RPC `get_candidates_v9` (full-text search + review intelligence)
- [x] RPC `get_ranked_restaurants` (legacy, 49 return columns)
- [x] RLS policies on auth tables
- [x] Google compliance (only `google_place_id` stored)
- [x] restaurant_deep_profiles (38 enrichment fields)
- [x] restaurant_popularity (trending scores)
- [x] Keyword dictionaries (28 cuisines, 19 tags, 3 boolean features)
- [x] gauntlet_runs + gauntlet_results (test tracking)
- [x] maintenance_requests (pipeline queue for CEO Command Center)
