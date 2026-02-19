# Donde API Test Results

**Date:** 2026-02-19T19:40:52Z
**Endpoint:** https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend

## Summary

| Metric | Count |
|--------|-------|
| PASSED | 230 |
| FAILED | 0 |
| WARNED | 6 |
| TOTAL  | 236 |
| **Hard Pass Rate** | **100%** (230 / 230) |

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
| PASS | T07 | price_level valid |  |
| PASS | T07 | noise_level valid |  |
| PASS | T07 | dress_code valid |  |
| PASS | T07 | success is true |  |
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
| PASS | T10 | price is 8737 |  |
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
| PASS | T14 | price 87378737 |  |
| PASS | T15 | success |  |
| PASS | T15 | solo_dining >= 4 |  |
| PASS | T15 | donde_match >= 60 |  |
| PASS | T15 | neighborhood match |  |
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
| PASS | T20 | success |  |
| WARN | T20 | cuisine is Italian | got: mexican |
| PASS | T20 | neighborhood Little Italy |  |
| PASS | T20 | date_friendly >= 3 |  |
| PASS | T21 | success |  |
| WARN | T21 | cuisine is Japanese | got: french |
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
| PASS | T25 | success |  |
| PASS | T25 | instagrammable tags |  |
| PASS | T25 | neighborhood West Loop |  |
| PASS | T26 | success |  |
| PASS | T26 | vegan referenced |  |
| PASS | T26 | donde_match >= 60 |  |
| PASS | T27 | success |  |
| PASS | T27 | gluten-free referenced |  |
| PASS | T27 | family_friendly >= 4 |  |
| PASS | T28 | success |  |
| WARN | T28 | BYOB tag present | tags=authentic mexican,vibrant cantina,neighborhood gem |
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
| PASS | T38 | success |  |
| PASS | T38 | google_rating 1-5 |  |
| PASS | T38 | review_count >= 0 |  |
| PASS | T38 | sentiment_score is number |  |
| PASS | T38 | google_place_id |  |
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
| PASS | T48 | success |  |
| PASS | T48 | donde_match >= 60 |  |
| PASS | T48 | restaurant |  |
| PASS | T49 | success flag exists |  |
| PASS | T49 | has recommendation |  |
| PASS | T49 | no injection |  |
| PASS | T50 | stability 5/5 |  |
| PASS | T51 | success |  |
| PASS | T51 | donde_match >= 60 |  |
| PASS | T51 | restaurant name |  |
| PASS | T51 | noise matches bustling |  |
| PASS | T51 | vibe referenced in output |  |
| PASS | T52 | success |  |
| PASS | T52 | neighborhood Logan Square |  |
| PASS | T52 | address contains Chicago |  |
| PASS | T52 | ZIP consistent with Logan Square area |  |
| PASS | T53 | success |  |
| PASS | T53 | donde_match >= 60 |  |
| PASS | T53 | group_friendly >= 4 |  |
| PASS | T53 | noise matches energetic |  |
| PASS | T54 | success |  |
| PASS | T54 | recommendation exists |  |
| PASS | T54 | insider_tip exists |  |
| PASS | T54 | rec length 65 words |  |
| PASS | T54 | no AI slop detected |  |
| PASS | T54 | uses Donde 'we' voice |  |
| PASS | T54 | insider tip concise |  |
| PASS | T55 | success |  |
| PASS | T55 | restaurant returned |  |
| WARN | T55 | deep dish maps to Italian/American | got: asian |
| PASS | T56 | success |  |
| PASS | T56 | restaurant returned |  |
| PASS | T56 | mole negro maps to Mexican |  |
| PASS | T57 | success |  |
| PASS | T57 | restaurant returned |  |
| WARN | T57 | sushi intent matched | got: american |
| PASS | T57 | outdoor_seating matched |  |
| PASS | T58 | success |  |
| PASS | T58 | still returns a restaurant |  |
| PASS | T58 | donde_match=83 |  |

## Enhancement Recommendations

Based on test results, the following enhancements should be considered:

### Phase 1 Failures (Contract)
- If T01-T08 fail: API contract is broken — investigate response-builder.ts
- Missing keys: Add the field to buildSuccessResponse in response-builder.ts

### Phase 2 Failures (Occasion Scoring)
- If occasion tests fail on score thresholds: Review OCCASION_WEIGHTS in scoring.ts
- If neighborhood doesn't match: Check RPC filter logic in migration

### Phase 3 Failures (Ranking Intelligence)
- If cuisine doesn't match keyword: Expand CUISINE_KEYWORDS in scoring.ts
- If intent expansion fails: Add mappings to INTENT_MAP in scoring.ts
- If dietary not referenced: Check DIETARY_KEYWORDS and Claude prompt

### Phase 4 Failures (Advanced)
- If cache hit fails: Verify LRU cache TTL in index.ts
- If Try Another returns same restaurant: Check exclude filter logic
- If Google data is null: Verify GOOGLE_PLACES_API_KEY secret

### Phase 5 Failures (Edge Cases)
- If injection test fails: Add input sanitization in index.ts
- If malformed JSON crashes: Add try-catch around req.json()
- If rapid calls fail: Consider rate limiting or connection pooling
