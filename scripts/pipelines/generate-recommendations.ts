/**
 * Pipeline 6: Pre-generate Recommendation Content
 * Generates per-restaurant, per-occasion recommendation paragraphs and donde_scores.
 * These are served instantly for generic requests (no special_request), avoiding live Claude calls.
 * Schedule: Weekly (Sunday 8am UTC, after scores-and-tags)
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { processBatches } from "../lib/batch.js";

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
    donde_score: number;
  }>;
}

async function main() {
  console.log("=== Pre-Recommendations Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const supabase = createAdminClient();

  // Fetch enriched restaurants with occasion scores
  const { data: restaurants, error: rError } = await supabase
    .from("restaurants")
    .select(
      "id, name, address, price_level, noise_level, lighting_ambiance, dress_code, cuisine_type, best_for_oneliner, insider_tip"
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
- Include a donde_score (0-10) reflecting how well this restaurant suits "${occasion}"
  (9-10 = outstanding match, 7-8 = excellent, 5-6 = solid, below 5 = not ideal for this occasion)

Return ONLY valid JSON (no markdown):
{
  "restaurants": [
    {
      "id": "restaurant-uuid",
      "recommendation": "Your warm 80-120 word recommendation...",
      "donde_score": 7.5
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
          const clampedScore = Math.max(
            0,
            Math.min(10, Number(result.donde_score) || 5)
          );

          if (DRY_RUN) {
            console.log(
              `  [DRY RUN] Would upsert rec for ${result.id} / ${occasion} (score: ${clampedScore})`
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
                donde_score: clampedScore,
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
