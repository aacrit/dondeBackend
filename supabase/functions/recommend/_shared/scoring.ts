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

export function mergeProfiles(
  restaurants: Restaurant[],
  allScores: OccasionScores[],
  allTags: Tag[],
  neighborhoods: Neighborhood[]
): RestaurantProfile[] {
  // Build lookup maps
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

export function filterAndRank(
  profiles: RestaurantProfile[],
  neighborhood: string,
  priceLevel: string,
  occasion: string
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

  // Filter: only restaurants with review summaries
  filtered = filtered.filter((p) => p.google_review_summary != null);

  if (filtered.length === 0) return [];

  // Sort by occasion score descending, tiebreak by google_rating
  const scoreField = getScoreField(occasion);

  filtered.sort((a, b) => {
    const scoreA =
      (a[scoreField as keyof RestaurantProfile] as number) || 0;
    const scoreB =
      (b[scoreField as keyof RestaurantProfile] as number) || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (b.google_rating || 0) - (a.google_rating || 0);
  });

  // Return top 10
  return filtered.slice(0, 10);
}

export function buildPrompt(
  top10: RestaurantProfile[],
  occasion: string,
  priceLevel: string,
  neighborhood: string,
  specialRequest: string
): string {
  const scoreField = getScoreField(occasion);

  const restaurantList = top10
    .map((d, i) => {
      const summary =
        typeof d.google_review_summary === "object"
          ? JSON.stringify(d.google_review_summary)
          : d.google_review_summary || "N/A";

      return `${i + 1}. ${d.name}
   Address: ${d.address}
   Neighborhood: ${d.neighborhood_name}
   Price: ${d.price_level}
   Google Rating: ${d.google_rating}/5 (${d.google_review_count} reviews)
   ${occasion} Score: ${(d[scoreField as keyof RestaurantProfile] as number) || "N/A"}/10
   Atmosphere: ${d.noise_level || "N/A"}, ${d.lighting_ambiance || "N/A"}
   Review Summary: ${summary}
   Best For: ${d.best_for_oneliner || "N/A"}
   Tags: ${d.tags.length > 0 ? d.tags.join(", ") : "N/A"}`;
    })
    .join("\n\n---\n\n");

  return `You are Donde, a warm and knowledgeable Chicago restaurant concierge. A user is looking for the perfect dining spot.

USER REQUEST:
- Occasion: ${occasion}
- Budget: ${priceLevel}
- Neighborhood: ${neighborhood}
- Special Request: ${specialRequest || "None"}

TOP 10 CANDIDATES (ranked by ${occasion} score):

${restaurantList}

YOUR TASK:
Pick THE ONE BEST restaurant for this person. Consider their occasion, special request, and overall fit.

Respond ONLY in this exact JSON format (no markdown, no backticks):
{
  "restaurant_index": 0,
  "recommendation": "A warm, personal 80-120 word paragraph explaining WHY this restaurant is the perfect match for their request. Mention specific things about the food, atmosphere, and what makes it special for their occasion.",
  "insider_tip": "One specific, actionable insider tip (e.g., ask for the corner booth, try the off-menu horchata, go on Tuesday for half-price bottles)",
  "donde_score": 7.5
}

The donde_score should be 0-10 reflecting how well this restaurant matches the user's specific request. 9-10 = outstanding match, 7-8 = excellent, 5-6 = solid pick, below 5 = best available but not ideal.`;
}
