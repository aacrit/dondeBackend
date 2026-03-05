/**
 * Donde Match V9 — Recommendation Engine
 *
 * V9 pipeline: Intent → RPC (with text search) → Dietary Filter → V9 Score (Relevance × Quality) → Google Enrich → Re-rank → Ranked Queue → Claude (blurb + boost) → Response
 *
 * V9 architecture:
 * - Score = Relevance(0-1) × Quality(0-100) + OccasionBonus(±5)
 * - Relevance is a GATE using review intelligence (dish > cuisine > vibe > open_ended)
 * - Quality uses query-type-aware weight profiles (no weight-shift rules)
 * - Review intelligence provides evidence-based dish/cuisine data (self-healing for null cuisine_type)
 */

import { corsPreflightResponse, jsonResponse } from "./_shared/cors.ts";
import { createSupabaseClient, createServiceClient } from "./_shared/supabase.ts";
import { callClaude, parseClaudeJson } from "./_shared/claude.ts";
import {
  ensureDiversity,
  extractUnmatchedKeywords,
} from "./_shared/scoring.ts";
import type { UserFeedbackSignals } from "./_shared/scoring.ts";
// V9 engine imports
import { classifyIntentV5 } from "./_shared/intent-classifier-v5.ts";
import { computeV9Score, reRankV9, NEIGHBORHOOD_ALIASES } from "./_shared/scoring-v9.ts";
import { buildV5SystemPrompt, buildV5UserPrompt, buildBlurbOnlyPrompt, detectCultureTheme } from "./_shared/prompts-v5.ts";
import type { CultureTheme } from "./_shared/prompts-v5.ts";
import {
  buildV9SuccessResponse,
  buildV9FallbackResponse,
  buildV9NoResultsResponse,
  buildV9ErrorResponse,
  buildV9RankedQueueItem,
} from "./_shared/response-builder-v9.ts";
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
import type {
  ClaudeRecommendation,
  V9Candidate,
  V9ScoringContext,
  V9ScoredCandidate,
  V9ScoreResult,
  ReviewIntelligence,
} from "./_shared/types-v9.ts";
import { getScoreTier } from "./_shared/types-v9.ts";

const API_VERSION = "10.0.0";

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

// Extract RPC row → V9Candidate mapping (RestaurantProfile + review intelligence)
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

function mapRpcToCandidate(row: Record<string, unknown>): V9Candidate {
  const base = mapRpcToProfile(row);
  const review_intelligence: ReviewIntelligence | null =
    (row.ri_dish_catalog || row.ri_cuisine_signals) ? {
      dish_catalog: (row.ri_dish_catalog as string[]) || [],
      popular_dishes: (row.ri_popular_dishes as string[]) || [],
      cuisine_signals: (row.ri_cuisine_signals as string[]) || [],
      review_food_quality: (row.ri_review_food_quality as number | null) ?? null,
      review_service_quality: (row.ri_review_service_quality as number | null) ?? null,
      review_ambiance_quality: (row.ri_review_ambiance_quality as number | null) ?? null,
      review_value_score: (row.ri_review_value_score as number | null) ?? null,
    } : null;
  return {
    ...base,
    review_intelligence,
    ri_text_rank: (row.ri_text_rank as number) || 0,
    dp_menu_highlights: base.deep_profile?.menu_highlights || null,
  };
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
      engine: "v10",
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

      // Detect culture theme for narrative voice from cuisine type and request
      const cultureText = [restaurantData.cuisine_type, context?.special_request].filter(Boolean).join(' ');
      const cultureTheme = detectCultureTheme(cultureText);

      // Build minimal prompt for single restaurant blurb
      const systemPrompt = buildV5SystemPrompt(scoreTier as "exceptional" | "great" | "good" | "decent" | "weak", cultureTheme);
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
    // V10: Resolve neighborhood aliases (landmarks, alternate names)
    const rawNeighborhood = body.neighborhood || "Anywhere";
    const neighborhood = NEIGHBORHOOD_ALIASES[rawNeighborhood.toLowerCase()] || rawNeighborhood;
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

    // V10: Intent classification FIRST so we can pass signals to RPC
    const [intentResult, userFeedback] = await Promise.all([
      classifyIntentV5(special_request, occasion),
      feedbackPromise,
    ]);

    const intent = intentResult.intent;
    const classificationPath = intentResult.classificationPath;

    logInfo("V10 intent classification", {
      path: classificationPath,
      cuisines: intent?.target_cuisines || [],
      importance: intent?.cuisine_importance || "none",
      emotional: intent?.emotional_intent || "none",
    });

    // V10: Dynamic candidate pool — vibe/open-ended queries get more candidates
    const hasVibeOnly = (intent?.vibe_keywords?.length ?? 0) > 0 && (intent?.target_cuisines?.length ?? 0) === 0;
    const isOpenEndedQuery = !intent || (
      (intent.target_cuisines?.length ?? 0) === 0 &&
      (intent.target_tags?.length ?? 0) === 0 &&
      (intent.vibe_keywords?.length ?? 0) === 0 &&
      !intent.dish_level_intent
    );
    const rpcLimit = (hasVibeOnly || isOpenEndedQuery) ? 80 : 50;

    // V10: Pass cuisine and tag targets to RPC for smarter retrieval
    const targetCuisines = intent?.target_cuisines || [];
    const targetTags = intent?.target_tags || [];

    const { data: rpcData, error: rpcError } = await supabase.rpc("get_candidates_v10", {
      p_query: special_request || null,
      p_neighborhood: neighborhood,
      p_occasion: occasion,
      p_limit: rpcLimit,
      p_exclude: exclude,
      p_target_cuisines: targetCuisines,
      p_target_tags: targetTags,
    }).then(result => {
      // Fallback to v9 RPC if v10 doesn't exist yet (migration not applied)
      if (result.error?.message?.includes("get_candidates_v10")) {
        logWarn("V10 RPC not found, falling back to V9");
        return supabase.rpc("get_candidates_v9", {
          p_query: special_request || null,
          p_neighborhood: neighborhood,
          p_occasion: occasion,
          p_limit: rpcLimit,
          p_exclude: exclude,
        });
      }
      return result;
    });

    let finalRpcData = rpcData;
    let finalRpcError = rpcError;

    // If neighborhood filter returned nothing, retry broader
    if ((!finalRpcData || finalRpcData.length === 0) && !finalRpcError && neighborhood !== "Anywhere") {
      logInfo("V10: Broadening RPC to Anywhere", { neighborhood });
      const { data: broadData, error: broadError } = await supabase.rpc(
        "get_candidates_v10",
        { p_query: special_request || null, p_neighborhood: "Anywhere", p_occasion: occasion, p_limit: rpcLimit, p_exclude: exclude, p_target_cuisines: targetCuisines, p_target_tags: targetTags }
      ).then(result => {
        if (result.error?.message?.includes("get_candidates_v10")) {
          return supabase.rpc("get_candidates_v9", { p_query: special_request || null, p_neighborhood: "Anywhere", p_occasion: occasion, p_limit: rpcLimit, p_exclude: exclude });
        }
        return result;
      });
      if (!broadError && broadData && broadData.length > 0) {
        finalRpcData = broadData;
        finalRpcError = null;
      }
    }

    if (finalRpcError || !finalRpcData || finalRpcData.length === 0) {
      logError("RPC failed or returned no results", { error: finalRpcError ? String(finalRpcError) : "empty" });
      return jsonResponse(buildV9NoResultsResponse(neighborhood, price_level));
    }

    // ================================================================
    // STEP 2: Map RPC results to V9Candidate (RestaurantProfile + review intelligence)
    // ================================================================
    const allCandidates: V9Candidate[] = (finalRpcData as Record<string, unknown>[]).map(
      (row) => mapRpcToCandidate(row as Record<string, unknown>)
    );

    // ================================================================
    // STEP 3: Dietary filter (safety — never relaxed)
    // V9 uses relevance gating instead of hard cuisine/price/neighborhood filters.
    // Exclude list is handled at the RPC level (p_exclude parameter).
    // ================================================================
    let candidates = allCandidates;
    if (dietary_restrictions.length > 0) {
      candidates = candidates.filter(r => {
        if (!r.dietary_options || r.dietary_options.length === 0) return true;
        return dietary_restrictions.some(dr => {
          const drLower = dr.toLowerCase();
          return r.dietary_options!.some(opt => opt.toLowerCase().includes(drLower));
        });
      });
    }

    if (candidates.length === 0) {
      return jsonResponse(buildV9NoResultsResponse(neighborhood, price_level));
    }

    // ================================================================
    // STEP 4: V9 Scoring — Relevance × Quality for ALL candidates
    // ================================================================
    const v9Context: V9ScoringContext = {
      occasion,
      specialRequest: special_request,
      neighborhood,
      priceLevel: price_level,
      googleData: null,
      intent,
      clientTimeOfDay: time_of_day,
      dietaryRestrictions: dietary_restrictions,
    };

    const scored = reRankV9(candidates, v9Context);

    // Apply diversity filter
    const diverseProfiles = ensureDiversity(
      scored.map(s => s.profile),
      allCandidates.filter(r => !exclude.includes(r.id)),
    );
    // Re-map to scored candidates maintaining order
    const diverseScored = diverseProfiles.map(p => {
      const found = scored.find(s => s.profile.id === p.id);
      return found!;
    }).filter(Boolean) as V9ScoredCandidate[];

    if (diverseScored.length === 0) {
      return jsonResponse(buildV9NoResultsResponse(neighborhood, price_level));
    }

    // ================================================================
    // STEP 4.5: Neighborhood Quality Gate
    // ================================================================
    const NEIGHBORHOOD_QUALITY_THRESHOLD = 45;
    let neighborhoodExpanded = false;
    const topNeighborhoodScore = diverseScored[0]?.dondeMatch ?? 0;

    if (topNeighborhoodScore < NEIGHBORHOOD_QUALITY_THRESHOLD && neighborhood !== "Anywhere") {
      logInfo("V9: Neighborhood quality gate triggered", {
        neighborhood,
        topScore: topNeighborhoodScore,
        threshold: NEIGHBORHOOD_QUALITY_THRESHOLD,
      });

      const { data: broadData } = await supabase.rpc("get_candidates_v10", {
        p_query: special_request || null,
        p_neighborhood: "Anywhere",
        p_occasion: occasion,
        p_limit: rpcLimit,
        p_exclude: exclude,
        p_target_cuisines: targetCuisines,
        p_target_tags: targetTags,
      }).then(result => {
        if (result.error?.message?.includes("get_candidates_v10")) {
          return supabase.rpc("get_candidates_v9", { p_query: special_request || null, p_neighborhood: "Anywhere", p_occasion: occasion, p_limit: rpcLimit, p_exclude: exclude });
        }
        return result;
      });

      if (broadData?.length) {
        const existingIds = new Set(diverseScored.map(s => s.profile.id));
        const newCandidates: V9Candidate[] = (broadData as Record<string, unknown>[])
          .filter((row: Record<string, unknown>) => !existingIds.has(row.id as string))
          .map((row: Record<string, unknown>) => mapRpcToCandidate(row));

        if (newCandidates.length > 0) {
          const broadScored = reRankV9(newCandidates, v9Context);
          const merged: V9ScoredCandidate[] = [...diverseScored, ...broadScored];
          merged.sort((a, b) => b.dondeMatch - a.dondeMatch);
          diverseScored.length = 0;
          for (const item of merged.slice(0, 15)) {
            diverseScored.push(item);
          }
          neighborhoodExpanded = true;
          logInfo("V9: Neighborhood expanded", {
            addedCandidates: broadScored.length,
            newTopScore: diverseScored[0]?.dondeMatch ?? 0,
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
    // STEP 6: Post-Google re-rank with real Google data (V9)
    // ================================================================
    const rerankedScored: V9ScoredCandidate[] = diverseScored.map(sc => {
      const googleData = sc.profile.google_place_id
        ? googleByPlaceId.get(sc.profile.google_place_id) || null
        : null;

      if (!googleData) return sc;

      // Re-compute with Google data for reputation accuracy
      const reResult = computeV9Score(sc.profile as V9Candidate, {
        ...v9Context,
        googleData,
      });

      return {
        ...sc,
        dondeMatch: reResult.dondeMatch,
        relevance: reResult.relevance,
        quality: reResult.quality,
        factors: reResult.factors,
        qualityWeights: reResult.qualityWeights,
        occasionBonus: reResult.occasionBonus,
        matchNarrative: reResult.matchNarrative,
        dataCompleteness: reResult.dataCompleteness,
        googleData,
      };
    });

    // Sort by re-ranked DondeScore
    rerankedScored.sort((a, b) => b.dondeMatch - a.dondeMatch);

    // ================================================================
    // STEP 6.1: Quality Callout Check
    // ================================================================
    const QUALITY_CALLOUT_THRESHOLD = 35;
    const topFinalScore = rerankedScored[0]?.dondeMatch ?? 0;
    const needsQualityCallout = topFinalScore < QUALITY_CALLOUT_THRESHOLD;
    if (needsQualityCallout) {
      logInfo("V9: Quality callout triggered", {
        topScore: topFinalScore,
        threshold: QUALITY_CALLOUT_THRESHOLD,
        restaurant: rerankedScored[0]?.profile.name,
      });
    }

    // ================================================================
    // STEP 6.5: Build Ranked Queue for instant "Try Again"
    // ================================================================
    const rankedQueue: Record<string, unknown>[] = [];
    for (let i = 1; i < Math.min(5, rerankedScored.length); i++) {
      rankedQueue.push(buildV9RankedQueueItem(rerankedScored[i], i + 1));
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
        const reviews = gd && gd.reviews?.length > 0 ? formatReviewsForPrompt(gd.reviews) : "";
        return { candidate: sc, googleData: gd, reviews };
      });

      // Determine score tier for tone modulation
      const topScore = rerankedScored[0].dondeMatch;
      const scoreTier = getScoreTier(topScore);

      // Build weight context string for Claude (V9: relevance type instead of weight shift rules)
      const topRelevance = rerankedScored[0].relevance;
      const weightContext = `${topRelevance.type} query (R=${topRelevance.score.toFixed(2)}): ${topRelevance.details}`;

      // Detect culture theme for narrative voice from top candidate + user intent
      const cultureText = [
        rerankedScored[0].profile.cuisine_type,
        intent?.target_cuisines?.join(' '),
        special_request,
      ].filter(Boolean).join(' ');
      const cultureTheme = detectCultureTheme(cultureText);

      // System prompt with Donde character voice + tone + narrative voice
      const systemPrompt = buildV5SystemPrompt(scoreTier, cultureTheme);

      // User prompt with full candidate pool + top 10 deep profiles
      // Cast V9ScoredCandidate to V5ScoredCandidate for prompt compatibility
      // (structurally compatible: both have .profile, .dondeMatch, .factors.*)
      const userPrompt = buildV5UserPrompt(
        special_request,
        occasion,
        neighborhood,
        price_level,
        dietary_restrictions,
        rerankedScored as unknown as Parameters<typeof buildV5UserPrompt>[5],
        topCandidatesWithGoogle as unknown as Parameters<typeof buildV5UserPrompt>[6],
        weightContext,
        intent,
        needsQualityCallout,
        neighborhoodExpanded,
      );

      // Single Claude API call — blurb + potential boost
      const claudeText = await callClaude(userPrompt, systemPrompt);

      // Parse Claude response
      let parsed: ClaudeRecommendation;
      try {
        parsed = parseClaudeJson<ClaudeRecommendation>(claudeText);
      } catch (_parseError) {
        // Regex recovery for malformed JSON
        const recovered = recoverFromMalformedV5(claudeText);
        if (recovered) {
          parsed = recovered;
          logWarn("Claude JSON parse failed, recovered via regex");
        } else {
          throw new Error("Claude returned unparseable response");
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
        // V9: Smart boost — just enough to leapfrog engine #1 by 3 points.
        // Previously up to +35 which inflated scores to 99 artificially.
        // The boost should reflect a *correction*, not a score fabrication.
        const rawBoost = Math.min(20, Math.max(3, parsed.boost_points || 0));
        const baseScore = boostedCandidate.dondeMatch;
        const leapfrogBoost = Math.max(3, engineTopScore - baseScore + 3);
        const boostPoints = Math.min(rawBoost, leapfrogBoost);
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
          logInfo("V9 Intent Boost applied", {
            from: rerankedScored[0].profile.name,
            to: boostedCandidate.profile.name,
            baseScore,
            boostPoints,
            boostedScore,
            reason: intentBoost.reason,
          });
        } else {
          // Boost rejected — use engine's #1
          logInfo("V9 Intent Boost rejected", {
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
      const dondeMatch = chosen.dondeMatch;

      // Get Google data for chosen
      let chosenGoogleData = chosen.googleData || null;
      if (!chosenGoogleData && chosen.profile.google_place_id) {
        chosenGoogleData = await fetchPlaceDetails(chosen.profile.google_place_id);
      }

      // Skip closed restaurants
      if (chosenGoogleData?.business_status === "CLOSED_PERMANENTLY") {
        logWarn("V9: Chosen restaurant permanently closed, picking next", { name: chosen.profile.name });
        const nextIdx = rerankedScored.findIndex((_s, i) => i !== chosenIdx);
        if (nextIdx !== -1) {
          const nextChosen = rerankedScored[nextIdx];
          const nextGoogle = nextChosen.googleData || (nextChosen.profile.google_place_id
            ? await fetchPlaceDetails(nextChosen.profile.google_place_id) : null);

          if (!parsed.insider_tip && nextChosen.profile.insider_tip) {
            parsed.insider_tip = nextChosen.profile.insider_tip;
          }

          const v9Result: V9ScoreResult = {
            dondeMatch: nextChosen.dondeMatch,
            relevance: nextChosen.relevance,
            quality: nextChosen.quality,
            factors: nextChosen.factors,
            qualityWeights: nextChosen.qualityWeights,
            occasionBonus: nextChosen.occasionBonus,
            matchNarrative: nextChosen.matchNarrative,
            dataCompleteness: nextChosen.dataCompleteness,
          };

          responseBody = buildV9SuccessResponse(
            nextChosen.profile, parsed, nextGoogle, nextChosen.dondeMatch,
            v9Result, null, rankedQueue,
            needsQualityCallout, neighborhoodExpanded,
          );
        } else {
          const v9Result: V9ScoreResult = {
            dondeMatch: 55,
            relevance: chosen.relevance,
            quality: chosen.quality,
            factors: chosen.factors,
            qualityWeights: chosen.qualityWeights,
            occasionBonus: chosen.occasionBonus,
            matchNarrative: chosen.matchNarrative,
            dataCompleteness: chosen.dataCompleteness,
          };
          responseBody = buildV9FallbackResponse(
            chosen.profile, chosenGoogleData, 55,
            v9Result, rankedQueue,
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

        const v9Result: V9ScoreResult = {
          dondeMatch,
          relevance: chosen.relevance,
          quality: chosen.quality,
          factors: chosen.factors,
          qualityWeights: chosen.qualityWeights,
          occasionBonus: chosen.occasionBonus,
          matchNarrative: chosen.matchNarrative,
          dataCompleteness: chosen.dataCompleteness,
        };

        responseBody = buildV9SuccessResponse(
          chosen.profile, parsed, chosenGoogleData, dondeMatch,
          v9Result, intentBoost, rankedQueue,
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
      logError("V9 Claude API failed, using fallback", { error: String(claudeError) });

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

        const v9Result: V9ScoreResult = {
          dondeMatch: nextChosen.dondeMatch,
          relevance: nextChosen.relevance,
          quality: nextChosen.quality,
          factors: nextChosen.factors,
          qualityWeights: nextChosen.qualityWeights,
          occasionBonus: nextChosen.occasionBonus,
          matchNarrative: nextChosen.matchNarrative,
          dataCompleteness: nextChosen.dataCompleteness,
        };
        responseBody = buildV9FallbackResponse(
          nextChosen.profile, nextGoogle, nextChosen.dondeMatch, v9Result, rankedQueue,
        );
      } else {
        const v9Result: V9ScoreResult = {
          dondeMatch: chosen.dondeMatch,
          relevance: chosen.relevance,
          quality: chosen.quality,
          factors: chosen.factors,
          qualityWeights: chosen.qualityWeights,
          occasionBonus: chosen.occasionBonus,
          matchNarrative: chosen.matchNarrative,
          dataCompleteness: chosen.dataCompleteness,
        };
        responseBody = buildV9FallbackResponse(
          chosen.profile, chosenGoogleData, chosen.dondeMatch, v9Result, rankedQueue,
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

    // Use service client for reliable logging (anon key lacks RLS INSERT permission)
    const serviceForLog = createServiceClient();
    serviceForLog
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

    logInfo("V9 recommendation served", {
      responseTimeMs,
      occasion, neighborhood, price_level,
      wasFallback,
      excludeCount: exclude.length,
      classificationPath,
      intentBoost: !!(responseBody as Record<string, unknown>).intent_boost,
      candidatePool: rerankedScored.length,
      rankedQueueSize: rankedQueue.length,
      engine: "v10",
    });

    const response = jsonResponse(responseBody);
    response.headers.set("X-API-Version", API_VERSION);
    response.headers.set("X-Engine", "v9");
    return response;
  } catch (error) {
    logError("V9 engine error", { error: String(error) });
    return jsonResponse(buildV9ErrorResponse(error), 500);
  }
});

// V5 Regex recovery for malformed Claude JSON
function recoverFromMalformedV5(text: string): ClaudeRecommendation | null {
  try {
    const indexMatch = text.match(/"restaurant_index"\s*:\s*(\d+)/);
    const recMatch = text.match(/"recommendation"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (indexMatch && recMatch) {
      const headlineMatch = text.match(/"match_headline"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const tipMatch = text.match(/"insider_tip"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const boostMatch = text.match(/"intent_boost"\s*:\s*(true|false)/);
      const boostReasonMatch = text.match(/"boost_reason"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const boostPointsMatch = text.match(/"boost_points"\s*:\s*(\d+)/);
      const sentMatch = text.match(/"sentiment_score"\s*:\s*([\d.]+)/);
      const summaryMatch = text.match(/"sentiment_summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);

      return {
        restaurant_index: parseInt(indexMatch[1]),
        match_headline: headlineMatch ? headlineMatch[1].replace(/\\"/g, '"') : null,
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
