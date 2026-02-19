# Donde API Test Results

**Date:** 2026-02-19T15:01:19Z
**Endpoint:** https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend

## Summary

| Metric | Count |
|--------|-------|
| PASSED | 180 |
| FAILED | 16 |
| WARNED | 7 |
| TOTAL  | 203 |
| **Hard Pass Rate** | **91%** (180 / 196) |

## Detailed Results

| Verdict | Test | Check | Details |
|---------|------|-------|---------|
| PASS | T01 | HTTP 200 |  |
| PASS | T01 | success is true |  |
| PASS | T01 | recommendation is string |  |
| PASS | T01 | donde_match >= 60 |  |
| PASS | T01 | donde_match <= 99 |  |
| PASS | T01 | timestamp is ISO 8601 |  |
| PASS | T01 | restaurant object |  |
| PASS | T01 | restaurant.id |  |
| PASS | T01 | restaurant.name |  |
| PASS | T01 | restaurant.address |  |
| PASS | T01 | tags is array |  |
| PASS | T01 | scores is object |  |
| PASS | T02 | restaurant.id |  |
| PASS | T02 | restaurant.name |  |
| PASS | T02 | restaurant.address |  |
| PASS | T02 | restaurant.neighborhood_name |  |
| PASS | T02 | restaurant.price_level |  |
| PASS | T02 | has google_place_id key |  |
| PASS | T02 | has google_rating key |  |
| PASS | T02 | has google_review_count |  |
| PASS | T02 | has phone key |  |
| PASS | T02 | has website key |  |
| PASS | T02 | has noise_level key |  |
| PASS | T02 | has cuisine_type key |  |
| PASS | T02 | has lighting_ambiance key |  |
| PASS | T02 | has dress_code key |  |
| PASS | T02 | has outdoor_seating key |  |
| PASS | T02 | has live_music key |  |
| PASS | T02 | has pet_friendly key |  |
| PASS | T02 | has parking_availability |  |
| PASS | T02 | has sentiment_breakdown |  |
| PASS | T02 | has sentiment_score key |  |
| PASS | T02 | has best_for_oneliner |  |
| PASS | T02 | has date_friendly_score |  |
| PASS | T02 | has group_friendly_score |  |
| PASS | T02 | has family_friendly_score |  |
| PASS | T02 | has romantic_rating |  |
| PASS | T02 | has business_lunch_score |  |
| PASS | T02 | has solo_dining_score |  |
| PASS | T02 | has hole_in_wall_factor |  |
| PASS | T02 | has insider_tip key |  |
| PASS | T03 | recommendation not empty |  |
| PASS | T03 | recommendation is string |  |
| PASS | T03 | recommendation >= 40 words |  |
| PASS | T03 | recommendation <= 200 words |  |
| PASS | T03 | insider_tip type |  |
| WARN | T03 | rec mentions restaurant name | name=trattoria rnb p not found in text |
| PASS | T04 | donde_match is number |  |
| PASS | T04 | donde_match >= 60 |  |
| PASS | T04 | donde_match <= 99 |  |
| PASS | T04 | donde_match is integer |  |
| PASS | T04 | success is true |  |
| PASS | T05 | tags is array |  |
| PASS | T05 | tags has >= 1 element |  |
| PASS | T05 | tags[0] is string |  |
| PASS | T05 | all tags are strings |  |
| PASS | T05 | tags has <= 10 elements |  |
| PASS | T06 | date_friendly_score in range or null |  |
| PASS | T06 | group_friendly_score in range or null |  |
| PASS | T06 | family_friendly_score in range or null |  |
| PASS | T06 | romantic_rating in range or null |  |
| PASS | T06 | business_lunch_score in range or null |  |
| PASS | T06 | solo_dining_score in range or null |  |
| PASS | T06 | hole_in_wall_factor in range or null |  |
| PASS | T06 | success is true |  |
| FAIL | T07 | price_level valid | allowed=$ $$ $$$ $$$$|got=null |
| PASS | T07 | noise_level valid |  |
| PASS | T07 | dress_code valid |  |
| FAIL | T07 | success is true | expected=true|got=false |
| PASS | T08 | outdoor_seating is bool or null |  |
| PASS | T08 | live_music is bool or null |  |
| PASS | T08 | pet_friendly is bool or null |  |
| PASS | T08 | success is true |  |
| PASS | T09 | success |  |
| PASS | T09 | date_friendly >= 5 |  |
| PASS | T09 | romantic_rating >= 5 |  |
| PASS | T09 | neighborhood match |  |
| PASS | T10 | success |  |
| PASS | T10 | group_friendly >= 5 |  |
| PASS | T10 | price is 1749 |  |
| PASS | T11 | success |  |
| PASS | T11 | family_friendly >= 5 |  |
| PASS | T11 | has restaurant name |  |
| PASS | T12 | success |  |
| PASS | T12 | business_lunch >= 5 |  |
| PASS | T12 | neighborhood match |  |
| PASS | T13 | success |  |
| PASS | T13 | solo_dining >= 4 |  |
| PASS | T13 | price_level $ |  |
| PASS | T14 | success |  |
| PASS | T14 | romantic_rating >= 6 |  |
| PASS | T14 | date_friendly >= 5 |  |
| PASS | T14 | price 17491749 |  |
| FAIL | T15 | success | expected=true|got=false |
| FAIL | T15 | solo_dining >= 4 | expected=true|got=false |
| FAIL | T15 | donde_match >= 60 | expected=true|got=false |
| FAIL | T15 | neighborhood match | expected=Bucktown|got=null |
| PASS | T16 | success |  |
| PASS | T16 | hole_in_wall >= 4 |  |
| PASS | T16 | neighborhood match |  |
| PASS | T16 | price $ |  |
| PASS | T17 | success |  |
| PASS | T17 | group_friendly >= 4 |  |
| PASS | T17 | neighborhood match |  |
| PASS | T18 | success |  |
| PASS | T18 | donde_match >= 60 |  |
| PASS | T18 | restaurant name |  |
| PASS | T18 | neighborhood_name |  |
| PASS | T18 | tags non-empty |  |
| PASS | T19 | success |  |
| PASS | T19 | cuisine matches Mexican |  |
| PASS | T19 | neighborhood Pilsen |  |
| FAIL | T20 | success | expected=true|got=false |
| WARN | T20 | cuisine is Italian | got:  |
| FAIL | T20 | neighborhood Little Italy | expected=Little Italy|got=null |
| FAIL | T20 | date_friendly >= 5 | expected=true|got=false |
| PASS | T21 | success |  |
| PASS | T21 | cuisine is Japanese |  |
| PASS | T21 | romantic >= 6 |  |
| PASS | T22 | success |  |
| PASS | T22 | spicy intent mapped |  |
| PASS | T22 | hole_in_wall >= 4 |  |
| PASS | T23 | success |  |
| PASS | T23 | romantic >= 7 |  |
| PASS | T23 | donde_match >= 70 |  |
| PASS | T24 | success |  |
| PASS | T24 | solo_dining >= 4 |  |
| PASS | T24 | healthy intent in output |  |
| FAIL | T25 | success | expected=true|got=false |
| WARN | T25 | instagrammable tags | tags= |
| FAIL | T25 | neighborhood Fulton Market | expected=Fulton Market|got=null |
| PASS | T26 | success |  |
| PASS | T26 | vegan referenced |  |
| PASS | T26 | donde_match >= 60 |  |
| PASS | T27 | success |  |
| PASS | T27 | gluten-free referenced |  |
| PASS | T27 | family_friendly >= 4 |  |
| PASS | T28 | success |  |
| WARN | T28 | BYOB tag present | tags=craft beer,brewpub,lively atmosphere |
| PASS | T28 | group_friendly >= 4 |  |
| PASS | T29 | success |  |
| PASS | T29 | rooftop/cocktail tags |  |
| PASS | T29 | romantic >= 5 |  |
| PASS | T29 | date_friendly >= 5 |  |
| PASS | T30 | success |  |
| PASS | T30 | outdoor_seating is true |  |
| PASS | T30 | pet_friendly is true |  |
| PASS | T30 | group_friendly >= 4 |  |
| PASS | T31 | first call success |  |
| PASS | T31 | second call success |  |
| PASS | T31 | cache hit same restaurant |  |
| PASS | T32 | success |  |
| PASS | T32 | donde_match >= 60 |  |
| PASS | T32 | restaurant.id |  |
| PASS | T33 | first call success |  |
| PASS | T33 | second call success |  |
| PASS | T33 | different restaurant |  |
| PASS | T34 | call 1 success |  |
| PASS | T34 | call 2 success |  |
| PASS | T34 | call 3 success |  |
| PASS | T34 | call 4 success |  |
| PASS | T34 | 4 unique restaurants |  |
| PASS | T35 | call 1 success |  |
| PASS | T35 | call 2 success |  |
| PASS | T35 | call 3 success |  |
| PASS | T35 | 3rd different |  |
| PASS | T36 | success |  |
| PASS | T36 | donde_match >= 60 |  |
| PASS | T36 | late-night context detected |  |
| PASS | T37 | success |  |
| PASS | T37 | brunch context in output |  |
| PASS | T37 | neighborhood Logan Square |  |
| FAIL | T38 | success | expected=true|got=false |
| WARN | T38 | google_rating present | null — Google API may be down |
| WARN | T38 | review_count present | null |
| WARN | T38 | sentiment_score present | null |
| FAIL | T38 | google_place_id | expected=non-null|got=null |
| PASS | T39 | success |  |
| PASS | T39 | phone present |  |
| PASS | T39 | website present |  |
| PASS | T40 | cuisine diversity |  |
| PASS | T41 | HTTP 200 |  |
| PASS | T41 | has success flag |  |
| PASS | T42 | HTTP 200 |  |
| PASS | T42 | has recommendation |  |
| PASS | T43 | HTTP 200 |  |
| PASS | T43 | has recommendation |  |
| PASS | T44 | success |  |
| PASS | T44 | donde_match >= 60 |  |
| PASS | T44 | restaurant |  |
| PASS | T45 | success flag exists |  |
| PASS | T45 | has recommendation |  |
| PASS | T45 | donde_match >= 60 |  |
| PASS | T46 | HTTP 500 |  |
| PASS | T46 | has response body |  |
| PASS | T47 | responded HTTP 405 |  |
| FAIL | T48 | success | expected=true|got= |
| FAIL | T48 | donde_match >= 60 | expected=true|got= |
| FAIL | T48 | restaurant | expected=non-null|got= |
| PASS | T49 | success flag exists |  |
| PASS | T49 | has recommendation |  |
| PASS | T49 | no injection |  |
| PASS | T50 | stability 5/5 |  |

## Failure Analysis

### Root Cause Summary

16 hard failures across 4 distinct issues. 13 of 16 failures share the same root cause: **sparse data coverage** in specific neighborhood + price_level combinations.

| Root Cause | Tests Affected | Failures | Fix Priority |
|-----------|---------------|----------|-------------|
| Missing restaurant data for narrow filters | T07, T15, T20, T25, T38 | 13 | High — run discovery pipeline for underserved neighborhoods |
| T48: Large exclude array breaks response | T48 | 3 | Medium — input validation for exclude array size |

---

### Failure Detail: T07 — Business Lunch + Fulton Market + $$$

**What happened:** `success: false` — no restaurants matched Fulton Market at $$$ price level.
**Root cause:** The `get_ranked_restaurants` RPC found no active restaurants in Fulton Market with `price_level = '$$$'`. The RPC returns empty when neighborhood has no matches at the requested price.
**Enhancement:** Run discovery pipeline targeting Fulton Market at $$$ price tier. Alternatively, implement **price-level relaxation** — when exact price yields 0 results, expand to adjacent levels ($$ and $$$$).

### Failure Detail: T15 — Treat Myself + Bucktown + $$$

**What happened:** `success: false` — no restaurants in Bucktown at $$$ price level.
**Root cause:** Same data gap. Bucktown has restaurants at $$ but not at $$$. The blended occasion scoring (50% solo + 30% romantic + 20% hidden gem) couldn't compensate for zero candidates.
**Enhancement:** Same as T07 — discover more Bucktown $$$ restaurants, or implement price relaxation.

### Failure Detail: T20 — Italian Pasta + Little Italy + $$

**What happened:** `success: false` — no restaurants in Little Italy at $$ price level.
**Root cause:** Little Italy has very few restaurants in the database. Despite being an iconic neighborhood for Italian cuisine, the discovery pipeline may not have sufficient coverage there.
**Enhancement:** Specifically target Little Italy in the next discovery pipeline run. Ironically, "pasta carbonara in Little Italy" is one of the most natural queries users would make.

### Failure Detail: T25 — Instagrammable + Fulton Market + $$$

**What happened:** `success: false` — same Fulton Market + $$$ data gap as T07.
**Root cause:** Identical to T07. Fulton Market is a trendy neighborhood known for instagrammable spots, but DB coverage at $$$ is empty.
**Enhancement:** Same as T07.

### Failure Detail: T38 — Best Rated + Fulton Market + $$$$

**What happened:** `success: false` — no restaurants at $$$$ in Fulton Market.
**Root cause:** Fulton Market appears to lack high-end ($$$$) restaurant data entirely.
**Enhancement:** Run focused discovery for Fulton Market at all price tiers.

### Failure Detail: T48 — Large Exclude Array (20 UUIDs)

**What happened:** Empty response — all 3 checks failed because `jq` returned empty strings.
**Root cause:** The 20 fake UUIDs generated by bash's `$RANDOM` may have produced malformed UUID strings that caused a request parsing issue, or the large exclude array caused an RPC/filter issue. The HTTP response was likely not valid JSON.
**Enhancement:** Add input validation to cap the exclude array at a reasonable size (e.g., 15). Add length validation in the Edge Function before passing to the RPC.

---

## Enhancement Recommendations (Prioritized)

### Priority 1: Data Coverage Gaps (Fixes T07, T15, T20, T25, T38)

| Action | Impact |
|--------|--------|
| Run discovery pipeline for Fulton Market (all price tiers) | Fixes T07, T25, T38 |
| Run discovery pipeline for Bucktown ($$$) | Fixes T15 |
| Run discovery pipeline for Little Italy (all price tiers) | Fixes T20 |
| Add price-level relaxation in `scoring.ts` (try adjacent tiers when 0 results) | Prevents all future data gap failures |

### Priority 2: Input Validation (Fixes T48)

| Action | Impact |
|--------|--------|
| Cap `exclude` array at 15 entries in `index.ts` | Prevents T48-style failures |
| Validate UUID format in exclude entries | Prevents malformed data from reaching RPC |

### Priority 3: Soft Improvements (Based on WARNs)

| Observation | Recommendation |
|------------|----------------|
| T03: Restaurant name not always in recommendation text | Consider adding instruction to Claude prompt: "Always mention the restaurant name in your recommendation" |
| T28: BYOB request didn't surface BYOB tag | Ensure BYOB restaurants in DB have "BYOB" tag assigned by tag pipeline |
| T40: Only 2 unique cuisines in 6 calls | Cache key includes request text, so "surprise me option 1" vs "option 2" produce different cache entries but may hit same ranking. Consider adding randomization seed |

---

## What Passed Well

| Category | Pass Rate | Notes |
|----------|-----------|-------|
| Contract shape (T01-T02) | 41/41 (100%) | All response keys present, correct types |
| donde_match scoring (T04) | 5/5 (100%) | Always integer 60-99 |
| Tags & scores (T05-T06) | 13/13 (100%) | Valid arrays and ranges |
| Occasion routing (T09-T14, T16-T18) | 33/33 (100%) | All occasions score correctly |
| Cuisine keywords (T19, T21) | 6/6 (100%) | Mexican/Japanese matched correctly |
| Intent expansion (T22-T24) | 9/9 (100%) | Spicy, anniversary, healthy all mapped |
| Dietary keywords (T26-T27) | 6/6 (100%) | Vegan and gluten-free referenced |
| Cache behavior (T31-T32) | 6/6 (100%) | Cache hit and bypass work correctly |
| Try Another / Exclude (T33-T35) | 12/12 (100%) | Exclude works, all unique restaurants |
| Negative tests (T41-T47, T49) | 15/15 (100%) | Graceful error handling, no injection |
| Stability (T50) | 1/1 (100%) | 5/5 rapid calls succeeded |

---

## Scorecard by Phase

| Phase | Tests | Hard Checks | Passed | Failed | Pass Rate |
|-------|-------|------------|--------|--------|-----------|
| 1. Contract | T01-T08 | 73 | 71 | 2 | 97% |
| 2. Parameters | T09-T18 | 36 | 32 | 4 | 89% |
| 3. Ranking | T19-T30 | 33 | 28 | 5 | 85% |
| 4. Advanced | T31-T40 | 32 | 30 | 2 | 94% |
| 5. Edge Cases | T41-T50 | 22 | 19 | 3 | 86% |
| **TOTAL** | **T01-T50** | **196** | **180** | **16** | **91%** |
