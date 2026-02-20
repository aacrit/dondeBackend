#!/usr/bin/env bash
set -uo pipefail

###############################################################################
# DONDE RECOMMENDATION API — FULL TEST SUITE (T01–T54)
# 54 scenarios · ~210 validation checks · 5 phases
#
# Usage:  chmod +x tests/test_catalog.sh && ./tests/test_catalog.sh
# Deps:   curl, jq (v1.6+), bash 4+
###############################################################################

API="https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend"
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
TEST_LOG=""
LAST_RESPONSE=""
HTTP_CODE=""
REPORT_FILE="tests/TEST_RESULTS.md"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_PATH="$(dirname "$SCRIPT_DIR")/$REPORT_FILE"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

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

api_call_method() {
  local method="$1"
  local body="${2:-}"
  local raw
  if [[ -n "$body" ]]; then
    raw=$(curl -s -w "\n%{http_code}" -X "$method" "$API" \
      -H "Content-Type: application/json" \
      -d "$body" \
      --max-time 45 2>/dev/null)
  else
    raw=$(curl -s -w "\n%{http_code}" -X "$method" "$API" \
      -H "Content-Type: application/json" \
      --max-time 45 2>/dev/null)
  fi
  HTTP_CODE=$(echo "$raw" | tail -n1)
  LAST_RESPONSE=$(echo "$raw" | sed '$d')
}

check() {
  local test_id="$1"
  local check_name="$2"
  local jq_expr="$3"
  local expected="$4"
  local actual
  actual=$(echo "$LAST_RESPONSE" | jq -r "$jq_expr" 2>/dev/null) || actual="JQ_ERROR"
  if [[ "$actual" == "$expected" ]]; then
    echo -e "  ${GREEN}PASS${NC} [$test_id] $check_name"
    ((PASS_COUNT++))
    TEST_LOG+="PASS|$test_id|$check_name\n"
  else
    echo -e "  ${RED}FAIL${NC} [$test_id] $check_name (expected: $expected, got: $actual)"
    ((FAIL_COUNT++))
    TEST_LOG+="FAIL|$test_id|$check_name|expected=$expected|got=$actual\n"
  fi
}

check_exists() {
  local test_id="$1"
  local check_name="$2"
  local jq_expr="$3"
  local actual
  actual=$(echo "$LAST_RESPONSE" | jq -r "$jq_expr" 2>/dev/null) || actual=""
  if [[ -n "$actual" && "$actual" != "null" && "$actual" != "" ]]; then
    echo -e "  ${GREEN}PASS${NC} [$test_id] $check_name"
    ((PASS_COUNT++))
    TEST_LOG+="PASS|$test_id|$check_name\n"
  else
    echo -e "  ${RED}FAIL${NC} [$test_id] $check_name (expected non-null, got: '$actual')"
    ((FAIL_COUNT++))
    TEST_LOG+="FAIL|$test_id|$check_name|expected=non-null|got=$actual\n"
  fi
}

check_oneof() {
  local test_id="$1"
  local check_name="$2"
  local jq_expr="$3"
  shift 3
  local allowed=("$@")
  local actual
  actual=$(echo "$LAST_RESPONSE" | jq -r "$jq_expr" 2>/dev/null) || actual=""
  local found=false
  for val in "${allowed[@]}"; do
    if [[ "$actual" == "$val" ]]; then found=true; break; fi
  done
  if $found; then
    echo -e "  ${GREEN}PASS${NC} [$test_id] $check_name (got: $actual)"
    ((PASS_COUNT++))
    TEST_LOG+="PASS|$test_id|$check_name\n"
  else
    echo -e "  ${RED}FAIL${NC} [$test_id] $check_name (got: '$actual', allowed: ${allowed[*]})"
    ((FAIL_COUNT++))
    TEST_LOG+="FAIL|$test_id|$check_name|allowed=${allowed[*]}|got=$actual\n"
  fi
}

warn_check() {
  local test_id="$1"
  local check_name="$2"
  local condition="$3" # "true" or "false"
  local detail="${4:-}"
  if [[ "$condition" == "true" ]]; then
    echo -e "  ${GREEN}PASS${NC} [$test_id] $check_name ${detail:+($detail)}"
    ((PASS_COUNT++))
    TEST_LOG+="PASS|$test_id|$check_name\n"
  else
    echo -e "  ${YELLOW}WARN${NC} [$test_id] $check_name ${detail:+($detail)}"
    ((SKIP_COUNT++))
    TEST_LOG+="WARN|$test_id|$check_name|$detail\n"
  fi
}

check_http() {
  local test_id="$1"
  local expected="$2"
  if [[ "$HTTP_CODE" == "$expected" ]]; then
    echo -e "  ${GREEN}PASS${NC} [$test_id] HTTP $expected"
    ((PASS_COUNT++))
    TEST_LOG+="PASS|$test_id|HTTP $expected\n"
  else
    echo -e "  ${RED}FAIL${NC} [$test_id] HTTP status (expected: $expected, got: $HTTP_CODE)"
    ((FAIL_COUNT++))
    TEST_LOG+="FAIL|$test_id|HTTP status|expected=$expected|got=$HTTP_CODE\n"
  fi
}

test_banner() {
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}  $1: $2${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

phase_banner() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║  PHASE $1: $2${NC}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"
}

###############################################################################
# START
###############################################################################
echo ""
echo "============================================================"
echo "  DONDE RECOMMENDATION API — FULL TEST SUITE (T01-T50)"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  Endpoint: $API"
echo "  Tests: 50 | Expected checks: ~185"
echo "============================================================"

# Store restaurant IDs for later exclude tests
T01_RESTAURANT_ID=""
T33_FIRST_ID=""

###############################################################################
# PHASE 1: CONTRACT VALIDATION (T01-T08)
###############################################################################
phase_banner "1" "Contract Validation (T01-T08)"

# ─── T01: Bare minimum request ───────────────────────────────────────────────
test_banner "T01" "Bare minimum request — empty body"
api_call '{}'

check_http   "T01" "200"
check        "T01" "success is true"              '.success'                                'true'
check        "T01" "recommendation is string"     '.recommendation | type'                  'string'
check        "T01" "donde_match >= 60"            '.donde_match >= 60'                      'true'
check        "T01" "donde_match <= 99"            '.donde_match <= 99'                      'true'
check        "T01" "timestamp is ISO 8601"        '.timestamp | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T")' 'true'
check_exists "T01" "restaurant object"            '.restaurant'
check_exists "T01" "restaurant.id"                '.restaurant.id'
check_exists "T01" "restaurant.name"              '.restaurant.name'
check_exists "T01" "restaurant.address"           '.restaurant.address'
check        "T01" "tags is array"                '.tags | type'                            'array'
check        "T01" "scores is object"             '.scores | type'                          'object'

T01_RESTAURANT_ID=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.id')
echo "  [info] Restaurant: $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name') (ID: $T01_RESTAURANT_ID)"

# ─── T02: Full response shape audit ─────────────────────────────────────────
test_banner "T02" "Full response shape audit — all fields present"
api_call '{"special_request":"good food","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}'

# restaurant fields — required
check_exists "T02" "restaurant.id"                '.restaurant.id'
check_exists "T02" "restaurant.name"              '.restaurant.name'
check_exists "T02" "restaurant.address"           '.restaurant.address'
check_exists "T02" "restaurant.neighborhood_name" '.restaurant.neighborhood_name'
check_oneof  "T02" "restaurant.price_level"       '.restaurant.price_level' '$' '$$' '$$$' '$$$$'

# restaurant fields — nullable but key must exist
check "T02" "has google_place_id key"    '.restaurant | has("google_place_id")'     'true'
check "T02" "has google_rating key"      '.restaurant | has("google_rating")'       'true'
check "T02" "has google_review_count"    '.restaurant | has("google_review_count")' 'true'
check "T02" "has phone key"              '.restaurant | has("phone")'               'true'
check "T02" "has website key"            '.restaurant | has("website")'             'true'
check "T02" "has noise_level key"        '.restaurant | has("noise_level")'         'true'
check "T02" "has cuisine_type key"       '.restaurant | has("cuisine_type")'        'true'
check "T02" "has lighting_ambiance key"  '.restaurant | has("lighting_ambiance")'   'true'
check "T02" "has dress_code key"         '.restaurant | has("dress_code")'          'true'
check "T02" "has outdoor_seating key"    '.restaurant | has("outdoor_seating")'     'true'
check "T02" "has live_music key"         '.restaurant | has("live_music")'          'true'
check "T02" "has pet_friendly key"       '.restaurant | has("pet_friendly")'        'true'
check "T02" "has parking_availability"   '.restaurant | has("parking_availability")' 'true'
check "T02" "has sentiment_breakdown"    '.restaurant | has("sentiment_breakdown")' 'true'
check "T02" "has sentiment_score key"    '.restaurant | has("sentiment_score")'     'true'
check "T02" "has best_for_oneliner"      '.restaurant | has("best_for_oneliner")'   'true'

# scores fields — all 7
check "T02" "has date_friendly_score"    '.scores | has("date_friendly_score")'     'true'
check "T02" "has group_friendly_score"   '.scores | has("group_friendly_score")'    'true'
check "T02" "has family_friendly_score"  '.scores | has("family_friendly_score")'   'true'
check "T02" "has romantic_rating"        '.scores | has("romantic_rating")'         'true'
check "T02" "has business_lunch_score"   '.scores | has("business_lunch_score")'    'true'
check "T02" "has solo_dining_score"      '.scores | has("solo_dining_score")'       'true'
check "T02" "has hole_in_wall_factor"    '.scores | has("hole_in_wall_factor")'     'true'

# top-level
check "T02" "has insider_tip key"        'has("insider_tip")'                       'true'

# ─── T03: Recommendation text quality ────────────────────────────────────────
test_banner "T03" "Recommendation text quality — length and format"
api_call '{"special_request":"romantic Italian dinner","occasion":"Date Night","neighborhood":"West Loop","price_level":"$$$"}'

check "T03" "recommendation not empty"     '.recommendation | length > 0'            'true'
check "T03" "recommendation is string"     '.recommendation | type'                  'string'

WORD_COUNT=$(echo "$LAST_RESPONSE" | jq -r '.recommendation' | wc -w | tr -d ' ')
if [[ $WORD_COUNT -ge 40 ]]; then
  echo -e "  ${GREEN}PASS${NC} [T03] recommendation >= 40 words (got: $WORD_COUNT)"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T03|recommendation >= 40 words\n"
else
  echo -e "  ${RED}FAIL${NC} [T03] recommendation >= 40 words (got: $WORD_COUNT)"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T03|recommendation >= 40 words|got=$WORD_COUNT\n"
fi
if [[ $WORD_COUNT -le 200 ]]; then
  echo -e "  ${GREEN}PASS${NC} [T03] recommendation <= 200 words (got: $WORD_COUNT)"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T03|recommendation <= 200 words\n"
else
  echo -e "  ${RED}FAIL${NC} [T03] recommendation <= 200 words (got: $WORD_COUNT)"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T03|recommendation <= 200 words|got=$WORD_COUNT\n"
fi

# insider_tip type check
IT_TYPE=$(echo "$LAST_RESPONSE" | jq -r '.insider_tip | type')
if [[ "$IT_TYPE" == "string" || "$IT_TYPE" == "null" ]]; then
  echo -e "  ${GREEN}PASS${NC} [T03] insider_tip is string or null (got: $IT_TYPE)"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T03|insider_tip type\n"
else
  echo -e "  ${RED}FAIL${NC} [T03] insider_tip type (expected string|null, got: $IT_TYPE)"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T03|insider_tip type|got=$IT_TYPE\n"
fi

# Restaurant name mentioned in recommendation (soft)
RNAME=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.name' | tr '[:upper:]' '[:lower:]' | head -c 15)
REC_LOWER=$(echo "$LAST_RESPONSE" | jq -r '.recommendation' | tr '[:upper:]' '[:lower:]')
if [[ "$REC_LOWER" == *"$RNAME"* ]]; then
  warn_check "T03" "rec mentions restaurant name" "true" "$RNAME"
else
  warn_check "T03" "rec mentions restaurant name" "false" "name=$RNAME not found in text"
fi

# ─── T04: donde_match range & type ──────────────────────────────────────────
test_banner "T04" "donde_match score — range and type"
api_call '{"special_request":"best pizza in town","occasion":"Chill Hangout","neighborhood":"Wicker Park","price_level":"$$"}'

check "T04" "donde_match is number"      '.donde_match | type'                      'number'
check "T04" "donde_match >= 60"          '.donde_match >= 60'                       'true'
check "T04" "donde_match <= 99"          '.donde_match <= 99'                       'true'
check "T04" "donde_match is integer"     '.donde_match == (.donde_match | floor)'   'true'
check "T04" "success is true"            '.success'                                 'true'
echo "  [info] donde_match: $(echo "$LAST_RESPONSE" | jq '.donde_match')"

# ─── T05: Tags array validation ─────────────────────────────────────────────
test_banner "T05" "Tags array — structure and content"
api_call '{"special_request":"outdoor brunch","occasion":"Treat Myself","neighborhood":"Lincoln Park","price_level":"$$"}'

check "T05" "tags is array"              '.tags | type'                              'array'
check "T05" "tags has >= 1 element"      '.tags | length >= 1'                      'true'
check "T05" "tags[0] is string"          '.tags[0] | type'                          'string'
check "T05" "all tags are strings"       '[.tags[] | type] | all(. == "string")'    'true'
check "T05" "tags has <= 10 elements"    '.tags | length <= 10'                     'true'
echo "  [info] Tags: $(echo "$LAST_RESPONSE" | jq -c '.tags')"

# ─── T06: Scores value ranges ───────────────────────────────────────────────
test_banner "T06" "Scores object — value ranges (0-10 or null)"
api_call '{"special_request":"steak dinner","occasion":"Special Occasion","neighborhood":"River North","price_level":"$$$$"}'

for field in date_friendly_score group_friendly_score family_friendly_score romantic_rating business_lunch_score solo_dining_score hole_in_wall_factor; do
  check "T06" "$field in range or null" \
    ".scores.${field} == null or (.scores.${field} >= 0 and .scores.${field} <= 10)" 'true'
done
check "T06" "success is true"            '.success'                                 'true'
echo "  [info] Scores: $(echo "$LAST_RESPONSE" | jq -c '.scores')"

# ─── T07: Enum field validation ─────────────────────────────────────────────
test_banner "T07" "Enum fields — dress_code, noise_level, price_level"
api_call '{"occasion":"Business Lunch","neighborhood":"West Loop","price_level":"$$$"}'

check_oneof "T07" "price_level valid"    '.restaurant.price_level' '$' '$$' '$$$' '$$$$'

NOISE=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.noise_level')
if [[ "$NOISE" == "null" || "$NOISE" == "Quiet" || "$NOISE" == "Moderate" || "$NOISE" == "Loud" ]]; then
  echo -e "  ${GREEN}PASS${NC} [T07] noise_level valid (got: $NOISE)"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T07|noise_level valid\n"
else
  echo -e "  ${RED}FAIL${NC} [T07] noise_level valid (got: $NOISE)"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T07|noise_level|got=$NOISE\n"
fi

DRESS=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.dress_code')
if [[ "$DRESS" == "null" || "$DRESS" == "Casual" || "$DRESS" == "Smart Casual" || "$DRESS" == "Business Casual" || "$DRESS" == "Formal" ]]; then
  echo -e "  ${GREEN}PASS${NC} [T07] dress_code valid (got: $DRESS)"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T07|dress_code valid\n"
else
  echo -e "  ${RED}FAIL${NC} [T07] dress_code valid (got: $DRESS)"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T07|dress_code|got=$DRESS\n"
fi

check "T07" "success is true"            '.success'                                 'true'

# ─── T08: Boolean field validation ──────────────────────────────────────────
test_banner "T08" "Boolean fields — outdoor_seating, live_music, pet_friendly"
api_call '{"special_request":"patio dining with my dog","occasion":"Chill Hangout","neighborhood":"Andersonville","price_level":"$$"}'

for field in outdoor_seating live_music pet_friendly; do
  check "T08" "$field is bool or null" \
    ".restaurant.${field} == null or .restaurant.${field} == true or .restaurant.${field} == false" 'true'
done
check "T08" "success is true"            '.success'                                 'true'

###############################################################################
# PHASE 2: PARAMETER COVERAGE (T09-T18)
###############################################################################
phase_banner "2" "Parameter Coverage (T09-T18)"

# ─── T09: Date Night ────────────────────────────────────────────────────────
test_banner "T09" "Occasion: Date Night — romantic scoring"
api_call '{"occasion":"Date Night","neighborhood":"Logan Square","price_level":"$$$"}'

check        "T09" "success"                '.success'                              'true'
check        "T09" "date_friendly >= 5"     '.scores.date_friendly_score >= 5'      'true'
check        "T09" "romantic_rating >= 5"   '.scores.romantic_rating >= 5'          'true'
check        "T09" "neighborhood match"     '.restaurant.neighborhood_name'         'Logan Square'
echo "  [info] $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name'), romantic=$(echo "$LAST_RESPONSE" | jq '.scores.romantic_rating'), date=$(echo "$LAST_RESPONSE" | jq '.scores.date_friendly_score')"

# ─── T10: Group Hangout ─────────────────────────────────────────────────────
test_banner "T10" "Occasion: Group Hangout — group scoring"
api_call '{"occasion":"Group Hangout","neighborhood":"Wicker Park","price_level":"$$"}'

check        "T10" "success"                '.success'                              'true'
check        "T10" "group_friendly >= 5"    '.scores.group_friendly_score >= 5'     'true'
check_oneof  "T10" "price is $$"            '.restaurant.price_level'               '$$'
echo "  [info] $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name'), group=$(echo "$LAST_RESPONSE" | jq '.scores.group_friendly_score')"

# ─── T11: Family Dinner ─────────────────────────────────────────────────────
test_banner "T11" "Occasion: Family Dinner — family scoring"
api_call '{"occasion":"Family Dinner","neighborhood":"Lincoln Park","price_level":"$$"}'

check        "T11" "success"                '.success'                              'true'
check        "T11" "family_friendly >= 5"   '.scores.family_friendly_score >= 5'    'true'
check_exists "T11" "has restaurant name"    '.restaurant.name'
echo "  [info] $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name'), family=$(echo "$LAST_RESPONSE" | jq '.scores.family_friendly_score')"

# ─── T12: Business Lunch ────────────────────────────────────────────────────
test_banner "T12" "Occasion: Business Lunch — business scoring"
api_call '{"occasion":"Business Lunch","neighborhood":"West Loop","price_level":"$$$"}'

check        "T12" "success"                '.success'                              'true'
check        "T12" "business_lunch >= 5"    '.scores.business_lunch_score >= 5'     'true'
check        "T12" "neighborhood match"     '.restaurant.neighborhood_name'         'West Loop'
echo "  [info] $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name'), business=$(echo "$LAST_RESPONSE" | jq '.scores.business_lunch_score')"

# ─── T13: Solo Dining ───────────────────────────────────────────────────────
test_banner "T13" "Occasion: Solo Dining — solo scoring"
api_call '{"occasion":"Solo Dining","neighborhood":"Pilsen","price_level":"$"}'

check        "T13" "success"                '.success'                              'true'
check        "T13" "solo_dining >= 4"       '.scores.solo_dining_score >= 4'        'true'
check_oneof  "T13" "price_level $"          '.restaurant.price_level'               '$'
echo "  [info] $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name'), solo=$(echo "$LAST_RESPONSE" | jq '.scores.solo_dining_score')"

# ─── T14: Special Occasion ──────────────────────────────────────────────────
test_banner "T14" "Occasion: Special Occasion — 70% romantic + 30% date blend"
api_call '{"occasion":"Special Occasion","neighborhood":"River North","price_level":"$$$$"}'

check "T14" "success"                       '.success'                              'true'
check "T14" "romantic_rating >= 6"          '.scores.romantic_rating >= 6'          'true'
check "T14" "date_friendly >= 5"            '.scores.date_friendly_score >= 5'      'true'
check_oneof "T14" "price $$$$"              '.restaurant.price_level'               '$$$$'
echo "  [info] romantic=$(echo "$LAST_RESPONSE" | jq '.scores.romantic_rating'), date=$(echo "$LAST_RESPONSE" | jq '.scores.date_friendly_score')"

# ─── T15: Treat Myself ──────────────────────────────────────────────────────
test_banner "T15" "Occasion: Treat Myself — solo+romantic+hidden_gem blend"
api_call '{"occasion":"Treat Myself","neighborhood":"Bucktown","price_level":"$$$"}'

check        "T15" "success"                '.success'                              'true'
check        "T15" "solo_dining >= 4"       '.scores.solo_dining_score >= 4'        'true'
check        "T15" "donde_match >= 60"      '.donde_match >= 60'                    'true'
check        "T15" "neighborhood match"     '.restaurant.neighborhood_name'         'Bucktown'
echo "  [info] solo=$(echo "$LAST_RESPONSE" | jq '.scores.solo_dining_score'), romantic=$(echo "$LAST_RESPONSE" | jq '.scores.romantic_rating'), hole=$(echo "$LAST_RESPONSE" | jq '.scores.hole_in_wall_factor')"

# ─── T16: Adventure ─────────────────────────────────────────────────────────
test_banner "T16" "Occasion: Adventure — hole_in_wall dominant"
api_call '{"occasion":"Adventure","neighborhood":"Chinatown","price_level":"$"}'

check        "T16" "success"                '.success'                              'true'
check        "T16" "hole_in_wall >= 4"      '.scores.hole_in_wall_factor >= 4'      'true'
check        "T16" "neighborhood match"     '.restaurant.neighborhood_name'         'Chinatown'
check_oneof  "T16" "price $"                '.restaurant.price_level'               '$'
echo "  [info] hole=$(echo "$LAST_RESPONSE" | jq '.scores.hole_in_wall_factor')"

# ─── T17: Chill Hangout ─────────────────────────────────────────────────────
test_banner "T17" "Occasion: Chill Hangout — group-dominant blend"
api_call '{"occasion":"Chill Hangout","neighborhood":"Lakeview","price_level":"$$"}'

check        "T17" "success"                '.success'                              'true'
check        "T17" "group_friendly >= 4"    '.scores.group_friendly_score >= 4'     'true'
check        "T17" "neighborhood match"     '.restaurant.neighborhood_name'         'Lakeview'
echo "  [info] group=$(echo "$LAST_RESPONSE" | jq '.scores.group_friendly_score')"

# ─── T18: Explicit defaults ─────────────────────────────────────────────────
test_banner "T18" "All defaults explicit — Any/Anywhere/Any"
api_call '{"occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}'

check        "T18" "success"                '.success'                              'true'
check        "T18" "donde_match >= 60"      '.donde_match >= 60'                    'true'
check_exists "T18" "restaurant name"        '.restaurant.name'
check_exists "T18" "neighborhood_name"      '.restaurant.neighborhood_name'
check        "T18" "tags non-empty"         '.tags | length >= 1'                   'true'

###############################################################################
# PHASE 3: RANKING INTELLIGENCE (T19-T30)
###############################################################################
phase_banner "3" "Ranking Intelligence (T19-T30)"

# ─── T19: Cuisine: Mexican ──────────────────────────────────────────────────
test_banner "T19" "Cuisine keyword: Mexican (tacos in Pilsen)"
api_call '{"special_request":"tacos","occasion":"Any","neighborhood":"Pilsen","price_level":"$"}'

check "T19" "success"                       '.success'                              'true'
CUISINE=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
if [[ "$CUISINE" == *"mexican"* || "$CUISINE" == *"taco"* || "$CUISINE" == *"latin"* ]]; then
  warn_check "T19" "cuisine matches Mexican" "true" "got: $CUISINE"
else
  warn_check "T19" "cuisine matches Mexican" "false" "got: $CUISINE"
fi
check "T19" "neighborhood Pilsen"           '.restaurant.neighborhood_name'         'Pilsen'
echo "  [info] $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name'), cuisine: $CUISINE"

# ─── T20: Cuisine: Italian ──────────────────────────────────────────────────
test_banner "T20" "Cuisine keyword: Italian (pasta in Little Italy)"
api_call '{"special_request":"pasta carbonara","occasion":"Date Night","neighborhood":"Little Italy","price_level":"$$"}'

check "T20" "success"                       '.success'                              'true'
CUISINE=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
if [[ "$CUISINE" == *"italian"* || "$CUISINE" == *"pasta"* ]]; then
  warn_check "T20" "cuisine is Italian" "true" "got: $CUISINE"
else
  warn_check "T20" "cuisine is Italian" "false" "got: $CUISINE"
fi
check "T20" "neighborhood Little Italy"     '.restaurant.neighborhood_name'         'Little Italy'
check "T20" "date_friendly >= 3"            '.scores.date_friendly_score >= 3'      'true'

# ─── T21: Cuisine: Japanese ─────────────────────────────────────────────────
test_banner "T21" "Cuisine keyword: Japanese (sushi omakase)"
api_call '{"special_request":"sushi omakase","occasion":"Special Occasion","neighborhood":"Anywhere","price_level":"$$$$"}'

check "T21" "success"                       '.success'                              'true'
CUISINE=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
if [[ "$CUISINE" == *"japanese"* || "$CUISINE" == *"sushi"* ]]; then
  warn_check "T21" "cuisine is Japanese" "true" "got: $CUISINE"
else
  warn_check "T21" "cuisine is Japanese" "false" "got: $CUISINE"
fi
check "T21" "romantic >= 6"                 '.scores.romantic_rating >= 6'          'true'

# ─── T22: Intent: spicy ─────────────────────────────────────────────────────
test_banner "T22" "Intent expansion: spicy → Thai/Indian/Korean/Mexican"
api_call '{"special_request":"something really spicy","occasion":"Adventure","neighborhood":"Anywhere","price_level":"Any"}'

check "T22" "success"                       '.success'                              'true'
CUISINE=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
if [[ "$CUISINE" == *"thai"* || "$CUISINE" == *"indian"* || "$CUISINE" == *"korean"* || "$CUISINE" == *"mexican"* || "$CUISINE" == *"szechuan"* || "$CUISINE" == *"chinese"* ]]; then
  warn_check "T22" "spicy intent mapped" "true" "got: $CUISINE"
else
  warn_check "T22" "spicy intent mapped" "false" "got: $CUISINE"
fi
check "T22" "hole_in_wall >= 4"             '.scores.hole_in_wall_factor >= 4'      'true'

# ─── T23: Intent: anniversary ────────────────────────────────────────────────
test_banner "T23" "Intent expansion: anniversary → romantic"
api_call '{"special_request":"anniversary dinner","occasion":"Special Occasion","neighborhood":"Anywhere","price_level":"$$$$"}'

check "T23" "success"                       '.success'                              'true'
check "T23" "romantic >= 7"                 '.scores.romantic_rating >= 7'          'true'
check "T23" "donde_match >= 70"             '.donde_match >= 70'                    'true'
echo "  [info] romantic=$(echo "$LAST_RESPONSE" | jq '.scores.romantic_rating'), match=$(echo "$LAST_RESPONSE" | jq '.donde_match')"

# ─── T24: Intent: healthy ───────────────────────────────────────────────────
test_banner "T24" "Intent expansion: healthy → farm-to-table/vegan"
api_call '{"special_request":"something healthy and light","occasion":"Solo Dining","neighborhood":"Anywhere","price_level":"$$"}'

check "T24" "success"                       '.success'                              'true'
check "T24" "solo_dining >= 4"              '.scores.solo_dining_score >= 4'        'true'
TAGS=$(echo "$LAST_RESPONSE" | jq -r '[.tags[] | ascii_downcase] | join(",")')
REC=$(echo "$LAST_RESPONSE" | jq -r '.recommendation' | tr '[:upper:]' '[:lower:]')
if [[ "$TAGS" == *"farm"* || "$TAGS" == *"vegan"* || "$TAGS" == *"healthy"* || "$TAGS" == *"fresh"* || "$REC" == *"health"* || "$REC" == *"fresh"* || "$REC" == *"light"* ]]; then
  warn_check "T24" "healthy intent in output" "true" "tags=$TAGS"
else
  warn_check "T24" "healthy intent in output" "false" "tags=$TAGS"
fi

# ─── T25: Intent: instagrammable ────────────────────────────────────────────
test_banner "T25" "Intent expansion: instagrammable → trendy/rooftop"
api_call '{"special_request":"instagrammable restaurant","occasion":"Treat Myself","neighborhood":"West Loop","price_level":"$$$"}'

check "T25" "success"                       '.success'                              'true'
TAGS=$(echo "$LAST_RESPONSE" | jq -r '[.tags[] | ascii_downcase] | join(",")')
if [[ "$TAGS" == *"trendy"* || "$TAGS" == *"rooftop"* || "$TAGS" == *"instagram"* || "$TAGS" == *"scenic"* || "$TAGS" == *"chic"* ]]; then
  warn_check "T25" "instagrammable tags" "true" "tags=$TAGS"
else
  warn_check "T25" "instagrammable tags" "false" "tags=$TAGS"
fi
check "T25" "neighborhood West Loop"        '.restaurant.neighborhood_name'         'West Loop'

# ─── T26: Dietary: vegan ────────────────────────────────────────────────────
test_banner "T26" "Dietary keyword: vegan"
api_call '{"special_request":"vegan options please","occasion":"Any","neighborhood":"Wicker Park","price_level":"$$"}'

check "T26" "success"                       '.success'                              'true'
REC=$(echo "$LAST_RESPONSE" | jq -r '.recommendation' | tr '[:upper:]' '[:lower:]')
TAGS=$(echo "$LAST_RESPONSE" | jq -r '[.tags[] | ascii_downcase] | join(",")')
if [[ "$REC" == *"vegan"* || "$REC" == *"plant"* || "$TAGS" == *"vegan"* ]]; then
  warn_check "T26" "vegan referenced" "true"
else
  warn_check "T26" "vegan referenced" "false" "rec doesn't mention vegan"
fi
check "T26" "donde_match >= 60"             '.donde_match >= 60'                    'true'

# ─── T27: Dietary: gluten-free ──────────────────────────────────────────────
test_banner "T27" "Dietary keyword: gluten-free"
api_call '{"special_request":"gluten free dining","occasion":"Family Dinner","neighborhood":"Anywhere","price_level":"Any"}'

check "T27" "success"                       '.success'                              'true'
REC=$(echo "$LAST_RESPONSE" | jq -r '.recommendation' | tr '[:upper:]' '[:lower:]')
TAGS=$(echo "$LAST_RESPONSE" | jq -r '[.tags[] | ascii_downcase] | join(",")')
if [[ "$REC" == *"gluten"* || "$TAGS" == *"gluten"* ]]; then
  warn_check "T27" "gluten-free referenced" "true"
else
  warn_check "T27" "gluten-free referenced" "false"
fi
check "T27" "family_friendly >= 4"          '.scores.family_friendly_score >= 4'    'true'

# ─── T28: Tag: BYOB ─────────────────────────────────────────────────────────
test_banner "T28" "Tag keyword: BYOB"
api_call '{"special_request":"byob restaurant","occasion":"Group Hangout","neighborhood":"Anywhere","price_level":"$"}'

check "T28" "success"                       '.success'                              'true'
TAGS=$(echo "$LAST_RESPONSE" | jq -r '[.tags[] | ascii_downcase] | join(",")')
if [[ "$TAGS" == *"byob"* ]]; then
  warn_check "T28" "BYOB tag present" "true" "tags=$TAGS"
else
  warn_check "T28" "BYOB tag present" "false" "tags=$TAGS"
fi
check "T28" "group_friendly >= 4"           '.scores.group_friendly_score >= 4'     'true'

# ─── T29: Multiple tags: rooftop + cocktails ────────────────────────────────
test_banner "T29" "Multiple tag keywords: rooftop + craft cocktails"
api_call '{"special_request":"rooftop bar with craft cocktails","occasion":"Date Night","neighborhood":"River North","price_level":"$$$"}'

check "T29" "success"                       '.success'                              'true'
TAGS=$(echo "$LAST_RESPONSE" | jq -r '[.tags[] | ascii_downcase] | join(",")')
if [[ "$TAGS" == *"rooftop"* || "$TAGS" == *"cocktail"* || "$TAGS" == *"scenic"* ]]; then
  warn_check "T29" "rooftop/cocktail tags" "true" "tags=$TAGS"
else
  warn_check "T29" "rooftop/cocktail tags" "false" "tags=$TAGS"
fi
check "T29" "romantic >= 5"                 '.scores.romantic_rating >= 5'          'true'
check "T29" "date_friendly >= 5"            '.scores.date_friendly_score >= 5'      'true'

# ─── T30: Feature: outdoor + pet ────────────────────────────────────────────
test_banner "T30" "Feature keywords: outdoor + pet friendly"
api_call '{"special_request":"outdoor dining pet friendly","occasion":"Chill Hangout","neighborhood":"Anywhere","price_level":"$$"}'

check "T30" "success"                       '.success'                              'true'
OUTDOOR=$(echo "$LAST_RESPONSE" | jq '.restaurant.outdoor_seating')
PET=$(echo "$LAST_RESPONSE" | jq '.restaurant.pet_friendly')
warn_check "T30" "outdoor_seating is true" "$([ "$OUTDOOR" = "true" ] && echo true || echo false)" "got: $OUTDOOR"
warn_check "T30" "pet_friendly is true"    "$([ "$PET" = "true" ] && echo true || echo false)"    "got: $PET"
check "T30" "group_friendly >= 4"           '.scores.group_friendly_score >= 4'     'true'

###############################################################################
# PHASE 4: ADVANCED FEATURES (T31-T40)
###############################################################################
phase_banner "4" "Advanced Features (T31-T40)"

# ─── T31: Cache hit ─────────────────────────────────────────────────────────
test_banner "T31" "Cache hit — identical requests return same result"
CACHE_BODY='{"special_request":"pizza","occasion":"Chill Hangout","neighborhood":"Wicker Park","price_level":"$$"}'

START1=$(date +%s%N 2>/dev/null || echo 0)
api_call "$CACHE_BODY"
END1=$(date +%s%N 2>/dev/null || echo 0)
FIRST_ID=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.id')
FIRST_NAME=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.name')
check "T31" "first call success"            '.success'                              'true'

sleep 2

START2=$(date +%s%N 2>/dev/null || echo 0)
api_call "$CACHE_BODY"
END2=$(date +%s%N 2>/dev/null || echo 0)
SECOND_ID=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.id')
check "T31" "second call success"           '.success'                              'true'

if [[ "$FIRST_ID" == "$SECOND_ID" ]]; then
  warn_check "T31" "cache hit same restaurant" "true" "$FIRST_NAME"
else
  warn_check "T31" "cache hit same restaurant" "false" "IDs differ"
fi

# ─── T32: Cache bypass ──────────────────────────────────────────────────────
test_banner "T32" "Cache bypass — exclude array forces fresh query"
api_call '{"special_request":"pizza","occasion":"Chill Hangout","neighborhood":"Wicker Park","price_level":"$$","exclude":["00000000-0000-0000-0000-000000000001"]}'

check        "T32" "success"                '.success'                              'true'
check        "T32" "donde_match >= 60"      '.donde_match >= 60'                    'true'
check_exists "T32" "restaurant.id"          '.restaurant.id'

# ─── T33: Try Another (exclude 1) ───────────────────────────────────────────
test_banner "T33" "Try Another — exclude 1 restaurant"
api_call '{"occasion":"Date Night","neighborhood":"West Loop","price_level":"$$$"}'
T33_FIRST_ID=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.id')
T33_FIRST_NAME=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.name')
check "T33" "first call success"            '.success'                              'true'

api_call "{\"occasion\":\"Date Night\",\"neighborhood\":\"West Loop\",\"price_level\":\"\$\$\$\",\"exclude\":[\"$T33_FIRST_ID\"]}"
T33_SECOND_ID=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.id')
T33_SECOND_NAME=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.name')
check "T33" "second call success"           '.success'                              'true'

if [[ "$T33_FIRST_ID" != "$T33_SECOND_ID" ]]; then
  echo -e "  ${GREEN}PASS${NC} [T33] different restaurant ($T33_SECOND_NAME != $T33_FIRST_NAME)"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T33|different restaurant\n"
else
  echo -e "  ${RED}FAIL${NC} [T33] same restaurant despite exclude"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T33|same restaurant despite exclude\n"
fi

# ─── T34: Try Another (exclude 3 chained) ───────────────────────────────────
test_banner "T34" "Try Another — exclude 3 (chained)"
EXCLUDE_IDS=()

api_call '{"occasion":"Group Hangout","neighborhood":"Anywhere","price_level":"$$"}'
check "T34" "call 1 success"                '.success'                              'true'
ID1=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.id')
EXCLUDE_IDS+=("$ID1")
sleep 1

api_call "{\"occasion\":\"Group Hangout\",\"neighborhood\":\"Anywhere\",\"price_level\":\"\$\$\",\"exclude\":[\"$ID1\"]}"
check "T34" "call 2 success"                '.success'                              'true'
ID2=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.id')
EXCLUDE_IDS+=("$ID2")
sleep 1

api_call "{\"occasion\":\"Group Hangout\",\"neighborhood\":\"Anywhere\",\"price_level\":\"\$\$\",\"exclude\":[\"$ID1\",\"$ID2\"]}"
check "T34" "call 3 success"                '.success'                              'true'
ID3=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.id')
EXCLUDE_IDS+=("$ID3")
sleep 1

api_call "{\"occasion\":\"Group Hangout\",\"neighborhood\":\"Anywhere\",\"price_level\":\"\$\$\",\"exclude\":[\"$ID1\",\"$ID2\",\"$ID3\"]}"
check "T34" "call 4 success"                '.success'                              'true'
ID4=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.id')

UNIQUE_COUNT=$(echo "$ID1 $ID2 $ID3 $ID4" | tr ' ' '\n' | sort -u | wc -l | tr -d ' ')
if [[ "$UNIQUE_COUNT" == "4" ]]; then
  echo -e "  ${GREEN}PASS${NC} [T34] all 4 restaurants unique"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T34|4 unique restaurants\n"
else
  echo -e "  ${RED}FAIL${NC} [T34] expected 4 unique, got $UNIQUE_COUNT"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T34|unique count|got=$UNIQUE_COUNT\n"
fi

# ─── T35: Rejection pattern analysis ────────────────────────────────────────
test_banner "T35" "Rejection pattern — exclude 2+ same-query restaurants"
api_call '{"special_request":"italian food","occasion":"Date Night","neighborhood":"Anywhere","price_level":"$$$"}'
R1_ID=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.id')
check "T35" "call 1 success"                '.success'                              'true'

api_call "{\"special_request\":\"italian food\",\"occasion\":\"Date Night\",\"neighborhood\":\"Anywhere\",\"price_level\":\"\$\$\$\",\"exclude\":[\"$R1_ID\"]}"
R2_ID=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.id')
check "T35" "call 2 success"                '.success'                              'true'

api_call "{\"special_request\":\"italian food\",\"occasion\":\"Date Night\",\"neighborhood\":\"Anywhere\",\"price_level\":\"\$\$\$\",\"exclude\":[\"$R1_ID\",\"$R2_ID\"]}"
R3_ID=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.id')
check "T35" "call 3 success"                '.success'                              'true'

if [[ "$R3_ID" != "$R1_ID" && "$R3_ID" != "$R2_ID" ]]; then
  echo -e "  ${GREEN}PASS${NC} [T35] 3rd result different from both excluded"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T35|3rd different\n"
else
  echo -e "  ${RED}FAIL${NC} [T35] 3rd result matches an excluded ID"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T35|3rd matches excluded\n"
fi

# ─── T36: Late night time context ───────────────────────────────────────────
test_banner "T36" "Time-of-day: late night craving"
api_call '{"special_request":"late night food craving","occasion":"Adventure","neighborhood":"Wicker Park","price_level":"$"}'

check "T36" "success"                       '.success'                              'true'
check "T36" "donde_match >= 60"             '.donde_match >= 60'                    'true'
TAGS=$(echo "$LAST_RESPONSE" | jq -r '[.tags[] | ascii_downcase] | join(",")')
REC=$(echo "$LAST_RESPONSE" | jq -r '.recommendation' | tr '[:upper:]' '[:lower:]')
if [[ "$TAGS" == *"late"* || "$REC" == *"late"* || "$REC" == *"night"* ]]; then
  warn_check "T36" "late-night context detected" "true"
else
  warn_check "T36" "late-night context detected" "false" "may depend on Chicago time"
fi

# ─── T37: Brunch time context ───────────────────────────────────────────────
test_banner "T37" "Time-of-day: brunch"
api_call '{"special_request":"weekend brunch","occasion":"Chill Hangout","neighborhood":"Logan Square","price_level":"$$"}'

check "T37" "success"                       '.success'                              'true'
CUISINE=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
TAGS=$(echo "$LAST_RESPONSE" | jq -r '[.tags[] | ascii_downcase] | join(",")')
REC=$(echo "$LAST_RESPONSE" | jq -r '.recommendation' | tr '[:upper:]' '[:lower:]')
if [[ "$CUISINE" == *"brunch"* || "$TAGS" == *"brunch"* || "$REC" == *"brunch"* ]]; then
  warn_check "T37" "brunch context in output" "true"
else
  warn_check "T37" "brunch context in output" "false"
fi
check "T37" "neighborhood Logan Square"     '.restaurant.neighborhood_name'         'Logan Square'

# ─── T38: Google live data ──────────────────────────────────────────────────
test_banner "T38" "Google live data — rating, reviews, sentiment"
api_call '{"special_request":"best rated restaurant","occasion":"Special Occasion","neighborhood":"River North","price_level":"$$$$"}'

check "T38" "success"                       '.success'                              'true'

GRATING=$(echo "$LAST_RESPONSE" | jq '.restaurant.google_rating')
if [[ "$GRATING" != "null" ]]; then
  check "T38" "google_rating 1-5" '.restaurant.google_rating >= 1 and .restaurant.google_rating <= 5' 'true'
else
  warn_check "T38" "google_rating present" "false" "null — Google API may be down"
fi

GREVIEWCOUNT=$(echo "$LAST_RESPONSE" | jq '.restaurant.google_review_count')
if [[ "$GREVIEWCOUNT" != "null" ]]; then
  check "T38" "review_count >= 0" '.restaurant.google_review_count >= 0' 'true'
else
  warn_check "T38" "review_count present" "false" "null"
fi

SENT=$(echo "$LAST_RESPONSE" | jq '.restaurant.sentiment_score')
if [[ "$SENT" != "null" ]]; then
  check "T38" "sentiment_score is number" '.restaurant.sentiment_score | type' 'number'
else
  warn_check "T38" "sentiment_score present" "false" "null"
fi

check_exists "T38" "google_place_id"        '.restaurant.google_place_id'

# ─── T39: Contact info ──────────────────────────────────────────────────────
test_banner "T39" "Contact info — phone and website (live fetch)"
api_call '{"special_request":"popular restaurant","occasion":"Any","neighborhood":"River North","price_level":"$$$"}'

check "T39" "success"                       '.success'                              'true'
PHONE=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.phone')
WEBSITE=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.website')
if [[ "$PHONE" != "null" && -n "$PHONE" ]]; then
  warn_check "T39" "phone present" "true" "$PHONE"
else
  warn_check "T39" "phone present" "false" "null or empty"
fi
if [[ "$WEBSITE" != "null" && -n "$WEBSITE" ]]; then
  warn_check "T39" "website present" "true"
else
  warn_check "T39" "website present" "false" "null or empty"
fi

# ─── T40: Diversity over multiple calls ─────────────────────────────────────
test_banner "T40" "Diversity — 6 calls should show cuisine variety"
CUISINES=()
for i in $(seq 1 6); do
  # Use unique special_request each time to avoid cache
  api_call "{\"special_request\":\"surprise me option $i\",\"occasion\":\"Any\",\"neighborhood\":\"Anywhere\",\"price_level\":\"Any\"}"
  C=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // "unknown"')
  CUISINES+=("$C")
  echo "  [info] Call $i: $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name') ($C)"
  sleep 1
done

UNIQUE_CUISINES=$(printf '%s\n' "${CUISINES[@]}" | sort -u | wc -l | tr -d ' ')
if [[ $UNIQUE_CUISINES -ge 2 ]]; then
  echo -e "  ${GREEN}PASS${NC} [T40] cuisine diversity: $UNIQUE_CUISINES unique in 6 calls"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T40|cuisine diversity\n"
else
  echo -e "  ${RED}FAIL${NC} [T40] only $UNIQUE_CUISINES unique cuisine(s) in 6 calls"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T40|cuisine diversity|count=$UNIQUE_CUISINES\n"
fi

###############################################################################
# PHASE 5: EDGE CASES & NEGATIVE TESTS (T41-T50)
###############################################################################
phase_banner "5" "Edge Cases & Negative Tests (T41-T50)"

# ─── T41: Invalid occasion ──────────────────────────────────────────────────
test_banner "T41" "Invalid occasion — 'Midnight Rave'"
api_call '{"occasion":"Midnight Rave","neighborhood":"Anywhere","price_level":"Any"}'

if [[ "$HTTP_CODE" == "200" ]]; then
  echo -e "  ${GREEN}PASS${NC} [T41] HTTP 200 (graceful handling)"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T41|HTTP 200\n"
  check "T41" "has success flag" '.success | type' 'boolean'
else
  echo -e "  ${YELLOW}WARN${NC} [T41] HTTP $HTTP_CODE"
  ((SKIP_COUNT++)); TEST_LOG+="WARN|T41|HTTP $HTTP_CODE\n"
  check_exists "T41" "some response" '.'
fi

# ─── T42: Invalid neighborhood ──────────────────────────────────────────────
test_banner "T42" "Invalid neighborhood — 'Narnia'"
api_call '{"occasion":"Any","neighborhood":"Narnia","price_level":"Any"}'

if [[ "$HTTP_CODE" == "200" ]]; then
  echo -e "  ${GREEN}PASS${NC} [T42] HTTP 200"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T42|HTTP 200\n"
  SUCCESS=$(echo "$LAST_RESPONSE" | jq '.success')
  echo "  [info] success=$SUCCESS (false=no results expected)"
  check_exists "T42" "has recommendation" '.recommendation'
else
  echo -e "  ${YELLOW}WARN${NC} [T42] HTTP $HTTP_CODE"
  ((SKIP_COUNT++)); TEST_LOG+="WARN|T42|HTTP $HTTP_CODE\n"
fi

# ─── T43: Invalid price level ───────────────────────────────────────────────
test_banner "T43" "Invalid price level — '\$\$\$\$\$'"
api_call '{"occasion":"Any","neighborhood":"Anywhere","price_level":"$$$$$"}'

if [[ "$HTTP_CODE" == "200" ]]; then
  echo -e "  ${GREEN}PASS${NC} [T43] HTTP 200 (graceful)"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T43|HTTP 200\n"
  check_exists "T43" "has recommendation" '.recommendation'
else
  echo -e "  ${YELLOW}WARN${NC} [T43] HTTP $HTTP_CODE"
  ((SKIP_COUNT++)); TEST_LOG+="WARN|T43|HTTP $HTTP_CODE\n"
fi

# ─── T44: Empty special_request ─────────────────────────────────────────────
test_banner "T44" "Empty special_request string"
api_call '{"special_request":"","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}'

check        "T44" "success"                '.success'                              'true'
check        "T44" "donde_match >= 60"      '.donde_match >= 60'                    'true'
check_exists "T44" "restaurant"             '.restaurant.name'

# ─── T45: Very long special_request ─────────────────────────────────────────
test_banner "T45" "Very long special_request — 500+ chars"
LONG_REQ="I want a restaurant that serves amazing Italian cuisine with homemade pasta and a great wine selection and outdoor seating and live jazz music on Friday nights and also has a romantic atmosphere with candles and flowers on the tables and the waiter should be very knowledgeable about the menu and the chef should have been trained in Italy and the restaurant should be in a quiet neighborhood with easy parking and the prices should be reasonable for the quality and I also want dessert recommendations and maybe they have a tasting menu option"
api_call "{\"special_request\":\"$LONG_REQ\",\"occasion\":\"Date Night\",\"neighborhood\":\"Anywhere\",\"price_level\":\"\$\$\$\"}"

check "T45" "success flag exists"           '.success | type'                       'boolean'
check_exists "T45" "has recommendation"     '.recommendation'
if [[ "$(echo "$LAST_RESPONSE" | jq '.success')" == "true" ]]; then
  check "T45" "donde_match >= 60"           '.donde_match >= 60'                    'true'
fi
echo "  [info] Handled ${#LONG_REQ}-char request"

# ─── T46: Malformed JSON ────────────────────────────────────────────────────
test_banner "T46" "Malformed JSON body"
LAST_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API" \
  -H "Content-Type: application/json" \
  -d '{invalid json here}' \
  --max-time 30 2>/dev/null)
HTTP_CODE=$(echo "$LAST_RESPONSE" | tail -n1)
LAST_RESPONSE=$(echo "$LAST_RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" == "400" || "$HTTP_CODE" == "500" || "$HTTP_CODE" == "200" ]]; then
  echo -e "  ${GREEN}PASS${NC} [T46] responded HTTP $HTTP_CODE (no crash)"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T46|HTTP $HTTP_CODE\n"
else
  echo -e "  ${RED}FAIL${NC} [T46] unexpected HTTP $HTTP_CODE"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T46|HTTP $HTTP_CODE\n"
fi
if [[ -n "$LAST_RESPONSE" ]]; then
  echo -e "  ${GREEN}PASS${NC} [T46] has response body"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T46|has response body\n"
else
  echo -e "  ${RED}FAIL${NC} [T46] empty response body"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T46|empty body\n"
fi

# ─── T47: Wrong HTTP method ─────────────────────────────────────────────────
test_banner "T47" "Wrong HTTP method — GET instead of POST"
api_call_method "GET"

if [[ -n "$LAST_RESPONSE" || -n "$HTTP_CODE" ]]; then
  echo -e "  ${GREEN}PASS${NC} [T47] API responded (HTTP $HTTP_CODE)"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T47|responded HTTP $HTTP_CODE\n"
else
  echo -e "  ${RED}FAIL${NC} [T47] no response"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T47|no response\n"
fi

# ─── T48: Large exclude array ───────────────────────────────────────────────
test_banner "T48" "Large exclude array — 10 properly formatted UUIDs"
UUIDS=""
for i in $(seq 1 10); do
  # Generate proper UUID v4 format using /proc/sys/kernel/random/uuid or fallback
  UUID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || printf '%08x-%04x-4%03x-%04x-%012x' $((RANDOM * RANDOM)) $((RANDOM)) $((RANDOM % 4096)) $(( (RANDOM % 16384) + 32768 )) $((RANDOM * RANDOM)))
  if [[ -n "$UUIDS" ]]; then UUIDS="$UUIDS,"; fi
  UUIDS="$UUIDS\"$UUID\""
done
api_call "{\"occasion\":\"Any\",\"neighborhood\":\"Anywhere\",\"price_level\":\"Any\",\"exclude\":[$UUIDS]}"

check        "T48" "success"                '.success'                              'true'
check        "T48" "donde_match >= 60"      '.donde_match >= 60'                    'true'
check_exists "T48" "restaurant"             '.restaurant.name'
echo "  [info] Handled 10-element exclude array with proper UUIDs"

# ─── T49: SQL/XSS injection ─────────────────────────────────────────────────
test_banner "T49" "Special characters — SQL/XSS injection attempt"
api_call '{"special_request":"restaurant with 100% organic; SELECT * FROM restaurants; <script>alert(1)</script>","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}'

check "T49" "success flag exists"           '.success | type'                       'boolean'
check_exists "T49" "has recommendation"     '.recommendation'
REC=$(echo "$LAST_RESPONSE" | jq -r '.recommendation // ""')
if [[ "$REC" != *"SELECT"* && "$REC" != *"<script>"* ]]; then
  echo -e "  ${GREEN}PASS${NC} [T49] no injection reflected in response"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T49|no injection\n"
else
  echo -e "  ${RED}FAIL${NC} [T49] injection reflected in response!"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T49|injection reflected\n"
fi

# ─── T50: Rapid sequential calls ────────────────────────────────────────────
test_banner "T50" "Rapid sequential calls — 5 calls, 0.5s apart"
RAPID_SUCCESS=0
for i in $(seq 1 5); do
  api_call "{\"special_request\":\"rapid test $i\",\"occasion\":\"Any\",\"neighborhood\":\"Anywhere\",\"price_level\":\"Any\"}"
  S=$(echo "$LAST_RESPONSE" | jq '.success')
  if [[ "$S" == "true" ]]; then ((RAPID_SUCCESS++)); fi
  echo "  [info] Call $i: success=$S, restaurant=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.name // "none"')"
  sleep 0.5
done

if [[ $RAPID_SUCCESS -ge 4 ]]; then
  echo -e "  ${GREEN}PASS${NC} [T50] $RAPID_SUCCESS/5 calls succeeded (stability OK)"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T50|stability $RAPID_SUCCESS/5\n"
else
  echo -e "  ${RED}FAIL${NC} [T50] only $RAPID_SUCCESS/5 calls succeeded"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T50|stability|success=$RAPID_SUCCESS\n"
fi

# ─── T51: Ambiance intent — Bustling and Vibrant ──────────────────────────────
test_banner "T51" "Ambiance intent: bustling and vibrant"
api_call '{"special_request":"Bustling and Vibrant","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}'

check "T51" "success" '.success' 'true'
check "T51" "donde_match >= 60" '.donde_match >= 60' 'true'
check_exists "T51" "restaurant name" '.restaurant.name'

# Soft check: noise level should indicate a bustling place (Moderate or Loud)
NOISE=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.noise_level')
if [[ "$NOISE" == "Moderate" || "$NOISE" == "Loud" ]]; then
  warn_check "T51" "noise matches bustling" "true" "got: $NOISE"
else
  warn_check "T51" "noise matches bustling" "false" "got: $NOISE — expected Moderate or Loud"
fi

# Soft check: recommendation or tags should reference vibe/energy
REC=$(echo "$LAST_RESPONSE" | jq -r '.recommendation' | tr '[:upper:]' '[:lower:]')
TAGS=$(echo "$LAST_RESPONSE" | jq -r '[.tags[]? | ascii_downcase] | join(",")')
if [[ "$REC" == *"bustl"* || "$REC" == *"vibrant"* || "$REC" == *"lively"* || "$REC" == *"energe"* || "$REC" == *"energy"* || "$TAGS" == *"lively"* || "$TAGS" == *"trendy"* ]]; then
  warn_check "T51" "vibe referenced in output" "true"
else
  warn_check "T51" "vibe referenced in output" "false" "no vibe words in rec or tags"
fi

echo "  [info] Restaurant: $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name'), Noise: $NOISE"
echo "  [info] Neighborhood: $(echo "$LAST_RESPONSE" | jq -r '.restaurant.neighborhood_name')"

# ─── T52: Address-neighborhood geographic consistency ─────────────────────────
test_banner "T52" "Address-neighborhood geographic consistency"
api_call '{"special_request":"good dinner","occasion":"Date Night","neighborhood":"Logan Square","price_level":"$$"}'

check "T52" "success" '.success' 'true'
check "T52" "neighborhood Logan Square" '.restaurant.neighborhood_name' 'Logan Square'

# Hard check: address should contain "Chicago"
ADDRESS=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.address')
if [[ "$ADDRESS" == *"Chicago"* ]]; then
  echo -e "  ${GREEN}PASS${NC} [T52] address contains Chicago"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T52|address contains Chicago\n"
else
  echo -e "  ${RED}FAIL${NC} [T52] address missing Chicago (got: $ADDRESS)"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T52|address missing Chicago|got=$ADDRESS\n"
fi

# Soft check: ZIP code consistent with Logan Square area
ADDR_ZIP=$(echo "$ADDRESS" | grep -oP '\b\d{5}\b' | head -1)
if [[ "$ADDR_ZIP" == "60647" || "$ADDR_ZIP" == "60622" || "$ADDR_ZIP" == "60642" ]]; then
  warn_check "T52" "ZIP consistent with Logan Square area" "true" "zip=$ADDR_ZIP"
else
  warn_check "T52" "ZIP consistent with Logan Square area" "false" "zip=$ADDR_ZIP"
fi

echo "  [info] Address: $ADDRESS"

# ─── T53: Ambiance synonyms — energetic fun loud ─────────────────────────────
test_banner "T53" "Ambiance synonyms: energetic fun loud atmosphere"
api_call '{"special_request":"energetic fun loud atmosphere","occasion":"Group Hangout","neighborhood":"Anywhere","price_level":"$$"}'

check "T53" "success" '.success' 'true'
check "T53" "donde_match >= 60" '.donde_match >= 60' 'true'
check "T53" "group_friendly >= 4" '.scores.group_friendly_score >= 4' 'true'

NOISE=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.noise_level')
if [[ "$NOISE" == "Moderate" || "$NOISE" == "Loud" ]]; then
  warn_check "T53" "noise matches energetic" "true" "got: $NOISE"
else
  warn_check "T53" "noise matches energetic" "false" "got: $NOISE"
fi

echo "  [info] Restaurant: $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name'), Noise: $NOISE"

# ─── T54: Recommendation quality — voice, conciseness, anti-slop ─────────────
test_banner "T54" "Recommendation quality: voice, conciseness, anti-slop"
api_call '{"special_request":"cozy Italian date spot with good pasta","occasion":"Date Night","neighborhood":"Anywhere","price_level":"$$"}'

check "T54" "success" '.success' 'true'
check_exists "T54" "recommendation exists" '.recommendation'
check_exists "T54" "insider_tip exists" '.insider_tip'

# Extract recommendation text
REC_TEXT=$(echo "$LAST_RESPONSE" | jq -r '.recommendation // ""')
TIP_TEXT=$(echo "$LAST_RESPONSE" | jq -r '.insider_tip // ""')

# Hard check: recommendation word count (target 50-100, allow some flexibility)
WORD_COUNT=$(echo "$REC_TEXT" | wc -w | tr -d ' ')
if [[ $WORD_COUNT -ge 30 && $WORD_COUNT -le 120 ]]; then
  echo -e "  ${GREEN}PASS${NC} [T54] recommendation length in range ($WORD_COUNT words)"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T54|rec length $WORD_COUNT words\n"
else
  echo -e "  ${RED}FAIL${NC} [T54] recommendation length out of range ($WORD_COUNT words, target 30-120)"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T54|rec length|words=$WORD_COUNT\n"
fi

# Soft check: AI slop detection — flag common generic AI phrases
REC_LOWER=$(echo "$REC_TEXT" | tr '[:upper:]' '[:lower:]')
SLOP_COUNT=0
SLOP_FOUND=""
for PHRASE in "culinary journey" "taste buds" "tantalizing" "mouthwatering" "delectable" "exquisite" "unforgettable" "unparalleled" "nestled" "from the moment you" "elevate your" "dining experience" "truly remarkable"; do
  if [[ "$REC_LOWER" == *"$PHRASE"* ]]; then
    ((SLOP_COUNT++))
    SLOP_FOUND+="'$PHRASE' "
  fi
done

if [[ $SLOP_COUNT -eq 0 ]]; then
  warn_check "T54" "no AI slop detected" "true"
elif [[ $SLOP_COUNT -le 1 ]]; then
  warn_check "T54" "minor AI slop" "false" "found: $SLOP_FOUND"
else
  warn_check "T54" "AI slop detected" "false" "found ${SLOP_COUNT}: $SLOP_FOUND"
fi

# Soft check: uses "we" pronoun (Donde voice)
if [[ "$REC_LOWER" == *" we "* || "$REC_LOWER" == *"we'"* || "$REC_LOWER" == *"we'd"* || "$REC_LOWER" == "we "* ]]; then
  warn_check "T54" "uses Donde 'we' voice" "true"
else
  warn_check "T54" "uses Donde 'we' voice" "false" "no 'we' pronoun found"
fi

# Soft check: insider tip is concise (under 40 words)
TIP_WORDS=$(echo "$TIP_TEXT" | wc -w | tr -d ' ')
if [[ $TIP_WORDS -le 40 && $TIP_WORDS -ge 3 ]]; then
  warn_check "T54" "insider tip concise" "true" "$TIP_WORDS words"
else
  warn_check "T54" "insider tip concise" "false" "$TIP_WORDS words (target: 3-40)"
fi

echo "  [info] Rec ($WORD_COUNT words): ${REC_TEXT:0:120}..."
echo "  [info] Tip ($TIP_WORDS words): $TIP_TEXT"

# ─── T55: Cuisine intent — deep dish pizza should return Italian/pizza ────────
test_banner "T55" "Cuisine intent: deep dish pizza"
api_call '{"special_request":"local favorite deep dish pizza","occasion":"Chill Hangout","neighborhood":"Anywhere","price_level":"$$"}'
check "T55" "success" '.success' 'true'
check_exists "T55" "restaurant returned" '.restaurant.name'
CUISINE_55=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
if [[ "$CUISINE_55" == *"italian"* || "$CUISINE_55" == *"pizza"* || "$CUISINE_55" == *"american"* ]]; then
  warn_check "T55" "deep dish maps to Italian/American" "true" "got: $CUISINE_55"
else
  warn_check "T55" "deep dish maps to Italian/American" "false" "got: $CUISINE_55"
fi
echo "  [info] Returned: $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name // "N/A"') ($CUISINE_55)"

# ─── T56: Cuisine intent — mole/Oaxacan should return Mexican ────────────────
test_banner "T56" "Cuisine intent: authentic mole negro (Oaxacan)"
api_call '{"special_request":"authentic mole negro","occasion":"Adventure","neighborhood":"Anywhere","price_level":"$$"}'
check "T56" "success" '.success' 'true'
check_exists "T56" "restaurant returned" '.restaurant.name'
CUISINE_56=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
if [[ "$CUISINE_56" == *"mexican"* ]]; then
  warn_check "T56" "mole negro maps to Mexican" "true" "got: $CUISINE_56"
else
  warn_check "T56" "mole negro maps to Mexican" "false" "got: $CUISINE_56"
fi
echo "  [info] Returned: $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name // "N/A"') ($CUISINE_56)"

# ─── T57: Compound intent — sushi + outdoor patio ────────────────────────────
test_banner "T57" "Compound intent: sushi with outdoor patio"
api_call '{"special_request":"sushi with outdoor patio","occasion":"Date Night","neighborhood":"Anywhere","price_level":"$$$"}'
check "T57" "success" '.success' 'true'
check_exists "T57" "restaurant returned" '.restaurant.name'
CUISINE_57=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
OUTDOOR_57=$(echo "$LAST_RESPONSE" | jq '.restaurant.outdoor_seating')
if [[ "$CUISINE_57" == *"japanese"* || "$CUISINE_57" == *"sushi"* ]]; then
  warn_check "T57" "sushi intent matched" "true" "got: $CUISINE_57"
else
  warn_check "T57" "sushi intent matched" "false" "got: $CUISINE_57"
fi
if [[ "$OUTDOOR_57" == "true" ]]; then
  warn_check "T57" "outdoor_seating matched" "true"
else
  warn_check "T57" "outdoor_seating matched" "false" "got: $OUTDOOR_57"
fi
echo "  [info] Returned: $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name // "N/A"') ($CUISINE_57, outdoor=$OUTDOOR_57)"

# ─── T58: Graceful degradation — obscure cuisine not in DB ───────────────────
test_banner "T58" "Graceful degradation: obscure cuisine not in DB"
api_call '{"special_request":"Uyghur hand-pulled noodles","occasion":"Adventure","neighborhood":"Anywhere","price_level":"$"}'
check "T58" "success" '.success' 'true'
check_exists "T58" "still returns a restaurant" '.restaurant.name'
MATCH_58=$(echo "$LAST_RESPONSE" | jq '.donde_match // 0')
if [[ "$MATCH_58" -ge 60 ]]; then
  echo -e "  ${GREEN}PASS${NC} [T58] donde_match >= 60 (got: $MATCH_58)"
  ((PASS_COUNT++)); TEST_LOG+="PASS|T58|donde_match=$MATCH_58\n"
else
  echo -e "  ${RED}FAIL${NC} [T58] donde_match >= 60 (got: $MATCH_58)"
  ((FAIL_COUNT++)); TEST_LOG+="FAIL|T58|donde_match=$MATCH_58\n"
fi
echo "  [info] Returned: $(echo "$LAST_RESPONSE" | jq -r '.restaurant.name // "N/A"') (match: $MATCH_58%)"

# ─── T59: Craft beer intent — should return brewery/beer-focused spot ─────────
test_banner "T59" "Craft beer intent: great craft beer"
api_call '{"special_request":"great craft beer","occasion":"Chill Hangout","neighborhood":"Anywhere","price_level":"$$"}'
check "T59" "success" '.success' 'true'
check_exists "T59" "restaurant returned" '.restaurant.name'
CUISINE_59=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
REC_59=$(echo "$LAST_RESPONSE" | jq -r '.recommendation // ""' | tr '[:upper:]' '[:lower:]')
NAME_59=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.name // "N/A"')
# Check if cuisine is beer-related or if recommendation mentions beer
if [[ "$CUISINE_59" == *"brewery"* || "$CUISINE_59" == *"beer"* ]]; then
  warn_check "T59" "craft beer maps to Brewery/Beer Bar" "true" "got: $CUISINE_59"
elif [[ "$REC_59" == *"beer"* || "$REC_59" == *"brew"* || "$REC_59" == *"tap"* ]]; then
  warn_check "T59" "craft beer maps to Brewery/Beer Bar" "true" "rec mentions beer: $NAME_59"
else
  warn_check "T59" "craft beer maps to Brewery/Beer Bar" "false" "got: $NAME_59 ($CUISINE_59)"
fi
echo "  [info] Returned: $NAME_59 ($CUISINE_59)"

###############################################################################
# T60-T65: New cuisine coverage + neighborhood relaxation
###############################################################################

test_banner "T60" "Cuisine intent: pierogi should return Polish"
api_call '{"special_request":"pierogi","occasion":"Adventure","neighborhood":"Anywhere","price_level":"$"}'
check "T60" "success" '.success' 'true'
check_exists "T60" "restaurant returned" '.restaurant.name'
CUISINE_60=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
NAME_60=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.name // "N/A"')
if [[ "$CUISINE_60" == *"polish"* ]]; then
  warn_check "T60" "pierogi maps to Polish" "true" "got: $CUISINE_60"
else
  warn_check "T60" "pierogi maps to Polish" "false" "got: $NAME_60 ($CUISINE_60)"
fi
echo "  [info] Returned: $NAME_60 ($CUISINE_60)"

test_banner "T61" "Cuisine intent: injera should return Ethiopian"
api_call '{"special_request":"injera and doro wat","occasion":"Adventure","neighborhood":"Anywhere","price_level":"$$"}'
check "T61" "success" '.success' 'true'
check_exists "T61" "restaurant returned" '.restaurant.name'
CUISINE_61=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
NAME_61=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.name // "N/A"')
if [[ "$CUISINE_61" == *"ethiopian"* ]]; then
  warn_check "T61" "injera maps to Ethiopian" "true" "got: $CUISINE_61"
else
  warn_check "T61" "injera maps to Ethiopian" "false" "got: $NAME_61 ($CUISINE_61)"
fi
echo "  [info] Returned: $NAME_61 ($CUISINE_61)"

test_banner "T62" "Cuisine intent: smoked brisket should return BBQ"
api_call '{"special_request":"smoked brisket and ribs","occasion":"Group Hangout","neighborhood":"Anywhere","price_level":"$$"}'
check "T62" "success" '.success' 'true'
check_exists "T62" "restaurant returned" '.restaurant.name'
CUISINE_62=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
NAME_62=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.name // "N/A"')
if [[ "$CUISINE_62" == *"bbq"* || "$CUISINE_62" == *"barbecue"* ]]; then
  warn_check "T62" "brisket maps to BBQ" "true" "got: $CUISINE_62"
else
  warn_check "T62" "brisket maps to BBQ" "false" "got: $NAME_62 ($CUISINE_62)"
fi
echo "  [info] Returned: $NAME_62 ($CUISINE_62)"

test_banner "T63" "Cuisine intent: mofongo should return Puerto Rican"
api_call '{"special_request":"mofongo","occasion":"Any","neighborhood":"Anywhere","price_level":"$$"}'
check "T63" "success" '.success' 'true'
check_exists "T63" "restaurant returned" '.restaurant.name'
CUISINE_63=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
NAME_63=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.name // "N/A"')
if [[ "$CUISINE_63" == *"puerto rican"* ]]; then
  warn_check "T63" "mofongo maps to Puerto Rican" "true" "got: $CUISINE_63"
else
  warn_check "T63" "mofongo maps to Puerto Rican" "false" "got: $NAME_63 ($CUISINE_63)"
fi
echo "  [info] Returned: $NAME_63 ($CUISINE_63)"

test_banner "T64" "Cuisine intent: shawarma should return Middle Eastern"
api_call '{"special_request":"shawarma plate","occasion":"Solo Dining","neighborhood":"Anywhere","price_level":"$"}'
check "T64" "success" '.success' 'true'
check_exists "T64" "restaurant returned" '.restaurant.name'
CUISINE_64=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.cuisine_type // ""' | tr '[:upper:]' '[:lower:]')
NAME_64=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.name // "N/A"')
if [[ "$CUISINE_64" == *"middle eastern"* ]]; then
  warn_check "T64" "shawarma maps to Middle Eastern" "true" "got: $CUISINE_64"
else
  warn_check "T64" "shawarma maps to Middle Eastern" "false" "got: $NAME_64 ($CUISINE_64)"
fi
echo "  [info] Returned: $NAME_64 ($CUISINE_64)"

test_banner "T65" "Neighborhood relaxation: niche cuisine + specific neighborhood"
api_call '{"special_request":"Ethiopian food","occasion":"Any","neighborhood":"Little Italy","price_level":"Any"}'
check "T65" "success is boolean" '.success | type' 'boolean'
check_exists "T65" "has recommendation" '.recommendation'
NAME_65=$(echo "$LAST_RESPONSE" | jq -r '.restaurant.name // "N/A"')
SUCCESS_65=$(echo "$LAST_RESPONSE" | jq -r '.success')
echo "  [info] Returned: $NAME_65 (success=$SUCCESS_65)"

###############################################################################
# FINAL REPORT
###############################################################################
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  FINAL REPORT                                                      ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

TOTAL=$((PASS_COUNT + FAIL_COUNT + SKIP_COUNT))
HARD_TOTAL=$((PASS_COUNT + FAIL_COUNT))

echo -e "  ${GREEN}PASSED:${NC}  $PASS_COUNT"
echo -e "  ${RED}FAILED:${NC}  $FAIL_COUNT"
echo -e "  ${YELLOW}WARNED:${NC} $SKIP_COUNT"
echo "  TOTAL:   $TOTAL"
echo ""

PASS_RATE=0
if [[ $HARD_TOTAL -gt 0 ]]; then
  PASS_RATE=$(( (PASS_COUNT * 100) / HARD_TOTAL ))
fi

echo "  Hard pass rate: ${PASS_RATE}% ($PASS_COUNT / $HARD_TOTAL)"
echo ""

if [[ $FAIL_COUNT -eq 0 ]]; then
  echo -e "  ${GREEN}★ ALL HARD CHECKS PASSED ★${NC}"
elif [[ $FAIL_COUNT -le 5 ]]; then
  echo -e "  ${YELLOW}MOSTLY PASSING — review $FAIL_COUNT failure(s) above${NC}"
elif [[ $FAIL_COUNT -le 15 ]]; then
  echo -e "  ${YELLOW}MODERATE ISSUES — $FAIL_COUNT failures need attention${NC}"
else
  echo -e "  ${RED}SIGNIFICANT FAILURES — $FAIL_COUNT checks failed${NC}"
fi

echo ""
echo "============================================================"
echo "  END OF TEST SUITE — $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "============================================================"

###############################################################################
# WRITE RESULTS TO MARKDOWN FILE
###############################################################################
cat > "$REPORT_PATH" << MDEOF
# Donde API Test Results

**Date:** $(date -u '+%Y-%m-%dT%H:%M:%SZ')
**Endpoint:** $API

## Summary

| Metric | Count |
|--------|-------|
| PASSED | $PASS_COUNT |
| FAILED | $FAIL_COUNT |
| WARNED | $SKIP_COUNT |
| TOTAL  | $TOTAL |
| **Hard Pass Rate** | **${PASS_RATE}%** ($PASS_COUNT / $HARD_TOTAL) |

## Detailed Results

| Verdict | Test | Check | Details |
|---------|------|-------|---------|
$(echo -e "$TEST_LOG" | while IFS='|' read -r verdict tid cname details; do
  [[ -z "$verdict" ]] && continue
  echo "| $verdict | $tid | $cname | $details |"
done)

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
MDEOF

echo ""
echo "  Results written to: $REPORT_PATH"
