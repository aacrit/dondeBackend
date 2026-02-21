# DondeAI Backend

AI-powered restaurant recommendation engine for Chicago. Returns ONE best restaurant match based on user's craving, occasion, neighborhood, and budget.

## Architecture

- **Recommendation API**: Supabase Edge Function (Deno/TypeScript) at `supabase/functions/recommend/`
- **Data Pipelines**: Node.js TypeScript scripts at `scripts/pipelines/`, run via GitHub Actions on cron
- **Database**: Supabase PostgreSQL. Migrations in `supabase/migrations/`
- **AI**: Claude Haiku via Anthropic API (recommendation generation + data enrichment + live sentiment)
- **Data Source**: Google Places API (restaurant discovery; live fetch at recommendation time for ratings/reviews/contact — never stored per ToS)

## Google API Compliance

Per Google Maps Platform ToS Section 3.2.3, only `place_id` can be stored indefinitely. Our compliance approach:
- **Stored in DB**: `google_place_id`, `name`/`address` (editorial identifiers), `price_level`, all Claude-generated enrichments (scores, tags, ambiance)
- **Fetched live**: Google rating, review count, phone, website, reviews — fetched at recommendation time for the chosen restaurant only
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

# Apply migrations
supabase db push
```

## Ranking Algorithm

Two-phase ranking before Claude makes the final pick:
1. **RPC phase** (`get_ranked_restaurants`): Server-side JOIN + filter + sort by occasion score DESC, total score DESC, `random()` tiebreaker. Returns `10 + len(exclude)` results.
2. **TypeScript phase**: Filter out excluded IDs, slice to top 10, then `reRankWithBoosts()` re-sorts by 60% occasion score + 40% keyword boost (cuisine match +3, tag match +1.5, feature match +1.5 per hit).

Keyword dictionaries: 14 cuisine categories, 17 tag categories, 3 boolean features (outdoor_seating, live_music, pet_friendly). See `scoring.ts` for full details.

## API Contract (immutable — frontend already built)

POST `/recommend` with `{special_request, occasion, neighborhood, price_level, exclude?}`
- `exclude` is an optional array of restaurant IDs to skip (used by "Try Another" on frontend)
Returns `{success, restaurant, recommendation, insider_tip, donde_match, scores, tags, timestamp}`

See `docs/api-field-mapping.md` for complete field mapping or `_archive/UI_UX_Requirements.md` for full UI/UX spec.

## Project Structure

- `supabase/functions/recommend/` — Edge Function (live API)
- `supabase/migrations/` — SQL schema migrations
- `scripts/lib/` — Shared utilities (Claude client, Supabase client, Google Places, config)
- `scripts/pipelines/` — Data pipeline scripts (discovery, enrichment, scores, tags)
- `.github/workflows/` — Scheduled GitHub Actions for each pipeline
- `_archive/` — Original n8n workflow exports (reference only)

## Environment Variables

All use `SUPAB_` prefix (SUPABASE_ is reserved in Edge Functions).

**Supabase Edge Function secrets** (set via `supabase secrets set` or Dashboard):
- `SUPAB_URL`, `SUPAB_ANON_KEY`
- `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`

**GitHub Actions secrets** (set in repo Settings → Secrets):
- `SUPAB_URL`, `SUPAB_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`

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

This requirement prevents unexpected usage charges and keeps you informed of operational costs.
