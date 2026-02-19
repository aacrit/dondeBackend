import type {
  Restaurant,
  OccasionScores,
  Tag,
  Neighborhood,
  RestaurantProfile,
} from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";

// --- Enhancement 2: Multi-score occasion weights ---
// Each occasion maps to a weighted blend of score columns
const OCCASION_WEIGHTS: Record<string, Record<string, number>> = {
  "Date Night": { date_friendly_score: 1.0 },
  "Group Hangout": { group_friendly_score: 1.0 },
  "Family Dinner": { family_friendly_score: 1.0 },
  "Business Lunch": { business_lunch_score: 1.0 },
  "Solo Dining": { solo_dining_score: 1.0 },
  "Special Occasion": { romantic_rating: 0.7, date_friendly_score: 0.3 },
  "Treat Myself": { solo_dining_score: 0.5, romantic_rating: 0.3, hole_in_wall_factor: 0.2 },
  Adventure: { hole_in_wall_factor: 0.6, group_friendly_score: 0.2, solo_dining_score: 0.2 },
  "Chill Hangout": { group_friendly_score: 0.6, solo_dining_score: 0.3, hole_in_wall_factor: 0.1 },
};

// Primary score column for RPC (backward compat) — used only for single-column lookup
const OCCASION_SCORE_MAP: Record<string, string> = {
  "Date Night": "date_friendly_score",
  "Group Hangout": "group_friendly_score",
  "Family Dinner": "family_friendly_score",
  "Business Lunch": "business_lunch_score",
  "Solo Dining": "solo_dining_score",
  "Special Occasion": "romantic_rating",
  "Treat Myself": "solo_dining_score",
  Adventure: "hole_in_wall_factor",
  "Chill Hangout": "group_friendly_score",
  Any: "total_score", // Enhancement 1: "Any" no longer biased to date_friendly
};

export function getScoreField(occasion: string): string {
  return OCCASION_SCORE_MAP[occasion] || "date_friendly_score";
}

// Enhancement 2: Compute weighted occasion score from multi-score blend
function computeWeightedOccasionScore(profile: RestaurantProfile, occasion: string): number {
  if (occasion === "Any") {
    return (sumAllScores(profile) / 70) * 10;
  }
  const weights = OCCASION_WEIGHTS[occasion];
  if (!weights) {
    const field = getScoreField(occasion);
    return (profile[field as keyof RestaurantProfile] as number) ?? 0;
  }
  let score = 0;
  for (const [field, weight] of Object.entries(weights)) {
    score += ((profile[field as keyof RestaurantProfile] as number) ?? 0) * weight;
  }
  return score;
}

// --- Keyword boosting ---

const CUISINE_KEYWORDS: Record<string, string[]> = {
  Mexican: ["mexican", "taco", "burrito", "carnitas", "enchilada", "mole"],
  Italian: ["italian", "pasta", "pizza", "risotto"],
  Japanese: ["japanese", "sushi", "ramen", "izakaya", "sake"],
  Thai: ["thai", "pad thai", "curry", "basil"],
  Chinese: ["chinese", "dim sum", "dumpling", "noodle"],
  Korean: ["korean", "bibimbap", "bbq", "kimchi"],
  Indian: ["indian", "curry", "tandoori", "naan", "masala"],
  French: ["french", "bistro", "crepe"],
  Seafood: ["seafood", "fish", "lobster", "oyster", "crab"],
  Steak: ["steak", "steakhouse", "filet"],
  Mediterranean: ["mediterranean", "hummus", "falafel", "greek"],
  Vietnamese: ["vietnamese", "pho", "banh mi"],
  Brunch: ["brunch", "pancake", "waffle", "mimosa"],
  American: ["burger", "american", "wings"],
};

const TAG_KEYWORDS: Record<string, string[]> = {
  byob: ["byob", "bring your own"],
  rooftop: ["rooftop", "skyline"],
  "outdoor patio": ["outdoor", "patio", "al fresco"],
  "hidden gem": ["hidden gem", "hidden", "secret"],
  "late night": ["late night", "late", "after midnight"],
  "craft cocktails": ["cocktail", "mixology", "craft drinks"],
  "live music": ["live music", "jazz", "band"],
  "farm-to-table": ["farm to table", "organic", "local ingredients"],
  "scenic view": ["view", "scenic", "panoramic", "waterfront", "lakefront", "river view"],
  romantic: ["romantic", "intimate", "candlelit", "cozy date"],
  trendy: ["trendy", "hip", "instagram", "modern", "stylish"],
  quiet: ["quiet", "peaceful", "calm", "serene"],
  "great value": ["cheap", "affordable", "deal", "value", "budget"],
  "brunch spot": ["brunch", "breakfast", "morning"],
  waterfront: ["waterfront", "lakefront", "riverwalk", "lake view"],
  "vegan friendly": ["vegan", "plant-based", "plant based"],
  "gluten free": ["gluten free", "celiac", "gluten-free"],
};

// --- Enhancement 4: Semantic intent expansion ---
// Maps natural-language intents to structured boost signals
interface IntentSignal {
  cuisines?: string[];
  tags?: string[];
  features?: (keyof RestaurantProfile)[];
}

const INTENT_MAP: Record<string, IntentSignal> = {
  "spicy": { cuisines: ["Thai", "Indian", "Korean", "Mexican"] },
  "anniversary": { tags: ["romantic", "scenic view"] },
  "celebrate": { tags: ["romantic", "trendy"] },
  "birthday": { tags: ["trendy", "craft cocktails"] },
  "healthy": { cuisines: ["Mediterranean"], tags: ["farm-to-table", "vegan friendly"] },
  "drinks": { tags: ["craft cocktails", "byob"] },
  "cocktails": { tags: ["craft cocktails"] },
  "wine": { tags: ["romantic"], cuisines: ["Italian", "French"] },
  "beer": { tags: ["great value", "craft cocktails"] },
  "quick": { tags: ["great value"] },
  "fast": { tags: ["great value"] },
  "cheap": { tags: ["great value", "hidden gem"] },
  "affordable": { tags: ["great value", "hidden gem"] },
  "fancy": { tags: ["trendy", "romantic"] },
  "upscale": { tags: ["trendy", "romantic"] },
  "elegant": { tags: ["romantic"] },
  "romantic": { tags: ["romantic", "scenic view"] },
  "cozy": { tags: ["quiet", "hidden gem"] },
  "chill": { tags: ["quiet", "hidden gem"] },
  "loud": { tags: ["live music", "trendy"] },
  "lively": { tags: ["live music", "trendy"] },
  "fun": { tags: ["trendy", "live music"] },
  "unique": { tags: ["hidden gem"] },
  "authentic": { tags: ["hidden gem"] },
  "local": { tags: ["hidden gem"] },
  "touristy": { tags: ["trendy", "scenic view"] },
  "instagrammable": { tags: ["trendy", "rooftop", "scenic view"] },
  "photogenic": { tags: ["trendy", "scenic view"] },
  "comfort food": { cuisines: ["American"], tags: ["great value"] },
  "comfort": { cuisines: ["American"], tags: ["great value"] },
  "noodles": { cuisines: ["Japanese", "Vietnamese", "Thai", "Chinese"] },
  "spice": { cuisines: ["Thai", "Indian", "Korean", "Mexican"] },
  "raw": { cuisines: ["Japanese"], tags: ["farm-to-table"] },
  "fresh": { tags: ["farm-to-table"] },
  "grilled": { cuisines: ["Steak", "American"] },
  "bbq": { cuisines: ["Korean", "American"] },
  "tapas": { cuisines: ["Mediterranean"], tags: ["trendy"] },
  "dim sum": { cuisines: ["Chinese"] },
  "omakase": { cuisines: ["Japanese"] },
  "vegetarian": { tags: ["vegan friendly"] },
  "vegan": { tags: ["vegan friendly"] },
  "gluten": { tags: ["gluten free"] },
  "celiac": { tags: ["gluten free"] },
  "halal": { tags: [] },
  "kosher": { tags: [] },
  "allergy": { tags: [] },
  "kids": { tags: [] },
  "family": { tags: [] },
  "group": { tags: [] },
  "large party": { tags: [] },
  "quiet dinner": { tags: ["quiet", "romantic"] },
  "business": { tags: ["quiet"] },
  "meeting": { tags: ["quiet"] },
  "solo": { tags: ["quiet", "hidden gem"] },
  "waterfront": { tags: ["waterfront", "scenic view"], features: ["outdoor_seating"] },
  "lakefront": { tags: ["waterfront", "scenic view"], features: ["outdoor_seating"] },
  "rooftop": { tags: ["rooftop", "scenic view"] },
  "skyline": { tags: ["rooftop", "scenic view"] },
  "garden": { features: ["outdoor_seating"] },
  "terrace": { features: ["outdoor_seating"] },
};

// --- Enhancement 5: Dietary keyword matching ---
const DIETARY_KEYWORDS: Record<string, string[]> = {
  "vegetarian": ["Vegetarian", "Veg"],
  "vegan": ["Vegan", "Plant-Based"],
  "gluten-free": ["Gluten-Free", "Gluten Free"],
  "gluten free": ["Gluten-Free", "Gluten Free"],
  "halal": ["Halal"],
  "kosher": ["Kosher"],
  "dairy-free": ["Dairy-Free", "Dairy Free"],
  "nut-free": ["Nut-Free", "Nut Free"],
  "keto": ["Keto", "Low-Carb"],
  "paleo": ["Paleo"],
};

// --- Enhancement 12: Time-of-day awareness ---
function getChicagoTimeContext(): string {
  const now = new Date();
  // Chicago is UTC-6 (CST) or UTC-5 (CDT)
  // Use a simple approximation — CDT from March to November
  const month = now.getUTCMonth(); // 0-indexed
  const isDST = month >= 2 && month <= 10; // March-November (approximate)
  const offsetHours = isDST ? 5 : 6;
  const chicagoHour = (now.getUTCHours() - offsetHours + 24) % 24;

  if (chicagoHour >= 6 && chicagoHour < 11) return "breakfast";
  if (chicagoHour >= 11 && chicagoHour < 15) return "lunch";
  if (chicagoHour >= 15 && chicagoHour < 21) return "dinner";
  return "late_night";
}

interface BoostedProfile extends RestaurantProfile {
  _boost: number;
}

// --- Enhancement 14: Rejection pattern analysis ---
export interface RejectionSignals {
  avoidCuisines: string[];
  avoidPriceLevels: string[];
}

export function analyzeRejections(
  excludedIds: string[],
  allProfiles: RestaurantProfile[]
): RejectionSignals {
  const signals: RejectionSignals = { avoidCuisines: [], avoidPriceLevels: [] };
  if (excludedIds.length < 2) return signals;

  const excluded = allProfiles.filter((p) => excludedIds.includes(p.id));
  if (excluded.length < 2) return signals;

  // Detect cuisine clustering
  const cuisineCounts = new Map<string, number>();
  for (const p of excluded) {
    if (p.cuisine_type) {
      cuisineCounts.set(p.cuisine_type, (cuisineCounts.get(p.cuisine_type) || 0) + 1);
    }
  }
  for (const [cuisine, count] of cuisineCounts) {
    if (count >= 2) signals.avoidCuisines.push(cuisine);
  }

  // Detect price level clustering
  const priceCounts = new Map<string, number>();
  for (const p of excluded) {
    if (p.price_level) {
      priceCounts.set(p.price_level, (priceCounts.get(p.price_level) || 0) + 1);
    }
  }
  for (const [price, count] of priceCounts) {
    if (count >= 2) signals.avoidPriceLevels.push(price);
  }

  return signals;
}

function computeBoost(
  profile: RestaurantProfile,
  specialRequest: string,
  rejectionSignals?: RejectionSignals
): number {
  let boost = 0;

  // Enhancement 14: Rejection penalty
  if (rejectionSignals) {
    if (
      profile.cuisine_type &&
      rejectionSignals.avoidCuisines.includes(profile.cuisine_type)
    ) {
      boost -= 2.0;
    }
    if (
      profile.price_level &&
      rejectionSignals.avoidPriceLevels.includes(profile.price_level)
    ) {
      boost -= 1.0;
    }
  }

  if (!specialRequest || specialRequest.trim().length < 3) return boost;

  const lower = specialRequest.toLowerCase();

  // Cuisine match: +3
  for (const [cuisine, keywords] of Object.entries(CUISINE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      if (
        profile.cuisine_type &&
        profile.cuisine_type.toLowerCase() === cuisine.toLowerCase()
      ) {
        boost += 3;
      }
      break; // Only match first cuisine
    }
  }

  // Tag match: +1.5 per matching tag
  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      const tagMatch = profile.tags.some((t) =>
        t.toLowerCase().includes(tag.toLowerCase())
      );
      if (tagMatch) boost += 1.5;
    }
  }

  // Boolean feature match: +1.5 if user mentions a feature the restaurant has
  const featureBoosts: [string[], keyof RestaurantProfile][] = [
    [["outdoor", "patio", "outside", "al fresco", "terrace", "view", "lakefront", "waterfront"], "outdoor_seating"],
    [["live music", "jazz", "band"], "live_music"],
    [["pet", "dog"], "pet_friendly"],
  ];
  for (const [keywords, field] of featureBoosts) {
    if (keywords.some((kw) => lower.includes(kw))) {
      if (profile[field]) boost += 1.5;
    }
  }

  // Enhancement 4: Semantic intent expansion (+1.0 per intent-to-attribute match)
  for (const [intent, signals] of Object.entries(INTENT_MAP)) {
    if (!lower.includes(intent)) continue;

    // Intent cuisine match
    if (signals.cuisines && profile.cuisine_type) {
      if (signals.cuisines.some((c) => c.toLowerCase() === profile.cuisine_type!.toLowerCase())) {
        boost += 1.0;
      }
    }
    // Intent tag match
    if (signals.tags) {
      for (const targetTag of signals.tags) {
        if (profile.tags.some((t) => t.toLowerCase().includes(targetTag.toLowerCase()))) {
          boost += 0.5;
        }
      }
    }
    // Intent feature match
    if (signals.features) {
      for (const feature of signals.features) {
        if (profile[feature]) boost += 0.5;
      }
    }
  }

  // Enhancement 5: Dietary keyword matching (+2 per dietary match)
  if (profile.dietary_options && profile.dietary_options.length > 0) {
    for (const [keyword, dietaryValues] of Object.entries(DIETARY_KEYWORDS)) {
      if (lower.includes(keyword)) {
        const match = profile.dietary_options.some((opt) =>
          dietaryValues.some((dv) => opt.toLowerCase().includes(dv.toLowerCase()))
        );
        if (match) boost += 2.0;
      }
    }
  }

  // Enhancement 5: good_for array matching (+1.0 per match)
  if (profile.good_for && profile.good_for.length > 0) {
    const goodForKeywords: Record<string, string[]> = {
      "date": ["Dates", "Date Night", "Romantic"],
      "group": ["Groups", "Group Dining", "Large Parties"],
      "family": ["Families", "Family", "Kids"],
      "solo": ["Solo", "Solo Dining"],
      "business": ["Business", "Business Lunch", "Meetings"],
    };
    for (const [keyword, matches] of Object.entries(goodForKeywords)) {
      if (lower.includes(keyword)) {
        if (profile.good_for.some((gf) =>
          matches.some((m) => gf.toLowerCase().includes(m.toLowerCase()))
        )) {
          boost += 1.0;
        }
      }
    }
  }

  // Enhancement 12: Time-of-day boost (+1.5 match, -1.0 mismatch)
  if (profile.best_times && profile.best_times.length > 0) {
    const timeContext = getChicagoTimeContext();
    if (profile.best_times.includes(timeContext)) {
      boost += 1.5;
    } else if (
      profile.best_times.length <= 2 &&
      !profile.best_times.includes(timeContext)
    ) {
      // Only penalize narrow-focus restaurants (e.g., brunch-only at dinner)
      boost -= 1.0;
    }
  }

  return boost;
}

// --- Donde Match: Deterministic weighted confidence percentage ---
// "We're X% confident this is your spot."
// Combines match relevance (70%) + quality signals (30%) into a single percentage.

export interface DondeMatchInputs {
  occasion: string;
  specialRequest: string;
  neighborhood: string;
  priceLevel: string;
  googleData: GooglePlaceData | null;
  claudeRelevance?: number;
}

// Weights sum to 1.0
const W_OCCASION = 0.30;
const W_REQUEST = 0.30;
const W_GOOGLE = 0.15;
const W_VIBE = 0.15;
const W_FILTER = 0.10;

// Per-occasion ideal vibe expectations
interface VibeExpectation {
  noise: string[];
  lighting: string[];
  dressMin: string;
  outdoorBonus: boolean;
  liveMusicBonus: boolean;
}

const OCCASION_VIBE_MAP: Record<string, VibeExpectation> = {
  "Date Night": {
    noise: ["Quiet", "Moderate"],
    lighting: ["dim", "intimate", "warm", "candlelit", "romantic"],
    dressMin: "Smart Casual",
    outdoorBonus: true,
    liveMusicBonus: true,
  },
  "Group Hangout": {
    noise: ["Moderate", "Loud"],
    lighting: ["bright", "lively", "modern", "warm", "vibrant"],
    dressMin: "Casual",
    outdoorBonus: true,
    liveMusicBonus: true,
  },
  "Family Dinner": {
    noise: ["Quiet", "Moderate"],
    lighting: ["bright", "warm", "modern", "welcoming"],
    dressMin: "Casual",
    outdoorBonus: true,
    liveMusicBonus: false,
  },
  "Business Lunch": {
    noise: ["Quiet"],
    lighting: ["bright", "modern", "warm", "elegant"],
    dressMin: "Business Casual",
    outdoorBonus: false,
    liveMusicBonus: false,
  },
  "Solo Dining": {
    noise: ["Quiet", "Moderate"],
    lighting: ["warm", "cozy", "bright", "relaxed"],
    dressMin: "Casual",
    outdoorBonus: true,
    liveMusicBonus: false,
  },
  "Special Occasion": {
    noise: ["Quiet"],
    lighting: ["dim", "intimate", "elegant", "warm", "candlelit"],
    dressMin: "Smart Casual",
    outdoorBonus: true,
    liveMusicBonus: true,
  },
  "Treat Myself": {
    noise: ["Quiet", "Moderate"],
    lighting: ["warm", "cozy", "intimate", "elegant"],
    dressMin: "Casual",
    outdoorBonus: true,
    liveMusicBonus: false,
  },
  Adventure: {
    noise: ["Moderate", "Loud", "Quiet"],
    lighting: ["any"],
    dressMin: "Casual",
    outdoorBonus: true,
    liveMusicBonus: true,
  },
  "Chill Hangout": {
    noise: ["Moderate", "Quiet"],
    lighting: ["warm", "cozy", "dim", "relaxed"],
    dressMin: "Casual",
    outdoorBonus: true,
    liveMusicBonus: true,
  },
  Any: {
    noise: ["Quiet", "Moderate"],
    lighting: ["any"],
    dressMin: "Casual",
    outdoorBonus: false,
    liveMusicBonus: false,
  },
};

const DRESS_LEVELS: Record<string, number> = {
  Casual: 1,
  "Smart Casual": 2,
  "Business Casual": 3,
  Formal: 4,
};

function sumAllScores(profile: RestaurantProfile): number {
  return (
    (profile.date_friendly_score || 0) +
    (profile.group_friendly_score || 0) +
    (profile.family_friendly_score || 0) +
    (profile.romantic_rating || 0) +
    (profile.business_lunch_score || 0) +
    (profile.solo_dining_score || 0) +
    (profile.hole_in_wall_factor || 0)
  );
}

// Sub-score 1: Occasion Fit (0-10) — Enhanced with multi-score blending
function computeOccasionFit(
  profile: RestaurantProfile,
  occasion: string
): number {
  // Enhancement 2: Use weighted blend instead of single score
  return computeWeightedOccasionScore(profile, occasion);
}

// Sub-score 2: Request Relevance (0-10) — tiered
function computeKeywordRelevance(
  profile: RestaurantProfile,
  specialRequest: string
): number {
  if (!specialRequest || specialRequest.trim().length < 3) return 7.0;

  const lower = specialRequest.toLowerCase();
  let points = 0;
  const maxPoints = 16; // Increased from 12 to account for new signals

  // Cuisine match: worth 4 points
  for (const [cuisine, keywords] of Object.entries(CUISINE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      if (
        profile.cuisine_type &&
        profile.cuisine_type.toLowerCase() === cuisine.toLowerCase()
      ) {
        points += 4;
      }
      break;
    }
  }

  // Tag match: worth up to 3 points (1 per match, max 3)
  let tagHits = 0;
  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      if (
        profile.tags.some((t) =>
          t.toLowerCase().includes(tag.toLowerCase())
        )
      ) {
        tagHits++;
      }
    }
  }
  points += Math.min(3, tagHits);

  // best_for_oneliner word overlap: worth up to 3 points
  if (profile.best_for_oneliner) {
    const onelineWords = profile.best_for_oneliner.toLowerCase().split(/\s+/);
    const requestWords = lower
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const overlap = requestWords.filter((w) =>
      onelineWords.some((ow) => ow.includes(w))
    ).length;
    points += Math.min(3, overlap);
  }

  // Boolean feature match: worth up to 2 points
  const featureKeywords: [string[], keyof RestaurantProfile][] = [
    [["outdoor", "patio", "outside", "al fresco", "terrace", "view", "lakefront", "waterfront"], "outdoor_seating"],
    [["live music", "jazz", "band", "live band"], "live_music"],
    [["pet", "dog", "pet-friendly", "dog-friendly"], "pet_friendly"],
  ];
  for (const [keywords, field] of featureKeywords) {
    if (keywords.some((kw) => lower.includes(kw))) {
      if (profile[field]) points += 1;
    }
  }

  // Enhancement 5: Dietary match: worth up to 2 points
  if (profile.dietary_options && profile.dietary_options.length > 0) {
    for (const [keyword, dietaryValues] of Object.entries(DIETARY_KEYWORDS)) {
      if (lower.includes(keyword)) {
        const match = profile.dietary_options.some((opt) =>
          dietaryValues.some((dv) => opt.toLowerCase().includes(dv.toLowerCase()))
        );
        if (match) {
          points += 2;
          break; // Only count one dietary match
        }
      }
    }
  }

  // Enhancement 4: Intent expansion: worth up to 2 points
  let intentPoints = 0;
  for (const [intent, signals] of Object.entries(INTENT_MAP)) {
    if (!lower.includes(intent)) continue;
    if (signals.cuisines && profile.cuisine_type) {
      if (signals.cuisines.some((c) => c.toLowerCase() === profile.cuisine_type!.toLowerCase())) {
        intentPoints += 1;
      }
    }
    if (signals.tags) {
      for (const targetTag of signals.tags) {
        if (profile.tags.some((t) => t.toLowerCase().includes(targetTag.toLowerCase()))) {
          intentPoints += 0.5;
        }
      }
    }
  }
  points += Math.min(2, intentPoints);

  points = Math.min(maxPoints, points);
  return (points / maxPoints) * 10;
}

function computeRequestRelevance(
  profile: RestaurantProfile,
  specialRequest: string,
  claudeRelevance?: number
): number {
  if (claudeRelevance !== undefined && claudeRelevance !== null) {
    return claudeRelevance;
  }
  return computeKeywordRelevance(profile, specialRequest);
}

// Sub-score 3: Google Quality (0-10)
function computeGoogleQuality(googleData: GooglePlaceData | null): number {
  if (!googleData || googleData.google_rating === null) {
    return 6.5;
  }

  const rating = googleData.google_rating;
  const reviewCount = googleData.google_review_count || 0;

  // Stretch 1-5 rating to 0-10 (clusters at 3.5-4.8)
  const ratingNorm = Math.min(10, Math.max(0, (rating - 2.5) * 4));

  // Confidence multiplier: more reviews = more trustworthy
  const confidence =
    reviewCount >= 100 ? 1.0 : reviewCount >= 20 ? 0.9 : 0.8;

  return ratingNorm * confidence;
}

// Sub-score 4: Vibe Alignment (0-10)
function computeVibeAlignment(
  profile: RestaurantProfile,
  occasion: string
): number {
  const expected = OCCASION_VIBE_MAP[occasion] || OCCASION_VIBE_MAP["Any"];
  let score = 0;
  const maxScore = 10;

  // Noise match (3 points)
  if (profile.noise_level) {
    if (expected.noise.includes(profile.noise_level)) {
      score += 3;
    } else {
      score += 1;
    }
  } else {
    score += 1.5;
  }

  // Lighting match (3 points)
  if (profile.lighting_ambiance && !expected.lighting.includes("any")) {
    const lightingLower = profile.lighting_ambiance.toLowerCase();
    const matches = expected.lighting.filter((kw) =>
      lightingLower.includes(kw)
    ).length;
    score += Math.min(3, matches * 1.5);
  } else {
    score += 1.5;
  }

  // Dress code appropriateness (2 points)
  if (profile.dress_code) {
    const restaurantLevel = DRESS_LEVELS[profile.dress_code] || 1;
    const expectedLevel = DRESS_LEVELS[expected.dressMin] || 1;
    if (restaurantLevel >= expectedLevel) {
      score += 2;
    } else {
      score += 1;
    }
  } else {
    score += 1;
  }

  // Bonus features (2 points)
  let bonusEarned = 0;
  let bonusAvailable = 0;
  if (expected.outdoorBonus) {
    bonusAvailable++;
    if (profile.outdoor_seating) bonusEarned++;
  }
  if (expected.liveMusicBonus) {
    bonusAvailable++;
    if (profile.live_music) bonusEarned++;
  }
  if (bonusAvailable > 0) {
    score += (bonusEarned / bonusAvailable) * 2;
  } else {
    score += 1;
  }

  return (score / maxScore) * 10;
}

// Sub-score 5: Filter Precision (0-10)
function computeFilterPrecision(
  profile: RestaurantProfile,
  requestedNeighborhood: string,
  requestedPrice: string
): number {
  let score = 10;
  let filtersApplied = 0;

  if (requestedNeighborhood && requestedNeighborhood !== "Anywhere") {
    filtersApplied++;
    if (
      profile.neighborhood_name.toLowerCase() !==
      requestedNeighborhood.toLowerCase()
    ) {
      score -= 5;
    }
  }

  if (requestedPrice && requestedPrice !== "Any") {
    filtersApplied++;
    if (profile.price_level !== requestedPrice) {
      score -= 5;
    }
  }

  if (filtersApplied === 0) return 8.0;

  return Math.max(0, score);
}

// Donde Match verdict tiers (for frontend display)
// 93-99%: "Perfect Match" (green)
// 85-92%: "Great Match" (green)
// 75-84%: "Good Match" (accent)
// 60-74%: "Worth Exploring" (accent)

export function computeDondeMatch(
  profile: RestaurantProfile,
  inputs: DondeMatchInputs
): number {
  const occasionFit = computeOccasionFit(profile, inputs.occasion);
  const requestRelevance = computeRequestRelevance(
    profile,
    inputs.specialRequest,
    inputs.claudeRelevance
  );
  const googleQuality = computeGoogleQuality(inputs.googleData);
  const vibeAlignment = computeVibeAlignment(profile, inputs.occasion);
  const filterPrecision = computeFilterPrecision(
    profile,
    inputs.neighborhood,
    inputs.priceLevel
  );

  const raw =
    W_OCCASION * occasionFit +
    W_REQUEST * requestRelevance +
    W_GOOGLE * googleQuality +
    W_VIBE * vibeAlignment +
    W_FILTER * filterPrecision;

  // Map 0-10 raw composite to 60-99% confidence range
  const matchPercent = 60 + Math.min(10, Math.max(0, raw)) * 3.9;
  return Math.min(99, Math.max(60, Math.round(matchPercent)));
}

// --- Legacy merge (kept as fallback for when RPC fails) ---

export function mergeProfiles(
  restaurants: Restaurant[],
  allScores: OccasionScores[],
  allTags: Tag[],
  neighborhoods: Neighborhood[]
): RestaurantProfile[] {
  const neighborhoodMap: Record<string, { name: string; description: string | null }> = {};
  for (const n of neighborhoods) {
    neighborhoodMap[n.id] = { name: n.name, description: n.description || null };
  }

  const scoresMap: Record<string, OccasionScores> = {};
  for (const s of allScores) {
    scoresMap[s.restaurant_id] = s;
  }

  const tagsMap: Record<string, string[]> = {};
  const tagCategoriesMap: Record<string, string[]> = {};
  for (const t of allTags) {
    if (!tagsMap[t.restaurant_id]) tagsMap[t.restaurant_id] = [];
    if (!tagCategoriesMap[t.restaurant_id]) tagCategoriesMap[t.restaurant_id] = [];
    if (t.tag_text && t.tag_text !== "null") {
      tagsMap[t.restaurant_id].push(t.tag_text);
      if (t.tag_category) tagCategoriesMap[t.restaurant_id].push(t.tag_category);
    }
  }

  return restaurants.map((r) => {
    const scores = scoresMap[r.id] || ({} as Partial<OccasionScores>);
    const nbhood = neighborhoodMap[r.neighborhood_id || ""] || { name: "Unknown", description: null };
    const totalScore =
      (scores.date_friendly_score ?? 0) +
      (scores.group_friendly_score ?? 0) +
      (scores.family_friendly_score ?? 0) +
      (scores.romantic_rating ?? 0) +
      (scores.business_lunch_score ?? 0) +
      (scores.solo_dining_score ?? 0) +
      (scores.hole_in_wall_factor ?? 0);

    return {
      ...r,
      neighborhood_name: nbhood.name,
      neighborhood_description: nbhood.description,
      date_friendly_score: scores.date_friendly_score ?? null,
      group_friendly_score: scores.group_friendly_score ?? null,
      family_friendly_score: scores.family_friendly_score ?? null,
      romantic_rating: scores.romantic_rating ?? null,
      business_lunch_score: scores.business_lunch_score ?? null,
      solo_dining_score: scores.solo_dining_score ?? null,
      hole_in_wall_factor: scores.hole_in_wall_factor ?? null,
      tags: tagsMap[r.id] || [],
      tag_categories: tagCategoriesMap[r.id] || [],
      occasion_score: null,
      total_score: totalScore,
      trending_score: null,
    };
  });
}

// --- Filter, boost, and rank ---

export function filterAndRank(
  profiles: RestaurantProfile[],
  neighborhood: string,
  priceLevel: string,
  occasion: string,
  specialRequest = ""
): RestaurantProfile[] {
  let filtered = profiles;

  // Filter by neighborhood
  if (neighborhood && neighborhood !== "Anywhere") {
    filtered = filtered.filter(
      (p) => p.neighborhood_name.toLowerCase() === neighborhood.toLowerCase()
    );
  }

  // Filter by price level (with relaxation to adjacent tiers)
  if (priceLevel && priceLevel !== "Any") {
    const exactMatch = filtered.filter((p) => p.price_level === priceLevel);
    if (exactMatch.length > 0) {
      filtered = exactMatch;
    } else {
      const PRICE_ORDER = ["$", "$$", "$$$", "$$$$"];
      const idx = PRICE_ORDER.indexOf(priceLevel);
      const adjacent = [
        ...(idx > 0 ? [PRICE_ORDER[idx - 1]] : []),
        ...(idx < PRICE_ORDER.length - 1 ? [PRICE_ORDER[idx + 1]] : []),
      ];
      const relaxed = filtered.filter((p) => adjacent.includes(p.price_level));
      if (relaxed.length > 0) {
        filtered = relaxed;
      }
      // If still empty after relaxation, keep all prices as last resort
    }
  }

  // Filter: only restaurants with enrichment data (noise_level as proxy)
  filtered = filtered.filter((p) => p.noise_level != null);

  // Enhancement 20: Filter inactive restaurants
  filtered = filtered.filter((p) => p.is_active !== false);

  if (filtered.length === 0) return [];

  // Apply keyword boosts and weighted composite sort
  const boosted: BoostedProfile[] = filtered.map((p) => ({
    ...p,
    _boost: computeBoost(p, specialRequest),
  }));

  boosted.sort((a, b) => {
    // Enhancement 2: Use weighted occasion score
    const occasionA = computeWeightedOccasionScore(a, occasion);
    const occasionB = computeWeightedOccasionScore(b, occasion);

    const normalizedSumA = (sumAllScores(a) / 70) * 10;
    const normalizedSumB = (sumAllScores(b) / 70) * 10;

    const compositeA =
      occasionA * 0.6 + normalizedSumA * 0.2 + a._boost * 0.2;
    const compositeB =
      occasionB * 0.6 + normalizedSumB * 0.2 + b._boost * 0.2;

    return compositeB - compositeA;
  });

  return boosted.slice(0, 10);
}

// --- Re-rank RPC results with keyword boosts ---

export function reRankWithBoosts(
  profiles: RestaurantProfile[],
  occasion: string,
  specialRequest: string,
  rejectionSignals?: RejectionSignals
): RestaurantProfile[] {
  const boosted: BoostedProfile[] = profiles.map((p) => ({
    ...p,
    _boost: computeBoost(p, specialRequest, rejectionSignals),
  }));

  // Enhancement 11: Add trending score as minor tiebreaker (5% weight)
  const hasTrending = boosted.some((b) => b.trending_score && b.trending_score > 0);

  // Only re-sort if at least one restaurant got a non-zero boost or trending signal
  const anyBoosted = boosted.some((b) => b._boost !== 0);
  if (!anyBoosted && !hasTrending && (!specialRequest || specialRequest.trim().length < 3)) {
    return profiles;
  }

  boosted.sort((a, b) => {
    // Enhancement 2: Use weighted occasion score
    const occasionA = computeWeightedOccasionScore(a, occasion);
    const occasionB = computeWeightedOccasionScore(b, occasion);

    const trendA = (a.trending_score || 0) / 10; // Normalize to ~0-1
    const trendB = (b.trending_score || 0) / 10;

    const compositeA = occasionA * 0.55 + a._boost * 0.35 + trendA * 0.10;
    const compositeB = occasionB * 0.55 + b._boost * 0.35 + trendB * 0.10;

    return compositeB - compositeA;
  });

  return boosted;
}

// --- Enhancement 6: Diversity-aware candidate selection ---

export function ensureDiversity(
  top: RestaurantProfile[],
  backfillPool: RestaurantProfile[],
  maxPerCuisine = 3,
  maxPerNeighborhood = 4
): RestaurantProfile[] {
  if (top.length <= 5) return top; // Not enough to diversify

  const result: RestaurantProfile[] = [];
  const cuisineCount = new Map<string, number>();
  const neighborhoodCount = new Map<string, number>();
  const demoted: RestaurantProfile[] = [];

  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const cuisine = r.cuisine_type || "Unknown";
    const neighborhood = r.neighborhood_name || "Unknown";

    const cc = cuisineCount.get(cuisine) || 0;
    const nc = neighborhoodCount.get(neighborhood) || 0;

    // Preserve top 3 positions (their Google reviews are pre-fetched)
    if (i < 3 || (cc < maxPerCuisine && nc < maxPerNeighborhood)) {
      result.push(r);
      cuisineCount.set(cuisine, cc + 1);
      neighborhoodCount.set(neighborhood, nc + 1);
    } else {
      demoted.push(r);
    }
  }

  // Backfill with restaurants from the overflow pool that add diversity
  const resultIds = new Set(result.map((r) => r.id));
  const topIds = new Set(top.map((r) => r.id));
  const candidates = backfillPool.filter((r) => !resultIds.has(r.id) && !topIds.has(r.id));

  for (const r of candidates) {
    if (result.length >= 10) break;
    const cuisine = r.cuisine_type || "Unknown";
    const neighborhood = r.neighborhood_name || "Unknown";
    const cc = cuisineCount.get(cuisine) || 0;
    const nc = neighborhoodCount.get(neighborhood) || 0;
    if (cc < maxPerCuisine && nc < maxPerNeighborhood) {
      result.push(r);
      cuisineCount.set(cuisine, cc + 1);
      neighborhoodCount.set(neighborhood, nc + 1);
    }
  }

  // If still under 10, add demoted back
  for (const r of demoted) {
    if (result.length >= 10) break;
    result.push(r);
  }

  return result.slice(0, 10);
}

// --- Prompt building (split for prompt caching) ---

// Enhancement 10: Expanded system prompt with static reference data for better cache utilization
export function buildSystemPrompt(): string {
  return `You are Donde, a warm and knowledgeable Chicago restaurant concierge. A user is looking for the perfect dining spot.

YOUR TASK:
Pick THE ONE BEST restaurant from the candidates below. Use this priority order:

1. SPECIAL REQUEST (highest priority): If the user has a specific craving, cuisine, vibe, or feature request (e.g., "sushi with a view", "quiet Italian spot", "outdoor brunch"), the restaurant MUST match that request as closely as possible. Match on cuisine type, tags, features (outdoor seating, live music), and atmosphere.
2. OCCASION FIT: The restaurant should suit the occasion (e.g., quiet and intimate for Date Night, lively for Group Hangout). Use the occasion score, noise level, and lighting as signals.
3. OVERALL QUALITY: Among restaurants that satisfy #1 and #2, prefer those with higher scores and stronger reviews.

KEY SIGNALS TO USE:
- Cuisine type: Match to what the user is craving
- Tags: Match to vibe words in the special request (e.g., "hidden gem", "rooftop", "scenic view")
- Features: Outdoor seating, live music, pet-friendly — match to explicit user requests
- Atmosphere: Noise level + lighting — match to occasion expectations
- Best For one-liner: Captures the restaurant's personality
- Dietary options: Match to dietary requirements (vegetarian, vegan, gluten-free, etc.)
- Reviews (when provided): Recent diner sentiment
- Trending score: Higher means more popular recently

OCCASION VIBE GUIDE:
- Date Night: Quiet/Moderate noise, dim/intimate lighting, Smart Casual+
- Group Hangout: Moderate/Loud noise, bright/lively, Casual
- Family Dinner: Quiet/Moderate noise, bright/warm, Casual
- Business Lunch: Quiet noise, bright/modern, Business Casual+
- Solo Dining: Quiet/Moderate noise, warm/cozy, Casual
- Special Occasion: Quiet noise, dim/elegant, Smart Casual+
- Treat Myself: Quiet/Moderate noise, warm/cozy, Casual
- Adventure: Any noise, any lighting, Casual (hidden gems preferred)
- Chill Hangout: Moderate/Quiet noise, warm/dim, Casual

IMPORTANT: Do NOT just pick the highest-scored restaurant. A restaurant with a 7/10 occasion score that perfectly matches "lakefront sushi" beats a 9/10 restaurant that serves Italian food indoors.

Respond ONLY in this exact JSON format (no markdown, no backticks):
{
  "restaurant_index": 0,
  "recommendation": "A warm, personal 80-120 word paragraph explaining WHY this restaurant is the perfect match for their request. Mention specific things about the food, atmosphere, and what makes it special for their occasion.",
  "insider_tip": "One specific, actionable insider tip (e.g., ask for the corner booth, try the off-menu horchata, go on Tuesday for half-price bottles)",
  "relevance_score": 8.5,
  "sentiment_score": 4.2,
  "sentiment_breakdown": "2-3 sentence summary of what diners love and any common complaints based on the provided reviews. Set to null if no reviews provided."
}

The relevance_score should be 0-10 reflecting how semantically relevant this restaurant is to the user's specific request text. Consider cuisine match, vibe words, dietary needs, and any specific mentions in their request. 9-10 = directly addresses every aspect of their request, 7-8 = strong match with minor gaps, 5-6 = partially matches, below 5 = best available but doesn't match well.
The sentiment_score should be 0-10 reflecting overall review sentiment. Only include if reviews are provided.`;
}

// Enhancement 9: Compressed candidate format for reduced token usage
export function buildUserPrompt(
  top10: RestaurantProfile[],
  occasion: string,
  priceLevel: string,
  neighborhood: string,
  specialRequest: string,
  reviewsByIndex?: Map<number, string>,
  neighborhoodDescription?: string | null,
  rejectionContext?: string
): string {
  const restaurantList = top10
    .map((d, i) => {
      const features = [
        d.outdoor_seating ? "Outdoor" : null,
        d.live_music ? "LiveMusic" : null,
        d.pet_friendly ? "PetFriendly" : null,
      ].filter(Boolean).join(",") || "—";

      const dietary = d.dietary_options?.length
        ? d.dietary_options.join(",")
        : "";

      const occasionScore = computeWeightedOccasionScore(d, occasion);
      const trending = d.trending_score ? ` T:${d.trending_score.toFixed(1)}` : "";

      let entry = `${i}. ${d.name} | ${d.neighborhood_name} | ${d.cuisine_type || "N/A"} | ${d.price_level} | ${occasion}:${occasionScore.toFixed(1)}/10${trending} | ${d.noise_level || "?"} noise, ${d.lighting_ambiance || "?"} | ${d.dress_code || "?"} | ${features}${dietary ? " | Diet:" + dietary : ""} | "${d.best_for_oneliner || "N/A"}" | Tags: ${d.tags.length > 0 ? d.tags.join(", ") : "—"}`;

      if (reviewsByIndex?.has(i)) {
        entry += `\nReviews:\n${reviewsByIndex.get(i)}`;
      }

      return entry;
    })
    .join("\n\n");

  let prompt = `USER REQUEST:
- Occasion: ${occasion}
- Budget: ${priceLevel}
- Neighborhood: ${neighborhood}
- Special Request: ${specialRequest || "None"}`;

  // Enhancement 15: Neighborhood character context
  if (neighborhoodDescription && neighborhood !== "Anywhere") {
    prompt += `\n- Neighborhood Character: ${neighborhoodDescription}`;
  }

  // Enhancement 14: Rejection context
  if (rejectionContext) {
    prompt += `\n\n${rejectionContext}`;
  }

  prompt += `\n\nTOP 10 CANDIDATES (format: Index. Name | Neighborhood | Cuisine | Price | OccasionScore | Noise,Lighting | DressCode | Features | Diet | BestFor | Tags):

${restaurantList}`;

  return prompt;
}

// Legacy single-string prompt builder (kept for fallback compatibility)
export function buildPrompt(
  top10: RestaurantProfile[],
  occasion: string,
  priceLevel: string,
  neighborhood: string,
  specialRequest: string
): string {
  return buildSystemPrompt() + "\n\n" + buildUserPrompt(top10, occasion, priceLevel, neighborhood, specialRequest);
}
