# Recommendation Blurb Generation

Last updated: 2026-03-15

How DondeAI generates the recommendation text, match headlines, insider tips, and queue blurbs that users see in the app.

## E2E Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  POST /recommend  { special_request, occasion, neighborhood, ... }     │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│  1. INTENT CLASSIFICATION  (classifyIntentV5)                        │
│     Extracts: cuisine, dish_level_intent, vibe_keywords,             │
│     semantic_tags, similar_to, mood, implicit_cuisines               │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│  2. CANDIDATE RETRIEVAL  (get_candidates_v11 RPC)                    │
│     50–100 candidates from PostgreSQL via composite scoring RPC      │
│     Fallback chain: V11 → V10 → V9                                  │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│  3. V9/V11 SCORING  (computeV9Score per candidate)                   │
│     DondeScore = Relevance(0-1) × Quality(0-100) + OccasionBonus    │
│     Generates MatchNarrative per candidate (template-based)          │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│  4. GOOGLE PLACES ENRICHMENT  (top 5 candidates only)                │
│     Live rating, review count, reviews (0-5), photos, hours          │
│     Timeout: 1500ms, fails gracefully                                │
└───────────────────────────────┬───────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│  5. POST-GOOGLE RE-RANKING                                           │
│     Re-computes V9 scores with live Google reputation data           │
│     Updates dondeMatch + matchNarrative for all candidates           │
└──────────┬────────────────────┬───────────────────────────────────────┘
           │                    │
           ▼                    ▼
┌──────────────────┐  ┌────────────────────────────────────────────────┐
│ 6a. QUEUE BLURBS │  │ 6b. CLAUDE BLURB GENERATION                   │
│ (items #2–#8)    │  │     (top pick only — single API call)          │
│ Template-based   │  │     Model: claude-haiku-4-5-20251001           │
│ No API call      │  │     System prompt: ~2000 tokens (cached)       │
│                  │  │     User prompt: ~2500 tokens                  │
│                  │  │     Max output: 512 tokens                     │
│                  │  │     Temperature: 0.7                           │
└──────────────────┘  └─────────────────────┬──────────────────────────┘
                                            │
                                            ▼
                      ┌────────────────────────────────────────────────┐
                      │ 7. INTENT BOOST EVALUATION                     │
                      │    Claude may override engine's #1 pick        │
                      │    Guard: base ≥35, max boost +35, total ≤99   │
                      └─────────────────────┬──────────────────────────┘
                                            │
                                            ▼
                      ┌────────────────────────────────────────────────┐
                      │ 8. QUALITY GUARDRAILS                          │
                      │    - AI slop detection (30+ banned words)      │
                      │    - Em dash stripping (U+2014 → comma)        │
                      │    - Word count check (target 100–120)         │
                      │    - "We"/"our" voice mandate check            │
                      └─────────────────────┬──────────────────────────┘
                                            │
                                            ▼
                      ┌────────────────────────────────────────────────┐
                      │ 9. RESPONSE ASSEMBLY  (buildV9SuccessResponse) │
                      │    Packages: recommendation, match_headline,   │
                      │    insider_tip, match_narrative, ranked_queue,  │
                      │    scoring_v9, deep_context                    │
                      └─────────────────────┬──────────────────────────┘
                                            │
                                            ▼
                      ┌────────────────────────────────────────────────┐
                      │ 10. CACHE + LOG + GRADE                        │
                      │     In-memory: 15min soft / 30min hard         │
                      │     Persistent: DondeCache write-through       │
                      │       (quality gate: SF>=80 AND BQ>=80)        │
                      │     Fire-and-forget logging to user_queries    │
                      │     Score fit + blurb quality grading           │
                      └────────────────────────────────────────────────┘
```

## Text Generation Summary

| Field | Method | Source File | Notes |
|-------|--------|-------------|-------|
| `recommendation` (main) | LLM (Claude Haiku 4.5) | `prompts-v5.ts` → `claude.ts` | 100–115 word blurb, single API call |
| `match_headline` | LLM (Claude Haiku 4.5) | `prompts-v5.ts` → `claude.ts` | 10–15 words, no restaurant name |
| `insider_tip` | LLM + DB fallback | `prompts-v5.ts` → `claude.ts` | Falls back to `insider_tip` or `best_seat_in_house` from DB |
| `match_narrative.*` | Template (TypeScript) | `scoring-v9.ts` | Computed from scoring factors, no LLM |
| Queue `recommendation` | Template (TypeScript) | `response-builder-v9.ts` | `buildQueueBlurb()` — DB fields only |
| Queue `match_headline` | Template (TypeScript) | `response-builder-v9.ts` | Uses `matchNarrative.summary` |
| Score tier / tone | Rule-based mapping | `prompts-v5.ts` | 5 tiers map to tone directives |
| Culture voice | Keyword matching | `prompts-v5.ts` | 5 literary personas by cuisine |

---

## 1. Claude Blurb Generation (Main Pick)

**File:** `supabase/functions/recommend/_shared/prompts-v5.ts`
**API client:** `supabase/functions/recommend/_shared/claude.ts`
**Orchestration:** `supabase/functions/recommend/index.ts` (lines ~800–1009)

### Claude API Configuration

```
Model:       claude-haiku-4-5-20251001
Max tokens:  512
Temperature: 0.7
Caching:     System prompt cached with cache_control: "ephemeral"
Retries:     2 attempts on 5xx/timeout, 2s sleep between
Endpoint:    https://api.anthropic.com/v1/messages
```

### System Prompt Architecture (~2000 tokens)

The system prompt is built by `buildV5SystemPrompt(scoreTier, cultureTheme, occasion)` and composed from four modular layers:

#### Layer 1: Character Voice

The Donde character is a "sharp, literate Chicago food and bar critic who writes like texting a best friend after a great meal." Core rules:

- **Voice mandate:** Every blurb must contain "we" or "our" (collective voice, never "I" or "you should")
- **Earned opinions:** Ground every claim in a specific detail, not adjectives
- **One honest caveat always:** Even for 95-score picks
- **Cultural specificity:** Use each kitchen's vocabulary (injera not "flatbread", banchan not "side dishes")
- **Short sentences as punctuation:** At least one ≤6-word sentence per blurb
- **Stakes and skin in the game:** "We'd send our mom here"
- **Temporal anchoring:** Ground in specific moments — time of day, season, day of week
- **Micro-narrative tension:** Expectation → pivot → payoff arc
- **Humanization:** Contractions, fragments, mid-sentence pivots, dropped articles

Additional directives cover emotional architecture, vulnerability/stakes (1 in 3 blurbs), projected memory, and the "friend test."

#### Layer 2: Narrative Voice (5 Literary Personas)

Selected by `detectCultureTheme()` based on cuisine keywords in the top candidate + user intent:

| Theme | Literary Model | Style | Calibration Example |
|-------|---------------|-------|---------------------|
| **Neutral** | Albert Camus | Spare, existential, absurdist warmth | "The rigatoni has that chew that means someone back there actually gives a damn about the dough." |
| **Japanese** | Banana Yoshimoto | Intimate, comforting, food as emotional anchor | "The katsu curry at Miku is the kind of meal that makes the rain outside feel like it's happening to someone else." |
| **Indian** | Jhumpa Lahiri | Sensory memory, food as emotional bridge | "The dal at Rangoli tastes the way someone's kitchen smells at six in the evening." |
| **Middle Eastern** | Kahlil Gibran | Aphoristic warmth, hospitality as philosophy | "A good shawarma needs nothing explained." |
| **South American** | Gabriel García Márquez | Sensory abundance, warmth bordering mythic | "The mole at La Casa has the patience of something that's been stirring since morning." |

Detection maps 180+ cuisine keywords across 5 groups. Defaults to "neutral" (Camus) when unmatched.

#### Layer 3: Occasion Register (9 Registers)

Selected by keyword matching on the `occasion` field:

| Occasion | Register | Emotional Key |
|----------|----------|---------------|
| Date Night | Conspiratorial intimacy | "We'd hold hands here." |
| Solo Dining | Quiet confidence | "This is where we go when we want to think." |
| Group Hangout | Generous energy | "Bring six people and zero plans." |
| Family Dinner | Warm practicality | "The kids menu isn't an afterthought." |
| Business Lunch | Quiet competence | "Nobody's distracted, nobody's bored." |
| Special Occasion | Earned gravitas | "We save this one." |
| Treat Myself | Luxurious self-assurance | "You earned this." |
| Adventure | Discovery energy | "We found something." |
| Chill Hangout | Low-key ease | "We come here when we don't want to think about it." |

#### Layer 4: Tone Directive (5 Score Tiers)

Modulates enthusiasm vs. honesty based on the DondeMatch score:

| Tier | Score Range | Tone |
|------|-------------|------|
| Perfect Match | 80–99 | Declarative authority, no hedging. "This is where we'd eat tonight." |
| Strong Pick | 75–87 | Confident with texture, name one real trade-off |
| Solid Option | 60–74 | Measured honesty, sarcasm may surface |
| Worth a Try | 45–59 | Frank, not apologetic. Lead with one genuine positive |
| Best Available | 0–44 | Transparent. "We looked for [X] and the options are thin." |

### User Prompt Structure (~2500 tokens)

Built by `buildV5UserPrompt()`. Sections:

1. **User request context** — special_request (100 char max), occasion, neighborhood, price, dietary, weight context
2. **Dish match analysis** (conditional) — if `dish_level_intent` exists, lists candidates with matching signature_dishes and menu_highlights. Includes: `CRITICAL: If #0 does NOT serve "X", you MUST boost a candidate that does.`
3. **Full candidate pool** (compact) — all 50–100 candidates as: `#N. Name | Cuisine | Price | DM:score | Tags: ... [feature✓]`
4. **Top 10 deep profiles** — rich data for the best candidates:
   - Signature dishes + why, menu highlights, flavor profiles
   - Service style, pacing, decor, music, energy, conversation friendliness
   - Reservation difficulty, wait time, USP, best seat, wow factors, awards
   - Noise, lighting, dress code, outdoor seating, live music
   - Google reviews (live-fetched, formatted as "5/5: text...")
   - DB editorial content (insider_tip, best_for_oneliner)
5. **Quality note** (conditional) — if match scored below confidence threshold
6. **Neighborhood note** (conditional) — if search expanded beyond requested neighborhood

### Claude Output Format

```json
{
  "restaurant_index": 0,
  "match_headline": "10-15 word one-liner",
  "recommendation": "100-120 word single-paragraph blurb",
  "insider_tip": "One sentence tip",
  "intent_boost": false,
  "boost_reason": null,
  "boost_points": 0,
  "sentiment_score": null,
  "sentiment_summary": null
}
```

### Blurb Structure Mandate

Every recommendation blurb follows a three-part structure (100–115 words total):

1. **Hook** (1 sentence): Tension, curiosity, bold claim, or provocation. Never open with the restaurant name.
2. **Heart** (2–3 sentences): Sensory food detail + atmosphere detail, connected to the user's occasion.
3. **Conviction** (1 sentence): Decisive close, ≤8 words. "We'd eat here tonight." "Go. Bring someone."

Opening rotation by restaurant name hash: 50% food/dish lead, 25% provocation/opinion, 25% neighborhood/context.

### Query Term Echo (Key Terms Extraction)

The prompt includes an `extractKeyTerms()` function that mirrors the grading.ts query relevance logic. It extracts significant words from the user's query (filtering 40+ stop words and detecting compound neighborhood names like "logan square") and injects them as `KEY SEARCH TERMS` into both the full user prompt and the blurb-only prompt.

The system prompt's QUERY TERM ECHO rule instructs Claude to weave each key term naturally into the blurb where the restaurant matches the term. For feature-mismatch cases (e.g., user asked "rooftop" but restaurant isn't a rooftop), Claude acknowledges the search context without falsely claiming the feature. This ensures blurbs read as direct responses to the specific request. Scored as part of Blurb Quality Grade Check 2 (25pts).

### Specificity Checklist

Every blurb must include at least 3 of: (1) the restaurant name, (2) a specific number (price, year, rating), (3) the neighborhood name, (4) a sensory texture word (charred, crispy, smoky, tangy, spicy, creamy, buttery, flaky, tender). Scored as part of Blurb Quality Grade Check 3 (20pts).

### Intent Boost

Claude can override the engine's #1 pick if a lower-ranked candidate uniquely matches the user's specific request. Boost calibration:

| Match Type | Points |
|------------|--------|
| Exact dish match only this candidate has | +20–35 |
| Exact cuisine match only this candidate has | +15–25 |
| Strong vibe/feature alignment | +8–14 |
| Slight fit improvement | +5–7 |

Guard rails: base score ≥ 35, max boost +35, total ≤ 99. If boosted, Claude writes the blurb for the boosted candidate.

---

## 2. Match Headline

**Main pick:** Generated by Claude as part of the blurb API call (see above). 10–15 words answering "Why this restaurant for THIS request?" No restaurant name.

**Queue items:** Uses `matchNarrative.summary` from the scoring engine (template-based). Format: `"{strongest_factor_label} — {first_key_signal}"`.

---

## 3. Insider Tip

**Priority chain** (main pick):
1. Claude-generated from the API call ("Ask for...", "Sit at...", "Skip the...")
2. DB field: `restaurants.insider_tip`
3. DB field: `deep_profiles.best_seat_in_house`

Claude is instructed to make tips occasion-aware: date night = seating/timing moves, solo = where to sit, group = logistics, business = table selection, family = kid-tested intel.

**Queue items:** `restaurants.insider_tip` from DB, or null.

---

## 4. Match Narrative (Template-Based)

**File:** `supabase/functions/recommend/_shared/scoring-v9.ts` (`generateV9MatchNarrative`)

Generated entirely in TypeScript during scoring, no LLM call. Fields:

| Field | Logic |
|-------|-------|
| `strongest_factor` | Factor with highest weight from V9 quality computation ("food", "vibe", etc.) |
| `strongest_factor_label` | Tier-based label: "Outstanding Cuisine Match" (Q≥70), "Good Food Fit" (50≤Q<70), "Decent Menu" (Q<50) |
| `key_signals` | 2–3 strings: dish/cuisine matches, awards, authenticity score, relevance strength |
| `summary` | `"{strongest_factor_label} — {first_key_signal_lowercase}"` |
| `weak_spots` | "Below average quality" if Q<40; "Partial relevance match" if R<0.5 |
| `confidence_caveat` | "Limited data available — score may update..." if no deep_profile or confidence<0.3 |
| `comparison_context` | Set during re-ranking: "X points ahead of next option" |

---

## 5. Queue Blurbs (Template-Based)

**File:** `supabase/functions/recommend/_shared/response-builder-v9.ts` (`buildQueueBlurb`)

For "Try Again" queue items (#2–#8), blurbs are composed from pre-existing DB fields with no API call:

```
[unique_selling_point OR best_for_oneliner]. [Known for the {signature_dish}]. [Around ${price} per person.]
```

Composition rules:
1. **Lead:** `deep_profile.unique_selling_point` (human-written) → fallback to `best_for_oneliner`
2. **Detail:** First signature dish → fallback to non-generic key_signal from match narrative
3. **Context:** `check_average_per_person` → fallback to first weak_spot from narrative
4. Minimum 1 part, maximum 3 parts, joined with spaces.

**Fallback response** (when Claude API fails entirely): Uses `buildQueueBlurb()` for the main pick too, falling back to `best_for_oneliner`, then to `"A top pick based on our match engine."`

---

## 6. Blurb-Only Endpoint (Try Again Regeneration)

**Route:** `POST /recommend/blurb`
**File:** `supabase/functions/recommend/_shared/prompts-v5.ts` (`buildBlurbOnlyPrompt`)

A lightweight endpoint for regenerating a Claude-quality blurb for a single restaurant during "Try Again" flows. Significantly smaller prompt than the full recommendation:

- Input: ~300–400 tokens (vs ~2500 for full)
- Output: max 384 tokens
- Contains: restaurant profile, deep context highlights, match narrative for grounding
- Same system prompt (character voice + tone + occasion)
- Returns: `{ match_headline, recommendation, insider_tip }`

---

## 7. Quality Guardrails

**File:** `supabase/functions/recommend/index.ts` (lines ~1011–1056)

Post-generation checks applied to Claude's output before sending to the client:

### AI Slop Detection

30+ banned patterns checked against the recommendation text:

```
"culinary", "gastronomic", "unforgettable", "unparalleled", "nestled",
"tantalizing", "mouthwatering", "delectable", "exquisite", "embark",
"elevate your", "a testament to", "truly remarkable", "a must-visit",
"culinary journey", "dining experience", "perfect harmony", "burst of flavor",
"symphony of", "tapestry", "crafted with care", "fusion of flavors", ...
```

Logs a warning if 2+ patterns detected. Does not reject/regenerate — logs only.

### Em Dash Stripping

All U+2014 characters in `recommendation` and `insider_tip` are replaced with `, ` (comma + space), with cleanup of double separators.

### Word Count Check

Target: 100–115 words. Warns if <80 or >150. Does not reject.

### Voice Mandate Check

Checks for `\bwe\b` or `\bour\b` in the blurb. Warns if missing. Does not reject.

---

## 8. Banned Patterns (Full List)

67 patterns banned in the system prompt, enforced via instruction (not post-processing):

> "nestled", "mouthwatering", "culinary journey", "hidden treasure", "a must-visit", "boasts", "a treat for", "sure to delight", "whether you're", "if you're looking for", "look no further", "gem of a", "foodie", "elevated", "curated experience", "—", "Ah,", "Oh,", "gastronomic", "culinary", "transcend", "artisan", "artisanal", "delectable", "exquisite", "tantalizing", "delightful", "impeccable", "unparalleled", "diverse menu", "wide array", "burst of flavor", "hidden gem", "taste buds", "food lovers", "every bite", "must-visit", "something for everyone", "where tradition meets", "beckons", "invites you", "promises", "journey", "tapestry", "crafted with", "fusion of", "symphony of", "palette", "indulge", "savor every", "dining experience", "perfectly", "masterfully", "beautifully", "stunningly", "won't disappoint", "does not disappoint", "a feast for", "a true", "truly", "simply put", "in the heart of", "offers a", "provides a", "delivers a", "the perfect spot", "a perfect", "dining destination", "unforgettable", "remarkable", "exceptional dining", "when it comes to", "go-to spot", "ideal for", "the ultimate"

---

## 9. Fallback Chain

When things go wrong, the system degrades gracefully:

```
Claude JSON parse fails
  → Regex extraction of fields (restaurant_index, recommendation, etc.)
    → Falls back to buildV9FallbackResponse()
      → buildQueueBlurb() from DB fields
        → best_for_oneliner
          → "A top pick based on our match engine."
```

Closed restaurant handling: if the chosen restaurant has `business_status === "CLOSED_PERMANENTLY"`, the system picks the next candidate in the ranked queue and uses its blurb (or generates a fallback).

---

## 10. Caching

### In-Memory Cache

Stale-while-revalidate pattern:
- Soft TTL: 15 minutes (serve stale, flag for refresh)
- Hard TTL: 30 minutes (delete entry)
- Cache key: `occasion|neighborhood|price|normalized_request|exclude_list`
- Max 500 entries

### DondeCache (Persistent)

Three-level fuzzy matching with quality gate:
- **L1 (Exact):** Same cache key as in-memory (without exclude list)
- **L2 (Fingerprint):** Intent-based hash (cuisines + dish + vibes + constraints + context)
- **L3 (Canonical):** Signal-based canonical form with 60+ query synonyms + 50+ dish canonical mappings
- **Quality gate:** Only B-/80+ responses cached (CHECK constraints on score_fit_score and blurb_quality_score)
- **TTL:** 3 days (organic), 7 days (prewarm)
- **Invalidation:** DB triggers on restaurant/enrichment changes; engine version check; TTL expiry
- **Try Another:** Cached `ranked_queue` used for exclude-list lookups without recomputing
- **Google compliance:** `photo_urls`, `opening_hours`, `review_snippets` nulled in cached responses

Claude-generated blurbs are cached as part of the full response. No separate blurb cache.

---

## Key Files

| File | Role |
|------|------|
| `supabase/functions/recommend/index.ts` | Main orchestrator — E2E request flow |
| `supabase/functions/recommend/_shared/prompts-v5.ts` | System prompt, user prompt, blurb-only prompt, sentiment prompt |
| `supabase/functions/recommend/_shared/claude.ts` | Claude API client with retry logic and JSON parsing |
| `supabase/functions/recommend/_shared/response-builder-v9.ts` | Response assembly, queue blurb templates, fallback responses |
| `supabase/functions/recommend/_shared/scoring-v9.ts` | V9 scoring engine + match narrative generation |
| `supabase/functions/recommend/_shared/types-v9.ts` | TypeScript types for scoring, narratives, Claude output |
| `supabase/functions/recommend/_shared/grading.ts` | Server-side score fit + blurb quality grading |
| `supabase/functions/recommend/_shared/query-cache.ts` | DondeCache — persistent 3-level cache with fuzzy matching |
| `supabase/functions/recommend/_shared/google-places.ts` | Live Google Places enrichment |
