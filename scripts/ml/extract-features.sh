#!/usr/bin/env bash
# extract-features.sh — Call the live recommend API for each training query
# and extract rule-engine feature vectors for ML training.
#
# Usage:
#   ./scripts/ml/extract-features.sh [--batch-start N] [--batch-size N]
#
# Cost: $0 (uses skip_claude + skip_google)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRAINING_DATA="$SCRIPT_DIR/training-data.json"
OUTPUT_FILE="$SCRIPT_DIR/features-dataset.json"

# Parse .env (strip inline comments and whitespace)
ENV_FILE="$SCRIPT_DIR/../../.env"
if [[ -f "$ENV_FILE" ]]; then
  SUPAB_URL=$(grep '^SUPAB_URL=' "$ENV_FILE" | head -1 | sed 's/^SUPAB_URL=//' | sed 's/[[:space:]]*#.*//' | tr -d '[:space:]')
  SUPAB_ANON_KEY=$(grep '^SUPAB_ANON_KEY=' "$ENV_FILE" | head -1 | sed 's/^SUPAB_ANON_KEY=//' | sed 's/[[:space:]]*#.*//' | tr -d '[:space:]')
fi

if [[ -z "${SUPAB_URL:-}" ]] || [[ -z "${SUPAB_ANON_KEY:-}" ]]; then
  echo "ERROR: SUPAB_URL and SUPAB_ANON_KEY must be set (via .env or environment)"
  exit 1
fi

# Defaults
BATCH_START=0
BATCH_SIZE=999999

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --batch-start) BATCH_START="$2"; shift 2 ;;
    --batch-size)  BATCH_SIZE="$2"; shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

TOTAL_QUERIES=$(python3 -c "import json; print(len(json.load(open('$TRAINING_DATA'))))")
BATCH_END=$((BATCH_START + BATCH_SIZE))
if (( BATCH_END > TOTAL_QUERIES )); then
  BATCH_END=$TOTAL_QUERIES
fi

echo "=== ML Feature Extraction ==="
echo "Training data: $TRAINING_DATA ($TOTAL_QUERIES queries)"
echo "Batch: queries $BATCH_START to $((BATCH_END - 1))"
echo "Output: $OUTPUT_FILE"
echo "API: $SUPAB_URL (skip_claude + skip_google = \$0)"
echo ""

# Export vars for Python subprocess
export TRAINING_DATA_PATH="$TRAINING_DATA"
export OUTPUT_FILE_PATH="$OUTPUT_FILE"
export SUPAB_URL
export SUPAB_ANON_KEY
export BATCH_START
export BATCH_END

# Use Python to do the heavy lifting — JSON parsing, API calls, feature extraction
python3 << 'PYEOF'
import json
import subprocess
import sys
import time
import os

TRAINING_DATA = os.environ.get("TRAINING_DATA_PATH")
OUTPUT_FILE = os.environ.get("OUTPUT_FILE_PATH")
SUPAB_URL = os.environ.get("SUPAB_URL")
SUPAB_ANON_KEY = os.environ.get("SUPAB_ANON_KEY")
BATCH_START = int(os.environ.get("BATCH_START", "0"))
BATCH_END = int(os.environ.get("BATCH_END", "999999"))

with open(TRAINING_DATA) as f:
    queries = json.load(f)

results = []
# Load existing results if resuming
if os.path.exists(OUTPUT_FILE):
    try:
        with open(OUTPUT_FILE) as f:
            existing = json.load(f)
        existing_query_ids = {r["query_id"] for r in existing}
        results = existing
        print(f"Loaded {len(existing)} existing records from previous run")
    except (json.JSONDecodeError, KeyError):
        existing_query_ids = set()
        results = []
else:
    existing_query_ids = set()

total = min(BATCH_END, len(queries))
errors = 0
skipped = 0

for idx in range(BATCH_START, total):
    q = queries[idx]
    query_id = q["query_id"]
    query_text = q["query"]
    occasion = q.get("occasion", "Any")

    # Skip if already processed
    if query_id in existing_query_ids:
        skipped += 1
        continue

    print(f"Processing query {idx + 1}/{total}: [{query_id}] \"{query_text}\"", flush=True)

    # Build request body
    body = json.dumps({
        "special_request": query_text,
        "occasion": occasion,
        "skip_claude": True,
        "skip_google": True
    })

    # Call API via curl
    try:
        proc = subprocess.run(
            [
                "curl", "-s", "--max-time", "25",
                "-X", "POST", f"{SUPAB_URL}/functions/v1/recommend",
                "-H", f"Authorization: Bearer {SUPAB_ANON_KEY}",
                "-H", f"apikey: {SUPAB_ANON_KEY}",
                "-H", "Content-Type: application/json",
                "-d", body
            ],
            capture_output=True, text=True, timeout=30
        )
        response_text = proc.stdout.strip()
        if not response_text:
            print(f"  ERROR: Empty response for query {query_id}", flush=True)
            errors += 1
            time.sleep(0.3)
            continue

        resp = json.loads(response_text)
    except (subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        print(f"  ERROR: {type(e).__name__} for query {query_id}", flush=True)
        errors += 1
        time.sleep(0.3)
        continue

    if not resp.get("success"):
        print(f"  ERROR: API returned success=false for query {query_id}: {resp.get('recommendation','')}", flush=True)
        errors += 1
        time.sleep(0.3)
        continue

    # Extract primary restaurant (rank 1)
    restaurant = resp.get("restaurant", {})
    scoring = resp.get("scoring_v9", {})
    narrative = resp.get("match_narrative", {})

    results.append({
        "query_id": query_id,
        "query": query_text,
        "restaurant_id": restaurant.get("id"),
        "restaurant_name": restaurant.get("name"),
        "cuisine_type": restaurant.get("cuisine_type"),
        "neighborhood": restaurant.get("neighborhood_name"),
        "price_level": restaurant.get("price_level"),
        "rule_engine_rank": 1,
        "rule_donde_match": resp.get("donde_match"),
        "features": {
            "relevance_score": scoring.get("relevance_score"),
            "relevance_type": scoring.get("relevance_type"),
            "food": scoring.get("food"),
            "vibe": scoring.get("vibe"),
            "service": scoring.get("service"),
            "reputation": scoring.get("reputation"),
            "convenience": scoring.get("convenience"),
            "quality_score": scoring.get("quality_score"),
            "data_completeness": scoring.get("data_completeness"),
            "occasion_bonus": scoring.get("occasion_bonus"),
            "weights_used": scoring.get("weights_used")
        },
        "strongest_factor": narrative.get("strongest_factor"),
        "ideal_rank": None,
        "ideal_score": None
    })

    # Extract ranked_queue items (ranks 2+)
    for item in resp.get("ranked_queue", []):
        rq_restaurant = item.get("restaurant", {})
        rq_scoring = item.get("scoring_v9", {})

        results.append({
            "query_id": query_id,
            "query": query_text,
            "restaurant_id": rq_restaurant.get("id"),
            "restaurant_name": rq_restaurant.get("name"),
            "cuisine_type": rq_restaurant.get("cuisine_type"),
            "neighborhood": rq_restaurant.get("neighborhood_name"),
            "price_level": rq_restaurant.get("price_level"),
            "rule_engine_rank": item.get("rank"),
            "rule_donde_match": item.get("donde_match"),
            "features": {
                "relevance_score": rq_scoring.get("relevance_score"),
                "relevance_type": rq_scoring.get("relevance_type"),
                "food": rq_scoring.get("food"),
                "vibe": rq_scoring.get("vibe"),
                "service": rq_scoring.get("service"),
                "reputation": rq_scoring.get("reputation"),
                "convenience": rq_scoring.get("convenience"),
                "quality_score": rq_scoring.get("quality_score"),
                "data_completeness": rq_scoring.get("data_completeness"),
                "occasion_bonus": rq_scoring.get("occasion_bonus"),
                "weights_used": rq_scoring.get("weights_used")
            },
            "strongest_factor": None,  # match_narrative only for primary
            "ideal_rank": None,
            "ideal_score": None
        })

    existing_query_ids.add(query_id)

    # Save progress every 10 queries
    if (idx + 1) % 10 == 0 or idx == total - 1:
        with open(OUTPUT_FILE, "w") as f:
            json.dump(results, f, indent=2)
        print(f"  Saved progress: {len(results)} records", flush=True)

    # Rate limit
    time.sleep(0.3)

# Final save
with open(OUTPUT_FILE, "w") as f:
    json.dump(results, f, indent=2)

unique_queries = len({r["query_id"] for r in results})
print(f"\n=== Done ===")
print(f"Queries processed: {unique_queries}")
print(f"Skipped (already done): {skipped}")
print(f"Total records: {len(results)}")
print(f"Errors: {errors}")
print(f"Output: {OUTPUT_FILE}")
PYEOF
