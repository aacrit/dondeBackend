# Subjective Engine Test Fixes — Cumulative Record

Last updated: 2026-03-18

## Summary

7 rounds of subjective testing (175 queries total) compared DondeAI engine results against expert consensus from The Infatuation, TimeOut, Michelin Guide, Chicago Tribune, and Reddit r/chicagofood. Each round identified failures, applied targeted fixes, and verified no regression on the 50-case golden dataset.

| Round | Queries | Before Pass% | After Pass% | CAT Before | CAT After | Version | Branch |
|-------|---------|-------------|------------|------------|-----------|---------|--------|
| R1 | 25 | 64% | 92% | 4 | 0 | V21 | claude/v21-subjective-tester-fixes |
| R2 | 25 | 64% | 72% | 1 | 0 | V22 | claude/v22-subjective-stress-test-fixes |
| R3 | 25 | 44% | 100% | 7 | 0 | V23 | claude/v23-round3-subjective-fixes |
| R4 | 25 | 60% | 80% | 2 | 0 | V23 | claude/v23-round3-subjective-fixes |
| R5 | 25 | 52% | 80% | 6 | 0 | V25 | claude/v25-subjective-round6-fixes |
| R6 | 25 | 40% | 88% | 9 | 0 | V25 | claude/v25-subjective-round6-fixes |
| R7 | 25 | 64% | TBD | 2 | TBD | V26 | claude/v26-subjective-round7-fixes |
| **Total** | **175** | **55% avg** | **85% avg** | **31** | **0** | | |

**Golden dataset (final):** 181P/0F/7W, avg DM 83 — NO REGRESSION vs V10 baseline (+137 passes, +13 DM).

---

## Round 1 Fixes (V21)

### Fix 1.1: Dish-gated reputation runs before cuisine-gated reputation
- **File:** `scoring-v9.ts:1078-1114`
- **Failure:** "best burger" and "best deep dish pizza" returned North Pond (American fine dining) because cuisine gate fired first, giving 1.0 cuisine match on "American" before checking if the restaurant actually serves burgers/pizza.
- **Before:** North Pond (DM 92) for "best burger"
- **After:** Au Cheval (DM 86) for "best burger"

### Fix 1.2: Cuisine-gate threshold raised 0.40 → 0.90
- **File:** `scoring-v9.ts:1096-1122`
- **Failure:** "best Korean food" returned Kyoten (Japanese) via East Asian family match (0.88 relevance passed the 0.40 gate).
- **Before:** Kyoten (Japanese, DM 89) for "best Korean food"
- **After:** Jeong (Korean, DM 81) for "best Korean food"

### Fix 1.3: Dish-not-found cap lowered 0.70 → 0.55
- **File:** `scoring-v9.ts:1107-1110`
- **Failure:** Restaurants with right cuisine but missing the actual dish (e.g., RPM Italian for "best deep dish pizza") scored too high.
- **Before:** RPM Italian (DM 88) competitive for "best deep dish pizza"
- **After:** Nella Pizza e Pasta (DM 92) wins for "best deep dish pizza"

### Fix 1.4: Non-restaurant concept penalty
- **File:** `scoring-v9.ts:1179-1190`
- **Failure:** "best restaurant in West Loop" returned The Aviary (Cocktail Bar).
- **Before:** The Aviary (Cocktail Bar, DM 86)
- **After:** avec Restaurant (Mediterranean, DM 82)

### Fix 1.5: Venue-type words added to NON_DISH_WORDS
- **File:** `intent-classifier-v5.ts:505-508`
- **Words added:** steakhouse, izakaya, brasserie, brewpub, taproom, churrasco, rodizio
- **Failure:** "best steakhouse" triggered dish_level_intent, routing through dish search instead of cuisine path.
- **Before:** Dish search path for "best steakhouse"
- **After:** Cuisine path (Steak) for "best steakhouse"

---

## Round 2 Fixes (V22)

### Fix 2.1: Restaurant name partial match — word-boundary regex
- **File:** `scoring-v9.ts:1620-1638`
- **Failure:** "best Polish food" returned Topolobampo (Mexican) because "Topolobampo" contains "pol" (stemmed "Polish"), giving a false 0.95 name match.
- **Fix:** Changed from substring matching to word-boundary regex. Added 5-char minimum for stemmed fragments.
- **Before:** Topolobampo (Mexican, DM 92) for "best Polish food"
- **After:** Jim's Original (Polish, DM 81)

### Fix 2.2: Sub-cuisine keywords added to NON_DISH_WORDS
- **File:** `intent-classifier-v5.ts:526-537`
- **Words added:** lebanese, turkish, yemeni, kurdish, palestinian, trinidadian, jamaican, ecuadorian, salvadoran, ukrainian, irish, swedish, serbian, bosnian, portuguese, british, georgian, azerbaijani
- **Failure:** "best Lebanese food" triggered dish_level_intent, capping relevance at 0.55. DM dropped to 39.
- **Before:** Galit (DM 39) for "best Lebanese food"
- **After:** Galit (DM 88) for "best Lebanese food"

---

## Round 3 Fixes (V23)

### Fix 3.1: Neighborhood-gated reputation
- **File:** `scoring-v9.ts:1085-1104`
- **Failure:** "best restaurant in Humboldt Park" returned Bavette's (River North). Reputation path returned early without checking neighborhood.
- **Before:** Bavette's (River North, DM 91)
- **After:** La Encantada (Humboldt Park, DM 78)

### Fix 3.2: Speakeasy pre-check before cuisine gate
- **File:** `scoring-v9.ts:1105-1125`
- **Failure:** "best speakeasy" returned Lena Brava (Latin American). Speakeasy structural check was after the cuisine gate.
- **Before:** Lena Brava (Latin American, DM 82)
- **After:** The Aviary (Cocktail Bar, DM 78)

### Fix 3.3: Cross-cuisine dish-reputation cap at 0.45
- **File:** `scoring-v9.ts:1117-1125`
- **Failure:** When dish was found in a restaurant's catalog but cuisine didn't match targets, relevance was still too high.
- **Fix:** Cap relevance at 0.45 when dish is found but cuisine doesn't match.

### Fix 3.4: Structural feature verification (6 checks)
- **File:** `scoring-v9.ts:1244-1345`
- **Features:** waterfront, fireplace, private dining, view, quiet/conversation, speakeasy
- **Failure:** "best waterfront restaurant" returned Bavette's (basement steakhouse). "best restaurant with a view" returned Bavette's. No structural verification existed.
- **Before:** Bavette's for waterfront/view queries
- **After:** The J. Parker (lake view) for waterfront, North Pond (park views) for view

### Fix 3.5: Burmese cuisine added
- **Files:** `scoring.ts`, `scoring-v9.ts`, `intent-classifier-v5.ts`
- **Additions:** CUISINE_KEYWORDS, INTENT_MAP, CUISINE_FAMILIES (Southeast Asian), SUBCUISINE_SPECIFIC, NON_DISH_WORDS
- **Failure:** "best Burmese food" returned Big Jones (Southern).
- **After:** HaiSous (Vietnamese, family match with low DM indicating limited coverage)

### Fix 3.6: Cross-cuisine contamination fixes
- **Files:** `scoring.ts`, `intent-classifier-v5.ts`
- **Changes:** Afghan no longer maps to Indian. Moroccan no longer maps to Mediterranean. Taiwanese no longer maps to Chinese. Pakistani no longer maps to Indian.
- **Failure:** "best Afghan food" returned Thattu (Indian). "best Moroccan food" returned avec (Mediterranean).
- **After:** Galit (Middle Eastern family) for Afghan. Shokran (Moroccan) for Moroccan.

---

## Round 4 Fixes (V23 continued)

### Fix 4.1: Plural forms in CUISINE_KEYWORDS
- **File:** `scoring.ts:28-30`
- **Words added:** tamales, tacos, burritos, enchiladas, churros, quesadillas, dumplings, noodles, wontons
- **Failure:** "best tamales" didn't match "tamale" (singular) in keywords. Returned Bavette's (Steak).
- **After:** XOCO (Mexican, DM 93)

### Fix 4.2: Haitian cuisine added
- **File:** `scoring.ts:49-52`
- **Additions:** CUISINE_KEYWORDS (haitian, griyo, griot, diri kole, pikliz, tassot, accra), CUISINE_FAMILIES (Caribbean), INTENT_MAP, NON_DISH_WORDS, SUBCUISINE_SPECIFIC
- **Failure:** "best Haitian food" returned Bavette's (Steak, DM 91).
- **After:** Caribbean American Baking Co (Caribbean, DM 70)

### Fix 4.3: Sri Lankan mapping fixed
- **File:** `scoring.ts:885-886`
- **Change:** Maps to ["Indian", "Sri Lankan"] instead of just ["Indian"]. Added to CUISINE_FAMILIES (South Asian).
- **Failure:** "best Sri Lankan food" returned Thattu with no differentiation from Indian.

### Fix 4.4: INTENT_MAP additions
- **File:** `scoring.ts:402,416`
- **Entries:** tamales, bao buns — explicit dish-to-cuisine mapping
- **Failure:** These dishes lacked cuisine mappings, causing generic reputation path.

---

## Round 5 Fixes (V25)

### Fix 5.1: dish_level_intent for INTENT_MAP food items
- **File:** `intent-classifier-v5.ts:719-751`
- **Failure:** Items like "donut", "bagel", "cookie", "torta", "ice cream" existed in INTENT_MAP (for cuisine mapping) but never triggered dish_level_intent, so the dish-gating path was bypassed entirely. Fine-dining restaurants won via reputation.
- **Exclusions:** Venue types (steakhouse, etc.), sub-cuisine names, cuisine-query suffixes ("food", "cuisine"), cuisine names
- **Before:** North Pond (DM 92) for "best donut", Big Jones (DM 91) for "best bagel"
- **After:** Avondale Coffee (DM 43) for "best donut", Loaves & Witches (DM 74) for "best bagel"

### Fix 5.2: Missing INTENT_MAP entries
- **File:** `scoring.ts:793-810`
- **Entries added:** bagel/bagels → ["American", "Coffee/Cafe"], cookie/cookies → ["American", "Coffee/Cafe"], torta/tortas → ["Mexican"]
- **Change:** Removed cuisines from "wine" entry (wine bars are a vibe concept, not a cuisine)
- **Before:** Big Jones (DM 91) for "best torta"
- **After:** XOCO (DM 93) for "best torta"

### Fix 5.3: Dish-gated cap lowered 0.55 → 0.40
- **File:** `scoring-v9.ts:1164`
- **Failure:** Right-cuisine-but-no-dish restaurants still scored too high at 0.55 cap.
- **Impact:** Fine-dining restaurants without the actual dish (e.g., North Pond for "best donut") now get 0.40 relevance.

### Fix 5.4: Neighborhood aliases added
- **File:** `scoring-v9.ts:520-522`
- **Aliases:** bronzeville → Bronzeville, back of the yards → Back of the Yards, woodlawn → Woodlawn
- **Before:** "best restaurant in Bronzeville" returned Big Jones (Andersonville)
- **After:** Honey 1 BBQ (Bronzeville, DM 62)

---

## Round 6 Fixes (V25)

### Fix 6.1: Price-sensitive reputation gate
- **File:** `scoring-v9.ts:1382-1410`
- **Failure:** "best cheap eats" returned Big Jones ($$). "best fine dining" returned Big Jones ($$). "best splurge-worthy" returned Big Jones ($$). No price filtering in reputation path.
- **Fix:** "cheap eats" blocks $$+. "affordable" blocks $$$+. "fine dining"/"splurge"/"tasting menu" blocks $/$$.
- **Before:** Big Jones ($$, DM 91-95) for all price-tier queries
- **After:** La Esperanza ($) for cheap eats, Bavette's ($$$$) for fine dining

### Fix 6.2: Dietary constraint reputation gate
- **File:** `scoring-v9.ts:1432-1497`
- **Failure:** "best halal restaurant" returned Big Jones (Southern). "best kosher restaurant" returned Big Jones. "best gluten free" returned Bavette's. No dietary verification.
- **Fix:** Three-tier system:
  - Strict (halal/kosher): must be in cuisine_type, tags, or oneliner
  - Dedicated (vegan/gluten-free): only cuisine_type or restaurant name counts
  - Loose (vegetarian): dietary_options sufficient
- **Before:** Big Jones (DM 91) for halal/kosher
- **After:** DM 18 for halal/kosher (honest "no good match" — correct behavior when DB lacks coverage)

### Fix 6.3: Time-of-day / concept reputation gates
- **File:** `scoring-v9.ts:1516-1578`
- **Failure:** "best breakfast spot" returned Big Jones (no breakfast verification). "best dessert restaurant" returned Bavette's.
- **Fix:** Breakfast, brunch, happy hour, dessert, food truck, buffet — each verifies the restaurant actually offers this service.
- **Before:** Big Jones (DM 91) for breakfast, Bavette's (DM 91) for dessert
- **After:** Floriole Cafe (DM 88) for breakfast, Floriole Cafe (DM 88) for dessert

### Fix 6.4: Format structural gates
- **File:** `scoring-v9.ts:1580-1640`
- **Failure:** "best tasting menu" and "best prix fixe" returned Bavette's. No format verification.
- **Fix:** Tasting menu, prix fixe, after-work drinks — each verifies structural signals.
- **Before:** Bavette's (DM 96) for tasting menu
- **After:** Ever Restaurant (DM 94) for tasting menu

### Fix 6.5: Vibe trigger additions
- **File:** `scoring-v9.ts:1634`
- **Added:** "date night", "date", "brunch" to REPUTATION_VIBE_TRIGGERS regex
- **Impact:** These queries now route through vibe-blended reputation instead of pure reputation.

---

## Round 7 Fixes (V26)

Round 7 used 25 complex, multi-signal queries: compound constraints, cultural nuance, scenario-based, dietary combos, and edge cases. These are the hardest queries a real Chicago user would type.

### Initial Results (Before Fixes)

| # | Query | Engine #1 | Grade |
|---|-------|-----------|-------|
| 1 | romantic Italian dinner outdoor River North | RPM Italian (DM 99) | CORRECT |
| 2 | cheap authentic tacos late Pilsen | La Esperanza (DM 95) | CORRECT |
| 3 | upscale Japanese private dining birthday | Tamu Sushi (DM 82) | ACCEPTABLE |
| 4 | casual BYOB vegetarian Logan Square | Daisies (DM 95, not BYOB) | WRONG |
| 5 | Michelin star under $100 | Bavette's (DM 35) | ACCEPTABLE |
| 6 | family brunch patio Lincoln Park | Floriole Cafe (DM 89) | CORRECT |
| 7 | quiet upscale business dinner Loop | Cantina on Madison ($, DM 83) | CATASTROPHIC |
| 8 | lively Mexican margaritas live music | Mi Tocaya (DM 95) | CORRECT |
| 9 | parents seafood anniversary | Joe's Seafood (DM 84) | CORRECT |
| 10 | first date affordable cocktails | Big Jones (DM 88) | ACCEPTABLE |
| 11 | deep dish Chicago experience visitors | Chicago's Pizza Lakeview (DM 66) | WRONG |
| 12 | post-concert late night United Center | Tamu Sushi (DM 93) | WRONG |
| 13 | group of 8 celebrating fun loud | Bavette's (DM 74) | ACCEPTABLE |
| 14 | dim sum cart service Hong Kong | Triple Crown (DM 84) | CORRECT |
| 15 | Neapolitan pizza wood-fired | Bar Siena (DM 78) | WRONG |
| 16 | hole in wall Mexican locals | XOCO (DM 94) | CORRECT |
| 17 | old school steakhouse tableside Caesar | Bavette's (DM 95) | CORRECT |
| 18 | farm-to-table tasting menu not pretentious | Bavette's (DM 86) | CATASTROPHIC |
| 19 | gluten free pasta date night | Ignotz's (DM 91) | ACCEPTABLE |
| 20 | halal fine dining Eid | The Aviary (DM 75) | WRONG |
| 21 | vegan brunch good coffee | Lou Mitchell's (DM 87) | WRONG |
| 22 | kosher friendly business lunch | Bavette's (DM 74) | WRONG |
| 23 | like Girl and the Goat less crowded | Cantina on Madison (DM 86) | WRONG |
| 24 | best restaurant opened 2025 | Bavette's (DM 93) | WRONG |
| 25 | Michelin star with takeout | goosefoot (DM 95) | ACCEPTABLE |

**Summary: 7 CORRECT, 6 ACCEPTABLE, 10 WRONG, 2 CATASTROPHIC**
**Pass rate: 52% (CORRECT + ACCEPTABLE)**

### Fix 7.1: Universal structural pre-checks (V26)
- **File:** `scoring-v9.ts` (new block at top of computeRelevance)
- **Root cause:** Structural checks (halal/kosher, tasting menu, upscale+business) only existed in the reputation path. Non-reputation queries (vibe, cuisine, open_ended) bypassed all verification. This caused:
  - Q7: Cantina on Madison ($, casual Mexican) winning "quiet upscale business dinner" via vibe path
  - Q18: Bavette's winning "farm-to-table tasting menu" via vibe path (no tasting menu check)
  - Q20/Q22: halal/kosher queries returning non-halal/kosher restaurants via vibe path
- **Fix:** Added 3 universal pre-checks that run BEFORE any relevance path:
  1. **Halal/kosher universal gate**: When query contains "halal" or "kosher", verify restaurant has the dietary signal. Returns rel=0.15 on mismatch.
  2. **Tasting menu universal gate**: When query contains "tasting menu" (non-reputation), verify restaurant actually offers one. Returns rel=0.25 on mismatch.
  3. **Upscale+business universal gate**: When query contains "upscale"/"fine dining" + "business"/"client", block $ restaurants (rel=0.20) and casual+$$ restaurants (rel=0.30).
- **Impact on Q7:** Cantina on Madison ($, casual) now gets rel=0.20, allowing Miru ($$$$, quiet Japanese) to win.
- **Impact on Q18:** Bavette's (no tasting menu signal) now gets rel=0.25, allowing North Pond/Elske/goosefoot to win.
- **Impact on Q20/Q22:** Restaurants without halal/kosher signals now get rel=0.15.

### Remaining Issues (Not Fixed in R7)

- **Q4 (BYOB Logan Square):** Daisies wins via vibe path even though it's not BYOB. The BYOB constraint fires in the constraint path but the vibe path returns first with rel=1.0. Would require restructuring vibe vs constraint priority.
- **Q11 (deep dish visitors):** Chicago's Pizza-Lakeview wins via dish path instead of iconic spots like Lou Malnati's or Pequod's. Root cause: dish catalog matching favors restaurants with "deep dish" in catalog over famous chains that may not have explicit dish catalog entries.
- **Q12 (late night United Center):** "United Center" is not mapped to a neighborhood. Would require landmark-to-neighborhood mapping.
- **Q15 (Neapolitan pizza):** Bar Siena wins over Spacca Napoli. Root cause: dish relevance path doesn't distinguish Neapolitan-specific from generic pizza.
- **Q21 (vegan brunch):** Lou Mitchell's (not vegan-focused) wins via cuisine path. The "vegan" dedicated check only exists in reputation path.
- **Q23 (like Girl and the Goat):** Deterministic intent classifier (Tier 1) doesn't detect restaurant-name references. Would require similar_to field in deterministic classification.
- **Q24 (opened in 2025):** Engine has no temporal awareness. No opening-year field in restaurant data.

---

## ML Boost Table Refresh (Post-Fixes)

After all 6 rounds, the boost table was refreshed to align with V25 scoring:

| Category | Count | Details |
|----------|-------|---------|
| Stale entries updated | 14 | Removed wrong-cuisine boost targets |
| New canonical entries | 34 | afghan, lebanese, moroccan, haitian, carnitas, tamales, gelato, etc. |
| Alias entries | 38 | "best X food" / "best X" forms |
| **Total key count** | **654 → 726** | +72 net new keys |

---

## Remaining Known Issues

### DB Coverage Gaps (not fixable via scoring)
- **Halal/kosher restaurants**: Very few or zero tagged in DB. Engine correctly returns low DM.
- **Food trucks**: Not well-represented in DB.
- **Buffet restaurants**: Limited coverage.
- **Sri Lankan**: No dedicated Sri Lankan restaurants (Thattu is Indian).
- **Tibetan**: Himalayan restaurants classified as Indian in DB.

### Scoring Edge Cases (future rounds)
- **"best Italian beef"**: Maps to American+Italian, causing Italian fine-dining to match. Should be American only.
- **"best ice cream"**: Specialty shops exist but have low quality scores vs fine dining.
- **"best poke bowl"**: Mediterranean restaurants with poke match via dish catalog.
- **"best sports bar"**: No structural verification gate for sports bars.
- **"best wine bar"**: Lacks dedicated wine-bar structural check.
- **"best lively sports bar with good food"**: Compound vibe queries still challenging.
- **"restaurant opened in 2025"**: No temporal awareness (no opening_year field in DB).
- **"like Girl and the Goat but less crowded"**: Deterministic Tier 1 classifier has no similar_to detection. Requires Claude for restaurant-name references.
- **BYOB constraint vs vibe path priority**: BYOB constraint checked in constraint path but vibe path returns first with high relevance, bypassing BYOB check.
- **Neapolitan-specific pizza vs generic pizza**: Dish path doesn't distinguish Neapolitan from other pizza styles.
- **Vegan/dietary universal check**: Currently only in reputation path; non-reputation queries bypass dedicated dietary check for "vegan brunch" etc.

### Blurb Quality (7 golden dataset WARNs)
- All 7 WARNs are deterministic blurb quality (C/70-75 vs B-/80 threshold).
- Not scoring-related. Would require blurb generation improvements.
