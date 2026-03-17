#!/usr/bin/env python3
"""
DondeAI Knowledge Distillation - XGBoost Model Training
Trains a LambdaMART ranking model from teacher-labeled data.
Exports model as JSON for TypeScript Edge Function inference.

Usage:
  pip install -r requirements.txt
  python train-model.py [--input merged-training-data.json] [--output model.json]

The training data format is an array of query objects, each with:
  - query_id, query, category, occasion, expected_cuisines
  - ideal_ranking: [{rank, restaurant_id, restaurant_name, cuisine_type,
                     neighborhood, price_level, score, reasoning}]

The model learns to predict the teacher's ideal score (0-99) from 22 features
extracted per (query, restaurant) pair.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import numpy as np
except ImportError:
    print("[ERROR] numpy is required. Install with: pip install numpy>=1.24.0")
    print("For a zero-dependency alternative, use train-simple.py instead.")
    sys.exit(1)

try:
    import xgboost as xgb
    HAS_XGBOOST = True
except ImportError:
    HAS_XGBOOST = False

try:
    from sklearn.model_selection import GroupKFold
    from sklearn.metrics import mean_squared_error, mean_absolute_error
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

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

# Category to relevance type heuristic mapping
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
# FEATURE EXTRACTION
# ============================================================================

def extract_features(query: str, category: str, restaurant: dict,
                     expected_cuisines: list) -> np.ndarray:
    """
    Extract 22 features from a (query, restaurant) pair.

    Since the training data comes from teacher labels (not the rule engine),
    we don't have engine-computed scores like relevance_score or quality factors.
    Instead, we derive proxy features from the available restaurant metadata
    and query characteristics.
    """
    query_lower = query.lower()
    query_words = [w for w in query_lower.split() if len(w) > 1]

    restaurant_cuisine = (restaurant.get("cuisine_type") or "").lower()
    restaurant_neighborhood = (restaurant.get("neighborhood") or "").lower()
    restaurant_price = restaurant.get("price_level", "$$")
    price_level_num = len(restaurant_price.replace(" ", "").replace("$", "")) if "$" in str(restaurant_price) else 2

    # --- Relevance type one-hot (derived from category + query keywords) ---
    has_dish = 1 if any(kw in query_lower for kw in DISH_KEYWORDS) else 0
    has_cuisine = 1 if any(kw in query_lower for kw in CUISINE_KEYWORDS) else 0
    has_vibe = 1 if any(kw in query_lower for kw in VIBE_KEYWORDS) else 0
    has_neighborhood = 1 if any(kw in query_lower for kw in NEIGHBORHOOD_KEYWORDS) else 0

    # Determine primary relevance type
    rel_type = CATEGORY_TO_RELEVANCE.get(category, "open_ended")
    if has_dish:
        rel_type = "dish"
    elif has_cuisine and rel_type not in ("dish",):
        rel_type = "cuisine"
    elif has_vibe and rel_type not in ("dish", "cuisine"):
        rel_type = "vibe"

    # --- Cuisine match ---
    cuisine_match_exact = 0
    if expected_cuisines:
        for ec in expected_cuisines:
            if ec.lower() in restaurant_cuisine:
                cuisine_match_exact = 1
                break
    elif has_cuisine:
        cuisine_match_exact = 1 if any(
            kw in query_lower and kw in restaurant_cuisine
            for kw in CUISINE_KEYWORDS
        ) else 0

    # --- Neighborhood match ---
    neighborhood_match = 0
    if has_neighborhood:
        neighborhood_match = 1 if any(
            kw in query_lower and kw in restaurant_neighborhood
            for kw in NEIGHBORHOOD_KEYWORDS
        ) else 0

    # --- Price match ---
    price_match = 1  # default neutral
    if "cheap" in query_lower or "budget" in query_lower:
        price_match = 1 if price_level_num <= 1 else 0
    elif "upscale" in query_lower or "fine dining" in query_lower or "luxury" in query_lower:
        price_match = 1 if price_level_num >= 3 else 0

    # --- Relevance score proxy ---
    # Since we don't have the rule engine's relevance, compute a proxy
    # based on keyword matching between query and restaurant
    relevance_proxy = 0.5  # base
    if cuisine_match_exact:
        relevance_proxy += 0.3
    if neighborhood_match:
        relevance_proxy += 0.1
    if price_match:
        relevance_proxy += 0.05
    # Check reasoning field for dish mentions
    reasoning = (restaurant.get("reasoning") or "").lower()
    if has_dish:
        dish_in_reasoning = any(kw in reasoning for kw in DISH_KEYWORDS if kw in query_lower)
        if dish_in_reasoning:
            relevance_proxy += 0.2
    relevance_proxy = min(relevance_proxy, 1.0)

    # --- Quality factor proxies ---
    # Without engine scores, derive from the teacher's ideal score
    # The teacher score encodes quality implicitly via ranking position
    teacher_score = restaurant.get("score", 75.0)
    rank = restaurant.get("rank", 3)

    # Food score: higher for dish/cuisine categories + high teacher score
    food_proxy = 5.0 + (teacher_score - 75) * 0.05
    if rel_type in ("dish", "cuisine"):
        food_proxy += 1.0
    if cuisine_match_exact:
        food_proxy += 0.5
    food_proxy = np.clip(food_proxy, 0, 10)

    # Vibe score: higher for vibe category
    vibe_proxy = 5.0 + (teacher_score - 75) * 0.04
    if rel_type == "vibe":
        vibe_proxy += 1.5
    vibe_proxy = np.clip(vibe_proxy, 0, 10)

    # Service score
    service_proxy = 6.0 + (teacher_score - 75) * 0.03
    service_proxy = np.clip(service_proxy, 0, 10)

    # Reputation score: higher for reputation category
    reputation_proxy = 6.0 + (teacher_score - 75) * 0.04
    if rel_type == "reputation":
        reputation_proxy += 1.0
    reputation_proxy = np.clip(reputation_proxy, 0, 10)

    # Convenience score
    convenience_proxy = 6.5 + (teacher_score - 75) * 0.02
    if neighborhood_match:
        convenience_proxy += 0.5
    if price_match:
        convenience_proxy += 0.3
    convenience_proxy = np.clip(convenience_proxy, 0, 10)

    # Data completeness proxy (assume high since teacher selected these)
    data_completeness = 0.85

    return np.array([
        relevance_proxy,                                          # relevance_score
        1.0 if rel_type == "dish" else 0.0,                       # relevance_type_dish
        1.0 if rel_type == "cuisine" else 0.0,                    # relevance_type_cuisine
        1.0 if rel_type == "vibe" else 0.0,                       # relevance_type_vibe
        1.0 if rel_type == "reputation" else 0.0,                 # relevance_type_reputation
        1.0 if rel_type == "open_ended" else 0.0,                 # relevance_type_open_ended
        food_proxy,                                                # food_score
        vibe_proxy,                                                # vibe_score
        service_proxy,                                             # service_score
        reputation_proxy,                                          # reputation_score
        convenience_proxy,                                         # convenience_score
        data_completeness,                                         # data_completeness
        float(cuisine_match_exact),                                # cuisine_match_exact
        float(neighborhood_match),                                 # neighborhood_match
        float(price_match),                                        # price_match
        0.0,                                                       # trending_score (placeholder)
        0.0,                                                       # google_rating_bayesian (not available)
        float(len(query_words)),                                   # query_word_count
        float(has_cuisine),                                        # query_has_cuisine
        float(has_dish),                                           # query_has_dish
        float(has_vibe),                                           # query_has_vibe
        float(has_neighborhood),                                   # query_has_neighborhood
    ], dtype=np.float32)


# ============================================================================
# DATA LOADING
# ============================================================================

def load_training_data(input_path: str) -> list:
    """Load training data from JSON, trying merged file first then original."""
    if not os.path.exists(input_path):
        # Try fallback to training-data.json in same directory
        fallback = os.path.join(os.path.dirname(input_path), "training-data.json")
        if os.path.exists(fallback) and fallback != input_path:
            print(f"[INFO] {input_path} not found, falling back to {fallback}")
            input_path = fallback
        else:
            print(f"[ERROR] Training data not found: {input_path}")
            print("Run the teacher labeling pipeline first.")
            sys.exit(1)

    with open(input_path, "r") as f:
        data = json.load(f)

    if not isinstance(data, list) or len(data) == 0:
        print("[ERROR] Training data is empty.")
        sys.exit(1)

    return data


def prepare_examples(data: list):
    """
    Convert raw training data into feature matrix X, label vector y,
    and group array for ranking.

    Handles two formats:
      1. ideal_ranking: [{rank, restaurant_id, ..., score, reasoning}]
         (teacher-labeled data from training-data.json)
      2. candidates: [{rank, restaurant_id, ..., donde_match, relevance_score, ...}]
         (engine-scored data from candidates-batch.json)
    """
    X_rows = []
    y_labels = []
    groups = []  # query_id for each example
    metadata = []  # for reporting

    for entry in data:
        query_id = entry["query_id"]
        query = entry["query"]
        category = entry.get("category", "Discovery")
        expected_cuisines = entry.get("expected_cuisines", [])

        # Determine which format we have
        rankings = entry.get("ideal_ranking", entry.get("candidates", []))
        if not rankings:
            continue

        for restaurant in rankings:
            # Extract the teacher score (ideal_ranking) or engine score (candidates)
            score = restaurant.get("score", restaurant.get("donde_match", 75.0))

            features = extract_features(query, category, restaurant, expected_cuisines)
            X_rows.append(features)
            y_labels.append(float(score))
            groups.append(query_id)
            metadata.append({
                "query_id": query_id,
                "query": query,
                "restaurant_name": restaurant.get("restaurant_name", "Unknown"),
                "restaurant_id": restaurant.get("restaurant_id", ""),
                "score": score,
                "rank": restaurant.get("rank", 0),
            })

    X = np.array(X_rows, dtype=np.float32)
    y = np.array(y_labels, dtype=np.float32)
    groups_arr = np.array(groups, dtype=np.int32)

    return X, y, groups_arr, metadata


# ============================================================================
# XGBOOST TRAINING
# ============================================================================

def compute_group_sizes(groups: np.ndarray) -> np.ndarray:
    """
    Convert per-example group IDs into XGBoost-style group sizes.
    E.g., [1,1,1,2,2,3,3,3,3] -> [3,2,4]
    Groups must be contiguous (sorted by group_id).
    """
    sizes = []
    current_group = groups[0]
    count = 0
    for g in groups:
        if g == current_group:
            count += 1
        else:
            sizes.append(count)
            current_group = g
            count = 1
    sizes.append(count)
    return np.array(sizes, dtype=np.int32)


def ndcg_at_k(y_true: np.ndarray, y_pred: np.ndarray,
              groups: np.ndarray, k: int = 5) -> float:
    """Compute NDCG@k averaged over query groups."""
    unique_groups = np.unique(groups)
    ndcg_scores = []

    for gid in unique_groups:
        mask = groups == gid
        true_scores = y_true[mask]
        pred_scores = y_pred[mask]

        if len(true_scores) <= 1:
            ndcg_scores.append(1.0)
            continue

        # Sort by predicted score descending
        pred_order = np.argsort(-pred_scores)[:k]
        ideal_order = np.argsort(-true_scores)[:k]

        # DCG
        dcg = 0.0
        for i, idx in enumerate(pred_order):
            dcg += (2 ** true_scores[idx] - 1) / np.log2(i + 2)

        # IDCG
        idcg = 0.0
        for i, idx in enumerate(ideal_order):
            idcg += (2 ** true_scores[idx] - 1) / np.log2(i + 2)

        if idcg > 0:
            ndcg_scores.append(dcg / idcg)
        else:
            ndcg_scores.append(1.0)

    return float(np.mean(ndcg_scores))


def normalize_scores_for_ranking(y: np.ndarray) -> np.ndarray:
    """
    Normalize teacher scores to 0-1 range for ranking objective.
    Ranking objectives work better with normalized relevance labels.
    """
    y_min, y_max = y.min(), y.max()
    if y_max == y_min:
        return np.zeros_like(y)
    return (y - y_min) / (y_max - y_min)


def train_xgboost(X: np.ndarray, y: np.ndarray, groups: np.ndarray,
                   metadata: list, n_folds: int = 5) -> tuple:
    """
    Train XGBoost LambdaMART ranker with GroupKFold cross-validation.

    Returns (model, training_metrics).
    """
    if not HAS_XGBOOST:
        print("[ERROR] xgboost not installed. Run: pip install xgboost>=2.0.0")
        sys.exit(1)
    if not HAS_SKLEARN:
        print("[ERROR] scikit-learn not installed. Run: pip install scikit-learn>=1.3.0")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("XGBoost LambdaMART Training")
    print("=" * 60)
    print(f"Total examples:  {len(y)}")
    print(f"Unique queries:  {len(np.unique(groups))}")
    print(f"Features:        {X.shape[1]}")
    print(f"Score range:     [{y.min():.1f}, {y.max():.1f}]")
    print(f"Score mean:      {y.mean():.1f}")
    print(f"Cross-val folds: {n_folds}")

    # Normalize labels for ranking
    y_norm = normalize_scores_for_ranking(y)

    # GroupKFold cross-validation
    gkf = GroupKFold(n_splits=min(n_folds, len(np.unique(groups))))

    fold_metrics = []
    all_val_preds = np.zeros(len(y))
    all_val_mask = np.zeros(len(y), dtype=bool)

    params = {
        "objective": "rank:pairwise",
        "learning_rate": 0.1,
        "max_depth": 4,
        "min_child_weight": 5,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "eval_metric": "ndcg@5",
        "tree_method": "hist",
        "verbosity": 0,
        "seed": 42,
    }

    for fold_idx, (train_idx, val_idx) in enumerate(gkf.split(X, y_norm, groups)):
        X_train, X_val = X[train_idx], X[val_idx]
        y_train, y_val = y_norm[train_idx], y_norm[val_idx]
        y_raw_val = y[val_idx]
        groups_train = groups[train_idx]
        groups_val = groups[val_idx]

        # Compute group sizes (required for ranking)
        # Sort by group to ensure contiguous groups
        train_sort = np.argsort(groups_train)
        X_train = X_train[train_sort]
        y_train = y_train[train_sort]
        groups_train = groups_train[train_sort]
        train_group_sizes = compute_group_sizes(groups_train)

        val_sort = np.argsort(groups_val)
        X_val = X_val[val_sort]
        y_val = y_val[val_sort]
        y_raw_val = y_raw_val[val_sort]
        groups_val_sorted = groups_val[val_sort]
        val_group_sizes = compute_group_sizes(groups_val_sorted)

        dtrain = xgb.DMatrix(X_train, label=y_train, feature_names=FEATURE_NAMES)
        dtrain.set_group(train_group_sizes)

        dval = xgb.DMatrix(X_val, label=y_val, feature_names=FEATURE_NAMES)
        dval.set_group(val_group_sizes)

        model = xgb.train(
            params,
            dtrain,
            num_boost_round=100,
            evals=[(dtrain, "train"), (dval, "eval")],
            early_stopping_rounds=20,
            verbose_eval=False,
        )

        val_preds = model.predict(dval)

        # NDCG@5 on raw scores (not normalized)
        ndcg5 = ndcg_at_k(y_raw_val, val_preds, groups_val_sorted, k=5)

        # Score-space metrics (map predictions back to raw scale)
        pred_scores = val_preds * (y.max() - y.min()) + y.min()
        rmse = np.sqrt(mean_squared_error(y_raw_val, pred_scores))
        mae = mean_absolute_error(y_raw_val, pred_scores)

        fold_metrics.append({
            "fold": fold_idx + 1,
            "ndcg_at_5": ndcg5,
            "rmse": rmse,
            "mae": mae,
            "n_train": len(y_train),
            "n_val": len(y_val),
            "best_iteration": model.best_iteration if hasattr(model, "best_iteration") else 100,
        })

        # Store predictions for global metrics
        original_val_idx = val_idx[val_sort]
        all_val_preds[original_val_idx] = pred_scores
        all_val_mask[original_val_idx] = True

        print(f"  Fold {fold_idx + 1}: NDCG@5={ndcg5:.4f}, RMSE={rmse:.2f}, "
              f"MAE={mae:.2f}, trees={fold_metrics[-1]['best_iteration']}")

    # Print fold summary
    avg_ndcg = np.mean([m["ndcg_at_5"] for m in fold_metrics])
    avg_rmse = np.mean([m["rmse"] for m in fold_metrics])
    avg_mae = np.mean([m["mae"] for m in fold_metrics])
    print(f"\n  Average: NDCG@5={avg_ndcg:.4f}, RMSE={avg_rmse:.2f}, MAE={avg_mae:.2f}")

    # Train final model on all data
    print("\nTraining final model on all data...")
    sort_all = np.argsort(groups)
    X_sorted = X[sort_all]
    y_norm_sorted = y_norm[sort_all]
    groups_sorted = groups[sort_all]
    all_group_sizes = compute_group_sizes(groups_sorted)

    dall = xgb.DMatrix(X_sorted, label=y_norm_sorted, feature_names=FEATURE_NAMES)
    dall.set_group(all_group_sizes)

    final_model = xgb.train(
        params,
        dall,
        num_boost_round=100,
        evals=[(dall, "train")],
        verbose_eval=False,
    )

    # Feature importance
    importance = final_model.get_score(importance_type="gain")
    print("\nFeature Importance (gain):")
    sorted_imp = sorted(importance.items(), key=lambda x: x[1], reverse=True)
    for name, score in sorted_imp[:10]:
        print(f"  {name}: {score:.2f}")

    # Compute adjustment statistics
    final_preds = final_model.predict(dall)
    pred_scores_all = final_preds * (y.max() - y.min()) + y.min()
    adjustments = pred_scores_all - y[sort_all]
    mean_adj = np.mean(np.abs(adjustments))

    # Split info for reporting
    n_val = sum(m["n_val"] for m in fold_metrics) // n_folds

    training_metrics = {
        "ndcg_at_5": round(float(avg_ndcg), 4),
        "rmse": round(float(avg_rmse), 2),
        "mae": round(float(avg_mae), 2),
        "mean_adjustment": round(float(mean_adj), 2),
        "n_training_pairs": len(y),
        "n_validation_pairs": n_val,
        "n_queries": len(np.unique(groups)),
        "n_folds": n_folds,
        "fold_details": fold_metrics,
        "feature_importance": {k: round(v, 2) for k, v in sorted_imp},
    }

    return final_model, training_metrics


# ============================================================================
# MODEL EXPORT (JSON for TypeScript inference)
# ============================================================================

def tree_to_json(tree_dump: str) -> dict:
    """
    Parse XGBoost text dump of a single tree into our JSON node format.

    XGBoost dump format (per line):
      "0:[f5<0.5] yes=1,no=2,missing=1"
      "1:leaf=0.234567"

    Our format:
      {"split": 5, "threshold": 0.5, "children": [{...}, {...}]}
      {"leaf": 0.234567}
    """
    lines = tree_dump.strip().split("\n")
    nodes = {}

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Parse node ID
        colon_idx = line.index(":")
        node_id = int(line[:colon_idx].strip())

        rest = line[colon_idx + 1:]

        if rest.startswith("leaf="):
            leaf_val = float(rest.split("=")[1])
            nodes[node_id] = {"leaf": leaf_val}
        else:
            # Internal node: [f<feature><threshold>] yes=<left>,no=<right>
            bracket_end = rest.index("]")
            condition = rest[1:bracket_end]

            # Parse feature and threshold
            lt_idx = condition.index("<")
            feature_name = condition[:lt_idx]
            threshold = float(condition[lt_idx + 1:])

            # Extract feature index from name like "f5"
            feature_idx = int(feature_name[1:]) if feature_name.startswith("f") else int(feature_name)

            # Parse yes/no
            meta = rest[bracket_end + 1:].strip()
            parts = {}
            for part in meta.split(","):
                if "=" in part:
                    k, v = part.strip().split("=")
                    parts[k] = int(v)

            nodes[node_id] = {
                "split": feature_idx,
                "threshold": threshold,
                "yes": parts.get("yes", -1),
                "no": parts.get("no", -1),
            }

    def build_tree(node_id: int) -> dict:
        node = nodes[node_id]
        if "leaf" in node:
            return {"leaf": node["leaf"]}
        return {
            "split": node["split"],
            "threshold": node["threshold"],
            "children": [
                build_tree(node["yes"]),
                build_tree(node["no"]),
            ],
        }

    if 0 not in nodes:
        return {"leaf": 0.0}

    return build_tree(0)


def export_model_json(model, training_metrics: dict, output_path: str,
                      y_min: float, y_max: float):
    """
    Export XGBoost model as JSON compatible with xgboost-inference.ts.

    The TypeScript inference engine expects:
      - trees: array of serialized tree objects
      - feature_names: ordered list of feature names
      - learning_rate: float
      - base_score: float (DondeMatch midpoint)
    """
    # Dump trees as text and convert to our JSON format
    tree_dumps = model.get_dump()
    trees_json = []

    for dump in tree_dumps:
        tree = tree_to_json(dump)
        trees_json.append(tree)

    model_output = {
        "model_type": "xgboost_ranker",
        "version": "1.0",
        "created": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "n_trees": len(trees_json),
        "n_features": len(FEATURE_NAMES),
        "feature_names": FEATURE_NAMES,
        "learning_rate": 0.1,
        "base_score": float((y_min + y_max) / 2),
        "score_range": {"min": float(y_min), "max": float(y_max)},
        "trees": trees_json,
        "training_metrics": training_metrics,
    }

    with open(output_path, "w") as f:
        json.dump(model_output, f, indent=2)

    file_size = os.path.getsize(output_path)
    print(f"\nModel exported to {output_path}")
    print(f"  Trees: {len(trees_json)}")
    print(f"  File size: {file_size / 1024:.1f} KB")

    return model_output


def export_linear_fallback(X: np.ndarray, y: np.ndarray, output_path: str):
    """
    Train and export a simple linear regression as fallback.
    Uses numpy least-squares, no sklearn needed.
    """
    print("\n" + "=" * 60)
    print("Linear Fallback Model")
    print("=" * 60)

    # Add bias column
    X_bias = np.column_stack([X, np.ones(len(X))])

    # Least squares: (X^T X)^-1 X^T y
    try:
        weights, residuals, rank, sv = np.linalg.lstsq(X_bias, y, rcond=None)
    except np.linalg.LinAlgError:
        print("[WARN] Least squares failed, using pseudoinverse")
        weights = np.linalg.pinv(X_bias) @ y

    feature_weights = weights[:-1]
    bias = weights[-1]

    # Evaluate
    y_pred = X_bias @ weights
    rmse = np.sqrt(np.mean((y - y_pred) ** 2))
    mae = np.mean(np.abs(y - y_pred))

    print(f"  RMSE: {rmse:.2f}")
    print(f"  MAE:  {mae:.2f}")
    print(f"  Bias: {bias:.2f}")

    # Top features by absolute weight
    print("\n  Feature weights (top 10 by magnitude):")
    weight_pairs = list(zip(FEATURE_NAMES, feature_weights))
    weight_pairs.sort(key=lambda x: abs(x[1]), reverse=True)
    for name, w in weight_pairs[:10]:
        print(f"    {name}: {w:.4f}")

    linear_model = {
        "model_type": "linear_adjustment",
        "version": "1.0",
        "created": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "n_features": len(FEATURE_NAMES),
        "feature_names": FEATURE_NAMES,
        "weights": {name: round(float(w), 6) for name, w in zip(FEATURE_NAMES, feature_weights)},
        "bias": round(float(bias), 4),
        "training_metrics": {
            "rmse": round(float(rmse), 2),
            "mae": round(float(mae), 2),
            "n_examples": len(y),
        },
    }

    with open(output_path, "w") as f:
        json.dump(linear_model, f, indent=2)

    print(f"\n  Linear model exported to {output_path}")
    return linear_model


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="DondeAI XGBoost Model Training"
    )
    parser.add_argument(
        "--input",
        default=os.path.join(os.path.dirname(__file__), "merged-training-data.json"),
        help="Path to training data JSON (default: merged-training-data.json, falls back to training-data.json)",
    )
    parser.add_argument(
        "--output",
        default=os.path.join(os.path.dirname(__file__), "model.json"),
        help="Path for exported model JSON (default: model.json)",
    )
    parser.add_argument(
        "--folds",
        type=int,
        default=5,
        help="Number of cross-validation folds (default: 5)",
    )
    parser.add_argument(
        "--linear-only",
        action="store_true",
        help="Train only the linear fallback (no xgboost dependency)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("DondeAI Knowledge Distillation - XGBoost Training")
    print("=" * 60)

    # Load data
    data = load_training_data(args.input)
    print(f"Loaded {len(data)} query entries from {args.input}")

    # Prepare features
    X, y, groups, metadata = prepare_examples(data)
    print(f"Extracted {len(y)} training examples across {len(np.unique(groups))} queries")
    print(f"Score range: [{y.min():.1f}, {y.max():.1f}], mean: {y.mean():.1f}")

    if len(y) == 0:
        print("[ERROR] No training examples extracted. Check your training data format.")
        sys.exit(1)

    # Always train linear fallback
    linear_output = args.output.replace(".json", "-linear.json")
    export_linear_fallback(X, y, linear_output)

    # Train XGBoost if available and not --linear-only
    if args.linear_only:
        print("\n[INFO] --linear-only mode, skipping XGBoost training.")
        return

    if not HAS_XGBOOST:
        print("\n[WARN] xgboost not installed. Only linear model was trained.")
        print("Install with: pip install xgboost>=2.0.0")
        print("Then rerun without --linear-only for full XGBoost training.")
        return

    if not HAS_SKLEARN:
        print("\n[WARN] scikit-learn not installed. Only linear model was trained.")
        print("Install with: pip install scikit-learn>=1.3.0")
        return

    # Minimum data requirements
    n_unique_groups = len(np.unique(groups))
    if n_unique_groups < args.folds:
        print(f"\n[WARN] Only {n_unique_groups} query groups, reducing folds to {n_unique_groups}")
        args.folds = max(2, n_unique_groups)

    model, metrics = train_xgboost(X, y, groups, metadata, n_folds=args.folds)

    # Export XGBoost model
    export_model_json(model, metrics, args.output, y.min(), y.max())

    # Summary
    print("\n" + "=" * 60)
    print("Training Complete")
    print("=" * 60)
    print(f"  XGBoost model: {args.output}")
    print(f"  Linear model:  {linear_output}")
    print(f"  NDCG@5:        {metrics['ndcg_at_5']:.4f}")
    print(f"  RMSE:          {metrics['rmse']:.2f}")
    print(f"  MAE:           {metrics['mae']:.2f}")
    print(f"  Training pairs:{metrics['n_training_pairs']}")


if __name__ == "__main__":
    main()
