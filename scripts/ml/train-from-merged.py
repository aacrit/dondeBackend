#!/usr/bin/env python3
"""
DondeAI Linear Model Training — works with merged-training-data.json format.
Zero external dependencies (pure Python).

Trains on records that have BOTH rule engine features AND ideal scores.
Learns the adjustment: ideal_score - rule_donde_match = delta to predict.

Usage: python3 train-from-merged.py
"""

import json
import math
import os

FEATURE_NAMES = [
    "relevance_score", "rel_dish", "rel_cuisine", "rel_vibe",
    "rel_reputation", "rel_semantic", "rel_open_ended",
    "food", "vibe", "service", "reputation", "convenience",
    "data_completeness", "quality_score",
    "price_numeric", "query_words",
    "has_cuisine_kw", "has_neighborhood_kw",
    "rule_donde_match", "occasion_bonus",
    "rule_rank", "ideal_rank"
]

def extract_features(record):
    """Extract feature vector from a merged training record."""
    f = record.get("features", {})
    if not f:
        return None

    rel_type = f.get("relevance_type", "")
    price = record.get("price_level", "$$")
    price_num = {"$": 1, "$$": 2, "$$$": 3, "$$$$": 4}.get(price, 2)
    query = record.get("query", "")
    words = query.lower().split()

    cuisine_keywords = {"italian","mexican","thai","japanese","chinese","korean","indian",
                       "french","greek","vietnamese","ethiopian","peruvian","polish","mediterranean"}
    neighborhood_keywords = {"loop","west loop","lincoln park","wicker park","logan square",
                            "pilsen","chinatown","river north","lakeview","hyde park","bucktown"}

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
        1 if any(w in cuisine_keywords for w in words) else 0,
        1 if any(w in neighborhood_keywords for w in words) else 0,
        record.get("rule_donde_match", 0) or 0,
        f.get("occasion_bonus", 0),
        record.get("rule_engine_rank", 3) or 3,
        record.get("ideal_rank", 3) or 3,
    ]

def solve_linear(X, y):
    """Solve linear regression via normal equations (pure Python)."""
    n = len(X)
    p = len(X[0])

    # Add bias column
    X_bias = [[1.0] + row for row in X]
    p_bias = p + 1

    # Compute X^T X
    XtX = [[0.0] * p_bias for _ in range(p_bias)]
    for i in range(p_bias):
        for j in range(p_bias):
            s = 0.0
            for k in range(n):
                s += X_bias[k][i] * X_bias[k][j]
            XtX[i][j] = s

    # Add regularization (Ridge, lambda=1.0)
    for i in range(p_bias):
        XtX[i][i] += 1.0

    # Compute X^T y
    Xty = [0.0] * p_bias
    for i in range(p_bias):
        s = 0.0
        for k in range(n):
            s += X_bias[k][i] * y[k]
        Xty[i] = s

    # Gaussian elimination with partial pivoting
    A = [XtX[i][:] + [Xty[i]] for i in range(p_bias)]
    for col in range(p_bias):
        max_row = col
        for row in range(col + 1, p_bias):
            if abs(A[row][col]) > abs(A[max_row][col]):
                max_row = row
        A[col], A[max_row] = A[max_row], A[col]

        if abs(A[col][col]) < 1e-12:
            continue

        for row in range(col + 1, p_bias):
            factor = A[row][col] / A[col][col]
            for j in range(col, p_bias + 1):
                A[row][j] -= factor * A[col][j]

    # Back substitution
    weights = [0.0] * p_bias
    for i in range(p_bias - 1, -1, -1):
        if abs(A[i][i]) < 1e-12:
            continue
        weights[i] = A[i][p_bias]
        for j in range(i + 1, p_bias):
            weights[i] -= A[i][j] * weights[j]
        weights[i] /= A[i][i]

    return weights[0], weights[1:]  # bias, feature_weights

def main():
    print("=" * 60)
    print("DondeAI Linear Model Training (from merged data)")
    print("=" * 60)

    data_path = os.path.join(os.path.dirname(__file__), "merged-training-data.json")
    with open(data_path) as f:
        data = json.load(f)
    print(f"Loaded {len(data)} records")

    # Filter to records with both features AND ideal scores AND rule scores
    # We want to learn: what adjustment makes rule_donde_match closer to ideal_score?
    examples = []
    for record in data:
        if not record.get("features"):
            continue
        if record.get("rule_donde_match") is None:
            continue
        if record.get("ideal_score") is None:
            continue

        features = extract_features(record)
        if features is None:
            continue

        # Target: ideal_score - rule_donde_match (what should the adjustment be?)
        delta = record["ideal_score"] - record["rule_donde_match"]
        # Clamp to realistic range
        delta = max(-20, min(20, delta))

        examples.append((features, delta, record))

    # Also add records where rule engine ranked but teacher didn't (mild negative signal)
    # Key fix: use a MILD penalty (-2 not -5) since rule picks aren't necessarily wrong,
    # they're just different from teacher. Teacher only ranked 5, rule engine may have
    # valid alternatives. Also DOWNSAMPLE to balance with positive examples.
    negative_examples = []
    for record in data:
        if not record.get("features"):
            continue
        if record.get("rule_donde_match") is None:
            continue
        if record.get("ideal_rank") is None and record.get("ideal_score") is None:
            features = extract_features(record)
            if features:
                # Mild penalty: rule engine picked it but teacher didn't
                delta = -2.0
                negative_examples.append((features, delta, record))

    # Downsample negatives to at most 2x the positive count for balance
    import random
    random.seed(42)
    max_negatives = len(examples) * 2
    if len(negative_examples) > max_negatives:
        negative_examples = random.sample(negative_examples, max_negatives)
    examples.extend(negative_examples)

    print(f"Training examples: {len(examples)}")

    if len(examples) < 10:
        print("[ERROR] Not enough training examples")
        return

    # Split: 80% train, 20% validation (by query_id)
    query_ids = list(set(r[2]["query_id"] for r in examples))
    query_ids.sort()
    split_idx = int(len(query_ids) * 0.8)
    train_qids = set(query_ids[:split_idx])
    val_qids = set(query_ids[split_idx:])

    train_X = [e[0] for e in examples if e[2]["query_id"] in train_qids]
    train_y = [e[1] for e in examples if e[2]["query_id"] in train_qids]
    val_X = [e[0] for e in examples if e[2]["query_id"] in val_qids]
    val_y = [e[1] for e in examples if e[2]["query_id"] in val_qids]

    print(f"Train: {len(train_X)} examples ({len(train_qids)} queries)")
    print(f"Validation: {len(val_X)} examples ({len(val_qids)} queries)")

    # Train
    print("\nTraining linear regression...")
    bias, weights = solve_linear(train_X, train_y)

    # Evaluate on validation
    val_errors = []
    val_predictions = []
    for x, y_true in zip(val_X, val_y):
        y_pred = bias + sum(w * xi for w, xi in zip(weights, x))
        val_errors.append(abs(y_pred - y_true))
        val_predictions.append((y_pred, y_true))

    mae = sum(val_errors) / len(val_errors) if val_errors else 0
    rmse = math.sqrt(sum(e**2 for e in val_errors) / len(val_errors)) if val_errors else 0

    # Pairwise concordance (ranking accuracy)
    concordant = 0
    discordant = 0
    for i in range(len(val_predictions)):
        for j in range(i + 1, min(i + 50, len(val_predictions))):  # Sample pairs
            pred_diff = val_predictions[i][0] - val_predictions[j][0]
            true_diff = val_predictions[i][1] - val_predictions[j][1]
            if pred_diff * true_diff > 0:
                concordant += 1
            elif pred_diff * true_diff < 0:
                discordant += 1

    total_pairs = concordant + discordant
    concordance = concordant / total_pairs if total_pairs > 0 else 0.5

    print(f"\n{'='*60}")
    print(f"VALIDATION RESULTS")
    print(f"{'='*60}")
    print(f"MAE:  {mae:.2f} points")
    print(f"RMSE: {rmse:.2f} points")
    print(f"Pairwise concordance: {concordance:.3f} ({concordant}/{total_pairs})")
    print(f"(0.5 = random, 1.0 = perfect ranking)")

    # Feature importance
    print(f"\n{'='*60}")
    print(f"FEATURE WEIGHTS (top 10 by |weight|)")
    print(f"{'='*60}")
    weight_pairs = list(zip(FEATURE_NAMES, weights))
    weight_pairs.sort(key=lambda x: abs(x[1]), reverse=True)
    for name, w in weight_pairs[:10]:
        direction = "+" if w > 0 else ""
        print(f"  {name:25s} {direction}{w:.4f}")

    print(f"\n  Bias: {bias:.4f}")

    # Export model
    model = {
        "model_type": "linear_adjustment",
        "version": "1.0.0",
        "created": "2026-03-16",
        "feature_names": FEATURE_NAMES,
        "weights": {name: round(w, 6) for name, w in zip(FEATURE_NAMES, weights)},
        "bias": round(bias, 6),
        "training_metrics": {
            "mae": round(mae, 3),
            "rmse": round(rmse, 3),
            "concordance": round(concordance, 4),
            "n_train": len(train_X),
            "n_validation": len(val_X),
            "n_features": len(FEATURE_NAMES),
        }
    }

    model_path = os.path.join(os.path.dirname(__file__), "model.json")
    with open(model_path, "w") as f:
        json.dump(model, f, indent=2)
    print(f"\nModel saved to {model_path}")
    print(f"Model size: {os.path.getsize(model_path)} bytes")

    # Also save to Edge Function location
    edge_path = os.path.join(os.path.dirname(__file__), "..", "..",
                             "supabase", "functions", "recommend", "_shared", "ml-model.json")
    edge_path = os.path.normpath(edge_path)
    try:
        with open(edge_path, "w") as f:
            json.dump(model, f, indent=2)
        print(f"Model deployed to {edge_path}")
    except Exception as e:
        print(f"Could not deploy to Edge Function path: {e}")
        print(f"Manually copy: cp {model_path} {edge_path}")

    # Show example predictions
    print(f"\n{'='*60}")
    print(f"EXAMPLE PREDICTIONS (first 10 validation)")
    print(f"{'='*60}")
    print(f"{'Rule DM':>8} {'Ideal':>8} {'ML Adj':>8} {'ML DM':>8} {'Delta':>8}")
    for i, ((pred, true), x) in enumerate(zip(val_predictions[:10], val_X[:10])):
        rule_dm = x[18]  # rule_donde_match feature
        clamped = max(-5, min(5, pred))
        ml_dm = max(0, min(99, rule_dm + clamped))
        print(f"{rule_dm:8.0f} {rule_dm + true:8.1f} {clamped:+8.2f} {ml_dm:8.1f} {true:+8.1f}")

if __name__ == "__main__":
    main()
