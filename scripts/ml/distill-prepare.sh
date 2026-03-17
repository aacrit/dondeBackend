#!/usr/bin/env bash
set -uo pipefail

###############################################################################
# DISTILL-PREPARE: Fetch candidate data for knowledge distillation
#
# Reads queries from tests/generated-queries.json (or falls back to the
# golden dataset embedded below) and calls the DondeAI recommend API with
# skip_claude=true and skip_google=true ($0 cost) to collect scored
# candidate data for XGBoost training.
#
# Usage:
#   chmod +x scripts/ml/distill-prepare.sh
#   ./scripts/ml/distill-prepare.sh                          # all queries
#   ./scripts/ml/distill-prepare.sh --batch-start 0 --batch-size 50
#   ./scripts/ml/distill-prepare.sh --source golden          # golden dataset only
#   ./scripts/ml/distill-prepare.sh --source generated       # generated queries only
#
# Requires: SUPAB_URL, SUPAB_ANON_KEY (from .env or environment)
# Output:   scripts/ml/candidates-batch.json
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_FILE="$SCRIPT_DIR/candidates-batch.json"
GENERATED_QUERIES="$ROOT_DIR/tests/generated-queries.json"
BATCH_START=0
BATCH_SIZE=9999
QUERY_SOURCE="auto"  # auto, golden, generated
BATCH_DELAY=0.5

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

###############################################################################
# Parse arguments
###############################################################################
while [[ $# -gt 0 ]]; do
  case "$1" in
    --batch-start) BATCH_START="$2"; shift 2 ;;
    --batch-size)  BATCH_SIZE="$2"; shift 2 ;;
    --source)      QUERY_SOURCE="$2"; shift 2 ;;
    --output)      OUTPUT_FILE="$2"; shift 2 ;;
    --delay)       BATCH_DELAY="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--batch-start N] [--batch-size N] [--source golden|generated|auto] [--output FILE] [--delay SECS]"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

###############################################################################
# Load environment
###############################################################################
if [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$ROOT_DIR/.env"; set +a
fi

if [[ -z "${SUPAB_URL:-}" ]] || [[ -z "${SUPAB_ANON_KEY:-}" ]]; then
  echo -e "${RED}ERROR: SUPAB_URL and SUPAB_ANON_KEY must be set (in .env or environment)${NC}"
  exit 1
fi

API="${SUPAB_URL}/functions/v1/recommend"

###############################################################################
# Golden dataset queries (fallback when generated-queries.json is empty)
# These are the 50 golden dataset queries from the test suite.
###############################################################################
GOLDEN_QUERIES='[
  {"query":"smash burger","category":"Food","occasion":"Any"},
  {"query":"soup dumplings","category":"Food","occasion":"Any"},
  {"query":"korean fried chicken","category":"Food","occasion":"Any"},
  {"query":"truffle pasta","category":"Food","occasion":"Any"},
  {"query":"cuban food","category":"Food","occasion":"Any"},
  {"query":"hand rolls","category":"Food","occasion":"Any"},
  {"query":"acai bowl","category":"Food","occasion":"Any"},
  {"query":"jerk chicken","category":"Food","occasion":"Any"},
  {"query":"fondue","category":"Food","occasion":"Any"},
  {"query":"deep dish pizza","category":"Food","occasion":"Any"},
  {"query":"lobster bisque","category":"Food","occasion":"Any"},
  {"query":"taiwanese food","category":"Food","occasion":"Any"},
  {"query":"hot chicken","category":"Food","occasion":"Any"},
  {"query":"charcuterie board","category":"Food","occasion":"Any"},
  {"query":"grain bowl","category":"Food","occasion":"Any"},
  {"query":"speakeasy","category":"Vibe","occasion":"Any"},
  {"query":"jazz bar","category":"Vibe","occasion":"Any"},
  {"query":"tiki bar","category":"Vibe","occasion":"Any"},
  {"query":"karaoke bar","category":"Vibe","occasion":"Any"},
  {"query":"rooftop brunch","category":"Vibe","occasion":"Any"},
  {"query":"bottomless brunch","category":"Vibe","occasion":"Any"},
  {"query":"power lunch","category":"Vibe","occasion":"Any"},
  {"query":"dive bar","category":"Vibe","occasion":"Any"},
  {"query":"sports bar","category":"Vibe","occasion":"Any"},
  {"query":"cozy date night restaurant","category":"Vibe","occasion":"Date Night"},
  {"query":"walk in friendly restaurant","category":"Service","occasion":"Any"},
  {"query":"large party dining","category":"Service","occasion":"Group Hangout"},
  {"query":"happy hour","category":"Service","occasion":"Any"},
  {"query":"omakase","category":"Service","occasion":"Any"},
  {"query":"prix fixe dinner","category":"Service","occasion":"Any"},
  {"query":"outdoor seating","category":"Service","occasion":"Any"},
  {"query":"byob restaurant","category":"Service","occasion":"Any"},
  {"query":"family style dinner","category":"Service","occasion":"Family Dinner"},
  {"query":"valet parking","category":"Service","occasion":"Any"},
  {"query":"private dining room","category":"Service","occasion":"Special Occasion"},
  {"query":"best tasting menu in chicago","category":"Reputation","occasion":"Any"},
  {"query":"michelin star restaurant","category":"Reputation","occasion":"Any"},
  {"query":"best craft cocktail bar","category":"Reputation","occasion":"Any"},
  {"query":"best rooftop dining","category":"Reputation","occasion":"Any"},
  {"query":"james beard restaurant","category":"Reputation","occasion":"Any"},
  {"query":"late night food","category":"Convenience","occasion":"Any"},
  {"query":"west loop restaurants","category":"Convenience","occasion":"Any"},
  {"query":"near wrigley field","category":"Convenience","occasion":"Any"},
  {"query":"quick lunch near the loop","category":"Convenience","occasion":"Any"},
  {"query":"open for sunday dinner","category":"Convenience","occasion":"Any"},
  {"query":"restaurant with free wifi","category":"Convenience","occasion":"Any"},
  {"query":"kid friendly brunch","category":"Convenience","occasion":"Family Dinner"},
  {"query":"dog friendly patio","category":"Convenience","occasion":"Any"},
  {"query":"river north restaurant","category":"Convenience","occasion":"Any"},
  {"query":"logan square restaurant","category":"Convenience","occasion":"Any"}
]'

###############################################################################
# Build query list
###############################################################################
build_query_list() {
  local generated_count=0

  # Check if generated-queries.json has actual queries
  if [[ -f "$GENERATED_QUERIES" ]]; then
    generated_count=$(jq '.queries | length' "$GENERATED_QUERIES" 2>/dev/null || echo "0")
  fi

  case "$QUERY_SOURCE" in
    golden)
      echo "$GOLDEN_QUERIES"
      ;;
    generated)
      if [[ "$generated_count" -eq 0 ]]; then
        echo -e "${RED}ERROR: No queries in generated-queries.json. Run gen-test-queries agent first.${NC}" >&2
        exit 1
      fi
      jq '[.queries[] | {query: .special_request, category: .category, occasion: (.occasion // "Any")}]' "$GENERATED_QUERIES"
      ;;
    auto)
      if [[ "$generated_count" -gt 0 ]]; then
        echo -e "${CYAN}Using $generated_count queries from generated-queries.json${NC}" >&2
        # Merge golden + generated, dedup by query text
        local generated
        generated=$(jq '[.queries[] | {query: .special_request, category: .category, occasion: (.occasion // "Any")}]' "$GENERATED_QUERIES")
        echo "$GOLDEN_QUERIES" | jq --argjson gen "$generated" '. + $gen | unique_by(.query)'
      else
        echo -e "${YELLOW}generated-queries.json is empty, using 50 golden dataset queries${NC}" >&2
        echo "$GOLDEN_QUERIES"
      fi
      ;;
    *)
      echo -e "${RED}ERROR: Unknown source '$QUERY_SOURCE'. Use: golden, generated, auto${NC}" >&2
      exit 1
      ;;
  esac
}

QUERIES=$(build_query_list)
TOTAL_QUERIES=$(echo "$QUERIES" | jq 'length')

echo -e "${BOLD}=== DondeAI Knowledge Distillation — Candidate Preparation ===${NC}"
echo -e "Total queries available: ${CYAN}$TOTAL_QUERIES${NC}"
echo -e "Batch: start=${CYAN}$BATCH_START${NC}, size=${CYAN}$BATCH_SIZE${NC}"
echo -e "API: ${CYAN}$API${NC}"
echo -e "Output: ${CYAN}$OUTPUT_FILE${NC}"
echo ""

###############################################################################
# Slice queries for this batch
###############################################################################
BATCH_END=$((BATCH_START + BATCH_SIZE))
if [[ $BATCH_END -gt $TOTAL_QUERIES ]]; then
  BATCH_END=$TOTAL_QUERIES
fi

BATCH_QUERIES=$(echo "$QUERIES" | jq ".[$BATCH_START:$BATCH_END]")
BATCH_COUNT=$(echo "$BATCH_QUERIES" | jq 'length')

echo -e "Processing ${BOLD}$BATCH_COUNT${NC} queries (index $BATCH_START to $((BATCH_END - 1)))"
echo ""

###############################################################################
# Process each query
###############################################################################
RESULTS="[]"
SUCCESS=0
ERRORS=0
QUERY_ID=$((BATCH_START + 1))

for i in $(seq 0 $((BATCH_COUNT - 1))); do
  QUERY_OBJ=$(echo "$BATCH_QUERIES" | jq ".[$i]")
  QUERY_TEXT=$(echo "$QUERY_OBJ" | jq -r '.query')
  CATEGORY=$(echo "$QUERY_OBJ" | jq -r '.category')
  OCCASION=$(echo "$QUERY_OBJ" | jq -r '.occasion // "Any"')

  # Progress indicator
  printf "[%3d/%3d] %-50s " "$((i + 1))" "$BATCH_COUNT" "$QUERY_TEXT"

  # Build request body
  REQUEST_BODY=$(jq -n \
    --arg sr "$QUERY_TEXT" \
    --arg oc "$OCCASION" \
    '{
      special_request: $sr,
      occasion: $oc,
      neighborhood: "Anywhere",
      price_level: "Any",
      skip_claude: true,
      skip_google: true
    }')

  # Call API
  RAW_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SUPAB_ANON_KEY" \
    -H "apikey: $SUPAB_ANON_KEY" \
    -d "$REQUEST_BODY" \
    --max-time 45 2>/dev/null)

  HTTP_CODE=$(echo "$RAW_RESPONSE" | tail -n1)
  RESPONSE=$(echo "$RAW_RESPONSE" | sed '$d')

  if [[ "$HTTP_CODE" != "200" ]]; then
    echo -e "${RED}HTTP $HTTP_CODE${NC}"
    ((ERRORS++))
    QUERY_ID=$((QUERY_ID + 1))
    sleep "$BATCH_DELAY"
    continue
  fi

  # Check for success
  IS_SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
  if [[ "$IS_SUCCESS" != "true" ]]; then
    echo -e "${RED}API error${NC}"
    ((ERRORS++))
    QUERY_ID=$((QUERY_ID + 1))
    sleep "$BATCH_DELAY"
    continue
  fi

  # Extract top restaurant + ranked queue
  DONDE_MATCH=$(echo "$RESPONSE" | jq '.donde_match // 0')

  # Build candidates array from ranked_queue (up to 5 entries)
  CANDIDATES=$(echo "$RESPONSE" | jq '[
    (.ranked_queue // [])[:5] | to_entries[] | {
      rank: (.value.rank // (.key + 1)),
      restaurant_id: (.value.restaurant.id // "unknown"),
      restaurant_name: (.value.restaurant.name // "Unknown"),
      cuisine_type: (.value.restaurant.cuisine_type // "Unknown"),
      neighborhood: (.value.restaurant.neighborhood_name // "Unknown"),
      price_level: (.value.restaurant.price_level // "Unknown"),
      donde_match: (.value.donde_match // 0),
      relevance_score: (.value.scoring_v9.relevance_score // 0),
      relevance_type: (.value.scoring_v9.relevance_type // "open_ended"),
      food_score: (.value.scoring_v9.food // 0),
      vibe_score: (.value.scoring_v9.vibe // 0),
      service_score: (.value.scoring_v9.service // 0),
      reputation_score: (.value.scoring_v9.reputation // 0),
      convenience_score: (.value.scoring_v9.convenience // 0),
      data_completeness: (.value.scoring_v9.data_completeness // 0),
      match_headline: (.value.match_headline // ""),
      best_for_oneliner: (.value.restaurant.best_for_oneliner // "")
    }
  ]')

  CANDIDATE_COUNT=$(echo "$CANDIDATES" | jq 'length')

  # If ranked_queue is empty, fall back to the top-1 restaurant from the response
  if [[ "$CANDIDATE_COUNT" -eq 0 ]]; then
    CANDIDATES=$(echo "$RESPONSE" | jq '[{
      rank: 1,
      restaurant_id: (.restaurant.id // "unknown"),
      restaurant_name: (.restaurant.name // "Unknown"),
      cuisine_type: (.restaurant.cuisine_type // "Unknown"),
      neighborhood: (.restaurant.neighborhood_name // "Unknown"),
      price_level: (.restaurant.price_level // "Unknown"),
      donde_match: (.donde_match // 0),
      relevance_score: (.scoring_v9.relevance_score // 0),
      relevance_type: (.scoring_v9.relevance_type // "open_ended"),
      food_score: (.scoring_v9.food // 0),
      vibe_score: (.scoring_v9.vibe // 0),
      service_score: (.scoring_v9.service // 0),
      reputation_score: (.scoring_v9.reputation // 0),
      convenience_score: (.scoring_v9.convenience // 0),
      data_completeness: (.scoring_v9.data_completeness // 0),
      match_headline: "",
      best_for_oneliner: (.restaurant.best_for_oneliner // "")
    }]')
    CANDIDATE_COUNT=1
  fi

  # Build result entry
  RESULT_ENTRY=$(jq -n \
    --argjson qid "$QUERY_ID" \
    --arg q "$QUERY_TEXT" \
    --arg cat "$CATEGORY" \
    --argjson cands "$CANDIDATES" \
    '{
      query_id: $qid,
      query: $q,
      category: $cat,
      candidates: $cands
    }')

  RESULTS=$(echo "$RESULTS" | jq --argjson entry "$RESULT_ENTRY" '. + [$entry]')

  echo -e "${GREEN}DM $DONDE_MATCH${NC} ($CANDIDATE_COUNT candidates)"
  ((SUCCESS++))
  QUERY_ID=$((QUERY_ID + 1))

  # Rate limit: pause every 10 queries
  if [[ $(( (i + 1) % 10 )) -eq 0 ]] && [[ $i -lt $((BATCH_COUNT - 1)) ]]; then
    echo -e "  ${CYAN}... batch pause (${BATCH_DELAY}s) ...${NC}"
    sleep "$BATCH_DELAY"
  fi
done

###############################################################################
# Write output
###############################################################################
echo "$RESULTS" | jq '.' > "$OUTPUT_FILE"

echo ""
echo -e "${BOLD}=== Summary ===${NC}"
echo -e "Processed: ${CYAN}$BATCH_COUNT${NC} queries"
echo -e "Success:   ${GREEN}$SUCCESS${NC}"
echo -e "Errors:    ${RED}$ERRORS${NC}"
echo -e "Output:    ${CYAN}$OUTPUT_FILE${NC}"

TOTAL_CANDIDATES=$(echo "$RESULTS" | jq '[.[].candidates | length] | add // 0')
echo -e "Total candidate pairs: ${CYAN}$TOTAL_CANDIDATES${NC}"

echo ""
echo -e "${YELLOW}Next step: Review candidates-batch.json, then run CLI agent ranking to create training labels.${NC}"
echo -e "${YELLOW}  cat scripts/ml/candidates-batch.json | jq '.[0]'${NC}"
