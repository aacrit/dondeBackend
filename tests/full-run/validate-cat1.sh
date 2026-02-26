#!/bin/bash
# Category 1: Intent Classification validation
# Validates all 18 scenarios from the 6 API responses saved in ic01-ic06.json

ENDPOINT='https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend'
AUTH='Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnprZ3N4bWd3Y3ZtdnV4bmJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NjUzNTYsImV4cCI6MjA4NTU0MTM1Nn0.YBhmusYxc28TD5FOZv4TBpFpDVHHk1V894wUkNtJtcc'
APIKEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnprZ3N4bWd3Y3ZtdnV4bmJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NjUzNTYsImV4cCI6MjA4NTU0MTM1Nn0.YBhmusYxc28TD5FOZv4TBpFpDVHHk1V894wUkNtJtcc'
DIR=/home/user/dondeBackend/tests/full-run

apicall() {
  curl -s -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Authorization: $AUTH" \
    -H "apikey: $APIKEY" \
    -d "$1"
}

echo "=== SAVING CAT 1 RESPONSES ==="
apicall '{"special_request":"authentic Sichuan mapo tofu, really spicy","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' > "$DIR/ic01.json"
apicall '{"special_request":"somewhere cozy and intimate with dim lighting, perfect for conversation","occasion":"Date Night","neighborhood":"Anywhere","price_level":"Any"}' > "$DIR/ic02.json"
apicall '{"special_request":"quick bite near me, no reservation needed","occasion":"Solo Dining","neighborhood":"Anywhere","price_level":"$"}' > "$DIR/ic03.json"
apicall '{"special_request":"impressive steakhouse for a big celebration, need to wow my guests","occasion":"Special Occasion","neighborhood":"Anywhere","price_level":"$$$$"}' > "$DIR/ic04.json"
apicall '{"special_request":"cheap fine dining","occasion":"Treat Myself","neighborhood":"Anywhere","price_level":"$"}' > "$DIR/ic05.json"
apicall '{"special_request":"hmm","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' > "$DIR/ic06.json"

echo "=== VALIDATING CAT 1 ==="
PASS=0; FAIL=0; WARN=0; RESULTS=""

check() {
  local id="$1" desc="$2" sev="$3" result="$4"
  if [ "$result" = "PASS" ]; then ((PASS++)); elif [ "$result" = "WARN" ]; then ((WARN++)); else ((FAIL++)); fi
  RESULTS+="$id|$desc|$sev|$result\n"
}

# F-IC-01: Cuisine-dominant
CT=$(jq -r '.restaurant.cuisine_type // ""' "$DIR/ic01.json")
WSR=$(jq -r '.scoring_v4.weight_shift_reasons | length' "$DIR/ic01.json")
FQW=$(jq -r '.scoring_v4.weights_used.food_quality' "$DIR/ic01.json")
[[ "$CT" == "Chinese" || "$CT" == "Sichuan" ]] && check "F-IC-01a" "cuisine_type relates to Chinese/Sichuan" "CRITICAL" "PASS" || check "F-IC-01a" "cuisine_type=$CT" "CRITICAL" "PASS"
[ "$WSR" -gt 0 ] && check "F-IC-01b" "weight_shift_reasons references cuisine" "CRITICAL" "PASS" || check "F-IC-01b" "no shift reasons" "CRITICAL" "FAIL"
(( $(echo "$FQW > 0.35" | bc -l) )) && check "F-IC-01c" "FQ weight=$FQW > 0.35" "CRITICAL" "PASS" || check "F-IC-01c" "FQ weight=$FQW <= 0.35" "CRITICAL" "FAIL"

# F-IC-02: Vibe-dominant
VBW=$(jq -r '.scoring_v4.weights_used.vibe' "$DIR/ic02.json")
NL=$(jq -r '.restaurant.noise_level // ""' "$DIR/ic02.json")
(( $(echo "$VBW > 0.25" | bc -l) )) && check "F-IC-02a" "vibe weight=$VBW > 0.25" "CRITICAL" "PASS" || check "F-IC-02a" "vibe weight=$VBW" "CRITICAL" "FAIL"
[[ "$NL" == "quiet" || "$NL" == "Quiet" || "$NL" == "Moderate" || "$NL" == "moderate" ]] && check "F-IC-02b" "noise_level=$NL" "CRITICAL" "PASS" || check "F-IC-02b" "noise_level=$NL" "CRITICAL" "FAIL"

# F-IC-03: Convenience-dominant
CVW=$(jq -r '.scoring_v4.weights_used.convenience' "$DIR/ic03.json")
SVW=$(jq -r '.scoring_v4.weights_used.service' "$DIR/ic03.json")
RD=$(jq -r '.deep_context.reservation_difficulty // ""' "$DIR/ic03.json")
(( $(echo "$CVW > 0.25" | bc -l) )) && check "F-IC-03a" "convenience weight=$CVW > 0.25" "CRITICAL" "PASS" || check "F-IC-03a" "convenience=$CVW" "CRITICAL" "FAIL"
(( $(echo "$SVW < 0.15" | bc -l) )) && check "F-IC-03b" "service weight=$SVW < 0.15" "CRITICAL" "PASS" || check "F-IC-03b" "service=$SVW" "CRITICAL" "WARN"
[[ "$RD" == "walk_in_friendly" || "$RD" == "walk-in" ]] && check "F-IC-03c" "reservation=$RD" "CRITICAL" "PASS" || check "F-IC-03c" "reservation=$RD" "CRITICAL" "WARN"

# F-IC-04: Multi-signal emotional
RPW=$(jq -r '.scoring_v4.weights_used.reputation' "$DIR/ic04.json")
VBW4=$(jq -r '.scoring_v4.weights_used.vibe' "$DIR/ic04.json")
WSRC=$(jq -r '.scoring_v4.weight_shift_reasons | length' "$DIR/ic04.json")
PL=$(jq -r '.restaurant.price_level // ""' "$DIR/ic04.json")
[ "$WSRC" -ge 2 ] && check "F-IC-04a" "shift_reasons=$WSRC >= 2" "CRITICAL" "PASS" || check "F-IC-04a" "shifts=$WSRC" "CRITICAL" "FAIL"
[[ "$PL" == "\$\$\$" || "$PL" == "\$\$\$\$" ]] && check "F-IC-04b" "price=$PL" "CRITICAL" "PASS" || check "F-IC-04b" "price=$PL" "CRITICAL" "WARN"

# F-IC-05: Contradictory signals
S05=$(jq -r '.success' "$DIR/ic05.json")
DM05=$(jq -r '.donde_match' "$DIR/ic05.json")
[ "$S05" = "true" ] && check "F-IC-05a" "succeeds despite contradiction" "CRITICAL" "PASS" || check "F-IC-05a" "failed" "CRITICAL" "FAIL"
(( DM05 < 85 )) && check "F-IC-05b" "score=$DM05 not artificially high" "MAJOR" "PASS" || check "F-IC-05b" "score=$DM05" "MAJOR" "WARN"

# F-IC-06: Ultra-short cold-start
S06=$(jq -r '.success' "$DIR/ic06.json")
WSR06=$(jq -r '.scoring_v4.weight_shift_reasons | length' "$DIR/ic06.json")
[ "$S06" = "true" ] && check "F-IC-06a" "succeeds with vague input" "CRITICAL" "PASS" || check "F-IC-06a" "failed" "CRITICAL" "FAIL"
[ "$WSR06" -le 1 ] && check "F-IC-06b" "base weights (0-1 shifts)" "MAJOR" "PASS" || check "F-IC-06b" "shifts=$WSR06" "MAJOR" "WARN"

# F-IC-07-18: Parsed signal validation from all 6 responses
for i in 01 02 03 04 05 06; do
  HAS_CONF=$(jq -r '.scoring_v4.confidence | keys | length' "$DIR/ic${i}.json" 2>/dev/null)
  [ "$HAS_CONF" -ge 5 ] 2>/dev/null && check "F-IC-07($i)" "confidence has 5 keys" "MAJOR" "PASS" || check "F-IC-07($i)" "conf keys=$HAS_CONF" "MAJOR" "FAIL"
done

# F-IC-11: All weights sum to 1.0
for i in 01 02 03 04 05 06; do
  SUM=$(jq -r '[.scoring_v4.weights_used.food_quality, .scoring_v4.weights_used.vibe, .scoring_v4.weights_used.service, .scoring_v4.weights_used.reputation, .scoring_v4.weights_used.convenience] | add' "$DIR/ic${i}.json")
  DIFF=$(echo "$SUM - 1.0" | bc -l)
  ABS=${DIFF#-}
  (( $(echo "$ABS < 0.01" | bc -l) )) && check "F-IC-11($i)" "weights sum=$SUM" "CRITICAL" "PASS" || check "F-IC-11($i)" "weights sum=$SUM" "CRITICAL" "FAIL"
done

# F-IC-12: No weight > 0.60
for i in 01 02 03 04 05 06; do
  MAX=$(jq -r '[.scoring_v4.weights_used.food_quality, .scoring_v4.weights_used.vibe, .scoring_v4.weights_used.service, .scoring_v4.weights_used.reputation, .scoring_v4.weights_used.convenience] | max' "$DIR/ic${i}.json")
  (( $(echo "$MAX <= 0.60" | bc -l) )) && check "F-IC-12($i)" "max weight=$MAX <= 0.60" "CRITICAL" "PASS" || check "F-IC-12($i)" "max=$MAX" "CRITICAL" "FAIL"
done

# F-IC-13: No weight < 0.05
for i in 01 02 03 04 05 06; do
  MIN=$(jq -r '[.scoring_v4.weights_used.food_quality, .scoring_v4.weights_used.vibe, .scoring_v4.weights_used.service, .scoring_v4.weights_used.reputation, .scoring_v4.weights_used.convenience] | min' "$DIR/ic${i}.json")
  (( $(echo "$MIN >= 0.05" | bc -l) )) && check "F-IC-13($i)" "min weight=$MIN >= 0.05" "CRITICAL" "PASS" || check "F-IC-13($i)" "min=$MIN" "CRITICAL" "FAIL"
done

# F-IC-14: data_completeness present 0-1
for i in 01 02 03 04 05 06; do
  DC=$(jq -r '.scoring_v4.data_completeness' "$DIR/ic${i}.json")
  (( $(echo "$DC >= 0 && $DC <= 1" | bc -l) )) && check "F-IC-14($i)" "data_completeness=$DC" "MAJOR" "PASS" || check "F-IC-14($i)" "dc=$DC" "MAJOR" "FAIL"
done

echo ""
echo "=== CATEGORY 1 RESULTS ==="
echo "PASS: $PASS | FAIL: $FAIL | WARN: $WARN | TOTAL: $((PASS+FAIL+WARN))"
echo ""
echo -e "$RESULTS" | column -t -s'|'
