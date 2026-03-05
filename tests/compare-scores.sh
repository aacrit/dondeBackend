#!/usr/bin/env bash
set -uo pipefail

###############################################################################
# DONDE A/B SCORE COMPARISON TOOL
# Runs the same query twice and shows side-by-side comparison.
# Useful for verifying consistency and debugging scoring behavior.
#
# Usage:  ./tests/compare-scores.sh "romantic Italian dinner"
# Deps:   curl, jq (v1.6+), bash 4+
###############################################################################

API="https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

###############################################################################
# ARGUMENT CHECK
###############################################################################

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 \"<query>\""
  echo "Example: $0 \"romantic Italian dinner\""
  exit 1
fi

QUERY="$1"

echo ""
echo "============================================================"
echo "  DONDE A/B SCORE COMPARISON"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  Query: \"$QUERY\""
echo "============================================================"

###############################################################################
# HELPER
###############################################################################

api_call() {
  local body="$1"
  local raw
  raw=$(curl -s -w "\n%{http_code}" -X POST "$API" \
    -H "Content-Type: application/json" \
    -d "$body" \
    --max-time 45 2>/dev/null)
  local code
  code=$(echo "$raw" | tail -n1)
  local response
  response=$(echo "$raw" | sed '$d')
  echo "$code"
  echo "$response"
}

extract_fields() {
  local resp="$1"
  local label="$2"

  local name donde_match relevance_score relevance_type quality_score
  local food vibe service reputation convenience
  local strongest_factor key_signals

  name=$(echo "$resp" | jq -r '.restaurant.name // "unknown"' 2>/dev/null)
  donde_match=$(echo "$resp" | jq -r '.donde_match // "n/a"' 2>/dev/null)
  relevance_score=$(echo "$resp" | jq -r '.scoring_v9.relevance_score // "n/a"' 2>/dev/null)
  relevance_type=$(echo "$resp" | jq -r '.scoring_v9.relevance_type // "n/a"' 2>/dev/null)
  quality_score=$(echo "$resp" | jq -r '.scoring_v9.quality_score // "n/a"' 2>/dev/null)
  food=$(echo "$resp" | jq -r '.scoring_v9.food // "n/a"' 2>/dev/null)
  vibe=$(echo "$resp" | jq -r '.scoring_v9.vibe // "n/a"' 2>/dev/null)
  service=$(echo "$resp" | jq -r '.scoring_v9.service // "n/a"' 2>/dev/null)
  reputation=$(echo "$resp" | jq -r '.scoring_v9.reputation // "n/a"' 2>/dev/null)
  convenience=$(echo "$resp" | jq -r '.scoring_v9.convenience // "n/a"' 2>/dev/null)
  strongest_factor=$(echo "$resp" | jq -r '.match_narrative.strongest_factor // "n/a"' 2>/dev/null)
  key_signals=$(echo "$resp" | jq -r '(.match_narrative.key_signals // [])[:5] | join(", ")' 2>/dev/null)

  echo "$label|$name|$donde_match|$relevance_score|$relevance_type|$quality_score|$food|$vibe|$service|$reputation|$convenience|$strongest_factor|$key_signals"
}

###############################################################################
# RUN A
###############################################################################

echo ""
echo -e "${CYAN}Running query A ...${NC}"

BODY=$(jq -n \
  --arg sr "$QUERY" \
  '{special_request: $sr, occasion: "Any", neighborhood: "Anywhere", price_level: "Any"}')

RAW_A=$(api_call "$BODY")
CODE_A=$(echo "$RAW_A" | head -n1)
RESP_A=$(echo "$RAW_A" | tail -n +2)

if [[ "$CODE_A" != "200" ]]; then
  echo -e "${RED}Run A failed with HTTP $CODE_A${NC}"
  exit 1
fi

SUCCESS_A=$(echo "$RESP_A" | jq -r '.success' 2>/dev/null)
if [[ "$SUCCESS_A" != "true" ]]; then
  echo -e "${RED}Run A returned success=$SUCCESS_A${NC}"
  exit 1
fi

echo -e "${GREEN}Run A complete${NC}"

# Small delay between runs
sleep 2

###############################################################################
# RUN B
###############################################################################

echo -e "${CYAN}Running query B ...${NC}"

RAW_B=$(api_call "$BODY")
CODE_B=$(echo "$RAW_B" | head -n1)
RESP_B=$(echo "$RAW_B" | tail -n +2)

if [[ "$CODE_B" != "200" ]]; then
  echo -e "${RED}Run B failed with HTTP $CODE_B${NC}"
  exit 1
fi

SUCCESS_B=$(echo "$RESP_B" | jq -r '.success' 2>/dev/null)
if [[ "$SUCCESS_B" != "true" ]]; then
  echo -e "${RED}Run B returned success=$SUCCESS_B${NC}"
  exit 1
fi

echo -e "${GREEN}Run B complete${NC}"

###############################################################################
# EXTRACT AND COMPARE
###############################################################################

FIELDS_A=$(extract_fields "$RESP_A" "A")
FIELDS_B=$(extract_fields "$RESP_B" "B")

# Parse fields
IFS='|' read -r _ NAME_A DM_A REL_A RELTYPE_A QUAL_A FOOD_A VIBE_A SVC_A REP_A CONV_A STRONG_A SIGNALS_A <<< "$FIELDS_A"
IFS='|' read -r _ NAME_B DM_B REL_B RELTYPE_B QUAL_B FOOD_B VIBE_B SVC_B REP_B CONV_B STRONG_B SIGNALS_B <<< "$FIELDS_B"

echo ""
echo "============================================================"
echo "  SIDE-BY-SIDE COMPARISON"
echo "============================================================"
echo ""

printf "  ${BOLD}%-24s${NC} ${CYAN}%-30s${NC} ${CYAN}%-30s${NC}\n" "Metric" "Run A" "Run B"
printf "  %-24s %-30s %-30s\n" "────────────────────────" "──────────────────────────────" "──────────────────────────────"
printf "  %-24s %-30s %-30s\n" "Restaurant" "$NAME_A" "$NAME_B"
printf "  %-24s %-30s %-30s\n" "donde_match" "$DM_A" "$DM_B"
printf "  %-24s %-30s %-30s\n" "relevance_score" "$REL_A" "$REL_B"
printf "  %-24s %-30s %-30s\n" "relevance_type" "$RELTYPE_A" "$RELTYPE_B"
printf "  %-24s %-30s %-30s\n" "quality_score" "$QUAL_A" "$QUAL_B"
printf "  %-24s %-30s %-30s\n" "food" "$FOOD_A" "$FOOD_B"
printf "  %-24s %-30s %-30s\n" "vibe" "$VIBE_A" "$VIBE_B"
printf "  %-24s %-30s %-30s\n" "service" "$SVC_A" "$SVC_B"
printf "  %-24s %-30s %-30s\n" "reputation" "$REP_A" "$REP_B"
printf "  %-24s %-30s %-30s\n" "convenience" "$CONV_A" "$CONV_B"
printf "  %-24s %-30s %-30s\n" "strongest_factor" "$STRONG_A" "$STRONG_B"
echo ""
echo "  Key Signals A: $SIGNALS_A"
echo "  Key Signals B: $SIGNALS_B"

###############################################################################
# CONSISTENCY CHECK
###############################################################################

echo ""
echo -e "${BOLD}── Consistency Analysis ──${NC}"

SAME_RESTAURANT=false
if [[ "$NAME_A" == "$NAME_B" ]]; then
  SAME_RESTAURANT=true
  echo -e "  ${GREEN}CONSISTENT${NC}: Same restaurant returned both times ($NAME_A)"
else
  echo -e "  ${YELLOW}DIFFERENT${NC}: Different restaurants returned (A: $NAME_A, B: $NAME_B)"
fi

# Compare donde_match delta
DM_A_INT=${DM_A%.*}
DM_B_INT=${DM_B%.*}
DM_DIFF=$(( DM_A_INT > DM_B_INT ? DM_A_INT - DM_B_INT : DM_B_INT - DM_A_INT ))

if (( DM_DIFF == 0 )); then
  echo -e "  ${GREEN}STABLE${NC}: donde_match identical ($DM_A)"
elif (( DM_DIFF <= 5 )); then
  echo -e "  ${GREEN}STABLE${NC}: donde_match within 5 points (A: $DM_A, B: $DM_B, delta: $DM_DIFF)"
elif (( DM_DIFF <= 15 )); then
  echo -e "  ${YELLOW}VARIANCE${NC}: donde_match differs by $DM_DIFF points (A: $DM_A, B: $DM_B)"
else
  echo -e "  ${RED}UNSTABLE${NC}: donde_match differs by $DM_DIFF points (A: $DM_A, B: $DM_B)"
fi

if [[ "$RELTYPE_A" == "$RELTYPE_B" ]]; then
  echo -e "  ${GREEN}CONSISTENT${NC}: Same relevance_type ($RELTYPE_A)"
else
  echo -e "  ${YELLOW}DIFFERENT${NC}: relevance_type changed (A: $RELTYPE_A, B: $RELTYPE_B)"
fi

echo ""
echo "============================================================"
echo "  Done."
echo "============================================================"
