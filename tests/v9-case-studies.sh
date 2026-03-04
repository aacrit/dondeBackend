#!/usr/bin/env bash
# V9 Case Study Suite — 10 varied inputs with full pipeline tracing
# Traces: intent classification → relevance gate → quality factors → final score
set -euo pipefail

API_URL="https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3YnprZ3N4bWd3Y3ZtdnV4bmJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NjUzNTYsImV4cCI6MjA4NTU0MTM1Nn0.YBhmusYxc28TD5FOZv4TBpFpDVHHk1V894wUkNtJtcc"

PASS=0; WARN=0; FAIL=0; TOTAL=0
ISSUES=()

call_api() {
  curl -s -w "\n%{http_code}" \
    -X POST "$API_URL" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "$1" \
    --max-time 25
}

# ─── Trace a single case ───────────────────────────────────────
run_case() {
  local num="$1" label="$2" body="$3"
  local expect_rel_type="$4"   # dish|cuisine|vibe|open_ended or "" to skip
  local min_dm="$5"            # minimum donde_match or 0
  local expect_cuisine="$6"    # substring in cuisine_type or ""
  local notes="$7"             # what we're watching for

  TOTAL=$((TOTAL + 1))
  printf "\n\033[1;36m━━━ Case %02d: %s ━━━\033[0m\n" "$num" "$label"
  printf "  📝 %s\n" "$notes"

  local response
  response=$(call_api "$body" 2>/dev/null) || {
    echo "  ❌ CURL FAILED"
    FAIL=$((FAIL+1))
    ISSUES+=("Case $num ($label): curl failed")
    return
  }

  local http_code
  http_code=$(echo "$response" | tail -1)
  local json
  json=$(echo "$response" | sed '$d')

  if [[ "$http_code" != "200" ]]; then
    echo "  ❌ HTTP $http_code"
    FAIL=$((FAIL+1))
    ISSUES+=("Case $num ($label): HTTP $http_code")
    return
  fi

  local success
  success=$(echo "$json" | jq -r '.success // false')
  if [[ "$success" != "true" ]]; then
    local err_msg
    err_msg=$(echo "$json" | jq -r '.recommendation // "unknown error"' | head -c 200)
    echo "  ❌ success=false → $err_msg"
    FAIL=$((FAIL+1))
    ISSUES+=("Case $num ($label): success=false — $err_msg")
    return
  fi

  # ─── Extract all pipeline data ───
  local name cuisine dm
  name=$(echo "$json" | jq -r '.restaurant.name // "?"')
  cuisine=$(echo "$json" | jq -r '.restaurant.cuisine_type // "null"')
  dm=$(echo "$json" | jq -r '.donde_match // 0')

  # Relevance Gate
  local rel_type rel_score rel_details
  rel_type=$(echo "$json" | jq -r '.scoring_v9.relevance_type // "?"')
  rel_score=$(echo "$json" | jq -r '.scoring_v9.relevance_score // 0')
  rel_details=$(echo "$json" | jq -r '.scoring_v9.relevance_details // ""' | head -c 120)

  # Quality
  local quality occ_bonus data_comp
  quality=$(echo "$json" | jq -r '.scoring_v9.quality_score // 0')
  occ_bonus=$(echo "$json" | jq -r '.scoring_v9.occasion_bonus // 0')
  data_comp=$(echo "$json" | jq -r '.scoring_v9.data_completeness // 0')

  # Factor scores
  local food vibe service reputation convenience
  food=$(echo "$json" | jq -r '.scoring_v9.food // "-"')
  vibe=$(echo "$json" | jq -r '.scoring_v9.vibe // "-"')
  service=$(echo "$json" | jq -r '.scoring_v9.service // "-"')
  reputation=$(echo "$json" | jq -r '.scoring_v9.reputation // "-"')
  convenience=$(echo "$json" | jq -r '.scoring_v9.convenience // "-"')

  # Weights
  local w_food w_vibe w_svc w_rep w_conv
  w_food=$(echo "$json" | jq -r '.scoring_v9.weights_used.food // "-"')
  w_vibe=$(echo "$json" | jq -r '.scoring_v9.weights_used.vibe // "-"')
  w_svc=$(echo "$json" | jq -r '.scoring_v9.weights_used.service // "-"')
  w_rep=$(echo "$json" | jq -r '.scoring_v9.weights_used.reputation // "-"')
  w_conv=$(echo "$json" | jq -r '.scoring_v9.weights_used.convenience // "-"')

  # Confidence
  local conf_food conf_vibe conf_svc conf_rep conf_conv
  conf_food=$(echo "$json" | jq -r '.scoring_v9.confidence.food // "-"')
  conf_vibe=$(echo "$json" | jq -r '.scoring_v9.confidence.vibe // "-"')
  conf_svc=$(echo "$json" | jq -r '.scoring_v9.confidence.service // "-"')
  conf_rep=$(echo "$json" | jq -r '.scoring_v9.confidence.reputation // "-"')
  conf_conv=$(echo "$json" | jq -r '.scoring_v9.confidence.convenience // "-"')

  # Factor details (top signal per factor)
  local fd_food fd_vibe fd_svc fd_rep fd_conv
  fd_food=$(echo "$json" | jq -r '[.scoring_v9.factor_details.food // {} | to_entries[] | "\(.key)=\(.value.score)/\(.value.max)"] | join(", ")' 2>/dev/null || echo "-")
  fd_vibe=$(echo "$json" | jq -r '[.scoring_v9.factor_details.vibe // {} | to_entries[] | "\(.key)=\(.value.score)/\(.value.max)"] | join(", ")' 2>/dev/null || echo "-")
  fd_svc=$(echo "$json" | jq -r '[.scoring_v9.factor_details.service // {} | to_entries[] | "\(.key)=\(.value.score)/\(.value.max)"] | join(", ")' 2>/dev/null || echo "-")
  fd_rep=$(echo "$json" | jq -r '[.scoring_v9.factor_details.reputation // {} | to_entries[] | "\(.key)=\(.value.score)/\(.value.max)"] | join(", ")' 2>/dev/null || echo "-")
  fd_conv=$(echo "$json" | jq -r '[.scoring_v9.factor_details.convenience // {} | to_entries[] | "\(.key)=\(.value.score)/\(.value.max)"] | join(", ")' 2>/dev/null || echo "-")

  # Match narrative
  local strongest_factor narrative_summary key_signals weak_spots
  strongest_factor=$(echo "$json" | jq -r '.match_narrative.strongest_factor // "-"')
  narrative_summary=$(echo "$json" | jq -r '.match_narrative.summary // "-"' | head -c 120)
  key_signals=$(echo "$json" | jq -r '[.match_narrative.key_signals // [] | .[]] | join("; ")' | head -c 150)
  weak_spots=$(echo "$json" | jq -r '[.match_narrative.weak_spots // [] | .[]] | join("; ")' | head -c 100)

  # Deep context highlights
  local sig_dishes deep_service_style deep_reservation
  sig_dishes=$(echo "$json" | jq -r '[.deep_context.signature_dishes // [] | .[] | .dish] | join(", ")' 2>/dev/null | head -c 100 || echo "-")
  deep_service_style=$(echo "$json" | jq -r '.deep_context.service_style // "-"')
  deep_reservation=$(echo "$json" | jq -r '.deep_context.reservation_difficulty // "-"')

  # Intent boost
  local boost_active boost_reason
  boost_active=$(echo "$json" | jq -r '.intent_boost.active // false')
  boost_reason=$(echo "$json" | jq -r '.intent_boost.reason // "-"' | head -c 100)

  # Queue size
  local queue_size
  queue_size=$(echo "$json" | jq -r '.ranked_queue | length' 2>/dev/null || echo "0")

  # Recommendation excerpt
  local rec
  rec=$(echo "$json" | jq -r '.recommendation // ""' | head -c 150)

  # ─── PRINT FULL TRACE ───
  printf "\n"
  printf "  \033[1m🏪 RESULT: %s\033[0m (cuisine: %s)\n" "$name" "$cuisine"
  printf "  \033[1;33m⭐ DondeMatch: %s\033[0m\n" "$dm"
  printf "\n"

  printf "  ┌─ STEP 1: RELEVANCE GATE ─────────────────\n"
  printf "  │ Type:    %s\n" "$rel_type"
  printf "  │ Score:   %s (0-1.0)\n" "$rel_score"
  printf "  │ Details: %s\n" "$rel_details"
  printf "  └──────────────────────────────────────────\n"

  printf "  ┌─ STEP 2: QUALITY RANK ───────────────────\n"
  printf "  │ Quality: %s/100\n" "$quality"
  printf "  │ Formula: %s × %s + (%s bonus) = %s\n" "$rel_score" "$quality" "$occ_bonus" "$dm"
  printf "  │ Data completeness: %s\n" "$data_comp"
  printf "  └──────────────────────────────────────────\n"

  printf "  ┌─ STEP 3: FACTOR SCORES (0-10) ──────────\n"
  printf "  │ Food:        %6s  (w=%s, conf=%s)\n" "$food" "$w_food" "$conf_food"
  printf "  │ Reputation:  %6s  (w=%s, conf=%s)\n" "$reputation" "$w_rep" "$conf_rep"
  printf "  │ Vibe:        %6s  (w=%s, conf=%s)\n" "$vibe" "$w_vibe" "$conf_vibe"
  printf "  │ Service:     %6s  (w=%s, conf=%s)\n" "$service" "$w_svc" "$conf_svc"
  printf "  │ Convenience: %6s  (w=%s, conf=%s)\n" "$convenience" "$w_conv" "$conf_conv"
  printf "  └──────────────────────────────────────────\n"

  if [[ "$fd_food" != "-" && "$fd_food" != "" ]]; then
    printf "  ┌─ STEP 4: FACTOR DETAILS ──────────────\n"
    printf "  │ Food:        %s\n" "$fd_food"
    printf "  │ Reputation:  %s\n" "$fd_rep"
    printf "  │ Vibe:        %s\n" "$fd_vibe"
    printf "  │ Service:     %s\n" "$fd_svc"
    printf "  │ Convenience: %s\n" "$fd_conv"
    printf "  └──────────────────────────────────────────\n"
  fi

  printf "  ┌─ STEP 5: NARRATIVE & SIGNALS ────────────\n"
  printf "  │ Strongest: %s\n" "$strongest_factor"
  printf "  │ Summary:   %s\n" "$narrative_summary"
  printf "  │ Signals:   %s\n" "$key_signals"
  if [[ "$weak_spots" != "" && "$weak_spots" != "null" ]]; then
    printf "  │ Weak spots: %s\n" "$weak_spots"
  fi
  printf "  └──────────────────────────────────────────\n"

  printf "  ┌─ STEP 6: DEEP CONTEXT ──────────────────\n"
  printf "  │ Signature dishes: %s\n" "${sig_dishes:-none}"
  printf "  │ Service style:    %s\n" "$deep_service_style"
  printf "  │ Reservations:     %s\n" "$deep_reservation"
  printf "  └──────────────────────────────────────────\n"

  if [[ "$boost_active" == "true" ]]; then
    printf "  ┌─ INTENT BOOST ─────────────────────────\n"
    printf "  │ ⚡ ACTIVE: %s\n" "$boost_reason"
    printf "  └──────────────────────────────────────────\n"
  fi

  printf "  📋 Queue: %s alternatives | Rec: %s...\n" "$queue_size" "$(echo "$rec" | head -c 80)"

  # ─── ASSERTIONS ───
  local failed=0 warned=0

  # Check relevance type
  if [[ -n "$expect_rel_type" ]]; then
    if [[ "$rel_type" == "$expect_rel_type" ]]; then
      printf "  ✅ Relevance type = %s\n" "$rel_type"
    else
      printf "  ⚠️  Expected relevance '%s', got '%s'\n" "$expect_rel_type" "$rel_type"
      warned=1
      ISSUES+=("Case $num: Expected rel=$expect_rel_type, got $rel_type")
    fi
  fi

  # Check cuisine
  if [[ -n "$expect_cuisine" ]]; then
    if echo "$cuisine" | grep -qi "$expect_cuisine"; then
      printf "  ✅ Cuisine contains '%s'\n" "$expect_cuisine"
    else
      printf "  ⚠️  Expected cuisine '%s', got '%s'\n" "$expect_cuisine" "$cuisine"
      warned=1
      ISSUES+=("Case $num: Expected cuisine=$expect_cuisine, got $cuisine")
    fi
  fi

  # Check minimum DondeMatch
  if [[ "$min_dm" -gt 0 ]]; then
    if [[ "$dm" -ge "$min_dm" ]]; then
      printf "  ✅ DM=%s >= %s\n" "$dm" "$min_dm"
    else
      printf "  ⚠️  DM=%s < %s (below target)\n" "$dm" "$min_dm"
      warned=1
      ISSUES+=("Case $num: DM=$dm < min=$min_dm")
    fi
  fi

  # Sanity: verify DondeScore ≈ relevance × quality + bonus
  local expected_dm
  expected_dm=$(echo "$rel_score $quality $occ_bonus" | awk '{v=$1*$2+$3; if(v>99)v=99; if(v<0)v=0; printf "%d", v}')
  local dm_diff
  dm_diff=$(( dm > expected_dm ? dm - expected_dm : expected_dm - dm ))
  if [[ "$dm_diff" -gt 3 ]]; then
    printf "  ⚠️  Score math mismatch: %s × %s + %s = ~%s, but DM=%s (diff=%s)\n" "$rel_score" "$quality" "$occ_bonus" "$expected_dm" "$dm" "$dm_diff"
    warned=1
    ISSUES+=("Case $num: Score math off by $dm_diff (expected ~$expected_dm, got $dm)")
  else
    printf "  ✅ Score math checks out: %s × %s + %s ≈ %s\n" "$rel_score" "$quality" "$occ_bonus" "$dm"
  fi

  # Check for low-confidence factors
  for factor_conf in "$conf_food" "$conf_vibe" "$conf_svc" "$conf_rep" "$conf_conv"; do
    if [[ "$factor_conf" == "low" ]]; then
      printf "  ℹ️  Low confidence factor detected\n"
      break
    fi
  done

  if [[ "$failed" -eq 1 ]]; then
    FAIL=$((FAIL+1))
  elif [[ "$warned" -gt 0 ]]; then
    WARN=$((WARN+1))
  else
    PASS=$((PASS+1))
  fi
}

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   V9 CASE STUDY SUITE — 10 Varied Inputs, Full Trace      ║"
echo "║   Testing: Intent → Relevance → Quality → Score → Output  ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ═══════════════════════════════════════════
# CASE 1: Momos (specific dish, niche)
# ═══════════════════════════════════════════
run_case 1 "Momos" \
  '{"special_request":"momos","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "dish" 50 "" \
  "Niche dish — V9 should detect dish-level intent and find Tibetan/Nepali restaurant"

# ═══════════════════════════════════════════
# CASE 2: Soup Dumplings (specific dish, popular)
# ═══════════════════════════════════════════
run_case 2 "Soup Dumplings" \
  '{"special_request":"soup dumplings","occasion":"Any","neighborhood":"Anywhere","price_level":"Any"}' \
  "dish" 55 "" \
  "Popular dish — should find Chinese restaurant known for xiao long bao / soup dumplings"

# ═══════════════════════════════════════════
# CASE 3: Romantic Italian Date Night (cuisine + occasion + vibe)
# ═══════════════════════════════════════════
run_case 3 "Romantic Italian Date Night" \
  '{"special_request":"romantic Italian dinner","occasion":"Date Night","neighborhood":"Anywhere","price_level":"$$$"}' \
  "cuisine" 55 "italian" \
  "Multi-signal: cuisine + occasion + vibe. Weights should shift toward vibe+service for Date Night"

# ═══════════════════════════════════════════
# CASE 4: Cheap Late Night Tacos (dish + budget + time)
# ═══════════════════════════════════════════
run_case 4 "Cheap Late Night Tacos" \
  '{"special_request":"late night tacos","occasion":"Any","neighborhood":"Anywhere","price_level":"$","time_of_day":"late_night"}' \
  "dish" 45 "" \
  "Dish + time constraint + budget. Convenience factor should weigh timing fit heavily"

# ═══════════════════════════════════════════
# CASE 5: Vegan Brunch (dietary + occasion)
# ═══════════════════════════════════════════
run_case 5 "Vegan Brunch" \
  '{"special_request":"vegan brunch","occasion":"Brunch","neighborhood":"Anywhere","price_level":"Any","dietary_restrictions":["vegan"]}' \
  "" 40 "" \
  "Dietary hard-filter + occasion. Should only return restaurants with vegan options"

# ═══════════════════════════════════════════
# CASE 6: Rooftop Drinks (pure vibe query)
# ═══════════════════════════════════════════
run_case 6 "Rooftop Drinks" \
  '{"special_request":"rooftop bar with a view","occasion":"Drinks","neighborhood":"Anywhere","price_level":"Any"}' \
  "vibe" 40 "" \
  "Pure vibe query — V9 should classify as vibe type, weight vibe factor at 0.35"

# ═══════════════════════════════════════════
# CASE 7: Business Lunch Downtown (occasion + neighborhood + formality)
# ═══════════════════════════════════════════
run_case 7 "Business Lunch Downtown" \
  '{"special_request":"impressive business lunch","occasion":"Business","neighborhood":"The Loop","price_level":"$$$"}' \
  "" 50 "" \
  "Business occasion in specific neighborhood. Service style fit + noise level critical"

# ═══════════════════════════════════════════
# CASE 8: Korean BBQ Group Outing (cuisine + social occasion)
# ═══════════════════════════════════════════
run_case 8 "Korean BBQ Group Outing" \
  '{"special_request":"Korean BBQ","occasion":"Group Outing","neighborhood":"Anywhere","price_level":"Any"}' \
  "cuisine" 50 "korean" \
  "Cuisine-level query with group occasion. Should boost group-friendly restaurants"

# ═══════════════════════════════════════════
# CASE 9: Hole in the Wall (vibe-only, budget)
# ═══════════════════════════════════════════
run_case 9 "Hole in the Wall" \
  '{"special_request":"hole in the wall","occasion":"Any","neighborhood":"Anywhere","price_level":"$"}' \
  "vibe" 40 "" \
  "Vibe query with budget constraint. Should find casual, authentic, cheap spots"

# ═══════════════════════════════════════════
# CASE 10: Gluten-Free Sushi Date (dish + dietary + occasion)
# ═══════════════════════════════════════════
run_case 10 "Gluten-Free Sushi Date" \
  '{"special_request":"sushi","occasion":"Date Night","neighborhood":"Lincoln Park","price_level":"$$","dietary_restrictions":["gluten-free"]}' \
  "" 40 "" \
  "Dish + dietary filter + occasion + neighborhood. Most constrained query — tests filter stacking"

# ═══════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    RESULTS SUMMARY                          ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
printf "  \033[1;32mPASS: %d\033[0m  |  \033[1;33mWARN: %d\033[0m  |  \033[1;31mFAIL: %d\033[0m  |  TOTAL: %d\n" "$PASS" "$WARN" "$FAIL" "$TOTAL"
echo ""

if [[ ${#ISSUES[@]} -gt 0 ]]; then
  echo "  Issues found:"
  for issue in "${ISSUES[@]}"; do
    echo "    → $issue"
  done
  echo ""
fi

if [[ "$FAIL" -gt 0 ]]; then
  echo "  ⛔ $FAIL case(s) FAILED"
  exit 1
elif [[ "$WARN" -gt 0 ]]; then
  echo "  ⚠️  All passed with $WARN warning(s) — review above for optimization opportunities"
  exit 0
else
  echo "  ✅ All 10 cases passed clean!"
  exit 0
fi
