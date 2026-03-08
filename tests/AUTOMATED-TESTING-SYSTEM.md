# DondeAI Automated Testing System — Complete Reference

> **Single source of truth** for the DondeAI test system, agent team, and ARCADE OPS command center.
> Last updated: 2026-03-08

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [The Five Agents](#3-the-five-agents)
4. [Golden Dataset (50 Queries)](#4-golden-dataset)
5. [Gauntlet Search Atlas (375+ Queries)](#5-gauntlet-search-atlas)
6. [Full Test Catalog (170 Scenarios)](#6-full-test-catalog)
7. [Benchmark-200](#7-benchmark-200)
8. [Chicago-Specific Taxonomy](#8-chicago-specific-taxonomy)
9. [Scoring Thresholds & Metrics](#9-scoring-thresholds--metrics)
10. [API Budget Management](#10-api-budget-management)
11. [Notification & Escalation Protocol](#11-notification--escalation-protocol)
12. [Dashboard Interaction Model](#12-dashboard-interaction-model)
13. [File Inventory](#13-file-inventory)

---

## 1. System Overview

```
╔══════════════════════════════════════════════════════════════════════╗
║                   DondeAI ARCADE OPS                               ║
║              Automated Testing Command Center                       ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                     ║
║   CEO Dashboard (arcade-ops.html)                                   ║
║   ┌─────────┐  ┌─────────┐  ┌─────────┐                           ║
║   │ ▶ START │  │ ⏸ PAUSE │  │ ■ STOP  │                           ║
║   └────┬────┘  └────┬────┘  └────┬────┘                           ║
║        │            │            │                                  ║
║        └────────────┼────────────┘                                  ║
║                     ▼                                               ║
║   ┌─────────────────────────────────────┐                           ║
║   │     Agent Orchestrator              │                           ║
║   │     (agent-orchestrator.ts)         │                           ║
║   │     Budget: 50 API calls/day        │                           ║
║   └──┬──────┬──────┬──────┬──────┬─────┘                           ║
║      │      │      │      │      │                                  ║
║      ▼      ▼      ▼      ▼      ▼                                  ║
║   ATLAS  QAUDIT SENTINEL HUNTER GUARDIAN                            ║
║   (20)   (0)    (15)     (10)   (5)     ← API calls/day            ║
║      │      │      │      │      │                                  ║
║      └──────┴──────┴──────┴──────┘                                  ║
║                     │                                               ║
║                     ▼                                               ║
║   ┌─────────────────────────────────────┐                           ║
║   │  DondeAI Recommend API              │                           ║
║   │  POST /functions/v1/recommend       │                           ║
║   │  + Supabase PostgreSQL (direct)     │                           ║
║   └─────────────────────────────────────┘                           ║
╚══════════════════════════════════════════════════════════════════════╝
```

**Purpose**: Continuously validate DondeAI search quality through 5 specialized agents, controlled by the CEO from a 90s-arcade-themed dashboard.

**Key Metrics (Current Baseline)**:
- Gauntlet: 375 queries, 81.6% pass rate (DM >= 60), avg DM 71.0
- Golden Dataset: 50 queries, 85% pass rate, avg DM 69
- Gaps Detected: 215 (intent: 109, scoring: 47, relevance_ceiling: 28, cuisine_mismatch: 22)
- API Errors: 3 (P0 severity)

---

## 2. Architecture

### Component Map

| Component | Location | Technology | Purpose |
|-----------|----------|------------|---------|
| Dashboard | `dondeAI/arcade-ops.html` | HTML/CSS/JS | CEO command center |
| Dashboard CSS | `dondeAI/css/arcade-ops.css` | CSS3 | 90s arcade theme |
| Dashboard JS | `dondeAI/js/arcade-ops.js` | ES Modules | Controls, polling, gamification |
| Orchestrator | `dondeBackend/scripts/pipelines/agent-orchestrator.ts` | TypeScript/Node | Agent lifecycle + budget |
| ATLAS Agent | `dondeBackend/scripts/pipelines/agents/atlas-runner.ts` | TypeScript | Gauntlet query execution |
| QAUDIT Agent | `dondeBackend/scripts/pipelines/agents/quality-auditor.ts` | TypeScript | Blurb & score analysis |
| SENTINEL Agent | `dondeBackend/scripts/pipelines/agents/sentinel.ts` | TypeScript | Regression detection |
| HUNTER Agent | `dondeBackend/scripts/pipelines/agents/edge-hunter.ts` | TypeScript | Edge case probing |
| GUARDIAN Agent | `dondeBackend/scripts/pipelines/agents/data-guardian.ts` | TypeScript | Data integrity |

### Data Flow

```
Orchestrator starts → Agents cycle independently
  ATLAS → calls API → scores results → writes gauntlet-results/*.jsonl
  QAUDIT → reads ATLAS results → analyzes blurbs → writes audit-report.json
  SENTINEL → calls API (golden set) → compares baseline → writes delta-report.json
  HUNTER → calls API (edge cases) → validates contracts → writes probe-report.json
  GUARDIAN → queries Supabase → checks integrity → writes integrity-report.json

All agents → write to agent-status.json (polled by dashboard)
Budget exceeded → write to notification-queue.json (displayed in dashboard)
```

---

## 3. The Five Agents

### Agent 1: ATLAS — "The Map Maker"

```
╔═══════════════════════════════════════╗
║  ATLAS — The Map Maker               ║
║  Arcade Avatar: Pixel Explorer        ║
║  API Budget: 20 calls/day             ║
╠═══════════════════════════════════════╣
║  Role: Gauntlet query execution       ║
║  Categories: Tiers 1-5                ║
║    - Cuisine (143 queries)            ║
║    - Dish (77 queries)                ║
║    - Vibe (58 queries)                ║
║    - Chicago Specific (42 queries)    ║
║    - Occasion (36 queries)            ║
║    - Reputation (19 queries)          ║
╚═══════════════════════════════════════╝
```

**Cycle Behavior**:
1. Load search atlas from `tests/search-atlas-v1.jsonl`
2. Pick random batch of 5-10 queries (respecting daily budget)
3. Execute each against live API: `POST /recommend`
4. Score: DM >= 60 = PASS, DM >= 80 = EXCELLENT, DM < 40 = CRITICAL
5. Feed failing queries to gap analyzer for classification
6. Write results to `tests/gauntlet-results/run-{timestamp}.jsonl`
7. Update agent-status.json with: queries_run, pass_rate, avg_dm, gaps_found
8. Sleep 60s, repeat

**Auto-capabilities**:
- Re-runs failed queries with `exclude: []` cleared to isolate restaurant vs query issues
- Tracks category-level pass rates to focus on weakest categories
- Flags API errors (HTTP non-200) as P0 notifications

**Reuses**: `gauntlet-runner.ts`, `gap-analyzer.ts`, `generate-search-atlas.ts`

---

### Agent 2: QAUDIT — "The Critic"

```
╔═══════════════════════════════════════╗
║  QAUDIT — The Critic                 ║
║  Arcade Avatar: Pixel Judge           ║
║  API Budget: 0 calls/day              ║
╠═══════════════════════════════════════╣
║  Role: Blurb & scoring quality audit  ║
║  Categories:                          ║
║    - Blurb Quality (20 checks)        ║
║    - Score Accuracy (8 checks)        ║
║    - Tone Calibration (6 checks)      ║
╚═══════════════════════════════════════╝
```

**Cycle Behavior**:
1. Watch for new ATLAS result files in `tests/gauntlet-results/`
2. Load all responses from latest run
3. For each blurb, check against banned word list (40+ patterns):

```javascript
const BANNED_PATTERNS = [
  "culinary", "gastronomic", "delectable", "exquisite", "tantalizing",
  "delightful", "mouthwatering", "nestled", "tucked away", "hidden gem",
  "impeccable", "unparalleled", "masterfully", "beautifully", "stunningly",
  "perfectly", "artisan", "artisanal", "elevate", "elevated", "transcend",
  "journey", "tapestry", "diverse menu", "wide array", "must-visit",
  "not disappoint", "fusion of", "indulge", "culinary journey",
  "dining experience", "food lovers", "every bite", "savor every",
  "burst of flavor", "symphony of flavors", "palette", "taste buds",
  "beckons", "invites you", "promises", "where tradition meets",
  "crafted with", "something for everyone", "Ah,", "Oh,",
  "Whether you", "If you're looking", "Whether it's", "From...to..."
];
```

4. Check structural requirements:
   - Word count 60-100
   - No em dashes (U+2014)
   - "We" voice present
   - Restaurant name present
   - Single paragraph (no line breaks)
5. Validate tone-score alignment:
   - DM >= 85: No hedging ("might", "could be", "if you")
   - DM < 55: No overselling ("perfect", "ideal")
6. Cross-validate scoring math (GM verification)
7. Assign grade: A (0 issues), B (1-2 minor), C (3+ or 1 major), F (critical slop)
8. Write audit report

**Auto-capabilities**:
- Flags exact banned words with position in blurb
- Computes "slop density" (banned words per 100 words)
- Tracks grade trends over time

---

### Agent 3: SENTINEL — "The Watchman"

```
╔═══════════════════════════════════════╗
║  SENTINEL — The Watchman              ║
║  Arcade Avatar: Pixel Knight          ║
║  API Budget: 15 calls/day             ║
╠═══════════════════════════════════════╣
║  Role: Regression detection           ║
║  Categories:                          ║
║    - Golden Dataset (50 queries)      ║
║    - Regression Guard (baseline)      ║
║    - Try Another Monotonicity         ║
╚═══════════════════════════════════════╝
```

**Cycle Behavior**:
1. Sample 10-15 queries from golden dataset (rotating through all 50 over multiple cycles)
2. Execute against API, capture DM scores
3. Compare against stored baselines:
   - V10 baseline: avg DM 70 (50-case)
   - V11 baseline: avg DM 71 (375-case gauntlet)
4. Flag regressions: any query where DM dropped > 5 points from last known score
5. Run 1-2 Try Another chains (3-deep) per cycle:
   - Assert monotonic non-increasing scores
   - Assert no duplicate restaurants
   - Assert score delta < 25 between consecutive
6. Update rolling baseline with new scores
7. Write delta report

**Auto-capabilities**:
- Maintains rolling 7-day score history per query
- Detects trend degradation (3 consecutive drops on same query)
- Classifies regressions: engine change, data change, or API instability

**Golden Dataset Queries (50)**:

| ID | Category | Query | Min Score | Expected Cuisine |
|----|----------|-------|-----------|-----------------|
| GD-F01 | Food | best burger in Chicago | 55 | American |
| GD-F02 | Food | authentic Chinese food | 55 | Chinese |
| GD-F03 | Food | Korean BBQ | 55 | Korean |
| GD-F04 | Food | best pasta in the city | 55 | Italian |
| GD-F05 | Food | Caribbean food | 50 | Caribbean/Cuban |
| GD-F06 | Food | omakase sushi | 55 | Japanese |
| GD-F07 | Food | street tacos | 45 | Mexican |
| GD-F08 | Food | jerk chicken | 50 | Caribbean/Jamaican |
| GD-F09 | Food | French bistro | 50 | French |
| GD-F10 | Food | wood-fired pizza | 60 | Italian |
| GD-F11 | Food | oyster bar | 50 | Seafood/French |
| GD-F12 | Food | soup dumplings | 50 | Taiwanese/Chinese |
| GD-F13 | Food | Chicago hot dog | 50 | American |
| GD-F14 | Food | fine dining tasting menu | 50 | French/Italian |
| GD-F15 | Food | pho | 45 | Vietnamese |
| GD-V01 | Vibe | romantic dinner | 55 | — |
| GD-V02 | Vibe | rooftop bar | 50 | — |
| GD-V03 | Vibe | cozy spot | 50 | — |
| GD-V04 | Vibe | trendy restaurant | 45 | — |
| GD-V05 | Vibe | outdoor dining | 55 | — |
| GD-V06 | Vibe | quiet place to talk | 55 | — |
| GD-V07 | Vibe | lively atmosphere | 55 | — |
| GD-V08 | Vibe | late night eats | 50 | — |
| GD-V09 | Vibe | hole in the wall | 50 | — |
| GD-V10 | Vibe | brunch spot | 60 | — |
| GD-S01 | Service | business lunch | 55 | — |
| GD-S02 | Service | group dinner 10 people | 50 | — |
| GD-S03 | Service | family friendly restaurant | 55 | — |
| GD-S04 | Service | special occasion dinner | 55 | — |
| GD-S05 | Service | quick lunch | 55 | — |
| GD-S06 | Service | dinner before a show | 55 | — |
| GD-S07 | Service | work happy hour | 55 | — |
| GD-S08 | Service | anniversary dinner | 55 | — |
| GD-S09 | Service | solo dining | 50 | — |
| GD-S10 | Service | birthday celebration | 55 | — |
| GD-R01 | Reputation | best restaurant in Chicago | 60 | — |
| GD-R02 | Reputation | Michelin star restaurant | 65 | — |
| GD-R03 | Reputation | award winning chef | 55 | — |
| GD-R04 | Reputation | famous Chicago restaurant | 55 | — |
| GD-R05 | Reputation | most popular restaurant | 60 | — |
| GD-C01 | Convenience | open right now | 50 | — |
| GD-C02 | Convenience | no reservation needed | 55 | — |
| GD-C03 | Convenience | cheap eats | 45 | — |
| GD-C04 | Convenience | BYOB restaurant | 55 | — |
| GD-C05 | Convenience | delivery available | 55 | — |
| GD-C06 | Convenience | parking available | 45 | — |
| GD-C07 | Convenience | near the Loop | 55 | — |
| GD-C08 | Convenience | wheelchair accessible | 50 | — |
| GD-C09 | Convenience | dog friendly patio | 55 | — |
| GD-C10 | Convenience | vegan options | 55 | — |

---

### Agent 4: HUNTER — "The Rogue"

```
╔═══════════════════════════════════════╗
║  HUNTER — The Rogue                   ║
║  Arcade Avatar: Pixel Ninja           ║
║  API Budget: 10 calls/day             ║
╠═══════════════════════════════════════╣
║  Role: Edge case & security probing   ║
║  Categories:                          ║
║    - Edge Cases (10 scenarios)        ║
║    - Dietary Handling (6 scenarios)   ║
║    - API Contract (12 checks)        ║
╚═══════════════════════════════════════╝
```

**Cycle Behavior**:
1. Select 2-3 probes per cycle from the probe registry:

**Edge Case Probes**:
```json
[
  {"id": "EC-01", "input": "", "name": "Empty request"},
  {"id": "EC-02", "input": "a]very long string repeated 500 times...", "name": "Max length input"},
  {"id": "EC-03", "input": "café résumé naïve", "name": "Unicode characters"},
  {"id": "EC-04", "input": "'; DROP TABLE restaurants; --", "name": "SQL injection"},
  {"id": "EC-05", "input": "dinner", "params": {"neighborhood": "Mars"}, "name": "Invalid neighborhood"},
  {"id": "EC-06", "input": "dinner", "params": {"dietary_restrictions": ["vegan","gluten_free","halal","kosher","nut_free"]}, "name": "All restrictions"},
  {"id": "EC-07", "input": "vegan steakhouse", "name": "Contradictory request"},
  {"id": "EC-08", "input": "dinner", "params": {"exclude": ["00000000-0000-0000-0000-000000000000"]}, "name": "Non-existent exclusion"},
  {"id": "EC-09", "input": "<script>alert('xss')</script>", "name": "XSS attempt"},
  {"id": "EC-10", "input": "dinner", "params": {"price_level": "$$$$$$"}, "name": "Invalid price level"}
]
```

2. Execute probe against API
3. Validate response:
   - HTTP 200 (or graceful error)
   - Response contract intact (all required fields present)
   - No crashes, no stack traces in response
   - Correct types for all fields
4. Run API contract validation on every response:
   - `success` is boolean
   - `donde_match` is integer 0-99
   - `restaurant.id` is valid UUID
   - `timestamp` is valid ISO 8601
   - `tags` is array of strings
   - No null critical fields (name, address, cuisine_type)
5. Write probe report

**Auto-capabilities**:
- Generates mutation variants of failed probes
- Tracks which edge cases have been tested recently (rotation)
- Flags any response > 15s as timeout concern

---

### Agent 5: GUARDIAN — "The Sage"

```
╔═══════════════════════════════════════╗
║  GUARDIAN — The Sage                  ║
║  Arcade Avatar: Pixel Wizard          ║
║  API Budget: 5 calls/day              ║
╠═══════════════════════════════════════╣
║  Role: Data integrity & quality       ║
║  Categories:                          ║
║    - RPC/Database (8 checks)          ║
║    - Data Quality (8 checks)          ║
║    - Frontend Rendering (10 checks)   ║
╚═══════════════════════════════════════╝
```

**Cycle Behavior**:
1. Connect to Supabase directly (service role key)
2. Run integrity checks:

```sql
-- DQ-01: No restaurants missing deep_profiles
SELECT count(*) FROM restaurants r
LEFT JOIN deep_profiles dp ON r.id = dp.restaurant_id
WHERE dp.id IS NULL AND r.is_active = true;
-- Expected: 0

-- DQ-02: All occasion scores in range
SELECT count(*) FROM occasion_scores
WHERE date_friendly_score NOT BETWEEN 0 AND 10
   OR group_friendly_score NOT BETWEEN 0 AND 10;
-- Expected: 0

-- DQ-03: No orphaned records
SELECT count(*) FROM deep_profiles dp
LEFT JOIN restaurants r ON dp.restaurant_id = r.id
WHERE r.id IS NULL;
-- Expected: 0

-- DQ-04: Tag distribution
SELECT count(*) FROM restaurants r
WHERE r.is_active = true
AND (SELECT count(*) FROM restaurant_tags rt WHERE rt.restaurant_id = r.id) < 3;
-- Expected: 0

-- DQ-05: No NULL critical fields
SELECT count(*) FROM restaurants
WHERE is_active = true AND (name IS NULL OR address IS NULL);
-- Expected: 0
```

3. Validate insider tip format:
   - Starts with verb: Ask, Grab, Sit, Try, Order, Request, Get, Skip, Go
   - Length: 15-25 words
4. Check enrichment confidence values: all 0.00-1.00
5. Spot-check 5 random restaurants via API to validate end-to-end
6. Write integrity report

**Auto-capabilities**:
- Computes data completeness score per restaurant
- Identifies "thin" restaurants (< 50% field coverage)
- Recommends enrichment pipeline re-runs for specific gaps

---

## 4. Golden Dataset

See Agent 3 (SENTINEL) section above for the complete 50-query golden dataset table.

**Latest Results** (2026-03-07):
- 50 tests, 88 checks
- PASSED: 75 | FAILED: 1 | WARNED: 12
- Pass Rate: 85%
- Category Averages: Food 77, Vibe 64, Service 61, Reputation 79, Convenience 64
- Overall Average DM: 69

**Baseline File**: `tests/GOLDEN_DATASET_RESULTS.md`

---

## 5. Gauntlet Search Atlas

**Source**: `tests/search-atlas-v1.jsonl` (generated from taxonomy configs)
**Generator**: `scripts/pipelines/generate-search-atlas.ts`

### Tier Structure

| Tier | Name | Queries | Description |
|------|------|---------|-------------|
| 0 | Existing Critical | 1000+ | Real Chicago searches from dataset |
| 1 | Core Singles | 375 | Single-signal queries (cuisine, dish, vibe, occasion) |
| 2 | Multi-Signal | TBD | Combined signals (cuisine + vibe, dish + occasion) |
| 3 | Neighborhood | TBD | Neighborhood-filtered queries |
| 4 | Constraint | TBD | Price + dietary + time filters |
| 5 | Adversarial | TBD | Edge cases, contradictions, ambiguity |

### Category Distribution (Tier 1)

| Category | Queries | Avg DM | Pass Rate (>=60) | Excel (>=80) | Weak (<40) |
|----------|---------|--------|-------------------|--------------|------------|
| Cuisine | 143 | 69.8 | 79.0% | 26.6% | 4.2% |
| Dish | 77 | 75.6 | 94.8% | 48.1% | 2.6% |
| Vibe | 58 | 65.8 | 74.1% | 24.1% | 5.2% |
| Chicago Specific | 42 | 72.0 | 71.4% | 31.0% | 2.4% |
| Occasion | 36 | 68.5 | 77.8% | 11.1% | 0.0% |
| Reputation | 19 | 80.7 | 100.0% | 89.5% | 0.0% |

### Gap Types

| Gap Type | Count | Severity | Description |
|----------|-------|----------|-------------|
| intent | 109 | P1 | Intent misclassification |
| scoring | 47 | P1 | Score doesn't reflect quality |
| relevance_ceiling | 28 | P2 | Max relevance limited by data |
| cuisine_mismatch | 22 | P2 | Wrong cuisine returned |
| neighborhood | 6 | P1 | Wrong neighborhood results |
| api_error | 3 | P0 | API returned error/0 score |

---

## 6. Full Test Catalog (170 Scenarios)

Reference: `tests/TEST-FULL.md`

### Category Summary

| # | Category | Scenarios | API Calls | Key Checks |
|---|----------|-----------|-----------|------------|
| 1 | Intent Classification | 18 | 6 | Cuisine/vibe/convenience/multi-signal parsing |
| 2 | Scoring Engine | 20 | 0 | Geometric mean, floor, confidence regression |
| 3 | Factor Computation | 15 | 0 | FQ, VB, SV, RP, CV sub-criteria |
| 4 | Dynamic Weights | 12 | 7 | Per-occasion weight fingerprints |
| 5 | Score Accuracy | 8 | 0 | GM cross-validation, distribution sanity |
| 6 | Try Another | 12 | 15 | Monotonicity, diversity, exclusion |
| 7 | Blurb Quality | 20 | 0 | Banned words, tone, "We" voice, grounding |
| 8 | API Contract | 12 | 0 | Field presence, types, backward compat |
| 9 | Dietary Handling | 6 | 4 | Restrictions, conflicts, fallback |
| 10 | Edge Cases | 10 | 6 | Empty input, injection, long input, concurrent |
| 11 | Two-Phase Scoring | 6 | 0 | Phase 1→2 enhancement, Google timeout |
| 12 | Rejection Patterns | 5 | 6 | Pattern detection, avoidance, no overcorrect |
| 13 | RPC & Database | 8 | 0 | Column validation, filters, tiebreaker |
| 14 | Frontend Rendering | 10 | 0 | Score tiers, labels, factor dims, V4 keys |
| 15 | Data Quality | 8 | 0 | Deep profiles, tips format, scores range |
| **TOTAL** | | **170** | **44** | |

### Agent-to-Category Mapping

| Agent | Primary Categories | Secondary |
|-------|-------------------|-----------|
| ATLAS | 1 (Intent), 4 (Weights), 6 (Try Another) | 12 (Rejection) |
| QAUDIT | 7 (Blurb Quality), 5 (Score Accuracy) | 8 (Contract) |
| SENTINEL | 6 (Try Another), 4 (Weights) | 5 (Accuracy) |
| HUNTER | 9 (Dietary), 10 (Edge Cases), 8 (Contract) | 12 (Rejection) |
| GUARDIAN | 13 (RPC/DB), 15 (Data Quality), 14 (Frontend) | 11 (Two-Phase) |

---

## 7. Benchmark-200

**File**: `tests/benchmark-200.sh`
**Structure**: 10 categories x 20 queries = 200 test cases

| Category | Example Queries |
|----------|----------------|
| Cuisine Classics | Italian, Mexican, Chinese, Japanese, Thai... |
| Chicago Icons | Italian beef, deep dish, tavern-style pizza... |
| Vibe Searches | Romantic, rooftop, cozy, trendy, late night... |
| Occasion | Date night, business lunch, birthday, group... |
| Dietary | Vegan, gluten-free, halal, kosher... |
| Neighborhood | Wicker Park, Lincoln Park, West Loop, Logan Square... |
| Price Level | Cheap eats, mid-range, upscale, splurge... |
| Service Style | Quick service, tasting menu, BYOB, takeout... |
| Contextual | Pre-game dining, brunch, after-theater, late night... |
| Reputation | Michelin, best of, award-winning, famous... |

---

## 8. Chicago-Specific Taxonomy

**File**: `scripts/data/taxonomy/chicago-specific.json`

### Chicago Dishes (18)
Italian beef, deep dish, Chicago hot dog, tavern-style pizza, jibaritos, gym shoe sandwich, mother-in-law sandwich, Maxwell Street Polish, South Side rib tips, breaded steak sandwich, paczki, kolaczki, rainbow cone, Garrett Mix, Chicago mix popcorn, Italian lemonade, Chicago cheesesteak, celery salt

### Chicago Restaurant Comparisons (9)
like Portillo's, like Lou Malnati's, like Giordano's, Portillo's alternative, better than Alinea, like Girl and the Goat, like Parachute, like Smyth, like Ever

### Chicago Events & Locations (18)
dinner before Bulls/Bears/Cubs/Sox/Hawks game, food near United Center, Wrigley Field, Soldier Field, Navy Pier, Millennium Park, Art Institute, Field Museum, Restaurant Week, Taste of Chicago, concert dining, The Bear TV show

### Chicago Cultural Food Corridors (8)
Devon Avenue (Indian/Pakistani), Argyle Street (Vietnamese/Chinese), Chinatown dim sum, Pilsen Mexican, Little Village tacos, Greektown, Albany Park (Korean/Middle Eastern), Uptown Vietnamese

---

## 9. Scoring Thresholds & Metrics

### DondeMatch Score Tiers

| Range | Tier | Agent Action |
|-------|------|-------------|
| 90-99 | Outstanding | Celebrate (gold star in log) |
| 80-89 | Strong Pick | Pass (excellent) |
| 70-79 | Solid Option | Pass |
| 60-69 | Worth a Try | Pass (marginal) |
| 50-59 | Below Threshold | Warn |
| 40-49 | Weak | Flag as gap |
| < 40 | Critical | Flag as P1 gap + notification |
| 0 | API Error | Flag as P0 + immediate notification |

### Pass Criteria

| Metric | Threshold | Action if Below |
|--------|-----------|-----------------|
| Overall Pass Rate | >= 80% | SENTINEL alerts |
| Golden Dataset Pass Rate | >= 85% | SENTINEL regression flag |
| API Success Rate | >= 99% | HUNTER P0 alert |
| Blurb Grade | >= B | QAUDIT flag |
| Data Integrity | 100% | GUARDIAN P0 alert |

### Gamification Scoring

| Event | XP Awarded |
|-------|-----------|
| Query passes (DM >= 60) | +10 XP |
| Query excellent (DM >= 80) | +25 XP |
| Query outstanding (DM >= 90) | +100 XP |
| Gap detected & classified | +15 XP |
| Blurb audit clean (grade A) | +20 XP |
| Regression caught | +50 XP |
| Edge case survived | +30 XP |
| Data integrity check clean | +10 XP |
| Level up threshold | 500 XP |

### HP (Health Points) Calculation

```
Agent HP = passRate × 100
  >= 90%: Full HP (green bar)
  >= 70%: High HP (green bar)
  >= 50%: Medium HP (amber bar)
  < 50%: Low HP (red bar, flashing)
  0%: Dead (skull icon, notification to CEO)
```

---

## 10. API Budget Management

### Daily Budget: 50 calls

| Agent | Allocation | Priority |
|-------|-----------|----------|
| ATLAS | 20 | High — primary quality signal |
| SENTINEL | 15 | High — regression detection |
| HUNTER | 10 | Medium — edge case coverage |
| GUARDIAN | 5 | Low — mostly DB queries |
| QAUDIT | 0 | N/A — analyzes existing data |
| **TOTAL** | **50** | |

### Budget Rules

1. Budget resets at midnight UTC
2. Each agent tracks its own usage against allocation
3. When agent hits allocation limit, it enters BUDGET_PAUSED state
4. Agent can request additional calls via notification to CEO
5. CEO can Approve (grants +N calls), Deny (stays paused), or Defer (ask again in 1 hour)
6. Emergency override: if API errors detected, HUNTER gets +5 bonus calls automatically
7. Unused calls do NOT roll over

### Budget Request Format

```json
{
  "type": "budget_request",
  "agent": "ATLAS",
  "current_used": 20,
  "requested_additional": 10,
  "reason": "Tier 2 coverage: 42 untested cuisine queries remain",
  "priority": "medium",
  "timestamp": "2026-03-08T14:30:00Z"
}
```

---

## 11. Notification & Escalation Protocol

### Notification Types

| Type | Severity | Trigger | Action Required |
|------|----------|---------|-----------------|
| Budget Request | Medium | Agent hits daily allocation | Approve / Deny / Defer |
| API Error (P0) | Critical | HTTP error or DM=0 | Investigate immediately |
| Regression Detected | High | DM dropped >5 from baseline | Review delta report |
| Achievement | Info | Agent levels up or milestone hit | Celebrate |
| Cycle Complete | Low | Agent finishes full cycle | Acknowledge |
| System Alert | Critical | Orchestrator error or crash | Restart system |

### Escalation Chain

```
1. Notification appears in dashboard notification bar
2. If unacknowledged after 5 minutes → notification flashes
3. If unacknowledged after 15 minutes → sound alert (if enabled)
4. P0 notifications → always flash + sound
```

---

## 12. Dashboard Interaction Model

### Controls

| Button | Action | Visual Feedback |
|--------|--------|-----------------|
| START (▶) | Launch all agents | Green glow, "READY? GO!" flash |
| PAUSE (⏸) | Freeze all agents at current state | Amber blink, "PAUSED" overlay |
| STOP (■) | Graceful shutdown | Red flash, "GAME OVER" ASCII splash |

### State Machine

```
IDLE → [START] → RUNNING → [PAUSE] → PAUSED → [START] → RUNNING
                    ↓                              ↓
                 [STOP]                          [STOP]
                    ↓                              ↓
                  IDLE ←───────────────────────── IDLE
```

### Dashboard Polling

- Polls `agent-status.json` every 3 seconds when RUNNING
- Polls every 10 seconds when PAUSED
- No polling when IDLE
- Updates all agent cards, battle log, leaderboard, budget bar on each poll

---

## 13. File Inventory

### Test Data Files

| File | Size | Description |
|------|------|-------------|
| `tests/search-atlas-v1.jsonl` | ~375 lines | Tier 1 search atlas |
| `tests/gauntlet-results/run-*.jsonl` | Varies | Per-run results |
| `tests/gauntlet-results/dashboard-data.json` | ~15KB | Aggregated dashboard data |
| `tests/gauntlet-results/agent-status.json` | ~2KB | Live agent status (polled by dashboard) |
| `tests/gauntlet-results/notification-queue.json` | ~1KB | Pending notifications |

### Test Scripts

| File | Lines | Description |
|------|-------|-------------|
| `tests/gauntlet.sh` | 138 | Gauntlet orchestrator |
| `tests/golden-dataset-test.sh` | ~400 | Golden dataset runner |
| `tests/benchmark-200.sh` | ~600 | 200-case benchmark |
| `tests/regression-guard.sh` | ~200 | Baseline comparator |
| `tests/test_catalog.sh` | ~800 | 65-scenario catalog |
| `tests/TEST-FULL.md` | 650 | 170-scenario agent spec |

### Agent Pipeline Files

| File | Description |
|------|-------------|
| `scripts/pipelines/agent-orchestrator.ts` | Main lifecycle manager |
| `scripts/pipelines/agents/atlas-runner.ts` | ATLAS agent |
| `scripts/pipelines/agents/quality-auditor.ts` | QAUDIT agent |
| `scripts/pipelines/agents/sentinel.ts` | SENTINEL agent |
| `scripts/pipelines/agents/edge-hunter.ts` | HUNTER agent |
| `scripts/pipelines/agents/data-guardian.ts` | GUARDIAN agent |

### Dashboard Files

| File | Description |
|------|-------------|
| `dondeAI/arcade-ops.html` | CEO command center |
| `dondeAI/css/arcade-ops.css` | 90s arcade theme |
| `dondeAI/js/arcade-ops.js` | Dashboard logic |

---

*Generated: 2026-03-08 | ARCADE OPS v1.0*
