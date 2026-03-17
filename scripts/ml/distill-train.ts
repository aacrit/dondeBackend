/**
 * DondeAI Knowledge Distillation — XGBoost Training Pipeline
 *
 * Reads training-data.json (query-restaurant pairs with teacher labels),
 * extracts features, and trains an XGBoost model for fast inference.
 *
 * The "teacher" is the DondeAI scoring engine (V11/V18) run via CLI at $0 cost.
 * The "student" is a lightweight XGBoost model that learns to reproduce the
 * teacher's rankings from extracted features.
 *
 * Usage:
 *   cd scripts && npx tsx ml/distill-train.ts
 *   cd scripts && npx tsx ml/distill-train.ts --output ml/model.json
 *   cd scripts && npx tsx ml/distill-train.ts --validate
 *
 * Prerequisites:
 *   npm install xgboost  (when ready to train — not needed for feature extraction)
 *
 * Pipeline:
 *   1. distill-prepare.sh  → candidates-batch.json  (API candidate data)
 *   2. CLI agent ranking    → training-data.json     (teacher labels)
 *   3. distill-train.ts     → model.json             (trained XGBoost model)
 *   4. xgboost-inference.ts → predict()              (fast scoring)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// TYPES
// ============================================================================

/** Features extracted per (query, restaurant) pair for XGBoost training */
export interface TrainingFeatures {
  // --- From rule engine scoring ---
  /** Relevance score 0-1 (the GATE in DondeScore formula) */
  relevance_score: number;
  /** One-hot encoding of relevance type */
  relevance_type_dish: number;
  relevance_type_cuisine: number;
  relevance_type_vibe: number;
  relevance_type_reputation: number;
  relevance_type_open_ended: number;
  /** Individual quality factor scores (0-10 each) */
  food_score: number;
  vibe_score: number;
  service_score: number;
  reputation_score: number;
  convenience_score: number;
  /** Data completeness 0-1 */
  data_completeness: number;

  // --- From restaurant profile ---
  /** Binary: does restaurant cuisine_type exactly match query target? */
  cuisine_match_exact: number;
  /** Binary: does restaurant neighborhood match query neighborhood? */
  neighborhood_match: number;
  /** Binary: does restaurant price_level match query price? */
  price_match: number;
  /** Trending score (placeholder — 0 until trending pipeline exists) */
  trending_score: number;
  /** Google rating with Bayesian shrinkage (C=30, m=4.15) */
  google_rating_bayesian: number;

  // --- From query characteristics ---
  /** Word count of the query string */
  query_word_count: number;
  /** Binary: does query contain a cuisine keyword? */
  query_has_cuisine: number;
  /** Binary: does query contain a specific dish name? */
  query_has_dish: number;
  /** Binary: does query contain a vibe/ambiance keyword? */
  query_has_vibe: number;
  /** Binary: does query contain a neighborhood reference? */
  query_has_neighborhood: number;
}

/** A single training example: features + teacher label */
interface TrainingExample {
  query_id: number;
  query: string;
  restaurant_id: string;
  restaurant_name: string;
  features: TrainingFeatures;
  /** Teacher label: the DondeMatch score (0-99) from the rule engine */
  label: number;
  /** Rank position assigned by the teacher (1 = best) */
  rank: number;
}

/** Raw training data entry from training-data.json */
interface TrainingDataEntry {
  query_id: number;
  query: string;
  category: string;
  candidates: Array<{
    rank: number;
    restaurant_id: string;
    restaurant_name: string;
    cuisine_type: string;
    neighborhood: string;
    price_level: string;
    donde_match: number;
    relevance_score: number;
    relevance_type: string;
    food_score: number;
    vibe_score: number;
    service_score: number;
    reputation_score: number;
    convenience_score: number;
    data_completeness: number;
    match_headline: string;
    best_for_oneliner: string;
  }>;
  /** Optional: teacher-assigned labels (added by CLI agent ranking step) */
  teacher_labels?: Record<string, number>;
}

// ============================================================================
// KEYWORD LISTS (for query feature extraction)
// ============================================================================

/** Common cuisine keywords to detect in queries */
const CUISINE_KEYWORDS = [
  "italian", "mexican", "chinese", "japanese", "thai", "indian", "korean",
  "vietnamese", "french", "greek", "mediterranean", "ethiopian", "cuban",
  "peruvian", "colombian", "brazilian", "turkish", "lebanese", "moroccan",
  "polish", "german", "irish", "soul food", "southern", "cajun", "bbq",
  "seafood", "steakhouse", "sushi", "ramen", "pho", "taiwanese", "szechuan",
  "eritrean", "somali", "nigerian", "senegalese", "jamaican", "caribbean",
  "hawaiian", "filipino", "malaysian", "pakistani", "nepalese", "tibetan",
  "georgian", "persian", "palestinian", "yemeni", "puerto rican", "salvadoran",
  "argentinian", "venezuelan", "ecuadorian", "ukrainian", "bosnian", "serbian",
];

/** Common dish keywords to detect in queries */
const DISH_KEYWORDS = [
  "pizza", "burger", "tacos", "sushi", "ramen", "pho", "pasta", "steak",
  "wings", "dumplings", "soup dumplings", "dim sum", "pad thai", "bibimbap",
  "shawarma", "falafel", "kebab", "gyoza", "omakase", "ceviche", "pupusa",
  "empanada", "pierogi", "momo", "fondue", "hot dog", "deep dish", "lobster",
  "oysters", "fried chicken", "smash burger", "hand rolls", "grain bowl",
  "acai bowl", "charcuterie", "brunch", "noodles", "curry", "sandwich",
  "calzone", "wagyu", "oxtail", "pozole", "birria", "al pastor",
  "hot chicken", "jerk chicken", "truffle pasta", "lobster bisque",
];

/** Vibe/ambiance keywords to detect in queries */
const VIBE_KEYWORDS = [
  "cozy", "romantic", "lively", "quiet", "intimate", "upscale", "casual",
  "trendy", "hip", "divey", "dive bar", "speakeasy", "rooftop", "outdoor",
  "patio", "garden", "waterfront", "sports bar", "jazz", "live music",
  "karaoke", "tiki", "lounge", "cocktail", "wine bar", "pub", "brewery",
  "date night", "power lunch", "family friendly", "kid friendly",
  "bottomless brunch", "happy hour", "late night",
];

/** Neighborhood keywords to detect in queries */
const NEIGHBORHOOD_KEYWORDS = [
  "loop", "west loop", "river north", "lincoln park", "wicker park",
  "logan square", "bucktown", "pilsen", "chinatown", "hyde park",
  "lakeview", "andersonville", "uptown", "edgewater", "rogers park",
  "bridgeport", "south loop", "gold coast", "old town", "ukrainian village",
  "avondale", "humboldt park", "irving park", "north center", "streeterville",
  "fulton market", "wrigley", "wrigleyville", "downtown", "magnificent mile",
  "little italy", "boystown",
];

// ============================================================================
// FEATURE EXTRACTION
// ============================================================================

/**
 * Extract features from a (query, candidate) pair.
 *
 * This is the core feature engineering function. It converts raw API response
 * data into a fixed-size numeric feature vector suitable for XGBoost.
 */
function extractFeatures(
  query: string,
  category: string,
  candidate: TrainingDataEntry["candidates"][0]
): TrainingFeatures {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 1);

  // One-hot encode relevance type
  const relType = candidate.relevance_type || "open_ended";

  // Detect query characteristics
  const hasCuisine = CUISINE_KEYWORDS.some((kw) => queryLower.includes(kw)) ? 1 : 0;
  const hasDish = DISH_KEYWORDS.some((kw) => queryLower.includes(kw)) ? 1 : 0;
  const hasVibe = VIBE_KEYWORDS.some((kw) => queryLower.includes(kw)) ? 1 : 0;
  const hasNeighborhood = NEIGHBORHOOD_KEYWORDS.some((kw) => queryLower.includes(kw)) ? 1 : 0;

  // Cuisine match: check if restaurant cuisine contains any query cuisine keyword
  const restaurantCuisine = (candidate.cuisine_type || "").toLowerCase();
  const cuisineMatch = CUISINE_KEYWORDS.some(
    (kw) => queryLower.includes(kw) && restaurantCuisine.includes(kw)
  ) ? 1 : 0;

  // Neighborhood match: check if restaurant neighborhood appears in query
  const restaurantNeighborhood = (candidate.neighborhood || "").toLowerCase();
  const neighborhoodMatch = NEIGHBORHOOD_KEYWORDS.some(
    (kw) => queryLower.includes(kw) && restaurantNeighborhood.includes(kw)
  ) ? 1 : 0;

  // Price match: simple heuristic — "cheap" -> $, "upscale"/"fine dining" -> $$$$
  const priceLevel = (candidate.price_level || "$$").replace(/[^$]/g, "").length;
  let priceMatch = 0;
  if (queryLower.includes("cheap") || queryLower.includes("budget")) {
    priceMatch = priceLevel <= 1 ? 1 : 0;
  } else if (queryLower.includes("upscale") || queryLower.includes("fine dining") || queryLower.includes("luxury")) {
    priceMatch = priceLevel >= 3 ? 1 : 0;
  } else {
    // No price signal in query — neutral match
    priceMatch = 1;
  }

  return {
    relevance_score: candidate.relevance_score || 0,
    relevance_type_dish: relType === "dish" ? 1 : 0,
    relevance_type_cuisine: relType === "cuisine" ? 1 : 0,
    relevance_type_vibe: relType === "vibe" ? 1 : 0,
    relevance_type_reputation: relType === "reputation" ? 1 : 0,
    relevance_type_open_ended: relType === "open_ended" ? 1 : 0,
    food_score: candidate.food_score || 0,
    vibe_score: candidate.vibe_score || 0,
    service_score: candidate.service_score || 0,
    reputation_score: candidate.reputation_score || 0,
    convenience_score: candidate.convenience_score || 0,
    data_completeness: candidate.data_completeness || 0,
    cuisine_match_exact: cuisineMatch,
    neighborhood_match: neighborhoodMatch,
    price_match: priceMatch,
    trending_score: 0, // Placeholder — no trending pipeline yet
    google_rating_bayesian: 0, // Not available in skip_google mode
    query_word_count: queryWords.length,
    query_has_cuisine: hasCuisine,
    query_has_dish: hasDish,
    query_has_vibe: hasVibe,
    query_has_neighborhood: hasNeighborhood,
  };
}

/**
 * Convert a TrainingFeatures object to a flat array for XGBoost.
 * The order must match the feature names array.
 */
export function featuresToArray(f: TrainingFeatures): number[] {
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

/** Feature names in the same order as featuresToArray */
export const FEATURE_NAMES = [
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
];

// ============================================================================
// TRAINING PIPELINE
// ============================================================================

/**
 * Load and validate training data from JSON file.
 */
function loadTrainingData(path: string): TrainingDataEntry[] {
  if (!existsSync(path)) {
    console.error(`Training data not found: ${path}`);
    console.error("Run distill-prepare.sh first to generate candidates-batch.json");
    console.error("Then run CLI agent ranking to create training-data.json");
    process.exit(1);
  }

  const raw = readFileSync(path, "utf-8");
  const data: TrainingDataEntry[] = JSON.parse(raw);

  if (!Array.isArray(data) || data.length === 0) {
    console.error("Training data is empty. Run the distillation pipeline first.");
    process.exit(1);
  }

  return data;
}

/**
 * Convert raw training data into feature vectors + labels.
 *
 * If teacher_labels exist (from CLI agent ranking), use those as labels.
 * Otherwise, fall back to the rule engine's donde_match as the label.
 */
function prepareTrainingExamples(data: TrainingDataEntry[]): TrainingExample[] {
  const examples: TrainingExample[] = [];

  for (const entry of data) {
    for (const candidate of entry.candidates) {
      const features = extractFeatures(entry.query, entry.category, candidate);

      // Use teacher label if available, otherwise use rule engine score
      const label = entry.teacher_labels?.[candidate.restaurant_id]
        ?? candidate.donde_match
        ?? 0;

      examples.push({
        query_id: entry.query_id,
        query: entry.query,
        restaurant_id: candidate.restaurant_id,
        restaurant_name: candidate.restaurant_name,
        features,
        label,
        rank: candidate.rank,
      });
    }
  }

  return examples;
}

/**
 * Split examples into train/validation sets (80/20 by query_id).
 */
function splitTrainValidation(
  examples: TrainingExample[],
  validationRatio = 0.2
): { train: TrainingExample[]; validation: TrainingExample[] } {
  const queryIds = [...new Set(examples.map((e) => e.query_id))];
  const shuffled = queryIds.sort(() => Math.random() - 0.5);
  const splitIdx = Math.floor(shuffled.length * (1 - validationRatio));
  const trainIds = new Set(shuffled.slice(0, splitIdx));

  return {
    train: examples.filter((e) => trainIds.has(e.query_id)),
    validation: examples.filter((e) => !trainIds.has(e.query_id)),
  };
}

/**
 * Train XGBoost model.
 *
 * PLACEHOLDER: This function outlines the XGBoost training process.
 * To actually train, install the xgboost npm package:
 *
 *   npm install xgboost
 *
 * XGBoost configuration for ranking:
 * - objective: "reg:squarederror" (regress on DondeMatch score 0-99)
 *   OR "rank:pairwise" (learn relative ordering within query groups)
 * - max_depth: 6 (moderate tree depth for 22 features)
 * - eta: 0.1 (learning rate)
 * - n_estimators: 200 (number of boosting rounds)
 * - subsample: 0.8 (row sampling to prevent overfitting)
 * - colsample_bytree: 0.8 (feature sampling)
 * - min_child_weight: 3 (prevent overfitting on sparse queries)
 * - eval_metric: "ndcg@5" for ranking, "rmse" for regression
 *
 * The model learns a function: f(features) -> predicted_score
 * where features are the 22-dimensional TrainingFeatures vector
 * and predicted_score approximates the teacher's DondeMatch.
 */
async function trainModel(
  train: TrainingExample[],
  validation: TrainingExample[],
  outputPath: string
): Promise<void> {
  console.log("\n=== XGBoost Training ===");
  console.log(`Train examples:      ${train.length}`);
  console.log(`Validation examples: ${validation.length}`);
  console.log(`Features:            ${FEATURE_NAMES.length}`);
  console.log(`Output:              ${outputPath}`);

  // Convert to feature arrays
  const X_train = train.map((e) => featuresToArray(e.features));
  const y_train = train.map((e) => e.label);
  const X_val = validation.map((e) => featuresToArray(e.features));
  const y_val = validation.map((e) => e.label);

  // ---- XGBoost training (uncomment when xgboost is installed) ----
  //
  // import XGBoost from "xgboost";
  //
  // const model = new XGBoost({
  //   booster: "gbtree",
  //   objective: "reg:squarederror",
  //   max_depth: 6,
  //   eta: 0.1,
  //   subsample: 0.8,
  //   colsample_bytree: 0.8,
  //   min_child_weight: 3,
  //   n_estimators: 200,
  //   eval_metric: "rmse",
  // });
  //
  // await model.fit(X_train, y_train, {
  //   eval_set: [[X_val, y_val]],
  //   early_stopping_rounds: 20,
  //   verbose: true,
  // });
  //
  // // Export model as JSON (for xgboost-inference.ts)
  // const modelJson = model.toJSON();
  // writeFileSync(outputPath, JSON.stringify(modelJson, null, 2));
  //
  // // Feature importance
  // const importance = model.getFeatureImportance();
  // console.log("\nFeature Importance (top 10):");
  // Object.entries(importance)
  //   .sort(([, a], [, b]) => b - a)
  //   .slice(0, 10)
  //   .forEach(([name, score]) => console.log(`  ${name}: ${score.toFixed(4)}`));

  // ---- Placeholder output ----
  console.log("\n[PLACEHOLDER] XGBoost training not yet connected.");
  console.log("To train for real:");
  console.log("  1. npm install xgboost");
  console.log("  2. Uncomment the XGBoost section in distill-train.ts");
  console.log("  3. Run: cd scripts && npx tsx ml/distill-train.ts");

  // Write a placeholder model for testing the inference pipeline
  const placeholderModel = {
    version: "0.0.1",
    created: new Date().toISOString(),
    feature_names: FEATURE_NAMES,
    feature_count: FEATURE_NAMES.length,
    train_examples: train.length,
    validation_examples: validation.length,
    trees: [],
    note: "Placeholder model — replace with real XGBoost output after training",
  };

  writeFileSync(outputPath, JSON.stringify(placeholderModel, null, 2));
  console.log(`\nPlaceholder model written to ${outputPath}`);
}

/**
 * Validate model on held-out data.
 */
function validateModel(validation: TrainingExample[]): void {
  console.log("\n=== Validation Report ===");
  console.log(`Validation examples: ${validation.length}`);

  if (validation.length === 0) {
    console.log("No validation data available.");
    return;
  }

  // Basic stats on the label distribution
  const labels = validation.map((e) => e.label);
  const mean = labels.reduce((a, b) => a + b, 0) / labels.length;
  const min = Math.min(...labels);
  const max = Math.max(...labels);

  console.log(`Label distribution: min=${min}, max=${max}, mean=${mean.toFixed(1)}`);

  // Category breakdown
  const categories = new Map<string, number[]>();
  for (const entry of validation) {
    const cat = entry.query.toLowerCase();
    // Group by relevance type
    const relType = entry.features.relevance_type_dish ? "dish"
      : entry.features.relevance_type_cuisine ? "cuisine"
      : entry.features.relevance_type_vibe ? "vibe"
      : entry.features.relevance_type_reputation ? "reputation"
      : "open_ended";
    if (!categories.has(relType)) categories.set(relType, []);
    categories.get(relType)!.push(entry.label);
  }

  console.log("\nBy relevance type:");
  for (const [type, scores] of categories) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    console.log(`  ${type}: n=${scores.length}, avg_label=${avg.toFixed(1)}`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const doValidate = args.includes("--validate");
  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : join(__dirname, "model.json");
  const trainingPath = join(__dirname, "training-data.json");

  console.log("=== DondeAI Knowledge Distillation — Training Pipeline ===");
  console.log(`Training data: ${trainingPath}`);

  // Load data
  const data = loadTrainingData(trainingPath);
  console.log(`Loaded ${data.length} query entries`);

  // Extract features
  const examples = prepareTrainingExamples(data);
  console.log(`Extracted ${examples.length} training examples`);

  if (examples.length === 0) {
    console.error("No training examples could be extracted. Check your training data.");
    process.exit(1);
  }

  // Split train/validation
  const { train, validation } = splitTrainValidation(examples);

  // Train
  await trainModel(train, validation, outputPath);

  // Validate
  if (doValidate) {
    validateModel(validation);
  }

  // Summary
  console.log("\n=== Feature Vector Sample ===");
  const sample = examples[0];
  console.log(`Query: "${sample.query}"`);
  console.log(`Restaurant: ${sample.restaurant_name}`);
  console.log(`Label (DondeMatch): ${sample.label}`);
  console.log("Features:");
  FEATURE_NAMES.forEach((name, i) => {
    console.log(`  ${name}: ${featuresToArray(sample.features)[i]}`);
  });
}

main().catch((err) => {
  console.error("Training pipeline failed:", err);
  process.exit(1);
});
