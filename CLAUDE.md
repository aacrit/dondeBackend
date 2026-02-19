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

## Key Commands

```bash
# Edge Function local dev
supabase functions serve recommend --env-file .env

# Deploy Edge Function
supabase functions deploy recommend

# Run a pipeline locally
cd scripts && npx tsx pipelines/discovery.ts

# Apply migrations
supabase db push
```

## API Contract (immutable — frontend already built)

POST `/recommend` with `{special_request, occasion, neighborhood, price_level}`
Returns `{success, restaurant, recommendation, insider_tip, donde_match, scores, tags, timestamp}`

See `_archive/UI_UX_Requirements.md` for full response schema.

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
