/**
 * Pipeline 1: Restaurant Discovery
 * Replaces n8n Agent 1 - discovers new restaurants via Google Places API
 * Schedule: Weekly (Sunday 3am UTC)
 */

import { createAdminClient } from "../lib/supabase.js";
import { textSearch, getPlaceDetails } from "../lib/google-places.js";
import {
  NEIGHBORHOODS,
  CUISINE_TYPES,
  CHICAGO_COORDS,
  SEARCH_RADIUS,
  PRICE_MAP,
  ZIP_TO_NEIGHBORHOOD,
  NEIGHBORHOOD_BOUNDS,
} from "../lib/config.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";

async function main() {
  console.log("=== Restaurant Discovery Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const supabase = createAdminClient();

  // Step 1: Get neighborhood IDs from DB
  const { data: neighborhoods, error: nhError } = await supabase
    .from("neighborhoods")
    .select("*");
  if (nhError) throw nhError;

  const neighborhoodIdMap = new Map<string, string>();
  for (const n of neighborhoods!) {
    neighborhoodIdMap.set(n.name, n.id);
  }

  // Step 2: Generate all search queries
  const queries: Array<{ neighborhood: string; cuisine: string; query: string }> = [];
  for (const neighborhood of NEIGHBORHOODS) {
    for (const cuisine of CUISINE_TYPES) {
      queries.push({
        neighborhood,
        cuisine,
        query: `${cuisine} restaurants in ${neighborhood}, Chicago`,
      });
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

      toInsert.push({
        name: result.name,
        address: result.formatted_address,
        neighborhood_id: neighborhoodId,
        google_place_id: result.place_id,
        google_rating: result.rating || null,
        google_review_count: result.user_ratings_total || null,
        price_level: PRICE_MAP[result.price_level ?? 2] || "$$",
        phone: result.formatted_phone_number || null,
        website: result.website || null,
        hours_of_operation: result.opening_hours || null,
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
      toInsert.slice(0, 3).map((r) => `${r.name} (${r.address})`)
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
}

main().catch((err) => {
  console.error("Discovery pipeline failed:", err);
  process.exit(1);
});
