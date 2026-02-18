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

    // Build Claude prompt (uses stored enrichment data only — no Google data)
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

      // Fetch fresh Google Place Details for the chosen restaurant (transient — never stored)
      const googleData = chosen.google_place_id
        ? await fetchPlaceDetails(chosen.google_place_id)
        : null;

      // If we got reviews, generate on-the-fly sentiment via a second Claude call
      if (googleData && googleData.reviews.length > 0 && !parsed.sentiment_breakdown) {
        try {
          const reviewsText = formatReviewsForPrompt(googleData.reviews);
          const sentimentPrompt = `Analyze these restaurant reviews for ${googleData.name}. Return ONLY valid JSON (no markdown):
{"sentiment_score": 4.2, "sentiment_breakdown": "2-3 sentence summary of what diners love and any common complaints."}

Reviews:
${reviewsText}`;

          const sentimentText = await callClaude(sentimentPrompt);
          const sentiment = parseClaudeJson<{
            sentiment_score: number;
            sentiment_breakdown: string;
          }>(sentimentText);

          parsed.sentiment_score = sentiment.sentiment_score;
          parsed.sentiment_breakdown = sentiment.sentiment_breakdown;
        } catch (sentimentErr) {
          console.error("Sentiment generation failed (non-fatal):", sentimentErr);
        }
      }

      responseBody = buildSuccessResponse(chosen, parsed, googleData);
    } catch (claudeError) {
      // Fallback: return top-ranked restaurant without AI enrichment
      console.error("Claude API failed, using fallback:", claudeError);
      const scoreField = getScoreField(occasion);
      const chosen = top10[0];

      // Still try to fetch Google data for the fallback
      const googleData = chosen.google_place_id
        ? await fetchPlaceDetails(chosen.google_place_id)
        : null;

      responseBody = buildFallbackResponse(chosen, scoreField, googleData);
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
