# API & Workflows

Last updated: 2026-03-04

## Edge Function Request Flow (V9)

```
index.ts orchestration — single POST /recommend endpoint
```

1. **Parse & sanitize** — Extract craving, occasion, neighborhood, price, exclude, dietary, time_of_day, open_now. Prompt injection defense.
2. **Rate limit** — 30 req/min/IP (soft: logs warning, returns 429)
3. **Cache check** — 5-min TTL, 100-entry LRU. Bypassed if exclude list non-empty.
4. **[Parallel]** Intent classification (`classifyIntentV5`) + user feedback fetch + RPC `get_candidates_v9` (includes full-text search on reviews via `p_query`)
5. **Dietary filter** — Safety-critical hard filter on dietary restrictions (never relaxed). No other hard filters — V9 relevance gating handles cuisine/dish/vibe.
6. **V9 scoring** (`reRankV9`) — Relevance(0-1) × Quality(0-100) + OccasionBonus(±5). Relevance uses review intelligence (dish_catalog, cuisine_signals, popular_dishes).
7. **Diversity filter** — `ensureDiversity()` max 2 same cuisine in top results
8. **Google Places fetch** — Top 5 candidates, 1.5s timeout, parallel
9. **Post-Google re-score** — Re-compute all candidates with real Google data for reputation accuracy. Simple descending re-sort.
10. **Build Ranked Queue** — Top 5 results packaged as `ranked_queue` items (lightweight, no Claude call)
11. **Claude recommendation** — System prompt (voice + tone tier) + user prompt (candidates + reviews). Claude picks restaurant, writes 100-120 word blurb, optional intent boost.
12. **Intent Boost guard rails** — If Claude elevates lower candidate: base >= 35, boosted must beat #1.
13. **Cuisine mismatch cap** — If high-importance cuisine mismatch: cap DondeMatch at 65 post-Claude.
14. **Response build** — `buildV9SuccessResponse()` with `scoring_v9`, `match_narrative`, `ranked_queue`. Cache result. Fire-and-forget query log.

**Fallback tiers:** JSON parse → regex recovery → fallback response (top restaurant, no AI text) → no-results → error

## V9 Scoring Model

**Formula:** `DondeScore = Relevance(0-1) × Quality(0-100) + OccasionBonus(±5)`

Score range: 0-99 (clamped). Relevance is a GATE — low relevance = low score regardless of quality.

**Relevance** classifies match type using review intelligence:
- **dish** (R=1.0): Exact dish found in `dish_catalog` or `popular_dishes`
- **cuisine** (R=0.85-1.0): Cuisine matches `cuisine_signals` or `cuisine_type`
- **vibe** (R=0.50-0.75): Vibe/occasion match but no food signal
- **open_ended** (R=0.40-0.60): Generic query, no specific match signal

**Quality** computes 5 factors (0-10 each) with query-type-aware weight profiles:

| Factor | Key Signals |
|--------|-------------|
| Food | Review intelligence cuisine signals, dish catalog, menu highlights, dietary fit |
| Vibe | Noise, lighting, dress code, energy, music, vibe keywords |
| Service | Occasion base, service style, pacing, social dynamics |
| Reputation | Stretched Google rating (3.5→0, 5.0→10), review count confidence, awards |
| Convenience | Timing, reservation accessibility, wait time, parking |

**Self-healing:** When `cuisine_type` is NULL (1806/2719 restaurants), V9 falls back to `cuisine_signals` from review intelligence.

**Score tiers:** 90+ Outstanding | 80-89 Strong Pick | 70-79 Solid Option | 60-69 Worth a Try | <60 Best Available

**Intent Boost:** Claude may elevate a lower-ranked candidate by 5-25 points. Guard rails: base score >= 35, boosted must exceed engine's #1. Post-boost cuisine mismatch cap at 65.

## Scoring Test Benchmark

| Version | Tests | Pass | Notes |
|---------|-------|------|-------|
| V9.0 (current) | 95 | 95/95 | Relevance × Quality, review intelligence, self-healing |
| V7.3b (archived) | 88 | 67/88 | Geometric mean, V5 weights |

## Pipeline Inventory (18 scripts in `scripts/pipelines/`)

### Scheduled (GitHub Actions cron)

| Script | Schedule | Purpose |
|--------|----------|---------|
| `analytics.ts` | Daily 2:00 UTC | Popularity/trending score aggregation |
| `discovery.ts` | Monthly 1st, 3:00 UTC | Google Places text search (14 neighborhoods x cuisines) |
| `validate-status.ts` | Monthly 1st, 4:00 UTC | Check restaurant active status |
| `enrichment.ts` | Monthly 1st, 5:00 UTC | Claude enrichment (ambiance, dietary, insider_tip) |
| `enrichment-v2.ts` | Monthly 1st, 6:00 UTC | Deep profile enrichment (35 fields per restaurant) |
| `generate-occasion-scores.ts` | Monthly 1st, 7:00 UTC | Claude scores 7 occasion dimensions (0-10) |
| `generate-tags.ts` | Monthly 1st, 7:00 UTC | Claude generates 3-6 tags per restaurant |

### Manual Dispatch

| Script | Purpose |
|--------|---------|
| `regenerate-occasion-scores.ts` | Full scores regeneration |
| `regenerate-tags.ts` | Full tags regeneration |
| `audit-enrichment-gaps.ts` | Read-only gap report (missing tips, stories, profiles) |
| `audit-full-dataset.ts` | Comprehensive data quality audit |
| `enrich-full-dataset.ts` | Full dataset enrichment (use `--live` flag) |
| `enrich-new-or-gaps.ts` | Gap-targeted enrichment |
| `intent-gap-analysis.ts` | Intent classification gap analysis |
| `re-enrichment.ts` | Re-enrichment of existing data |
| `populate-all.ts` | Orchestrator: discovery → enrichment → scores → tags |

**Rate limits:** All Claude pipelines use 6s between batches (10 req/min). Batch size: 5-10 restaurants per call.

## Google Places Integration

**Discovery pipeline:** Text search 14 neighborhoods x multiple cuisine types. Deduplicates by place_id, maps to neighborhood via ZIP/coordinates.

**Live fetch (per recommendation request):** `fetchPlaceDetails()` for top 5 candidates with 1.5s timeout. Returns: rating, review_count, phone, website, opening_hours, reviews (max 3).

**Compliance:** Only `google_place_id` stored. All other Google data fetched live, never persisted. Per ToS §3.2.3.
