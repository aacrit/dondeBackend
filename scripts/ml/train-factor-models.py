#!/usr/bin/env python3
"""
Per-Factor ML Adjustment Models for DondeAI Scoring Engine

Trains 5 separate linear adjustment models (food, vibe, service, reputation, convenience)
using gauntlet_results graded test data. Each model learns when a factor score should be
adjusted up or down based on the overall grade outcome and context features.

Zero dependencies — pure Python 3 (stdlib only).

Usage:
    python3 scripts/ml/train-factor-models.py
"""

import json
import math
import os
import random
from datetime import datetime, timezone

# ── Configuration ────────────────────────────────────────────────────────────

FACTORS = ["food", "vibe", "service", "reputation", "convenience"]
CLAMP_MIN = -2.0
CLAMP_MAX = 2.0
HOLDOUT_FRACTION = 0.20
LEARNING_RATE = 0.001
EPOCHS = 200
SEED = 42

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_FILE = os.path.join(SCRIPT_DIR, "factor-training-data.json")
OUTPUT_FILE = os.path.join(SCRIPT_DIR, "factor-models.json")


# ── Grade utilities ──────────────────────────────────────────────────────────

GRADE_TO_NUMERIC = {
    "A+": 97, "A": 95, "A-": 92,
    "B+": 88, "B": 85, "B-": 81,
    "C+": 78, "C": 75, "C-": 72,
    "D+": 68, "D": 65, "D-": 62,
    "F": 50,
}


def grade_to_number(grade_str):
    """Convert letter grade to numeric value."""
    if not grade_str:
        return None
    # Handle grades like "A (95)" or just "A"
    g = grade_str.strip().split(" ")[0].split("(")[0].strip()
    return GRADE_TO_NUMERIC.get(g)


def is_good_grade(grade_str):
    """Returns True if grade is A or B tier."""
    n = grade_to_number(grade_str)
    return n is not None and n >= 80


def is_bad_grade(grade_str):
    """Returns True if grade is C, D, or F tier."""
    n = grade_to_number(grade_str)
    return n is not None and n < 80


# ── Feature engineering ──────────────────────────────────────────────────────

def collect_categories(data):
    """Collect unique values for one-hot encoding."""
    relevance_types = sorted(set(r.get("relevance_type", "unknown") or "unknown" for r in data))
    categories = sorted(set(r.get("category", "unknown") or "unknown" for r in data))
    return relevance_types, categories


def one_hot(value, vocab):
    """One-hot encode a value against a vocabulary list."""
    return [1.0 if value == v else 0.0 for v in vocab]


def build_features(row, target_factor, relevance_types, categories):
    """
    Build feature vector for predicting adjustment of target_factor.
    Features:
      - Other 4 factor scores (normalized to 0-1 by dividing by 10)
      - relevance_type one-hot
      - category one-hot
      - donde_match (normalized to 0-1 by dividing by 100)
      - score_fit_score (normalized to 0-1 by dividing by 100)
    """
    features = []

    # Other factor scores
    for f in FACTORS:
        if f != target_factor:
            val = row.get(f)
            features.append((val or 0.0) / 10.0)

    # One-hot: relevance_type
    rt = row.get("relevance_type", "unknown") or "unknown"
    features.extend(one_hot(rt, relevance_types))

    # One-hot: category
    cat = row.get("category", "unknown") or "unknown"
    features.extend(one_hot(cat, categories))

    # Donde match and score fit
    dm = row.get("donde_match")
    features.append((dm or 0.0) / 100.0)

    sf = row.get("score_fit_score")
    features.append((sf or 0.0) / 100.0)

    return features


def compute_target(row, target_factor):
    """
    Compute the adjustment target for a factor.

    Logic:
    - Uses score_fit_grade when available (100 rows), otherwise uses donde_match
      as a proxy for overall quality (all 2127 rows).
    - If the overall quality is good and this factor is low,
      the factor should have been higher (positive adjustment).
    - If the overall quality is bad and this factor is high,
      the factor should have been lower (negative adjustment).
    - The target adjustment is clamped to [-2.0, +2.0].

    The "ideal" factor score is derived from the quality signal:
    - score_fit_grade: grade 50-100 maps to ideal factor 5.0-9.5
    - donde_match: DM 0-100 maps to ideal factor 4.0-9.5
    """
    actual = row.get(target_factor)
    if actual is None:
        return None

    # Primary signal: score_fit_grade (when available)
    grade = row.get("score_fit_grade")
    grade_num = grade_to_number(grade) if grade else None

    if grade_num is not None:
        # Scale: grade 50-100 maps to ideal factor 5.0-9.5
        ideal = 5.0 + (grade_num - 50) / 50.0 * 4.5
    else:
        # Fallback: use donde_match as quality proxy
        dm = row.get("donde_match")
        if dm is None:
            return None
        # DM 0-100 maps to ideal factor 4.0-9.5
        # DM 70+ is "passing", so DM 70 → ideal ~7.1, DM 90 → ideal ~8.9
        ideal = 4.0 + (dm / 100.0) * 5.5

    adjustment = ideal - actual

    # Clamp
    adjustment = max(CLAMP_MIN, min(CLAMP_MAX, adjustment))

    return adjustment


# ── Linear regression (pure Python) ─────────────────────────────────────────

def dot(a, b):
    """Dot product of two vectors."""
    return sum(x * y for x, y in zip(a, b))


def train_linear_model(X_train, y_train, lr=LEARNING_RATE, epochs=EPOCHS):
    """
    Train a linear regression model using gradient descent.
    Returns (weights, bias).
    """
    n_features = len(X_train[0])
    n_samples = len(X_train)

    # Initialize weights to small random values
    random.seed(SEED)
    weights = [random.gauss(0, 0.01) for _ in range(n_features)]
    bias = 0.0

    for epoch in range(epochs):
        # Compute gradients
        grad_w = [0.0] * n_features
        grad_b = 0.0

        for i in range(n_samples):
            pred = dot(weights, X_train[i]) + bias
            error = pred - y_train[i]

            for j in range(n_features):
                grad_w[j] += error * X_train[i][j]
            grad_b += error

        # Update weights
        for j in range(n_features):
            weights[j] -= lr * (grad_w[j] / n_samples)
        bias -= lr * (grad_b / n_samples)

    return weights, bias


def predict(weights, bias, x):
    """Predict using linear model, clamped to adjustment range."""
    raw = dot(weights, x) + bias
    return max(CLAMP_MIN, min(CLAMP_MAX, raw))


def evaluate(weights, bias, X_test, y_test):
    """Compute evaluation metrics on test set."""
    n = len(X_test)
    if n == 0:
        return {"mae": 0.0, "rmse": 0.0, "n": 0}

    errors = []
    for i in range(n):
        pred = predict(weights, bias, X_test[i])
        errors.append(abs(pred - y_test[i]))

    mae = sum(errors) / n
    mse = sum(e ** 2 for e in errors) / n
    rmse = math.sqrt(mse)

    # Directional accuracy: does the model predict the correct sign?
    correct_direction = 0
    for i in range(n):
        pred = predict(weights, bias, X_test[i])
        if (pred >= 0 and y_test[i] >= 0) or (pred < 0 and y_test[i] < 0):
            correct_direction += 1
    dir_accuracy = correct_direction / n if n > 0 else 0.0

    return {
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "directional_accuracy": round(dir_accuracy, 4),
        "n_test": n,
    }


# ── Feature name mapping ────────────────────────────────────────────────────

def get_feature_names(target_factor, relevance_types, categories):
    """Build human-readable feature names matching build_features order."""
    names = []
    for f in FACTORS:
        if f != target_factor:
            names.append(f"other_{f}")
    for rt in relevance_types:
        names.append(f"rel_type_{rt}")
    for cat in categories:
        names.append(f"category_{cat}")
    names.append("donde_match")
    names.append("score_fit_score")
    return names


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("DondeAI Per-Factor ML Model Training")
    print("=" * 70)

    # Load data
    with open(INPUT_FILE) as f:
        data = json.load(f)
    print(f"\nLoaded {len(data)} training examples from {INPUT_FILE}")

    # Collect vocabularies
    relevance_types, categories = collect_categories(data)
    print(f"Relevance types ({len(relevance_types)}): {relevance_types}")
    print(f"Categories ({len(categories)}): {categories}")

    # Train a model per factor
    models = {}
    all_metrics = {}

    for factor in FACTORS:
        print(f"\n{'─' * 70}")
        print(f"Training model for: {factor.upper()}")
        print(f"{'─' * 70}")

        # Build dataset
        X = []
        y = []
        skipped = 0

        for row in data:
            target = compute_target(row, factor)
            if target is None:
                skipped += 1
                continue
            features = build_features(row, factor, relevance_types, categories)
            X.append(features)
            y.append(target)

        print(f"  Samples: {len(X)} (skipped {skipped} with missing data)")

        if len(X) < 10:
            print(f"  SKIPPING — insufficient data")
            continue

        # Target distribution
        y_pos = sum(1 for v in y if v > 0)
        y_neg = sum(1 for v in y if v < 0)
        y_zero = sum(1 for v in y if v == 0)
        y_mean = sum(y) / len(y)
        y_std = math.sqrt(sum((v - y_mean) ** 2 for v in y) / len(y))
        print(f"  Target distribution: {y_pos} positive, {y_neg} negative, {y_zero} zero")
        print(f"  Target mean: {y_mean:.4f}, std: {y_std:.4f}")

        # Split into train/test
        random.seed(SEED)
        indices = list(range(len(X)))
        random.shuffle(indices)
        split = int(len(indices) * (1 - HOLDOUT_FRACTION))

        train_idx = indices[:split]
        test_idx = indices[split:]

        X_train = [X[i] for i in train_idx]
        y_train = [y[i] for i in train_idx]
        X_test = [X[i] for i in test_idx]
        y_test = [y[i] for i in test_idx]

        print(f"  Train: {len(X_train)}, Test: {len(X_test)}")

        # Train
        weights, bias = train_linear_model(X_train, y_train)

        # Evaluate
        train_metrics = evaluate(weights, bias, X_train, y_train)
        test_metrics = evaluate(weights, bias, X_test, y_test)

        print(f"  Train MAE: {train_metrics['mae']:.4f}, RMSE: {train_metrics['rmse']:.4f}, "
              f"Dir Acc: {train_metrics['directional_accuracy']:.2%}")
        print(f"  Test  MAE: {test_metrics['mae']:.4f}, RMSE: {test_metrics['rmse']:.4f}, "
              f"Dir Acc: {test_metrics['directional_accuracy']:.2%}")

        # Build named weight dict
        feature_names = get_feature_names(factor, relevance_types, categories)
        weight_dict = {}
        for name, w in zip(feature_names, weights):
            weight_dict[name] = round(w, 6)

        # Show top influential features
        sorted_weights = sorted(weight_dict.items(), key=lambda kv: abs(kv[1]), reverse=True)
        print(f"  Top 5 features by |weight|:")
        for name, w in sorted_weights[:5]:
            direction = "+" if w > 0 else "-" if w < 0 else "0"
            print(f"    {direction} {name}: {w:.6f}")

        models[factor] = {
            "weights": weight_dict,
            "bias": round(bias, 6),
            "metrics": {
                "train": train_metrics,
                "test": test_metrics,
            },
            "n_features": len(feature_names),
            "n_train": len(X_train),
            "n_test": len(X_test),
        }
        all_metrics[factor] = test_metrics

    # Build output
    output = {
        "version": "1.0.0",
        "created": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "description": "Per-factor linear adjustment models for DondeAI scoring engine",
        "config": {
            "clamp_range": [CLAMP_MIN, CLAMP_MAX],
            "learning_rate": LEARNING_RATE,
            "epochs": EPOCHS,
            "holdout_fraction": HOLDOUT_FRACTION,
            "seed": SEED,
        },
        "vocabularies": {
            "relevance_types": relevance_types,
            "categories": categories,
        },
        "factors": models,
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n{'=' * 70}")
    print(f"MODEL SUMMARY")
    print(f"{'=' * 70}")
    print(f"Output: {OUTPUT_FILE}")
    print(f"Factors trained: {len(models)}")
    print(f"\nPer-factor test metrics:")
    for factor in FACTORS:
        if factor in all_metrics:
            m = all_metrics[factor]
            print(f"  {factor:12s}  MAE={m['mae']:.4f}  RMSE={m['rmse']:.4f}  "
                  f"DirAcc={m['directional_accuracy']:.2%}  (n={m['n_test']})")

    avg_mae = sum(m["mae"] for m in all_metrics.values()) / len(all_metrics) if all_metrics else 0
    avg_dir = sum(m["directional_accuracy"] for m in all_metrics.values()) / len(all_metrics) if all_metrics else 0
    print(f"\n  {'AVERAGE':12s}  MAE={avg_mae:.4f}  DirAcc={avg_dir:.2%}")
    print(f"\nDone.")


if __name__ == "__main__":
    main()
