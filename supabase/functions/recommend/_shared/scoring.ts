import type {
  Restaurant,
  OccasionScores,
  Tag,
  Neighborhood,
  RestaurantProfile,
} from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";

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
  Any: "date_friendly_score",
};

export function getScoreField(occasion: string): string {
  return OCCASION_SCORE_MAP[occasion] || "date_friendly_score";
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
};

interface BoostedProfile extends RestaurantProfile {
  _boost: number;
}

function computeBoost(
  profile: RestaurantProfile,
  specialRequest: string
): number {
  if (!specialRequest || specialRequest.trim().length < 3) return 0;

  const lower = specialRequest.toLowerCase();
  let boost = 0;

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

  return boost;
}

// --- Donde Score: Deterministic weighted multi-factor formula ---

export interface DondeScoreInputs {
  occasion: string;
  specialRequest: string;
  neighborhood: string;
  priceLevel: string;
  isGeneric: boolean;
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

// Sub-score 1: Occasion Fit (0-10)
function computeOccasionFit(
  profile: RestaurantProfile,
  occasion: string
): number {
  if (occasion === "Any") {
    return (sumAllScores(profile) / 70) * 10;
  }
  const scoreField = getScoreField(occasion);
  return (profile[scoreField as keyof RestaurantProfile] as number) || 0;
}

// Sub-score 2: Request Relevance (0-10) — tiered
function computeKeywordRelevance(
  profile: RestaurantProfile,
  specialRequest: string
): number {
  if (!specialRequest || specialRequest.trim().length < 3) return 7.0;

  const lower = specialRequest.toLowerCase();
  let points = 0;
  const maxPoints = 10;

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

  return (points / maxPoints) * 10;
}

function computeRequestRelevance(
  profile: RestaurantProfile,
  specialRequest: string,
  isGeneric: boolean,
  claudeRelevance?: number
): number {
  if (claudeRelevance !== undefined && claudeRelevance !== null) {
    return claudeRelevance;
  }
  if (isGeneric) {
    return 7.0;
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
  // 4.5 → 8.0, 4.0 → 6.0, 3.5 → 4.0, 3.0 → 2.0
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

/**
 * Compute the DondeAI Score — a deterministic, weighted composite of 5 sub-scores.
 * Returns a value on a X.X scale clamped to [5.0, 10.0].
 */
export function computeDondeScore(
  profile: RestaurantProfile,
  inputs: DondeScoreInputs
): number {
  const occasionFit = computeOccasionFit(profile, inputs.occasion);
  const requestRelevance = computeRequestRelevance(
    profile,
    inputs.specialRequest,
    inputs.isGeneric,
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

  const clamped = Math.min(10.0, Math.max(5.0, raw));
  return Math.round(clamped * 10) / 10;
}

// --- Legacy merge (kept as fallback for when RPC fails) ---

export function mergeProfiles(
  restaurants: Restaurant[],
  allScores: OccasionScores[],
  allTags: Tag[],
  neighborhoods: Neighborhood[]
): RestaurantProfile[] {
  const neighborhoodMap: Record<string, string> = {};
  for (const n of neighborhoods) {
    neighborhoodMap[n.id] = n.name;
  }

  const scoresMap: Record<string, OccasionScores> = {};
  for (const s of allScores) {
    scoresMap[s.restaurant_id] = s;
  }

  const tagsMap: Record<string, string[]> = {};
  for (const t of allTags) {
    if (!tagsMap[t.restaurant_id]) tagsMap[t.restaurant_id] = [];
    if (t.tag_text && t.tag_text !== "null") {
      tagsMap[t.restaurant_id].push(t.tag_text);
    }
  }

  return restaurants.map((r) => {
    const scores = scoresMap[r.id] || ({} as Partial<OccasionScores>);
    return {
      ...r,
      neighborhood_name: neighborhoodMap[r.neighborhood_id || ""] || "Unknown",
      date_friendly_score: scores.date_friendly_score ?? null,
      group_friendly_score: scores.group_friendly_score ?? null,
      family_friendly_score: scores.family_friendly_score ?? null,
      romantic_rating: scores.romantic_rating ?? null,
      business_lunch_score: scores.business_lunch_score ?? null,
      solo_dining_score: scores.solo_dining_score ?? null,
      hole_in_wall_factor: scores.hole_in_wall_factor ?? null,
      tags: tagsMap[r.id] || [],
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

  // Filter by price level
  if (priceLevel && priceLevel !== "Any") {
    filtered = filtered.filter((p) => p.price_level === priceLevel);
  }

  // Filter: only restaurants with enrichment data (noise_level as proxy)
  filtered = filtered.filter((p) => p.noise_level != null);

  if (filtered.length === 0) return [];

  const scoreField = getScoreField(occasion);

  // Apply keyword boosts and weighted composite sort
  const boosted: BoostedProfile[] = filtered.map((p) => ({
    ...p,
    _boost: computeBoost(p, specialRequest),
  }));

  boosted.sort((a, b) => {
    const occasionA =
      (a[scoreField as keyof RestaurantProfile] as number) || 0;
    const occasionB =
      (b[scoreField as keyof RestaurantProfile] as number) || 0;

    const sumA =
      (a.date_friendly_score || 0) +
      (a.group_friendly_score || 0) +
      (a.family_friendly_score || 0) +
      (a.romantic_rating || 0) +
      (a.business_lunch_score || 0) +
      (a.solo_dining_score || 0) +
      (a.hole_in_wall_factor || 0);
    const sumB =
      (b.date_friendly_score || 0) +
      (b.group_friendly_score || 0) +
      (b.family_friendly_score || 0) +
      (b.romantic_rating || 0) +
      (b.business_lunch_score || 0) +
      (b.solo_dining_score || 0) +
      (b.hole_in_wall_factor || 0);

    // Weighted composite: 60% occasion + 20% normalized total + 20% boost
    const normalizedSumA = (sumA / 70) * 10; // Normalize sum (max 70) to 0-10 scale
    const normalizedSumB = (sumB / 70) * 10;

    const compositeA =
      occasionA * 0.6 + normalizedSumA * 0.2 + a._boost * 0.2;
    const compositeB =
      occasionB * 0.6 + normalizedSumB * 0.2 + b._boost * 0.2;

    return compositeB - compositeA;
  });

  return boosted.slice(0, 10);
}

// --- Prompt building (split for prompt caching) ---

export function buildSystemPrompt(): string {
  return `You are Donde, a warm and knowledgeable Chicago restaurant concierge. A user is looking for the perfect dining spot.

YOUR TASK:
Pick THE ONE BEST restaurant for this person. Consider their occasion, special request, and overall fit.

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

export function buildUserPrompt(
  top10: RestaurantProfile[],
  occasion: string,
  priceLevel: string,
  neighborhood: string,
  specialRequest: string,
  reviewsByIndex?: Map<number, string>
): string {
  const scoreField = getScoreField(occasion);

  const restaurantList = top10
    .map((d, i) => {
      let entry = `${i + 1}. ${d.name}
   Address: ${d.address}
   Neighborhood: ${d.neighborhood_name}
   Price: ${d.price_level}
   ${occasion} Score: ${(d[scoreField as keyof RestaurantProfile] as number) || "N/A"}/10
   Atmosphere: ${d.noise_level || "N/A"}, ${d.lighting_ambiance || "N/A"}
   Dress Code: ${d.dress_code || "N/A"}
   Best For: ${d.best_for_oneliner || "N/A"}
   Tags: ${d.tags.length > 0 ? d.tags.join(", ") : "N/A"}`;

      if (reviewsByIndex?.has(i)) {
        entry += `\n   Recent Reviews:\n${reviewsByIndex.get(i)}`;
      }

      return entry;
    })
    .join("\n\n---\n\n");

  return `USER REQUEST:
- Occasion: ${occasion}
- Budget: ${priceLevel}
- Neighborhood: ${neighborhood}
- Special Request: ${specialRequest || "None"}

TOP 10 CANDIDATES (ranked by ${occasion} score):

${restaurantList}`;
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
