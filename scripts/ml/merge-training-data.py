#!/usr/bin/env python3
"""
merge-training-data.py — Merge rule-engine features with ideal rankings.

Reads:
  - features-dataset.json (rule engine features per restaurant per query)
  - training-data.json (ideal rankings from teacher)

Outputs:
  - merged-training-data.json (combined dataset ready for ML training)

Matching logic:
  - Match by query_id + restaurant_id
  - Restaurants in ideal ranking but NOT in rule engine results:
    included with rule_engine_rank=null, rule_donde_match=null
    (ML should learn to boost these — the rules missed them)
  - Restaurants in rule engine results but NOT in ideal ranking:
    included with ideal_rank=null, ideal_score=null
    (ML should learn to penalize these — the rules over-ranked them)
"""

import json
import os
import sys
from collections import defaultdict

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FEATURES_FILE = os.path.join(SCRIPT_DIR, "features-dataset.json")
TRAINING_FILE = os.path.join(SCRIPT_DIR, "training-data.json")
OUTPUT_FILE = os.path.join(SCRIPT_DIR, "merged-training-data.json")


def main():
    # Load features dataset
    with open(FEATURES_FILE) as f:
        features = json.load(f)
    print(f"Loaded {len(features)} feature records from {FEATURES_FILE}")

    # Load training data (ideal rankings)
    with open(TRAINING_FILE) as f:
        training = json.load(f)
    print(f"Loaded {len(training)} queries from {TRAINING_FILE}")

    # Index features by (query_id, restaurant_id)
    features_by_key = {}
    features_by_query = defaultdict(list)
    for record in features:
        key = (record["query_id"], record["restaurant_id"])
        features_by_key[key] = record
        features_by_query[record["query_id"]].append(record)

    # Index ideal rankings by (query_id, restaurant_id)
    ideal_by_key = {}
    ideal_by_query = defaultdict(list)
    for query in training:
        qid = query["query_id"]
        for item in query["ideal_ranking"]:
            key = (qid, item["restaurant_id"])
            ideal_by_key[key] = {
                "rank": item["rank"],
                "score": item["score"],
                "reasoning": item.get("reasoning"),
                "restaurant_name": item["restaurant_name"],
                "cuisine_type": item.get("cuisine_type"),
                "neighborhood": item.get("neighborhood"),
                "price_level": item.get("price_level"),
            }
            ideal_by_query[qid].append(item)

    merged = []
    stats = {
        "matched": 0,
        "rule_only": 0,
        "ideal_only": 0,
        "total_queries": len(training),
    }

    # Collect all keys from both sources
    all_keys = set(features_by_key.keys()) | set(ideal_by_key.keys())

    for key in sorted(all_keys):
        query_id, restaurant_id = key
        feat = features_by_key.get(key)
        ideal = ideal_by_key.get(key)

        # Find the query text
        query_text = None
        for q in training:
            if q["query_id"] == query_id:
                query_text = q["query"]
                break

        if feat and ideal:
            # Both sources have this restaurant — full match
            stats["matched"] += 1
            merged.append({
                "query_id": query_id,
                "query": query_text or feat["query"],
                "restaurant_id": restaurant_id,
                "restaurant_name": feat.get("restaurant_name") or ideal["restaurant_name"],
                "cuisine_type": feat.get("cuisine_type") or ideal.get("cuisine_type"),
                "neighborhood": feat.get("neighborhood") or ideal.get("neighborhood"),
                "price_level": feat.get("price_level") or ideal.get("price_level"),
                "rule_engine_rank": feat["rule_engine_rank"],
                "rule_donde_match": feat["rule_donde_match"],
                "features": feat["features"],
                "strongest_factor": feat.get("strongest_factor"),
                "ideal_rank": ideal["rank"],
                "ideal_score": ideal["score"],
                "ideal_reasoning": ideal["reasoning"],
            })

        elif feat and not ideal:
            # Rule engine ranked it, but teacher didn't — ML should penalize
            stats["rule_only"] += 1
            merged.append({
                "query_id": query_id,
                "query": query_text or feat["query"],
                "restaurant_id": restaurant_id,
                "restaurant_name": feat.get("restaurant_name"),
                "cuisine_type": feat.get("cuisine_type"),
                "neighborhood": feat.get("neighborhood"),
                "price_level": feat.get("price_level"),
                "rule_engine_rank": feat["rule_engine_rank"],
                "rule_donde_match": feat["rule_donde_match"],
                "features": feat["features"],
                "strongest_factor": feat.get("strongest_factor"),
                "ideal_rank": None,
                "ideal_score": None,
                "ideal_reasoning": None,
            })

        elif ideal and not feat:
            # Teacher ranked it, but rule engine didn't — ML should boost
            stats["ideal_only"] += 1
            merged.append({
                "query_id": query_id,
                "query": query_text,
                "restaurant_id": restaurant_id,
                "restaurant_name": ideal["restaurant_name"],
                "cuisine_type": ideal.get("cuisine_type"),
                "neighborhood": ideal.get("neighborhood"),
                "price_level": ideal.get("price_level"),
                "rule_engine_rank": None,
                "rule_donde_match": None,
                "features": None,
                "strongest_factor": None,
                "ideal_rank": ideal["rank"],
                "ideal_score": ideal["score"],
                "ideal_reasoning": ideal["reasoning"],
            })

    # Sort by query_id, then by ideal_rank (nulls last), then by rule_engine_rank (nulls last)
    def sort_key(r):
        return (
            r["query_id"],
            r["ideal_rank"] if r["ideal_rank"] is not None else 999,
            r["rule_engine_rank"] if r["rule_engine_rank"] is not None else 999,
        )
    merged.sort(key=sort_key)

    # Write output
    with open(OUTPUT_FILE, "w") as f:
        json.dump(merged, f, indent=2)

    # Print summary
    print(f"\n=== Merge Summary ===")
    print(f"Total queries: {stats['total_queries']}")
    print(f"Total merged records: {len(merged)}")
    print(f"  Matched (both sources): {stats['matched']}")
    print(f"  Rule engine only (ideal_rank=null, ML should penalize): {stats['rule_only']}")
    print(f"  Ideal only (features=null, ML should boost): {stats['ideal_only']}")
    print(f"Output: {OUTPUT_FILE}")

    # Per-query overlap analysis
    overlap_counts = []
    for q in training:
        qid = q["query_id"]
        ideal_ids = {item["restaurant_id"] for item in q["ideal_ranking"]}
        rule_ids = {r["restaurant_id"] for r in features_by_query.get(qid, [])}
        overlap = len(ideal_ids & rule_ids)
        overlap_counts.append(overlap)

    if overlap_counts:
        avg_overlap = sum(overlap_counts) / len(overlap_counts)
        perfect = sum(1 for c in overlap_counts if c == 5)
        zero = sum(1 for c in overlap_counts if c == 0)
        print(f"\nPer-query overlap (ideal vs rule engine top 6):")
        print(f"  Average overlap: {avg_overlap:.1f}/5 restaurants")
        print(f"  Perfect overlap (5/5): {perfect}/{len(overlap_counts)} queries")
        print(f"  Zero overlap (0/5): {zero}/{len(overlap_counts)} queries")
        print(f"  Distribution: {dict(sorted(defaultdict(int, {c: overlap_counts.count(c) for c in set(overlap_counts)}).items()))}")


if __name__ == "__main__":
    main()
