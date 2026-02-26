# Backend Architecture

Last updated: 2026-02-26

## System Overview

| Layer | Technology |
|-------|-----------|
| API | Supabase Edge Function (Deno/TS), V5.0.0 |
| AI | Claude Haiku 4.5 (recommendations, enrichment, scoring, intent classification) |
| DB | Supabase PostgreSQL (10 tables, 27 migrations) |
| Data | Google Places API (live fetch per request; only `google_place_id` stored per ToS §3.2.3) |
| Pipelines | Node.js 20 + tsx scripts, GitHub Actions cron |
| CI/CD | 8 GitHub Actions workflows |

## File Tree

```
supabase/
  functions/recommend/
    index.ts                      # V5.0.0 entry point (832 lines)
    _shared/                      # 16 shared modules
      types.ts                    # Core types (RestaurantProfile, DeepProfile, etc.)
      types-v5.ts                 # V5 types (V5ScoredCandidate, V5Factors, etc.)
      scoring-v5.ts               # V5 5-factor geometric mean engine
      weight-config-v5.ts         # 4-layer adaptive weight system (28 shift rules)
      intent-classifier-v5.ts     # Deterministic (~80%) + Claude fallback (~15%)
      filter-pipeline-v5.ts       # Hard filter cascade (6 filters + relaxation)
      prompts-v5.ts               # Claude system/user prompt templates
      response-builder-v5.ts      # API response construction + fallbacks
      scoring.ts                  # Legacy keyword dicts, diversity, slop detection
      scoring-v3.ts               # Factor computation functions (reused by V5)
      intent-classifier.ts        # V4 intent (types reused by V5)
      claude.ts                   # Anthropic API client (raw fetch, prompt caching)
      google-places.ts            # Google Places API wrapper (1.5s timeout)
      supabase.ts                 # Anon + service role clients
      cors.ts                     # CORS headers + JSON response helpers
      logger.ts                   # Structured JSON logging
  migrations/                     # 27 SQL migration files (2026-02-18 to 2026-02-26)

scripts/
  lib/                            # 6 shared pipeline libraries
    config.ts                     # Chicago neighborhoods, cuisines, coordinates
    claude.ts                     # Node.js Anthropic SDK client
    google-places.ts              # Google Places wrapper (Node version)
    supabase.ts                   # Admin Supabase client (service role)
    batch.ts                      # Batch processing utility
    types.ts                      # Pipeline-specific types
  pipelines/                      # 18 pipeline scripts (see API-WORKFLOWS.md)
  package.json                    # npm scripts for pipelines

tests/
  test_catalog.sh                 # 65-scenario bash API test suite
  TEST-FULL.md                    # 170-scenario agent-driven test spec
  TEST_RESULTS.md                 # Latest test results

.github/workflows/                # 8 CI/CD workflows (see below)
```

## Edge Function Modules (V5)

| Module | Purpose | Size |
|--------|---------|------|
| `index.ts` | Orchestration: parse → rate limit → cache → intent → filter → score → Google → Claude → respond | 832 lines |
| `scoring-v5.ts` | 5-factor geometric mean: `(FQ^w * VB^w * SV^w * RP^w * CV^w) * 10` | 20 KB |
| `weight-config-v5.ts` | 4-layer weights: base → 28 context shifts → data-quality → pool-size | 13 KB |
| `intent-classifier-v5.ts` | Deterministic keyword parsing (~80%), Claude Haiku fallback (~15%) | 24 KB |
| `filter-pipeline-v5.ts` | Hard cascade: exclude → neighborhood → price → dietary → cuisine → open now | 13 KB |
| `prompts-v5.ts` | System prompt (voice + tone tiers + banned words) + user prompt (candidates) | 13 KB |
| `response-builder-v5.ts` | Success / fallback / no-results / error response builders | 12 KB |
| `scoring.ts` | Legacy: keyword dicts (28 cuisines, 19 tags), `ensureDiversity()`, slop patterns | 125 KB |
| `scoring-v3.ts` | Individual factor functions: `computeFoodQuality()`, `computeVibe()`, etc. | 67 KB |

## Deployment

| Target | Trigger | Method |
|--------|---------|--------|
| Edge Function | Push to `main`/`claude/**` (when `supabase/functions/recommend/**` changes) | `deploy-edge-function.yml` |
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
| `deploy-edge-function.yml` | Push + manual dispatch | Edge Function deployment |

## Google API Compliance

Only `google_place_id` stored permanently. `name`/`address` stored as editorial content. All Google-sourced data (rating, reviews, photos, hours, phone, website) fetched live per request, never persisted. Per Google Places API ToS §3.2.3.
