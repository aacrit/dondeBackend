# API & Workflows

Last updated: 2026-03-17

## Edge Function Request Flow (V11)

```
index.ts orchestration — single POST /recommend endpoint
```

1. **Parse & sanitize** — Extract craving, occasion, neighborhood, price, exclude, dietary, time_of_day, open_now. Prompt injection defense.
2. **Neighborhood detection** — V18: When `neighborhood` is "Anywhere", scans `special_request` for NEIGHBORHOOD_ALIASES (sorted longest-first to avoid partial matches). "near wrigley field" auto-sets neighborhood to "Lakeview" for RPC filtering.
3. **Rate limit** — 30 req/min/IP (soft: logs warning, returns 429)
4. **In-memory cache check** — 15-min soft TTL, 30-min hard TTL, stale-while-revalidate. Bypassed if exclude list non-empty.
5. **Persistent cache L1** — DondeCache exact key lookup. If hit, return immediately (~50ms). For "Try Another" (exclude non-empty), check `ranked_queue` for next eligible result.
6. **[Parallel]** Intent classification (`classifyIntentV5` — deterministic + LLM fallback with `semantic_tags`, `similar_to`, `mood`, `implicit_cuisines`) + user feedback fetch + user preference profile fetch
7. **Persistent cache L2/L3** — After intent classification, try fingerprint match (L2) and canonical form match (L3). Fuzzy matching via synonym normalization + dish canonicalization.
8. **Concept expansion** — V17/V18: Merge concept constraints, tags, and vibes into intent for scoring. Track `_originalVibeCount` before merging.
9. **RPC candidates** — `get_candidates_v11` (composite scoring with `p_semantic_tags`, fallback to V10 → V9 RPC). Dynamic candidate pool: 100 for complex queries.
10. **Dietary filter** — Safety-critical hard filter on dietary restrictions (never relaxed). No other hard filters — V11 relevance gating handles cuisine/dish/vibe/semantic.
11. **V11 scoring** (`reRankV9`) — Relevance(0-1) x Quality(0-100) + OccasionBonus(+/-5). V18+ quality floors. 6 weight profiles.
12. **Post-scoring filters** — `applyPostScoringFilters()`: neighborhood + price hard filters with 3-phase graceful expansion (exact -> adjacent -> best available). Bypassed for "Anywhere"/"Any".
13. **Diversity filter** — `ensureDiversity()` max 2 same cuisine in top results
14. **Google Places fetch** — Top 5 candidates, 1.5s timeout, parallel
15. **Post-Google re-score** — Re-compute all candidates with real Google data for reputation accuracy. Simple descending re-sort.
16. **MMR diversity re-ranking** — `applyMMRDiversity()` for queue positions #2-5. Lambda=0.7. Cuisine/neighborhood/price diversity. Discovery pick at position 4-5.
17. **Build Ranked Queue** — Top 5 results packaged as `ranked_queue` items (template blurbs, no Claude call)
18. **Circuit breaker check** — If Claude circuit is OPEN (3+ consecutive failures), skip Claude and use deterministic blurbs. Auto-recovers after 60s cooldown.
19. **Claude recommendation** — System prompt (character voice + literary persona + occasion register + tone tier) + user prompt (candidates + reviews + deep profiles). Claude picks restaurant, writes 100-120 word blurb, optional intent boost. Budget-aware retries (60/40 split).
20. **Intent Boost guard rails** — If Claude elevates lower candidate: base >= 35, max boost +35, total <= 99.
21. **Cuisine mismatch cap** — If high-importance cuisine mismatch: cap DondeMatch at 65 post-Claude.
22. **Quality guardrails** — Slop detection (67 banned patterns), em dash stripping, word count check (100-120), "we/our" voice mandate.
23. **Shadow personalization** — `computeShadowPersonalization()` computes boost from `user_taste_profiles` (cuisine/neighborhood/vibe affinity). Logged but not applied to score. Response field: `personalization`.
24. **ML scoring** — `applyMLAdjustments()` from `ml-adjustment.ts`. A/B test: 50% get ML-adjusted scores (+/-5 DM), 50% get pure rules. Response field: `ml_scoring`.
25. **Score decompression** — `decompressScore()` piecewise linear mapping. Widens 72-86 DM band. Applied AFTER grading so grading uses raw scores.
26. **Response build** — `buildV9SuccessResponse()` with `scoring_v9`, `match_narrative`, `ranked_queue`, `circuit_breaker`, `personalization`, `ml_scoring`, `response_time_ms`. Cache result. Fire-and-forget query log + score validation grading.
27. **Telemetry header** — `X-Donde-Timing` header with per-component timing breakdown (9 markers).
28. **Persistent cache write-through** — Quality-gated (score fit >= 80 AND blurb quality >= 80). Stores response with intent fingerprint + canonical form for L2/L3 future hits.

**Fallback tiers:** JSON parse → regex recovery → fallback response (top restaurant, no AI text) → no-results → error

## V11 Scoring Model

**Formula:** `DondeScore = Relevance(0-1) × Quality(0-100) + OccasionBonus(±5)`

Score range: 0-99 (clamped). Relevance is a GATE — low relevance = low score regardless of quality.

**Relevance** classifies match type using review intelligence + semantic matching:
- **dish** (R=1.0): Exact dish found in `dish_catalog` or `popular_dishes` (150+ synonyms)
- **cuisine** (R=0.85-1.0): Cuisine matches `cuisine_signals` or `cuisine_type`
- **vibe** (R=0.45-0.75): Vibe/occasion match, dynamic floor based on signal count
- **semantic** (R=0.50-0.80): Semantic tag matching via `computeSemanticRelevance()`
- **reputation** (R=0.45-0.70): Chef/award/reputation match, blended with vibe/constraint signals
- **open_ended** (R=0.40-1.0): Generic query or neighborhood match (V18: R=1.0 for neighborhood match, R=0.50 for mismatch)

**Quality** computes 5 factors (0-10 each) with query-type-aware weight profiles:

| Factor | Key Signals |
|--------|-------------|
| Food | Review intelligence cuisine signals, dish catalog, menu highlights, dietary fit, dish synonyms |
| Vibe | Noise, lighting, dress code, energy, music, vibe keywords, crowd_profile, wow_factors |
| Service | Occasion base, service style, pacing, social dynamics, crowd matching |
| Reputation | Stretched Google rating (3.5→0, 5.0→10), review count confidence, awards, chef_notable |
| Convenience | Timing, reservation accessibility, wait time, parking, practical constraints |

**Quality floors (V18):** cuisine/dish >=74 (rel>=0.90), >=68 (rel>=0.70); neighborhood >=80 (rel>=0.90); vibe >=68 (rel>=0.75); reputation >=72 (rel>=0.80).

**Self-healing:** When `cuisine_type` is NULL (29/2,719 restaurants — down from 1,806 after cuisine taxonomy fixes), V11 falls back to `cuisine_signals` from review intelligence.

**Score tiers:** 90+ Outstanding | 80-89 Strong Pick | 70-79 Solid Option | 60-69 Worth a Try | <60 Best Available

**Intent Boost:** Claude may elevate a lower-ranked candidate by 5-35 points. Guard rails: base score ≥ 35, max boost +35, total ≤ 99. Post-boost cuisine mismatch cap at 65.

## Scoring Test Benchmark

| Version | Tests | Pass | Notes |
|---------|-------|------|-------|
| V19+ (current) | 188 checks | 188P/0F/0W | Golden dataset, avg DM 80, 100% pass rate, $0 cost |
| V18 | 188 checks | 177P/0F/11W | Golden dataset, avg DM 77, avg SF 88, avg BQ 79 |
| V16 | 188 checks | 177P/0F/11W | First pass of V16 fixes |
| V11 | 188 checks | 142P/2F/44W | Semantic matching, avg DM 76 |
| V10 (baseline) | 50 | 44P/4F/2W | Golden dataset, avg DM 70 |
| V9.0 | 95 | 95/95 | Relevance x Quality, review intelligence, self-healing |
| V7.3b (archived) | 88 | 67/88 | Geometric mean, V5 weights |

## Pipeline Inventory (35 scripts in `scripts/pipelines/`)

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
| `enrichment-review-intelligence.ts` | Monthly 1st | V11 semantic descriptors, scenarios, wow_factors |
| `maintenance-worker.ts` | Every 5 min (GH Actions) | Cron worker for CEO Command Center pipeline triggers |
| `cache-warmer.ts` | Daily midnight Chicago (06:00 UTC) | DondeCache pre-warming (3 sources: popular/golden/manual, budget-gated) |
| `cache-invalidator.ts` | Daily (with cache-warmer) | Cleanup expired/stale cache entries, engine version invalidation |

### Manual Dispatch

| Script | Purpose |
|--------|---------|
| `audit-enrichment-gaps.ts` | Read-only gap report (missing tips, stories, profiles) |
| `audit-full-dataset.ts` | Comprehensive data quality audit |
| `enrich-full-dataset.ts` | Full dataset enrichment (use `--live` flag) |
| `enrich-new-or-gaps.ts` | Gap-targeted enrichment |
| `intent-gap-analysis.ts` | Intent classification gap analysis |
| `re-enrichment.ts` | Re-enrichment of existing data |
| `populate-all.ts` | Orchestrator: discovery → enrichment → scores → tags |
| `gauntlet-runner.ts` | Command Center gauntlet test execution |
| `gauntlet-dashboard.ts` | Gauntlet markdown + JSON report generation |
| `gauntlet-backfill.ts` | Backfill gauntlet results from historical data |
| `agent-orchestrator.ts` | Multi-agent pipeline orchestration |
| `gap-analyzer.ts` | Scoring gap analysis and detection |
| `generate-search-atlas.ts` | Search atlas generation for discovery |
| `backfill-new-fields.ts` | Backfill newly added DB fields |
| `backfill-tips-stories.ts` | Tips/stories backfill (Claude Sonnet 4) |
| `clean-unenriched.ts` | Clean up unenriched restaurant records |
| `convert-v8-to-atlas.ts` | V8 → Atlas data conversion utility |
| `regenerate-occasion-scores.ts` | Full regeneration of all occasion scores |
| `regenerate-tags.ts` | Full regeneration of all restaurant tags |
| `query-miner.ts` | Extract canonical queries from user_queries for cache warming |
| `blurb-upgrader.ts` | Upgrade deterministic cache blurbs to Claude-tailored blurbs via Claude Max CLI ($0) |
| `reservation-enrichment.ts` | OpenTable + Resy deep link enrichment for all restaurants ($0) |
| `resy-enrichment.ts` | Resy venue validation via public search API ($0) |
| `generate-embeddings.ts` | Generate pgvector embeddings (Ollama/OpenAI-style APIs) |

**ML Training Pipeline** (`scripts/ml/` — 17 files, separate from data pipelines):

| Script | Purpose |
|--------|---------|
| `harvest-training-data.sh` | Harvest training data from golden dataset via CLI agents ($0) |
| `merge-training-data.py` | Merge features + rankings into training-ready dataset |
| `train-model.py` | XGBoost LambdaMART + GroupKFold cross-validation |
| `train-simple.py` | Zero-dep linear fallback trainer |
| `simulate-ab-test.py` | A/B test simulation framework |

**Rate limits:** All Claude pipelines use 6s between batches (10 req/min). Batch size: 5-10 restaurants per call.

## Google Places Integration

**Discovery pipeline:** Text search 14 neighborhoods x multiple cuisine types. Deduplicates by place_id, maps to neighborhood via ZIP/coordinates.

**Live fetch (per recommendation request):** `fetchPlaceDetails()` for top 5 candidates with 1.5s timeout. Returns: rating, review_count, phone, website, opening_hours, reviews (max 3).

**Compliance:** Only `google_place_id` stored. All other Google data fetched live, never persisted. Per ToS §3.2.3.
