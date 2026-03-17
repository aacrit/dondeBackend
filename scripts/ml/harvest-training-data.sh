#!/bin/bash
#
# Harvest ALL available training data from Supabase — $0 cost
#
# Sources:
#   1. gauntlet_results  — golden dataset + benchmark graded results (query, restaurant, scores, grades)
#   2. user_queries      — live API responses with scoring breakdowns + user feedback
#   3. query_cache       — quality-gated (B-/80+) cached responses with full scores
#   4. user_favorites    — explicit positive signal (user saved this restaurant)
#   5. user_visits       — strongest positive signal (user actually went)
#
# Output: harvested-training-data.json — thousands of labeled training examples
#
set -euo pipefail
cd "$(dirname "$0")"

# Load env
if [ -f "../../.env" ]; then
  source "../../.env"
elif [ -f "../.env" ]; then
  source "../.env"
fi

URL="${SUPAB_URL:?Set SUPAB_URL}"
KEY="${SUPAB_SERVICE_ROLE_KEY:-$SUPAB_ANON_KEY}"

echo "============================================================"
echo "  DondeAI Training Data Harvester"
echo "============================================================"

# Temp files
mkdir -p /tmp/donde-harvest

# ================================================================
# SOURCE 1: gauntlet_results — graded test results
# Each row has query, restaurant_name, donde_match, score_fit_score,
# blurb_quality_score, gap_type, category
# PASS results = positive training signal
# FAIL/WARN = weak or negative signal
# ================================================================
echo ""
echo "Source 1: gauntlet_results (graded test data)..."
curl -s "$URL/rest/v1/gauntlet_results?select=query,restaurant_name,donde_match,score_fit_score,score_fit_grade,blurb_quality_score,blurb_quality_grade,gap_type,category,run_id&order=created_at.desc&limit=5000" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  > /tmp/donde-harvest/gauntlet_results.json

GAUNTLET_COUNT=$(python3 -c "import json; d=json.load(open('/tmp/donde-harvest/gauntlet_results.json')); print(len(d))")
echo "  Fetched: $GAUNTLET_COUNT graded results"

# ================================================================
# SOURCE 2: user_queries — live API responses with feedback
# Has: special_request, recommended_restaurant_id, donde_match,
# score_fit_score, blurb_quality_score, claude_relevance_score (1=like, 0=dislike),
# source, exclude count
# ================================================================
echo ""
echo "Source 2: user_queries (live API + feedback)..."
curl -s "$URL/rest/v1/user_queries?select=special_request,recommended_restaurant_id,donde_match,score_fit_score,score_fit_grade,blurb_quality_score,blurb_quality_grade,claude_relevance_score,source,occasion,neighborhood,price_level,cache_hit,created_at&order=created_at.desc&limit=10000" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  > /tmp/donde-harvest/user_queries.json

UQ_COUNT=$(python3 -c "import json; d=json.load(open('/tmp/donde-harvest/user_queries.json')); print(len(d))")
echo "  Fetched: $UQ_COUNT user queries"

# ================================================================
# SOURCE 3: query_cache — quality-gated cached responses
# Only B-/80+ responses get cached, so these are all positive examples
# Has: query_key, response (full JSON with scoring_v9), score_fit_score,
# blurb_quality_score, hit_count
# ================================================================
echo ""
echo "Source 3: query_cache (quality-gated responses)..."
curl -s "$URL/rest/v1/query_cache?select=query_key,canonical_query,score_fit_score,blurb_quality_score,hit_count,engine_version,created_at&order=hit_count.desc&limit=5000" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  > /tmp/donde-harvest/query_cache.json

CACHE_COUNT=$(python3 -c "import json; d=json.load(open('/tmp/donde-harvest/query_cache.json')); print(len(d))")
echo "  Fetched: $CACHE_COUNT cached responses"

# ================================================================
# SOURCE 4: user_favorites — explicit positive signal
# ================================================================
echo ""
echo "Source 4: user_favorites..."
curl -s "$URL/rest/v1/user_favorites?select=user_id,restaurant_id,created_at&limit=5000" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  > /tmp/donde-harvest/user_favorites.json

FAV_COUNT=$(python3 -c "import json; d=json.load(open('/tmp/donde-harvest/user_favorites.json')); print(len(d))")
echo "  Fetched: $FAV_COUNT favorites"

# ================================================================
# SOURCE 5: user_visits — strongest positive signal
# ================================================================
echo ""
echo "Source 5: user_visits..."
curl -s "$URL/rest/v1/user_visits?select=user_id,restaurant_id,visit_type,created_at&limit=5000" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  > /tmp/donde-harvest/user_visits.json

VISIT_COUNT=$(python3 -c "import json; d=json.load(open('/tmp/donde-harvest/user_visits.json')); print(len(d))")
echo "  Fetched: $VISIT_COUNT visits"

# ================================================================
# SOURCE 6: gauntlet_runs — run-level summaries for context
# ================================================================
echo ""
echo "Source 6: gauntlet_runs (run summaries)..."
curl -s "$URL/rest/v1/gauntlet_runs?select=run_id,avg_dm,avg_score_fit,avg_blurb_quality,grade_pass_count,total,gap_count,mode,created_at&order=created_at.desc&limit=100" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  > /tmp/donde-harvest/gauntlet_runs.json

RUN_COUNT=$(python3 -c "import json; d=json.load(open('/tmp/donde-harvest/gauntlet_runs.json')); print(len(d))")
echo "  Fetched: $RUN_COUNT test runs"

# ================================================================
# SOURCE 7: Restaurant data (for feature extraction)
# ================================================================
echo ""
echo "Source 7: Restaurant data for feature joining..."
curl -s "$URL/rest/v1/restaurants?is_active=eq.true&select=id,name,cuisine_type,neighborhood_name,price_level,noise_level&limit=3000" \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  > /tmp/donde-harvest/restaurants.json

REST_COUNT=$(python3 -c "import json; d=json.load(open('/tmp/donde-harvest/restaurants.json')); print(len(d))")
echo "  Fetched: $REST_COUNT restaurants"

# ================================================================
# MERGE ALL SOURCES
# ================================================================
echo ""
echo "============================================================"
echo "  Merging all sources..."
echo "============================================================"

python3 << 'PYTHON_MERGE'
import json
import os

harvest_dir = "/tmp/donde-harvest"

def load(name):
    path = os.path.join(harvest_dir, name)
    with open(path) as f:
        data = json.load(f)
    return data if isinstance(data, list) else []

gauntlet = load("gauntlet_results.json")
user_queries = load("user_queries.json")
cache = load("query_cache.json")
favorites = load("user_favorites.json")
visits = load("user_visits.json")
runs = load("gauntlet_runs.json")
restaurants = load("restaurants.json")

# Index restaurants
rest_by_id = {r["id"]: r for r in restaurants}
rest_by_name = {}
for r in restaurants:
    name = (r.get("name") or "").lower().strip()
    if name:
        rest_by_name[name] = r

training_examples = []

# --- Source 1: Gauntlet results (graded test outcomes) ---
# Each graded result is a (query, restaurant, quality_signal) triple
gauntlet_count = 0
for row in gauntlet:
    query = row.get("query", "")
    restaurant_name = row.get("restaurant_name", "")
    dm = row.get("donde_match")
    sf = row.get("score_fit_score")
    bq = row.get("blurb_quality_score")
    gap = row.get("gap_type")
    category = row.get("category", "")

    if not query or dm is None:
        continue

    # Look up restaurant
    rest = rest_by_name.get(restaurant_name.lower().strip())
    rest_id = rest["id"] if rest else None

    # Label: PASS = positive, FAIL = negative, WARN = weak positive
    if sf and sf >= 80 and bq and bq >= 80 and dm >= 70:
        label = "positive"
        score = dm
    elif gap:
        label = "negative"
        score = max(0, dm - 15)
    else:
        label = "weak_positive"
        score = dm

    training_examples.append({
        "source": "gauntlet",
        "query": query,
        "restaurant_id": rest_id,
        "restaurant_name": restaurant_name,
        "cuisine_type": rest.get("cuisine_type") if rest else None,
        "neighborhood": rest.get("neighborhood_name") if rest else None,
        "price_level": rest.get("price_level") if rest else None,
        "donde_match": dm,
        "score_fit": sf,
        "blurb_quality": bq,
        "label": label,
        "ideal_score": score,
        "category": category,
    })
    gauntlet_count += 1

# --- Source 2: User queries (live API + feedback) ---
uq_count = 0
for row in user_queries:
    query = row.get("special_request", "")
    rest_id = row.get("recommended_restaurant_id")
    dm = row.get("donde_match")
    sf = row.get("score_fit_score")
    bq = row.get("blurb_quality_score")
    feedback = row.get("claude_relevance_score")  # 1=like, 0=dislike
    source = row.get("source", "")

    if not query or dm is None:
        continue

    rest = rest_by_id.get(rest_id, {})

    # Determine label from feedback + grades
    if feedback == 1:
        label = "positive"
        score = min(99, dm + 5)
    elif feedback == 0:
        label = "negative"
        score = max(0, dm - 10)
    elif sf and sf >= 80 and bq and bq >= 80:
        label = "weak_positive"
        score = dm
    else:
        label = "neutral"
        score = dm

    training_examples.append({
        "source": f"user_query_{source}" if source else "user_query",
        "query": query,
        "restaurant_id": rest_id,
        "restaurant_name": rest.get("name"),
        "cuisine_type": rest.get("cuisine_type"),
        "neighborhood": rest.get("neighborhood_name"),
        "price_level": rest.get("price_level"),
        "donde_match": dm,
        "score_fit": sf,
        "blurb_quality": bq,
        "label": label,
        "ideal_score": score,
        "category": None,
    })
    uq_count += 1

# --- Source 3: Cache (quality-gated, all are positive) ---
cache_count = 0
for row in cache:
    query = row.get("canonical_query") or row.get("query_key", "")
    sf = row.get("score_fit_score")
    bq = row.get("blurb_quality_score")
    hits = row.get("hit_count", 0)

    if not query or not sf:
        continue

    # High-hit cache entries are strong positives (popular + quality-gated)
    label = "positive" if hits and hits > 3 else "weak_positive"

    training_examples.append({
        "source": "cache",
        "query": query,
        "restaurant_id": None,
        "restaurant_name": None,
        "cuisine_type": None,
        "neighborhood": None,
        "price_level": None,
        "donde_match": None,
        "score_fit": sf,
        "blurb_quality": bq,
        "label": label,
        "ideal_score": sf,  # Use score_fit as quality proxy
        "category": None,
    })
    cache_count += 1

# --- Source 4+5: Favorites + Visits (strong positive signals) ---
fav_rests = set()
for row in favorites:
    rid = row.get("restaurant_id")
    if rid:
        fav_rests.add(rid)

visit_rests = set()
for row in visits:
    rid = row.get("restaurant_id")
    if rid:
        visit_rests.add(rid)

# Summary
by_source = {}
by_label = {}
for ex in training_examples:
    src = ex["source"]
    by_source[src] = by_source.get(src, 0) + 1
    lbl = ex["label"]
    by_label[lbl] = by_label.get(lbl, 0) + 1

print(f"\n  Training examples by source:")
for src, count in sorted(by_source.items(), key=lambda x: -x[1]):
    print(f"    {src:<30} {count:>6}")

print(f"\n  Training examples by label:")
for lbl, count in sorted(by_label.items(), key=lambda x: -x[1]):
    print(f"    {lbl:<20} {count:>6}")

print(f"\n  Favorited restaurants:  {len(fav_rests)}")
print(f"  Visited restaurants:   {len(visit_rests)}")
print(f"\n  TOTAL training examples: {len(training_examples)}")

# Save
output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)) if "__file__" in dir() else ".", "harvested-training-data.json")
# Use script dir
script_dir = os.path.dirname(os.path.abspath("harvest-training-data.sh"))
output_path = os.path.join(script_dir, "harvested-training-data.json")

with open(output_path, "w") as f:
    json.dump(training_examples, f, indent=2)

size_kb = os.path.getsize(output_path) // 1024
print(f"\n  Saved to: harvested-training-data.json ({size_kb}KB)")

# Also save metadata
meta = {
    "total_examples": len(training_examples),
    "by_source": by_source,
    "by_label": by_label,
    "favorited_restaurants": len(fav_rests),
    "visited_restaurants": len(visit_rests),
    "gauntlet_runs": len(runs),
    "unique_queries": len(set(ex["query"] for ex in training_examples)),
    "unique_restaurants": len(set(ex["restaurant_id"] for ex in training_examples if ex["restaurant_id"])),
}
with open(os.path.join(script_dir, "harvest-metadata.json"), "w") as f:
    json.dump(meta, f, indent=2)
print(f"  Metadata: harvest-metadata.json")

PYTHON_MERGE

echo ""
echo "============================================================"
echo "  Harvest complete!"
echo "============================================================"
