import { corsPreflightResponse, jsonResponse } from "./_shared/cors.ts";
import { createSupabaseClient } from "./_shared/supabase.ts";
import { callClaude, parseClaudeJson } from "./_shared/claude.ts";
import {
  mergeProfiles,
  filterAndRank,
  reRankWithBoosts,
  reRankV2,
  ensureDiversity,
  analyzeRejections,
  buildSystemPrompt,
  buildUserPrompt,
  computeDondeMatch,
  computeDondeMatchV2,
  computeScoringDimensions,
  computeDimensionWeights,
  extractUnmatchedKeywords,
} from "./_shared/scoring.ts";
import { classifyIntent } from "./_shared/intent-classifier.ts";
import {
  buildSuccessResponse,
  buildFallbackResponse,
  buildTemplateResponse,
  buildNoResultsResponse,
  buildErrorResponse,
} from "./_shared/response-builder.ts";
import {
  fetchPlaceDetails,
  formatReviewsForPrompt,
} from "./_shared/google-places.ts";
import { logInfo, logWarn, logError } from "./_shared/logger.ts";
import type {
  UserRequest,
  Restaurant,
  OccasionScores,
  Tag,
  Neighborhood,
  ClaudeRecommendation,
  RestaurantProfile,
  DeepProfile,
} from "./_shared/types.ts";

// B15: API version for response headers
const API_VERSION = "2.1.0";

// --- Enhancement 8: In-memory response cache ---
interface CacheEntry {
  response: Record<string, unknown>;
  expiry: number;
}
const RESPONSE_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(occasion: string, neighborhood: string, price: string, request: string): string {
  return `${occasion}|${neighborhood}|${price}|${request.toLowerCase().trim()}`;
}

function getCachedResponse(key: string): Record<string, unknown> | null {
  const entry = RESPONSE_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    RESPONSE_CACHE.delete(key);
    return null;
  }
  return entry.response;
}

function setCacheResponse(key: string, response: Record<string, unknown>): void {
  // Evict expired entries if cache grows large
  if (RESPONSE_CACHE.size > 100) {
    const now = Date.now();
    for (const [k, v] of RESPONSE_CACHE) {
      if (now > v.expiry) RESPONSE_CACHE.delete(k);
    }
  }
  RESPONSE_CACHE.set(key, { response, expiry: Date.now() + CACHE_TTL });
}

// --- B13: In-memory rate limiter ---
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const RATE_LIMIT_MAP = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 30; // requests per window
const RATE_LIMIT_WINDOW = 60_000; // 1 minute

function checkRateLimit(clientIp: string): boolean {
  const now = Date.now();
  const entry = RATE_LIMIT_MAP.get(clientIp);
  if (!entry || now > entry.resetAt) {
    RATE_LIMIT_MAP.set(clientIp, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return false;
  return true;
}

// Periodic cleanup of expired rate limit entries
function cleanupRateLimits(): void {
  if (RATE_LIMIT_MAP.size > 500) {
    const now = Date.now();
    for (const [key, entry] of RATE_LIMIT_MAP) {
      if (now > entry.resetAt) RATE_LIMIT_MAP.delete(key);
    }
  }
}

// --- B20: Input sanitization ---
function sanitizeInput(input: string): string {
  return input
    // Strip control characters (keep newlines, tabs)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Collapse excessive whitespace
    .replace(/\s{5,}/g, "    ")
    // Strip obvious prompt injection attempts
    .replace(/ignore\s+(all\s+)?previous\s+instructions/gi, "")
    .replace(/you\s+are\s+now\s+/gi, "")
    .replace(/system\s*:\s*/gi, "")
    .replace(/\[INST\]/gi, "")
    .replace(/<\/?(?:system|assistant|user)>/gi, "")
    .trim();
}

// B7: UserFeedbackSignals type imported from scoring.ts
import type { UserFeedbackSignals } from "./_shared/scoring.ts";

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return corsPreflightResponse();
  }

  // B16: Health check endpoint
  if (req.method === "GET") {
    return jsonResponse({
      status: "ok",
      version: API_VERSION,
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, recommendation: "Method not allowed" },
      405
    );
  }

  // B13: Rate limiting
  cleanupRateLimits();
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";
  if (!checkRateLimit(clientIp)) {
    logWarn("Rate limit exceeded", { ip: clientIp });
    return jsonResponse(
      { success: false, recommendation: "Too many requests. Please wait a moment." },
      429
    );
  }

  // Enhancement 13: Track response time
  const startTime = Date.now();

  try {
    // Parse and validate input
    const body: UserRequest = await req.json();
    const special_request = sanitizeInput((body.special_request || "").slice(0, 500)); // B20: Length limit + sanitization
    const occasion = body.occasion || "Any";
    const neighborhood = body.neighborhood || "Anywhere";
    const price_level = body.price_level || "Any";

    // B2: Accept client-provided time_of_day (validated)
    const VALID_TIME_PERIODS = ["breakfast", "lunch", "dinner", "late_night"];
    const time_of_day = (typeof body.time_of_day === "string" && VALID_TIME_PERIODS.includes(body.time_of_day))
      ? body.time_of_day : null;
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const exclude = (body.exclude || [])
      .filter((id: string) => typeof id === "string" && UUID_REGEX.test(id))
      .slice(0, 15);

    // F5: Dietary restrictions (validated string array, max 5)
    const dietary_restrictions = (body.dietary_restrictions || [])
      .filter((d: string) => typeof d === "string" && d.length < 30)
      .slice(0, 5);

    // F9: User ID for personalization (optional, validated format)
    const user_id = (typeof body.user_id === "string" && body.user_id.length < 100)
      ? body.user_id : null;

    // F11: Process feedback if included (fire-and-forget)
    if (body.feedback?.restaurant_id && body.feedback?.feedback && user_id) {
      const supabaseForFeedback = createSupabaseClient();
      supabaseForFeedback
        .from("user_queries")
        .update({ feedback: body.feedback.feedback })
        .eq("recommended_restaurant_id", body.feedback.restaurant_id)
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .then(() => {})
        .catch((err: unknown) => logError("Failed to store feedback", { error: String(err) }));
    }

    // Enhancement 8: Check cache (skip for "Try Another" requests)
    if (exclude.length === 0) {
      const cacheKey = getCacheKey(occasion, neighborhood, price_level, special_request);
      const cached = getCachedResponse(cacheKey);
      if (cached) {
        return jsonResponse(cached);
      }
    }

    // Initialize Supabase client
    const supabase = createSupabaseClient();

    // B7: Fetch user feedback history for personalization (non-blocking)
    let userFeedback: UserFeedbackSignals | null = null;
    const feedbackPromise = user_id
      ? supabase
          .from("user_queries")
          .select("recommended_restaurant_id, feedback, restaurants!inner(cuisine_type)")
          .eq("user_id", user_id)
          .not("feedback", "is", null)
          .order("created_at", { ascending: false })
          .limit(20)
          .then(({ data }) => {
            if (!data || data.length === 0) return null;
            const signals: UserFeedbackSignals = {
              likedCuisines: [], dislikedCuisines: [],
              likedRestaurantIds: [], dislikedRestaurantIds: [],
            };
            for (const row of data) {
              const cuisine = (row.restaurants as Record<string, unknown>)?.cuisine_type as string | null;
              const rid = row.recommended_restaurant_id as string;
              if (row.feedback === "like") {
                if (rid) signals.likedRestaurantIds.push(rid);
                if (cuisine && !signals.likedCuisines.includes(cuisine)) signals.likedCuisines.push(cuisine);
              } else if (row.feedback === "dislike") {
                if (rid) signals.dislikedRestaurantIds.push(rid);
                if (cuisine && !signals.dislikedCuisines.includes(cuisine)) signals.dislikedCuisines.push(cuisine);
              }
            }
            return signals;
          })
          .catch((err: unknown) => {
            logWarn("Failed to fetch user feedback", { error: String(err) });
            return null;
          })
      : Promise.resolve(null);

    // --- Step 0.5: Intent classification + Step 1: RPC (parallel) ---
    let allRpcResults: RestaurantProfile[];
    let top10: RestaurantProfile[];

    // Enhancement 6: Request extra results for diversity backfill
    const rpcLimit = 15 + exclude.length;

    // Fire intent classification, feedback resolution, and initial RPC in parallel
    const [intent, resolvedFeedback, initialRpc] = await Promise.all([
      special_request ? classifyIntent(special_request) : Promise.resolve(null),
      feedbackPromise,
      supabase.rpc("get_ranked_restaurants", {
        p_neighborhood: neighborhood,
        p_price_level: price_level,
        p_occasion: occasion,
        p_limit: rpcLimit,
        p_target_cuisine: null, // First pass without cuisine filter
      }),
    ]);

    userFeedback = resolvedFeedback;

    let { data: rpcData, error: rpcError } = initialRpc;

    // If intent has high-importance cuisine but no matches in initial results, re-query with cuisine boost
    if (
      intent?.cuisine_importance === "high" &&
      intent.target_cuisines.length > 0 &&
      rpcData &&
      rpcData.length > 0
    ) {
      const targetCuisine = intent.target_cuisines[0];
      const hasCuisineMatch = (rpcData as RestaurantProfile[]).some(
        (r) => r.cuisine_type?.toLowerCase() === targetCuisine.toLowerCase()
      );
      if (!hasCuisineMatch) {
        logInfo("Intent re-query: cuisine not found in initial results", { cuisine: targetCuisine });
        const { data: cuisineData, error: cuisineError } = await supabase.rpc(
          "get_ranked_restaurants",
          {
            p_neighborhood: neighborhood,
            p_price_level: price_level,
            p_occasion: occasion,
            p_limit: rpcLimit,
            p_target_cuisine: targetCuisine,
          }
        );
        if (!cuisineError && cuisineData && cuisineData.length > 0) {
          rpcData = cuisineData;
          rpcError = null;
        }
      }
    }

    // Price relaxation: if no results with exact price, retry with "Any" price
    if ((!rpcData || rpcData.length === 0) && !rpcError && price_level !== "Any") {
      logInfo("Price relaxation: retrying with Any", { neighborhood, price_level });
      const targetCuisine = (intent?.cuisine_importance === "high" && intent.target_cuisines.length > 0)
        ? intent.target_cuisines[0] : null;
      const { data: relaxedData, error: relaxedError } = await supabase.rpc(
        "get_ranked_restaurants",
        { p_neighborhood: neighborhood, p_price_level: "Any", p_occasion: occasion, p_limit: rpcLimit, p_target_cuisine: targetCuisine }
      );
      if (!relaxedError && relaxedData && relaxedData.length > 0) {
        rpcData = relaxedData;
        rpcError = null;
      }
    }

    // Neighborhood relaxation: if still no results, retry with "Anywhere" + "Any" price
    if ((!rpcData || rpcData.length === 0) && !rpcError && neighborhood !== "Anywhere") {
      logInfo("Neighborhood relaxation: retrying with Anywhere", { neighborhood });
      const targetCuisine = (intent?.cuisine_importance === "high" && intent.target_cuisines.length > 0)
        ? intent.target_cuisines[0] : null;
      const { data: anywhereData, error: anywhereError } = await supabase.rpc(
        "get_ranked_restaurants",
        { p_neighborhood: "Anywhere", p_price_level: "Any", p_occasion: occasion, p_limit: rpcLimit, p_target_cuisine: targetCuisine }
      );
      if (!anywhereError && anywhereData && anywhereData.length > 0) {
        rpcData = anywhereData;
        rpcError = null;
      }
    }

    if (rpcError || !rpcData || rpcData.length === 0) {
      if (rpcError) {
        logError("RPC failed, falling back to legacy queries", { error: String(rpcError) });
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
      allRpcResults = top10;
    } else {
      // V2: Map dp_* fields from RPC into deep_profile object on each result
      allRpcResults = (rpcData as Record<string, unknown>[]).map((row) => {
        const hasDeepProfile = row.dp_service_style != null || row.dp_flavor_profiles != null;
        const deep_profile: DeepProfile | null = hasDeepProfile ? {
          flavor_profiles: (row.dp_flavor_profiles as string[] | null) || null,
          signature_dishes: (row.dp_signature_dishes as Array<{ dish: string; why: string }> | null) || null,
          cuisine_subcategory: (row.dp_cuisine_subcategory as string | null) || null,
          menu_depth: (row.dp_menu_depth as string | null) || null,
          spice_level: (row.dp_spice_level as string | null) || null,
          dietary_depth: (row.dp_dietary_depth as string | null) || null,
          service_style: (row.dp_service_style as string | null) || null,
          meal_pacing: (row.dp_meal_pacing as string | null) || null,
          reservation_difficulty: (row.dp_reservation_difficulty as string | null) || null,
          typical_wait_minutes: (row.dp_typical_wait_minutes as number | null) || null,
          group_size_sweet_spot: (row.dp_group_size_sweet_spot as string | null) || null,
          check_average_per_person: (row.dp_check_average_per_person as number | null) || null,
          tipping_culture: (row.dp_tipping_culture as string | null) || null,
          kid_friendliness: (row.dp_kid_friendliness as number | null) || null,
          music_vibe: (row.dp_music_vibe as string | null) || null,
          decor_style: (row.dp_decor_style as string | null) || null,
          conversation_friendliness: (row.dp_conversation_friendliness as number | null) || null,
          energy_level: (row.dp_energy_level as number | null) || null,
          seating_options: (row.dp_seating_options as string[] | null) || null,
          instagram_worthiness: (row.dp_instagram_worthiness as number | null) || null,
          seasonal_relevance: (row.dp_seasonal_relevance as Record<string, number> | null) || null,
          cultural_authenticity: (row.dp_cultural_authenticity as number | null) || null,
          origin_story: (row.dp_origin_story as string | null) || null,
          crowd_profile: (row.dp_crowd_profile as string[] | null) || null,
          neighborhood_integration: (row.dp_neighborhood_integration as string | null) || null,
          chef_notable: (row.dp_chef_notable as boolean | null) || null,
          awards_recognition: (row.dp_awards_recognition as string[] | null) || null,
          wow_factors: (row.dp_wow_factors as string[] | null) || null,
          date_progression: (row.dp_date_progression as string | null) || null,
          best_seat_in_house: (row.dp_best_seat_in_house as string | null) || null,
          ideal_weather: (row.dp_ideal_weather as string[] | null) || null,
          unique_selling_point: (row.dp_unique_selling_point as string | null) || null,
          transit_accessibility: (row.dp_transit_accessibility as string | null) || null,
          byob_policy: (row.dp_byob_policy as string | null) || null,
          payment_notes: (row.dp_payment_notes as string | null) || null,
          enrichment_confidence: (row.dp_enrichment_confidence as number | null) || null,
        } : null;

        // Return RestaurantProfile with deep_profile attached
        return {
          ...row,
          deep_profile,
        } as unknown as RestaurantProfile;
      });
      top10 = allRpcResults;
    }

    // Filter excluded restaurants (handles both RPC and fallback paths)
    if (exclude.length > 0) {
      top10 = top10.filter((r) => !exclude.includes(r.id));
    }

    // F5: Dietary restriction filtering
    if (dietary_restrictions.length > 0) {
      const dietaryFiltered = top10.filter((r) => {
        if (!r.dietary_options || r.dietary_options.length === 0) return false;
        const opts = r.dietary_options.map((d) => d.toLowerCase());
        return dietary_restrictions.every((dr: string) =>
          opts.some((opt) => opt.includes(dr.toLowerCase()))
        );
      });
      // Graceful fallback: if no dietary matches, keep unfiltered but log
      if (dietaryFiltered.length > 0) {
        top10 = dietaryFiltered;
      } else {
        logWarn("Dietary filter matched 0 restaurants, using unfiltered", { dietary_restrictions });
      }
    }

    top10 = top10.slice(0, 10);

    // Enhancement 14: Analyze rejection patterns from excluded restaurants
    const rejectionSignals = exclude.length >= 2
      ? analyzeRejections(exclude, allRpcResults)
      : undefined;

    // V2: Re-rank using multi-dimensional scoring (falls back to V1 if no deep profiles)
    const hasDeepProfiles = top10.some((r) => r.deep_profile != null);
    if (hasDeepProfiles) {
      top10 = reRankV2(top10, occasion, special_request, rejectionSignals, intent, userFeedback, time_of_day);
    } else {
      top10 = reRankWithBoosts(top10, occasion, special_request, rejectionSignals, intent, userFeedback, time_of_day);
    }

    // Enhancement 6: Apply diversity filter
    const backfillPool = allRpcResults.filter((r) => !exclude.includes(r.id));
    top10 = ensureDiversity(top10, backfillPool);

    if (top10.length === 0) {
      return jsonResponse(buildNoResultsResponse(neighborhood, price_level));
    }

    // Detect cuisine mismatch: user asked for specific cuisine but none of the candidates match
    let cuisineMismatch: { requested: string; keyword: string } | null = null;
    if (
      intent?.cuisine_importance === "high" &&
      intent.target_cuisines.length > 0 &&
      !top10.some((r) =>
        intent!.target_cuisines.some(
          (tc) => r.cuisine_type?.toLowerCase() === tc.toLowerCase()
        )
      )
    ) {
      cuisineMismatch = {
        requested: intent.target_cuisines[0],
        keyword: special_request,
      };
      logInfo("Cuisine mismatch detected", {
        requested: cuisineMismatch.requested,
        candidateCuisines: [...new Set(top10.map((r) => r.cuisine_type).filter(Boolean))],
      });
    }

    // --- Step 2: Claude recommendation with live Google reviews ---
    let responseBody: Record<string, unknown>;
    let wasFallback = false;

    try {
      // Enhancement 3: Expand Google fetches to top 5 candidates
      const top5PlaceIds = top10
        .slice(0, 5)
        .map((r) => r.google_place_id)
        .filter(Boolean) as string[];

      // Enhancement 7: True parallel execution — fire Google + Claude together
      // Build Claude prompt first (without reviews), then race with Google
      const systemPrompt = buildSystemPrompt(occasion, price_level);

      // Get neighborhood description for prompt (Enhancement 15)
      const neighborhoodDescription = top10[0]?.neighborhood_description || null;

      // Enhancement 14: Build rejection context for Claude
      let rejectionContext: string | undefined;
      if (rejectionSignals && (rejectionSignals.avoidCuisines.length > 0 || rejectionSignals.avoidPriceLevels.length > 0)) {
        const parts: string[] = [];
        if (rejectionSignals.avoidCuisines.length > 0) {
          parts.push(`cuisines: ${rejectionSignals.avoidCuisines.join(", ")}`);
        }
        if (rejectionSignals.avoidPriceLevels.length > 0) {
          parts.push(`price levels: ${rejectionSignals.avoidPriceLevels.join(", ")}`);
        }
        rejectionContext = `NOTE: The user has rejected ${exclude.length} previous suggestions. They seem to want something different from ${parts.join(" and ")}. Prioritize variety.`;
      }

      // Start Google fetches
      const googlePromises = top5PlaceIds.map((pid) => fetchPlaceDetails(pid));

      // Wait for Google results (with timeout to avoid blocking)
      const googleTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
      const googleRace = Promise.all(googlePromises);
      const googleResultsOrTimeout = await Promise.race([googleRace, googleTimeout]);

      const googleResults = googleResultsOrTimeout
        ? (googleResultsOrTimeout as Awaited<ReturnType<typeof fetchPlaceDetails>>[])
        : [];

      // Map Google results back to top10 indices
      const reviewsByIndex = new Map<number, string>();
      const googleByPlaceId = new Map<
        string,
        Awaited<ReturnType<typeof fetchPlaceDetails>>
      >();
      for (let i = 0; i < top5PlaceIds.length && i < googleResults.length; i++) {
        const gd = googleResults[i];
        if (gd) {
          googleByPlaceId.set(top5PlaceIds[i], gd);
          // Find the index in top10
          const top10Idx = top10.findIndex(
            (r) => r.google_place_id === top5PlaceIds[i]
          );
          if (top10Idx !== -1 && gd.reviews.length > 0) {
            reviewsByIndex.set(top10Idx, formatReviewsForPrompt(gd.reviews));
          }
        }
      }

      // Build cuisine mismatch context for Claude prompt
      let cuisineMismatchContext: string | null = null;
      if (cuisineMismatch) {
        cuisineMismatchContext = `CUISINE MISMATCH: The user asked for "${special_request}" (${cuisineMismatch.requested} cuisine), but none of the candidates serve this cuisine. Be honest about this gap. Pick the best alternative and briefly explain why it's a good fallback, but acknowledge upfront that we don't have their specific craving covered. Set your relevance_score to 5.0 or below to reflect the mismatch. Do NOT pretend the recommendation matches their request.`;
      }

      // Build user prompt with reviews (if available from Google)
      const userPrompt = buildUserPrompt(
        top10,
        occasion,
        price_level,
        neighborhood,
        special_request,
        reviewsByIndex.size > 0 ? reviewsByIndex : undefined,
        neighborhoodDescription,
        rejectionContext,
        cuisineMismatchContext
      );

      // Call Claude
      const claudeText = await callClaude(userPrompt, systemPrompt);

      // Enhancement 19: Tiered JSON parsing
      let parsed: ClaudeRecommendation;
      try {
        parsed = parseClaudeJson<ClaudeRecommendation>(claudeText);
      } catch (_parseError) {
        // Tier 2: Try regex recovery from malformed JSON
        const recovered = recoverFromMalformedClaude(claudeText);
        if (recovered) {
          parsed = recovered;
          logWarn("Claude JSON parse failed, recovered via regex");
        } else {
          throw new Error("Claude returned unparseable response");
        }
      }

      // Quality guardrail: detect AI slop patterns in recommendation text
      if (parsed.recommendation) {
        const SLOP_PATTERNS = [
          // Core AI slop words
          "culinary", "gastronomic", "unforgettable", "unparalleled", "nestled",
          "tantalizing", "mouthwatering", "delectable", "exquisite", "embark",
          "elevate your", "a testament to", "truly remarkable", "a must-visit",
          "from the moment you", "whether you're looking", "taste buds",
          "culinary journey", "dining experience", "perfect harmony",
          // Extended slop detection (V3)
          "burst of flavor", "a cut above", "doesn't disappoint",
          "will not disappoint", "not to be missed", "that will leave you",
          "perfect blend", "perfect balance", "hits all the right notes",
          "checks all the boxes", "treat your taste buds", "palate",
          "unapologetically", "does it right", "gets it right",
          "if you know you know", "think meets",
        ];
        const recLower = parsed.recommendation.toLowerCase();
        const slopHits = SLOP_PATTERNS.filter((p) => recLower.includes(p));
        if (slopHits.length >= 2) {
          logWarn("Recommendation quality: slop patterns detected", { count: slopHits.length, patterns: slopHits });
        }

        // V3: Em dash detection (major AI tell)
        const emDashCount = (parsed.recommendation.match(/\u2014/g) || []).length;
        if (emDashCount > 0) {
          logWarn("Recommendation contains em dashes", { count: emDashCount });
        }

        // V3: Structural AI tell detection
        const structuralTells = [
          /^(ah|so|well|look|here's the thing),?\s/i,
          /whether\s.*\sor\s/i,
          /if you're looking for/i,
        ];
        const structHits = structuralTells.filter((p) => p.test(parsed.recommendation));
        if (structHits.length > 0) {
          logWarn("Recommendation has structural AI tells", { count: structHits.length });
        }

        // Word count check
        const wordCount = parsed.recommendation.split(/\s+/).length;
        if (wordCount > 100) {
          logWarn("Recommendation length exceeds target", { wordCount, target: "50-80" });
        }
      }

      const idx = Math.min(
        Math.max(0, parsed.restaurant_index || 0),
        top10.length - 1
      );
      const chosen = top10[idx];

      // Enhancement 20: Check for closed restaurants
      let googleData = chosen.google_place_id
        ? googleByPlaceId.get(chosen.google_place_id) || null
        : null;

      if (!googleData && chosen.google_place_id) {
        // Claude picked outside top 5 — fetch individually
        googleData = await fetchPlaceDetails(chosen.google_place_id);
      }

      // Enhancement 20: If restaurant is closed, try next candidate
      if (googleData?.business_status === "CLOSED_PERMANENTLY") {
        logWarn("Chosen restaurant permanently closed, picking next", { name: chosen.name });
        const nextIdx = top10.findIndex((r, i) => i !== idx && r.id !== chosen.id);
        if (nextIdx !== -1) {
          const nextChosen = top10[nextIdx];
          const nextGoogleData = nextChosen.google_place_id
            ? googleByPlaceId.get(nextChosen.google_place_id) || await fetchPlaceDetails(nextChosen.google_place_id)
            : null;

          // Use stored insider_tip as fallback
          if (!parsed.insider_tip && nextChosen.insider_tip) {
            parsed.insider_tip = nextChosen.insider_tip;
          }

          const closedMatchInputs = {
            occasion,
            specialRequest: special_request,
            neighborhood,
            priceLevel: price_level,
            googleData: nextGoogleData,
            claudeRelevance: parsed.relevance_score,
            sentimentNegative: parsed.sentiment_negative,
            intent,
            rejectionSignals,
            userFeedback,
            clientTimeOfDay: time_of_day,
            dietaryRestrictions: dietary_restrictions,
          };
          let dondeMatch = nextChosen.deep_profile
            ? computeDondeMatchV2(nextChosen, closedMatchInputs, intent)
            : computeDondeMatch(nextChosen, closedMatchInputs);
          if (cuisineMismatch) dondeMatch = Math.min(dondeMatch, 65);

          responseBody = buildSuccessResponse(nextChosen, parsed, nextGoogleData, dondeMatch, undefined, undefined, cuisineMismatch);
        } else {
          // Fallback if no alternatives
          responseBody = buildFallbackResponse(chosen, googleData, 55, cuisineMismatch);
        }
      } else {
        // Normal path: use Claude's pick
        // Use stored insider_tip as fallback if Claude didn't provide one
        if (!parsed.insider_tip && chosen.insider_tip) {
          parsed.insider_tip = chosen.insider_tip;
        }
        // V2: Use deep profile best_seat_in_house as ultimate insider tip fallback
        if (!parsed.insider_tip && chosen.deep_profile?.best_seat_in_house) {
          parsed.insider_tip = chosen.deep_profile.best_seat_in_house;
        }

        // V2: Compute donde_match using multi-dimensional scoring
        const matchInputs = {
          occasion,
          specialRequest: special_request,
          neighborhood,
          priceLevel: price_level,
          googleData,
          claudeRelevance: parsed.relevance_score,
          sentimentNegative: parsed.sentiment_negative,
          intent,
          rejectionSignals,
          userFeedback,
          clientTimeOfDay: time_of_day,
          dietaryRestrictions: dietary_restrictions,
        };
        let dondeMatch = chosen.deep_profile
          ? computeDondeMatchV2(chosen, matchInputs, intent)
          : computeDondeMatch(chosen, matchInputs);

        // Cap match score for cuisine mismatch — never claim a high match when we don't have the cuisine
        if (cuisineMismatch) {
          dondeMatch = Math.min(dondeMatch, 65);
        }

        // V2: Compute scoring dimensions for response
        const dimensions = computeScoringDimensions(chosen, occasion, special_request, intent);
        const weights = computeDimensionWeights(occasion, intent);

        responseBody = buildSuccessResponse(chosen, parsed, googleData, dondeMatch, dimensions, weights, cuisineMismatch);
      }
    } catch (claudeError) {
      wasFallback = true;

      // Enhancement 19: Tiered fallback
      logError("Claude API failed, using fallback", { error: String(claudeError) });
      const chosen = top10[0];

      const googleData = chosen.google_place_id
        ? await fetchPlaceDetails(chosen.google_place_id)
        : null;

      // Enhancement 20: Skip closed restaurant in fallback too
      if (googleData?.business_status === "CLOSED_PERMANENTLY" && top10.length > 1) {
        const nextChosen = top10[1];
        const nextGoogleData = nextChosen.google_place_id
          ? await fetchPlaceDetails(nextChosen.google_place_id)
          : null;
        const closedFallbackInputs = {
          occasion,
          specialRequest: special_request,
          neighborhood,
          priceLevel: price_level,
          googleData: nextGoogleData,
          intent,
          rejectionSignals,
          userFeedback,
          clientTimeOfDay: time_of_day,
          dietaryRestrictions: dietary_restrictions,
        };
        let fallbackMatch = nextChosen.deep_profile
          ? computeDondeMatchV2(nextChosen, closedFallbackInputs, intent)
          : computeDondeMatch(nextChosen, closedFallbackInputs);
        if (cuisineMismatch) fallbackMatch = Math.min(fallbackMatch, 65);
        // Enhancement 19 Tier 4: Template-based response
        responseBody = buildTemplateResponse(nextChosen, nextGoogleData, fallbackMatch, occasion, cuisineMismatch);
      } else {
        // Compute donde_match deterministically (no Claude relevance available)
        const normalFallbackInputs = {
          occasion,
          specialRequest: special_request,
          neighborhood,
          priceLevel: price_level,
          googleData,
          intent,
          rejectionSignals,
          userFeedback,
          clientTimeOfDay: time_of_day,
          dietaryRestrictions: dietary_restrictions,
        };
        let fallbackMatch = chosen.deep_profile
          ? computeDondeMatchV2(chosen, normalFallbackInputs, intent)
          : computeDondeMatch(chosen, normalFallbackInputs);
        if (cuisineMismatch) fallbackMatch = Math.min(fallbackMatch, 65);

        // Enhancement 19 Tier 4: Use template-based response (richer than one-liner)
        responseBody = buildTemplateResponse(chosen, googleData, fallbackMatch, occasion, cuisineMismatch);
      }
    }

    // Enhancement 8: Cache successful responses (only for non-exclude requests)
    if (exclude.length === 0) {
      const cacheKey = getCacheKey(occasion, neighborhood, price_level, special_request);
      setCacheResponse(cacheKey, responseBody);
    }

    // Enhancement 13: Enriched query logging (fire-and-forget — don't block the response)
    const chosenId = (responseBody.restaurant as Record<string, unknown>)
      ?.id as string;
    const responseTimeMs = Date.now() - startTime;

    // Continuous learning: detect keywords not matched by any dictionary
    const unmatchedKw = extractUnmatchedKeywords(special_request);

    supabase
      .from("user_queries")
      .insert({
        occasion,
        price_level,
        special_request,
        neighborhood_id:
          top10[0]?.neighborhood_id || null,
        recommended_restaurant_id: chosenId || null,
        donde_match: (responseBody.donde_match as number) || null,
        exclude_count: exclude.length,
        was_fallback: wasFallback,
        response_time_ms: responseTimeMs,
        claude_relevance_score:
          (responseBody as Record<string, unknown>).relevance_score || null,
        unmatched_keywords: unmatchedKw.length > 0 ? unmatchedKw : null,
        // F9: User ID for personalization tracking
        user_id: user_id || null,
        // F5: Dietary restrictions used
        dietary_restrictions: dietary_restrictions.length > 0 ? dietary_restrictions : null,
      })
      .then(() => {})
      .catch((err: unknown) => logError("Failed to log query", { error: String(err) }));

    logInfo("Recommendation served", {
      responseTimeMs,
      occasion, neighborhood, price_level,
      wasFallback,
      excludeCount: exclude.length,
      hasUserFeedback: !!userFeedback,
      timeOfDay: time_of_day,
    });

    // B15: Include API version in response headers
    const response = jsonResponse(responseBody);
    response.headers.set("X-API-Version", API_VERSION);
    return response;
  } catch (error) {
    logError("Recommendation engine error", { error: String(error) });
    return jsonResponse(buildErrorResponse(error), 500);
  }
});

// Enhancement 19 Tier 2: Regex recovery for malformed Claude JSON
function recoverFromMalformedClaude(text: string): ClaudeRecommendation | null {
  try {
    const indexMatch = text.match(/"restaurant_index"\s*:\s*(\d+)/);
    const recMatch = text.match(/"recommendation"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (indexMatch && recMatch) {
      const tipMatch = text.match(/"insider_tip"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const relMatch = text.match(/"relevance_score"\s*:\s*([\d.]+)/);
      const sentMatch = text.match(/"sentiment_score"\s*:\s*([\d.]+)/);
      const breakdownMatch = text.match(/"sentiment_breakdown"\s*:\s*"((?:[^"\\]|\\.)*)"/);

      const summaryMatch = text.match(/"sentiment_summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const posMatch = text.match(/"sentiment_positive"\s*:\s*(\d+)/);
      const negMatch = text.match(/"sentiment_negative"\s*:\s*(\d+)/);
      const neuMatch = text.match(/"sentiment_neutral"\s*:\s*(\d+)/);

      return {
        restaurant_index: parseInt(indexMatch[1]),
        recommendation: recMatch[1].replace(/\\"/g, '"'),
        insider_tip: tipMatch ? tipMatch[1].replace(/\\"/g, '"') : null,
        relevance_score: relMatch ? parseFloat(relMatch[1]) : 7.0,
        sentiment_score: sentMatch ? parseFloat(sentMatch[1]) : null,
        sentiment_breakdown: breakdownMatch ? breakdownMatch[1].replace(/\\"/g, '"') : null,
        sentiment_summary: summaryMatch ? summaryMatch[1].replace(/\\"/g, '"') : null,
        sentiment_positive: posMatch ? parseInt(posMatch[1]) : null,
        sentiment_negative: negMatch ? parseInt(negMatch[1]) : null,
        sentiment_neutral: neuMatch ? parseInt(neuMatch[1]) : null,
      };
    }
  } catch (_e) {
    // Regex recovery failed
  }
  return null;
}
