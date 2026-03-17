/**
 * Intent Classification Types (Version Alpha)
 *
 * Type definitions for intent classification used across the scoring engine.
 * Active classifier implementation is in intent-classifier-v5.ts.
 */

export interface IntentClassification {
  target_cuisines: string[];
  target_tags: string[];
  target_features: string[];
  cuisine_importance: "high" | "medium" | "low";
}

/** V4: Per-signal confidence levels for weight modulation */
export interface IntentConfidence {
  cuisine: "high" | "medium" | "low";
  vibe: "high" | "medium" | "low";
  occasion: "high" | "medium" | "low";
  constraints: "high" | "medium" | "low";
  overall: "high" | "medium" | "low";
}

/** V2 extended intent with nuanced signals for multi-dimensional ranking */
export interface IntentClassificationV2 extends IntentClassification {
  flavor_preferences: string[];
  vibe_keywords: string[];
  practical_constraints: string[];
  emotional_intent: string;
  date_type: string | null;
  group_size_hint: string | null;
  spontaneity: "planned" | "spontaneous" | "unknown";
  /** V4: Per-signal confidence levels */
  confidence?: IntentConfidence;
  /** V6: Specific dish query detected (e.g., "tandoori chicken", "pad thai").
   *  Set when a cuisine keyword match is a food item (not cuisine name) — indicates
   *  the user wants a specific dish, not just a cuisine category. */
  dish_level_intent?: string | null;
  /** V11: Freeform semantic descriptors — concepts that don't map to fixed dictionaries.
   *  Examples: "celebrity hangout", "pre-game dinner", "grandmother's cooking",
   *  "underground food scene", "Instagram-worthy". Matched against restaurant
   *  semantic_descriptors, best_for_scenarios, wow_factors, crowd_profile. */
  semantic_tags?: string[];
  /** V11: Reference restaurant or experience — "like Alinea but casual",
   *  "reminds me of Tokyo". Used for comparable_restaurants matching. */
  similar_to?: string | null;
  /** V11: Emotional mood — "adventurous", "nostalgic", "celebratory", "indulgent".
   *  More nuanced than emotional_intent, captures the feeling the user wants. */
  mood?: string | null;
  /** V11: Cuisines implied but not explicitly named — "dumplings" implies
   *  Chinese, Japanese, Nepalese. Used to broaden candidate pool. */
  implicit_cuisines?: string[];
}
