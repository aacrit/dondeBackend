/**
 * Pipeline: Validate Restaurant Status
 * Enhancement 20: Closed-restaurant detection and deactivation
 * Checks Google Places business_status for all active restaurants.
 * Deactivates permanently closed restaurants.
 * Schedule: Monthly (or triggered manually)
 */

import { createAdminClient } from "../lib/supabase.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";

interface PlaceDetailsResult {
  result?: {
    business_status?: string;
    name?: string;
  };
  status: string;
}

async function fetchBusinessStatus(placeId: string, apiKey: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: "business_status,name",
      key: apiKey,
    });

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`
    );

    if (!res.ok) return null;

    const data: PlaceDetailsResult = await res.json();
    return data.result?.business_status || null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("=== Restaurant Status Validation Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_PLACES_API_KEY");

  const supabase = createAdminClient();

  // Get all active restaurants with Google place IDs
  const { data: restaurants, error: rError } = await supabase
    .from("restaurants")
    .select("id, name, google_place_id, is_active")
    .not("google_place_id", "is", null)
    .or("is_active.is.null,is_active.eq.true");

  if (rError) throw rError;
  if (!restaurants || restaurants.length === 0) {
    console.log("No restaurants to validate.");
    return;
  }

  console.log(`Validating status for ${restaurants.length} restaurants`);

  let closedCount = 0;
  let tempClosedCount = 0;
  let operationalCount = 0;

  await processBatches(restaurants, 5, async (batch) => {
    for (const restaurant of batch) {
      if (!restaurant.google_place_id) continue;

      const status = await fetchBusinessStatus(restaurant.google_place_id, apiKey);
      if (!status) {
        console.log(`  Could not fetch status for ${restaurant.name}`);
        continue;
      }

      if (status === "CLOSED_PERMANENTLY") {
        closedCount++;
        console.log(`  CLOSED: ${restaurant.name}`);

        if (!DRY_RUN) {
          const { error: updateError } = await supabase
            .from("restaurants")
            .update({ is_active: false })
            .eq("id", restaurant.id);

          if (updateError) {
            console.error(`  Failed to deactivate ${restaurant.name}:`, updateError);
          }
        }
      } else if (status === "CLOSED_TEMPORARILY") {
        tempClosedCount++;
        console.log(`  TEMP CLOSED: ${restaurant.name}`);
      } else {
        operationalCount++;
      }
    }
  }, 500); // 500ms delay between batches for API rate limiting

  console.log(`\nResults:`);
  console.log(`  Operational: ${operationalCount}`);
  console.log(`  Temporarily closed: ${tempClosedCount}`);
  console.log(`  Permanently closed: ${closedCount}`);
  console.log("Status validation pipeline complete.");
}

main().catch((err) => {
  console.error("Status validation pipeline failed:", err);
  process.exit(1);
});
