/**
 * One-time Backfill: cuisine_type, outdoor_seating, live_music, pet_friendly
 * For restaurants already enriched (noise_level IS NOT NULL) but missing new fields.
 * Run manually: DRY_RUN=true npx tsx pipelines/backfill-new-fields.ts
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";

interface BackfillResult {
  restaurants: Array<{
    name: string;
    cuisine_type: string;
    outdoor_seating: boolean;
    live_music: boolean;
    pet_friendly: boolean;
  }>;
}

async function main() {
  console.log("=== Backfill New Fields ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const supabase = createAdminClient();

  // Find already-enriched restaurants missing the new fields
  const { data: restaurants, error } = await supabase
    .from("restaurants")
    .select("id, name, address, price_level, ambiance, good_for, dietary_options, best_for_oneliner")
    .not("noise_level", "is", null)
    .is("cuisine_type", null);

  if (error) throw error;
  if (!restaurants || restaurants.length === 0) {
    console.log("No restaurants need backfilling. Done.");
    return;
  }

  console.log(`Found ${restaurants.length} restaurants needing backfill`);

  await processBatches(restaurants, 10, async (batch) => {
    const restaurantList = batch
      .map(
        (r) =>
          `Restaurant: ${r.name}\nAddress: ${r.address || "N/A"}\nPrice Level: ${r.price_level || "N/A"}\nAmbiance: ${(r.ambiance || []).join(", ") || "N/A"}\nGood For: ${(r.good_for || []).join(", ") || "N/A"}\nDietary: ${(r.dietary_options || []).join(", ") || "N/A"}\nOne-liner: ${r.best_for_oneliner || "N/A"}`
      )
      .join("\n\n---\n\n");

    const prompt = `Analyze the following restaurants and provide these fields for each:

1. cuisine_type: Primary cuisine category. Use ONE of: "Mexican", "American", "Italian", "Japanese", "Thai", "Chinese", "Korean", "French", "Seafood", "Steak", "Mediterranean", "Vietnamese", "Indian", "Vegan", "Brunch", "Cocktail Bar", "Coffee/Cafe", or similar. Must be a single string.
2. outdoor_seating: true/false — whether the restaurant has outdoor/patio seating
3. live_music: true/false — whether the restaurant regularly features live music
4. pet_friendly: true/false — whether the restaurant allows pets (especially on patios)

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "restaurants": [
    {
      "name": "Restaurant Name",
      "cuisine_type": "Italian",
      "outdoor_seating": true,
      "live_music": false,
      "pet_friendly": true
    }
  ]
}

Restaurants to analyze:

${restaurantList}`;

    const responseText = await askClaude(prompt);
    const parsed = parseJsonResponse<BackfillResult>(responseText);

    for (let i = 0; i < batch.length; i++) {
      const restaurant = batch[i];
      const result = parsed.restaurants[i];
      if (!result) continue;

      const updateData = {
        cuisine_type: result.cuisine_type || null,
        outdoor_seating: result.outdoor_seating ?? null,
        live_music: result.live_music ?? null,
        pet_friendly: result.pet_friendly ?? null,
        updated_at: new Date().toISOString(),
      };

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would update ${restaurant.name}:`, updateData);
        continue;
      }

      const { error: updateError } = await supabase
        .from("restaurants")
        .update(updateData)
        .eq("id", restaurant.id);

      if (updateError) {
        console.error(`Failed to update ${restaurant.name}:`, updateError);
      } else {
        console.log(`  Updated: ${restaurant.name}`);
      }
    }
  });

  console.log("Backfill complete.");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
