/**
 * Donde Match V3.5 — Scoring Engine (Optimized + Tone Modulation)
 *
 * Five human-intuitive factors: Food Match, Setting Fit, Atmosphere, Reputation, Convenience
 * Each factor scores 0-10. Weighted composite maps to 0-99 Donde Match via power-law scaling.
 *
 * Design philosophy: "High score = best match. If nothing hits 80+, something is off."
 *
 * V3.1 optimizations (expert review cycle 1):
 * - Power-law scaling (exponent 0.85) stretches compressed [35-80] range to [30-90+]
 * - Reduced neutral defaults to lower floor from ~37 to ~25 DM
 * - Bayesian shrinkage for confidence gating (toward prior mean, not zero)
 * - Atmosphere normalization: consistent scale regardless of request verbosity
 * - Blended weights: medium cuisine importance preserved during occasion overrides
 * - Google rating stretched to actual candidate distribution (3.5-5.0)
 * - Feedback recalibrated: +0.5 liked (was +0.3), ratios match Prospect Theory
 * - Claude relevance applied to composite, not individual factors (preserves display)
 * - Under-budget price penalty removed (budgets are ceilings)
 * - Setting/Atmosphere decorrelation discount (0.85x overlap reduction)
 *
 * V3.2 optimizations (expert review cycle 2):
 * - Scale multiplier 99→105 to make 90+ DM reachable for genuine perfect matches (S1)
 * - Bayesian gating scoped to enrichment-dependent factors only: food, setting, atmosphere (PT2)
 * - Cold start: atmosphere neutral 3.5 when zero data; null deep_profile triggers gating (PA3)
 * - Single penalty clamp: removed intermediate max(0) from deal-breaker + personalization (PT4)
 * - Rejection signal stacking prevention: avoidCuisine skipped if already penalized (PA5)
 * - Neighborhood penalty reduced -1.0→-0.6: 2.5:1 ratio vs price matches mental accounting (HB3)
 * - Adventure weights rebalanced: setting 0.15→0.25, food 0.25→0.20 for hidden gem intent (HB6)
 * - Food+Reputation decorrelation: 0.10x overlap discount for correlated quality signals (PA1)
 * - Atmosphere denominator cap: max +3 from conditionals to prevent verbose-request dilution (PA8)
 *
 * V3.3 optimizations (expert review cycle 3):
 * - Food maxPossible 10→11: Layer 1 expanded to 0-6 in V3.1 but denominator was stale (S1/PA8/PT6)
 * - Atmosphere cold-start bypasses Bayesian gating: 3.5 neutral = no enrichment data used (S6)
 * - avoidPriceLevels stacking prevention: skip if deal-breaker price penalty already applied (S10)
 * - Missing occasion weight overrides: Solo Dining, Treat Myself, Chill Hangout now have tuned weights (PA1)
 * - Inverted penalty hierarchy fix: avoidCuisine -2.0→-0.7 (inferred < explicit dislike -1.0) (PA3)
 *
 * V3.4 optimizations (expert review cycles 4-5):
 * - Power-law exponent 0.85→0.73, multiplier 105→116 (S1/S2/PT4: ceiling and mean uplift)
 * - Quality match bonus: +0.5 multi-factor excellence, +0.3 well-rounded, +0.3 strong lead (S8)
 * - Bayesian prior 5.0→5.5, threshold 5→3 (S3/PT1: reduce mediocrity trap)
 * - Reputation neutral defaults raised: sparse data ≠ bad reputation (S4/PT9)
 * - Liked cuisine bonus 0.5→1.0 (S9: rebalance like/dislike ratio)
 * - Decorrelation coefficients softened: 0.15→0.10, 0.10→0.05 (S7/PT5)
 *
 * V3.5 tone modulation (expert review cycle 6: CW/UX/BP/FC):
 * - Pre-compute preliminary DM before Claude call (without Claude-dependent inputs)
 * - Inject score-tier tone directive into system prompt for blurb confidence calibration
 * - Show preliminary DM per candidate in user prompt for tone-aware recommendation writing
 */

import type {
  RestaurantProfile,
  DeepProfile,
} from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { IntentClassification, IntentClassificationV2 } from "./intent-classifier.ts";

// Re-import shared dictionaries from scoring.ts
import {
  CUISINE_KEYWORDS,
  TAG_KEYWORDS,
  DIETARY_KEYWORDS,
  DIETARY_HIERARCHY,
  OCCASION_WEIGHTS,
  type RejectionSignals,
  type UserFeedbackSignals,
} from "./scoring.ts";

// ==========================================
// V3 TYPES
// ==========================================

export interface V3Factors {
  food: number;       // 0-10
  setting: number;    // 0-10
  atmosphere: number; // 0-10
  reputation: number; // 0-10
  convenience: number; // 0-10
}

export interface V3Weights {
  food: number;
  setting: number;
  atmosphere: number;
  reputation: number;
  convenience: number;
}

/** V3.6: Sub-component detail for a single layer within a factor */
export interface V3SubComponent {
  score: number;      // actual points earned
  max: number;        // maximum possible points for this layer
  signal: string;     // brief human-readable explanation
}

export interface V3FactorResult {
  score: number;
  dataPoints: number;
  maxDataPoints: number;
  details?: Record<string, V3SubComponent>;  // V3.6: sub-component breakdown for UI drill-down
}

export interface V3ScoredCandidate {
  profile: RestaurantProfile;
  factors: V3Factors;
  weights: V3Weights;
  rawComposite: number;
  dondeMatch: number;
  dataCompleteness: number;
}

export interface V3ScoringBreakdown {
  food_match: number;
  setting_fit: number;
  atmosphere: number;
  reputation: number;
  convenience: number;
  weights_used: V3Weights;
  data_completeness: number;
}

// ==========================================
// SHARED LOOKUP TABLES (V3-specific)
// ==========================================

// Cuisine family relationships for partial matches
const CUISINE_FAMILIES: Record<string, string[]> = {
  Mediterranean: ["Greek", "Italian", "Middle Eastern"],
  "East Asian": ["Japanese", "Chinese", "Korean"],
  "Southeast Asian": ["Thai", "Vietnamese"],
  "Latin American": ["Mexican", "Peruvian", "Brazilian", "Puerto Rican"],
  "South Asian": ["Indian"],
};

// Reverse lookup: cuisine → family
const CUISINE_TO_FAMILY: Record<string, string> = {};
for (const [family, cuisines] of Object.entries(CUISINE_FAMILIES)) {
  for (const c of cuisines) {
    CUISINE_TO_FAMILY[c] = family;
  }
}

// Noise expectations per occasion
const OCCASION_NOISE: Record<string, string[]> = {
  "Date Night": ["Quiet", "Moderate"],
  "Group Hangout": ["Moderate", "Loud"],
  "Family Dinner": ["Quiet", "Moderate"],
  "Business Lunch": ["Quiet"],
  "Solo Dining": ["Quiet", "Moderate"],
  "Special Occasion": ["Quiet"],
  "Treat Myself": ["Quiet", "Moderate"],
  Adventure: ["Moderate", "Loud", "Quiet"],
  "Chill Hangout": ["Moderate", "Quiet"],
  Any: ["Quiet", "Moderate"],
};

// Lighting expectations per occasion
const OCCASION_LIGHTING: Record<string, string[]> = {
  "Date Night": ["dim", "intimate", "warm", "candlelit", "romantic"],
  "Group Hangout": ["bright", "lively", "modern", "warm", "vibrant"],
  "Family Dinner": ["bright", "warm", "modern", "welcoming"],
  "Business Lunch": ["bright", "modern", "warm", "elegant"],
  "Solo Dining": ["warm", "cozy", "bright", "relaxed"],
  "Special Occasion": ["dim", "intimate", "elegant", "warm", "candlelit"],
  "Treat Myself": ["warm", "cozy", "intimate", "elegant"],
  Adventure: [],  // any lighting
  "Chill Hangout": ["warm", "cozy", "dim", "relaxed"],
  Any: [],
};

// Energy level expectations per occasion
const OCCASION_ENERGY: Record<string, [number, number]> = {
  "Date Night": [4, 7],
  "Group Hangout": [6, 9],
  "Family Dinner": [3, 6],
  "Business Lunch": [2, 5],
  "Solo Dining": [2, 6],
  "Special Occasion": [4, 7],
  "Treat Myself": [3, 7],
  Adventure: [4, 10],
  "Chill Hangout": [3, 6],
  Any: [3, 7],
};

// Music fitness per occasion
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

// Service style fitness per occasion
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

// Service styles that clash with an occasion
const SERVICE_CLASH: Record<string, string[]> = {
  "Special Occasion": ["Fast Casual", "Counter"],
  "Date Night": ["Fast Casual"],
  "Business Lunch": ["Counter", "Fast Casual"],
  "Group Hangout": ["Omakase"],
};

// Dress code levels
const DRESS_LEVELS: Record<string, number> = {
  Casual: 1,
  "Smart Casual": 2,
  "Business Casual": 3,
  Formal: 4,
};

// Minimum dress code per occasion
const OCCASION_DRESS_MIN: Record<string, string> = {
  "Date Night": "Smart Casual",
  "Business Lunch": "Business Casual",
  "Special Occasion": "Smart Casual",
  "Group Hangout": "Casual",
  "Family Dinner": "Casual",
  "Solo Dining": "Casual",
  "Treat Myself": "Casual",
  Adventure: "Casual",
  "Chill Hangout": "Casual",
  Any: "Casual",
};

// Pacing fitness per occasion
const PACING_FIT: Record<string, string[]> = {
  "Business Lunch": ["quick_bite", "relaxed"],
  "Date Night": ["relaxed", "leisurely"],
  "Group Hangout": ["relaxed", "leisurely"],
  "Solo Dining": ["quick_bite", "relaxed"],
  "Special Occasion": ["leisurely", "ceremonial"],
  "Treat Myself": ["relaxed", "leisurely", "ceremonial"],
  Adventure: ["quick_bite", "relaxed", "ceremonial"],
  "Family Dinner": ["relaxed"],
  "Chill Hangout": ["relaxed", "leisurely"],
};

const PRICE_ORDER = ["$", "$$", "$$$", "$$$$"];

// ==========================================
// HELPER: Weighted occasion score from DB
// ==========================================

function computeWeightedOccasionScore(profile: RestaurantProfile, occasion: string): number {
  if (occasion === "Any") {
    const total =
      (profile.date_friendly_score || 0) +
      (profile.group_friendly_score || 0) +
      (profile.family_friendly_score || 0) +
      (profile.romantic_rating || 0) +
      (profile.business_lunch_score || 0) +
      (profile.solo_dining_score || 0) +
      (profile.hole_in_wall_factor || 0);
    return (total / 70) * 10;
  }
  const weights = OCCASION_WEIGHTS[occasion];
  if (!weights) {
    return (profile.date_friendly_score || 0);
  }
  let score = 0;
  for (const [field, weight] of Object.entries(weights)) {
    score += ((profile[field as keyof RestaurantProfile] as number) ?? 0) * weight;
  }
  return score;
}

// ==========================================
// FACTOR 1: FOOD MATCH (0-10)
// ==========================================

export function computeFoodMatch(
  profile: RestaurantProfile,
  intent: IntentClassification | IntentClassificationV2 | null,
  dietaryRestrictions?: string[],
  specialRequest?: string
): V3FactorResult {
  let score = 0;
  let dataPoints = 0;
  let maxDataPoints = 0;
  const details: Record<string, V3SubComponent> = {};

  const dp = profile.deep_profile;
  const v2Intent = intent && "flavor_preferences" in intent ? intent as IntentClassificationV2 : null;

  // V6: Detect dish-level intent for layer rebalancing
  const isDishLevel = v2Intent?.dish_level_intent != null;

  // Layer 1: Cuisine alignment
  // V6: When dish-level intent detected, cuisine ceiling reduced from 6→4 to make room
  // for elevated dish matching (Layer 4: 1→4). This ensures "tandoori chicken" doesn't
  // give equal scores to all Indian restaurants regardless of their menu.
  const cuisineMax = isDishLevel ? 4 : 6;
  maxDataPoints++;
  const targetCuisines = intent?.target_cuisines || [];
  let cuisineScore = 0;
  let cuisineSignal = "";

  if (targetCuisines.length > 0) {
    dataPoints++;
    if (profile.cuisine_type) {
      const cuisineLower = profile.cuisine_type.toLowerCase();
      const exactMatch = targetCuisines.some(c => c.toLowerCase() === cuisineLower);
      // Substring match: "Modern Indian" contains "Indian", "New American" contains "American"
      const containsMatch = !exactMatch && targetCuisines.some(c =>
        cuisineLower.includes(c.toLowerCase()) || c.toLowerCase().includes(cuisineLower)
      );

      if (exactMatch) {
        cuisineScore = cuisineMax;
        cuisineSignal = `Exact: ${profile.cuisine_type}`;
      } else if (containsMatch) {
        cuisineScore = isDishLevel ? 3.5 : 5.5;
        cuisineSignal = `Close: ${profile.cuisine_type}`;
      } else if (dp?.cuisine_subcategory) {
        const subLower = dp.cuisine_subcategory.toLowerCase();
        if (targetCuisines.some(c => subLower.includes(c.toLowerCase()))) {
          cuisineScore = isDishLevel ? 3 : 5;
          cuisineSignal = `Sub-match: ${dp.cuisine_subcategory}`;
        } else if (isRelatedCuisine(profile.cuisine_type, targetCuisines)) {
          cuisineScore = isDishLevel ? 2 : 3.5;
          cuisineSignal = `Related: ${profile.cuisine_type}`;
        }
      } else if (isRelatedCuisine(profile.cuisine_type, targetCuisines)) {
        cuisineScore = isDishLevel ? 2 : 3.5;
        cuisineSignal = `Related: ${profile.cuisine_type}`;
      }
      if (cuisineScore === 0) cuisineSignal = `No match: ${profile.cuisine_type}`;
    } else {
      cuisineSignal = "No cuisine listed";
    }
  } else {
    cuisineScore = 2.5;
    cuisineSignal = "No cuisine filter";
  }
  score += cuisineScore;
  details.cuisine = { score: cuisineScore, max: cuisineMax, signal: cuisineSignal };

  // Layer 2: Flavor profile match (0-2 points)
  maxDataPoints++;
  let flavorScore = 0;
  let flavorSignal = "";
  if (dp?.flavor_profiles && dp.flavor_profiles.length > 0) {
    dataPoints++;
    const flavorPrefs = v2Intent?.flavor_preferences || extractFlavorIntent(specialRequest || "");
    if (flavorPrefs.length > 0) {
      const overlapCount = flavorPrefs.filter(f =>
        dp.flavor_profiles!.some(fp => fp.toLowerCase().includes(f.toLowerCase()))
      ).length;
      flavorScore = Math.min(2, overlapCount * 0.7);
      flavorSignal = overlapCount > 0 ? `${overlapCount} flavor overlap` : "No flavor overlap";
    } else {
      flavorSignal = "No flavor preference";
    }
  } else {
    flavorSignal = "No flavor data";
  }
  score += flavorScore;
  details.flavor = { score: flavorScore, max: 2, signal: flavorSignal };

  // Layer 3: Dietary fit (0-2 points)
  maxDataPoints++;
  let dietScore = 0;
  let dietSignal = "";
  if (dietaryRestrictions && dietaryRestrictions.length > 0) {
    if (dp?.dietary_depth) {
      dataPoints++;
      if (dp.dietary_depth === "dedicated") { dietScore = 2; dietSignal = "Dedicated options"; }
      else if (dp.dietary_depth === "solid") { dietScore = 1.5; dietSignal = "Solid options"; }
      else if (dp.dietary_depth === "token") { dietScore = 0.5; dietSignal = "Limited options"; }
      else dietSignal = "Unknown depth";
    } else if (profile.dietary_options && profile.dietary_options.length > 0) {
      dataPoints++;
      const allMatch = dietaryRestrictions.every(dr => {
        const keywords = DIETARY_KEYWORDS[dr.toLowerCase()];
        if (!keywords) return false;
        return profile.dietary_options!.some(opt =>
          keywords.some(kw => opt.toLowerCase().includes(kw.toLowerCase()))
        );
      });
      if (allMatch) { dietScore = 1; dietSignal = "All restrictions met"; }
      else {
        const someMatch = dietaryRestrictions.some(dr => {
          const keywords = DIETARY_KEYWORDS[dr.toLowerCase()];
          if (!keywords) return false;
          return profile.dietary_options!.some(opt =>
            keywords.some(kw => opt.toLowerCase().includes(kw.toLowerCase()))
          );
        });
        if (someMatch) { dietScore = 0.5; dietSignal = "Partial match"; }
        else dietSignal = "No dietary match";
      }
    } else {
      dietSignal = "No dietary data";
    }
  } else {
    dietScore = 0.5;
    dietSignal = "No restrictions";
    dataPoints++;
  }
  score += dietScore;
  details.dietary = { score: dietScore, max: 2, signal: dietSignal };

  // Layer 4: Menu interest signal
  // V6: Elevated from 0-1 → 0-4 for dish-level queries. This is the critical change
  // that differentiates "has the requested dish" from "right cuisine but wrong menu".
  // For "tandoori chicken": restaurant WITH it scores 4/4; without scores 0/4.
  // That 4-point gap × Food weight 0.40-0.45 → ~15 DondeMatch point difference.
  const menuMax = isDishLevel ? 4 : 1;
  maxDataPoints++;
  const requestLower = (specialRequest || "").toLowerCase();
  let menuScore = 0;
  let menuSignal = "";
  if (dp?.signature_dishes && Array.isArray(dp.signature_dishes) && dp.signature_dishes.length > 0 && requestLower.length > 2) {
    dataPoints++;

    // V6: Phrase-aware dish matching (3 priority tiers)
    // Priority 1: Exact dish name match (full phrase)
    const exactDishMatch = dp.signature_dishes.some(d =>
      requestLower.includes(d.dish.toLowerCase()) ||
      d.dish.toLowerCase().includes(requestLower)
    );

    if (exactDishMatch) {
      menuScore = menuMax;
      menuSignal = "Exact dish match";
    } else if (isDishLevel) {
      // Priority 2: Bigram overlap (prevents "chicken" false positives)
      // "tandoori chicken" → bigrams: ["tandoori chicken"]
      // Won't match "Butter Chicken" because "butter chicken" ≠ "tandoori chicken"
      const rWords = requestLower.split(/\s+/).filter(w => w.length > 2);
      const requestBigrams: string[] = [];
      for (let i = 0; i < rWords.length - 1; i++) {
        requestBigrams.push(`${rWords[i]} ${rWords[i + 1]}`);
      }
      const bigramMatch = requestBigrams.length > 0 && dp.signature_dishes.some(d =>
        requestBigrams.some(bg => d.dish.toLowerCase().includes(bg))
      );
      if (bigramMatch) {
        menuScore = menuMax * 0.75;
        menuSignal = "Dish phrase match";
      } else {
        // Priority 3: Single-word fallback (heavily discounted for dish queries)
        const wordMatch = dp.signature_dishes.some(d => {
          const dishWords = d.dish.toLowerCase().split(/\s+/);
          return dishWords.some(w => w.length > 3 && requestLower.includes(w));
        });
        menuScore = wordMatch ? 1 : 0;
        menuSignal = wordMatch ? "Partial word match" : "No dish match";
      }
    } else {
      // Non-dish query: original V5 logic (max 1 pt)
      const dishMatch = dp.signature_dishes.some(d => {
        const dishWords = d.dish.toLowerCase().split(/\s+/);
        return dishWords.some(w => w.length > 3 && requestLower.includes(w));
      });
      if (dishMatch) { menuScore = 1; menuSignal = "Dish match found"; }
      else menuSignal = "No dish match";
    }

    // V6: menu_highlights fallback (broader coverage, lower confidence)
    if (menuScore === 0 && dp?.menu_highlights?.length) {
      const highlightMatch = dp.menu_highlights.some(item =>
        requestLower.includes(item.toLowerCase()) ||
        item.toLowerCase().includes(requestLower)
      );
      if (highlightMatch) {
        menuScore = isDishLevel ? menuMax * 0.6 : 0.5;
        menuSignal = "Menu highlight match";
      }
    }
  } else if (profile.tags.length > 0 && requestLower.length > 2) {
    dataPoints++;
    let tagMatch = false;
    const foodTags = ["farm-to-table", "brunch spot", "vegan friendly", "gluten free"];
    for (const ft of foodTags) {
      const tagKws = TAG_KEYWORDS[ft];
      if (tagKws && tagKws.some(kw => requestLower.includes(kw))) {
        if (profile.tags.some(t => t.toLowerCase().includes(ft))) {
          tagMatch = true;
          break;
        }
      }
    }
    if (tagMatch) { menuScore = 0.5; menuSignal = "Tag match"; }
    else menuSignal = "No tag match";

    // V6: Also check menu_highlights when no signature_dishes exist
    if (menuScore === 0 && dp?.menu_highlights?.length && requestLower.length > 2) {
      const highlightMatch = dp.menu_highlights.some(item =>
        requestLower.includes(item.toLowerCase()) ||
        item.toLowerCase().includes(requestLower)
      );
      if (highlightMatch) {
        menuScore = isDishLevel ? menuMax * 0.5 : 0.5;
        menuSignal = "Menu highlight match (no sig dishes)";
      }
    }
  } else {
    menuSignal = "No menu data";
  }
  score += menuScore;
  details.menu = { score: menuScore, max: menuMax, signal: menuSignal };

  // Normalize to 0-10 — V3.6: adaptive denominator based on layers with scorable data
  // Previous: fixed maxPossible=11 meant perfect cuisine match + no flavor/menu data = 5.9/10
  // Now: only count layers that had data to score against, preventing absent data from diluting
  const hasFlavorData = dp?.flavor_profiles && dp.flavor_profiles.length > 0
    && (v2Intent?.flavor_preferences?.length || extractFlavorIntent(specialRequest || "").length > 0);
  const hasMenuData = (dp?.signature_dishes && Array.isArray(dp.signature_dishes) && dp.signature_dishes.length > 0 && requestLower.length > 2)
    || (profile.tags.length > 0 && requestLower.length > 2);
  // V6: Denominator accounts for dish-level rebalancing
  const maxPossible = cuisineMax              // Layer 1: cuisine (4 for dish, 6 otherwise)
    + (hasFlavorData ? 2 : 0)                 // Layer 2: flavor (only if both sides have data)
    + 2                                        // Layer 3: dietary (always active — has default)
    + (hasMenuData ? menuMax : 0);            // Layer 4: menu (4 for dish, 1 otherwise)
  const effectiveDenom = Math.max(maxPossible, 8); // Floor at 8 to prevent over-inflation
  const normalized = Math.min(10, (score / effectiveDenom) * 10);

  // No cuisine_type → cap at 4
  if (!profile.cuisine_type && targetCuisines.length > 0) {
    return { score: Math.min(4, normalized), dataPoints, maxDataPoints, details };
  }

  // No food intent → floor at neutral 5
  // When cuisine_importance is "low" (experience query like "byob spot, live music"),
  // or when there's no special request at all, don't punish food score.
  // EXCEPTION: Do NOT apply floor when dietary restrictions are present —
  // the dietary signal must be preserved (ANOMALY-1 fix).
  if (targetCuisines.length === 0) {
    if ((intent?.cuisine_importance === "low" || !specialRequest || specialRequest.trim().length < 3)
        && (!dietaryRestrictions || dietaryRestrictions.length === 0)) {
      return { score: Math.max(normalized, 5), dataPoints, maxDataPoints, details };
    }
  }

  return { score: normalized, dataPoints, maxDataPoints, details };
}

// ==========================================
// FACTOR 2: SETTING FIT (0-10)
// ==========================================

export function computeSettingFit(
  profile: RestaurantProfile,
  occasion: string,
  intent: IntentClassification | IntentClassificationV2 | null
): V3FactorResult {
  let score = 0;
  let dataPoints = 0;
  let maxDataPoints = 0;
  const details: Record<string, V3SubComponent> = {};

  const dp = profile.deep_profile;
  const v2Intent = intent && "group_size_hint" in intent ? intent as IntentClassificationV2 : null;

  // Layer 1: Occasion base score (0-7 points) — power stretch for better top-end discrimination (S4)
  maxDataPoints++;
  const occasionBase = computeWeightedOccasionScore(profile, occasion);
  if (occasionBase > 0) {
    dataPoints++;
    // Power stretch (x^0.85) expands the 6-9 DB range into more of the 0-7 budget (S4)
    const stretched = Math.pow(occasionBase / 10, 0.85) * 7;
    score += stretched;
  } else {
    score += 2.5; // reduced neutral default (was 3.5, S3)
  }

  // Layer 2: Service style alignment (-0.5 to +1.5 points)
  maxDataPoints++;
  if (dp?.service_style) {
    dataPoints++;
    const fits = SERVICE_FIT[occasion] || [];
    if (fits.length > 0 && fits.includes(dp.service_style)) {
      score += 1.5;
    }
    const clashes = SERVICE_CLASH[occasion] || [];
    if (clashes.includes(dp.service_style)) {
      score -= 0.5;
    }
  }

  // Layer 3: Pacing and social dynamics (0-1.5 points)
  maxDataPoints++;
  if (dp) {
    let socialPoints = 0;
    let socialDataUsed = false;

    // Meal pacing fit
    if (dp.meal_pacing) {
      const pacingFits = PACING_FIT[occasion] || [];
      if (pacingFits.length > 0 && pacingFits.includes(dp.meal_pacing)) {
        socialPoints += 0.5;
        socialDataUsed = true;
      }
    }

    // Kid friendliness for Family Dinner
    if (occasion === "Family Dinner" && dp.kid_friendliness != null) {
      if (dp.kid_friendliness >= 7) socialPoints += 0.75;
      else if (dp.kid_friendliness >= 5) socialPoints += 0.25;
      socialDataUsed = true;
    }

    // Conversation friendliness for Date/Business
    if (["Date Night", "Business Lunch", "Special Occasion"].includes(occasion) && dp.conversation_friendliness != null) {
      if (dp.conversation_friendliness >= 7) socialPoints += 0.5;
      socialDataUsed = true;
    }

    // Group size check
    if (dp.group_size_sweet_spot) {
      const rangeMatch = dp.group_size_sweet_spot.match(/\[(\d+),(\d+)\)/);
      if (rangeMatch) {
        const max = parseInt(rangeMatch[2], 10);
        const isLargeGroup = v2Intent?.group_size_hint === "large_group";
        if (isLargeGroup && max <= 6) {
          socialPoints -= 1.0;
          socialDataUsed = true;
        }
      }
    }

    // Date progression match
    if (dp.date_progression && v2Intent?.date_type) {
      if (dp.date_progression.toLowerCase().includes(v2Intent.date_type.toLowerCase())) {
        socialPoints += 0.5;
        socialDataUsed = true;
      }
    }

    if (socialDataUsed) {
      dataPoints++;
      score += Math.min(1.5, Math.max(-1.0, socialPoints));
    }
  }

  const clamped = Math.min(10, Math.max(0, score));

  // V3.6: Build sub-component details for UI drill-down
  const occasionStretched = occasionBase > 0 ? Math.pow(occasionBase / 10, 0.85) * 7 : 2.5;
  details.occasion = { score: Math.round(occasionStretched * 10) / 10, max: 7, signal: occasionBase > 0 ? `${occasion} ${occasionBase.toFixed(1)}/10` : "No occasion data" };

  let serviceScore = 0;
  if (dp?.service_style) {
    const fits = SERVICE_FIT[occasion] || [];
    if (fits.length > 0 && fits.includes(dp.service_style)) serviceScore = 1.5;
    const clashes = SERVICE_CLASH[occasion] || [];
    if (clashes.includes(dp.service_style)) serviceScore -= 0.5;
  }
  details.service = { score: Math.max(0, serviceScore), max: 1.5, signal: dp?.service_style || "No data" };
  details.social = { score: Math.max(0, clamped - occasionStretched - Math.max(0, serviceScore)), max: 1.5, signal: "Pacing + social dynamics" };

  // Occasion "Any" → use average + baseline (reduced neutral, S3)
  if (occasion === "Any" && occasionBase === 0) {
    return { score: 4, dataPoints, maxDataPoints, details }; // was 5
  }

  return { score: clamped, dataPoints, maxDataPoints, details };
}

// ==========================================
// FACTOR 3: ATMOSPHERE (0-10)
// ==========================================

export function computeAtmosphere(
  profile: RestaurantProfile,
  occasion: string,
  intent: IntentClassification | IntentClassificationV2 | null,
  specialRequest?: string
): V3FactorResult {
  // V3.6: Track sub-component scores for detail breakdown
  let noiseScore = 0, lightingScore = 0, dressScore = 0, energyScore = 0, musicScore = 0, vibeScore = 0;
  let score = 0;
  let dataPoints = 0;
  let maxDataPoints = 0;

  const dp = profile.deep_profile;
  const v2Intent = intent && "vibe_keywords" in intent ? intent as IntentClassificationV2 : null;
  const requestLower = (specialRequest || "").toLowerCase();

  // Layer 1: Basic ambiance signals (0-4 points)

  // V3.6: Track both absolute max and data-active max for adaptive normalization
  // S3 "zero-information = zero score" was correct for not adding phantom points,
  // but INCLUDING absent layers in the denominator artificially depresses scores
  // for restaurants with partial atmosphere data.
  let atmoMaxPossible = 0;     // denominator: only layers with scorable data
  let atmoMaxAbsolute = 0;     // tracking total for reference

  // V6.1: Vibe-keyword-driven noise and lighting preferences
  // Merges vibe preferences with occasion preferences so "Cozy brunch" favors quiet spots
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
  const vibeKeywords = v2Intent?.vibe_keywords || [];
  const vibeNoisePrefs: string[] = [];
  const vibeLightingPrefs: string[] = [];
  for (const vk of vibeKeywords) {
    const vkLower = vk.toLowerCase();
    if (VIBE_NOISE[vkLower]) vibeNoisePrefs.push(...VIBE_NOISE[vkLower]);
    if (VIBE_LIGHTING[vkLower]) vibeLightingPrefs.push(...VIBE_LIGHTING[vkLower]);
  }

  // Noise match (0-2.0) — increased from 0-1.5 for better range (S1)
  maxDataPoints++;
  atmoMaxAbsolute += 2.0;
  const occasionNoise = OCCASION_NOISE[occasion] || OCCASION_NOISE.Any;
  // V6.1: Merge occasion + vibe noise preferences (union, deduplicated)
  const expectedNoise = [...new Set([...occasionNoise, ...vibeNoisePrefs])];
  if (profile.noise_level) {
    dataPoints++;
    atmoMaxPossible += 2.0;    // V3.6: only count in denominator when data exists
    if (expectedNoise.includes(profile.noise_level)) {
      score += 2.0;
    } else {
      score += 0.3;
    }
  }

  // Lighting match (0-2.0) — increased from 0-1.5 (S1)
  maxDataPoints++;
  atmoMaxAbsolute += 2.0;
  const occasionLighting = OCCASION_LIGHTING[occasion] || [];
  // V6.1: Merge occasion + vibe lighting preferences (union, deduplicated)
  const expectedLighting = [...new Set([...occasionLighting, ...vibeLightingPrefs])];
  if (profile.lighting_ambiance && expectedLighting.length > 0) {
    dataPoints++;
    atmoMaxPossible += 2.0;
    const lightingLower = profile.lighting_ambiance.toLowerCase();
    const lightingMatches = expectedLighting.filter(kw => lightingLower.includes(kw)).length;
    if (lightingMatches > 0) {
      score += Math.min(2.0, lightingMatches * 1.0);
    }
  } else if (expectedLighting.length === 0) {
    score += 0.5;
    atmoMaxPossible += 0.5;    // neutral counts toward its own contribution
  }

  // Dress code appropriateness (0-1)
  maxDataPoints++;
  atmoMaxAbsolute += 1.0;
  const expectedDressMin = OCCASION_DRESS_MIN[occasion] || "Casual";
  if (profile.dress_code) {
    dataPoints++;
    atmoMaxPossible += 1.0;
    const restaurantLevel = DRESS_LEVELS[profile.dress_code] || 1;
    const expectedLevel = DRESS_LEVELS[expectedDressMin] || 1;
    if (restaurantLevel >= expectedLevel) {
      score += 1;
    } else {
      score += 0.3;
    }
  }

  // Layer 2: Energy and music alignment (0-3 points)

  // Energy level (0-2.0) — increased from 0-1.5 (S1)
  maxDataPoints++;
  atmoMaxAbsolute += 2.0;
  if (dp?.energy_level != null) {
    dataPoints++;
    atmoMaxPossible += 2.0;
    const [eMin, eMax] = OCCASION_ENERGY[occasion] || [3, 7];
    const midpoint = (eMin + eMax) / 2;
    if (dp.energy_level >= eMin && dp.energy_level <= eMax) {
      score += 2.0;
    } else {
      score += Math.max(0, 2.0 - Math.abs(dp.energy_level - midpoint) * 0.4);
    }
  }

  // Music vibe (0-1.5) — increased from 0-1 (S1)
  maxDataPoints++;
  atmoMaxAbsolute += 1.5;
  if (dp?.music_vibe) {
    dataPoints++;
    atmoMaxPossible += 1.5;
    const fits = MUSIC_FIT[occasion] || [];
    if (fits.includes(dp.music_vibe)) score += 1.5;
  }

  // Vibe keyword matches (0-1.5)
  maxDataPoints++;
  atmoMaxAbsolute += 1.5;
  if (v2Intent?.vibe_keywords && v2Intent.vibe_keywords.length > 0 && dp) {
    let vibeHits = 0;
    for (const vibe of v2Intent.vibe_keywords) {
      const vibeLower = vibe.toLowerCase();
      if (dp.decor_style && dp.decor_style.toLowerCase().includes(vibeLower)) { vibeHits++; continue; }
      if (dp.music_vibe && dp.music_vibe.toLowerCase().includes(vibeLower)) { vibeHits++; continue; }
      // Map vibe keywords to energy ranges
      const VIBE_ENERGY: Record<string, [number, number]> = {
        intimate: [2, 5], lively: [6, 9], cozy: [2, 5], elegant: [3, 6],
        casual: [3, 7], buzzing: [7, 10], chill: [2, 5], refined: [3, 6],
        warm: [3, 6], modern: [4, 8], funky: [6, 9],
      };
      if (dp.energy_level != null && VIBE_ENERGY[vibeLower]) {
        const [lo, hi] = VIBE_ENERGY[vibeLower];
        if (dp.energy_level >= lo && dp.energy_level <= hi) { vibeHits++; continue; }
      }
    }
    if (vibeHits > 0) {
      dataPoints++;
      atmoMaxPossible += 1.5;
      score += Math.min(1.5, vibeHits * 0.5);
    }
  }

  // V6.2: Extended vibe keyword matching via restaurant tags (0-1.5)
  // Maps common bar/nightlife/vibe search terms to relevant restaurant tags.
  // This handles queries like "speakeasy", "jazz bar", "tiki bar", "sports bar"
  // by checking restaurant tags, not just deep profile data.
  const VIBE_TAG_MAP: Record<string, string[]> = {
    speakeasy: ["cocktails", "hidden gem", "craft cocktails", "speakeasy"],
    jazz: ["live music", "jazz"],
    blues: ["live music", "blues"],
    "sports bar": ["lively", "sports"],
    karaoke: ["lively", "karaoke"],
    arcade: ["lively", "arcade"],
    tiki: ["cocktails", "tiki", "craft cocktails"],
    "dive bar": ["dive", "hidden gem", "great value"],
    "piano bar": ["live music", "piano", "romantic"],
    nightlife: ["lively", "cocktails", "late night", "craft cocktails"],
    "wine cellar": ["romantic", "wine", "quiet"],
    hipster: ["hidden gem", "trendy"],
    "rooftop bar": ["rooftop", "scenic", "cocktails"],
    "hotel bar": ["cocktails", "quiet"],
    "library bar": ["quiet", "cocktails"],
  };

  if (requestLower && profile.tags.length > 0) {
    const tagStrings = profile.tags.map((t: Tag) => (typeof t === "string" ? t : t.name || "").toLowerCase());
    let vibeTagHits = 0;
    for (const [vibeKey, matchPatterns] of Object.entries(VIBE_TAG_MAP)) {
      if (requestLower.includes(vibeKey)) {
        for (const pattern of matchPatterns) {
          if (tagStrings.some((ts: string) => ts.includes(pattern))) {
            vibeTagHits++;
            break;
          }
        }
      }
    }
    if (vibeTagHits > 0) {
      maxDataPoints++;
      atmoMaxPossible += 1.5;
      score += Math.min(1.5, vibeTagHits * 0.75);
      dataPoints++;
    }
  }

  // V6.1: Conversation friendliness bonus for date/romantic occasions (0-1.0)
  // Restaurants where you can actually talk are critical for date queries
  const dateOccasions = ["Date Night", "Anniversary", "Special Occasion"];
  if (dateOccasions.includes(occasion) && dp?.conversation_friendliness != null) {
    maxDataPoints++;
    atmoMaxAbsolute += 1.0;
    dataPoints++;
    atmoMaxPossible += 1.0;
    if (dp.conversation_friendliness >= 7) {
      score += 1.0;
    } else if (dp.conversation_friendliness >= 5) {
      score += 0.5;
    } else {
      score += 0;
    }
  }

  // Layer 3: Request-driven signals

  // Live music / entertainment if requested (from specialRequest or intent tags)
  const targetTags = intent?.target_tags || [];
  const targetFeatures = intent?.target_features || [];
  const wantsLiveMusic = requestLower.match(/live music|live band|live jazz|live dj|karaoke|entertainment/)
    || targetTags.some(t => /music|entertainment|dj|karaoke/i.test(t))
    || targetFeatures.includes("live_music");
  if (wantsLiveMusic) {
    maxDataPoints++;
    atmoMaxPossible += 1.5; // S2: track conditional layer in normalization denominator
    if (profile.live_music) {
      score += 1.5; dataPoints++;
    } else if (dp?.music_vibe && /live/.test(dp.music_vibe)) {
      score += 1.0; dataPoints++;
    } else if (profile.tags.some(t => /live music|live band|live jazz/i.test(t))) {
      score += 1.0; dataPoints++;
    }
  }

  // Specific music style matching (jazz, acoustic, blues)
  const musicStyleMatch = requestLower.match(/\bjazz\b|\bacoustic\b|\bblues\b/);
  if (musicStyleMatch && dp?.music_vibe) {
    maxDataPoints++;
    atmoMaxPossible += 1.0;
    if (dp.music_vibe.toLowerCase().includes(musicStyleMatch[0])) {
      score += 1.0; dataPoints++;
    }
  }

  // Outdoor if requested
  if (requestLower.match(/outdoor|patio|outside|al fresco|terrace/)) {
    maxDataPoints++;
    atmoMaxPossible += 1.0;
    if (profile.outdoor_seating) { score += 1; dataPoints++; }
  }

  // Scenic/waterfront tags
  if (requestLower.match(/view|scenic|waterfront|lakefront|rooftop/)) {
    maxDataPoints++;
    atmoMaxPossible += 1.0;
    const hasScenic = profile.tags.some(t =>
      /waterfront|lakefront|rooftop|scenic|skyline|river view/i.test(t)
    );
    if (hasScenic) { score += 1; dataPoints++; }
  }

  // Seasonal relevance
  if (dp?.seasonal_relevance) {
    maxDataPoints++;
    atmoMaxPossible += 0.5;
    const month = new Date().getUTCMonth();
    const season = month >= 2 && month <= 4 ? "spring"
      : month >= 5 && month <= 7 ? "summer"
      : month >= 8 && month <= 10 ? "fall"
      : "winter";
    const seasonScore = (dp.seasonal_relevance as Record<string, number>)[season] || 5;
    if (seasonScore >= 7) { score += 0.5; dataPoints++; }
  }

  // Instagram-worthy
  if (requestLower.match(/instagram|aesthetic|photogenic|cute/)) {
    maxDataPoints++;
    atmoMaxPossible += 1.0;
    if (dp?.instagram_worthiness != null && dp.instagram_worthiness >= 8) {
      score += 1;
      dataPoints++;
    }
  }

  // V3.2 (PA3): Cold-start safety — if no atmosphere data points at all, return conservative neutral
  // V3.6: raised from 3.5→4.0 to reflect that zero data is truly unknown, not slightly-bad
  if (dataPoints === 0) {
    return { score: 4.0, dataPoints: 0, maxDataPoints, details: { ambiance: { score: 0, max: 5, signal: "No data" }, energy: { score: 0, max: 3.5, signal: "No data" } } };
  }

  // V3.6: Normalize using adaptive denominator (only data-active layers in denominator)
  // The base layers' contributions to atmoMaxPossible are now conditional on data presence,
  // so a restaurant with noise+energy data but no lighting/dress scores against max=4.0 not 10.0.
  // Floor at 5.0 to prevent over-inflation when only 1-2 layers have data.
  const effectiveMax = Math.max(atmoMaxPossible, 5.0);

  // V6: Coverage discount — sparse atmosphere data cannot produce perfect scores.
  // Without this, 3/6 layers matching perfectly → 10.0 (the denominator shrinks to match
  // the numerator). The discount ensures only restaurants with complete atmosphere data
  // can reach 10.0. 3/6 layers → max 8.5, 4/6 → max 9.0, etc.
  const BASE_LAYER_COUNT = 6;
  const coveredBaseLayers = [
    profile.noise_level,
    profile.lighting_ambiance && (OCCASION_LIGHTING[occasion] || []).length > 0,
    profile.dress_code,
    dp?.energy_level != null,
    dp?.music_vibe,
    v2Intent?.vibe_keywords && v2Intent.vibe_keywords.length > 0 && dp,
  ].filter(Boolean).length;
  const coverageDiscount = 0.7 + 0.3 * (coveredBaseLayers / BASE_LAYER_COUNT);

  const normalizedAtmo = effectiveMax > 0
    ? Math.min(10, (score / effectiveMax) * 10 * coverageDiscount)
    : Math.min(10, score * coverageDiscount);

  // V3.6: Build sub-component details for UI drill-down (post-hoc from known data)
  const details: Record<string, V3SubComponent> = {};
  details.noise = { score: profile.noise_level && expectedNoise.includes(profile.noise_level) ? 2.0 : profile.noise_level ? 0.3 : 0, max: 2, signal: profile.noise_level || "No data" };
  details.lighting = { score: profile.lighting_ambiance && expectedLighting.length > 0 ? Math.min(2.0, expectedLighting.filter(kw => profile.lighting_ambiance!.toLowerCase().includes(kw)).length * 1.0) : 0, max: 2, signal: profile.lighting_ambiance || "No data" };
  details.dress = { score: profile.dress_code && (DRESS_LEVELS[profile.dress_code] || 1) >= (DRESS_LEVELS[expectedDressMin] || 1) ? 1 : profile.dress_code ? 0.3 : 0, max: 1, signal: profile.dress_code || "No data" };
  details.energy = { score: dp?.energy_level != null ? Math.min(2.0, Math.max(0, 2.0 - Math.abs(dp.energy_level - ((OCCASION_ENERGY[occasion] || [3, 7])[0] + (OCCASION_ENERGY[occasion] || [3, 7])[1]) / 2) * 0.4)) : 0, max: 2, signal: dp?.energy_level != null ? `Energy ${dp.energy_level}/10` : "No data" };
  details.music = { score: dp?.music_vibe && (MUSIC_FIT[occasion] || []).includes(dp.music_vibe) ? 1.5 : 0, max: 1.5, signal: dp?.music_vibe || "No data" };
  // V6.1: Conversation friendliness for date occasions
  if (dateOccasions.includes(occasion) && dp?.conversation_friendliness != null) {
    details.social = { score: dp.conversation_friendliness >= 7 ? 1.0 : dp.conversation_friendliness >= 5 ? 0.5 : 0, max: 1, signal: `Conversation ${dp.conversation_friendliness}/10` };
  }

  return {
    score: Math.max(0, normalizedAtmo),
    dataPoints,
    maxDataPoints,
    details,
  };
}

// ==========================================
// FACTOR 4: REPUTATION (0-10)
// ==========================================

export function computeReputation(
  profile: RestaurantProfile,
  googleData: GooglePlaceData | null,
  sentimentScore?: number | null,
  sentimentNegative?: number | null
): V3FactorResult {
  let score = 0;
  let dataPoints = 0;
  let maxDataPoints = 0;
  const details: Record<string, V3SubComponent> = {};

  const dp = profile.deep_profile;

  // Layer 1: Google rating (0-5 points) — V3.6: widened range + higher ceiling
  maxDataPoints++;
  let googleScore = 0;
  if (googleData && googleData.google_rating != null) {
    dataPoints++;
    const rating = googleData.google_rating;
    const reviewCount = googleData.google_review_count || 0;
    // V3.6: Widen stretch from 3.5-5.0 → 3.0-5.0, ceiling 4→5
    // Old: (4.5-3.5)*2.67 = 2.67/4 → 4.5★ with 200 reviews = 2.67 reputation points
    // New: (4.5-3.0)*2.5  = 3.75/5 → 4.5★ with 200 reviews = 3.75 reputation points
    // This gives a strong Google rating the weight users expect; a 4.8★ place now scores 4.5 instead of 3.5
    const normalized = Math.max(0, (rating - 3.0) * 2.5);
    const confidence = reviewCount >= 200 ? 1.0
      : reviewCount >= 50 ? 0.9
      : reviewCount >= 10 ? 0.8
      : 0.7;
    googleScore = Math.min(5, Math.max(0, normalized * confidence));
    score += googleScore;
    details.google = { score: googleScore, max: 5, signal: `${rating}★ (${reviewCount} reviews)` };
  } else {
    googleScore = 2.5;
    score += googleScore;
    details.google = { score: googleScore, max: 5, signal: "No Google data" };
  }

  // Layer 2: Sentiment from reviews (0-2 points)
  maxDataPoints++;
  let sentScore = 0;
  if (sentimentScore != null) {
    dataPoints++;
    sentScore = (sentimentScore / 10) * 2;
    if (sentimentNegative != null && sentimentNegative > 30) {
      sentScore -= Math.min(1.5, ((sentimentNegative - 30) / 40) * 1.5);
    }
    score += sentScore;
    details.sentiment = { score: Math.max(0, sentScore), max: 2, signal: `Score ${sentimentScore}/10` };
  } else {
    score += 1.0;
    details.sentiment = { score: 1.0, max: 2, signal: "No reviews" };
  }
  if (sentimentNegative != null && sentimentNegative > 30 && sentimentScore == null) {
    score -= Math.min(1.5, ((sentimentNegative - 30) / 40) * 1.5);
  }

  // Layer 3: Awards and recognition (0-2 points)
  maxDataPoints++;
  let awardsUsed = false;
  let awardsScore = 0;
  if (dp) {

    if (dp.awards_recognition && dp.awards_recognition.length > 0) {
      awardsScore += 1.0;
      awardsUsed = true;
    }
    if (dp.chef_notable) {
      awardsScore += 0.5;
      awardsUsed = true;
    }
    if (dp.cultural_authenticity != null && dp.cultural_authenticity >= 8) {
      awardsScore += 0.5;
      awardsUsed = true;
    }

    if (awardsUsed) {
      dataPoints++;
      score += Math.min(2, awardsScore);
    }
  }
  if (!awardsUsed) {
    score += 0.5;
    details.awards = { score: 0.5, max: 2, signal: "No awards data" };
  } else {
    details.awards = { score: Math.min(2, awardsScore), max: 2, signal: dp?.awards_recognition?.join(", ") || (dp?.chef_notable ? "Notable chef" : "Recognized") };
  }

  // Layer 4: Community standing (0-2 points)
  maxDataPoints++;
  let communityUsed = false;
  let communityScore = 0;
  if (dp) {

    if (dp.neighborhood_integration === "institution") {
      communityScore += 1.5;
      communityUsed = true;
    } else if (dp.neighborhood_integration === "destination") {
      communityScore += 1.0;
      communityUsed = true;
    } else if (dp.neighborhood_integration === "hidden_local") {
      communityScore += 0.5;
      communityUsed = true;
    }

    if (profile.trending_score != null && profile.trending_score >= 7) {
      communityScore += 0.5;
      communityUsed = true;
    }

    if (communityUsed) {
      dataPoints++;
      score += Math.min(2, communityScore);
    }
  }
  if (!communityUsed) {
    score += 0.5;
    details.community = { score: 0.5, max: 2, signal: "No community data" };
  } else {
    details.community = { score: Math.min(2, communityScore), max: 2, signal: dp?.neighborhood_integration || "Community presence" };
  }

  return {
    score: Math.min(10, Math.max(0, score)),
    dataPoints,
    maxDataPoints,
    details,
  };
}

// ==========================================
// FACTOR 5: CONVENIENCE (0-10)
// ==========================================

export function computeConvenience(
  profile: RestaurantProfile,
  intent: IntentClassification | IntentClassificationV2 | null,
  clientTimeOfDay?: string | null,
  specialRequest?: string
): V3FactorResult {
  let score = 4; // Start lower than neutral (was 5, S3/S6: lower floor, expand bonus range)
  let dataPoints = 0;
  let maxDataPoints = 0;

  const dp = profile.deep_profile;
  const v2Intent = intent && "spontaneity" in intent ? intent as IntentClassificationV2 : null;
  const requestLower = (specialRequest || "").toLowerCase();

  // Layer 1: Timing fit (-2 to +2.0) — expanded bonus range (S6)
  maxDataPoints++;
  const timeOfDay = clientTimeOfDay || null;
  if (timeOfDay && profile.best_times && profile.best_times.length > 0) {
    dataPoints++;
    if (profile.best_times.includes(timeOfDay)) {
      score += 2.0;   // was 1.5 — expanded bonus to compensate for lower start
    } else if (profile.best_times.length <= 2) {
      // Narrow-focus restaurant at wrong time
      score -= 2;
    } else {
      score -= 0.5;
    }
  }

  // Layer 2: Reservation accessibility (-2.5 to +2.0) — rebalanced (S6)
  maxDataPoints++;
  if (dp?.reservation_difficulty) {
    dataPoints++;
    const isSpontaneous = v2Intent?.spontaneity === "spontaneous"
      || requestLower.match(/tonight|right now|last minute|walk.?in|spontaneous/);

    if (dp.reservation_difficulty === "hard_to_get" && isSpontaneous) {
      score -= 2.5;  // was -3 — reduced to prevent double-floor-clamp (S6)
    } else if (dp.reservation_difficulty === "walk_in_friendly") {
      score += isSpontaneous ? 2.0 : 0.5;  // was 1.5 — expanded bonus
    }
  }

  // Wait time
  maxDataPoints++;
  if (dp?.typical_wait_minutes != null) {
    dataPoints++;
    if (dp.typical_wait_minutes > 60) score -= 1.0;    // was -1.5 — reduced (S6)
    else if (dp.typical_wait_minutes > 30) score -= 0.5;
    else score += 1.0; // Short wait is a positive (was +0.5, S6: expanded bonus)
  }

  // Layer 3: Practical notes (-0.5 to +1.5)
  if (dp?.payment_notes && dp.payment_notes.toLowerCase().includes("cash")) {
    maxDataPoints++;
    dataPoints++;
    score -= 0.5;
  }

  // BYOB matching (broader detection — from specialRequest or intent practical_constraints)
  const v2IntentForConstraints = intent && "practical_constraints" in intent ? intent as IntentClassificationV2 : null;
  const constraints = v2IntentForConstraints?.practical_constraints || [];
  const wantsByob = requestLower.includes("byob") || constraints.includes("byob_preference");
  if (wantsByob) {
    maxDataPoints++;
    if (dp?.byob_policy && dp.byob_policy.toLowerCase().includes("byob")) {
      dataPoints++;
      score += 1.5;
    } else if (profile.tags.some(t => /byob/i.test(t))) {
      dataPoints++;
      score += 1.5;
    }
  }

  // Parking positive signal
  if (profile.parking_availability && !/none|no /i.test(profile.parking_availability)) {
    score += 0.5;
  }

  // V3.6: Build sub-component details for UI drill-down
  const finalScore = Math.min(10, Math.max(0, score));
  const details: Record<string, V3SubComponent> = {};
  const timingDelta = (timeOfDay && profile.best_times?.includes(timeOfDay)) ? 2.0 : (timeOfDay && profile.best_times?.length ? (profile.best_times.length <= 2 ? -2 : -0.5) : 0);
  details.timing = { score: Math.max(0, 4 + timingDelta), max: 6, signal: timeOfDay && profile.best_times?.includes(timeOfDay) ? `Good for ${timeOfDay}` : timeOfDay ? "Off-peak" : "No time data" };
  details.reservation = { score: dp?.reservation_difficulty === "walk_in_friendly" ? 2 : dp?.reservation_difficulty === "hard_to_get" ? 0 : 1, max: 2, signal: dp?.reservation_difficulty || "No data" };
  details.practical = { score: Math.max(0, finalScore - (4 + timingDelta) - (dp?.reservation_difficulty === "walk_in_friendly" ? 2 : dp?.reservation_difficulty === "hard_to_get" ? -2.5 : 0)), max: 2, signal: profile.parking_availability || "Standard" };

  return {
    score: finalScore,
    dataPoints,
    maxDataPoints,
    details,
  };
}

// ==========================================
// DYNAMIC WEIGHTS
// ==========================================

export function computeV3Weights(
  occasion: string,
  intent: IntentClassification | IntentClassificationV2 | null
): V3Weights {
  let w: V3Weights = { food: 0.30, setting: 0.25, atmosphere: 0.20, reputation: 0.15, convenience: 0.10 };
  const v2Intent = intent && "emotional_intent" in intent ? intent as IntentClassificationV2 : null;

  // Cuisine-driven requests: food dominates; experience queries: atmosphere/convenience dominate
  if (intent?.cuisine_importance === "high") {
    w = { food: 0.45, setting: 0.15, atmosphere: 0.15, reputation: 0.15, convenience: 0.10 };
  } else if (intent?.cuisine_importance === "medium") {
    w = { food: 0.35, setting: 0.20, atmosphere: 0.20, reputation: 0.15, convenience: 0.10 };
  } else if (intent?.cuisine_importance === "low") {
    w = { food: 0.15, setting: 0.20, atmosphere: 0.30, reputation: 0.15, convenience: 0.20 };
  }

  // Occasion overrides — always blend with cuisine weights (V3.6: high cuisine no longer skips occasion)
  // V3.6 fix: "best sushi for a date night" was ignoring the date night signal entirely
  // because cuisine_importance="high" bypassed this block. Now high=70/30, medium=40/60, low=0/100.
  {
    let occasionW: V3Weights | null = null;
    if (["Date Night", "Special Occasion"].includes(occasion)) {
      occasionW = { food: 0.20, setting: 0.30, atmosphere: 0.25, reputation: 0.15, convenience: 0.10 };
    } else if (occasion === "Adventure") {
      // V3.2 (HB6): Increased setting 0.15→0.25 (where hole_in_wall_factor lives),
      // decreased food 0.25→0.20 (users explicitly de-prioritize cuisine for adventure)
      occasionW = { food: 0.20, setting: 0.25, atmosphere: 0.15, reputation: 0.25, convenience: 0.15 };
    } else if (occasion === "Family Dinner") {
      occasionW = { food: 0.25, setting: 0.25, atmosphere: 0.15, reputation: 0.15, convenience: 0.20 };
    } else if (occasion === "Business Lunch") {
      occasionW = { food: 0.20, setting: 0.30, atmosphere: 0.25, reputation: 0.15, convenience: 0.10 };
    } else if (occasion === "Solo Dining") {
      // V3.3 (PA1): Solo diners prioritize convenience (walk-in, bar seating) + food quality
      occasionW = { food: 0.30, setting: 0.15, atmosphere: 0.20, reputation: 0.15, convenience: 0.20 };
    } else if (occasion === "Treat Myself") {
      // V3.3 (PA1): Treat Myself emphasizes food + atmosphere (self-indulgence experience)
      occasionW = { food: 0.30, setting: 0.15, atmosphere: 0.25, reputation: 0.20, convenience: 0.10 };
    } else if (occasion === "Chill Hangout") {
      // V3.3 (PA1): Chill Hangout favors atmosphere + convenience (low-key, easy access)
      occasionW = { food: 0.20, setting: 0.20, atmosphere: 0.25, reputation: 0.10, convenience: 0.25 };
    }
    if (occasionW) {
      // Blend ratio by cuisine importance:
      //   high   → 70% cuisine + 30% occasion (V3.6: was 100/0 — user filters now respected)
      //   medium → 40% cuisine + 60% occasion (unchanged)
      //   low    → 0% cuisine + 100% occasion (unchanged)
      const cuisineBlend = intent?.cuisine_importance === "high" ? 0.7
        : intent?.cuisine_importance === "medium" ? 0.4
        : 0.0;
      w = {
        food: w.food * cuisineBlend + occasionW.food * (1 - cuisineBlend),
        setting: w.setting * cuisineBlend + occasionW.setting * (1 - cuisineBlend),
        atmosphere: w.atmosphere * cuisineBlend + occasionW.atmosphere * (1 - cuisineBlend),
        reputation: w.reputation * cuisineBlend + occasionW.reputation * (1 - cuisineBlend),
        convenience: w.convenience * cuisineBlend + occasionW.convenience * (1 - cuisineBlend),
      };
    }
  }

  // Emotional intent fine-tuning
  if (v2Intent?.emotional_intent === "explore") {
    w.reputation += 0.05; w.food -= 0.05;
  } else if (v2Intent?.emotional_intent === "comfort") {
    w.atmosphere += 0.05; w.reputation -= 0.05;
  } else if (v2Intent?.emotional_intent === "impress") {
    w.reputation += 0.05; w.convenience -= 0.05;
  }

  // Normalize to sum to 1.0
  const sum = w.food + w.setting + w.atmosphere + w.reputation + w.convenience;
  if (Math.abs(sum - 1.0) > 0.001) {
    w.food /= sum;
    w.setting /= sum;
    w.atmosphere /= sum;
    w.reputation /= sum;
    w.convenience /= sum;
  }

  return w;
}

// ==========================================
// DEAL-BREAKER GATES
// ==========================================

export function applyDealBreakerGates(
  candidates: RestaurantProfile[],
  exclude: string[],
  dietaryRestrictions?: string[]
): { passed: RestaurantProfile[]; gated: Map<string, string> } {
  const passed: RestaurantProfile[] = [];
  const gated = new Map<string, string>();

  for (const r of candidates) {
    // Gate 1: Previously excluded
    if (exclude.includes(r.id)) {
      gated.set(r.id, "excluded");
      continue;
    }

    // Gate 2: Dietary hard block
    if (dietaryRestrictions && dietaryRestrictions.length > 0 && r.dietary_options && r.dietary_options.length > 0) {
      const hasNone = dietaryRestrictions.every(dr => {
        const keywords = DIETARY_KEYWORDS[dr.toLowerCase()];
        if (!keywords) return true; // Unknown restriction → don't block
        return !r.dietary_options!.some(opt =>
          keywords.some(kw => opt.toLowerCase().includes(kw.toLowerCase()))
        );
      });

      if (hasNone) {
        // Check hierarchy (Vegan→Vegetarian partial credit)
        let hasHierarchyMatch = false;
        for (const dr of dietaryRestrictions) {
          const subsumes = DIETARY_HIERARCHY[dr.toLowerCase()];
          if (subsumes) {
            hasHierarchyMatch = subsumes.some(sub => {
              const subValues = DIETARY_KEYWORDS[sub];
              if (!subValues) return false;
              return r.dietary_options!.some(opt =>
                subValues.some(sv => opt.toLowerCase().includes(sv.toLowerCase()))
              );
            });
            if (hasHierarchyMatch) break;
          }
        }
        if (!hasHierarchyMatch) {
          gated.set(r.id, "dietary_mismatch");
          continue;
        }
      }
    }

    passed.push(r);
  }

  return { passed, gated };
}

// ==========================================
// DEAL-BREAKER PENALTIES (on composite)
// ==========================================

function applyDealBreakerPenalties(
  composite: number,
  profile: RestaurantProfile,
  occasion: string,
  neighborhood: string,
  priceLevel: string,
  intent: IntentClassification | IntentClassificationV2 | null,
  sentimentNegative?: number | null,
  dietaryRestrictions?: string[]
): { result: number; priceAlreadyPenalized: boolean } {
  let result = composite;

  // NOTE: Cuisine mismatch penalty REMOVED — Food Match factor already handles cuisine
  // alignment (0 pts for mismatch). Having a separate multiplicative penalty here
  // double-counted the miss, crushing fallback scores to near-zero (e.g., 3%).

  // V3.3 (HB4): Dietary incompatibility composite-level penalty
  // The Food Match factor only allocates 2 of 11 points to dietary fit, which is ~18%.
  // With low cuisine_importance (food weight 0.15), dietary mismatch has near-zero impact
  // on the composite. A vegan user seeing a BBQ joint scored 59 ("Worth a Try") is the
  // single most trust-damaging false positive. Apply composite penalty to fix.
  if (dietaryRestrictions && dietaryRestrictions.length > 0) {
    if (profile.dietary_options && profile.dietary_options.length > 0) {
      // Restaurant has dietary data — check if any match
      const anyMatch = dietaryRestrictions.some(dr => {
        const keywords = DIETARY_KEYWORDS[dr.toLowerCase()];
        if (!keywords) return false;
        return profile.dietary_options!.some(opt =>
          keywords.some(kw => opt.toLowerCase().includes(kw.toLowerCase()))
        );
      });
      if (!anyMatch) {
        // Check hierarchy (Vegan → Vegetarian partial credit)
        let hasHierarchyMatch = false;
        for (const dr of dietaryRestrictions) {
          const subsumes = DIETARY_HIERARCHY[dr.toLowerCase()];
          if (subsumes) {
            hasHierarchyMatch = subsumes.some(sub => {
              const subValues = DIETARY_KEYWORDS[sub];
              if (!subValues) return false;
              return profile.dietary_options!.some(opt =>
                subValues.some(sv => opt.toLowerCase().includes(sv.toLowerCase()))
              );
            });
            if (hasHierarchyMatch) break;
          }
        }
        if (hasHierarchyMatch) {
          result -= 0.8;  // Partial match (e.g., vegan at vegetarian-only place)
        } else {
          result -= 2.0;  // Has dietary options but none match at all
        }
      }
    } else if (!profile.dietary_options || profile.dietary_options.length === 0) {
      // No dietary data at all — unknown = risky for dietary-restricted users
      result -= 2.5;
    }
  }

  // Price mismatch — unified subtractive penalties (P1 fix: ISSUE-1)
  // All penalties are subtractive so magnitude is independent of base score
  // and commutative with other penalties. Values calibrated to approximate
  // previous multiplicative behavior at mean composite (~5.0).
  // V3.3 (S10): Track whether price was penalized here to prevent stacking with avoidPriceLevels
  let priceAlreadyPenalized = false;
  if (priceLevel && priceLevel !== "Any" && profile.price_level) {
    const userIdx = PRICE_ORDER.indexOf(priceLevel);
    const restIdx = PRICE_ORDER.indexOf(profile.price_level);
    if (userIdx >= 0 && restIdx >= 0) {
      const gap = restIdx - userIdx;
      if (gap >= 3) { result -= 3.0; priceAlreadyPenalized = true; }
      else if (gap === 2) { result -= 1.5; priceAlreadyPenalized = true; }    // was -2.0 — diminishing sensitivity (HB6)
      else if (gap === 1) { result -= 0.5; priceAlreadyPenalized = true; }
      // Under-budget penalty removed (HB6: budgets are ceilings, not targets)
    }
  }

  // Neighborhood mismatch — V3.2 (HB3): reduced -1.0→-0.6
  // 2.5:1 ratio vs 2-tier price penalty matches mental accounting asymmetry (Thaler, 1985)
  // Price = direct out-of-pocket loss; neighborhood = soft logistical inconvenience
  if (neighborhood && neighborhood !== "Anywhere" && profile.neighborhood_name) {
    if (profile.neighborhood_name.toLowerCase() !== neighborhood.toLowerCase()) {
      result -= 0.6;
    }
  }

  // Sentiment crisis — REMOVED (P0 fix: sentiment double-counting)
  // Sentiment is already handled in computeReputation() where negative sentiment
  // penalizes the Reputation factor by up to -1.5. Having a second penalty here
  // double-counts the same signal, creating a combined ~15 DM point penalty from
  // a single source. The Reputation factor is the correct place for this signal.

  // V3.2 (PT4): No intermediate clamp — allow negative values to flow to personalization
  // Single clamp at Math.max(0) applied after ALL penalties in computeV3DondeMatch
  return { result, priceAlreadyPenalized };
}

// ==========================================
// PERSONALIZATION ADJUSTMENTS
// ==========================================

function applyPersonalization(
  composite: number,
  profile: RestaurantProfile,
  rejectionSignals?: RejectionSignals,
  userFeedback?: UserFeedbackSignals | null,
  priceAlreadyPenalized?: boolean
): number {
  let result = composite;

  // User feedback history — recalibrated for Prospect Theory 2x ratio (PA5, HB1)
  let cuisineAlreadyPenalized = false;
  if (userFeedback) {
    if (profile.cuisine_type && userFeedback.likedCuisines.includes(profile.cuisine_type)) {
      result += 1.0;   // V3.4 (S9): 1:1 ratio with dislike -1.0 (was 0.5)
    }
    if (profile.cuisine_type && userFeedback.dislikedCuisines.includes(profile.cuisine_type)) {
      result -= 1.0;   // unchanged — now 2.0:1 ratio (matches Prospect Theory)
      cuisineAlreadyPenalized = true;
    }
    if (userFeedback.dislikedRestaurantIds.includes(profile.id)) {
      result -= 2.0;   // was -2.5 — reduced to avoid destroying otherwise good matches
    }
  }

  // Rejection pattern analysis
  // V3.2 (PA5): Prevent stacking — avoidCuisine skipped if already penalized by dislikedCuisines
  // V3.3 (PA3): Inverted hierarchy fix — avoidCuisine is inferred (weaker signal) than explicit
  // dislikedCuisines (-1.0). Was -2.0, now -0.7 to respect: explicit dislike > inferred pattern.
  if (rejectionSignals) {
    if (profile.cuisine_type && rejectionSignals.avoidCuisines.includes(profile.cuisine_type)) {
      if (!cuisineAlreadyPenalized) {
        result -= 0.7;  // V3.3: was -2.0; inferred signal should be weaker than explicit -1.0
      }
      // else: dislikedCuisines -1.0 already applied above; skip to prevent stacking
    }
    // V3.3 (S10): Prevent stacking — skip avoidPriceLevels if deal-breaker price penalty already applied
    if (profile.price_level && rejectionSignals.avoidPriceLevels.includes(profile.price_level)) {
      if (!priceAlreadyPenalized) {
        result -= 1.5;
      }
      // else: deal-breaker price penalty already applied; skip to prevent stacking
    }
  }

  // V3.2 (PT4): No intermediate clamp — single clamp in computeV3DondeMatch after all penalties
  return result;
}

// ==========================================
// V3 DONDE MATCH (full pipeline)
// ==========================================

export interface V3DondeMatchInputs {
  occasion: string;
  specialRequest: string;
  neighborhood: string;
  priceLevel: string;
  googleData: GooglePlaceData | null;
  claudeRelevance?: number;
  sentimentScore?: number | null;
  sentimentNegative?: number | null;
  intent: IntentClassification | IntentClassificationV2 | null;
  rejectionSignals?: RejectionSignals;
  userFeedback?: UserFeedbackSignals | null;
  clientTimeOfDay?: string | null;
  dietaryRestrictions?: string[];
}

export function computeV3DondeMatch(
  profile: RestaurantProfile,
  inputs: V3DondeMatchInputs
): { dondeMatch: number; factors: V3Factors; weights: V3Weights; dataCompleteness: number; factorDetails?: Record<string, Record<string, V3SubComponent>> } {
  // Step 1: Compute each factor
  const foodResult = computeFoodMatch(profile, inputs.intent, inputs.dietaryRestrictions, inputs.specialRequest);
  const settingResult = computeSettingFit(profile, inputs.occasion, inputs.intent);
  const atmosphereResult = computeAtmosphere(profile, inputs.occasion, inputs.intent, inputs.specialRequest);
  const reputationResult = computeReputation(profile, inputs.googleData, inputs.sentimentScore, inputs.sentimentNegative);
  const convenienceResult = computeConvenience(profile, inputs.intent, inputs.clientTimeOfDay, inputs.specialRequest);

  // Apply enrichment confidence gating — Bayesian shrinkage toward prior mean
  // V3.2 (PT2, PA9, S4): Only gate factors that depend on deep_profile enrichment data
  // Reputation (Google API + sentiment) and Convenience (timing/reservation) are NOT gated
  // because enrichment_confidence measures AI enrichment quality, not Google/DB data quality
  const dp = profile.deep_profile;
  const PRIOR_MEAN = 5.5;  // V3.4 (PT1): raised toward population mean (was 5.0)
  // V3.2 (PA3): null deep_profile = lowest confidence (was: bypassed gating entirely)
  const enrichConf = dp?.enrichment_confidence ?? 0;
  const needsGating = enrichConf < 3;  // V3.4 (S3): only gate very-low-confidence (was < 5)
  const shrinkageWeight = needsGating
    ? enrichConf / 6   // V3.4: 0.0 to 0.33 for conf 0-2 (was enrichConf / 10)
    : 1.0;

  const applyGating = (score: number): number => {
    if (!needsGating) return score;
    return PRIOR_MEAN * (1 - shrinkageWeight) + score * shrinkageWeight;
  };

  // V3.3 (S6): Atmosphere cold-start (dataPoints===0) already returns neutral 3.5;
  // gating it further toward 5.0 would INCREASE the score (Bayesian inversion).
  // Skip gating when the factor had no enrichment data to gate.
  const atmoScore = atmosphereResult.dataPoints === 0
    ? atmosphereResult.score  // V3.3: cold-start bypass — 3.5 neutral is already conservative
    : applyGating(atmosphereResult.score);

  const factors: V3Factors = {
    food: applyGating(foodResult.score),          // uses flavor_profiles, signature_dishes, dietary_depth
    setting: applyGating(settingResult.score),     // uses service_style, meal_pacing, kid_friendliness
    atmosphere: atmoScore,                         // V3.3: cold-start bypass when no data points
    reputation: reputationResult.score,            // Google data + sentiment — independent of enrichment
    convenience: convenienceResult.score,           // timing/reservation — independent of enrichment
  };

  // Step 2: Dynamic weights
  const weights = computeV3Weights(inputs.occasion, inputs.intent);

  // Step 3: Factor decorrelation — discount overlapping quality signals
  // Setting/Atmosphere: share noise/energy/conversation data (PT1 fix)
  if (factors.setting > 7 && factors.atmosphere > 7) {
    const overlap = Math.min(factors.setting - 7, factors.atmosphere - 7) * 0.10; // V3.4 (S7/PT5): was 0.15
    factors.atmosphere = Math.max(0, factors.atmosphere - overlap);
  }
  // V3.2 (PA1): Food/Reputation: share quality signals via cuisine alignment + awards/authenticity
  // Coefficient 0.10 (smaller than Setting/Atmo's 0.15 — correlation is weaker)
  if (factors.food > 7 && factors.reputation > 7) {
    const qualityOverlap = Math.min(factors.food - 7, factors.reputation - 7) * 0.05; // V3.4 (S7/PT5): was 0.10
    factors.reputation = Math.max(0, factors.reputation - qualityOverlap);
  }

  // Step 3b: Weighted composite (0-10)
  let raw = factors.food * weights.food
    + factors.setting * weights.setting
    + factors.atmosphere * weights.atmosphere
    + factors.reputation * weights.reputation
    + factors.convenience * weights.convenience;

  // Step 3c: Quality match bonus — rewards multi-factor excellence (V3.4 S1/S8)
  let qualityBonus = 0;
  const factorScores = [factors.food, factors.setting, factors.atmosphere,
                        factors.reputation, factors.convenience];
  const highFactors = factorScores.filter(f => f >= 6.5).length;
  const allAboveFloor = factorScores.every(f => f >= 5.0);
  const dominantScore = Math.max(...factorScores);
  if (highFactors >= 3) qualityBonus += 0.5;       // Multi-factor excellence
  if (allAboveFloor) qualityBonus += 0.3;           // Well-rounded match
  if (dominantScore >= 8.0) qualityBonus += 0.3;    // Strong lead factor
  raw += Math.min(0.8, qualityBonus);                // Cap total quality bonus at +0.8

  // Step 4: Claude relevance modulation — applied to composite, not factors (S8, PT4, HB5)
  // This preserves factor display integrity and avoids boundary clamping losses
  if (inputs.claudeRelevance != null) {
    const relevanceAdjust = (inputs.claudeRelevance - 5) * 0.1; // -0.5 to +0.5
    raw += relevanceAdjust;  // Direct composite adjustment (was: mutated food+setting factors)
  }

  // Step 5: Deal-breaker penalties
  const dealBreakerResult = applyDealBreakerPenalties(
    raw, profile,
    inputs.occasion, inputs.neighborhood, inputs.priceLevel,
    inputs.intent, inputs.sentimentNegative,
    inputs.dietaryRestrictions
  );
  raw = dealBreakerResult.result;

  // Step 6: Personalization
  raw = applyPersonalization(raw, profile, inputs.rejectionSignals, inputs.userFeedback, dealBreakerResult.priceAlreadyPenalized);

  // V3.2 (PT4): Single clamp after all penalties — raw may be negative from stacked subtractive penalties
  raw = Math.max(0, raw);

  // Step 7: Map to 0-99 with power-law scaling (HB3, PT8)
  // V3.4 (S1/S2/PT4): Exponent 0.85→0.73 lifts mid-range scores; multiplier 105→116 scales ceiling
  // Combined effect: mean ~55→70, median ~58→75, max 88→95+
  // Clamp at 99 prevents overflow; practical max ~97-99 for genuine perfect matches
  const rawNormalized = Math.max(0, Math.min(1, raw / 10));  // Normalize to 0-1
  const scaled = Math.pow(rawNormalized, 0.73);                // V3.4: power-law stretch (was 0.85)
  const dondeMatch = Math.min(99, Math.max(0, Math.round(scaled * 116))); // V3.4: scale (was 105)

  // Data completeness
  const totalDataPoints = foodResult.dataPoints + settingResult.dataPoints
    + atmosphereResult.dataPoints + reputationResult.dataPoints + convenienceResult.dataPoints;
  const totalMaxPoints = foodResult.maxDataPoints + settingResult.maxDataPoints
    + atmosphereResult.maxDataPoints + reputationResult.maxDataPoints + convenienceResult.maxDataPoints;
  const dataCompleteness = totalMaxPoints > 0 ? totalDataPoints / totalMaxPoints : 0;

  // V3.6: Collect sub-component details from each factor for UI drill-down
  const factorDetails: Record<string, Record<string, V3SubComponent>> = {};
  if (foodResult.details) factorDetails.food_match = foodResult.details;
  if (settingResult.details) factorDetails.setting_fit = settingResult.details;
  if (atmosphereResult.details) factorDetails.atmosphere = atmosphereResult.details;
  if (reputationResult.details) factorDetails.reputation = reputationResult.details;
  if (convenienceResult.details) factorDetails.convenience = convenienceResult.details;

  return { dondeMatch, factors, weights, dataCompleteness, factorDetails };
}

// ==========================================
// V3 RE-RANK
// ==========================================

export function reRankV3(
  profiles: RestaurantProfile[],
  occasion: string,
  specialRequest: string,
  rejectionSignals?: RejectionSignals,
  intent?: IntentClassification | IntentClassificationV2 | null,
  userFeedback?: UserFeedbackSignals | null,
  clientTimeOfDay?: string | null,
  dietaryRestrictions?: string[]
): RestaurantProfile[] {
  const scored = profiles.map(p => {
    // Compute V3 factors without Google data (not available at ranking time)
    const { dondeMatch } = computeV3DondeMatch(p, {
      occasion,
      specialRequest,
      neighborhood: "Anywhere", // Don't penalize at ranking time (pre-filter handles this)
      priceLevel: "Any",       // Don't penalize at ranking time
      googleData: null,        // Not available yet
      intent: intent ?? null,
      rejectionSignals,
      userFeedback,
      clientTimeOfDay,
      dietaryRestrictions,
    });
    return { profile: p, score: dondeMatch };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.profile);
}

// ==========================================
// HELPERS
// ==========================================

function isRelatedCuisine(cuisine: string, targets: string[]): boolean {
  // Try exact key lookup first
  let family = CUISINE_TO_FAMILY[cuisine];

  // Fallback: substring match for variants like "Modern Indian" → find "Indian" in keys
  if (!family) {
    const cuisineLower = cuisine.toLowerCase();
    const match = Object.entries(CUISINE_TO_FAMILY).find(
      ([key]) => cuisineLower.includes(key.toLowerCase())
    );
    if (match) family = match[1];
  }

  if (!family) return false;
  return targets.some(t => {
    // Direct family match (e.g., "Mediterranean" when "Greek" is the restaurant)
    if (t.toLowerCase() === family!.toLowerCase()) return true;
    // Same family match (e.g., "Greek" restaurant when "Italian" requested — both Mediterranean)
    let targetFamily = CUISINE_TO_FAMILY[t];
    if (!targetFamily) {
      const tLower = t.toLowerCase();
      const tmatch = Object.entries(CUISINE_TO_FAMILY).find(
        ([key]) => tLower.includes(key.toLowerCase())
      );
      if (tmatch) targetFamily = tmatch[1];
    }
    return targetFamily === family;
  });
}

// Flavor intent extraction (from special_request text)
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

function extractFlavorIntent(specialRequest: string): string[] {
  const lower = specialRequest.toLowerCase();
  const matches: string[] = [];
  for (const [keyword, flavors] of Object.entries(FLAVOR_KEYWORDS)) {
    if (lower.includes(keyword)) {
      matches.push(...flavors);
    }
  }
  return [...new Set(matches)];
}
