/**
 * Pipeline: Clean Unenriched Restaurants
 * Removes unenriched restaurant rows that would be excluded by the donde engine.
 * Saves Claude AI API costs by preventing enrichment of disqualified restaurants.
 *
 * Criteria for deletion (any one triggers removal):
 *   1. No google_place_id (can't verify or enrich)
 *   2. Distance from Chicago downtown > 10 miles
 *   3. Google rating < 3.8
 *   4. Google review count < 10
 *   5. business_status === "CLOSED_PERMANENTLY"
 *   6. Google types contain no food/restaurant/bar types
 *
 * Safety:
 *   - DRY_RUN=true by default (preview only)
 *   - Never deletes enriched restaurants (noise_level IS NOT NULL)
 *   - DELETE WHERE clause includes noise_level IS NULL guard
 *
 * Usage:
 *   npx tsx pipelines/clean-unenriched.ts                          # dry run
 *   DRY_RUN=false npx tsx pipelines/clean-unenriched.ts            # live delete
 *   SINCE_YESTERDAY=true npx tsx pipelines/clean-unenriched.ts     # only recent adds
 *   DRY_RUN=false SINCE_YESTERDAY=true npx tsx pipelines/clean-unenriched.ts
 */

import { createAdminClient } from "../lib/supabase.js";
import { processBatches } from "../lib/batch.js";
import { CHICAGO_COORDS } from "../lib/config.js";

// --- Configuration ---
const DRY_RUN = process.env.DRY_RUN !== "false";
const SINCE_YESTERDAY = process.env.SINCE_YESTERDAY === "true";
const RADIUS_MILES = Number(process.env.RADIUS_MILES) || 10;
const MIN_RATING = Number(process.env.MIN_RATING) || 3.8;
const MIN_REVIEWS = Number(process.env.MIN_REVIEWS) || 10;
const GOOGLE_FIELDS =
  "business_status,rating,user_ratings_total,types,geometry,name";
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 500;
const DELETE_CHUNK_SIZE = 100;

// --- Types ---
type DeletionReason =
  | "no_google_place_id"
  | "permanently_closed"
  | "not_food_establishment"
  | "too_far_from_downtown"
  | "low_rating"
  | "too_few_reviews";

interface FlaggedRestaurant {
  id: string;
  name: string;
  reasons: DeletionReason[];
  details: string[];
}

interface PlaceDetailsWithStatus {
  place_id: string;
  name: string;
  business_status?: string;
  rating?: number;
  user_ratings_total?: number;
  types?: string[];
  geometry?: {
    location: { lat: number; lng: number };
  };
}

// --- Food-type allowlist ---
const FOOD_TYPES = new Set([
  "restaurant",
  "bar",
  "food",
  "cafe",
  "bakery",
  "meal_delivery",
  "meal_takeaway",
  "night_club",
  "mexican_restaurant",
  "italian_restaurant",
  "steak_house",
  "pizza_restaurant",
  "sushi_restaurant",
  "thai_restaurant",
  "chinese_restaurant",
  "japanese_restaurant",
  "french_restaurant",
  "indian_restaurant",
  "korean_restaurant",
  "vietnamese_restaurant",
  "seafood_restaurant",
  "hamburger_restaurant",
  "breakfast_restaurant",
  "brunch_restaurant",
  "ramen_restaurant",
  "barbecue_restaurant",
  "turkish_restaurant",
  "greek_restaurant",
  "spanish_restaurant",
  "lebanese_restaurant",
  "middle_eastern_restaurant",
  "american_restaurant",
  "asian_restaurant",
  "indonesian_restaurant",
  "african_restaurant",
  "mediterranean_restaurant",
  "vegan_restaurant",
  "vegetarian_restaurant",
]);

// --- Helpers ---

function haversineDistanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isFoodEstablishment(types: string[]): boolean {
  return types.some(
    (t) => FOOD_TYPES.has(t) || t.includes("restaurant")
  );
}

/**
 * Direct Google Places API call with proper error logging.
 * Does NOT use the shared getPlaceDetails() which silently swallows errors.
 * Pattern borrowed from validate-status.ts.
 */
let firstApiError: string | null = null;

async function fetchPlaceForCleanup(
  placeId: string,
  apiKey: string
): Promise<PlaceDetailsWithStatus | null> {
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: GOOGLE_FIELDS,
      key: apiKey,
    });

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`
    );

    if (!res.ok) {
      const errText = `HTTP ${res.status} ${res.statusText}`;
      if (!firstApiError) {
        firstApiError = errText;
        console.error(`\n  *** GOOGLE API HTTP ERROR: ${errText} ***`);
      }
      return null;
    }

    const data = await res.json();

    if (data.status !== "OK") {
      const errMsg = `${data.status} — ${data.error_message || "no details"}`;
      if (!firstApiError) {
        firstApiError = errMsg;
        console.error(`\n  *** GOOGLE API ERROR: ${errMsg} ***`);
        console.error(`  Check: Is GOOGLE_PLACES_API_KEY valid? Is Places API enabled? Is billing active?\n`);
      }
      return null;
    }

    return data.result || null;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (!firstApiError) {
      firstApiError = errMsg;
      console.error(`\n  *** FETCH ERROR: ${errMsg} ***`);
    }
    return null;
  }
}

// --- Main ---

async function main() {
  const now = new Date().toISOString();
  console.log("============================================");
  console.log("  CLEAN UNENRICHED RESTAURANTS");
  console.log(`  ${now}`);
  console.log("============================================");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (set DRY_RUN=false to delete)" : "LIVE — deletions will execute"}`);
  console.log(`Radius: ${RADIUS_MILES} miles | Min rating: ${MIN_RATING} | Min reviews: ${MIN_REVIEWS}`);

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_PLACES_API_KEY environment variable");
  console.log(`Google API key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);

  const supabase = createAdminClient();

  // Step 1: Query unenriched restaurants
  let query = supabase
    .from("restaurants")
    .select("id, name, address, google_place_id, created_at")
    .is("noise_level", null)
    .or("is_active.is.null,is_active.eq.true");

  if (SINCE_YESTERDAY) {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    query = query.gte("created_at", yesterday);
    console.log(`Filter: Only restaurants added since ${yesterday.slice(0, 10)}`);
  } else {
    console.log("Filter: All unenriched restaurants");
  }

  const { data: restaurants, error: fetchError } = await query;
  if (fetchError) throw fetchError;

  if (!restaurants || restaurants.length === 0) {
    console.log("\nNo unenriched restaurants found. Nothing to clean.");
    return;
  }

  console.log(`\nUnenriched restaurants found: ${restaurants.length}`);

  // Step 2: Separate — no google_place_id vs has place_id
  const noPlaceId = restaurants.filter((r) => !r.google_place_id);
  const withPlaceId = restaurants.filter((r) => r.google_place_id);

  const flagged: FlaggedRestaurant[] = [];
  let apiSkipped = 0;

  // Flag restaurants without place_id
  for (const r of noPlaceId) {
    flagged.push({
      id: r.id,
      name: r.name || "(unnamed)",
      reasons: ["no_google_place_id"],
      details: ["No google_place_id — cannot verify or enrich"],
    });
  }

  // Step 3: Batch-fetch Google Places details and evaluate
  // Uses direct fetch (NOT shared getPlaceDetails which swallows errors)
  let processed = 0;
  let apiSuccessCount = 0;

  await processBatches(
    withPlaceId,
    BATCH_SIZE,
    async (batch, batchIndex) => {
      for (const restaurant of batch) {
        const details = await fetchPlaceForCleanup(
          restaurant.google_place_id!,
          apiKey
        );

        processed++;

        if (!details) {
          apiSkipped++;

          // Early abort: if first full batch ALL failed, stop wasting API calls
          if (batchIndex === 1 && apiSkipped >= BATCH_SIZE && apiSuccessCount === 0) {
            throw new Error(
              `\nABORTING: First ${BATCH_SIZE} API calls ALL failed.\n` +
              `Google API error: ${firstApiError}\n` +
              `Fix the issue above and retry.`
            );
          }
          continue;
        }

        apiSuccessCount++;

        // Log first successful response as proof the API is working
        if (apiSuccessCount === 1) {
          console.log(`  API confirmed working — first result: ${details.name} (rating: ${details.rating}, types: ${details.types?.slice(0, 3).join(", ")})`);
        }

        const reasons: DeletionReason[] = [];
        const detailMsgs: string[] = [];

        // Check 1: Permanently closed
        if (details.business_status === "CLOSED_PERMANENTLY") {
          reasons.push("permanently_closed");
          detailMsgs.push("Permanently closed");
        }

        // Check 2: Not a food establishment
        if (details.types && details.types.length > 0) {
          if (!isFoodEstablishment(details.types)) {
            reasons.push("not_food_establishment");
            detailMsgs.push(`Types: ${details.types.join(", ")}`);
          }
        }

        // Check 3: Too far from downtown
        if (details.geometry?.location) {
          const dist = haversineDistanceMiles(
            CHICAGO_COORDS.lat,
            CHICAGO_COORDS.lng,
            details.geometry.location.lat,
            details.geometry.location.lng
          );
          if (dist > RADIUS_MILES) {
            reasons.push("too_far_from_downtown");
            detailMsgs.push(`${dist.toFixed(1)} miles from downtown`);
          }
        }

        // Check 4: Low rating (skip if null — benefit of doubt)
        if (
          details.rating !== undefined &&
          details.rating !== null &&
          details.rating < MIN_RATING
        ) {
          reasons.push("low_rating");
          detailMsgs.push(`Rating: ${details.rating}`);
        }

        // Check 5: Too few reviews (skip if null — benefit of doubt)
        if (
          details.user_ratings_total !== undefined &&
          details.user_ratings_total !== null &&
          details.user_ratings_total < MIN_REVIEWS
        ) {
          reasons.push("too_few_reviews");
          detailMsgs.push(`Reviews: ${details.user_ratings_total}`);
        }

        if (reasons.length > 0) {
          flagged.push({
            id: restaurant.id,
            name: restaurant.name || details.name || "(unnamed)",
            reasons,
            details: detailMsgs,
          });
        }
      }

      // Progress logging every 50 restaurants
      if (processed % 50 < BATCH_SIZE) {
        console.log(
          `  Progress: ${processed}/${withPlaceId.length} — ${flagged.length} flagged, ${apiSkipped} skipped`
        );
      }
    },
    BATCH_DELAY_MS
  );

  // Step 4: Print report
  const kept = restaurants.length - flagged.length - apiSkipped;

  // Count reasons
  const reasonCounts: Record<string, number> = {};
  for (const f of flagged) {
    for (const r of f.reasons) {
      reasonCounts[r] = (reasonCounts[r] || 0) + 1;
    }
  }

  console.log("\n--- FLAGGED FOR DELETION ---");
  console.log(`Total flagged: ${flagged.length}`);
  console.log("");
  console.log("By reason (a restaurant may have multiple):");
  console.log(
    `  no_google_place_id ........ ${reasonCounts["no_google_place_id"] || 0}`
  );
  console.log(
    `  permanently_closed ........ ${reasonCounts["permanently_closed"] || 0}`
  );
  console.log(
    `  not_food_establishment .... ${reasonCounts["not_food_establishment"] || 0}`
  );
  console.log(
    `  too_far_from_downtown ..... ${reasonCounts["too_far_from_downtown"] || 0}`
  );
  console.log(
    `  low_rating (< ${MIN_RATING}) ......... ${reasonCounts["low_rating"] || 0}`
  );
  console.log(
    `  too_few_reviews (< ${MIN_REVIEWS}) .... ${reasonCounts["too_few_reviews"] || 0}`
  );
  console.log(`  Google API failed (skipped)  ${apiSkipped}`);

  console.log("\n--- DETAILED LIST ---");
  for (let i = 0; i < flagged.length; i++) {
    const f = flagged[i];
    console.log(
      `  ${i + 1}. ${f.name} — ${f.reasons.join(", ")} (${f.details.join("; ")})`
    );
  }

  console.log(`\n--- SUMMARY ---`);
  console.log(`  To delete:  ${flagged.length}`);
  console.log(`  API skipped: ${apiSkipped} (will retry next run)`);
  console.log(`  To keep:    ${kept} (ready for enrichment)`);

  if (flagged.length === 0) {
    console.log("\nNothing to delete. All unenriched restaurants passed checks.");
    return;
  }

  // Step 5: Execute deletions
  if (DRY_RUN) {
    console.log(
      "\nDRY RUN — no deletions performed. Set DRY_RUN=false to delete."
    );
    return;
  }

  console.log(`\n--- EXECUTING DELETIONS ---`);
  const idsToDelete = flagged.map((f) => f.id);

  // Delete in chunks to avoid URL length limits
  for (let i = 0; i < idsToDelete.length; i += DELETE_CHUNK_SIZE) {
    const chunk = idsToDelete.slice(i, i + DELETE_CHUNK_SIZE);
    const chunkLabel = `chunk ${Math.floor(i / DELETE_CHUNK_SIZE) + 1}/${Math.ceil(idsToDelete.length / DELETE_CHUNK_SIZE)}`;

    // 1. Delete from non-cascading satellite tables first
    const { error: tagsErr, count: tagsCount } = await supabase
      .from("tags")
      .delete({ count: "exact" })
      .in("restaurant_id", chunk);
    if (tagsErr) console.error(`  Tags delete error (${chunkLabel}):`, tagsErr);

    const { error: scoresErr, count: scoresCount } = await supabase
      .from("occasion_scores")
      .delete({ count: "exact" })
      .in("restaurant_id", chunk);
    if (scoresErr)
      console.error(`  Occasion scores delete error (${chunkLabel}):`, scoresErr);

    // 2. Delete from restaurants (with safety guard: only noise_level IS NULL)
    const { error: restErr, count: restCount } = await supabase
      .from("restaurants")
      .delete({ count: "exact" })
      .in("id", chunk)
      .is("noise_level", null);
    if (restErr)
      console.error(`  Restaurants delete error (${chunkLabel}):`, restErr);

    console.log(
      `  ${chunkLabel}: deleted ${restCount || 0} restaurants, ${tagsCount || 0} tags, ${scoresCount || 0} occasion scores`
    );
  }

  // Step 6: Post-deletion summary
  const { count: enrichedCount } = await supabase
    .from("restaurants")
    .select("id", { count: "exact", head: true })
    .not("noise_level", "is", null)
    .or("is_active.is.null,is_active.eq.true");

  const { count: remainingUnenriched } = await supabase
    .from("restaurants")
    .select("id", { count: "exact", head: true })
    .is("noise_level", null)
    .or("is_active.is.null,is_active.eq.true");

  console.log("\n--- POST-CLEANUP TOTALS ---");
  console.log(`  Active enriched restaurants:  ${enrichedCount}`);
  console.log(`  Remaining unenriched:         ${remainingUnenriched}`);
  console.log("============================================");
}

main().catch((err) => {
  console.error("Clean unenriched pipeline failed:", err);
  process.exit(1);
});
