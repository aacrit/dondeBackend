/**
 * Donde Match V8 — Recommendation Engine
 *
 * V8 pipeline: Intent → RPC → Hard Filter → V8 Score → Google Enrich → Re-rank → Ranked Queue → Claude (blurb + boost) → Response
 *
 * V8 key changes:
 * - Arithmetic weighted mean replaces geometric mean (no single-factor collapse)
 * - Intent alignment baked into score as multiplier [0.70, 1.00] (not tiebreaker)
 * - 12 consolidated weight-shift rules (down from 28)
 * - Single confidence function (replaces dual system)
 * - Ground-up factor computation rewrite (self-contained, no V3 imports)
 * - Cuisine mismatch cap removed (intent multiplier handles penalty)
 * - Try Again queue blurbs generated from match narrative (no more one-liners)
 */

import { corsPreflightResponse, jsonResponse } from "./_shared/cors.ts";
import { createSupabaseClient, createServiceClient } from "./_shared/supabase.ts";
import { callClaude, parseClaudeJson } from "./_shared/claude.ts";
import {
  ensureDiversity,
  extractUnmatchedKeywords,
} from "./_shared/scoring.ts";
import type { UserFeedbackSignals } from "./_shared/scoring.ts";
// V8 engine imports
import { classifyIntentV5 } from "./_shared/intent-classifier-v5.ts";
import { runFilterPipeline } from "./_shared/filter-pipeline-v5.ts";
import type { FilterContext } from "./_shared/filter-pipeline-v5.ts";
import { computeV8DondeMatch, reRankV8 } from "./_shared/scoring-v8.ts";
import { buildV5SystemPrompt, buildV5UserPrompt, buildBlurbOnlyPrompt } from "./_shared/prompts-v5.ts";
import {
  buildV7SuccessResponse,
  buildV7FallbackResponse,
  buildV7NoResultsResponse,
  buildV7ErrorResponse,
  buildRankedQueueItem,
} from "./_shared/response-builder-v7.ts";
import {
  fetchPlaceDetails,
  formatReviewsForPrompt,
} from "./_shared/google-places.ts";
import { logInfo, logWarn, logError } from "./_shared/logger.ts";
import type {
  UserRequest,
  RestaurantProfile,
  DeepProfile,
} from "./_shared/types.ts";
import type { V5ClaudeRecommendation } from "./_shared/types-v5.ts";
import type { V7ScoredCandidate } from "./_shared/types-v7.ts";
import { getScoreTier } from "./_shared/types-v7.ts";
import type { V8ScoredCandidate } from "./_shared/types-v8.ts";

// V7 API version
const API_VERSION = "7.0.0";

// --- In-memory response cache ---
interface CacheEntry {
  response: Record<string, unknown>;
  expiry: number;
}
const RESPONSE_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes (V6.2: extended from 5min — restaurant data changes rarely)

function getCacheKey(occasion: string, neighborhood: string, price: string, request: string, exclude?: string[]): string {
  // V6.2: Normalize cache key — sort words so "cozy ramen" and "ramen cozy" hit the same entry
  const normalizedRequest = request.toLowerCase().trim().split(/\s+/).sort().join(" ");
  const excludeKey = exclude && exclude.length > 0 ? `|ex:${[...exclude].sort().join(",")}` : "";
  return `${occasion}|${neighborhood}|${price}|${normalizedRequest}${excludeKey}`;
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
  // V6.2: Increased cache size from 100 → 500 entries (~1MB total, trivial for Edge Function)
  if (RESPONSE_CACHE.size > 500) {
    const now = Date.now();
    for (const [k, v] of RESPONSE_CACHE) {
      if (now > v.expiry) RESPONSE_CACHE.delete(k);
    }
  }
  RESPONSE_CACHE.set(key, { response, expiry: Date.now() + CACHE_TTL });
}

// --- Rate limiter ---
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const RATE_LIMIT_MAP = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 60_000;

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

function cleanupRateLimits(): void {
  if (RATE_LIMIT_MAP.size > 500) {
    const now = Date.now();
    for (const [key, entry] of RATE_LIMIT_MAP) {
      if (now > entry.resetAt) RATE_LIMIT_MAP.delete(key);
    }
  }
}

// --- Input sanitization ---
function sanitizeInput(input: string): string {
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s{5,}/g, "    ")
    .replace(/ignore\s+(all\s+)?previous\s+instructions/gi, "")
    .replace(/you\s+are\s+now\s+/gi, "")
    .replace(/system\s*:\s*/gi, "")
    .replace(/\[INST\]/gi, "")
    .replace(/<\/?(?:system|assistant|user)>/gi, "")
    .trim();
}

// V8.8: Extract RPC row → RestaurantProfile mapping for reuse
function mapRpcToProfile(row: Record<string, unknown>): RestaurantProfile {
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
  return { ...row, deep_profile } as unknown as RestaurantProfile;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return corsPreflightResponse();
  }

  // Health check endpoint
  if (req.method === "GET") {
    return jsonResponse({
      status: "ok",
      version: API_VERSION,
      engine: "v7",
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, recommendation: "Method not allowed" },
      405
    );
  }

  // Rate limiting
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

  // V8.8: Route detection — /recommend/blurb for lazy Try Again blurb generation
  const url = new URL(req.url);
  const isBlurbRequest = url.pathname.endsWith("/blurb");

  if (isBlurbRequest) {
    try {
      const blurbBody = await req.json();
      const restaurantData = blurbBody.restaurant_data;
      const context = blurbBody.context;

      if (!restaurantData?.name) {
        return jsonResponse({ success: false, error: "Missing restaurant_data.name" }, 400);
      }

      // Sanitize user-provided strings
      if (context?.special_request) {
        context.special_request = sanitizeInput(context.special_request.slice(0, 500));
      }

      // Determine score tier for tone modulation
      const scoreTier = context?.score_tier || "good";

      // Build minimal prompt for single restaurant blurb
      const systemPrompt = buildV5SystemPrompt(scoreTier as "exceptional" | "great" | "good" | "decent" | "weak");
      const userPrompt = buildBlurbOnlyPrompt(restaurantData, context || {});

      const rawText = await callClaude(userPrompt, systemPrompt, { maxTokens: 384, temperature: 0.7 });
      const parsed = parseClaudeJson<{ recommendation?: string; match_headline?: string; insider_tip?: string }>(rawText);

      // Clean em-dashes from output
      if (parsed.recommendation) {
        parsed.recommendation = parsed.recommendation.replace(/\u2014/g, ", ").replace(/ , /g, ", ").replace(/,\s*,/g, ",");
      }
      if (parsed.insider_tip) {
        parsed.insider_tip = parsed.insider_tip.replace(/\u2014/g, ", ").replace(/ , /g, ", ").replace(/,\s*,/g, ",");
      }

      return jsonResponse({
        success: true,
        recommendation: parsed.recommendation || null,
        match_headline: parsed.match_headline || null,
        insider_tip: parsed.insider_tip || null,
      });
    } catch (err) {
      logError("Blurb endpoint error", { error: err instanceof Error ? err.message : String(err) });
      return jsonResponse({ success: false, error: "Failed to generate blurb" }, 500);
    }
  }

  const startTime = Date.now();

  try {
    // ================================================================
    // STEP 0: Parse and validate input
    // ================================================================
    const body: UserRequest & { open_now?: boolean } = await req.json();
    const special_request = sanitizeInput((body.special_request || "").slice(0, 500));
    const occasion = body.occasion || "Any";
    const neighborhood = body.neighborhood || "Anywhere";
    const price_level = body.price_level || "Any";
    const open_now = body.open_now === true; // V5: Open Now toggle

    const VALID_TIME_PERIODS = ["breakfast", "lunch", "dinner", "late_night"];
    const time_of_day = (typeof body.time_of_day === "string" && VALID_TIME_PERIODS.includes(body.time_of_day))
      ? body.time_of_day : null;
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const exclude = (body.exclude || [])
      .filter((id: string) => typeof id === "string" && UUID_REGEX.test(id))
      .slice(0, 15);

    const dietary_restrictions = (body.dietary_restrictions || [])
      .filter((d: string) => typeof d === "string" && d.length < 30)
      .slice(0, 5);

    const user_id = (typeof body.user_id === "string" && body.user_id.length < 100)
      ? body.user_id : null;

    // SSO: Extract authenticated user ID from JWT
    let authUserId: string | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      if (token.length > 200) {
        try {
          const serviceClient = createServiceClient();
          const { data: { user: authUser } } = await serviceClient.auth.getUser(token);
          if (authUser?.id) authUserId = authUser.id;
        } catch {
          // Invalid JWT — continue as anonymous
        }
      }
    }

    // Process feedback if included (fire-and-forget)
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

    // Check cache — V6.2: include exclude list in cache key so "Try Another" can cache too
    const cacheKey = getCacheKey(occasion, neighborhood, price_level, special_request, exclude);
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      return jsonResponse(cached);
    }

    const supabase = createSupabaseClient();

    // ================================================================
    // STEP 1: Intent classification + User feedback + RPC (parallel)
    // ================================================================
    const feedbackColumn = authUserId ? "auth_user_id" : "user_id";
    const feedbackValue = authUserId || user_id;
    const feedbackLimit = authUserId ? 50 : 20;

    const feedbackPromise = feedbackValue
      ? supabase
          .from("user_queries")
          .select("recommended_restaurant_id, feedback, restaurants!inner(cuisine_type)")
          .eq(feedbackColumn, feedbackValue)
          .not("feedback", "is", null)
          .order("created_at", { ascending: false })
          .limit(feedbackLimit)
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

    // V5: Wider RPC fetch — we filter client-side now
    const rpcLimit = 30;

    const [intentResult, userFeedback, initialRpc] = await Promise.all([
      classifyIntentV5(special_request, occasion),
      feedbackPromise,
      supabase.rpc("get_ranked_restaurants", {
        p_neighborhood: neighborhood,
        p_price_level: "Any", // V5: Fetch broadly, filter client-side
        p_occasion: occasion,
        p_limit: rpcLimit,
        p_target_cuisine: null,
      }),
    ]);

    const intent = intentResult.intent;
    const classificationPath = intentResult.classificationPath;

    logInfo("V7 intent classification", {
      path: classificationPath,
      cuisines: intent?.target_cuisines || [],
      importance: intent?.cuisine_importance || "none",
      emotional: intent?.emotional_intent || "none",
    });

    let { data: rpcData, error: rpcError } = initialRpc;

    // V5: If neighborhood filter returned nothing, retry broader
    if ((!rpcData || rpcData.length === 0) && !rpcError && neighborhood !== "Anywhere") {
      logInfo("V5: Broadening RPC to Anywhere", { neighborhood });
      const { data: broadData, error: broadError } = await supabase.rpc(
        "get_ranked_restaurants",
        { p_neighborhood: "Anywhere", p_price_level: "Any", p_occasion: occasion, p_limit: rpcLimit, p_target_cuisine: null }
      );
      if (!broadError && broadData && broadData.length > 0) {
        rpcData = broadData;
        rpcError = null;
      }
    }

    if (rpcError || !rpcData || rpcData.length === 0) {
      logError("RPC failed or returned no results", { error: rpcError ? String(rpcError) : "empty" });
      return jsonResponse(buildV7NoResultsResponse(neighborhood, price_level));
    }

    // ================================================================
    // STEP 2: Map RPC results to RestaurantProfile with deep_profile
    // ================================================================
    const allCandidates: RestaurantProfile[] = (rpcData as Record<string, unknown>[]).map(
      (row) => mapRpcToProfile(row as Record<string, unknown>)
    );

    // ================================================================
    // STEP 3: V5 Hard Filter Pipeline
    // ================================================================
    const filterContext: FilterContext = {
      exclude,
      neighborhood,
      priceLevel: price_level,
      dietaryRestrictions: dietary_restrictions,
      cuisineImportance: (intent?.cuisine_importance as "high" | "medium" | "low") || "low",
      targetCuisines: intent?.target_cuisines || [],
      openNow: open_now,
      // openNowData will be populated after Google fetch for Open Now toggle
    };

    const filterResult = runFilterPipeline(allCandidates, filterContext);
    let filtered = filterResult.candidates;
    const relaxationApplied = filterResult.relaxationApplied;

    if (relaxationApplied.length > 0) {
      logInfo("V7 filter relaxation applied", { relaxed: relaxationApplied });
    }

    if (filtered.length === 0) {
      return jsonResponse(buildV7NoResultsResponse(neighborhood, price_level));
    }

    // ================================================================
    // STEP 4: V8 Scoring — Score ALL filtered candidates
    // ================================================================
    const scored = reRankV8(
      filtered,
      occasion,
      special_request,
      intent,
      dietary_restrictions,
      filtered.length,
      time_of_day,
    );

    // Apply diversity filter
    const diverseProfiles = ensureDiversity(
      scored.map(s => s.profile),
      allCandidates.filter(r => !exclude.includes(r.id)),
    );
    // Re-map to scored candidates maintaining order
    const diverseScored = diverseProfiles.map(p => {
      const found = scored.find(s => s.profile.id === p.id);
      return found!;
    }).filter(Boolean);

    if (diverseScored.length === 0) {
      return jsonResponse(buildV7NoResultsResponse(neighborhood, price_level));
    }

    // ================================================================
    // STEP 4.5: V8.8 Neighborhood Quality Gate
    // ================================================================
    // If the top scored result in the requested neighborhood is below
    // the quality threshold (P15=50), broaden to "Anywhere" and merge
    // with original results. This prevents serving mediocre results
    // just because they're nearby.
    const NEIGHBORHOOD_QUALITY_THRESHOLD = 50;
    let neighborhoodExpanded = false;
    const topNeighborhoodScore = diverseScored[0]?.result.dondeMatch ?? 0;

    if (topNeighborhoodScore < NEIGHBORHOOD_QUALITY_THRESHOLD && neighborhood !== "Anywhere") {
      logInfo("V8.8: Neighborhood quality gate triggered", {
        neighborhood,
        topScore: topNeighborhoodScore,
        threshold: NEIGHBORHOOD_QUALITY_THRESHOLD,
      });

      const { data: broadData } = await supabase.rpc("get_ranked_restaurants", {
        p_neighborhood: "Anywhere",
        p_price_level: "Any",
        p_occasion: occasion,
        p_limit: rpcLimit,
        p_target_cuisine: null,
      });

      if (broadData?.length) {
        const existingIds = new Set(diverseScored.map(s => s.profile.id));
        const newProfiles: RestaurantProfile[] = (broadData as Record<string, unknown>[])
          .filter((row: Record<string, unknown>) => !existingIds.has(row.id as string) && !exclude.includes(row.id as string))
          .map((row: Record<string, unknown>) => mapRpcToProfile(row));

        if (newProfiles.length > 0) {
          const broadScored = reRankV8(
            newProfiles, occasion, special_request, intent,
            dietary_restrictions, newProfiles.length, time_of_day,
          );
          // Merge and re-sort: include all original + broader candidates
          const merged = [...diverseScored, ...broadScored];
          merged.sort((a, b) => b.result.dondeMatch - a.result.dondeMatch);
          // Replace diverseScored with merged results (take top entries)
          diverseScored.length = 0;
          for (const item of merged.slice(0, 15)) {
            diverseScored.push(item);
          }
          neighborhoodExpanded = true;
          logInfo("V8.8: Neighborhood expanded", {
            addedCandidates: broadScored.length,
            newTopScore: diverseScored[0]?.result.dondeMatch ?? 0,
          });
        }
      }
    }

    // ================================================================
    // STEP 5: Google Places enrichment (top 5 candidates)
    // ================================================================
    const top5PlaceIds = diverseScored
      .slice(0, 5)
      .map(s => s.profile.google_place_id)
      .filter(Boolean) as string[];

    const googlePromises = top5PlaceIds.map(pid => fetchPlaceDetails(pid));
    const googleTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 1500));
    const googleRace = Promise.all(googlePromises);
    const googleResultsOrTimeout = await Promise.race([googleRace, googleTimeout]);

    const googleResults = googleResultsOrTimeout
      ? (googleResultsOrTimeout as Awaited<ReturnType<typeof fetchPlaceDetails>>[])
      : [];

    const googleByPlaceId = new Map<string, Awaited<ReturnType<typeof fetchPlaceDetails>>>();
    for (let i = 0; i < top5PlaceIds.length && i < googleResults.length; i++) {
      const gd = googleResults[i];
      if (gd) googleByPlaceId.set(top5PlaceIds[i], gd);
    }

    // ================================================================
    // STEP 6: Post-Google re-rank with real Google data (V8)
    // ================================================================
    const rerankedScored: V7ScoredCandidate[] = diverseScored.map(sc => {
      const googleData = sc.profile.google_place_id
        ? googleByPlaceId.get(sc.profile.google_place_id) || null
        : null;

      // Re-compute with Google data for reputation accuracy
      const reResult = computeV8DondeMatch(sc.profile, {
        occasion,
        specialRequest: special_request,
        neighborhood: "Anywhere", // Already filtered
        priceLevel: "Any",         // Already filtered
        googleData,
        sentimentScore: null,
        sentimentNegative: null,
        intent,
        clientTimeOfDay: time_of_day,
        dietaryRestrictions: dietary_restrictions,
        candidatePoolSize: diverseScored.length,
      });

      // V8→V7 adapter: V7ScoredCandidate shape for response builder backward compat
      return {
        profile: sc.profile,
        dondeMatch: reResult.dondeMatch,
        factors: reResult.factors,
        weights: reResult.weights,
        confidence: { food: "high" as const, vibe: "high" as const, service: "high" as const, reputation: "high" as const, convenience: "high" as const },
        dataCompleteness: reResult.dataCompleteness,
        weightShiftReasons: reResult.weightShiftReasons,
        factorDetails: reResult.factorDetails,
        intentAlignment: reResult.intentAlignment,
        matchNarrative: reResult.matchNarrative,
        googleData,
      };
    });

    // Sort by re-ranked DondeScore (simple descending).
    // V8: Intent alignment is already baked into the score, no tiebreaker needed.
    rerankedScored.sort((a, b) => b.dondeMatch - a.dondeMatch);

    // ================================================================
    // STEP 6.1: V8.8 Quality Callout Check
    // ================================================================
    // If the top result scores below P5 (40) of observed distribution,
    // it's essentially a forced match from filters. Flag for callout.
    const QUALITY_CALLOUT_THRESHOLD = 40;
    const topFinalScore = rerankedScored[0]?.dondeMatch ?? 0;
    const needsQualityCallout = topFinalScore < QUALITY_CALLOUT_THRESHOLD;
    if (needsQualityCallout) {
      logInfo("V8.8: Quality callout triggered", {
        topScore: topFinalScore,
        threshold: QUALITY_CALLOUT_THRESHOLD,
        restaurant: rerankedScored[0]?.profile.name,
      });
    }

    // ================================================================
    // STEP 6.5: V7 — Build Ranked Queue for instant "Try Again"
    // ================================================================
    const rankedQueue: Record<string, unknown>[] = [];
    for (let i = 1; i < Math.min(5, rerankedScored.length); i++) {
      rankedQueue.push(buildRankedQueueItem(rerankedScored[i], i + 1));
    }

    // ================================================================
    // STEP 7: Build Claude prompt — full pool + top 3 deep profiles
    // ================================================================
    let responseBody: Record<string, unknown>;
    let wasFallback = false;

    try {
      // Build deep profiles for top 10 (Google data only available for top 5 already fetched)
      const topCandidatesWithGoogle = rerankedScored.slice(0, 10).map(sc => {
        const gd = sc.googleData || null;
        const reviews = gd && gd.reviews.length > 0 ? formatReviewsForPrompt(gd.reviews) : "";
        return { candidate: sc, googleData: gd, reviews };
      });

      // Determine score tier for tone modulation
      const topScore = rerankedScored[0].dondeMatch;
      const scoreTier = getScoreTier(topScore);

      // Build weight context string for Claude
      const weightContext = rerankedScored[0].weightShiftReasons.join("; ") || "Standard weights";

      // V5 system prompt with Donde character voice + tone directive
      const systemPrompt = buildV5SystemPrompt(scoreTier);

      // V5 user prompt with full candidate pool + top 10 deep profiles
      const userPrompt = buildV5UserPrompt(
        special_request,
        occasion,
        neighborhood,
        price_level,
        dietary_restrictions,
        rerankedScored,
        topCandidatesWithGoogle,
        weightContext,
        intent,
        needsQualityCallout,
        neighborhoodExpanded,
      );

      // Single Claude API call — blurb + potential boost
      const claudeText = await callClaude(userPrompt, systemPrompt);

      // Parse Claude's V5 response
      let parsed: V5ClaudeRecommendation;
      try {
        parsed = parseClaudeJson<V5ClaudeRecommendation>(claudeText);
      } catch (_parseError) {
        // Regex recovery for malformed JSON
        const recovered = recoverFromMalformedV5(claudeText);
        if (recovered) {
          parsed = recovered;
          logWarn("V5 Claude JSON parse failed, recovered via regex");
        } else {
          throw new Error("Claude returned unparseable V5 response");
        }
      }

      // ================================================================
      // STEP 8: Process Intent Boost
      // ================================================================
      let chosenIdx = Math.min(Math.max(0, parsed.restaurant_index || 0), rerankedScored.length - 1);
      let intentBoost: {
        active: boolean;
        reason: string;
        boost_points: number;
        base_score: number;
        original_engine_rank: number;
      } | null = null;

      if (parsed.intent_boost && chosenIdx > 0) {
        const boostedCandidate = rerankedScored[chosenIdx];
        const engineTopScore = rerankedScored[0].dondeMatch;
        // V6: Raised ceiling from 25 → 35 for dish-level queries
        const boostPoints = Math.min(35, Math.max(5, parsed.boost_points || 0));
        const baseScore = boostedCandidate.dondeMatch;
        const boostedScore = Math.min(99, baseScore + boostPoints);

        // Guard rails: base score must be >= 35, boosted must beat engine #1
        if (baseScore >= 35 && boostedScore > engineTopScore) {
          intentBoost = {
            active: true,
            reason: parsed.boost_reason || "Better match for your request",
            boost_points: boostPoints,
            base_score: baseScore,
            original_engine_rank: chosenIdx,
          };
          // Update the chosen candidate's dondeMatch to include boost
          rerankedScored[chosenIdx] = {
            ...boostedCandidate,
            dondeMatch: boostedScore,
          };
          logInfo("V7 Intent Boost applied", {
            from: rerankedScored[0].profile.name,
            to: boostedCandidate.profile.name,
            baseScore,
            boostPoints,
            boostedScore,
            reason: intentBoost.reason,
          });
        } else {
          // Boost rejected — use engine's #1
          logInfo("V7 Intent Boost rejected", {
            baseScore,
            boostPoints,
            boostedScore,
            engineTopScore,
            reason: baseScore < 35 ? "base too low" : "doesn't beat #1",
          });
          chosenIdx = 0;
          intentBoost = null;
        }
      } else if (!parsed.intent_boost) {
        chosenIdx = 0;
      }

      const chosen = rerankedScored[chosenIdx];
      let dondeMatch = chosen.dondeMatch;

      // V8: Cuisine mismatch detection (informational only, no cap).
      // V8's intent multiplier already penalizes mismatched restaurants naturally.
      let cuisineMismatch: { requested: string; got: string } | null = null;
      if (intent?.cuisine_importance === "high" && intent.target_cuisines?.length > 0) {
        const chosenCuisine = (chosen.profile.cuisine_type || "").toLowerCase();
        const subcategory = (chosen.profile.deep_profile?.cuisine_subcategory || "").toLowerCase();
        const cuisineMatch = intent.target_cuisines.some((tc: string) => {
          const tcLower = tc.toLowerCase();
          return chosenCuisine.includes(tcLower) || tcLower.includes(chosenCuisine)
            || subcategory.includes(tcLower) || tcLower.includes(subcategory);
        });
        if (!cuisineMatch) {
          cuisineMismatch = {
            requested: intent.target_cuisines.join(", "),
            got: chosen.profile.cuisine_type || "Unknown",
          };
          logInfo("V8 cuisine_mismatch: detected (no cap, intent multiplier handles penalty)", {
            requested: intent.target_cuisines,
            got: chosen.profile.cuisine_type,
            score: dondeMatch,
          });
        }
      }

      // Get Google data for chosen
      let chosenGoogleData = chosen.googleData || null;
      if (!chosenGoogleData && chosen.profile.google_place_id) {
        chosenGoogleData = await fetchPlaceDetails(chosen.profile.google_place_id);
      }

      // Enhancement 20: Skip closed restaurants
      if (chosenGoogleData?.business_status === "CLOSED_PERMANENTLY") {
        logWarn("V7: Chosen restaurant permanently closed, picking next", { name: chosen.profile.name });
        const nextIdx = rerankedScored.findIndex((s, i) => i !== chosenIdx);
        if (nextIdx !== -1) {
          const nextChosen = rerankedScored[nextIdx];
          const nextGoogle = nextChosen.googleData || (nextChosen.profile.google_place_id
            ? await fetchPlaceDetails(nextChosen.profile.google_place_id) : null);

          if (!parsed.insider_tip && nextChosen.profile.insider_tip) {
            parsed.insider_tip = nextChosen.profile.insider_tip;
          }

          const v7Result = {
            dondeMatch: nextChosen.dondeMatch,
            factors: nextChosen.factors,
            weights: nextChosen.weights,
            confidence: nextChosen.confidence,
            dataCompleteness: nextChosen.dataCompleteness,
            weightShiftReasons: nextChosen.weightShiftReasons,
            factorDetails: nextChosen.factorDetails,
            intentAlignment: nextChosen.intentAlignment,
            matchNarrative: nextChosen.matchNarrative,
          };

          responseBody = buildV7SuccessResponse(
            nextChosen.profile, parsed, nextGoogle, nextChosen.dondeMatch,
            v7Result, null, relaxationApplied, rankedQueue, null,
            needsQualityCallout, neighborhoodExpanded,
          );
        } else {
          responseBody = buildV7FallbackResponse(
            chosen.profile, chosenGoogleData, 55,
            { dondeMatch: 55, factors: chosen.factors, weights: chosen.weights, confidence: chosen.confidence, dataCompleteness: chosen.dataCompleteness, weightShiftReasons: chosen.weightShiftReasons, factorDetails: chosen.factorDetails, intentAlignment: chosen.intentAlignment, matchNarrative: chosen.matchNarrative },
            relaxationApplied, rankedQueue,
          );
        }
      } else {
        // Normal path: use Claude's pick
        if (!parsed.insider_tip && chosen.profile.insider_tip) {
          parsed.insider_tip = chosen.profile.insider_tip;
        }
        if (!parsed.insider_tip && chosen.profile.deep_profile?.best_seat_in_house) {
          parsed.insider_tip = chosen.profile.deep_profile.best_seat_in_house;
        }

        const v7Result = {
          dondeMatch,
          factors: chosen.factors,
          weights: chosen.weights,
          confidence: chosen.confidence,
          dataCompleteness: chosen.dataCompleteness,
          weightShiftReasons: chosen.weightShiftReasons,
          factorDetails: chosen.factorDetails,
          intentAlignment: chosen.intentAlignment,
          matchNarrative: chosen.matchNarrative,
        };

        responseBody = buildV7SuccessResponse(
          chosen.profile, parsed, chosenGoogleData, dondeMatch,
          v7Result, intentBoost, relaxationApplied, rankedQueue, cuisineMismatch,
          needsQualityCallout, neighborhoodExpanded,
        );
      }

      // Quality guardrail: detect AI slop patterns
      if (parsed.recommendation) {
        const SLOP_PATTERNS = [
          "culinary", "gastronomic", "unforgettable", "unparalleled", "nestled",
          "tantalizing", "mouthwatering", "delectable", "exquisite", "embark",
          "elevate your", "a testament to", "truly remarkable", "a must-visit",
          "from the moment you", "whether you're looking", "taste buds",
          "culinary journey", "dining experience", "perfect harmony",
          "burst of flavor", "a cut above", "doesn't disappoint",
          "will not disappoint", "not to be missed", "that will leave you",
          "perfect blend", "perfect balance", "hits all the right notes",
          "checks all the boxes", "treat your taste buds", "palate",
          "artisanal", "artisan", "transcend", "beckons", "invites you",
          "symphony of", "tapestry", "crafted with care", "fusion of flavors",
          "something for everyone", "where tradition meets", "food lovers",
          "hidden gem", "promises", "impeccable", "masterfully", "stunningly",
        ];
        const recLower = parsed.recommendation.toLowerCase();
        const slopHits = SLOP_PATTERNS.filter(p => recLower.includes(p));
        if (slopHits.length >= 2) {
          logWarn("V5 slop patterns detected", { count: slopHits.length, patterns: slopHits });
        }

        const emDashCount = (parsed.recommendation.match(/\u2014/g) || []).length;
        if (emDashCount > 0) {
          logWarn("V5 recommendation contains em dashes", { count: emDashCount });
          // Strip em dashes — replace with comma+space, then clean up double separators
          parsed.recommendation = parsed.recommendation.replace(/\u2014/g, ", ").replace(/ , /g, ", ").replace(/,\s*,/g, ",");
        }
        // Strip em dashes from insider_tip as well
        if (parsed.insider_tip) {
          parsed.insider_tip = parsed.insider_tip.replace(/\u2014/g, ", ").replace(/ , /g, ", ").replace(/,\s*,/g, ",");
        }

        // V5: Word count check (target 100-120 words per prompt spec)
        const wordCount = parsed.recommendation.split(/\s+/).length;
        if (wordCount < 80 || wordCount > 150) {
          logWarn("V5 recommendation word count outside target", { wordCount, target: "100-120" });
        }

        // V5: "We" voice check
        const recLowerForVoice = parsed.recommendation.toLowerCase();
        if (!/\bwe\b|\bour\b/.test(recLowerForVoice)) {
          logWarn("V5 recommendation missing 'we'/'our' voice mandate");
        }
      }

    } catch (claudeError) {
      wasFallback = true;
      logError("V7 Claude API failed, using fallback", { error: String(claudeError) });

      const chosen = rerankedScored[0];
      let chosenGoogleData = chosen.googleData || null;
      if (!chosenGoogleData && chosen.profile.google_place_id) {
        chosenGoogleData = await fetchPlaceDetails(chosen.profile.google_place_id);
      }

      // Skip closed restaurant in fallback
      if (chosenGoogleData?.business_status === "CLOSED_PERMANENTLY" && rerankedScored.length > 1) {
        const nextChosen = rerankedScored[1];
        const nextGoogle = nextChosen.googleData || (nextChosen.profile.google_place_id
          ? await fetchPlaceDetails(nextChosen.profile.google_place_id) : null);

        responseBody = buildV7FallbackResponse(
          nextChosen.profile, nextGoogle, nextChosen.dondeMatch,
          { dondeMatch: nextChosen.dondeMatch, factors: nextChosen.factors, weights: nextChosen.weights, confidence: nextChosen.confidence, dataCompleteness: nextChosen.dataCompleteness, weightShiftReasons: nextChosen.weightShiftReasons, factorDetails: nextChosen.factorDetails, intentAlignment: nextChosen.intentAlignment, matchNarrative: nextChosen.matchNarrative },
          relaxationApplied, rankedQueue,
        );
      } else {
        responseBody = buildV7FallbackResponse(
          chosen.profile, chosenGoogleData, chosen.dondeMatch,
          { dondeMatch: chosen.dondeMatch, factors: chosen.factors, weights: chosen.weights, confidence: chosen.confidence, dataCompleteness: chosen.dataCompleteness, weightShiftReasons: chosen.weightShiftReasons, factorDetails: chosen.factorDetails, intentAlignment: chosen.intentAlignment, matchNarrative: chosen.matchNarrative },
          relaxationApplied, rankedQueue,
        );
      }
    }

    // ================================================================
    // STEP 9: Cache + Logging
    // ================================================================
    // V6.2: Cache all responses (including "Try Another" with exclude list)
    const storeCacheKey = getCacheKey(occasion, neighborhood, price_level, special_request, exclude);
    setCacheResponse(storeCacheKey, responseBody);

    const chosenId = (responseBody.restaurant as Record<string, unknown>)?.id as string;
    const responseTimeMs = Date.now() - startTime;
    const unmatchedKw = extractUnmatchedKeywords(special_request);

    supabase
      .from("user_queries")
      .insert({
        occasion,
        price_level,
        special_request,
        neighborhood_id: rerankedScored[0]?.profile?.neighborhood_id || null,
        recommended_restaurant_id: chosenId || null,
        donde_match: (responseBody.donde_match as number) || null,
        exclude_count: exclude.length,
        was_fallback: wasFallback,
        response_time_ms: responseTimeMs,
        unmatched_keywords: unmatchedKw.length > 0 ? unmatchedKw : null,
        user_id: user_id || null,
        auth_user_id: authUserId || null,
        dietary_restrictions: dietary_restrictions.length > 0 ? dietary_restrictions : null,
      })
      .then(() => {})
      .catch((err: unknown) => logError("Failed to log query", { error: String(err) }));

    // SSO: Auto-save search for authenticated users
    if (authUserId && chosenId) {
      const chosenRestaurant = responseBody.restaurant as Record<string, unknown>;
      const serviceForSave = createServiceClient();
      serviceForSave
        .from("user_searches")
        .insert({
          user_id: authUserId,
          craving: special_request || null,
          occasion,
          neighborhood,
          price_level,
          dietary_restrictions: dietary_restrictions.length > 0 ? dietary_restrictions : null,
          restaurant_id: chosenId,
          restaurant_name: (chosenRestaurant?.name as string) || null,
          cuisine_type: (chosenRestaurant?.cuisine_type as string) || null,
          donde_match: (responseBody.donde_match as number) || null,
          result_snapshot: {
            name: chosenRestaurant?.name,
            best_for_oneliner: chosenRestaurant?.best_for_oneliner,
            recommendation: (responseBody as Record<string, unknown>).recommendation,
            donde_match: responseBody.donde_match,
          },
        })
        .then(() => {})
        .catch((err: unknown) => logError("Failed to auto-save search", { error: String(err) }));
    }

    logInfo("V7 recommendation served", {
      responseTimeMs,
      occasion, neighborhood, price_level,
      wasFallback,
      excludeCount: exclude.length,
      classificationPath,
      intentBoost: !!(responseBody as Record<string, unknown>).intent_boost,
      relaxation: relaxationApplied,
      candidatePool: rerankedScored.length,
      rankedQueueSize: rankedQueue.length,
      engine: "v7",
    });

    const response = jsonResponse(responseBody);
    response.headers.set("X-API-Version", API_VERSION);
    response.headers.set("X-Engine", "v7");
    return response;
  } catch (error) {
    logError("V7 engine error", { error: String(error) });
    return jsonResponse(buildV7ErrorResponse(error), 500);
  }
});

// V5 Regex recovery for malformed Claude JSON
function recoverFromMalformedV5(text: string): V5ClaudeRecommendation | null {
  try {
    const indexMatch = text.match(/"restaurant_index"\s*:\s*(\d+)/);
    const recMatch = text.match(/"recommendation"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (indexMatch && recMatch) {
      const tipMatch = text.match(/"insider_tip"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const boostMatch = text.match(/"intent_boost"\s*:\s*(true|false)/);
      const boostReasonMatch = text.match(/"boost_reason"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const boostPointsMatch = text.match(/"boost_points"\s*:\s*(\d+)/);
      const sentMatch = text.match(/"sentiment_score"\s*:\s*([\d.]+)/);
      const summaryMatch = text.match(/"sentiment_summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);

      return {
        restaurant_index: parseInt(indexMatch[1]),
        recommendation: recMatch[1].replace(/\\"/g, '"'),
        insider_tip: tipMatch ? tipMatch[1].replace(/\\"/g, '"') : null,
        intent_boost: boostMatch ? boostMatch[1] === "true" : false,
        boost_reason: boostReasonMatch ? boostReasonMatch[1].replace(/\\"/g, '"') : null,
        boost_points: boostPointsMatch ? parseInt(boostPointsMatch[1]) : 0,
        sentiment_score: sentMatch ? parseFloat(sentMatch[1]) : null,
        sentiment_summary: summaryMatch ? summaryMatch[1].replace(/\\"/g, '"') : null,
      };
    }
  } catch (_e) {
    // Regex recovery failed
  }
  return null;
}
