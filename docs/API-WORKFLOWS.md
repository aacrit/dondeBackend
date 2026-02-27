# API & Workflows

Last updated: 2026-02-27

## Edge Function Request Flow (V7.3b)

```
index.ts orchestration — single POST /recommend endpoint
```

1. **Parse & sanitize** — Extract craving, occasion, neighborhood, price, exclude, dietary, time_of_day, open_now. Prompt injection defense.
2. **Rate limit** — 30 req/min/IP (soft: logs warning, returns 429)
3. **Cache check** — 5-min TTL, 100-entry LRU. Bypassed if exclude list non-empty.
4. **[Parallel]** Intent classification (`classifyIntentV5`) + user feedback fetch + RPC `get_ranked_restaurants`
5. **Hard filter pipeline** (`runFilterPipeline`) — 6-stage cascade:
   - Exclude list → Neighborhood → Price → Dietary → Cuisine (from intent) → Open Now
   - Relaxation cascade if <12 candidates survive (drops stricter filters)
6. **V7 scoring** (`reRankV7`) — 5-factor geometric mean WITHOUT Google data. Intent alignment tiebreaker for ties ≤5 DM points.
7. **Diversity filter** — `ensureDiversity()` max 2 same cuisine in top results
8. **Google Places fetch** — Top 5 candidates, 1.5s timeout, parallel
9. **Post-Google re-score** — Re-compute all candidates with real Google data for reputation accuracy. Simple descending re-sort.
10. **Build Ranked Queue** — Top 5 results packaged as `ranked_queue` items (lightweight, no Claude call)
11. **Claude recommendation** — System prompt (voice + tone tier) + user prompt (candidates + reviews). Claude picks restaurant, writes 100-120 word blurb, optional intent boost.
12. **Intent Boost guard rails** — If Claude elevates lower candidate: base >= 35, boosted must beat #1.
13. **Cuisine mismatch cap** — If high-importance cuisine mismatch: cap DondeMatch at 65 post-Claude.
14. **Response build** — `buildV7SuccessResponse()` with `scoring_v7`, `match_narrative`, `ranked_queue`. Cache result. Fire-and-forget query log.

**Fallback tiers:** JSON parse → regex recovery → fallback response (top restaurant, no AI text) → no-results → error

## V7 Scoring Model

**Formula:** `DondeScore = (FQ^w_f * VB^w_v * SV^w_s * RP^w_r * CV^w_c) × 12`

Score range: 0-99 (clamped). Factors on 0-10 scale. Multiplier: fixed ×12.

| Factor | Base Weight | Key Signals |
|--------|------------|-------------|
| Food | 0.25 | Cuisine match, flavor profile, dietary fit, dish-level intent |
| Vibe | 0.18 | Noise, lighting, dress code, energy, music, vibe keywords |
| Service | 0.17 | Occasion base, service style, pacing, social dynamics |
| Reputation | 0.25 | Stretched Google rating (3.5→0, 5.0→10), review count confidence, awards, community signal |
| Convenience | 0.15 | Timing, reservation accessibility, wait time, parking, BYOB |

**Weight System** (`weight-config-v5.ts` — imported by scoring-v7.ts):

1. **Base weights** — Food: 0.25, Vibe: 0.18, Service: 0.17, Reputation: 0.25, Convenience: 0.15
2. **28 context shift rules** — Occasion (8), cuisine importance (3), emotional intent (3), constraints (6), context signals (8)
3. **Data-quality adaptation** — Low-confidence factors regressed toward 5.5 prior
4. **Pool-size adaptation** — Adjusts when candidate pool is slim

Clamped [0.05, 0.50], normalized to sum 1.0.

**Confidence system:** Factor-specific confidence levels (high/medium/low). Low-confidence factors regressed toward prior (5.5). Prior: all factors = 5.5.

**V7 Intent Alignment** (for ranking + UI, NOT score multiplier):
```
intentAlignment.score = weighted avg of cuisine_match + dish_match + vibe_match + constraint_match
```
Used as tiebreaker in `reRankV7`: restaurants within 5 DM points and >0.15 alignment difference get reordered.

**Score tiers:** 90+ Outstanding | 80-89 Strong Pick | 70-79 Solid Option | 60-69 Worth a Try | <60 Best Available

**Intent Boost:** Claude may elevate a lower-ranked candidate by 5-25 points. Guard rails: base score >= 35, boosted must exceed engine's #1. Post-boost cuisine mismatch cap at 65.

## Golden Dataset Benchmark

**Test:** `tests/golden-dataset-test.sh` — 50 queries, 88 checks across Food/Vibe/Service/Reputation/Convenience.

| Version | Pass | Fail | Warn | Avg DM | Notes |
|---------|------|------|------|--------|-------|
| V5 baseline | 70 | 2 | 16 | 76 | Reference |
| V7.0 | 66 | 4 | 18 | 72 | Intent multiplier caused regression |
| V7.3b (current) | 67 | 2 | 19 | 74 | V5 weights + no cuisine caps |

±4 pass variance per run due to Claude non-determinism.

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
