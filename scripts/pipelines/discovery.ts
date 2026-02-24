/**
 * Pipeline 1: Restaurant Discovery
 * Replaces n8n Agent 1 - discovers new restaurants via Google Places API
 * Schedule: Weekly (Sunday 3am UTC)
 *
 * Modes:
 *   Default:  Searches all CUISINE_TYPES × NEIGHBORHOODS (broad sweep)
 *   Targeted: TARGET_CUISINES=Japanese,Korean — only searches specified cuisines
 *             Also searches sub-cuisine variants (ramen, sushi, izakaya, etc.)
 *   Variants: INCLUDE_VARIANTS=true — adds sub-cuisine search queries from
 *             CUISINE_SEARCH_VARIANTS (e.g. "ramen in West Loop, Chicago")
 *
 * Usage:
 *   npx tsx pipelines/discovery.ts                         # full sweep
 *   TARGET_CUISINES=Japanese npx tsx pipelines/discovery.ts # targeted Japanese
 *   INCLUDE_VARIANTS=true npx tsx pipelines/discovery.ts   # full sweep + variants
 *   DRY_RUN=true npx tsx pipelines/discovery.ts            # preview without insert
 */

import { createAdminClient } from "../lib/supabase.js";
import { textSearch, getPlaceDetails } from "../lib/google-places.js";
import {
  NEIGHBORHOODS,
  CUISINE_TYPES,
  CUISINE_SEARCH_VARIANTS,
  CHICAGO_COORDS,
  SEARCH_RADIUS,
  PRICE_MAP,
  ZIP_TO_NEIGHBORHOOD,
  NEIGHBORHOOD_BOUNDS,
} from "../lib/config.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";
const TARGET_CUISINES = process.env.TARGET_CUISINES
  ? process.env.TARGET_CUISINES.split(",").map((c) => c.trim())
  : null;
// Include sub-cuisine variant searches (always on for targeted mode)
const INCLUDE_VARIANTS =
  process.env.INCLUDE_VARIANTS === "true" || TARGET_CUISINES !== null;

async function main() {
  console.log("=== Restaurant Discovery Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  if (TARGET_CUISINES) {
    console.log(`Targeted cuisines: ${TARGET_CUISINES.join(", ")}`);
  }
  if (INCLUDE_VARIANTS) {
    console.log("Sub-cuisine variant searches: ENABLED");
  }

  const supabase = createAdminClient();

  // Step 0: Cuisine gap analysis — report current coverage
  const { data: coverageData, error: covError } = await supabase
    .from("restaurants")
    .select("cuisine_type")
    .eq("is_active", true)
    .not("noise_level", "is", null);

  if (!covError && coverageData) {
    const counts = new Map<string, number>();
    for (const r of coverageData) {
      const c = r.cuisine_type || "Unknown";
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    console.log("\nCurrent cuisine coverage (enriched + active restaurants):");
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [cuisine, count] of sorted) {
      console.log(`  ${cuisine}: ${count}`);
    }
    // Identify gaps — cuisines with 0 enriched restaurants
    const gaps = (CUISINE_TYPES as readonly string[]).filter(
      (c) => !counts.has(c) || counts.get(c)! < 3
    );
    if (gaps.length > 0) {
      console.log(`\n  GAPS (< 3 restaurants): ${gaps.join(", ")}`);
    }
    console.log();
  }

  // Step 1: Get neighborhood IDs from DB
  const { data: neighborhoods, error: nhError } = await supabase
    .from("neighborhoods")
    .select("*");
  if (nhError) throw nhError;

  const neighborhoodIdMap = new Map<string, string>();
  for (const n of neighborhoods!) {
    neighborhoodIdMap.set(n.name, n.id);
  }

  // Step 2: Generate search queries
  const cuisines = TARGET_CUISINES
    ? TARGET_CUISINES
    : (CUISINE_TYPES as readonly string[]);

  const queries: Array<{
    neighborhood: string;
    cuisine: string;
    query: string;
  }> = [];

  for (const neighborhood of NEIGHBORHOODS) {
    for (const cuisine of cuisines) {
      // Base query: "Japanese restaurants in West Loop, Chicago"
      queries.push({
        neighborhood,
        cuisine,
        query: `${cuisine} restaurants in ${neighborhood}, Chicago`,
      });

      // Variant queries: "ramen in West Loop, Chicago", "sushi in West Loop, Chicago"
      if (INCLUDE_VARIANTS) {
        const variants = CUISINE_SEARCH_VARIANTS[cuisine] || [];
        for (const variant of variants) {
          queries.push({
            neighborhood,
            cuisine,
            query: `best ${variant} in ${neighborhood}, Chicago`,
          });
        }
      }
    }
  }

  // For targeted mode, also add city-wide searches without neighborhood restriction
  if (TARGET_CUISINES) {
    for (const cuisine of TARGET_CUISINES) {
      queries.push({
        neighborhood: "Chicago",
        cuisine,
        query: `best ${cuisine} restaurants in Chicago`,
      });
      queries.push({
        neighborhood: "Chicago",
        cuisine,
        query: `top rated ${cuisine} food Chicago`,
      });
      const variants = CUISINE_SEARCH_VARIANTS[cuisine] || [];
      for (const variant of variants) {
        queries.push({
          neighborhood: "Chicago",
          cuisine,
          query: `best ${variant} in Chicago`,
        });
        queries.push({
          neighborhood: "Chicago",
          cuisine,
          query: `${variant} restaurant Chicago`,
        });
      }
    }
  }

  console.log(`Generated ${queries.length} search queries`);

  // Step 3: Run Google Places searches and collect unique place IDs
  const placeMap = new Map<string, { place_id: string; name: string }>();

  await processBatches(queries, 5, async (batch) => {
    const results = await Promise.all(
      batch.map((q) => textSearch(q.query, CHICAGO_COORDS, SEARCH_RADIUS))
    );

    for (const searchResults of results) {
      for (const place of searchResults.slice(0, 20)) {
        if (!placeMap.has(place.place_id)) {
          placeMap.set(place.place_id, {
            place_id: place.place_id,
            name: place.name,
          });
        }
      }
    }
  }, 500);

  console.log(`Found ${placeMap.size} unique restaurants from searches`);

  // Step 4: Check against existing restaurants
  const { data: existing, error: exError } = await supabase
    .from("restaurants")
    .select("google_place_id, name, address");
  if (exError) throw exError;

  const existingPlaceIds = new Set(
    existing!.map((r) => r.google_place_id).filter(Boolean)
  );
  const existingCombos = new Set(
    existing!.map(
      (r) =>
        `${(r.name || "").toLowerCase().trim()}|||${(r.address || "").toLowerCase().trim()}`
    )
  );

  const newPlaces = Array.from(placeMap.values()).filter(
    (p) => !existingPlaceIds.has(p.place_id)
  );
  console.log(
    `${newPlaces.length} potentially new restaurants (${placeMap.size - newPlaces.length} already in DB)`
  );

  if (newPlaces.length === 0) {
    console.log("No new restaurants to add. Done.");
    return;
  }

  // Step 5: Get Place Details for new restaurants
  const toInsert: Array<Record<string, unknown>> = [];
  const now = new Date().toISOString();

  await processBatches(newPlaces, 5, async (batch) => {
    const details = await Promise.all(
      batch.map((p) => getPlaceDetails(p.place_id))
    );

    for (const result of details) {
      if (!result) continue;

      // Check name+address dedup
      const combo = `${(result.name || "").toLowerCase().trim()}|||${(result.formatted_address || "").toLowerCase().trim()}`;
      if (existingCombos.has(combo)) continue;

      // Map to neighborhood
      let neighborhoodId: string | null = null;
      const address = result.formatted_address || "";

      // Try ZIP code first
      const zipMatch = address.match(/\b(\d{5})\b/);
      if (zipMatch) {
        const nhName = ZIP_TO_NEIGHBORHOOD[zipMatch[1]];
        if (nhName) neighborhoodId = neighborhoodIdMap.get(nhName) || null;
      }

      // Fallback: coordinate bounding boxes
      if (!neighborhoodId && result.geometry?.location) {
        const { lat, lng } = result.geometry.location;
        for (const [name, bounds] of Object.entries(NEIGHBORHOOD_BOUNDS)) {
          if (
            lat >= bounds.latMin &&
            lat <= bounds.latMax &&
            lng >= bounds.lngMin &&
            lng <= bounds.lngMax
          ) {
            neighborhoodId = neighborhoodIdMap.get(name) || null;
            break;
          }
        }
      }

      // Store only compliant data: place_id (allowed), name/address (editorial),
      // price_level (our classification). Google-specific fields (rating, phone,
      // website, hours) are NOT stored per Google Maps Platform ToS Section 3.2.3.
      toInsert.push({
        name: result.name,
        address: result.formatted_address,
        neighborhood_id: neighborhoodId,
        google_place_id: result.place_id,
        price_level: PRICE_MAP[result.price_level ?? 2] || "$$",
        data_source: "google_places_api",
        created_at: now,
        updated_at: now,
      });
    }
  }, 500);

  console.log(`${toInsert.length} restaurants ready for insertion`);

  if (DRY_RUN) {
    console.log("DRY RUN — skipping database insert");
    console.log(
      "Sample:",
      toInsert.slice(0, 5).map((r) => `${r.name} (${r.address})`)
    );
    return;
  }

  // Step 6: Insert to Supabase
  if (toInsert.length > 0) {
    const { error: insertError } = await supabase
      .from("restaurants")
      .insert(toInsert);

    if (insertError) {
      console.error("Insert error:", insertError);
      throw insertError;
    }

    console.log(`Successfully inserted ${toInsert.length} new restaurants`);
  }

  // Step 7: Post-insert summary
  if (TARGET_CUISINES) {
    console.log(
      `\nNext steps: Run enrichment + scores + tags pipelines for the new restaurants:`
    );
    console.log("  npx tsx pipelines/enrichment.ts");
    console.log("  npx tsx pipelines/enrichment-v2.ts");
    console.log("  npx tsx pipelines/generate-occasion-scores.ts");
    console.log("  npx tsx pipelines/generate-tags.ts");
  }
}

main().catch((err) => {
  console.error("Discovery pipeline failed:", err);
  process.exit(1);
});
