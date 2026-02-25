# Donde Match V3.0 — Scoring Engine Design Document

> Five human-intuitive factors. One confidence score. The definitive guide to how DondeAI matches restaurants to cravings.

---

## 1. Executive Summary

**Donde Match** is the confidence score (0–99) displayed to users that answers: **"How well does this restaurant fit what you asked for?"**

V3 replaces V2's five abstract dimensions (Occasion Fit, Craving Match, Vibe Alignment, Practical Fit, Discovery Value) with **five human-intuitive factors** that mirror how people actually evaluate restaurants:

| Factor | What It Answers | Range |
|--------|----------------|-------|
| **Food Match** | "Does this serve what I'm craving?" | 0–10 |
| **Setting Fit** | "Is this the right place for my occasion?" | 0–10 |
| **Atmosphere** | "Will the vibe feel right?" | 0–10 |
| **Reputation** | "Is this place actually good?" | 0–10 |
| **Convenience** | "Can I realistically go here tonight?" | 0–10 |

The weighted composite of these five factors maps directly to the 0–99 Donde Match score.

### Design Philosophy

> **"High score = best match. If nothing hits 80+, something is off."**

V3 principles:
1. **Full truth** — Scores range 0–99 with no artificial floor. A 15% match is genuinely bad.
2. **Factor independence** — Each factor scores 0–10 using only its own data. No cross-contamination.
3. **Integrated signals** — Google data feeds into Reputation; Claude relevance is a small nudge (±0.5). No separate overlay layers.
4. **Data completeness awareness** — Each factor tracks how much data was available. Missing data defaults to neutral, never penalizes.
5. **Human-intuitive naming** — Factors use language a diner would use, not ML jargon.

### V3 vs V2 — Key Changes

| Aspect | V2 | V3 |
|--------|----|----|
| **Factors** | Occasion Fit, Craving Match, Vibe Alignment, Practical Fit, Discovery Value | Food Match, Setting Fit, Atmosphere, Reputation, Convenience |
| **Score range** | 45–99% (artificial floor) | 0–99 (full range) |
| **Mapping** | `45 + composite × 5.4` | `Math.round(raw × 10)` |
| **Google data** | Separate 10% overlay | Integrated in Reputation factor |
| **Claude relevance** | Separate 15% overlay | ±0.5 modulation on Food + Setting |
| **Cuisine mismatch penalty** | Multiplicative (×0.55 / ×0.75) | Handled by Food Match factor (0 pts for mismatch) |
| **Default weights** | 25/25/20/15/15 | 30/25/20/15/10 |
| **Data completeness** | Enrichment confidence gating only | Per-factor dataPoints/maxDataPoints tracking |

### High-Level Pipeline

```mermaid
flowchart LR
    subgraph "User Input"
        UI["Craving + Occasion\n+ Neighborhood + Price\n+ Dietary + Feedback"]
    end

    subgraph "Phase 1"
        IC["Intent\nClassification\n(Claude Haiku)"]
    end

    subgraph "Phase 2"
        RPC["Server Pre-Rank\n(PostgreSQL RPC)\n~400 → 15"]
    end

    subgraph "Phase 3"
        RERANK["Client Re-Rank\n(V3 5-Factor Scoring)\n15 → Top 10"]
    end

    subgraph "Phase 4"
        CLAUDE["Claude\nRecommendation\n+ Sentiment"]
        GOOGLE["Google\nPlace Details"]
    end

    subgraph "Phase 5"
        MATCH["Donde Match\nScore (0-99)"]
    end

    UI --> IC
    UI --> RPC
    IC -.->|"structured signals"| RERANK
    RPC -->|"15 candidates"| RERANK
    RERANK -->|"top 10"| CLAUDE
    RERANK -->|"top 3-5"| GOOGLE
    CLAUDE -->|"relevance_score\nsentiment"| MATCH
    GOOGLE -->|"rating\nreview_count"| MATCH
    RERANK -->|"base factors"| MATCH
    MATCH -->|"Final Result"| RESP["Restaurant +\nDonde Match %\n+ Recommendation"]
```

### Score Tiers

| Range | Tier | Meaning |
|-------|------|---------|
| 90–99 | Perfect Match | Near-perfect fit across all factors |
| 80–89 | Great Match | Strong alignment with minor trade-offs |
| 65–79 | Good Match | Solid choice, some factors less ideal |
| 45–64 | Fair Match | Partial fit — has appeal but clear gaps |
| 25–44 | Stretch | Significant mismatches on key factors |
| 0–24 | Poor Match | Fundamental incompatibility |

---

## 2. End-to-End Process Flow

```mermaid
sequenceDiagram
    participant U as User (SPA)
    participant EF as Edge Function
    participant DB as PostgreSQL
    participant CI as Claude (Intent)
    participant CR as Claude (Recommend)
    participant G as Google Places

    U->>EF: POST /recommend<br/>{special_request, occasion, neighborhood,<br/>price_level, dietary, exclude[], user_id}

    Note over EF: Validate & sanitize inputs

    par Phase 1 + 2 (Parallel)
        EF->>CI: Classify intent<br/>"cozy ramen with killer sake"
        CI-->>EF: {target_cuisines: ["Japanese"],<br/>cuisine_importance: "high",<br/>flavor_preferences: ["umami-forward"],<br/>vibe_keywords: ["cozy"],<br/>emotional_intent: "comfort"}
    and
        EF->>DB: RPC get_ranked_restaurants<br/>(neighborhood, price, occasion, limit=15+exclude)
        DB-->>EF: 15 ranked RestaurantProfiles
    and
        EF->>DB: Resolve user feedback<br/>(liked/disliked cuisines & restaurants)
        DB-->>EF: UserFeedbackSignals
    end

    Note over EF: Phase 2b: Intent re-query if needed

    Note over EF: Phase 3: Deal-breaker gates →<br/>reRankV3() → Diversity filter → Top 10

    par Phase 4 (Parallel)
        EF->>CR: Recommend from top 10<br/>(profiles + request + reviews)
        CR-->>EF: {restaurant_index, recommendation,<br/>relevance_score, sentiment}
    and
        EF->>G: Place Details for top 3-5
        G-->>EF: GooglePlaceData × 3-5
    end

    Note over EF: Phase 5: computeV3DondeMatch()<br/>= 5 factors × weights<br/>+ Claude modulation<br/>+ deal-breaker penalties<br/>+ personalization → 0-99

    EF-->>U: {restaurant, recommendation,<br/>donde_match: 87, factors, tags}

    EF-)DB: INSERT user_queries (fire-and-forget)
```

---

## 3. Phase 1 — Intent Classification

**When:** Runs in parallel with the RPC query (adds no latency to critical path)
**Model:** Claude Haiku 4.5
**Latency:** 200–400ms

The intent classifier converts a free-text `special_request` like _"cozy ramen with killer sake"_ into structured search signals.

### Intent Fields

| Field | Type | Example | Used By |
|-------|------|---------|---------|
| `target_cuisines` | string[] | `["Japanese"]` | Food Match, RPC re-query |
| `cuisine_importance` | high / medium / low | `"high"` | Dynamic weights, penalties |
| `target_tags` | string[] | `["craft cocktails"]` | Atmosphere |
| `target_features` | string[] | `["outdoor_seating"]` | Atmosphere |
| `flavor_preferences` | string[] | `["umami-forward"]` | Food Match |
| `vibe_keywords` | string[] | `["cozy"]` | Atmosphere |
| `practical_constraints` | string[] | `["walk-in"]` | Convenience |
| `emotional_intent` | string | `"comfort"` | Dynamic weights |
| `date_type` | string \| null | `"first_date"` | Setting Fit |
| `group_size_hint` | string \| null | `"couple"` | Setting Fit |
| `spontaneity` | planned / spontaneous / unknown | `"spontaneous"` | Convenience |

### Cuisine Importance Downstream Impact

```mermaid
flowchart TD
    CI{cuisine_importance}

    CI -->|"high"| H["Weight shift: Food 45%\nRPC re-query if cuisine missing\nCuisine penalty candidate active"]

    CI -->|"medium"| M["Weight shift: Food 35%\nNo re-query\nMild cuisine penalty candidate"]

    CI -->|"low"| L["Weight shift: Atmosphere 30%, Convenience 20%\nNo re-query\nNo cuisine penalty"]
```

> **Source:** `intent-classifier.ts`, `scoring-v3.ts:881-930`

---

## 4. Phase 2 — Server-Side Pre-Ranking (RPC)

A single PostgreSQL RPC call (`get_ranked_restaurants`) performs server-side JOINs, filtering, and sorting.

### Filter → Sort → Limit

```mermaid
flowchart TD
    ALL["~400+ restaurants"]
    ALL --> F1{"Neighborhood"}
    F1 -->|"Anywhere"| F2
    F1 -->|"Specific"| FILT1["Keep matching"] --> F2
    F2{"Price level"}
    F2 -->|"Any"| F3
    F2 -->|"Specific"| FILT2["Keep matching"] --> F3
    F3{"Active + enriched"}
    F3 --> FILT3["noise_level IS NOT NULL\nis_active = true"]
    FILT3 --> SORT["Sort: occasion_score DESC\n→ total_score DESC\n→ random() tiebreaker"]
    SORT --> LIM["LIMIT 15 + len(exclude)"]
    LIM --> OUT["15–20 RestaurantProfiles"]
```

### Relaxation Cascades

When initial results are empty:
1. Re-query with `p_target_cuisine` if high-importance cuisine missing
2. Retry with "Any" price
3. Retry with "Anywhere" + "Any" price
4. Fallback: 4 legacy queries + mergeProfiles()

> **Source:** `index.ts:262-366`

---

## 5. Phase 3 — Client-Side Re-Ranking

### Re-Ranking Pipeline

```mermaid
flowchart TD
    RPC["15 RPC results"]
    RPC --> GATES["Deal-Breaker Gates\n(applyDealBreakerGates)"]
    GATES --> EXCLUDED["Remove excluded IDs"]
    EXCLUDED --> DIETARY{"Dietary\nhard block?"}
    DIETARY -->|"Complete mismatch\n(no hierarchy match)"| BLOCK["Gated out"]
    DIETARY -->|"Pass / partial"| PASSED
    PASSED["Passed candidates"]
    PASSED --> RANK["reRankV3()\n5-factor scoring\n(without Google data)"]
    RANK --> DIVERSE["Diversity filter\n(max per cuisine/neighborhood)\nBackfill from overflow"]
    DIVERSE --> TOP10["Final Top 10"]
```

### Deal-Breaker Gates

Pre-scoring hard filters that remove candidates before any factor computation:

| Gate | Trigger | Result |
|------|---------|--------|
| **Excluded IDs** | Restaurant ID in `exclude[]` | Removed |
| **Dietary hard block** | All dietary restrictions fail AND no hierarchy match | Removed |

Note: Dietary gate only blocks when there is NO match at all. Partial matches (e.g., Vegan user at Vegetarian restaurant) pass through — the Food Match factor handles the scoring nuance.

### Ranking-Time Scoring

During re-ranking, `reRankV3()` computes V3 factors with these limitations:
- `googleData: null` (not available yet)
- `neighborhood: "Anywhere"` (don't penalize — pre-filter handled this)
- `priceLevel: "Any"` (don't penalize — pre-filter handled this)

This means the ranking is driven by Food Match, Setting Fit, Atmosphere, and Convenience — with Reputation using neutral defaults for Google data.

### Diversity Filter

After scoring, `ensureDiversity()` ensures variety:
- Top 3 always preserved (Google data pre-fetched)
- Max 5 per cuisine type
- Max 7 per neighborhood
- Backfill from overflow pool to maintain 10 candidates

> **Source:** `scoring-v3.ts:1170-1199`, `scoring.ts:2280-2341`

---

## 6. Phase 4 — Claude Recommendation + Google Data

### Parallel Execution

```mermaid
flowchart LR
    TOP10["Top 10 ranked"]
    TOP10 --> CLAUDE["Claude Haiku 4.5\nPick best + write rec\n+ sentiment analysis"]
    TOP10 --> GOOGLE["Google Places API\nTop 3-5 details"]
    CLAUDE --> MERGE["Merge"]
    GOOGLE --> MERGE
    MERGE --> RESULT["Chosen restaurant\n+ recommendation\n+ relevance_score\n+ sentiment + Google data"]
```

### Claude Output

| Field | Type | Feeds Into |
|-------|------|-----------|
| `restaurant_index` | 0–9 | Which restaurant Claude picks |
| `recommendation` | string | User-facing blurb |
| `insider_tip` | string | Actionable tip |
| `relevance_score` | 0–10 | V3 Claude modulation (±0.5) |
| `sentiment_score` | 0–10 | Reputation factor |
| `sentiment_breakdown` | string | UI display |

### Google Output

| Field | Feeds Into |
|-------|-----------|
| `google_rating` (1–5) | Reputation factor (normalized to 0–4) |
| `google_review_count` | Reputation factor (confidence multiplier) |
| `reviews[]` | Claude sentiment analysis |

> **Source:** `index.ts`, `claude.ts`, `google-places.ts`

---

## 7. Phase 5 — V3 Donde Match Score

The core of V3. Each restaurant is evaluated across 5 independent factors, combined with dynamic weights, then adjusted by penalties and personalization.

### Computation Flow

```mermaid
flowchart TD
    subgraph "Step 1: Compute 5 Factors (0-10 each)"
        F1["Food Match\nCuisine + flavor + dietary\n+ menu interest"]
        F2["Setting Fit\nOccasion base + service style\n+ pacing + social dynamics"]
        F3["Atmosphere\nNoise + lighting + energy\n+ music + vibe + aesthetics"]
        F4["Reputation\nGoogle rating + sentiment\n+ awards + community"]
        F5["Convenience\nTiming + reservation\n+ wait + payment + parking"]
    end

    subgraph "Step 2: Enrichment Confidence Gating"
        ECG["If confidence < 5:\nFood & Atmosphere dampened\nformula: 0.5 + (conf/10) × 0.5"]
    end

    subgraph "Step 3: Dynamic Weights"
        DW["computeV3Weights()\nAdjusted by occasion +\ncuisine_importance +\nemotional_intent\nNormalized to sum = 1.0"]
    end

    subgraph "Step 4: Weighted Composite"
        COMP["raw = F×W.food + S×W.setting\n+ A×W.atmosphere + R×W.reputation\n+ C×W.convenience"]
    end

    subgraph "Step 5: Claude Modulation"
        CM["If relevance_score available:\nadjust = (relevance - 5) × 0.1\nFood += adjust, Setting += adjust\nRecompute raw"]
    end

    subgraph "Step 6: Deal-Breaker Penalties"
        DBP["Price mismatch: ×0.5 to -0.5\nNeighborhood mismatch: -1.0\nSentiment crisis: up to -2.0"]
    end

    subgraph "Step 7: Personalization"
        PERS["Liked cuisine: +0.3\nDisliked cuisine: -1.0\nDisliked restaurant: -2.5\nAvoided cuisine: -2.0\nAvoided price: -1.5"]
    end

    subgraph "Step 8: Final Mapping"
        MAP["dondeMatch = round(raw × 10)\nClamped to 0-99"]
    end

    F1 & F2 & F3 & F4 & F5 --> ECG --> DW
    DW --> COMP --> CM --> DBP --> PERS --> MAP
```

---

## 8. Factor 1: Food Match (0–10)

**Question answered:** "Does this serve what I'm craving?"

Food Match uses 4 scoring layers, normalized to a 0–10 scale from a raw maximum of 10 points.

### Scoring Layers

```mermaid
flowchart TD
    subgraph "Layer 1: Cuisine Alignment (0-5 pts)"
        CA["target_cuisines from intent"]
        CA -->|"Exact match"| E5["5 pts\n('Japanese' = 'Japanese')"]
        CA -->|"Contains match"| E45["4.5 pts\n('Modern Indian' contains 'Indian')"]
        CA -->|"Subcategory match"| E4["4 pts\n(cuisine_subcategory matches)"]
        CA -->|"Related cuisine"| E3["3 pts\n(Same family: Greek/Italian = Mediterranean)"]
        CA -->|"No match"| E0["0 pts"]
        CA -->|"No cuisine requested"| E3B["3 pts (baseline)"]
    end

    subgraph "Layer 2: Flavor Profile (0-2 pts)"
        FP["intent.flavor_preferences\nvs deep_profile.flavor_profiles"]
        FP --> FPC["0.7 pts per overlap\nmax 2 pts"]
    end

    subgraph "Layer 3: Dietary Fit (0-2 pts)"
        DF["dietary_restrictions"]
        DF -->|"dedicated depth"| D2["2 pts"]
        DF -->|"solid depth"| D15["1.5 pts"]
        DF -->|"token depth"| D05["0.5 pts"]
        DF -->|"match via options"| D1["1 pt"]
        DF -->|"partial match"| DP5["0.5 pts"]
        DF -->|"no restriction"| DN["1 pt (default pass)"]
    end

    subgraph "Layer 4: Menu Interest (0-1 pt)"
        MI["signature_dishes vs request words"]
        MI -->|"dish word match"| M1["1 pt"]
        MI -->|"food tag match"| MT5["0.5 pts"]
        MI -->|"no match"| M0["0 pts"]
    end

    E5 & FPC & D2 & M1 --> NORM["Normalize: (score/10) × 10\n= direct pass-through"]
```

### Cuisine Family Relationships

For "related cuisine" partial credit (3 points):

| Family | Cuisines |
|--------|----------|
| Mediterranean | Greek, Italian, Middle Eastern |
| East Asian | Japanese, Chinese, Korean |
| Southeast Asian | Thai, Vietnamese |
| Latin American | Mexican, Peruvian, Brazilian, Puerto Rican |
| South Asian | Indian |

### Special Rules

| Condition | Effect |
|-----------|--------|
| No `cuisine_type` + cuisine requested | Cap at 4 |
| No food intent (`target_cuisines` empty + `cuisine_importance` = "low") | Floor at 5 |
| No `special_request` (empty/short) | Floor at 5 |

### Flavor Keyword Extraction

When `flavor_preferences` is not available from intent, V3 extracts from `special_request`:

| Keyword | Maps To |
|---------|---------|
| smoky | smoky, charred, grilled, wood-fired |
| spicy | bold-spiced, chili-forward, fiery |
| fresh | bright-acidic, herbaceous, citrus-forward, light |
| rich | umami-forward, rich-buttery, creamy, decadent |
| sweet | sweet-savory, caramelized, honey-glazed |
| tangy | fermented, pickled, vinegar-bright, bright-acidic |
| earthy | earthy, mushroom, truffle, root-vegetable |
| savory | umami-forward, savory, meaty |

> **Source:** `scoring-v3.ts:239-382`

---

## 9. Factor 2: Setting Fit (0–10)

**Question answered:** "Is this the right type of place for my occasion?"

### Scoring Layers

#### Layer 1: Occasion Base Score (0–7 points)

Computed from DB occasion scores using the same weighted blending as V2:

| Occasion | Formula |
|----------|---------|
| Date Night | 100% `date_friendly_score` |
| Group Hangout | 100% `group_friendly_score` |
| Family Dinner | 100% `family_friendly_score` |
| Business Lunch | 100% `business_lunch_score` |
| Solo Dining | 100% `solo_dining_score` |
| Special Occasion | 70% `romantic_rating` + 30% `date_friendly_score` |
| Treat Myself | 50% `solo_dining_score` + 30% `romantic_rating` + 20% `hole_in_wall_factor` |
| Adventure | 60% `hole_in_wall_factor` + 20% `group_friendly_score` + 20% `solo_dining_score` |
| Chill Hangout | 60% `group_friendly_score` + 30% `solo_dining_score` + 10% `hole_in_wall_factor` |
| Any | Average of all 7 scores / 70 × 10 |

Formula: `(occasionBase / 10) × 7` — maps the 0–10 DB score to a 0–7 contribution.

#### Layer 2: Service Style Alignment (−0.5 to +1.5)

| Occasion | Ideal Styles | Clashing Styles |
|----------|-------------|----------------|
| Business Lunch | Full Table Service | Counter, Fast Casual |
| Date Night | Full Table Service, Omakase, Tasting Menu, Bar Service | Fast Casual |
| Group Hangout | Full Table Service, Family Style, Fast Casual, Bar Service | Omakase |
| Family Dinner | Full Table Service, Family Style | — |
| Solo Dining | Counter, Bar Service, Fast Casual, Full Table Service | — |
| Special Occasion | Tasting Menu, Omakase, Full Table Service | Fast Casual, Counter |
| Treat Myself | Full Table Service, Omakase, Tasting Menu, Counter | — |
| Adventure | Counter, Family Style, Omakase, Full Table Service | — |
| Chill Hangout | Full Table Service, Bar Service, Fast Casual | — |

- Ideal match: **+1.5**
- Clashing match: **−0.5**

#### Layer 3: Pacing & Social Dynamics (0–1.5 max, −1.0 min)

| Signal | Points | Condition |
|--------|--------|-----------|
| Meal pacing fit | +0.5 | Pacing matches occasion ideal |
| Kid friendliness ≥7 | +0.75 | Family Dinner |
| Kid friendliness 5–6 | +0.25 | Family Dinner |
| Conversation friendliness ≥7 | +0.5 | Date Night / Business Lunch / Special Occasion |
| Group size mismatch | −1.0 | Large group + sweet spot max ≤6 |
| Date progression match | +0.5 | `date_progression` includes `date_type` |

### Pacing Expectations

| Occasion | Ideal Pacing |
|----------|-------------|
| Business Lunch | quick_bite, relaxed |
| Date Night | relaxed, leisurely |
| Special Occasion | leisurely, ceremonial |
| Solo Dining | quick_bite, relaxed |
| Adventure | quick_bite, relaxed, ceremonial |
| Family Dinner | relaxed |

> **Source:** `scoring-v3.ts:388-487`

---

## 10. Factor 3: Atmosphere (0–10)

**Question answered:** "Will the vibe feel right?"

Atmosphere is the most signal-dense factor, pulling from 10+ data sources across 3 layers.

### Layer 1: Basic Ambiance (0–4 points)

**Noise Match (0–1.5):**

| Occasion | Acceptable Noise |
|----------|-----------------|
| Date Night | Quiet, Moderate |
| Group Hangout | Moderate, Loud |
| Family Dinner | Quiet, Moderate |
| Business Lunch | Quiet |
| Solo Dining | Quiet, Moderate |
| Special Occasion | Quiet |
| Adventure | Moderate, Loud, Quiet |

- Match: **1.5 pts** | No match: **0.5 pts** | Missing data: **0.5 pts**

**Lighting Match (0–1.5):**

| Occasion | Expected Lighting |
|----------|------------------|
| Date Night | dim, intimate, warm, candlelit, romantic |
| Group Hangout | bright, lively, modern, warm, vibrant |
| Business Lunch | bright, modern, warm, elegant |
| Special Occasion | dim, intimate, elegant, warm, candlelit |
| Adventure | _(any)_ |

- Points: `min(1.5, keywordMatches × 0.75)` | No expectation: **0.75** | Missing: **0.5**

**Dress Code (0–1):**

| Occasion | Minimum Dress |
|----------|--------------|
| Date Night | Smart Casual |
| Business Lunch | Business Casual |
| Special Occasion | Smart Casual |
| All others | Casual |

- Meets minimum: **1 pt** | Below: **0.5 pts** | Missing: **0.5 pts**

### Layer 2: Energy & Music (0–3 points)

**Energy Level (0–1.5):**

| Occasion | Ideal Range |
|----------|------------|
| Date Night | 4–7 |
| Group Hangout | 6–9 |
| Family Dinner | 3–6 |
| Business Lunch | 2–5 |
| Solo Dining | 2–6 |
| Special Occasion | 4–7 |
| Adventure | 4–10 |
| Chill Hangout | 3–6 |

- In range: **1.5 pts** | Out of range: `max(0, 1.5 − |energy − midpoint| × 0.3)`

**Music Vibe (0–1):**

| Occasion | Fitting Music |
|----------|--------------|
| Date Night | live-jazz, curated-playlist, ambient |
| Business Lunch | ambient, no-music |
| Group Hangout | curated-playlist, DJ, live-jazz, live-band |
| Special Occasion | live-jazz, curated-playlist, ambient |
| Solo Dining | ambient, curated-playlist |
| Treat Myself | curated-playlist, live-jazz |
| Adventure | curated-playlist, live-band, DJ |
| Chill Hangout | ambient, curated-playlist |
| Family Dinner | ambient, no-music |

**Vibe Keyword Matching (0–1.5):**

Maps user's `vibe_keywords` against restaurant data:
- `decor_style` string matching
- `music_vibe` string matching
- Energy range mapping (e.g., "intimate" = energy 2–5, "buzzing" = 7–10)

Points: `min(1.5, hits × 0.5)`

### Layer 3: Request-Driven Signals (variable)

These only contribute when the user's request mentions them:

| Request Signal | Match | Points |
|---------------|-------|--------|
| Live music / entertainment | `live_music=true` | +1.5 |
| Live music / entertainment | Music vibe has "live" | +1.0 |
| Live music / entertainment | Tag matches "live music/band/jazz" | +1.0 |
| Specific music style (jazz, acoustic, blues) | `music_vibe` matches | +1.0 |
| Outdoor / patio / al fresco | `outdoor_seating=true` | +1.0 |
| View / scenic / rooftop | Matching tag | +1.0 |
| Seasonal relevance | Season score ≥7 | +0.5 |
| Instagram / aesthetic | `instagram_worthiness` ≥8 | +1.0 |

> **Source:** `scoring-v3.ts:493-674`

---

## 11. Factor 4: Reputation (0–10)

**Question answered:** "Is this place actually good?"

Reputation is the only factor that integrates **live external data** (Google ratings, review sentiment). It uses 4 scoring layers.

### Layer 1: Google Rating (0–4 points)

```
normalized = (google_rating − 2.5) × 1.6     // Stretch 2.5-5.0 → 0-4
confidence = reviewCount ≥ 200 → 1.0
           | reviewCount ≥ 50  → 0.9
           | reviewCount ≥ 10  → 0.8
           | reviewCount < 10  → 0.7
score = min(4, max(0, normalized × confidence))
```

**No Google data:** 2.0 pts (neutral — absence of evidence is not evidence of absence)

### Layer 2: Sentiment from Reviews (0–2 points)

```
score = (sentimentScore / 10) × 2    // 0-10 sentiment → 0-2
```

If `sentimentNegative > 30%`:
```
penalty = min(1.5, ((negPercent − 30) / 40) × 1.5)
score -= penalty
```

**No sentiment data:** 1.0 pt (neutral)

### Layer 3: Awards & Recognition (0–2 points)

| Signal | Points |
|--------|--------|
| Awards/recognition present | +1.0 |
| Chef notable | +0.5 |
| Cultural authenticity ≥8 | +0.5 |
| **No awards data** | **0.5** (neutral) |

### Layer 4: Community Standing (0–2 points)

| Signal | Points |
|--------|--------|
| `neighborhood_integration` = "institution" | +1.5 |
| `neighborhood_integration` = "destination" | +1.0 |
| `neighborhood_integration` = "hidden_local" | +0.5 |
| `trending_score` ≥7 | +0.5 |
| **No community data** | **0.5** (neutral) |

> **Source:** `scoring-v3.ts:680-785`

---

## 12. Factor 5: Convenience (0–10)

**Question answered:** "Can I realistically go here tonight?"

Convenience starts at **5 (neutral)** and adjusts up/down based on practical signals. This "innocent until proven inconvenient" approach ensures missing data doesn't penalize.

### Layer 1: Timing Fit (−2 to +1.5)

| Condition | Effect |
|-----------|--------|
| `best_times` includes current time_of_day | +1.5 |
| `best_times` is narrow (≤2) AND doesn't match | −2.0 |
| `best_times` doesn't match (broad restaurant) | −0.5 |

### Layer 2: Reservation Accessibility (−3 to +1.5)

| Condition | Effect |
|-----------|--------|
| `reservation_difficulty` = "hard_to_get" + spontaneous request | −3.0 |
| `reservation_difficulty` = "walk_in_friendly" + spontaneous | +1.5 |
| `reservation_difficulty` = "walk_in_friendly" + planned | +0.5 |

Spontaneous detected from: intent `spontaneity` field OR request words like "tonight", "right now", "walk-in", "last minute"

### Layer 3: Wait Time

| Condition | Effect |
|-----------|--------|
| `typical_wait_minutes` > 60 | −1.5 |
| `typical_wait_minutes` > 30 | −0.5 |
| `typical_wait_minutes` ≤ 30 | +0.5 |

### Layer 4: Practical Notes

| Signal | Effect |
|--------|--------|
| Cash-only payment | −0.5 |
| BYOB requested + BYOB available | +1.5 |
| Parking available (not "none") | +0.5 |

> **Source:** `scoring-v3.ts:791-875`

---

## 13. Dynamic Weight System

Weights determine how much each factor contributes to the final composite. They shift dynamically based on context.

### Default Weights

```
Food:        30%
Setting:     25%
Atmosphere:  20%
Reputation:  15%
Convenience: 10%
```

### By Cuisine Importance

| Importance | Food | Setting | Atmosphere | Reputation | Convenience |
|-----------|------|---------|------------|------------|-------------|
| **High** (explicit cuisine) | **45%** | 15% | 15% | 15% | 10% |
| **Medium** (implied cuisine) | **35%** | 20% | 20% | 15% | 10% |
| **Low** (experience query) | 15% | 20% | **30%** | 15% | **20%** |

### By Occasion (when cuisine_importance ≠ "high")

| Occasion | Food | Setting | Atmosphere | Reputation | Convenience |
|----------|------|---------|------------|------------|-------------|
| Date Night / Special Occasion | 20% | **30%** | **25%** | 15% | 10% |
| Adventure | 25% | 15% | 20% | **25%** | 15% |
| Family Dinner | 25% | 25% | 15% | 15% | **20%** |
| Business Lunch | 20% | **30%** | **25%** | 15% | 10% |

### By Emotional Intent (fine-tuning)

| Intent | Effect |
|--------|--------|
| `explore` | Reputation +5%, Food −5% |
| `comfort` | Atmosphere +5%, Reputation −5% |
| `impress` | Reputation +5%, Convenience −5% |

**All weights are normalized to sum to 1.0** after all adjustments.

```mermaid
flowchart TD
    BASE["Default: 30/25/20/15/10"]
    BASE --> CI{"cuisine_importance"}
    CI -->|"high"| HIGH["45/15/15/15/10"]
    CI -->|"medium"| MED["35/20/20/15/10"]
    CI -->|"low"| LOW["15/20/30/15/20"]
    MED -->|"!= high"| OCC{"Occasion?"}
    LOW -->|"!= high"| OCC
    OCC -->|"Date Night\nSpecial Occasion\nBusiness Lunch"| VIBE["20/30/25/15/10"]
    OCC -->|"Adventure"| ADV["25/15/20/25/15"]
    OCC -->|"Family Dinner"| FAM["25/25/15/15/20"]
    HIGH & MED & LOW & VIBE & ADV & FAM --> EI{"emotional_intent?"}
    EI -->|"explore"| EEXP["Rep +5%, Food −5%"]
    EI -->|"comfort"| ECOM["Atm +5%, Rep −5%"]
    EI -->|"impress"| EIMP["Rep +5%, Conv −5%"]
    EI -->|"other"| NORM
    EEXP & ECOM & EIMP --> NORM["Normalize to Σ=1.0"]
```

> **Source:** `scoring-v3.ts:881-930`

---

## 14. Enrichment Confidence Gating

When a restaurant's deep profile has low confidence (`enrichment_confidence < 5`), V3 dampens the factors that rely most heavily on deep profile data:

```
confidenceFactor = enrichment_confidence / 10    // e.g., 0.3 for confidence=3

Food:       score × (0.5 + confidenceFactor × 0.5)    // Dampened
Setting:    score (unchanged — uses DB occasion scores)
Atmosphere: score × (0.5 + confidenceFactor × 0.5)    // Dampened
Reputation: score (unchanged — uses Google data)
Convenience: score (unchanged — uses DB + intent)
```

This ensures that unreliable enrichment data doesn't produce false confidence. At confidence=0, Food and Atmosphere are halved. At confidence≥5, no dampening occurs.

> **Source:** `scoring-v3.ts:1107-1118`

---

## 15. Claude Relevance Modulation

After computing the weighted composite, V3 applies a **small** modulation based on Claude's independent assessment:

```
adjust = (claudeRelevance − 5) × 0.1    // Range: −0.5 to +0.5

factors.food    += adjust
factors.setting += adjust

// Recompute raw composite with adjusted factors
raw = recompute(factors, weights)
```

**Design rationale:** Claude's relevance_score (0–10) reflects its holistic assessment of fit. A score of 8 adds +0.3, a score of 3 subtracts −0.2. The modulation is intentionally small because:
1. Claude already influences the system by picking which restaurant to recommend
2. Double-counting AI judgment would create circular dependency
3. The deterministic factor scores should dominate

> **Source:** `scoring-v3.ts:1131-1141`

---

## 16. Deal-Breaker Penalties

Applied after the composite is computed, these penalties address hard requirement mismatches that the factor system doesn't fully capture.

### Price Mismatch

| Gap | Penalty | Example |
|-----|---------|---------|
| 3+ tiers over-budget | `composite × 0.5` | Asked for $, got $$$$ |
| 2 tiers over-budget | `composite × 0.7` | Asked for $, got $$$ |
| 1 tier over-budget | `composite − 0.5` | Asked for $$, got $$$ |
| 1 tier under-budget | `composite − 0.2` | Asked for $$$, got $$ |

### Neighborhood Mismatch

When relaxation cascade expands beyond the requested neighborhood:
```
composite -= 1.0
```

### Sentiment Crisis

When negative review percentage exceeds 40%:
```
penalty = min(2.0, ((negPercent − 40) / 30) × 2.0)
composite -= penalty
```

### Cuisine Mismatch — Design Note

V3 **removed** the V2 cuisine mismatch penalty (×0.55 / ×0.75) from deal-breaker penalties. The reasoning: Food Match factor already scores 0 points for complete mismatch, which naturally reduces the composite. Adding a separate multiplicative penalty double-counted the miss.

However, test results show that non-food factors (Setting, Atmosphere, Reputation) can push a cuisine-mismatched restaurant to 83–89%, which may feel misleading when a user explicitly asked for sushi and got Italian.

**See Section 18: Cuisine Mismatch Penalty Candidates** for three proposed models under evaluation.

> **Source:** `scoring-v3.ts:994-1035`

---

## 17. Personalization Layer

The final adjustment before score mapping incorporates user history:

### User Feedback Signals

| Signal | Effect |
|--------|--------|
| User previously liked this cuisine type | +0.3 |
| User previously disliked this cuisine type | −1.0 |
| User previously disliked this specific restaurant | −2.5 |

### Rejection Pattern Analysis

Analyzed from the `exclude[]` list (restaurants the user rejected via "Try Another"):

| Pattern | Effect |
|---------|--------|
| Same cuisine rejected 2+ times | −2.0 |
| Same price level rejected 2+ times | −1.5 |

> **Source:** `scoring-v3.ts:1041-1073`

---

## 18. Cuisine Mismatch Penalty Candidates

Three models are under evaluation. The test harness runs all three against cuisine mismatch scenarios to determine which best balances user expectations.

### Model A: No Penalty (Current V3)

The Food Match factor handles everything. A cuisine mismatch scores 0/5 in Layer 1, which reduces the Food Match factor, which reduces the composite through weighted multiplication.

**Pros:** Clean architecture, no double-counting
**Cons:** Non-food factors can push mismatched restaurants to 80%+ when Setting/Atmosphere/Reputation are strong

### Model B: Tiered Cap

When `cuisine_importance` = "high" and cuisine doesn't match, cap the final Donde Match:
- High importance + mismatch: **max 65%**
- Medium importance + mismatch: **max 80%**
- Low importance: no cap

**Pros:** Simple, predictable, directly addresses the "sushi → Italian at 89%" problem
**Cons:** Abrupt ceiling creates a cliff; restaurants at cap are undifferentiated

### Model C: Continuous Scaled Penalty

Apply a subtractive penalty to the raw composite based on importance:
- High importance + mismatch: **−2.5** from composite (≈ −25% on final score)
- Medium importance + mismatch: **−1.5** from composite (≈ −15% on final score)
- Low importance: no penalty

**Pros:** Smooth penalty, no cliff, proportional to importance level
**Cons:** Harder to reason about; interaction with other penalties may create unexpectedly low scores

### Decision Framework

The test harness evaluates each model against these scenarios:

| Scenario | Expected Behavior | Actual (Tested) |
|----------|-------------------|-----------------|
| "Best sushi" → Japanese restaurant | Score ≥75 (all models agree) | DM=69 (Food=7.7; weight spread limits ceiling) |
| "Best sushi" → Italian (great setting/vibe) | Model A: ~44, Model B: cap 44, Model C: ~19 | Model A=44, B=44, C=19 |
| "Fun lively spot" → any cuisine | Score reflects setting/vibe (all models agree) | DM=58 (Food floored at 5, Setting=6.2) |
| "Maybe fish?" → Steak restaurant | Model A: ~37, Model B: ~37, Model C: ~12 | Tested via T06: DM=37 |

---

## 19. Data Completeness Tracking

Each factor reports how many data points it used vs how many it could have used:

```typescript
interface V3FactorResult {
  score: number;        // 0-10
  dataPoints: number;   // How many data fields were available
  maxDataPoints: number; // How many data fields were checked
}
```

The overall data completeness is:
```
totalDataPoints / totalMaxDataPoints
```

This is returned in the response as `data_completeness` (0.0–1.0) and can be used by the UI to communicate confidence:
- ≥0.8: "High confidence" — most data available
- 0.5–0.79: "Moderate confidence" — some data missing
- <0.5: "Low confidence" — sparse data, score is more uncertain

---

## 20. Score Mapping

### Formula

```
dondeMatch = Math.min(99, Math.max(0, Math.round(raw × 10)))
```

Where `raw` is the final composite after all adjustments (0–10 scale).

Each composite point = **10 percentage points**. A restaurant scoring 7.2 across weighted factors maps to **72%**.

### Score Influence Breakdown

With default weights (30/25/20/15/10):

```
Food Match:    30%  of final score
Setting Fit:   25%  of final score
Atmosphere:    20%  of final score
Reputation:    15%  of final score
Convenience:   10%  of final score
```

After Claude modulation (±0.5) and deal-breaker penalties, the deterministic factor scores retain **~95%+ of influence** on the final number.

---

## 21. V3 Radar Chart Proposal

V3's five factors map naturally to a 5-axis radar chart for visual display.

### Design

```
                Food Match
                   /\
                  /  \
                 /    \
    Convenience /      \ Setting Fit
                \      /
                 \    /
                  \  /
                   \/
         Reputation  Atmosphere
```

### Axes

| Axis | Label | Position |
|------|-------|----------|
| Food Match | "Food" | Top (12 o'clock) |
| Setting Fit | "Setting" | Upper right (2 o'clock) |
| Atmosphere | "Vibe" | Lower right (4 o'clock) |
| Reputation | "Reputation" | Lower left (8 o'clock) |
| Convenience | "Convenience" | Upper left (10 o'clock) |

### Visual Encoding

- **Fill:** Theme accent color at 15% opacity
- **Stroke:** Theme accent color at 80% opacity
- **Scale:** 0–10 per axis (radial)
- **Data points:** Small dots at factor intersections
- **Labels:** Factor name + score (e.g., "Food 8.2")
- **Interaction:** Tap factor label to see scoring breakdown

### Comparison to V2 Petal Radar

| Aspect | V2 Petal Radar | V3 Radar |
|--------|---------------|----------|
| Axes | 6 (date, group, family, business, solo, gem) | 5 (food, setting, vibe, reputation, convenience) |
| Data source | Occasion scores from DB | Computed V3 factors |
| User meaning | "How good is this for different occasions" | "How well does this match YOUR request" |
| Shape | Teardrop petals | Standard polygon |

The V3 radar replaces the petal radar as the primary visualization. Occasion scores remain available in the response for backwards compatibility.

---

## 22. Appendix A — User Request Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `special_request` | Yes | string (max 500) | Free-text craving |
| `occasion` | Yes | string | One of 9 occasions or "Any" |
| `neighborhood` | Yes | string | One of 14 Chicago neighborhoods or "Anywhere" |
| `price_level` | Yes | string | "$", "$$", "$$$", "$$$$", or "Any" |
| `dietary_restrictions` | No | string[] | Vegan, Vegetarian, Gluten-Free, Halal |
| `exclude` | No | uuid[] | Previously rejected restaurant IDs |
| `user_id` | No | uuid | For feedback-based personalization |
| `time_of_day` | No | string | breakfast, lunch, dinner, late_night |
| `feedback` | No | object | `{restaurant_id, feedback: "like"|"dislike"}` |

---

## 23. Appendix B — Restaurant Scoring Attributes

**Core Fields:**
- 7 occasion scores (0-10): `date_friendly_score`, `group_friendly_score`, `family_friendly_score`, `romantic_rating`, `business_lunch_score`, `solo_dining_score`, `hole_in_wall_factor`
- `cuisine_type`, `price_level`, `noise_level`, `lighting_ambiance`, `dress_code`
- `outdoor_seating`, `live_music`, `pet_friendly`
- `dietary_options[]`, `good_for[]`, `ambiance[]`, `best_times[]`
- `tags[]`, `trending_score` (0-10)

**Deep Profile Fields (35 attributes):**
- **Food:** `flavor_profiles[]`, `signature_dishes[]`, `cuisine_subcategory`, `menu_depth`, `spice_level`, `dietary_depth`
- **Service:** `service_style`, `meal_pacing`, `reservation_difficulty`, `typical_wait_minutes`, `tipping_culture`
- **Atmosphere:** `energy_level`, `music_vibe`, `decor_style`, `conversation_friendliness`, `seating_options[]`
- **Social:** `group_size_sweet_spot`, `kid_friendliness`, `crowd_profile[]`
- **Discovery:** `wow_factors[]`, `chef_notable`, `awards_recognition[]`, `cultural_authenticity`, `origin_story`, `unique_selling_point`, `neighborhood_integration`
- **Practical:** `check_average_per_person`, `transit_accessibility`, `payment_notes`, `byob_policy`, `instagram_worthiness`
- **Temporal:** `seasonal_relevance{}`, `ideal_weather`
- **Meta:** `enrichment_confidence`, `date_progression`

---

## 24. Appendix C — V3 Response Fields

```json
{
  "success": true,
  "restaurant": { "..." },
  "recommendation": "string",
  "insider_tip": "string|null",
  "donde_match": 87,
  "scoring_v2": {
    "occasion_fit": 7.8,
    "craving_match": 9.1,
    "vibe_alignment": 8.3,
    "practical_fit": 7.5,
    "discovery_value": 6.9,
    "weights_used": { "food": 0.30, "setting": 0.25, "atmosphere": 0.20, "reputation": 0.15, "convenience": 0.10 }
  },
  "scores": { "date_friendly_score": "8", "..." },
  "deep_context": { "signature_dishes": [], "service_style": "Full Table Service", "..." },
  "tags": ["hidden gem", "craft cocktails"],
  "timestamp": "ISO"
}
```

Note: The `scoring_v2` field name is retained for API compatibility but contains V3 factor values mapped to V2 field names:
- `occasion_fit` ← V3 Setting Fit
- `craving_match` ← V3 Food Match
- `vibe_alignment` ← V3 Atmosphere
- `practical_fit` ← V3 Convenience
- `discovery_value` ← V3 Reputation

---

## 25. Appendix D — Key Source Files

| File | Lines | Purpose |
|------|-------|---------|
| `recommend/_shared/scoring-v3.ts` | ~1256 | V3 scoring engine (all 5 factors, weights, penalties) |
| `recommend/_shared/scoring.ts` | ~2671 | V1/V2 scoring + shared dictionaries (CUISINE_KEYWORDS, etc.) |
| `recommend/index.ts` | ~842 | Orchestrator: request → response |
| `recommend/_shared/intent-classifier.ts` | ~98 | Intent classification prompt & parsing |
| `recommend/_shared/response-builder.ts` | ~200 | Response JSON construction |
| `recommend/_shared/types.ts` | ~188 | TypeScript interfaces |
| `recommend/_shared/claude.ts` | ~60 | Anthropic API client |
| `recommend/_shared/google-places.ts` | ~100 | Google Places live fetch |
| `tests/scoring-v3-test.ts` | ~1489 | V3 scoring test harness (50 scenarios) |

---

## 26. Test Results Summary (50 Scenarios)

**Run date:** 2026-02-25 | **Result:** 50/50 PASSED (100%)

### Score Distribution

| Metric | Min | Max | Mean | Median |
|--------|-----|-----|------|--------|
| **Donde Match** | 0 | 81 | 50.2 | 54 |
| **Food Match** | 0.7 | 8.4 | 4.4 | 5.0 |
| **Setting Fit** | 1.4 | 8.8 | 5.6 | 5.4 |
| **Atmosphere** | 1.6 | 8.5 | 5.8 | 5.8 |
| **Reputation** | 1.5 | 9.5 | 5.3 | 5.1 |
| **Convenience** | 2.0 | 10.0 | 6.4 | 6.5 |

### Key Findings

1. **Cuisine mismatch is well-handled by Food factor alone.** With `cuisine_importance: "high"`, a complete mismatch yields Food=1.0, dragging DM to ~38–42 even when other factors are excellent (T05, T10). Model A (no separate penalty) already produces reasonable scores.

2. **DM ceiling at ~81.** Even a "perfect" scenario (T37) with all factors 7.5–8.8 only reaches DM=81. This is a property of weighted averaging — reaching 90+ would require near-perfect 9+ across all factors, which is extremely rare. This is acceptable for a 0–99 range.

3. **Convenience factor has high default.** Median=6.5, min=2.0. The base of 5 + various bonuses (BYOB, parking) pushes convenience high by default. This is intentional — most restaurants are "convenient enough."

4. **Data completeness averages 71%.** Most mock profiles are well-enriched. Real production data may have lower completeness for newer restaurants.

### Cuisine Penalty Model Comparison

Scenario: "best sushi omakase" → Italian restaurant with outstanding Setting=8.8, Atmosphere=7.0, Reputation=7.6

| Model | DM Score | Behavior |
|-------|----------|----------|
| **A: No penalty (status quo)** | 44 | Food=1.0 through weighted average already limits score |
| **B: Tiered cap at 65** | 44 | Cap irrelevant — score already below 65 |
| **C: Continuous -2.5** | 19 | Overly harsh double-penalty on already-low score |

**Conclusion:** Model A is sufficient. The V3 weight system with `cuisine_importance: "high"` → food_weight=0.45 already ensures a cuisine mismatch (Food=1.0) dominates the composite. The concern from V2 (T76-T80 scores of 83-89%) was caused by V2's narrower 45-99% range and different weight distribution, not an architectural flaw in the factor model.

---

## 27. Known Scoring Anomalies

### ANOMALY-1: No-Intent Floor Masks Dietary Mismatch

**Location:** `computeFoodMatch()` lines 375-378

**Behavior:** When `targetCuisines.length === 0` and `cuisine_importance === "low"`, a floor of 5.0 is applied to the Food factor. This was designed for experience-first queries ("fun lively spot with good drinks") where no food intent exists. However, the floor also activates when a user has dietary restrictions but no cuisine target — masking the dietary penalty.

**Example:**
- Request: "vegan dinner" → intent: `{ target_cuisines: [], cuisine_importance: "low", dietaryRestrictions: ["Vegan"] }`
- Restaurant: BBQ joint with no vegan options
- Expected Food: ≤4 (bad dietary match)
- Actual Food: 5.0 (floor overrides)

**Impact:** A vegan at a BBQ joint scores identically (DM=54) to a vegan at a dedicated vegan restaurant (DM=54). The dietary signal is completely hidden.

**Proposed Fix:** Exempt the floor when `dietaryRestrictions` is non-empty:
```typescript
// Current (line 376):
if (intent?.cuisine_importance === "low" || !specialRequest || specialRequest.trim().length < 3) {
  return { score: Math.max(normalized, 5), dataPoints, maxDataPoints };
}

// Proposed:
if ((intent?.cuisine_importance === "low" || !specialRequest || specialRequest.trim().length < 3)
    && (!dietaryRestrictions || dietaryRestrictions.length === 0)) {
  return { score: Math.max(normalized, 5), dataPoints, maxDataPoints };
}
```

**Test scenarios affected:** T40, T46, T47

### ANOMALY-2: Food Factor Ceiling

The maximum observed Food score is 8.4 (T37). The theoretical max is 10 (5 cuisine + 2 flavor + 2 dietary + 1 menu = 10), but achieving it requires:
- Exact cuisine match (5 pts)
- 3+ flavor profile overlaps (2 pts — capped at min(2, count×0.7))
- Dietary depth "dedicated" (2 pts)
- Signature dish keyword match (1 pt)

In practice, cuisine match + flavor + no dietary restriction defaults to ~7.7 max. This is acceptable but means DM rarely exceeds 85 even in ideal conditions.

---

## 28. Expert Review Synthesis (5 Specialists)

Five expert subagents reviewed the V3 design and test results on 2026-02-25. This section consolidates their findings, organized by severity and cross-referencing which experts raised each issue.

### 28.1 Critical Issues (Must Fix)

#### ISSUE-1: Mixed Penalty Arithmetic (Statistician, Probability, Behavioral)

**Problem:** `applyDealBreakerPenalties()` mixes multiplicative (`result *= 0.5`) and subtractive (`result -= 1.0`) penalties on the same composite. A multiplicative penalty has variable absolute impact — a restaurant scoring 8.0 loses 4.0 points from `*0.5`, while one scoring 4.0 loses only 2.0. This means high-quality restaurants are penalized more severely in absolute terms, which is counterintuitive. Sequential application also creates order-dependent distortion.

**All 3 experts recommend:** Unify to subtractive penalties. Replace `result *= 0.5` (3-tier price gap) with `result -= 3.0` and `result *= 0.7` (2-tier gap) with `result -= 2.0`. This makes penalty magnitude predictable and independent of base score.

**Code location:** `scoring-v3.ts` lines 994-1035

#### ISSUE-2: Sentiment Double-Counting (Statistician, Predictive Analytics)

**Problem:** Negative sentiment is penalized twice:
1. In `computeReputation()` (lines 717-719): penalty up to -1.5 on Reputation factor
2. In `applyDealBreakerPenalties()` (lines 1030-1032): penalty up to -2.0 on composite

At 60% negative sentiment, combined penalty ≈ -15 DM points from the same signal. Thresholds are misaligned (Reputation triggers at >30%, deal-breaker at >40%).

**Recommendation:** Remove sentiment from deal-breaker penalties and rely solely on the Reputation factor. If extreme cases need a deal-breaker, raise threshold to >55-60% and apply a cap rather than subtraction.

#### ISSUE-3: ANOMALY-1 Confirmation (All 5 experts)

All five experts independently confirmed that the no-intent floor masking dietary mismatch (Section 27, ANOMALY-1) is critical. The Behavioral expert noted this is a "trust catastrophe" — dietary restrictions are identity-salient constraints (Rozin & Fallon, 1987), and violating them damages trust more severely than any other mismatch type.

**Fix:** Already proposed in Section 27. Implement immediately.

### 28.2 Significant Concerns (Should Address)

#### ISSUE-4: Setting/Atmosphere Factor Correlation (Predictive Analytics, Probability, Behavioral)

**Problem:** Setting Fit and Atmosphere share substantial signal overlap — both are conditioned on `occasion`, both evaluate "is this the right kind of place?" Combined weight of 45% (25% + 20%) means correlated factors dominate the score. The Probability expert estimates Corr(S, A) ≈ 0.7, making their combined effective influence closer to 50-55% due to double-counted shared variance.

**Options (requires design decision):**
- **Option A:** Merge into single "Venue Fit" factor (4-factor model, cleaner). Predictive Analytics recommends this.
- **Option B:** Orthogonalize — move all occasion-driven ambiance (noise expectations, lighting expectations) exclusively into Setting; make Atmosphere purely request-driven (vibe keywords, music, outdoor, Instagram). This preserves 5 factors while reducing correlation.
- **Option C:** Keep as-is but add documentation that this is an intentional design choice trading statistical purity for user-facing granularity.

#### ISSUE-5: Score Range Compression & Perception (Statistician, Behavioral)

**Problem:** DM range is effectively 0-81 with mean=50.2. On a 0-99 scale, users invoke a "percentage grade" mental model where 50 = "F" (failing). Half of all recommendations will feel like failures even when they represent reasonable matches. The 90-99 tier ("Perfect Match") is essentially unreachable.

**Options:**
- **Option A (Statistician):** Apply power-law scaling: `DM = round(pow(raw/10, 0.9) * 99)`. Maps raw=8.6→DM=87 instead of 86. Stretches upper range without dramatically changing mid-range.
- **Option B (Behavioral):** Apply sigmoid stretch centered at composite=5.5 with gain=1.3. Maps current mean of 50 to ~60 on display.
- **Option C:** Keep linear mapping but redefine tier labels: "Great Match" at 75+ instead of 80+, "Good Match" at 55+ instead of 65+.
- **Option D (Behavioral):** Implement display floor of 20-25 for any restaurant passing deal-breaker gates. Internal score stays 0-99 for ranking; display score clamps minimum.

#### ISSUE-6: Enrichment Confidence Discontinuity (Statistician, Predictive Analytics, Probability)

**Problem:** At confidence=5, multiplier jumps from 0.745 to 1.0 (a 34% boost). This cliff function means a restaurant oscillating around confidence 4.9-5.0 sees dramatic score swings.

**All 3 recommend:** Smooth continuous function. Statistician proposes: `multiplier = min(1.0, confidence / 5.0)`. Probability proposes: `multiplier = 0.5 + 0.5 * min(1.0, confidence / 10.0)`. Both eliminate the discontinuity.

#### ISSUE-7: Weight Override Precedence (Statistician, Predictive Analytics)

**Problem:** When `cuisine_importance="medium"` and `occasion="Date Night"`, the occasion override completely replaces medium-cuisine weights (35/20/20/15/10) with Date Night weights (20/30/25/15/10). The user's "medium" cuisine signal is entirely discarded for 5 of 9 specific occasions.

**Recommendation:** Blend weights instead of overriding: `finalWeight = alpha * cuisineWeight + (1-alpha) * occasionWeight` where alpha depends on cuisine_importance (e.g., 1.0 for high, 0.6 for medium, 0.3 for low).

#### ISSUE-8: Convenience Upward Bias (Statistician, Predictive Analytics)

**Problem:** Convenience starts at 5.0 with median=6.5, contributing near-constant positive signal. At 10% weight, its discriminating power is only ~0.5 DM points between typical restaurants. Effectively a tiebreaker, not a discriminator.

**Options:**
- Lower starting point to 3.0 and recalibrate bonuses for wider range
- Accept as intentional tiebreaker and document
- Fold into deal-breaker penalties and replace with "Value" factor (Behavioral expert suggestion)

### 28.3 Visualization Recommendations (Data Visualization Expert)

#### ISSUE-9: Radar Chart Weight Mismatch

**Problem:** Chart shows raw 0-10 factor scores, but DM uses dynamic weights. A user seeing Food=3 + four other factors at 8+ will mentally average "mostly good" while DM=38 due to 45% food weight. Visual area misleads.

**Recommendation:** Display weighted contribution per axis OR visually encode weight as axis thickness/opacity. Add a "weight context" micro-bar below the chart showing the weight distribution.

#### ISSUE-10: Mobile Rendering

Minimum 220px diameter for labeled radar. Below that, use compact shape-only mode (120px) with colored dots at vertices. Tap to expand.

#### ISSUE-11: Per-Axis Confidence

Use visual treatment per axis: solid line (≥70% complete), dashed (40-69%), dotted with "?" (<40%). More informative than a single aggregate percentage.

#### ISSUE-12: Comparison Mode

For 2 restaurants: reference polygon (fill) + second as stroke-only. For 3+: side-by-side small multiples (per Cleveland & McGill).

### 28.4 Behavioral Recommendations (Human Behavioral Expert)

#### ISSUE-13: "Fair Match" Label is Euphemistic

"Fair" has positive connotations. Rename the 45-64 tier to **"Partial Match"** — communicates "some factors matched, some didn't."

#### ISSUE-14: Anchoring in "Try Another" Cycles

First score becomes anchor. When subsequent scores decline, add contextual framing: "Exploring a different direction" or "Different vibe, closer to you."

#### ISSUE-15: Claude ±0.5 Below JND

The ±0.5 modulation translates to ~2-3 DM points, below the just-noticeable difference threshold of 5-8 points. Either increase to ±1.0-1.5 for perceptibility, or accept as invisible tiebreaker (current intent).

#### ISSUE-16: Missing "Price/Value" Factor

Users consistently rank Price/Value in top 3 restaurant selection criteria (NRA surveys, Zagat research). Currently handled only as penalty + filter, not visible in factor breakdown.

### 28.5 Predictive Analytics Recommendations

#### ISSUE-17: CUISINE_FAMILIES Coverage Gaps

Missing: American family (American, New American, Southern, Cajun, BBQ), European (French, Spanish, British), African (Ethiopian, Nigerian, Moroccan). South Asian only has "Indian" — missing Nepalese, Pakistani, Sri Lankan.

#### ISSUE-18: Feedback Loop Validation Pipeline

To validate predictive accuracy:
- Log V3 factor vectors + final score at recommendation time
- Track user feedback (like/dislike, "try another", save, share)
- After 1000 events: train logistic regression `P(like) ~ factors` and compare learned weights to hand-tuned weights
- Track "score surprise" metric: DM≥80 but disliked, or DM<60 but liked

#### ISSUE-19: Claude Modulation Contaminates Factor Values

Claude adjustment modifies `factors.food` and `factors.setting` directly (lines 1131-1141), meaning returned factor values no longer represent pure deterministic computation. If displayed on radar chart, users see contaminated values.

**Recommendation:** Apply modulation to raw composite directly: `raw += relevanceAdjust * (weights.food + weights.setting)`, preserving semantic purity of per-factor scores.

### 28.6 Expert Strengths Consensus

All 5 experts praised:
1. **Factor independence enforcement** — each factor computed in its own function
2. **Data completeness tracking per factor** — rare in hand-tuned scoring systems
3. **Deal-breaker gate/penalty separation** — correct two-phase architecture
4. **Weight normalization robustness** — tolerance-based with correct floating-point handling
5. **Cuisine family graceful degradation** — smooth 5/4.5/4/3/0 partial-credit gradient
6. **Design document honesty** — self-identified anomalies before deployment

### 28.7 Priority Action Matrix

| Priority | Issue | Impact | Effort | Experts |
|----------|-------|--------|--------|---------|
| P0 | ANOMALY-1: Dietary floor fix | High | Low (1 line) | All 5 |
| P0 | Sentiment double-counting | High | Low | 2 |
| P1 | Mixed penalty arithmetic | Medium | Medium | 3 |
| P1 | Enrichment confidence smoothing | Medium | Low | 3 |
| P1 | Weight override → blend | Medium | Medium | 2 |
| P2 | Setting/Atmosphere → merge to 4 factors | Medium | High | 3 | **DECIDED: Merge** |
| P2 | Score range → nonlinear scaling | Medium | Medium | 2 | **DECIDED: Implement** |
| P2 | Radar chart weight display | Medium | Medium | 1 |
| P3 | CUISINE_FAMILIES expansion | Low | Low | 1 |
| P3 | "Fair" → "Partial" relabel | Low | Low | 1 |
| P3 | Convenience bias | Low | Medium | 2 |
| P3 | Claude factor contamination | Low | Low | 1 |

---

## 29. Design Decisions (Post-Review)

Based on expert findings and stakeholder input, the following design decisions were made:

### 29.1 DECISION: Merge Setting Fit + Atmosphere → 4-Factor Model

**Decision:** Merge Setting Fit and Atmosphere into a single **"Venue Fit"** factor. The V3.1 model will have 4 factors:

| Factor | What It Answers | Weight (default) |
|--------|----------------|------------------|
| **Food Match** | "Does this serve what I'm craving?" | 35% |
| **Venue Fit** | "Is this the right place for my occasion and vibe?" | 35% |
| **Reputation** | "Is this place actually good?" | 20% |
| **Convenience** | "Can I realistically go here tonight?" | 10% |

**Rationale:**
- Setting and Atmosphere are correlated at ~0.7 (both conditioned on occasion), double-counting venue quality at combined 45%
- Merging eliminates multicollinearity and creates a cleaner weight distribution
- 4-axis diamond radar chart is more visually intuitive than 5-axis pentagon
- Consolidation preserves all existing signals (occasion scores, service style, noise, lighting, energy, music, vibe) in one coherent function

**Implementation notes:**
- Combine `computeSettingFit()` and `computeAtmosphere()` into `computeVenueFit()`
- Use the occasion base score (0-7) as the foundation, then layer service/pacing/social dynamics, then noise/lighting/energy/music/vibe/request-driven signals
- Normalize to 0-10 as with other factors
- Update `V3Factors`, `V3Weights`, `V3ScoringBreakdown` interfaces
- Update radar chart from pentagon to diamond

### 29.2 DECISION: Nonlinear Score Scaling

**Decision:** Apply power-law scaling to stretch the upper DM range, making 80+ and 90+ tiers achievable.

**Formula:**
```
dondeMatch = Math.min(99, Math.max(0, Math.round(Math.pow(raw / 10, 0.9) * 99)))
```

**Mapping examples:**

| Raw Composite | Current (Linear) | New (Power 0.9) |
|--------------|------------------|-----------------|
| 4.0 | 40 | 46 |
| 5.0 | 50 | 53 |
| 6.0 | 60 | 61 |
| 7.0 | 70 | 72 |
| 8.0 | 80 | 81 |
| 8.6 | 86 | 87 |
| 9.0 | 90 | 90 |
| 9.5 | 95 | 95 |

**Rationale:**
- Current ceiling at DM=81 means 90+ tier is unreachable
- Power 0.9 subtly stretches the upper range: raw 8.6 → 87 (was 86), raw 9.0 → 90 (same)
- Mid-range scores shift up slightly (50→53), reducing the "failing grade" perception
- Rankings are preserved — the function is monotonically increasing
- The change is conservative (exponent 0.9, not 0.7 or 0.8)

**Note:** This decision may be revisited after implementing the 4-factor model, as factor consolidation will change the score distribution.

---

## 30. Final Design Review Results

**Reviewer:** Comprehensive design review agent (2026-02-25)

**Verdict: READY TO COMMIT**

### Findings Summary

- **Formula accuracy:** All formulas in the document match the code implementation exactly. Verified across all 5 factors, weight tables, penalty functions, and score mapping.
- **Internal consistency:** All sections agree. Weight tables, tier definitions, and source references are correct.
- **Minor documentation gaps fixed:**
  - Music Fit table expanded from 4 to 9 occasions
  - Live music tag fallback path added to Atmosphere signals
  - Blues added to specific music style matching
  - Mermaid weight flowchart fixed to show both medium and low flowing to occasion override
- **No blocking issues found.**
