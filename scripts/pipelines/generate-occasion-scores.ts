/**
 * Pipeline 5: Generate Occasion Scores
 * NEW pipeline - generates occasion scores for restaurants that don't have them
 * Schedule: Weekly (Sunday 7am UTC)
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";

interface ScoresResult {
  restaurants: Array<{
    id: string;
    date_friendly_score: number;
    group_friendly_score: number;
    family_friendly_score: number;
    business_lunch_score: number;
    solo_dining_score: number;
    hole_in_wall_factor: number;
    romantic_rating: number;
  }>;
}

async function main() {
  console.log("=== Occasion Scores Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const supabase = createAdminClient();

  // Find restaurants without occasion scores
  const { data: allScores, error: scError } = await supabase
    .from("occasion_scores")
    .select("restaurant_id");
  if (scError) throw scError;

  const scoredIds = new Set((allScores || []).map((s) => s.restaurant_id));

  const { data: restaurants, error: rError } = await supabase
    .from("restaurants")
    .select(
      "id, name, address, price_level, noise_level, lighting_ambiance, ambiance, good_for, best_for_oneliner"
    );
  if (rError) throw rError;

  const unscored = (restaurants || []).filter((r) => !scoredIds.has(r.id));

  if (unscored.length === 0) {
    console.log("All restaurants have occasion scores. Done.");
    return;
  }

  console.log(`Found ${unscored.length} restaurants needing occasion scores`);

  await processBatches(unscored, 10, async (batch) => {
    const restaurantList = batch
      .map((r, i) => {
        return `${i + 1}. ${r.name} (ID: ${r.id})
   Address: ${r.address || "N/A"}
   Price: ${r.price_level || "N/A"}
   Noise: ${r.noise_level || "N/A"}
   Lighting: ${r.lighting_ambiance || "N/A"}
   Ambiance: ${(r.ambiance || []).join(", ") || "N/A"}
   Good For: ${(r.good_for || []).join(", ") || "N/A"}
   One-liner: ${r.best_for_oneliner || "N/A"}`;
      })
      .join("\n\n---\n\n");

    const prompt = `Rate each restaurant on these 7 occasion dimensions from 0-10 (integers only).

Scoring guide:
- date_friendly_score: Romantic atmosphere, intimate seating, good wine/cocktails
- group_friendly_score: Communal tables, shareable plates, lively atmosphere, good for 4+
- family_friendly_score: Kid-friendly menu, casual, high chairs, not too loud
- business_lunch_score: Professional setting, quiet enough for conversation, efficient service
- solo_dining_score: Bar seating, counter service, welcoming to solo diners
- hole_in_wall_factor: Hidden gem quality, authentic, off-the-radar, local favorite
- romantic_rating: Special occasion worthy, ambiance, presentation, unique experience

Return ONLY valid JSON (no markdown):
{
  "restaurants": [
    {
      "id": "restaurant-uuid",
      "date_friendly_score": 7,
      "group_friendly_score": 8,
      "family_friendly_score": 5,
      "business_lunch_score": 6,
      "solo_dining_score": 7,
      "hole_in_wall_factor": 4,
      "romantic_rating": 7
    }
  ]
}

Restaurants:

${restaurantList}`;

    try {
      const responseText = await askClaude(prompt, { maxTokens: 4096 });
      const parsed = parseJsonResponse<ScoresResult>(responseText);

      for (const result of parsed.restaurants) {
        // Clamp all scores to 0-10
        const clamp = (v: number) => Math.max(0, Math.min(10, Math.round(v)));

        const scoreData = {
          restaurant_id: result.id,
          date_friendly_score: clamp(result.date_friendly_score),
          group_friendly_score: clamp(result.group_friendly_score),
          family_friendly_score: clamp(result.family_friendly_score),
          business_lunch_score: clamp(result.business_lunch_score),
          solo_dining_score: clamp(result.solo_dining_score),
          hole_in_wall_factor: clamp(result.hole_in_wall_factor),
          romantic_rating: clamp(result.romantic_rating),
        };

        if (DRY_RUN) {
          console.log(`  [DRY RUN] Would insert scores for ${result.id}`);
          continue;
        }

        const { error: insertError } = await supabase
          .from("occasion_scores")
          .upsert(scoreData, { onConflict: "restaurant_id" });

        if (insertError) {
          console.error(
            `Failed to upsert scores for ${result.id}:`,
            insertError
          );
        }
      }

      console.log(`  Scored ${parsed.restaurants.length} restaurants`);
    } catch (err) {
      console.error("Claude failed for batch:", err);
    }
  });

  console.log("Occasion scores pipeline complete.");
}

main().catch((err) => {
  console.error("Occasion scores pipeline failed:", err);
  process.exit(1);
});
