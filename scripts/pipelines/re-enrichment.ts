/**
 * Pipeline: Re-Enrichment with Google Context
 *
 * Fixes cuisine_type and best_for_oneliner for all restaurants by using
 * Google Place types as the primary cuisine signal (instead of name-guessing).
 *
 * Hybrid approach:
 *   Tier 1 — Google types lookup: maps specific Google types directly to cuisine
 *   Tier 2 — Claude fallback: for ambiguous types, Claude classifies using reviews
 *   All restaurants get Claude-generated best_for_oneliner with resolved cuisine + reviews
 *
 * Usage: cd scripts && npx tsx pipelines/re-enrichment.ts
 * Env: DRY_RUN=true to preview without DB writes
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { getPlaceDetails } from "../lib/google-places.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";

// Tier 1: Direct Google type → cuisine mapping
const GOOGLE_TYPE_TO_CUISINE: Record<string, string> = {
  mexican_restaurant: "Mexican",
  italian_restaurant: "Italian",
  japanese_restaurant: "Japanese",
  thai_restaurant: "Thai",
  chinese_restaurant: "Chinese",
  korean_restaurant: "Korean",
  indian_restaurant: "Indian",
  french_restaurant: "French",
  seafood_restaurant: "Seafood",
  steak_house: "Steak",
  mediterranean_restaurant: "Mediterranean",
  vietnamese_restaurant: "Vietnamese",
  greek_restaurant: "Greek",
  brazilian_restaurant: "Brazilian",
  american_restaurant: "American",
  hamburger_restaurant: "American",
  barbecue_restaurant: "BBQ",
  brunch_restaurant: "Brunch",
  vegan_restaurant: "Vegan",
  vegetarian_restaurant: "Vegan",
  cafe: "Coffee/Cafe",
  coffee_shop: "Coffee/Cafe",
  bar: "Cocktail Bar",
  // Additional common Google types
  pizza_restaurant: "Italian",
  sushi_restaurant: "Japanese",
  ramen_restaurant: "Japanese",
  middle_eastern_restaurant: "Middle Eastern",
  turkish_restaurant: "Middle Eastern",
  lebanese_restaurant: "Middle Eastern",
  spanish_restaurant: "Mediterranean",
  ethiopian_restaurant: "Ethiopian",
  peruvian_restaurant: "Peruvian",
  brewery: "Brewery/Beer Bar",
};

interface RestaurantRow {
  id: string;
  name: string;
  address: string;
  price_level: string | null;
  google_place_id: string | null;
  cuisine_type: string | null;
  best_for_oneliner: string | null;
}

interface GoogleContext {
  restaurant: RestaurantRow;
  googleTypes: string[];
  reviewSnippets: string[];
  editorialSummary: string | null;
  resolvedCuisine: string | null; // Tier 1 result (null = needs Claude)
}

interface ClaudeResult {
  name: string;
  cuisine_type: string;
  best_for_oneliner: string;
}

function resolveCuisineFromGoogleTypes(types: string[]): string | null {
  for (const type of types) {
    if (GOOGLE_TYPE_TO_CUISINE[type]) {
      return GOOGLE_TYPE_TO_CUISINE[type];
    }
  }
  return null;
}

async function main() {
  console.log("=== Re-Enrichment Pipeline (Google Context) ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const supabase = createAdminClient();

  // Step 1: Fetch all restaurants with google_place_id
  const { data: restaurants, error } = await supabase
    .from("restaurants")
    .select("id, name, address, price_level, google_place_id, cuisine_type, best_for_oneliner")
    .not("google_place_id", "is", null)
    .order("name");

  if (error) throw error;
  if (!restaurants || restaurants.length === 0) {
    console.log("No restaurants with google_place_id found.");
    return;
  }

  console.log(`Found ${restaurants.length} restaurants to re-enrich`);

  let tier1Count = 0;
  let tier2Count = 0;
  let googleFailCount = 0;

  // Step 2: Fetch Google data and resolve cuisine (batch of 5 to respect rate limits)
  await processBatches(restaurants as RestaurantRow[], 5, async (batch) => {
    const contexts: GoogleContext[] = [];

    // Fetch Google Place Details for each restaurant in the batch
    for (const restaurant of batch) {
      if (!restaurant.google_place_id) continue;

      try {
        const details = await getPlaceDetails(
          restaurant.google_place_id,
          "name,types,reviews,editorial_summary"
        );

        if (!details) {
          console.warn(`  Google lookup failed for ${restaurant.name}`);
          googleFailCount++;
          contexts.push({
            restaurant,
            googleTypes: [],
            reviewSnippets: [],
            editorialSummary: null,
            resolvedCuisine: null,
          });
          continue;
        }

        const types = details.types || [];
        const reviews = (details.reviews || [])
          .slice(0, 3)
          .map((r) => (r.text || "").substring(0, 200));
        const editorial = details.editorial_summary?.overview || null;

        // Tier 1: Try direct Google type mapping
        const resolved = resolveCuisineFromGoogleTypes(types);
        if (resolved) {
          tier1Count++;
          console.log(`  ✓ ${restaurant.name}: Google types → ${resolved} (was: ${restaurant.cuisine_type || "N/A"})`);
        } else {
          tier2Count++;
          console.log(`  ? ${restaurant.name}: Generic types [${types.join(", ")}] — needs Claude`);
        }

        contexts.push({
          restaurant,
          googleTypes: types,
          reviewSnippets: reviews,
          editorialSummary: editorial,
          resolvedCuisine: resolved,
        });
      } catch (err) {
        console.error(`  Failed Google fetch for ${restaurant.name}:`, err);
        googleFailCount++;
        contexts.push({
          restaurant,
          googleTypes: [],
          reviewSnippets: [],
          editorialSummary: null,
          resolvedCuisine: null,
        });
      }
    }

    if (contexts.length === 0) return;

    // Step 3: Build Claude prompt for best_for_oneliner (all) + cuisine fallback (ambiguous only)
    const restaurantList = contexts
      .map((ctx) => {
        const cuisineLine = ctx.resolvedCuisine
          ? `Confirmed Cuisine: ${ctx.resolvedCuisine} (from Google types — DO NOT change this)`
          : `Google Types: [${ctx.googleTypes.join(", ")}] (classify the cuisine from these + reviews)`;
        const reviewLine = ctx.reviewSnippets.length > 0
          ? `Top Reviews: ${ctx.reviewSnippets.map((r) => `"${r}"`).join(" | ")}`
          : "No reviews available";
        const editorialLine = ctx.editorialSummary
          ? `Editorial: ${ctx.editorialSummary}`
          : "";

        return [
          `Restaurant: ${ctx.restaurant.name}`,
          `Address: ${ctx.restaurant.address || "N/A"}`,
          `Price Level: ${ctx.restaurant.price_level || "N/A"}`,
          cuisineLine,
          reviewLine,
          editorialLine,
        ].filter(Boolean).join("\n");
      })
      .join("\n\n---\n\n");

    const prompt = `For each restaurant, provide the cuisine_type and a best_for_oneliner.

CUISINE_TYPE rules:
- If "Confirmed Cuisine" is provided, use that EXACT value — do not override it.
- If "Google Types" are provided instead, classify using ONE of: Mexican, American, Italian, Japanese, Thai, Chinese, Korean, French, Seafood, Steak, Mediterranean, Vietnamese, Indian, Ethiopian, Peruvian, Brazilian, Brunch, Vegan, Cocktail Bar, Coffee/Cafe, Polish, Puerto Rican, Southern/Soul Food, Middle Eastern, Greek, Fusion, BBQ
- Use reviews and editorial summary as secondary context if Google types are ambiguous.

BEST_FOR_ONELINER rules:
- Max 15 words. Catchy, specific, not generic.
- Reference what makes this restaurant distinct — cuisine specialty, vibe, or standout quality from reviews.
- Do NOT use: "hidden gem", "culinary", "unforgettable", "a must-visit".
- Bad example: "A must-visit Italian spot with unforgettable flavors"
- Good example: "Handmade pasta and natural wines in a candlelit corner of Logan Square"

Return ONLY valid JSON (no markdown):
{"restaurants": [{"name": "Restaurant Name", "cuisine_type": "Mexican", "best_for_oneliner": "Oaxacan mole and mezcal in a colorful Wicker Park storefront"}]}

Restaurants to analyze:

${restaurantList}`;

    const responseText = await askClaude(prompt, { maxTokens: 4096, temperature: 0.2 });
    const parsed = parseJsonResponse<{ restaurants: ClaudeResult[] }>(responseText);

    // Step 4: Match results and update DB
    for (const ctx of contexts) {
      const claudeResult = parsed.restaurants.find(
        (r) => r.name.toLowerCase().trim() === ctx.restaurant.name.toLowerCase().trim()
      );

      if (!claudeResult) {
        console.warn(`  No Claude result for ${ctx.restaurant.name}`);
        continue;
      }

      // Use Tier 1 cuisine if available, otherwise use Claude's classification
      const finalCuisine = ctx.resolvedCuisine || claudeResult.cuisine_type;
      const finalOneliner = claudeResult.best_for_oneliner;

      const changed =
        finalCuisine !== ctx.restaurant.cuisine_type ||
        finalOneliner !== ctx.restaurant.best_for_oneliner;

      if (!changed) {
        console.log(`  = ${ctx.restaurant.name}: No changes needed`);
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY RUN] ${ctx.restaurant.name}:`);
        if (finalCuisine !== ctx.restaurant.cuisine_type) {
          console.log(`    cuisine: "${ctx.restaurant.cuisine_type}" → "${finalCuisine}"`);
        }
        if (finalOneliner !== ctx.restaurant.best_for_oneliner) {
          console.log(`    oneliner: "${ctx.restaurant.best_for_oneliner}" → "${finalOneliner}"`);
        }
        continue;
      }

      const { error: updateError } = await supabase
        .from("restaurants")
        .update({
          cuisine_type: finalCuisine,
          best_for_oneliner: finalOneliner,
          updated_at: new Date().toISOString(),
        })
        .eq("id", ctx.restaurant.id);

      if (updateError) {
        console.error(`  Failed to update ${ctx.restaurant.name}:`, updateError);
      } else {
        console.log(`  ✓ Updated ${ctx.restaurant.name}: ${finalCuisine} | "${finalOneliner}"`);
      }
    }
  }, 2000); // 2s delay between batches for Google rate limits

  console.log("\n=== Re-Enrichment Summary ===");
  console.log(`Tier 1 (Google types): ${tier1Count} restaurants`);
  console.log(`Tier 2 (Claude fallback): ${tier2Count} restaurants`);
  console.log(`Google failures: ${googleFailCount} restaurants`);
  console.log("Done.");
}

main().catch((err) => {
  console.error("Re-enrichment pipeline failed:", err);
  process.exit(1);
});
