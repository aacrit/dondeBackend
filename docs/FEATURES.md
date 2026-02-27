# Backend Features

Last updated: 2026-02-27

## Edge Function (V7.3b — active)

### Scoring Engine
- [x] V7 geometric mean scoring (5 factors: Food, Vibe, Service, Reputation, Convenience)
- [x] V5 weight engine (28 context shift rules, 4 adaptive layers) — imported by V7
- [x] Intent Alignment Score (0.0–1.0): cuisine/dish/vibe/constraint matching for ranking tiebreaker
- [x] Match Narrative: structured "why this match" data for UI storytelling
- [x] Ranked Queue: pre-computed top 5 results → instant Try Again on frontend (<100ms)
- [x] Post-Google re-score: reputation re-computed with real Google ratings
- [x] Stretched Google rating (3.5→0, 5.0→10 for reputation factor)
- [x] Factor-specific confidence regression toward 5.5 prior
- [x] Intent tiebreaker in pre-Google ranking (±5 DM, >0.15 alignment difference)
- [x] Cuisine mismatch cap at 65 (post-Claude guard rail only — no in-scoring caps)

### Pipeline & Infrastructure
- [x] V5 hard filter pipeline (6 filters + relaxation cascade)
- [x] Deterministic intent classification (~80% zero-cost, Claude fallback ~15%)
- [x] Intent Boost — Claude may elevate lower-ranked candidate (5-25 points, guard rails)
- [x] 5-min in-memory response cache (100 entries, LRU eviction)
- [x] 30/min/IP rate limiting (soft enforcement)
- [x] Input sanitization + prompt injection defense
- [x] Tiered fallback (JSON parse → regex recovery → template → one-liner)
- [x] Slop detection (40+ banned patterns) + em dash detection
- [x] Word count guardrail (target 100-120 words)
- [x] Closed restaurant auto-substitution
- [x] Fire-and-forget query logging
- [x] Parallel execution: intent + RPC + feedback fetch; Google top-5

### Deprecated (dead code — do not use)
- `scoring-v5.ts` — replaced by `scoring-v7.ts`
- `scoring-v3.ts` — factor fns called directly from `scoring-v7.ts`
- `weight-config-v7.ts` — 34-rule system caused regression; `weight-config-v5.ts` used instead
- `response-builder-v5.ts` — replaced by `response-builder-v7.ts`
- `types-v5.ts` — replaced by `types-v7.ts`

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
- [x] RPC `get_ranked_restaurants` (49 return columns, single round-trip)
- [x] RLS policies on auth tables
- [x] Google compliance (only `google_place_id` stored)
- [x] restaurant_deep_profiles (38 enrichment fields)
- [x] restaurant_popularity (trending scores)
- [x] Keyword dictionaries (28 cuisines, 19 tags, 3 boolean features)
