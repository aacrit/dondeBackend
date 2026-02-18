import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsPreflightResponse, jsonResponse } from "./_shared/cors.ts";
import { createSupabaseClient } from "./_shared/supabase.ts";
import { callClaude, parseClaudeJson } from "./_shared/claude.ts";
import {
  mergeProfiles,
  filterAndRank,
  buildSystemPrompt,
  buildUserPrompt,
  computeDondeScore,
} from "./_shared/scoring.ts";
import {
  buildSuccessResponse,
  buildPreGeneratedResponse,
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
  PreRecommendation,
} from "./_shared/types.ts";

// --- Generic request detection ---

const GENERIC_PHRASES = [
  "surprise me", "anything good", "whatever", "best spot",
  "something nice", "good food", "recommend something",
  "hungry", "let's eat", "feed me", "dealer's choice",
  "you pick", "chef's choice", "anything",
];

function isGenericRequest(specialRequest: string): boolean {
  if (!specialRequest || specialRequest.trim().length === 0) return true;
  if (specialRequest.trim().length < 5) return true;
  const lower = specialRequest.toLowerCase().trim();
  return GENERIC_PHRASES.some((phrase) => lower.includes(phrase));
}

serve(async (req: Request) => {
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

    // --- Step 2: Route to generic or specific path ---
    let responseBody: Record<string, unknown>;
    const generic = isGenericRequest(special_request);

    if (generic) {
      // === PATH A: Generic request — use pre-generated content, 0 Claude calls ===
      const chosen = top10[0];

      // Lookup pre-generated recommendation
      const { data: preRecData } = await supabase
        .from("pre_recommendations")
        .select("restaurant_id, occasion, recommendation, donde_score")
        .eq("restaurant_id", chosen.id)
        .eq("occasion", occasion === "Any" ? "Date Night" : occasion)
        .single();

      // Fetch Google Places live (still required per ToS)
      const googleData = chosen.google_place_id
        ? await fetchPlaceDetails(chosen.google_place_id)
        : null;

      // Compute donde_score deterministically
      const dondeScore = computeDondeScore(chosen, {
        occasion,
        specialRequest: special_request,
        neighborhood,
        priceLevel: price_level,
        isGeneric: true,
        googleData,
      });

      if (preRecData) {
        responseBody = buildPreGeneratedResponse(
          chosen,
          preRecData as PreRecommendation,
          googleData,
          dondeScore
        );
      } else {
        // No pre-rec found — use fallback response (no Claude call)
        responseBody = buildFallbackResponse(chosen, googleData, dondeScore);
      }
    } else {
      // === PATH B: Specific request — single Claude call with reviews ===
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

        // Compute donde_score deterministically (Claude provides relevance_score)
        const dondeScore = computeDondeScore(chosen, {
          occasion,
          specialRequest: special_request,
          neighborhood,
          priceLevel: price_level,
          isGeneric: false,
          googleData,
          claudeRelevance: parsed.relevance_score,
        });

        responseBody = buildSuccessResponse(chosen, parsed, googleData, dondeScore);
      } catch (claudeError) {
        // Fallback: return top-ranked restaurant without AI enrichment
        console.error("Claude API failed, using fallback:", claudeError);
        const chosen = top10[0];

        const googleData = chosen.google_place_id
          ? await fetchPlaceDetails(chosen.google_place_id)
          : null;

        // Compute donde_score deterministically (no Claude relevance available)
        const fallbackScore = computeDondeScore(chosen, {
          occasion,
          specialRequest: special_request,
          neighborhood,
          priceLevel: price_level,
          isGeneric: isGenericRequest(special_request),
          googleData,
        });

        responseBody = buildFallbackResponse(chosen, googleData, fallbackScore);
      }
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
