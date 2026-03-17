#!/bin/bash
#
# Run 50 Case Studies: Engine vs ML comparison with full trace
# Shows top restaurants picked by engine, ML boost decisions, and rationale
# $0 cost (skip_claude + skip_google)
#
set -euo pipefail
cd "$(dirname "$0")"
source ../../.env 2>/dev/null || true

URL="${SUPAB_URL:-https://vwbzkgsxmgwcvmvuxnbe.supabase.co}"
KEY="${SUPAB_ANON_KEY}"

echo "============================================================"
echo "  DondeAI 50 Case Studies — Engine vs ML Trace"
echo "  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================================"

# 50 diverse test queries covering all categories
QUERIES=(
  "romantic Italian dinner"
  "best sushi in Chicago"
  "thai food in Logan Square"
  "late night tacos"
  "quiet business lunch downtown"
  "BYOB wine bar"
  "family friendly Mexican in Pilsen"
  "speakeasy cocktail bar"
  "deep dish pizza"
  "vegan friendly dinner"
  "french bistro"
  "korean fried chicken"
  "best tasting menu"
  "outdoor patio brunch"
  "Indian food"
  "soup dumplings"
  "hidden gem Bridgeport"
  "anniversary dinner special"
  "group dinner 10 people"
  "Polish restaurant Avondale"
  "Ethiopian food"
  "omakase experience"
  "craft cocktails with small plates"
  "kid friendly brunch"
  "Michelin star restaurant"
  "cheap eats under 15 dollars"
  "Japanese ramen"
  "steakhouse for boss dinner"
  "Mediterranean near River North"
  "comfort food after bad day"
  "dim sum Chinatown"
  "rooftop with views"
  "seafood restaurant"
  "peruvian food"
  "walk-in friendly no reservation"
  "Nigerian food"
  "date night West Loop"
  "sports bar near Wrigley"
  "farm to table seasonal"
  "Filipino food"
  "prix fixe dinner"
  "gluten free options"
  "best burger"
  "quiet coffee shop lunch"
  "Szechuan spicy authentic"
  "birthday celebration dinner"
  "halal food"
  "brunch spot bottomless mimosas"
  "lobster roll"
  "Ukrainian Village dinner"
)

RESULTS_FILE="case-studies-results.json"
echo "[" > "$RESULTS_FILE"
FIRST=true

for i in "${!QUERIES[@]}"; do
  QUERY="${QUERIES[$i]}"
  NUM=$((i + 1))

  # Call API
  RESPONSE=$(curl -s -X POST "$URL/functions/v1/recommend" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "{\"special_request\": \"$QUERY\", \"skip_claude\": true, \"skip_google\": true}" 2>/dev/null)

  # Extract key data
  python3 -c "
import json, sys

try:
    d = json.loads('''$RESPONSE''')
except:
    d = json.load(sys.stdin)

if not d.get('success'):
    print(f'  CASE {$NUM}/50: \"$QUERY\" — ERROR: {d.get(\"recommendation\",\"unknown\")}')
    sys.exit(0)

r = d.get('restaurant', {})
sv9 = d.get('scoring_v9', {})
ml = d.get('ml_scoring', {})
fml = d.get('factor_ml', {})
cb = d.get('circuit_breaker', {})
pers = d.get('personalization', {})
queue = d.get('ranked_queue', [])

# Determine if ML boosted
ml_active = ml.get('active', False)
ml_group = ml.get('ab_group', 'rules')
ml_adj = ml.get('adjustments', [])
ml_boosted = len(ml_adj) > 0 and any(a.get('ml_adjustment', 0) != 0 for a in ml_adj)

print(f'')
print(f'━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
print(f'  CASE {$NUM}/50: \"$QUERY\"')
print(f'━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
print(f'')
print(f'  ENGINE PICK:')
print(f'    #1: {r.get(\"name\",\"?\")} ({r.get(\"cuisine_type\",\"?\")}, {r.get(\"neighborhood_name\",\"?\")})')
print(f'    DondeMatch: {d.get(\"donde_match\",\"?\")}')
print(f'    Relevance: {sv9.get(\"relevance_type\",\"?\")} ({sv9.get(\"relevance_score\",\"?\")})')
print(f'    Factors: food={sv9.get(\"food\",\"?\")}, vibe={sv9.get(\"vibe\",\"?\")}, service={sv9.get(\"service\",\"?\")}, rep={sv9.get(\"reputation\",\"?\")}, conv={sv9.get(\"convenience\",\"?\")}')
print(f'')

# Queue
if queue:
    print(f'  RANKED QUEUE:')
    for qi in queue[:4]:
        qr = qi.get('restaurant', {})
        qs = qi.get('scoring_v9', {})
        headline = qi.get('match_headline', '')[:60]
        print(f'    #{qi.get(\"rank\",\"?\")}: {qr.get(\"name\",\"?\")} ({qr.get(\"cuisine_type\",\"?\")}) DM={qi.get(\"donde_match\",\"?\")} — {headline}')
    print()

# ML decision
print(f'  ML DECISION:')
print(f'    Model loaded: {ml.get(\"model_loaded\", False)}')
print(f'    A/B group: {ml_group}')
if ml_boosted:
    print(f'    ACTION: BOOSTED')
    for a in ml_adj:
        if a.get('ml_adjustment', 0) != 0:
            print(f'      ↑ {a.get(\"restaurant_name\",\"?\")}: DM {a.get(\"rule_dm\",\"?\")} → {a.get(\"ml_dm\",\"?\")} ({a.get(\"ml_adjustment\",0):+.1f})')
    print(f'    RATIONALE: ML identified teacher-validated restaurants that the rule engine')
    print(f'    found but ranked lower. Boost promotes better-fit picks to higher positions.')
else:
    print(f'    ACTION: NO BOOST')
    print(f'    RATIONALE: Either (a) engine\\'s picks already match teacher\\'s ideal,')
    print(f'    (b) teacher\\'s preferred restaurants not in engine\\'s candidate pool,')
    print(f'    or (c) boost table has no entry for this query pattern.')

# Factor ML
if fml and fml.get('model_loaded'):
    print(f'')
    print(f'  FACTOR ML:')
    adj = fml.get('adjustments', {})
    for factor in ['food', 'vibe', 'service', 'reputation', 'convenience']:
        fa = adj.get(factor, {})
        if fa:
            status = 'ACTIVE' if fa.get('active') else 'shadow'
            delta = fa.get('delta', 0)
            if delta != 0:
                print(f'    {factor}: {fa.get(\"raw\",\"?\")} → {fa.get(\"adjusted\",\"?\")} ({delta:+.1f}) [{status}]')

# Assessment
print(f'')
print(f'  ASSESSMENT:')
dm = d.get('donde_match', 0)
rel = sv9.get('relevance_type', '')
food = sv9.get('food', 0)
if dm >= 85:
    print(f'    ✓ Strong match (DM={dm}) — engine confident in this pick')
elif dm >= 75:
    print(f'    ~ Good match (DM={dm}) — solid option with room for improvement')
elif dm >= 65:
    print(f'    △ Moderate match (DM={dm}) — acceptable but ML could help find better')
else:
    print(f'    ✗ Weak match (DM={dm}) — likely a retrieval gap or sparse data')

if rel in ('dish', 'cuisine') and food >= 8:
    print(f'    ✓ Food-relevant query with high food score ({food}) — good alignment')
elif rel == 'vibe':
    print(f'    ~ Vibe query — atmosphere matters more than cuisine precision')
elif rel == 'reputation':
    print(f'    ~ Reputation query — awards/ratings drive the ranking')
elif rel == 'open_ended':
    print(f'    △ Open-ended query — engine using general quality signals')

" 2>/dev/null || echo "  CASE $NUM/50: \"$QUERY\" — PARSE ERROR"

  sleep 0.3
done

echo ""
echo "============================================================"
echo "  50 CASE STUDIES COMPLETE"
echo "============================================================"
