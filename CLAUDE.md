# DondeAI Backend

AI-powered restaurant recommendation engine for Chicago. Returns ONE best restaurant match based on user's craving, occasion, neighborhood, and budget.

## Architecture

- **Recommendation API**: Supabase Edge Function (Deno/TypeScript) at `supabase/functions/recommend/`
- **Data Pipelines**: Node.js TypeScript scripts at `scripts/pipelines/`, run via GitHub Actions on cron
- **Database**: Supabase PostgreSQL. Migrations in `supabase/migrations/`
- **AI**: Claude Haiku via Anthropic API (recommendation generation + data enrichment)
- **Data Source**: Google Places API (restaurant discovery + reviews)

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
Returns `{success, restaurant, recommendation, insider_tip, donde_score, scores, tags, timestamp}`

See `_archive/UI_UX_Requirements.md` for full response schema.

## Project Structure

- `supabase/functions/recommend/` — Edge Function (live API)
- `supabase/migrations/` — SQL schema migrations
- `scripts/lib/` — Shared utilities (Claude client, Supabase client, Google Places, config)
- `scripts/pipelines/` — Data pipeline scripts (discovery, enrichment, reviews, sentiment, scores, tags)
- `.github/workflows/` — Scheduled GitHub Actions for each pipeline
- `_archive/` — Original n8n workflow exports (reference only)

## Environment Variables

Set in Supabase vault (Edge Function) and GitHub Secrets (pipelines):
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_PLACES_API_KEY`
