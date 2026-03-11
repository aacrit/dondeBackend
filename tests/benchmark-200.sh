#!/usr/bin/env bash
set -uo pipefail

###############################################################################
# DONDE BENCHMARK 200 — SCORING ENGINE V11 VALIDATION
# 200 test cases across 10 categories (20 tests each)
# Tests the recommendation API for scoring quality and consistency.
#
# Categories:
#   1. Direct Cuisine (20)   2. Specific Dish (20)    3. Vibe/Atmosphere (20)
#   4. Multi-Dimensional (20) 5. Discovery/Surprise (20) 6. Contextual (20)
#   7. Reputation (20)       8. Constraints (20)      9. Niche/Uncommon (20)
#  10. Complex Natural Language (20)
#
# Usage:  chmod +x tests/benchmark-200.sh && ./tests/benchmark-200.sh
# Deps:   curl, jq (v1.6+), bash 4+
###############################################################################

API="https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend"
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
TOTAL_DONDE_MATCH=0
TOTAL_TESTS=0
TOTAL_FIT_SCORE=0
TOTAL_BLURB_SCORE=0
TEST_LOG=""
LAST_RESPONSE=""
HTTP_CODE=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_FILE="tests/BENCHMARK_200_RESULTS.md"
REPORT_PATH="$(dirname "$SCRIPT_DIR")/$REPORT_FILE"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Category tracking arrays
declare -A CAT_PASS CAT_FAIL CAT_WARN CAT_MATCH_SUM CAT_COUNT
CATEGORIES=("Cuisine" "Dish" "Vibe" "Multi" "Discovery" "Contextual" "Reputation" "Constraints" "Niche" "Complex")
for cat in "${CATEGORIES[@]}"; do
  CAT_PASS[$cat]=0; CAT_FAIL[$cat]=0; CAT_WARN[$cat]=0; CAT_MATCH_SUM[$cat]=0; CAT_COUNT[$cat]=0
done

# Thresholds per category
declare -A THRESHOLDS
THRESHOLDS[Cuisine]=55
THRESHOLDS[Dish]=55
THRESHOLDS[Vibe]=50
THRESHOLDS[Multi]=45
THRESHOLDS[Discovery]=40
THRESHOLDS[Contextual]=45
THRESHOLDS[Reputation]=55
THRESHOLDS[Constraints]=45
THRESHOLDS[Niche]=35
THRESHOLDS[Complex]=40

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

# Run a single benchmark test
# $1: test_id, $2: category, $3: query
run_bench_test() {
  local test_id="$1"
  local category="$2"
  local query="$3"
  local min_score="${THRESHOLDS[$category]}"

  echo -e "\n${CYAN}[$test_id] $category: \"$query\"${NC}"

  local body
  body=$(jq -n \
    --arg sr "$query" \
    '{special_request: $sr, occasion: "Any", neighborhood: "Anywhere", price_level: "Any"}')

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

  # Check donde_match is a number
  if ! [[ "$donde_match" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    check_fail "$test_id" "donde_match is numeric" "got $donde_match"
    return
  fi

  local relevance_score relevance_type food_score vibe_score service_score blurb_text
  relevance_score=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v9.relevance_score // "n/a"' 2>/dev/null)
  relevance_type=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v9.relevance_type // "n/a"' 2>/dev/null)
  food_score=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v9.food // 0' 2>/dev/null)
  vibe_score=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v9.vibe // 0' 2>/dev/null)
  service_score=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v9.service // 0' 2>/dev/null)
  blurb_text=$(echo "$LAST_RESPONSE" | jq -r '.recommendation // ""' 2>/dev/null)

  # ── Compute Fit Score (0-100) ──
  local fit_score=0

  # Relevance alignment (30 pts)
  local rel_align=20
  case "$category" in
    Cuisine|Dish|Niche)
      if [[ "$relevance_type" == "food_category" || "$relevance_type" == "dish" || "$relevance_type" == "cuisine" ]]; then
        rel_align=30
      else
        rel_align=10
      fi
      ;;
    Vibe)
      if [[ "$relevance_type" == "vibe" ]]; then
        rel_align=30
      else
        rel_align=10
      fi
      ;;
    *)
      rel_align=20
      ;;
  esac
  fit_score=$((fit_score + rel_align))

  # Cuisine match (25 pts) — food categories check cuisine, others auto-pass
  local cuisine_pts=25
  case "$category" in
    Cuisine|Dish|Niche)
      local q_lower cuisine_lower_fit
      q_lower=$(echo "$query" | tr '[:upper:]' '[:lower:]')
      cuisine_lower_fit=$(echo "$cuisine_type" | tr '[:upper:]' '[:lower:]')
      if [[ "$cuisine_lower_fit" == *"$q_lower"* || "$q_lower" == *"$cuisine_lower_fit"* ]]; then
        cuisine_pts=25
      else
        cuisine_pts=10
      fi
      ;;
    *)
      cuisine_pts=25
      ;;
  esac
  fit_score=$((fit_score + cuisine_pts))

  # Factor alignment (25 pts)
  local factor_pts=15
  case "$category" in
    Cuisine|Dish|Niche)
      local fs_int=${food_score%.*}
      if (( fs_int >= 6 )); then factor_pts=25; else factor_pts=5; fi
      ;;
    Vibe)
      local vs_int=${vibe_score%.*}
      if (( vs_int >= 6 )); then factor_pts=25; else factor_pts=5; fi
      ;;
    Service|Constraints)
      local ss_int=${service_score%.*}
      if (( ss_int >= 6 )); then factor_pts=25; else factor_pts=5; fi
      ;;
    *)
      factor_pts=15
      ;;
  esac
  fit_score=$((fit_score + factor_pts))

  # Compression (10 pts)
  local comp_pts=5
  if [[ "$relevance_score" != "n/a" ]]; then
    local rel_100
    rel_100=$(echo "$relevance_score" | awk '{printf "%d", $1 * 100}')
    if (( rel_100 >= 80 )); then comp_pts=10; else comp_pts=5; fi
  fi
  fit_score=$((fit_score + comp_pts))

  # Weak spots (10 pts)
  local weak_pts=10
  local weak_spots
  weak_spots=$(echo "$LAST_RESPONSE" | jq -r '.match_narrative.weak_spots // empty' 2>/dev/null)
  if [[ -n "$weak_spots" && "$weak_spots" != "null" && "$weak_spots" != "[]" ]]; then
    weak_pts=5
  fi
  fit_score=$((fit_score + weak_pts))

  # ── Compute Blurb Quality Score (0-100) ──
  local blurb_score=0

  # Slop check (25 pts)
  local slop_count=0
  local blurb_lower
  blurb_lower=$(echo "$blurb_text" | tr '[:upper:]' '[:lower:]')
  for slop_word in "culinary" "gastronomic" "mouthwatering" "nestled" "hidden gem" "elevated" "must-visit" "dining experience" "every bite" "beckons"; do
    if [[ "$blurb_lower" == *"$slop_word"* ]]; then
      ((slop_count++))
    fi
  done
  if (( slop_count == 0 )); then
    blurb_score=$((blurb_score + 25))
  elif (( slop_count == 1 )); then
    blurb_score=$((blurb_score + 15))
  else
    blurb_score=$((blurb_score + 5))
  fi

  # Voice (15 pts) — contains "we" or "our"
  if echo "$blurb_lower" | grep -qwE '(we|our)'; then
    blurb_score=$((blurb_score + 15))
  fi

  # Word count (15 pts)
  local word_count
  word_count=$(echo "$blurb_text" | wc -w | tr -d ' ')
  if (( word_count >= 100 && word_count <= 120 )); then
    blurb_score=$((blurb_score + 15))
  elif (( word_count >= 80 && word_count <= 130 )); then
    blurb_score=$((blurb_score + 10))
  else
    blurb_score=$((blurb_score + 5))
  fi

  # Relevance (15 pts baseline)
  blurb_score=$((blurb_score + 15))

  # Specificity (10 pts) — descriptive adjectives
  if echo "$blurb_lower" | grep -qwE '(crispy|tender|smoky|tangy|rich|creamy|savory|fresh|bright|bold|spicy|buttery|silky|flaky|charred|aromatic)'; then
    blurb_score=$((blurb_score + 10))
  else
    blurb_score=$((blurb_score + 5))
  fi

  # Letter grades
  local fit_grade blurb_grade
  if (( fit_score >= 93 )); then fit_grade="A"
  elif (( fit_score >= 87 )); then fit_grade="B+"
  elif (( fit_score >= 80 )); then fit_grade="B-"
  elif (( fit_score >= 70 )); then fit_grade="C"
  else fit_grade="D"
  fi

  if (( blurb_score >= 93 )); then blurb_grade="A"
  elif (( blurb_score >= 87 )); then blurb_grade="B+"
  elif (( blurb_score >= 80 )); then blurb_grade="B-"
  elif (( blurb_score >= 70 )); then blurb_grade="C"
  else blurb_grade="D"
  fi

  # Track totals for averages
  TOTAL_FIT_SCORE=$((TOTAL_FIT_SCORE + fit_score))
  TOTAL_BLURB_SCORE=$((TOTAL_BLURB_SCORE + blurb_score))

  echo "  → $restaurant_name ($cuisine_type) | DM: $donde_match | Rel: $relevance_score ($relevance_type) | Fit: $fit_score ($fit_grade) | Blurb: $blurb_score ($blurb_grade)"

  # Track donde_match for category averages
  ((TOTAL_TESTS++))
  local dm_int=${donde_match%.*}
  TOTAL_DONDE_MATCH=$((TOTAL_DONDE_MATCH + dm_int))
  CAT_MATCH_SUM[$category]=$(( ${CAT_MATCH_SUM[$category]} + dm_int ))
  CAT_COUNT[$category]=$(( ${CAT_COUNT[$category]} + 1 ))

  # Check: donde_match meets minimum threshold
  if (( dm_int >= min_score )); then
    check_pass "$test_id" "donde_match >= $min_score (got $donde_match)"
    CAT_PASS[$category]=$(( ${CAT_PASS[$category]} + 1 ))
  elif (( dm_int >= min_score - 10 )); then
    check_warn "$test_id" "donde_match near threshold" "got $donde_match, want >= $min_score"
    CAT_WARN[$category]=$(( ${CAT_WARN[$category]} + 1 ))
  else
    check_fail "$test_id" "donde_match >= $min_score" "got $donde_match"
    CAT_FAIL[$category]=$(( ${CAT_FAIL[$category]} + 1 ))
  fi

  # Grade checks: Fit
  if (( fit_score >= 80 )); then
    check_pass "$test_id" "Fit grade $fit_grade ($fit_score)"
  elif (( fit_score >= 70 )); then
    check_warn "$test_id" "Fit grade $fit_grade" "score $fit_score"
  else
    check_fail "$test_id" "Fit grade $fit_grade" "score $fit_score"
  fi

  # Grade checks: Blurb
  if (( blurb_score >= 80 )); then
    check_pass "$test_id" "Blurb grade $blurb_grade ($blurb_score)"
  elif (( blurb_score >= 70 )); then
    check_warn "$test_id" "Blurb grade $blurb_grade" "score $blurb_score"
  else
    check_fail "$test_id" "Blurb grade $blurb_grade" "score $blurb_score"
  fi

  # Small delay to respect rate limits
  sleep 1
}

###############################################################################
# START
###############################################################################
echo ""
echo "============================================================"
echo "  DONDE BENCHMARK 200 — SCORING ENGINE V11 VALIDATION"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  Endpoint: $API"
echo "  Tests: 200 | Categories: 10 (20 each)"
echo "============================================================"

###############################################################################
# CATEGORY 1: DIRECT CUISINE (20 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  CATEGORY 1: DIRECT CUISINE (20 tests, threshold >= 55)            ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_bench_test "B1-01" "Cuisine" "mexican food"
run_bench_test "B1-02" "Cuisine" "thai restaurant"
run_bench_test "B1-03" "Cuisine" "ethiopian cuisine"
run_bench_test "B1-04" "Cuisine" "japanese"
run_bench_test "B1-05" "Cuisine" "italian place"
run_bench_test "B1-06" "Cuisine" "indian food"
run_bench_test "B1-07" "Cuisine" "french bistro"
run_bench_test "B1-08" "Cuisine" "korean bbq"
run_bench_test "B1-09" "Cuisine" "chinese dim sum"
run_bench_test "B1-10" "Cuisine" "mediterranean"
run_bench_test "B1-11" "Cuisine" "vietnamese pho"
run_bench_test "B1-12" "Cuisine" "brazilian steakhouse"
run_bench_test "B1-13" "Cuisine" "peruvian"
run_bench_test "B1-14" "Cuisine" "greek restaurant"
run_bench_test "B1-15" "Cuisine" "middle eastern"
run_bench_test "B1-16" "Cuisine" "polish food"
run_bench_test "B1-17" "Cuisine" "southern comfort food"
run_bench_test "B1-18" "Cuisine" "seafood restaurant"
run_bench_test "B1-19" "Cuisine" "steak dinner"
run_bench_test "B1-20" "Cuisine" "brunch spot"

###############################################################################
# CATEGORY 2: SPECIFIC DISH (20 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  CATEGORY 2: SPECIFIC DISH (20 tests, threshold >= 55)             ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_bench_test "B2-01" "Dish" "deep dish pizza"
run_bench_test "B2-02" "Dish" "soup dumplings"
run_bench_test "B2-03" "Dish" "birria tacos"
run_bench_test "B2-04" "Dish" "pad thai"
run_bench_test "B2-05" "Dish" "ramen"
run_bench_test "B2-06" "Dish" "tandoori chicken"
run_bench_test "B2-07" "Dish" "al pastor tacos"
run_bench_test "B2-08" "Dish" "lobster roll"
run_bench_test "B2-09" "Dish" "sushi omakase"
run_bench_test "B2-10" "Dish" "fried chicken"
run_bench_test "B2-11" "Dish" "brisket"
run_bench_test "B2-12" "Dish" "pho bo"
run_bench_test "B2-13" "Dish" "ceviche"
run_bench_test "B2-14" "Dish" "gyro"
run_bench_test "B2-15" "Dish" "pierogi"
run_bench_test "B2-16" "Dish" "dosa"
run_bench_test "B2-17" "Dish" "bibimbap"
run_bench_test "B2-18" "Dish" "mole negro"
run_bench_test "B2-19" "Dish" "banh mi"
run_bench_test "B2-20" "Dish" "butter chicken"

###############################################################################
# CATEGORY 3: VIBE/ATMOSPHERE (20 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  CATEGORY 3: VIBE/ATMOSPHERE (20 tests, threshold >= 50)           ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_bench_test "B3-01" "Vibe" "cozy date spot"
run_bench_test "B3-02" "Vibe" "lively Saturday night"
run_bench_test "B3-03" "Vibe" "quiet work lunch"
run_bench_test "B3-04" "Vibe" "dark moody bar"
run_bench_test "B3-05" "Vibe" "rooftop with views"
run_bench_test "B3-06" "Vibe" "casual neighborhood joint"
run_bench_test "B3-07" "Vibe" "elegant fine dining"
run_bench_test "B3-08" "Vibe" "buzzing energy"
run_bench_test "B3-09" "Vibe" "intimate romantic"
run_bench_test "B3-10" "Vibe" "trendy hot spot"
run_bench_test "B3-11" "Vibe" "laid back patio"
run_bench_test "B3-12" "Vibe" "speakeasy vibe"
run_bench_test "B3-13" "Vibe" "cozy winter spot"
run_bench_test "B3-14" "Vibe" "upscale lounge"
run_bench_test "B3-15" "Vibe" "chill brunch"
run_bench_test "B3-16" "Vibe" "funky eclectic"
run_bench_test "B3-17" "Vibe" "classic old school"
run_bench_test "B3-18" "Vibe" "hip modern"
run_bench_test "B3-19" "Vibe" "warm rustic"
run_bench_test "B3-20" "Vibe" "sophisticated cocktails"

###############################################################################
# CATEGORY 4: MULTI-DIMENSIONAL (20 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  CATEGORY 4: MULTI-DIMENSIONAL (20 tests, threshold >= 45)         ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_bench_test "B4-01" "Multi" "romantic Italian near river north with cocktails"
run_bench_test "B4-02" "Multi" "casual Mexican with outdoor seating BYOB"
run_bench_test "B4-03" "Multi" "upscale Japanese for business dinner"
run_bench_test "B4-04" "Multi" "family friendly Indian with vegetarian options"
run_bench_test "B4-05" "Multi" "late night Korean after a concert"
run_bench_test "B4-06" "Multi" "quiet French bistro for anniversary"
run_bench_test "B4-07" "Multi" "lively group dinner Mediterranean"
run_bench_test "B4-08" "Multi" "solo lunch affordable sushi"
run_bench_test "B4-09" "Multi" "birthday dinner Italian 8 people"
run_bench_test "B4-10" "Multi" "date night thai with ambiance"
run_bench_test "B4-11" "Multi" "healthy lunch quick service downtown"
run_bench_test "B4-12" "Multi" "cozy pub with craft beer and good food"
run_bench_test "B4-13" "Multi" "upscale brunch champagne river north"
run_bench_test "B4-14" "Multi" "casual seafood outdoor summer"
run_bench_test "B4-15" "Multi" "business lunch steakhouse private room"
run_bench_test "B4-16" "Multi" "vegan friendly trendy dinner"
run_bench_test "B4-17" "Multi" "pre-theater quick elegant dinner"
run_bench_test "B4-18" "Multi" "sunday family brunch kids friendly"
run_bench_test "B4-19" "Multi" "romantic sushi quiet intimate"
run_bench_test "B4-20" "Multi" "group celebration cocktails small plates"

###############################################################################
# CATEGORY 5: DISCOVERY/SURPRISE (20 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  CATEGORY 5: DISCOVERY/SURPRISE (20 tests, threshold >= 40)        ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_bench_test "B5-01" "Discovery" "surprise me"
run_bench_test "B5-02" "Discovery" "something I haven't tried"
run_bench_test "B5-03" "Discovery" "dealer's choice"
run_bench_test "B5-04" "Discovery" "chef's recommendation"
run_bench_test "B5-05" "Discovery" "wildcard pick"
run_bench_test "B5-06" "Discovery" "hidden gem"
run_bench_test "B5-07" "Discovery" "something adventurous"
run_bench_test "B5-08" "Discovery" "off the beaten path"
run_bench_test "B5-09" "Discovery" "local secret"
run_bench_test "B5-10" "Discovery" "best kept secret"
run_bench_test "B5-11" "Discovery" "what's hot right now"
run_bench_test "B5-12" "Discovery" "most unique restaurant"
run_bench_test "B5-13" "Discovery" "something different"
run_bench_test "B5-14" "Discovery" "foodie's choice"
run_bench_test "B5-15" "Discovery" "underground favorite"
run_bench_test "B5-16" "Discovery" "underrated spot"
run_bench_test "B5-17" "Discovery" "best new restaurant"
run_bench_test "B5-18" "Discovery" "most creative menu"
run_bench_test "B5-19" "Discovery" "hole in the wall gem"
run_bench_test "B5-20" "Discovery" "something unexpected"

###############################################################################
# CATEGORY 6: CONTEXTUAL (20 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  CATEGORY 6: CONTEXTUAL (20 tests, threshold >= 45)                ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_bench_test "B6-01" "Contextual" "dinner before a Bulls game"
run_bench_test "B6-02" "Contextual" "birthday dinner for 8"
run_bench_test "B6-03" "Contextual" "rehearsal dinner spot"
run_bench_test "B6-04" "Contextual" "client entertainment dinner"
run_bench_test "B6-05" "Contextual" "post-work drinks and food"
run_bench_test "B6-06" "Contextual" "quick lunch between meetings"
run_bench_test "B6-07" "Contextual" "graduation celebration"
run_bench_test "B6-08" "Contextual" "bachelorette dinner"
run_bench_test "B6-09" "Contextual" "reunion with old friends"
run_bench_test "B6-10" "Contextual" "first date impressive"
run_bench_test "B6-11" "Contextual" "proposal dinner spot"
run_bench_test "B6-12" "Contextual" "power lunch downtown"
run_bench_test "B6-13" "Contextual" "after-movie late bite"
run_bench_test "B6-14" "Contextual" "pre-concert dinner wicker park"
run_bench_test "B6-15" "Contextual" "team building dinner 15 people"
run_bench_test "B6-16" "Contextual" "parents visiting from out of town"
run_bench_test "B6-17" "Contextual" "solo birthday treat myself"
run_bench_test "B6-18" "Contextual" "weekend catch up with bestie"
run_bench_test "B6-19" "Contextual" "morning after brunch"
run_bench_test "B6-20" "Contextual" "holiday dinner celebration"

###############################################################################
# CATEGORY 7: REPUTATION (20 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  CATEGORY 7: REPUTATION (20 tests, threshold >= 55)                ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_bench_test "B7-01" "Reputation" "best restaurant in Chicago"
run_bench_test "B7-02" "Reputation" "michelin star restaurant"
run_bench_test "B7-03" "Reputation" "James Beard winner"
run_bench_test "B7-04" "Reputation" "most awarded restaurant"
run_bench_test "B7-05" "Reputation" "top rated Chicago"
run_bench_test "B7-06" "Reputation" "celebrity chef restaurant"
run_bench_test "B7-07" "Reputation" "iconic Chicago dining"
run_bench_test "B7-08" "Reputation" "legendary steakhouse"
run_bench_test "B7-09" "Reputation" "famous deep dish"
run_bench_test "B7-10" "Reputation" "best new restaurant 2024"
run_bench_test "B7-11" "Reputation" "critically acclaimed"
run_bench_test "B7-12" "Reputation" "food critic favorite"
run_bench_test "B7-13" "Reputation" "neighborhood institution"
run_bench_test "B7-14" "Reputation" "Chicago classic"
run_bench_test "B7-15" "Reputation" "must-try Chicago restaurant"
run_bench_test "B7-16" "Reputation" "world class dining"
run_bench_test "B7-17" "Reputation" "destination restaurant"
run_bench_test "B7-18" "Reputation" "best chef in Chicago"
run_bench_test "B7-19" "Reputation" "award winning cocktails"
run_bench_test "B7-20" "Reputation" "Chicago dining bucket list"

###############################################################################
# CATEGORY 8: CONSTRAINTS (20 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  CATEGORY 8: CONSTRAINTS (20 tests, threshold >= 45)               ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_bench_test "B8-01" "Constraints" "BYOB restaurant"
run_bench_test "B8-02" "Constraints" "outdoor patio dining"
run_bench_test "B8-03" "Constraints" "walk-in friendly no reservation"
run_bench_test "B8-04" "Constraints" "budget under \$30 per person"
run_bench_test "B8-05" "Constraints" "wheelchair accessible"
run_bench_test "B8-06" "Constraints" "late night open past 11"
run_bench_test "B8-07" "Constraints" "parking available"
run_bench_test "B8-08" "Constraints" "private dining room"
run_bench_test "B8-09" "Constraints" "gluten free options"
run_bench_test "B8-10" "Constraints" "vegan menu"
run_bench_test "B8-11" "Constraints" "kosher restaurant"
run_bench_test "B8-12" "Constraints" "halal food"
run_bench_test "B8-13" "Constraints" "dog friendly patio"
run_bench_test "B8-14" "Constraints" "large group 20 people"
run_bench_test "B8-15" "Constraints" "quick under 45 minutes"
run_bench_test "B8-16" "Constraints" "quiet enough for conversation"
run_bench_test "B8-17" "Constraints" "good for zoom lunch"
run_bench_test "B8-18" "Constraints" "cash only spots"
run_bench_test "B8-19" "Constraints" "prix fixe menu"
run_bench_test "B8-20" "Constraints" "delivery available"

###############################################################################
# CATEGORY 9: NICHE/UNCOMMON (20 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  CATEGORY 9: NICHE/UNCOMMON (20 tests, threshold >= 35)            ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_bench_test "B9-01" "Niche" "Georgian food"
run_bench_test "B9-02" "Niche" "Peruvian ceviche bar"
run_bench_test "B9-03" "Niche" "Oaxacan mole"
run_bench_test "B9-04" "Niche" "Sichuan hot pot"
run_bench_test "B9-05" "Niche" "Neapolitan pizza"
run_bench_test "B9-06" "Niche" "Argentinian empanadas"
run_bench_test "B9-07" "Niche" "Filipino food"
run_bench_test "B9-08" "Niche" "Jamaican jerk"
run_bench_test "B9-09" "Niche" "Afghan cuisine"
run_bench_test "B9-10" "Niche" "Burmese food"
run_bench_test "B9-11" "Niche" "Senegalese restaurant"
run_bench_test "B9-12" "Niche" "Uyghur food"
run_bench_test "B9-13" "Niche" "Basque pintxos"
run_bench_test "B9-14" "Niche" "Sri Lankan curry"
run_bench_test "B9-15" "Niche" "Haitian food"
run_bench_test "B9-16" "Niche" "Salvadoran pupusas"
run_bench_test "B9-17" "Niche" "Moroccan tagine"
run_bench_test "B9-18" "Niche" "Tibetan momos"
run_bench_test "B9-19" "Niche" "Nigerian jollof rice"
run_bench_test "B9-20" "Niche" "Armenian food"

###############################################################################
# CATEGORY 10: COMPLEX NATURAL LANGUAGE (20 tests)
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  CATEGORY 10: COMPLEX NATURAL LANGUAGE (20 tests, threshold >= 40) ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

run_bench_test "B10-01" "Complex" "where tech bros eat"
run_bench_test "B10-02" "Complex" "that place with the famous burger"
run_bench_test "B10-03" "Complex" "somewhere my foodie friend would love"
run_bench_test "B10-04" "Complex" "like eating in Tokyo"
run_bench_test "B10-05" "Complex" "grandma's cooking feeling"
run_bench_test "B10-06" "Complex" "Instagram worthy dinner"
run_bench_test "B10-07" "Complex" "where should I take someone who's tried everything"
run_bench_test "B10-08" "Complex" "Chicago food everyone talks about"
run_bench_test "B10-09" "Complex" "the one Bon Appetit featured"
run_bench_test "B10-10" "Complex" "where do chefs eat on their night off"
run_bench_test "B10-11" "Complex" "old money dinner vibes"
run_bench_test "B10-12" "Complex" "new money flashy dinner"
run_bench_test "B10-13" "Complex" "underground food scene"
run_bench_test "B10-14" "Complex" "street food but sit down"
run_bench_test "B10-15" "Complex" "if Anthony Bourdain were alive where would he go"
run_bench_test "B10-16" "Complex" "tasting menu that's actually worth it"
run_bench_test "B10-17" "Complex" "most romantic restaurant no question"
run_bench_test "B10-18" "Complex" "can't go wrong safe bet"
run_bench_test "B10-19" "Complex" "impressive but not pretentious"
run_bench_test "B10-20" "Complex" "best bang for your buck high end"

###############################################################################
# RESULTS SUMMARY
###############################################################################
echo ""
echo "============================================================"
echo "  BENCHMARK 200 — RESULTS SUMMARY"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "============================================================"
echo ""
echo -e "  ${GREEN}PASSED${NC}: $PASS_COUNT"
echo -e "  ${RED}FAILED${NC}: $FAIL_COUNT"
echo -e "  ${YELLOW}WARNED${NC}: $WARN_COUNT"
echo "  TOTAL CHECKS: $((PASS_COUNT + FAIL_COUNT + WARN_COUNT))"
echo ""

# Category breakdown
echo "  ── Per-Category Breakdown ──"
printf "  %-14s %5s %5s %5s %7s %9s\n" "Category" "Pass" "Fail" "Warn" "AvgDM" "Threshold"
printf "  %-14s %5s %5s %5s %7s %9s\n" "──────────" "────" "────" "────" "──────" "─────────"
for cat in "${CATEGORIES[@]}"; do
  local_count=${CAT_COUNT[$cat]}
  if (( local_count > 0 )); then
    avg_dm=$(( ${CAT_MATCH_SUM[$cat]} / local_count ))
  else
    avg_dm=0
  fi
  printf "  %-14s %5d %5d %5d %7d %9d\n" \
    "$cat" "${CAT_PASS[$cat]}" "${CAT_FAIL[$cat]}" "${CAT_WARN[$cat]}" "$avg_dm" "${THRESHOLDS[$cat]}"
done

if (( TOTAL_TESTS > 0 )); then
  echo ""
  echo "  Overall:     avg DM = $((TOTAL_DONDE_MATCH / TOTAL_TESTS)) ($TOTAL_TESTS tests)"
fi

# Generate markdown report
echo ""
echo "Generating report: $REPORT_FILE"
cat > "$REPORT_PATH" << REPORT_EOF
# Benchmark 200 — V11 Validation Results

**Date:** $(date -u '+%Y-%m-%dT%H:%M:%SZ')
**Endpoint:** $API
**Tests:** 200 | **Checks:** $((PASS_COUNT + FAIL_COUNT + WARN_COUNT))

## Summary

| Metric | Value |
|--------|-------|
| PASSED | $PASS_COUNT |
| FAILED | $FAIL_COUNT |
| WARNED | $WARN_COUNT |
| Pass Rate | $(( (PASS_COUNT + FAIL_COUNT + WARN_COUNT) > 0 ? PASS_COUNT * 100 / (PASS_COUNT + FAIL_COUNT + WARN_COUNT) : 0 ))% |

## Per-Category Breakdown

| Category | Pass | Fail | Warn | Avg DM | Threshold |
|----------|------|------|------|--------|-----------|
$(for cat in "${CATEGORIES[@]}"; do
  local_count=${CAT_COUNT[$cat]}
  if (( local_count > 0 )); then
    avg_dm=$(( ${CAT_MATCH_SUM[$cat]} / local_count ))
  else
    avg_dm=0
  fi
  echo "| $cat | ${CAT_PASS[$cat]} | ${CAT_FAIL[$cat]} | ${CAT_WARN[$cat]} | $avg_dm | ${THRESHOLDS[$cat]} |"
done)
| **Overall** | **$PASS_COUNT** | **$FAIL_COUNT** | **$WARN_COUNT** | **$( (( TOTAL_TESTS > 0 )) && echo "$((TOTAL_DONDE_MATCH / TOTAL_TESTS))" || echo "N/A" )** | — |

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
