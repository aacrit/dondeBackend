# Backend Architecture

Last updated: 2026-02-27

## System Overview

| Layer | Technology |
|-------|-----------|
| API | Supabase Edge Function (Deno/TS), V7.3b |
| AI | Claude Haiku 4.5 (recommendations, enrichment, intent classification) |
| DB | Supabase PostgreSQL (10 tables, 27 migrations) |
| Data | Google Places API (live fetch per request; only `google_place_id` stored per ToS §3.2.3) |
| Pipelines | Node.js 20 + tsx scripts, GitHub Actions cron |
| CI/CD | 8 GitHub Actions workflows |

## File Tree

```
supabase/
  functions/recommend/
    index.ts                      # V7.3b entry point
    _shared/                      # 18 shared modules
      types.ts                    # Core types (RestaurantProfile, DeepProfile, etc.)
      types-v7.ts                 # V7 types (V7Factors, V7Weights, V7MatchNarrative, V7IntentAlignment, etc.)
      scoring-v7.ts               # V7 consolidated scoring engine (imports V3 factors + V5 weights)
      weight-config-v7.ts         # [DEPRECATED] V7 34-rule weight system — replaced by V5 weights in V7.3
      response-builder-v7.ts      # V7 response builder (ranked_queue, match_narrative, intent_alignment)
      intent-classifier-v5.ts     # Deterministic (~80%) + Claude fallback (~15%)
      filter-pipeline-v5.ts       # Hard filter cascade (6 filters + relaxation)
      prompts-v5.ts               # Claude system/user prompt templates
      scoring.ts                  # Shared: keyword dicts, diversity, slop detection
      scoring-v3.ts               # [DEPRECATED] Factor functions — reused by scoring-v7.ts
      scoring-v5.ts               # [DEPRECATED] V5 engine — replaced by scoring-v7.ts
      weight-config-v5.ts         # V5 weight engine (28 rules) — still imported by scoring-v7.ts
      types-v5.ts                 # [DEPRECATED] V5 types
      response-builder-v5.ts      # [DEPRECATED] V5 response builder
      intent-classifier.ts        # V4 intent types (reused by V5 classifier)
      claude.ts                   # Anthropic API client (raw fetch, prompt caching)
      google-places.ts            # Google Places API wrapper (1.5s timeout)
      supabase.ts                 # Anon + service role clients
      cors.ts                     # CORS headers + JSON response helpers
      logger.ts                   # Structured JSON logging
  migrations/                     # 27 SQL migration files

scripts/
  lib/                            # 6 shared pipeline libraries
    config.ts, claude.ts, google-places.ts, supabase.ts, batch.ts, types.ts
  pipelines/                      # 18 pipeline scripts (see API-WORKFLOWS.md)
  package.json

tests/
  test_catalog.sh                 # 65-scenario bash API test suite
  golden-dataset-test.sh          # 50-query golden dataset benchmark (88 checks)
  TEST-FULL.md                    # 170-scenario agent-driven test spec
  GOLDEN_DATASET_RESULTS.md       # Latest golden dataset results
  TEST_RESULTS.md                 # Latest catalog results

.github/workflows/                # 8 CI/CD workflows
```

## V7 Scoring Engine Modules

| Module | Purpose | Status |
|--------|---------|--------|
| `scoring-v7.ts` | Consolidated 5-factor engine: V3 factor fns + V5 weights + V7 intent alignment, match narrative, ranked queue | **Active** |
| `weight-config-v5.ts` | 28-rule adaptive weight system (imported by scoring-v7.ts) | **Active** |
| `response-builder-v7.ts` | Builds `scoring_v7`, `ranked_queue`, `match_narrative`, `intent_alignment` fields | **Active** |
| `types-v7.ts` | V7Factors, V7Weights, V7MatchNarrative, V7IntentAlignment, V7ScoredCandidate | **Active** |
| `scoring-v5.ts` | Old V5 engine | **@deprecated** |
| `weight-config-v7.ts` | Old V7 34-rule engine with stacking caps (caused score regression) | **@deprecated** |
| `scoring-v3.ts` | V3 factor functions (computeFoodMatch, computeAtmosphere, etc.) — still called by scoring-v7.ts | **@deprecated** |
| `types-v5.ts`, `response-builder-v5.ts` | Old V5 types + builder | **@deprecated** |

## Deployment

| Target | Trigger | Method |
|--------|---------|--------|
| Edge Function | Push to any branch (when `supabase/functions/recommend/**` changes) | `deploy-edge-function.yml` |
| Migrations | Manual | `supabase db push` or Dashboard SQL Editor |
| Pipelines | Cron (monthly) + manual dispatch | GitHub Actions |

## CI/CD Workflows

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| `analytics.yml` | Daily 2:00 UTC | Popularity/trending analytics |
| `discovery.yml` | Monthly 1st, 3:00 UTC | Google Places restaurant discovery |
| `validate-status.yml` | Monthly 1st, 4:00 UTC | Active status validation |
| `enrichment.yml` | Monthly 1st, 5:00 UTC | Claude enrichment (ambiance, dietary, insider tips) |
| `enrichment-v2.yml` | Monthly 1st, 6:00 UTC | Deep profile enrichment (35 fields) |
| `scores-and-tags.yml` | Monthly 1st, 7:00 UTC | Occasion scores (7 dims) + tag generation |
| `regenerate-scores-tags.yml` | Manual dispatch | Full scores + tags regeneration |
| `deploy-edge-function.yml` | Push to any branch + manual dispatch | Edge Function deployment |

## Google API Compliance

Only `google_place_id` stored permanently. `name`/`address` stored as editorial content. All Google-sourced data (rating, reviews, photos, hours, phone, website) fetched live per request, never persisted. Per Google Places API ToS §3.2.3.
