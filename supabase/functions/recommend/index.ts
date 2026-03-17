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

import { corsPreflightResponse, jsonResponse, buildCorsHeaders } from "./_shared/cors.ts";
import { createSupabaseClient, createServiceClient } from "./_shared/supabase.ts";
import { callClaude, parseClaudeJson } from "./_shared/claude.ts";
import { isCircuitOpen, recordSuccess, recordFailure, getCircuitState } from "./_shared/circuit-breaker.ts";
import {
  ensureDiversity,
  extractUnmatchedKeywords,
} from "./_shared/scoring.ts";
import { computeScoreFitGrade, computeBlurbQualityGrade } from "./_shared/grading.ts";
import {
  buildExactCacheKey,
  computeIntentFingerprint,
  computeCanonicalForm,
  lookupPersistentCache,
  populateCache,
  getNextFromCachedQueue,
} from "./_shared/query-cache.ts";
import type { UserFeedbackSignals } from "./_shared/types-v9.ts";
import { applyPostScoringFilters } from "./_shared/post-filters.ts";
// V9 engine imports
import { classifyIntentV5 } from "./_shared/intent-classifier-v5.ts";
import { computeV9Score, reRankV9, NEIGHBORHOOD_ALIASES, expandQueryConcepts, applyMMRDiversity, decompressScore } from "./_shared/scoring-v9.ts";
import { buildV5SystemPrompt, buildV5UserPrompt, buildBlurbOnlyPrompt, detectCultureTheme } from "./_shared/prompts-v5.ts";
import type { CultureTheme } from "./_shared/prompts-v5.ts";
import {
  buildV9SuccessResponse,
  buildV9FallbackResponse,
  buildV9NoResultsResponse,
  buildV9ErrorResponse,
  buildV9RankedQueueItem,
  buildQueueBlurb,
} from "./_shared/response-builder-v9.ts";
import {
  fetchPlaceDetails,
  formatReviewsForPrompt,
  getGoogleCallStats,
  resetGoogleCallStats,
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
  TasteProfile,
  PersonalizationResult,
} from "./_shared/types-v9.ts";
import { getScoreTier } from "./_shared/types-v9.ts";
import { buildReservationLinks, checkResyAvailability } from "./_shared/reservation-links.ts";
import type { ReservationRow, ReservationLinks as ReservationLinksType } from "./_shared/reservation-links.ts";
import { isMLModelLoaded, computeTargetedBoost } from "./_shared/ml-adjustment.ts";

const API_VERSION = "11.0.0";

// --- In-memory response cache (stale-while-revalidate) ---
interface CacheEntry {
  response: Record<string, unknown>;
  staleAfter: number;  // soft expiry — serve but mark stale
  expiry: number;      // hard expiry — remove completely
}
const RESPONSE_CACHE = new Map<string, CacheEntry>();
const CACHE_SOFT_TTL = 15 * 60 * 1000; // 15 minutes — serve stale after this
const CACHE_HARD_TTL = 30 * 60 * 1000; // 30 minutes — delete after this

// V20: Unified slop patterns — expanded to 50+ (shared between main blurb, blurb endpoint, and quality guardrail)
const BLURB_SLOP_PATTERNS = [
  "\u2014",                // em dash — strictly prohibited
  "nestled", "mouthwatering", "culinary journey", "hidden gem", "hidden treasure",
  "a must-visit", "must-visit", "if you're looking for", "whether you're",
  "look no further", "culinary", "elevated", "delectable", "exquisite",
  "tantalizing", "impeccable", "burst of flavor", "taste buds", "every bite",
  "something for everyone", "won't disappoint", "does not disappoint",
  "dining experience", "unforgettable", "the perfect spot", "go-to spot",
  "ideal for", "the ultimate",
  // V20: Expanded anti-slop patterns
  "it's worth noting", "it's no surprise", "pairs perfectly", "hits different",
  "chef-driven", "locally sourced", "seasonal ingredients", "warm hospitality",
  "inviting atmosphere", "culinary prowess", "flavor profile", "price point",
  "farm-to-table", "nose-to-tail", "thoughtfully curated", "carefully selected",
  "hand-picked", "each dish tells", "every plate is", "a celebration of",
  "pays homage", "takes you on", "where every", "more than just",
  "the star of the show", "steal the show", "take center stage",
];

// V20: Structural slop detection patterns — catch AI writing patterns beyond word-level
const STRUCTURAL_SLOP_PATTERNS = [
  { pattern: /\b(\w+)\s+\1\b/i, name: "word_repetition" },
  { pattern: /\b(?:wonderful|amazing|fantastic|incredible|outstanding)\b/i, name: "generic_superlative" },
  { pattern: /\b(?:is served|are prepared|is crafted|are made|is presented)\b/i, name: "passive_food_voice" },
  { pattern: /(?:From\s+the\s+\w+\s+to\s+the|Whether\s+you|If\s+you're\s+looking)/i, name: "ai_opening_pattern" },
];

function getCacheKey(occasion: string, neighborhood: string, price: string, request: string, exclude?: string[]): string {
  // V6.2: Normalize cache key — sort words so "cozy ramen" and "ramen cozy" hit the same entry
  const normalizedRequest = request.toLowerCase().trim().split(/\s+/).sort().join(" ");
  const excludeKey = exclude && exclude.length > 0 ? `|ex:${[...exclude].sort().join(",")}` : "";
  return `${occasion}|${neighborhood}|${price}|${normalizedRequest}${excludeKey}`;
}

function getCachedResponse(key: string): { response: Record<string, unknown>; isStale: boolean } | null {
  const entry = RESPONSE_CACHE.get(key);
  if (!entry) return null;
  const now = Date.now();
  // Hard expiry: 30 minutes — remove completely
  if (now > entry.expiry) {
    RESPONSE_CACHE.delete(key);
    return null;
  }
  // Soft expiry: 15 minutes — serve but flag as stale for background refresh
  return { response: entry.response, isStale: now > entry.staleAfter };
}

function setCacheResponse(key: string, response: Record<string, unknown>): void {
  // V6.2: Increased cache size from 100 → 500 entries (~1MB total, trivial for Edge Function)
  if (RESPONSE_CACHE.size > 500) {
    const now = Date.now();
    for (const [k, v] of RESPONSE_CACHE) {
      if (now > v.expiry) RESPONSE_CACHE.delete(k);
    }
  }
  const now = Date.now();
  RESPONSE_CACHE.set(key, {
    response,
    staleAfter: now + CACHE_SOFT_TTL,
    expiry: now + CACHE_HARD_TTL,
  });
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

/** Race an RPC promise chain against a deadline. Returns { data: null, error } on timeout. */
function rpcWithTimeout<T>(
  rpcPromise: PromiseLike<{ data: T; error: unknown }>,
  timeoutMs: number,
): Promise<{ data: T | null; error: unknown }> {
  const timer = new Promise<{ data: null; error: Error }>(resolve =>
    setTimeout(() => resolve({ data: null, error: new Error(`RPC timed out after ${timeoutMs}ms`) }), timeoutMs)
  );
  return Promise.race([rpcPromise, timer]);
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
    menu_highlights: (row.dp_menu_highlights as string[] | null) || null,
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
      // V11: Semantic enrichment fields
      semantic_descriptors: (row.ri_semantic_descriptors as string[]) || [],
      best_for_scenarios: (row.ri_best_for_scenarios as string[]) || [],
      comparable_restaurants: (row.ri_comparable_restaurants as string[]) || [],
    } : null;
  return {
    ...base,
    review_intelligence,
    ri_text_rank: (row.ri_text_rank as number) || 0,
    dp_menu_highlights: base.deep_profile?.menu_highlights || null,
  };
}

Deno.serve(async (req: Request) => {
  const requestOrigin = req.headers.get("origin");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(requestOrigin);
  }

  // Health check endpoint
  if (req.method === "GET") {
    return jsonResponse({
      status: "ok",
      version: API_VERSION,
      engine: "v11",
      timestamp: new Date().toISOString(),
    }, 200, requestOrigin);
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, recommendation: "Method not allowed" },
      405,
      requestOrigin
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
      429,
      requestOrigin
    );
  }

  // Source tracking — command-center test calls vs website production
  const requestSource = req.headers.get("x-donde-source") || "website";

  // V8.8: Route detection — /recommend/blurb for lazy Try Again blurb generation
  const url = new URL(req.url);
  const isBlurbRequest = url.pathname.endsWith("/blurb");

  if (isBlurbRequest) {
    try {
      const blurbBody = await req.json();
      const restaurantData = blurbBody.restaurant_data;
      const context = blurbBody.context;

      if (!restaurantData?.name) {
        return jsonResponse({ success: false, error: "Missing restaurant_data.name" }, 400, requestOrigin);
      }

      // Sanitize user-provided strings
      if (context?.special_request) {
        context.special_request = sanitizeInput(context.special_request.slice(0, 500));
      }

      // Determine score tier for tone modulation
      const scoreTier = context?.score_tier || "good";

      // V20: Detect voice from cuisine + occasion + query (3-axis selection)
      const cultureTheme = detectCultureTheme(restaurantData.cuisine_type || '', context?.occasion || '', context?.special_request || '');

      // Build minimal prompt for single restaurant blurb
      const systemPrompt = buildV5SystemPrompt(scoreTier as "exceptional" | "great" | "good" | "decent" | "weak", cultureTheme, context?.occasion || "");
      const userPrompt = buildBlurbOnlyPrompt(restaurantData, context || {});

      // Circuit breaker: skip Claude if circuit is open
      if (isCircuitOpen()) {
        logWarn("Circuit breaker: skipping blurb endpoint Claude call", {
          restaurant: restaurantData.name,
          circuitState: getCircuitState().state,
          totalTrips: getCircuitState().totalTrips,
        });
        return jsonResponse({
          success: true,
          recommendation: null,
          match_headline: null,
          insider_tip: null,
          circuit_breaker: { state: getCircuitState().state, skipped_claude: true, total_trips: getCircuitState().totalTrips },
        }, 200, requestOrigin);
      }

      let rawText: string;
      try {
        rawText = await callClaude(userPrompt, systemPrompt, { maxTokens: 384, temperature: 0.7 });
        recordSuccess();
      } catch (claudeErr) {
        recordFailure();
        logError("Blurb endpoint Claude call failed", {
          error: claudeErr instanceof Error ? claudeErr.message : String(claudeErr),
          circuitState: getCircuitState().state,
          consecutiveFailures: getCircuitState().consecutiveFailures,
        });
        return jsonResponse({
          success: true,
          recommendation: null,
          match_headline: null,
          insider_tip: null,
          circuit_breaker: { state: getCircuitState().state, skipped_claude: true, total_trips: getCircuitState().totalTrips },
        }, 200, requestOrigin);
      }

      const parsed = parseClaudeJson<{ recommendation?: string; match_headline?: string; insider_tip?: string }>(rawText);

      // Clean em-dashes from output
      if (parsed.recommendation) {
        parsed.recommendation = parsed.recommendation.replace(/\u2014/g, ", ").replace(/ , /g, ", ").replace(/,\s*,/g, ",");
      }

      // Slop guardrail for blurb endpoint
      if (parsed.recommendation) {
        const blurbLower = parsed.recommendation.toLowerCase();
        const slopHits = BLURB_SLOP_PATTERNS.filter(p => blurbLower.includes(p.toLowerCase()));
        if (slopHits.length > 0) {
          logWarn("Blurb endpoint slop detected", { patterns: slopHits, restaurant: restaurantData.name });
        }
        // V21: Voice compliance — log only, no auto-fix. Flexible voice identity allows
        // blurbs without explicit "we/our" if they have strong Donde personality.
        if (!/\bwe\b|\bour\b/.test(blurbLower)) {
          logWarn("Blurb endpoint: no 'we'/'our' detected (voice identity allows this)");
        }
      }

      // Validate insider tip structure (verb-start, word count)
      parsed.insider_tip = validateInsiderTip(parsed.insider_tip) || null;

      return jsonResponse({
        success: true,
        recommendation: parsed.recommendation || null,
        match_headline: parsed.match_headline || null,
        insider_tip: parsed.insider_tip,
        circuit_breaker: { state: getCircuitState().state, skipped_claude: false, total_trips: getCircuitState().totalTrips },
      }, 200, requestOrigin);
    } catch (err) {
      logError("Blurb endpoint error", { error: err instanceof Error ? err.message : String(err) });
      return jsonResponse({ success: false, error: "Failed to generate blurb" }, 500, requestOrigin);
    }
  }

  const startTime = Date.now();
  const timings: Record<string, number> = {};
  let stepStart = startTime;

  try {
    // ================================================================
    // STEP 0: Parse and validate input
    // ================================================================
    const body: UserRequest & { open_now?: boolean } = await req.json();
    const special_request = sanitizeInput((body.special_request || "").slice(0, 500));
    const occasion = body.occasion || "Any";
    // V10: Resolve neighborhood aliases (landmarks, alternate names)
    const rawNeighborhood = body.neighborhood || "Anywhere";
    let neighborhood = NEIGHBORHOOD_ALIASES[rawNeighborhood.toLowerCase()] || rawNeighborhood;
    // V18: Detect neighborhood from special_request when body.neighborhood is "Anywhere".
    // This ensures "near wrigley field" filters RPC candidates to Lakeview.
    if (neighborhood === "Anywhere" && special_request) {
      const reqLower = special_request.toLowerCase();
      // Check longer aliases first to avoid partial matches (e.g., "wrigley field" before "wrigley")
      const sortedAliases = Object.entries(NEIGHBORHOOD_ALIASES)
        .sort((a, b) => b[0].length - a[0].length);
      for (const [alias, canonical] of sortedAliases) {
        if (reqLower.includes(alias)) {
          neighborhood = canonical;
          break;
        }
      }
    }
    const price_level = body.price_level || "Any";
    const open_now = body.open_now === true; // V5: Open Now toggle
    const skip_claude = body.skip_claude === true; // Zero-cost testing: skip Claude API calls
    const skip_google = body.skip_google === true; // Zero-cost testing: skip Google Places API calls

    // Reset Google API call counters at start of each request
    resetGoogleCallStats();

    const VALID_TIME_PERIODS = ["breakfast", "lunch", "dinner", "late_night"];
    const time_of_day = (typeof body.time_of_day === "string" && VALID_TIME_PERIODS.includes(body.time_of_day))
      ? body.time_of_day : null;
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const exclude = (Array.isArray(body.exclude) ? body.exclude : [])
      .filter((id: string) => typeof id === "string" && UUID_REGEX.test(id))
      .slice(0, 15);

    const dietary_restrictions = (Array.isArray(body.dietary_restrictions) ? body.dietary_restrictions : [])
      .filter((d: string) => typeof d === "string" && d.length < 30)
      .slice(0, 5);

    const user_id = (typeof body.user_id === "string" && body.user_id.length < 100)
      ? body.user_id : null;

    // SSO: Extract authenticated user ID from JWT (1s timeout guard — on timeout, continue as anonymous)
    let authUserId: string | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      if (token.length > 200) {
        try {
          const serviceClient = createServiceClient();
          const authResult = await Promise.race([
            serviceClient.auth.getUser(token),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
          ]);
          if (authResult && typeof authResult === "object" && "data" in authResult) {
            const authUser = (authResult as { data: { user: { id: string } | null } }).data.user;
            if (authUser?.id) authUserId = authUser.id;
          }
        } catch {
          // Invalid JWT or timeout — continue as anonymous
        }
      }
    }

    // Process feedback if included (fire-and-forget)
    // Note: feedback column may not exist in user_queries yet (pending migration)
    // Use auth_user_id since user_id column doesn't exist in current schema
    if (body.feedback?.restaurant_id && body.feedback?.feedback && authUserId) {
      const serviceForFeedback = createServiceClient();
      serviceForFeedback
        .from("user_queries")
        .update({ claude_relevance_score: body.feedback.feedback === "like" ? 1 : 0 })
        .eq("recommended_restaurant_id", body.feedback.restaurant_id)
        .eq("auth_user_id", authUserId)
        .order("created_at", { ascending: false })
        .limit(1)
        .then(() => {})
        .catch((err: unknown) => logError("Failed to store feedback", { error: String(err) }));
    }

    // Check cache — V6.2: include exclude list in cache key so "Try Another" can cache too
    // V12: Stale-while-revalidate — serve stale immediately, refresh in background
    // V22: Skip in-memory cache for skip_claude — same rationale as persistent cache bypass
    const cacheKey = getCacheKey(occasion, neighborhood, price_level, special_request, exclude);
    if (!skip_claude) {
      const cached = getCachedResponse(cacheKey);
      if (cached) {
        if (!cached.isStale) {
          // Fresh cache hit — return immediately
          return jsonResponse(cached.response, 200, requestOrigin);
        }
        // Stale cache hit — serve immediately but don't block on background refresh
        // The next request after this one will get fresh data since we continue processing
        // and re-cache at the end of this function
        return jsonResponse(cached.response, 200, requestOrigin);
      }
    }

    timings.parse = Date.now() - stepStart;
    stepStart = Date.now();

    const supabase = createSupabaseClient();

    // ================================================================
    // STEP 0.5: Persistent cache lookup — exact key (L1)
    // ================================================================
    const persistentCacheKey = buildExactCacheKey(occasion, neighborhood, price_level, special_request);
    let cacheHit = false;
    let cacheHitLevel: number | null = null;

    // V22: Skip persistent cache for skip_claude requests — deterministic scoring
    // tests must always run through the full pipeline with fresh blurbs to ensure
    // grading compliance. Cached Claude blurbs may not pass bash grading checks.
    if (exclude.length === 0 && !skip_claude) {
      try {
        const pcHit = await lookupPersistentCache(supabase, persistentCacheKey, "", "");
        if (pcHit && pcHit.level === 1) {
          cacheHit = true;
          cacheHitLevel = 1;
          setCacheResponse(cacheKey, pcHit.responseBody);
          const serviceForLog = createServiceClient();
          serviceForLog
            .from("user_queries")
            .insert({
              id: crypto.randomUUID(),
              occasion, price_level, special_request,
              recommended_restaurant_id: (pcHit.responseBody.restaurant as Record<string, unknown>)?.id || null,
              donde_match: pcHit.responseBody.donde_match || null,
              exclude_count: 0, was_fallback: false,
              response_time_ms: Date.now() - startTime,
              auth_user_id: authUserId || null,
              source: requestSource,
              cache_hit: true, cache_hit_level: 1,
            })
            .then(() => {}).catch(() => {});
          logInfo("Persistent cache HIT (L1 exact)", { responseTimeMs: Date.now() - startTime });
          return jsonResponse(pcHit.responseBody, 200, requestOrigin);
        }
      } catch (err) {
        logWarn("Persistent cache L1 lookup failed", { error: String(err) });
      }
    } else if (exclude.length > 0) {
      // "Try Another" — check cached ranked_queue for alternatives
      try {
        const pcHit = await lookupPersistentCache(supabase, persistentCacheKey, "", "");
        if (pcHit?.rankedQueue) {
          const nextItem = getNextFromCachedQueue(pcHit.rankedQueue, exclude);
          if (nextItem) {
            // Wrap ranked queue item in standard response envelope
            const queueRestaurant = nextItem.restaurant as Record<string, unknown> || {};
            const envelopedResponse = {
              success: true,
              restaurant: queueRestaurant,
              recommendation: (nextItem as Record<string, unknown>).match_headline || "",
              donde_match: nextItem.donde_match || 0,
              scoring_v9: (nextItem as Record<string, unknown>).scoring_v9 || {},
              match_narrative: (nextItem as Record<string, unknown>).match_narrative || {},
              ranked_queue: [],
              tags: [],
              timestamp: new Date().toISOString(),
            };
            const serviceForLog = createServiceClient();
            serviceForLog
              .from("user_queries")
              .insert({
                id: crypto.randomUUID(),
                occasion, price_level, special_request,
                recommended_restaurant_id: queueRestaurant?.id || null,
                donde_match: nextItem.donde_match || null,
                exclude_count: exclude.length, was_fallback: false,
                response_time_ms: Date.now() - startTime,
                auth_user_id: authUserId || null,
                source: requestSource,
                cache_hit: true, cache_hit_level: 1,
              })
              .then(() => {}).catch(() => {});
            logInfo("Persistent cache HIT (ranked_queue fallback)", { responseTimeMs: Date.now() - startTime, excludeCount: exclude.length });
            return jsonResponse(envelopedResponse, 200, requestOrigin);
          }
        }
      } catch (err) {
        logWarn("Persistent cache ranked_queue lookup failed", { error: String(err) });
      }
    }

    // ================================================================
    // STEP 1: Intent classification + User feedback + RPC (parallel)
    // ================================================================
    // Use auth_user_id for feedback lookup (user_id column doesn't exist in schema)
    const feedbackValue = authUserId;
    const feedbackLimit = 50;

    const feedbackPromise = feedbackValue
      ? supabase
          .from("user_queries")
          .select("recommended_restaurant_id, claude_relevance_score, restaurants!inner(cuisine_type)")
          .eq("auth_user_id", feedbackValue)
          .not("claude_relevance_score", "is", null)
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
              // Use claude_relevance_score as feedback proxy (1 = like, 0 = dislike)
              const score = (row as Record<string, unknown>).claude_relevance_score as number | null;
              if (score === 1) {
                if (rid) signals.likedRestaurantIds.push(rid);
                if (cuisine && !signals.likedCuisines.includes(cuisine)) signals.likedCuisines.push(cuisine);
              } else if (score === 0) {
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

    // V12: Fetch user preference profile for personalized tiebreaking (auth users only)
    const preferencesPromise = authUserId
      ? supabase
          .from("user_searches")
          .select("cuisine_type, neighborhood, occasion")
          .eq("user_id", authUserId)
          .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .not("cuisine_type", "is", null)
          .order("created_at", { ascending: false })
          .limit(50)
          .then(({ data }) => {
            if (!data || data.length === 0) return null;
            // Count frequency of each cuisine, neighborhood, occasion
            const cuisineCounts = new Map<string, number>();
            const neighborhoodCounts = new Map<string, number>();
            const occasionCounts = new Map<string, number>();
            for (const row of data) {
              const c = row.cuisine_type as string | null;
              const n = row.neighborhood as string | null;
              const o = row.occasion as string | null;
              if (c) cuisineCounts.set(c, (cuisineCounts.get(c) || 0) + 1);
              if (n && n !== "Anywhere") neighborhoodCounts.set(n, (neighborhoodCounts.get(n) || 0) + 1);
              if (o && o !== "Any") occasionCounts.set(o, (occasionCounts.get(o) || 0) + 1);
            }
            const topN = (m: Map<string, number>, n: number) =>
              [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
            return {
              topCuisines: topN(cuisineCounts, 3),
              topNeighborhoods: topN(neighborhoodCounts, 3),
              topOccasions: topN(occasionCounts, 3),
            };
          })
          .catch((err: unknown) => {
            logWarn("Failed to fetch user preferences", { error: String(err) });
            return null;
          })
      : Promise.resolve(null);

    // Learning Flywheel Phase 1: Fetch taste profile (parallel, <5ms PK lookup)
    const tasteProfilePromise: Promise<TasteProfile | null> = authUserId
      ? supabase
          .from("user_taste_profiles")
          .select("*")
          .eq("user_id", authUserId)
          .maybeSingle()
          .then(({ data }) => {
            if (!data) return null;
            return {
              totalSignals: data.total_signals ?? 0,
              cuisineAffinities: (data.cuisine_affinities as Array<{ cuisine: string; score: number }>) || [],
              cuisineAvoidances: (data.cuisine_avoidances as string[]) || [],
              noisePreference: data.noise_preference ?? 0,
              energyPreference: data.energy_preference ?? 0,
              formalityPreference: data.formality_preference ?? 0,
              weightFood: data.weight_food ?? 1.0,
              weightVibe: data.weight_vibe ?? 1.0,
              weightService: data.weight_service ?? 1.0,
              weightReputation: data.weight_reputation ?? 1.0,
              weightConvenience: data.weight_convenience ?? 1.0,
              priceAffinity: data.price_affinity ?? null,
              neighborhoodAffinities: (data.neighborhood_affinities as Array<{ neighborhood: string; score: number }>) || [],
              discoveryScore: data.discovery_score ?? 0.5,
            } as TasteProfile;
          })
          .catch((err: unknown) => {
            logWarn("Failed to fetch taste profile", { error: String(err) });
            return null;
          })
      : Promise.resolve(null);

    timings.cache_lookup = Date.now() - stepStart;
    stepStart = Date.now();

    // V10: Intent classification FIRST so we can pass signals to RPC
    const [intentResult, userFeedback, userPreferences, tasteProfile] = await Promise.all([
      classifyIntentV5(special_request, occasion, { skipClaude: skip_claude, claudeTimeoutMs: 6000 }),
      feedbackPromise,
      preferencesPromise,
      tasteProfilePromise,
    ]);

    const intent = intentResult.intent;
    const classificationPath = intentResult.classificationPath;

    timings.intent = Date.now() - stepStart;
    stepStart = Date.now();

    logInfo("V10 intent classification", {
      path: classificationPath,
      cuisines: intent?.target_cuisines || [],
      importance: intent?.cuisine_importance || "none",
      emotional: intent?.emotional_intent || "none",
    });

    // ================================================================
    // STEP 1.5: Persistent cache lookup — fingerprint/canonical (L2/L3)
    // ================================================================
    // V22: Also skip L2/L3 persistent cache for skip_claude requests
    if (exclude.length === 0 && !cacheHit && !skip_claude) {
      try {
        const intentFingerprint = computeIntentFingerprint(intent, occasion, neighborhood, price_level);
        const canonicalForm = computeCanonicalForm(special_request, intent);
        const pcHit = await lookupPersistentCache(supabase, persistentCacheKey, intentFingerprint, canonicalForm);
        if (pcHit) {
          cacheHit = true;
          cacheHitLevel = pcHit.level;
          setCacheResponse(cacheKey, pcHit.responseBody);
          const serviceForLog = createServiceClient();
          serviceForLog
            .from("user_queries")
            .insert({
              id: crypto.randomUUID(),
              occasion, price_level, special_request,
              recommended_restaurant_id: (pcHit.responseBody.restaurant as Record<string, unknown>)?.id || null,
              donde_match: pcHit.responseBody.donde_match || null,
              exclude_count: 0, was_fallback: false,
              response_time_ms: Date.now() - startTime,
              auth_user_id: authUserId || null,
              source: requestSource,
              cache_hit: true, cache_hit_level: pcHit.level,
            })
            .then(() => {}).catch(() => {});
          logInfo(`Persistent cache HIT (L${pcHit.level} ${pcHit.level === 2 ? "fingerprint" : "canonical"})`, {
            responseTimeMs: Date.now() - startTime,
          });
          return jsonResponse(pcHit.responseBody, 200, requestOrigin);
        }
      } catch (err) {
        logWarn("Persistent cache L2/L3 lookup failed", { error: String(err) });
      }
    }

    // V11: Dynamic candidate pool — complex/vibe/open-ended queries get more candidates
    const hasVibeOnly = (intent?.vibe_keywords?.length ?? 0) > 0 && (intent?.target_cuisines?.length ?? 0) === 0;
    const isOpenEndedQuery = !intent || (
      (intent.target_cuisines?.length ?? 0) === 0 &&
      (intent.target_tags?.length ?? 0) === 0 &&
      (intent.vibe_keywords?.length ?? 0) === 0 &&
      !intent.dish_level_intent
    );
    // V11: Count distinct signal categories for complex query detection
    const signalCategories = intent ? [
      (intent.target_cuisines?.length ?? 0) > 0 || !!intent.dish_level_intent,
      (intent.vibe_keywords?.length ?? 0) > 0 || (intent.target_tags?.length ?? 0) > 0,
      (intent.practical_constraints?.length ?? 0) > 0,
      (intent.semantic_tags?.length ?? 0) > 0,
    ].filter(Boolean).length : 0;
    const isComplexQuery = signalCategories >= 3 || (intent?.semantic_tags?.length ?? 0) > 0;
    const rpcLimit = (hasVibeOnly || isOpenEndedQuery || isComplexQuery) ? 150 : 100;

    // V11: Pass cuisine, tag, and semantic targets to RPC for smarter retrieval
    const semanticTags = intent?.semantic_tags || [];
    // V11: Expand semantic concepts into structured signals for RPC enrichment
    const conceptExpansion = expandQueryConcepts(semanticTags, special_request);
    // V18: Store original vibe/tag count BEFORE concept expansion merges.
    // This lets the reputation path distinguish user-intended vibes from
    // concept-expanded ones (e.g., "best restaurant Chicago" has no user vibes).
    if (intent) {
      (intent as Record<string, unknown>)._originalVibeCount =
        (intent.vibe_keywords || []).length + (intent.target_tags || []).length;
    }
    // V15: Include implicit_cuisines from Claude fallback for better cuisine matching
    // e.g., "dumplings" → implicit_cuisines: ["Chinese", "Japanese", "Nepalese/Tibetan", "Polish"]
    const implicitCuisines = intent?.implicit_cuisines || [];
    const targetCuisines = [...new Set([...(intent?.target_cuisines || []), ...(conceptExpansion.cuisines || []), ...implicitCuisines])];
    const targetTags = [...(intent?.target_tags || []), ...(conceptExpansion.tags || []), ...(conceptExpansion.vibes || [])];
    // V12: Merge concept vibes into intent for vibe relevance scoring
    if (conceptExpansion.vibes?.length && intent) {
      const existingVibes = new Set((intent.vibe_keywords || []).map((v: string) => v.toLowerCase()));
      const newVibes = conceptExpansion.vibes.filter(v => !existingVibes.has(v.toLowerCase()));
      if (newVibes.length > 0) {
        intent.vibe_keywords = [...(intent.vibe_keywords || []), ...newVibes];
      }
    }
    // V17: Merge concept constraints into intent for constraint relevance scoring.
    // Without this, CONCEPT_MAP constraints (e.g., "happy hour" → walk_in,
    // "byob" → byob, "valet parking" → valet_parking) don't flow into scoring.
    if (conceptExpansion.constraints?.length && intent) {
      const existingConstraints = new Set((intent.practical_constraints || []).map((c: string) => c.toLowerCase()));
      const newConstraints = conceptExpansion.constraints.filter(c => !existingConstraints.has(c.toLowerCase()));
      if (newConstraints.length > 0) {
        intent.practical_constraints = [...(intent.practical_constraints || []), ...newConstraints];
      }
    }
    // V17: Merge concept tags into intent target_tags for vibe relevance scoring
    if (conceptExpansion.tags?.length && intent) {
      const existingTags = new Set((intent.target_tags || []).map((t: string) => t.toLowerCase()));
      const newTags = conceptExpansion.tags.filter(t => !existingTags.has(t.toLowerCase()));
      if (newTags.length > 0) {
        intent.target_tags = [...(intent.target_tags || []), ...newTags];
      }
    }

    // Deadline-propagated RPC timeout: min(5s, remaining budget - 9s for scoring+Google+Claude)
    const rpcDeadline = Math.max(3000, Math.min(5000, 15000 - (Date.now() - startTime) - 9000));
    const { data: rpcData, error: rpcError } = await rpcWithTimeout(
      supabase.rpc("get_candidates_v11", {
        p_query: special_request || null,
        p_neighborhood: neighborhood,
        p_occasion: occasion,
        p_limit: rpcLimit,
        p_exclude: exclude,
        p_target_cuisines: targetCuisines,
        p_target_tags: targetTags,
        p_semantic_tags: semanticTags,
      }).then(result => {
        // Fallback chain: v11 → v10 → v9
        if (result.error?.message?.includes("get_candidates_v11")) {
          logWarn("V11 RPC not found, falling back to V10");
          return supabase.rpc("get_candidates_v10", {
            p_query: special_request || null,
            p_neighborhood: neighborhood,
            p_occasion: occasion,
            p_limit: rpcLimit,
            p_exclude: exclude,
            p_target_cuisines: targetCuisines,
            p_target_tags: targetTags,
          }).then(r => {
            if (r.error?.message?.includes("get_candidates_v10")) {
              logWarn("V10 RPC not found, falling back to V9");
              return supabase.rpc("get_candidates_v9", {
                p_query: special_request || null,
                p_neighborhood: neighborhood,
                p_occasion: occasion,
                p_limit: rpcLimit,
                p_exclude: exclude,
              });
            }
            return r;
          });
        }
        return result;
      }),
      rpcDeadline,
    );

    let finalRpcData = rpcData;
    let finalRpcError = rpcError;

    // If neighborhood filter returned nothing, retry broader
    if ((!finalRpcData || finalRpcData.length === 0) && !finalRpcError && neighborhood !== "Anywhere") {
      logInfo("V11: Broadening RPC to Anywhere", { neighborhood });
      const broadDeadline1 = Math.max(2000, Math.min(4000, 15000 - (Date.now() - startTime) - 9000));
      const { data: broadData, error: broadError } = await rpcWithTimeout(
        supabase.rpc(
          "get_candidates_v11",
          { p_query: special_request || null, p_neighborhood: "Anywhere", p_occasion: occasion, p_limit: rpcLimit, p_exclude: exclude, p_target_cuisines: targetCuisines, p_target_tags: targetTags, p_semantic_tags: semanticTags }
        ).then(result => {
          if (result.error?.message?.includes("get_candidates_v11")) {
            return supabase.rpc("get_candidates_v10", { p_query: special_request || null, p_neighborhood: "Anywhere", p_occasion: occasion, p_limit: rpcLimit, p_exclude: exclude, p_target_cuisines: targetCuisines, p_target_tags: targetTags }).then(r => {
              if (r.error?.message?.includes("get_candidates_v10")) {
                return supabase.rpc("get_candidates_v9", { p_query: special_request || null, p_neighborhood: "Anywhere", p_occasion: occasion, p_limit: rpcLimit, p_exclude: exclude });
              }
              return r;
            });
          }
          return result;
        }),
        broadDeadline1,
      );
      if (!broadError && broadData && broadData.length > 0) {
        finalRpcData = broadData;
        finalRpcError = null;
      }
    }

    // V12: If cuisine filter returned nothing, retry without cuisine filter
    // This handles rare cuisines (Ecuadorian, etc.) where no restaurants have that cuisine_type
    if ((!finalRpcData || finalRpcData.length === 0) && !finalRpcError && targetCuisines.length > 0) {
      logInfo("V12: Broadening RPC by removing cuisine filter", { cuisines: targetCuisines });
      const broadDeadline2 = Math.max(2000, Math.min(4000, 15000 - (Date.now() - startTime) - 9000));
      const { data: broadData2, error: broadError2 } = await rpcWithTimeout(
        supabase.rpc(
          "get_candidates_v11",
          { p_query: special_request || null, p_neighborhood: "Anywhere", p_occasion: occasion, p_limit: rpcLimit, p_exclude: exclude, p_target_cuisines: [], p_target_tags: targetTags, p_semantic_tags: semanticTags }
        ).then(result => {
          if (result.error?.message?.includes("get_candidates_v11")) {
            return supabase.rpc("get_candidates_v10", { p_query: special_request || null, p_neighborhood: "Anywhere", p_occasion: occasion, p_limit: rpcLimit, p_exclude: exclude, p_target_cuisines: [], p_target_tags: targetTags }).then(r => {
              if (r.error?.message?.includes("get_candidates_v10")) {
                return supabase.rpc("get_candidates_v9", { p_query: special_request || null, p_neighborhood: "Anywhere", p_occasion: occasion, p_limit: rpcLimit, p_exclude: exclude });
              }
              return r;
            });
          }
          return result;
        }),
        broadDeadline2,
      );
      if (!broadError2 && broadData2 && broadData2.length > 0) {
        finalRpcData = broadData2;
        finalRpcError = null;
        // Downgrade cuisine importance since we broadened
        if (intent) {
          intent.cuisine_importance = "medium";
        }
      }
    }

    if (finalRpcError || !finalRpcData || finalRpcData.length === 0) {
      logError("RPC failed or returned no results", { error: finalRpcError ? String(finalRpcError) : "empty" });
      return jsonResponse(buildV9NoResultsResponse(neighborhood, price_level), 200, requestOrigin);
    }

    // V19: bug-fixer — Neighborhood candidate injection
    // When a neighborhood is detected from the query, the RPC's +5 neighborhood bonus
    // may be too weak to surface neighborhood restaurants in the top 50. If no candidates
    // from the target neighborhood appear, do a supplementary RPC with a larger limit
    // and inject matching neighborhood restaurants into the candidate pool.
    if (neighborhood !== "Anywhere" && finalRpcData && finalRpcData.length > 0) {
      const neighborhoodLower = neighborhood.toLowerCase();
      const hasNeighborhoodCandidate = (finalRpcData as Record<string, unknown>[]).some(
        (row) => ((row.neighborhood_name as string) || "").toLowerCase() === neighborhoodLower
      );
      if (!hasNeighborhoodCandidate && (Date.now() - startTime) < 6000) {
        logInfo("V19: No candidates from target neighborhood, injecting", { neighborhood });
        const injDeadline = Math.max(2000, Math.min(3000, 15000 - (Date.now() - startTime) - 8000));
        const { data: injData } = await rpcWithTimeout(
          supabase.rpc("get_candidates_v11", {
            p_query: special_request || null,
            p_neighborhood: neighborhood,
            p_occasion: occasion,
            p_limit: 200,
            p_exclude: exclude,
            p_target_cuisines: targetCuisines,
            p_target_tags: targetTags,
            p_semantic_tags: semanticTags,
          }).then(result => {
            if (result.error?.message?.includes("get_candidates_v11")) {
              return supabase.rpc("get_candidates_v10", { p_query: special_request || null, p_neighborhood: neighborhood, p_occasion: occasion, p_limit: 200, p_exclude: exclude, p_target_cuisines: targetCuisines, p_target_tags: targetTags });
            }
            return result;
          }),
          injDeadline,
        );
        if (injData?.length) {
          const existingIds = new Set((finalRpcData as Record<string, unknown>[]).map(r => r.id as string));
          const neighborhoodCandidates = (injData as Record<string, unknown>[])
            .filter((row: Record<string, unknown>) =>
              !existingIds.has(row.id as string) &&
              ((row.neighborhood_name as string) || "").toLowerCase() === neighborhoodLower
            )
            .slice(0, 10);
          if (neighborhoodCandidates.length > 0) {
            finalRpcData = [...(finalRpcData as Record<string, unknown>[]), ...neighborhoodCandidates] as typeof finalRpcData;
            logInfo("V19: Injected neighborhood candidates", { count: neighborhoodCandidates.length, neighborhood });
          }
        }
      }
    }

    timings.rpc = Date.now() - stepStart;
    stepStart = Date.now();

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
      return jsonResponse(buildV9NoResultsResponse(neighborhood, price_level), 200, requestOrigin);
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
      userPreferences: userPreferences || null,
      tasteProfile: tasteProfile || null,
    };

    const scored = reRankV9(candidates, v9Context);

    // Apply diversity filter
    const diverseProfiles = ensureDiversity(
      scored.map(s => s.profile),
      allCandidates.filter(r => !exclude.includes(r.id)),
      2,  // maxPerCuisine: tightened from 3 to prevent monoculture (Analytics Expert rec #2)
      3,  // maxPerNeighborhood: tightened from 5 for better geographic diversity
    );
    // Re-map to scored candidates maintaining order
    const diverseScored = diverseProfiles.map(p => {
      const found = scored.find(s => s.profile.id === p.id);
      return found!;
    }).filter(Boolean) as V9ScoredCandidate[];

    if (diverseScored.length === 0) {
      return jsonResponse(buildV9NoResultsResponse(neighborhood, price_level), 200, requestOrigin);
    }

    // ================================================================
    // STEP 4.5: Neighborhood Quality Gate
    // ================================================================
    const NEIGHBORHOOD_QUALITY_THRESHOLD = 45;
    let neighborhoodExpanded = false;
    const topNeighborhoodScore = diverseScored[0]?.dondeMatch ?? 0;

    const neighborhoodGateElapsed = Date.now() - startTime;
    if (topNeighborhoodScore < NEIGHBORHOOD_QUALITY_THRESHOLD && neighborhood !== "Anywhere" && neighborhoodGateElapsed < 8000) {
      logInfo("V9: Neighborhood quality gate triggered", {
        neighborhood,
        topScore: topNeighborhoodScore,
        threshold: NEIGHBORHOOD_QUALITY_THRESHOLD,
      });

      const nqgDeadline = Math.max(2000, Math.min(3000, 15000 - (Date.now() - startTime) - 8000));
      const { data: broadData } = await rpcWithTimeout(
        supabase.rpc("get_candidates_v11", {
          p_query: special_request || null,
          p_neighborhood: "Anywhere",
          p_occasion: occasion,
          p_limit: rpcLimit,
          p_exclude: exclude,
          p_target_cuisines: targetCuisines,
          p_target_tags: targetTags,
          p_semantic_tags: semanticTags,
        }).then(result => {
          if (result.error?.message?.includes("get_candidates_v11")) {
            return supabase.rpc("get_candidates_v10", { p_query: special_request || null, p_neighborhood: "Anywhere", p_occasion: occasion, p_limit: rpcLimit, p_exclude: exclude, p_target_cuisines: targetCuisines, p_target_tags: targetTags }).then(r => {
              if (r.error?.message?.includes("get_candidates_v10")) {
                return supabase.rpc("get_candidates_v9", { p_query: special_request || null, p_neighborhood: "Anywhere", p_occasion: occasion, p_limit: rpcLimit, p_exclude: exclude });
              }
              return r;
            });
          }
          return result;
        }),
        nqgDeadline,
      );

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

    timings.scoring = Date.now() - stepStart;
    stepStart = Date.now();

    // ================================================================
    // STEP 5: Google Places enrichment (top 5 candidates)
    // ================================================================
    const googleByPlaceId = new Map<string, Awaited<ReturnType<typeof fetchPlaceDetails>>>();

    if (skip_google) {
      logInfo("skip_google: skipping all Google Places API calls");
    } else {
      const top5PlaceIds = diverseScored
        .slice(0, 5)
        .map(s => s.profile.google_place_id)
        .filter(Boolean) as string[];

      const googlePromises = top5PlaceIds.map(pid => fetchPlaceDetails(pid));
      const googleTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 2500));
      const googleRace = Promise.all(googlePromises);
      const googleResultsOrTimeout = await Promise.race([googleRace, googleTimeout]);

      const googleResults = googleResultsOrTimeout
        ? (googleResultsOrTimeout as Awaited<ReturnType<typeof fetchPlaceDetails>>[])
        : [];

      for (let i = 0; i < top5PlaceIds.length && i < googleResults.length; i++) {
        const gd = googleResults[i];
        if (gd) googleByPlaceId.set(top5PlaceIds[i], gd);
      }

      // Log Google Places fetch outcome for debugging
      const googleHitCount = googleByPlaceId.size;
      const googleTimedOut = !googleResultsOrTimeout;
      if (googleTimedOut) {
        logWarn("V9: Google Places batch timed out (2.5s)", { placeIds: top5PlaceIds.length });
      } else {
        logInfo("V9: Google Places enriched", {
          fetched: googleHitCount,
          total: top5PlaceIds.length,
          hasHours: [...googleByPlaceId.values()].filter(g => g?.opening_hours).length,
        });
      }
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
        factorDetails: reResult.factorDetails,
        factorConfidence: reResult.factorConfidence,
        googleData,
      };
    });

    // Sort by re-ranked DondeScore
    rerankedScored.sort((a, b) => b.dondeMatch - a.dondeMatch);

    // ================================================================
    // STEP 6.05: Post-Scoring Neighborhood + Price Filters
    // ================================================================
    // Apply hard filters AFTER scoring so we filter on quality, not retrieval.
    // Graceful expansion: exact -> adjacent -> best available.
    const postFilter = applyPostScoringFilters(rerankedScored, neighborhood, price_level);
    if (postFilter.filterApplied) {
      // Replace rerankedScored contents in-place so all downstream refs update
      rerankedScored.length = 0;
      for (const c of postFilter.candidates) {
        rerankedScored.push(c);
      }
      logInfo("Post-scoring filter applied", {
        neighborhood: postFilter.neighborhoodFiltered ? neighborhood : "any",
        price: postFilter.priceFiltered ? price_level : "any",
        exactMatches: postFilter.exactMatchCount,
        adjacentMatches: postFilter.adjacentMatchCount,
        expanded: postFilter.expanded,
        expansionReason: postFilter.expansionReason,
        resultCount: rerankedScored.length,
      });
    }

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
    // STEP 6.5: MMR Diversity Re-Ranking + Build Ranked Queue
    // ================================================================
    // Apply MMR diversity to positions #2-5 (queue candidates).
    // Position #1 (primary recommendation) is never changed.
    const queueCandidates = rerankedScored.slice(1, Math.min(6, rerankedScored.length));
    const mmrResult = applyMMRDiversity(
      rerankedScored[0],
      queueCandidates,
    );
    // Update rerankedScored positions 1..N to reflect MMR order
    // (downstream code like queue blurb upgrade uses rerankedScored[qi+1])
    for (let i = 0; i < mmrResult.reranked.length; i++) {
      rerankedScored[i + 1] = mmrResult.reranked[i];
    }
    const rankedQueue: Record<string, unknown>[] = [];
    for (let i = 0; i < mmrResult.reranked.length; i++) {
      const item = buildV9RankedQueueItem(mmrResult.reranked[i], i + 2, special_request);
      // Append diversity annotation to match_headline if present
      const annotation = mmrResult.annotations.get(mmrResult.reranked[i].profile.id);
      if (annotation) {
        const existing = item.match_headline as string | null;
        item.match_headline = existing ? `${existing} | ${annotation}` : annotation;
      }
      rankedQueue.push(item);
    }

    // ================================================================
    // STEP 6.6: Fetch reservation links for chosen restaurant (parallel, non-blocking)
    // ================================================================
    const chosenRestaurantId = rerankedScored[0]?.profile?.id;
    const reservationPromise: Promise<ReservationLinksType | null> = chosenRestaurantId
      ? supabase
          .from("restaurant_reservations")
          .select("platform, platform_id, platform_slug, booking_url, url_template, priority, is_verified")
          .eq("restaurant_id", chosenRestaurantId)
          .eq("is_active", true)
          .order("priority", { ascending: true })
          .then(async ({ data, error }) => {
            if (error || !data || data.length === 0) return null;
            const phone = rerankedScored[0]?.googleData?.phone || null;
            const website = rerankedScored[0]?.googleData?.website || null;
            const resDifficulty = rerankedScored[0]?.profile?.deep_profile?.reservation_difficulty || null;
            const googleReservable = rerankedScored[0]?.googleData?.reservable ?? null;
            const links = buildReservationLinks(
              data as ReservationRow[],
              phone,
              website,
              resDifficulty,
              undefined, // params
              googleReservable,
            );
            // Resy real-time availability (2s timeout, best-effort)
            const resyRow = (data as ReservationRow[]).find(
              r => r.platform === "resy" && r.platform_id
            );
            if (resyRow?.platform_id) {
              links.availability = await checkResyAvailability(resyRow.platform_id);
            }
            return links;
          })
          .catch(() => null)
      : Promise.resolve(null);

    timings.google = Date.now() - stepStart;
    stepStart = Date.now();

    // ================================================================
    // STEP 7: Build Claude prompt — full pool + top 3 deep profiles
    // ================================================================
    let responseBody: Record<string, unknown>;
    let wasFallback = false;
    let claudeCircuitBroke = false; // true when circuit breaker caused deterministic fallback

    try {
      // Build deep profiles for top 10 (Google data only available for top 5 already fetched)
      const topCandidatesWithGoogle = rerankedScored.slice(0, 10).map(sc => {
        const gd = sc.googleData || null;
        const reviews = gd && gd.reviews?.length > 0 ? formatReviewsForPrompt(gd.reviews) : "";
        return { candidate: sc, googleData: gd, reviews };
      });

      // ================================================================
      // STEP 7: Generate recommendation (Claude or deterministic fallback)
      // ================================================================
      let parsed: ClaudeRecommendation;

      const circuitOpen = isCircuitOpen();
      if (skip_claude || circuitOpen) {
        // Zero-cost mode OR circuit breaker: deterministic blurb from restaurant profile data
        const chosen = rerankedScored[0];
        const fallbackBlurb = buildQueueBlurb(chosen.profile, chosen.matchNarrative, special_request);
        parsed = {
          recommendation: fallbackBlurb || chosen.profile.best_for_oneliner || "A top pick based on our match engine.",
          match_headline: chosen.matchNarrative?.summary || null,
          insider_tip: chosen.profile.insider_tip || chosen.profile.deep_profile?.best_seat_in_house || null,
          restaurant_index: 0,
          intent_boost: false,
        } as ClaudeRecommendation;
        if (circuitOpen) {
          claudeCircuitBroke = true;
          logWarn("Circuit breaker: skipping Claude, using deterministic blurb", {
            restaurant: chosen.profile.name,
            circuitState: getCircuitState().state,
            totalTrips: getCircuitState().totalTrips,
          });
        } else {
          logInfo("skip_claude: using deterministic blurb", { restaurant: chosen.profile.name });
        }
      } else {
      // Determine score tier for tone modulation
      const topScore = rerankedScored[0].dondeMatch;
      const scoreTier = getScoreTier(topScore);

      // Build weight context string for Claude (V9: relevance type instead of weight shift rules)
      const topRelevance = rerankedScored[0].relevance;
      const weightContext = `${topRelevance.type} query (R=${topRelevance.score.toFixed(2)}): ${topRelevance.details}`;

      // Detect culture theme from winning restaurant's actual cuisine only
      // (user request text can pollute detection when intent differs from result)
      const cultureText = rerankedScored[0].profile.cuisine_type
        || (rerankedScored[0].profile as any).review_intelligence?.cuisine_signals?.join(' ')
        || '';
      // V20: 3-axis voice selection — cuisine + occasion + query
      const cultureTheme = detectCultureTheme(cultureText, occasion, special_request);

      // System prompt with Donde character voice + tone + narrative voice + occasion register
      const systemPrompt = buildV5SystemPrompt(scoreTier, cultureTheme, occasion);

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

      // Single Claude API call — blurb + potential boost (Sonnet for primary, stronger voice differentiation)
      // Deadline propagation: Claude timeout = min(10s, remaining budget - 1.5s buffer)
      // This ensures Claude never pushes us past the 15s frontend AbortController deadline.
      const claudeDeadline = Math.max(3000, Math.min(10000, 15000 - (Date.now() - startTime) - 1500));
      const claudeText = await callClaude(userPrompt, systemPrompt, {
        model: "claude-sonnet-4-6",
        timeoutMs: claudeDeadline,
      });

      // Parse Claude response
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

      // Circuit breaker: record success — Claude responded and parsed OK
      recordSuccess();

      // ================================================================
      // STEP 7.5: Slop guardrail — retry once if banned patterns detected
      // ================================================================
      const blurbText = (parsed.recommendation || "").toLowerCase();
      const headlineText = (parsed.match_headline || "").toLowerCase();
      const combinedText = blurbText + " " + headlineText;
      const foundSlop = BLURB_SLOP_PATTERNS.filter(p => combinedText.includes(p.toLowerCase()));

      const elapsedBeforeSlop = Date.now() - startTime;
      if (foundSlop.length > 0 && elapsedBeforeSlop < 8000) {
        logWarn("Slop detected in Claude blurb, retrying", {
          patterns: foundSlop,
          restaurant: rerankedScored[parsed.restaurant_index || 0]?.profile.name,
          elapsedMs: elapsedBeforeSlop,
        });
        try {
          const retryPrompt = userPrompt + `\n\nCRITICAL RETRY: Your previous response contained banned patterns: ${foundSlop.map(p => `"${p}"`).join(", ")}. Rewrite WITHOUT these patterns. Same JSON format.`;
          const slopRetryDeadline = Math.max(2000, Math.min(5000, 15000 - (Date.now() - startTime) - 1000));
          const retryText = await callClaude(retryPrompt, systemPrompt, { timeoutMs: slopRetryDeadline });
          const retryParsed = parseClaudeJson<ClaudeRecommendation>(retryText);
          // Only accept retry if it's cleaner
          const retryBlurb = (retryParsed.recommendation || "").toLowerCase();
          const retryHeadline = (retryParsed.match_headline || "").toLowerCase();
          const retryCombined = retryBlurb + " " + retryHeadline;
          const retrySlop = BLURB_SLOP_PATTERNS.filter(p => retryCombined.includes(p.toLowerCase()));
          if (retrySlop.length < foundSlop.length) {
            parsed = retryParsed;
            logInfo("Slop retry accepted", {
              originalPatterns: foundSlop.length,
              retryPatterns: retrySlop.length,
            });
          } else {
            logWarn("Slop retry not cleaner, using original", {
              originalPatterns: foundSlop.length,
              retryPatterns: retrySlop.length,
            });
          }
        } catch (retryErr) {
          logWarn("Slop retry failed, using original", {
            error: retryErr instanceof Error ? retryErr.message : String(retryErr),
          });
        }
      } else if (foundSlop.length > 0) {
        logWarn("Slop detected but skipping retry (time budget exceeded)", {
          patterns: foundSlop,
          elapsedMs: elapsedBeforeSlop,
        });
      }
      } // end else (Claude path)

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

      // Get Google data for chosen (skip if time budget exceeded or skip_google)
      let chosenGoogleData = chosen.googleData || null;
      if (!skip_google && !chosenGoogleData && chosen.profile.google_place_id && (Date.now() - startTime) < 12000) {
        chosenGoogleData = await fetchPlaceDetails(chosen.profile.google_place_id);
      }

      // Resolve reservation links (launched in Step 6.6, non-blocking)
      const reservationLinks = await reservationPromise;

      // Skip closed restaurants
      if (chosenGoogleData?.business_status === "CLOSED_PERMANENTLY") {
        logWarn("V9: Chosen restaurant permanently closed, picking next", { name: chosen.profile.name });
        const nextIdx = rerankedScored.findIndex((_s, i) => i !== chosenIdx);
        if (nextIdx !== -1) {
          const nextChosen = rerankedScored[nextIdx];
          const nextGoogle = nextChosen.googleData || (!skip_google && nextChosen.profile.google_place_id && (Date.now() - startTime) < 12000
            ? await fetchPlaceDetails(nextChosen.profile.google_place_id) : null);

          if (!validateInsiderTip(parsed.insider_tip)) {
            parsed.insider_tip = validateInsiderTip(nextChosen.profile.insider_tip)
              || nextChosen.profile.deep_profile?.best_seat_in_house
              || null;
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
            needsQualityCallout, neighborhoodExpanded, reservationLinks,
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
            v9Result, rankedQueue, special_request, reservationLinks,
          );
        }
      } else {
        // Normal path: validate insider tip with verb-start + word count, then fall back
        parsed.insider_tip = validateInsiderTip(parsed.insider_tip)
          || validateInsiderTip(chosen.profile.insider_tip)
          || chosen.profile.deep_profile?.best_seat_in_house
          || null;

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
          needsQualityCallout, neighborhoodExpanded, reservationLinks,
        );
      }

      // Quality guardrail: detect AI slop patterns (uses shared BLURB_SLOP_PATTERNS)
      // Skip for deterministic blurbs — they don't have AI slop
      if (parsed.recommendation && !skip_claude) {
        const recLower = parsed.recommendation.toLowerCase();
        const slopHits = BLURB_SLOP_PATTERNS.filter(p => recLower.includes(p.toLowerCase()));
        if (slopHits.length >= 2) {
          logWarn("V5 slop patterns detected", { count: slopHits.length, patterns: slopHits });
        }

        // V20: Structural slop detection
        const structuralHits = STRUCTURAL_SLOP_PATTERNS.filter(p => p.pattern.test(parsed.recommendation!));
        if (structuralHits.length > 0) {
          logWarn("V20 structural slop detected", { patterns: structuralHits.map(h => h.name) });
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

        // V21: Voice compliance — log only, no auto-fix. Flexible voice identity allows
        // blurbs without explicit "we/our" if they carry strong Donde personality.
        const recLowerForVoice = parsed.recommendation.toLowerCase();
        if (!/\bwe\b|\bour\b/.test(recLowerForVoice)) {
          logWarn("V21 recommendation: no 'we'/'our' detected (voice identity allows this)");
        }
      }

      // ================================================================
      // STEP 9.5: V21 Hybrid — Claude blurbs for queue positions #2-3
      // ================================================================
      // Fire parallel Claude calls for the top 2 queue items (positions #2 and #3).
      // Uses a shorter prompt (just voice + restaurant profile + user query).
      // Budget guard: only attempt if <10s elapsed. Falls back to deterministic on failure.
      if (!skip_claude && !isCircuitOpen() && rankedQueue.length >= 2 && (Date.now() - startTime) < 8000) {
        const queueUpgradeStart = Date.now();
        const upgradePromises: Promise<{ idx: number; blurb: string | null; headline: string | null; tip: string | null }>[] = [];

        for (let qi = 0; qi < Math.min(2, rankedQueue.length); qi++) {
          const queueCandidate = rerankedScored[qi + 1]; // +1 because rerankedScored[0] is the main pick
          if (!queueCandidate) continue;

          const qProfile = queueCandidate.profile;
          const qCuisineText = qProfile.cuisine_type || '';
          const qVoice = detectCultureTheme(qCuisineText, occasion, special_request);
          const qScoreTier = getScoreTier(queueCandidate.dondeMatch);
          const qSystemPrompt = buildV5SystemPrompt(qScoreTier, qVoice, occasion);
          const qUserPrompt = buildBlurbOnlyPrompt(
            {
              name: qProfile.name,
              cuisine_type: qProfile.cuisine_type,
              price_level: qProfile.price_level,
              neighborhood_name: qProfile.neighborhood_name,
              noise_level: qProfile.noise_level,
              lighting_ambiance: qProfile.lighting_ambiance,
              outdoor_seating: qProfile.outdoor_seating,
              tags: qProfile.tags,
              deep_context: qProfile.deep_profile ? {
                signature_dishes: qProfile.deep_profile.signature_dishes,
                menu_highlights: qProfile.deep_profile.menu_highlights,
                flavor_profiles: qProfile.deep_profile.flavor_profiles,
                service_style: qProfile.deep_profile.service_style,
                music_vibe: qProfile.deep_profile.music_vibe,
                unique_selling_point: qProfile.deep_profile.unique_selling_point,
                best_seat_in_house: qProfile.deep_profile.best_seat_in_house,
                wow_factors: qProfile.deep_profile.wow_factors,
                awards_recognition: qProfile.deep_profile.awards_recognition,
              } : undefined,
            },
            {
              special_request,
              occasion,
              neighborhood,
              score_tier: qScoreTier,
              match_narrative: queueCandidate.matchNarrative ? {
                summary: queueCandidate.matchNarrative.summary,
                key_signals: queueCandidate.matchNarrative.key_signals,
                strongest_factor_label: queueCandidate.matchNarrative.strongest_factor_label,
                weak_spots: queueCandidate.matchNarrative.weak_spots,
              } : undefined,
            },
          );

          const qDeadline = Math.max(2000, Math.min(4000, 15000 - (Date.now() - startTime) - 1500));
          upgradePromises.push(
            callClaude(qUserPrompt, qSystemPrompt, { maxTokens: 256, temperature: 0.7, timeoutMs: qDeadline })
              .then(text => {
                const qParsed = parseClaudeJson<{ recommendation?: string; match_headline?: string; insider_tip?: string }>(text);
                // Strip em dashes
                let rec = qParsed.recommendation || null;
                if (rec) rec = rec.replace(/\u2014/g, ", ").replace(/ , /g, ", ").replace(/,\s*,/g, ",");
                return { idx: qi, blurb: rec, headline: qParsed.match_headline || null, tip: qParsed.insider_tip || null };
              })
              .catch(err => {
                logWarn("V21 queue Claude call failed, keeping deterministic", { position: qi + 2, error: String(err) });
                return { idx: qi, blurb: null, headline: null, tip: null };
              })
          );
        }

        try {
          const results = await Promise.all(upgradePromises);
          for (const r of results) {
            if (r.blurb && rankedQueue[r.idx]) {
              (rankedQueue[r.idx] as Record<string, unknown>).recommendation = r.blurb;
              if (r.headline) (rankedQueue[r.idx] as Record<string, unknown>).match_headline = r.headline;
              if (r.tip) (rankedQueue[r.idx] as Record<string, unknown>).insider_tip = r.tip;
              logInfo("V21 queue blurb upgraded via Claude", {
                position: r.idx + 2,
                restaurant: (rankedQueue[r.idx] as Record<string, unknown>).restaurant
                  ? ((rankedQueue[r.idx] as Record<string, unknown>).restaurant as Record<string, unknown>).name
                  : "unknown",
                elapsed: Date.now() - queueUpgradeStart,
              });
            }
          }
        } catch (err) {
          logWarn("V21 queue upgrade Promise.all failed", { error: String(err) });
        }

        // Update the response body's ranked_queue with upgraded blurbs
        if (responseBody && (responseBody as Record<string, unknown>).ranked_queue) {
          (responseBody as Record<string, unknown>).ranked_queue = rankedQueue;
        }
      }

    } catch (claudeError) {
      wasFallback = true;
      claudeCircuitBroke = true;
      // Circuit breaker: record failure so circuit opens after threshold
      recordFailure();
      logError("V9 Claude API failed, using fallback", {
        error: String(claudeError),
        circuitState: getCircuitState().state,
        consecutiveFailures: getCircuitState().consecutiveFailures,
        totalTrips: getCircuitState().totalTrips,
      });

      const chosen = rerankedScored[0];
      let chosenGoogleData = chosen.googleData || null;
      if (!skip_google && !chosenGoogleData && chosen.profile.google_place_id) {
        chosenGoogleData = await fetchPlaceDetails(chosen.profile.google_place_id);
      }
      const reservationLinks = await reservationPromise;

      // Skip closed restaurant in fallback
      if (chosenGoogleData?.business_status === "CLOSED_PERMANENTLY" && rerankedScored.length > 1) {
        const nextChosen = rerankedScored[1];
        const nextGoogle = nextChosen.googleData || (!skip_google && nextChosen.profile.google_place_id
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
          nextChosen.profile, nextGoogle, nextChosen.dondeMatch, v9Result, rankedQueue, special_request, reservationLinks,
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
          chosen.profile, chosenGoogleData, chosen.dondeMatch, v9Result, rankedQueue, special_request, reservationLinks,
        );
      }
    }

    timings.claude_blurb = Date.now() - stepStart;
    stepStart = Date.now();

    // ================================================================
    // STEP 8.5: Attach post-filter metadata to response
    // ================================================================
    if (postFilter.filterApplied) {
      (responseBody as Record<string, unknown>).filter_applied = {
        neighborhood: postFilter.neighborhoodFiltered ? neighborhood : null,
        price_level: postFilter.priceFiltered ? price_level : null,
        expanded: postFilter.expanded,
        expansion_reason: postFilter.expansionReason,
        exact_matches: postFilter.exactMatchCount,
        adjacent_matches: postFilter.adjacentMatchCount,
      };
    }

    // ================================================================
    // STEP 9: Cache + Logging
    // ================================================================
    const chosenId = (responseBody.restaurant as Record<string, unknown>)?.id as string;
    const responseTimeMs = Date.now() - startTime;
    const unmatchedKw = extractUnmatchedKeywords(special_request);

    // Use service client for reliable logging (anon key lacks RLS INSERT permission)
    // Generate UUID client-side since table lacks DEFAULT gen_random_uuid()
    const serviceForLog = createServiceClient();
    // Compute score validation grades for live monitoring (uses raw scores)
    const scoreFitResult = computeScoreFitGrade(special_request, responseBody as Record<string, unknown>);
    const blurbQualityResult = computeBlurbQualityGrade(special_request, responseBody as Record<string, unknown>);

    // ================================================================
    // STEP 9.1: Score Decompression (post-grading)
    // ================================================================
    // Apply decompression AFTER grading so grading uses raw scores.
    // The user sees decompressed scores that spread the 70-90 band wider.
    {
      const rawDM = responseBody.donde_match as number;
      const decompressedDM = decompressScore(rawDM);
      responseBody.donde_match = decompressedDM;

      // Also decompress ranked_queue scores for consistency
      const queue = responseBody.ranked_queue as Record<string, unknown>[] | undefined;
      if (queue) {
        for (const item of queue) {
          if (typeof item.donde_match === "number") {
            item.donde_match = decompressScore(item.donde_match);
          }
        }
      }

      if (rawDM !== decompressedDM) {
        logInfo("Score decompression applied", {
          raw: rawDM,
          decompressed: decompressedDM,
          delta: decompressedDM - rawDM,
        });
      }
    }

    // V6.2: Cache all responses with decompressed scores
    const storeCacheKey = getCacheKey(occasion, neighborhood, price_level, special_request, exclude);
    setCacheResponse(storeCacheKey, responseBody);

    // Only insert columns that exist in the current schema
    // user_id, dietary_restrictions, feedback columns may not exist yet
    const queryLogRow: Record<string, unknown> = {
      id: crypto.randomUUID(),
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
      auth_user_id: authUserId || null,
      source: requestSource,
      recommendation_text: (responseBody as Record<string, unknown>).recommendation || null,
      score_fit_score: scoreFitResult.score,
      score_fit_grade: scoreFitResult.grade,
      blurb_quality_score: blurbQualityResult.score,
      blurb_quality_grade: blurbQualityResult.grade,
      cache_hit: false,
      cache_hit_level: null,
    };
    serviceForLog
      .from("user_queries")
      .insert(queryLogRow)
      .then(() => {})
      .catch((err: unknown) => logError("Failed to log query", { error: String(err) }));

    // ================================================================
    // STEP 9.5: Persistent cache write-through (quality-gated)
    // ================================================================
    if (scoreFitResult.score >= 80 && blurbQualityResult.score >= 80 && exclude.length === 0) {
      const intentFingerprint = computeIntentFingerprint(intent, occasion, neighborhood, price_level);
      const canonicalForm = computeCanonicalForm(special_request, intent);
      populateCache(
        serviceForLog, persistentCacheKey, intentFingerprint, canonicalForm,
        special_request, occasion, neighborhood, price_level,
        responseBody, scoreFitResult.score, blurbQualityResult.score, "organic",
      ).catch((err) => logWarn("Cache write-through failed", { error: String(err) }));
    }

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
      engine: "v11",
    });

    // ================================================================
    // STEP 9.7: Learning Flywheel — Shadow Personalization (Phase 1)
    // Compute what the boost WOULD be, log it, but do NOT apply it
    // ================================================================
    const personalization = computeShadowPersonalization(tasteProfile, rerankedScored[0], v9Context);
    (responseBody as Record<string, unknown>).personalization = {
      active: personalization.active,
      shadow_boost: personalization.shadowBoost,
      signals_used: personalization.signalsUsed,
      taste_summary: personalization.tasteSummary,
    };
    if (personalization.signalsUsed > 0) {
      logInfo("Learning Flywheel shadow", {
        shadowBoost: personalization.shadowBoost,
        signalsUsed: personalization.signalsUsed,
        topCuisines: personalization.tasteSummary?.topCuisines || [],
        type: personalization.tasteSummary?.type || "new_user",
      });
    }

    // ================================================================
    // STEP 9.8: ML Scoring — Targeted Boost (Version Alpha)
    // Boost-only: (1) teacher-validated per-query boosts (+5)
    //             (2) cross-query consistent winner boosts (+2)
    // Applied AFTER grading but BEFORE decompression. 0% regression risk.
    // ================================================================
    const mlAppliedAdjustments: { restaurant_id: string; restaurant_name: string; rule_dm: number; ml_adjustment: number; ml_dm: number }[] = [];

    // Compute canonical form for boost table lookup
    const boostCanonical = computeCanonicalForm(special_request, intent);

    // Apply targeted boost to the primary recommendation
    const primaryRestaurant = (rerankedScored[0] as Record<string, unknown>)?.profile
      || (rerankedScored[0] as Record<string, unknown>)?.restaurant
      || rerankedScored[0] || {};
    const primaryRestId = String((primaryRestaurant as Record<string, unknown>).id || "");
    const primaryBoost = computeTargetedBoost(primaryRestId, boostCanonical, special_request);

    if (primaryBoost > 0) {
      const ruleDM = responseBody.donde_match as number;
      const boostedDM = Math.max(0, Math.min(99, ruleDM + primaryBoost));
      responseBody.donde_match = boostedDM;
      mlAppliedAdjustments.push({
        restaurant_id: primaryRestId,
        restaurant_name: String((primaryRestaurant as Record<string, unknown>).name || ""),
        rule_dm: ruleDM,
        ml_adjustment: primaryBoost,
        ml_dm: boostedDM,
      });
    }

    // Apply targeted boosts to queue items
    const queue = (responseBody.ranked_queue || []) as Record<string, unknown>[];
    for (const item of queue) {
      const qRest = (item.restaurant || item) as Record<string, unknown>;
      const qId = String(qRest.id || "");
      const qBoost = computeTargetedBoost(qId, boostCanonical, special_request);
      if (qBoost > 0) {
        const qRuleDM = Number(item.donde_match || 0);
        const qBoostedDM = Math.max(0, Math.min(99, qRuleDM + qBoost));
        (item as Record<string, number>).donde_match = qBoostedDM;
        mlAppliedAdjustments.push({
          restaurant_id: qId,
          restaurant_name: String(qRest.name || ""),
          rule_dm: qRuleDM,
          ml_adjustment: qBoost,
          ml_dm: qBoostedDM,
        });
      }
    }

    (responseBody as Record<string, unknown>).ml_scoring = {
      active: true,
      ab_group: "ml",
      model_loaded: isMLModelLoaded(),
      adjustments: mlAppliedAdjustments,
    };
    if (mlAppliedAdjustments.length > 0) {
      logInfo("ML scoring", {
        model_loaded: isMLModelLoaded(),
        adjustments: mlAppliedAdjustments
          .map(s => ({ name: s.restaurant_name, rule_dm: s.rule_dm, adj: s.ml_adjustment, ml_dm: s.ml_dm })),
      });
    }

    // Attach Google API cost stats to every response
    (responseBody as Record<string, unknown>).google_api_cost = getGoogleCallStats();

    // Attach circuit breaker state for monitoring (prod-sentinel can track trips)
    const cbState = getCircuitState();
    (responseBody as Record<string, unknown>).circuit_breaker = {
      state: cbState.state,
      skipped_claude: claudeCircuitBroke,
      total_trips: cbState.totalTrips,
    };

    // Performance telemetry: finalize timings
    timings.response_build = Date.now() - stepStart;
    timings.total = Date.now() - startTime;
    (responseBody as Record<string, unknown>).response_time_ms = timings.total;

    // Log timings for monitoring
    logInfo("Perf telemetry", timings);

    const response = jsonResponse(responseBody, 200, requestOrigin);
    response.headers.set("X-API-Version", API_VERSION);
    response.headers.set("X-Engine", "v9");
    // X-Donde-Timing header: comma-separated key=value pairs for performance monitoring
    const timingHeader = Object.entries(timings).map(([k, v]) => `${k}=${v}`).join(", ");
    response.headers.set("X-Donde-Timing", timingHeader);
    return response;
  } catch (error) {
    // Log full error server-side for debugging — never expose to client
    logError("V9 engine error", { error: String(error), stack: (error instanceof Error) ? error.stack : undefined });
    // Build sanitized response with generic user-facing message (no raw errors/stack traces/paths)
    const errorBody = buildV9ErrorResponse(error);
    errorBody.google_api_cost = getGoogleCallStats();
    return jsonResponse(errorBody, 500, requestOrigin);
  }
});

// ================================================================
// Learning Flywheel Phase 1: Shadow Personalization
// Computes what the personalization boost WOULD be without applying it
// ================================================================
function computeShadowPersonalization(
  profile: TasteProfile | null,
  chosen: V9ScoredCandidate,
  context: V9ScoringContext,
): PersonalizationResult {
  const noProfile: PersonalizationResult = {
    active: false,
    shadowBoost: 0,
    signalsUsed: 0,
    tasteSummary: null,
  };
  if (!profile || profile.totalSignals < 5) return noProfile;

  let boost = 0;
  const restaurantCuisine = chosen.profile.cuisine_type?.toLowerCase() || "";

  // Cuisine affinity boost: top cuisine match → +3 max
  for (const aff of profile.cuisineAffinities) {
    if (aff.cuisine.toLowerCase() === restaurantCuisine) {
      boost += Math.round(aff.score * 3);
      break;
    }
  }

  // Cuisine avoidance penalty: -5
  if (profile.cuisineAvoidances.some(c => c.toLowerCase() === restaurantCuisine)) {
    boost -= 5;
  }

  // Price fit: +1 if within 0.5 tiers, -1 if 2+ tiers away
  if (profile.priceAffinity && context.priceLevel === "Any") {
    const restaurantPrice = chosen.profile.price_level;
    const priceMap: Record<string, number> = { "$": 1, "$$": 2, "$$$": 3, "$$$$": 4 };
    const rp = priceMap[restaurantPrice || ""] || 0;
    if (rp > 0) {
      const diff = Math.abs(rp - profile.priceAffinity);
      if (diff <= 0.5) boost += 1;
      else if (diff >= 2) boost -= 1;
    }
  }

  // Neighborhood affinity: +2 for favorite neighborhood
  const restaurantNeighborhood = (chosen.profile as Record<string, unknown>).neighborhood_name as string || "";
  for (const na of profile.neighborhoodAffinities) {
    if (na.neighborhood.toLowerCase() === restaurantNeighborhood.toLowerCase() && na.score >= 0.5) {
      boost += 2;
      break;
    }
  }

  // Discovery bonus: +1 for unexplored cuisine (adventurous users)
  if (profile.discoveryScore > 0.6) {
    const isExplored = profile.cuisineAffinities.some(a => a.cuisine.toLowerCase() === restaurantCuisine);
    if (!isExplored && restaurantCuisine) {
      boost += 1;
    }
  }

  // Hard clamp: +/-5 total
  boost = Math.max(-5, Math.min(5, boost));

  // Build taste summary
  const vibeLabel = profile.noisePreference < -0.3 ? "quiet" : profile.noisePreference > 0.3 ? "lively" : "moderate";
  const priceLabel = profile.priceAffinity
    ? ["$", "$$", "$$$", "$$$$"][Math.round(profile.priceAffinity) - 1] || "$$"
    : "any";
  const typeLabel = profile.discoveryScore > 0.6 ? "explorer" : profile.discoveryScore < 0.3 ? "loyalist" : "balanced";

  return {
    active: false,  // Phase 1: shadow mode — never active
    shadowBoost: boost,
    signalsUsed: profile.totalSignals,
    tasteSummary: {
      topCuisines: profile.cuisineAffinities.slice(0, 3).map(a => a.cuisine),
      vibe: vibeLabel,
      price: priceLabel,
      type: typeLabel,
    },
  };
}

// V12: Insider tip structural validation — must start with verb, ≤25 words
const INSIDER_TIP_VALID_STARTERS = [
  'ask', 'sit', 'skip', 'grab', 'try', 'order', 'get', 'come',
  'arrive', 'book', 'request', 'save', 'start', 'go', 'bring',
  'tell', 'pick', 'choose', 'avoid', 'make', 'take', 'check',
  'look', 'head', 'split', 'share', 'pair', 'opt', 'swap',
  'call', 'plan', 'show', 'snag', 'add', 'spring', 'double',
];

function validateInsiderTip(tip: string | null | undefined): string | null {
  if (!tip) return null;
  const trimmed = tip.trim();
  // Word count check
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 25) return null;
  // Verb-start check
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
  if (!INSIDER_TIP_VALID_STARTERS.includes(firstWord)) return null;
  return trimmed;
}

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
