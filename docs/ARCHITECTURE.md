# Backend Architecture

Last updated: 2026-03-13

## System Overview

| Layer | Technology |
|-------|-----------|
| API | Supabase Edge Function (Deno/TS), V11 scoring engine |
| AI | Claude Haiku 4.5 (recommendations, enrichment, intent classification) |
| DB | Supabase PostgreSQL (15 tables, 61 migrations) |
| Data | Google Places API (live fetch per request; only `google_place_id` stored per ToS §3.2.3) |
| Pipelines | Node.js 20 + tsx scripts, GitHub Actions cron |
| CI/CD | 15 GitHub Actions workflows |

## File Tree

```
supabase/
  functions/recommend/
    index.ts                      # V11 entry point (filenames retained from V9)
    _shared/                      # Active modules
      types.ts                    # Core types (RestaurantProfile, DeepProfile, etc.)
      types-v9.ts                 # V11 types (V9Candidate, V9ScoreResult, V9ScoredCandidate, MatchNarrative, etc.)
      scoring-v9.ts               # V11 scoring engine: Relevance(0-1) × Quality(0-100) + OccasionBonus(±5)
      response-builder-v9.ts      # V11 response builder (scoring_v9, ranked_queue, match_narrative)
      intent-classifier-v5.ts     # Deterministic (~80%) + Claude fallback (~15%), semantic tags
      prompts-v5.ts               # Claude system/user prompt templates (5 literary voices, 9 occasions, 5 tone tiers)
      scoring.ts                  # Shared: keyword dicts, diversity, slop detection
      intent-classifier.ts        # V4 intent types (reused by V5 classifier)
      claude.ts                   # Anthropic API client (raw fetch, prompt caching, retry)
      google-places.ts            # Google Places API wrapper (1.5s timeout)
      supabase.ts                 # Anon + service role clients
      cors.ts                     # CORS headers + JSON response helpers
      logger.ts                   # Structured JSON logging
    _archive/pre-v9/              # Deprecated V3-V8 scoring/types/filters/weights

scripts/
  lib/                            # 6 shared pipeline libraries
    config.ts, claude.ts, google-places.ts, supabase.ts, batch.ts, types.ts
  pipelines/                      # 28 pipeline scripts (see API-WORKFLOWS.md)
  package.json

tests/
  test_catalog.sh                 # 65-scenario bash API test suite
  golden-dataset-test.sh          # 50-query golden dataset benchmark (88 checks)
  benchmark-200.sh                # 200-case V11 benchmark
  regression-guard.sh             # V10 baseline regression guard
  compare-scores.sh               # A/B score comparison tool
  TEST-FULL.md                    # 170-scenario agent-driven test spec
  GOLDEN_DATASET_RESULTS.md       # Latest golden dataset results

.github/workflows/                # 15 CI/CD workflows

.devcontainer/
  devcontainer.json               # Codespace config (Node 20, port forwarding)
  setup.sh                        # Installs Claude Code CLI + Supabase CLI
```

## V11 Scoring Engine Modules

| Module | Purpose | Status |
|--------|---------|--------|
| `scoring-v9.ts` | Relevance × Quality engine with review intelligence, semantic matching, query-type-aware weights, match narrative | **Active (V11)** |
| `types-v9.ts` | V9Candidate, V9ScoreResult, V9ScoredCandidate, V9Factors, MatchNarrative, ClaudeRecommendation | **Active (V11)** |
| `response-builder-v9.ts` | Builds `scoring_v9` (relevance + quality + factors), `ranked_queue`, `match_narrative`, queue blurbs | **Active (V11)** |
| `intent-classifier-v5.ts` | Deterministic intent classification + semantic tags, similar_to, mood, implicit_cuisines | **Active** |
| `prompts-v5.ts` | Claude prompt templates — 5 literary personas, 9 occasion registers, 5 tone tiers | **Active** |
| All V3-V8 modules | Archived to `_archive/pre-v9/` | **Archived** |

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
| `enrichment-semantic.yml` | Manual dispatch | Semantic enrichment pipeline |
| `scores-and-tags.yml` | Monthly 1st, 7:00 UTC | Occasion scores (7 dims) + tag generation |
| `regenerate-scores-tags.yml` | Manual dispatch | Full scores + tags regeneration |
| `run-review-intelligence.yml` | Manual dispatch | Review intelligence extraction |
| `deploy-edge-function.yml` | Push to any branch + manual dispatch | Edge Function deployment |
| `apply-migration.yml` | Manual dispatch | Apply SQL migration to Supabase |
| `migrate.yml` | Manual dispatch | Database migration runner |
| `auto-merge-claude.yml` | On push to `claude/**` | Auto-merges claude branches to main |
| `auto-migrate.yml` | On push (when `supabase/migrations/**` changes) | Auto-applies new migrations to Supabase |
| `maintenance-worker.yml` | Every 5 min | Polls `maintenance_requests` table, executes pipeline operations |

## Google API Compliance

Only `google_place_id` stored permanently. `name`/`address` stored as editorial content. All Google-sourced data (rating, reviews, photos, hours, phone, website) fetched live per request, never persisted. Per Google Places API ToS §3.2.3.
