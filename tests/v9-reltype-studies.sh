#!/usr/bin/env bash
# V9 Relevance Type Case Studies — 10 realistic user inputs
# Focus: Does the engine correctly classify intent across varied input styles?
set -euo pipefail

API_URL="https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnprZ3N4bWd3Y3ZtdnV4bmJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NjUzNTYsImV4cCI6MjA4NTU0MTM1Nn0.YBhmusYxc28TD5FOZv4TBpFpDVHHk1V894wUkNtJtcc"

ISSUES=()
CASE=0

call_api() {
  curl -s -w "\n%{http_code}" \
    -X POST "$API_URL" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "$1" \
    --max-time 25
}

run() {
  local num="$1" label="$2" body="$3" expect_rel="$4" why="$5"
  CASE=$((CASE + 1))

  printf "\n\033[1;36m━━━ Case %02d: %s ━━━\033[0m\n" "$num" "$label"
  printf "  🎯 Expected: \033[1m%s\033[0m — %s\n" "$expect_rel" "$why"

  local response
  response=$(call_api "$body" 2>/dev/null) || { echo "  ❌ CURL FAILED"; ISSUES+=("$num|$label|CURL_FAIL|$expect_rel|-|-|-|-|-"); return; }

  local http_code
  http_code=$(echo "$response" | tail -1)
  local json
  json=$(echo "$response" | sed '$d')

  if [[ "$http_code" != "200" ]]; then
    echo "  ❌ HTTP $http_code"
    ISSUES+=("$num|$label|HTTP_$http_code|$expect_rel|-|-|-|-|-")
    return
  fi

  local success
  success=$(echo "$json" | jq -r '.success // false')
  if [[ "$success" != "true" ]]; then
    echo "  ❌ success=false"
    ISSUES+=("$num|$label|FAIL|$expect_rel|-|-|-|-|-")
    return
  fi

  local name cuisine dm rel_type rel_score rel_details quality occ_bonus
  name=$(echo "$json" | jq -r '.restaurant.name // "?"')
  cuisine=$(echo "$json" | jq -r '.restaurant.cuisine_type // "null"')
  dm=$(echo "$json" | jq -r '.donde_match // 0')
  rel_type=$(echo "$json" | jq -r '.scoring_v9.relevance_type // "?"')
  rel_score=$(echo "$json" | jq -r '.scoring_v9.relevance_score // 0')
  rel_details=$(echo "$json" | jq -r '.scoring_v9.relevance_details // ""' | head -c 120)
  quality=$(echo "$json" | jq -r '.scoring_v9.quality_score // 0')
  occ_bonus=$(echo "$json" | jq -r '.scoring_v9.occasion_bonus // 0')

  local food vibe service reputation convenience
  food=$(echo "$json" | jq -r '.scoring_v9.food // "-"')
  vibe=$(echo "$json" | jq -r '.scoring_v9.vibe // "-"')
  service=$(echo "$json" | jq -r '.scoring_v9.service // "-"')
  reputation=$(echo "$json" | jq -r '.scoring_v9.reputation // "-"')
  convenience=$(echo "$json" | jq -r '.scoring_v9.convenience // "-"')

  local w_food w_vibe w_svc w_rep w_conv
  w_food=$(echo "$json" | jq -r '.scoring_v9.weights_used.food // "-"')
  w_vibe=$(echo "$json" | jq -r '.scoring_v9.weights_used.vibe // "-"')
  w_svc=$(echo "$json" | jq -r '.scoring_v9.weights_used.service // "-"')
  w_rep=$(echo "$json" | jq -r '.scoring_v9.weights_used.reputation // "-"')
  w_conv=$(echo "$json" | jq -r '.scoring_v9.weights_used.convenience // "-"')

  local boost_active boost_reason
  boost_active=$(echo "$json" | jq -r '.intent_boost.active // false')
  boost_reason=$(echo "$json" | jq -r '.intent_boost.reason // "-"' | head -c 120)

  local narrative_summary key_signals
  narrative_summary=$(echo "$json" | jq -r '.match_narrative.summary // "-"' | head -c 120)
  key_signals=$(echo "$json" | jq -r '[.match_narrative.key_signals // [] | .[]] | join("; ")' | head -c 150)

  local rec
  rec=$(echo "$json" | jq -r '.recommendation // ""' | head -c 120)

  local queue_size
  queue_size=$(echo "$json" | jq -r '.ranked_queue | length' 2>/dev/null || echo "0")

  # Print trace
  printf "\n  \033[1m🏪 %s\033[0m (%s)\n" "$name" "$cuisine"
  printf "  \033[1;33m⭐ DM: %s\033[0m  |  Rel: \033[1m%s\033[0m %s  |  Quality: %s/100  |  Bonus: %s\n" \
    "$dm" "$rel_type" "$rel_score" "$quality" "$occ_bonus"
  printf "  📊 F=%-4s R=%-4s V=%-4s S=%-4s C=%-4s\n" "$food" "$reputation" "$vibe" "$service" "$convenience"
  printf "  ⚖️  w: F=%-4s R=%-4s V=%-4s S=%-4s C=%-4s\n" "$w_food" "$w_rep" "$w_vibe" "$w_svc" "$w_conv"
  printf "  📖 %s\n" "$rel_details"
  printf "  💬 %s\n" "$narrative_summary"
  printf "  🔑 %s\n" "$key_signals"
  if [[ "$boost_active" == "true" ]]; then
    printf "  ⚡ BOOST: %s\n" "$boost_reason"
  fi
  printf "  📋 Queue: %s | Rec: %s...\n" "$queue_size" "$(echo "$rec" | head -c 80)"

  # Assertion: relevance type
  if [[ "$rel_type" == "$expect_rel" ]]; then
    printf "  \033[1;32m✅ Relevance type CORRECT: %s\033[0m\n" "$rel_type"
  else
    printf "  \033[1;31m❌ Relevance type WRONG: expected %s, got %s\033[0m\n" "$expect_rel" "$rel_type"
    ISSUES+=("$num|$label|REL_MISMATCH|$expect_rel|$rel_type|$rel_score|$dm|$name|$cuisine")
  fi

  # Warning: low DondeMatch
  if [[ "$dm" -lt 40 ]]; then
    printf "  \033[1;33m⚠️  DM=%s is very low\033[0m\n" "$dm"
    ISSUES+=("$num|$label|LOW_DM|$expect_rel|$rel_type|$rel_score|$dm|$name|$cuisine")
  fi
}

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   V9 RELEVANCE TYPE CASE STUDIES — 10 Realistic Inputs     ║"
echo "║   Covering: dish / cuisine / vibe / open_ended              ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ═══════════════════════════════════════════════════
# DISH TYPE — specific food items, natural phrasing
# ═══════════════════════════════════════════════════

run 1 "Quick dish: 'al pastor'" \
  '{"special_request":"al pastor","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "dish" "Two-word dish name, no context — pure dish intent"

run 2 "Long sentence: 'I want some really good soup dumplings, the kind with the broth inside'" \
  '{"special_request":"I want some really good soup dumplings, the kind with the broth inside","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "dish" "Long natural sentence but core intent is a specific dish"

run 3 "Casual: 'craving birria tacos rn'" \
  '{"special_request":"craving birria tacos rn","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "dish" "Slang/casual but clear dish: birria tacos"

# ═══════════════════════════════════════════════════
# CUISINE TYPE — cuisine-level queries
# ═══════════════════════════════════════════════════

run 4 "Simple cuisine: 'Ethiopian'" \
  '{"special_request":"Ethiopian","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "cuisine" "Single word = exact cuisine name"

run 5 "Sentence cuisine: 'my girlfriend loves Thai food, something authentic not too touristy'" \
  '{"special_request":"my girlfriend loves Thai food, something authentic not too touristy","occasion":"Date Night","neighborhood":"Anywhere","price_level":"$$"}' \
  "cuisine" "Long sentence but core = Thai cuisine. Should NOT be dish-level"

run 6 "Multi-word: 'fancy Italian dinner for anniversary'" \
  '{"special_request":"fancy Italian dinner for anniversary","occasion":"Special Occasion","neighborhood":"Anywhere","price_level":"$$$$"}' \
  "cuisine" "Cuisine + occasion + vibe. 'dinner' is meal period, NOT a dish"

# ═══════════════════════════════════════════════════
# VIBE TYPE — atmosphere / experience queries
# ═══════════════════════════════════════════════════

run 7 "Pure vibe: 'chill spot'" \
  '{"special_request":"chill spot","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "vibe" "Two-word vibe query, no food/cuisine signal"

run 8 "Sentence vibe: 'somewhere dark and moody with great cocktails, like a speakeasy vibe'" \
  '{"special_request":"somewhere dark and moody with great cocktails, like a speakeasy vibe","occasion":"Drinks","neighborhood":"Anywhere","price_level":"$$$"}' \
  "vibe" "Long descriptive vibe query. No cuisine or dish mentioned"

# ═══════════════════════════════════════════════════
# OPEN-ENDED TYPE — no specific food/cuisine/vibe
# ═══════════════════════════════════════════════════

run 9 "Open: 'surprise me'" \
  '{"special_request":"surprise me","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "open_ended" "Classic open-ended — no signals at all"

run 10 "Conversational open: 'honestly idk what I want, just something good near me that won't break the bank'" \
  '{"special_request":"honestly idk what I want, just something good near me that wont break the bank","occasion":"Any","neighborhood":"Anywhere","price_level":"$$"}' \
  "open_ended" "Long conversational but zero food/vibe signal — should be open_ended"

# ═══════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════
echo ""
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    RESULTS SUMMARY                          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

if [[ ${#ISSUES[@]} -eq 0 ]]; then
  printf "  \033[1;32m✅ All %d cases passed — relevance type correct for all inputs\033[0m\n" "$CASE"
else
  printf "  \033[1;31m%d issue(s) found:\033[0m\n\n" "${#ISSUES[@]}"
  printf "  %-4s %-60s %-12s %-12s %-6s %-4s %-25s\n" "Case" "Label" "Expected" "Got" "RelSc" "DM" "Restaurant"
  printf "  %-4s %-60s %-12s %-12s %-6s %-4s %-25s\n" "----" "----" "--------" "---" "-----" "--" "----------"
  for issue in "${ISSUES[@]}"; do
    IFS='|' read -r num label kind expected got rel_sc dm rname rcuisine <<< "$issue"
    printf "  %-4s %-60s %-12s %-12s %-6s %-4s %s\n" "$num" "$label" "$expected" "$got" "$rel_sc" "$dm" "$rname"
  done
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "  Total: %d cases\n" "$CASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
