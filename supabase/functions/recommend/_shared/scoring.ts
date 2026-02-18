import type {
  Restaurant,
  OccasionScores,
  Tag,
  Neighborhood,
  RestaurantProfile,
} from "./types.ts";

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
  "donde_score": 7.5,
  "sentiment_score": 4.2,
  "sentiment_breakdown": "2-3 sentence summary of what diners love and any common complaints based on the provided reviews. Set to null if no reviews provided."
}

The donde_score should be 0-10 reflecting how well this restaurant matches the user's specific request. 9-10 = outstanding match, 7-8 = excellent, 5-6 = solid pick, below 5 = best available but not ideal.
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
