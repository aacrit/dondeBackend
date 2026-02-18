import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsPreflightResponse, jsonResponse } from "./_shared/cors.ts";
import { createSupabaseClient } from "./_shared/supabase.ts";
import { callClaude, parseClaudeJson } from "./_shared/claude.ts";
import {
  mergeProfiles,
  filterAndRank,
  buildPrompt,
  getScoreField,
} from "./_shared/scoring.ts";
import {
  buildSuccessResponse,
  buildFallbackResponse,
  buildNoResultsResponse,
  buildErrorResponse,
} from "./_shared/response-builder.ts";
import type {
  UserRequest,
  Restaurant,
  OccasionScores,
  Tag,
  Neighborhood,
  ClaudeRecommendation,
} from "./_shared/types.ts";

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

    // Parallel fetch all data
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

    const restaurants = restaurantsRes.data as Restaurant[];
    const scores = scoresRes.data as OccasionScores[];
    const tags = tagsRes.data as Tag[];
    const neighborhoods = neighborhoodsRes.data as Neighborhood[];

    // Merge into full profiles
    const profiles = mergeProfiles(restaurants, scores, tags, neighborhoods);

    // Filter and rank
    const top10 = filterAndRank(profiles, neighborhood, price_level, occasion);

    if (top10.length === 0) {
      return jsonResponse(buildNoResultsResponse());
    }

    // Build Claude prompt
    const prompt = buildPrompt(
      top10,
      occasion,
      price_level,
      neighborhood,
      special_request
    );

    // Call Claude and build response
    let responseBody: Record<string, unknown>;

    try {
      const claudeText = await callClaude(prompt);
      const parsed = parseClaudeJson<ClaudeRecommendation>(claudeText);

      const idx = Math.min(
        Math.max(0, parsed.restaurant_index || 0),
        top10.length - 1
      );
      const chosen = top10[idx];

      responseBody = buildSuccessResponse(chosen, parsed);
    } catch (claudeError) {
      // Fallback: return top-ranked restaurant without AI enrichment
      console.error("Claude API failed, using fallback:", claudeError);
      const scoreField = getScoreField(occasion);
      responseBody = buildFallbackResponse(top10[0], scoreField);
    }

    // Log query (fire-and-forget — don't block the response)
    const chosenId = (responseBody.restaurant as Record<string, unknown>)
      ?.id as string;
    const neighborhoodRecord = neighborhoods.find(
      (n) => n.name.toLowerCase() === neighborhood.toLowerCase()
    );

    supabase
      .from("user_queries")
      .insert({
        occasion,
        price_level,
        special_request,
        neighborhood_id: neighborhoodRecord?.id || null,
        recommended_restaurant_id: chosenId || null,
      })
      .then(() => {})
      .catch((err: unknown) => console.error("Failed to log query:", err));

    return jsonResponse(responseBody);
  } catch (error) {
    return jsonResponse(buildErrorResponse(error), 500);
  }
});
