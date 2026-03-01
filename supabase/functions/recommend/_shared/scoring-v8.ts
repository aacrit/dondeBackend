/**
 * Donde Match V8 — Unified Scoring Engine (Ground-Up Rewrite)
 *
 * Single file replaces scoring-v3.ts (1786 lines), scoring-v7.ts (801 lines),
 * and weight-config-v5.ts (428 lines) = 3,014 lines → ~500 lines.
 *
 * V8.5 Architecture:
 *   DondeScore = (BaseQuality - CoherencePenalty) × IntentMultiplier
 *   BaseQuality = WeightedArithmeticMean(factors) × 10  → 0-100
 *   CoherencePenalty = max(0, (|vibe - service| - 4) × 0.6)
 *   IntentMultiplier = floor + range × intentAlignment
 *     high confidence:  [0.80, 1.05]  ← V8.5: softened from 0.78
 *     medium confidence: [0.84, 1.05] ← V8.5: softened from 0.82
 *     low confidence:   [0.90, 1.05]  ← V8.5: softened from 0.88
 *     no signals: 1.0
 *   IntentAlignment composite floor: 0.30  ← V8.5 O18: raised 0.20→0.30
 *   IntentAlignment vibe floor: 0.20       ← V8.4: Laplace smoothing
 *   IntentAlignment constraint floor: 0.25 ← V8.4: Laplace smoothing
 *   Food weight shift: guarded by actual cuisine/dish signals ← V8.5
 *   Food weight delta: +0.05 (reduced from +0.12)             ← V8.5
 *
 * V8.5 optimizations:
 * - Guarded food weight inflation — "High cuisine priority" only fires with actual
 *   cuisine/dish signals, preventing food weight spike for experience queries
 * - Reduced food weight delta +0.12→+0.08 — less aggressive food dominance
 * - IA composite floor of 0.20 — prevents extreme IM penalties for ambiguous queries
 * - Softened IM floors (+0.02 each level) — gentler penalty across all confidence levels
 * - IA composite floor raised to 0.25 (O18) — from 0.20, further reduces IM penalty
 *
 * V8.4 optimizations:
 * - Laplace-smoothed intent alignment — vibe/constraint floors prevent zero-IA collapse
 * - Relaxed coherence penalty — threshold 3→4, coefficient 0.8→0.6 (42% of cases hit old threshold)
 *
 * V8.3 optimizations:
 * - Confidence-weighted intent multiplier — reduces penalty for vague/short queries
 * - Vibe-service alignment penalty — cross-factor coherence check
 *
 * V8.2 optimizations (algorithm-inspired):
 * - Per-factor Bayesian priors (replaces universal 5.5) — Bayesian Statistics
 * - Bayesian average for Google ratings — IMDB/Yelp Weighted Rating
 * - 6-level cuisine alignment with family adjacency — Wu-Palmer WordNet Similarity
 * - Asymmetric intent multiplier [0.78, 1.05] — BM25 query-relative scoring
 * - Strengthened vibe coverage discount — Netflix score normalization
 * - Raised reputation award ceiling (1.0→1.5) — TrustRank
 *
 * V8.1 changes:
 * - Expanded CUISINE_FAMILIES (Caribbean, African, European, American)
 * - Confidence 0.6+0.4 (from 0.5+0.5), null cuisine cap 4→6
 * - Intent multiplier 0.75+0.25 (from 0.70+0.30)
 *
 * Key changes from V7:
 * - Arithmetic mean replaces geometric mean (no single-factor collapse)
 * - Intent alignment is IN the score, not a tiebreaker
 * - 12 consolidated weight-shift rules (down from 28)
 * - Per-factor confidence function with Bayesian priors
 * - Self-contained: no imports from scoring-v3.ts or weight-config-v5.ts
 */

import type { RestaurantProfile } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { IntentClassificationV2 } from "./intent-classifier.ts";
import type { V7MatchNarrative, V7SubComponent } from "./types-v7.ts";
import type {
  V8Factors,
  V8Weights,
  V8SubComponent,
  V8IntentAlignment,
  V8DondeMatchInputs,
  V8DondeMatchResult,
  V8WeightShiftRule,
  V8ScoredCandidate,
} from "./types-v8.ts";
import {
  OCCASION_WEIGHTS,
  DIETARY_KEYWORDS,
} from "./scoring.ts";

// ==========================================
// CONSTANTS
// ==========================================

const FACTOR_FLOOR = 1.0;

// Per-factor Bayesian priors based on observed population means.
// Inspiration: Bayesian Statistics — rather than regressing all factors toward a
// universal 5.5 neutral, each factor regresses toward its empirically observed mean.
// This prevents inflating food (population mean ~4.5) and deflating vibe (mean ~9.0).
const FACTOR_PRIORS: Record<string, number> = {
  food: 4.0,        // Unknown food match should be penalized — user asked for something specific
  vibe: 7.0,        // Most restaurants provide adequate atmosphere; 7.0 = "probably fine"
  service: 5.5,     // Service is genuinely uncertain without occasion/deep profile data
  reputation: 6.0,  // Donde's curated pool has survivorship bias — avg Google rating ~4.2★
  convenience: 6.5, // Most restaurants are reasonably convenient for walk-in diners
};

// Cuisine family relationships for partial matches
const CUISINE_FAMILIES: Record<string, string[]> = {
  Mediterranean: ["Greek", "Italian", "Middle Eastern"],
  "East Asian": ["Japanese", "Chinese", "Korean", "Taiwanese"],
  "Southeast Asian": ["Thai", "Vietnamese"],
  "Latin American": ["Mexican", "Peruvian", "Brazilian", "Puerto Rican"],
  Caribbean: ["Cuban", "Jamaican", "Trinidadian"],
  "South Asian": ["Indian"],
  African: ["Ethiopian", "Nigerian", "Moroccan"],
  European: ["Polish", "German", "French", "British"],
  American: ["BBQ", "Southern", "Southern/Soul Food", "Cajun", "Creole"],
};

// Cross-family adjacency for 6-level cuisine alignment.
// Inspiration: Wu-Palmer Similarity from WordNet taxonomy — cuisines sharing
// a grandparent node (adjacent families) get partial credit, not just same-family.
const FAMILY_ADJACENCY: Record<string, string[]> = {
  Mediterranean: ["European", "African"],
  "East Asian": ["Southeast Asian"],
  "Southeast Asian": ["East Asian", "South Asian"],
  "Latin American": ["Caribbean"],
  Caribbean: ["Latin American", "African"],
  "South Asian": ["Southeast Asian", "Mediterranean"],
  African: ["Mediterranean", "Caribbean"],
  European: ["Mediterranean"],
  American: ["European"],
};
const CUISINE_TO_FAMILY: Record<string, string> = {};
for (const [family, cuisines] of Object.entries(CUISINE_FAMILIES)) {
  for (const c of cuisines) CUISINE_TO_FAMILY[c] = family;
}

// Occasion-based expectations
const OCCASION_NOISE: Record<string, string[]> = {
  "Date Night": ["Quiet", "Moderate"], "Group Hangout": ["Moderate", "Loud"],
  "Family Dinner": ["Quiet", "Moderate"], "Business Lunch": ["Quiet"],
  "Solo Dining": ["Quiet", "Moderate"], "Special Occasion": ["Quiet"],
  "Treat Myself": ["Quiet", "Moderate"], Adventure: ["Moderate", "Loud", "Quiet"],
  "Chill Hangout": ["Moderate", "Quiet"], Any: ["Quiet", "Moderate"],
};
const OCCASION_LIGHTING: Record<string, string[]> = {
  "Date Night": ["dim", "intimate", "warm", "candlelit", "romantic"],
  "Group Hangout": ["bright", "lively", "modern", "warm", "vibrant"],
  "Family Dinner": ["bright", "warm", "modern", "welcoming"],
  "Business Lunch": ["bright", "modern", "warm", "elegant"],
  "Solo Dining": ["warm", "cozy", "bright", "relaxed"],
  "Special Occasion": ["dim", "intimate", "elegant", "warm", "candlelit"],
  "Treat Myself": ["warm", "cozy", "intimate", "elegant"],
  Adventure: [], "Chill Hangout": ["warm", "cozy", "dim", "relaxed"], Any: [],
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
const SERVICE_CLASH: Record<string, string[]> = {
  "Special Occasion": ["Fast Casual", "Counter"],
  "Date Night": ["Fast Casual"],
  "Business Lunch": ["Counter", "Fast Casual"],
  "Group Hangout": ["Omakase"],
};
const DRESS_LEVELS: Record<string, number> = {
  Casual: 1, "Smart Casual": 2, "Business Casual": 3, Formal: 4,
};
const OCCASION_DRESS_MIN: Record<string, string> = {
  "Date Night": "Smart Casual", "Business Lunch": "Business Casual",
  "Special Occasion": "Smart Casual", "Group Hangout": "Casual",
  "Family Dinner": "Casual", "Solo Dining": "Casual", "Treat Myself": "Casual",
  Adventure: "Casual", "Chill Hangout": "Casual", Any: "Casual",
};
const PACING_FIT: Record<string, string[]> = {
  "Business Lunch": ["quick_bite", "relaxed"], "Date Night": ["relaxed", "leisurely"],
  "Group Hangout": ["relaxed", "leisurely"], "Solo Dining": ["quick_bite", "relaxed"],
  "Special Occasion": ["leisurely", "ceremonial"],
  "Treat Myself": ["relaxed", "leisurely", "ceremonial"],
  Adventure: ["quick_bite", "relaxed", "ceremonial"], "Family Dinner": ["relaxed"],
  "Chill Hangout": ["relaxed", "leisurely"],
};

// Vibe keyword mappings for atmosphere matching
const VIBE_NOISE: Record<string, string[]> = {
  cozy: ["Quiet"], intimate: ["Quiet"], chill: ["Quiet", "Moderate"],
  lively: ["Moderate", "Loud"], buzzing: ["Loud"], refined: ["Quiet", "Moderate"],
  elegant: ["Quiet", "Moderate"], warm: ["Moderate"], casual: ["Moderate"],
};
const VIBE_LIGHTING: Record<string, string[]> = {
  cozy: ["dim", "warm", "intimate"], intimate: ["dim", "intimate", "candlelit"],
  elegant: ["warm", "candlelit", "romantic"], refined: ["warm", "dim"],
  lively: ["bright", "warm"], casual: ["bright", "natural"],
  chill: ["dim", "warm"], warm: ["warm", "intimate"],
};
const VIBE_ENERGY: Record<string, [number, number]> = {
  intimate: [2, 5], lively: [6, 9], cozy: [2, 5], elegant: [3, 6],
  casual: [3, 7], buzzing: [7, 10], chill: [2, 5], refined: [3, 6],
  warm: [3, 6], modern: [4, 8], funky: [6, 9],
};

// Bar/nightlife vibe tag mappings
const VIBE_TAG_MAP: Record<string, string[]> = {
  speakeasy: ["cocktails", "hidden gem", "craft cocktails", "speakeasy"],
  jazz: ["live music", "jazz"], blues: ["live music", "blues"],
  "sports bar": ["lively", "sports"], karaoke: ["lively", "karaoke"],
  tiki: ["cocktails", "tiki", "craft cocktails"],
  "dive bar": ["dive", "hidden gem", "great value"],
  "piano bar": ["live music", "piano", "romantic"],
  nightlife: ["lively", "cocktails", "late night", "craft cocktails"],
  "wine cellar": ["romantic", "wine", "quiet"],
  hipster: ["hidden gem", "trendy"],
  "rooftop bar": ["rooftop", "scenic", "cocktails"],
};

// Flavor extraction from special_request
const FLAVOR_KEYWORDS: Record<string, string[]> = {
  smoky: ["smoky", "charred", "grilled", "wood-fired"],
  spicy: ["bold-spiced", "chili-forward", "fiery"],
  fresh: ["bright-acidic", "herbaceous", "citrus-forward", "light"],
  rich: ["umami-forward", "rich-buttery", "creamy", "decadent"],
  sweet: ["sweet-savory", "caramelized", "honey-glazed"],
  tangy: ["fermented", "pickled", "vinegar-bright", "bright-acidic"],
  earthy: ["earthy", "mushroom", "truffle", "root-vegetable"],
  savory: ["umami-forward", "savory", "meaty"],
};

// ==========================================
// V8 BASE WEIGHTS
// ==========================================

const V8_BASE_WEIGHTS: V8Weights = {
  food: 0.28,
  vibe: 0.18,
  service: 0.12,
  reputation: 0.22,
  convenience: 0.20,
};

// ==========================================
// V8 WEIGHT SHIFT RULES (12 consolidated)
// ==========================================

const V8_RULES: V8WeightShiftRule[] = [
  // 1. Date/Special/Anniversary
  {
    condition: { occasion: ["Date Night", "Special Occasion"] },
    deltas: { vibe: +0.10, service: +0.04, convenience: -0.10, reputation: -0.04 },
    label: "Date/special: vibe + service up",
  },
  // 2. Business
  {
    condition: { occasion: ["Business Lunch"] },
    deltas: { service: +0.10, vibe: +0.04, food: -0.06, convenience: -0.04, reputation: -0.04 },
    label: "Business: service + vibe up",
  },
  // 3. Family
  {
    condition: { occasion: ["Family Dinner"] },
    deltas: { service: +0.05, convenience: +0.10, vibe: -0.10, reputation: -0.05 },
    label: "Family: convenience up, vibe down",
  },
  // 4. Solo/Chill
  {
    condition: { occasion: ["Solo Dining", "Chill Hangout"] },
    deltas: { convenience: +0.10, food: +0.04, service: -0.08, vibe: -0.06 },
    label: "Solo/chill: convenience + food up",
  },
  // 5. Group/Large Group
  {
    condition: { occasion: ["Group Hangout"] },
    deltas: { service: +0.08, convenience: +0.06, food: -0.06, reputation: -0.08 },
    label: "Group: service + convenience up",
  },
  // 6. Adventure/Treat
  {
    condition: { occasion: ["Adventure", "Treat Myself"] },
    deltas: { food: +0.06, reputation: +0.04, convenience: -0.10 },
    label: "Adventure/treat: food + reputation up",
  },
  // 7. Cuisine importance: high (+ dish-level)
  // V8.5: Delta reduced from +0.12 to +0.05 — less aggressive food dominance.
  // The matchesV8Condition guard (O15) ensures this only fires when actual
  // cuisine/dish signals are present, not just because the classifier defaults
  // to "high" importance for ambiguous queries.
  // V8.5 iterations: +0.12 → +0.08 → +0.05 (progressive reduction after
  // 200-case testing showed food weight inflation still causing DM drag)
  {
    condition: { cuisineImportance: "high" },
    deltas: { food: +0.05, reputation: -0.01, vibe: -0.02, service: -0.02 },
    label: "High cuisine priority: food dominates",
  },
  // 8. Cuisine importance: low
  {
    condition: { cuisineImportance: "low" },
    deltas: { vibe: +0.06, service: +0.04, food: -0.10 },
    label: "Low cuisine priority: vibe + service up",
  },
  // 9. Emotional: impress/celebrate
  {
    condition: { emotionalIntent: ["impress", "celebrate"] },
    deltas: { reputation: +0.08, vibe: +0.06, convenience: -0.08, food: -0.06 },
    label: "Impress/celebrate: reputation + vibe up",
  },
  // 10. Emotional: comfort/indulge
  {
    condition: { emotionalIntent: ["comfort", "indulge"] },
    deltas: { food: +0.08, vibe: +0.06, reputation: -0.08, service: -0.06 },
    label: "Comfort/indulge: food + vibe up",
  },
  // 11. Spontaneous
  {
    condition: { spontaneous: true },
    deltas: { convenience: +0.12, service: -0.06, vibe: -0.06 },
    label: "Spontaneous: convenience dominates",
  },
  // 12. Vibe-specific query (rooftop/outdoor/bar)
  {
    condition: { vibeKeywords: ["rooftop", "outdoor", "terrace", "patio", "view", "al fresco"] },
    deltas: { vibe: +0.12, food: -0.06, convenience: -0.06 },
    label: "Outdoor/vibe query: vibe elevated",
  },
  // 13. Reputation-priority query (awards, ratings, best-of)
  // Addresses systematic disadvantage for reputation-heavy queries (avg DM 51 vs 56 overall).
  // Inspiration: TrustRank — queries about quality/prestige should weight reputation signal.
  {
    condition: { vibeKeywords: ["michelin", "james beard", "award", "best rated", "top rated", "highly rated", "best reviewed", "award-winning", "critically acclaimed"] },
    deltas: { reputation: +0.12, food: -0.04, convenience: -0.04, vibe: -0.04 },
    label: "Reputation query: reputation dominates",
  },
];

// ==========================================
// CONFIDENCE FUNCTION
// ==========================================

/**
 * Per-factor confidence function: regress toward factor-specific prior based on data.
 *
 * Inspiration: Bayesian posterior estimation — the prior encodes our belief about
 * a typical restaurant on each dimension. As data arrives (higher ratio), we trust
 * the observed score more. The sigmoid-shaped confidence curve gives diminishing
 * returns from additional data points, matching information-theoretic expectations.
 *
 * V8.2 changes:
 * - Factor-specific priors replace universal 5.5 (fixes vibe deflation + food inflation)
 * - Confidence range [0.6, 1.0] maintained for backward compatibility
 */
function applyConfidence(raw: number, dataPoints: number, maxDataPoints: number, factor?: string): number {
  const ratio = maxDataPoints > 0 ? dataPoints / maxDataPoints : 0;
  const confidence = 0.6 + 0.4 * ratio;
  const prior = (factor && FACTOR_PRIORS[factor]) ?? 5.5;
  return raw * confidence + prior * (1 - confidence);
}

// ==========================================
// HELPERS
// ==========================================

function getCuisineFamily(cuisine: string): string | null {
  let family = CUISINE_TO_FAMILY[cuisine];
  if (!family) {
    const cl = cuisine.toLowerCase();
    const match = Object.entries(CUISINE_TO_FAMILY).find(
      ([key]) => cl.includes(key.toLowerCase())
    );
    if (match) family = match[1];
  }
  return family || null;
}

function isRelatedCuisine(cuisine: string, targets: string[]): boolean {
  const family = getCuisineFamily(cuisine);
  if (!family) return false;
  return targets.some(t => {
    if (t.toLowerCase() === family!.toLowerCase()) return true;
    const targetFamily = getCuisineFamily(t);
    return targetFamily === family;
  });
}

// 6-level cuisine relationship: same-family vs adjacent-family.
// Inspiration: Wu-Palmer Similarity from WordNet — depth-based taxonomy distance.
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

function extractFlavorIntent(specialRequest: string): string[] {
  const lower = specialRequest.toLowerCase();
  const matches: string[] = [];
  for (const [keyword, flavors] of Object.entries(FLAVOR_KEYWORDS)) {
    if (lower.includes(keyword)) matches.push(...flavors);
  }
  return [...new Set(matches)];
}

function tagToString(t: unknown): string {
  if (typeof t === "string") return t;
  if (t && typeof t === "object" && "name" in t) return (t as { name: string }).name || "";
  if (t && typeof t === "object" && "tag_text" in t) return (t as { tag_text: string }).tag_text || "";
  return "";
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

// ==========================================
// FACTOR 1: FOOD (0-10)
// ==========================================

function computeFood(
  profile: RestaurantProfile,
  intent: IntentClassificationV2 | null,
  dietaryRestrictions?: string[],
  specialRequest?: string,
): { score: number; dataPoints: number; maxDataPoints: number; details: Record<string, V8SubComponent> } {
  const dp = profile.deep_profile;
  const requestLower = (specialRequest || "").toLowerCase();
  const targetCuisines = intent?.target_cuisines || [];
  const isDishLevel = intent?.dish_level_intent != null;
  let dataPoints = 0;
  let maxDataPoints = 0;
  const details: Record<string, V8SubComponent> = {};

  // Signal 1: Cuisine match (0-4)
  const cuisineMax = 4;
  maxDataPoints++;
  let cuisineScore = 0;
  let cuisineSignal = "";
  if (targetCuisines.length > 0) {
    dataPoints++;
    if (profile.cuisine_type) {
      const cl = profile.cuisine_type.toLowerCase();
      const exact = targetCuisines.some(c => c.toLowerCase() === cl);
      const contains = !exact && targetCuisines.some(c =>
        cl.includes(c.toLowerCase()) || c.toLowerCase().includes(cl)
      );
      if (exact) { cuisineScore = 4; cuisineSignal = `Exact: ${profile.cuisine_type}`; }
      else if (contains) { cuisineScore = 3; cuisineSignal = `Close: ${profile.cuisine_type}`; }
      else if (dp?.cuisine_subcategory) {
        const subLower = dp.cuisine_subcategory.toLowerCase();
        if (targetCuisines.some(c => subLower.includes(c.toLowerCase()))) {
          cuisineScore = 2.5; cuisineSignal = `Sub-match: ${dp.cuisine_subcategory}`;
        } else if (isRelatedCuisine(profile.cuisine_type, targetCuisines)) {
          cuisineScore = 1.5; cuisineSignal = `Related: ${profile.cuisine_type}`;
        } else if (isAdjacentCuisine(profile.cuisine_type, targetCuisines)) {
          cuisineScore = 0.8; cuisineSignal = `Adjacent family: ${profile.cuisine_type}`;
        } else {
          cuisineScore = 0; cuisineSignal = `No match: ${profile.cuisine_type}`;
        }
      } else if (isRelatedCuisine(profile.cuisine_type, targetCuisines)) {
        cuisineScore = 1.5; cuisineSignal = `Related: ${profile.cuisine_type}`;
      } else if (isAdjacentCuisine(profile.cuisine_type, targetCuisines)) {
        cuisineScore = 0.8; cuisineSignal = `Adjacent family: ${profile.cuisine_type}`;
      } else {
        cuisineScore = 0; cuisineSignal = `No match: ${profile.cuisine_type}`;
      }
    } else {
      cuisineSignal = "No cuisine listed";
    }
  } else {
    cuisineScore = 2; cuisineSignal = "No cuisine filter";
  }
  details.cuisine = { score: cuisineScore, max: cuisineMax, signal: cuisineSignal };

  // Signal 2: Dish match (0-3, elevated for dish-level queries)
  const dishMax = isDishLevel ? 3 : 1;
  maxDataPoints++;
  let dishScore = 0;
  let dishSignal = "";
  if (dp?.signature_dishes?.length && requestLower.length > 2) {
    dataPoints++;
    const exactDish = dp.signature_dishes.some(d =>
      requestLower.includes(d.dish.toLowerCase()) || d.dish.toLowerCase().includes(requestLower)
    );
    if (exactDish) {
      dishScore = dishMax; dishSignal = "Exact dish match";
    } else if (isDishLevel) {
      // Bigram match
      const rWords = requestLower.split(/\s+/).filter(w => w.length > 2);
      const bigrams: string[] = [];
      for (let i = 0; i < rWords.length - 1; i++) bigrams.push(`${rWords[i]} ${rWords[i + 1]}`);
      const bigramMatch = bigrams.length > 0 && dp.signature_dishes.some(d =>
        bigrams.some(bg => d.dish.toLowerCase().includes(bg))
      );
      if (bigramMatch) { dishScore = dishMax * 0.75; dishSignal = "Dish phrase match"; }
      else {
        const wordMatch = dp.signature_dishes.some(d =>
          d.dish.toLowerCase().split(/\s+/).some(w => w.length > 3 && requestLower.includes(w))
        );
        dishScore = wordMatch ? 1 : 0;
        dishSignal = wordMatch ? "Partial word match" : "No dish match";
      }
    } else {
      const wordMatch = dp.signature_dishes.some(d =>
        d.dish.toLowerCase().split(/\s+/).some(w => w.length > 3 && requestLower.includes(w))
      );
      if (wordMatch) { dishScore = 1; dishSignal = "Dish match found"; }
      else dishSignal = "No dish match";
    }
    // Menu highlights fallback
    if (dishScore === 0 && dp?.menu_highlights?.length) {
      const hlMatch = dp.menu_highlights.some(item =>
        requestLower.includes(item.toLowerCase()) || item.toLowerCase().includes(requestLower)
      );
      if (hlMatch) { dishScore = isDishLevel ? dishMax * 0.6 : 0.5; dishSignal = "Menu highlight match"; }
    }
  } else if (profile.tags?.length > 0 && requestLower.length > 2) {
    dataPoints++;
    // Tag-based food matching
    const tagStrings = profile.tags.map(t => tagToString(t).toLowerCase());
    const foodTags = ["farm-to-table", "brunch spot", "vegan friendly", "gluten free"];
    let found = false;
    for (const ft of foodTags) {
      if (requestLower.includes(ft.split("-").join(" ")) || requestLower.includes(ft)) {
        if (tagStrings.some(ts => ts.includes(ft))) { found = true; break; }
      }
    }
    if (found) { dishScore = 0.5; dishSignal = "Tag match"; }
    else dishSignal = "No tag match";
    // Menu highlights fallback when no signature dishes
    if (dishScore === 0 && dp?.menu_highlights?.length) {
      const hlMatch = dp.menu_highlights.some(item =>
        requestLower.includes(item.toLowerCase()) || item.toLowerCase().includes(requestLower)
      );
      if (hlMatch) { dishScore = isDishLevel ? dishMax * 0.5 : 0.5; dishSignal = "Menu highlight match"; }
    }
  } else {
    dishSignal = "No menu data";
  }
  details.dish = { score: dishScore, max: dishMax, signal: dishSignal };

  // Signal 3: Dietary fit (0-2)
  maxDataPoints++;
  let dietScore = 0;
  let dietSignal = "";
  if (dietaryRestrictions?.length) {
    if (dp?.dietary_depth) {
      dataPoints++;
      if (dp.dietary_depth === "dedicated") { dietScore = 2; dietSignal = "Dedicated options"; }
      else if (dp.dietary_depth === "solid") { dietScore = 1.5; dietSignal = "Solid options"; }
      else if (dp.dietary_depth === "token") { dietScore = 0.5; dietSignal = "Limited options"; }
      else dietSignal = "Unknown depth";
    } else if (profile.dietary_options?.length) {
      dataPoints++;
      const allMatch = dietaryRestrictions.every(dr => {
        const keywords = DIETARY_KEYWORDS[dr.toLowerCase()];
        if (!keywords) return false;
        return profile.dietary_options!.some(opt => keywords.some(kw => opt.toLowerCase().includes(kw.toLowerCase())));
      });
      if (allMatch) { dietScore = 1; dietSignal = "All restrictions met"; }
      else {
        const someMatch = dietaryRestrictions.some(dr => {
          const keywords = DIETARY_KEYWORDS[dr.toLowerCase()];
          if (!keywords) return false;
          return profile.dietary_options!.some(opt => keywords.some(kw => opt.toLowerCase().includes(kw.toLowerCase())));
        });
        if (someMatch) { dietScore = 0.5; dietSignal = "Partial match"; }
        else dietSignal = "No dietary match";
      }
    } else {
      dietSignal = "No dietary data";
    }
  } else {
    dietScore = 1; dietSignal = "No restrictions"; dataPoints++;
  }
  details.dietary = { score: dietScore, max: 2, signal: dietSignal };

  // Signal 4: Flavor overlap (0-1)
  maxDataPoints++;
  let flavorScore = 0;
  let flavorSignal = "";
  const flavorPrefs = intent?.flavor_preferences || extractFlavorIntent(specialRequest || "");
  if (dp?.flavor_profiles?.length && flavorPrefs.length > 0) {
    dataPoints++;
    const overlap = flavorPrefs.filter(f =>
      dp.flavor_profiles!.some(fp => fp.toLowerCase().includes(f.toLowerCase()))
    ).length;
    flavorScore = Math.min(1, overlap * 0.5);
    flavorSignal = overlap > 0 ? `${overlap} flavor overlap` : "No flavor overlap";
  } else {
    flavorSignal = flavorPrefs.length > 0 ? "No flavor data" : "No flavor preference";
  }
  details.flavor = { score: flavorScore, max: 1, signal: flavorSignal };

  // Normalize: only active layers count in denominator
  const hasFlavorData = dp?.flavor_profiles?.length && flavorPrefs.length > 0;
  const hasMenuData = (dp?.signature_dishes?.length && requestLower.length > 2) ||
    (profile.tags?.length > 0 && requestLower.length > 2);
  const activeDenom = cuisineMax + 2 + (hasFlavorData ? 1 : 0) + (hasMenuData ? dishMax : 0);
  const effectiveDenom = Math.max(activeDenom, 6);
  const rawTotal = cuisineScore + dishScore + dietScore + flavorScore;
  let normalized = Math.min(10, (rawTotal / effectiveDenom) * 10);

  // No cuisine_type → cap at 6 when cuisine was requested (null = missing data, not wrong cuisine)
  if (!profile.cuisine_type && targetCuisines.length > 0) normalized = Math.min(6, normalized);
  // No food intent → floor at 5.0 (food is irrelevant, not unknown — above food prior of 4.0)
  if (targetCuisines.length === 0 && (!specialRequest || specialRequest.trim().length < 3)
    && (!dietaryRestrictions || dietaryRestrictions.length === 0)) {
    normalized = Math.max(normalized, 5.0);
  }

  return { score: normalized, dataPoints, maxDataPoints, details };
}

// ==========================================
// FACTOR 2: VIBE (0-10) — Atmosphere
// ==========================================

function computeVibe(
  profile: RestaurantProfile,
  occasion: string,
  intent: IntentClassificationV2 | null,
  specialRequest?: string,
): { score: number; dataPoints: number; maxDataPoints: number; details: Record<string, V8SubComponent> } {
  const dp = profile.deep_profile;
  const requestLower = (specialRequest || "").toLowerCase();
  const vibeKeywords = intent?.vibe_keywords || [];
  let dataPoints = 0;
  let maxDataPoints = 0;
  let score = 0;
  let scorePossible = 0;
  const details: Record<string, V8SubComponent> = {};

  // Merge vibe + occasion noise/lighting preferences
  const vibeNoisePrefs: string[] = [];
  const vibeLightingPrefs: string[] = [];
  for (const vk of vibeKeywords) {
    const vl = vk.toLowerCase();
    if (VIBE_NOISE[vl]) vibeNoisePrefs.push(...VIBE_NOISE[vl]);
    if (VIBE_LIGHTING[vl]) vibeLightingPrefs.push(...VIBE_LIGHTING[vl]);
  }

  // Signal 1: Noise match (0-3)
  maxDataPoints++;
  const expectedNoise = [...new Set([...(OCCASION_NOISE[occasion] || OCCASION_NOISE.Any), ...vibeNoisePrefs])];
  let noiseScore = 0;
  if (profile.noise_level) {
    dataPoints++;
    scorePossible += 3;
    noiseScore = expectedNoise.includes(profile.noise_level) ? 3 : 0.5;
    score += noiseScore;
  }
  details.noise = { score: noiseScore, max: 3, signal: profile.noise_level || "No data" };

  // Signal 2: Lighting match (0-3)
  maxDataPoints++;
  const expectedLighting = [...new Set([...(OCCASION_LIGHTING[occasion] || []), ...vibeLightingPrefs])];
  let lightingScore = 0;
  if (profile.lighting_ambiance && expectedLighting.length > 0) {
    dataPoints++;
    scorePossible += 3;
    const lLower = profile.lighting_ambiance.toLowerCase();
    const hits = expectedLighting.filter(kw => lLower.includes(kw)).length;
    lightingScore = hits > 0 ? Math.min(3, hits * 1.5) : 0;
    score += lightingScore;
  } else if (expectedLighting.length === 0) {
    // No lighting preference → neutral
    lightingScore = 1;
    scorePossible += 1;
    score += lightingScore;
  }
  details.lighting = { score: lightingScore, max: 3, signal: profile.lighting_ambiance || "No data" };

  // Signal 3: Energy fit (0-2)
  maxDataPoints++;
  let energyScore = 0;
  if (dp?.energy_level != null) {
    dataPoints++;
    scorePossible += 2;
    const [eMin, eMax] = OCCASION_ENERGY[occasion] || [3, 7];
    // Also check vibe keyword energy expectations
    let inVibeRange = false;
    for (const vk of vibeKeywords) {
      const range = VIBE_ENERGY[vk.toLowerCase()];
      if (range && dp.energy_level >= range[0] && dp.energy_level <= range[1]) {
        inVibeRange = true;
        break;
      }
    }
    if ((dp.energy_level >= eMin && dp.energy_level <= eMax) || inVibeRange) {
      energyScore = 2;
    } else {
      const mid = (eMin + eMax) / 2;
      energyScore = Math.max(0, 2 - Math.abs(dp.energy_level - mid) * 0.4);
    }
    score += energyScore;
  }
  details.energy = { score: energyScore, max: 2, signal: dp?.energy_level != null ? `Energy ${dp.energy_level}/10` : "No data" };

  // Signal 4: Music + dress combined (0-2)
  maxDataPoints++;
  let comboScore = 0;
  let comboSignal = "";
  // Music
  if (dp?.music_vibe) {
    dataPoints++;
    scorePossible += 1;
    const fits = MUSIC_FIT[occasion] || [];
    if (fits.includes(dp.music_vibe)) { comboScore += 1; comboSignal = dp.music_vibe; }
  }
  // Dress
  const expectedDressMin = OCCASION_DRESS_MIN[occasion] || "Casual";
  if (profile.dress_code) {
    scorePossible += 1;
    const rLevel = DRESS_LEVELS[profile.dress_code] || 1;
    const eLevel = DRESS_LEVELS[expectedDressMin] || 1;
    if (rLevel >= eLevel) { comboScore += 1; comboSignal += (comboSignal ? " + " : "") + profile.dress_code; }
    else { comboScore += 0.3; comboSignal += (comboSignal ? " + " : "") + profile.dress_code + " (low)"; }
  }
  if (!comboSignal) comboSignal = "No data";
  score += comboScore;
  details.style = { score: comboScore, max: 2, signal: comboSignal };

  // Bonus: Vibe keyword hits from tags/deep profile (0-1.5)
  if (vibeKeywords.length > 0 && dp) {
    let vibeHits = 0;
    for (const vibe of vibeKeywords) {
      const vl = vibe.toLowerCase();
      if (dp.decor_style?.toLowerCase().includes(vl)) { vibeHits++; continue; }
      if (dp.music_vibe?.toLowerCase().includes(vl)) { vibeHits++; continue; }
    }
    if (vibeHits > 0) {
      maxDataPoints++;
      dataPoints++;
      scorePossible += 1.5;
      const vibeBonus = Math.min(1.5, vibeHits * 0.5);
      score += vibeBonus;
      details.vibe_match = { score: vibeBonus, max: 1.5, signal: `${vibeHits} vibe keyword hits` };
    }
  }

  // Bonus: Tag-based vibe matching (bar/nightlife)
  if (requestLower && profile.tags?.length > 0) {
    const tagStrings = profile.tags.map(t => tagToString(t).toLowerCase());
    let vibeTagHits = 0;
    for (const [vibeKey, matchPatterns] of Object.entries(VIBE_TAG_MAP)) {
      if (requestLower.includes(vibeKey)) {
        for (const pattern of matchPatterns) {
          if (tagStrings.some(ts => ts.includes(pattern))) { vibeTagHits++; break; }
        }
      }
    }
    if (vibeTagHits > 0) {
      scorePossible += 1.5;
      const tagBonus = Math.min(1.5, vibeTagHits * 0.75);
      score += tagBonus;
      dataPoints++;
      details.vibe_tags = { score: tagBonus, max: 1.5, signal: `${vibeTagHits} vibe tag hits` };
    }
  }

  // Bonus: Conversation friendliness for date occasions (0-1)
  const dateOccasions = ["Date Night", "Anniversary", "Special Occasion"];
  if (dateOccasions.includes(occasion) && dp?.conversation_friendliness != null) {
    maxDataPoints++;
    dataPoints++;
    scorePossible += 1;
    const convScore = dp.conversation_friendliness >= 7 ? 1.0 : dp.conversation_friendliness >= 5 ? 0.5 : 0;
    score += convScore;
    details.social = { score: convScore, max: 1, signal: `Conversation ${dp.conversation_friendliness}/10` };
  }

  // Bonus: Outdoor/scenic/live music if requested
  if (requestLower.match(/outdoor|patio|outside|al fresco|terrace/)) {
    scorePossible += 1;
    if (profile.outdoor_seating) { score += 1; dataPoints++; }
    details.outdoor = { score: profile.outdoor_seating ? 1 : 0, max: 1, signal: profile.outdoor_seating ? "Has outdoor" : "No outdoor" };
  }
  if (requestLower.match(/view|scenic|waterfront|lakefront|rooftop/)) {
    scorePossible += 1;
    const hasScenic = profile.tags?.some(t => /waterfront|lakefront|rooftop|scenic|skyline|river view/i.test(tagToString(t)));
    if (hasScenic) { score += 1; dataPoints++; }
  }
  const wantsLiveMusic = requestLower.match(/live music|live band|live jazz|live dj|karaoke|entertainment/)
    || intent?.target_tags?.some(t => /music|entertainment|dj|karaoke/i.test(t))
    || intent?.target_features?.includes("live_music");
  if (wantsLiveMusic) {
    scorePossible += 1.5;
    if (profile.live_music) { score += 1.5; dataPoints++; }
    else if (dp?.music_vibe && /live/.test(dp.music_vibe)) { score += 1.0; dataPoints++; }
    else if (profile.tags?.some(t => /live music|live band|live jazz/i.test(tagToString(t)))) { score += 1.0; dataPoints++; }
  }

  // Cold-start: zero data → return vibe prior (consistent with Bayesian confidence regression)
  if (dataPoints === 0) {
    return { score: FACTOR_PRIORS.vibe, dataPoints: 0, maxDataPoints, details: { noise: { score: 0, max: 3, signal: "No data" } } };
  }

  // Normalize using adaptive denominator
  const effectiveMax = Math.max(scorePossible, 5);
  // Coverage discount: sparse data can't produce perfect scores
  const baseLayers = [profile.noise_level, profile.lighting_ambiance, profile.dress_code,
    dp?.energy_level != null, dp?.music_vibe].filter(Boolean).length;
  // Strengthened coverage discount: 0.55 + 0.45 instead of 0.7 + 0.3.
  // Inspiration: Netflix score normalization — prevents sparse-data restaurants
  // from inflating to 9.6 on vibe with just 1 matching signal. The wider range
  // [0.55, 1.0] vs old [0.70, 1.0] means a restaurant with 1/5 base layers
  // gets 0.64 discount instead of 0.76.
  const coverageDiscount = 0.55 + 0.45 * (baseLayers / 5);
  const normalized = Math.min(10, (score / effectiveMax) * 10 * coverageDiscount);

  return { score: Math.max(0, normalized), dataPoints, maxDataPoints, details };
}

// ==========================================
// FACTOR 3: SERVICE (0-10)
// ==========================================

function computeService(
  profile: RestaurantProfile,
  occasion: string,
  intent: IntentClassificationV2 | null,
): { score: number; dataPoints: number; maxDataPoints: number; details: Record<string, V8SubComponent> } {
  const dp = profile.deep_profile;
  let dataPoints = 0;
  let maxDataPoints = 0;
  let score = 0;
  const details: Record<string, V8SubComponent> = {};

  // Signal 1: Occasion base score (0-6)
  maxDataPoints++;
  const occasionBase = computeWeightedOccasionScore(profile, occasion);
  if (occasionBase > 0) {
    dataPoints++;
    score += Math.pow(occasionBase / 10, 0.85) * 6;
  } else {
    score += 2.5;
  }
  details.occasion = { score: Math.round(score * 10) / 10, max: 6, signal: occasionBase > 0 ? `${occasion} ${occasionBase.toFixed(1)}/10` : "No occasion data" };

  // Signal 2: Service style fit (0-2)
  maxDataPoints++;
  let serviceStyleScore = 0;
  if (dp?.service_style) {
    dataPoints++;
    const fits = SERVICE_FIT[occasion] || [];
    if (fits.length > 0 && fits.includes(dp.service_style)) serviceStyleScore = 2;
    else serviceStyleScore = 1;
    const clashes = SERVICE_CLASH[occasion] || [];
    if (clashes.includes(dp.service_style)) serviceStyleScore = 0;
  } else {
    serviceStyleScore = 1; // neutral
  }
  score += serviceStyleScore;
  details.service_style = { score: serviceStyleScore, max: 2, signal: dp?.service_style || "No data" };

  // Signal 3: Social dynamics (0-2)
  maxDataPoints++;
  let socialScore = 0;
  let socialDataUsed = false;
  if (dp) {
    // Meal pacing
    if (dp.meal_pacing) {
      const pacingFits = PACING_FIT[occasion] || [];
      if (pacingFits.includes(dp.meal_pacing)) { socialScore += 0.5; socialDataUsed = true; }
    }
    // Kid friendliness for family
    if (occasion === "Family Dinner" && dp.kid_friendliness != null) {
      if (dp.kid_friendliness >= 7) socialScore += 0.75;
      else if (dp.kid_friendliness >= 5) socialScore += 0.25;
      socialDataUsed = true;
    }
    // Conversation friendliness for date/business
    if (["Date Night", "Business Lunch", "Special Occasion"].includes(occasion) && dp.conversation_friendliness != null) {
      if (dp.conversation_friendliness >= 7) socialScore += 0.5;
      socialDataUsed = true;
    }
    // Group size
    if (dp.group_size_sweet_spot) {
      const rangeMatch = dp.group_size_sweet_spot.match(/\[(\d+),(\d+)\)/);
      if (rangeMatch) {
        const max = parseInt(rangeMatch[2], 10);
        if (intent?.group_size_hint === "large_group" && max <= 6) {
          socialScore -= 1.0; socialDataUsed = true;
        }
      }
    }
    // Date progression
    if (dp.date_progression && intent?.date_type) {
      if (dp.date_progression.toLowerCase().includes(intent.date_type.toLowerCase())) {
        socialScore += 0.5; socialDataUsed = true;
      }
    }
    if (socialDataUsed) { dataPoints++; socialScore = Math.min(2, Math.max(-1, socialScore)); }
  }
  score += Math.max(0, socialScore);
  details.social = { score: Math.max(0, socialScore), max: 2, signal: socialDataUsed ? "Social fit assessed" : "No data" };

  const clamped = Math.min(10, Math.max(0, score));

  // Occasion "Any" with no data → neutral
  if (occasion === "Any" && occasionBase === 0) {
    return { score: 4, dataPoints, maxDataPoints, details };
  }

  return { score: clamped, dataPoints, maxDataPoints, details };
}

// ==========================================
// FACTOR 4: REPUTATION (0-10)
// ==========================================

function computeReputation(
  profile: RestaurantProfile,
  googleData: GooglePlaceData | null,
  sentimentScore?: number | null,
  sentimentNegative?: number | null,
): { score: number; dataPoints: number; maxDataPoints: number; details: Record<string, V8SubComponent> } {
  const dp = profile.deep_profile;
  let dataPoints = 0;
  let maxDataPoints = 0;
  const details: Record<string, V8SubComponent> = {};

  // Signal 1: Google rating (0-7) — Bayesian average
  // Inspiration: IMDB Weighted Rating / Yelp Bayesian Average
  // Uses a Bayesian prior to discount sparse-review restaurants smoothly
  // instead of the step-function confidence (0.7/0.8/0.9/1.0).
  // Formula: bayesianRating = (C × m + n × R) / (C + n)
  //   C = minimum reviews for full credibility (30 — typical Chicago restaurant)
  //   m = global prior (4.15 — Chicago restaurant avg Google rating)
  maxDataPoints++;
  let googleScore = 0;
  const BAYESIAN_C = 30;
  const BAYESIAN_M = 4.15;
  if (googleData?.google_rating != null) {
    dataPoints++;
    const rating = googleData.google_rating;
    const reviewCount = googleData.google_review_count || 0;
    const bayesianRating = (BAYESIAN_C * BAYESIAN_M + reviewCount * rating) / (BAYESIAN_C + reviewCount);
    const raw = Math.max(0, Math.min(10, (bayesianRating - 3.5) / 1.5 * 10));
    googleScore = Math.min(7, raw * 0.85);
    details.google = { score: googleScore, max: 7, signal: `${rating}\u2605 (${reviewCount} reviews, adj ${bayesianRating.toFixed(2)})` };
  } else {
    googleScore = 3.5;
    details.google = { score: 3.5, max: 7, signal: "No Google data" };
  }

  // Signal 2: Sentiment (0-2)
  maxDataPoints++;
  let sentScore = 0;
  if (sentimentScore != null) {
    dataPoints++;
    sentScore = (sentimentScore / 10) * 2;
    if (sentimentNegative != null && sentimentNegative > 30) {
      sentScore -= Math.min(1.5, ((sentimentNegative - 30) / 40) * 1.5);
    }
    sentScore = Math.max(0, sentScore);
    details.sentiment = { score: sentScore, max: 2, signal: `Sentiment ${sentimentScore}/10` };
  } else {
    sentScore = 1.0;
    details.sentiment = { score: 1.0, max: 2, signal: "No sentiment data" };
  }

  // Signal 3: Awards + community (0-1 condensed)
  maxDataPoints++;
  let bonusScore = 0;
  let bonusSignal = "";
  if (dp) {
    if (dp.awards_recognition?.length) { bonusScore += 0.4; bonusSignal = dp.awards_recognition[0]; }
    if (dp.chef_notable) { bonusScore += 0.3; bonusSignal += (bonusSignal ? ", " : "") + "Notable chef"; }
    if (dp.cultural_authenticity != null && dp.cultural_authenticity >= 8) { bonusScore += 0.3; bonusSignal += (bonusSignal ? ", " : "") + "Authentic"; }
    if (dp.neighborhood_integration === "institution") { bonusScore += 0.2; }
    else if (dp.neighborhood_integration === "destination") { bonusScore += 0.1; }
    if (profile.trending_score != null && profile.trending_score >= 7) { bonusScore += 0.2; }
    if (bonusScore > 0) dataPoints++;
  }
  // Raise award ceiling from 1.0 → 1.5 so reputation-heavy queries get more signal
  bonusScore = Math.min(1.5, bonusScore);
  details.awards = { score: bonusScore, max: 1.5, signal: bonusSignal || "No awards data" };

  // Total
  const total = googleScore + sentScore + bonusScore;
  const reputation = Math.min(10, Math.max(0, total));

  return { score: reputation, dataPoints, maxDataPoints, details };
}

// ==========================================
// FACTOR 5: CONVENIENCE (0-10)
// ==========================================

function computeConvenience(
  profile: RestaurantProfile,
  intent: IntentClassificationV2 | null,
  clientTimeOfDay?: string | null,
  specialRequest?: string,
): { score: number; dataPoints: number; maxDataPoints: number; details: Record<string, V8SubComponent> } {
  const dp = profile.deep_profile;
  const requestLower = (specialRequest || "").toLowerCase();
  let dataPoints = 0;
  let maxDataPoints = 0;
  let score = 4; // neutral start
  const details: Record<string, V8SubComponent> = {};

  // Signal 1: Timing fit (-2 to +2)
  maxDataPoints++;
  if (clientTimeOfDay && profile.best_times?.length) {
    dataPoints++;
    if (profile.best_times.includes(clientTimeOfDay)) score += 2;
    else if (profile.best_times.length <= 2) score -= 2;
    else score -= 0.5;
  }
  details.timing = {
    score: Math.max(0, Math.min(6, score)),
    max: 6,
    signal: clientTimeOfDay && profile.best_times?.includes(clientTimeOfDay) ? `Good for ${clientTimeOfDay}` : clientTimeOfDay ? "Off-peak" : "No time data",
  };

  // Signal 2: Reservation accessibility (-2.5 to +2)
  maxDataPoints++;
  if (dp?.reservation_difficulty) {
    dataPoints++;
    const isSpontaneous = intent?.spontaneity === "spontaneous"
      || requestLower.match(/tonight|right now|last minute|walk.?in|spontaneous/);
    if (dp.reservation_difficulty === "hard_to_get" && isSpontaneous) score -= 2.5;
    else if (dp.reservation_difficulty === "walk_in_friendly") score += isSpontaneous ? 2.0 : 0.5;
  }
  details.reservation = {
    score: dp?.reservation_difficulty === "walk_in_friendly" ? 2 : dp?.reservation_difficulty === "hard_to_get" ? 0 : 1,
    max: 2,
    signal: dp?.reservation_difficulty || "No data",
  };

  // Wait time
  maxDataPoints++;
  if (dp?.typical_wait_minutes != null) {
    dataPoints++;
    if (dp.typical_wait_minutes > 60) score -= 1.0;
    else if (dp.typical_wait_minutes > 30) score -= 0.5;
    else score += 1.0;
  }

  // Practical notes
  if (dp?.payment_notes?.toLowerCase().includes("cash")) { maxDataPoints++; dataPoints++; score -= 0.5; }

  // BYOB matching
  const constraints = intent?.practical_constraints || [];
  const wantsByob = requestLower.includes("byob") || constraints.includes("byob_preference");
  if (wantsByob) {
    maxDataPoints++;
    if ((dp?.byob_policy?.toLowerCase().includes("byob")) || profile.tags?.some(t => /byob/i.test(tagToString(t)))) {
      dataPoints++; score += 1.5;
    }
  }

  // Parking
  if (profile.parking_availability && !/none|no /i.test(profile.parking_availability)) score += 0.5;

  const finalScore = Math.min(10, Math.max(0, score));
  details.practical = { score: Math.max(0, finalScore - 4), max: 6, signal: profile.parking_availability || "Standard" };

  // V7 compat: +1 uplift to match V7's convenience boost
  const uplifted = Math.min(10, finalScore + 1);

  return { score: uplifted, dataPoints, maxDataPoints, details };
}

// ==========================================
// V8 WEIGHT COMPUTATION
// ==========================================

function matchesV8Condition(
  condition: V8WeightShiftRule["condition"],
  occasion: string,
  intent: IntentClassificationV2 | null,
): boolean {
  if (condition.occasion && !condition.occasion.includes(occasion)) return false;
  if (condition.cuisineImportance) {
    if (intent?.cuisine_importance !== condition.cuisineImportance) return false;
    // V8.5 O15: Guard "high" cuisine importance — only fire when there are actual
    // cuisine or dish signals. Prevents food weight inflation for experience queries
    // like "drag brunch" or "michelin dining room" where the classifier defaults
    // to high importance but there are no specific cuisine/dish targets.
    if (condition.cuisineImportance === "high") {
      const hasCuisineTargets = (intent?.target_cuisines?.length ?? 0) > 0;
      const hasDishTarget = !!intent?.dish_level_intent;
      if (!hasCuisineTargets && !hasDishTarget) return false;
    }
  }
  if (condition.emotionalIntent) {
    if (!intent?.emotional_intent || !condition.emotionalIntent.includes(intent.emotional_intent)) return false;
  }
  if (condition.spontaneous !== undefined) {
    if ((intent?.spontaneity === "spontaneous") !== condition.spontaneous) return false;
  }
  if (condition.vibeKeywords) {
    const has = condition.vibeKeywords.some(kw =>
      intent?.vibe_keywords?.some(vk => vk.toLowerCase().includes(kw.toLowerCase()))
    );
    if (!has) return false;
  }
  if (condition.targetTags) {
    const has = condition.targetTags.some(kw =>
      intent?.target_tags?.some((tt: string) => tt.toLowerCase().includes(kw.toLowerCase()))
    );
    if (!has) return false;
  }
  if (condition.targetCuisineIsBar !== undefined) {
    const BAR_PATTERN = /cocktail|bar\b|speakeasy|brewery|pub|lounge|whiskey bar|wine bar/i;
    const isBar = intent?.target_cuisines?.some((tc: string) => BAR_PATTERN.test(tc)) ?? false;
    if (condition.targetCuisineIsBar !== isBar) return false;
  }
  if (condition.dishLevelIntent !== undefined) {
    if ((intent?.dish_level_intent != null) !== condition.dishLevelIntent) return false;
  }
  return true;
}

function computeV8Weights(
  occasion: string,
  intent: IntentClassificationV2 | null,
): { weights: V8Weights; appliedRules: string[] } {
  const w: V8Weights = { ...V8_BASE_WEIGHTS };
  const appliedRules: string[] = [];

  for (const rule of V8_RULES) {
    if (matchesV8Condition(rule.condition, occasion, intent)) {
      for (const [key, delta] of Object.entries(rule.deltas)) {
        (w as Record<string, number>)[key] += delta as number;
      }
      appliedRules.push(rule.label);
    }
  }

  // Clamp [0.05, 0.50] and normalize
  const keys: (keyof V8Weights)[] = ["food", "vibe", "service", "reputation", "convenience"];
  for (const k of keys) w[k] = Math.max(0.05, Math.min(0.50, w[k]));
  const sum = keys.reduce((s, k) => s + w[k], 0);
  if (Math.abs(sum - 1.0) > 0.001) {
    for (const k of keys) w[k] /= sum;
  }

  return { weights: w, appliedRules };
}

// ==========================================
// V8 INTENT ALIGNMENT
// ==========================================

function computeV8IntentAlignment(
  profile: RestaurantProfile,
  intent: IntentClassificationV2 | null,
  specialRequest: string,
): V8IntentAlignment {
  if (!intent) {
    return { score: 0.5, cuisine: 0.5, dish: 0, vibe: 0.5, constraints: 0.5, hasActiveSignals: false };
  }

  const dp = profile.deep_profile;
  const targetCuisines = intent.target_cuisines || [];
  const vibeKeywords = intent.vibe_keywords || [];
  const targetTags = intent.target_tags || [];
  const constraints = intent.practical_constraints || [];
  const vibeSignals = [...vibeKeywords, ...targetTags];

  const hasCuisine = targetCuisines.length > 0;
  const hasDish = !!intent.dish_level_intent;
  const hasVibe = vibeSignals.length > 0;
  const hasConstraints = constraints.length > 0;
  const hasActiveSignals = hasCuisine || hasDish || hasVibe || hasConstraints;

  // Cuisine alignment (0-1.0) — 6-level scale
  // Inspiration: Wu-Palmer Similarity from WordNet taxonomy
  // Exact=1.0, Contains=0.75, Subcategory=0.6, SameFamily=0.40, AdjacentFamily=0.25, None=0.1
  let cuisineAlignment = 0.5;
  if (hasCuisine && profile.cuisine_type) {
    const cl = profile.cuisine_type.toLowerCase();
    const exact = targetCuisines.some(c => c.toLowerCase() === cl);
    const contains = !exact && targetCuisines.some(c =>
      cl.includes(c.toLowerCase()) || c.toLowerCase().includes(cl)
    );
    if (exact) cuisineAlignment = 1.0;
    else if (contains) cuisineAlignment = 0.75;
    else if (dp?.cuisine_subcategory) {
      const sub = dp.cuisine_subcategory.toLowerCase();
      if (targetCuisines.some(c => sub.includes(c.toLowerCase()))) cuisineAlignment = 0.6;
      else if (isRelatedCuisine(profile.cuisine_type, targetCuisines)) cuisineAlignment = 0.40;
      else if (isAdjacentCuisine(profile.cuisine_type, targetCuisines)) cuisineAlignment = 0.25;
      else cuisineAlignment = 0.10;
    } else if (isRelatedCuisine(profile.cuisine_type, targetCuisines)) {
      cuisineAlignment = 0.40;
    } else if (isAdjacentCuisine(profile.cuisine_type, targetCuisines)) {
      cuisineAlignment = 0.25;
    } else {
      cuisineAlignment = 0.10;
    }
  } else if (hasCuisine && !profile.cuisine_type) {
    cuisineAlignment = 0.10;
  }

  // Dish alignment (0-1.0)
  let dishAlignment = 0.5;
  if (hasDish) {
    dishAlignment = 0;
    if (dp?.signature_dishes?.length) {
      const dq = intent.dish_level_intent!.toLowerCase();
      const exactDish = dp.signature_dishes.some(d =>
        dq.includes(d.dish.toLowerCase()) || d.dish.toLowerCase().includes(dq)
      );
      if (exactDish) dishAlignment = 1.0;
      else {
        const words = dq.split(/\s+/).filter(w => w.length >= 2);
        const wordMatch = dp.signature_dishes.some(d =>
          words.some(w => d.dish.toLowerCase().includes(w))
        );
        dishAlignment = wordMatch ? 0.4 : 0;
      }
    }
    // Menu highlights fallback
    if (dishAlignment < 0.4 && dp?.menu_highlights?.length) {
      const dq = intent.dish_level_intent!.toLowerCase();
      const hlMatch = dp.menu_highlights.some(item =>
        dq.includes(item.toLowerCase()) || item.toLowerCase().includes(dq)
      );
      if (hlMatch) dishAlignment = Math.max(dishAlignment, 0.6);
    }
  }

  // Vibe alignment (0-1.0)
  // V8.4: Laplace floor of 0.20 — absence of matching tags doesn't mean the
  // restaurant is wrong for the vibe, it may just lack tag coverage.
  // Inspiration: Laplace smoothing (add-1) from NLP — never assign zero
  // probability to unseen events. A restaurant without "romantic" tags
  // may still be perfectly romantic; sparse tag data ≠ negative signal.
  let vibeAlignment = 0.5;
  if (hasVibe) {
    const tagStrings = (profile.tags || []).map(t => tagToString(t).toLowerCase());
    let vibeHits = 0;
    for (const signal of vibeSignals) {
      const sl = signal.toLowerCase();
      if (tagStrings.some(ts => ts.includes(sl))) { vibeHits++; continue; }
      if (dp?.decor_style?.toLowerCase().includes(sl)) { vibeHits++; continue; }
      if (dp?.music_vibe?.toLowerCase().includes(sl)) { vibeHits++; continue; }
    }
    vibeAlignment = Math.max(0.20, Math.min(1.0, vibeHits / vibeSignals.length));
  }

  // Constraint alignment (0-1.0)
  // V8.4: Laplace floor of 0.25 — unmatched constraints may be absent from
  // profile data rather than genuinely unsupported. A restaurant without
  // explicit "outdoor" in its profile might still have a patio.
  let constraintAlignment = 0.5;
  if (hasConstraints) {
    let constraintHits = 0;
    for (const constraint of constraints) {
      if (constraint === "outdoor_preferred" && profile.outdoor_seating) { constraintHits++; continue; }
      if (constraint === "pet_friendly" && profile.pet_friendly) { constraintHits++; continue; }
      if (constraint === "byob" && dp?.byob_policy?.toLowerCase().includes("byob")) { constraintHits++; continue; }
      if (constraint === "walk_in" && dp?.reservation_difficulty === "walk_in_friendly") { constraintHits++; continue; }
      if (constraint === "quiet_environment" && profile.noise_level === "Quiet") { constraintHits++; continue; }
      if (constraint === "parking_needed" && profile.parking_availability && !/none|no /i.test(profile.parking_availability)) { constraintHits++; continue; }
    }
    constraintAlignment = Math.max(0.25, Math.min(1.0, constraintHits / constraints.length));
  }

  // Weighted composite (only active components count)
  let totalWeight = 0;
  let weightedSum = 0;
  if (hasCuisine) { weightedSum += cuisineAlignment * 0.40; totalWeight += 0.40; }
  if (hasDish) { weightedSum += dishAlignment * 0.25; totalWeight += 0.25; }
  if (hasVibe) { weightedSum += vibeAlignment * 0.20; totalWeight += 0.20; }
  if (hasConstraints) { weightedSum += constraintAlignment * 0.15; totalWeight += 0.15; }

  let score = totalWeight > 0 ? weightedSum / totalWeight : 0.5;

  // V8.5 O16+O18: IA composite floor of 0.30 — prevents extreme IM penalties.
  // When the intent classifier produces active signals but none align with the
  // restaurant's profile, the raw composite can drop to 0.06-0.15, causing
  // IM to hit near floor (0.80-0.90). A floor of 0.30 acknowledges that
  // any curated restaurant has baseline relevance to any reasonable query.
  // V8.5→V8.6: Raised from 0.20→0.25→0.30→0.35 across iterations.
  // V8.6: Raise to 0.35 — 200-case testing at strict level 2 revealed 15
  // experience/vibe queries all hitting the 0.30 floor, causing IM to over-penalize.
  // Combined with V8.6 IM floors, minimum possible IM is now:
  //   high conf: 0.82 + 0.23*0.35 = 0.901
  //   medium:    0.86 + 0.19*0.35 = 0.927
  //   low:       0.92 + 0.13*0.35 = 0.966
  // Inspiration: Jelinek-Mercer smoothing — interpolate with a uniform prior.
  if (hasActiveSignals && score < 0.35) {
    score = 0.35;
  }

  return { score, cuisine: cuisineAlignment, dish: dishAlignment, vibe: vibeAlignment, constraints: constraintAlignment, hasActiveSignals };
}

// ==========================================
// V8 MATCH NARRATIVE GENERATION
// ==========================================

function generateV8MatchNarrative(
  factors: V8Factors,
  weights: V8Weights,
  intent: IntentClassificationV2 | null,
  intentAlignment: V8IntentAlignment,
  factorDetails: Record<string, Record<string, V8SubComponent>>,
  profile: RestaurantProfile,
): V7MatchNarrative {
  const contributions = [
    { factor: "food", contribution: factors.food * weights.food, score: factors.food },
    { factor: "vibe", contribution: factors.vibe * weights.vibe, score: factors.vibe },
    { factor: "service", contribution: factors.service * weights.service, score: factors.service },
    { factor: "reputation", contribution: factors.reputation * weights.reputation, score: factors.reputation },
    { factor: "convenience", contribution: factors.convenience * weights.convenience, score: factors.convenience },
  ];
  contributions.sort((a, b) => b.contribution - a.contribution);
  const strongest = contributions[0];
  const weakest = contributions[contributions.length - 1];

  const FACTOR_LABELS: Record<string, Record<string, string>> = {
    food: { high: "Outstanding Cuisine Match", medium: "Good Food Fit", low: "Decent Menu" },
    vibe: { high: "Perfect Atmosphere", medium: "Good Vibe Match", low: "Adequate Setting" },
    service: { high: "Excellent Service Fit", medium: "Good Service Match", low: "Standard Service" },
    reputation: { high: "Highly Regarded", medium: "Well Reviewed", low: "Decent Reputation" },
    convenience: { high: "Very Convenient", medium: "Reasonably Convenient", low: "Some Tradeoffs" },
  };

  const tier = strongest.score >= 8 ? "high" : strongest.score >= 6 ? "medium" : "low";
  const strongestLabel = FACTOR_LABELS[strongest.factor]?.[tier] || "Strong Match";

  // Key signals from factor details
  const keySignals: string[] = [];
  const strongDetails = factorDetails[strongest.factor];
  if (strongDetails) {
    const topSubs = Object.entries(strongDetails)
      .sort(([, a], [, b]) => (b.score / Math.max(b.max, 0.01)) - (a.score / Math.max(a.max, 0.01)))
      .slice(0, 2);
    for (const [, sub] of topSubs) {
      if (sub.score > 0 && sub.signal && sub.signal !== "No data") keySignals.push(sub.signal);
    }
  }
  if (intentAlignment.cuisine >= 0.7 && intent?.target_cuisines?.length) {
    keySignals.unshift(`Matches ${intent.target_cuisines[0]} cuisine`);
  }
  if (intentAlignment.dish >= 0.7 && intent?.dish_level_intent) {
    keySignals.unshift(`Has ${intent.dish_level_intent} on menu`);
  }
  const trimmedSignals = keySignals.slice(0, 3);

  let summary = strongestLabel;
  if (trimmedSignals.length > 0) summary += ` \u2014 ${trimmedSignals[0].toLowerCase()}`;

  const weakSpots: string[] = [];
  if (weakest.score < 5) {
    weakSpots.push(`Lower ${weakest.factor} score`);
  }

  let confidenceCaveat: string | null = null;
  const dp = profile.deep_profile;
  if (!dp || (dp.enrichment_confidence ?? 0) < 0.3) {
    confidenceCaveat = "Limited data available \u2014 score may update with more information";
  }

  return {
    strongest_factor: strongest.factor,
    strongest_factor_label: strongestLabel,
    key_signals: trimmedSignals,
    comparison_context: null,
    summary,
    weak_spots: weakSpots,
    confidence_caveat: confidenceCaveat,
  };
}

// ==========================================
// V8 FOOD ABSORBED ADJUSTMENT
// ==========================================

function foodAbsorbedAdjustment(
  rawScore: number,
  profile: RestaurantProfile,
  userFeedback?: { likedCuisines: string[]; dislikedCuisines: string[]; likedRestaurantIds: string[]; dislikedRestaurantIds: string[] } | null,
  rejectionSignals?: { avoidCuisines: string[]; avoidPriceLevels: string[]; avoidRestaurantIds: string[] },
): number {
  let adjusted = rawScore;
  if (userFeedback && profile.cuisine_type) {
    if (userFeedback.likedCuisines.includes(profile.cuisine_type)) adjusted += 0.8;
    if (userFeedback.dislikedCuisines.includes(profile.cuisine_type)) adjusted -= 1.0;
  }
  if (rejectionSignals && profile.cuisine_type) {
    if (rejectionSignals.avoidCuisines.includes(profile.cuisine_type)) {
      const alreadyPenalized = userFeedback?.dislikedCuisines.includes(profile.cuisine_type);
      if (!alreadyPenalized) adjusted -= 0.5;
    }
  }
  if (userFeedback?.dislikedRestaurantIds.includes(profile.id)) adjusted -= 1.5;
  return adjusted;
}

// ==========================================
// V8 DONDE MATCH (full pipeline)
// ==========================================

/**
 * Compute the V8 Donde Match score for a single restaurant.
 *
 * Pipeline:
 * 1. Compute raw factor scores (all 5 factors)
 * 2. Apply food absorbed adjustments (user feedback)
 * 3. Apply single confidence function per factor (Bayesian priors)
 * 4. Compute intent alignment (6-level cuisine taxonomy)
 * 5. Compute dynamic weights (13 rules)
 * 6. Arithmetic weighted mean → BaseQuality (0-100)
 * 6b. Vibe-service coherence penalty (V8.3, relaxed V8.4)
 * 7. Confidence-weighted intent multiplier (V8.3)
 * 8. DondeScore = AdjustedBaseQuality × IntentMultiplier
 *
 * V8.4 changes in intent alignment:
 * - Vibe alignment Laplace floor: 0.20 (prevents zero-IA from missing tags)
 * - Constraint alignment Laplace floor: 0.25 (sparse profile ≠ negative signal)
 * 9. Generate match narrative
 */
export function computeV8DondeMatch(
  profile: RestaurantProfile,
  inputs: V8DondeMatchInputs,
): V8DondeMatchResult {
  // Step 1: Compute raw factor scores
  const foodResult = computeFood(profile, inputs.intent, inputs.dietaryRestrictions, inputs.specialRequest);
  const vibeResult = computeVibe(profile, inputs.occasion, inputs.intent, inputs.specialRequest);
  const serviceResult = computeService(profile, inputs.occasion, inputs.intent);
  const reputationResult = computeReputation(profile, inputs.googleData, inputs.sentimentScore, inputs.sentimentNegative);
  const convenienceResult = computeConvenience(profile, inputs.intent, inputs.clientTimeOfDay, inputs.specialRequest);

  // Step 2: Food absorbed adjustments
  const adjustedFood = foodAbsorbedAdjustment(
    foodResult.score, profile, inputs.userFeedback, inputs.rejectionSignals,
  );

  // Step 3: Apply per-factor confidence (regress toward factor-specific priors)
  const factors: V8Factors = {
    food: Math.max(FACTOR_FLOOR, Math.min(10, applyConfidence(adjustedFood, foodResult.dataPoints, foodResult.maxDataPoints, "food"))),
    vibe: Math.max(FACTOR_FLOOR, Math.min(10, applyConfidence(vibeResult.score, vibeResult.dataPoints, vibeResult.maxDataPoints, "vibe"))),
    service: Math.max(FACTOR_FLOOR, Math.min(10, applyConfidence(serviceResult.score, serviceResult.dataPoints, serviceResult.maxDataPoints, "service"))),
    reputation: Math.max(FACTOR_FLOOR, Math.min(10, applyConfidence(reputationResult.score, reputationResult.dataPoints, reputationResult.maxDataPoints, "reputation"))),
    convenience: Math.max(FACTOR_FLOOR, Math.min(10, applyConfidence(convenienceResult.score, convenienceResult.dataPoints, convenienceResult.maxDataPoints, "convenience"))),
  };

  // Step 4: Collect sub-component details
  const factorDetails: Record<string, Record<string, V8SubComponent>> = {
    food: foodResult.details,
    vibe: vibeResult.details,
    service: serviceResult.details,
    reputation: reputationResult.details,
    convenience: convenienceResult.details,
  };

  // Step 5: Compute intent alignment
  const intentAlignment = computeV8IntentAlignment(profile, inputs.intent, inputs.specialRequest);

  // Step 6: Compute dynamic weights
  const { weights, appliedRules } = computeV8Weights(inputs.occasion, inputs.intent);

  // Step 7: Arithmetic weighted mean → BaseQuality (0-100)
  let baseQuality = (
    factors.food * weights.food +
    factors.vibe * weights.vibe +
    factors.service * weights.service +
    factors.reputation * weights.reputation +
    factors.convenience * weights.convenience
  ) * 10;

  // V8.3→V8.4: Vibe-service alignment penalty — cross-factor coherence.
  // Inspiration: Multi-criteria decision analysis / ISO 9126 quality model.
  // V8.4 adjustment: Threshold raised from 3→4, coefficient reduced 0.8→0.6.
  // Rationale: In Donde's curated restaurant pool, vibe=9.7 and service=5.4
  // (gap=4.3) is the NORM, not an anomaly — 42% of test cases hit the old
  // threshold. The penalty should only fire for truly extreme coherence gaps
  // (>4 points), using a gentler coefficient to avoid over-correcting.
  // Inspiration: Robust statistics — use MAD-based thresholds (2σ equivalent)
  // instead of arbitrary cutoffs to distinguish signal from noise.
  const vibeServiceGap = Math.abs(factors.vibe - factors.service);
  if (vibeServiceGap > 4) {
    const coherencePenalty = (vibeServiceGap - 4) * 0.6; // Max ~3.6 points for gap of 10
    baseQuality -= coherencePenalty;
  }

  // Step 8: Confidence-weighted intent multiplier
  // V8.3→V8.6: The IM floor and range adapt to classifier confidence.
  // V8.5: Initial softening (+0.02 from V8.3). V8.6: Further softening (+0.02)
  // after 200-case testing at strict level 2 showed 4 experience queries
  // scoring 1-2 points below threshold.
  //
  // High confidence (5+ words, clear intent): IM = [0.82, 1.05]  ← V8.6: was 0.80
  // Medium confidence (3-4 words):            IM = [0.86, 1.05]  ← V8.6: was 0.84
  // Low confidence (1-2 words, vague):        IM = [0.92, 1.05]  ← V8.6: was 0.90
  //
  // Combined with IA floor of 0.30, minimum possible IM:
  //   high: 0.82 + 0.23*0.30 = 0.889
  //   medium: 0.86 + 0.19*0.30 = 0.917
  //   low: 0.92 + 0.13*0.30 = 0.959
  let intentMultiplier = 1.0;
  if (intentAlignment.hasActiveSignals) {
    const confLevel = inputs.intent?.confidence?.overall ?? "medium";
    const imFloor = confLevel === "high" ? 0.82 : confLevel === "medium" ? 0.86 : 0.92;
    const imRange = 1.05 - imFloor;
    intentMultiplier = imFloor + imRange * intentAlignment.score;
  }

  // Step 9: Final score
  let dondeMatch = Math.round(baseQuality * intentMultiplier);
  dondeMatch = Math.min(99, Math.max(0, dondeMatch));

  // Data completeness
  const totalDataPoints = foodResult.dataPoints + vibeResult.dataPoints +
    serviceResult.dataPoints + reputationResult.dataPoints + convenienceResult.dataPoints;
  const totalMaxPoints = foodResult.maxDataPoints + vibeResult.maxDataPoints +
    serviceResult.maxDataPoints + reputationResult.maxDataPoints + convenienceResult.maxDataPoints;
  const dataCompleteness = totalMaxPoints > 0 ? totalDataPoints / totalMaxPoints : 0;

  // Step 10: Generate match narrative
  const matchNarrative = generateV8MatchNarrative(
    factors, weights, inputs.intent, intentAlignment, factorDetails, profile,
  );

  return {
    dondeMatch,
    baseQuality: Math.round(baseQuality * 10) / 10,
    intentMultiplier: Math.round(intentMultiplier * 1000) / 1000,
    factors,
    weights,
    intentAlignment,
    matchNarrative,
    dataCompleteness,
    weightShiftReasons: appliedRules,
    factorDetails,
  };
}

// ==========================================
// V8 RE-RANK
// ==========================================

/**
 * Re-rank a list of restaurant profiles using V8 scoring.
 * Intent is IN the score — no tiebreaker needed.
 */
export function reRankV8(
  profiles: RestaurantProfile[],
  occasion: string,
  specialRequest: string,
  intent: IntentClassificationV2 | null,
  dietaryRestrictions?: string[],
  candidatePoolSize?: number,
  clientTimeOfDay?: string | null,
): Array<{ profile: RestaurantProfile; result: V8DondeMatchResult }> {
  const scored = profiles.map(profile => {
    const result = computeV8DondeMatch(profile, {
      occasion,
      specialRequest,
      neighborhood: "Anywhere",
      priceLevel: "Any",
      googleData: null,
      intent,
      dietaryRestrictions,
      candidatePoolSize: candidatePoolSize ?? profiles.length,
      clientTimeOfDay,
    });
    return { profile, result };
  });

  // Sort by DondeMatch — intent is already factored in
  scored.sort((a, b) => b.result.dondeMatch - a.result.dondeMatch);

  // Add comparison context to narratives
  if (scored.length >= 2) {
    const topScore = scored[0].result.dondeMatch;
    for (let i = 0; i < scored.length; i++) {
      const gap = topScore - scored[i].result.dondeMatch;
      if (i === 0 && scored.length > 1) {
        scored[i].result.matchNarrative.comparison_context =
          `${topScore - scored[1].result.dondeMatch} points ahead of next option`;
      } else if (gap > 0) {
        scored[i].result.matchNarrative.comparison_context =
          `${gap} points behind top pick`;
      }
    }
  }

  return scored;
}
