/**
 * Donde Match V9 — Relevance × Quality Scoring Engine
 *
 * V9 Architecture:
 *   DondeScore = Relevance(0-1) × Quality(0-100) + OccasionBonus(±5)
 *
 * Relevance is a GATE — low relevance = low score regardless of quality.
 *   Priority hierarchy: dish > cuisine > vibe > open_ended
 *   Uses review intelligence (evidence-based) + structured data (fallback)
 *
 * Quality is the RANK — among relevant restaurants, quality determines order.
 *   Weight profiles adapt to query type (no weight-shift rules needed)
 *
 * Occasion is a TIEBREAKER — ±5 points max, never drives the ranking.
 *
 * Statistical foundations:
 * - Bayesian average for Google ratings (C=30, m=4.15) — retained from V8
 * - Wu-Palmer cuisine taxonomy (6-level) — retained from V8
 * - BM25/TF-IDF via PostgreSQL ts_rank() — new, for review intelligence
 * - Conditional probability: P(quality | match_type) — new, query-type weights
 * - Laplace smoothing: vibe/constraint floors — retained from V8
 */

import type { RestaurantProfile } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { IntentClassificationV2 } from "./intent-classifier.ts";
import type {
  MatchNarrative,
  V9Candidate,
  V9Factors,
  V9FactorDetails,
  V9FactorConfidence,
  V9Relevance,
  V9RelevanceType,
  V9QualityWeights,
  V9QualityResult,
  V9ScoringContext,
  V9ScoreResult,
  V9ScoredCandidate,
  V9SubComponent,
  ReviewIntelligence,
} from "./types-v9.ts";
import {
  OCCASION_WEIGHTS,
  DIETARY_KEYWORDS,
} from "./scoring.ts";

// ==========================================
// CONSTANTS
// ==========================================

// Cuisine family relationships — retained from V8
const CUISINE_FAMILIES: Record<string, string[]> = {
  Mediterranean: ["Greek", "Italian", "Middle Eastern", "Spanish", "Moroccan", "Levantine"],
  "East Asian": ["Japanese", "Chinese", "Korean", "Taiwanese", "Sichuan"],
  "Southeast Asian": ["Thai", "Vietnamese", "Cambodian", "Laotian", "Malaysian", "Singaporean"],
  "Latin American": ["Mexican", "Peruvian", "Brazilian", "Puerto Rican", "Colombian", "Ecuadorian", "Venezuelan", "Salvadoran", "Argentine"],
  Caribbean: ["Cuban", "Jamaican", "Trinidadian", "Caribbean/Jamaican"],
  "South Asian": ["Indian", "Nepalese/Tibetan", "Pakistani"],
  "East African": ["Ethiopian", "Eritrean", "Somali", "East African"],
  "West African": ["Nigerian", "Ghanaian", "Senegalese", "West African", "Liberian"],
  "Central Asian": ["Central Asian", "Georgian", "Azerbaijani"],
  "Middle Eastern": ["Persian", "Yemeni", "Kurdish", "Palestinian", "Lebanese", "Turkish"],
  European: ["Polish", "German", "French", "British", "Ukrainian", "Irish", "Swedish", "Serbian", "Bosnian", "Portuguese", "Spanish"],
  American: ["BBQ", "Southern", "Southern/Soul Food", "Cajun", "Creole", "Hawaiian"],
};

const FAMILY_ADJACENCY: Record<string, string[]> = {
  Mediterranean: ["European", "Middle Eastern", "East African"],
  "East Asian": ["Southeast Asian"],
  "Southeast Asian": ["East Asian", "South Asian"],
  "Latin American": ["Caribbean"],
  Caribbean: ["Latin American", "West African"],
  "South Asian": ["Southeast Asian", "Middle Eastern"],
  "East African": ["Mediterranean", "West African", "Middle Eastern"],
  "West African": ["Caribbean", "East African"],
  "Central Asian": ["Middle Eastern", "South Asian"],
  "Middle Eastern": ["Mediterranean", "South Asian", "Central Asian"],
  European: ["Mediterranean"],
  American: ["European"],
};

const CUISINE_TO_FAMILY: Record<string, string> = {};
for (const [family, cuisines] of Object.entries(CUISINE_FAMILIES)) {
  for (const c of cuisines) CUISINE_TO_FAMILY[c] = family;
}

function getCuisineFamily(cuisine: string): string | null {
  return CUISINE_TO_FAMILY[cuisine] || null;
}

function isRelatedCuisine(cuisine: string, targets: string[]): boolean {
  const family = getCuisineFamily(cuisine);
  if (!family) return false;
  return targets.some(t => {
    if (t.toLowerCase() === family.toLowerCase()) return true;
    const targetFamily = getCuisineFamily(t);
    return targetFamily === family;
  });
}

function isAdjacentCuisine(cuisine: string, targets: string[]): boolean {
  const family = getCuisineFamily(cuisine);
  if (!family) return false;
  const adjacent = FAMILY_ADJACENCY[family] || [];
  return targets.some(t => {
    const targetFamily = getCuisineFamily(t);
    if (!targetFamily) return false;
    return adjacent.includes(targetFamily);
  });
}

function tagToString(t: unknown): string {
  if (typeof t === "string") return t;
  if (t && typeof t === "object" && "name" in t) return (t as { name: string }).name || "";
  if (t && typeof t === "object" && "tag_text" in t) return (t as { tag_text: string }).tag_text || "";
  return "";
}

// Occasion noise/service expectations — retained from V8
const OCCASION_NOISE: Record<string, string[]> = {
  "Date Night": ["Quiet", "Moderate"], "Group Hangout": ["Moderate", "Loud"],
  "Family Dinner": ["Quiet", "Moderate"], "Business Lunch": ["Quiet"],
  "Solo Dining": ["Quiet", "Moderate"], "Special Occasion": ["Quiet"],
  "Treat Myself": ["Quiet", "Moderate"], Adventure: ["Moderate", "Loud", "Quiet"],
  "Chill Hangout": ["Moderate", "Quiet"], Any: ["Quiet", "Moderate"],
};

const SERVICE_CLASH: Record<string, string[]> = {
  "Special Occasion": ["Fast Casual", "Counter"],
  "Date Night": ["Fast Casual"],
  "Business Lunch": ["Counter", "Fast Casual"],
  "Group Hangout": ["Omakase"],
};

const SERVICE_FIT: Record<string, string[]> = {
  "Business Lunch": ["Full Table Service"],
  "Date Night": ["Full Table Service", "Omakase", "Tasting Menu", "Bar Service"],
  "Group Hangout": ["Full Table Service", "Family Style", "Fast Casual", "Bar Service"],
  "Family Dinner": ["Full Table Service", "Family Style"],
  "Solo Dining": ["Counter", "Bar Service", "Fast Casual", "Full Table Service"],
  "Special Occasion": ["Tasting Menu", "Omakase", "Full Table Service"],
  "Treat Myself": ["Full Table Service", "Omakase", "Tasting Menu", "Counter"],
  Adventure: ["Counter", "Family Style", "Omakase", "Full Table Service"],
  "Chill Hangout": ["Full Table Service", "Bar Service", "Fast Casual"],
};

const OCCASION_ENERGY: Record<string, [number, number]> = {
  "Date Night": [4, 7], "Group Hangout": [6, 9], "Family Dinner": [3, 6],
  "Business Lunch": [2, 5], "Solo Dining": [2, 6], "Special Occasion": [4, 7],
  "Treat Myself": [3, 7], Adventure: [4, 10], "Chill Hangout": [3, 6], Any: [3, 7],
};

const MUSIC_FIT: Record<string, string[]> = {
  "Date Night": ["live-jazz", "curated-playlist", "ambient"],
  "Business Lunch": ["ambient", "no-music"],
  "Group Hangout": ["curated-playlist", "DJ", "live-jazz", "live-band"],
  "Family Dinner": ["ambient", "no-music", "curated-playlist"],
  "Solo Dining": ["curated-playlist", "ambient", "no-music"],
  "Special Occasion": ["live-jazz", "curated-playlist", "ambient"],
  "Chill Hangout": ["curated-playlist", "ambient", "live-jazz"],
  Adventure: ["live-jazz", "live-band", "DJ", "curated-playlist"],
  "Treat Myself": ["curated-playlist", "ambient", "live-jazz"],
  Any: ["curated-playlist", "ambient"],
};

// ==========================================
// QUALITY WEIGHT PROFILES
// ==========================================

/**
 * Statistical foundation: Conditional probability
 * P(quality | match_type) has different factor distributions depending on query type.
 * This replaces V8's 14 weight-shift rules with 4 static profiles.
 */
const QUALITY_WEIGHTS: Record<V9RelevanceType, V9QualityWeights> = {
  dish: {
    // "I want momos" — food quality is what matters
    food: 0.40, reputation: 0.30, vibe: 0.10, service: 0.10, convenience: 0.10,
  },
  cuisine: {
    // "I want Thai food" — food quality + reputation
    food: 0.35, reputation: 0.30, vibe: 0.12, service: 0.12, convenience: 0.11,
  },
  vibe: {
    // "quiet intimate anniversary" — vibe is what matters
    food: 0.15, reputation: 0.25, vibe: 0.35, service: 0.15, convenience: 0.10,
  },
  open_ended: {
    // "surprise me" — reputation is the deciding factor
    food: 0.18, reputation: 0.45, vibe: 0.15, service: 0.12, convenience: 0.10,
  },
};

// ==========================================
// RELEVANCE COMPUTATION (0-1.0) — THE GATE
// ==========================================

function isOpenEnded(intent: IntentClassificationV2): boolean {
  return (
    (intent.target_cuisines?.length ?? 0) === 0 &&
    (intent.target_tags?.length ?? 0) === 0 &&
    (intent.vibe_keywords?.length ?? 0) === 0 &&
    (intent.practical_constraints?.length ?? 0) === 0 &&
    (intent.flavor_preferences?.length ?? 0) === 0 &&
    !intent.dish_level_intent
  );
}

/**
 * Compute Relevance — "Does this restaurant match what the user is looking for?"
 *
 * Priority: dish > cuisine > vibe > open_ended
 * Uses review intelligence (evidence-based) as primary, structured data as fallback.
 */
export function computeRelevance(
  candidate: V9Candidate,
  intent: IntentClassificationV2 | null,
  specialRequest: string,
): V9Relevance {

  // No intent → everything is equally relevant (open-ended query)
  if (!intent || isOpenEnded(intent)) {
    return { score: 1.0, type: "open_ended", details: "No specific request — all restaurants relevant" };
  }

  const hasDish = !!intent.dish_level_intent;
  const hasCuisine = (intent.target_cuisines?.length ?? 0) > 0;
  const hasVibe = (intent.vibe_keywords?.length ?? 0) > 0 || (intent.target_tags?.length ?? 0) > 0;

  // === DISH-LEVEL RELEVANCE (highest priority) ===
  if (hasDish) {
    const dishRelevance = computeDishRelevance(candidate, intent, specialRequest);
    if (dishRelevance > 0) {
      return { score: dishRelevance, type: "dish", details: `Dish match: ${dishRelevance.toFixed(2)}` };
    }
    // Dish requested but not found → fall through to cuisine (heavily penalized)
    if (hasCuisine) {
      const cuisineRelevance = computeCuisineRelevance(candidate, intent);
      // Cap at 0.40 — right cuisine but wrong dish
      return {
        score: Math.min(0.40, cuisineRelevance * 0.40),
        type: "cuisine",
        details: `Cuisine match but no dish (capped 0.40)`,
      };
    }
    // Dish requested, no cuisine match either → very low relevance
    return { score: 0.05, type: "dish", details: "No dish or cuisine match" };
  }

  // === CUISINE-LEVEL RELEVANCE ===
  if (hasCuisine) {
    const cuisineRelevance = computeCuisineRelevance(candidate, intent);
    return { score: cuisineRelevance, type: "cuisine", details: `Cuisine: ${cuisineRelevance.toFixed(2)}` };
  }

  // === VIBE-LEVEL RELEVANCE ===
  if (hasVibe) {
    const vibeRelevance = computeVibeRelevance(candidate, intent);
    return { score: vibeRelevance, type: "vibe", details: `Vibe: ${vibeRelevance.toFixed(2)}` };
  }

  // Fallback: some intent but no clear food/vibe signal
  return { score: 0.70, type: "open_ended", details: "Weak signal" };
}

// ---- Dish Relevance (0-1.0) — Uses Review Intelligence ----

function computeDishRelevance(
  candidate: V9Candidate,
  intent: IntentClassificationV2,
  _specialRequest: string,
): number {
  const dish = intent.dish_level_intent!.toLowerCase();
  const ri = candidate.review_intelligence;

  // Level 1: Review intelligence dish catalog (NEW in V9)
  if (ri?.dish_catalog?.length) {
    const exactDish = ri.dish_catalog.some(d =>
      d.toLowerCase().includes(dish) || dish.includes(d.toLowerCase())
    );
    if (exactDish) {
      const isPopular = ri.popular_dishes?.some(d =>
        d.toLowerCase().includes(dish) || dish.includes(d.toLowerCase())
      );
      return isPopular ? 1.0 : 0.90; // Popular dish = perfect, any mention = excellent
    }
  }

  // Level 2: Full-text search rank from SQL (already computed in RPC)
  if (candidate.ri_text_rank > 0.1) {
    return Math.min(0.85, 0.50 + candidate.ri_text_rank);
  }

  // Level 3: Structured data — signature_dishes, menu_highlights (same as V8 fallback)
  const dp = candidate.deep_profile;
  if (dp?.signature_dishes?.length) {
    const match = dp.signature_dishes.some(d =>
      d.dish.toLowerCase().includes(dish) || dish.includes(d.dish.toLowerCase())
    );
    if (match) return 0.85;

    // Word-level match
    const words = dish.split(/\s+/).filter(w => w.length > 2);
    const wordMatch = dp.signature_dishes.some(d =>
      words.some(w => d.dish.toLowerCase().includes(w))
    );
    if (wordMatch) return 0.50;
  }

  // Level 4: menu_highlights (AI-predicted, lowest priority)
  if (dp?.menu_highlights?.some(h => h.toLowerCase().includes(dish))) {
    return 0.65;
  }

  // Level 5: No dish data at all
  return 0.0;
}

// ---- Cuisine Relevance (0-1.0) — Reuses V8 6-level Taxonomy ----

function computeCuisineRelevance(
  candidate: V9Candidate,
  intent: IntentClassificationV2,
): number {
  const targets = intent.target_cuisines || [];
  if (targets.length === 0) return 0.5;
  const ri = candidate.review_intelligence;

  // Review intelligence cuisine signals (NEW in V9)
  // Evidence-based: what reviewers actually say about the cuisine
  if (ri?.cuisine_signals?.length) {
    const riMatch = targets.some(t =>
      ri.cuisine_signals.some(s => s.toLowerCase() === t.toLowerCase())
    );
    if (riMatch) return 0.95; // Reviews confirm this cuisine
  }

  // Structured cuisine_type (same as V8 6-level taxonomy)
  if (candidate.cuisine_type) {
    const cl = candidate.cuisine_type.toLowerCase();
    if (targets.some(t => t.toLowerCase() === cl)) return 1.0;           // Exact
    if (targets.some(t => cl.includes(t.toLowerCase()) || t.toLowerCase().includes(cl))) return 0.80; // Contains
    if (isRelatedCuisine(candidate.cuisine_type, targets)) return 0.50;  // Same family
    if (isAdjacentCuisine(candidate.cuisine_type, targets)) return 0.30; // Adjacent
    return 0.05; // Different cuisine entirely
  }

  // No cuisine_type → check review intelligence
  if (ri?.cuisine_signals?.length) {
    // We have review data suggesting a cuisine but no structured match to target
    const riPartial = targets.some(t =>
      ri.cuisine_signals.some(s =>
        s.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(s.toLowerCase())
      )
    );
    return riPartial ? 0.70 : 0.15;
  }

  return 0.10; // No data at all
}

// ---- Vibe Relevance (0-1.0) — Tag + Deep Profile Matching ----

function computeVibeRelevance(
  candidate: V9Candidate,
  intent: IntentClassificationV2,
): number {
  const signals = [...(intent.vibe_keywords || []), ...(intent.target_tags || [])];
  if (signals.length === 0) return 0.80;

  const tags = (candidate.tags || []).map(t => tagToString(t).toLowerCase());
  const dp = candidate.deep_profile;
  const oneliner = (candidate.best_for_oneliner || "").toLowerCase();

  let hits = 0;
  for (const signal of signals) {
    const sl = signal.toLowerCase();
    if (tags.some(t => t.includes(sl))) { hits++; continue; }
    if (dp?.decor_style?.toLowerCase().includes(sl)) { hits++; continue; }
    if (dp?.music_vibe?.toLowerCase().includes(sl)) { hits++; continue; }
    if (dp?.wow_factors?.some(w => w.toLowerCase().includes(sl))) { hits++; continue; }
    if (dp?.service_style?.toLowerCase().includes(sl)) { hits++; continue; }
    if (oneliner.includes(sl)) { hits++; continue; }
  }

  const hitRate = hits / signals.length;
  // Vibe queries are fuzzy — sparse tag data ≠ bad match.
  // Floor at 0.65 (vs 0.25 before). Full hit = 1.0.
  return 0.65 + 0.35 * hitRate;
}

// ==========================================
// QUALITY COMPUTATION (0-100) — THE RANK
// ==========================================

/**
 * Compute Quality — "How good is this restaurant at what the user cares about?"
 * Adapts quality weights based on the relevance type (query context).
 */
export function computeQuality(
  candidate: V9Candidate,
  relevanceType: V9RelevanceType,
  context: V9ScoringContext,
): { quality: number; weights: V9QualityWeights; factors: V9Factors; factorDetails: V9FactorDetails; factorConfidence: V9FactorConfidence } {
  const weights = QUALITY_WEIGHTS[relevanceType];

  // Compute raw quality dimensions (0-10 each) — now returns details + confidence
  const foodResult = computeFoodQuality(candidate, context.googleData, context.intent, relevanceType);
  const reputationResult = computeReputationQuality(candidate, context.googleData);
  const vibeResult = computeVibeQuality(candidate, context.occasion, context.intent);
  const serviceResult = computeServiceQuality(candidate, context.occasion, context.intent);
  const convenienceResult = computeConvenienceQuality(candidate, context.intent, context.clientTimeOfDay, context.specialRequest, context.priceLevel);

  const quality = (
    foodResult.score * weights.food +
    reputationResult.score * weights.reputation +
    vibeResult.score * weights.vibe +
    serviceResult.score * weights.service +
    convenienceResult.score * weights.convenience
  ) * 10; // Scale to 0-100

  return {
    quality: Math.min(100, Math.max(0, quality)),
    weights,
    factors: {
      food: foodResult.score,
      vibe: vibeResult.score,
      service: serviceResult.score,
      reputation: reputationResult.score,
      convenience: convenienceResult.score,
    },
    factorDetails: {
      food: foodResult.details,
      vibe: vibeResult.details,
      service: serviceResult.details,
      reputation: reputationResult.details,
      convenience: convenienceResult.details,
    },
    factorConfidence: {
      food: foodResult.confidence,
      vibe: vibeResult.confidence,
      service: serviceResult.confidence,
      reputation: reputationResult.confidence,
      convenience: convenienceResult.confidence,
    },
  };
}

// ---- Food Quality (0-10) — Blends Review Intelligence with Structured Data ----

function computeFoodQuality(
  candidate: V9Candidate,
  googleData: GooglePlaceData | null,
  intent: IntentClassificationV2 | null,
  relevanceType: V9RelevanceType,
): V9QualityResult {
  const ri = candidate.review_intelligence;
  const dp = candidate.deep_profile;
  const details: Record<string, V9SubComponent> = {};

  let score = 5.0; // Neutral starting point
  let signals = 0;
  let confidence: "high" | "medium" | "low" = "low";

  // Review intelligence food quality (strongest signal — from actual reviews)
  if (ri?.review_food_quality != null) {
    score = ri.review_food_quality; // 0-10 from review analysis
    signals += 3; // Weighted heavily (worth 3 other signals)
    details.review_quality = { score: ri.review_food_quality, max: 10, signal: "Review food quality score" };
    confidence = "high";
  }

  // Google rating as food proxy — Bayesian average
  if (googleData?.google_rating != null) {
    const BAYESIAN_C = 30;
    const BAYESIAN_M = 4.15;
    const reviewCount = googleData.google_review_count || 0;
    const bayesianRating = (BAYESIAN_C * BAYESIAN_M + reviewCount * googleData.google_rating) / (BAYESIAN_C + reviewCount);
    const googleFood = Math.max(0, Math.min(10, (bayesianRating - 3.5) / 1.5 * 10));
    score = signals > 0 ? (score * signals + googleFood) / (signals + 1) : googleFood;
    signals += 1;
    details.google = { score: Math.round(googleFood * 10) / 10, max: 10, signal: `Google ${googleData.google_rating} ★ (Bayesian)` };
    if (confidence === "low") confidence = "medium";
  }

  // Deep profile enrichment signals (minor adjustments)
  if (dp?.cultural_authenticity != null && dp.cultural_authenticity >= 8) {
    score += 0.5;
    details.authenticity = { score: 0.5, max: 0.5, signal: "Culturally authentic" };
  }
  if (dp?.awards_recognition?.length) {
    score += 0.3;
    details.awards = { score: 0.3, max: 0.3, signal: dp.awards_recognition[0] };
  }

  // B1: Review value score — blend for open-ended or budget-sensitive queries
  if (ri?.review_value_score != null && relevanceType === "open_ended") {
    score = (score * signals + ri.review_value_score * 0.5) / (signals + 0.5);
    signals += 0.5;
    details.value = { score: ri.review_value_score, max: 10, signal: "Review value score" };
  }

  // B2: Spice level matching — when user wants spicy food
  if (dp?.spice_level && intent) {
    const wantsSpicy = (intent.flavor_preferences || []).some((f: string) =>
      ["spicy", "spice", "hot", "fiery"].includes(f.toLowerCase())
    ) || (intent.vibe_keywords || []).some((v: string) => v.toLowerCase().includes("spic"));
    if (wantsSpicy) {
      const spiceMap: Record<string, number> = { mild: 3, medium: 7, hot: 9, extra_hot: 10, none: 0 };
      const spiceScore = spiceMap[dp.spice_level] ?? 5;
      score += (spiceScore / 10) * 0.5;
      details.spice = { score: spiceScore, max: 10, signal: `Spice level: ${dp.spice_level}` };
    }
  }

  // B3: Flavor profile matching — match intent.flavor_preferences against dp.flavor_profiles
  if (dp?.flavor_profiles?.length && intent?.flavor_preferences?.length) {
    const intentFlavors = intent.flavor_preferences.map((f: string) => f.toLowerCase());
    const profileFlavors = dp.flavor_profiles.map((f: string) => f.toLowerCase());
    const matches = intentFlavors.filter((f: string) =>
      profileFlavors.some((p: string) => p.includes(f) || f.includes(p))
    );
    if (matches.length > 0) {
      const flavorBonus = Math.min(0.8, matches.length * 0.4);
      score += flavorBonus;
      details.flavor = { score: matches.length, max: intentFlavors.length, signal: `Flavor match: ${matches.join(", ")}` };
    }
  }

  return { score: Math.min(10, Math.max(0, score)), details, confidence };
}

// ---- Reputation Quality (0-10) — Bayesian (retained from V8) ----

function computeReputationQuality(
  candidate: V9Candidate,
  googleData: GooglePlaceData | null,
): V9QualityResult {
  const dp = candidate.deep_profile;
  const ri = candidate.review_intelligence;
  const details: Record<string, V9SubComponent> = {};
  let score = 0;
  let confidence: "high" | "medium" | "low" = "low";

  // Google rating — Bayesian average (main reputation signal)
  if (googleData?.google_rating != null) {
    const BAYESIAN_C = 30;
    const BAYESIAN_M = 4.15;
    const reviewCount = googleData.google_review_count || 0;
    const bayesianRating = (BAYESIAN_C * BAYESIAN_M + reviewCount * googleData.google_rating) / (BAYESIAN_C + reviewCount);
    const googleBase = Math.max(0, Math.min(7, (bayesianRating - 3.5) / 1.5 * 10 * 0.85));
    score = googleBase;
    details.google = { score: Math.round(googleBase * 10) / 10, max: 7, signal: `Google ${googleData.google_rating} ★ (Bayesian)` };
    confidence = "medium";
  } else {
    // Internal reputation signals when Google data is absent
    let internalRep = 3.0;
    if (dp?.awards_recognition?.length) internalRep += 1.5;
    if (dp?.chef_notable) internalRep += 1.0;
    if (dp?.cultural_authenticity != null && dp.cultural_authenticity >= 8) internalRep += 0.5;
    if (dp?.neighborhood_integration === "institution") internalRep += 0.5;
    else if (dp?.neighborhood_integration === "destination") internalRep += 0.3;
    if (candidate.trending_score != null && Number(candidate.trending_score) >= 7) internalRep += 0.5;
    score = Math.min(7, internalRep);
  }

  // Review intelligence service quality (NEW in V9 — supplements single Google rating)
  if (ri?.review_service_quality != null) {
    score = (score * 2 + ri.review_service_quality) / 3;
    details.review_service = { score: Math.round(ri.review_service_quality * 10) / 10, max: 10, signal: "Review service quality" };
    confidence = "high";
  }

  // Awards and community bonus (0-1.5)
  let bonus = 0;
  if (dp?.awards_recognition?.length) {
    bonus += 0.4;
    details.awards = { score: 0.4, max: 0.4, signal: dp.awards_recognition[0] };
  }
  if (dp?.chef_notable) {
    bonus += 0.3;
    details.chef = { score: 0.3, max: 0.3, signal: "Notable chef" };
  }
  if (dp?.cultural_authenticity != null && dp.cultural_authenticity >= 8) bonus += 0.3;
  if (dp?.neighborhood_integration === "institution") bonus += 0.2;
  else if (dp?.neighborhood_integration === "destination") bonus += 0.1;
  if (candidate.trending_score != null && Number(candidate.trending_score) >= 7) {
    bonus += 0.2;
    details.trending = { score: 0.2, max: 0.2, signal: "Currently trending" };
  }

  score += Math.min(1.5, bonus);

  return { score: Math.min(10, Math.max(0, score)), details, confidence };
}

// ---- Vibe Quality (0-10) — Occasion + Atmosphere Matching ----

function computeVibeQuality(
  candidate: V9Candidate,
  occasion: string,
  intent: IntentClassificationV2 | null,
): V9QualityResult {
  const dp = candidate.deep_profile;
  const ri = candidate.review_intelligence;
  const details: Record<string, V9SubComponent> = {};
  let score = 0;
  let scorePossible = 0;
  let hasData = false;

  // Noise fit (0-3)
  const expectedNoise = OCCASION_NOISE[occasion] || ["Moderate"];
  scorePossible += 3;
  let noisePoints = 1.5;
  if (candidate.noise_level) {
    noisePoints = expectedNoise.includes(candidate.noise_level) ? 3 : 0.5;
    hasData = true;
  }
  score += noisePoints;
  details.noise = { score: Math.round(noisePoints * 10) / 10, max: 3, signal: candidate.noise_level ? `Noise: ${candidate.noise_level} (expected: ${expectedNoise.join("/")})` : "No noise data" };

  // Energy fit (0-2)
  scorePossible += 2;
  let energyPoints = 1;
  if (dp?.energy_level != null) {
    const [eMin, eMax] = OCCASION_ENERGY[occasion] || [3, 7];
    if (dp.energy_level >= eMin && dp.energy_level <= eMax) energyPoints = 2;
    else {
      const mid = (eMin + eMax) / 2;
      energyPoints = Math.max(0, 2 - Math.abs(dp.energy_level - mid) * 0.4);
    }
    hasData = true;
  }
  score += energyPoints;
  details.energy = { score: Math.round(energyPoints * 10) / 10, max: 2, signal: dp?.energy_level != null ? `Energy level ${dp.energy_level}/10` : "No energy data" };

  // Music fit (0-1.5)
  scorePossible += 1.5;
  let musicPoints = 0.75;
  if (dp?.music_vibe) {
    const fits = MUSIC_FIT[occasion] || [];
    musicPoints = fits.includes(dp.music_vibe) ? 1.5 : 0.5;
    hasData = true;
  }
  score += musicPoints;
  details.music = { score: Math.round(musicPoints * 10) / 10, max: 1.5, signal: dp?.music_vibe || "No music data" };

  // Review intelligence ambiance quality (NEW in V9)
  scorePossible += 3;
  let ambiancePoints = 1.5;
  if (ri?.review_ambiance_quality != null) {
    ambiancePoints = (ri.review_ambiance_quality / 10) * 3;
    hasData = true;
  }
  score += ambiancePoints;
  details.ambiance = { score: Math.round(ambiancePoints * 10) / 10, max: 3, signal: ri?.review_ambiance_quality != null ? `Ambiance quality ${ri.review_ambiance_quality}/10` : "No ambiance data" };

  // B4: Instagram worthiness — bonus when user seeks photogenic/instagrammable
  if (dp?.instagram_worthiness != null && intent) {
    const wantsGram = (intent.target_tags || []).some((t: string) =>
      t.toLowerCase().includes("instagram") || t.toLowerCase().includes("photogenic")
    ) || (intent.vibe_keywords || []).some((v: string) =>
      v.toLowerCase().includes("instagram") || v.toLowerCase().includes("photo")
    );
    if (wantsGram) {
      const gramBonus = (dp.instagram_worthiness / 10) * 1.5;
      score += gramBonus;
      scorePossible += 1.5;
      details.instagram = { score: Math.round(gramBonus * 10) / 10, max: 1.5, signal: `Instagram worthiness: ${dp.instagram_worthiness}/10` };
    }
  }

  // Normalize to 0-10
  const normalized = scorePossible > 0 ? (score / scorePossible) * 10 : 5;
  const confidence: "high" | "medium" | "low" = (ri?.review_ambiance_quality != null && dp?.energy_level != null) ? "high" : hasData ? "medium" : "low";
  return { score: Math.min(10, Math.max(0, normalized)), details, confidence };
}

// ---- Service Quality (0-10) — Occasion Fit + Service Style ----

function computeServiceQuality(
  candidate: V9Candidate,
  occasion: string,
  intent: IntentClassificationV2 | null,
): V9QualityResult {
  const dp = candidate.deep_profile;
  const details: Record<string, V9SubComponent> = {};
  let score = 0;

  // Occasion base score (0-6)
  const occasionBase = computeWeightedOccasionScore(candidate, occasion);
  const occasionPoints = Math.pow(Math.max(0, occasionBase) / 10, 0.85) * 6;
  score += occasionPoints;
  details.occasion = { score: Math.round(occasionPoints * 10) / 10, max: 6, signal: `Occasion score for ${occasion}` };

  // Service style fit (0-2)
  let serviceStylePoints = 1;
  if (dp?.service_style) {
    const fits = SERVICE_FIT[occasion] || [];
    if (fits.includes(dp.service_style)) serviceStylePoints = 2;
    else serviceStylePoints = 1;
    const clashes = SERVICE_CLASH[occasion] || [];
    if (clashes.includes(dp.service_style)) serviceStylePoints -= 2;
  }
  score += serviceStylePoints;
  details.service = { score: Math.max(0, Math.round(serviceStylePoints * 10) / 10), max: 2, signal: dp?.service_style || "No service style data" };

  // Social dynamics (0-2)
  let socialScore = 0;
  let socialSignal = "Social fit";
  if (dp?.kid_friendliness != null && occasion === "Family Dinner") {
    if (dp.kid_friendliness >= 7) { socialScore += 0.75; socialSignal = "Kid-friendly"; }
    else if (dp.kid_friendliness >= 5) { socialScore += 0.25; socialSignal = "Somewhat kid-friendly"; }
  }
  if (dp?.conversation_friendliness != null &&
    ["Date Night", "Business Lunch", "Special Occasion"].includes(occasion)) {
    if (dp.conversation_friendliness >= 7) { socialScore += 0.5; socialSignal = "Great for conversation"; }
  }
  const clampedSocial = Math.min(2, Math.max(0, socialScore));
  score += clampedSocial;
  details.social = { score: Math.round(clampedSocial * 10) / 10, max: 2, signal: socialSignal };

  // B6: Crowd profile matching — bonus when crowd matches occasion
  const CROWD_OCCASION_FIT: Record<string, string[]> = {
    "Group Hangout": ["young_professionals", "college_crowd", "diverse"],
    "Date Night": ["couples", "young_professionals"],
    "Family Dinner": ["families", "mixed_ages"],
    "Business Lunch": ["business_professional", "young_professionals"],
  };
  if (dp?.crowd_profile?.length) {
    const expectedCrowds = CROWD_OCCASION_FIT[occasion] || [];
    if (expectedCrowds.length > 0) {
      const crowdMatch = dp.crowd_profile.some((c: string) => expectedCrowds.includes(c));
      if (crowdMatch) {
        score += 0.5;
        details.crowd = { score: 0.5, max: 0.5, signal: `Crowd: ${dp.crowd_profile.join(", ")}` };
      }
    }
  }

  // Occasion "Any" with no data → neutral
  if (occasion === "Any" && occasionBase === 0) {
    return { score: 5, details, confidence: "low" };
  }

  const confidence: "high" | "medium" | "low" = (dp?.service_style && dp?.kid_friendliness != null) ? "high" : dp?.service_style ? "medium" : "low";
  return { score: Math.min(10, Math.max(0, score)), details, confidence };
}

function computeWeightedOccasionScore(profile: RestaurantProfile, occasion: string): number {
  if (occasion === "Any") {
    const total =
      (profile.date_friendly_score || 0) + (profile.group_friendly_score || 0) +
      (profile.family_friendly_score || 0) + (profile.romantic_rating || 0) +
      (profile.business_lunch_score || 0) + (profile.solo_dining_score || 0) +
      (profile.hole_in_wall_factor || 0);
    return (total / 70) * 10;
  }
  const weights = OCCASION_WEIGHTS[occasion];
  if (!weights) return (profile.date_friendly_score || 0);
  let score = 0;
  for (const [field, weight] of Object.entries(weights)) {
    score += ((profile[field as keyof RestaurantProfile] as number) ?? 0) * weight;
  }
  return score;
}

// ---- Convenience Quality (0-10) — Timing + Accessibility ----

function computeConvenienceQuality(
  candidate: V9Candidate,
  intent: IntentClassificationV2 | null,
  clientTimeOfDay?: string | null,
  specialRequest?: string,
  priceLevel?: string,
): V9QualityResult {
  const dp = candidate.deep_profile;
  const requestLower = (specialRequest || "").toLowerCase();
  const details: Record<string, V9SubComponent> = {};
  let score = 5; // neutral start
  let hasData = false;

  // Timing fit
  let timingAdj = 0;
  if (clientTimeOfDay && candidate.best_times?.length) {
    if (candidate.best_times.includes(clientTimeOfDay)) { timingAdj = 2; }
    else if (candidate.best_times.length <= 2) { timingAdj = -1.5; }
    else { timingAdj = -0.5; }
    hasData = true;
  }
  score += timingAdj;
  details.timing = { score: Math.max(0, 2 + timingAdj), max: 4, signal: clientTimeOfDay ? `Best at ${clientTimeOfDay}` : "No timing data" };

  // Reservation accessibility
  let reservationAdj = 0;
  if (dp?.reservation_difficulty) {
    const isSpontaneous = intent?.spontaneity === "spontaneous"
      || /tonight|right now|last minute|walk.?in|spontaneous/.test(requestLower);
    if (dp.reservation_difficulty === "hard_to_get" && isSpontaneous) reservationAdj = -2;
    else if (dp.reservation_difficulty === "walk_in_friendly") reservationAdj = isSpontaneous ? 1.5 : 0.5;
    hasData = true;
  }
  score += reservationAdj;
  details.reservation = { score: Math.max(0, 1.5 + reservationAdj), max: 3.5, signal: dp?.reservation_difficulty || "No reservation data" };

  // Wait time
  let waitAdj = 0;
  if (dp?.typical_wait_minutes != null) {
    if (dp.typical_wait_minutes > 60) waitAdj = -1.0;
    else if (dp.typical_wait_minutes > 30) waitAdj = -0.5;
    else waitAdj = 0.5;
    hasData = true;
    details.wait = { score: Math.max(0, 0.5 + waitAdj), max: 1.5, signal: `~${dp.typical_wait_minutes} min wait` };
  }
  score += waitAdj;

  // Parking
  let parkingAdj = 0;
  if (candidate.parking_availability && !/none|no /i.test(candidate.parking_availability)) {
    parkingAdj = 0.5;
    hasData = true;
    details.parking = { score: 0.5, max: 0.5, signal: candidate.parking_availability };
  }
  score += parkingAdj;

  // B7: Budget precision — check_average_per_person against price level
  if (dp?.check_average_per_person != null && priceLevel && priceLevel !== "Any") {
    const PRICE_LEVEL_RANGES: Record<string, [number, number]> = {
      "$": [0, 20], "$$": [20, 45], "$$$": [45, 80], "$$$$": [80, 999],
    };
    const range = PRICE_LEVEL_RANGES[priceLevel];
    if (range) {
      const [lo, hi] = range;
      const avg = dp.check_average_per_person;
      if (avg >= lo && avg <= hi) {
        score += 0.5;
        details.budget = { score: 1, max: 1, signal: `~$${avg}/person (within budget)` };
      } else if (avg > hi * 1.3) {
        score -= 1.0;
        details.budget = { score: 0, max: 1, signal: `~$${avg}/person (above budget)` };
      }
      hasData = true;
    }
  }

  const confidence: "high" | "medium" | "low" = (clientTimeOfDay && dp?.reservation_difficulty) ? "high" : hasData ? "medium" : "low";
  return { score: Math.min(10, Math.max(0, score)), details, confidence };
}

// ==========================================
// OCCASION BONUS (±5 tiebreaker)
// ==========================================

function computeOccasionBonus(
  candidate: V9Candidate,
  occasion: string,
  _intent: IntentClassificationV2 | null,
): number {
  if (occasion === "Any") return 0;

  const dp = candidate.deep_profile;

  // Service style clash: -5
  const clashes = SERVICE_CLASH[occasion] || [];
  if (dp?.service_style && clashes.includes(dp.service_style)) return -5;

  // Noise mismatch: -2
  const expectedNoise = OCCASION_NOISE[occasion] || [];
  if (candidate.noise_level && !expectedNoise.includes(candidate.noise_level)) return -2;

  // Good occasion fit: +3 to +5
  const occasionScore = computeWeightedOccasionScore(candidate, occasion);
  if (occasionScore >= 8) return +5;
  if (occasionScore >= 6) return +3;

  return 0;
}

// ==========================================
// MATCH NARRATIVE
// ==========================================

function generateV9MatchNarrative(
  relevance: V9Relevance,
  quality: number,
  weights: V9QualityWeights,
  intent: IntentClassificationV2 | null,
  candidate: V9Candidate,
): MatchNarrative {
  // Determine strongest quality factor
  const factorContributions = [
    { factor: "food", weight: weights.food },
    { factor: "reputation", weight: weights.reputation },
    { factor: "vibe", weight: weights.vibe },
    { factor: "service", weight: weights.service },
    { factor: "convenience", weight: weights.convenience },
  ];
  factorContributions.sort((a, b) => b.weight - a.weight);
  const strongestFactor = factorContributions[0].factor;

  const FACTOR_LABELS: Record<string, Record<string, string>> = {
    food: { high: "Outstanding Cuisine Match", medium: "Good Food Fit", low: "Decent Menu" },
    vibe: { high: "Perfect Atmosphere", medium: "Good Vibe Match", low: "Adequate Setting" },
    service: { high: "Excellent Service Fit", medium: "Good Service Match", low: "Standard Service" },
    reputation: { high: "Highly Regarded", medium: "Well Reviewed", low: "Decent Reputation" },
    convenience: { high: "Very Convenient", medium: "Reasonably Convenient", low: "Some Tradeoffs" },
  };

  const tier = quality >= 70 ? "high" : quality >= 50 ? "medium" : "low";
  const strongestLabel = FACTOR_LABELS[strongestFactor]?.[tier] || "Strong Match";

  // Build key signals
  const keySignals: string[] = [];

  // Relevance-based signals
  if (relevance.type === "dish" && intent?.dish_level_intent) {
    const ri = candidate.review_intelligence;
    if (ri?.popular_dishes?.some(d => d.toLowerCase().includes(intent.dish_level_intent!.toLowerCase()))) {
      keySignals.push(`${intent.dish_level_intent} is a popular menu item`);
    } else if (ri?.dish_catalog?.some(d => d.toLowerCase().includes(intent.dish_level_intent!.toLowerCase()))) {
      keySignals.push(`${intent.dish_level_intent} confirmed by reviews`);
    } else {
      keySignals.push(`Matches ${intent.dish_level_intent}`);
    }
  }
  if (relevance.type === "cuisine" && intent?.target_cuisines?.length) {
    keySignals.push(`Matches ${intent.target_cuisines[0]} cuisine`);
  }
  if (relevance.score >= 0.90) {
    keySignals.push("Strong relevance match");
  }

  // Quality signals
  const dp = candidate.deep_profile;
  if (dp?.awards_recognition?.length) {
    keySignals.push(dp.awards_recognition[0]);
  }
  if (dp?.cultural_authenticity != null && dp.cultural_authenticity >= 8) {
    keySignals.push("Culturally authentic");
  }

  const trimmedSignals = keySignals.slice(0, 3);

  let summary = strongestLabel;
  if (trimmedSignals.length > 0) summary += ` \u2014 ${trimmedSignals[0].toLowerCase()}`;

  const weakSpots: string[] = [];
  if (quality < 40) weakSpots.push("Below average quality");
  if (relevance.score < 0.5 && relevance.type !== "open_ended") weakSpots.push("Partial relevance match");

  let confidenceCaveat: string | null = null;
  if (!dp || (dp.enrichment_confidence ?? 0) < 0.3) {
    confidenceCaveat = "Limited data available \u2014 score may update with more information";
  }

  return {
    strongest_factor: strongestFactor,
    strongest_factor_label: strongestLabel,
    key_signals: trimmedSignals,
    comparison_context: null,
    summary,
    weak_spots: weakSpots,
    confidence_caveat: confidenceCaveat,
  };
}

// ==========================================
// V9 DONDE MATCH (full pipeline)
// ==========================================

/**
 * Compute the V9 Donde Match score for a single candidate.
 *
 * Pipeline:
 * 1. Compute Relevance (the GATE) — uses review intelligence + structured data
 * 2. Compute Quality (the RANK) — query-type-aware weighted mean
 * 3. Score = Relevance × Quality
 * 4. Occasion adjustment (±5 tiebreaker)
 * 5. Generate match narrative
 */
export function computeV9Score(
  candidate: V9Candidate,
  context: V9ScoringContext,
): V9ScoreResult {

  // Step 1: Compute Relevance (the GATE)
  const relevance = computeRelevance(candidate, context.intent, context.specialRequest);

  // Step 2: Compute Quality (the RANK)
  const { quality, weights, factors, factorDetails, factorConfidence } = computeQuality(candidate, relevance.type, context);

  // Step 3: V9 Score = Relevance × Quality
  const v9Score = Math.round(relevance.score * quality);

  // Step 4: Occasion adjustment (±5 max, tiebreaker only)
  const occasionBonus = computeOccasionBonus(candidate, context.occasion, context.intent);
  const finalScore = Math.min(99, Math.max(0, v9Score + occasionBonus));

  // Step 5: Data completeness
  const dp = candidate.deep_profile;
  const hasRI = candidate.review_intelligence != null;
  const hasDP = dp != null;
  const dataCompleteness = (hasRI ? 0.4 : 0) + (hasDP ? 0.4 : 0) + (dp?.enrichment_confidence ?? 0) * 0.2;

  // Step 6: Generate match narrative
  const matchNarrative = generateV9MatchNarrative(
    relevance, quality, weights, context.intent, candidate,
  );

  return {
    dondeMatch: finalScore,
    relevance,
    quality,
    factors,
    qualityWeights: weights,
    occasionBonus,
    matchNarrative,
    dataCompleteness,
    factorDetails,
    factorConfidence,
  };
}

// ==========================================
// V9 RE-RANK
// ==========================================

/**
 * Score and rank a list of V9 candidates.
 * Returns sorted array with comparison context in narratives.
 */
export function reRankV9(
  candidates: V9Candidate[],
  context: V9ScoringContext,
): V9ScoredCandidate[] {
  const scored = candidates.map(candidate => {
    const result = computeV9Score(candidate, context);
    return {
      profile: candidate as RestaurantProfile,
      dondeMatch: result.dondeMatch,
      relevance: result.relevance,
      quality: result.quality,
      factors: result.factors,
      qualityWeights: result.qualityWeights,
      occasionBonus: result.occasionBonus,
      matchNarrative: result.matchNarrative,
      dataCompleteness: result.dataCompleteness,
      factorDetails: result.factorDetails,
      factorConfidence: result.factorConfidence,
      reviewIntelligence: candidate.review_intelligence,
    };
  });

  // Sort by DondeMatch — relevance is already factored in
  scored.sort((a, b) => b.dondeMatch - a.dondeMatch);

  // Add comparison context to narratives
  if (scored.length >= 2) {
    const topScore = scored[0].dondeMatch;
    for (let i = 0; i < scored.length; i++) {
      const gap = topScore - scored[i].dondeMatch;
      if (i === 0 && scored.length > 1) {
        scored[i].matchNarrative.comparison_context =
          `${topScore - scored[1].dondeMatch} points ahead of next option`;
      } else if (gap > 0) {
        scored[i].matchNarrative.comparison_context =
          `${gap} points behind top pick`;
      }
    }
  }

  return scored;
}
