/**
 * Pipeline: Regenerate Tags
 *
 * Re-generates tags for ALL restaurants (including already-tagged ones).
 * Unlike generate-tags.ts which only targets untagged restaurants,
 * this pipeline refreshes tags using the corrected cuisine_type as context.
 *
 * Usage: cd scripts && npx tsx pipelines/regenerate-tags.ts
 * Env: DRY_RUN=true to preview without DB writes
 *      BATCH_LIMIT=50 to process only N restaurants (for incremental runs)
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";
const BATCH_LIMIT = parseInt(process.env.BATCH_LIMIT || "0", 10);

interface TagEntry {
  text: string;
  category: string;
}

interface TagsResult {
  restaurants: Array<{
    id: string;
    tags: (string | TagEntry)[];
  }>;
}

async function main() {
  console.log("=== Regenerate Tags Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  if (BATCH_LIMIT > 0) console.log(`Batch limit: ${BATCH_LIMIT} restaurants`);

  const supabase = createAdminClient();

  const { data: restaurants, error: rError } = await supabase
    .from("restaurants")
    .select(
      "id, name, address, price_level, cuisine_type, noise_level, ambiance, good_for, dietary_options, best_for_oneliner"
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

  console.log(`Regenerating tags for ${targets.length} restaurants`);
  let successCount = 0;
  let failCount = 0;

  await processBatches(targets, 10, async (batch) => {
    const restaurantList = batch
      .map((r, i) => {
        return `${i + 1}. ${r.name} (ID: ${r.id})
   Cuisine: ${r.cuisine_type || "N/A"}
   Price: ${r.price_level || "N/A"}
   Noise: ${r.noise_level || "N/A"}
   Ambiance: ${(r.ambiance || []).join(", ") || "N/A"}
   Good For: ${(r.good_for || []).join(", ") || "N/A"}
   Dietary: ${(r.dietary_options || []).join(", ") || "N/A"}
   One-liner: ${r.best_for_oneliner || "N/A"}`;
      })
      .join("\n\n---\n\n");

    const prompt = `Generate 3-6 short, descriptive tags for each restaurant. Each tag should include a category.

Tag categories: "vibe" (atmosphere/mood), "cuisine" (food style), "feature" (amenities), "dietary" (dietary options), "occasion" (best occasions)

Important: Use the cuisine type to inform tag selection. For example:
- A Polish restaurant should get cuisine tags like "pierogi", "comfort food"
- A BBQ spot should get tags like "smoked meats", "casual"
- A cocktail bar should get tags like "craft cocktails", "date night"

Good tag examples: {"text": "hidden gem", "category": "vibe"}, {"text": "craft cocktails", "category": "feature"}, {"text": "family-style", "category": "vibe"}, {"text": "late night", "category": "feature"}, {"text": "farm-to-table", "category": "cuisine"}, {"text": "byob", "category": "feature"}, {"text": "rooftop", "category": "feature"}, {"text": "brunch spot", "category": "occasion"}, {"text": "date night", "category": "occasion"}, {"text": "trendy", "category": "vibe"}, {"text": "vegan friendly", "category": "dietary"}, {"text": "outdoor patio", "category": "feature"}

Return ONLY valid JSON (no markdown):
{
  "restaurants": [
    {
      "id": "restaurant-uuid",
      "tags": [{"text": "hidden gem", "category": "vibe"}, {"text": "craft cocktails", "category": "feature"}, {"text": "date night", "category": "occasion"}]
    }
  ]
}

Restaurants:

${restaurantList}`;

    try {
      const responseText = await askClaude(prompt);
      const parsed = parseJsonResponse<TagsResult>(responseText);

      for (const result of parsed.restaurants) {
        const rawTags = result.tags || [];
        const validEntries = rawTags
          .map((t) => {
            if (typeof t === "string") {
              return { text: t, category: null as string | null };
            }
            return { text: t.text, category: t.category || null };
          })
          .filter((t) => t.text && t.text !== "null" && t.text.length > 0);

        if (DRY_RUN) {
          console.log(
            `  [DRY RUN] Would replace ${validEntries.length} tags for ${result.id}`
          );
          successCount++;
          continue;
        }

        // Delete existing tags for this restaurant, then insert new ones
        const { error: deleteError } = await supabase
          .from("tags")
          .delete()
          .eq("restaurant_id", result.id);

        if (deleteError) {
          console.error(
            `  Failed to delete old tags for ${result.id}:`,
            deleteError
          );
          failCount++;
          continue;
        }

        const tagRows = validEntries.map((tag) => ({
          restaurant_id: result.id,
          tag_text: tag.text,
          tag_category: tag.category,
        }));

        if (tagRows.length > 0) {
          const { error: insertError } = await supabase
            .from("tags")
            .insert(tagRows);

          if (insertError) {
            console.error(
              `  Failed to insert tags for ${result.id}:`,
              insertError
            );
            failCount++;
          } else {
            successCount++;
          }
        }
      }

      console.log(`  Tagged ${parsed.restaurants.length} restaurants`);
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
  console.error("Regenerate tags pipeline failed:", err);
  process.exit(1);
});
