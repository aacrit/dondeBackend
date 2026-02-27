/**
 * V6 Dish Enrichment Script
 *
 * Expands signature_dishes from 3-5 to 10-15 items and populates the new
 * menu_highlights field for all restaurants. Uses Claude Haiku to extract
 * dish names from existing profile data + Google review snippets.
 *
 * Usage:
 *   tsx enrich-dishes.ts                      # all restaurants
 *   tsx enrich-dishes.ts --cuisine Indian     # only Indian restaurants
 *   tsx enrich-dishes.ts --limit 10           # first 10 only (dry-run)
 *   tsx enrich-dishes.ts --live               # skip confirmation prompt
 */

import { createAdminClient } from "./lib/supabase.ts";
import { askClaude, parseJsonResponse } from "./lib/claude.ts";
import { processBatches } from "./lib/batch.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RestaurantRow {
  id: string;
  name: string;
  cuisine_type: string | null;
  tags: string[];
}

interface DeepProfileRow {
  restaurant_id: string;
  signature_dishes: Array<{ dish: string; why: string }> | null;
  menu_highlights: string[] | null;
  flavor_profiles: string[] | null;
}

interface EnrichmentResult {
  signature_dishes: Array<{ dish: string; why: string }>;
  menu_highlights: string[];
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const cuisineFilter = args.includes("--cuisine")
  ? args[args.indexOf("--cuisine") + 1]
  : null;
const limitArg = args.includes("--limit")
  ? parseInt(args[args.indexOf("--limit") + 1], 10)
  : null;
const isLive = args.includes("--live");

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildEnrichmentPrompt(
  name: string,
  cuisineType: string | null,
  existingDishes: Array<{ dish: string; why: string }> | null,
  tags: string[],
  flavorProfiles: string[] | null,
): string {
  const existing = existingDishes?.map((d) => d.dish).join(", ") || "None";

  return `You are a Chicago restaurant menu expert. Given a restaurant's profile, extract:
1. signature_dishes: 10-15 specific named dishes this restaurant likely serves. Include the existing ones plus additional popular/notable dishes based on the cuisine type, restaurant name hints, and tags. Each dish needs a "dish" name and brief "why" (2-5 words explaining why it's notable).
2. menu_highlights: A flat list of 15-25 commonly served menu items (dish names only, no descriptions). Include staples for this cuisine type that this restaurant almost certainly serves.

RULES:
- Be specific: "Tandoori Chicken" not "chicken dish"
- Use proper dish names with cultural accuracy: "Chicken Tikka Masala" not "tikka chicken"
- Include both signatures and staple items for the cuisine
- For Indian: include tandoori items, curries, biryanis, breads, appetizers, desserts
- For Italian: include pastas, pizzas, antipasti, secondi, dolci
- For Japanese: include sushi, sashimi, rolls, ramen, appetizers
- Do NOT invent fusion dishes unless the restaurant is explicitly fusion
- Keep existing signature_dishes — add to them, don't replace

Restaurant: ${name}
Cuisine: ${cuisineType || "Unknown"}
Existing signature dishes: ${existing}
Tags: ${tags.join(", ") || "None"}
Flavor profile: ${flavorProfiles?.join(", ") || "Unknown"}

Respond ONLY in JSON:
{"signature_dishes":[{"dish":"Name","why":"Brief reason"}],"menu_highlights":["Dish Name 1","Dish Name 2"]}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const supabase = createAdminClient();

  // Fetch restaurants
  let query = supabase
    .from("restaurants")
    .select("id, name, cuisine_type, tags");

  if (cuisineFilter) {
    query = query.ilike("cuisine_type", `%${cuisineFilter}%`);
  }

  if (limitArg) {
    query = query.limit(limitArg);
  }

  const { data: restaurants, error: restError } = await query;
  if (restError) throw new Error(`Failed to fetch restaurants: ${restError.message}`);
  if (!restaurants?.length) {
    console.log("No restaurants found matching criteria.");
    return;
  }

  console.log(`Found ${restaurants.length} restaurants to enrich`);
  if (cuisineFilter) console.log(`Cuisine filter: ${cuisineFilter}`);
  if (limitArg) console.log(`Limit: ${limitArg}`);

  // Fetch existing deep profiles
  const ids = restaurants.map((r: RestaurantRow) => r.id);
  const { data: profiles, error: profError } = await supabase
    .from("restaurant_deep_profiles")
    .select("restaurant_id, signature_dishes, menu_highlights, flavor_profiles")
    .in("restaurant_id", ids);

  if (profError) throw new Error(`Failed to fetch profiles: ${profError.message}`);

  const profileMap = new Map<string, DeepProfileRow>();
  for (const p of (profiles || []) as DeepProfileRow[]) {
    profileMap.set(p.restaurant_id, p);
  }

  if (!isLive) {
    console.log(`\nReady to enrich ${restaurants.length} restaurants.`);
    console.log("Run with --live to execute. Exiting (dry-run).");
    return;
  }

  // Process in batches
  let enriched = 0;
  let failed = 0;

  await processBatches(
    restaurants as RestaurantRow[],
    10, // batch size
    async (batch) => {
      const promises = batch.map(async (r) => {
        try {
          const profile = profileMap.get(r.id);
          const prompt = buildEnrichmentPrompt(
            r.name,
            r.cuisine_type,
            profile?.signature_dishes || null,
            r.tags || [],
            profile?.flavor_profiles || null,
          );

          const response = await askClaude(prompt, {
            maxTokens: 2048,
            temperature: 0.2,
          });

          const result = parseJsonResponse<EnrichmentResult>(response);

          // Validate
          if (
            !Array.isArray(result.signature_dishes) ||
            !Array.isArray(result.menu_highlights)
          ) {
            throw new Error("Invalid response structure");
          }

          // Deduplicate signature_dishes by dish name
          const seenDishes = new Set<string>();
          const dedupedDishes = result.signature_dishes.filter((d) => {
            const key = d.dish.toLowerCase().trim();
            if (seenDishes.has(key)) return false;
            seenDishes.add(key);
            return true;
          });

          // Deduplicate menu_highlights
          const dedupedHighlights = [
            ...new Set(
              result.menu_highlights.map((h) => h.trim()).filter(Boolean),
            ),
          ];

          // Upsert into deep_profile
          const { error: upsertError } = await supabase
            .from("restaurant_deep_profiles")
            .upsert(
              {
                restaurant_id: r.id,
                signature_dishes: dedupedDishes,
                menu_highlights: dedupedHighlights,
              },
              { onConflict: "restaurant_id" },
            );

          if (upsertError) {
            throw new Error(`Upsert failed: ${upsertError.message}`);
          }

          enriched++;
          console.log(
            `  ✓ ${r.name}: ${dedupedDishes.length} dishes, ${dedupedHighlights.length} highlights`,
          );
        } catch (err) {
          failed++;
          console.error(`  ✗ ${r.name}: ${(err as Error).message}`);
        }
      });

      await Promise.all(promises);
    },
    2000, // 2s delay between batches
  );

  console.log(
    `\nDone. Enriched: ${enriched}, Failed: ${failed}, Total: ${restaurants.length}`,
  );
}

main().catch(console.error);
