/**
 * Donde Match V3.1 — Scoring Engine (Optimized)
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

export interface V3FactorResult {
  score: number;
  dataPoints: number;
  maxDataPoints: number;
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

  const dp = profile.deep_profile;
  const v2Intent = intent && "flavor_preferences" in intent ? intent as IntentClassificationV2 : null;

  // Layer 1: Cuisine alignment (0-6 points) — increased from 0-5 to expand factor ceiling (S1 fix)
  maxDataPoints++;
  const targetCuisines = intent?.target_cuisines || [];

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
        score += 6;       // was 5 — expanded to use more of 0-10 budget (S1)
      } else if (containsMatch) {
        score += 5.5;     // was 4.5
      } else if (dp?.cuisine_subcategory) {
        const subLower = dp.cuisine_subcategory.toLowerCase();
        if (targetCuisines.some(c => subLower.includes(c.toLowerCase()))) {
          score += 5;     // was 4
        } else if (isRelatedCuisine(profile.cuisine_type, targetCuisines)) {
          score += 3.5;   // was 3
        }
      } else if (isRelatedCuisine(profile.cuisine_type, targetCuisines)) {
        score += 3.5;     // was 3
      }
      // mismatch = 0 points (not a penalty, just no points)
    }
  } else {
    // No cuisine requested — reduced baseline (S3: lower neutral defaults)
    score += 2.5;  // was 3
  }

  // Layer 2: Flavor profile match (0-2 points)
  maxDataPoints++;
  if (dp?.flavor_profiles && dp.flavor_profiles.length > 0) {
    dataPoints++;
    const flavorPrefs = v2Intent?.flavor_preferences || extractFlavorIntent(specialRequest || "");
    if (flavorPrefs.length > 0) {
      const overlapCount = flavorPrefs.filter(f =>
        dp.flavor_profiles!.some(fp => fp.toLowerCase().includes(f.toLowerCase()))
      ).length;
      score += Math.min(2, overlapCount * 0.7);
    }
  }

  // Layer 3: Dietary fit (0-2 points)
  maxDataPoints++;
  if (dietaryRestrictions && dietaryRestrictions.length > 0) {
    if (dp?.dietary_depth) {
      dataPoints++;
      if (dp.dietary_depth === "dedicated") score += 2;
      else if (dp.dietary_depth === "solid") score += 1.5;
      else if (dp.dietary_depth === "token") score += 0.5;
    } else if (profile.dietary_options && profile.dietary_options.length > 0) {
      dataPoints++;
      const allMatch = dietaryRestrictions.every(dr => {
        const keywords = DIETARY_KEYWORDS[dr.toLowerCase()];
        if (!keywords) return false;
        return profile.dietary_options!.some(opt =>
          keywords.some(kw => opt.toLowerCase().includes(kw.toLowerCase()))
        );
      });
      if (allMatch) score += 1;
      else {
        // Partial match
        const someMatch = dietaryRestrictions.some(dr => {
          const keywords = DIETARY_KEYWORDS[dr.toLowerCase()];
          if (!keywords) return false;
          return profile.dietary_options!.some(opt =>
            keywords.some(kw => opt.toLowerCase().includes(kw.toLowerCase()))
          );
        });
        if (someMatch) score += 0.5;
      }
    }
  } else {
    // No dietary restriction — restaurant passes by default (reduced from 1.0, S3)
    score += 0.5;
    dataPoints++;
  }

  // Layer 4: Menu interest signal (0-1 point)
  maxDataPoints++;
  const requestLower = (specialRequest || "").toLowerCase();
  if (dp?.signature_dishes && Array.isArray(dp.signature_dishes) && dp.signature_dishes.length > 0 && requestLower.length > 2) {
    dataPoints++;
    const dishMatch = dp.signature_dishes.some(d => {
      const dishWords = d.dish.toLowerCase().split(/\s+/);
      return dishWords.some(w => w.length > 3 && requestLower.includes(w));
    });
    if (dishMatch) score += 1;
  } else if (profile.tags.length > 0) {
    dataPoints++;
    // Check food-relevant tag matches
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
    if (tagMatch) score += 0.5;
  }

  // Normalize to 0-10
  const maxPossible = 10; // 5 + 2 + 2 + 1
  const normalized = Math.min(10, (score / maxPossible) * 10);

  // No cuisine_type → cap at 4
  if (!profile.cuisine_type && targetCuisines.length > 0) {
    return { score: Math.min(4, normalized), dataPoints, maxDataPoints };
  }

  // No food intent → floor at neutral 5
  // When cuisine_importance is "low" (experience query like "byob spot, live music"),
  // or when there's no special request at all, don't punish food score.
  // EXCEPTION: Do NOT apply floor when dietary restrictions are present —
  // the dietary signal must be preserved (ANOMALY-1 fix).
  if (targetCuisines.length === 0) {
    if ((intent?.cuisine_importance === "low" || !specialRequest || specialRequest.trim().length < 3)
        && (!dietaryRestrictions || dietaryRestrictions.length === 0)) {
      return { score: Math.max(normalized, 5), dataPoints, maxDataPoints };
    }
  }

  return { score: normalized, dataPoints, maxDataPoints };
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

  // Occasion "Any" → use average + baseline (reduced neutral, S3)
  if (occasion === "Any" && occasionBase === 0) {
    return { score: 4, dataPoints, maxDataPoints }; // was 5
  }

  return { score: clamped, dataPoints, maxDataPoints };
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
  let score = 0;
  let dataPoints = 0;
  let maxDataPoints = 0;

  const dp = profile.deep_profile;
  const v2Intent = intent && "vibe_keywords" in intent ? intent as IntentClassificationV2 : null;
  const requestLower = (specialRequest || "").toLowerCase();

  // Layer 1: Basic ambiance signals (0-4 points)

  // Track max possible for normalization (S2: normalize Atmosphere like Food Match)
  let atmoMaxPossible = 0;

  // Noise match (0-2.0) — increased from 0-1.5 for better range (S1)
  maxDataPoints++;
  atmoMaxPossible += 2.0;
  const expectedNoise = OCCASION_NOISE[occasion] || OCCASION_NOISE.Any;
  if (profile.noise_level) {
    dataPoints++;
    if (expectedNoise.includes(profile.noise_level)) {
      score += 2.0;     // was 1.5
    } else {
      score += 0.3;     // was 0.5 — reduced mismatch neutral (S3)
    }
  }
  // No neutral for missing data (S3: zero-information = zero score)

  // Lighting match (0-2.0) — increased from 0-1.5 (S1)
  maxDataPoints++;
  atmoMaxPossible += 2.0;
  const expectedLighting = OCCASION_LIGHTING[occasion] || [];
  if (profile.lighting_ambiance && expectedLighting.length > 0) {
    dataPoints++;
    const lightingLower = profile.lighting_ambiance.toLowerCase();
    const lightingMatches = expectedLighting.filter(kw => lightingLower.includes(kw)).length;
    if (lightingMatches > 0) {
      score += Math.min(2.0, lightingMatches * 1.0);  // was 1.5, 0.75
    }
  } else if (expectedLighting.length === 0) {
    score += 0.5; // no expectation → small neutral
    atmoMaxPossible -= 0.5; // adjust denominator
  }
  // No neutral for missing data (S3)

  // Dress code appropriateness (0-1)
  maxDataPoints++;
  atmoMaxPossible += 1.0;
  const expectedDressMin = OCCASION_DRESS_MIN[occasion] || "Casual";
  if (profile.dress_code) {
    dataPoints++;
    const restaurantLevel = DRESS_LEVELS[profile.dress_code] || 1;
    const expectedLevel = DRESS_LEVELS[expectedDressMin] || 1;
    if (restaurantLevel >= expectedLevel) {
      score += 1;
    } else {
      score += 0.3; // was 0.5 — reduced (S3)
    }
  }
  // No neutral for missing data (S3)

  // Layer 2: Energy and music alignment (0-3 points)

  // Energy level (0-2.0) — increased from 0-1.5 (S1)
  maxDataPoints++;
  atmoMaxPossible += 2.0;
  if (dp?.energy_level != null) {
    dataPoints++;
    const [eMin, eMax] = OCCASION_ENERGY[occasion] || [3, 7];
    const midpoint = (eMin + eMax) / 2;
    if (dp.energy_level >= eMin && dp.energy_level <= eMax) {
      score += 2.0;   // was 1.5
    } else {
      score += Math.max(0, 2.0 - Math.abs(dp.energy_level - midpoint) * 0.4);
    }
  }
  // No neutral for missing data (S3)

  // Music vibe (0-1.5) — increased from 0-1 (S1)
  maxDataPoints++;
  atmoMaxPossible += 1.5;
  if (dp?.music_vibe) {
    dataPoints++;
    const fits = MUSIC_FIT[occasion] || [];
    if (fits.includes(dp.music_vibe)) score += 1.5;  // was 1.0
  }

  // Vibe keyword matches (0-1.5)
  maxDataPoints++;
  atmoMaxPossible += 1.5;
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
      score += Math.min(1.5, vibeHits * 0.5);
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

  // S2 fix: Normalize atmosphere score to 0-10 using actual max possible for this request
  // This ensures a restaurant scoring 6/8 on a simple request is equivalent to 8/10.5 on a verbose one
  const normalizedAtmo = atmoMaxPossible > 0
    ? Math.min(10, (score / atmoMaxPossible) * 10)
    : Math.min(10, score);

  return {
    score: Math.max(0, normalizedAtmo),
    dataPoints,
    maxDataPoints,
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

  const dp = profile.deep_profile;

  // Layer 1: Google rating (0-4 points) — stretched to realistic candidate range (S5)
  maxDataPoints++;
  if (googleData && googleData.google_rating != null) {
    dataPoints++;
    const rating = googleData.google_rating;
    const reviewCount = googleData.google_review_count || 0;
    // S5: Stretch realistic candidate range (3.5-5.0) to 0-4 for better discrimination
    // Old: (rating - 2.5) * 1.6 → 4.0 at 5.0, 3.2 at 4.5, 2.4 at 4.0
    // New: (rating - 3.5) * 2.67 → 4.0 at 5.0, 2.67 at 4.5, 1.33 at 4.0
    const normalized = Math.max(0, (rating - 3.5) * 2.67);
    const confidence = reviewCount >= 200 ? 1.0
      : reviewCount >= 50 ? 0.9
      : reviewCount >= 10 ? 0.8
      : 0.7;
    score += Math.min(4, Math.max(0, normalized * confidence));
  } else {
    score += 1.0; // Reduced neutral: no evidence = minimal credit (was 2.0, S3)
  }

  // Layer 2: Sentiment from reviews (0-2 points)
  maxDataPoints++;
  if (sentimentScore != null) {
    dataPoints++;
    score += (sentimentScore / 10) * 2;
  } else {
    score += 0.5; // Reduced neutral (was 1.0, S3)
  }
  if (sentimentNegative != null && sentimentNegative > 30) {
    score -= Math.min(1.5, ((sentimentNegative - 30) / 40) * 1.5);
  }

  // Layer 3: Awards and recognition (0-2 points)
  maxDataPoints++;
  let awardsUsed = false;
  if (dp) {
    let awardsScore = 0;

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
    score += 0.25; // Reduced neutral (was 0.5, S3)
  }

  // Layer 4: Community standing (0-2 points)
  maxDataPoints++;
  let communityUsed = false;
  if (dp) {
    let communityScore = 0;

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
    score += 0.25; // Reduced neutral (was 0.5, S3)
  }

  return {
    score: Math.min(10, Math.max(0, score)),
    dataPoints,
    maxDataPoints,
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

  return {
    score: Math.min(10, Math.max(0, score)),
    dataPoints,
    maxDataPoints,
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

  // Occasion overrides — blend with cuisine weights instead of replacing (S7, PA3, PT7 fix)
  if (intent?.cuisine_importance !== "high") {
    let occasionW: V3Weights | null = null;
    if (["Date Night", "Special Occasion"].includes(occasion)) {
      occasionW = { food: 0.20, setting: 0.30, atmosphere: 0.25, reputation: 0.15, convenience: 0.10 };
    } else if (occasion === "Adventure") {
      occasionW = { food: 0.25, setting: 0.15, atmosphere: 0.20, reputation: 0.25, convenience: 0.15 };
    } else if (occasion === "Family Dinner") {
      occasionW = { food: 0.25, setting: 0.25, atmosphere: 0.15, reputation: 0.15, convenience: 0.20 };
    } else if (occasion === "Business Lunch") {
      occasionW = { food: 0.20, setting: 0.30, atmosphere: 0.25, reputation: 0.15, convenience: 0.10 };
    }
    if (occasionW) {
      // Blend: medium cuisine → 40% cuisine weights + 60% occasion weights
      // Low cuisine → 100% occasion weights (current behavior preserved)
      const cuisineBlend = intent?.cuisine_importance === "medium" ? 0.4 : 0.0;
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
  sentimentNegative?: number | null
): number {
  let result = composite;

  // NOTE: Cuisine mismatch penalty REMOVED — Food Match factor already handles cuisine
  // alignment (0 pts for mismatch). Having a separate multiplicative penalty here
  // double-counted the miss, crushing fallback scores to near-zero (e.g., 3%).

  // Price mismatch — unified subtractive penalties (P1 fix: ISSUE-1)
  // All penalties are subtractive so magnitude is independent of base score
  // and commutative with other penalties. Values calibrated to approximate
  // previous multiplicative behavior at mean composite (~5.0).
  if (priceLevel && priceLevel !== "Any" && profile.price_level) {
    const userIdx = PRICE_ORDER.indexOf(priceLevel);
    const restIdx = PRICE_ORDER.indexOf(profile.price_level);
    if (userIdx >= 0 && restIdx >= 0) {
      const gap = restIdx - userIdx;
      if (gap >= 3) result -= 3.0;
      else if (gap === 2) result -= 1.5;    // was -2.0 — diminishing sensitivity (HB6)
      else if (gap === 1) result -= 0.5;
      // Under-budget penalty removed (HB6: budgets are ceilings, not targets)
    }
  }

  // Neighborhood mismatch (relaxation cascade)
  if (neighborhood && neighborhood !== "Anywhere" && profile.neighborhood_name) {
    if (profile.neighborhood_name.toLowerCase() !== neighborhood.toLowerCase()) {
      result -= 1.0;
    }
  }

  // Sentiment crisis — REMOVED (P0 fix: sentiment double-counting)
  // Sentiment is already handled in computeReputation() where negative sentiment
  // penalizes the Reputation factor by up to -1.5. Having a second penalty here
  // double-counts the same signal, creating a combined ~15 DM point penalty from
  // a single source. The Reputation factor is the correct place for this signal.

  return Math.max(0, result);
}

// ==========================================
// PERSONALIZATION ADJUSTMENTS
// ==========================================

function applyPersonalization(
  composite: number,
  profile: RestaurantProfile,
  rejectionSignals?: RejectionSignals,
  userFeedback?: UserFeedbackSignals | null
): number {
  let result = composite;

  // User feedback history — recalibrated for Prospect Theory 2x ratio (PA5, HB1)
  if (userFeedback) {
    if (profile.cuisine_type && userFeedback.likedCuisines.includes(profile.cuisine_type)) {
      result += 0.5;   // was 0.3 — increased to be perceptible (+5 DM)
    }
    if (profile.cuisine_type && userFeedback.dislikedCuisines.includes(profile.cuisine_type)) {
      result -= 1.0;   // unchanged — now 2.0:1 ratio (matches Prospect Theory)
    }
    if (userFeedback.dislikedRestaurantIds.includes(profile.id)) {
      result -= 2.0;   // was -2.5 — reduced to avoid destroying otherwise good matches
    }
  }

  // Rejection pattern analysis
  if (rejectionSignals) {
    if (profile.cuisine_type && rejectionSignals.avoidCuisines.includes(profile.cuisine_type)) {
      result -= 2.0;
    }
    if (profile.price_level && rejectionSignals.avoidPriceLevels.includes(profile.price_level)) {
      result -= 1.5;
    }
  }

  return Math.max(0, result);
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
): { dondeMatch: number; factors: V3Factors; weights: V3Weights; dataCompleteness: number } {
  // Step 1: Compute each factor
  const foodResult = computeFoodMatch(profile, inputs.intent, inputs.dietaryRestrictions, inputs.specialRequest);
  const settingResult = computeSettingFit(profile, inputs.occasion, inputs.intent);
  const atmosphereResult = computeAtmosphere(profile, inputs.occasion, inputs.intent, inputs.specialRequest);
  const reputationResult = computeReputation(profile, inputs.googleData, inputs.sentimentScore, inputs.sentimentNegative);
  const convenienceResult = computeConvenience(profile, inputs.intent, inputs.clientTimeOfDay, inputs.specialRequest);

  // Apply enrichment confidence gating — Bayesian shrinkage toward prior mean (PT2, PT6)
  const dp = profile.deep_profile;
  const PRIOR_MEAN = 5.0;
  const needsGating = dp?.enrichment_confidence != null && dp.enrichment_confidence < 5;
  const shrinkageWeight = needsGating
    ? (dp!.enrichment_confidence!) / 10  // 0.0 to 0.4 for conf 0-4
    : 1.0;

  // PT2: Proper Bayesian shrinkage: pulls toward prior mean, not toward zero
  // PT6: Apply to all factors that consume deep_profile data (not just food + atmosphere)
  const applyGating = (score: number): number => {
    if (!needsGating) return score;
    return PRIOR_MEAN * (1 - shrinkageWeight) + score * shrinkageWeight;
  };

  const factors: V3Factors = {
    food: applyGating(foodResult.score),
    setting: applyGating(settingResult.score),
    atmosphere: applyGating(atmosphereResult.score),
    reputation: applyGating(reputationResult.score),
    convenience: applyGating(convenienceResult.score),
  };

  // Step 2: Dynamic weights
  const weights = computeV3Weights(inputs.occasion, inputs.intent);

  // Step 3: Setting/Atmosphere decorrelation (PT1 fix)
  // These factors share noise/energy/conversation data; discount overlap to prevent inflation
  if (factors.setting > 7 && factors.atmosphere > 7) {
    const overlap = Math.min(factors.setting - 7, factors.atmosphere - 7) * 0.15;
    factors.atmosphere = Math.max(0, factors.atmosphere - overlap);
  }

  // Step 3b: Weighted composite (0-10)
  let raw = factors.food * weights.food
    + factors.setting * weights.setting
    + factors.atmosphere * weights.atmosphere
    + factors.reputation * weights.reputation
    + factors.convenience * weights.convenience;

  // Step 4: Claude relevance modulation — applied to composite, not factors (S8, PT4, HB5)
  // This preserves factor display integrity and avoids boundary clamping losses
  if (inputs.claudeRelevance != null) {
    const relevanceAdjust = (inputs.claudeRelevance - 5) * 0.1; // -0.5 to +0.5
    raw += relevanceAdjust;  // Direct composite adjustment (was: mutated food+setting factors)
  }

  // Step 5: Deal-breaker penalties
  raw = applyDealBreakerPenalties(
    raw, profile,
    inputs.occasion, inputs.neighborhood, inputs.priceLevel,
    inputs.intent, inputs.sentimentNegative
  );

  // Step 6: Personalization
  raw = applyPersonalization(raw, profile, inputs.rejectionSignals, inputs.userFeedback);

  // Step 7: Map to 0-99 with power-law scaling (HB3, PT8)
  // Power 0.85 stretches the compressed [35-80] range into [30-90+]
  // This makes 85+ achievable for genuine perfect matches and expands perceptual discrimination
  const rawNormalized = Math.max(0, Math.min(1, raw / 10));  // Normalize to 0-1
  const scaled = Math.pow(rawNormalized, 0.85);                // Power-law stretch
  const dondeMatch = Math.min(99, Math.max(0, Math.round(scaled * 99)));

  // Data completeness
  const totalDataPoints = foodResult.dataPoints + settingResult.dataPoints
    + atmosphereResult.dataPoints + reputationResult.dataPoints + convenienceResult.dataPoints;
  const totalMaxPoints = foodResult.maxDataPoints + settingResult.maxDataPoints
    + atmosphereResult.maxDataPoints + reputationResult.maxDataPoints + convenienceResult.maxDataPoints;
  const dataCompleteness = totalMaxPoints > 0 ? totalDataPoints / totalMaxPoints : 0;

  return { dondeMatch, factors, weights, dataCompleteness };
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
