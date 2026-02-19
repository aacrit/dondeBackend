import { corsPreflightResponse, jsonResponse } from "./_shared/cors.ts";
import { createSupabaseClient } from "./_shared/supabase.ts";
import { callClaude, parseClaudeJson } from "./_shared/claude.ts";
import {
  mergeProfiles,
  filterAndRank,
  buildSystemPrompt,
  buildUserPrompt,
  computeDondeMatch,
} from "./_shared/scoring.ts";
import {
  buildSuccessResponse,
  buildFallbackResponse,
  buildNoResultsResponse,
  buildErrorResponse,
} from "./_shared/response-builder.ts";
import {
  fetchPlaceDetails,
  formatReviewsForPrompt,
} from "./_shared/google-places.ts";
import type {
  UserRequest,
  Restaurant,
  OccasionScores,
  Tag,
  Neighborhood,
  ClaudeRecommendation,
  RestaurantProfile,
} from "./_shared/types.ts";

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return corsPreflightResponse();
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, recommendation: "Method not allowed" },
      405
    );
  }

  try {
    // Parse and validate input
    const body: UserRequest = await req.json();
    const special_request = body.special_request || "";
    const occasion = body.occasion || "Any";
    const neighborhood = body.neighborhood || "Anywhere";
    const price_level = body.price_level || "Any";

    // Initialize Supabase client
    const supabase = createSupabaseClient();

    // --- Step 1: Get ranked restaurants via RPC (single DB round-trip) ---
    let top10: RestaurantProfile[];

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "get_ranked_restaurants",
      {
        p_neighborhood: neighborhood,
        p_price_level: price_level,
        p_occasion: occasion,
        p_limit: 10,
      }
    );

    if (rpcError || !rpcData || rpcData.length === 0) {
      if (rpcError) {
        console.error("RPC failed, falling back to legacy queries:", rpcError);
      }

      // Fallback: legacy 4-query approach
      const [restaurantsRes, scoresRes, tagsRes, neighborhoodsRes] =
        await Promise.all([
          supabase.from("restaurants").select("*"),
          supabase.from("occasion_scores").select("*"),
          supabase.from("tags").select("*"),
          supabase.from("neighborhoods").select("*"),
        ]);

      if (restaurantsRes.error) throw restaurantsRes.error;
      if (scoresRes.error) throw scoresRes.error;
      if (tagsRes.error) throw tagsRes.error;
      if (neighborhoodsRes.error) throw neighborhoodsRes.error;

      const profiles = mergeProfiles(
        restaurantsRes.data as Restaurant[],
        scoresRes.data as OccasionScores[],
        tagsRes.data as Tag[],
        neighborhoodsRes.data as Neighborhood[]
      );

      top10 = filterAndRank(profiles, neighborhood, price_level, occasion, special_request);
    } else {
      top10 = rpcData as RestaurantProfile[];
    }

    if (top10.length === 0) {
      return jsonResponse(buildNoResultsResponse());
    }

    // --- Step 2: Claude recommendation with live Google reviews ---
    let responseBody: Record<string, unknown>;

    try {
      // Start Google Places fetches for top 3 in parallel with Claude
      const top3PlaceIds = top10
        .slice(0, 3)
        .map((r) => r.google_place_id)
        .filter(Boolean) as string[];

      const googlePromises = top3PlaceIds.map((pid) =>
        fetchPlaceDetails(pid)
      );

      // Build reviews map from top 3 Google results for the merged prompt
      const googleResults = await Promise.all(googlePromises);

      // Map Google results back to top10 indices
      const reviewsByIndex = new Map<number, string>();
      const googleByPlaceId = new Map<
        string,
        Awaited<ReturnType<typeof fetchPlaceDetails>>
      >();
      for (let i = 0; i < top3PlaceIds.length; i++) {
        const gd = googleResults[i];
        if (gd) {
          googleByPlaceId.set(top3PlaceIds[i], gd);
          // Find the index in top10
          const top10Idx = top10.findIndex(
            (r) => r.google_place_id === top3PlaceIds[i]
          );
          if (top10Idx !== -1 && gd.reviews.length > 0) {
            reviewsByIndex.set(top10Idx, formatReviewsForPrompt(gd.reviews));
          }
        }
      }

      // Single Claude call: recommendation + sentiment (merged)
      const systemPrompt = buildSystemPrompt();
      const userPrompt = buildUserPrompt(
        top10,
        occasion,
        price_level,
        neighborhood,
        special_request,
        reviewsByIndex.size > 0 ? reviewsByIndex : undefined
      );

      const claudeText = await callClaude(userPrompt, systemPrompt);
      const parsed = parseClaudeJson<ClaudeRecommendation>(claudeText);

      const idx = Math.min(
        Math.max(0, parsed.restaurant_index || 0),
        top10.length - 1
      );
      const chosen = top10[idx];

      // Use pre-fetched Google data if available, otherwise fetch now
      let googleData = chosen.google_place_id
        ? googleByPlaceId.get(chosen.google_place_id) || null
        : null;

      if (!googleData && chosen.google_place_id) {
        // Claude picked outside top 3 — fetch individually
        googleData = await fetchPlaceDetails(chosen.google_place_id);
      }

      // Use stored insider_tip as fallback if Claude didn't provide one
      if (!parsed.insider_tip && chosen.insider_tip) {
        parsed.insider_tip = chosen.insider_tip;
      }

      // Compute donde_match deterministically (Claude provides relevance_score)
      const dondeMatch = computeDondeMatch(chosen, {
        occasion,
        specialRequest: special_request,
        neighborhood,
        priceLevel: price_level,
        googleData,
        claudeRelevance: parsed.relevance_score,
      });

      responseBody = buildSuccessResponse(chosen, parsed, googleData, dondeMatch);
    } catch (claudeError) {
      // Fallback: return top-ranked restaurant without AI enrichment
      console.error("Claude API failed, using fallback:", claudeError);
      const chosen = top10[0];

      const googleData = chosen.google_place_id
        ? await fetchPlaceDetails(chosen.google_place_id)
        : null;

      // Compute donde_match deterministically (no Claude relevance available)
      const fallbackMatch = computeDondeMatch(chosen, {
        occasion,
        specialRequest: special_request,
        neighborhood,
        priceLevel: price_level,
        googleData,
      });

      responseBody = buildFallbackResponse(chosen, googleData, fallbackMatch);
    }

    // Log query (fire-and-forget — don't block the response)
    const chosenId = (responseBody.restaurant as Record<string, unknown>)
      ?.id as string;

    supabase
      .from("user_queries")
      .insert({
        occasion,
        price_level,
        special_request,
        neighborhood_id:
          top10[0]?.neighborhood_id || null,
        recommended_restaurant_id: chosenId || null,
      })
      .then(() => {})
      .catch((err: unknown) => console.error("Failed to log query:", err));

    return jsonResponse(responseBody);
  } catch (error) {
    return jsonResponse(buildErrorResponse(error), 500);
  }
});
