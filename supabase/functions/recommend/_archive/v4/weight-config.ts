/**
 * V4 Weight Configuration — Dynamic Weight Shift Engine
 *
 * Configurable mapping from parsed intent signals to factor weight adjustments.
 * Replaces the hardcoded if/else weight logic from V3's computeV3Weights().
 *
 * Design: Each rule has a condition matcher and weight deltas. All matching rules
 * are applied additively, then weights are clamped and normalized to sum to 1.0.
 */

import type { IntentClassificationV2 } from "./intent-classifier.ts";

// ==========================================
// V4 WEIGHT TYPES
// ==========================================

export interface V4Weights {
  foodQuality: number;
  vibe: number;
  service: number;
  reputation: number;
  convenience: number;
}

export interface WeightShiftCondition {
  occasion?: string[];
  cuisineImportance?: "high" | "medium" | "low";
  emotionalIntent?: string;
  priceSensitive?: boolean;
  spontaneous?: boolean;
}

export interface WeightShiftRule {
  condition: WeightShiftCondition;
  deltas: Partial<V4Weights>;
  label?: string; // Human-readable description for debugging
}

// ==========================================
// BASE WEIGHTS
// ==========================================

export const BASE_WEIGHTS: V4Weights = {
  foodQuality: 0.30,
  vibe: 0.20,
  service: 0.20,
  reputation: 0.15,
  convenience: 0.15,
};

// ==========================================
// WEIGHT SHIFT RULES
// ==========================================

export const WEIGHT_SHIFT_RULES: WeightShiftRule[] = [
  // --- Occasion-driven shifts ---
  {
    condition: { occasion: ["Date Night", "Special Occasion"] },
    deltas: { vibe: +0.10, service: +0.05, convenience: -0.10, foodQuality: -0.05 },
    label: "Date/special: vibe + service up, convenience down",
  },
  {
    condition: { occasion: ["Business Lunch"] },
    deltas: { service: +0.10, vibe: +0.05, convenience: -0.05, foodQuality: -0.10 },
    label: "Business: service + vibe up, food down",
  },
  {
    condition: { occasion: ["Adventure"] },
    deltas: { reputation: +0.10, foodQuality: -0.05, service: -0.05 },
    label: "Adventure: reputation up (hidden gems), food + service down",
  },
  {
    condition: { occasion: ["Family Dinner"] },
    deltas: { service: +0.05, convenience: +0.10, vibe: -0.10, reputation: -0.05 },
    label: "Family: convenience + service up, vibe down",
  },
  {
    condition: { occasion: ["Solo Dining"] },
    deltas: { convenience: +0.10, foodQuality: +0.05, service: -0.10, vibe: -0.05 },
    label: "Solo: convenience + food up, service down",
  },
  {
    condition: { occasion: ["Treat Myself"] },
    deltas: { foodQuality: +0.05, vibe: +0.05, convenience: -0.10 },
    label: "Treat myself: food + vibe up, convenience down",
  },
  {
    condition: { occasion: ["Chill Hangout"] },
    deltas: { vibe: +0.10, convenience: +0.05, foodQuality: -0.10, reputation: -0.05 },
    label: "Chill: vibe + convenience up, food down",
  },
  {
    condition: { occasion: ["Group Hangout"] },
    deltas: { service: +0.05, vibe: +0.05, foodQuality: -0.05, reputation: -0.05 },
    label: "Group: service + vibe up, food + reputation down",
  },

  // --- Intent-driven shifts ---
  {
    condition: { cuisineImportance: "high" },
    deltas: { foodQuality: +0.15, vibe: -0.05, service: -0.05, reputation: -0.05 },
    label: "High cuisine priority: food dominates",
  },
  {
    condition: { cuisineImportance: "medium" },
    deltas: { foodQuality: +0.05, vibe: -0.025, convenience: -0.025 },
    label: "Medium cuisine priority: food slightly up",
  },
  {
    condition: { emotionalIntent: "impress" },
    deltas: { reputation: +0.05, convenience: -0.05 },
    label: "Impress: reputation up",
  },
  {
    condition: { emotionalIntent: "comfort" },
    deltas: { vibe: +0.05, reputation: -0.05 },
    label: "Comfort: vibe up",
  },
  {
    condition: { emotionalIntent: "explore" },
    deltas: { reputation: +0.05, foodQuality: -0.05 },
    label: "Explore: reputation up (discovery value)",
  },
  {
    condition: { emotionalIntent: "indulge" },
    deltas: { foodQuality: +0.05, vibe: +0.03, convenience: -0.08 },
    label: "Indulge: food + vibe up, convenience down",
  },

  // --- Constraint-driven shifts ---
  {
    condition: { priceSensitive: true },
    deltas: { convenience: +0.10, foodQuality: -0.05, vibe: -0.05 },
    label: "Price sensitive: convenience up (price fit lives here)",
  },
  {
    condition: { spontaneous: true },
    deltas: { convenience: +0.10, service: -0.05, vibe: -0.05 },
    label: "Spontaneous: convenience up (walk-in, wait time)",
  },
];

// ==========================================
// WEIGHT CLAMPING BOUNDS
// ==========================================

const WEIGHT_MIN = 0.05;
const WEIGHT_MAX = 0.60;

// ==========================================
// WEIGHT COMPUTATION ENGINE
// ==========================================

/**
 * Check if a single rule's condition matches the current context.
 */
function matchesCondition(
  condition: WeightShiftCondition,
  occasion: string,
  intent: IntentClassificationV2 | null,
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

  return true;
}

/**
 * Compute dynamic weights for a given occasion + intent context.
 *
 * Process:
 * 1. Start from BASE_WEIGHTS
 * 2. Apply all matching rule deltas additively
 * 3. Clamp each weight to [WEIGHT_MIN, WEIGHT_MAX]
 * 4. Normalize to sum to 1.0
 *
 * Returns the dynamic weights and a list of which rules were applied (for debugging/blurb context).
 */
export function computeV4Weights(
  occasion: string,
  intent: IntentClassificationV2 | null,
): { weights: V4Weights; appliedRules: string[] } {
  // Start from base
  const w: V4Weights = { ...BASE_WEIGHTS };
  const appliedRules: string[] = [];

  // Apply all matching rules
  for (const rule of WEIGHT_SHIFT_RULES) {
    if (matchesCondition(rule.condition, occasion, intent)) {
      if (rule.deltas.foodQuality) w.foodQuality += rule.deltas.foodQuality;
      if (rule.deltas.vibe) w.vibe += rule.deltas.vibe;
      if (rule.deltas.service) w.service += rule.deltas.service;
      if (rule.deltas.reputation) w.reputation += rule.deltas.reputation;
      if (rule.deltas.convenience) w.convenience += rule.deltas.convenience;
      if (rule.label) appliedRules.push(rule.label);
    }
  }

  // Clamp
  w.foodQuality = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.foodQuality));
  w.vibe = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.vibe));
  w.service = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.service));
  w.reputation = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.reputation));
  w.convenience = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.convenience));

  // Normalize to sum to 1.0
  const sum = w.foodQuality + w.vibe + w.service + w.reputation + w.convenience;
  if (Math.abs(sum - 1.0) > 0.001) {
    w.foodQuality /= sum;
    w.vibe /= sum;
    w.service /= sum;
    w.reputation /= sum;
    w.convenience /= sum;
  }

  return { weights: w, appliedRules };
}
