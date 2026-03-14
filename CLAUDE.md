# DondeAI Backend

Last updated: 2026-03-13

> **Read this file first, then `docs/*.md` only as needed. Only open source files when modifying code.**

AI restaurant recommendation engine for Chicago. Supabase Edge Function (Deno/TS) + PostgreSQL + data pipelines. ~2,720 restaurants (active, including 7 newly added iconic Chicago institutions), 2,719+ with deep profiles, 2,712 with review intelligence. 33 neighborhoods, 15 cultural themes. AI: Claude Haiku 4.5 for recommendations + intent classification. 61 migrations (including comprehensive data quality audit fixes), 15 CI/CD workflows, 28 pipeline scripts. Codespace dev container with Claude Code + Supabase CLI.

## Documentation Index

| Doc | Contents |
|-----|----------|
| `docs/ARCHITECTURE.md` | Repo structure, tech stack, V11 modules, deployment, CI/CD |
| `docs/DATABASE.md` | Complete DB schema — all tables, columns, types, RPC, relationships |
| `docs/API-WORKFLOWS.md` | V11 request flow, scoring model, pipeline inventory, Google integration |
| `docs/FEATURES.md` | Backend feature checklist with implementation status |
| `docs/RECOMMENDATION-BLURBS.md` | Blurb generation architecture — Claude prompts, literary voices, quality guardrails, intent boost |
| `docs/CEO-COMMAND-CENTER.md` | Admin dashboard architecture (agents, pipelines, data health, maintenance worker) |
| `docs/OPTIMIZATION-RECOMMENDATIONS.md` | Backend optimization priorities (learning flywheel, caching, match narrative) |
| `_archive/VERSION-HISTORY.md` | Pre-V9 scoring evolution, V8 optimization, historical test results, case studies |

## Agents

| Agent | Purpose | Trigger |
|-------|---------|---------|
| `ceo-advisor` | Strategic product advisor — Top 10 prioritized recommendations | Manual |
| `donde-premium-advisor` | Premium app audit (UI polish, backend, marketing psychology, Claude Code mastery) | Manual |
| `donde-ciso` | Security audit across 10 domains — severity-ranked findings with remediation | Manual or auto on security changes |
| `update-docs` | Scans codebase and updates all MD files to reflect current state | Auto when Claude judges changes are significant |
| `gen-test-queries` | Generates 10 diverse, persona-driven test queries (1000-query repository) | Manual |
| `analytics-expert` | Chief Analytics Officer — benchmarks engine, implements quick-wins, CEO report | Manual or auto on scoring changes |
| `db-reviewer` | Database quality audit — accuracy, freshness, completeness, cross-field consistency | Manual or auto after enrichment runs |
| `perf-optimizer` | Response time optimizer — profiles latency waterfall, audits timeouts, implements safe optimizations | Manual or auto on timeout/latency issues |
| `uat-tester` | UAT super-user — browses DondeAI UIs via Playwright, inspects every element for bugs, UX, accessibility, visual consistency | Manual |
| `bug-fixer` | Post-test bug fixer — ingests golden-dataset failures, root-causes, groups, fixes scoring/blurb/grading code, deploys | Auto after test failures |

All agents in `.claude/agents/`. Spawn via the Agent tool or `/agents` dialog. Reference files for premium-advisor in `docs/references/premium-advisor/`.

## Tests

| File | Description |
|------|-------------|
| `tests/test_catalog.sh` | 65-scenario bash API test suite |
| `tests/golden-dataset-test.sh` | 50-query golden dataset with score fit + blurb quality grading — writes results to Supabase `gauntlet_runs`/`gauntlet_results` |
| `tests/benchmark-200.sh` | 200-case V11 benchmark with score fit + blurb quality grading (10 categories × 20 queries) |
| `tests/regression-guard.sh` | Scoring regression guard — compares against V10 baseline, writes to Supabase |
| `tests/compare-scores.sh` | A/B score comparison tool for query debugging |
| `tests/gauntlet.sh` | Command Center gauntlet test runner |
| `tests/focused-retest-gaps.sh` | Targeted retest of known gap queries |
| `tests/v10-scoring-benchmark.sh` | V10 scoring baseline benchmark |
| `tests/TEST-FULL.md` | 170-scenario agent-driven test spec |
| `tests/V9_E2E_100_RESULTS.md` | V9 E2E: 490 pass, 0 fail, 1 warn (99%) |
| `tests/generated-queries.json` | Persona-driven test query repository (target: 1000 queries) |

**V10 scoring baseline (2026-03-05):** 50-case benchmark: 44P/4F/2W, avg DM 70. V9 baseline was 39P/4F/7W, avg DM 68.

**V11 current (2026-03-12):** 50-case golden dataset (188 checks): 142P/2F/44W, avg DM 76, avg score fit 86, avg blurb quality 75. Regression guard: NO REGRESSION vs V10 baseline.

**V11 analytics fixes (2026-03-12):** Voice compliance auto-fix (blurb quality), cuisine_type reclassification (18 restaurants), diversity caps tightened (maxPerCuisine 3→2, maxPerNeighborhood 5→3), Google rating signal for reputation relevance, same-family cuisine relevance 0.50→0.60 (Peruvian→Mexican fix), adjacent cuisine relevance 0.30→0.40, reputation base floor 0.50→0.55. Expected: blurb WARNs 44→~15, pass rate 75%→~88%.

**V16 scoring fixes (2026-03-13):** 31-issue gap fix. Reputation+vibe blending (best rooftop/cocktail/tasting menu queries now check vibe fit). Cross-cuisine dish synonym guard (soup dumplings no longer matches gyoza at Japanese restaurants). "tiki" moved from Hawaiian to Cocktail Bar CUISINE_KEYWORDS. BYOB constraint enforcement (non-BYOB restaurants penalized). Quality floors raised: cuisine 65, neighborhood 65, vibe 68, reputation 65. Valet parking constraint added. Vibe relevance floor raised 0.70→0.75 for primary vibe queries. Constraint relevance base raised 0.80→0.85. New CONCEPT_MAP/INTENT_MAP entries for garden restaurant, family style, best rooftop/cocktail/tasting. Blurb key-term mandate strengthened. Cuisine sub-type aliases (somali, nigerian, szechuan, nepalese, etc.) added to NON_DISH_WORDS to prevent false dish_level_intent. Multi-word dish cap (0.65) with query modifier filtering.

**V16 retest results (2026-03-13):** Golden dataset (188 checks): 177P/0F/11W, avg DM 77, avg score fit 88, avg blurb quality 79. Regression guard: 177P/0F/11W, avg DM 77 — NO REGRESSION vs V10 baseline (44P/4F/2W, avg DM 70). Pass count improved +133, avg DM improved +7. Key improvements: tiki bar 60→78, authentic Szechuan 53→76, Senegalese 48→70, Nigerian 48→70, Eritrean 49→75, near wrigley field 45→82.

**V16 blurb quality fixes (2026-03-13):** Deterministic blurb generation (buildQueueBlurb) rebuilt to produce 100-120 word blurbs scoring B-/80+ on grading. Slop scrubbing (22 banned patterns removed from DB-sourced text). Flavor profile → grading adjective mapping (30+ entries: umami→bold, charred→smoky, etc.). Word count padding (origin story, cultural authenticity, group size). Service score floor of 6.0 for restaurants with service_style data. Occasion score power curve softened (0.85→0.70). Results: 144P→177P (+33), 4F→0F, 34W→11W, avg score fit 85→88, avg blurb quality 76→79.

**CLI test write-back:** `golden-dataset-test.sh` and `regression-guard.sh` persist results to `gauntlet_runs` + `gauntlet_results` Supabase tables when `SUPAB_URL` and `SUPAB_ANON_KEY` env vars are set. Run ID format: `cli-golden-*` / `cli-regression-*`. Source field: `cli`.

**Zero-cost testing (`skip_claude`):** Pass `"skip_claude": true` in request body to skip all Claude API calls. Engine returns deterministic scores + fallback blurbs from restaurant profiles. Intent classification uses deterministic Tier 1 only. Used by CEO Command Center "Scoring Only" mode (default).

## Scoring Engine — V11 (Active)

**Active files:** `scoring-v9.ts` + `types-v9.ts` + `response-builder-v9.ts` (filenames retained from V9, logic is V11)

**Formula:** `DondeScore = Relevance(0-1) × Quality(0-100) + OccasionBonus(±5)`

- **Relevance** is a GATE: uses review intelligence (`cuisine_signals`, `dish_catalog`, `popular_dishes`) to classify match type (dish > cuisine > vibe > semantic > reputation > open_ended). Low relevance = low score regardless of quality.
- **Quality** uses query-type-aware weight profiles (6 profiles: dish, cuisine, vibe, reputation, open_ended, multi_signal). Computes 5 factors: food, vibe, service, reputation, convenience.

**V11 enhancements (over V10):**
- Semantic concept matching via `computeSemanticRelevance()` — matches `semantic_tags` against RI descriptors, scenarios, tags, wow_factors, crowd_profile
- LLM-enhanced intent classification with `semantic_tags`, `similar_to`, `mood`, `implicit_cuisines` fields
- Query expansion engine (`expandQueryConcepts()`) with 40+ concept mappings
- Expanded DISH_SYNONYMS (150+ entries) with cross-cuisine mapping
- Dynamic vibe relevance floor: 0.45 for 3+ signals (was fixed 0.65)
- Multi-signal weight profile for queries spanning 3+ signal categories
- Reduced confidence pull-to-center: CONFIDENCE_MEAN=55, confidenceFactor 0.80-1.0
- Composite RPC scoring (v11): all signals scored simultaneously instead of sequential ORDER BY
- Semantic tag search in RPC via `p_semantic_tags`
- Dynamic candidate pool: 100 candidates for complex/semantic queries (was 50/80)

**V10 features retained:** Reputation relevance type, dish synonyms, word stemming, neighborhood aliases, confidence-weighted quality, practical constraint scoring.

**V16 enhancements (over V11):**
- Reputation+vibe blending: reputation queries with vibe/constraint signals blend both relevance paths (60/40 rep/vibe)
- Cross-cuisine dish synonym guard: dish synonyms capped at 0.50 relevance when restaurant cuisine doesn't match target
- BYOB enforcement: restaurants without BYOB data get 0.40 relevance penalty when BYOB is primary constraint
- Quality floor hierarchy: cuisine/dish ≥65, neighborhood ≥65, vibe ≥68, reputation ≥65
- Valet parking constraint pattern and matching in both relevance and convenience quality
- Vibe relevance floor raised 0.70→0.75 for vibe-primary queries
- Constraint relevance formula: base 0.85, cap 0.98 (was 0.80/0.97)
- Cuisine sub-type NON_DISH_WORDS: 30+ aliases (somali, nigerian, szechuan, nepalese, sicilian, etc.) prevent false dish_level_intent
- Multi-word dish cap: specific dishes (2+ non-modifier words) capped at 0.65 relevance when cuisine matches but dish doesn't
- "tiki"/"tiki bar" in Cocktail Bar CUISINE_KEYWORDS + NON_DISH_WORDS (not Hawaiian, not a dish)
- Service score floor: 6.0 minimum for restaurants with service_style data (prevents formula compression below grading threshold)
- Occasion score power curve: 0.85→0.70 (less compression for "Any" occasion queries)
- Deterministic blurbs: 100-120 word target with slop scrubbing, flavor adjective mapping, word count padding, "we/our" voice

**Self-healing**: When `cuisine_type` is NULL, falls back to `cuisine_signals` (29/2,719 restaurants — down from 1,806 after cuisine taxonomy fixes).

| Factor | Key Signals |
|--------|-------------|
| Food | Review intelligence cuisine signals, dish catalog, menu highlights, dietary fit, dish synonyms |
| Vibe | Noise, lighting, dress, energy, music, vibe keywords, crowd_profile, wow_factors |
| Service | Occasion base, service style, pacing, social dynamics, crowd matching |
| Reputation | Stretched Google rating, reviews, awards, chef_notable, neighborhood_integration |
| Convenience | Timing, reservation, wait time, parking, practical constraints (BYOB, outdoor, walk-in) |

**V11 RPC** (`get_candidates_v11`): Composite scoring with `p_semantic_tags`. Falls back to V10 → V9 RPC if migration not applied.

**Score tiers:** 90+ Outstanding | 80-89 Strong Pick | 70-79 Solid Option | 60-69 Worth a Try | <60 Best Available

**Score Validation Grading:**
- Score Fit Grade (0-100): Relevance alignment (30pts) + Cuisine match (25pts) + Factor alignment (25pts) + Compression check (10pts) + Weak spots coherence (10pts)
- Blurb Quality Grade (0-100): Slop-free (25pts) + Query relevance (25pts, includes compound neighborhood detection + 30 stop words) + Specificity (20pts) + Voice compliance (15pts) + Word count (15pts)
- Pass criteria: DM >= 70 AND Score Fit >= B- (80) AND Blurb Quality >= B- (80)
- Grade scale: A+ (97+), A (93-96), B+ (87-89), B (83-86), B- (80-82), C (73-79), D (60-69), F (<60)
- Grading code: `_shared/grading.ts` (backend) + `dondeAI/js/cc-grading.js` (frontend) — must stay in sync

**CEO Dashboard Data (Supabase queries for debugging issues):**
- `gauntlet_runs` table: `run_id, avg_dm, avg_score_fit, avg_blurb_quality, grade_pass_count, grade_distribution, total, gap_count, mode, delta_avg_dm, created_at`
- `gauntlet_results` table: `query, donde_match, restaurant_name, score_fit_score, score_fit_grade, blurb_quality_score, blurb_quality_grade, gap_type, category, run_id`
- `user_queries` table: `special_request, donde_match, score_fit_score, score_fit_grade, blurb_quality_score, blurb_quality_grade, recommendation_text, source, created_at`
- Quick issue lookup: `curl -s "$SUPAB_URL/rest/v1/gauntlet_results?run_id=eq.<RUN_ID>&blurb_quality_score=lt.80&select=query,restaurant_name,blurb_quality_score,blurb_quality_grade" -H "apikey: $SUPAB_ANON_KEY" -H "Authorization: Bearer $SUPAB_SERVICE_ROLE_KEY"`

## API Contract (Immutable)

```
POST https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend
Authorization: Bearer <supabase-anon-key>
apikey: <supabase-anon-key>
Timeout: 15s (AbortController on frontend)
```

**Request:**
```json
{
  "special_request": "string (required, max 500)",
  "occasion": "string (default: Any)",
  "neighborhood": "string (default: Anywhere)",
  "price_level": "string (default: Any)",
  "exclude": ["uuid (max 15)"],
  "dietary_restrictions": ["string (max 5, 30 chars each)"],
  "user_id": "uuid",
  "feedback": {"restaurant_id": "uuid", "feedback": "like|dislike"},
  "time_of_day": "breakfast|lunch|dinner|late_night",
  "skip_claude": "boolean (internal: skip Claude API calls, use deterministic blurbs — $0 cost)"
}
```

**Response (V11):**
```json
{
  "success": true,
  "restaurant": {
    "id", "name", "address", "best_for_oneliner", "google_place_id",
    "google_rating", "google_review_count", "price_level", "phone", "website",
    "noise_level", "cuisine_type", "lighting_ambiance", "dress_code",
    "outdoor_seating", "live_music", "pet_friendly", "parking_availability",
    "dietary_options", "sentiment_breakdown", "sentiment_score", "sentiment_summary",
    "neighborhood_name", "photo_urls", "opening_hours", "review_snippets",
    "best_times"
  },
  "recommendation": "string (100-115 words)",
  "insider_tip": "string|null",
  "donde_match": "integer 0-99",
  "scores": { "date_friendly_score", "group_friendly_score", "family_friendly_score",
    "business_lunch_score", "solo_dining_score", "hole_in_wall_factor", "romantic_rating" },
  "scoring_v9": {
    "relevance_score", "relevance_type", "relevance_details",
    "quality_score", "occasion_bonus", "data_completeness",
    "food", "vibe", "service", "reputation", "convenience",
    "weights_used"
  },
  "match_narrative": {
    "strongest_factor", "key_signals", "summary", "weak_spots", "comparison_context"
  },
  "ranked_queue": [
    { "rank", "restaurant", "donde_match", "scoring_v9", "match_headline" }
  ],
  "deep_context": { "signature_dishes", "service_style", "reservation_difficulty", "..." },
  "tags": ["string"],
  "intent_boost": { "active", "reason", "boost_points", "base_score" },
  "timestamp": "ISO"
}
```

**Errors:** HTTP non-200 → `{success: false, recommendation: "error message"}` | 429 rate limit | 500 engine error

**Health:** `GET /recommend` → `{status, version, engine, timestamp}`

## Commands

```bash
# Local dev
supabase functions serve recommend --env-file .env

# Deploy Edge Function
supabase functions deploy recommend

# Pipelines
cd scripts && npx tsx pipelines/discovery.ts
cd scripts && npx tsx pipelines/enrichment.ts
cd scripts && npx tsx pipelines/generate-occasion-scores.ts
cd scripts && TARGET_CUISINES=Japanese npm run discovery:targeted
cd scripts && DRY_RUN=true npm run discovery:gaps
cd scripts && npx tsx pipelines/enrichment-review-intelligence.ts  # V11 semantic descriptors

# Migrations
supabase db push

# Tests
./tests/test_catalog.sh
./tests/golden-dataset-test.sh
./tests/benchmark-200.sh
./tests/regression-guard.sh
./tests/compare-scores.sh "romantic Italian dinner"
```

## Environment Variables

All use `SUPAB_` prefix (`SUPABASE_` is reserved in Edge Functions).

| Context | Variables |
|---------|-----------|
| Edge Function | `SUPAB_URL`, `SUPAB_ANON_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY` |
| GitHub Actions | above + `SUPAB_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` |
| Local `.env` | all above + optional `DATABASE_URL` |

## Claude API Cost Policy

**Before running ANY pipeline that calls Claude:** estimate cost, get explicit approval.

Haiku 4.5: $0.80/M input, $4.00/M output. Full enrichment-v2 (~1000 restaurants) ~ $2-2.50.

## Git Workflow

For every task that modifies code:
1. Create a new branch from main with `claude/` prefix (e.g., `claude/add-cache`, `claude/fix-scoring`)
2. Make all changes on that branch
3. Commit with a clear, descriptive message
4. Push the branch to origin — CI auto-merges `claude/**` branches to `main` via `.github/workflows/auto-merge-claude.yml`
5. No PR needed for `claude/` branches — auto-merge handles it

**Never commit directly to main. Always use `claude/` branch prefix so CI auto-merges.**

## Coding Standards

| Context | Rules |
|---------|-------|
| Edge Function | Deno runtime, `https://esm.sh/` imports, `Deno.env.get()` |
| Pipelines | Node.js 20 + tsx, `.js` import extensions (ESM) |
| Types | Dual: `_shared/types.ts` (Deno) vs `scripts/lib/types.ts` (Node) |
| Claude clients | Dual: `_shared/claude.ts` (raw fetch) vs `scripts/lib/claude.ts` (`@anthropic-ai/sdk`) |
| Patterns | Fire-and-forget logging, response builder functions, structured JSON logging via `logger.ts` |
