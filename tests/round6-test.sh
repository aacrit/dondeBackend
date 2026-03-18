#!/bin/bash
# Round 6 Subjective Engine Test — 25 queries
set -euo pipefail

source /home/aacrit/projects/dondeBackend/.env

QUERIES=(
  # Pattern A: Price-sensitive (5)
  "best cheap eats in Chicago"
  "best fine dining experience"
  "best Michelin star restaurant"
  "best affordable date night"
  "best splurge-worthy restaurant"
  # Pattern B: Time-of-day / occasion edge cases (5)
  "best breakfast spot"
  "best happy hour"
  "best after-work drinks and food"
  "best Sunday brunch"
  "best dessert restaurant"
  # Pattern C: Dietary restriction queries (5)
  "best vegan restaurant"
  "best gluten free restaurant"
  "best halal restaurant"
  "best kosher restaurant"
  "best vegetarian friendly"
  # Pattern D: Specific restaurant style/format (5)
  "best food truck"
  "best buffet"
  "best tasting menu"
  "best omakase"
  "best prix fixe"
  # Pattern E: Cultural/community queries (5)
  "best soul food"
  "best Chinatown dim sum"
  "best Little Village Mexican"
  "best Devon Avenue Indian"
  "best Argyle Street Vietnamese"
)

echo "["
first=true
for q in "${QUERIES[@]}"; do
  if [ "$first" = true ]; then
    first=false
  else
    echo ","
  fi

  RESPONSE=$(curl -s -X POST "$SUPAB_URL/functions/v1/recommend" \
    -H "Authorization: Bearer $SUPAB_ANON_KEY" \
    -H "apikey: $SUPAB_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"special_request\": \"$q\", \"occasion\": \"Any\", \"neighborhood\": \"Anywhere\", \"price_level\": \"Any\", \"skip_claude\": true, \"skip_google\": true}")

  echo "$RESPONSE" | jq --arg query "$q" '{
    query: $query,
    restaurant: .restaurant.name,
    cuisine: .restaurant.cuisine_type,
    neighborhood: .restaurant.neighborhood_name,
    price: .restaurant.price_level,
    dm: .donde_match,
    relevance_score: .scoring_v9.relevance_score,
    relevance_type: .scoring_v9.relevance_type,
    relevance_details: .scoring_v9.relevance_details,
    food: .scoring_v9.food,
    vibe: .scoring_v9.vibe,
    service: .scoring_v9.service,
    reputation: .scoring_v9.reputation,
    convenience: .scoring_v9.convenience,
    queue: [.ranked_queue[]? | {name: .restaurant, dm: .donde_match}][:5]
  }'
done
echo ""
echo "]"
