/**
 * Pipeline 6: Pre-generate Recommendation Content
 * Generates per-restaurant, per-occasion recommendation paragraphs.
 * donde_match is computed deterministically using the weighted formula (without live Google data).
 * These are served instantly for generic requests (no special_request), avoiding live Claude calls.
 * Schedule: Weekly (Sunday 8am UTC, after scores-and-tags)
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { processBatches } from "../lib/batch.js";
import { OCCASION_SCORE_MAP } from "../lib/config.js";

const DRY_RUN = process.env.DRY_RUN === "true";

const OCCASIONS = [
  "Date Night",
  "Group Hangout",
  "Family Dinner",
  "Business Lunch",
  "Solo Dining",
  "Special Occasion",
  "Treat Myself",
  "Adventure",
  "Chill Hangout",
];

interface RecommendationResult {
  restaurants: Array<{
    id: string;
    recommendation: string;
  }>;
}

// --- Deterministic donde_match for pipeline (mirrors Edge Function formula) ---

const OCCASION_VIBE_MAP: Record<
  string,
  {
    noise: string[];
    lighting: string[];
    dressMin: string;
    outdoorBonus: boolean;
    liveMusicBonus: boolean;
  }
> = {
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
};

const DRESS_LEVELS: Record<string, number> = {
  Casual: 1,
  "Smart Casual": 2,
  "Business Casual": 3,
  Formal: 4,
};

function computeBaseScore(
  restaurant: Record<string, unknown>,
  scores: Record<string, number>,
  occasion: string
): number {
  // Sub-score 1: Occasion Fit (0-10)
  const scoreField = OCCASION_SCORE_MAP[occasion] || "date_friendly_score";
  const occasionFit = (scores[scoreField] as number) || 0;

  // Sub-score 2: Request Relevance — generic default (7.0)
  const requestRelevance = 7.0;

  // Sub-score 3: Google Quality — no Google data in pipeline (6.5)
  const googleQuality = 6.5;

  // Sub-score 4: Vibe Alignment
  const expected = OCCASION_VIBE_MAP[occasion] || OCCASION_VIBE_MAP["Chill Hangout"];
  let vibeScore = 0;
  const maxVibe = 10;

  // Noise match (3 pts)
  const noise = restaurant.noise_level as string | null;
  if (noise) {
    vibeScore += expected.noise.includes(noise) ? 3 : 1;
  } else {
    vibeScore += 1.5;
  }

  // Lighting match (3 pts)
  const lighting = restaurant.lighting_ambiance as string | null;
  if (lighting && !expected.lighting.includes("any")) {
    const lightingLower = lighting.toLowerCase();
    const matches = expected.lighting.filter((kw) =>
      lightingLower.includes(kw)
    ).length;
    vibeScore += Math.min(3, matches * 1.5);
  } else {
    vibeScore += 1.5;
  }

  // Dress code (2 pts)
  const dress = restaurant.dress_code as string | null;
  if (dress) {
    const rLevel = DRESS_LEVELS[dress] || 1;
    const eLevel = DRESS_LEVELS[expected.dressMin] || 1;
    vibeScore += rLevel >= eLevel ? 2 : 1;
  } else {
    vibeScore += 1;
  }

  // Bonus features (2 pts)
  let bonusEarned = 0;
  let bonusAvailable = 0;
  if (expected.outdoorBonus) {
    bonusAvailable++;
    if (restaurant.outdoor_seating) bonusEarned++;
  }
  if (expected.liveMusicBonus) {
    bonusAvailable++;
    if (restaurant.live_music) bonusEarned++;
  }
  if (bonusAvailable > 0) {
    vibeScore += (bonusEarned / bonusAvailable) * 2;
  } else {
    vibeScore += 1;
  }

  const vibeAlignment = (vibeScore / maxVibe) * 10;

  // Sub-score 5: Filter Precision — pipeline has no user filters (8.0)
  const filterPrecision = 8.0;

  // Weighted composite
  const raw =
    0.3 * occasionFit +
    0.3 * requestRelevance +
    0.15 * googleQuality +
    0.15 * vibeAlignment +
    0.1 * filterPrecision;

  // Map 0-10 raw composite to 60-99% confidence range
  const matchPercent = 60 + Math.min(10, Math.max(0, raw)) * 3.9;
  return Math.min(99, Math.max(60, Math.round(matchPercent)));
}

async function main() {
  console.log("=== Pre-Recommendations Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const supabase = createAdminClient();

  // Fetch enriched restaurants with occasion scores
  const { data: restaurants, error: rError } = await supabase
    .from("restaurants")
    .select(
      "id, name, address, price_level, noise_level, lighting_ambiance, dress_code, cuisine_type, best_for_oneliner, insider_tip, outdoor_seating, live_music, pet_friendly"
    )
    .not("noise_level", "is", null);

  if (rError) throw rError;
  if (!restaurants || restaurants.length === 0) {
    console.log("No enriched restaurants found. Done.");
    return;
  }

  // Fetch all occasion scores
  const { data: allScores, error: sError } = await supabase
    .from("occasion_scores")
    .select("*");
  if (sError) throw sError;

  const scoresMap: Record<string, Record<string, number>> = {};
  for (const s of allScores || []) {
    scoresMap[s.restaurant_id] = s;
  }

  // Fetch all tags
  const { data: allTags, error: tError } = await supabase
    .from("tags")
    .select("restaurant_id, tag_text");
  if (tError) throw tError;

  const tagsMap: Record<string, string[]> = {};
  for (const t of allTags || []) {
    if (!tagsMap[t.restaurant_id]) tagsMap[t.restaurant_id] = [];
    if (t.tag_text && t.tag_text !== "null") {
      tagsMap[t.restaurant_id].push(t.tag_text);
    }
  }

  // Only process restaurants that have scores
  const eligible = restaurants.filter((r) => scoresMap[r.id]);
  console.log(
    `Found ${eligible.length} restaurants eligible for pre-recommendations`
  );

  // Fetch existing pre_recommendations to skip already-generated ones
  const { data: existing, error: eError } = await supabase
    .from("pre_recommendations")
    .select("restaurant_id, occasion");
  if (eError) throw eError;

  const existingSet = new Set(
    (existing || []).map((e) => `${e.restaurant_id}:${e.occasion}`)
  );

  for (const occasion of OCCASIONS) {
    const needsRec = eligible.filter(
      (r) => !existingSet.has(`${r.id}:${occasion}`)
    );

    if (needsRec.length === 0) {
      console.log(`All restaurants have ${occasion} recommendations. Skipping.`);
      continue;
    }

    console.log(
      `\nGenerating ${occasion} recommendations for ${needsRec.length} restaurants`
    );

    await processBatches(needsRec, 5, async (batch) => {
      const restaurantList = batch
        .map((r, i) => {
          const scores = scoresMap[r.id] || {};
          const tags = tagsMap[r.id] || [];
          return `${i + 1}. ${r.name} (ID: ${r.id})
   Address: ${r.address || "N/A"}
   Price: ${r.price_level || "N/A"}
   Atmosphere: ${r.noise_level || "N/A"}, ${r.lighting_ambiance || "N/A"}
   Dress Code: ${r.dress_code || "N/A"}
   Cuisine: ${r.cuisine_type || "N/A"}
   Best For: ${r.best_for_oneliner || "N/A"}
   Tags: ${tags.length > 0 ? tags.join(", ") : "N/A"}
   Scores: date=${scores.date_friendly_score || 0}, group=${scores.group_friendly_score || 0}, family=${scores.family_friendly_score || 0}, business=${scores.business_lunch_score || 0}, solo=${scores.solo_dining_score || 0}, hole_in_wall=${scores.hole_in_wall_factor || 0}, romantic=${scores.romantic_rating || 0}`;
        })
        .join("\n\n---\n\n");

      const prompt = `You are Donde, a warm and knowledgeable Chicago restaurant concierge.

For each restaurant below, write a personalized recommendation for a "${occasion}" occasion.

Each recommendation should be:
- 80-120 words
- Warm, personal, and specific to WHY this restaurant is great for "${occasion}"
- Mention specific things about the food, atmosphere, and what makes it special

Return ONLY valid JSON (no markdown):
{
  "restaurants": [
    {
      "id": "restaurant-uuid",
      "recommendation": "Your warm 80-120 word recommendation..."
    }
  ]
}

Restaurants:

${restaurantList}`;

      try {
        const responseText = await askClaude(prompt, {
          maxTokens: 4096,
          temperature: 0.7,
        });
        const parsed = parseJsonResponse<RecommendationResult>(responseText);

        for (const result of parsed.restaurants) {
          // Find the restaurant data to compute the base score
          const restaurantData = batch.find((r) => r.id === result.id);
          const scores = scoresMap[result.id] || {};

          // Compute deterministic base match (no Google data, no user-specific relevance)
          const baseMatch = restaurantData
            ? computeBaseScore(restaurantData, scores, occasion)
            : 75;

          if (DRY_RUN) {
            console.log(
              `  [DRY RUN] Would upsert rec for ${result.id} / ${occasion} (base match: ${baseMatch}%)`
            );
            continue;
          }

          const { error: upsertError } = await supabase
            .from("pre_recommendations")
            .upsert(
              {
                restaurant_id: result.id,
                occasion,
                recommendation: result.recommendation,
                donde_match: baseMatch,
                generated_at: new Date().toISOString(),
              },
              { onConflict: "restaurant_id,occasion" }
            );

          if (upsertError) {
            console.error(
              `Failed to upsert rec for ${result.id}/${occasion}:`,
              upsertError
            );
          }
        }

        console.log(
          `  Generated ${parsed.restaurants.length} ${occasion} recommendations`
        );
      } catch (err) {
        console.error(`Claude failed for ${occasion} batch:`, err);
      }
    });
  }

  console.log("\nPre-recommendations pipeline complete.");
}

main().catch((err) => {
  console.error("Pre-recommendations pipeline failed:", err);
  process.exit(1);
});
