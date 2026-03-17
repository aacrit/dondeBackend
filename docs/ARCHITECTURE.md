# Backend Architecture

Last updated: 2026-03-17

## System Overview

| Layer | Technology |
|-------|-----------|
| API | Supabase Edge Function (Deno/TS), V11 scoring engine (V19+ tuning) |
| AI | Claude Haiku 4.5 (recommendations, enrichment, intent classification) |
| ML | Linear/XGBoost scoring adjustment, A/B testing (50/50 split), `ml-adjustment.ts` |
| DB | Supabase PostgreSQL (21 tables, 73 migrations, pgvector extension) |
| Cache | DondeCache — persistent 3-level fuzzy query cache (exact/fingerprint/canonical) |
| Vectors | pgvector HNSW indexes on `restaurant_embeddings` + `query_embeddings` (384-dim) |
| Data | Google Places API (live fetch per request; only `google_place_id` stored per ToS §3.2.3) |
| Reservations | Resy + OpenTable deep links via `restaurant_reservations` table |
| Pipelines | Node.js 20 + tsx scripts (35 pipelines), GitHub Actions cron |
| ML Training | `scripts/ml/` — Python XGBoost + TS inference, 1,050 training pairs |
| CI/CD | 16 GitHub Actions workflows |

## File Tree

```
supabase/
  functions/recommend/
    index.ts                      # V11 entry point (filenames retained from V9)
    _shared/                      # 19 TS modules + 1 JSON model
      types.ts                    # Core types (RestaurantProfile, DeepProfile, etc.)
      types-v9.ts                 # V11 types (V9Candidate, V9ScoreResult, V9ScoredCandidate, MatchNarrative, etc.)
      scoring-v9.ts               # V11 scoring engine + MMR diversity + score decompression
      response-builder-v9.ts      # V11 response builder (scoring_v9, ranked_queue, match_narrative)
      intent-classifier-v5.ts     # Deterministic (~80%) + Claude fallback (~15%), semantic tags
      prompts-v5.ts               # Claude system/user prompt templates (5 literary voices, 9 occasions, 5 tone tiers)
      scoring.ts                  # Shared: keyword dicts, diversity, slop detection
      grading.ts                  # Score fit + blurb quality grading (mirrors cc-grading.js)
      query-cache.ts              # DondeCache — 3-level persistent cache (exact/fingerprint/canonical)
      circuit-breaker.ts          # 3-state circuit breaker for Claude API (CLOSED/OPEN/HALF_OPEN)
      ml-adjustment.ts            # ML scoring layer — 22-feature extraction + linear/tree inference + A/B
      ml-model.json               # Pre-trained ML model weights (linear v1.0)
      post-filters.ts             # Post-scoring neighborhood + price filters with graceful expansion
      reservation-links.ts        # Resy + OpenTable deep link builder (Project Foxtrot)
      intent-classifier.ts        # V4 intent types (reused by V5 classifier)
      claude.ts                   # Anthropic API client (raw fetch, prompt caching, retry, circuit breaker)
      google-places.ts            # Google Places API wrapper (1.5s timeout)
      supabase.ts                 # Anon + service role clients
      cors.ts                     # CORS headers + security headers + JSON response helpers
      logger.ts                   # Structured JSON logging
    _archive/pre-v9/              # Deprecated V3-V8 scoring/types/filters/weights

scripts/
  lib/                            # 6 shared pipeline libraries
    config.ts, claude.ts, google-places.ts, supabase.ts, batch.ts, types.ts
  pipelines/                      # 35 pipeline scripts (see API-WORKFLOWS.md)
  ml/                             # 17 ML training files (Python + TS + JSON datasets)
    train-model.py                # XGBoost LambdaMART + GroupKFold
    train-simple.py               # Zero-dep linear fallback
    merge-training-data.py        # Feature merging + dedup
    harvest-training-data.sh      # $0 training data harvester via CLI agents
    model.json                    # Trained model output
    training-data*.json           # 1,050 Opus-ranked training pairs (4 batches)
  run-reservation-enrichment.sh   # Combined OpenTable + Resy pipeline runner
  package.json

tests/
  test_catalog.sh                 # 65-scenario bash API test suite
  golden-dataset-test.sh          # 50-query golden dataset benchmark (188 checks)
  benchmark-200.sh                # 200-case V11 benchmark
  regression-guard.sh             # V10 baseline regression guard
  compare-scores.sh               # A/B score comparison tool
  scoring-engine-500.sh           # 500-case scoring engine stress test
  uat-targeted-test.sh            # 30-case targeted UAT test suite
  TEST-FULL.md                    # 170-scenario agent-driven test spec
  GOLDEN_DATASET_RESULTS.md       # Latest golden dataset results
  generated-queries.json          # 210 persona-driven test queries

.github/workflows/                # 16 CI/CD workflows

.devcontainer/
  devcontainer.json               # Codespace config (Node 20, port forwarding)
  setup.sh                        # Installs Claude Code CLI + Supabase CLI
```

## V11 Scoring Engine Modules

| Module | Purpose | Status |
|--------|---------|--------|
| `scoring-v9.ts` | Relevance x Quality engine + MMR diversity + score decompression + match narrative | **Active (V11/V19+)** |
| `types-v9.ts` | V9Candidate, V9ScoreResult, V9ScoredCandidate, V9Factors, MatchNarrative, TasteProfile, PersonalizationResult | **Active (V11)** |
| `response-builder-v9.ts` | Builds `scoring_v9`, `ranked_queue`, `match_narrative`, queue blurbs | **Active (V11)** |
| `intent-classifier-v5.ts` | Deterministic intent classification + semantic tags, similar_to, mood, implicit_cuisines | **Active** |
| `prompts-v5.ts` | Claude prompt templates — 5 literary personas, 9 occasion registers, 5 tone tiers | **Active** |
| `grading.ts` | Server-side score fit + blurb quality grading (mirrors cc-grading.js) | **Active** |
| `query-cache.ts` | DondeCache — 3-level persistent cache with fuzzy matching + quality gate | **Active** |
| `circuit-breaker.ts` | 3-state circuit breaker for Claude API calls (CLOSED/OPEN/HALF_OPEN, 60s cooldown) | **Active** |
| `ml-adjustment.ts` | ML scoring layer — 22-feature extraction, linear/tree inference, A/B testing (50/50) | **Active** |
| `post-filters.ts` | Post-scoring neighborhood + price filters with 3-phase graceful expansion | **Active** |
| `reservation-links.ts` | Resy + OpenTable deep link builder + Resy availability check | **Active** |
| All V3-V8 modules | Archived to `_archive/pre-v9/` | **Archived** |

## Deployment

| Target | Trigger | Method |
|--------|---------|--------|
| Edge Function | Push to any branch (when `supabase/functions/recommend/**` changes) | `deploy-edge-function.yml` |
| Migrations (73) | Manual | `supabase db push` or Dashboard SQL Editor |
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
| `cache-warmer.yml` | Daily midnight Chicago (06:00 UTC) + manual dispatch | DondeCache pre-warming: mine queries → invalidate stale → warm cache |

## Google API Compliance

Only `google_place_id` stored permanently. `name`/`address` stored as editorial content. All Google-sourced data (rating, reviews, photos, hours, phone, website) fetched live per request, never persisted. Per Google Places API ToS §3.2.3.
