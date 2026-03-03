/**
 * V9 Pipeline: Review Intelligence
 *
 * Extracts evidence-based dish catalogs, cuisine signals, and quality scores
 * from Google Reviews using Claude Haiku. Populates the
 * restaurant_review_intelligence table for V9 scoring.
 *
 * Key difference from enrich-dishes.ts (which generates AI-predicted dishes from
 * cuisine type): this pipeline extracts ACTUAL dishes customers mention in reviews.
 *
 * Usage:
 *   tsx review-intelligence.ts                # all restaurants (dry-run)
 *   tsx review-intelligence.ts --live         # execute
 *   tsx review-intelligence.ts --limit 10     # first 10 only
 *   tsx review-intelligence.ts --force        # re-analyze even if already analyzed
 *
 * Schedule: Weekly (Sunday 7am UTC, after enrichment-v2)
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { processBatches } from "../lib/batch.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RestaurantRow {
  id: string;
  name: string;
  cuisine_type: string | null;
  google_place_id: string | null;
}

interface ReviewIntelligenceRow {
  restaurant_id: string;
  last_analyzed_at: string;
  analysis_version: number;
}

interface ExtractionResult {
  dish_catalog: string[];
  popular_dishes: string[];
  cuisine_signals: string[];
  review_food_quality: number;
  review_service_quality: number;
  review_ambiance_quality: number;
  review_value_score: number;
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const limitArg = args.includes("--limit")
  ? parseInt(args[args.indexOf("--limit") + 1], 10)
  : null;
const isLive = args.includes("--live");
const forceReanalyze = args.includes("--force");

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const ANALYSIS_VERSION = 1;

// ---------------------------------------------------------------------------
// Google Reviews fetch (transient — never stored per ToS)
// ---------------------------------------------------------------------------

async function fetchGoogleReviews(placeId: string): Promise<string[]> {
  if (!GOOGLE_API_KEY || !placeId) return [];
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: "reviews",
      key: GOOGLE_API_KEY,
    });
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`
    );
    const data = await res.json();
    const reviews = data?.result?.reviews || [];
    return reviews
      .slice(0, 5)
      .map((r: { text?: string }) => r.text || "")
      .filter((t: string) => t.length > 10);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

function buildExtractionPrompt(
  name: string,
  cuisineType: string | null,
  reviews: string[],
): string {
  const reviewText = reviews
    .map((r, i) => `Review ${i + 1}: "${r}"`)
    .join("\n");

  return `You are a restaurant data analyst. Extract structured intelligence from these Google Reviews for "${name}" (${cuisineType || "Unknown cuisine"}).

REVIEWS:
${reviewText || "No reviews available."}

Extract the following from the review text ONLY (do not invent items not mentioned):

1. dish_catalog: Every specific dish or food item mentioned in any review. Include variations (e.g., "deep dish pizza", "thin crust pizza" are separate entries). Be precise — use the exact names reviewers use. If no specific dishes are mentioned, return an empty array.

2. popular_dishes: From the dish_catalog, which items are mentioned in 2+ reviews OR described very positively? These are the restaurant's standout items.

3. cuisine_signals: What cuisine types or food categories do reviewers describe? E.g., "Italian", "sushi", "BBQ", "comfort food", "farm-to-table". Include the general style and any specific subcuisines.

4. Quality scores (0-10 scale, based on reviewer sentiment):
   - review_food_quality: How do reviewers rate the food? (0=terrible, 5=average, 10=exceptional)
   - review_service_quality: How do reviewers describe service/staff?
   - review_ambiance_quality: How do reviewers describe atmosphere/decor/vibe?
   - review_value_score: Do reviewers think it's good value for price?
   If a dimension isn't mentioned, score it 5.0 (neutral).

RULES:
- ONLY extract what reviewers actually say — do NOT generate typical dishes for the cuisine
- Use the exact dish names from reviews (preserve cultural/language accuracy)
- If reviews are sparse or generic, return small arrays and neutral scores
- Be conservative: uncertain = lower score, not higher

Respond ONLY in JSON:
{"dish_catalog":["dish1","dish2"],"popular_dishes":["dish1"],"cuisine_signals":["Italian","pizza"],"review_food_quality":7.5,"review_service_quality":6.0,"review_ambiance_quality":8.0,"review_value_score":7.0}`;
}

// ---------------------------------------------------------------------------
// tsvector builder (for PostgreSQL full-text search)
// ---------------------------------------------------------------------------

function buildSearchVector(result: ExtractionResult): string {
  // Combine all text signals into a single searchable string
  // PostgreSQL will convert this to tsvector via to_tsvector()
  const parts = [
    ...result.dish_catalog,
    ...result.popular_dishes,
    ...result.cuisine_signals,
  ];
  // Escape single quotes for SQL safety
  return parts.map(p => p.replace(/'/g, "''")).join(" ");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const supabase = createAdminClient();

  // Fetch all restaurants with Google Place IDs
  const PAGE = 1000;
  const allRestaurants: RestaurantRow[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from("restaurants")
      .select("id, name, cuisine_type, google_place_id")
      .not("google_place_id", "is", null)
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (error) throw new Error(`Failed to fetch restaurants: ${error.message}`);
    if (!data?.length) break;
    allRestaurants.push(...(data as RestaurantRow[]));
    if (data.length < PAGE) break;
    page++;
  }

  let restaurants = allRestaurants;
  if (limitArg) {
    restaurants = restaurants.slice(0, limitArg);
  }

  if (!restaurants.length) {
    console.log("No restaurants found with Google Place IDs.");
    return;
  }

  console.log(`Found ${restaurants.length} restaurants with Place IDs`);

  // Check which restaurants already have current review intelligence
  const ids = restaurants.map(r => r.id);
  const CHUNK = 100;
  const existingRI: ReviewIntelligenceRow[] = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("restaurant_review_intelligence")
      .select("restaurant_id, last_analyzed_at, analysis_version")
      .in("restaurant_id", chunk);
    if (error) throw new Error(`Failed to fetch RI: ${error.message}`);
    if (data) existingRI.push(...(data as ReviewIntelligenceRow[]));
  }

  const existingMap = new Map(existingRI.map(r => [r.restaurant_id, r]));

  // Filter to restaurants that need analysis
  const needsAnalysis = restaurants.filter(r => {
    if (forceReanalyze) return true;
    const existing = existingMap.get(r.id);
    if (!existing) return true;
    // Re-analyze if version is old
    if (existing.analysis_version < ANALYSIS_VERSION) return true;
    // Re-analyze if older than 7 days
    const lastAnalyzed = new Date(existing.last_analyzed_at);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return lastAnalyzed < sevenDaysAgo;
  });

  const skipped = restaurants.length - needsAnalysis.length;
  console.log(`Skipping ${skipped} recently analyzed, ${needsAnalysis.length} remaining`);

  if (!needsAnalysis.length) {
    console.log("All restaurants have current review intelligence. Nothing to do.");
    return;
  }

  if (!isLive) {
    console.log(`\nReady to analyze ${needsAnalysis.length} restaurants.`);
    console.log("Run with --live to execute. Exiting (dry-run).");
    return;
  }

  // Process in batches
  let analyzed = 0;
  let failed = 0;
  let noReviews = 0;

  await processBatches(
    needsAnalysis,
    5, // batch size (smaller than enrichment — each needs Google API call)
    async (batch) => {
      const promises = batch.map(async (r) => {
        try {
          // Step 1: Fetch fresh Google Reviews (transient, never stored)
          const reviews = await fetchGoogleReviews(r.google_place_id!);

          if (reviews.length === 0) {
            noReviews++;
            console.log(`  - ${r.name}: No reviews available, skipping`);
            return;
          }

          // Step 2: Extract intelligence via Haiku
          const prompt = buildExtractionPrompt(r.name, r.cuisine_type, reviews);
          const response = await askClaude(prompt, {
            maxTokens: 2048,
            temperature: 0.1, // Low temp for factual extraction
          });

          const result = parseJsonResponse<ExtractionResult>(response);

          // Validate structure
          if (!Array.isArray(result.dish_catalog) || !Array.isArray(result.cuisine_signals)) {
            throw new Error("Invalid response structure");
          }

          // Deduplicate arrays
          const dishCatalog = [...new Set(result.dish_catalog.map(d => d.trim()).filter(Boolean))];
          const popularDishes = [...new Set(result.popular_dishes.map(d => d.trim()).filter(Boolean))];
          const cuisineSignals = [...new Set(result.cuisine_signals.map(s => s.trim()).filter(Boolean))];

          // Clamp quality scores to 0-10
          const clamp = (v: number) => Math.min(10, Math.max(0, Number(v) || 5.0));

          // Step 3: Build search vector text
          const searchText = buildSearchVector({
            ...result,
            dish_catalog: dishCatalog,
            popular_dishes: popularDishes,
            cuisine_signals: cuisineSignals,
          });

          // Step 4: Upsert into restaurant_review_intelligence
          // Use raw SQL for tsvector conversion
          const { error: upsertError } = await supabase.rpc(
            "upsert_review_intelligence",
            {
              p_restaurant_id: r.id,
              p_dish_catalog: dishCatalog,
              p_popular_dishes: popularDishes,
              p_cuisine_signals: cuisineSignals,
              p_food_quality: clamp(result.review_food_quality),
              p_service_quality: clamp(result.review_service_quality),
              p_ambiance_quality: clamp(result.review_ambiance_quality),
              p_value_score: clamp(result.review_value_score),
              p_search_text: searchText,
              p_review_count: reviews.length,
              p_avg_rating: 0, // Google rating fetched separately
              p_version: ANALYSIS_VERSION,
            }
          );

          if (upsertError) {
            throw new Error(`Upsert failed: ${upsertError.message}`);
          }

          analyzed++;
          console.log(
            `  ✓ ${r.name}: ${dishCatalog.length} dishes, ${popularDishes.length} popular, ${cuisineSignals.length} signals (food: ${clamp(result.review_food_quality)})`,
          );
        } catch (err) {
          failed++;
          console.error(`  ✗ ${r.name}: ${(err as Error).message}`);
        }
      });

      await Promise.all(promises);
    },
    2000, // 2s delay between batches (Google API rate limit)
  );

  console.log(
    `\nDone. Analyzed: ${analyzed}, No reviews: ${noReviews}, Failed: ${failed}, Skipped: ${skipped}, Total: ${restaurants.length}`,
  );
}

main().catch(console.error);
