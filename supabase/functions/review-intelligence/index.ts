/**
 * V9 Pipeline: Review Intelligence — Supabase Edge Function
 *
 * Extracts evidence-based dish catalogs, cuisine signals, and quality scores
 * from Google Reviews using Claude Haiku. Populates the
 * restaurant_review_intelligence table for V9 scoring.
 *
 * Invoke via POST with JSON body:
 *   { "limit": 20, "offset": 0, "force": false }
 *
 * Returns progress + nextOffset for pagination:
 *   { "success": true, "analyzed": 18, "nextOffset": 20, "totalRemaining": 980 }
 *
 * Run manually via GitHub Action or call repeatedly with increasing offset
 * until totalRemaining = 0. Use { "force": true } to re-analyze all.
 */

import { corsPreflightResponse, jsonResponse } from "../recommend/_shared/cors.ts";
import { createServiceClient } from "../recommend/_shared/supabase.ts";
import { callClaude, parseClaudeJson } from "../recommend/_shared/claude.ts";

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

interface RequestBody {
  limit?: number;
  offset?: number;
  force?: boolean;
  concurrency?: number;
}

const ANALYSIS_VERSION = 1;
const DEFAULT_CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// Google Reviews fetch (transient — never stored per ToS)
// ---------------------------------------------------------------------------

async function fetchGoogleReviews(placeId: string): Promise<string[]> {
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey || !placeId) return [];
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      fields: "reviews",
      key: apiKey,
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
  const parts = [
    ...result.dish_catalog,
    ...result.popular_dishes,
    ...result.cuisine_signals,
  ];
  return parts.map(p => p.replace(/'/g, "''")).join(" ");
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return corsPreflightResponse();
  }

  try {
    const body: RequestBody = req.method === "POST" ? await req.json() : {};
    const limit = Math.min(body.limit ?? 20, 50); // Cap at 50 per call
    const offset = body.offset ?? 0;
    const force = body.force ?? false;
    const concurrency = Math.min(Math.max(body.concurrency ?? DEFAULT_CONCURRENCY, 1), 10);

    const supabase = createServiceClient();

    // Fetch total count of restaurants with Google Place IDs
    const { count: totalCount } = await supabase
      .from("restaurants")
      .select("id", { count: "exact", head: true })
      .not("google_place_id", "is", null);

    // Fetch this batch of restaurants (deterministic order for pagination)
    const { data: restaurants, error: fetchError } = await supabase
      .from("restaurants")
      .select("id, name, cuisine_type, google_place_id")
      .not("google_place_id", "is", null)
      .order("id")
      .range(offset, offset + limit - 1);

    if (fetchError) {
      return jsonResponse({ error: `Failed to fetch restaurants: ${fetchError.message}` }, 500);
    }

    if (!restaurants?.length) {
      return jsonResponse({
        success: true,
        message: "No more restaurants to process",
        processed: 0, analyzed: 0, skipped: 0, noReviews: 0, failed: 0,
        nextOffset: null,
        totalRemaining: 0,
      });
    }

    // Check which already have current review intelligence
    const ids = (restaurants as RestaurantRow[]).map(r => r.id);
    const { data: existingData } = await supabase
      .from("restaurant_review_intelligence")
      .select("restaurant_id, analysis_version")
      .in("restaurant_id", ids);

    const existingMap = new Map(
      (existingData as ReviewIntelligenceRow[] || []).map(r => [r.restaurant_id, r])
    );

    // Filter to restaurants that need analysis (skip already-analyzed unless forced)
    const needsAnalysis = (restaurants as RestaurantRow[]).filter(r => {
      if (force) return true;
      const existing = existingMap.get(r.id);
      if (!existing) return true;
      if (existing.analysis_version < ANALYSIS_VERSION) return true;
      return false;
    });

    const skipped = restaurants.length - needsAnalysis.length;
    let analyzed = 0;
    let failed = 0;
    let noReviews = 0;
    const details: string[] = [];

    // Process a single restaurant (used by concurrent executor)
    async function processOne(r: RestaurantRow): Promise<void> {
      try {
        const reviews = await fetchGoogleReviews(r.google_place_id!);

        if (reviews.length === 0) {
          noReviews++;
          details.push(`${r.name}: no reviews`);
          return;
        }

        const prompt = buildExtractionPrompt(r.name, r.cuisine_type, reviews);
        const response = await callClaude(prompt, undefined, {
          maxTokens: 2048,
          temperature: 0.1,
        });

        const result = parseClaudeJson<ExtractionResult>(response);

        if (!Array.isArray(result.dish_catalog) || !Array.isArray(result.cuisine_signals)) {
          throw new Error("Invalid response structure");
        }

        const dishCatalog = [...new Set(result.dish_catalog.map(d => d.trim()).filter(Boolean))];
        const popularDishes = [...new Set(result.popular_dishes.map(d => d.trim()).filter(Boolean))];
        const cuisineSignals = [...new Set(result.cuisine_signals.map(s => s.trim()).filter(Boolean))];

        const clamp = (v: number) => Math.min(10, Math.max(0, Number(v) || 5.0));

        const searchText = buildSearchVector({
          ...result,
          dish_catalog: dishCatalog,
          popular_dishes: popularDishes,
          cuisine_signals: cuisineSignals,
        });

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
            p_avg_rating: 0,
            p_version: ANALYSIS_VERSION,
          }
        );

        if (upsertError) {
          throw new Error(`Upsert failed: ${upsertError.message}`);
        }

        analyzed++;
        details.push(`${r.name}: ${dishCatalog.length} dishes, ${popularDishes.length} popular`);
      } catch (err) {
        failed++;
        details.push(`${r.name}: ERROR — ${(err as Error).message}`);
      }
    }

    // Process in concurrent chunks of `concurrency`
    for (let i = 0; i < needsAnalysis.length; i += concurrency) {
      const chunk = needsAnalysis.slice(i, i + concurrency);
      await Promise.all(chunk.map(processOne));
    }

    const nextOffset = offset + limit;
    const totalRemaining = Math.max(0, (totalCount ?? 0) - nextOffset);

    return jsonResponse({
      success: true,
      processed: restaurants.length,
      analyzed,
      skipped,
      noReviews,
      failed,
      nextOffset: totalRemaining > 0 ? nextOffset : null,
      totalRemaining,
      details,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
