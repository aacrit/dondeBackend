#!/usr/bin/env python3
"""
DondeAI Knowledge Distillation - Simple Linear Regression Trainer
Zero-dependency fallback using only Python standard library + numpy.

Trains a linear regression model to predict teacher's ideal DondeMatch
scores from 22 extracted features. Good enough for a first iteration
while the full XGBoost pipeline is being set up.

Usage:
  pip install numpy
  python train-simple.py [--input training-data.json] [--output model-linear.json]

Output: model-linear.json with per-feature weights + bias term.
The TypeScript inference wrapper can consume this for linear score adjustments.
"""

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

# ============================================================================
# CONSTANTS — must match distill-train.ts / xgboost-inference.ts
# ============================================================================

FEATURE_NAMES = [
    "relevance_score",
    "relevance_type_dish",
    "relevance_type_cuisine",
    "relevance_type_vibe",
    "relevance_type_reputation",
    "relevance_type_open_ended",
    "food_score",
    "vibe_score",
    "service_score",
    "reputation_score",
    "convenience_score",
    "data_completeness",
    "cuisine_match_exact",
    "neighborhood_match",
    "price_match",
    "trending_score",
    "google_rating_bayesian",
    "query_word_count",
    "query_has_cuisine",
    "query_has_dish",
    "query_has_vibe",
    "query_has_neighborhood",
]

CUISINE_KEYWORDS = [
    "italian", "mexican", "chinese", "japanese", "thai", "indian", "korean",
    "vietnamese", "french", "greek", "mediterranean", "ethiopian", "cuban",
    "peruvian", "colombian", "brazilian", "turkish", "lebanese", "moroccan",
    "polish", "german", "irish", "soul food", "southern", "cajun", "bbq",
    "seafood", "steakhouse", "sushi", "ramen", "pho", "taiwanese", "szechuan",
    "eritrean", "somali", "nigerian", "senegalese", "jamaican", "caribbean",
    "hawaiian", "filipino", "malaysian", "pakistani", "nepalese", "tibetan",
    "georgian", "persian", "palestinian", "yemeni", "puerto rican", "salvadoran",
    "argentinian", "venezuelan", "ecuadorian", "ukrainian", "bosnian", "serbian",
]

DISH_KEYWORDS = [
    "pizza", "burger", "tacos", "sushi", "ramen", "pho", "pasta", "steak",
    "wings", "dumplings", "soup dumplings", "dim sum", "pad thai", "bibimbap",
    "shawarma", "falafel", "kebab", "gyoza", "omakase", "ceviche", "pupusa",
    "empanada", "pierogi", "momo", "fondue", "hot dog", "deep dish", "lobster",
    "oysters", "fried chicken", "smash burger", "hand rolls", "grain bowl",
    "acai bowl", "charcuterie", "brunch", "noodles", "curry", "sandwich",
    "calzone", "wagyu", "oxtail", "pozole", "birria", "al pastor",
    "hot chicken", "jerk chicken", "truffle pasta", "lobster bisque",
]

VIBE_KEYWORDS = [
    "cozy", "romantic", "lively", "quiet", "intimate", "upscale", "casual",
    "trendy", "hip", "divey", "dive bar", "speakeasy", "rooftop", "outdoor",
    "patio", "garden", "waterfront", "sports bar", "jazz", "live music",
    "karaoke", "tiki", "lounge", "cocktail", "wine bar", "pub", "brewery",
    "date night", "power lunch", "family friendly", "kid friendly",
    "bottomless brunch", "happy hour", "late night",
]

NEIGHBORHOOD_KEYWORDS = [
    "loop", "west loop", "river north", "lincoln park", "wicker park",
    "logan square", "bucktown", "pilsen", "chinatown", "hyde park",
    "lakeview", "andersonville", "uptown", "edgewater", "rogers park",
    "bridgeport", "south loop", "gold coast", "old town", "ukrainian village",
    "avondale", "humboldt park", "irving park", "north center", "streeterville",
    "fulton market", "wrigley", "wrigleyville", "downtown", "magnificent mile",
    "little italy", "boystown",
]

CATEGORY_TO_RELEVANCE = {
    "Food": "cuisine",
    "Dish": "dish",
    "Cuisine": "cuisine",
    "Vibe": "vibe",
    "Reputation": "reputation",
    "Service": "reputation",
    "Discovery": "open_ended",
    "Contextual": "open_ended",
    "Convenience": "open_ended",
    "Multi": "open_ended",
    "Constraints": "open_ended",
}


# ============================================================================
# PURE PYTHON MATH (fallback when numpy is not available)
# ============================================================================

def py_dot(a, b):
    """Dot product of two lists."""
    return sum(x * y for x, y in zip(a, b))


def py_mat_mul(A, B_T):
    """Multiply matrix A by transpose of B (both are list-of-lists)."""
    n = len(A)
    m = len(B_T)
    k = len(A[0])
    result = [[0.0] * m for _ in range(n)]
    for i in range(n):
        for j in range(m):
            for p in range(k):
                result[i][j] += A[i][p] * B_T[j][p]
    return result


def py_lstsq(X, y):
    """
    Solve least squares using normal equations: w = (X^T X)^-1 X^T y.
    Pure Python implementation for when numpy is not available.
    Uses Cholesky-like approach with regularization.
    """
    n = len(X)
    m = len(X[0])

    # X^T X with L2 regularization (lambda=0.01)
    XtX = [[0.0] * m for _ in range(m)]
    for i in range(m):
        for j in range(m):
            s = 0.0
            for k in range(n):
                s += X[k][i] * X[k][j]
            XtX[i][j] = s
        XtX[i][i] += 0.01  # regularization

    # X^T y
    Xty = [0.0] * m
    for i in range(m):
        s = 0.0
        for k in range(n):
            s += X[k][i] * y[k]
        Xty[i] = s

    # Solve via Gaussian elimination
    # Augment XtX with Xty
    aug = [row[:] + [Xty[i]] for i, row in enumerate(XtX)]

    for col in range(m):
        # Pivot
        max_row = col
        for row in range(col + 1, m):
            if abs(aug[row][col]) > abs(aug[max_row][col]):
                max_row = row
        aug[col], aug[max_row] = aug[max_row], aug[col]

        if abs(aug[col][col]) < 1e-12:
            continue

        # Eliminate below
        for row in range(col + 1, m):
            factor = aug[row][col] / aug[col][col]
            for j in range(col, m + 1):
                aug[row][j] -= factor * aug[col][j]

    # Back substitution
    weights = [0.0] * m
    for i in range(m - 1, -1, -1):
        if abs(aug[i][i]) < 1e-12:
            weights[i] = 0.0
            continue
        s = aug[i][m]
        for j in range(i + 1, m):
            s -= aug[i][j] * weights[j]
        weights[i] = s / aug[i][i]

    return weights


# ============================================================================
# FEATURE EXTRACTION
# ============================================================================

def extract_features(query, category, restaurant, expected_cuisines):
    """Extract 22 features from a (query, restaurant) pair."""
    query_lower = query.lower()
    query_words = [w for w in query_lower.split() if len(w) > 1]

    restaurant_cuisine = (restaurant.get("cuisine_type") or "").lower()
    restaurant_neighborhood = (restaurant.get("neighborhood") or "").lower()
    restaurant_price = restaurant.get("price_level", "$$")
    price_level_num = restaurant_price.count("$") if "$" in str(restaurant_price) else 2

    has_dish = 1.0 if any(kw in query_lower for kw in DISH_KEYWORDS) else 0.0
    has_cuisine = 1.0 if any(kw in query_lower for kw in CUISINE_KEYWORDS) else 0.0
    has_vibe = 1.0 if any(kw in query_lower for kw in VIBE_KEYWORDS) else 0.0
    has_neighborhood = 1.0 if any(kw in query_lower for kw in NEIGHBORHOOD_KEYWORDS) else 0.0

    rel_type = CATEGORY_TO_RELEVANCE.get(category, "open_ended")
    if has_dish:
        rel_type = "dish"
    elif has_cuisine and rel_type not in ("dish",):
        rel_type = "cuisine"
    elif has_vibe and rel_type not in ("dish", "cuisine"):
        rel_type = "vibe"

    # Cuisine match
    cuisine_match_exact = 0.0
    if expected_cuisines:
        for ec in expected_cuisines:
            if ec.lower() in restaurant_cuisine:
                cuisine_match_exact = 1.0
                break
    elif has_cuisine:
        cuisine_match_exact = 1.0 if any(
            kw in query_lower and kw in restaurant_cuisine
            for kw in CUISINE_KEYWORDS
        ) else 0.0

    # Neighborhood match
    neighborhood_match = 0.0
    if has_neighborhood:
        neighborhood_match = 1.0 if any(
            kw in query_lower and kw in restaurant_neighborhood
            for kw in NEIGHBORHOOD_KEYWORDS
        ) else 0.0

    # Price match
    price_match = 1.0
    if "cheap" in query_lower or "budget" in query_lower:
        price_match = 1.0 if price_level_num <= 1 else 0.0
    elif "upscale" in query_lower or "fine dining" in query_lower or "luxury" in query_lower:
        price_match = 1.0 if price_level_num >= 3 else 0.0

    # Relevance proxy
    relevance_proxy = 0.5
    if cuisine_match_exact:
        relevance_proxy += 0.3
    if neighborhood_match:
        relevance_proxy += 0.1
    if price_match:
        relevance_proxy += 0.05
    reasoning = (restaurant.get("reasoning") or "").lower()
    if has_dish:
        if any(kw in reasoning for kw in DISH_KEYWORDS if kw in query_lower):
            relevance_proxy += 0.2
    relevance_proxy = min(relevance_proxy, 1.0)

    # Quality factor proxies
    teacher_score = restaurant.get("score", 75.0)

    food_proxy = max(0, min(10, 5.0 + (teacher_score - 75) * 0.05 +
                            (1.0 if rel_type in ("dish", "cuisine") else 0) +
                            (0.5 if cuisine_match_exact else 0)))
    vibe_proxy = max(0, min(10, 5.0 + (teacher_score - 75) * 0.04 +
                            (1.5 if rel_type == "vibe" else 0)))
    service_proxy = max(0, min(10, 6.0 + (teacher_score - 75) * 0.03))
    reputation_proxy = max(0, min(10, 6.0 + (teacher_score - 75) * 0.04 +
                                  (1.0 if rel_type == "reputation" else 0)))
    convenience_proxy = max(0, min(10, 6.5 + (teacher_score - 75) * 0.02 +
                                   (0.5 if neighborhood_match else 0) +
                                   (0.3 if price_match else 0)))

    return [
        relevance_proxy,
        1.0 if rel_type == "dish" else 0.0,
        1.0 if rel_type == "cuisine" else 0.0,
        1.0 if rel_type == "vibe" else 0.0,
        1.0 if rel_type == "reputation" else 0.0,
        1.0 if rel_type == "open_ended" else 0.0,
        food_proxy,
        vibe_proxy,
        service_proxy,
        reputation_proxy,
        convenience_proxy,
        0.85,  # data_completeness
        cuisine_match_exact,
        neighborhood_match,
        price_match,
        0.0,  # trending_score
        0.0,  # google_rating_bayesian
        float(len(query_words)),
        has_cuisine,
        has_dish,
        has_vibe,
        has_neighborhood,
    ]


# ============================================================================
# DATA LOADING
# ============================================================================

def load_training_data(input_path):
    """Load training data from JSON."""
    if not os.path.exists(input_path):
        fallback = os.path.join(os.path.dirname(input_path), "training-data.json")
        if os.path.exists(fallback) and fallback != input_path:
            print(f"[INFO] {input_path} not found, falling back to {fallback}")
            input_path = fallback
        else:
            print(f"[ERROR] Training data not found: {input_path}")
            sys.exit(1)

    with open(input_path, "r") as f:
        data = json.load(f)

    if not isinstance(data, list) or len(data) == 0:
        print("[ERROR] Training data is empty.")
        sys.exit(1)

    return data


def prepare_examples(data):
    """Convert raw training data into feature lists and labels."""
    X_rows = []
    y_labels = []
    query_ids = []
    names = []

    for entry in data:
        query_id = entry["query_id"]
        query = entry["query"]
        category = entry.get("category", "Discovery")
        expected_cuisines = entry.get("expected_cuisines", [])

        rankings = entry.get("ideal_ranking", entry.get("candidates", []))
        if not rankings:
            continue

        for restaurant in rankings:
            score = restaurant.get("score", restaurant.get("donde_match", 75.0))
            features = extract_features(query, category, restaurant, expected_cuisines)
            X_rows.append(features)
            y_labels.append(float(score))
            query_ids.append(query_id)
            names.append(f"{query} -> {restaurant.get('restaurant_name', '?')}")

    return X_rows, y_labels, query_ids, names


# ============================================================================
# TRAINING
# ============================================================================

def train_linear(X_rows, y_labels):
    """Train linear regression using numpy (preferred) or pure Python."""
    n = len(X_rows)
    m = len(X_rows[0])

    if HAS_NUMPY:
        X = np.array(X_rows, dtype=np.float64)
        y = np.array(y_labels, dtype=np.float64)

        # Add bias column
        X_bias = np.column_stack([X, np.ones(n)])

        # Solve
        weights, residuals, rank, sv = np.linalg.lstsq(X_bias, y, rcond=None)

        feature_weights = weights[:-1].tolist()
        bias = float(weights[-1])

        # Predictions
        y_pred = X_bias @ weights
        residuals_arr = y - y_pred
        rmse = float(np.sqrt(np.mean(residuals_arr ** 2)))
        mae = float(np.mean(np.abs(residuals_arr)))
    else:
        print("[INFO] numpy not available, using pure Python solver")
        # Add bias column
        X_bias = [row + [1.0] for row in X_rows]

        weights = py_lstsq(X_bias, y_labels)

        feature_weights = weights[:-1]
        bias = weights[-1]

        # Predictions
        y_pred = [py_dot(row, weights) for row in X_bias]
        residuals_list = [y_labels[i] - y_pred[i] for i in range(n)]
        rmse = math.sqrt(sum(r ** 2 for r in residuals_list) / n)
        mae = sum(abs(r) for r in residuals_list) / n

    return feature_weights, bias, rmse, mae, y_pred


def evaluate_by_group(y_labels, y_pred, query_ids):
    """Evaluate ranking quality per query group."""
    groups = {}
    for i, qid in enumerate(query_ids):
        if qid not in groups:
            groups[qid] = []
        groups[qid].append((y_labels[i], y_pred[i]))

    correct_order = 0
    total_pairs = 0

    for qid, pairs in groups.items():
        # Count concordant pairs (predicted order matches actual order)
        for i in range(len(pairs)):
            for j in range(i + 1, len(pairs)):
                true_i, pred_i = pairs[i]
                true_j, pred_j = pairs[j]
                if true_i == true_j:
                    continue
                total_pairs += 1
                # Concordant if both true and pred agree on order
                if (true_i > true_j and pred_i > pred_j) or \
                   (true_i < true_j and pred_i < pred_j):
                    correct_order += 1

    concordance = correct_order / total_pairs if total_pairs > 0 else 0
    return concordance


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="DondeAI Simple Linear Model Training (numpy only)"
    )
    parser.add_argument(
        "--input",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "merged-training-data.json"),
        help="Path to training data JSON",
    )
    parser.add_argument(
        "--output",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "model-linear.json"),
        help="Path for exported model JSON",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("DondeAI Simple Linear Model Training")
    print("=" * 60)
    print(f"Backend: {'numpy' if HAS_NUMPY else 'pure Python'}")

    # Load data
    data = load_training_data(args.input)
    print(f"Loaded {len(data)} query entries")

    # Prepare features
    X_rows, y_labels, query_ids, names = prepare_examples(data)
    print(f"Extracted {len(y_labels)} training examples")

    if len(y_labels) == 0:
        print("[ERROR] No training examples extracted.")
        sys.exit(1)

    y_min = min(y_labels)
    y_max = max(y_labels)
    y_mean = sum(y_labels) / len(y_labels)
    print(f"Score range: [{y_min:.1f}, {y_max:.1f}], mean: {y_mean:.1f}")

    # Train
    print("\nTraining linear regression...")
    feature_weights, bias, rmse, mae, y_pred = train_linear(X_rows, y_labels)

    print(f"\n  RMSE: {rmse:.2f}")
    print(f"  MAE:  {mae:.2f}")
    print(f"  Bias: {bias:.2f}")

    # Ranking evaluation
    concordance = evaluate_by_group(y_labels, y_pred, query_ids)
    print(f"  Pairwise concordance: {concordance:.4f}")

    # Feature weights
    print("\n  Feature weights (top 10 by magnitude):")
    weight_pairs = list(zip(FEATURE_NAMES, feature_weights))
    weight_pairs.sort(key=lambda x: abs(x[1]), reverse=True)
    for name, w in weight_pairs[:10]:
        print(f"    {name}: {w:.4f}")

    # Sample predictions
    print("\n  Sample predictions (first 5):")
    for i in range(min(5, len(y_labels))):
        print(f"    {names[i]}: actual={y_labels[i]:.0f}, predicted={y_pred[i]:.1f}")

    # Export
    model = {
        "model_type": "linear_adjustment",
        "version": "1.0",
        "created": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "n_features": len(FEATURE_NAMES),
        "feature_names": FEATURE_NAMES,
        "weights": {name: round(float(w), 6) for name, w in zip(FEATURE_NAMES, feature_weights)},
        "bias": round(float(bias), 4),
        "training_metrics": {
            "rmse": round(rmse, 2),
            "mae": round(mae, 2),
            "pairwise_concordance": round(concordance, 4),
            "n_examples": len(y_labels),
            "n_queries": len(set(query_ids)),
            "score_range": [round(y_min, 1), round(y_max, 1)],
        },
    }

    with open(args.output, "w") as f:
        json.dump(model, f, indent=2)

    file_size = os.path.getsize(args.output)
    print(f"\nModel exported to {args.output} ({file_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
