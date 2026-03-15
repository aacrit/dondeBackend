# CEO Command Center

> DondeAI's operational cockpit — real-time quality monitoring, agent-driven testing, and data-pipeline orchestration in a single dark-mode dashboard.

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│  command-center.html  (CEO Frontend — admin-gated)      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ Pulse    │  │ Agent    │  │ Analytics│  │ Data   │  │
│  │ Cards    │  │ Runner   │  │ & Gaps   │  │ Health │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       │              │             │             │       │
│  cc-ui.js    cc-agents.js  cc-analytics.js  cc-config.js│
└───────┼──────────────┼─────────────┼─────────────┼──────┘
        │    Supabase   │   REST/RPC  │   Insert    │
        ▼              ▼             ▼             ▼
┌─────────────────────────────────────────────────────────┐
│  Supabase (PostgreSQL + Edge Functions + Auth)          │
│  ┌──────────────┐ ┌───────────────┐ ┌────────────────┐ │
│  │ recommend    │ │ gauntlet_runs │ │ maintenance_   │ │
│  │ (Edge Fn)    │ │ & _results    │ │ requests       │ │
│  └──────┬───────┘ └───────────────┘ └───────┬────────┘ │
└─────────┼───────────────────────────────────┼──────────┘
          │                                   │ poll (5 min)
          ▼                                   ▼
┌─────────────────────┐    ┌──────────────────────────────┐
│  Scoring Engine V11 │    │ maintenance-worker (GH Action)│
│  Intent → Filter →  │    │ discovery | enrichment |      │
│  Score → Rank       │    │ scores_tags | audit           │
└─────────────────────┘    └──────────────────────────────┘
```

---

## Frontend

### Entry Point

**`command-center.html`** — Standalone dark-mode dashboard, admin-gated to `aacrit@gmail.com` via Supabase Google SSO.

### Module Map

| Module | Role |
|--------|------|
| **cc-config.js** | Constants, agent definitions, edge probes, golden queries, pipeline defs, global state, helpers (`ragClass`, `ragColor`, `determineGapType`) |
| **cc-agents.js** | Agent orchestration — calls `/recommend`, manages budgets, XP/level system, category/difficulty filtering |
| **cc-analytics.js** | Auth check, loads gauntlet data from Supabase or local JSON, renders quality metrics & gap analysis |
| **cc-ui.js** | Pulse cards, production strip, clock/uptime, system status dot, animated count-ups, section toggling |
| **cc-queries.js** | 1,042 Chicago test queries across 5 categories (Food, Vibe, Service, Rep, Conv) with difficulty tiers |

### UI Zones

1. **Pulse Cards** — System Health %, Avg DondeMatch, Needs Attention count. RAG-colored (green ≥ 80, amber ≥ 60, red < 60).
2. **Production Strip** — Three live KPIs; clickable to expand detail.
3. **Quick Actions** — Run Tests, Rerun & Compare, Check Data.
4. **Test Results** — Collapsible; shows per-query pass/fail, gap types, score distributions.
5. **Agents** — Table of 5 agents (Atlas, QAudit, Sentinel, Hunter, Guardian) with HP/XP/status + leaderboard.
6. **Data Health & Pipelines** — Discovery, Enrichment, Scores & Tags, Audit status.
7. **Activity Log** — Timestamped battle log with agent-color coding.

### Agents

| Agent | Color | Purpose |
|-------|-------|---------|
| **Atlas** | Blue `#3b82f6` | Broad-coverage golden-query runner |
| **QAudit** | Purple `#8b5cf6` | Quality auditor — deep score analysis |
| **Sentinel** | Amber `#f59e0b` | Edge-case & security probe runner (20 probes: SQLi, XSS, empty, unicode…) |
| **Hunter** | Red `#ef4444` | Gap hunter — targets known weaknesses |
| **Guardian** | Green `#22c55e` | Regression guard — re-tests previous failures |

Each agent has an XP/level system, per-session budget drawn from a daily $50 cap, and AbortController-based 15 s API timeout.

### Keyboard Shortcuts

`t` Run Tests · `r` Rerun & Compare · `d` Check Data · `1-3` Toggle sections · `?` Show help · `Esc` Close overlays

### Design Tokens

- **Palette:** `--cc-bg: #0c0d0f`, `--cc-surface: #16181c`, `--cc-accent: #8b8ff5`
- **Typography:** Inter (body), JetBrains Mono (data)
- **Motion:** Spring physics for user actions, ease-out for system reveals

---

## Backend

### Supabase Edge Functions

| Function | Method | Purpose |
|----------|--------|---------|
| **`recommend`** | POST | V11 recommendation engine — intent classification → candidate filtering → scoring → ranking. Returns `restaurant`, `donde_match`, `scoring_v9`, `match_narrative`, `ranked_queue[]`. |
| **`recommend`** | GET | Health check: `{status, version, engine, timestamp}` |
| **`review-intelligence`** | POST | Extracts dish catalogs and cuisine signals from reviews. |

**Scoring V11 formula:** `Relevance(0–1) × Quality(0–100) + OccasionBonus(±5)`
- 40+ semantic concepts, dynamic weight profiles per query type, self-healing for NULL fields.
- Rate-limited: 30 req/min/IP (429 on breach).
- In-memory cache: 15-min soft TTL / 30-min hard TTL, 500 entries, stale-while-revalidate.
- DondeCache: persistent 3-level fuzzy cache (exact/fingerprint/canonical), quality gate B-/80+.

### Database Tables (CEO-Relevant)

| Table | Purpose |
|-------|---------|
| **`maintenance_requests`** | Queue for pipeline operations. Columns: `operation`, `status` (pending → running → complete/failed), `requested_by` (default `ceo`), `config` JSONB, `result` JSONB, `stages` JSONB. |
| **`gauntlet_runs`** | Test run summaries — `passed_60/80/90`, `avg_dm`, gap counts, category stats, delta vs prior run. |
| **`gauntlet_results`** | Per-query scores, factor breakdowns, gap analysis per run. |
| **`restaurant_popularity`** | 7d/30d recommendation counts, trending score (0–10), query demand score (0–10). |
| **`user_queries`** | Fire-and-forget query log with feedback + cache hit tracking. |
| **`query_cache`** | DondeCache persistent cache (quality-gated B-/80+, 3-level fuzzy matching). |
| **`warming_runs`** | Cache pre-warming pipeline execution tracking. |

**RPC:** `get_cache_dashboard()` returns cache health metrics: active entries, 24h hit rate, savings, latency comparison, top uncached queries, last warming run.

All tables have RLS enabled. Gauntlet and maintenance data is publicly readable; mutations are frontend-auth-gated.

### Pipeline System

The CEO Command Center writes to `maintenance_requests`; a **GitHub Actions cron** (`maintenance-worker.yml`, every 5 min) polls and executes:

| Operation | Script | Schedule |
|-----------|--------|----------|
| **discovery** | `discovery.ts` | Monthly 1st, 03:00 UTC |
| **enrichment** | `enrichment-v2.ts` + `enrichment-review-intelligence.ts` | Monthly 1st, 05–06:00 UTC |
| **scores_tags** | `generate-occasion-scores.ts` + `generate-tags.ts` | Monthly 1st, 07:00 UTC |
| **audit** | `audit-full-dataset.ts` + `audit-enrichment-gaps.ts` | On-demand |

Additional pipelines: `analytics.ts` (daily trending aggregation), `validate-status.ts` (active status checks), `gauntlet-dashboard.ts` (markdown + JSON report generation with regression detection), `cache-warmer.ts` (daily DondeCache pre-warming), `cache-invalidator.ts` (cache cleanup), `query-miner.ts` (canonical query extraction).

All pipeline scripts support `DRY_RUN` mode and use the `SUPAB_SERVICE_ROLE_KEY` to bypass RLS.

### Auth & Authorization

- **Google SSO** via Supabase Auth; `user_profiles` auto-created on signup.
- **CEO gate:** Frontend checks email === `aacrit@gmail.com` before rendering.
- **RLS policies:** Users access own data; service-role key for pipelines.
- **Edge Functions:** JWT extracted from Authorization header; `recommend` has `verify_jwt = false` (validates in code).

### Environment Variables

| Variable | Usage |
|----------|-------|
| `SUPAB_URL` | Supabase project URL |
| `SUPAB_ANON_KEY` | Client-safe RLS key |
| `SUPAB_SERVICE_ROLE_KEY` | Pipeline access (bypasses RLS) |
| `DATABASE_URL` | Direct PostgreSQL (pipelines) |
| `ANTHROPIC_API_KEY` | Claude API (enrichment, scoring) |
| `GOOGLE_PLACES_API_KEY` | Discovery pipeline |

---

## Zero-Cost Testing

**Live API Toggle** (header, default OFF):
- **OFF ("Scoring Only"):** All tests send `skip_claude: true` → engine scores deterministically, returns fallback blurbs. $0 API cost.
- **ON ("LIVE API"):** Full Claude pipeline — Sonnet for blurbs, Haiku for intent fallback. ~$0.28/query.

**Standalone Live Tests** (always call Claude, red cards):
- **Blurb Quality Check:** 1 query ("romantic Italian dinner in Lincoln Park"), ~$0.30
- **Intent Classification:** 1 query ("somewhere fancy but not pretentious"), ~$0.05

## CLI Test Write-Back

CLI test scripts (`golden-dataset-test.sh`, `regression-guard.sh`) persist results to `gauntlet_runs` + `gauntlet_results` tables when `SUPAB_URL` and `SUPAB_ANON_KEY` env vars are set. Run IDs: `cli-golden-*`, `cli-regression-*`. Source field: `cli`.

## Data Flow: Test Run Lifecycle

```
CEO clicks "Run Tests" (Scoring Only mode — default)
  → cc-agents.js builds query pool (golden + edge probes)
  → Per query: POST /recommend with skip_claude=true → deterministic scoring
  → Results streamed to Activity Log
  → On complete: summary written to gauntlet_runs / gauntlet_results (mode: scoring_only)
  → cc-analytics.js reloads Pulse Cards with new avg_dm, gap count

CEO clicks "Blurb Quality Check" (Live test — always calls Claude)
  → 1 query with skip_claude=false → full Claude blurb generation
  → Blurb quality graded, result shown with [LIVE] badge
```

## Data Flow: Pipeline Trigger

```
CEO clicks "Check Data" → selects operation (e.g. enrichment)
  → Frontend INSERTs into maintenance_requests (status: pending)
  → maintenance-worker.yml (5-min cron) picks up request
  → Sets status: running, executes pipeline script
  → Updates stages[] JSONB with per-step progress
  → Sets status: complete/failed with result summary
  → Frontend polls and surfaces status in Data Health section
```

---

## File Reference

### Frontend (`dondeAI/`)

| Path | Lines | Purpose |
|------|-------|---------|
| `command-center.html` | 374 | Dashboard shell + auth gate |
| `css/command-center.css` | ~1800 | Dark theme, agent colors, animations |
| `js/cc-config.js` | 255 | Config, agents, state, helpers |
| `js/cc-agents.js` | 300+ | Test orchestration, API calls, XP |
| `js/cc-analytics.js` | 74+ | Gauntlet data loading, quality render |
| `js/cc-ui.js` | 150+ | Pulse, status, clock, count-up |
| `js/cc-queries.js` | 1042 | Chicago query dataset |
| `data/dashboard-data.json` | — | Sample gauntlet run |

### Backend (`dondeBackend/`)

| Path | Purpose |
|------|---------|
| `supabase/functions/recommend/index.ts` | V11 recommendation engine |
| `supabase/functions/recommend/_shared/scoring-v9.ts` | Scoring logic |
| `supabase/functions/recommend/_shared/intent-classifier-v5.ts` | Query intent detection |
| `supabase/functions/review-intelligence/index.ts` | Review analytics |
| `supabase/migrations/20260309000001_maintenance_requests.sql` | Pipeline queue table |
| `supabase/migrations/20260308000001_gauntlet_tracking.sql` | Test tracking tables |
| `supabase/migrations/20260314000001_query_cache.sql` | DondeCache tables + triggers + RPC |
| `supabase/functions/recommend/_shared/query-cache.ts` | DondeCache module |
| `supabase/functions/recommend/_shared/grading.ts` | Score fit + blurb quality grading |
| `scripts/pipelines/maintenance-worker.ts` | Cron worker |
| `scripts/pipelines/analytics.ts` | Trending aggregation |
| `scripts/pipelines/gauntlet-dashboard.ts` | Report generator |
| `scripts/pipelines/cache-warmer.ts` | DondeCache pre-warming |
| `scripts/pipelines/cache-invalidator.ts` | Cache cleanup |
| `scripts/pipelines/query-miner.ts` | Canonical query extraction |
| `.github/workflows/maintenance-worker.yml` | 5-min cron |
| `.github/workflows/cache-warmer.yml` | Daily cache warming |
