#!/usr/bin/env bash
set -uo pipefail

###############################################################################
# DONDE GOLDEN DATASET TEST SUITE
# Tests representative samples from the Chicago Common Searches dataset (1000 entries)
# against the live production API to measure quality metrics.
#
# 50 test cases across 5 categories:
#   Food (15), Vibe (10), Service (10), Reputation (5), Convenience (10)
#
# Usage:  chmod +x tests/golden-dataset-test.sh && ./tests/golden-dataset-test.sh
# Deps:   curl, jq (v1.6+), bash 4+
###############################################################################

API="https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend"
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
TOTAL_DONDE_MATCH=0
TOTAL_TESTS=0
CATEGORY_SCORES=()
TEST_LOG=""
LAST_RESPONSE=""
HTTP_CODE=""
REPORT_FILE="tests/GOLDEN_DATASET_RESULTS.md"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_PATH="$(dirname "$SCRIPT_DIR")/$REPORT_FILE"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Category tracking
FOOD_PASS=0; FOOD_FAIL=0; FOOD_WARN=0; FOOD_MATCH_SUM=0; FOOD_COUNT=0
VIBE_PASS=0; VIBE_FAIL=0; VIBE_WARN=0; VIBE_MATCH_SUM=0; VIBE_COUNT=0
SERVICE_PASS=0; SERVICE_FAIL=0; SERVICE_WARN=0; SERVICE_MATCH_SUM=0; SERVICE_COUNT=0
REPUTATION_PASS=0; REPUTATION_FAIL=0; REPUTATION_WARN=0; REPUTATION_MATCH_SUM=0; REPUTATION_COUNT=0
CONVENIENCE_PASS=0; CONVENIENCE_FAIL=0; CONVENIENCE_WARN=0; CONVENIENCE_MATCH_SUM=0; CONVENIENCE_COUNT=0

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

  local food_score vibe_score
  food_score=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v9.food // 0' 2>/dev/null)
  vibe_score=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v9.vibe // 0' 2>/dev/null)

  echo "  → $restaurant_name ($cuisine_type) | DM: $donde_match | Food: $food_score | Vibe: $vibe_score"

  # Track donde_match for category averages
  ((TOTAL_TESTS++))
  TOTAL_DONDE_MATCH=$((TOTAL_DONDE_MATCH + ${donde_match%.*}))

  case "$category" in
    Food) FOOD_MATCH_SUM=$((FOOD_MATCH_SUM + ${donde_match%.*})); ((FOOD_COUNT++)) ;;
    Vibe) VIBE_MATCH_SUM=$((VIBE_MATCH_SUM + ${donde_match%.*})); ((VIBE_COUNT++)) ;;
    Service) SERVICE_MATCH_SUM=$((SERVICE_MATCH_SUM + ${donde_match%.*})); ((SERVICE_COUNT++)) ;;
    Reputation) REPUTATION_MATCH_SUM=$((REPUTATION_MATCH_SUM + ${donde_match%.*})); ((REPUTATION_COUNT++)) ;;
    Convenience) CONVENIENCE_MATCH_SUM=$((CONVENIENCE_MATCH_SUM + ${donde_match%.*})); ((CONVENIENCE_COUNT++)) ;;
  esac

  # Check 1: donde_match meets minimum threshold
  local dm_int=${donde_match%.*}
  if (( dm_int >= min_score )); then
    check_pass "$test_id" "donde_match >= $min_score (got $donde_match)"
  elif (( dm_int >= min_score - 10 )); then
    check_warn "$test_id" "donde_match near threshold" "got $donde_match, want >= $min_score"
  else
    check_fail "$test_id" "donde_match >= $min_score" "got $donde_match"
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
echo "  DONDE GOLDEN DATASET TEST SUITE"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  Endpoint: $API"
echo "  Tests: 50 | Categories: Food, Vibe, Service, Reputation, Convenience"
echo "============================================================"

###############################################################################
# PHASE 1: FOOD (15 tests — cuisine matching, dish resolution, score quality)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 1: FOOD QUERIES (15 tests)                                   ║${NC}"
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
# PHASE 2: VIBE (10 tests — atmosphere matching, tag alignment)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 2: VIBE QUERIES (10 tests)                                   ║${NC}"
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
# PHASE 3: SERVICE (10 tests — feature matching, service expectations)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 3: SERVICE QUERIES (10 tests)                                ║${NC}"
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
# PHASE 4: REPUTATION (5 tests — award/media recognition matching)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 4: REPUTATION QUERIES (5 tests)                              ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_golden_test "GD-R01" "Reputation" "best tasting menu in chicago" "any" 60
run_golden_test "GD-R02" "Reputation" "michelin star restaurant" "any" 65
run_golden_test "GD-R03" "Reputation" "best craft cocktail bar" "any" 55
run_golden_test "GD-R04" "Reputation" "best rooftop dining" "any" 55
run_golden_test "GD-R05" "Reputation" "james beard restaurant" "any" 60

###############################################################################
# PHASE 5: CONVENIENCE (10 tests — location, hours, accessibility)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  PHASE 5: CONVENIENCE QUERIES (10 tests)                            ║${NC}"
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
# RESULTS SUMMARY
###############################################################################
echo ""
echo "============================================================"
echo "  GOLDEN DATASET TEST RESULTS"
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
if (( FOOD_COUNT > 0 )); then
  echo "  Food:        avg DM = $((FOOD_MATCH_SUM / FOOD_COUNT)) ($FOOD_COUNT tests)"
fi
if (( VIBE_COUNT > 0 )); then
  echo "  Vibe:        avg DM = $((VIBE_MATCH_SUM / VIBE_COUNT)) ($VIBE_COUNT tests)"
fi
if (( SERVICE_COUNT > 0 )); then
  echo "  Service:     avg DM = $((SERVICE_MATCH_SUM / SERVICE_COUNT)) ($SERVICE_COUNT tests)"
fi
if (( REPUTATION_COUNT > 0 )); then
  echo "  Reputation:  avg DM = $((REPUTATION_MATCH_SUM / REPUTATION_COUNT)) ($REPUTATION_COUNT tests)"
fi
if (( CONVENIENCE_COUNT > 0 )); then
  echo "  Convenience: avg DM = $((CONVENIENCE_MATCH_SUM / CONVENIENCE_COUNT)) ($CONVENIENCE_COUNT tests)"
fi
if (( TOTAL_TESTS > 0 )); then
  echo ""
  echo "  Overall:     avg DM = $((TOTAL_DONDE_MATCH / TOTAL_TESTS)) ($TOTAL_TESTS tests)"
fi

# Generate markdown report
echo ""
echo "Generating report: $REPORT_FILE"
cat > "$REPORT_PATH" << REPORT_EOF
# Golden Dataset Test Results

**Date:** $(date -u '+%Y-%m-%dT%H:%M:%SZ')
**Endpoint:** $API
**Tests:** 50 | **Checks:** $((PASS_COUNT + FAIL_COUNT + WARN_COUNT))

## Summary

| Metric | Value |
|--------|-------|
| PASSED | $PASS_COUNT |
| FAILED | $FAIL_COUNT |
| WARNED | $WARN_COUNT |
| Pass Rate | $(( PASS_COUNT * 100 / (PASS_COUNT + FAIL_COUNT + WARN_COUNT) ))% |

## Category Averages

| Category | Avg DondeMatch | Tests |
|----------|---------------|-------|
| Food | $( (( FOOD_COUNT > 0 )) && echo "$((FOOD_MATCH_SUM / FOOD_COUNT))" || echo "N/A" ) | $FOOD_COUNT |
| Vibe | $( (( VIBE_COUNT > 0 )) && echo "$((VIBE_MATCH_SUM / VIBE_COUNT))" || echo "N/A" ) | $VIBE_COUNT |
| Service | $( (( SERVICE_COUNT > 0 )) && echo "$((SERVICE_MATCH_SUM / SERVICE_COUNT))" || echo "N/A" ) | $SERVICE_COUNT |
| Reputation | $( (( REPUTATION_COUNT > 0 )) && echo "$((REPUTATION_MATCH_SUM / REPUTATION_COUNT))" || echo "N/A" ) | $REPUTATION_COUNT |
| Convenience | $( (( CONVENIENCE_COUNT > 0 )) && echo "$((CONVENIENCE_MATCH_SUM / CONVENIENCE_COUNT))" || echo "N/A" ) | $CONVENIENCE_COUNT |
| **Overall** | **$( (( TOTAL_TESTS > 0 )) && echo "$((TOTAL_DONDE_MATCH / TOTAL_TESTS))" || echo "N/A" )** | **$TOTAL_TESTS** |

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

echo "Done!"
echo "============================================================"

# Exit with failure if any hard failures
if (( FAIL_COUNT > 0 )); then
  exit 1
fi
exit 0
