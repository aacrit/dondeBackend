# Donde Match System v4.0 — Full System Specification

## Changelog from v3.6

### Scoring Engine
- **REPLACED** power-law scaling (`pow(x, 0.73) * 116`) with **Dynamic-Weight Geometric Mean**: `Score = (Π Factor_i ^ Weight_i) × 10`
- **RENAMED** factors: Food Match → Food Quality, Setting Fit → Service, Atmosphere → Vibe. Reputation and Convenience unchanged.
- **REPLACED** hardcoded weight logic (`computeV3Weights()` if/else blocks) with **configurable rule-based weight-shift engine** (`weight-config.ts`)
- **REMOVED** all post-composite adjustment layers: quality bonus, Claude relevance modulation, factor decorrelation, deal-breaker penalties, personalization penalties
- **ABSORBED** deal-breaker penalties into individual factors: dietary → Food Quality, price/neighborhood → Convenience
- **ABSORBED** user feedback personalization into Food Quality factor (liked/disliked cuisines, disliked restaurants)
- **ADDED** confidence scoring per factor (high/medium/low) with Bayesian regression toward 5.5 for uncertain data
- **ADDED** factor score floor at 1.0 to prevent geometric mean zero-collapse

### Intent Classification
- **ADDED** per-signal confidence levels: `confidence.cuisine`, `confidence.vibe`, `confidence.occasion`, `confidence.constraints`, `confidence.overall`
- Confidence fallback inference when Claude doesn't return confidence field
- Increased max tokens from 250 → 300 to accommodate confidence output

### Blurb Generation
- **INCREASED** target word count from 50-80 → 60-100 words
- **UPDATED** tone modulation tiers for geometric mean distribution: Outstanding (85+), Excellent (70-84), Solid Pick (55-69), Worth a Try (<55)
- **ADDED** weight-shift awareness: blurbs can reference dynamic weight context ("We put extra weight on vibe for your date night")
- **ADDED** V4 factor tag format in Claude prompts: `FQ:X/VB:X/SV:X/RP:X/CV:X`

### Data Enrichment
- **ADDED** enrichment gap audit script (`audit-enrichment-gaps.ts`)
- **ADDED** one-time backfill script for insider tips & origin stories using Claude Sonnet 4 (`backfill-tips-stories.ts`)

### Frontend
- **UPDATED** score tier thresholds: high ≥ 70 (was 80), mid ≥ 50 (was 55)
- **UPDATED** tier labels: Outstanding/Excellent/Solid Pick/Worth a Try/Adventurous
- **UPDATED** celebration threshold: 85+ (was 90+)
- **ADDED** dynamic weight percentage display per factor (L1)
- **ADDED** confidence badges per factor (high=green, medium=amber, low=gray)
- **ADDED** weight shift reason summaries in "Why This Match" section

### API Response
- **ADDED** `scoring_v4` field with: food_quality, vibe, service, reputation, convenience, weights_used (with V4 keys), weight_shift_reasons[], confidence{}, data_completeness, factor_details{}
- `scoring_v3` retained for backward compatibility (maps V4 factors to V3 keys)

---

## 1. Scoring Model

### 1.1 Formula

```
Donde Score = (FQ^W_fq × VB^W_vb × SV^W_sv × RP^W_rp × CV^W_cv) × 10
```

Where:
- `FQ` = Food Quality (1-10)
- `VB` = Vibe (1-10)
- `SV` = Service (1-10)
- `RP` = Reputation (1-10)
- `CV` = Convenience (1-10)
- `W_*` = Dynamic weights (sum to 1.0)
- `× 10` maps geometric mean to 0-100 scale

### 1.2 Five Factors

| Factor | Base Weight | Sub-criteria |
|--------|-------------|-------------|
| **Food Quality** | 0.30 | Cuisine alignment (0-6), flavor profile match (0-2), dietary fit (0-2), menu interest (0-1). Normalized to 0-10. Absorbs: dietary dealbreaker penalty, user liked/disliked cuisine, rejection avoidCuisines, disliked restaurant. |
| **Vibe** | 0.20 | Noise match (0-2), lighting match (0-2), dress code (0-1), energy level (0-2), music vibe (0-1.5), vibe keyword matches (0-1.5). Adaptive normalization (only data-active layers). Cold-start returns 4.0. |
| **Service** | 0.20 | Occasion base score (0-7, power-stretched), service style alignment (-0.5 to +1.5), pacing + social dynamics (0-1.5). Includes: kid-friendliness, conversation-friendliness, group size, date progression. |
| **Reputation** | 0.15 | Google rating (0-5, confidence-gated by review count), review sentiment (0-2), awards/recognition (0-2), community standing (0-2). |
| **Convenience** | 0.15 | Timing fit (-2 to +2), reservation accessibility (-2.5 to +2), wait time (-1 to +1), practical notes (-0.5 to +1.5), parking (+0.5). Absorbs: price mismatch penalty, neighborhood mismatch, rejection avoidPriceLevels. |

### 1.3 Dynamic Weight System

Weights shift based on parsed intent using configurable rules in `weight-config.ts`.

**Base weights**: FQ=0.30, VB=0.20, SV=0.20, RP=0.15, CV=0.15

**Shift rules** (applied additively, then clamped [0.05, 0.60] and normalized):

| Trigger | Shifts |
|---------|--------|
| Date Night / Special Occasion | VB +0.10, SV +0.05, CV -0.10, FQ -0.05 |
| Business Lunch | SV +0.10, VB +0.05, CV -0.05, FQ -0.10 |
| Adventure | RP +0.10, FQ -0.05, SV -0.05 |
| Family Dinner | SV +0.05, CV +0.10, VB -0.10, RP -0.05 |
| Solo Dining | CV +0.10, FQ +0.05, SV -0.10, VB -0.05 |
| Treat Myself | FQ +0.05, VB +0.05, CV -0.10 |
| Chill Hangout | VB +0.10, CV +0.05, FQ -0.10, RP -0.05 |
| High cuisine importance | FQ +0.15, VB -0.05, SV -0.05, RP -0.05 |
| Emotional intent: impress | RP +0.05, CV -0.05 |
| Price sensitive | CV +0.10, FQ -0.05, VB -0.05 |
| Spontaneous | CV +0.10, SV -0.05, VB -0.05 |

### 1.4 Confidence Adjustment

Before entering geometric mean, raw factor scores are regressed toward 5.5:

```
adjusted = raw × confidence_multiplier + 5.5 × (1 - confidence_multiplier)
```

| Level | Multiplier | Effect on raw score of 9.0 |
|-------|-----------|---------------------------|
| high | 1.0 | 9.0 (unchanged) |
| medium | 0.75 | 8.125 |
| low | 0.5 | 7.25 |

Confidence derivation:
- **Food Quality**: enrichment_confidence ≥ 5 + explicit cuisine = high
- **Vibe**: enrichment_confidence ≥ 5 + dataPoints ratio ≥ 0.5 = high
- **Service**: enrichment_confidence ≥ 5 + occasion scores present = high
- **Reputation**: Google review count ≥ 200 = high, ≥ 10 = medium, < 10 = low
- **Convenience**: always high

### 1.5 Score Tiers

| Range | Tier | Label |
|-------|------|-------|
| 85-99 | Outstanding | Exceptional across all factors |
| 70-84 | Excellent | Strong match, minor trade-offs |
| 55-69 | Solid Pick | Good match, notable trade-offs |
| 40-54 | Worth a Try | Decent, significant weaknesses |
| 0-39 | Adventurous | Poor match |

---

## 2. Input Parsing Pipeline

### 2.1 Intent Classification (V2 + V4 Confidence)

Claude Haiku classifies user input into structured signals:

| Signal | Type | Example |
|--------|------|---------|
| target_cuisines | string[] | ["Japanese", "Korean"] |
| cuisine_importance | "high" / "medium" / "low" | "high" for "sushi" |
| vibe_keywords | string[] | ["intimate", "cozy"] |
| emotional_intent | string | "impress", "comfort", "explore" |
| spontaneity | "planned" / "spontaneous" / "unknown" | "spontaneous" for "tonight" |
| confidence | IntentConfidence | {cuisine: "high", vibe: "medium", ...} |

### 2.2 Short/Vague Prompt Handling

For prompts ≤ 3 words or overall confidence = "low":
- Use base weights (no dynamic shifts)
- All factors regressed toward 5.5 with confidence_multiplier = 0.5
- Blurb surfaces assumptions: "Assuming a casual dinner out..."

### 2.3 Pipeline Flow

```
User Input → Intent Classifier → {signals + confidence}
                                        ↓
                               Weight Shift Engine ← weight-config.ts rules
                                        ↓
                               Dynamic Weights (sum to 1.0)
                                        ↓
               Five Factor Computation → Confidence Adjustment → Geometric Mean → Donde Score (0-99)
```

---

## 3. Blurb Generation

### 3.1 Prompt Architecture

System prompt includes:
- Voice modulation (occasion-driven personality shifts)
- Cultural grounding rules (cuisine-specific vocabulary)
- Banned words/patterns list
- Score-aware tone modulation with V4 tier boundaries

### 3.2 Tone Tiers

| Tier | DM Range | Tone |
|------|----------|------|
| Outstanding | 85+ | Full confidence. Declarative. "This is the one." |
| Excellent | 70-84 | Confident with honest trade-off acknowledgment |
| Solid Pick | 55-69 | Measured. Highlight 1-2 strong factors, note gaps |
| Worth a Try | <55 | Lead with strongest genuine positive, name gap briefly |

### 3.3 Weight-Awareness

Blurbs may reference dynamic weight context:
- "We put extra weight on vibe for your date night, and this place delivers."
- "For your spontaneous dinner, we prioritized convenience, and this one's walk-in friendly."

---

## 4. Data Enrichment

### 4.1 One-Time Backfill Pipeline

- **Model**: Claude Sonnet 4
- **Targets**: Restaurants missing insider_tip or origin_story
- **Batch size**: 5 restaurants per LLM call
- **Rate limit**: 10 req/min (6s delay between batches)
- **Output**: insider_tip (15-25 words, actionable) + origin_story (2-4 sentences)
- **Audit**: CSV log of all results (success/error per restaurant)
- **Modes**: Dry-run (default) and live (--live flag)

### 4.2 Enrichment Quality Standards

Insider tips:
- Start with a verb: "Ask for...", "Grab the...", "Sit at..."
- Specific to the restaurant, not generic
- Grounded in data (signature dishes, best seat, wow factors)

Origin stories:
- 2-4 sentences about founding, chef background, or cultural significance
- Include one memorable specific detail
- Conversational, not Wikipedia-style

---

## 5. Frontend Score Display

### 5.1 Progressive Disclosure

| Level | Content | Trigger |
|-------|---------|---------|
| L0 | Donde Score number in hero ring | Always visible |
| L1 | Five factor bars with scores + dynamic weight % chips | Tap score hero |
| L2 | Per-factor sub-criteria with confidence badges | Tap any factor row |

### 5.2 Visual Elements

- **Weight chips**: Small `XX%` labels next to factor names showing dynamic weight
- **Confidence badges**: 6px colored dots (green=high, amber=medium, gray=low)
- **Weight shift summary**: Text explaining top weight shift reason ("Weighted for Vibe")
- **Score ring**: Unchanged animation with updated celebration threshold (85+)

---

## 6. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (dondeAI)                        │
│  app.js → animations.js → utils.js                          │
│  Factor bars: V4 keys + weight chips + confidence badges    │
│  Score tiers: recalibrated for geometric mean               │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP POST /recommend
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Edge Function (dondeBackend)                    │
│  index.ts → orchestration                                   │
│  ┌────────────────┐  ┌──────────────────┐                  │
│  │ intent-         │  │ Supabase RPC     │  ← parallel     │
│  │ classifier.ts   │  │ get_ranked_      │                  │
│  │ (+ confidence)  │  │ restaurants      │                  │
│  └───────┬────────┘  └───────┬──────────┘                  │
│          │                    │                              │
│          ▼                    ▼                              │
│  ┌──────────────────────────────────────┐                   │
│  │ scoring-v4.ts — Geometric Mean       │                   │
│  │ ┌──────────────────────────────┐     │                   │
│  │ │ weight-config.ts             │     │                   │
│  │ │ (configurable shift rules)   │     │                   │
│  │ └──────────────────────────────┘     │                   │
│  │ ┌──────────────────────────────┐     │                   │
│  │ │ Factor computation (from     │     │                   │
│  │ │ scoring-v3.ts, reused)       │     │                   │
│  │ └──────────────────────────────┘     │                   │
│  │ Confidence adjustment → GM → Score   │                   │
│  └──────────────────────────────────────┘                   │
│          │                                                   │
│          ▼                                                   │
│  ┌──────────────────────────────────────┐                   │
│  │ scoring.ts — Claude blurb generation │                   │
│  │ (score-aware tone, weight context)   │                   │
│  └──────────────────────────────────────┘                   │
│          │                                                   │
│          ▼                                                   │
│  ┌──────────────────────────────────────┐                   │
│  │ response-builder.ts                  │                   │
│  │ → scoring_v4 (new) + scoring_v3      │                   │
│  └──────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Supabase Database                               │
│  restaurants (insider_tip)                                   │
│  restaurant_deep_profiles (origin_story, 34 enrichment      │
│  fields, enrichment_confidence)                              │
│  restaurant_occasion_scores                                  │
│  restaurant_tags                                             │
│  neighborhoods                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. File Manifest

### New Files
| File | Purpose |
|------|---------|
| `dondeBackend/.../weight-config.ts` | Configurable weight shift rules, base weights, normalization |
| `dondeBackend/.../scoring-v4.ts` | Geometric mean scoring engine, confidence adjustment, absorbed penalties |
| `dondeBackend/scripts/pipelines/audit-enrichment-gaps.ts` | Read-only enrichment gap audit |
| `dondeBackend/scripts/pipelines/backfill-tips-stories.ts` | One-time enrichment with Claude Sonnet 4 |

### Modified Files
| File | Changes |
|------|---------|
| `dondeBackend/.../types.ts` | Added V4Factors, V4Weights, V4FactorConfidence, V4SubComponent, V4FactorResult, V4ScoringBreakdown |
| `dondeBackend/.../intent-classifier.ts` | Added IntentConfidence, confidence field, validation, fallback inference |
| `dondeBackend/.../index.ts` | Switched from V3 to V4 scoring, removed claudeRelevance |
| `dondeBackend/.../response-builder.ts` | Added buildScoringV4(), scoring_v4 in response |
| `dondeBackend/.../scoring.ts` | Updated blurb word count (60-100), tone tiers for GM, V4 factor tags |
| `dondeAI/js/utils.js` | Updated score tiers, color thresholds for GM distribution |
| `dondeAI/js/animations.js` | V4 factor dims, weight chips, confidence badges, celebration at 85+ |
| `dondeAI/js/app.js` | V4 scoring data rendering, factor names, celebration threshold |
| `dondeAI/css/components.css` | Weight chip, confidence badge, tile-expand weight chip styles |

### Preserved Files
| File | Status |
|------|--------|
| `dondeBackend/.../scoring-v3.ts` | **Kept intact** — individual factor computation functions reused by scoring-v4.ts |
