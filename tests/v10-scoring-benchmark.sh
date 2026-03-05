#!/usr/bin/env bash
set -uo pipefail

###############################################################################
# DONDE V10 SCORING BENCHMARK — 50 Case Studies
#
# Designed to measure improvement from V10 scoring engine enhancements.
# Covers 8 categories targeting known failure modes:
#   1. Specific Dish (8)     — dish resolution, fuzzy matching, synonyms
#   2. Cuisine Match (7)     — cuisine retrieval, taxonomy, cross-cultural
#   3. Vibe/Atmosphere (7)   — vibe queries, tag matching, atmosphere
#   4. Multi-Constraint (7)  — combined cuisine+vibe+budget+location
#   5. Reputation (5)        — awards, best-of, critical acclaim
#   6. Natural Language (6)  — conversational, emotional, ambiguous
#   7. Occasion-Specific (5) — event-driven, date types, celebrations
#   8. Convenience/Location (5) — landmarks, neighborhoods, accessibility
#
# Usage: chmod +x tests/v10-scoring-benchmark.sh && ./tests/v10-scoring-benchmark.sh
# Deps:  curl, jq (v1.6+), bash 4+
###############################################################################

API_URL="https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnprZ3N4bWd3Y3ZtdnV4bmJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NjUzNTYsImV4cCI6MjA4NTU0MTM1Nn0.YBhmusYxc28TD5FOZv4TBpFpDVHHk1V894wUkNtJtcc"

PASS=0; FAIL=0; WARN=0
TOTAL_DM=0; TOTAL_TESTS=0
RESULTS_JSON="[]"
REPORT_FILE="tests/V10_BENCHMARK_RESULTS.md"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_PATH="$(dirname "$SCRIPT_DIR")/$REPORT_FILE"

# Category tracking
declare -A CAT_PASS CAT_FAIL CAT_WARN CAT_DM_SUM CAT_COUNT
for cat in dish cuisine vibe multi reputation natural occasion convenience; do
  CAT_PASS[$cat]=0; CAT_FAIL[$cat]=0; CAT_WARN[$cat]=0; CAT_DM_SUM[$cat]=0; CAT_COUNT[$cat]=0
done

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

###############################################################################
# HELPERS
###############################################################################

API_TMPFILE=$(mktemp)

api_call() {
  local body="$1"
  API_HTTP_CODE=$(curl -s -w "%{http_code}" \
    -X POST "$API_URL" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "$body" \
    --max-time 60 \
    -o "$API_TMPFILE" 2>/dev/null)
}

# Run a single benchmark test
# $1: test_id  $2: category  $3: query  $4: expected_cuisines (pipe-separated, "any" to skip)
# $5: min_score  $6: occasion  $7: expect_rel_type (dish|cuisine|vibe|open_ended|reputation, "" to skip)
# $8: neighborhood  $9: price_level
run_benchmark() {
  local test_id="$1" category="$2" query="$3" expected_cuisines="$4"
  local min_score="${5:-50}" occasion="${6:-Any}" expect_rel_type="${7:-}"
  local neighborhood="${8:-Anywhere}" price_level="${9:-Any}"

  ((TOTAL_TESTS++))
  ((CAT_COUNT[$category]++))

  printf "\n${CYAN}[%s] %s: \"%s\"${NC}\n" "$test_id" "$category" "$query"

  local body
  body=$(jq -n \
    --arg sr "$query" \
    --arg occ "$occasion" \
    --arg nb "$neighborhood" \
    --arg pl "$price_level" \
    '{special_request: $sr, occasion: $occ, neighborhood: $nb, price_level: $pl}')

  local http_code response
  api_call "$body"
  http_code="$API_HTTP_CODE"
  # Strip invalid Unicode surrogate pairs that jq cannot parse (e.g. emoji in Google reviews)
  response=$(sed 's/\\ud[89a-f][0-9a-f][0-9a-f]\\ud[c-f][0-9a-f][0-9a-f]//gi; s/\\ud[89a-f][0-9a-f][0-9a-f]//gi' "$API_TMPFILE")

  # Retry once on transient failure (timeout, empty response, non-200)
  local success_check
  success_check=$(echo "$response" | jq -r '.success // false' 2>/dev/null)
  if [[ "$http_code" != "200" || "$success_check" != "true" ]]; then
    printf "  ${YELLOW}RETRY${NC} (got HTTP %s, success=%s) — retrying in 2s...\n" "$http_code" "$success_check"
    sleep 2
    api_call "$body"
    http_code="$API_HTTP_CODE"
    # Strip invalid Unicode surrogate pairs that jq cannot parse (e.g. emoji in Google reviews)
  response=$(sed 's/\\ud[89a-f][0-9a-f][0-9a-f]\\ud[c-f][0-9a-f][0-9a-f]//gi; s/\\ud[89a-f][0-9a-f][0-9a-f]//gi' "$API_TMPFILE")
  fi

  if [[ "$http_code" != "200" ]]; then
    printf "  ${RED}FAIL${NC} [%s] HTTP 200 (got %s)\n" "$test_id" "$http_code"
    ((FAIL++)); ((CAT_FAIL[$category]++))
    RESULTS_JSON=$(echo "$RESULTS_JSON" | jq --arg id "$test_id" --arg cat "$category" \
      --arg q "$query" --arg status "FAIL" --arg reason "HTTP $http_code" \
      '. + [{"id":$id,"category":$cat,"query":$q,"status":$status,"reason":$reason,"dm":0}]')
    return
  fi

  local success
  success=$(echo "$response" | jq -r '.success // false' 2>/dev/null)
  if [[ "$success" != "true" ]]; then
    printf "  ${RED}FAIL${NC} [%s] success=true (got %s)\n" "$test_id" "$success"
    ((FAIL++)); ((CAT_FAIL[$category]++))
    RESULTS_JSON=$(echo "$RESULTS_JSON" | jq --arg id "$test_id" --arg cat "$category" \
      --arg q "$query" --arg status "FAIL" --arg reason "success=false" \
      '. + [{"id":$id,"category":$cat,"query":$q,"status":$status,"reason":$reason,"dm":0}]')
    return
  fi

  # Extract metrics
  local dm name cuisine rel_type rel_score quality food vibe service reputation convenience
  dm=$(echo "$response" | jq -r '.donde_match // 0')
  name=$(echo "$response" | jq -r '.restaurant.name // "unknown"')
  cuisine=$(echo "$response" | jq -r '.restaurant.cuisine_type // "unknown"')
  rel_type=$(echo "$response" | jq -r '.scoring_v9.relevance_type // "unknown"')
  rel_score=$(echo "$response" | jq -r '.scoring_v9.relevance_score // 0')
  quality=$(echo "$response" | jq -r '.scoring_v9.quality_score // 0')
  food=$(echo "$response" | jq -r '.scoring_v9.food // 0')
  vibe=$(echo "$response" | jq -r '.scoring_v9.vibe // 0')
  service=$(echo "$response" | jq -r '.scoring_v9.service // 0')
  reputation=$(echo "$response" | jq -r '.scoring_v9.reputation // 0')
  convenience=$(echo "$response" | jq -r '.scoring_v9.convenience // 0')

  printf "  → %s (%s) | DM: %s | R: %s (%.2f) | Q: %s | F:%s V:%s S:%s R:%s C:%s\n" \
    "$name" "$cuisine" "$dm" "$rel_type" "$rel_score" "$quality" "$food" "$vibe" "$service" "$reputation" "$convenience"

  local dm_int=${dm%.*}
  TOTAL_DM=$((TOTAL_DM + dm_int))
  CAT_DM_SUM[$category]=$((${CAT_DM_SUM[$category]} + dm_int))

  local test_status="PASS"
  local test_reason=""

  # Check 1: DondeMatch threshold
  if (( dm_int >= min_score )); then
    printf "  ${GREEN}PASS${NC} DM >= %d (got %s)\n" "$min_score" "$dm"
    ((PASS++)); ((CAT_PASS[$category]++))
  elif (( dm_int >= min_score - 10 )); then
    printf "  ${YELLOW}WARN${NC} DM near threshold (got %s, want >= %d)\n" "$dm" "$min_score"
    ((WARN++)); ((CAT_WARN[$category]++))
    test_status="WARN"
    test_reason="DM=$dm < $min_score"
  else
    printf "  ${RED}FAIL${NC} DM >= %d (got %s)\n" "$min_score" "$dm"
    ((FAIL++)); ((CAT_FAIL[$category]++))
    test_status="FAIL"
    test_reason="DM=$dm << $min_score"
  fi

  # Check 2: Cuisine match (when expected)
  if [[ "$expected_cuisines" != "any" && -n "$expected_cuisines" ]]; then
    local cuisine_lower matched=false
    cuisine_lower=$(echo "$cuisine" | tr '[:upper:]' '[:lower:]')
    IFS='|' read -ra CLIST <<< "$expected_cuisines"
    for ec in "${CLIST[@]}"; do
      local ec_lower
      ec_lower=$(echo "$ec" | tr '[:upper:]' '[:lower:]')
      if [[ "$cuisine_lower" == *"$ec_lower"* || "$ec_lower" == *"$cuisine_lower"* ]]; then
        matched=true; break
      fi
    done
    if $matched; then
      printf "  ${GREEN}PASS${NC} Cuisine: %s\n" "$cuisine"
    else
      printf "  ${YELLOW}WARN${NC} Cuisine: got %s, expected [%s]\n" "$cuisine" "$expected_cuisines"
      if [[ "$test_status" == "PASS" ]]; then test_status="WARN"; fi
      test_reason="${test_reason:+$test_reason; }cuisine=$cuisine"
    fi
  fi

  # Check 3: Relevance type (when expected)
  if [[ -n "$expect_rel_type" && "$expect_rel_type" != "" ]]; then
    if [[ "$rel_type" == "$expect_rel_type" ]]; then
      printf "  ${GREEN}PASS${NC} Relevance type: %s\n" "$rel_type"
    else
      printf "  ${YELLOW}WARN${NC} Relevance type: got %s, expected %s\n" "$rel_type" "$expect_rel_type"
    fi
  fi

  RESULTS_JSON=$(echo "$RESULTS_JSON" | jq \
    --arg id "$test_id" --arg cat "$category" --arg q "$query" \
    --arg status "$test_status" --arg reason "$test_reason" \
    --argjson dm "$dm_int" --arg name "$name" --arg cuisine "$cuisine" \
    --arg rt "$rel_type" --argjson rs "${rel_score:-0}" --argjson qs "${quality:-0}" \
    --argjson f "${food:-0}" --argjson v "${vibe:-0}" --argjson s "${service:-0}" \
    --argjson r "${reputation:-0}" --argjson c "${convenience:-0}" \
    '. + [{"id":$id,"category":$cat,"query":$q,"status":$status,"reason":$reason,
           "dm":$dm,"name":$name,"cuisine":$cuisine,"rel_type":$rt,"rel_score":$rs,
           "quality":$qs,"food":$f,"vibe":$v,"service":$s,"reputation":$r,"convenience":$c}]')

  sleep 1
}

###############################################################################
# START
###############################################################################
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  DONDE V10 SCORING BENCHMARK — 50 Case Studies"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  Endpoint: $API_URL"
echo "════════════════════════════════════════════════════════════════"

###############################################################################
# CATEGORY 1: SPECIFIC DISH (8 tests)
# Tests dish resolution, fuzzy matching, synonyms, menu awareness
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  1. SPECIFIC DISH QUERIES (8 tests)                            ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"

run_benchmark "D01" "dish" "birria tacos"             "Mexican"           60 "Any" "dish"
run_benchmark "D02" "dish" "xiao long bao"            "Chinese"           55 "Any" "dish"
run_benchmark "D03" "dish" "momos"                    "Nepalese|Indian"   55 "Any" "dish"
run_benchmark "D04" "dish" "al pastor"                "Mexican"           55 "Any" "dish"
run_benchmark "D05" "dish" "lobster roll"             "Seafood|American"  55 "Any" "dish"
run_benchmark "D06" "dish" "chicken tikka masala"     "Indian"            55 "Any" "dish"
run_benchmark "D07" "dish" "cacio e pepe"             "Italian"           55 "Any" "dish"
run_benchmark "D08" "dish" "pho"                      "Vietnamese"        60 "Any" "dish"

###############################################################################
# CATEGORY 2: CUISINE MATCH (7 tests)
# Tests cuisine retrieval, taxonomy matching, cross-cultural
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  2. CUISINE MATCH QUERIES (7 tests)                            ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"

run_benchmark "C01" "cuisine" "authentic Ethiopian food"        "Ethiopian"           55 "Any" "cuisine"
run_benchmark "C02" "cuisine" "Korean BBQ"                      "Korean"              60 "Any" "cuisine"
run_benchmark "C03" "cuisine" "Peruvian restaurant"             "Peruvian"            55 "Any" "cuisine"
run_benchmark "C04" "cuisine" "dim sum"                         "Chinese"             55 "Any" "dish"
run_benchmark "C05" "cuisine" "polish food"                     "Polish"              55 "Any" "cuisine"
run_benchmark "C06" "cuisine" "good sushi"                      "Japanese"            60 "Any" "dish"
run_benchmark "C07" "cuisine" "soul food"                       "Southern|American"   55 "Any" "cuisine"

###############################################################################
# CATEGORY 3: VIBE/ATMOSPHERE (7 tests)
# Tests vibe-first queries, tag matching, atmosphere resolution
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  3. VIBE/ATMOSPHERE QUERIES (7 tests)                          ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"

run_benchmark "V01" "vibe" "speakeasy cocktail bar"       "any" 55 "Any" "vibe"
run_benchmark "V02" "vibe" "lively rooftop bar"           "any" 55 "Any" "vibe"
run_benchmark "V03" "vibe" "quiet romantic dinner"        "any" 60 "Date Night" "vibe"
run_benchmark "V04" "vibe" "trendy hip restaurant"        "any" 55 "Any" "vibe"
run_benchmark "V05" "vibe" "hidden gem hole in the wall"  "any" 50 "Any" "vibe"
run_benchmark "V06" "vibe" "upscale fine dining"          "any" 60 "Special Occasion" "vibe"
run_benchmark "V07" "vibe" "chill casual neighborhood spot" "any" 55 "Any" "vibe"

###############################################################################
# CATEGORY 4: MULTI-CONSTRAINT (7 tests)
# Tests combined cuisine + vibe + budget + location queries
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  4. MULTI-CONSTRAINT QUERIES (7 tests)                         ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"

run_benchmark "M01" "multi" "cheap late night tacos"                "Mexican"           50 "Any"
run_benchmark "M02" "multi" "romantic Italian BYOB"                 "Italian"           55 "Date Night"
run_benchmark "M03" "multi" "spicy outdoor lunch"                   "any"               50 "Any"
run_benchmark "M04" "multi" "upscale sushi with great cocktails"    "Japanese"          55 "Date Night"
run_benchmark "M05" "multi" "family friendly Mexican with patio"    "Mexican"           55 "Family Dinner"
run_benchmark "M06" "multi" "vegan brunch with good coffee"         "any"               50 "Any"
run_benchmark "M07" "multi" "affordable Thai food near west loop"   "Thai"              50 "Any" "" "West Loop"

###############################################################################
# CATEGORY 5: REPUTATION (5 tests)
# Tests award recognition, critical acclaim, best-of matching
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  5. REPUTATION QUERIES (5 tests)                               ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"

run_benchmark "R01" "reputation" "michelin star restaurant"           "any" 60 "Any"
run_benchmark "R02" "reputation" "james beard award winner"           "any" 60 "Any"
run_benchmark "R03" "reputation" "best restaurant in chicago"         "any" 65 "Any"
run_benchmark "R04" "reputation" "critically acclaimed chef"          "any" 55 "Any"
run_benchmark "R05" "reputation" "most popular restaurant right now"  "any" 55 "Any"

###############################################################################
# CATEGORY 6: NATURAL LANGUAGE (6 tests)
# Tests conversational, emotional, ambiguous queries
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  6. NATURAL LANGUAGE QUERIES (6 tests)                         ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"

run_benchmark "N01" "natural" "somewhere to impress my in-laws"          "any" 55 "Special Occasion"
run_benchmark "N02" "natural" "I want something I've never tried"        "any" 50 "Adventure"
run_benchmark "N03" "natural" "take me somewhere fancy"                  "any" 55 "Date Night"
run_benchmark "N04" "natural" "what's good around here"                  "any" 50 "Any"
run_benchmark "N05" "natural" "feed me something amazing"                "any" 55 "Any"
run_benchmark "N06" "natural" "comfort food on a rainy day"              "any" 50 "Any"

###############################################################################
# CATEGORY 7: OCCASION-SPECIFIC (5 tests)
# Tests event-driven queries, date types, celebrations
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  7. OCCASION-SPECIFIC QUERIES (5 tests)                        ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"

run_benchmark "O01" "occasion" "anniversary dinner"                 "any" 60 "Special Occasion"
run_benchmark "O02" "occasion" "birthday celebration dinner"        "any" 60 "Special Occasion"
run_benchmark "O03" "occasion" "business client dinner"             "any" 60 "Business Lunch"
run_benchmark "O04" "occasion" "solo counter dining experience"     "any" 55 "Solo Dining"
run_benchmark "O05" "occasion" "fun group dinner for 8 people"      "any" 55 "Group Hangout"

###############################################################################
# CATEGORY 8: CONVENIENCE/LOCATION (5 tests)
# Tests landmarks, neighborhood resolution, accessibility
###############################################################################
echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  8. CONVENIENCE/LOCATION QUERIES (5 tests)                     ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════╝${NC}"

run_benchmark "L01" "convenience" "dinner near millennium park"     "any" 50 "Any" "" "The Loop"
run_benchmark "L02" "convenience" "late night food in wicker park"  "any" 50 "Any" "" "Wicker Park"
run_benchmark "L03" "convenience" "quick lunch in the loop"         "any" 55 "Any" "" "The Loop"
run_benchmark "L04" "convenience" "west loop date night restaurant" "any" 60 "Date Night" "" "West Loop"
run_benchmark "L05" "convenience" "logan square brunch"             "any" 55 "Any" "" "Logan Square"

###############################################################################
# RESULTS SUMMARY
###############################################################################
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  V10 SCORING BENCHMARK RESULTS"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo -e "  ${GREEN}PASSED${NC}: $PASS"
echo -e "  ${RED}FAILED${NC}: $FAIL"
echo -e "  ${YELLOW}WARNED${NC}: $WARN"
echo "  TOTAL TESTS: $TOTAL_TESTS"
echo ""

if (( TOTAL_TESTS > 0 )); then
  echo "  Overall Avg DM: $((TOTAL_DM / TOTAL_TESTS))"
fi
echo ""

echo "  ── Category Breakdown ──"
for cat in dish cuisine vibe multi reputation natural occasion convenience; do
  if (( ${CAT_COUNT[$cat]} > 0 )); then
    printf "  %-15s avg DM: %3d  (%dP/%dF/%dW, n=%d)\n" \
      "$cat" "$((${CAT_DM_SUM[$cat]} / ${CAT_COUNT[$cat]}))" \
      "${CAT_PASS[$cat]}" "${CAT_FAIL[$cat]}" "${CAT_WARN[$cat]}" "${CAT_COUNT[$cat]}"
  fi
done

echo ""

# Save results JSON
RESULTS_OUTFILE="$(dirname "$SCRIPT_DIR")/tests/v10-benchmark-results.json"
echo "$RESULTS_JSON" | jq '.' > "$RESULTS_OUTFILE"
echo "Results saved to: $RESULTS_OUTFILE"

# Generate markdown report
cat > "$REPORT_PATH" <<REPORT_EOF
# V10 Scoring Benchmark Results

**Run:** $(date -u '+%Y-%m-%dT%H:%M:%SZ')
**Tests:** $TOTAL_TESTS | **Pass:** $PASS | **Fail:** $FAIL | **Warn:** $WARN
**Overall Avg DM:** $((TOTAL_TESTS > 0 ? TOTAL_DM / TOTAL_TESTS : 0))

## Category Breakdown

| Category | Avg DM | Pass | Fail | Warn | Count |
|----------|--------|------|------|------|-------|
REPORT_EOF

for cat in dish cuisine vibe multi reputation natural occasion convenience; do
  if (( ${CAT_COUNT[$cat]} > 0 )); then
    printf "| %-15s | %3d | %d | %d | %d | %d |\n" \
      "$cat" "$((${CAT_DM_SUM[$cat]} / ${CAT_COUNT[$cat]}))" \
      "${CAT_PASS[$cat]}" "${CAT_FAIL[$cat]}" "${CAT_WARN[$cat]}" "${CAT_COUNT[$cat]}" >> "$REPORT_PATH"
  fi
done

echo "" >> "$REPORT_PATH"
echo "## Per-Case Results" >> "$REPORT_PATH"
echo "" >> "$REPORT_PATH"
echo '```' >> "$REPORT_PATH"
echo "$RESULTS_JSON" | jq -r '.[] | "\(.id) | \(.status) | DM=\(.dm) | \(.name // "N/A") (\(.cuisine // "N/A")) | \(.query)"' >> "$REPORT_PATH"
echo '```' >> "$REPORT_PATH"

echo "Report saved to: $REPORT_PATH"
echo ""

# Cleanup
rm -f "$API_TMPFILE"

# Exit code
if (( FAIL > 0 )); then
  exit 1
else
  exit 0
fi
