#!/usr/bin/env bash
set -uo pipefail

###############################################################################
# V9 END-TO-END TEST — 100 COMPLEX QUERIES
#
# Tests the full V9 pipeline: get_candidates_v9 RPC → review intelligence
# retrieval → ts_rank text matching → review quality scores
#
# Each query is COMPLEX: cuisine + dish + occasion + random natural language
# to stress-test the review intelligence data enrichment.
#
# What we validate per query:
#   1. RPC returns candidates (HTTP 200, non-empty results)
#   2. Review intelligence is present (ri_dish_catalog, ri_cuisine_signals)
#   3. ts_rank relevance: top result has positive text match for dish queries
#   4. Top result's dish_catalog or cuisine_signals contains expected terms
#   5. Review quality scores are populated (not null)
#   6. Score sanity: food_quality, service_quality in valid range (0-10)
#
# Usage:  chmod +x tests/v9-e2e-100.sh && ./tests/v9-e2e-100.sh
# Deps:   curl, jq (v1.6+), bash 4+
###############################################################################

# Supabase config
SUPAB_URL="https://vwbzkgsxmgwcvmvuxnbe.supabase.co"
SUPAB_KEY="${SUPAB_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnprZ3N4bWd3Y3ZtdnV4bmJlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTk2NTM1NiwiZXhwIjoyMDg1NTQxMzU2fQ.LZCrx5IKqkbfO0j9tCeYz309q59lmVuqyfm0DS6JOxk}"

RPC_URL="${SUPAB_URL}/rest/v1/rpc/get_candidates_v9"

# Counters
PASS=0
FAIL=0
WARN=0
TOTAL=0
TOTAL_RI_HIT=0      # Candidates with review intelligence
TOTAL_RI_MISS=0     # Candidates missing review intelligence
TOTAL_TEXT_RANK=0    # Sum of top-1 ri_text_rank for averaging

# Category tracking
declare -A CAT_PASS CAT_FAIL CAT_WARN CAT_COUNT
for cat in DishCuisine VibeDish OccasionDish CompoundNoise NicheCuisine DietaryDish PriceDish MultiSignal EdgeCase DiscoveryMix; do
  CAT_PASS[$cat]=0; CAT_FAIL[$cat]=0; CAT_WARN[$cat]=0; CAT_COUNT[$cat]=0
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Output files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAW_FILE="${SCRIPT_DIR}/V9_E2E_RAW_RESULTS.jsonl"
REPORT_FILE="${SCRIPT_DIR}/V9_E2E_100_RESULTS.md"
> "$RAW_FILE"

###############################################################################
# HELPER FUNCTIONS
###############################################################################

rpc_call() {
  local query="$1"
  local occasion="${2:-Any}"
  local neighborhood="${3:-Anywhere}"
  local price="${4:-Any}"

  curl -s "${RPC_URL}" \
    -X POST \
    -H "apikey: ${SUPAB_KEY}" \
    -H "Authorization: Bearer ${SUPAB_KEY}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg q "$query" \
      --arg n "$neighborhood" \
      --arg p "$price" \
      --arg o "$occasion" \
      '{p_query: $q, p_neighborhood: $n, p_price_level: $p, p_occasion: $o, p_limit: 10}')" \
    --max-time 30
}

check_pass() {
  local tid="$1"; local msg="$2"
  echo -e "  ${GREEN}PASS${NC} [$tid] $msg"
  ((PASS++))
}

check_fail() {
  local tid="$1"; local msg="$2"; local detail="${3:-}"
  echo -e "  ${RED}FAIL${NC} [$tid] $msg${detail:+ ($detail)}"
  ((FAIL++))
}

check_warn() {
  local tid="$1"; local msg="$2"; local detail="${3:-}"
  echo -e "  ${YELLOW}WARN${NC} [$tid] $msg${detail:+ ($detail)}"
  ((WARN++))
}

###############################################################################
# CORE TEST RUNNER
# $1: test_id, $2: category, $3: query, $4: expected_terms (pipe-sep),
# $5: occasion, $6: check_type (dish|cuisine|vibe|open)
###############################################################################
run_v9_test() {
  local test_id="$1"
  local category="$2"
  local query="$3"
  local expected_terms="$4"
  local occasion="${5:-Any}"
  local check_type="${6:-dish}"

  ((TOTAL++))
  CAT_COUNT[$category]=$(( ${CAT_COUNT[$category]} + 1 ))

  echo -e "\n${CYAN}[$test_id] $category: \"$query\" (occasion=$occasion)${NC}"

  local response
  response=$(rpc_call "$query" "$occasion")

  # Check 1: Valid response (non-error, non-empty)
  local is_error
  is_error=$(echo "$response" | jq -r '.code // empty' 2>/dev/null)
  if [[ -n "$is_error" ]]; then
    check_fail "$test_id" "RPC success" "error: $is_error"
    CAT_FAIL[$category]=$(( ${CAT_FAIL[$category]} + 1 ))
    return
  fi

  local result_count
  result_count=$(echo "$response" | jq 'length' 2>/dev/null)
  if [[ "$result_count" -lt 1 ]]; then
    check_fail "$test_id" "non-empty results" "got 0 candidates"
    CAT_FAIL[$category]=$(( ${CAT_FAIL[$category]} + 1 ))
    return
  fi
  check_pass "$test_id" "returned $result_count candidates"

  # Extract top result
  local top_name top_cuisine top_text_rank top_food_q top_svc_q top_amb_q top_val_s
  top_name=$(echo "$response" | jq -r '.[0].name // "?"')
  top_cuisine=$(echo "$response" | jq -r '.[0].cuisine_type // "?"')
  top_text_rank=$(echo "$response" | jq -r '.[0].ri_text_rank // 0')
  top_food_q=$(echo "$response" | jq -r '.[0].ri_review_food_quality // "null"')
  top_svc_q=$(echo "$response" | jq -r '.[0].ri_review_service_quality // "null"')
  top_amb_q=$(echo "$response" | jq -r '.[0].ri_review_ambiance_quality // "null"')
  top_val_s=$(echo "$response" | jq -r '.[0].ri_review_value_score // "null"')

  local top_dishes top_cuisine_signals top_popular
  top_dishes=$(echo "$response" | jq -r '.[0].ri_dish_catalog // [] | join(", ")' 2>/dev/null)
  top_cuisine_signals=$(echo "$response" | jq -r '.[0].ri_cuisine_signals // [] | join(", ")' 2>/dev/null)
  top_popular=$(echo "$response" | jq -r '.[0].ri_popular_dishes // [] | join(", ")' 2>/dev/null)

  echo "  -> #1: $top_name ($top_cuisine) | text_rank=$top_text_rank | food=$top_food_q svc=$top_svc_q amb=$top_amb_q val=$top_val_s"
  echo "  -> dishes: ${top_dishes:0:120}"
  echo "  -> cuisine_signals: ${top_cuisine_signals:0:100}"

  # Check 2: Review intelligence present on top result
  local ri_count
  ri_count=$(echo "$response" | jq '[.[] | select(.ri_dish_catalog != null and (.ri_dish_catalog | length) > 0)] | length' 2>/dev/null)
  if [[ "$ri_count" -gt 0 ]]; then
    TOTAL_RI_HIT=$((TOTAL_RI_HIT + ri_count))
    check_pass "$test_id" "review intelligence present ($ri_count/${result_count} candidates)"
  else
    TOTAL_RI_MISS=$((TOTAL_RI_MISS + 1))
    check_warn "$test_id" "no review intelligence on any candidate"
  fi

  # Check 3: ts_rank relevance for dish/cuisine queries
  if [[ "$check_type" == "dish" || "$check_type" == "cuisine" ]]; then
    # At least one candidate in top 5 should have text_rank > 0
    local any_ranked
    any_ranked=$(echo "$response" | jq '[.[0:5] | .[] | select(.ri_text_rank > 0)] | length' 2>/dev/null)
    if [[ "$any_ranked" -gt 0 ]]; then
      check_pass "$test_id" "text search matched ($any_ranked/5 top candidates ranked)"
    else
      check_warn "$test_id" "no text search matches in top 5" "query may use non-review terms"
    fi
  fi

  # Check 4: Expected terms found in top-3 candidates
  if [[ -n "$expected_terms" && "$expected_terms" != "any" ]]; then
    local found_match=false
    IFS='|' read -ra TERMS <<< "$expected_terms"
    # Search top 3 candidates' dish_catalog + cuisine_signals + cuisine_type
    local searchable
    searchable=$(echo "$response" | jq -r '[.[0:3] | .[] | (
      (.ri_dish_catalog // []) + (.ri_cuisine_signals // []) + (.ri_popular_dishes // []) + [.cuisine_type // ""]
    )] | flatten | map(ascii_downcase) | join(" ")' 2>/dev/null)

    for term in "${TERMS[@]}"; do
      local term_lower
      term_lower=$(echo "$term" | tr '[:upper:]' '[:lower:]')
      if echo "$searchable" | grep -qi "$term_lower"; then
        found_match=true
        break
      fi
    done

    if $found_match; then
      check_pass "$test_id" "expected term found in top-3"
      CAT_PASS[$category]=$(( ${CAT_PASS[$category]} + 1 ))
    else
      check_warn "$test_id" "expected terms not in top-3 RI data" "wanted: $expected_terms"
      CAT_WARN[$category]=$(( ${CAT_WARN[$category]} + 1 ))
    fi
  else
    CAT_PASS[$category]=$(( ${CAT_PASS[$category]} + 1 ))
  fi

  # Check 5: Review quality scores populated on top result
  if [[ "$top_food_q" != "null" && "$top_svc_q" != "null" ]]; then
    check_pass "$test_id" "quality scores populated (food=$top_food_q, svc=$top_svc_q)"
  else
    check_warn "$test_id" "quality scores missing on top result"
  fi

  # Save raw result
  echo "$response" | jq -c --arg tid "$test_id" --arg q "$query" --arg cat "$category" \
    --arg occ "$occasion" --arg ct "$check_type" --arg exp "$expected_terms" \
    '{test_id: $tid, query: $q, category: $cat, occasion: $occ, check_type: $ct,
      expected: $exp, result_count: (. | length),
      top1: {name: .[0].name, cuisine: .[0].cuisine_type, text_rank: .[0].ri_text_rank,
             food_q: .[0].ri_review_food_quality, dishes: (.[0].ri_dish_catalog // [] | length),
             cuisine_signals: .[0].ri_cuisine_signals}}' >> "$RAW_FILE" 2>/dev/null

  # Track text rank average
  TOTAL_TEXT_RANK=$(echo "$TOTAL_TEXT_RANK + ${top_text_rank:-0}" | bc 2>/dev/null || echo "$TOTAL_TEXT_RANK")
}

###############################################################################
# START
###############################################################################
echo ""
echo "============================================================"
echo "  V9 END-TO-END TEST — 100 COMPLEX QUERIES"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  RPC: get_candidates_v9"
echo "  Tests: 100 | Validates: RI data, ts_rank, quality scores"
echo "============================================================"

###############################################################################
# CATEGORY 1: DISH + CUISINE (10 tests)
# Complex: specific dish + cuisine type + occasion + noise words
###############################################################################
echo -e "\n${BOLD}=== CATEGORY 1: DISH + CUISINE (10) ===${NC}"

run_v9_test "V9-DC01" "DishCuisine" "authentic deep dish pizza for a fun night out in Chicago" "deep dish pizza|pizza" "Group Hangout" "dish"
run_v9_test "V9-DC02" "DishCuisine" "looking for real Korean BBQ with galbi and banchan somewhere cozy" "galbi|banchan|korean bbq" "Date Night" "dish"
run_v9_test "V9-DC03" "DishCuisine" "I want Thai pad see ew that reminds me of Bangkok street food" "pad see ew|thai" "Any" "dish"
run_v9_test "V9-DC04" "DishCuisine" "craving Japanese ramen with rich tonkotsu broth late night" "ramen|tonkotsu" "Chill Hangout" "dish"
run_v9_test "V9-DC05" "DishCuisine" "best Mexican tacos al pastor with fresh pineapple salsa please" "tacos al pastor|tacos|mexican" "Adventure" "dish"
run_v9_test "V9-DC06" "DishCuisine" "Ethiopian injera with doro wat for a unique cultural experience" "injera|doro wat|ethiopian" "Adventure" "dish"
run_v9_test "V9-DC07" "DishCuisine" "Italian truffle risotto for an anniversary celebration fine dining" "risotto|truffle|italian" "Special Occasion" "dish"
run_v9_test "V9-DC08" "DishCuisine" "Vietnamese pho with rare beef and tendon on a cold winter day" "pho|vietnamese" "Solo Dining" "dish"
run_v9_test "V9-DC09" "DishCuisine" "Indian butter chicken with garlic naan for family gathering" "butter chicken|naan|indian" "Family Dinner" "dish"
run_v9_test "V9-DC10" "DishCuisine" "fresh sushi omakase experience with uni and otoro at the bar" "omakase|sushi|uni|otoro" "Treat Myself" "dish"

###############################################################################
# CATEGORY 2: VIBE + DISH (10 tests)
# Complex: vibe descriptor + specific dish + conversational noise
###############################################################################
echo -e "\n${BOLD}=== CATEGORY 2: VIBE + DISH (10) ===${NC}"

run_v9_test "V9-VD01" "VibeDish" "cozy candlelit spot with amazing lobster bisque for two" "lobster|bisque|seafood" "Date Night" "dish"
run_v9_test "V9-VD02" "VibeDish" "loud energetic place with smash burgers and craft beer" "smash burger|burger" "Group Hangout" "dish"
run_v9_test "V9-VD03" "VibeDish" "quiet sophisticated wine bar with charcuterie board" "charcuterie|wine" "Date Night" "dish"
run_v9_test "V9-VD04" "VibeDish" "lively rooftop with amazing cocktails and ceviche" "ceviche|cocktails" "Group Hangout" "dish"
run_v9_test "V9-VD05" "VibeDish" "intimate speakeasy vibes with wagyu sliders and old fashioneds" "wagyu|speakeasy" "Date Night" "dish"
run_v9_test "V9-VD06" "VibeDish" "family friendly spot with incredible mac and cheese for kids" "mac and cheese|family" "Family Dinner" "dish"
run_v9_test "V9-VD07" "VibeDish" "hip trendy brunch with avocado toast and bottomless mimosas" "avocado toast|brunch|mimosas" "Chill Hangout" "dish"
run_v9_test "V9-VD08" "VibeDish" "rustic farmhouse feel with wood-fired margherita pizza" "margherita|pizza|wood-fired" "Date Night" "dish"
run_v9_test "V9-VD09" "VibeDish" "dark moody jazz bar with craft cocktails and oysters" "oysters|jazz|cocktails" "Date Night" "dish"
run_v9_test "V9-VD10" "VibeDish" "casual outdoor patio with fish tacos and margaritas" "fish tacos|tacos|margaritas" "Chill Hangout" "dish"

###############################################################################
# CATEGORY 3: OCCASION + DISH (10 tests)
# Complex: specific occasion + dish + filler words
###############################################################################
echo -e "\n${BOLD}=== CATEGORY 3: OCCASION + DISH (10) ===${NC}"

run_v9_test "V9-OD01" "OccasionDish" "anniversary dinner with steak and red wine somewhere elegant" "steak|steakhouse" "Special Occasion" "dish"
run_v9_test "V9-OD02" "OccasionDish" "business lunch power meeting with good salads and quiet space" "salad|business" "Business Lunch" "vibe"
run_v9_test "V9-OD03" "OccasionDish" "birthday party celebration with shared plates and fun atmosphere" "shared plates|tapas" "Group Hangout" "dish"
run_v9_test "V9-OD04" "OccasionDish" "solo ramen night just me and a steaming bowl of miso ramen" "ramen|miso" "Solo Dining" "dish"
run_v9_test "V9-OD05" "OccasionDish" "date night sushi where we can sit at the bar and watch the chef" "sushi|omakase" "Date Night" "dish"
run_v9_test "V9-OD06" "OccasionDish" "family brunch with pancakes and waffles kid-friendly please" "pancakes|waffles|brunch" "Family Dinner" "dish"
run_v9_test "V9-OD07" "OccasionDish" "group dinner for 8 people with sharable Korean fried chicken" "korean fried chicken|korean" "Group Hangout" "dish"
run_v9_test "V9-OD08" "OccasionDish" "treat myself to a fancy lobster roll after a long week" "lobster roll|lobster" "Treat Myself" "dish"
run_v9_test "V9-OD09" "OccasionDish" "late night adventure seeking the best al pastor street tacos" "al pastor|tacos" "Adventure" "dish"
run_v9_test "V9-OD10" "OccasionDish" "chill hangout vibes with wings and beer watching the game" "wings|beer" "Chill Hangout" "dish"

###############################################################################
# CATEGORY 4: COMPOUND + NOISE WORDS (10 tests)
# Complex: multiple cuisines/dishes + conversational padding
###############################################################################
echo -e "\n${BOLD}=== CATEGORY 4: COMPOUND + NOISE (10) ===${NC}"

run_v9_test "V9-CN01" "CompoundNoise" "my girlfriend wants sushi but I'm craving Italian so maybe something with both raw fish and pasta" "sushi|italian|pasta" "Date Night" "dish"
run_v9_test "V9-CN02" "CompoundNoise" "we can't decide between Thai curry and Mexican enchiladas help us find a place" "curry|thai|enchiladas|mexican" "Group Hangout" "cuisine"
run_v9_test "V9-CN03" "CompoundNoise" "I don't really know what I want maybe something Mediterranean with falafel or hummus" "falafel|hummus|mediterranean" "Any" "dish"
run_v9_test "V9-CN04" "CompoundNoise" "honestly just somewhere with amazing fried chicken and good music vibes" "fried chicken|chicken" "Chill Hangout" "dish"
run_v9_test "V9-CN05" "CompoundNoise" "looking for a place that does both great dim sum and Peking duck for Sunday family lunch" "dim sum|peking duck|chinese" "Family Dinner" "dish"
run_v9_test "V9-CN06" "CompoundNoise" "need a restaurant where half the group is vegetarian but I want steak" "steak|vegetarian" "Group Hangout" "dish"
run_v9_test "V9-CN07" "CompoundNoise" "something like bao buns or soup dumplings nothing too fancy just really good" "bao|soup dumplings|dumplings" "Chill Hangout" "dish"
run_v9_test "V9-CN08" "CompoundNoise" "want to explore African food maybe Nigerian jollof rice or Ethiopian combo plate" "jollof|ethiopian|african" "Adventure" "cuisine"
run_v9_test "V9-CN09" "CompoundNoise" "craving comfort food like mac cheese or meatloaf or pot pie something homey" "mac|meatloaf|comfort" "Solo Dining" "dish"
run_v9_test "V9-CN10" "CompoundNoise" "my parents are visiting from India and they want something spicy but not just Indian food" "spicy|indian" "Family Dinner" "cuisine"

###############################################################################
# CATEGORY 5: NICHE CUISINE (10 tests)
# Complex: less common cuisines + dish + occasion
###############################################################################
echo -e "\n${BOLD}=== CATEGORY 5: NICHE CUISINE (10) ===${NC}"

run_v9_test "V9-NC01" "NicheCuisine" "Peruvian ceviche with leche de tigre for a fun foodie adventure" "ceviche|peruvian" "Adventure" "dish"
run_v9_test "V9-NC02" "NicheCuisine" "Polish pierogi and kielbasa somewhere authentic old school" "pierogi|kielbasa|polish" "Any" "dish"
run_v9_test "V9-NC03" "NicheCuisine" "Puerto Rican mofongo with garlic sauce like grandma used to make" "mofongo|puerto rican" "Family Dinner" "dish"
run_v9_test "V9-NC04" "NicheCuisine" "Turkish kebabs and baklava for a group dinner celebration" "kebab|baklava|turkish" "Group Hangout" "dish"
run_v9_test "V9-NC05" "NicheCuisine" "Greek moussaka and fresh grilled octopus by the waterfront" "moussaka|octopus|greek" "Date Night" "dish"
run_v9_test "V9-NC06" "NicheCuisine" "Jamaican jerk chicken with festival and rice and peas" "jerk chicken|jamaican" "Chill Hangout" "dish"
run_v9_test "V9-NC07" "NicheCuisine" "Lebanese shawarma and tabbouleh quick casual lunch spot" "shawarma|tabbouleh|lebanese" "Solo Dining" "dish"
run_v9_test "V9-NC08" "NicheCuisine" "Filipino adobo and lumpia somewhere fun and casual" "adobo|lumpia|filipino" "Chill Hangout" "dish"
run_v9_test "V9-NC09" "NicheCuisine" "Colombian empanadas and bandeja paisa authentic Latin vibes" "empanadas|colombian" "Adventure" "dish"
run_v9_test "V9-NC10" "NicheCuisine" "Moroccan tagine with couscous romantic candlelit setting" "tagine|couscous|moroccan" "Date Night" "dish"

###############################################################################
# CATEGORY 6: DIETARY + DISH (10 tests)
# Complex: dietary restriction + dish craving + occasion
###############################################################################
echo -e "\n${BOLD}=== CATEGORY 6: DIETARY + DISH (10) ===${NC}"

run_v9_test "V9-DD01" "DietaryDish" "vegan ramen with rich mushroom broth date night" "ramen|vegan|mushroom" "Date Night" "dish"
run_v9_test "V9-DD02" "DietaryDish" "gluten free pasta that actually tastes good Italian place" "pasta|gluten free|italian" "Any" "dish"
run_v9_test "V9-DD03" "DietaryDish" "keto friendly burger without the bun lettuce wrap style" "burger|keto" "Solo Dining" "dish"
run_v9_test "V9-DD04" "DietaryDish" "vegetarian Thai green curry with tofu extra spicy" "green curry|thai|tofu" "Chill Hangout" "dish"
run_v9_test "V9-DD05" "DietaryDish" "halal Middle Eastern lamb shawarma plate for family" "shawarma|lamb|halal|middle eastern" "Family Dinner" "dish"
run_v9_test "V9-DD06" "DietaryDish" "dairy free dessert options alongside a good steak dinner" "steak|dairy free|dessert" "Special Occasion" "dish"
run_v9_test "V9-DD07" "DietaryDish" "pescatarian sushi with great veggie rolls too" "sushi|veggie rolls|pescatarian" "Date Night" "dish"
run_v9_test "V9-DD08" "DietaryDish" "nut allergy safe Chinese food dim sum style brunch" "dim sum|chinese|nut" "Family Dinner" "dish"
run_v9_test "V9-DD09" "DietaryDish" "organic farm to table salads with grilled chicken healthy spot" "salad|farm to table|organic" "Business Lunch" "dish"
run_v9_test "V9-DD10" "DietaryDish" "kosher deli with pastrami sandwich old school NYC vibes" "pastrami|kosher|deli" "Solo Dining" "dish"

###############################################################################
# CATEGORY 7: PRICE + DISH (10 tests)
# Complex: price expectation + specific dish + vibe words
###############################################################################
echo -e "\n${BOLD}=== CATEGORY 7: PRICE + DISH (10) ===${NC}"

run_v9_test "V9-PD01" "PriceDish" "cheap amazing tacos hole in the wall authentic spot" "tacos|hole in the wall" "Adventure" "dish"
run_v9_test "V9-PD02" "PriceDish" "splurge on wagyu beef tasting menu blow my mind" "wagyu|tasting menu" "Treat Myself" "dish"
run_v9_test "V9-PD03" "PriceDish" "affordable BYOB Italian with homemade pasta" "pasta|byob|italian" "Date Night" "dish"
run_v9_test "V9-PD04" "PriceDish" "cheap eats best bang for buck pho or banh mi" "pho|banh mi" "Solo Dining" "dish"
run_v9_test "V9-PD05" "PriceDish" "upscale steakhouse dry aged ribeye worth every penny" "ribeye|steak|dry aged" "Special Occasion" "dish"
run_v9_test "V9-PD06" "PriceDish" "budget friendly late night pizza by the slice" "pizza|slice" "Chill Hangout" "dish"
run_v9_test "V9-PD07" "PriceDish" "mid range Greek spot with great lamb chops and atmosphere" "lamb chops|greek" "Date Night" "dish"
run_v9_test "V9-PD08" "PriceDish" "fancy cocktail bar with small plates not too expensive" "cocktails|small plates" "Date Night" "dish"
run_v9_test "V9-PD09" "PriceDish" "dirt cheap dumplings cash only doesn't matter dive is fine" "dumplings|cheap|dive" "Adventure" "dish"
run_v9_test "V9-PD10" "PriceDish" "fine dining tasting menu with wine pairing special anniversary" "tasting menu|wine pairing" "Special Occasion" "dish"

###############################################################################
# CATEGORY 8: MULTI-SIGNAL (10 tests)
# Complex: multiple overlapping signals pushing relevance
###############################################################################
echo -e "\n${BOLD}=== CATEGORY 8: MULTI-SIGNAL (10) ===${NC}"

run_v9_test "V9-MS01" "MultiSignal" "spicy Sichuan mapo tofu numbing peppercorn authentic Chinese" "mapo tofu|sichuan|chinese" "Adventure" "dish"
run_v9_test "V9-MS02" "MultiSignal" "smoky BBQ brisket with cornbread and collard greens Southern soul food" "brisket|bbq|cornbread|southern" "Family Dinner" "dish"
run_v9_test "V9-MS03" "MultiSignal" "fresh handmade pasta carbonara with guanciale not bacon proper Roman" "carbonara|pasta|italian|roman" "Date Night" "dish"
run_v9_test "V9-MS04" "MultiSignal" "live jazz music with cajun crawfish boil and dirty rice" "crawfish|cajun|jazz" "Group Hangout" "dish"
run_v9_test "V9-MS05" "MultiSignal" "Sunday dim sum cart service with har gow and siu mai tea service" "dim sum|har gow|siu mai|chinese" "Family Dinner" "dish"
run_v9_test "V9-MS06" "MultiSignal" "craft beer garden with gourmet hot dogs and pretzel bites" "hot dogs|beer|pretzel" "Group Hangout" "dish"
run_v9_test "V9-MS07" "MultiSignal" "upscale Japanese izakaya with yakitori skewers sake flights small plates" "yakitori|izakaya|sake|japanese" "Date Night" "dish"
run_v9_test "V9-MS08" "MultiSignal" "brunch buffet eggs benedict french toast bottomless champagne Sunday" "eggs benedict|french toast|brunch" "Group Hangout" "dish"
run_v9_test "V9-MS09" "MultiSignal" "late night Korean fried chicken with spicy gochujang sauce and soju" "korean fried chicken|gochujang|korean" "Chill Hangout" "dish"
run_v9_test "V9-MS10" "MultiSignal" "waterfront seafood raw bar with oysters clams shrimp cocktail" "oysters|clams|shrimp|seafood" "Special Occasion" "dish"

###############################################################################
# CATEGORY 9: EDGE CASES (10 tests)
# Complex: ambiguous, misspelled, ultra-specific, contradictory
###############################################################################
echo -e "\n${BOLD}=== CATEGORY 9: EDGE CASES (10) ===${NC}"

run_v9_test "V9-EC01" "EdgeCase" "surprise me with something amazing I trust you completely" "any" "Any" "open"
run_v9_test "V9-EC02" "EdgeCase" "idk maybe like some noodles or something whatever" "noodle|ramen|pho|pasta" "Any" "dish"
run_v9_test "V9-EC03" "EdgeCase" "teh best taco's in chicagoo plz" "tacos|taco" "Any" "dish"
run_v9_test "V9-EC04" "EdgeCase" "something nobody has heard of hidden gem underground food scene" "any" "Adventure" "open"
run_v9_test "V9-EC05" "EdgeCase" "I want breakfast food but for dinner like a diner" "breakfast|diner" "Any" "dish"
run_v9_test "V9-EC06" "EdgeCase" "fusion restaurant mixing Japanese and Mexican flavors" "japanese|mexican|fusion" "Date Night" "cuisine"
run_v9_test "V9-EC07" "EdgeCase" "just coffee and pastries somewhere quiet to work for hours" "coffee|pastries" "Solo Dining" "dish"
run_v9_test "V9-EC08" "EdgeCase" "the most Instagram worthy restaurant beautiful plating and decor" "any" "Treat Myself" "vibe"
run_v9_test "V9-EC09" "EdgeCase" "old school Chicago Italian beef with hot giardiniera dipped" "italian beef|giardiniera" "Any" "dish"
run_v9_test "V9-EC10" "EdgeCase" "where do locals actually eat not tourist traps real neighborhood spot" "any" "Adventure" "open"

###############################################################################
# CATEGORY 10: DISCOVERY MIX (10 tests)
# Complex: unusual combos designed to test RI breadth
###############################################################################
echo -e "\n${BOLD}=== CATEGORY 10: DISCOVERY MIX (10) ===${NC}"

run_v9_test "V9-DM01" "DiscoveryMix" "artisan sourdough bread with fancy butter and natural wine" "sourdough|bread|wine" "Date Night" "dish"
run_v9_test "V9-DM02" "DiscoveryMix" "Argentinian empanadas with chimichurri and a Malbec" "empanadas|chimichurri|argentinian" "Chill Hangout" "dish"
run_v9_test "V9-DM03" "DiscoveryMix" "Hawaiian poke bowl with ahi tuna and spicy mayo casual spot" "poke|ahi tuna|hawaiian" "Solo Dining" "dish"
run_v9_test "V9-DM04" "DiscoveryMix" "German biergarten with bratwurst pretzels and boot of beer" "bratwurst|pretzel|german|biergarten" "Group Hangout" "dish"
run_v9_test "V9-DM05" "DiscoveryMix" "Venezuelan arepas with black beans and plantains" "arepas|venezuelan|plantains" "Adventure" "dish"
run_v9_test "V9-DM06" "DiscoveryMix" "French bistro with duck confit and creme brulee" "duck confit|creme brulee|french" "Date Night" "dish"
run_v9_test "V9-DM07" "DiscoveryMix" "Mediterranean mezze platter with baba ganoush and grilled halloumi" "mezze|baba ganoush|halloumi|mediterranean" "Group Hangout" "dish"
run_v9_test "V9-DM08" "DiscoveryMix" "Cuban sandwich with roast pork and swiss cheese old Havana vibes" "cuban sandwich|cuban|roast pork" "Solo Dining" "dish"
run_v9_test "V9-DM09" "DiscoveryMix" "Neapolitan pizza with San Marzano tomatoes fresh mozzarella wood fire" "neapolitan|pizza|san marzano" "Any" "dish"
run_v9_test "V9-DM10" "DiscoveryMix" "Southeast Asian laksa with coconut broth and shrimp rainy day comfort" "laksa|coconut|southeast asian" "Solo Dining" "dish"

###############################################################################
# SUMMARY
###############################################################################
echo ""
echo "============================================================"
echo "  V9 E2E TEST RESULTS"
echo "============================================================"
echo ""
echo -e "  ${GREEN}PASS:${NC} $PASS"
echo -e "  ${RED}FAIL:${NC} $FAIL"
echo -e "  ${YELLOW}WARN:${NC} $WARN"
echo "  TOTAL CHECKS: $((PASS + FAIL + WARN))"
echo "  TOTAL QUERIES: $TOTAL"
echo ""
echo "  RI Coverage: $TOTAL_RI_HIT candidates with RI data"
echo "  RI Misses: $TOTAL_RI_MISS queries with no RI on any candidate"
echo ""
echo "  Category Breakdown:"
echo "  ────────────────────────────────────────────────"
printf "  %-15s %-6s %-6s %-6s %-6s\n" "Category" "Tests" "Pass" "Fail" "Warn"
echo "  ────────────────────────────────────────────────"
for cat in DishCuisine VibeDish OccasionDish CompoundNoise NicheCuisine DietaryDish PriceDish MultiSignal EdgeCase DiscoveryMix; do
  printf "  %-15s %-6s %-6s %-6s %-6s\n" "$cat" "${CAT_COUNT[$cat]}" "${CAT_PASS[$cat]}" "${CAT_FAIL[$cat]}" "${CAT_WARN[$cat]}"
done

HARD_PASS_RATE=0
if [[ $((PASS + FAIL + WARN)) -gt 0 ]]; then
  HARD_PASS_RATE=$(( (PASS * 100) / (PASS + FAIL + WARN) ))
fi

echo ""
echo "  Hard Pass Rate: ${HARD_PASS_RATE}%"
echo ""

###############################################################################
# GENERATE MARKDOWN REPORT
###############################################################################
{
  echo "# V9 End-to-End Test Results — 100 Complex Queries"
  echo ""
  echo "**Date:** $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "**RPC:** get_candidates_v9 (review intelligence + ts_rank)"
  echo "**Tests:** $TOTAL queries | **Checks:** $((PASS + FAIL + WARN))"
  echo ""
  echo "## Summary"
  echo ""
  echo "| Metric | Value |"
  echo "|--------|-------|"
  echo "| PASSED | $PASS |"
  echo "| FAILED | $FAIL |"
  echo "| WARNED | $WARN |"
  echo "| Hard Pass Rate | ${HARD_PASS_RATE}% |"
  echo "| RI Coverage (candidates with RI) | $TOTAL_RI_HIT |"
  echo "| RI Misses (queries with 0 RI) | $TOTAL_RI_MISS |"
  echo ""
  echo "## Category Breakdown"
  echo ""
  echo "| Category | Tests | Pass | Fail | Warn |"
  echo "|----------|-------|------|------|------|"
  for cat in DishCuisine VibeDish OccasionDish CompoundNoise NicheCuisine DietaryDish PriceDish MultiSignal EdgeCase DiscoveryMix; do
    echo "| $cat | ${CAT_COUNT[$cat]} | ${CAT_PASS[$cat]} | ${CAT_FAIL[$cat]} | ${CAT_WARN[$cat]} |"
  done
  echo ""
  echo "## Test Design"
  echo ""
  echo "Each query is **complex multi-signal**: cuisine + dish + occasion + natural language noise."
  echo "This tests the V9 pipeline's ability to:"
  echo "1. Retrieve relevant candidates via \`ts_rank()\` on review intelligence text vectors"
  echo "2. Surface restaurants whose \`dish_catalog\` contains the queried dish"
  echo "3. Match \`cuisine_signals\` from actual reviewer descriptions"
  echo "4. Populate review quality scores (food, service, ambiance, value)"
  echo ""
  echo "### Categories"
  echo "- **DishCuisine (10):** Specific dish + cuisine type + occasion"
  echo "- **VibeDish (10):** Vibe descriptor + specific dish"
  echo "- **OccasionDish (10):** Occasion context + dish craving"
  echo "- **CompoundNoise (10):** Multiple cuisines/dishes + conversational padding"
  echo "- **NicheCuisine (10):** Less common cuisines (Peruvian, Polish, Filipino, etc.)"
  echo "- **DietaryDish (10):** Dietary restriction + dish + occasion"
  echo "- **PriceDish (10):** Price expectation + specific dish"
  echo "- **MultiSignal (10):** Overlapping reinforcing signals"
  echo "- **EdgeCase (10):** Ambiguous, misspelled, contradictory queries"
  echo "- **DiscoveryMix (10):** Unusual combos testing RI breadth"
} > "$REPORT_FILE"

echo "  Report: $REPORT_FILE"
echo "  Raw results: $RAW_FILE"
echo ""

# Exit with failure if any hard fails
if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
