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
}

interface TagRow {
  restaurant_id: string;
  tag_text: string;
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

  // Fetch ALL restaurants (Supabase defaults to 1000 rows, so paginate)
  const PAGE = 1000;
  const allRestaurants: RestaurantRow[] = [];
  let page = 0;
  while (true) {
    let query = supabase
      .from("restaurants")
      .select("id, name, cuisine_type")
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (cuisineFilter) {
      query = query.ilike("cuisine_type", `%${cuisineFilter}%`);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch restaurants: ${error.message}`);
    if (!data?.length) break;
    allRestaurants.push(...(data as RestaurantRow[]));
    if (data.length < PAGE) break;   // last page
    page++;
  }

  let restaurants = allRestaurants;
  if (limitArg) {
    restaurants = restaurants.slice(0, limitArg);
  }

  if (!restaurants.length) {
    console.log("No restaurants found matching criteria.");
    return;
  }

  console.log(`Found ${restaurants.length} restaurants in DB`);
  if (cuisineFilter) console.log(`Cuisine filter: ${cuisineFilter}`);
  if (limitArg) console.log(`Limit: ${limitArg}`);

  // Fetch tags + profiles in 100-ID chunks (PostgREST URL length limit)
  const ids = restaurants.map((r: RestaurantRow) => r.id);
  const CHUNK = 100;

  const allTagRows: TagRow[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("tags")
      .select("restaurant_id, tag_text")
      .in("restaurant_id", chunk);
    if (error) throw new Error(`Failed to fetch tags (chunk ${i}): ${error.message}`);
    if (data) allTagRows.push(...(data as TagRow[]));
  }

  const tagMap = new Map<string, string[]>();
  for (const t of allTagRows) {
    const existing = tagMap.get(t.restaurant_id) || [];
    existing.push(t.tag_text);
    tagMap.set(t.restaurant_id, existing);
  }

  const allProfiles: DeepProfileRow[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("restaurant_deep_profiles")
      .select("restaurant_id, signature_dishes, menu_highlights, flavor_profiles")
      .in("restaurant_id", chunk);
    if (error) throw new Error(`Failed to fetch profiles (chunk ${i}): ${error.message}`);
    if (data) allProfiles.push(...(data as DeepProfileRow[]));
  }

  const profileMap = new Map<string, DeepProfileRow>();
  for (const p of allProfiles) {
    profileMap.set(p.restaurant_id, p);
  }

  // Resume support: skip restaurants already enriched
  const needsEnrichment = restaurants.filter((r) => {
    const profile = profileMap.get(r.id);
    if (!profile) return true; // no profile at all → needs enrichment
    const hasDishes =
      Array.isArray(profile.signature_dishes) &&
      profile.signature_dishes.length >= 10;
    const hasHighlights =
      Array.isArray(profile.menu_highlights) &&
      profile.menu_highlights.length > 0;
    return !(hasDishes && hasHighlights);
  });

  const skipped = restaurants.length - needsEnrichment.length;
  console.log(
    `Skipping ${skipped} already-enriched restaurants, ${needsEnrichment.length} remaining`,
  );

  if (!needsEnrichment.length) {
    console.log("All restaurants already enriched. Nothing to do.");
    return;
  }

  if (!isLive) {
    console.log(`\nReady to enrich ${needsEnrichment.length} restaurants.`);
    console.log("Run with --live to execute. Exiting (dry-run).");
    return;
  }

  // Process in batches
  let enriched = 0;
  let failed = 0;

  await processBatches(
    needsEnrichment,
    10, // batch size
    async (batch) => {
      const promises = batch.map(async (r) => {
        try {
          const profile = profileMap.get(r.id);
          const prompt = buildEnrichmentPrompt(
            r.name,
            r.cuisine_type,
            profile?.signature_dishes || null,
            tagMap.get(r.id) || [],
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
    `\nDone. Enriched: ${enriched}, Failed: ${failed}, Skipped: ${skipped}, Total: ${restaurants.length}`,
  );
}

main().catch(console.error);
