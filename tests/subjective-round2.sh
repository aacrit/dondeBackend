#!/bin/bash
# Subjective Engine Test - Round 2 (Stress Test)

SUPAB_URL=$(grep '^SUPAB_URL=' .env | cut -d= -f2 | sed 's/#.*//' | tr -d '[:space:]')
SUPAB_ANON_KEY=$(grep '^SUPAB_ANON_KEY=' .env | cut -d= -f2 | sed 's/#.*//' | tr -d '[:space:]')

run_query() {
  local query="$1"
  local neighborhood="${2:-Anywhere}"
  local result=$(curl -s -X POST "$SUPAB_URL/functions/v1/recommend" \
    -H "Authorization: Bearer $SUPAB_ANON_KEY" \
    -H "apikey: $SUPAB_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"special_request\": \"$query\", \"occasion\": \"Any\", \"neighborhood\": \"$neighborhood\", \"price_level\": \"Any\", \"skip_claude\": true, \"skip_google\": true}")

  local name=$(echo "$result" | jq -r '.restaurant.name // "NULL"')
  local cuisine=$(echo "$result" | jq -r '.restaurant.cuisine_type // "NULL"')
  local dm=$(echo "$result" | jq -r '.donde_match // 0')
  local hood=$(echo "$result" | jq -r '.restaurant.neighborhood_name // "NULL"')
  local rel=$(echo "$result" | jq -r '.scoring_v9.relevance_score // 0')
  local rel_type=$(echo "$result" | jq -r '.scoring_v9.relevance_type // "NULL"')
  local food=$(echo "$result" | jq -r '.scoring_v9.food // 0')
  local rep=$(echo "$result" | jq -r '.scoring_v9.reputation // 0')

  # Extract queue names and DM scores only
  local q2_name=$(echo "$result" | jq -r '.ranked_queue[0]?.name // "—"')
  local q2_dm=$(echo "$result" | jq -r '.ranked_queue[0]?.donde_match // "—"')
  local q3_name=$(echo "$result" | jq -r '.ranked_queue[1]?.name // "—"')
  local q3_dm=$(echo "$result" | jq -r '.ranked_queue[1]?.donde_match // "—"')
  local q4_name=$(echo "$result" | jq -r '.ranked_queue[2]?.name // "—"')
  local q4_dm=$(echo "$result" | jq -r '.ranked_queue[2]?.donde_match // "—"')
  local q5_name=$(echo "$result" | jq -r '.ranked_queue[3]?.name // "—"')
  local q5_dm=$(echo "$result" | jq -r '.ranked_queue[3]?.donde_match // "—"')

  echo "QUERY: $query"
  echo "  #1: $name | $cuisine | DM:$dm | $hood | Rel:$rel ($rel_type) | Food:$food Rep:$rep"
  echo "  #2: $q2_name ($q2_dm) | #3: $q3_name ($q3_dm) | #4: $q4_name ($q4_dm) | #5: $q5_name ($q5_dm)"
  echo "---"
}

echo "=== CROSS-CUISINE STRESS TESTS (8) ==="
run_query "best Vietnamese food"
run_query "best Japanese food"
run_query "best Ethiopian food"
run_query "best Peruvian food"
run_query "best Greek food"
run_query "best Filipino food"
run_query "best Lebanese food"
run_query "best Polish food"

echo ""
echo "=== DISH-SPECIFIC STRESS TESTS (8) ==="
run_query "best gyoza"
run_query "best pho"
run_query "best al pastor tacos"
run_query "best chicken wings"
run_query "best dim sum"
run_query "best pierogi"
run_query "best lobster roll"
run_query "best Nashville hot chicken"

echo ""
echo "=== VENUE/CONCEPT STRESS TESTS (5) ==="
run_query "best restaurant in Lincoln Park" "Lincoln Park"
run_query "best restaurant in Wicker Park" "Wicker Park"
run_query "best restaurant in River North" "River North"
run_query "best restaurant in Pilsen" "Pilsen"
run_query "best restaurant in Andersonville" "Andersonville"

echo ""
echo "=== VIBE/STRUCTURAL STRESS TESTS (4) ==="
run_query "best patio restaurant"
run_query "best restaurant with live music"
run_query "best late night food"
run_query "best outdoor dining"
