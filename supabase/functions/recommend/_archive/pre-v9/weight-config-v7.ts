/**
 * V7 Weight Configuration — 5-Layer Adaptive Dynamic Weight System
 *
 * Key improvements over V5:
 * - Layer 2.5: Intent Amplification — when cuisine_importance=high AND dish_level_intent,
 *   further boost food weight to prevent non-food factors from drowning explicit food requests.
 * - Layer 5: Stacking Cap Enforcement — per-category delta caps prevent unexpected stacking
 *   when multiple rules from the same category fire simultaneously.
 * - Rebalanced base weights: Food 0.22, Vibe 0.20, Service 0.18, Reputation 0.22, Convenience 0.18
 *   (more balanced baseline that doesn't pre-favor food or reputation as heavily as V5).
 * - New combined-signal rules (e.g., date night + specific cuisine boosts both vibe AND food).
 * - Stronger convenience boost for "open now" / "near me" queries.
 *
 * Architecture:
 * Layer 1: Base weights
 * Layer 2: 34 context-driven shift rules (occasion, cuisine, emotion, constraint, context, combined)
 * Layer 2.5: Intent amplification (cuisine_importance=high AND dish_level_intent → food +0.08)
 * Layer 3: Data-quality adaptation (upweight high-confidence, downweight low-confidence)
 * Layer 4: Candidate pool adaptation (slim pickings vs abundance)
 * Layer 5: Stacking cap enforcement (per-category delta caps)
 *
 * All layers applied sequentially. Clamped [0.05, 0.50], normalized to sum 1.0.
 */

import type { IntentClassificationV2 } from "./intent-classifier.ts";

// ==========================================
// V7 INLINE TYPES
// ==========================================

export interface V7Weights {
  food: number;
  vibe: number;
  service: number;
  reputation: number;
  convenience: number;
}

export interface V7FactorConfidence {
  food: string; // "high" | "medium" | "low"
  vibe: string;
  service: string;
  reputation: string;
  convenience: string;
}

export interface V7WeightShiftCondition {
  occasion?: string[];
  cuisineImportance?: "high" | "medium" | "low";
  emotionalIntent?: string;
  priceSensitive?: boolean;
  spontaneous?: boolean;
  planned?: boolean;
  dateType?: string;
  groupSizeHint?: string;
  timeOfDay?: string;
  vibeKeywords?: string[];
  targetTags?: string[];
  targetCuisineIsBar?: boolean;
  dishLevelIntent?: boolean;
}

export interface V7WeightShiftRule {
  condition: V7WeightShiftCondition;
  deltas: Partial<V7Weights>;
  label?: string;
  /** V7: Rule category for stacking cap enforcement */
  category: string;
}

// ==========================================
// WEIGHT CLAMPING BOUNDS
// ==========================================

const WEIGHT_MIN = 0.05;
const WEIGHT_MAX = 0.50;

/**
 * V7 Stacking Caps: Maximum total delta per factor from any single rule category.
 * Prevents unexpected amplification when multiple rules in the same category fire.
 */
const CATEGORY_STACKING_CAP = 0.15;

// ==========================================
// LAYER 1: BASE WEIGHTS
// ==========================================

// V7.2: Match V5 base weights to prevent score regression.
// V7.0 used 0.22/0.20/0.18/0.22/0.18 but the lower food+reputation
// weights reduced DondeMatch for food/reputation queries.
export const V7_BASE_WEIGHTS: V7Weights = {
  food: 0.25,
  vibe: 0.18,
  service: 0.17,
  reputation: 0.25,
  convenience: 0.15,
};

// ==========================================
// LAYER 2: WEIGHT SHIFT RULES (34 rules)
// ==========================================

export const V7_WEIGHT_SHIFT_RULES: V7WeightShiftRule[] = [
  // --- Category A: Occasion shifts (8 rules) ---
  {
    condition: { occasion: ["Date Night", "Special Occasion"] },
    deltas: { vibe: +0.08, service: +0.04, convenience: -0.08, reputation: -0.04 },
    label: "Date/special: vibe + service up, convenience down",
    category: "occasion",
  },
  {
    condition: { occasion: ["Business Lunch"] },
    deltas: { service: +0.08, vibe: +0.04, food: -0.04, convenience: -0.04, reputation: -0.04 },
    label: "Business: service + vibe up, food down",
    category: "occasion",
  },
  {
    condition: { occasion: ["Adventure"] },
    deltas: { reputation: +0.05, food: -0.03, service: -0.02 },
    label: "Adventure: reputation up (hidden gems)",
    category: "occasion",
  },
  {
    condition: { occasion: ["Family Dinner"] },
    deltas: { service: +0.05, convenience: +0.08, vibe: -0.08, reputation: -0.05 },
    label: "Family: convenience + service up, vibe down",
    category: "occasion",
  },
  {
    condition: { occasion: ["Solo Dining"] },
    deltas: { convenience: +0.08, food: +0.05, service: -0.08, vibe: -0.05 },
    label: "Solo: convenience + food up, service down",
    category: "occasion",
  },
  {
    condition: { occasion: ["Treat Myself"] },
    deltas: { food: +0.05, vibe: +0.05, convenience: -0.10 },
    label: "Treat myself: food + vibe up, convenience down",
    category: "occasion",
  },
  {
    condition: { occasion: ["Chill Hangout"] },
    deltas: { vibe: +0.08, convenience: +0.05, food: -0.08, reputation: -0.05 },
    label: "Chill: vibe + convenience up, food down",
    category: "occasion",
  },
  {
    condition: { occasion: ["Group Hangout"] },
    deltas: { service: +0.05, vibe: +0.05, food: -0.05, reputation: -0.05 },
    label: "Group: service + vibe up, food + reputation down",
    category: "occasion",
  },

  // --- Category B: Cuisine importance shifts (3 rules) ---
  {
    condition: { cuisineImportance: "high" },
    deltas: { food: +0.15, vibe: -0.05, service: -0.05, reputation: -0.05 },
    label: "High cuisine priority: food dominates",
    category: "cuisine",
  },
  {
    condition: { cuisineImportance: "medium" },
    deltas: { food: +0.05, vibe: -0.025, convenience: -0.025 },
    label: "Medium cuisine priority: food slightly up",
    category: "cuisine",
  },
  {
    condition: { cuisineImportance: "low" },
    deltas: { vibe: +0.05, service: +0.03, food: -0.08 },
    label: "Low cuisine priority: vibe + service up, food down",
    category: "cuisine",
  },

  // --- Category B2: Dish-level intent shift (1 rule) ---
  {
    condition: { dishLevelIntent: true },
    deltas: { food: +0.05, vibe: -0.03, convenience: -0.02 },
    label: "Dish-level query: food further elevated",
    category: "cuisine",
  },

  // --- Category C: Emotional intent shifts (6 rules) ---
  {
    condition: { emotionalIntent: "impress" },
    deltas: { reputation: +0.08, service: +0.04, convenience: -0.07, food: -0.05 },
    label: "Impress: reputation + service up",
    category: "emotion",
  },
  {
    condition: { emotionalIntent: "comfort" },
    deltas: { vibe: +0.08, food: +0.03, reputation: -0.06, service: -0.05 },
    label: "Comfort: vibe + food up",
    category: "emotion",
  },
  {
    condition: { emotionalIntent: "explore" },
    deltas: { reputation: +0.05, food: +0.03, vibe: -0.04, convenience: -0.04 },
    label: "Explore: reputation + food up (discovery)",
    category: "emotion",
  },
  {
    condition: { emotionalIntent: "celebrate" },
    deltas: { vibe: +0.07, service: +0.05, reputation: +0.03, food: -0.08, convenience: -0.07 },
    label: "Celebrate: vibe + service + reputation up",
    category: "emotion",
  },
  {
    condition: { emotionalIntent: "casual" },
    deltas: { convenience: +0.05, food: -0.03, service: -0.02 },
    label: "Casual: convenience up, low effort",
    category: "emotion",
  },
  {
    condition: { emotionalIntent: "indulge" },
    deltas: { food: +0.08, vibe: +0.04, convenience: -0.08, service: -0.04 },
    label: "Indulge: food + vibe up, convenience down",
    category: "emotion",
  },

  // --- Category D: Constraint shifts (3 rules) ---
  {
    condition: { priceSensitive: true },
    deltas: { convenience: +0.10, food: -0.05, vibe: -0.05 },
    label: "Price sensitive: convenience up",
    category: "constraint",
  },
  {
    condition: { spontaneous: true },
    deltas: { convenience: +0.12, service: -0.05, vibe: -0.07 },
    label: "Spontaneous: convenience up (walk-in, no wait)",
    category: "constraint",
  },
  {
    condition: { planned: true },
    deltas: { service: +0.05, vibe: +0.05, convenience: -0.10 },
    label: "Planned: service + vibe up, convenience down",
    category: "constraint",
  },

  // --- Category E: Context signals (6 rules) ---
  {
    condition: { dateType: "first_date" },
    deltas: { vibe: +0.10, reputation: +0.05, food: -0.07, convenience: -0.08 },
    label: "First date: vibe + reputation up (safe pick)",
    category: "context",
  },
  {
    condition: { dateType: "anniversary" },
    deltas: { vibe: +0.08, service: +0.05, reputation: +0.05, food: -0.08, convenience: -0.10 },
    label: "Anniversary: must be special",
    category: "context",
  },
  {
    condition: { groupSizeHint: "large_group" },
    deltas: { service: +0.08, convenience: +0.07, vibe: -0.05, food: -0.05, reputation: -0.05 },
    label: "Large group: logistics dominate",
    category: "context",
  },
  {
    condition: { groupSizeHint: "solo" },
    deltas: { food: +0.05, convenience: +0.05, service: -0.05, vibe: -0.05 },
    label: "Solo: food + convenience up",
    category: "context",
  },
  {
    condition: { timeOfDay: "late_night" },
    deltas: { convenience: +0.08, vibe: +0.05, service: -0.08, reputation: -0.05 },
    label: "Late night: open late matters most",
    category: "context",
  },
  {
    condition: { timeOfDay: "breakfast" },
    deltas: { food: +0.05, convenience: +0.05, vibe: -0.05, reputation: -0.05 },
    label: "Breakfast: quality + quick",
    category: "context",
  },

  // --- Category F: Vibe/bar keyword signals (3 rules) ---
  {
    condition: { vibeKeywords: ["rooftop", "outdoor", "terrace", "patio", "view", "al fresco"] },
    deltas: { vibe: +0.08, food: -0.04, convenience: -0.04 },
    label: "Outdoor/rooftop query: vibe weight elevated",
    category: "vibe_signal",
  },
  {
    condition: { targetCuisineIsBar: true },
    deltas: { vibe: +0.08, food: -0.05, convenience: -0.03 },
    label: "Cocktail/bar query: vibe co-elevated with food",
    category: "vibe_signal",
  },
  {
    condition: { targetTags: ["live music", "lively atmosphere", "late night"] },
    deltas: { vibe: +0.10, food: -0.05, reputation: -0.05 },
    label: "Bar/nightlife query: vibe dominates",
    category: "vibe_signal",
  },

  // --- Category G: V7 Combined signal rules (4 rules) ---
  // New in V7: When multiple signals combine, apply synergistic boosts
  // that neither signal alone would trigger.
  {
    condition: { occasion: ["Date Night", "Special Occasion"], cuisineImportance: "high" },
    deltas: { food: +0.06, vibe: +0.04, service: -0.05, convenience: -0.05 },
    label: "Date + specific cuisine: food AND vibe elevated",
    category: "combined",
  },
  {
    condition: { occasion: ["Date Night"], emotionalIntent: "impress" },
    deltas: { vibe: +0.06, reputation: +0.04, food: -0.04, convenience: -0.06 },
    label: "Impress on date: vibe + reputation amplified",
    category: "combined",
  },
  {
    condition: { spontaneous: true, timeOfDay: "late_night" },
    deltas: { convenience: +0.10, vibe: +0.03, food: -0.05, service: -0.04, reputation: -0.04 },
    label: "Spontaneous late night: convenience dominates",
    category: "combined",
  },
  {
    condition: { emotionalIntent: "explore", cuisineImportance: "high" },
    deltas: { food: +0.05, reputation: +0.03, vibe: -0.04, convenience: -0.04 },
    label: "Explore + specific cuisine: food discovery prioritized",
    category: "combined",
  },
];

// ==========================================
// LAYER 2: RULE MATCHING
// ==========================================

function matchesCondition(
  condition: V7WeightShiftCondition,
  occasion: string,
  intent: IntentClassificationV2 | null,
  clientTimeOfDay?: string | null,
): boolean {
  if (condition.occasion && !condition.occasion.includes(occasion)) return false;

  if (condition.cuisineImportance && intent?.cuisine_importance !== condition.cuisineImportance) return false;

  if (condition.emotionalIntent && intent?.emotional_intent !== condition.emotionalIntent) return false;

  if (condition.priceSensitive !== undefined) {
    const isPriceSensitive = intent?.practical_constraints?.some(
      c => /budget|cheap|affordable|value|price/i.test(c)
    ) ?? false;
    if (condition.priceSensitive !== isPriceSensitive) return false;
  }

  if (condition.spontaneous !== undefined) {
    const isSpontaneous = intent?.spontaneity === "spontaneous";
    if (condition.spontaneous !== isSpontaneous) return false;
  }

  if (condition.planned !== undefined) {
    const isPlanned = intent?.spontaneity === "planned";
    if (condition.planned !== isPlanned) return false;
  }

  if (condition.dateType && intent?.date_type !== condition.dateType) return false;

  if (condition.groupSizeHint && intent?.group_size_hint !== condition.groupSizeHint) return false;

  if (condition.timeOfDay) {
    const tod = clientTimeOfDay || null;
    if (tod !== condition.timeOfDay) return false;
  }

  if (condition.vibeKeywords) {
    const hasKeyword = condition.vibeKeywords.some(kw =>
      intent?.vibe_keywords?.some(vk => vk.toLowerCase().includes(kw.toLowerCase()))
    );
    if (!hasKeyword) return false;
  }

  if (condition.targetTags) {
    const hasTag = condition.targetTags.some(kw =>
      intent?.target_tags?.some((tt: string) => tt.toLowerCase().includes(kw.toLowerCase()))
    );
    if (!hasTag) return false;
  }

  if (condition.targetCuisineIsBar !== undefined) {
    const BAR_PATTERN = /cocktail|bar\b|speakeasy|brewery|pub|lounge|whiskey bar|wine bar/i;
    const isBar = intent?.target_cuisines?.some((tc: string) => BAR_PATTERN.test(tc)) ?? false;
    if (condition.targetCuisineIsBar !== isBar) return false;
  }

  if (condition.dishLevelIntent !== undefined) {
    const hasDishIntent = intent?.dish_level_intent != null;
    if (condition.dishLevelIntent !== hasDishIntent) return false;
  }

  return true;
}

// ==========================================
// LAYER 2.5: INTENT AMPLIFICATION
// ==========================================

/**
 * Intent Amplification Layer — V7 addition.
 *
 * When the user's query has BOTH high cuisine importance AND a specific dish-level
 * intent (e.g., "tandoori chicken", "mole negro"), the food factor needs an extra
 * boost beyond what Layer 2 rules provide. Without this, non-food factors
 * (vibe, reputation) can still drown out the explicit food request after
 * normalization, especially when occasion or emotion rules also fire.
 *
 * This layer fires AFTER Layer 2 and BEFORE Layer 3.
 */
function applyIntentAmplification(
  weights: V7Weights,
  intent: IntentClassificationV2 | null,
  appliedRules: string[],
): V7Weights {
  if (!intent) return weights;

  const hasDishIntent = intent.dish_level_intent != null;
  const highCuisine = intent.cuisine_importance === "high";

  if (highCuisine && hasDishIntent) {
    const amplified = { ...weights };
    amplified.food += 0.08;
    // Redistribute the boost away from lower-priority factors
    amplified.vibe -= 0.03;
    amplified.service -= 0.02;
    amplified.convenience -= 0.03;
    appliedRules.push("Intent amplification: high cuisine + dish intent → food +0.08");
    return amplified;
  }

  return weights;
}

// ==========================================
// LAYER 3: DATA-QUALITY ADAPTATION
// ==========================================

function adaptWeightsToDataQuality(
  weights: V7Weights,
  confidence: V7FactorConfidence,
): V7Weights {
  const adapted = { ...weights };

  const BOOST_HIGH = 1.15;   // 15% boost for high-confidence data
  const KEEP_MEDIUM = 1.0;   // no change for medium
  const REDUCE_LOW = 0.80;   // 20% reduction for low-confidence data

  const getMultiplier = (c: string): number => {
    if (c === "high") return BOOST_HIGH;
    if (c === "medium") return KEEP_MEDIUM;
    return REDUCE_LOW;
  };

  adapted.food *= getMultiplier(confidence.food);
  adapted.vibe *= getMultiplier(confidence.vibe);
  adapted.service *= getMultiplier(confidence.service);
  adapted.reputation *= getMultiplier(confidence.reputation);
  adapted.convenience *= getMultiplier(confidence.convenience);

  return adapted;
}

// ==========================================
// LAYER 4: CANDIDATE POOL ADAPTATION
// ==========================================

function adaptWeightsToPoolSize(
  weights: V7Weights,
  candidatePoolSize: number,
): V7Weights {
  const adapted = { ...weights };

  if (candidatePoolSize <= 5) {
    // Slim pickings: prioritize quality among limited options
    adapted.reputation += 0.05;
    adapted.food += 0.05;
    adapted.vibe -= 0.05;
    adapted.convenience -= 0.05;
  }
  // 15+: standard weights, plenty of room to differentiate

  return adapted;
}

// ==========================================
// LAYER 5: STACKING CAP ENFORCEMENT
// ==========================================

/**
 * Per-category stacking caps — V7 addition.
 *
 * In V5, when multiple rules from the same category fire (e.g., two emotional
 * intent rules, or multiple context signals), their deltas stack without limit.
 * This can produce unexpected weight distributions.
 *
 * V7 enforces a per-category cap: the total delta contributed by all rules in a
 * single category is clamped to ±CATEGORY_STACKING_CAP per factor.
 *
 * This function is applied during Layer 2 rule processing, not as a post-hoc step.
 */
function applyLayer2WithStackingCaps(
  baseWeights: V7Weights,
  rules: V7WeightShiftRule[],
  occasion: string,
  intent: IntentClassificationV2 | null,
  clientTimeOfDay?: string | null,
): { weights: V7Weights; appliedRules: string[] } {
  const factors: (keyof V7Weights)[] = ["food", "vibe", "service", "reputation", "convenience"];
  const appliedRules: string[] = [];

  // Track cumulative deltas per category per factor
  const categoryDeltas: Record<string, Record<keyof V7Weights, number>> = {};

  // First pass: collect all matching rule deltas grouped by category
  for (const rule of rules) {
    if (!matchesCondition(rule.condition, occasion, intent, clientTimeOfDay)) continue;

    if (rule.label) appliedRules.push(rule.label);

    if (!categoryDeltas[rule.category]) {
      categoryDeltas[rule.category] = { food: 0, vibe: 0, service: 0, reputation: 0, convenience: 0 };
    }

    for (const f of factors) {
      if (rule.deltas[f]) {
        categoryDeltas[rule.category][f] += rule.deltas[f]!;
      }
    }
  }

  // Second pass: apply capped category deltas to base weights
  const w: V7Weights = { ...baseWeights };

  for (const category of Object.keys(categoryDeltas)) {
    const deltas = categoryDeltas[category];
    let capped = false;

    for (const f of factors) {
      // Enforce per-category stacking cap
      const rawDelta = deltas[f];
      const cappedDelta = Math.max(
        -CATEGORY_STACKING_CAP,
        Math.min(CATEGORY_STACKING_CAP, rawDelta),
      );
      w[f] += cappedDelta;

      if (Math.abs(rawDelta - cappedDelta) > 0.001) {
        capped = true;
      }
    }

    if (capped) {
      appliedRules.push(`Stacking cap: category "${category}" clamped to ±${CATEGORY_STACKING_CAP}`);
    }
  }

  return { weights: w, appliedRules };
}

// ==========================================
// NORMALIZATION
// ==========================================

function clampAndNormalize(weights: V7Weights): V7Weights {
  const w = { ...weights };

  // Clamp
  w.food = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.food));
  w.vibe = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.vibe));
  w.service = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.service));
  w.reputation = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.reputation));
  w.convenience = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.convenience));

  // Normalize to sum to 1.0
  const sum = w.food + w.vibe + w.service + w.reputation + w.convenience;
  if (Math.abs(sum - 1.0) > 0.001) {
    w.food /= sum;
    w.vibe /= sum;
    w.service /= sum;
    w.reputation /= sum;
    w.convenience /= sum;
  }

  return w;
}

// ==========================================
// PUBLIC API: COMPUTE V7 WEIGHTS
// ==========================================

/**
 * Compute dynamic weights for a given context using the V7 5-layer system.
 *
 * Process:
 * 1. Start from V7_BASE_WEIGHTS
 * 2. Apply all matching Layer 2 rules with per-category stacking caps (Layer 5)
 * 2.5. Apply intent amplification (high cuisine + dish intent → food +0.08)
 * 3. Apply Layer 3 data-quality adaptation
 * 4. Apply Layer 4 pool-size adaptation
 * 5. Clamp each weight to [0.05, 0.50], normalize to sum 1.0
 *
 * Returns dynamic weights + list of applied rules for debugging.
 */
export function computeV7Weights(
  occasion: string,
  intent: IntentClassificationV2 | null,
  confidence: V7FactorConfidence,
  candidatePoolSize: number = 15,
  clientTimeOfDay?: string | null,
): { weights: V7Weights; appliedRules: string[] } {
  // Layer 1: Start from base
  const base: V7Weights = { ...V7_BASE_WEIGHTS };

  // Layer 2 + Layer 5: Apply matching rules with stacking caps
  let { weights: w, appliedRules } = applyLayer2WithStackingCaps(
    base,
    V7_WEIGHT_SHIFT_RULES,
    occasion,
    intent,
    clientTimeOfDay,
  );

  // Layer 2.5: Intent amplification
  w = applyIntentAmplification(w, intent, appliedRules);

  // Layer 3: Data-quality adaptation
  w = adaptWeightsToDataQuality(w, confidence);

  // Track data quality adaptation in applied rules
  const lowConfFactors: string[] = [];
  const highConfFactors: string[] = [];
  for (const [factor, level] of Object.entries(confidence)) {
    if (level === "low") lowConfFactors.push(factor);
    if (level === "high") highConfFactors.push(factor);
  }
  if (lowConfFactors.length > 0) {
    appliedRules.push(`Data-quality: ${lowConfFactors.join(", ")} downweighted (sparse data)`);
  }
  if (highConfFactors.length > 0 && lowConfFactors.length > 0) {
    appliedRules.push(`Data-quality: ${highConfFactors.join(", ")} upweighted (strong data)`);
  }

  // Layer 4: Pool-size adaptation
  if (candidatePoolSize <= 5) {
    w = adaptWeightsToPoolSize(w, candidatePoolSize);
    appliedRules.push(`Pool-size: slim pickings (${candidatePoolSize}), quality prioritized`);
  }

  // Clamp and normalize
  w = clampAndNormalize(w);

  return { weights: w, appliedRules };
}
