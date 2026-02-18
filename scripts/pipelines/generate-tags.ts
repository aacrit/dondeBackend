/**
 * Pipeline 6: Generate Tags
 * NEW pipeline - auto-generates descriptive tags for restaurants
 * Schedule: Weekly (Sunday 7am UTC, runs with occasion scores)
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";

interface TagsResult {
  restaurants: Array<{
    id: string;
    tags: string[];
  }>;
}

async function main() {
  console.log("=== Tag Generation Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const supabase = createAdminClient();

  // Find restaurants without tags
  const { data: existingTags, error: tError } = await supabase
    .from("tags")
    .select("restaurant_id");
  if (tError) throw tError;

  const taggedIds = new Set(
    (existingTags || []).map((t) => t.restaurant_id)
  );

  const { data: restaurants, error: rError } = await supabase
    .from("restaurants")
    .select(
      "id, name, address, price_level, noise_level, ambiance, good_for, dietary_options, best_for_oneliner, google_review_summary"
    );
  if (rError) throw rError;

  const untagged = (restaurants || []).filter((r) => !taggedIds.has(r.id));

  if (untagged.length === 0) {
    console.log("All restaurants have tags. Done.");
    return;
  }

  console.log(`Found ${untagged.length} restaurants needing tags`);

  await processBatches(untagged, 10, async (batch) => {
    const restaurantList = batch
      .map((r, i) => {
        return `${i + 1}. ${r.name} (ID: ${r.id})
   Price: ${r.price_level || "N/A"}
   Noise: ${r.noise_level || "N/A"}
   Ambiance: ${(r.ambiance || []).join(", ") || "N/A"}
   Good For: ${(r.good_for || []).join(", ") || "N/A"}
   Dietary: ${(r.dietary_options || []).join(", ") || "N/A"}
   One-liner: ${r.best_for_oneliner || "N/A"}`;
      })
      .join("\n\n---\n\n");

    const prompt = `Generate 3-6 short, descriptive tags for each restaurant. Tags should be lowercase, 1-3 words each, and capture the restaurant's personality.

Good tag examples: "hidden gem", "craft cocktails", "family-style", "late night", "farm-to-table", "byob", "rooftop", "brunch spot", "local favorite", "date night", "trendy", "cash only", "dive bar vibes", "outdoor patio"

Return ONLY valid JSON (no markdown):
{
  "restaurants": [
    {
      "id": "restaurant-uuid",
      "tags": ["hidden gem", "craft cocktails", "date night"]
    }
  ]
}

Restaurants:

${restaurantList}`;

    try {
      const responseText = await askClaude(prompt);
      const parsed = parseJsonResponse<TagsResult>(responseText);

      for (const result of parsed.restaurants) {
        const validTags = (result.tags || []).filter(
          (t) => t && t !== "null" && t.length > 0
        );

        if (DRY_RUN) {
          console.log(
            `  [DRY RUN] Would insert ${validTags.length} tags for ${result.id}`
          );
          continue;
        }

        const tagRows = validTags.map((tag) => ({
          restaurant_id: result.id,
          tag_text: tag,
        }));

        if (tagRows.length > 0) {
          const { error: insertError } = await supabase
            .from("tags")
            .insert(tagRows);

          if (insertError) {
            console.error(
              `Failed to insert tags for ${result.id}:`,
              insertError
            );
          }
        }
      }

      console.log(`  Tagged ${parsed.restaurants.length} restaurants`);
    } catch (err) {
      console.error("Claude failed for batch:", err);
    }
  });

  console.log("Tag generation pipeline complete.");
}

main().catch((err) => {
  console.error("Tag generation pipeline failed:", err);
  process.exit(1);
});
