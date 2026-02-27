/**
 * V5 Weight Configuration — 3-Layer Adaptive Dynamic Weight System
 *
 * Layer 1: Base weights (Food: 0.25, Vibe: 0.18, Service: 0.17, Reputation: 0.25, Convenience: 0.15)
 * Layer 2: 28 context-driven shift rules (occasion, cuisine, emotion, constraint, context)
 * Layer 3: Data-quality adaptation (upweight high-confidence, downweight low-confidence factors)
 * Layer 4: Candidate pool adaptation (slim pickings vs abundance)
 *
 * All layers applied sequentially. Clamped [0.05, 0.50], normalized to sum 1.0.
 */

import type { IntentClassificationV2 } from "./intent-classifier.ts";
import type { V5Weights, V5WeightShiftCondition, V5WeightShiftRule, V5FactorConfidence } from "./types-v5.ts";

// ==========================================
// LAYER 1: BASE WEIGHTS
// ==========================================

export const V5_BASE_WEIGHTS: V5Weights = {
  food: 0.25,
  vibe: 0.18,
  service: 0.17,
  reputation: 0.25,
  convenience: 0.15,
};

// ==========================================
// LAYER 2: WEIGHT SHIFT RULES (28 rules)
// ==========================================

export const V5_WEIGHT_SHIFT_RULES: V5WeightShiftRule[] = [
  // --- Category A: Occasion shifts (8 rules) ---
  {
    condition: { occasion: ["Date Night", "Special Occasion"] },
    deltas: { vibe: +0.08, service: +0.04, convenience: -0.08, reputation: -0.04 },
    label: "Date/special: vibe + service up, convenience down",
  },
  {
    condition: { occasion: ["Business Lunch"] },
    deltas: { service: +0.08, vibe: +0.04, food: -0.04, convenience: -0.04, reputation: -0.04 },
    label: "Business: service + vibe up, food down",
  },
  {
    condition: { occasion: ["Adventure"] },
    deltas: { reputation: +0.05, food: -0.03, service: -0.02 },
    label: "Adventure: reputation up (hidden gems)",
  },
  {
    condition: { occasion: ["Family Dinner"] },
    deltas: { service: +0.05, convenience: +0.08, vibe: -0.08, reputation: -0.05 },
    label: "Family: convenience + service up, vibe down",
  },
  {
    condition: { occasion: ["Solo Dining"] },
    deltas: { convenience: +0.08, food: +0.05, service: -0.08, vibe: -0.05 },
    label: "Solo: convenience + food up, service down",
  },
  {
    condition: { occasion: ["Treat Myself"] },
    deltas: { food: +0.05, vibe: +0.05, convenience: -0.10 },
    label: "Treat myself: food + vibe up, convenience down",
  },
  {
    condition: { occasion: ["Chill Hangout"] },
    deltas: { vibe: +0.08, convenience: +0.05, food: -0.08, reputation: -0.05 },
    label: "Chill: vibe + convenience up, food down",
  },
  {
    condition: { occasion: ["Group Hangout"] },
    deltas: { service: +0.05, vibe: +0.05, food: -0.05, reputation: -0.05 },
    label: "Group: service + vibe up, food + reputation down",
  },

  // --- Category B: Cuisine importance shifts (3 rules) ---
  {
    condition: { cuisineImportance: "high" },
    deltas: { food: +0.15, vibe: -0.05, service: -0.05, reputation: -0.05 },
    label: "High cuisine priority: food dominates",
  },
  {
    condition: { cuisineImportance: "medium" },
    deltas: { food: +0.05, vibe: -0.025, convenience: -0.025 },
    label: "Medium cuisine priority: food slightly up",
  },
  {
    condition: { cuisineImportance: "low" },
    deltas: { vibe: +0.05, service: +0.03, food: -0.08 },
    label: "Low cuisine priority: vibe + service up, food down",
  },

  // --- Category B2: V6 Dish-level intent shift (1 rule) ---
  // When the user asks for a specific dish (e.g., "tandoori chicken"), push Food
  // weight even higher on top of the cuisine_importance="high" shift (+0.15).
  // This amplifies the 3.3-point dish match gap in the Food factor.
  {
    condition: { dishLevelIntent: true },
    deltas: { food: +0.05, vibe: -0.03, convenience: -0.02 },
    label: "Dish-level query: food further elevated",
  },

  // --- Category C: Emotional intent shifts (6 rules) ---
  {
    condition: { emotionalIntent: "impress" },
    deltas: { reputation: +0.08, service: +0.04, convenience: -0.07, food: -0.05 },
    label: "Impress: reputation + service up",
  },
  {
    condition: { emotionalIntent: "comfort" },
    deltas: { vibe: +0.08, food: +0.03, reputation: -0.06, service: -0.05 },
    label: "Comfort: vibe + food up",
  },
  {
    condition: { emotionalIntent: "explore" },
    deltas: { reputation: +0.05, food: +0.03, vibe: -0.04, convenience: -0.04 },
    label: "Explore: reputation + food up (discovery)",
  },
  {
    condition: { emotionalIntent: "celebrate" },
    deltas: { vibe: +0.07, service: +0.05, reputation: +0.03, food: -0.08, convenience: -0.07 },
    label: "Celebrate: vibe + service + reputation up",
  },
  {
    condition: { emotionalIntent: "casual" },
    deltas: { convenience: +0.05, food: -0.03, service: -0.02 },
    label: "Casual: convenience up, low effort",
  },
  {
    condition: { emotionalIntent: "indulge" },
    deltas: { food: +0.08, vibe: +0.04, convenience: -0.08, service: -0.04 },
    label: "Indulge: food + vibe up, convenience down",
  },

  // --- Category D: Constraint shifts (3 rules) ---
  {
    condition: { priceSensitive: true },
    deltas: { convenience: +0.10, food: -0.05, vibe: -0.05 },
    label: "Price sensitive: convenience up",
  },
  {
    condition: { spontaneous: true },
    deltas: { convenience: +0.12, service: -0.05, vibe: -0.07 },
    label: "Spontaneous: convenience up (walk-in, no wait)",
  },
  {
    condition: { planned: true },
    deltas: { service: +0.05, vibe: +0.05, convenience: -0.10 },
    label: "Planned: service + vibe up, convenience down",
  },

  // --- Category E: Context signals (8 rules) ---
  {
    condition: { dateType: "first_date" },
    deltas: { vibe: +0.10, reputation: +0.05, food: -0.07, convenience: -0.08 },
    label: "First date: vibe + reputation up (safe pick)",
  },
  {
    condition: { dateType: "anniversary" },
    deltas: { vibe: +0.08, service: +0.05, reputation: +0.05, food: -0.08, convenience: -0.10 },
    label: "Anniversary: must be special",
  },
  {
    condition: { groupSizeHint: "large_group" },
    deltas: { service: +0.08, convenience: +0.07, vibe: -0.05, food: -0.05, reputation: -0.05 },
    label: "Large group: logistics dominate",
  },
  {
    condition: { groupSizeHint: "solo" },
    deltas: { food: +0.05, convenience: +0.05, service: -0.05, vibe: -0.05 },
    label: "Solo: food + convenience up",
  },
  {
    condition: { timeOfDay: "late_night" },
    deltas: { convenience: +0.08, vibe: +0.05, service: -0.08, reputation: -0.05 },
    label: "Late night: open late matters most",
  },
  {
    condition: { timeOfDay: "breakfast" },
    deltas: { food: +0.05, convenience: +0.05, vibe: -0.05, reputation: -0.05 },
    label: "Breakfast: quality + quick",
  },

  // --- Category F: Vibe keyword signals (2 rules) ---
  {
    condition: { vibeKeywords: ["rooftop", "outdoor", "terrace", "patio", "view", "al fresco"] },
    deltas: { vibe: +0.08, food: -0.04, convenience: -0.04 },
    label: "Outdoor/rooftop query: vibe weight elevated",
  },
  {
    condition: { targetCuisineIsBar: true },
    deltas: { vibe: +0.08, food: -0.05, convenience: -0.03 },
    label: "Cocktail/bar query: vibe co-elevated with food",
  },
];

// ==========================================
// WEIGHT CLAMPING BOUNDS
// ==========================================

const WEIGHT_MIN = 0.05;
const WEIGHT_MAX = 0.50;

// ==========================================
// LAYER 2: RULE MATCHING
// ==========================================

function matchesCondition(
  condition: V5WeightShiftCondition,
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

  if (condition.targetCuisineIsBar !== undefined) {
    const BAR_PATTERN = /cocktail|bar\b|speakeasy|brewery|pub|lounge|whiskey bar|wine bar/i;
    const isBar = intent?.target_cuisines?.some((tc: string) => BAR_PATTERN.test(tc)) ?? false;
    if (condition.targetCuisineIsBar !== isBar) return false;
  }

  // V6: Dish-level intent condition
  if (condition.dishLevelIntent !== undefined) {
    const hasDishIntent = intent?.dish_level_intent != null;
    if (condition.dishLevelIntent !== hasDishIntent) return false;
  }

  return true;
}

// ==========================================
// LAYER 3: DATA-QUALITY ADAPTATION
// ==========================================

function adaptWeightsToDataQuality(
  weights: V5Weights,
  confidence: V5FactorConfidence,
): V5Weights {
  const adapted = { ...weights };

  const BOOST_HIGH = 1.15;   // 15% boost for high-confidence data
  const KEEP_MEDIUM = 1.0;    // no change for medium
  const REDUCE_LOW = 0.80;    // 20% reduction for low-confidence data

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
  weights: V5Weights,
  candidatePoolSize: number,
): V5Weights {
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
// NORMALIZATION
// ==========================================

function clampAndNormalize(weights: V5Weights): V5Weights {
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
// PUBLIC API: COMPUTE V5 WEIGHTS
// ==========================================

/**
 * Compute dynamic weights for a given context.
 *
 * Process:
 * 1. Start from V5_BASE_WEIGHTS
 * 2. Apply all matching Layer 2 rule deltas additively
 * 3. Apply Layer 3 data-quality adaptation
 * 4. Apply Layer 4 pool-size adaptation
 * 5. Clamp each weight to [0.05, 0.50], normalize to sum 1.0
 *
 * Returns dynamic weights + list of applied rules for debugging.
 */
export function computeV5Weights(
  occasion: string,
  intent: IntentClassificationV2 | null,
  confidence: V5FactorConfidence,
  candidatePoolSize: number = 15,
  clientTimeOfDay?: string | null,
): { weights: V5Weights; appliedRules: string[] } {
  // Layer 1: Start from base
  let w: V5Weights = { ...V5_BASE_WEIGHTS };
  const appliedRules: string[] = [];

  // Layer 2: Apply all matching rules
  for (const rule of V5_WEIGHT_SHIFT_RULES) {
    if (matchesCondition(rule.condition, occasion, intent, clientTimeOfDay)) {
      if (rule.deltas.food) w.food += rule.deltas.food;
      if (rule.deltas.vibe) w.vibe += rule.deltas.vibe;
      if (rule.deltas.service) w.service += rule.deltas.service;
      if (rule.deltas.reputation) w.reputation += rule.deltas.reputation;
      if (rule.deltas.convenience) w.convenience += rule.deltas.convenience;
      if (rule.label) appliedRules.push(rule.label);
    }
  }

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
