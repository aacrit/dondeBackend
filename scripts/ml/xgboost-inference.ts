/**
 * DondeAI Knowledge Distillation — XGBoost Inference Engine
 *
 * Pure TypeScript implementation of XGBoost decision tree traversal.
 * No external dependencies — loads a model JSON file and performs
 * prediction using only arithmetic operations.
 *
 * This module is designed to be embedded in the Supabase Edge Function
 * for sub-millisecond scoring, replacing the full V11 pipeline when
 * a trained model is available.
 *
 * Usage:
 *   import { XGBoostModel } from "./xgboost-inference.js";
 *
 *   const model = XGBoostModel.load("./model.json");
 *   const score = model.predict(features);
 *
 * Or for Deno (Edge Function):
 *   import { XGBoostModel } from "./xgboost-inference.ts";
 */

// ============================================================================
// TYPES
// ============================================================================

/** A single node in a decision tree */
interface TreeNode {
  /** Feature index to split on (undefined for leaf nodes) */
  split_feature?: number;
  /** Threshold value for the split (undefined for leaf nodes) */
  split_threshold?: number;
  /** Left child node (feature < threshold) */
  left?: TreeNode;
  /** Right child node (feature >= threshold) */
  right?: TreeNode;
  /** Leaf value (only defined for leaf nodes) */
  leaf_value?: number;
  /** Whether this is a leaf node */
  is_leaf: boolean;
}

/** Serialized tree format (from XGBoost JSON export) */
interface SerializedNode {
  split?: number;        // feature index
  threshold?: number;    // split threshold
  yes?: number;          // left child index
  no?: number;           // right child index
  leaf?: number;         // leaf value
  children?: SerializedNode[];
}

/** Model metadata from model.json */
interface ModelConfig {
  version: string;
  created: string;
  feature_names: string[];
  feature_count: number;
  train_examples: number;
  validation_examples: number;
  trees: SerializedNode[];
  /** Learning rate (default: 0.1) */
  learning_rate?: number;
  /** Base score (default: 0.5 for regression) */
  base_score?: number;
  note?: string;
}

/** Features extracted per (query, restaurant) pair — must match distill-train.ts */
export interface TrainingFeatures {
  relevance_score: number;
  relevance_type_dish: number;
  relevance_type_cuisine: number;
  relevance_type_vibe: number;
  relevance_type_reputation: number;
  relevance_type_open_ended: number;
  food_score: number;
  vibe_score: number;
  service_score: number;
  reputation_score: number;
  convenience_score: number;
  data_completeness: number;
  cuisine_match_exact: number;
  neighborhood_match: number;
  price_match: number;
  trending_score: number;
  google_rating_bayesian: number;
  query_word_count: number;
  query_has_cuisine: number;
  query_has_dish: number;
  query_has_vibe: number;
  query_has_neighborhood: number;
}

// ============================================================================
// TREE TRAVERSAL
// ============================================================================

/**
 * Build an in-memory tree from the serialized JSON format.
 *
 * XGBoost exports trees in a nested JSON structure where each node
 * has either children (internal node) or a leaf value (leaf node).
 */
function deserializeTree(node: SerializedNode): TreeNode {
  // Leaf node: has a "leaf" value and no children
  if (node.leaf !== undefined && node.children === undefined) {
    return {
      is_leaf: true,
      leaf_value: node.leaf,
    };
  }

  // Internal node: has split info and children
  if (node.children && node.children.length === 2) {
    return {
      is_leaf: false,
      split_feature: node.split,
      split_threshold: node.threshold,
      left: deserializeTree(node.children[0]),
      right: deserializeTree(node.children[1]),
    };
  }

  // Fallback: treat as leaf with value 0
  return {
    is_leaf: true,
    leaf_value: 0,
  };
}

/**
 * Traverse a single decision tree to get a prediction.
 *
 * Starting from the root, at each internal node:
 * - If feature[split_feature] < split_threshold, go left
 * - Otherwise, go right
 * - When reaching a leaf, return the leaf_value
 *
 * Time complexity: O(depth) per tree, typically O(6) for max_depth=6.
 */
function traverseTree(node: TreeNode, features: number[]): number {
  // Leaf node: return the value
  if (node.is_leaf) {
    return node.leaf_value ?? 0;
  }

  // Internal node: compare feature against threshold
  const featureIdx = node.split_feature ?? 0;
  const threshold = node.split_threshold ?? 0;
  const featureValue = features[featureIdx] ?? 0;

  if (featureValue < threshold) {
    return traverseTree(node.left!, features);
  } else {
    return traverseTree(node.right!, features);
  }
}

// ============================================================================
// MODEL CLASS
// ============================================================================

/**
 * XGBoost model for fast inference.
 *
 * Loads a model JSON file exported from the training pipeline and provides
 * O(n_trees * depth) prediction — typically <0.1ms for 200 trees * depth 6.
 *
 * For comparison, the full V11 scoring pipeline takes ~50-200ms per restaurant.
 * This model can score all 2,720 restaurants in <100ms total.
 */
export class XGBoostModel {
  private trees: TreeNode[];
  private baseScore: number;
  private learningRate: number;
  private featureNames: string[];

  constructor(config: ModelConfig) {
    this.trees = config.trees.map(deserializeTree);
    this.baseScore = config.base_score ?? 50; // DondeMatch midpoint
    this.learningRate = config.learning_rate ?? 0.1;
    this.featureNames = config.feature_names;
  }

  /**
   * Load model from a JSON file path.
   *
   * Works in both Node.js (readFileSync) and can be adapted for Deno (Deno.readTextFileSync).
   */
  static load(path: string): XGBoostModel {
    // Node.js path
    const fs = require("fs");
    const raw = fs.readFileSync(path, "utf-8");
    const config: ModelConfig = JSON.parse(raw);
    return new XGBoostModel(config);
  }

  /**
   * Load model from a JSON string (for Edge Function / Deno).
   */
  static fromJSON(json: string): XGBoostModel {
    const config: ModelConfig = JSON.parse(json);
    return new XGBoostModel(config);
  }

  /**
   * Predict a DondeMatch score for a (query, restaurant) feature vector.
   *
   * The prediction is: base_score + learning_rate * sum(tree_predictions)
   * Clamped to [0, 99] to match the DondeMatch range.
   *
   * @param features - TrainingFeatures object or flat number array
   * @returns Predicted DondeMatch score (0-99)
   */
  predict(features: TrainingFeatures | number[]): number {
    const featureArray = Array.isArray(features)
      ? features
      : this.featuresToArray(features);

    if (this.trees.length === 0) {
      // No trees loaded — return the base score (placeholder model)
      return this.baseScore;
    }

    // Sum predictions from all trees
    let prediction = this.baseScore;
    for (const tree of this.trees) {
      prediction += this.learningRate * traverseTree(tree, featureArray);
    }

    // Clamp to DondeMatch range
    return Math.max(0, Math.min(99, Math.round(prediction)));
  }

  /**
   * Predict scores for multiple feature vectors (batch prediction).
   *
   * @param featuresBatch - Array of feature objects or flat arrays
   * @returns Array of predicted DondeMatch scores
   */
  predictBatch(featuresBatch: (TrainingFeatures | number[])[]): number[] {
    return featuresBatch.map((f) => this.predict(f));
  }

  /**
   * Rank restaurants by predicted score for a given query.
   *
   * @param candidates - Array of {id, features} pairs
   * @returns Sorted array with predicted scores, highest first
   */
  rank(
    candidates: Array<{ id: string; features: TrainingFeatures | number[] }>
  ): Array<{ id: string; predictedScore: number; rank: number }> {
    const scored = candidates.map((c) => ({
      id: c.id,
      predictedScore: this.predict(c.features),
      rank: 0,
    }));

    // Sort descending by predicted score
    scored.sort((a, b) => b.predictedScore - a.predictedScore);

    // Assign ranks
    scored.forEach((item, idx) => {
      item.rank = idx + 1;
    });

    return scored;
  }

  /**
   * Get the number of trees in the model.
   */
  get treeCount(): number {
    return this.trees.length;
  }

  /**
   * Get feature names.
   */
  get features(): string[] {
    return [...this.featureNames];
  }

  /**
   * Convert TrainingFeatures object to flat array.
   * Order must match FEATURE_NAMES in distill-train.ts.
   */
  private featuresToArray(f: TrainingFeatures): number[] {
    return [
      f.relevance_score,
      f.relevance_type_dish,
      f.relevance_type_cuisine,
      f.relevance_type_vibe,
      f.relevance_type_reputation,
      f.relevance_type_open_ended,
      f.food_score,
      f.vibe_score,
      f.service_score,
      f.reputation_score,
      f.convenience_score,
      f.data_completeness,
      f.cuisine_match_exact,
      f.neighborhood_match,
      f.price_match,
      f.trending_score,
      f.google_rating_bayesian,
      f.query_word_count,
      f.query_has_cuisine,
      f.query_has_dish,
      f.query_has_vibe,
      f.query_has_neighborhood,
    ];
  }
}

// ============================================================================
// STANDALONE USAGE
// ============================================================================

/**
 * When run directly, load a model and run a sample prediction.
 *
 *   cd scripts && npx tsx ml/xgboost-inference.ts ml/model.json
 */
if (typeof require !== "undefined" && require.main === module) {
  const modelPath = process.argv[2] || "./model.json";
  console.log(`Loading model from ${modelPath}...`);

  try {
    const model = XGBoostModel.load(modelPath);
    console.log(`Model loaded: ${model.treeCount} trees, ${model.features.length} features`);

    // Sample prediction with dummy features
    const sampleFeatures: TrainingFeatures = {
      relevance_score: 0.85,
      relevance_type_dish: 0,
      relevance_type_cuisine: 1,
      relevance_type_vibe: 0,
      relevance_type_reputation: 0,
      relevance_type_open_ended: 0,
      food_score: 8.0,
      vibe_score: 7.0,
      service_score: 7.5,
      reputation_score: 7.8,
      convenience_score: 7.2,
      data_completeness: 0.90,
      cuisine_match_exact: 1,
      neighborhood_match: 0,
      price_match: 1,
      trending_score: 0,
      google_rating_bayesian: 0,
      query_word_count: 3,
      query_has_cuisine: 1,
      query_has_dish: 0,
      query_has_vibe: 0,
      query_has_neighborhood: 0,
    };

    const score = model.predict(sampleFeatures);
    console.log(`\nSample prediction: DondeMatch = ${score}`);
    console.log("(With placeholder model, returns base_score = 50)");
  } catch (err) {
    console.error("Failed to load model:", err);
    process.exit(1);
  }
}
