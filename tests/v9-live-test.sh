#!/usr/bin/env bash
# V9 Live API Test — 20 complex cases including momo/brewery case studies
# Tests the deployed V9 engine via the live Supabase Edge Function

set -euo pipefail

API_URL="https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnprZ3N4bWd3Y3ZtdnV4bmJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NjUzNTYsImV4cCI6MjA4NTU0MTM1Nn0.YBhmusYxc28TD5FOZv4TBpFpDVHHk1V894wUkNtJtcc"

PASS=0
FAIL=0
WARN=0
TOTAL=0
RESULTS=()

call_api() {
  local body="$1"
  curl -s -w "\n%{http_code}" \
    -X POST "$API_URL" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "$body" \
    --max-time 20
}

run_test() {
  local test_num="$1"
  local label="$2"
  local body="$3"
  local expect_name="$4"        # substring match on restaurant name (case-insensitive), or "" to skip
  local expect_cuisine="$5"     # substring match on cuisine_type, or "" to skip
  local min_dm="$6"             # minimum donde_match, or 0 to skip
  local expect_relevance="$7"   # expected relevance_type, or "" to skip

  TOTAL=$((TOTAL + 1))
  printf "\n━━━ Test %02d: %s ━━━\n" "$test_num" "$label"

  local response
  response=$(call_api "$body" 2>/dev/null) || { echo "  ❌ CURL FAILED"; FAIL=$((FAIL+1)); RESULTS+=("❌ $test_num $label — curl failed"); return; }

  local http_code
  http_code=$(echo "$response" | tail -1)
  local json
  json=$(echo "$response" | sed '$d')

  if [[ "$http_code" != "200" ]]; then
    echo "  ❌ HTTP $http_code"
    FAIL=$((FAIL+1))
    RESULTS+=("❌ $test_num $label — HTTP $http_code")
    return
  fi

  local success name cuisine dm engine rel_type rel_score quality rec
  success=$(echo "$json" | jq -r '.success // false')
  name=$(echo "$json" | jq -r '.restaurant.name // "unknown"')
  cuisine=$(echo "$json" | jq -r '.restaurant.cuisine_type // "null"')
  dm=$(echo "$json" | jq -r '.donde_match // 0')
  engine=$(echo "$json" | jq -r '.scoring_v9 // empty | "v9"' 2>/dev/null || echo "missing")
  rel_type=$(echo "$json" | jq -r '.scoring_v9.relevance_type // "unknown"')
  rel_score=$(echo "$json" | jq -r '.scoring_v9.relevance_score // 0')
  quality=$(echo "$json" | jq -r '.scoring_v9.quality_score // 0')
  rec=$(echo "$json" | jq -r '.recommendation // ""' | head -c 120)
  local queue_size
  queue_size=$(echo "$json" | jq -r '.ranked_queue | length // 0' 2>/dev/null || echo "0")
  local narrative_summary
  narrative_summary=$(echo "$json" | jq -r '.match_narrative.summary // "none"' | head -c 100)
  local food vibe service reputation convenience
  food=$(echo "$json" | jq -r '.scoring_v9.food // "-"')
  vibe=$(echo "$json" | jq -r '.scoring_v9.vibe // "-"')
  service=$(echo "$json" | jq -r '.scoring_v9.service // "-"')
  reputation=$(echo "$json" | jq -r '.scoring_v9.reputation // "-"')
  convenience=$(echo "$json" | jq -r '.scoring_v9.convenience // "-"')

  if [[ "$success" != "true" ]]; then
    echo "  ❌ success=false"
    FAIL=$((FAIL+1))
    RESULTS+=("❌ $test_num $label — success=false")
    return
  fi

  # Print results
  printf "  Restaurant: %s\n" "$name"
  printf "  Cuisine:    %s\n" "$cuisine"
  printf "  DM: %s | Relevance: %s (%s) | Quality: %s\n" "$dm" "$rel_type" "$rel_score" "$quality"
  printf "  Factors: F=%s V=%s S=%s R=%s C=%s\n" "$food" "$vibe" "$service" "$reputation" "$convenience"
  printf "  Queue: %s items | Narrative: %s\n" "$queue_size" "$narrative_summary"
  printf "  Rec: %s...\n" "$rec"

  # Scoring_v9 present?
  if [[ "$engine" == "missing" ]]; then
    echo "  ⚠️  WARN: scoring_v9 missing from response"
    WARN=$((WARN+1))
    RESULTS+=("⚠️  $test_num $label — scoring_v9 missing (DM=$dm, name=$name)")
    return
  fi

  # Assertions
  local failed=0
  local warnings=0

  # Name check
  if [[ -n "$expect_name" ]]; then
    if echo "$name" | grep -qi "$expect_name"; then
      printf "  ✅ Name contains '%s'\n" "$expect_name"
    else
      printf "  ❌ Expected name containing '%s', got '%s'\n" "$expect_name" "$name"
      failed=1
    fi
  fi

  # Cuisine check
  if [[ -n "$expect_cuisine" ]]; then
    if echo "$cuisine" | grep -qi "$expect_cuisine"; then
      printf "  ✅ Cuisine contains '%s'\n" "$expect_cuisine"
    else
      printf "  ⚠️  Expected cuisine '%s', got '%s'\n" "$expect_cuisine" "$cuisine"
      warnings=1
    fi
  fi

  # DondeMatch minimum
  if [[ "$min_dm" -gt 0 ]]; then
    if [[ "$dm" -ge "$min_dm" ]]; then
      printf "  ✅ DM=%s >= %s\n" "$dm" "$min_dm"
    else
      printf "  ⚠️  DM=%s < %s (below target)\n" "$dm" "$min_dm"
      warnings=1
    fi
  fi

  # Relevance type check
  if [[ -n "$expect_relevance" ]]; then
    if [[ "$rel_type" == "$expect_relevance" ]]; then
      printf "  ✅ Relevance type = %s\n" "$rel_type"
    else
      printf "  ⚠️  Expected relevance '%s', got '%s'\n" "$expect_relevance" "$rel_type"
      warnings=1
    fi
  fi

  if [[ "$failed" -eq 1 ]]; then
    FAIL=$((FAIL+1))
    RESULTS+=("❌ $test_num $label — DM=$dm, name=$name, rel=$rel_type($rel_score)")
  elif [[ "$warnings" -gt 0 ]]; then
    WARN=$((WARN+1))
    RESULTS+=("⚠️  $test_num $label — DM=$dm, name=$name, rel=$rel_type($rel_score)")
  else
    PASS=$((PASS+1))
    RESULTS+=("✅ $test_num $label — DM=$dm, name=$name, rel=$rel_type($rel_score)")
  fi
}

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       V9 LIVE API TEST — 20 Complex Cases                  ║"
echo "║       Testing: Relevance × Quality scoring engine           ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ═══════════════════════════════════════════
# CASE STUDIES FROM USER TESTING (must fix)
# ═══════════════════════════════════════════

run_test 1 "CASE STUDY: momo" \
  '{"special_request":"momo","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "momo" "" 50 "dish"

run_test 2 "CASE STUDY: brewery with a view" \
  '{"special_request":"brewery with a view","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "" "brew" 40 ""

run_test 3 "CASE STUDY: shawarma" \
  '{"special_request":"shawarma","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "" "" 50 "dish"

run_test 4 "CASE STUDY: dive bar" \
  '{"special_request":"dive bar","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "" "" 50 "vibe"

# ═══════════════════════════════════════════
# DISH-LEVEL QUERIES (V9 should excel here)
# ═══════════════════════════════════════════

run_test 5 "Specific dish: deep dish pizza" \
  '{"special_request":"deep dish pizza","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "" "" 60 "dish"

run_test 6 "Specific dish: birria tacos" \
  '{"special_request":"birria tacos","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "" "mexican" 50 "dish"

run_test 7 "Specific dish: ramen" \
  '{"special_request":"ramen","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "" "" 55 "dish"

# ═══════════════════════════════════════════
# CUISINE QUERIES (V9 relevance gate)
# ═══════════════════════════════════════════

run_test 8 "Cuisine: Ethiopian food" \
  '{"special_request":"Ethiopian food","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "" "ethiopian" 50 "cuisine"

run_test 9 "Cuisine: sushi in Lincoln Park" \
  '{"special_request":"sushi","occasion":"Date Night","neighborhood":"Lincoln Park","price_level":"Any"}' \
  "" "" 55 ""

run_test 10 "Cuisine: Thai food, spicy" \
  '{"special_request":"spicy Thai food","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "" "thai" 50 "cuisine"

# ═══════════════════════════════════════════
# VIBE QUERIES (V9 relevance: vibe type)
# ═══════════════════════════════════════════

run_test 11 "Vibe: rooftop drinks" \
  '{"special_request":"rooftop drinks","occasion":"Drinks","neighborhood":"Anywhere","price_level":"Any"}' \
  "" "" 45 ""

run_test 12 "Vibe: quiet romantic dinner" \
  '{"special_request":"quiet romantic dinner","occasion":"Date Night","neighborhood":"Anywhere","price_level":"$$$"}' \
  "" "" 55 ""

run_test 13 "Vibe: loud fun group dinner" \
  '{"special_request":"loud fun place for a group birthday","occasion":"Group Outing","neighborhood":"Anywhere","price_level":"Any"}' \
  "" "" 50 ""

# ═══════════════════════════════════════════
# COMPLEX / MULTI-SIGNAL QUERIES
# ═══════════════════════════════════════════

run_test 14 "Complex: vegan brunch with outdoor seating" \
  '{"special_request":"vegan brunch with outdoor seating","occasion":"Brunch","neighborhood":"Anywhere","price_level":"Any","dietary_restrictions":["vegan"]}' \
  "" "" 40 ""

run_test 15 "Complex: business lunch, impressive, downtown" \
  '{"special_request":"impressive business lunch","occasion":"Business","neighborhood":"The Loop","price_level":"$$$"}' \
  "" "" 50 ""

run_test 16 "Complex: late night tacos after bar" \
  '{"special_request":"late night tacos","occasion":"Any","neighborhood":"Anywhere","price_level":"$","time_of_day":"late_night"}' \
  "" "mexican" 45 ""

# ═══════════════════════════════════════════
# EDGE CASES (null cuisine_type, niche)
# ═══════════════════════════════════════════

run_test 17 "Edge: BYOB" \
  '{"special_request":"BYOB restaurant","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "" "" 40 ""

run_test 18 "Edge: hole in the wall" \
  '{"special_request":"hole in the wall","occasion":"Any","neighborhood":"Anywhere","price_level":"$"}' \
  "" "" 40 "vibe"

run_test 19 "Edge: Korean BBQ" \
  '{"special_request":"Korean BBQ","occasion":"Group Outing","neighborhood":"Anywhere","price_level":"Any"}' \
  "" "korean" 50 "cuisine"

run_test 20 "Edge: gluten free Italian" \
  '{"special_request":"Italian restaurant with gluten free options","occasion":"Date Night","neighborhood":"Anywhere","price_level":"$$","dietary_restrictions":["gluten-free"]}' \
  "" "italian" 45 "cuisine"

# ═══════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    RESULTS SUMMARY                          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

for r in "${RESULTS[@]}"; do
  echo "  $r"
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "  PASS: %d  |  WARN: %d  |  FAIL: %d  |  TOTAL: %d\n" "$PASS" "$WARN" "$FAIL" "$TOTAL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ "$FAIL" -gt 0 ]]; then
  echo "  ⛔ $FAIL test(s) FAILED"
  exit 1
else
  echo "  ✅ All tests passed ($WARN warnings)"
  exit 0
fi
