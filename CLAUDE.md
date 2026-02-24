# DondeAI

> **SYNC DIRECTIVE**: This CLAUDE.md is shared identically across `dondeAI` (frontend) and `dondeBackend` (backend). Any edit MUST be copied to both repos in the same commit/PR. Always verify both files match after changes.

AI restaurant recommendations for Chicago. One craving in → one perfect spot out.

**Design philosophy**: "Ink & Momentum" — Arc Browser choreography, Apple Notes ink feel, Linear precision, Notion progressive disclosure.

## Architecture

| Layer | Tech | Location |
|-------|------|----------|
| **Frontend** | Vanilla HTML/CSS/JS (zero framework, zero build) | `dondeAI/` |
| **API** | Supabase Edge Function (Deno/TS) | `dondeBackend/supabase/functions/recommend/` |
| **AI** | Claude Haiku 4.5 (recommendations, enrichment, sentiment, intent) | Edge Function + pipelines |
| **DB** | Supabase PostgreSQL | `dondeBackend/supabase/migrations/` |
| **Data** | Google Places API (live fetch per request; `google_place_id` only stored per ToS §3.2.3) | Edge Function + pipelines |
| **Pipelines** | Node.js TS scripts, GitHub Actions cron | `dondeBackend/scripts/pipelines/` |

## Skill

**`/frontenddesign`** — design system enforcement (`.claude/skills/frontenddesign/SKILL.md`). Auto-activates on UI/animation/layout tasks. Enforces Ink Rule, 3-voice typography, motion grammar, all 16 theme variants, accessibility.

## API Contract (Immutable — shared between repos)

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

**Response:**
```json
{
  "success": true,
  "restaurant": {
    "id", "name", "address", "best_for_oneliner", "google_place_id",
    "google_rating", "google_review_count", "price_level", "phone", "website",
    "noise_level", "cuisine_type", "lighting_ambiance", "dress_code",
    "outdoor_seating", "live_music", "pet_friendly", "parking_availability",
    "dietary_options", "sentiment_breakdown", "sentiment_score", "sentiment_summary",
    "sentiment_positive", "sentiment_negative", "sentiment_neutral",
    "neighborhood_name", "photo_urls", "opening_hours", "review_snippets"
  },
  "recommendation": "string",
  "insider_tip": "string|null",
  "donde_match": "numeric 60-99",
  "scores": {
    "date_friendly_score", "group_friendly_score", "family_friendly_score",
    "business_lunch_score", "solo_dining_score", "hole_in_wall_factor", "romantic_rating"
  },
  "scoring_v2": {
    "occasion_fit", "craving_match", "vibe_alignment", "practical_fit",
    "discovery_value", "weights_used"
  },
  "deep_context": { "signature_dishes", "service_style", "reservation_difficulty", "..." },
  "tags": ["string"],
  "timestamp": "ISO"
}
```

**Errors:** HTTP non-200 → toast + return to canvas | `success:false` → show `recommendation` as error | network → "Couldn't reach the engine." | timeout → "Request timed out."

**Health:** `GET /recommend` → `{status, version, timestamp}`

---

## Frontend (`dondeAI/`)

### Files

```
index.html                  # SPA entry point
css/reset|tokens|typography|layout|components|animations|responsive.css
css/themes/{neutral,indian,middleeastern,nepalese,japanese,eastasian,african,southamerican}.css
js/app.js                   # Orchestrator (init, event delegation, result rendering)
js/state.js                 # Pub/sub store: getState(), setState(patch), subscribe(fn)
js/router.js                # Canvas↔Result via translateX
js/api.js                   # Supabase Edge Function client
js/theme.js                 # 8 cultures × 2 modes, auto-theme on typing, radial wash
js/audio.js                 # Web Audio chimes per culture (opt-in)
js/voice.js                 # Web Speech Recognition
js/animations.js            # Score ring, petal radar, bloom cycle, particles, logo
js/share.js                 # 8-channel share sheet + canvas card
js/persistence.js           # localStorage (theme, sound, history, bookmarks, userId, feedback)
js/accessibility.js         # Focus, announcements, keyboard shortcuts
js/offline.js               # Connectivity detection
js/utils.js                 # 50+ SVG icons, cuisine mapper, 320 greetings
Frontendarch.md             # Architecture reference
UI_UX_Requirements.md       # Business requirements (immutable)
nicehave_sso.md             # Future: SSO auth roadmap (not implemented)
```

### Design Principles (Non-Negotiable)

1. **Canvas + Result** — 2 views only. No multi-step wizard.
2. **Ink Rule** — `--ac` only on: score ring, restaurant name, active CTAs, selected pills, logo dot, caret, petal radar (8%/25%). Everything else grayscale. Google stars always `var(--star-gold)`. RAG colors (`--rag-green`, `--rag-amber`, `--rag-red`) are universal and theme-independent.
3. **3 Type Voices** — Emotional (Playfair Display): headings/prompts. Structural (Inter): buttons/labels. Data (JetBrains Mono): scores/badges.
4. **Motion Grammar** — Spring `cubic-bezier(.34,1.56,.64,1)`: user-initiated. Ease `cubic-bezier(.4,0,.2,1)`: system reveals. `prefers-reduced-motion`: all 0ms.
5. **Cultural Personality** — Themes change palette + textures + terminology + audio + border/shadow depth.

### User Flow

```
[Canvas] Greeting → Craving input + voice + smart chips + Surprise Me
         → Filter drawer (Occasion 9, Neighborhood 15, Budget 5, Dietary 4, Randomize)
         → CTA (disabled until craving) → Taste Memory (last 3) → Saved Spots
    ↓ submit
[Loading] Act 1: blur canvas → Act 2: particles + logo draw-in + sonar → Act 3: reveal
    ↓
[Result]  3-tier progressive disclosure:
  Tier 1 (Glance):  Match pill + name (ink reveal) + one-liner + blurb + feedback
  Tier 2 (Lean In): Score hero arc + bloom cycle + photos + hours + sentiment + Google + glyph bar
  Tier 3 (Deep):    V2 score breakdown bars + detail badges grid
```

### State (`state.js`)

```js
{ step, craving, occasion, neighborhood, priceLevel, dietaryRestrictions,
  result, loading, error, excludeIds, theme: {culture, mode},
  colorMode, soundEnabled, history, pendingFeedback }
```

### Themes (8 × 2 = 16 variants)

| ID | Name | Hue | | ID | Name | Hue |
|---|---|---|---|---|---|---|
| `neutral` | Studio | achromatic | | `japanese` | Zen | 220° indigo |
| `indian` | Desi | 28° marigold | | `eastasian` | Silk | 285° plum |
| `middleeastern` | Bazaar | 48° gold | | `african` | Kente | 155° emerald |
| `nepalese` | Himalayan | 178° turquoise | | `southamerican` | Sabor | 350° chili |

Applied via `data-theme` + `data-mode` on `<html>`. Auto-theme on typing (cuisine keywords → culture preview). Each culture has unique labels, smart chips, greetings, audio frequencies, and textures.

### Scores Display

- **Match (0-100):** 90+ "Outstanding" | 85-89 "Excellent" | 75-84 "Solid Pick" | 60-74 "Worth a Try" | <60 "Adventurous"
- **Vibe Radar (6 axes):** date, group, family, business, solo, gem — teardrop petals, accent 8%/25%
- **Bloom cycle:** compact ring → petal radar → V2 bars → compact (tap to cycle)
- **Sentiment:** 4px RAG bar (`--rag-green`/`--fg3`/`--rag-red` at 70% opacity)
- **Glyph bar:** 32px spring-pop icons for price, noise, ambiance, cuisine, parking, dress, atmosphere

### Persistence (localStorage)

`dondeai-theme`, `dondeai-sound`, `dondeai-colormode`, `dondeai-history` (last 3), `dondeai-bookmarks` (max 20), `dondeai-user-id` (UUID), `dondeai-feedback` (max 100)

### Filter Options

- **Occasion:** Date Night, Group Hangout, Family Dinner, Business Lunch, Solo Dining, Special Occasion, Treat Myself, Adventure, Chill Hangout
- **Neighborhood:** Anywhere + 14 Chicago neighborhoods
- **Budget:** Any, $, $$, $$$, $$$$
- **Dietary:** Vegan, Vegetarian, Gluten-Free, Halal (multi-select)

### Accessibility (WCAG 2.1 AA)

Skip nav, `<main>` landmark, `aria-live` announcements, `radiogroup`+`radio` pills, `switch`+`aria-pressed` toggles, focus management on view change, `:focus-visible` outlines, reduced-motion 0ms, full keyboard nav, AA contrast across 16 variants.

### Keyboard Shortcuts

`/` focus craving | `T` toggle color mode | `F` toggle filters | `R` try again | `Escape` close modal | Arrows navigate pills

### Responsive

320px (min) → 375px (primary mobile) → 500px max-h (virtual keyboard adapt) → 768px (tablet) → 1024px (desktop) → 2560px (max UHD)

### Frontend Coding Standards

- **HTML:** Semantic, all interactives focusable + named, `lang="en"`, data attrs for actions
- **CSS:** All values via custom properties, mobile-first `min-width`, `clamp()` fluid, no `!important`, BEM-like naming
- **JS:** ES modules, plain objects + functions, event delegation via `data-action`, `requestAnimationFrame`, cached DOM queries, `AbortController` for fetches, no circular deps
- **Motion tokens:** `--dur-instant`(0) through `--dur-score`(1200), all → 0ms under reduced-motion
- **Z-index:** `--z-base`(1) → `--z-particle`(500)

---

## Backend (`dondeBackend/`)

### Files

```
supabase/functions/recommend/index.ts    # Edge Function entry point
supabase/functions/recommend/_shared/    # 9 modules (types, scoring, intent, response-builder, claude, google-places, supabase, cors, logger)
supabase/migrations/                     # 18 SQL migrations
scripts/pipelines/                       # discovery, enrichment, enrichment-v2, occasion-scores, tags, analytics, validate-status, +more
scripts/lib/                             # config, claude, google-places, supabase, batch, types
tests/test_catalog.sh                    # 65-test API suite (5 phases, ~215 checks)
docs/api-field-mapping.md               # Full field mapping
.github/workflows/                       # 8 CI/CD workflows
```

### Google API Compliance

Only `google_place_id` stored permanently. `name`/`address` stored as editorial. All Google-sourced data (rating, reviews, photos, hours) fetched live for top 5 candidates per request, never persisted.

### Ranking Algorithm

1. **RPC** (`get_ranked_restaurants`): Server-side JOIN of restaurants + occasion_scores + neighborhoods + deep_profiles + popularity. Filters by neighborhood/price/active. Returns top `15 + len(exclude)`.
2. **Intent classification** (parallel): Claude classifies `special_request` → cuisines, tags, features, flavors, vibe, emotional intent. Re-queries with cuisine filter if needed.
3. **Re-ranking** (TypeScript):
   - **V2** (deep profiles): `reRankV2()` — multi-dimensional: occasion fit, craving match, vibe alignment, practical fit, discovery value
   - **V1** fallback: `reRankWithBoosts()` — 60% occasion + 40% keyword boost
   - Both: rejection analysis, feedback signals, time-of-day, `ensureDiversity()` (max 2 same-cuisine)
4. **Claude pick**: Top 10 profiles + request + Google reviews → personalized recommendation + sentiment
5. **Relaxation**: No results → retry "Any" price → retry "Anywhere" + "Any" price

### Occasion Weights

| Occasion | Formula |
|----------|---------|
| Date Night / Group / Family / Business / Solo | 100% matching dimension |
| Special Occasion | 70% romantic + 30% date |
| Treat Myself | 50% solo + 30% romantic + 20% hole_in_wall |
| Adventure | 60% hole_in_wall + 20% group + 20% solo |
| Chill Hangout | 60% group + 30% solo + 10% hole_in_wall |
| Any | average of all 7 |

### Keyword Dictionaries (`_shared/scoring.ts`)

28 cuisines, 19 tags (byob, rooftop, hidden gem, late night, craft cocktails, etc.), 3 boolean features (outdoor_seating, live_music, pet_friendly)

### Database

- **Core:** `restaurants` (~1000), `occasion_scores` (7 dims, 0-10), `tags` (3-6 per restaurant), `neighborhoods` (14), `user_queries` (logs + feedback)
- **V2:** `restaurant_deep_profiles` (35 fields: culinary, service, atmosphere, cultural, experiential, practical), `restaurant_popularity`, `unmatched_keywords`
- **RPC:** `get_ranked_restaurants(p_neighborhood, p_price_level, p_occasion, p_limit, p_target_cuisine)`

### Edge Function Features

API v2.1.0 | 5-min cache (100 entries, bypassed with exclude) | 30/min/IP rate limit | Input sanitization + prompt injection defense | Tiered fallback (JSON → regex → template → one-liner) | Slop detection | Closed restaurant auto-substitution | Fire-and-forget query logging | Parallel: intent + RPC + feedback fetch; Google top-5 with 1.5s timeout

### Pipeline Schedule

Monthly on 1st (analytics daily), chained via GitHub Actions:

`analytics (2:00 UTC daily)` → `discovery (3:00)` → `validate-status (4:00)` → `enrichment (5:00)` → `enrichment-v2 (6:00)` → `scores-and-tags (7:00)` | `regenerate` = manual

### Deployment

- **Edge Function:** Auto-deploys via GitHub Actions on push to `main`/`claude/**` when `supabase/functions/recommend/**` changes
- **Migrations:** Manual (`supabase db push` or Dashboard SQL Editor)

### Claude API Cost Requirement

**IMPORTANT:** Before running ANY pipeline that calls Claude:
1. Estimate and disclose cost (input + output tokens, USD)
2. Get explicit approval before proceeding

Haiku 4.5: $0.80/M input, $4.00/M output. Full enrichment-v2 (~1000 restaurants) ≈ $2-2.50.

---

## Commands

```bash
# Frontend (dondeAI/)
# Open index.html in browser (no build step)

# Backend — Local dev
supabase functions serve recommend --env-file .env

# Backend — Deploy
supabase functions deploy recommend

# Backend — Pipelines
cd scripts && npx tsx pipelines/discovery.ts    # (or enrichment, enrichment-v2, etc.)

# Backend — Migrations
supabase db push

# Backend — Tests (65 scenarios)
./tests/test_catalog.sh
```

## Environment Variables

All use `SUPAB_` prefix (`SUPABASE_` is reserved in Edge Functions).

- **Edge Function secrets:** `SUPAB_URL`, `SUPAB_ANON_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`
- **GitHub Actions secrets:** above + `SUPAB_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`
- **Local `.env`:** all above + optional `DATABASE_URL`

## Backend Coding Standards

- **Edge Function:** Deno runtime (`https://esm.sh/` imports, `Deno.env.get()`)
- **Pipelines:** Node.js 20 + tsx (`.js` import extensions per ESM)
- **Dual type systems:** `_shared/types.ts` (Deno) vs `scripts/lib/types.ts` (Node) — overlapping but not identical
- **Dual Claude clients:** `_shared/claude.ts` (raw fetch) vs `scripts/lib/claude.ts` (`@anthropic-ai/sdk`)
- **Patterns:** Fire-and-forget logging, response builder functions, structured JSON logging via `logger.ts`

## Future (Not Implemented)

SSO auth (Google/Apple/Instagram/TikTok) → user accounts, unlimited history, favorites. See `nicehave_sso.md` in frontend repo.
