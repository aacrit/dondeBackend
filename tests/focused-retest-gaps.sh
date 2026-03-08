#!/usr/bin/env bash
###############################################################################
# Focused Retest — Tests all 241 gap queries from the Mar 8 gauntlet run
#
# Usage:
#   ./tests/focused-retest-gaps.sh [--limit N]
#
# Requires: SUPAB_URL and SUPAB_ANON_KEY in .env
###############################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$BACKEND_DIR/.env" 2>/dev/null || true

API_URL="${SUPAB_URL}/functions/v1/recommend"
ANON_KEY="${SUPAB_ANON_KEY}"
LIMIT="${1:---limit}"
MAX_QUERIES=999

if [[ "$LIMIT" == "--limit" ]] && [[ -n "${2:-}" ]]; then
  MAX_QUERIES="$2"
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# All gap queries from the gauntlet, organized by priority
declare -a QUERIES=(
  # P0 — API errors (were DM=0)
  "Ecuadorian food near me"
  "where to get pancakes"
  "where to get cheesecake"

  # P1 — Lowest DM intent gaps (DM < 60)
  "somewhere upscale"
  "upscale bar"
  "upscale restaurant Chicago"
  "authentic Nepalese"
  "Cajun food near me"
  "best Pakistani"
  "ice cream"
  "best bulgogi in Chicago"
  "best Korean"
  "Southern food near me"
  "Jamaican food near me"
  "Bangladeshi food near me"
  "Sri Lankan food near me"

  # P1 — Intent gaps (DM 60-75)
  "classic place to eat"
  "classic dinner spot"
  "tasting menu near me"
  "classic restaurant"
  "where to get Soul Food food"
  "romantic place to eat"
  "romantic restaurant Chicago"
  "romantic bar"
  "Chicago mix popcorn restaurant"
  "best Persian"
  "authentic Soul Food"
  "best BBQ in Chicago"
  "good place for brunch"
  "brunch spot"
  "best butter chicken"
  "best Chinese in Chicago"
  "best Chinese"
  "authentic Bangladeshi"
  "best brunch restaurant"
  "good Maxwell Street Polish"
  "authentic Indonesian"
  "where to get pupusas"

  # P1 — Intent gaps (DM 76-84)
  "best brisket"
  "best brunch"
  "where to get kolaczki"
  "best Moroccan in Chicago"
  "good pad thai"
  "authentic Azerbaijani"
  "best Moroccan"
  "authentic Swedish"
  "good eggs benedict"
  "best Spanish"
  "best business lunch restaurant"
  "best dumplings in Chicago"
  "best tiramisu"
  "best mochi"
  "best birthday restaurant"
  "best casual hangout restaurant"
  "bib gourmand chicago"
  "best wings"
  "best birria tacos in Chicago"
  "best tacos"
  "best sport peppers in Chicago"
  "best Ghanaian"
  "best mother-in-law"
  "where to get coffee"
  "best Hawaiian in Chicago"
  "best Kurdish"
  "best Serbian"
  "best french toast in Chicago"
  "best Malaysian"
  "best breaded steak sandwich in Chicago"
  "eater 38 chicago"
  "omelette restaurant"
  "best avocado toast in Chicago"
  "best group dinner restaurant"
  "best Italian ice in Chicago"
  "best South Side rib tips"
  "paczki near me"
  "rainbow cone"
  "best anniversary restaurant"
  "where to get gym shoe"
  "best Italian beef in Chicago"
  "Bangladeshi restaurant"
  "best Indian in Chicago"
  "best Argentine in Chicago"
  "best Colombian"
  "best Colombian in Chicago"
  "best Laotian"
  "infatuation chicago picks"
  "Levantine food"
  "where to get Bosnian food"
  "Portuguese place"
  "best Ukrainian"
  "British food"
  "Israeli place"
  "best Afghan"
  "best Liberian"
  "best Sri Lankan"
  "Trinidadian food"
  "best Peruvian"
  "Singaporean restaurant"
  "Levantine place"
  "Indonesian place"
  "Singaporean place"
  "best Soul Food in Chicago"
  "best churros"
  "speakeasy place to eat"
  "somewhere speakeasy"
  "speakeasy restaurant"
  "best burger in Chicago"
  "best fried chicken in Chicago"
  "cocktails restaurant"
  "best Chicago cheesesteak"
  "best steak in Chicago"
  "best date night restaurant"

  # P1 — Scoring gaps (DM 40-60)
  "authentic Malaysian"
  "good Haitian restaurant"
  "good Eritrean restaurant"
  "Somali place"
  "authentic Nigerian"
  "Senegalese food near me"
  "good Lebanese restaurant"
  "Turkish place"
  "Southern restaurant"
  "Creole restaurant"
  "Uzbek food near me"
  "Malaysian restaurant"
  "where to get Tibetan food"
  "Cajun restaurant"
  "good Creole restaurant"
  "Creole place"
  "lively restaurant Chicago"
  "lively restaurant"
  "lively dinner spot"
  "somewhere funky"
  "somewhere buzzing"
  "buzzing restaurant"
  "buzzing bar"
  "somewhere rooftop"
  "rooftop dinner spot"
  "family friendly dinner spot"
  "family friendly place to eat"
  "family friendly restaurant Chicago"
  "group dinner in Chicago"
  "where to go for group dinner"
  "family dinner spot"
  "good place for family dinner"
  "family dinner restaurant"
  "happy hour in Chicago"
  "good place for happy hour"
  "where to go for happy hour"

  # P1 — Neighborhood/location gaps
  "dinner before Bulls game"
  "dinner before Bears game"
  "dinner before Cubs game"
  "dinner before White Sox game"
  "dinner before Blackhawks game"
  "food near United Center"
  "food near Wrigley Field"
  "food near Soldier Field"
  "food near Guaranteed Rate Field"
  "food near Navy Pier"
  "food near Art Institute"
  "food near Millennium Park"
  "food near Field Museum"
)

TOTAL=${#QUERIES[@]}
if [[ $MAX_QUERIES -lt $TOTAL ]]; then
  TOTAL=$MAX_QUERIES
fi

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  DONDE Focused Gap Retest — $TOTAL queries               ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

PASS=0
FAIL=0
WARN=0
TOTAL_DM=0
RESULTS=()

for ((i=0; i<TOTAL; i++)); do
  query="${QUERIES[$i]}"
  result=$(curl -s --max-time 15 -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "apikey: $ANON_KEY" \
    -d "{\"special_request\": \"$query\"}" 2>/dev/null)

  dm=$(echo "$result" | jq -r '.donde_match // 0' 2>/dev/null)
  rest=$(echo "$result" | jq -r '.restaurant.name // "ERROR"' 2>/dev/null)
  rel=$(echo "$result" | jq -r '.scoring_v9.relevance_type // "?"' 2>/dev/null)

  TOTAL_DM=$((TOTAL_DM + dm))

  if [[ "$dm" -ge 70 ]]; then
    status="${GREEN}PASS${NC}"
    PASS=$((PASS + 1))
  elif [[ "$dm" -ge 60 ]]; then
    status="${YELLOW}WARN${NC}"
    WARN=$((WARN + 1))
  else
    status="${RED}FAIL${NC}"
    FAIL=$((FAIL + 1))
  fi

  printf "  %3d. %-45s DM=%2d  %-15s %b  %s\n" $((i+1)) "\"$query\"" "$dm" "$rel" "$status" "$rest"

  # Rate limiting
  if (( (i + 1) % 5 == 0 )); then
    sleep 0.5
  fi
done

AVG_DM=$((TOTAL_DM / TOTAL))

echo ""
echo -e "${BOLD}━━━ Results ━━━${NC}"
echo -e "  Total: $TOTAL | ${GREEN}PASS: $PASS${NC} | ${YELLOW}WARN: $WARN${NC} | ${RED}FAIL: $FAIL${NC}"
echo -e "  Pass rate (DM≥70): $(( PASS * 100 / TOTAL ))%"
echo -e "  Avg DondeMatch: $AVG_DM"
echo ""
