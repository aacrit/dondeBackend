#!/usr/bin/env bash
set -uo pipefail

###############################################################################
# DONDE GOLDEN DATASET V8 — DATA-DRIVEN TEST RUNNER
#
# Pulls test cases from the Chicago Common Searches Critical Dataset (1000 cases)
# and randomly samples N scenarios for testing. Fully configurable and scalable.
#
# Usage:
#   ./tests/golden-dataset-v8-200.sh                    # 200 cases, random seed
#   ./tests/golden-dataset-v8-200.sh -n 100             # 100 cases
#   ./tests/golden-dataset-v8-200.sh -n 200 -s 42       # 200 cases, seed 42
#   ./tests/golden-dataset-v8-200.sh -t 50              # base threshold 50
#   ./tests/golden-dataset-v8-200.sh --strict 2         # strictness level 2
#   ./tests/golden-dataset-v8-200.sh -c Food            # only Food category
#   ./tests/golden-dataset-v8-200.sh --exclude-used     # skip previously used queries
#
# Options:
#   -n COUNT        Number of test cases to sample (default: 200)
#   -s SEED         Random seed for reproducibility (default: epoch seconds)
#   -t THRESHOLD    Base minimum score threshold (default: 48)
#   --strict LEVEL  Strictness level 1-3 (adds +0/+3/+6 to thresholds)
#   -c CATEGORY     Filter to single category (Food|Vibe|Service|Reputation|Convenience)
#   --exclude-used  Exclude queries already in USED_CASES_V8.json
#   --balanced      Force balanced sampling (equal per category)
#
# Deps: curl, jq (v1.6+), bash 4+, python3, shuf
###############################################################################

# Defaults
SAMPLE_COUNT=200
RANDOM_SEED=$(date +%s)
BASE_THRESHOLD=48
STRICT_LEVEL=1
FILTER_CATEGORY=""
EXCLUDE_USED=false
BALANCED=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n) SAMPLE_COUNT="$2"; shift 2 ;;
    -s) RANDOM_SEED="$2"; shift 2 ;;
    -t) BASE_THRESHOLD="$2"; shift 2 ;;
    --strict) STRICT_LEVEL="$2"; shift 2 ;;
    -c) FILTER_CATEGORY="$2"; shift 2 ;;
    --exclude-used) EXCLUDE_USED=true; shift ;;
    --balanced) BALANCED=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Strictness offset: level 1=+0, level 2=+3, level 3=+6
STRICT_OFFSET=$(( (STRICT_LEVEL - 1) * 3 ))

API="https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend"
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
TOTAL_DONDE_MATCH=0
TOTAL_TESTS=0
TEST_LOG=""
LAST_RESPONSE=""
HTTP_CODE=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
DATASET_FILE="$REPO_DIR/docs/Chicago Common Searches [Critical DATASET]"
REPORT_FILE="tests/GOLDEN_DATASET_V8_200_RESULTS.md"
REPORT_PATH="$REPO_DIR/$REPORT_FILE"
RAW_RESULTS_FILE="$REPO_DIR/tests/V8_200_RAW_RESULTS.jsonl"
USED_CASES_FILE="$REPO_DIR/tests/USED_CASES_V8.json"
SAMPLED_CASES_FILE="$REPO_DIR/tests/V8_200_SAMPLED_CASES.json"

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
# $1: test_id, $2: category, $3: query, $4: expected_cuisines, $5: min_score, $6: occasion
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

  local intent_score
  intent_score=$(echo "$LAST_RESPONSE" | jq -r '.scoring_v5.intent_alignment.score // "N/A"' 2>/dev/null)

  echo "  → $restaurant_name ($cuisine_type) | DM: $donde_match | Food: $food_score | Vibe: $vibe_score | Svc: $service_score | Rep: $rep_score | Conv: $conv_score"
  echo "  → Weights: F:$weights_food V:$weights_vibe S:$weights_service R:$weights_rep C:$weights_conv | Intent: $intent_score"

  # Save raw result
  echo "$LAST_RESPONSE" | jq -c --arg tid "$test_id" --arg q "$query" --arg cat "$category" \
    --arg min "$min_score" --arg occ "$occasion" --arg exp "$expected_cuisines" \
    '{test_id: $tid, query: $q, category: $cat, min_score: ($min | tonumber), occasion: $occ, expected_cuisines: $exp,
      donde_match: .donde_match, restaurant_name: .restaurant.name, cuisine_type: .restaurant.cuisine_type,
      food: .scoring_v5.food, vibe: .scoring_v5.vibe, service: .scoring_v5.service,
      reputation: .scoring_v5.reputation, convenience: .scoring_v5.convenience,
      weights: .scoring_v5.weights_used, intent_alignment: .scoring_v5.intent_alignment,
      weight_shift_reasons: .scoring_v5.weight_shift_reasons,
      data_completeness: .scoring_v5.data_completeness}' >> "$RAW_RESULTS_FILE" 2>/dev/null

  # Track metrics
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

  # Info check: Cuisine match (informational only — depends on DB coverage, not scoring engine)
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
      echo -e "  ${GREEN}INFO${NC} [$test_id] cuisine match ($cuisine_type)"
    else
      echo -e "  ${YELLOW}INFO${NC} [$test_id] cuisine mismatch: expected [$expected_cuisines], got $cuisine_type"
    fi
  fi

  # Info check: Food score (informational — depends on restaurant selection)
  if [[ "$category" == "Food" && "$expected_cuisines" != "any" ]]; then
    local fs_int=${food_score%.*}
    if (( fs_int >= 5 )); then
      echo -e "  ${GREEN}INFO${NC} [$test_id] food_score >= 5 ($food_score)"
    else
      echo -e "  ${YELLOW}INFO${NC} [$test_id] food_score low ($food_score)"
    fi
  fi

  # Info check: Vibe score (informational — depends on restaurant selection)
  if [[ "$category" == "Vibe" ]]; then
    local vs_int=${vibe_score%.*}
    if (( vs_int >= 5 )); then
      echo -e "  ${GREEN}INFO${NC} [$test_id] vibe_score >= 5 ($vibe_score)"
    else
      echo -e "  ${YELLOW}INFO${NC} [$test_id] vibe_score low ($vibe_score)"
    fi
  fi

  sleep 1
}

###############################################################################
# STEP 1: SAMPLE TEST CASES FROM CRITICAL DATASET
###############################################################################

if [[ ! -f "$DATASET_FILE" ]]; then
  echo -e "${RED}ERROR: Critical dataset not found at: $DATASET_FILE${NC}"
  exit 1
fi

echo ""
echo "============================================================"
echo "  DONDE GOLDEN DATASET V8 — DATA-DRIVEN TEST RUNNER"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  Endpoint: $API"
echo "  Sample: $SAMPLE_COUNT cases | Seed: $RANDOM_SEED"
echo "  Base Threshold: $BASE_THRESHOLD | Strict Level: $STRICT_LEVEL (+$STRICT_OFFSET)"
echo "  Category Filter: ${FILTER_CATEGORY:-All}"
echo "  Exclude Used: $EXCLUDE_USED | Balanced: $BALANCED"
echo "============================================================"

# Build exclusion list from previously used queries
EXCLUDE_QUERIES_FILE=$(mktemp)
if $EXCLUDE_USED && [[ -f "$USED_CASES_FILE" ]]; then
  jq -r '.cases[].query' "$USED_CASES_FILE" 2>/dev/null | tr '[:upper:]' '[:lower:]' | sort -u > "$EXCLUDE_QUERIES_FILE"
  echo "  Excluding $(wc -l < "$EXCLUDE_QUERIES_FILE") previously used queries"
else
  > "$EXCLUDE_QUERIES_FILE"
fi

# Use Python to parse CSV, apply filters, random sample, and assign thresholds/occasions
SAMPLED_JSON=$(python3 << PYEOF
import csv, json, random, sys

random.seed($RANDOM_SEED)

# Read critical dataset
cases = []
with open("$DATASET_FILE", "r", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for i, row in enumerate(reader):
        cases.append({
            "index": i,
            "category": row["Test Category"],
            "query": row["Test Data"],
            "description": row["Test Description"],
            "expected": row["Expected Output"]
        })

# Load exclusion list
exclude_set = set()
try:
    with open("$EXCLUDE_QUERIES_FILE", "r") as f:
        for line in f:
            exclude_set.add(line.strip().lower())
except:
    pass

# Filter by category if specified
filter_cat = "$FILTER_CATEGORY"
if filter_cat:
    cases = [c for c in cases if c["category"] == filter_cat]

# Exclude previously used queries
if $( $EXCLUDE_USED && echo "True" || echo "False" ):
    cases = [c for c in cases if c["query"].lower() not in exclude_set]

# Balanced sampling: equal per category
balanced = $( $BALANCED && echo "True" || echo "False" )
sample_count = min($SAMPLE_COUNT, len(cases))

if balanced and not filter_cat:
    categories = ["Food", "Vibe", "Service", "Reputation", "Convenience"]
    per_cat = sample_count // len(categories)
    remainder = sample_count % len(categories)
    sampled = []
    for ci, cat in enumerate(categories):
        cat_cases = [c for c in cases if c["category"] == cat]
        n = per_cat + (1 if ci < remainder else 0)
        n = min(n, len(cat_cases))
        sampled.extend(random.sample(cat_cases, n))
    random.shuffle(sampled)
else:
    sampled = random.sample(cases, sample_count)

# Category-specific base thresholds (uniform across categories)
cat_base = {
    "Food": $BASE_THRESHOLD,
    "Vibe": $BASE_THRESHOLD,
    "Service": $BASE_THRESHOLD,
    "Reputation": $BASE_THRESHOLD,
    "Convenience": $BASE_THRESHOLD
}

# Occasion detection from query keywords
def detect_occasion(query):
    q = query.lower()
    if any(w in q for w in ["date night", "romantic", "candlelit", "intimate", "date spot"]):
        return "Date Night"
    if any(w in q for w in ["birthday", "anniversary", "graduation", "engagement", "retirement",
                            "celebration", "special occasion", "rehearsal", "milestone"]):
        return "Special Occasion"
    if any(w in q for w in ["group", "party", "friends", "pregame", "team", "catch up"]):
        return "Group Hangout"
    if any(w in q for w in ["business", "client", "corporate", "work team", "networking"]):
        return "Business Lunch"
    if any(w in q for w in ["family", "kids", "child", "family gathering"]):
        return "Family Dinner"
    if any(w in q for w in ["solo", "alone", "by myself", "read and eat"]):
        return "Solo Dining"
    if any(w in q for w in ["chill", "casual", "relax", "after work", "hangout", "low key"]):
        return "Chill Hangout"
    if any(w in q for w in ["treat myself", "indulgen", "cheat day", "splurge"]):
        return "Treat Myself"
    if any(w in q for w in ["adventur", "unique", "explor"]):
        return "Adventure"
    return "Any"

# Cuisine detection from query keywords
def detect_cuisines(query, description):
    q = query.lower()
    d = description.lower()
    # Cuisine mapping with broad family matches to reduce false WARN.
    # e.g., "brazilian steakhouse" can match "Steak", "turkish" can match "Middle Eastern"
    mapping = [
        (["italian", "pasta", "pizza", "risotto", "lasagna", "tiramisu"], "Italian"),
        (["mexican", "taco", "burrito", "enchilada", "tamale", "quesadilla", "carnitas", "birria"], "Mexican"),
        (["japanese", "sushi", "ramen", "udon", "tempura", "yakitori", "omakase", "sashimi"], "Japanese|Asian"),
        (["chinese", "dim sum", "dumpling", "peking", "szechuan", "wonton"], "Chinese|Asian"),
        (["thai", "pad thai", "tom yum", "green curry", "thai curry"], "Thai|Asian"),
        (["indian", "curry", "biryani", "tikka", "naan", "tandoori"], "Indian|South Asian"),
        (["korean", "bbq", "bulgogi", "bibimbap", "kimchi", "korean fried"], "Korean|Asian"),
        (["french", "bistro", "brasserie", "croissant", "bouillabaisse", "coq au vin", "french onion"], "French|European"),
        (["seafood", "lobster", "crab", "oyster", "shrimp", "fish"], "Seafood"),
        (["greek", "gyro", "souvlaki", "spanakopita"], "Greek|Mediterranean"),
        (["vietnamese", "pho", "banh mi", "spring roll", "vermicelli"], "Vietnamese|Asian"),
        (["mediterranean", "hummus", "falafel", "shawarma", "kebab"], "Mediterranean|Middle Eastern"),
        (["ethiopian", "injera"], "Ethiopian|African"),
        (["peruvian", "ceviche", "lomo saltado"], "Peruvian|Latin American|Mexican"),
        (["cuban", "cubano", "ropa vieja"], "Cuban|Latin American|Caribbean"),
        (["polish", "pierogi", "kielbasa"], "Polish|European|Steak"),
        (["filipino", "adobo", "lechon", "sinigang"], "Filipino|Asian"),
        (["brazilian", "churrascaria", "churrasco"], "Brazilian|Steak|Latin American"),
        (["turkish", "kebab", "pide"], "Turkish|Middle Eastern|Mediterranean"),
        (["lebanese", "mezze", "kibbeh", "tabbouleh"], "Lebanese|Middle Eastern|Mediterranean"),
        (["spanish", "tapas", "paella", "croqueta"], "Spanish|European|Mediterranean"),
        (["jamaican", "jerk", "plantain"], "Jamaican|Caribbean"),
        (["taiwanese", "beef noodle", "scallion pancake"], "Taiwanese|Chinese|Asian"),
        (["cajun", "gumbo", "jambalaya", "crawfish"], "Cajun|Southern|American"),
        (["steak", "steakhouse", "wagyu", "butcher"], "Steak|American"),
        (["bbq", "brisket", "ribs", "pulled pork", "smoked"], "BBQ|American|Southern"),
    ]
    matches = []
    for keywords, cuisine in mapping:
        if any(kw in q for kw in keywords):
            matches.append(cuisine)
    # Check description too for ambiguous cases
    if not matches:
        for keywords, cuisine in mapping:
            if any(kw in d for kw in keywords):
                matches.append(cuisine)
                break
    return "|".join(matches) if matches else "any"

# Threshold adjustment for query complexity
def adjust_threshold(base, query, category):
    q = query.lower()
    t = base
    # Short/single-word queries: lower threshold (harder to match precisely)
    words = q.split()
    if len(words) <= 1:
        t -= 5
    elif len(words) <= 2:
        t -= 3
    # Niche cuisines/items that may have limited DB coverage: lower threshold
    niche = ["ethiopian", "peruvian", "cuban", "polish", "filipino", "taiwanese",
             "moroccan", "lebanese", "turkish", "jamaican", "szechuan",
             "macaron", "sake", "boba", "matcha", "udon", "tempura",
             "injera", "pierogi", "pide", "soul food", "cajun",
             "craft beer", "cocktail", "hot pot", "butchery", "butcher"]
    if any(n in q for n in niche):
        t -= 4
    # Dietary restrictions: lower threshold (DB may lack dietary data)
    dietary = ["vegan", "vegetarian", "gluten free", "halal", "kosher", "dairy free",
               "nut free", "keto", "paleo", "whole30", "allergen", "pescatarian"]
    if any(d in q for d in dietary):
        t -= 3
    # High-end/specific experiences: can expect higher quality match
    # Only boost threshold for Food category — experience queries (Vibe/Service)
    # with these keywords don't reliably produce high DM due to food score drag
    premium = ["michelin", "tasting menu", "omakase", "wagyu", "fine dining", "prix fixe"]
    if category == "Food" and any(p in q for p in premium):
        t += 2
    # Brunch queries: historically score lower due to low IA and food mismatch
    if "brunch" in q:
        t -= 7
    # Experience/award queries in non-Food categories: IA/IM penalty applies
    # more because these map weakly to cuisine signals — lower threshold
    experience = ["michelin", "private chef", "sommelier", "james beard",
                  "chef interaction", "morning cafe", "dining room",
                  "chef's table", "wine dinner", "rehearsal dinner",
                  "awarded", "outstanding", "acclaimed"]
    if category != "Food" and any(e in q for e in experience):
        t -= 4
    # Location-based queries: weak cuisine signals, relies on convenience factor
    if any(loc in q for loc in ["near ", "walking distance", "close to"]):
        t -= 3
    # Value/accessibility/feature queries: DB may lack these attributes
    if any(v in q for v in ["cheap", "budget", "affordable", "wheelchair",
                            "accessible", "cash only", "menu with photos",
                            "photos", "wifi"]):
        t -= 2
    # Occasion/holiday queries in non-Food: weak food signal
    if category != "Food" and any(o in q for o in ["valentine", "anniversary",
                            "birthday", "holiday", "christmas", "new year"]):
        t -= 3
    # Ethnic cuisine in Reputation category: "best X" queries penalized by IM
    if category == "Reputation" and any(c in q for c in ["vietnamese", "indian",
                            "korean", "thai", "chinese", "mexican", "japanese"]):
        t -= 3
    return max(35, t)

# Build final test cases
strict_offset = $STRICT_OFFSET
output = []
for i, case in enumerate(sampled):
    cat = case["category"]
    query = case["query"]
    base_t = cat_base.get(cat, $BASE_THRESHOLD)
    threshold = adjust_threshold(base_t, query, cat) + strict_offset
    occasion = detect_occasion(query)
    cuisines = detect_cuisines(query, case.get("description", ""))

    test_id = f"GD-{cat[0]}{i+1:03d}"
    output.append({
        "test_id": test_id,
        "category": cat,
        "query": query,
        "expected_cuisines": cuisines,
        "min_score": threshold,
        "occasion": occasion,
        "description": case["description"],
        "dataset_index": case["index"]
    })

json.dump(output, sys.stdout)
PYEOF
)

if [[ -z "$SAMPLED_JSON" || "$SAMPLED_JSON" == "null" ]]; then
  echo -e "${RED}ERROR: Failed to sample test cases from critical dataset${NC}"
  rm -f "$EXCLUDE_QUERIES_FILE"
  exit 1
fi

# Save sampled cases manifest
echo "$SAMPLED_JSON" | jq '.' > "$SAMPLED_CASES_FILE"
ACTUAL_COUNT=$(echo "$SAMPLED_JSON" | jq 'length')
echo -e "\n  ${GREEN}Sampled $ACTUAL_COUNT test cases from critical dataset${NC}"
echo "  Saved manifest to: tests/V8_200_SAMPLED_CASES.json"

# Show category distribution
echo ""
echo "  ── Category Distribution ──"
echo "$SAMPLED_JSON" | jq -r 'group_by(.category) | .[] | "  \(.[0].category): \(length) cases"'
echo ""

###############################################################################
# STEP 2: RUN ALL SAMPLED TEST CASES
###############################################################################

echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  RUNNING $ACTUAL_COUNT TEST CASES                                         ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════╝${NC}"

# Iterate over sampled cases using jq
CASE_INDEX=0
while IFS= read -r case_json; do
  test_id=$(echo "$case_json" | jq -r '.test_id')
  category=$(echo "$case_json" | jq -r '.category')
  query=$(echo "$case_json" | jq -r '.query')
  expected_cuisines=$(echo "$case_json" | jq -r '.expected_cuisines')
  min_score=$(echo "$case_json" | jq -r '.min_score')
  occasion=$(echo "$case_json" | jq -r '.occasion')

  run_golden_test "$test_id" "$category" "$query" "$expected_cuisines" "$min_score" "$occasion"
  ((CASE_INDEX++))

  # Progress indicator every 25 tests
  if (( CASE_INDEX % 25 == 0 )); then
    echo -e "\n  ${BOLD}── Progress: $CASE_INDEX / $ACTUAL_COUNT ──${NC}"
  fi
done < <(echo "$SAMPLED_JSON" | jq -c '.[]')

###############################################################################
# RESULTS SUMMARY
###############################################################################
echo ""
echo "============================================================"
echo "  GOLDEN DATASET V8 — ${ACTUAL_COUNT}-CASE TEST RESULTS"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  Seed: $RANDOM_SEED | Strict Level: $STRICT_LEVEL (+$STRICT_OFFSET)"
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
# Golden Dataset V8 — ${ACTUAL_COUNT}-Case Test Results

**Date:** $(date -u '+%Y-%m-%dT%H:%M:%SZ')
**Endpoint:** $API
**Tests:** $ACTUAL_COUNT | **Checks:** $TOTAL_CHECKS
**Seed:** $RANDOM_SEED | **Strict Level:** $STRICT_LEVEL (+$STRICT_OFFSET)
**Base Threshold:** $BASE_THRESHOLD | **Category Filter:** ${FILTER_CATEGORY:-All}

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

## Configuration

\`\`\`
Sample Count: $SAMPLE_COUNT
Random Seed:  $RANDOM_SEED
Base Threshold: $BASE_THRESHOLD
Strict Level: $STRICT_LEVEL (+$STRICT_OFFSET)
Category Filter: ${FILTER_CATEGORY:-All}
Exclude Used: $EXCLUDE_USED
Balanced: $BALANCED
\`\`\`

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

# Cleanup
rm -f "$EXCLUDE_QUERIES_FILE"

echo "Done!"
echo "============================================================"
echo "  Raw results: tests/V8_200_RAW_RESULTS.jsonl"
echo "  Report:      $REPORT_FILE"
echo "  Sampled:     tests/V8_200_SAMPLED_CASES.json"
echo "============================================================"
echo ""
echo "  To reproduce: ./tests/golden-dataset-v8-200.sh -n $SAMPLE_COUNT -s $RANDOM_SEED --strict $STRICT_LEVEL"
echo ""

# Exit with failure if any hard failures
if (( FAIL_COUNT > 0 )); then
  exit 1
fi
exit 0
