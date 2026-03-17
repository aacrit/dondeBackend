#!/usr/bin/env python3
"""
DondeAI ML A/B Test Simulator — $0 cost, no API calls.

Compares rule-engine-only scores vs ML-adjusted scores against the
teacher's ideal rankings. Uses existing data:
  - features-dataset.json (rule engine scores for 210 queries)
  - training-data.json (ideal teacher rankings)
  - model.json (trained ML weights)

Usage: python3 simulate-ab-test.py
"""

import json
import os
import math

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# ============================================================================
# LOAD DATA
# ============================================================================

def load_json(filename):
    path = os.path.join(SCRIPT_DIR, filename)
    with open(path) as f:
        return json.load(f)

def load_model():
    model = load_json("model.json")
    return model

# ============================================================================
# ML INFERENCE (mirrors ml-adjustment.ts)
# ============================================================================

def predict_adjustment(features, model):
    if model["model_type"] == "linear_adjustment":
        pred = model.get("bias", 0)
        for name, i in zip(model["feature_names"], range(len(features))):
            pred += model.get("weights", {}).get(name, 0) * features[i]
        return max(-5, min(5, round(pred * 10) / 10))
    return 0

def extract_features(record):
    f = record.get("features", {})
    if not f:
        return None

    rel_type = f.get("relevance_type", "")
    price = record.get("price_level", "$$")
    price_num = {"$": 1, "$$": 2, "$$$": 3, "$$$$": 4}.get(price, 2)
    query = record.get("query", "")
    words = query.lower().split()

    cuisine_kw = {"italian","mexican","thai","japanese","chinese","korean","indian",
                  "french","greek","vietnamese","ethiopian","peruvian","polish","mediterranean",
                  "cuban","taiwanese","korean","szechuan","senegalese","nigerian","eritrean"}
    neighborhood_kw = {"loop","west loop","lincoln park","wicker park","logan square",
                       "pilsen","chinatown","river north","lakeview","hyde park","bucktown",
                       "wrigley","fulton","andersonville"}

    return [
        f.get("relevance_score", 0),
        1 if rel_type == "dish" else 0,
        1 if rel_type in ("cuisine", "cuisine_match") else 0,
        1 if rel_type == "vibe" else 0,
        1 if rel_type == "reputation" else 0,
        1 if rel_type == "semantic" else 0,
        1 if rel_type == "open_ended" else 0,
        f.get("food", 0),
        f.get("vibe", 0),
        f.get("service", 0),
        f.get("reputation", 0),
        f.get("convenience", 0),
        f.get("data_completeness", 0),
        f.get("quality_score", 0),
        price_num,
        len(words),
        1 if any(w in cuisine_kw for w in words) else 0,
        1 if any(w in neighborhood_kw for w in words) else 0,
        record.get("rule_donde_match", 0) or 0,
        f.get("occasion_bonus", 0),
        record.get("rule_engine_rank", 3) or 3,
        3,  # ideal_rank placeholder (not used for inference)
    ]

# ============================================================================
# RANKING METRICS
# ============================================================================

def dcg_at_k(scores, k=5):
    """Discounted Cumulative Gain at position k."""
    dcg = 0
    for i, score in enumerate(scores[:k]):
        dcg += score / math.log2(i + 2)
    return dcg

def ndcg_at_k(predicted_order, ideal_scores, k=5):
    """Normalized DCG: how close is predicted ranking to ideal?"""
    # Get scores in predicted order
    pred_scores = [ideal_scores.get(rid, 0) for rid in predicted_order[:k]]
    # Get scores in ideal order (sorted descending)
    ideal_sorted = sorted(ideal_scores.values(), reverse=True)[:k]

    dcg = dcg_at_k(pred_scores, k)
    idcg = dcg_at_k(ideal_sorted, k)

    return dcg / idcg if idcg > 0 else 0

def hit_at_k(predicted_ids, ideal_ids, k=5):
    """What fraction of ideal top-K restaurants appear in predicted top-K?"""
    pred_set = set(predicted_ids[:k])
    ideal_set = set(ideal_ids[:k])
    if not ideal_set:
        return 0
    return len(pred_set & ideal_set) / len(ideal_set)

# ============================================================================
# MAIN SIMULATION
# ============================================================================

def main():
    print("=" * 70)
    print("  DondeAI ML A/B Test Simulator — $0 cost, pure local computation")
    print("=" * 70)

    # Load data
    features_data = load_json("features-dataset.json")
    teacher_data = load_json("training-data.json")
    model = load_model()

    print(f"\nData loaded:")
    print(f"  Rule engine features: {len(features_data)} records")
    print(f"  Teacher rankings:     {len(teacher_data)} queries")
    print(f"  Model: {model['model_type']} v{model['version']}")
    print(f"  Training metrics: MAE={model.get('training_metrics',{}).get('mae','?')}, "
          f"Concordance={model.get('training_metrics',{}).get('concordance','?')}")

    # Index features by query_id
    features_by_query = {}
    for record in features_data:
        qid = record["query_id"]
        if qid not in features_by_query:
            features_by_query[qid] = []
        features_by_query[qid].append(record)

    # Index teacher rankings by query_id
    teacher_by_query = {}
    for entry in teacher_data:
        qid = entry["query_id"]
        teacher_by_query[qid] = entry

    # Simulate A/B test
    rules_ndcg_scores = []
    ml_ndcg_scores = []
    rules_hit_scores = []
    ml_hit_scores = []

    improvements = []
    regressions = []
    unchanged = []

    queries_compared = 0

    print(f"\n{'='*70}")
    print(f"  QUERY-BY-QUERY COMPARISON")
    print(f"{'='*70}")
    print(f"{'Query':<45} {'Rules':>8} {'ML':>8} {'Delta':>8}")
    print(f"{'-'*45} {'-'*8} {'-'*8} {'-'*8}")

    for qid in sorted(features_by_query.keys()):
        if qid not in teacher_by_query:
            continue

        candidates = features_by_query[qid]
        teacher = teacher_by_query[qid]
        ideal_ranking = teacher.get("ideal_ranking", [])

        if not ideal_ranking or not candidates:
            continue

        # Build ideal score map (restaurant_id -> teacher score)
        ideal_scores = {}
        ideal_ids = []
        for r in ideal_ranking:
            rid = r.get("restaurant_id", "")
            score = r.get("score", 0)
            ideal_scores[rid] = score
            ideal_ids.append(rid)

        # --- GROUP A: Rules only ---
        rules_ranking = sorted(candidates, key=lambda x: x.get("rule_donde_match", 0) or 0, reverse=True)
        rules_ids = [r["restaurant_id"] for r in rules_ranking]
        rules_scores = {r["restaurant_id"]: r.get("rule_donde_match", 0) or 0 for r in rules_ranking}

        # --- GROUP B: ML-adjusted ---
        ml_candidates = []
        for record in candidates:
            features = extract_features(record)
            rule_dm = record.get("rule_donde_match", 0) or 0
            if features:
                adjustment = predict_adjustment(features, model)
                ml_dm = max(0, min(99, rule_dm + adjustment))
            else:
                ml_dm = rule_dm
                adjustment = 0
            ml_candidates.append({
                "restaurant_id": record["restaurant_id"],
                "restaurant_name": record.get("restaurant_name", ""),
                "rule_dm": rule_dm,
                "ml_adjustment": adjustment,
                "ml_dm": ml_dm,
            })

        ml_ranking = sorted(ml_candidates, key=lambda x: x["ml_dm"], reverse=True)
        ml_ids = [r["restaurant_id"] for r in ml_ranking]

        # Compute metrics
        rules_ndcg = ndcg_at_k(rules_ids, ideal_scores, k=5)
        ml_ndcg = ndcg_at_k(ml_ids, ideal_scores, k=5)
        rules_hit = hit_at_k(rules_ids, ideal_ids, k=5)
        ml_hit = hit_at_k(ml_ids, ideal_ids, k=5)

        rules_ndcg_scores.append(rules_ndcg)
        ml_ndcg_scores.append(ml_ndcg)
        rules_hit_scores.append(rules_hit)
        ml_hit_scores.append(ml_hit)
        queries_compared += 1

        query_text = teacher.get("query", f"Query {qid}")[:44]
        delta = ml_ndcg - rules_ndcg

        marker = ""
        if delta > 0.01:
            improvements.append((qid, query_text, rules_ndcg, ml_ndcg, delta))
            marker = " +"
        elif delta < -0.01:
            regressions.append((qid, query_text, rules_ndcg, ml_ndcg, delta))
            marker = " -"
        else:
            unchanged.append((qid, query_text, rules_ndcg, ml_ndcg))

        print(f"{query_text:<45} {rules_ndcg:8.3f} {ml_ndcg:8.3f} {delta:+8.3f}{marker}")

    # ========================================================================
    # AGGREGATE RESULTS
    # ========================================================================

    print(f"\n{'='*70}")
    print(f"  AGGREGATE RESULTS ({queries_compared} queries)")
    print(f"{'='*70}")

    avg_rules_ndcg = sum(rules_ndcg_scores) / len(rules_ndcg_scores) if rules_ndcg_scores else 0
    avg_ml_ndcg = sum(ml_ndcg_scores) / len(ml_ndcg_scores) if ml_ndcg_scores else 0
    avg_rules_hit = sum(rules_hit_scores) / len(rules_hit_scores) if rules_hit_scores else 0
    avg_ml_hit = sum(ml_hit_scores) / len(ml_hit_scores) if ml_hit_scores else 0

    print(f"\n{'Metric':<35} {'Rules':>10} {'ML':>10} {'Delta':>10} {'Winner':>10}")
    print(f"{'-'*35} {'-'*10} {'-'*10} {'-'*10} {'-'*10}")
    print(f"{'NDCG@5 (ranking quality)':<35} {avg_rules_ndcg:10.4f} {avg_ml_ndcg:10.4f} {avg_ml_ndcg - avg_rules_ndcg:+10.4f} {'ML' if avg_ml_ndcg > avg_rules_ndcg else 'Rules':>10}")
    print(f"{'Hit@5 (overlap with ideal)':<35} {avg_rules_hit:10.4f} {avg_ml_hit:10.4f} {avg_ml_hit - avg_rules_hit:+10.4f} {'ML' if avg_ml_hit > avg_rules_hit else 'Rules':>10}")

    print(f"\n{'Category':<35} {'Count':>10} {'Pct':>10}")
    print(f"{'-'*35} {'-'*10} {'-'*10}")
    print(f"{'Queries where ML improves':<35} {len(improvements):>10} {len(improvements)/queries_compared*100:>9.1f}%")
    print(f"{'Queries where ML regresses':<35} {len(regressions):>10} {len(regressions)/queries_compared*100:>9.1f}%")
    print(f"{'Queries unchanged':<35} {len(unchanged):>10} {len(unchanged)/queries_compared*100:>9.1f}%")

    # Top improvements
    if improvements:
        improvements.sort(key=lambda x: x[4], reverse=True)
        print(f"\n{'='*70}")
        print(f"  TOP 10 IMPROVEMENTS (ML wins)")
        print(f"{'='*70}")
        for qid, query, r_ndcg, m_ndcg, delta in improvements[:10]:
            print(f"  Q{qid:>3}: {query:<40} Rules={r_ndcg:.3f} ML={m_ndcg:.3f} +{delta:.3f}")

    # Top regressions
    if regressions:
        regressions.sort(key=lambda x: x[4])
        print(f"\n{'='*70}")
        print(f"  TOP 10 REGRESSIONS (Rules wins)")
        print(f"{'='*70}")
        for qid, query, r_ndcg, m_ndcg, delta in regressions[:10]:
            print(f"  Q{qid:>3}: {query:<40} Rules={r_ndcg:.3f} ML={m_ndcg:.3f} {delta:.3f}")

    # Score distribution comparison
    print(f"\n{'='*70}")
    print(f"  SCORE DISTRIBUTION IMPACT")
    print(f"{'='*70}")

    all_rule_dms = []
    all_ml_dms = []
    all_adjustments = []

    for qid in features_by_query:
        for record in features_by_query[qid]:
            rule_dm = record.get("rule_donde_match", 0) or 0
            features = extract_features(record)
            if features:
                adj = predict_adjustment(features, model)
                ml_dm = max(0, min(99, rule_dm + adj))
                all_rule_dms.append(rule_dm)
                all_ml_dms.append(ml_dm)
                all_adjustments.append(adj)

    if all_rule_dms:
        rule_mean = sum(all_rule_dms) / len(all_rule_dms)
        ml_mean = sum(all_ml_dms) / len(all_ml_dms)
        rule_std = (sum((x - rule_mean)**2 for x in all_rule_dms) / len(all_rule_dms)) ** 0.5
        ml_std = (sum((x - ml_mean)**2 for x in all_ml_dms) / len(all_ml_dms)) ** 0.5
        adj_mean = sum(all_adjustments) / len(all_adjustments)
        adj_pos = sum(1 for a in all_adjustments if a > 0)
        adj_neg = sum(1 for a in all_adjustments if a < 0)
        adj_zero = sum(1 for a in all_adjustments if a == 0)

        print(f"  {'':30} {'Rules':>10} {'ML':>10}")
        print(f"  {'Mean DondeMatch':<30} {rule_mean:>10.1f} {ml_mean:>10.1f}")
        print(f"  {'Std Dev':<30} {rule_std:>10.1f} {ml_std:>10.1f}")
        print(f"  {'Min':<30} {min(all_rule_dms):>10.0f} {min(all_ml_dms):>10.0f}")
        print(f"  {'Max':<30} {max(all_rule_dms):>10.0f} {max(all_ml_dms):>10.0f}")
        print(f"\n  Adjustment distribution ({len(all_adjustments)} restaurants):")
        print(f"    Boosted (+):  {adj_pos:>5} ({adj_pos/len(all_adjustments)*100:.1f}%)")
        print(f"    Penalized (-): {adj_neg:>4} ({adj_neg/len(all_adjustments)*100:.1f}%)")
        print(f"    Unchanged (0): {adj_zero:>4} ({adj_zero/len(all_adjustments)*100:.1f}%)")
        print(f"    Mean adjustment: {adj_mean:+.2f} points")

    # ========================================================================
    # VERDICT
    # ========================================================================

    print(f"\n{'='*70}")
    print(f"  VERDICT")
    print(f"{'='*70}")

    ndcg_delta = avg_ml_ndcg - avg_rules_ndcg
    if ndcg_delta > 0.02:
        print(f"\n  ML WINS: NDCG@5 improved by {ndcg_delta:+.4f}")
        print(f"  Recommendation: Increase ML_AB_TEST_PERCENTAGE to 100%")
    elif ndcg_delta < -0.02:
        print(f"\n  RULES WIN: NDCG@5 degraded by {ndcg_delta:+.4f}")
        print(f"  Recommendation: Set ML_AB_TEST_PERCENTAGE to 0%, retrain model")
    else:
        print(f"\n  TIE: NDCG@5 delta is {ndcg_delta:+.4f} (within noise)")
        print(f"  Recommendation: Collect more training data, retrain with XGBoost")

    imp_pct = len(improvements) / queries_compared * 100 if queries_compared else 0
    reg_pct = len(regressions) / queries_compared * 100 if queries_compared else 0
    print(f"\n  Improved: {imp_pct:.0f}% of queries | Regressed: {reg_pct:.0f}% of queries")
    print(f"  Net improvement ratio: {imp_pct - reg_pct:+.0f}%")

if __name__ == "__main__":
    main()
