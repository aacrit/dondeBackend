#!/bin/bash
# Round 3 Subjective Engine Testing - 25 queries
set -euo pipefail

SUPAB_URL="https://vwbzkgsxmgwcvmvuxnbe.supabase.co"
SUPAB_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnprZ3N4bWd3Y3ZtdnV4bmJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NjUzNTYsImV4cCI6MjA4NTU0MTM1Nn0.YBhmusYxc28TD5FOZv4TBpFpDVHHk1V894wUkNtJtcc"

run_query() {
  local query="$1"
  local neighborhood="${2:-Anywhere}"
  local result
  result=$(curl -s -X POST "$SUPAB_URL/functions/v1/recommend" \
    -H "Authorization: Bearer $SUPAB_ANON_KEY" \
    -H "apikey: $SUPAB_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"special_request\": \"$query\", \"occasion\": \"Any\", \"neighborhood\": \"$neighborhood\", \"price_level\": \"Any\", \"skip_claude\": true, \"skip_google\": true}")

  echo "$result" | jq --arg q "$query" '{
    query: $q,
    restaurant: .restaurant.name,
    cuisine: .restaurant.cuisine_type,
    neighborhood: .restaurant.neighborhood_name,
    dm: .donde_match,
    relevance_score: .scoring_v9.relevance_score,
    relevance_type: .scoring_v9.relevance_type,
    relevance_details: .scoring_v9.relevance_details,
    queue: [.ranked_queue[]? | {name: (.restaurant.name // .restaurant), dm: .donde_match, rel_type: .scoring_v9.relevance_type}][:5]
  }'
}

echo "============================================"
echo "PATTERN A: Dish Specialists (8 queries)"
echo "============================================"

for q in "best empanadas" "best banh mi" "best falafel" "best elote" "best ceviche" "best jerk chicken" "best bibimbap" "best pupusa"; do
  echo "--- $q ---"
  run_query "$q"
  echo ""
done

echo "============================================"
echo "PATTERN B: Cross-Cuisine Contamination (7 queries)"
echo "============================================"

for q in "best Moroccan food" "best Colombian food" "best Taiwanese food" "best Cuban food" "best Burmese food" "best Afghan food" "best Jamaican food"; do
  echo "--- $q ---"
  run_query "$q"
  echo ""
done

echo "============================================"
echo "PATTERN C: Vibe/Structural (6 queries)"
echo "============================================"

for q in "best waterfront restaurant" "best restaurant with fireplace" "best restaurant with private dining" "best quiet restaurant for conversation" "best restaurant with a view" "best speakeasy"; do
  echo "--- $q ---"
  run_query "$q"
  echo ""
done

echo "============================================"
echo "PATTERN D: Neighborhood Precision (4 queries)"
echo "============================================"

for q in "best restaurant in Hyde Park" "best restaurant in Humboldt Park" "best restaurant in Bridgeport" "best restaurant in Uptown"; do
  echo "--- $q ---"
  run_query "$q"
  echo ""
done

echo "============================================"
echo "ALL 25 QUERIES COMPLETE"
echo "============================================"
