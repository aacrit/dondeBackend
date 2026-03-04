# DondeAI Backend

Last updated: 2026-03-04

> **Read all `docs/*.md` files for context before making changes. Only open source files when modifying code.**

AI restaurant recommendation engine for Chicago. Supabase Edge Function (Deno/TS) + PostgreSQL + data pipelines.

## Documentation Index

| Doc | Contents |
|-----|----------|
| `docs/ARCHITECTURE.md` | Repo structure, tech stack, V9 modules, deployment, CI/CD |
| `docs/DATABASE.md` | Complete DB schema — all tables, columns, types, RPC, relationships |
| `docs/API-WORKFLOWS.md` | V9 request flow, scoring model, pipeline inventory, Google integration |
| `docs/FEATURES.md` | Backend feature checklist with implementation status |

## Tests

| File | Description |
|------|-------------|
| `tests/test_catalog.sh` | 65-scenario bash API test suite |
| `tests/golden-dataset-test.sh` | 50-query golden dataset (88 checks) — primary scoring benchmark |
| `tests/TEST-FULL.md` | 170-scenario agent-driven test spec |
| `tests/GOLDEN_DATASET_RESULTS.md` | Latest golden dataset results |
| `tests/TEST_RESULTS.md` | Latest catalog results: 273 pass, 3 fail, 30 warn (2026-02-24) |

**V9 scoring test baseline (2026-03-04):** 95/95 pass. V9 replaces V7.3b's geometric mean with Relevance × Quality architecture.

## Scoring Engine — V9 (active)

**Active engine:** `scoring-v9.ts` + `types-v9.ts` + `response-builder-v9.ts`

**Formula:** `DondeScore = Relevance(0-1) × Quality(0-100) + OccasionBonus(±5)`

- **Relevance** is a GATE: uses review intelligence (`cuisine_signals`, `dish_catalog`, `popular_dishes`) to classify match type (dish > cuisine > vibe > open_ended). Low relevance = low score regardless of quality.
- **Quality** uses query-type-aware weight profiles (no weight-shift rules). Computes 5 factors: food, vibe, service, reputation, convenience.
- **Self-healing**: When `cuisine_type` is NULL, V9 falls back to `cuisine_signals` from review intelligence (1806/2719 restaurants affected).

| Factor | Key Signals |
|--------|-------------|
| Food | Review intelligence cuisine signals, dish catalog, menu highlights, dietary fit |
| Vibe | Noise, lighting, dress, energy, music, vibe keywords |
| Service | Occasion base, service style, pacing, social dynamics |
| Reputation | Stretched Google rating (3.5→0, 5.0→10), reviews, awards |
| Convenience | Timing, reservation, wait time, parking |

**V9 RPC** (`get_candidates_v9`): Adds `p_query` for full-text search on reviews, `p_exclude` at SQL level. No `p_target_cuisine` (relevance handles this).

**Deprecated (archived to `_archive/pre-v9/`):** `scoring-v3.ts`, `scoring-v5.ts`, `scoring-v7.ts`, `scoring-v8.ts`, `types-v5.ts`, `types-v7.ts`, `types-v8.ts`, `weight-config-v5.ts`, `weight-config-v7.ts`, `response-builder-v5.ts`, `response-builder-v7.ts`, `filter-pipeline-v5.ts`.

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
  "time_of_day": "breakfast|lunch|dinner|late_night"
}
```

**Response (V9):**
```json
{
  "success": true,
  "restaurant": {
    "id", "name", "address", "best_for_oneliner", "google_place_id",
    "google_rating", "google_review_count", "price_level", "phone", "website",
    "noise_level", "cuisine_type", "lighting_ambiance", "dress_code",
    "outdoor_seating", "live_music", "pet_friendly", "parking_availability",
    "dietary_options", "sentiment_breakdown", "sentiment_score", "sentiment_summary",
    "neighborhood_name", "photo_urls", "opening_hours", "review_snippets"
  },
  "recommendation": "string (100-120 words)",
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

# Migrations
supabase db push

# Tests
./tests/test_catalog.sh
./tests/golden-dataset-test.sh
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

## Coding Standards

| Context | Rules |
|---------|-------|
| Edge Function | Deno runtime, `https://esm.sh/` imports, `Deno.env.get()` |
| Pipelines | Node.js 20 + tsx, `.js` import extensions (ESM) |
| Types | Dual: `_shared/types.ts` (Deno) vs `scripts/lib/types.ts` (Node) |
| Claude clients | Dual: `_shared/claude.ts` (raw fetch) vs `scripts/lib/claude.ts` (`@anthropic-ai/sdk`) |
| Patterns | Fire-and-forget logging, response builder functions, structured JSON logging via `logger.ts` |
