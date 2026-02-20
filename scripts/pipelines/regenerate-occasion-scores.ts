/**
 * Pipeline: Regenerate Occasion Scores
 *
 * Re-generates occasion scores for ALL restaurants (including already-scored ones).
 * Unlike generate-occasion-scores.ts which only targets unscored restaurants,
 * this pipeline refreshes scores using the corrected cuisine_type as context.
 *
 * Usage: cd scripts && npx tsx pipelines/regenerate-occasion-scores.ts
 * Env: DRY_RUN=true to preview without DB writes
 *      BATCH_LIMIT=50 to process only N restaurants (for incremental runs)
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";
const BATCH_LIMIT = parseInt(process.env.BATCH_LIMIT || "0", 10);

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
  console.log("=== Regenerate Occasion Scores Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  if (BATCH_LIMIT > 0) console.log(`Batch limit: ${BATCH_LIMIT} restaurants`);

  const supabase = createAdminClient();

  const { data: restaurants, error: rError } = await supabase
    .from("restaurants")
    .select(
      "id, name, address, price_level, cuisine_type, noise_level, lighting_ambiance, ambiance, good_for, best_for_oneliner"
    )
    .eq("is_active", true)
    .order("name");
  if (rError) throw rError;

  let targets = restaurants || [];
  if (BATCH_LIMIT > 0) {
    targets = targets.slice(0, BATCH_LIMIT);
  }

  if (targets.length === 0) {
    console.log("No restaurants found. Done.");
    return;
  }

  console.log(`Regenerating occasion scores for ${targets.length} restaurants`);
  let successCount = 0;
  let failCount = 0;

  await processBatches(targets, 10, async (batch) => {
    const restaurantList = batch
      .map((r, i) => {
        return `${i + 1}. ${r.name} (ID: ${r.id})
   Cuisine: ${r.cuisine_type || "N/A"}
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

Important: Use the cuisine type to inform your scoring. For example:
- Cocktail bars should score high on date_friendly and solo_dining, low on family_friendly
- BBQ joints should score high on group_friendly and hole_in_wall_factor
- Fine dining steakhouses should score high on business_lunch and romantic_rating
- Brunch spots should score high on group_friendly and family_friendly

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
          console.log(`  [DRY RUN] Would upsert scores for ${result.id}`);
          successCount++;
          continue;
        }

        const { error: upsertError } = await supabase
          .from("occasion_scores")
          .upsert(scoreData, { onConflict: "restaurant_id" });

        if (upsertError) {
          console.error(
            `  Failed to upsert scores for ${result.id}:`,
            upsertError
          );
          failCount++;
        } else {
          successCount++;
        }
      }

      console.log(`  Scored ${parsed.restaurants.length} restaurants`);
    } catch (err) {
      console.error("Claude failed for batch:", err);
      failCount += batch.length;
    }
  });

  console.log("\n=== Regeneration Summary ===");
  console.log(`Success: ${successCount} restaurants`);
  console.log(`Failed: ${failCount} restaurants`);
  console.log("Done.");
}

main().catch((err) => {
  console.error("Regenerate occasion scores pipeline failed:", err);
  process.exit(1);
});
