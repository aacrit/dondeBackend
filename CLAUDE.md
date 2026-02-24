# DondeAI Backend

AI-powered restaurant recommendation engine for Chicago. Returns ONE best restaurant match based on user's craving, occasion, neighborhood, and budget.

## Architecture

- **Recommendation API**: Supabase Edge Function (Deno/TypeScript) at `supabase/functions/recommend/`
- **Data Pipelines**: Node.js TypeScript scripts at `scripts/pipelines/`, run via GitHub Actions on cron
- **Database**: Supabase PostgreSQL. Migrations in `supabase/migrations/`
- **AI**: Claude Haiku 4.5 via Anthropic API (recommendation generation + data enrichment + live sentiment + intent classification)
- **Data Source**: Google Places API (restaurant discovery; live fetch at recommendation time for ratings/reviews/contact — never stored per ToS)

## Google API Compliance

Per Google Maps Platform ToS Section 3.2.3, only `place_id` can be stored indefinitely. Our compliance approach:
- **Stored in DB**: `google_place_id`, `name`/`address` (editorial identifiers), `price_level`, all Claude-generated enrichments (scores, tags, ambiance, deep profiles)
- **Fetched live**: Google rating, review count, phone, website, reviews, photos, opening hours — fetched at recommendation time for top 5 candidates only
- **Generated on-the-fly**: Review sentiment summary and score — Claude analyzes fresh Google reviews per request, never stored

## Deployment

**Edge Function auto-deploys via GitHub Actions** (`.github/workflows/deploy-edge-function.yml`):
- Triggers on push to `main` or `claude/**` branches when files in `supabase/functions/recommend/**` change
- Can also be triggered manually from GitHub Actions tab → "Deploy Edge Function" → "Run workflow"
- Requires `SUPABASE_ACCESS_TOKEN` secret in GitHub repo settings

**Migrations must be applied manually** — no auto-deploy workflow exists:
- Via CLI: `supabase db push`
- Via Supabase Dashboard: SQL Editor → paste migration SQL

## Key Commands

```bash
# Edge Function local dev
supabase functions serve recommend --env-file .env

# Deploy Edge Function (manual — usually auto-deployed via GitHub Actions on push)
supabase functions deploy recommend

# Run a pipeline locally
cd scripts && npx tsx pipelines/discovery.ts

# Run tests (bash test suite against live API)
chmod +x tests/test_catalog.sh && ./tests/test_catalog.sh

# Apply migrations
supabase db push
```

## Ranking Algorithm

Three-phase ranking before Claude makes the final pick:

1. **RPC phase** (`get_ranked_restaurants`): Server-side JOIN of `restaurants` + `occasion_scores` + `neighborhoods` + `restaurant_deep_profiles` + `restaurant_popularity`. Filters by neighborhood, price, and active/enriched status. Sorts by cuisine match (if intent detected), occasion score DESC, total score DESC, `random()` tiebreaker. Returns `15 + len(exclude)` results.

2. **Intent classification** (parallel with RPC): Claude pre-classifies the `special_request` into structured criteria — target cuisines, tags, features, flavor preferences, vibe keywords, emotional intent, date type, group size hint, and spontaneity. If high-importance cuisine detected but not in initial RPC results, a second cuisine-targeted RPC query fires.

3. **TypeScript re-ranking phase**: Filter out excluded IDs, apply dietary restriction filtering, slice to top 10, then:
   - **V2 path** (if deep profiles exist): `reRankV2()` uses multi-dimensional scoring — occasion fit, craving match, vibe alignment, practical fit, discovery value — with dynamic dimension weights per occasion and intent.
   - **V1 fallback**: `reRankWithBoosts()` re-sorts by 60% occasion score + 40% keyword boost (cuisine match +3, tag match +1.5, feature match +1.5 per hit).
   - Both paths incorporate rejection analysis (when `exclude` >= 2), user feedback signals (liked/disliked cuisines and restaurants), and time-of-day context.
   - `ensureDiversity()` ensures no more than 2 restaurants from the same cuisine type in the top results.

4. **Claude pick**: Claude receives top 10 profiles + user request + Google reviews and selects the best match with a personalized recommendation text and live sentiment analysis.

**Relaxation strategy**: If no results found, the system tries price relaxation (retry with "Any" price), then neighborhood relaxation (retry with "Anywhere" + "Any" price).

### Keyword Dictionaries

See `supabase/functions/recommend/_shared/scoring.ts` for full details:
- **28 cuisine categories**: Mexican, American, Italian, Japanese, Thai, Chinese, Korean, French, Seafood, Steak, Mediterranean, Vietnamese, Indian, Ethiopian, Peruvian, Brazilian, Brunch, Vegan, Cocktail Bar, Coffee/Cafe, Polish, Puerto Rican, Southern/Soul Food, Middle Eastern, Greek, Fusion, BBQ, Brewery/Beer Bar
- **19 tag categories**: byob, rooftop, outdoor patio, hidden gem, late night, craft cocktails, craft beer, live music, farm-to-table, scenic view, romantic, trendy, quiet, great value, brunch spot, waterfront, vegan friendly, gluten free, lively atmosphere
- **3 boolean features**: outdoor_seating, live_music, pet_friendly

### Occasion Score Mapping

| Occasion | Score Column(s) | Weight Blend |
|----------|----------------|-------------|
| Date Night | date_friendly_score | 100% |
| Group Hangout | group_friendly_score | 100% |
| Family Dinner | family_friendly_score | 100% |
| Business Lunch | business_lunch_score | 100% |
| Solo Dining | solo_dining_score | 100% |
| Special Occasion | romantic_rating + date_friendly | 70% / 30% |
| Treat Myself | solo_dining + romantic + hole_in_wall | 50% / 30% / 20% |
| Adventure | hole_in_wall + group_friendly + solo_dining | 60% / 20% / 20% |
| Chill Hangout | group_friendly + solo_dining + hole_in_wall | 60% / 30% / 10% |
| Any | Average of all 7 scores | Equal |

## API Contract (immutable — frontend already built)

### Request

POST `/recommend` with JSON body:

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `special_request` | string | `""` | Free-text craving input (max 500 chars, sanitized) |
| `occasion` | string | `"Any"` | Occasion type (see mapping above) |
| `neighborhood` | string | `"Anywhere"` | Chicago neighborhood filter (14 neighborhoods) |
| `price_level` | string | `"Any"` | Budget filter: $, $$, $$$, $$$$ |
| `exclude` | string[] | `[]` | Restaurant IDs to skip (for "Try Another"; max 15, UUID-validated) |
| `dietary_restrictions` | string[] | `[]` | Dietary filters (max 5 items, max 30 chars each) |
| `user_id` | string | `null` | User identifier for personalization (max 100 chars) |
| `feedback` | object | `null` | `{restaurant_id, feedback: "like"|"dislike"}` — stored for learning |
| `time_of_day` | string | `null` | Time context: `breakfast`, `lunch`, `dinner`, `late_night` |

### Response

Returns `{success, restaurant, recommendation, insider_tip, donde_match, scores, tags, deep_context, scoring_v2, timestamp}`

- `restaurant` object includes: id, name, address, google_place_id, google_rating, google_review_count, price_level, phone, website, noise_level, cuisine_type, lighting_ambiance, dress_code, outdoor_seating, live_music, pet_friendly, parking_availability, dietary_options, sentiment_breakdown, sentiment_score, sentiment_summary, sentiment_positive, sentiment_negative, sentiment_neutral, best_for_oneliner, neighborhood_name, photo_urls, opening_hours, review_snippets
- `deep_context` (V2, nullable): signature_dishes, service_style, reservation_difficulty, byob_policy, best_seat_in_house, unique_selling_point, wow_factors, origin_story, awards_recognition, and more
- `scoring_v2` (V2, nullable): occasion_fit, craving_match, vibe_alignment, practical_fit, discovery_value, weights_used
- `donde_match`: integer 60–99, deterministically computed match confidence

GET `/recommend` returns health check: `{status, version, timestamp}`

See `docs/api-field-mapping.md` for complete field mapping or `_archive/UI_UX_Requirements.md` for full UI/UX spec.

## V2 Deep Profile System

The enrichment-v2 pipeline generates 35 nuanced fields per restaurant stored in `restaurant_deep_profiles`:

- **Flavor & Culinary Identity**: flavor_profiles, signature_dishes, cuisine_subcategory, menu_depth, spice_level, dietary_depth
- **Service & Experience**: service_style, meal_pacing, reservation_difficulty, typical_wait_minutes, group_size_sweet_spot, check_average_per_person, tipping_culture, kid_friendliness
- **Atmosphere & Sensory**: music_vibe, decor_style, conversation_friendliness, energy_level, seating_options, instagram_worthiness, seasonal_relevance
- **Cultural & Narrative**: cultural_authenticity, origin_story, crowd_profile, neighborhood_integration, chef_notable, awards_recognition
- **Experiential**: wow_factors, date_progression, best_seat_in_house, ideal_weather, unique_selling_point
- **Practical**: transit_accessibility, byob_policy, payment_notes, enrichment_confidence

When deep profiles are available, the ranking uses `reRankV2()` and `computeDondeMatchV2()` for multi-dimensional scoring instead of the simpler keyword-boost approach.

## Edge Function Features

The recommendation Edge Function (`supabase/functions/recommend/index.ts`) includes:

- **API versioning**: `X-API-Version` response header (currently `2.1.0`)
- **In-memory response cache**: 5-minute TTL, max 100 entries, bypassed when `exclude` is non-empty
- **Rate limiting**: 30 requests per minute per IP (in-memory, per-isolate)
- **Input sanitization**: Control character stripping, whitespace collapsing, prompt injection pattern removal
- **Tiered Claude fallback**: JSON parse → regex recovery → template-based response → one-liner fallback
- **AI slop detection**: Warns on overused AI phrases in recommendation text (culinary, gastronomic, etc.)
- **Closed restaurant detection**: Checks `business_status` from Google and auto-substitutes next candidate
- **Query logging**: Fire-and-forget INSERT to `user_queries` with response time, unmatched keywords, user feedback
- **Parallel execution**: Intent classification + RPC + user feedback fetch run simultaneously; Google Place Details for top 5 fetched in parallel with 1.5s timeout

## Shared Modules (Edge Function)

All in `supabase/functions/recommend/_shared/`:

| File | Purpose |
|------|---------|
| `types.ts` | TypeScript interfaces for all data models (UserRequest, Restaurant, RestaurantProfile, DeepProfile, ScoringDimensions, etc.) |
| `scoring.ts` | Ranking logic, keyword boost, donde_match computation (V1 + V2), prompt building, occasion weights, diversity filter, rejection analysis |
| `intent-classifier.ts` | Claude-powered intent pre-classification (V2 with flavor, vibe, emotional intent, spontaneity detection) |
| `response-builder.ts` | 5 response builders: success, fallback, template (V2 with deep profile), no-results, error |
| `claude.ts` | Anthropic API client with prompt caching (`cache_control: ephemeral`), 1-retry on 5xx/timeout |
| `google-places.ts` | Live Google Place Details fetch (rating, reviews, photos, hours, business status) |
| `supabase.ts` | Supabase client initialization (uses `SUPAB_URL` + `SUPAB_ANON_KEY`) |
| `cors.ts` | CORS headers + JSON response helper |
| `logger.ts` | Structured JSON logger (info/warn/error with timestamps and context) |

## Project Structure

```
dondeBackend/
├── supabase/
│   ├── functions/recommend/           — Edge Function (live API)
│   │   ├── index.ts                   — Main handler (rate limit, cache, routing, Claude call)
│   │   └── _shared/                   — Shared modules (see table above)
│   ├── migrations/                    — 18 SQL migrations (schema, RPC, indexes)
│   └── config.toml                    — Supabase local config
├── scripts/
│   ├── lib/                           — Shared pipeline utilities
│   │   ├── config.ts                  — Neighborhoods (14), cuisines (28), coords, ZIP mapping
│   │   ├── claude.ts                  — Node.js Anthropic SDK client (Haiku 4.5)
│   │   ├── google-places.ts           — Google Places API (text search + place details)
│   │   ├── supabase.ts                — Admin Supabase client (service role key)
│   │   ├── batch.ts                   — Generic batch processor with delays
│   │   └── types.ts                   — Pipeline TypeScript interfaces
│   ├── pipelines/                     — Data pipeline scripts
│   │   ├── discovery.ts               — Google Places restaurant discovery
│   │   ├── enrichment.ts              — Claude enrichment (ambiance, dietary, insider tip)
│   │   ├── enrichment-v2.ts           — V2 deep profile enrichment (35 fields, uses Sonnet + reviews)
│   │   ├── generate-occasion-scores.ts — Claude occasion scoring (7 dimensions)
│   │   ├── generate-tags.ts           — Claude tag generation (3-6 per restaurant)
│   │   ├── regenerate-occasion-scores.ts — Full regeneration of all occasion scores
│   │   ├── regenerate-tags.ts         — Full regeneration of all tags
│   │   ├── analytics.ts              — Compute trending/popularity from user_queries
│   │   ├── validate-status.ts        — Google Places business status validation
│   │   ├── re-enrichment.ts          — Re-enrich existing restaurants
│   │   ├── backfill-new-fields.ts    — One-time backfill for new columns
│   │   ├── populate-all.ts           — Orchestrator: runs all pipelines sequentially
│   │   └── intent-gap-analysis.ts    — Analyze unmatched keywords from user_queries
│   ├── test-scoring-optimizations.ts  — Scoring optimization tests
│   ├── package.json                   — Dependencies (@anthropic-ai/sdk, @supabase/supabase-js)
│   └── tsconfig.json                  — TypeScript config (ES2022, ESNext modules)
├── .github/workflows/                 — GitHub Actions (8 workflows)
│   ├── deploy-edge-function.yml       — Edge Function deploy (push to main/claude/** + manual)
│   ├── discovery.yml                  — Monthly discovery (1st, 3am UTC; + manual)
│   ├── enrichment.yml                 — Monthly enrichment (1st, 5am; auto after discovery)
│   ├── enrichment-v2.yml             — Monthly deep profiles (1st, 6am; auto after enrichment)
│   ├── scores-and-tags.yml           — Monthly scores + tags (1st, 7am; auto after enrichment)
│   ├── regenerate-scores-tags.yml    — Manual: full regeneration (configurable batch_limit, dry_run)
│   ├── analytics.yml                 — Daily analytics (2am UTC; + manual)
│   └── validate-status.yml           — Monthly restaurant status check (1st, 4am; + manual)
├── tests/
│   ├── test_catalog.sh               — Full API test suite (65 tests, ~215 checks, 5 phases)
│   └── TEST_RESULTS.md               — Auto-generated test results report
├── docs/
│   ├── api-field-mapping.md          — Complete request/response field mapping
│   └── system-architecture.md        — Mermaid diagrams of system flow
├── _archive/                          — Reference: original n8n workflows + UI/UX spec
├── .env.example                       — Environment variable template
├── .gitignore
└── CLAUDE.md                          — This file
```

## Data Pipeline Schedule

Pipelines run monthly on the 1st (reduced from weekly to save API credits), with chained triggers:

| Time (UTC) | Workflow | Pipeline | Trigger |
|------------|----------|----------|---------|
| 2:00 AM | analytics.yml | `analytics.ts` | Daily cron |
| 3:00 AM | discovery.yml | `discovery.ts` | Monthly cron (1st) |
| 4:00 AM | validate-status.yml | `validate-status.ts` | Monthly cron (1st) |
| 5:00 AM | enrichment.yml | `enrichment.ts` | Monthly cron (1st) + auto after Discovery |
| 6:00 AM | enrichment-v2.yml | `enrichment-v2.ts` | Monthly cron (1st) + auto after Enrichment |
| 7:00 AM | scores-and-tags.yml | `scores-and-tags.ts` | Monthly cron (1st) + auto after Enrichment |
| Manual | regenerate-scores-tags.yml | `regenerate-*.ts` | Manual only (configurable batch_limit, dry_run) |

All workflows can also be triggered manually via GitHub Actions → "Run workflow".

## Database Schema

### Core Tables

- **`restaurants`**: ~1000 Chicago restaurants with editorial fields, enrichment data, `google_place_id` (only permanently stored Google field)
- **`occasion_scores`**: 7 dimension scores (0-10) per restaurant, one row per restaurant (unique constraint)
- **`tags`**: 3-6 tags per restaurant (tag_text + tag_category)
- **`neighborhoods`**: 14 Chicago neighborhoods with descriptions
- **`user_queries`**: Query logs with occasion, price, special_request, recommended restaurant, donde_match, response time, feedback, unmatched keywords

### V2 Tables

- **`restaurant_deep_profiles`**: 35 nuanced enrichment fields per restaurant (see V2 Deep Profile System section)
- **`restaurant_popularity`**: Trending scores computed from `user_queries` by analytics pipeline
- **`unmatched_keywords`**: Tracks keywords from special_requests that don't match any dictionary (for continuous improvement)

### Key RPC

- **`get_ranked_restaurants(p_neighborhood, p_price_level, p_occasion, p_limit, p_target_cuisine)`**: Single-query ranking that JOINs restaurants + scores + neighborhoods + deep_profiles + popularity. Supports cuisine-targeted queries and "Any"/"Anywhere" defaults.

## Environment Variables

All use `SUPAB_` prefix (SUPABASE_ is reserved in Edge Functions).

**Supabase Edge Function secrets** (set via `supabase secrets set` or Dashboard):
- `SUPAB_URL`, `SUPAB_ANON_KEY`
- `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`

**GitHub Actions secrets** (set in repo Settings → Secrets):
- `SUPAB_URL`, `SUPAB_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`
- `SUPABASE_ACCESS_TOKEN` (for Edge Function deployment)

**Local development** (`.env` file, see `.env.example`):
- All of the above, plus optional `DATABASE_URL` for direct psql access

## Testing

The test suite (`tests/test_catalog.sh`) runs 65 scenarios across 5 phases against the live API:

1. **Contract Validation** (T01–T08): Response shape, field types, enum values, boolean fields
2. **Parameter Coverage** (T09–T18): All 9 occasions, default handling, neighborhood filtering
3. **Ranking Intelligence** (T19–T30): Cuisine keyword matching, intent expansion, dietary keywords, tag/feature matching
4. **Advanced Features** (T31–T40): Cache hit/bypass, Try Another (exclude), rejection patterns, Google live data, diversity
5. **Edge Cases & Negative Tests** (T41–T65): Invalid inputs, injection attempts, rapid calls, ambiance intent, neighborhood relaxation, new cuisine coverage

Results are written to `tests/TEST_RESULTS.md` with pass/fail/warn counts and per-check details.

## Claude API Cost Requirement

**IMPORTANT: Before running ANY pipeline or script that calls Claude for DB updates**, the session assistant MUST:
1. **Estimate and disclose the total cost** (input + output tokens, USD)
2. **Get your explicit approval** before proceeding
3. **Monitor for API usage limits** and alert you if approaching monthly cap

**Current pricing** (Claude Haiku 4.5):
- Input: $0.80 / million tokens
- Output: $4.00 / million tokens

**Examples:**
- **enrichment-v2** (full backfill ~1000 restaurants): ~$2.00-2.50 (2 passes per restaurant × live reviews)
- **enrichment-v2** (weekly new restaurants ~5-10): ~$0.01-0.02
- **scores pipeline** (all restaurants): ~$0.50-1.00
- **analytics pipeline**: $0 (no Claude calls — pure SQL aggregation)
- **validate-status pipeline**: $0 (Google Places API only, no Claude)
- **intent classification** (per API request): ~$0.0001 (~150 input + ~100 output tokens)

This requirement prevents unexpected usage charges and keeps you informed of operational costs.

## Development Conventions

- **Edge Function runtime**: Deno (imports use URLs like `https://esm.sh/` and `Deno.env.get()`)
- **Pipeline runtime**: Node.js 20 with `tsx` for TypeScript execution (imports use `.js` extensions per ESM)
- **Two separate type systems**: `supabase/functions/recommend/_shared/types.ts` (Deno) and `scripts/lib/types.ts` (Node.js) — they overlap but are not identical
- **Two separate Claude clients**: `_shared/claude.ts` (Deno, raw fetch to Anthropic API) and `scripts/lib/claude.ts` (Node.js, uses `@anthropic-ai/sdk`)
- **Fire-and-forget pattern**: Query logging and feedback storage use `.then().catch()` to avoid blocking responses
- **JSON response builder pattern**: All API responses go through `response-builder.ts` functions to ensure consistent shape
- **Structured logging**: Edge Function uses `logger.ts` for machine-parseable JSON log lines
