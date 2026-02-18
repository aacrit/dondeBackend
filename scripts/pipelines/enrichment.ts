/**
 * Pipeline 2: Enhanced Details Enricher
 * Replaces n8n Agent 2 - fills ambiance, dietary, accessibility data via Claude
 * Schedule: Weekly (Sunday 5am UTC)
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";

interface EnrichmentResult {
  restaurants: Array<{
    name: string;
    noise_level: string;
    lighting_ambiance: string;
    dress_code: string;
    ambiance: string;
    dietary_options: string[];
    good_for: string[];
    parking_info: string;
    accessibility_features: string[];
    best_for_oneliner: string;
  }>;
}

async function main() {
  console.log("=== Enrichment Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const supabase = createAdminClient();

  // Fetch restaurants needing enrichment
  const { data: restaurants, error } = await supabase
    .from("restaurants")
    .select("id, name, address, price_level")
    .is("noise_level", null);

  if (error) throw error;
  if (!restaurants || restaurants.length === 0) {
    console.log("No restaurants need enrichment. Done.");
    return;
  }

  console.log(`Found ${restaurants.length} restaurants needing enrichment`);

  await processBatches(restaurants, 10, async (batch) => {
    const restaurantList = batch
      .map(
        (r) =>
          `Restaurant: ${r.name}\nAddress: ${r.address || "N/A"}\nPrice Level: ${r.price_level || "N/A"}`
      )
      .join("\n\n---\n\n");

    const prompt = `Analyze the following restaurants and provide enrichment data for each.

For each restaurant, provide:
1. noise_level: "Quiet", "Moderate", or "Loud"
2. lighting_ambiance: Brief description (e.g., "Dim and intimate", "Bright and modern")
3. dress_code: "Casual", "Smart Casual", "Business Casual", or "Formal"
4. ambiance: Brief overall vibe description
5. dietary_options: Array of options like ["Vegetarian", "Vegan", "Gluten-Free"]
6. good_for: Array of occasions like ["Groups", "Dates", "Families", "Solo"]
7. parking_info: Description of likely parking availability
8. accessibility_features: Array like ["Wheelchair accessible"]
9. best_for_oneliner: A catchy one-liner describing what makes this place special (max 15 words)

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "restaurants": [
    {
      "name": "Restaurant Name",
      "noise_level": "Moderate",
      "lighting_ambiance": "Warm and inviting",
      "dress_code": "Casual",
      "ambiance": "Relaxed neighborhood spot",
      "dietary_options": ["Vegetarian"],
      "good_for": ["Groups"],
      "parking_info": "Street parking available",
      "accessibility_features": ["Wheelchair accessible"],
      "best_for_oneliner": "The hidden gem your foodie friends haven't found yet"
    }
  ]
}

Restaurants to analyze:

${restaurantList}`;

    const responseText = await askClaude(prompt);
    const parsed = parseJsonResponse<EnrichmentResult>(responseText);
    const now = new Date().toISOString();

    for (let i = 0; i < batch.length; i++) {
      const restaurant = batch[i];
      const enrichment = parsed.restaurants[i];
      if (!enrichment) continue;

      const updateData = {
        noise_level: enrichment.noise_level || null,
        lighting_ambiance: enrichment.lighting_ambiance || null,
        dress_code: enrichment.dress_code || null,
        parking_availability: enrichment.parking_info || null,
        ambiance: enrichment.ambiance ? [enrichment.ambiance] : null,
        dietary_options: Array.isArray(enrichment.dietary_options)
          ? enrichment.dietary_options
          : [],
        accessibility_features: Array.isArray(enrichment.accessibility_features)
          ? enrichment.accessibility_features
          : [],
        good_for: Array.isArray(enrichment.good_for)
          ? enrichment.good_for
          : [],
        best_for_oneliner:
          enrichment.best_for_oneliner || null,
        updated_at: now,
        last_data_refresh: now,
      };

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would update ${restaurant.name}:`, updateData.noise_level);
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

  console.log("Enrichment pipeline complete.");
}

main().catch((err) => {
  console.error("Enrichment pipeline failed:", err);
  process.exit(1);
});
