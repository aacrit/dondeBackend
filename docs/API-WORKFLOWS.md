# API & Workflows

Last updated: 2026-02-26

## Edge Function Request Flow (V5.0.0)

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
6. **V5 scoring** (`reRankV5`) — 5-factor geometric mean WITHOUT Google data
7. **Diversity filter** — `ensureDiversity()` max 2 same cuisine in top results
8. **Google Places fetch** — Top 5 candidates, 1.5s timeout, parallel
9. **Post-Google re-rank** — Re-compute scores WITH Google data, re-sort
10. **Claude recommendation** — System prompt (voice + tone tier) + user prompt (candidates + reviews). Claude picks restaurant, writes 100-120 word blurb, optional intent boost.
11. **Intent Boost processing** — If Claude elevates a lower candidate: base >= 35, boosted must beat #1. Guard rails enforced.
12. **Response build** — `buildV5SuccessResponse()` with scoring_v5 breakdown. Cache result. Fire-and-forget query log + auto-save for auth users.

**Fallback tiers:** JSON parse → regex recovery → fallback response (top restaurant, no AI text) → no-results → error

## V5 Scoring Model

**Formula:** `DondeScore = (FQ^w_fq * VB^w_vb * SV^w_sv * RP^w_rp * CV^w_cv) * 10`

Score range: 60-99 (clamped). Factors on 0-10 scale.

| Factor | Base Weight | Key Signals |
|--------|------------|-------------|
| Food Quality | 0.25 | Cuisine match, flavor profile, dietary fit, menu interest |
| Vibe | 0.18 | Noise, lighting, dress code, energy, music, vibe keywords |
| Service | 0.17 | Occasion base, service style, pacing, social dynamics |
| Reputation | 0.25 | Stretched Google rating (4.0→0, 4.9→10), reviews, awards |
| Convenience | 0.15 | Timing, reservation, wait time, parking, practical notes |

**4-Layer Dynamic Weight System** (`weight-config-v5.ts`):

1. **Base weights** — Food: 0.25, Vibe: 0.18, Service: 0.17, Reputation: 0.25, Convenience: 0.15
2. **28 context shift rules** — Occasion (8), cuisine importance (3), emotional intent (3), constraints (6), context signals (8). Each rule adds/subtracts deltas.
3. **Data-quality adaptation** — Low-confidence factors regressed toward 5.5
4. **Pool-size adaptation** — Adjusts when candidate pool is slim vs abundant

Clamped [0.05, 0.50], normalized to sum 1.0.

**Score tiers** (`types-v5.ts`): 88+ Perfect Match | 75-87 Strong Pick | 60-74 Solid Option | 45-59 Worth a Try | <45 Best Available

**Intent Boost:** Claude may elevate a lower-ranked candidate by 5-25 points. Guard rails: base score >= 35, boosted must exceed engine's #1.

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

### One-Time

| Script | Purpose |
|--------|---------|
| `backfill-tips-stories.ts` | Insider tips + origin stories (Claude Sonnet 4) |
| `backfill-new-fields.ts` | Backfill new schema columns |

**Rate limits:** All Claude pipelines use 6s between batches (10 req/min). Batch size: 5-10 restaurants per call.

## Google Places Integration

**Discovery pipeline:** Text search 14 neighborhoods x multiple cuisine types. Deduplicates by place_id, maps to neighborhood via ZIP/coordinates.

**Live fetch (per recommendation request):** `fetchPlaceDetails()` for top 5 candidates with 1.5s timeout. Returns: rating, review_count, phone, website, opening_hours, reviews (max 3).

**Compliance:** Only `google_place_id` stored. All other Google data fetched live, never persisted. Per ToS §3.2.3.

## API Request/Response Reference

See CLAUDE.md for the full immutable API contract (request schema, response schema, error handling).

Key fields:
- **Request:** `special_request` (required), `occasion`, `neighborhood`, `price_level`, `exclude[]`, `dietary_restrictions[]`, `time_of_day`, `user_id`, `feedback`
- **Response:** `restaurant` (25+ fields), `recommendation`, `insider_tip`, `donde_match`, `scores` (7 occasion dims), `scoring_v5` (5 factors + weights + confidence), `deep_context`, `tags[]`, `intent_boost`
- **Data sources:** DB (pipeline-enriched) | Google Places (live) | Claude (live) | Computed (deterministic)
