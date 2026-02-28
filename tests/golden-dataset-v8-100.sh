#!/usr/bin/env bash
set -uo pipefail

###############################################################################
# DONDE GOLDEN DATASET V8 — 100-CASE TEST SUITE
# Expanded from 50 (V7.3b) to 100 diversified test cases.
# Tests the live production API across 5 categories + 8 new sub-categories.
#
# 100 test cases:
#   Original 50: Food (15), Vibe (10), Service (10), Reputation (5), Convenience (10)
#   New 50: Multi-Signal (8), Dish-Level (6), Dietary (6), Occasion (8),
#           Compound (6), Niche Cuisine (6), Price (5), Time (5)
#
# Usage:  chmod +x tests/golden-dataset-v8-100.sh && ./tests/golden-dataset-v8-100.sh
# Deps:   curl, jq (v1.6+), bash 4+
###############################################################################

API="https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend"
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
TOTAL_DONDE_MATCH=0
TOTAL_TESTS=0
TEST_LOG=""
LAST_RESPONSE=""
HTTP_CODE=""
REPORT_FILE="tests/GOLDEN_DATASET_V8_RESULTS.md"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_PATH="$(dirname "$SCRIPT_DIR")/$REPORT_FILE"
RAW_RESULTS_FILE="$(dirname "$SCRIPT_DIR")/tests/V8_RAW_RESULTS.jsonl"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Category tracking
declare -A CAT_PASS CAT_FAIL CAT_WARN CAT_SUM CAT_COUNT
for cat in Food Vibe Service Reputation Convenience; do
  CAT_PASS[$cat]=0; CAT_FAIL[$cat]=0; CAT_WARN[$cat]=0; CAT_SUM[$cat]=0; CAT_COUNT[$cat]=0
done

# Clear raw results
> "$RAW_RESULTS_FILE"

###############################################################################
# HELPER FUNCTIONS
###############################################################################

api_call() {
  local body="${1:-'{}'}"
  local raw
  raw=$(curl -s -w "\n%{http_code}" -X POST "$API" \
    -H "Content-Type: application/json" \
    -d "$body" \
    --max-time 45 2>/dev/null)
  HTTP_CODE=$(echo "$raw" | tail -n1)
  LAST_RESPONSE=$(echo "$raw" | sed '$d')
}

check_pass() {
  local test_id="$1"
  local check_name="$2"
  echo -e "  ${GREEN}PASS${NC} [$test_id] $check_name"
  ((PASS_COUNT++))
  TEST_LOG+="PASS|$test_id|$check_name\n"
}

check_fail() {
  local test_id="$1"
  local check_name="$2"
  local detail="${3:-}"
  echo -e "  ${RED}FAIL${NC} [$test_id] $check_name${detail:+ ($detail)}"
  ((FAIL_COUNT++))
  TEST_LOG+="FAIL|$test_id|$check_name|$detail\n"
}

check_warn() {
  local test_id="$1"
  local check_name="$2"
  local detail="${3:-}"
  echo -e "  ${YELLOW}WARN${NC} [$test_id] $check_name${detail:+ ($detail)}"
  ((WARN_COUNT++))
  TEST_LOG+="WARN|$test_id|$check_name|$detail\n"
}

# Run a single golden dataset test
# $1: test_id, $2: category, $3: query, $4: expected_cuisines (pipe-separated), $5: min_score, $6: occasion (optional)
run_golden_test() {
  local test_id="$1"
  local category="$2"
  local query="$3"
  local expected_cuisines="$4"
  local min_score="${5:-55}"
  local occasion="${6:-Any}"

  echo -e "\n${CYAN}[$test_id] $category: \"$query\"${NC}"

  local body
  body=$(jq -n \
    --arg sr "$query" \
    --arg occ "$occasion" \
    '{special_request: $sr, occasion: $occ, neighborhood: "Anywhere", price_level: "Any"}')

  api_call "$body"

  if [[ "$HTTP_CODE" != "200" ]]; then
    check_fail "$test_id" "HTTP 200" "got $HTTP_CODE"
    return
  fi

  local success
  success=$(echo "$LAST_RESPONSE" | jq -r '.success' 2>/dev/null)
  if [[ "$success" != "true" ]]; then
    check_fail "$test_id" "success=true" "got $success"
    return
  fi

  # Extract key metrics
  local donde_match restaurant_name cuisine_type
  donde_match=$(echo "$LAST_RESPONSE" | jq -r '.donde_match // 0' 2>/dev/null)
  restaurant_name=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.name // "unknown"' 2>/dev/null)
  cuisine_type=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // "unknown"' 2>/dev/null)

  local food_score vibe_score service_score rep_score conv_score
  food_score=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.food // 0' 2>/dev/null)
  vibe_score=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.vibe // 0' 2>/dev/null)
  service_score=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.service // 0' 2>/dev/null)
  rep_score=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.reputation // 0' 2>/dev/null)
  conv_score=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.convenience // 0' 2>/dev/null)

  # Extract weights and intent alignment
  local weights_food weights_vibe weights_service weights_rep weights_conv
  weights_food=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.weights_used.food // 0' 2>/dev/null)
  weights_vibe=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.weights_used.vibe // 0' 2>/dev/null)
  weights_service=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.weights_used.service // 0' 2>/dev/null)
  weights_rep=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.weights_used.reputation // 0' 2>/dev/null)
  weights_conv=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.weights_used.convenience // 0' 2>/dev/null)

  local intent_cuisine intent_dish intent_vibe intent_constraints intent_score
  intent_score=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.intent_alignment.score // "N/A"' 2>/dev/null)
  intent_cuisine=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.intent_alignment.cuisine // "N/A"' 2>/dev/null)
  intent_dish=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.intent_alignment.dish // "N/A"' 2>/dev/null)
  intent_vibe=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.intent_alignment.vibe // "N/A"' 2>/dev/null)
  intent_constraints=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.intent_alignment.constraints // "N/A"' 2>/dev/null)

  local weight_shift_reasons
  weight_shift_reasons=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.weight_shift_reasons // [] | join(", ")' 2>/dev/null)

  echo "  → $restaurant_name ($cuisine_type) | DM: $donde_match | Food: $food_score | Vibe: $vibe_score | Svc: $service_score | Rep: $rep_score | Conv: $conv_score"
  echo "  → Weights: F:$weights_food V:$weights_vibe S:$weights_service R:$weights_rep C:$weights_conv | Intent: $intent_score"

  # Save raw result for case study analysis
  echo "$LAST_RESPONSE" | jq -c --arg tid "$test_id" --arg q "$query" --arg cat "$category" \
    --arg min "$min_score" --arg occ "$occasion" --arg exp "$expected_cuisines" \
    '{test_id: $tid, query: $q, category: $cat, min_score: ($min | tonumber), occasion: $occ, expected_cuisines: $exp,
      donde_match: .donde_match, restaurant_name: .restaurant.name, cuisine_type: .restaurant.cuisine_type,
      food: .scoring_v5.food, vibe: .scoring_v5.vibe, service: .scoring_v5.service,
      reputation: .scoring_v5.reputation, convenience: .scoring_v5.convenience,
      weights: .scoring_v5.weights_used, intent_alignment: .scoring_v5.intent_alignment,
      weight_shift_reasons: .scoring_v5.weight_shift_reasons,
      data_completeness: .scoring_v5.data_completeness}' >> "$RAW_RESULTS_FILE" 2>/dev/null

  # Track donde_match for category averages
  ((TOTAL_TESTS++))
  TOTAL_DONDE_MATCH=$((TOTAL_DONDE_MATCH + ${donde_match%.*}))

  local cat_key="$category"
  CAT_SUM[$cat_key]=$(( ${CAT_SUM[$cat_key]} + ${donde_match%.*} ))
  CAT_COUNT[$cat_key]=$(( ${CAT_COUNT[$cat_key]} + 1 ))

  # Check 1: donde_match meets minimum threshold
  local dm_int=${donde_match%.*}
  if (( dm_int >= min_score )); then
    check_pass "$test_id" "donde_match >= $min_score (got $donde_match)"
    CAT_PASS[$cat_key]=$(( ${CAT_PASS[$cat_key]} + 1 ))
  elif (( dm_int >= min_score - 10 )); then
    check_warn "$test_id" "donde_match near threshold" "got $donde_match, want >= $min_score"
    CAT_WARN[$cat_key]=$(( ${CAT_WARN[$cat_key]} + 1 ))
  else
    check_fail "$test_id" "donde_match >= $min_score" "got $donde_match"
    CAT_FAIL[$cat_key]=$(( ${CAT_FAIL[$cat_key]} + 1 ))
  fi

  # Check 2: Cuisine match (for Food category)
  if [[ "$category" == "Food" && -n "$expected_cuisines" && "$expected_cuisines" != "any" ]]; then
    local cuisine_lower
    cuisine_lower=$(echo "$cuisine_type" | tr '[:upper:]' '[:lower:]')
    local cuisine_matched=false
    IFS='|' read -ra CUISINE_LIST <<< "$expected_cuisines"
    for ec in "${CUISINE_LIST[@]}"; do
      local ec_lower
      ec_lower=$(echo "$ec" | tr '[:upper:]' '[:lower:]')
      if [[ "$cuisine_lower" == *"$ec_lower"* || "$ec_lower" == *"$cuisine_lower"* ]]; then
        cuisine_matched=true
        break
      fi
    done
    if $cuisine_matched; then
      check_pass "$test_id" "cuisine match ($cuisine_type)"
    else
      check_warn "$test_id" "cuisine match" "expected one of [$expected_cuisines], got $cuisine_type"
    fi
  fi

  # Check 3: Food score for food queries
  if [[ "$category" == "Food" ]]; then
    local fs_int=${food_score%.*}
    if (( fs_int >= 5 )); then
      check_pass "$test_id" "food_score >= 5 (got $food_score)"
    else
      check_warn "$test_id" "food_score low" "got $food_score"
    fi
  fi

  # Check 4: Vibe score for vibe queries
  if [[ "$category" == "Vibe" ]]; then
    local vs_int=${vibe_score%.*}
    if (( vs_int >= 5 )); then
      check_pass "$test_id" "vibe_score >= 5 (got $vibe_score)"
    else
      check_warn "$test_id" "vibe_score low" "got $vibe_score"
    fi
  fi

  # Small delay to respect rate limits
  sleep 1
}

###############################################################################
# START
###############################################################################
echo ""
echo "============================================================"
echo "  DONDE GOLDEN DATASET V8 — 100-CASE TEST SUITE"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  Endpoint: $API"
echo "  Tests: 100 | Categories: Food, Vibe, Service, Reputation, Convenience"
echo "============================================================"

###############################################################################
# PHASE 1: FOOD (15 tests — original)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 1: FOOD QUERIES — Original (15 tests)                       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-F01" "Food" "smash burger" "American" 55
run_golden_test "GD-F02" "Food" "soup dumplings" "Chinese" 55
run_golden_test "GD-F03" "Food" "korean fried chicken" "Korean" 55
run_golden_test "GD-F04" "Food" "truffle pasta" "Italian" 55
run_golden_test "GD-F05" "Food" "cuban food" "Caribbean|Cuban" 50
run_golden_test "GD-F06" "Food" "hand rolls" "Japanese" 55
run_golden_test "GD-F07" "Food" "acai bowl" "any" 45
run_golden_test "GD-F08" "Food" "jerk chicken" "Caribbean|Jamaican" 50
run_golden_test "GD-F09" "Food" "fondue" "French" 50
run_golden_test "GD-F10" "Food" "deep dish pizza" "Italian|American" 60
run_golden_test "GD-F11" "Food" "lobster bisque" "Seafood|French" 50
run_golden_test "GD-F12" "Food" "taiwanese food" "Taiwanese|Chinese" 50
run_golden_test "GD-F13" "Food" "hot chicken" "American|Southern" 50
run_golden_test "GD-F14" "Food" "charcuterie board" "French|Italian" 50
run_golden_test "GD-F15" "Food" "grain bowl" "any" 45

###############################################################################
# PHASE 2: VIBE (10 tests — original)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 2: VIBE QUERIES — Original (10 tests)                       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-V01" "Vibe" "speakeasy" "any" 55
run_golden_test "GD-V02" "Vibe" "jazz bar" "any" 50
run_golden_test "GD-V03" "Vibe" "tiki bar" "any" 50
run_golden_test "GD-V04" "Vibe" "karaoke bar" "any" 45
run_golden_test "GD-V05" "Vibe" "rooftop brunch" "any" 55
run_golden_test "GD-V06" "Vibe" "bottomless brunch" "any" 55
run_golden_test "GD-V07" "Vibe" "power lunch" "any" 55
run_golden_test "GD-V08" "Vibe" "dive bar" "any" 50
run_golden_test "GD-V09" "Vibe" "sports bar" "any" 50
run_golden_test "GD-V10" "Vibe" "cozy date night restaurant" "any" 60 "Date Night"

###############################################################################
# PHASE 3: SERVICE (10 tests — original)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 3: SERVICE QUERIES — Original (10 tests)                    ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-S01" "Service" "walk in friendly restaurant" "any" 55
run_golden_test "GD-S02" "Service" "large party dining" "any" 50 "Group Hangout"
run_golden_test "GD-S03" "Service" "happy hour" "any" 55
run_golden_test "GD-S04" "Service" "omakase" "Japanese" 55
run_golden_test "GD-S05" "Service" "prix fixe dinner" "any" 55
run_golden_test "GD-S06" "Service" "outdoor seating" "any" 55
run_golden_test "GD-S07" "Service" "byob restaurant" "any" 55
run_golden_test "GD-S08" "Service" "family style dinner" "any" 55 "Family Dinner"
run_golden_test "GD-S09" "Service" "valet parking" "any" 50
run_golden_test "GD-S10" "Service" "private dining room" "any" 55 "Special Occasion"

###############################################################################
# PHASE 4: REPUTATION (5 tests — original)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 4: REPUTATION QUERIES — Original (5 tests)                  ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-R01" "Reputation" "best tasting menu in chicago" "any" 60
run_golden_test "GD-R02" "Reputation" "michelin star restaurant" "any" 65
run_golden_test "GD-R03" "Reputation" "best craft cocktail bar" "any" 55
run_golden_test "GD-R04" "Reputation" "best rooftop dining" "any" 55
run_golden_test "GD-R05" "Reputation" "james beard restaurant" "any" 60

###############################################################################
# PHASE 5: CONVENIENCE (10 tests — original)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 5: CONVENIENCE QUERIES — Original (10 tests)                ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-C01" "Convenience" "late night food" "any" 50
run_golden_test "GD-C02" "Convenience" "west loop restaurants" "any" 55
run_golden_test "GD-C03" "Convenience" "near wrigley field" "any" 45
run_golden_test "GD-C04" "Convenience" "quick lunch near the loop" "any" 55
run_golden_test "GD-C05" "Convenience" "open for sunday dinner" "any" 55
run_golden_test "GD-C06" "Convenience" "restaurant with free wifi" "any" 45
run_golden_test "GD-C07" "Convenience" "kid friendly brunch" "any" 55 "Family Dinner"
run_golden_test "GD-C08" "Convenience" "dog friendly patio" "any" 50
run_golden_test "GD-C09" "Convenience" "river north restaurant" "any" 55
run_golden_test "GD-C10" "Convenience" "logan square restaurant" "any" 55

###############################################################################
# PHASE 6: MULTI-SIGNAL — food + vibe combined (8 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 6: MULTI-SIGNAL QUERIES (8 tests)                           ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-N01" "Food" "romantic italian dinner" "Italian" 60 "Date Night"
run_golden_test "GD-N02" "Food" "trendy sushi spot" "Japanese" 55
run_golden_test "GD-N03" "Food" "cozy ramen place" "Japanese" 55
run_golden_test "GD-N04" "Vibe" "lively mexican restaurant" "Mexican" 55 "Group Hangout"
run_golden_test "GD-N05" "Food" "upscale steakhouse" "American|Steak" 60 "Special Occasion"
run_golden_test "GD-N06" "Vibe" "intimate wine bar" "any" 55 "Date Night"
run_golden_test "GD-N07" "Food" "casual thai food" "Thai" 55 "Chill Hangout"
run_golden_test "GD-N08" "Food" "authentic indian curry" "Indian" 55

###############################################################################
# PHASE 7: DISH-LEVEL INTENT (6 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 7: DISH-LEVEL INTENT QUERIES (6 tests)                      ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-N09" "Food" "pad thai" "Thai" 55
run_golden_test "GD-N10" "Food" "margherita pizza" "Italian" 55
run_golden_test "GD-N11" "Food" "pho" "Vietnamese" 55
run_golden_test "GD-N12" "Food" "tacos al pastor" "Mexican" 55
run_golden_test "GD-N13" "Food" "chicken tikka masala" "Indian" 50
run_golden_test "GD-N14" "Food" "sashimi platter" "Japanese" 55

###############################################################################
# PHASE 8: DIETARY RESTRICTIONS (6 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 8: DIETARY RESTRICTION QUERIES (6 tests)                    ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-N15" "Food" "vegan restaurant" "any" 50
run_golden_test "GD-N16" "Food" "gluten free options" "any" 50
run_golden_test "GD-N17" "Food" "halal food" "any" 45
run_golden_test "GD-N18" "Food" "vegetarian friendly dinner" "any" 50
run_golden_test "GD-N19" "Food" "dairy free restaurant" "any" 45
run_golden_test "GD-N20" "Food" "plant based burger" "any" 45

###############################################################################
# PHASE 9: OCCASION-SPECIFIC (8 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 9: OCCASION-SPECIFIC QUERIES (8 tests)                      ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-N21" "Service" "first date restaurant" "any" 55 "Date Night"
run_golden_test "GD-N22" "Service" "anniversary dinner" "any" 60 "Special Occasion"
run_golden_test "GD-N23" "Service" "birthday party venue" "any" 55 "Group Hangout"
run_golden_test "GD-N24" "Service" "business client dinner" "any" 55 "Business Lunch"
run_golden_test "GD-N25" "Service" "solo dining counter seat" "any" 50 "Solo Dining"
run_golden_test "GD-N26" "Service" "treat myself dinner" "any" 55 "Treat Myself"
run_golden_test "GD-N27" "Service" "family brunch with kids" "any" 50 "Family Dinner"
run_golden_test "GD-N28" "Service" "casual hangout with friends" "any" 55 "Chill Hangout"

###############################################################################
# PHASE 10: COMPOUND QUERIES (6 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 10: COMPOUND QUERIES (6 tests)                              ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-N29" "Food" "spicy thai food with outdoor seating" "Thai" 55
run_golden_test "GD-N30" "Food" "cheap mexican food near downtown" "Mexican" 50
run_golden_test "GD-N31" "Vibe" "quiet restaurant good for conversation" "any" 55 "Date Night"
run_golden_test "GD-N32" "Food" "best pizza by the slice late night" "Italian|American" 50
run_golden_test "GD-N33" "Vibe" "restaurant with live music and cocktails" "any" 50
run_golden_test "GD-N34" "Food" "healthy salad bowl near loop" "any" 45

###############################################################################
# PHASE 11: NICHE/EDGE CUISINES (6 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 11: NICHE/EDGE CUISINE QUERIES (6 tests)                    ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-N35" "Food" "ethiopian food" "Ethiopian" 45
run_golden_test "GD-N36" "Food" "peruvian ceviche" "Peruvian|Latin" 45
run_golden_test "GD-N37" "Food" "greek food" "Greek|Mediterranean" 50
run_golden_test "GD-N38" "Food" "polish food" "Polish|European" 45
run_golden_test "GD-N39" "Food" "bbq brisket" "American|BBQ" 55
run_golden_test "GD-N40" "Food" "dim sum" "Chinese" 55

###############################################################################
# PHASE 12: PRICE-SENSITIVE (5 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 12: PRICE-SENSITIVE QUERIES (5 tests)                       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-N41" "Convenience" "cheap eats under 15 dollars" "any" 45
run_golden_test "GD-N42" "Convenience" "fancy dinner splurge" "any" 55 "Special Occasion"
run_golden_test "GD-N43" "Convenience" "affordable date night" "any" 55 "Date Night"
run_golden_test "GD-N44" "Convenience" "budget friendly lunch" "any" 50
run_golden_test "GD-N45" "Convenience" "high end tasting menu" "any" 55

###############################################################################
# PHASE 13: TIME-CONTEXTUALIZED (5 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 13: TIME-CONTEXTUALIZED QUERIES (5 tests)                   ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-N46" "Convenience" "breakfast spot" "any" 50
run_golden_test "GD-N47" "Convenience" "brunch this weekend" "any" 55
run_golden_test "GD-N48" "Convenience" "after midnight food" "any" 45
run_golden_test "GD-N49" "Convenience" "quick weekday lunch" "any" 55
run_golden_test "GD-N50" "Convenience" "dinner reservation tonight" "any" 55

###############################################################################
# RESULTS SUMMARY
###############################################################################
echo ""
echo "============================================================"
echo "  GOLDEN DATASET V8 — 100-CASE TEST RESULTS"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "============================================================"
echo ""
echo -e "  ${GREEN}PASSED${NC}: $PASS_COUNT"
echo -e "  ${RED}FAILED${NC}: $FAIL_COUNT"
echo -e "  ${YELLOW}WARNED${NC}: $WARN_COUNT"
echo "  TOTAL CHECKS: $((PASS_COUNT + FAIL_COUNT + WARN_COUNT))"
echo ""

# Category averages
echo "  ── Category Averages ──"
for cat in Food Vibe Service Reputation Convenience; do
  local_count=${CAT_COUNT[$cat]}
  if (( local_count > 0 )); then
    local_avg=$(( ${CAT_SUM[$cat]} / local_count ))
    echo "  $cat:  avg DM = $local_avg ($local_count tests, ${CAT_PASS[$cat]}P/${CAT_FAIL[$cat]}F/${CAT_WARN[$cat]}W)"
  fi
done

if (( TOTAL_TESTS > 0 )); then
  echo ""
  echo "  Overall:     avg DM = $((TOTAL_DONDE_MATCH / TOTAL_TESTS)) ($TOTAL_TESTS tests)"
fi

# Pass rate
TOTAL_CHECKS=$((PASS_COUNT + FAIL_COUNT + WARN_COUNT))
if (( TOTAL_CHECKS > 0 )); then
  PASS_RATE=$((PASS_COUNT * 100 / TOTAL_CHECKS))
  echo "  Pass Rate:   ${PASS_RATE}%"
fi

###############################################################################
# GENERATE MARKDOWN REPORT
###############################################################################
echo ""
echo "Generating report: $REPORT_FILE"
cat > "$REPORT_PATH" << REPORT_EOF
# Golden Dataset V8 — 100-Case Test Results

**Date:** $(date -u '+%Y-%m-%dT%H:%M:%SZ')
**Endpoint:** $API
**Tests:** 100 | **Checks:** $TOTAL_CHECKS

## Summary

| Metric | Value |
|--------|-------|
| PASSED | $PASS_COUNT |
| FAILED | $FAIL_COUNT |
| WARNED | $WARN_COUNT |
| Pass Rate | ${PASS_RATE:-0}% |
| Avg DondeMatch | $( (( TOTAL_TESTS > 0 )) && echo "$((TOTAL_DONDE_MATCH / TOTAL_TESTS))" || echo "N/A" ) |

## Category Averages

| Category | Avg DM | Tests | Pass | Fail | Warn |
|----------|--------|-------|------|------|------|
$(for cat in Food Vibe Service Reputation Convenience; do
  lc=${CAT_COUNT[$cat]}
  if (( lc > 0 )); then
    echo "| $cat | $((${CAT_SUM[$cat]} / lc)) | $lc | ${CAT_PASS[$cat]} | ${CAT_FAIL[$cat]} | ${CAT_WARN[$cat]} |"
  else
    echo "| $cat | N/A | 0 | 0 | 0 | 0 |"
  fi
done)

## Detailed Results

$(echo -e "$TEST_LOG" | while IFS='|' read -r status tid name detail; do
  if [[ "$status" == "PASS" ]]; then
    echo "- **PASS** [$tid] $name"
  elif [[ "$status" == "FAIL" ]]; then
    echo "- **FAIL** [$tid] $name — $detail"
  elif [[ "$status" == "WARN" ]]; then
    echo "- **WARN** [$tid] $name — $detail"
  fi
done)
REPORT_EOF

###############################################################################
# GENERATE USED CASES MANIFEST
###############################################################################
USED_CASES_FILE="$(dirname "$SCRIPT_DIR")/tests/USED_CASES_V8.json"
echo "Generating used cases manifest: tests/USED_CASES_V8.json"
cat > "$USED_CASES_FILE" << 'CASES_EOF'
{
  "version": "V8-100",
  "generated": "TIMESTAMP_PLACEHOLDER",
  "description": "Test cases used in V8 golden dataset validation. Do NOT reuse these for future iterations.",
  "total_cases": 100,
  "cases": [
    {"id": "GD-F01", "category": "Food", "query": "smash burger", "source": "original-50"},
    {"id": "GD-F02", "category": "Food", "query": "soup dumplings", "source": "original-50"},
    {"id": "GD-F03", "category": "Food", "query": "korean fried chicken", "source": "original-50"},
    {"id": "GD-F04", "category": "Food", "query": "truffle pasta", "source": "original-50"},
    {"id": "GD-F05", "category": "Food", "query": "cuban food", "source": "original-50"},
    {"id": "GD-F06", "category": "Food", "query": "hand rolls", "source": "original-50"},
    {"id": "GD-F07", "category": "Food", "query": "acai bowl", "source": "original-50"},
    {"id": "GD-F08", "category": "Food", "query": "jerk chicken", "source": "original-50"},
    {"id": "GD-F09", "category": "Food", "query": "fondue", "source": "original-50"},
    {"id": "GD-F10", "category": "Food", "query": "deep dish pizza", "source": "original-50"},
    {"id": "GD-F11", "category": "Food", "query": "lobster bisque", "source": "original-50"},
    {"id": "GD-F12", "category": "Food", "query": "taiwanese food", "source": "original-50"},
    {"id": "GD-F13", "category": "Food", "query": "hot chicken", "source": "original-50"},
    {"id": "GD-F14", "category": "Food", "query": "charcuterie board", "source": "original-50"},
    {"id": "GD-F15", "category": "Food", "query": "grain bowl", "source": "original-50"},
    {"id": "GD-V01", "category": "Vibe", "query": "speakeasy", "source": "original-50"},
    {"id": "GD-V02", "category": "Vibe", "query": "jazz bar", "source": "original-50"},
    {"id": "GD-V03", "category": "Vibe", "query": "tiki bar", "source": "original-50"},
    {"id": "GD-V04", "category": "Vibe", "query": "karaoke bar", "source": "original-50"},
    {"id": "GD-V05", "category": "Vibe", "query": "rooftop brunch", "source": "original-50"},
    {"id": "GD-V06", "category": "Vibe", "query": "bottomless brunch", "source": "original-50"},
    {"id": "GD-V07", "category": "Vibe", "query": "power lunch", "source": "original-50"},
    {"id": "GD-V08", "category": "Vibe", "query": "dive bar", "source": "original-50"},
    {"id": "GD-V09", "category": "Vibe", "query": "sports bar", "source": "original-50"},
    {"id": "GD-V10", "category": "Vibe", "query": "cozy date night restaurant", "source": "original-50"},
    {"id": "GD-S01", "category": "Service", "query": "walk in friendly restaurant", "source": "original-50"},
    {"id": "GD-S02", "category": "Service", "query": "large party dining", "source": "original-50"},
    {"id": "GD-S03", "category": "Service", "query": "happy hour", "source": "original-50"},
    {"id": "GD-S04", "category": "Service", "query": "omakase", "source": "original-50"},
    {"id": "GD-S05", "category": "Service", "query": "prix fixe dinner", "source": "original-50"},
    {"id": "GD-S06", "category": "Service", "query": "outdoor seating", "source": "original-50"},
    {"id": "GD-S07", "category": "Service", "query": "byob restaurant", "source": "original-50"},
    {"id": "GD-S08", "category": "Service", "query": "family style dinner", "source": "original-50"},
    {"id": "GD-S09", "category": "Service", "query": "valet parking", "source": "original-50"},
    {"id": "GD-S10", "category": "Service", "query": "private dining room", "source": "original-50"},
    {"id": "GD-R01", "category": "Reputation", "query": "best tasting menu in chicago", "source": "original-50"},
    {"id": "GD-R02", "category": "Reputation", "query": "michelin star restaurant", "source": "original-50"},
    {"id": "GD-R03", "category": "Reputation", "query": "best craft cocktail bar", "source": "original-50"},
    {"id": "GD-R04", "category": "Reputation", "query": "best rooftop dining", "source": "original-50"},
    {"id": "GD-R05", "category": "Reputation", "query": "james beard restaurant", "source": "original-50"},
    {"id": "GD-C01", "category": "Convenience", "query": "late night food", "source": "original-50"},
    {"id": "GD-C02", "category": "Convenience", "query": "west loop restaurants", "source": "original-50"},
    {"id": "GD-C03", "category": "Convenience", "query": "near wrigley field", "source": "original-50"},
    {"id": "GD-C04", "category": "Convenience", "query": "quick lunch near the loop", "source": "original-50"},
    {"id": "GD-C05", "category": "Convenience", "query": "open for sunday dinner", "source": "original-50"},
    {"id": "GD-C06", "category": "Convenience", "query": "restaurant with free wifi", "source": "original-50"},
    {"id": "GD-C07", "category": "Convenience", "query": "kid friendly brunch", "source": "original-50"},
    {"id": "GD-C08", "category": "Convenience", "query": "dog friendly patio", "source": "original-50"},
    {"id": "GD-C09", "category": "Convenience", "query": "river north restaurant", "source": "original-50"},
    {"id": "GD-C10", "category": "Convenience", "query": "logan square restaurant", "source": "original-50"},
    {"id": "GD-N01", "category": "Food", "query": "romantic italian dinner", "source": "v8-new-50"},
    {"id": "GD-N02", "category": "Food", "query": "trendy sushi spot", "source": "v8-new-50"},
    {"id": "GD-N03", "category": "Food", "query": "cozy ramen place", "source": "v8-new-50"},
    {"id": "GD-N04", "category": "Vibe", "query": "lively mexican restaurant", "source": "v8-new-50"},
    {"id": "GD-N05", "category": "Food", "query": "upscale steakhouse", "source": "v8-new-50"},
    {"id": "GD-N06", "category": "Vibe", "query": "intimate wine bar", "source": "v8-new-50"},
    {"id": "GD-N07", "category": "Food", "query": "casual thai food", "source": "v8-new-50"},
    {"id": "GD-N08", "category": "Food", "query": "authentic indian curry", "source": "v8-new-50"},
    {"id": "GD-N09", "category": "Food", "query": "pad thai", "source": "v8-new-50"},
    {"id": "GD-N10", "category": "Food", "query": "margherita pizza", "source": "v8-new-50"},
    {"id": "GD-N11", "category": "Food", "query": "pho", "source": "v8-new-50"},
    {"id": "GD-N12", "category": "Food", "query": "tacos al pastor", "source": "v8-new-50"},
    {"id": "GD-N13", "category": "Food", "query": "chicken tikka masala", "source": "v8-new-50"},
    {"id": "GD-N14", "category": "Food", "query": "sashimi platter", "source": "v8-new-50"},
    {"id": "GD-N15", "category": "Food", "query": "vegan restaurant", "source": "v8-new-50"},
    {"id": "GD-N16", "category": "Food", "query": "gluten free options", "source": "v8-new-50"},
    {"id": "GD-N17", "category": "Food", "query": "halal food", "source": "v8-new-50"},
    {"id": "GD-N18", "category": "Food", "query": "vegetarian friendly dinner", "source": "v8-new-50"},
    {"id": "GD-N19", "category": "Food", "query": "dairy free restaurant", "source": "v8-new-50"},
    {"id": "GD-N20", "category": "Food", "query": "plant based burger", "source": "v8-new-50"},
    {"id": "GD-N21", "category": "Service", "query": "first date restaurant", "source": "v8-new-50"},
    {"id": "GD-N22", "category": "Service", "query": "anniversary dinner", "source": "v8-new-50"},
    {"id": "GD-N23", "category": "Service", "query": "birthday party venue", "source": "v8-new-50"},
    {"id": "GD-N24", "category": "Service", "query": "business client dinner", "source": "v8-new-50"},
    {"id": "GD-N25", "category": "Service", "query": "solo dining counter seat", "source": "v8-new-50"},
    {"id": "GD-N26", "category": "Service", "query": "treat myself dinner", "source": "v8-new-50"},
    {"id": "GD-N27", "category": "Service", "query": "family brunch with kids", "source": "v8-new-50"},
    {"id": "GD-N28", "category": "Service", "query": "casual hangout with friends", "source": "v8-new-50"},
    {"id": "GD-N29", "category": "Food", "query": "spicy thai food with outdoor seating", "source": "v8-new-50"},
    {"id": "GD-N30", "category": "Food", "query": "cheap mexican food near downtown", "source": "v8-new-50"},
    {"id": "GD-N31", "category": "Vibe", "query": "quiet restaurant good for conversation", "source": "v8-new-50"},
    {"id": "GD-N32", "category": "Food", "query": "best pizza by the slice late night", "source": "v8-new-50"},
    {"id": "GD-N33", "category": "Vibe", "query": "restaurant with live music and cocktails", "source": "v8-new-50"},
    {"id": "GD-N34", "category": "Food", "query": "healthy salad bowl near loop", "source": "v8-new-50"},
    {"id": "GD-N35", "category": "Food", "query": "ethiopian food", "source": "v8-new-50"},
    {"id": "GD-N36", "category": "Food", "query": "peruvian ceviche", "source": "v8-new-50"},
    {"id": "GD-N37", "category": "Food", "query": "greek food", "source": "v8-new-50"},
    {"id": "GD-N38", "category": "Food", "query": "polish food", "source": "v8-new-50"},
    {"id": "GD-N39", "category": "Food", "query": "bbq brisket", "source": "v8-new-50"},
    {"id": "GD-N40", "category": "Food", "query": "dim sum", "source": "v8-new-50"},
    {"id": "GD-N41", "category": "Convenience", "query": "cheap eats under 15 dollars", "source": "v8-new-50"},
    {"id": "GD-N42", "category": "Convenience", "query": "fancy dinner splurge", "source": "v8-new-50"},
    {"id": "GD-N43", "category": "Convenience", "query": "affordable date night", "source": "v8-new-50"},
    {"id": "GD-N44", "category": "Convenience", "query": "budget friendly lunch", "source": "v8-new-50"},
    {"id": "GD-N45", "category": "Convenience", "query": "high end tasting menu", "source": "v8-new-50"},
    {"id": "GD-N46", "category": "Convenience", "query": "breakfast spot", "source": "v8-new-50"},
    {"id": "GD-N47", "category": "Convenience", "query": "brunch this weekend", "source": "v8-new-50"},
    {"id": "GD-N48", "category": "Convenience", "query": "after midnight food", "source": "v8-new-50"},
    {"id": "GD-N49", "category": "Convenience", "query": "quick weekday lunch", "source": "v8-new-50"},
    {"id": "GD-N50", "category": "Convenience", "query": "dinner reservation tonight", "source": "v8-new-50"}
  ]
}
CASES_EOF
# Replace timestamp placeholder
sed -i "s/TIMESTAMP_PLACEHOLDER/$(date -u '+%Y-%m-%dT%H:%M:%SZ')/" "$USED_CASES_FILE"

echo "Done!"
echo "============================================================"
echo "  Raw results saved to: tests/V8_RAW_RESULTS.jsonl"
echo "  Report saved to: $REPORT_FILE"
echo "  Used cases manifest: tests/USED_CASES_V8.json"
echo "============================================================"

# Exit with failure if any hard failures
if (( FAIL_COUNT > 0 )); then
  exit 1
fi
exit 0
