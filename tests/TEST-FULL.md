# DondeAI Test Suite — FULL (Comprehensive Validation)

> **Run:** `claude -p "$(cat dondeBackend/tests/TEST-FULL.md)"` from parent of both repos
> **When:** Before major releases, after enrichment runs, after scoring engine changes
> **Target:** ~60 API calls max, ~170 test scenarios, < 10 minutes wall clock
> **Pass gate:** 100% PASS on critical, < 5% WARN, 0 FAIL
> **Replaces:** Legacy 83-scenario test catalog (T01–T83)

---

## System Context

You are the **DondeAI QA Lead Agent** — the most thorough testing agent for the Donde restaurant recommendation system. You have access to the full codebase, Supabase backend, and must validate EVERY aspect of the system spec.

Read these files before doing anything else:
1. `dondeBackend/donde-match-system-v4.0.md` — Full system spec (scoring, weights, blurbs, schema)
2. `dondeBackend/supabase/functions/recommend/_shared/scoring-v4.ts` — Geometric mean scoring engine
3. `dondeBackend/supabase/functions/recommend/_shared/weight-config.ts` — Dynamic weight rules
4. `dondeBackend/supabase/functions/recommend/_shared/intent-classifier.ts` — Intent parsing + confidence
5. `dondeBackend/supabase/functions/recommend/_shared/scoring.ts` — Blurb generation + Claude prompts
6. `dondeBackend/supabase/functions/recommend/_shared/scoring-v3.ts` — Factor computation functions (reused by V4)
7. `dondeBackend/supabase/functions/recommend/index.ts` — Orchestration + post-Google re-rank
8. `dondeBackend/supabase/functions/recommend/_shared/response-builder.ts` — API response construction
9. `dondeBackend/supabase/functions/recommend/_shared/types.ts` — All type definitions
10. `dondeAI/js/app.js` — Frontend rendering logic
11. `dondeAI/js/utils.js` — Score tiers, color logic, helper functions
12. `dondeAI/js/animations.js` — Factor display, confidence badges, celebrations
13. `dondeAI/css/components.css` — Weight chip, confidence badge, tile styles

After reading all files, perform a gap analysis against the legacy test catalog (T01–T83, 306 checks). Remove obsolete tests that reference V3-only logic (pre-geometric mean), update tests that reference old thresholds, and add all new tests below. Then execute.

---

## Test Execution Protocol

```
INITIALIZE:
  READ all source files listed above
  BUILD test registry from this document
  DETECT environment (Supabase URL, API endpoint)
  CREATE results accumulator

FOR cycle = 1 TO 5:
  RUN all test categories in order (1 → 15)
  CAPTURE results as {id, name, category, severity: CRITICAL|MAJOR|MINOR, status: PASS|FAIL|WARN, details, cycle, api_call_id}

  COMPUTE:
    pass_rate = PASS / total
    critical_fails = count(FAIL where severity=CRITICAL)

  IF pass_rate === 1.0 → STOP, report success
  IF critical_fails === 0 AND pass_rate > 0.95 → STOP, report with warnings

  IF any FAIL:
    GROUP failures by root cause
    FOR each root cause:
      ANALYZE source code for bug
      IF fix is safe (< 10 lines, single file, non-breaking, has clear spec basis):
        APPLY fix
        LOG fix to changelog
      ELSE:
        LOG as "requires manual fix" with diagnosis
    CONTINUE to next cycle

AFTER all cycles:
  WRITE tests/full-results-{timestamp}.json (structured)
  WRITE tests/full-results-{timestamp}.md (human readable)
  WRITE tests/full-changelog-{timestamp}.md (all fixes applied)
  PRINT summary to console
```

---

## FULL Test Catalog (170 scenarios across 15 categories)

---

### Category 1: INTENT CLASSIFICATION (18 scenarios, 6 API calls)

> **Strategy:** 6 carefully designed inputs that together cover ALL intent signals from the spec (§2.1). Each response validates multiple parsing paths.

**F-IC-01: Cuisine-dominant input**
```json
{"special_request": "authentic Sichuan mapo tofu, really spicy", "occasion": "Any", "neighborhood": "Anywhere", "price_level": "Any"}
```
Assert:
- [ ] `cuisine_type` of result relates to Chinese/Sichuan
- [ ] `weight_shift_reasons` references cuisine importance
- [ ] `weights_used.food_quality` > 0.35 (high cuisine importance: FQ +0.15)
- [ ] Response includes flavor-related context in blurb

**F-IC-02: Vibe-dominant input**
```json
{"special_request": "somewhere cozy and intimate with dim lighting, perfect for conversation", "occasion": "Date Night", "neighborhood": "Anywhere", "price_level": "Any"}
```
Assert:
- [ ] `weights_used.vibe` > 0.25 (Date Night VB +0.10)
- [ ] Restaurant's `noise_level` is "quiet" or "moderate"
- [ ] Restaurant's `lighting_ambiance` is "dim" or "moderate"
- [ ] Blurb references atmosphere/vibe
- [ ] `weight_shift_reasons` includes Date Night

**F-IC-03: Convenience-dominant input**
```json
{"special_request": "quick bite near me, no reservation needed", "occasion": "Solo Dining", "neighborhood": "Anywhere", "price_level": "$"}
```
Assert:
- [ ] `weights_used.convenience` > 0.25 (Solo +0.10 + Price sensitive +0.10, capped)
- [ ] `weights_used.service` < 0.15 (Solo: SV -0.10)
- [ ] Restaurant's `reservation_difficulty` is "walk-in" or "recommended"

**F-IC-04: Multi-signal input with emotional intent**
```json
{"special_request": "impressive steakhouse for a big celebration, need to wow my guests", "occasion": "Special Occasion", "neighborhood": "Anywhere", "price_level": "$$$$"}
```
Assert:
- [ ] `weights_used.reputation` elevated (impress: RP +0.05)
- [ ] `weights_used.vibe` elevated (Special Occasion: VB +0.10)
- [ ] `weight_shift_reasons` array length >= 2
- [ ] Restaurant `price_level` is "$$$" or "$$$$"

**F-IC-05: Contradictory signals**
```json
{"special_request": "cheap fine dining", "occasion": "Treat Myself", "neighborhood": "Anywhere", "price_level": "$"}
```
Assert:
- [ ] Response still succeeds (no crash on contradictions)
- [ ] System prioritizes explicit `price_level` filter over "fine dining" signal
- [ ] Score reflects some tension (not artificially high)

**F-IC-06: Ultra-short input (cold-start)**
```json
{"special_request": "hmm", "occasion": "Any", "neighborhood": "Anywhere", "price_level": "Any"}
```
Assert:
- [ ] Response succeeds
- [ ] Weights approximately equal to base weights (tolerance ±0.03)
- [ ] Blurb surfaces assumptions (e.g., "casual dinner" or equivalent framing)
- [ ] `scoring_v4.confidence` has multiple "low" or "medium" values

**F-IC-07–18: Parsed signal validation** (from the 6 responses above, 0 additional calls)
- [ ] F-IC-07: `confidence` object present with keys: food_quality, vibe, service, reputation, convenience
- [ ] F-IC-08: Each confidence value is one of: "high", "medium", "low"
- [ ] F-IC-09: Vague input (F-IC-06) has `confidence.overall` or majority of factors at "low"
- [ ] F-IC-10: Specific input (F-IC-01) has `confidence.food_quality` at "high"
- [ ] F-IC-11: All `weights_used` values are > 0 and sum to 1.0
- [ ] F-IC-12: No weight exceeds 0.60 (upper clamp)
- [ ] F-IC-13: No weight below 0.05 (lower clamp)
- [ ] F-IC-14: `data_completeness` is present and between 0.0–1.0 for all responses
- [ ] F-IC-15: `factor_details` has at least one sub-object for each response
- [ ] F-IC-16: For F-IC-04, `scoring_v4.weights_used.reputation` > base 0.15
- [ ] F-IC-17: For F-IC-03, `scoring_v4.weights_used.food_quality` < base 0.30 (Solo FQ stays, but price_sensitive FQ -0.05)
- [ ] F-IC-18: Weight shifts are additive (stacking multiple triggers increases shift)

---

### Category 2: SCORING ENGINE — UNIT TESTS (20 scenarios, 0 API calls)

> **Strategy:** Import and directly test scoring functions. Zero API calls.

#### 2A: Geometric Mean Formula (6 tests)

**F-GM-01: Spec worked example A** — FQ=9,VB=8,SV=8,RP=7,CV=8 @ date weights → ≈87
**F-GM-02: Spec worked example B** — FQ=10,VB=10,SV=2,RP=8,CV=10 @ date weights → ≈66
**F-GM-03: Spec worked example C** — All 5s @ base weights → 50
**F-GM-04: All 10s** → Score = 100
**F-GM-05: All 1s (floor)** → Score = 10
**F-GM-06: Single weak factor** — FQ=9,VB=9,SV=9,RP=1,CV=9 → GM punishes the 1 proportionally to its weight

#### 2B: Factor Floor (3 tests)

**F-FL-01:** Input FQ=0 → floored to 1.0 before GM
**F-FL-02:** Input FQ=-2 (invalid) → floored to 1.0
**F-FL-03:** Input FQ=0.5 → floored to 1.0

#### 2C: Confidence Regression (5 tests)

**F-CR-01:** raw=9.0, high → 9.0
**F-CR-02:** raw=9.0, medium → 8.125
**F-CR-03:** raw=9.0, low → 7.25
**F-CR-04:** raw=1.0, low → 1.0 × 0.5 + 5.5 × 0.5 = 3.25
**F-CR-05:** raw=5.5, any → 5.5 (regression target is identity)

#### 2D: Weight System (6 tests)

**F-WS-01:** Base weights sum to 1.0: 0.30+0.20+0.20+0.15+0.15 = 1.0
**F-WS-02:** Date Night shift: VB→0.30, SV→0.25, CV→0.05, FQ→0.25, RP→0.15 → normalize → sum = 1.0
**F-WS-03:** All shifts stacked (Date Night + High Cuisine + Impress) → clamp [0.05, 0.60] → normalize → sum = 1.0
**F-WS-04:** Business Lunch: SV +0.10, VB +0.05, CV -0.05, FQ -0.10 → validate all shifts applied
**F-WS-05:** Family Dinner: SV +0.05, CV +0.10, VB -0.10, RP -0.05 → validate
**F-WS-06:** Spontaneous + Price Sensitive stacking: CV gets +0.10 +0.10 = +0.20 → clamped to 0.35 max? Verify normalization

---

### Category 3: FIVE FACTOR COMPUTATION (15 scenarios, 0 API calls)

> **Strategy:** Unit-test each factor's sub-criteria computation from `scoring-v3.ts` functions.

#### 3A: Food Quality Factor

**F-FQ-01:** Perfect cuisine match → cuisine alignment = 6/6
**F-FQ-02:** No cuisine match → cuisine alignment = 0/6
**F-FQ-03:** Flavor profile match with 2/3 flavors → 1.33/2
**F-FQ-04:** Dietary fit — restaurant has "vegan", user wants "vegan" → dietary = 2/2
**F-FQ-05:** Dietary dealbreaker — user needs "gluten free", restaurant has none → penalty absorbed into FQ

#### 3B: Vibe Factor

**F-VB-01:** Quiet restaurant + "intimate" vibe keyword → noise match high
**F-VB-02:** Loud restaurant + "intimate" → noise mismatch, lower score
**F-VB-03:** Cold-start (no vibe data) → returns 4.0
**F-VB-04:** Adaptive normalization — only scores layers that have data (not all 6 sub-criteria)
**F-VB-05:** Music vibe alignment — "live" music_vibe + "live music" vibe keyword → bonus

#### 3C: Service Factor

**F-SV-01:** Date Night occasion → date_friendly_score drives base (0-7, power-stretched)
**F-SV-02:** Service style alignment — full service + Date Night → positive alignment
**F-SV-03:** Kid-friendliness in Family Dinner → contributes to social dynamics

#### 3D: Reputation Factor

**F-RP-01:** Google rating 4.5 with 500 reviews → high confidence, score near 4.5
**F-RP-02:** Google rating 4.5 with 5 reviews → low confidence, regresses toward 2.5
**F-RP-03:** No Google data (Phase 1 ranking) → defaults to 2.5/5 with low confidence

#### 3E: Convenience Factor

**F-CV-01:** Walk-in + no wait → high convenience score
**F-CV-02:** Price mismatch (user wants $, restaurant is $$$$) → penalty absorbed
**F-CV-03:** Neighborhood mismatch → penalty absorbed

---

### Category 4: DYNAMIC WEIGHT MATRIX (12 scenarios, 7 API calls)

> **Strategy:** One API call per occasion to verify weight fingerprints match the spec table in §1.3.

**F-DW-01: Date Night**
Assert: VB > 0.25, SV > 0.20, CV < 0.15, FQ < 0.30

**F-DW-02: Business Lunch**
Assert: SV > 0.25, VB > 0.20, CV < 0.15, FQ < 0.25

**F-DW-03: Adventure**
Assert: RP > 0.20, FQ < 0.30, SV < 0.20

**F-DW-04: Family Dinner**
Assert: SV > 0.20, CV > 0.20, VB < 0.15, RP < 0.15

**F-DW-05: Solo Dining**
Assert: CV > 0.20, FQ > 0.30, SV < 0.15, VB < 0.20

**F-DW-06: Treat Myself**
Assert: FQ > 0.30, VB > 0.20, CV < 0.10

**F-DW-07: Chill Hangout**
Assert: VB > 0.25, CV > 0.15, FQ < 0.25, RP < 0.15

**F-DW-08–12: Cross-occasion weight invariants** (from 7 responses, 0 additional calls)
- [ ] F-DW-08: Every response's weights sum to 1.0 ±0.001
- [ ] F-DW-09: No weight < 0.05 in any response
- [ ] F-DW-10: No weight > 0.60 in any response
- [ ] F-DW-11: Date Night VB > Chill Hangout VB (Date gets VB+SV, Chill gets VB+CV)
- [ ] F-DW-12: Business Lunch SV is the highest or second-highest weight

---

### Category 5: SCORE ACCURACY CROSS-VALIDATION (8 scenarios, 0 API calls — reuse Cat 4 responses)

> **Strategy:** For ALL 7 responses from Category 4, verify mathematical consistency.

**F-XA-01–07: GM verification per response**
For each of the 7 responses:
- Compute: `GM = (FQ^W_fq × VB^W_vb × SV^W_sv × RP^W_rp × CV^W_cv) × 10`
- Assert: `|donde_match - GM| <= 3` (tolerance for confidence adjustment + Google data)

**F-XA-08: Score distribution sanity**
- Across all 7 responses, assert: at least 2 different score tiers represented
- No more than 5 responses in the same 10-point band (anti-clustering check)

---

### Category 6: TRY ANOTHER — MONOTONICITY & DIVERSITY (12 scenarios, 15 API calls)

> **Strategy:** 5 query chains × 3 calls = 15 API calls. Tests the post-Google re-rank fix.

**F-TA-01: "Italian dinner" / Date Night × 3** — Assert monotonic non-increasing scores
**F-TA-02: "sushi" / Adventure × 3** — Assert monotonic
**F-TA-03: "cheap eats" / Chill × 3** — Assert monotonic
**F-TA-04: "steakhouse" / Business × 3** — Assert monotonic
**F-TA-05: "tacos" / Solo × 3** — Assert monotonic

**F-TA-06: No duplicate restaurants** across any chain
**F-TA-07: Exclusion list respected** — excluded IDs never reappear
**F-TA-08: Score deltas reasonable** — no drop > 25 points between consecutive calls
**F-TA-09: Cuisine consistency** — within a chain, results should be same or related cuisine
**F-TA-10: Blurb variety** — no two blurbs in a chain share >50% of words (anti-template check)
**F-TA-11: Chain-3 still viable** — third result still has score > 30 (not scraping bottom)
**F-TA-12: Weight stability** — same query gets same weights across chain (weights depend on input, not restaurant)

---

### Category 7: BLURB GENERATION — COMPREHENSIVE (20 scenarios, 0 API calls — reuse all prior)

> **Strategy:** Validate blurb quality across ALL captured responses (6 + 7 + 15 = 28 responses available).

#### 7A: Hard Requirements (8 tests — CRITICAL severity)

**F-BL-01: Word count 60-100** — ALL blurbs
**F-BL-02: No slop patterns** — Check all 40+ banned words from spec §4.4
Full banned list to check:
`culinary, gastronomic, nestled, elevate, elevated, transcend, artisan, artisanal, delectable, exquisite, tantalizing, delightful, impeccable, unparalleled, diverse menu, wide array, burst of flavor, hidden gem, taste buds, food lovers, every bite, must-visit, not disappoint, something for everyone, where tradition meets, beckons, invites you, promises, journey, tapestry, crafted with, fusion of, symphony of, palette, indulge, savor every, culinary journey, dining experience, perfectly, masterfully, beautifully, stunningly`

**F-BL-03: No em dashes** — zero Unicode em dash (U+2014) in ANY blurb
**F-BL-04: No structural tells** — "Ah,", "Oh,", "Whether...or...", "If you're looking for..."
**F-BL-05: "We" voice** — at least one "we"/"We"/"our" per blurb
**F-BL-06: Restaurant name present** — every blurb names the restaurant
**F-BL-07: No hallucinated cuisine** — blurb's cuisine references match `restaurant.cuisine_type`
**F-BL-08: Single paragraph** — no line breaks within blurb (it's a paragraph, not a list)

#### 7B: Tone Calibration (6 tests — MAJOR severity)

**F-BL-09: Outstanding tone (85+)** — declarative, confident, "This is the one" energy
Assert: No hedging words ("might", "could be", "if you")
**F-BL-10: Excellent tone (70-84)** — confident with honest trade-off
Assert: May mention one minor gap
**F-BL-11: Solid Pick tone (55-69)** — measured, 1-2 strong factors highlighted
Assert: Does mention a gap or trade-off
**F-BL-12: Worth a Try tone (<55)** — leads with genuine positive, names gap
Assert: Contains a qualifier
**F-BL-13: Tone-score alignment** — for all responses, blurb positivity correlates with score
**F-BL-14: No overselling low scores** — if score < 55, blurb should NOT say "perfect" or "ideal"

#### 7C: Contextual Grounding (6 tests — MAJOR severity)

**F-BL-15: Weight-awareness** — if `weight_shift_reasons` non-empty, at least 30% of blurbs reference the context
**F-BL-16: Cuisine specificity** — blurb mentions specific dish or cuisine detail (not just "great food")
**F-BL-17: Neighborhood grounding** — for neighborhood-filtered queries, at least some blurbs mention the area
**F-BL-18: Insider tip echo** — blurb draws from restaurant's data (not generic praise)
**F-BL-19: Occasion relevance** — Date Night blurbs mention romance/ambiance; Business blurbs mention service/professional
**F-BL-20: Cuisine mismatch honesty** — if cuisine doesn't match query, blurb pivots honestly without apology

---

### Category 8: API RESPONSE CONTRACT (12 scenarios, 0 API calls — reuse)

**F-RC-01: Top-level fields** — `success`, `restaurant`, `recommendation`, `insider_tip`, `donde_match`, `scores`, `tags`, `deep_context`, `scoring_v2`, `scoring_v3`, `scoring_v4`, `cuisine_mismatch`, `timestamp`
**F-RC-02: Restaurant object** — all 17+ fields from spec §7.2 present (id, name, address, google_place_id, google_rating, google_review_count, price_level, phone, website, noise_level, cuisine_type, lighting_ambiance, dress_code, outdoor_seating, live_music, pet_friendly, parking_availability, dietary_options, neighborhood_name, photo_urls, opening_hours, review_snippets, sentiment fields)
**F-RC-03: scoring_v4 complete** — 5 factors + weights_used + weight_shift_reasons + confidence + data_completeness + factor_details
**F-RC-04: scoring_v3 backward compat** — food_match, setting_fit, atmosphere, reputation, convenience mapped correctly
**F-RC-05: V3↔V4 mapping** — `scoring_v3.food_match ≈ scoring_v4.food_quality`, `scoring_v3.setting_fit ≈ scoring_v4.service`, `scoring_v3.atmosphere ≈ scoring_v4.vibe`
**F-RC-06: Google data** — `restaurant.google_rating` (number 1-5), `restaurant.google_review_count` (integer > 0)
**F-RC-07: Sentiment in restaurant** — `restaurant.sentiment_score`, `restaurant.sentiment_positive`, `restaurant.sentiment_negative`, `restaurant.sentiment_neutral`, `restaurant.sentiment_breakdown`, `restaurant.sentiment_summary` all present
**F-RC-08: Tags array** — `tags` is array of strings, length >= 1
**F-RC-09: donde_match** — integer 0-99
**F-RC-10: timestamp** — valid ISO 8601 format
**F-RC-11: Restaurant ID** — valid UUID format
**F-RC-12: No null critical fields** — name, address, cuisine_type, price_level never null

---

### Category 9: DIETARY & RESTRICTION HANDLING (6 scenarios, 4 API calls)

**F-DR-01: Single restriction — vegan**
```json
{"special_request": "dinner", "occasion": "Any", "dietary_restrictions": ["vegan"], "neighborhood": "Anywhere", "price_level": "Any"}
```
Assert: restaurant has "vegan" in dietary_options OR food_quality reflects accommodation

**F-DR-02: Multiple restrictions — gluten free + vegan**
Assert: system handles gracefully, doesn't crash, FQ reflects tension

**F-DR-03: Conflicting restriction + craving — "vegan steakhouse"**
Assert: System resolves conflict, returns result, FQ score reflects mismatch

**F-DR-04: Rare restriction — "halal"**
Assert: System handles non-standard restriction gracefully

**F-DR-05: Graceful fallback** — if no restaurants match dietary, system should widen search (from spec §3.1 step 5)
**F-DR-06: Dietary penalty in FQ** — verify dietary mismatch lowers food_quality factor, not other factors

---

### Category 10: EDGE CASES & ERROR HANDLING (10 scenarios, 6 API calls)

**F-EC-01: Empty special_request** — `""` → succeeds with base weights
**F-EC-02: Very long special_request** — 500+ character input → no crash, reasonable parse
**F-EC-03: Special characters** — `"café résumé naïve"` → no encoding errors
**F-EC-04: SQL injection attempt** — `"'; DROP TABLE restaurants; --"` → safe, returns normal result
**F-EC-05: All filters + all restrictions** — maximum filter combination → succeeds or graceful "no results"
**F-EC-06: Invalid neighborhood** — `"Mars"` → falls back to Anywhere or error message

**F-EC-07: Heavy exclusion list (10+ IDs)** — still returns result
**F-EC-08: Duplicate exclusion IDs** — doesn't crash
**F-EC-09: Non-existent exclusion UUID** — gracefully ignored
**F-EC-10: Concurrent requests** — if testable, send 3 simultaneous requests → all return valid

---

### Category 11: TWO-PHASE SCORING (6 scenarios, 0 API calls — code review + reuse)

> **Strategy:** Validate the Phase 1 → Phase 2 scoring architecture from spec §3.2.

**F-TP-01: Phase 1 defaults** — `reRankV4()` uses reputation default 2.5 with low confidence
**F-TP-02: Phase 2 enhancement** — after Google data, reputation factor can jump to 4.5+
**F-TP-03: Post-Google re-rank** — verify `index.ts` sorts by final scores after Google data insertion (step 12)
**F-TP-04: Google timeout handling** — if Google API times out (1.5s), system continues with Phase 1 scores
**F-TP-05: Prelim scores array** — `prelimScores[]` computed for top 5 candidates with Google data
**F-TP-06: Score can only increase** — Phase 2 score should generally be >= Phase 1 score (more data = less regression)

---

### Category 12: REJECTION PATTERN ANALYSIS (5 scenarios, 6 API calls)

> **Strategy:** Test the rejection analysis system (spec §3.1 step 6).

**F-RJ-01: Single rejection — no pattern analysis**
```json
{"special_request": "Italian", "occasion": "Date Night", "exclude": ["id_from_F-TA-01-call-1"]}
```
Assert: No avoidCuisines or avoidPriceLevels applied

**F-RJ-02: Two rejections — pattern triggers** (need chain of 3)
Use a chain where first two results are same cuisine:
Assert after 3rd call: system may detect cuisine avoidance pattern

**F-RJ-03: Price rejection pattern**
Reject two expensive restaurants, assert third is lower price

**F-RJ-04: Disliked restaurant never returns**
Reject a restaurant, then send 3 more queries. Assert it never reappears.

**F-RJ-05: Rejection pattern doesn't overcorrect**
After 2 rejections, system should still return good results (score > 40)

---

### Category 13: RPC & DATABASE LAYER (8 scenarios, 0 API calls — direct Supabase queries)

> **Strategy:** Validate the `get_ranked_restaurants` RPC and data integrity directly.

**F-DB-01: RPC returns correct columns** — verify all 49 return columns exist
**F-DB-02: noise_level filter** — RPC excludes restaurants with NULL noise_level
**F-DB-03: is_active filter** — RPC excludes `is_active = false` restaurants
**F-DB-04: Neighborhood filter** — `p_neighborhood = 'Wicker Park'` only returns Wicker Park restaurants
**F-DB-05: Price filter** — `p_price_level = '$$'` only returns $$ restaurants
**F-DB-06: Cuisine boost** — `p_target_cuisine = 'Italian'` boosts Italian restaurants in ordering
**F-DB-07: Occasion mapping** — Date Night maps to `date_friendly_score`, Business maps to `business_lunch_score`, etc.
**F-DB-08: Random tiebreaker** — Two identical RPC calls return different orderings (random() works)

---

### Category 14: FRONTEND RENDERING (10 scenarios, 0 API calls — code review)

> **Strategy:** Validate frontend code directly matches spec §6.

**F-FR-01: Score tier thresholds** — utils.js: high >= 70, mid >= 50
**F-FR-02: Tier labels** — Outstanding/Excellent/Solid Pick/Worth a Try/Adventurous
**F-FR-03: Celebration threshold** — animations.js: triggers at >= 85
**F-FR-04: Factor dimensions** — FACTOR_DIMS has exactly 5 entries: food_quality, vibe, service, reputation, convenience
**F-FR-05: Factor labels** — "Food Quality", "Vibe", "Service", "Reputation", "Convenience"
**F-FR-06: Factor icons** — plate, music, diamond, starFull, clock
**F-FR-07: Weight chips** — L1 display shows XX% labels next to factor names
**F-FR-08: Confidence badges** — 6px dots: green=high, amber=medium, gray=low
**F-FR-09: V4 factor key usage** — app.js uses V4 keys (food_quality not food, service not setting, vibe not atmosphere)
**F-FR-10: scoring_v4 rendering** — app.js reads from `scoring_v4` not `scoring_v3` for primary display

---

### Category 15: ENRICHMENT & DATA QUALITY (8 scenarios, 0 API calls — Supabase queries)

> **Strategy:** Validate data quality standards from spec §5.

**F-DQ-01: No restaurants missing deep_profiles** — count(restaurants LEFT JOIN deep_profiles WHERE deep_profiles IS NULL) = 0
**F-DQ-02: Insider tips format** — all tips start with a verb ("Ask", "Grab", "Sit", "Try", "Order", "Request", "Get", "Skip", "Go")
**F-DQ-03: Insider tip length** — all tips 15-25 words
**F-DQ-04: Origin story length** — all origin_stories 2-4 sentences
**F-DQ-05: Enrichment confidence range** — all values 0.00-1.00
**F-DQ-06: Occasion scores range** — all scores 0-10, no NULLs
**F-DQ-07: Tag distribution** — every restaurant has >= 3 tags
**F-DQ-08: No orphaned records** — no deep_profiles, occasion_scores, or tags referencing non-existent restaurants

---

## API Call Budget Summary

| Category | API Calls | Scenarios | Severity Mix |
|----------|-----------|-----------|-------------|
| 1. Intent Classification | 6 | 18 | 6 critical, 12 major |
| 2. Scoring Engine | 0 | 20 | 20 critical |
| 3. Factor Computation | 0 | 15 | 15 critical |
| 4. Dynamic Weights | 7 | 12 | 7 critical, 5 major |
| 5. Score Accuracy | 0 (reuse) | 8 | 8 critical |
| 6. Try Another | 15 | 12 | 12 critical |
| 7. Blurb Quality | 0 (reuse) | 20 | 8 critical, 12 major |
| 8. Response Contract | 0 (reuse) | 12 | 12 critical |
| 9. Dietary Handling | 4 | 6 | 6 major |
| 10. Edge Cases | 6 | 10 | 4 critical, 6 major |
| 11. Two-Phase Scoring | 0 (code) | 6 | 6 major |
| 12. Rejection Patterns | 6 | 5 | 5 major |
| 13. RPC & Database | 0 (Supabase) | 8 | 8 critical |
| 14. Frontend Rendering | 0 (code) | 10 | 10 major |
| 15. Data Quality | 0 (Supabase) | 8 | 8 major |
| **TOTAL** | **44** | **170** | **89 critical, 81 major** |

*Buffer of 16 API calls for retry/fix cycles*

---

## Legacy Test Catalog Migration Guide

The following legacy tests (T01–T83) should be handled as follows:

### REMOVE (Obsolete — reference V3-only logic)
- T01–T10: V3 weight computation tests → replaced by F-WS-01–06
- T15–T20: Power-law scaling tests → replaced by F-GM-01–06 (geometric mean)
- T30–T35: Post-composite adjustment tests → REMOVED (adjustments no longer exist in V4)
- T45–T50: Claude relevance modulation → REMOVED (no longer in pipeline)

### UPDATE (Threshold/logic changes)
- T11–T14: Weight shift tests → replaced by F-DW-01–12 (now tests all 7 occasions + stacking)
- T60–T66: Blurb quality tests → replaced by F-BL-01–20 (expanded slop list, new tone tiers)
- T70–T75: Score tier tests → replaced by F-FR-01–02 (new thresholds: 85/70/55/40)
- T82: Em dash test → now F-BL-03 (critical, not warning)

### KEEP (Still valid, absorbed into new catalog)
- T40: Cuisine diversity → now F-TA-09
- T55–T63: Cuisine mapping → now F-IC-01 + F-FQ-01–02
- T67: "We" voice → now F-BL-05 (elevated to critical)
- T76–T80: Cuisine mismatch → now F-BL-20
- T83: Try Another monotonicity → now F-TA-01–05 (expanded from 2 to 5 chains)

---

## Results Output Format

Write to `tests/full-results-{YYYYMMDD-HHmmss}.md`:

```markdown
# FULL Test Results — {date}

## Executive Summary
- **Cycles Run:** {N} of 5
- **Final Pass Rate:** {X}% ({pass}/{total})
- **Critical Failures:** {N}
- **Major Failures:** {N}
- **Warnings:** {N}
- **API Calls Used:** {N} / 60 budget
- **Wall Clock Time:** {X}m {Y}s

## Results by Category

### Category 1: Intent Classification
| ID | Name | Severity | Status | Details |
|----|------|----------|--------|---------|
| F-IC-01 | Cuisine-dominant | CRITICAL | PASS | cuisine_type=Chinese, FQ weight=0.38 |
...

[repeat for all 15 categories]

## Fixes Applied
| Cycle | Test ID | Fix Description | File | Lines Changed |
|-------|---------|-----------------|------|---------------|
...

## Regression Risk Assessment
[List any fixes that could affect other parts of the system]

## Recommended Follow-ups
[Any WARN-level issues that should be addressed but aren't blocking]

## Final Verdict: {PASS | CONDITIONAL PASS | FAIL}
- PASS: 100% pass rate
- CONDITIONAL PASS: 0 critical fails, < 5% warnings
- FAIL: Any critical failure remaining after 5 cycles
```

Also write JSON to `tests/full-results-{YYYYMMDD-HHmmss}.json`:
```json
{
  "timestamp": "ISO-8601",
  "cycles_run": 3,
  "final_verdict": "PASS",
  "pass_rate": 1.0,
  "total_tests": 170,
  "passed": 170,
  "failed": 0,
  "warned": 0,
  "api_calls_used": 44,
  "wall_clock_seconds": 180,
  "categories": { "..." : "..." },
  "fixes_applied": [ "..." ],
  "all_results": [ "..." ]
}
```

---

## Agent Coordination Protocol

When running with the DondeAI agent team:

| Agent | Owns Categories | Responsibility |
|-------|----------------|----------------|
| **Testing Expert** (orchestrator) | ALL — orchestrates execution | Runs protocol, aggregates results, decides fix/continue |
| **Frontend Specialist** | 14 (Frontend Rendering) | Validates JS/CSS code against spec, reports to orchestrator |
| **Backend/DB Specialist** | 2 (Scoring Engine), 3 (Factors), 11 (Two-Phase), 13 (RPC/DB) | Unit tests scoring functions, validates DB queries |
| **UI/UX Expert** | 7 (Blurb Quality), reviews blurb tone | Evaluates blurb quality holistically beyond pattern matching |
| **Animation Expert** | 14.F-FR-03, 14.F-FR-07, 14.F-FR-08 | Validates celebration threshold, weight chips, confidence badges |

**Handoff protocol:**
1. Testing Expert reads all source files and distributes assignments
2. Each specialist runs their categories IN PARALLEL
3. Results flow back to Testing Expert in standard format
4. Testing Expert aggregates, identifies cross-category failures, triggers fix cycles
5. After fixes, ALL affected categories re-run (not just the fixed test)

---

## Appendix: Complete Banned Word List for Blurb Testing

```javascript
const BANNED_PATTERNS = [
  // AI slop — food
  "culinary", "gastronomic", "delectable", "exquisite", "tantalizing",
  "delightful", "mouthwatering", "scrumptious", "delish", "yummy",
  "palate", "palette", "taste buds", "flavor explosion", "burst of flavor",
  "symphony of flavors", "culinary journey", "dining experience",
  "food lovers", "every bite", "savor every",
  // AI slop — place
  "nestled", "tucked away", "hidden gem", "oasis", "haven",
  "beckons", "invites you", "welcomes you", "promises",
  "where tradition meets", "where...meets...",
  // AI slop — quality
  "impeccable", "unparalleled", "masterfully", "beautifully",
  "stunningly", "perfectly", "artisan", "artisanal", "handcrafted",
  "crafted with", "lovingly prepared",
  // AI slop — general
  "elevate", "elevated", "transcend", "journey", "tapestry",
  "diverse menu", "wide array", "something for everyone",
  "must-visit", "not disappoint", "won't disappoint",
  "fusion of", "indulge",
  // Structural tells
  "Ah,", "Oh,", "Whether you", "If you're looking",
  "Whether it's", "From...to..."
];
```
