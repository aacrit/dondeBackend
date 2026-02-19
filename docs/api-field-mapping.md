# API Field Mapping: UI ↔ Backend

Complete mapping of every field exchanged between the frontend and the recommend Edge Function.

---

## REQUEST (UI → Backend)

`POST /recommend` — exactly 4 fields, all optional with defaults.

| Field | Type | Default | UI Element | Purpose |
|-------|------|---------|------------|---------|
| `special_request` | string | `""` | Free-text craving input | Core routing signal. If < 5 chars or matches generic phrases ("surprise me", "anything good", etc.), backend skips Claude and serves a pre-generated recommendation (PATH A). Otherwise triggers a live Claude call with fresh Google reviews (PATH B). |
| `occasion` | string | `"Any"` | Single-select picker: Date Night, Group Hangout, Family Dinner, Business Lunch, Solo Dining, Special Occasion, Treat Myself, Adventure, Chill Hangout | Selects which occasion score column to rank by. Feeds into `donde_match` calculation (30% weight). Used to look up pre-generated recommendations. |
| `neighborhood` | string | `"Anywhere"` | Single-select picker: Anywhere + 14 Chicago neighborhoods | Filters restaurant pool via DB query. Contributes to `donde_match` filter precision score (10% weight). |
| `price_level` | string | `"Any"` | Single-select: Any, $, $$, $$$, $$$$ | Filters restaurant pool via DB query. Contributes to `donde_match` filter precision score (10% weight). |

---

## RESPONSE (Backend → UI)

### Top-level fields

| Field | Type | Source | UI Element | Purpose |
|-------|------|--------|------------|---------|
| `success` | boolean | Edge Function logic | Controls result vs error screen | `true` = show recommendation. `false` = show `recommendation` field as error message. |
| `recommendation` | string | PATH A: `pre_recommendations` table. PATH B: Claude generates live (80-120 words). | Main body paragraph on result card | Personalized explanation of WHY this restaurant fits the user's request. |
| `insider_tip` | string \| null | PATH B: Claude generates live. Fallback: `restaurants.insider_tip` from DB. PATH A: from pre-rec or DB. | Highlighted callout box (shown only if present) | Actionable insider knowledge (e.g. "ask for the corner booth", "go on Tuesday for half-price oysters"). |
| `donde_match` | integer (60-99) | Computed deterministically via weighted formula | Animated ring visualization with verdict tier label | Match confidence percentage. Tiers: 93%+ Perfect Match, 85%+ Great Match, 75%+ Good Match, 60%+ Worth Exploring. |
| `tags` | string[] \| null | `tags` table (pipeline-generated) | Pill-shaped tag cloud | Descriptive labels like "hidden gem", "craft cocktails", "farm-to-table", "date night". |
| `timestamp` | ISO 8601 string | Generated at response time | Not displayed; client-side logging | When the recommendation was generated. |

### `restaurant` object

| Field | Type | Source | UI Element | Purpose |
|-------|------|--------|------------|---------|
| `name` | string | Google Places live fetch (preferred) → DB fallback | Primary heading on result card | Restaurant name. |
| `best_for_oneliner` | string \| null | DB (`restaurants.best_for_oneliner`, pipeline-enriched) | Subtitle under name | Short tagline (max 15 words), e.g. "Late-night tacos with a cult following". |
| `address` | string | Google Places live fetch (preferred) → DB fallback | Tappable link → opens Google Maps | Full street address. |
| `phone` | string \| null | Google Places live fetch only (never stored) | `tel:` link button (shown only if present) | Phone number for calling the restaurant. |
| `website` | string \| null | Google Places live fetch only (never stored) | External link button (shown only if present) | Restaurant's website URL. |
| `google_place_id` | string \| null | DB (only Google field stored permanently per ToS) | Link to Google Maps place page | Used to construct Google Maps URL for the restaurant. |
| `google_rating` | string (numeric) \| null | Google Places live fetch only (never stored) | 5-star visualization + numeric rating | Google star rating (e.g. "4.5"). Parse to float for display. |
| `google_review_count` | string \| null | Google Places live fetch only (never stored) | Displayed alongside star rating | Number of Google reviews (e.g. "1,234"). |
| `price_level` | string | DB (`restaurants.price_level`) | Price badge (e.g. "$$") | Budget tier indicator. |
| `cuisine_type` | string \| null | DB (pipeline-enriched by Claude) | Cuisine emoji + gradient accent color | Used by UI for visual theming via keyword→hue mapping (e.g. "Mexican" → taco emoji + warm hue). |
| `noise_level` | string \| null | DB (pipeline-enriched: Quiet, Moderate, Loud) | Atmosphere tag | Noise level indicator. |
| `lighting_ambiance` | string \| null | DB (pipeline-enriched, e.g. "Dim and intimate") | Atmosphere tag | Lighting/ambiance description. |
| `dress_code` | string \| null | DB (pipeline-enriched: Casual, Smart Casual, Business Casual, Formal) | Atmosphere tag | Expected dress code. |
| `outdoor_seating` | boolean \| null | DB (pipeline-enriched) | Atmosphere tag (shown if `true`) | Whether restaurant has patio/outdoor seating. |
| `live_music` | boolean \| null | DB (pipeline-enriched) | Atmosphere tag (shown if `true`) | Whether restaurant has live music. |
| `pet_friendly` | boolean \| null | DB (pipeline-enriched) | Atmosphere tag (shown if `true`) | Whether restaurant allows pets. |
| `parking_availability` | string \| null | DB (pipeline-enriched) | Info line (shown only if present) | Parking description (e.g. "Street parking", "Valet available"). |
| `sentiment_breakdown` | string \| null | PATH B only: Claude analyzes fresh Google reviews on-the-fly. PATH A: null. | Stacked bar (positive/neutral/negative %) | Text like "85% positive, 10% neutral, 5% negative". UI parses percentages. |
| `sentiment_score` | string (numeric 0-1) \| null | PATH B only: Claude generates on-the-fly. PATH A: null. | Fallback if breakdown not parseable | Overall sentiment as 0-1 float. |
| `neighborhood_name` | string | DB (`neighborhoods.name` via join) | Displayed on result card | Name of the neighborhood the restaurant is in. |

### `scores` object

All scores are used to render a radar/spider chart. Chart is shown only if 3+ dimensions are present.

| Field | Type | Source | Radar Label | Purpose |
|-------|------|--------|-------------|---------|
| `date_friendly_score` | string (0-10) \| null | DB `occasion_scores` table (pipeline-generated) | DT / Date | How suitable for date nights. |
| `group_friendly_score` | string (0-10) \| null | DB `occasion_scores` table | GR / Group | How suitable for groups of 4+. |
| `family_friendly_score` | string (0-10) \| null | DB `occasion_scores` table | FM / Family | How kid/family-friendly. |
| `business_lunch_score` | string (0-10) \| null | DB `occasion_scores` table | BZ / Business | How suitable for business meetings. |
| `solo_dining_score` | string (0-10) \| null | DB `occasion_scores` table | SL / Solo | How welcoming to solo diners. |
| `hole_in_wall_factor` | string (0-10) \| null | DB `occasion_scores` table | GM / Gem | Hidden gem / off-the-radar factor. |
| `romantic_rating` | string (0-10) \| null | DB `occasion_scores` table | (separate score element) | Special occasion / romance factor. Not in radar chart. |

---

## Data Source Legend

| Source | Stored in DB? | When Fetched |
|--------|--------------|--------------|
| **DB (pipeline-enriched)** | Yes | Pre-computed weekly by data pipelines using Claude |
| **DB (pre-generated)** | Yes | Pre-computed weekly (recommendations + donde_match per restaurant × occasion) |
| **Google Places (live)** | No (per ToS) | Fetched at recommendation time for the chosen restaurant only |
| **Claude (live)** | No | PATH B only: single API call at recommendation time |
| **Computed** | No | donde_match calculated deterministically per request |

---

## PATH A vs PATH B Summary

| Aspect | PATH A (Generic Request) | PATH B (Specific Request) |
|--------|--------------------------|---------------------------|
| Trigger | Empty/short craving or generic phrases | Specific craving text (5+ chars, non-generic) |
| Claude API call | None | 1 call (recommendation + sentiment) |
| Google Places fetch | 1 fetch (chosen restaurant) | 3 fetches in parallel (top 3 candidates) |
| Recommendation source | `pre_recommendations` table | Claude generates live |
| Sentiment data | null | Claude analyzes fresh reviews |
| Latency | Fast (~200ms) | Slower (~800ms with Claude) |
| donde_match | From pre-computed value or deterministic formula | Deterministic formula with Claude's relevance_score |
