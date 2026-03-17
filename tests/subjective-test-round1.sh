#!/bin/bash
# Subjective Engine Tester - Round 1
# Runs 25 diverse queries and extracts key results

SUPAB_URL="https://vwbzkgsxmgwcvmvuxnbe.supabase.co"
SUPAB_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnprZ3N4bWd3Y3ZtdnV4bmJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NjUzNTYsImV4cCI6MjA4NTU0MTM1Nn0.YBhmusYxc28TD5FOZv4TBpFpDVHHk1V894wUkNtJtcc"

OUTPUT_FILE="/home/aacrit/projects/dondeBackend/tests/subjective-round1-results.json"

# 25 queries
queries=(
  "best Italian restaurant|Any|Anywhere"
  "authentic Mexican food|Any|Anywhere"
  "best sushi|Any|Anywhere"
  "best Indian food|Any|Anywhere"
  "best Thai food|Any|Anywhere"
  "best Korean food|Any|Anywhere"
  "best BBQ|Any|Anywhere"
  "best Chinese food|Any|Anywhere"
  "romantic dinner|Date Night|Anywhere"
  "business lunch downtown|Business|Anywhere"
  "family friendly restaurant|Family|Anywhere"
  "birthday dinner|Birthday|Anywhere"
  "solo dining|Any|Anywhere"
  "best rooftop restaurant|Any|Anywhere"
  "cozy restaurant|Any|Anywhere"
  "best brunch|Any|Anywhere"
  "best steakhouse|Any|Anywhere"
  "hidden gem restaurant|Any|Anywhere"
  "best restaurant in West Loop|Any|West Loop"
  "best restaurant in Logan Square|Any|Logan Square"
  "best restaurant in Chinatown|Any|Chinatown"
  "best deep dish pizza|Any|Anywhere"
  "best tacos|Any|Anywhere"
  "best ramen|Any|Anywhere"
  "best burger|Any|Anywhere"
)

echo "[" > "$OUTPUT_FILE"
first=true

for i in "${!queries[@]}"; do
  IFS='|' read -r query occasion neighborhood <<< "${queries[$i]}"
  num=$((i + 1))

  echo "Running query $num/25: $query" >&2

  response=$(curl -s -X POST "$SUPAB_URL/functions/v1/recommend" \
    -H "Authorization: Bearer $SUPAB_ANON_KEY" \
    -H "apikey: $SUPAB_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"special_request\": \"$query\", \"occasion\": \"$occasion\", \"neighborhood\": \"$neighborhood\", \"price_level\": \"Any\", \"skip_claude\": true, \"skip_google\": true}" 2>/dev/null)

  # Extract key fields
  result=$(echo "$response" | jq -c "{
    query_num: $num,
    query: \"$query\",
    primary_name: .restaurant.name,
    primary_cuisine: .restaurant.cuisine_type,
    primary_neighborhood: .restaurant.neighborhood_name,
    donde_match: .donde_match,
    relevance_score: .scoring_v9.relevance_score,
    relevance_type: .scoring_v9.relevance_type,
    food: .scoring_v9.food,
    vibe: .scoring_v9.vibe,
    service: .scoring_v9.service,
    reputation: .scoring_v9.reputation,
    convenience: .scoring_v9.convenience,
    queue_top5: [.ranked_queue[:5][]? | {name: .restaurant, dm: .donde_match, cuisine: .scoring_v9.relevance_type}]
  }" 2>/dev/null)

  if [ "$first" = true ]; then
    first=false
  else
    echo "," >> "$OUTPUT_FILE"
  fi
  echo "$result" >> "$OUTPUT_FILE"
done

echo "]" >> "$OUTPUT_FILE"

echo "" >&2
echo "Results written to $OUTPUT_FILE" >&2
echo "Summary:" >&2
cat "$OUTPUT_FILE" | jq -r '.[] | "\(.query_num). \(.query) => \(.primary_name) (\(.primary_cuisine)) DM=\(.donde_match) rel=\(.relevance_score) type=\(.relevance_type)"'
