#!/bin/bash
# Generate ML training data from 150 subjective test queries
# Runs each query through the current engine and saves top-5 results

set -euo pipefail

# Load environment
source /home/aacrit/projects/dondeBackend/.env

OUTPUT_DIR="/home/aacrit/projects/dondeBackend/scripts/ml"
RAW_DIR="$OUTPUT_DIR/subjective-raw"
mkdir -p "$RAW_DIR"

SUPAB_URL="${SUPAB_URL}"
SUPAB_ANON_KEY="${SUPAB_ANON_KEY}"

# All 150 queries with metadata: "query|category|expected_cuisines|round"
declare -a QUERIES=(
  # R1 (25)
  "best Italian restaurant|cuisine|Italian|R1"
  "authentic Mexican food|cuisine|Mexican|R1"
  "best sushi|dish|Japanese|R1"
  "best Indian food|cuisine|Indian|R1"
  "best Thai food|cuisine|Thai|R1"
  "best Korean food|cuisine|Korean|R1"
  "best BBQ|cuisine|BBQ,American|R1"
  "best Chinese food|cuisine|Chinese|R1"
  "romantic dinner|vibe|Any|R1"
  "business lunch downtown|occasion|Any|R1"
  "family friendly restaurant|occasion|Any|R1"
  "birthday dinner|occasion|Any|R1"
  "solo dining|occasion|Any|R1"
  "best rooftop restaurant|vibe|Any|R1"
  "cozy restaurant|vibe|Any|R1"
  "best brunch|concept|Any|R1"
  "best steakhouse|cuisine|Steakhouse,American|R1"
  "hidden gem restaurant|vibe|Any|R1"
  "best restaurant in West Loop|neighborhood|Any|R1"
  "best restaurant in Logan Square|neighborhood|Any|R1"
  "best restaurant in Chinatown|neighborhood|Any|R1"
  "best deep dish pizza|dish|Italian,Pizza|R1"
  "best tacos|dish|Mexican|R1"
  "best ramen|dish|Japanese,Ramen|R1"
  "best burger|dish|American|R1"
  # R2 (25)
  "best Vietnamese food|cuisine|Vietnamese|R2"
  "best Japanese food|cuisine|Japanese|R2"
  "best Ethiopian food|cuisine|Ethiopian|R2"
  "best Peruvian food|cuisine|Peruvian|R2"
  "best Greek food|cuisine|Greek|R2"
  "best Filipino food|cuisine|Filipino|R2"
  "best Lebanese food|cuisine|Lebanese|R2"
  "best Polish food|cuisine|Polish|R2"
  "best gyoza|dish|Japanese|R2"
  "best pho|dish|Vietnamese|R2"
  "best al pastor tacos|dish|Mexican|R2"
  "best chicken wings|dish|American|R2"
  "best dim sum|dish|Chinese|R2"
  "best pierogi|dish|Polish|R2"
  "best lobster roll|dish|Seafood,American|R2"
  "best Nashville hot chicken|dish|American,Southern|R2"
  "best restaurant in Lincoln Park|neighborhood|Any|R2"
  "best restaurant in Wicker Park|neighborhood|Any|R2"
  "best restaurant in River North|neighborhood|Any|R2"
  "best restaurant in Pilsen|neighborhood|Any|R2"
  "best restaurant in Andersonville|neighborhood|Any|R2"
  "best patio restaurant|vibe|Any|R2"
  "best restaurant with live music|vibe|Any|R2"
  "best late night food|concept|Any|R2"
  "best outdoor dining|vibe|Any|R2"
  # R3 (25)
  "best empanadas|dish|Latin American,Argentine|R3"
  "best banh mi|dish|Vietnamese|R3"
  "best falafel|dish|Middle Eastern|R3"
  "best elote|dish|Mexican|R3"
  "best ceviche|dish|Peruvian,Latin American|R3"
  "best jerk chicken|dish|Jamaican,Caribbean|R3"
  "best bibimbap|dish|Korean|R3"
  "best pupusa|dish|Salvadoran,Central American|R3"
  "best Moroccan food|cuisine|Moroccan|R3"
  "best Colombian food|cuisine|Colombian|R3"
  "best Taiwanese food|cuisine|Taiwanese|R3"
  "best Cuban food|cuisine|Cuban|R3"
  "best Burmese food|cuisine|Burmese|R3"
  "best Afghan food|cuisine|Afghan|R3"
  "best Jamaican food|cuisine|Jamaican|R3"
  "best waterfront restaurant|vibe|Any|R3"
  "best fireplace restaurant|vibe|Any|R3"
  "best private dining|vibe|Any|R3"
  "best quiet restaurant for conversation|vibe|Any|R3"
  "best restaurant with a view|vibe|Any|R3"
  "best speakeasy|vibe|Any|R3"
  "best restaurant in Hyde Park|neighborhood|Any|R3"
  "best restaurant in Humboldt Park|neighborhood|Any|R3"
  "best restaurant in Bridgeport|neighborhood|Any|R3"
  "best restaurant in Uptown|neighborhood|Any|R3"
  # R4 (25)
  "best croissant|dish|French,Bakery|R4"
  "best arepa|dish|Venezuelan,Colombian|R4"
  "best tamales|dish|Mexican|R4"
  "best dumplings|dish|Chinese,Asian|R4"
  "best gelato|dish|Italian|R4"
  "best fried chicken|dish|American,Southern|R4"
  "best fish tacos|dish|Mexican,Seafood|R4"
  "best shawarma|dish|Middle Eastern|R4"
  "best bao buns|dish|Chinese,Taiwanese|R4"
  "best carnitas|dish|Mexican|R4"
  "best restaurant in Ravenswood|neighborhood|Any|R4"
  "best restaurant in Ukrainian Village|neighborhood|Any|R4"
  "best restaurant in Albany Park|neighborhood|Any|R4"
  "best restaurant in Edgewater|neighborhood|Any|R4"
  "best restaurant in Little Italy|neighborhood|Any|R4"
  "best Senegalese food|cuisine|Senegalese|R4"
  "best Haitian food|cuisine|Haitian|R4"
  "best Cambodian food|cuisine|Cambodian|R4"
  "best Uzbek food|cuisine|Uzbek|R4"
  "best Sri Lankan food|cuisine|Sri Lankan|R4"
  "cheap late night tacos|concept|Mexican|R4"
  "upscale sushi for a date|concept|Japanese|R4"
  "family friendly Italian near Lincoln Park|concept|Italian|R4"
  "best cocktails and small plates|concept|Any|R4"
  "casual brunch with outdoor seating|concept|Any|R4"
  # R5 (25)
  "best hot dog|dish|American|R5"
  "best donut|dish|Bakery|R5"
  "best bagel|dish|Bakery|R5"
  "best slice of pizza|dish|Italian,Pizza|R5"
  "best torta|dish|Mexican|R5"
  "best Italian beef|dish|Italian,American|R5"
  "best gyro|dish|Greek,Middle Eastern|R5"
  "best ice cream|dish|Dessert|R5"
  "best cookie|dish|Bakery|R5"
  "best poke bowl|dish|Hawaiian,Japanese|R5"
  "romantic wine bar|vibe|Any|R5"
  "fun group dinner spot|occasion|Any|R5"
  "trendy new restaurant|vibe|Any|R5"
  "quiet coffee shop for work|vibe|Any|R5"
  "lively sports bar with good food|vibe|Any|R5"
  "best restaurant in Bronzeville|neighborhood|Any|R5"
  "best restaurant in Rogers Park|neighborhood|Any|R5"
  "best restaurant in Irving Park|neighborhood|Any|R5"
  "best restaurant in North Center|neighborhood|Any|R5"
  "best restaurant in Old Town|neighborhood|Any|R5"
  "best Venezuelan food|cuisine|Venezuelan|R5"
  "best Tibetan food|cuisine|Tibetan|R5"
  "best Eritrean food|cuisine|Eritrean|R5"
  "best Laotian food|cuisine|Laotian|R5"
  "best Trinidadian food|cuisine|Trinidadian|R5"
  # R6 (25)
  "best cheap eats in Chicago|concept|Any|R6"
  "best fine dining experience|concept|Any|R6"
  "best Michelin star restaurant|concept|Any|R6"
  "best affordable date night|concept|Any|R6"
  "best splurge-worthy restaurant|concept|Any|R6"
  "best breakfast spot|concept|Any|R6"
  "best happy hour|concept|Any|R6"
  "best after-work drinks and food|concept|Any|R6"
  "best Sunday brunch|concept|Any|R6"
  "best dessert restaurant|concept|Any|R6"
  "best vegan restaurant|dietary|Any|R6"
  "best gluten free restaurant|dietary|Any|R6"
  "best halal restaurant|dietary|Any|R6"
  "best kosher restaurant|dietary|Any|R6"
  "best vegetarian friendly|dietary|Any|R6"
  "best food truck|format|Any|R6"
  "best buffet|format|Any|R6"
  "best tasting menu|format|Any|R6"
  "best omakase|format|Japanese|R6"
  "best prix fixe|format|Any|R6"
  "best soul food|cuisine|Soul Food,Southern|R6"
  "best Chinatown dim sum|dish|Chinese|R6"
  "best Little Village Mexican|cuisine|Mexican|R6"
  "best Devon Avenue Indian|cuisine|Indian|R6"
  "best Argyle Street Vietnamese|cuisine|Vietnamese|R6"
)

echo "=== Generating Subjective Training Data ==="
echo "Total queries: ${#QUERIES[@]}"
echo "Output: $RAW_DIR"
echo ""

QUERY_ID=0
FAILED=0
SUCCESS=0

for entry in "${QUERIES[@]}"; do
  IFS='|' read -r query category expected_cuisines round <<< "$entry"
  QUERY_ID=$((QUERY_ID + 1))

  # Create safe filename
  safe_name=$(echo "$query" | tr ' ' '_' | tr -cd '[:alnum:]_' | head -c 60)
  outfile="$RAW_DIR/${QUERY_ID}_${safe_name}.json"

  # Skip if already fetched
  if [ -f "$outfile" ] && [ -s "$outfile" ]; then
    # Verify it's valid JSON with ranked_queue
    if jq -e '.ranked_queue' "$outfile" > /dev/null 2>&1; then
      SUCCESS=$((SUCCESS + 1))
      echo "[$QUERY_ID/150] SKIP (cached): $query"
      continue
    fi
  fi

  echo -n "[$QUERY_ID/150] $query ... "

  # Call the engine
  response=$(curl -s --max-time 30 -X POST "$SUPAB_URL/functions/v1/recommend" \
    -H "Authorization: Bearer $SUPAB_ANON_KEY" \
    -H "apikey: $SUPAB_ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"special_request\": \"$query\", \"skip_claude\": true, \"skip_google\": true}" 2>&1) || true

  if echo "$response" | jq -e '.ranked_queue' > /dev/null 2>&1; then
    echo "$response" > "$outfile"
    dm=$(echo "$response" | jq -r '.donde_match // "?"')
    queue_len=$(echo "$response" | jq -r '.ranked_queue | length')
    top_name=$(echo "$response" | jq -r '.restaurant.name // "?"')
    echo "OK (DM=$dm, queue=$queue_len, top=$top_name)"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "FAIL"
    echo "$response" > "$outfile.err"
    FAILED=$((FAILED + 1))
  fi

  # Small delay to avoid rate limiting
  sleep 0.3
done

echo ""
echo "=== Complete ==="
echo "Success: $SUCCESS / 150"
echo "Failed: $FAILED / 150"
echo "Raw files: $RAW_DIR"
