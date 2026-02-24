# DondeAI Backend

Chicago restaurant recommendation engine. Returns ONE best match per request based on craving, occasion, neighborhood, budget.

## Architecture

- **API**: Supabase Edge Function (Deno/TS) — `supabase/functions/recommend/`
- **Pipelines**: Node.js TS scripts — `scripts/pipelines/`, GitHub Actions cron
- **DB**: Supabase PostgreSQL — `supabase/migrations/`
- **AI**: Claude Haiku 4.5 (recommendations, enrichment, sentiment, intent classification)
- **Data**: Google Places API (discovery + live fetch at request time; never stored per ToS §3.2.3)

## Google API Compliance

Only `google_place_id` stored permanently. `name`/`address` stored as editorial. All Google-sourced data (rating, reviews, phone, website, photos, hours) fetched live for top 5 candidates per request, never persisted. Sentiment generated on-the-fly by Claude from fresh reviews.

## Commands

```bash
supabase functions serve recommend --env-file .env  # Local dev
supabase functions deploy recommend                  # Manual deploy
cd scripts && npx tsx pipelines/discovery.ts         # Run pipeline
supabase db push                                     # Apply migrations
./tests/test_catalog.sh                              # Run test suite (65 tests)
```

## Deployment

- **Edge Function**: Auto-deploys via GitHub Actions on push to `main`/`claude/**` when `supabase/functions/recommend/**` changes. Manual trigger available. Requires `SUPABASE_ACCESS_TOKEN` secret.
- **Migrations**: Manual only (`supabase db push` or paste in Dashboard SQL Editor).

## Ranking Algorithm

1. **RPC** (`get_ranked_restaurants`): Server-side JOIN of restaurants + occasion_scores + neighborhoods + deep_profiles + popularity. Filters by neighborhood/price/active. Sorts: cuisine match → occasion score → total score → `random()`. Returns `15 + len(exclude)`.
2. **Intent classification** (parallel with RPC): Claude classifies `special_request` → cuisines, tags, features, flavors, vibe, emotional intent, date type, group size, spontaneity. Re-queries with cuisine filter if high-importance cuisine missing from results.
3. **Re-ranking** (TypeScript): Exclude filtered IDs → dietary filtering → slice top 10 → re-rank:
   - **V2** (deep profiles present): `reRankV2()` — multi-dimensional: occasion fit, craving match, vibe alignment, practical fit, discovery value
   - **V1** fallback: `reRankWithBoosts()` — 60% occasion + 40% keyword boost (+3 cuisine, +1.5 tag, +1.5 feature)
   - Both use rejection analysis (exclude≥2), user feedback signals, time-of-day context
   - `ensureDiversity()`: max 2 same-cuisine in results
4. **Claude pick**: Top 10 profiles + request + Google reviews → personalized recommendation + sentiment

**Relaxation**: No results → retry "Any" price → retry "Anywhere" + "Any" price.

## Keyword Dictionaries (`_shared/scoring.ts`)

- **28 cuisines**: Mexican, American, Italian, Japanese, Thai, Chinese, Korean, French, Seafood, Steak, Mediterranean, Vietnamese, Indian, Ethiopian, Peruvian, Brazilian, Brunch, Vegan, Cocktail Bar, Coffee/Cafe, Polish, Puerto Rican, Southern/Soul Food, Middle Eastern, Greek, Fusion, BBQ, Brewery/Beer Bar
- **19 tags**: byob, rooftop, outdoor patio, hidden gem, late night, craft cocktails, craft beer, live music, farm-to-table, scenic view, romantic, trendy, quiet, great value, brunch spot, waterfront, vegan friendly, gluten free, lively atmosphere
- **3 features**: outdoor_seating, live_music, pet_friendly

## Occasion Weights (`_shared/scoring.ts`)

| Occasion | Weights |
|----------|---------|
| Date Night | date_friendly 100% |
| Group Hangout | group_friendly 100% |
| Family Dinner | family_friendly 100% |
| Business Lunch | business_lunch 100% |
| Solo Dining | solo_dining 100% |
| Special Occasion | romantic 70% + date_friendly 30% |
| Treat Myself | solo 50% + romantic 30% + hole_in_wall 20% |
| Adventure | hole_in_wall 60% + group 20% + solo 20% |
| Chill Hangout | group 60% + solo 30% + hole_in_wall 10% |
| Any | average of all 7 |

## API Contract (immutable)

**POST `/recommend`**

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `special_request` | string | `""` | Max 500 chars, sanitized |
| `occasion` | string | `"Any"` | See occasion table |
| `neighborhood` | string | `"Anywhere"` | 14 Chicago neighborhoods |
| `price_level` | string | `"Any"` | $, $$, $$$, $$$$ |
| `exclude` | string[] | `[]` | UUIDs to skip; max 15 |
| `dietary_restrictions` | string[] | `[]` | Max 5, 30 chars each |
| `user_id` | string | null | For personalization |
| `feedback` | object | null | `{restaurant_id, feedback: "like"\|"dislike"}` |
| `time_of_day` | string | null | breakfast, lunch, dinner, late_night |

**Response**: `{success, restaurant, recommendation, insider_tip, donde_match (60-99), scores, tags, deep_context, scoring_v2, timestamp}`

- `restaurant`: id, name, address, google_place_id, google_rating, google_review_count, price_level, phone, website, noise_level, cuisine_type, lighting_ambiance, dress_code, outdoor_seating, live_music, pet_friendly, parking_availability, dietary_options, sentiment_{breakdown,score,summary,positive,negative,neutral}, best_for_oneliner, neighborhood_name, photo_urls, opening_hours, review_snippets
- `deep_context` (V2, nullable): signature_dishes, service_style, reservation_difficulty, byob_policy, best_seat_in_house, unique_selling_point, wow_factors, origin_story, awards_recognition, +more
- `scoring_v2` (V2, nullable): occasion_fit, craving_match, vibe_alignment, practical_fit, discovery_value, weights_used

**GET `/recommend`**: Health check → `{status, version, timestamp}`

Full field mapping: `docs/api-field-mapping.md` | UI/UX spec: `_archive/UI_UX_Requirements.md`

## V2 Deep Profiles (`restaurant_deep_profiles`, 35 fields)

- **Culinary**: flavor_profiles, signature_dishes, cuisine_subcategory, menu_depth, spice_level, dietary_depth
- **Service**: service_style, meal_pacing, reservation_difficulty, typical_wait_minutes, group_size_sweet_spot, check_average_per_person, tipping_culture, kid_friendliness
- **Atmosphere**: music_vibe, decor_style, conversation_friendliness, energy_level, seating_options, instagram_worthiness, seasonal_relevance
- **Cultural**: cultural_authenticity, origin_story, crowd_profile, neighborhood_integration, chef_notable, awards_recognition
- **Experiential**: wow_factors, date_progression, best_seat_in_house, ideal_weather, unique_selling_point
- **Practical**: transit_accessibility, byob_policy, payment_notes, enrichment_confidence

When present, ranking uses `reRankV2()` + `computeDondeMatchV2()` for multi-dimensional scoring.

## Edge Function Features

API version `2.1.0` | Cache: 5-min TTL, 100 entries (bypassed with exclude) | Rate limit: 30/min/IP | Input sanitization (control chars, prompt injection) | Tiered fallback: JSON parse → regex recovery → template response → one-liner | Slop detection (warns on AI clichés) | Closed restaurant auto-substitution | Fire-and-forget query logging (response time, unmatched keywords, feedback) | Parallel: intent + RPC + feedback fetch; Google top-5 with 1.5s timeout

## Edge Function Shared Modules (`_shared/`)

| File | Purpose |
|------|---------|
| `types.ts` | All interfaces: UserRequest, Restaurant, RestaurantProfile, DeepProfile, ScoringDimensions, ClaudeRecommendation |
| `scoring.ts` | Ranking, keyword boost, donde_match (V1+V2), prompts, occasion weights, diversity, rejection analysis |
| `intent-classifier.ts` | Claude intent pre-classification V2 (flavor, vibe, emotion, spontaneity) |
| `response-builder.ts` | 5 builders: success, fallback, template (V2), no-results, error |
| `claude.ts` | Anthropic API with prompt caching + 1 retry on 5xx |
| `google-places.ts` | Live Place Details (rating, reviews, photos, hours, business status) |
| `supabase.ts` | Client init (`SUPAB_URL` + `SUPAB_ANON_KEY`) |
| `cors.ts` | CORS headers + JSON response helper |
| `logger.ts` | Structured JSON logger (info/warn/error) |

## Project Structure

```
supabase/functions/recommend/        — Edge Function: index.ts + _shared/ (9 modules)
supabase/migrations/                 — 18 SQL migrations
scripts/lib/                         — config.ts, claude.ts, google-places.ts, supabase.ts, batch.ts, types.ts
scripts/pipelines/
  discovery.ts                       — Google Places restaurant discovery
  enrichment.ts                      — Claude enrichment (ambiance, dietary, insider tip)
  enrichment-v2.ts                   — Deep profile enrichment (35 fields, Sonnet + reviews)
  generate-occasion-scores.ts        — Claude occasion scoring (7 dimensions)
  generate-tags.ts                   — Claude tag generation (3-6 per restaurant)
  regenerate-occasion-scores.ts      — Full score regeneration
  regenerate-tags.ts                 — Full tag regeneration
  analytics.ts                       — Trending/popularity from user_queries
  validate-status.ts                 — Google business status checks
  re-enrichment.ts                   — Re-enrich existing restaurants
  backfill-new-fields.ts             — One-time column backfill
  populate-all.ts                    — Run all pipelines sequentially
  intent-gap-analysis.ts             — Analyze unmatched keywords
scripts/test-scoring-optimizations.ts
.github/workflows/                   — 8 workflows (see schedule below)
tests/test_catalog.sh                — 65-test API suite (5 phases, ~215 checks)
tests/TEST_RESULTS.md                — Auto-generated results
docs/api-field-mapping.md            — Full field mapping
docs/system-architecture.md          — Mermaid architecture diagrams
_archive/                            — Legacy n8n workflows + UI/UX spec
```

## Pipeline Schedule

Monthly on 1st (reduced from weekly to save API credits), chained triggers:

| UTC | Workflow | Trigger |
|-----|----------|---------|
| 2:00 | analytics.yml → `analytics.ts` | Daily |
| 3:00 | discovery.yml → `discovery.ts` | Monthly |
| 4:00 | validate-status.yml → `validate-status.ts` | Monthly |
| 5:00 | enrichment.yml → `enrichment.ts` | Monthly + after Discovery |
| 6:00 | enrichment-v2.yml → `enrichment-v2.ts` | Monthly + after Enrichment |
| 7:00 | scores-and-tags.yml → scores + tags | Monthly + after Enrichment |
| — | regenerate-scores-tags.yml | Manual (batch_limit, dry_run) |

## Database

**Core**: `restaurants` (~1000), `occasion_scores` (7 dims, 0-10, unique per restaurant), `tags` (3-6 per restaurant), `neighborhoods` (14), `user_queries` (logs with feedback, response time, unmatched keywords)

**V2**: `restaurant_deep_profiles` (35 fields), `restaurant_popularity` (trending scores), `unmatched_keywords` (continuous learning)

**RPC**: `get_ranked_restaurants(p_neighborhood, p_price_level, p_occasion, p_limit, p_target_cuisine)` — single-query JOIN of all tables, supports cuisine targeting + "Any"/"Anywhere" defaults.

## Environment Variables

All use `SUPAB_` prefix (`SUPABASE_` is reserved in Edge Functions).

- **Edge Function secrets**: `SUPAB_URL`, `SUPAB_ANON_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`
- **GitHub Actions secrets**: `SUPAB_URL`, `SUPAB_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`, `SUPABASE_ACCESS_TOKEN`
- **Local** (`.env`): All above + optional `DATABASE_URL` for psql

## Testing

`tests/test_catalog.sh` — 65 scenarios, 5 phases:
1. **Contract** (T01–T08): Response shape, types, enums, booleans
2. **Parameters** (T09–T18): All 9 occasions, defaults, neighborhoods
3. **Ranking** (T19–T30): Cuisine matching, intent expansion, dietary, tags/features
4. **Advanced** (T31–T40): Cache, Try Another, rejections, Google data, diversity
5. **Edge Cases** (T41–T65): Invalid inputs, injection, rapid calls, relaxation, new cuisines

Results → `tests/TEST_RESULTS.md`

## Claude API Cost Requirement

**IMPORTANT: Before running ANY pipeline that calls Claude**, the assistant MUST:
1. **Estimate and disclose cost** (input + output tokens, USD)
2. **Get explicit approval** before proceeding
3. **Monitor for usage limits**

**Haiku 4.5 pricing**: $0.80/M input, $4.00/M output

| Pipeline | Estimated Cost |
|----------|---------------|
| enrichment-v2 (full ~1000) | ~$2.00-2.50 |
| enrichment-v2 (new ~5-10) | ~$0.01-0.02 |
| scores (all) | ~$0.50-1.00 |
| analytics / validate-status | $0 (no Claude) |
| intent classification (per request) | ~$0.0001 |

## Development Conventions

- **Edge Function**: Deno runtime (`https://esm.sh/` imports, `Deno.env.get()`)
- **Pipelines**: Node.js 20 + tsx (`.js` import extensions per ESM)
- **Dual type systems**: `_shared/types.ts` (Deno) vs `scripts/lib/types.ts` (Node) — overlapping but not identical
- **Dual Claude clients**: `_shared/claude.ts` (raw fetch) vs `scripts/lib/claude.ts` (`@anthropic-ai/sdk`)
- **Patterns**: Fire-and-forget logging (`.then().catch()`), response builder functions for consistent shape, structured JSON logging via `logger.ts`
