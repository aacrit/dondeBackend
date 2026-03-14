/**
 * DondeCache — Persistent Query Cache with Multi-Level Fuzzy Matching
 *
 * Three-level cache lookup:
 *   L1: Exact cache_key match (same as in-memory getCacheKey())
 *   L2: Intent fingerprint match (structured intent → deterministic hash)
 *   L3: Canonical form match (signal-based canonical representation)
 *
 * Quality gate: Only responses with score_fit >= 80 AND blurb_quality >= 80 are cached.
 * TTL: 3 days (organic), 7 days (prewarm).
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { IntentClassificationV2 } from "./intent-classifier.ts";

// ============================================================================
// Constants
// ============================================================================

const ORGANIC_TTL_MS = 3 * 24 * 60 * 60 * 1000;  // 3 days
const PREWARM_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
const QUALITY_GATE = 80;  // B- minimum

/** Synonym map for query normalization — "cheap" and "budget" produce the same canonical form */
const QUERY_SYNONYM_MAP: Record<string, string> = {
  "cheap": "budget",
  "affordable": "budget",
  "inexpensive": "budget",
  "low cost": "budget",
  "fancy": "upscale",
  "high end": "upscale",
  "high-end": "upscale",
  "white tablecloth": "upscale",
  "fine dining": "upscale",
  "date spot": "romantic",
  "date night": "romantic",
  "cozy date": "romantic",
  "anniversary dinner": "romantic",
  "chill": "casual",
  "laid back": "casual",
  "laid-back": "casual",
  "low key": "casual",
  "low-key": "casual",
  "hip": "trendy",
  "stylish": "trendy",
  "instagrammable": "trendy",
  "late night": "late_night",
  "after midnight": "late_night",
  "late": "late_night",
  "quick bite": "fast_casual",
  "fast casual": "fast_casual",
  "grab and go": "fast_casual",
  "hidden gem": "hidden_gem",
  "hole in the wall": "hidden_gem",
  "hole-in-the-wall": "hidden_gem",
  "secret": "hidden_gem",
  "best": "top_rated",
  "top rated": "top_rated",
  "top-rated": "top_rated",
  "highest rated": "top_rated",
  "award winning": "top_rated",
  "award-winning": "top_rated",
};

/** Simple dish synonym normalization — maps variations to canonical form */
const DISH_CANONICAL: Record<string, string> = {
  "momos": "momo",
  "tibetan dumplings": "momo",
  "nepali dumplings": "momo",
  "xiao long bao": "soup_dumplings",
  "xlb": "soup_dumplings",
  "xiaolongbao": "soup_dumplings",
  "soup dumpling": "soup_dumplings",
  "soup dumplings": "soup_dumplings",
  "deep dish": "deep_dish_pizza",
  "deep dish pizza": "deep_dish_pizza",
  "chicago style pizza": "deep_dish_pizza",
  "chicago pizza": "deep_dish_pizza",
  "stuffed pizza": "deep_dish_pizza",
  "phad thai": "pad_thai",
  "pad tai": "pad_thai",
  "pad thai": "pad_thai",
  "potstickers": "gyoza",
  "pot stickers": "gyoza",
  "gyoza": "gyoza",
  "burgers": "burger",
  "hamburger": "burger",
  "hamburgers": "burger",
  "smash burger": "burger",
  "smashburger": "burger",
  "chicken wings": "wings",
  "wing": "wings",
  "buffalo wings": "wings",
  "hot wings": "wings",
  "wings": "wings",
  "pierogies": "pierogi",
  "pierogy": "pierogi",
  "perogies": "pierogi",
  "pierogi": "pierogi",
  "dimsum": "dim_sum",
  "yum cha": "dim_sum",
  "dim sum": "dim_sum",
  "kebabs": "kebab",
  "kabob": "kebab",
  "kabobs": "kebab",
  "kebab": "kebab",
  "shwarma": "shawarma",
  "schwarma": "shawarma",
  "shawarma": "shawarma",
  "tacos": "taco",
  "street tacos": "taco",
  "taco": "taco",
  "birria tacos": "birria",
  "birria": "birria",
  "cebiche": "ceviche",
  "seviche": "ceviche",
  "ceviche": "ceviche",
  "pupusas": "pupusa",
  "pupusa": "pupusa",
  "empanadas": "empanada",
  "empanada": "empanada",
  "arepas": "arepa",
  "arepa": "arepa",
  "falafels": "falafel",
  "falafel": "falafel",
  "nigiri": "sushi",
  "maki": "sushi",
  "sashimi": "sushi",
  "sushi": "sushi",
  "omakase": "omakase",
  "chef's choice": "omakase",
  "chefs tasting": "omakase",
  "tonkotsu ramen": "ramen",
  "shoyu ramen": "ramen",
  "miso ramen": "ramen",
  "ramen": "ramen",
  "beef pho": "pho",
  "chicken pho": "pho",
  "pho": "pho",
};

// ============================================================================
// Public API
// ============================================================================

export interface CacheHitResult {
  level: 1 | 2 | 3;           // 1=exact, 2=fingerprint, 3=canonical
  responseBody: Record<string, unknown>;
  cacheEntryId: string;
  rankedQueue: unknown[] | null;
}

/**
 * Build the exact-match cache key (same logic as getCacheKey in index.ts).
 * Excludes the `exclude` list so Try Another always misses persistent cache.
 */
export function buildExactCacheKey(
  occasion: string,
  neighborhood: string,
  priceLevel: string,
  specialRequest: string,
): string {
  const normalized = specialRequest.toLowerCase().trim().split(/\s+/).sort().join(" ");
  return `${occasion}|${neighborhood}|${priceLevel}|${normalized}`;
}

/**
 * Compute a deterministic intent fingerprint from classified intent.
 * Makes "momo" = "momos" = "best momos" produce the same fingerprint.
 */
export function computeIntentFingerprint(
  intent: IntentClassificationV2 | null,
  occasion: string,
  neighborhood: string,
  priceLevel: string,
): string {
  if (!intent) {
    // No intent → fingerprint from context only
    return `none|${occasion}|${neighborhood}|${priceLevel}`;
  }

  const parts: string[] = [];

  // Cuisines (sorted)
  if (intent.target_cuisines?.length) {
    parts.push("c:" + [...intent.target_cuisines].sort().join(","));
  }

  // Dish (normalized via DISH_CANONICAL)
  if (intent.dish_level_intent) {
    const dish = intent.dish_level_intent.toLowerCase().trim();
    const canonical = DISH_CANONICAL[dish] || dish.replace(/\s+/g, "_");
    parts.push("d:" + canonical);
  }

  // Vibe keywords (sorted)
  if (intent.vibe_keywords?.length) {
    parts.push("v:" + [...intent.vibe_keywords].map(v => v.toLowerCase()).sort().join(","));
  }

  // Practical constraints (sorted)
  if (intent.practical_constraints?.length) {
    parts.push("x:" + [...intent.practical_constraints].map(c => c.toLowerCase()).sort().join(","));
  }

  // Emotional intent
  if (intent.emotional_intent && intent.emotional_intent !== "casual") {
    parts.push("e:" + intent.emotional_intent.toLowerCase());
  }

  // Context
  parts.push(`${occasion}|${neighborhood}|${priceLevel}`);

  return parts.join("|");
}

/**
 * Build a signal-based canonical form with typed prefixes and synonym normalization.
 */
export function computeCanonicalForm(
  specialRequest: string,
  intent: IntentClassificationV2 | null,
): string {
  const parts: string[] = [];
  const lower = specialRequest.toLowerCase().trim();

  // Apply synonym normalization to the raw query
  let normalized = lower;
  for (const [from, to] of Object.entries(QUERY_SYNONYM_MAP)) {
    // Use word boundary matching to avoid partial replacements
    const regex = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    normalized = normalized.replace(regex, to);
  }

  // Dish signal
  if (intent?.dish_level_intent) {
    const dish = intent.dish_level_intent.toLowerCase().trim();
    const canonical = DISH_CANONICAL[dish] || dish.replace(/\s+/g, "_");
    parts.push("DISH:" + canonical);
  }

  // Cuisine signals
  if (intent?.target_cuisines?.length) {
    for (const c of [...intent.target_cuisines].sort()) {
      parts.push("C:" + c);
    }
  }

  // Vibe signals
  if (intent?.vibe_keywords?.length) {
    for (const v of [...intent.vibe_keywords].map(v => v.toLowerCase()).sort()) {
      parts.push("V:" + v);
    }
  }

  // Emotional intent
  if (intent?.emotional_intent && intent.emotional_intent !== "casual") {
    parts.push("E:" + intent.emotional_intent);
  }

  // Constraints
  if (intent?.practical_constraints?.length) {
    for (const x of [...intent.practical_constraints].map(c => c.toLowerCase()).sort()) {
      parts.push("X:" + x);
    }
  }

  // If no structured signals, fall back to normalized sorted words
  if (parts.length === 0) {
    parts.push("RAW:" + normalized.split(/\s+/).sort().join("_"));
  }

  return parts.join("|");
}

/**
 * Three-level persistent cache lookup via single SQL query.
 * Returns the best match (exact > fingerprint > canonical) or null.
 */
export async function lookupPersistentCache(
  supabase: SupabaseClient,
  exactKey: string,
  fingerprint: string,
  canonicalForm: string,
): Promise<CacheHitResult | null> {
  // Try exact match first (fastest path)
  const { data: exactMatch } = await supabase
    .from("query_cache")
    .select("id, response_body, ranked_queue")
    .eq("cache_key", exactKey)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .single();

  if (exactMatch) {
    // Fire-and-forget hit count update
    supabase
      .from("query_cache")
      .update({ hit_count: (exactMatch as Record<string, unknown>).hit_count as number || 0 + 1, last_hit_at: new Date().toISOString() })
      .eq("id", exactMatch.id)
      .then(() => {})
      .catch(() => {});

    return {
      level: 1,
      responseBody: exactMatch.response_body as Record<string, unknown>,
      cacheEntryId: exactMatch.id as string,
      rankedQueue: exactMatch.ranked_queue as unknown[] | null,
    };
  }

  // Try fingerprint match (L2)
  const { data: fpMatch } = await supabase
    .from("query_cache")
    .select("id, response_body, ranked_queue")
    .eq("intent_fingerprint", fingerprint)
    .gt("expires_at", new Date().toISOString())
    .order("hit_count", { ascending: false })
    .limit(1)
    .single();

  if (fpMatch) {
    supabase
      .from("query_cache")
      .update({ hit_count: (fpMatch as Record<string, unknown>).hit_count as number || 0 + 1, last_hit_at: new Date().toISOString() })
      .eq("id", fpMatch.id)
      .then(() => {})
      .catch(() => {});

    return {
      level: 2,
      responseBody: fpMatch.response_body as Record<string, unknown>,
      cacheEntryId: fpMatch.id as string,
      rankedQueue: fpMatch.ranked_queue as unknown[] | null,
    };
  }

  // Try canonical form match (L3)
  const { data: canonMatch } = await supabase
    .from("query_cache")
    .select("id, response_body, ranked_queue")
    .eq("canonical_form", canonicalForm)
    .gt("expires_at", new Date().toISOString())
    .order("hit_count", { ascending: false })
    .limit(1)
    .single();

  if (canonMatch) {
    supabase
      .from("query_cache")
      .update({ hit_count: (canonMatch as Record<string, unknown>).hit_count as number || 0 + 1, last_hit_at: new Date().toISOString() })
      .eq("id", canonMatch.id)
      .then(() => {})
      .catch(() => {});

    return {
      level: 3,
      responseBody: canonMatch.response_body as Record<string, unknown>,
      cacheEntryId: canonMatch.id as string,
      rankedQueue: canonMatch.ranked_queue as unknown[] | null,
    };
  }

  return null;
}

/**
 * Populate the persistent cache with a quality-gated response.
 * Only stores entries that meet the B-/80 quality gate.
 */
export async function populateCache(
  serviceClient: SupabaseClient,
  cacheKey: string,
  fingerprint: string,
  canonicalForm: string,
  specialRequest: string,
  occasion: string,
  neighborhood: string,
  priceLevel: string,
  responseBody: Record<string, unknown>,
  scoreFit: number,
  blurbQuality: number,
  source: "organic" | "prewarm" | "golden" = "organic",
): Promise<boolean> {
  // Quality gate
  if (scoreFit < QUALITY_GATE || blurbQuality < QUALITY_GATE) {
    return false;
  }

  const ttl = source === "organic" ? ORGANIC_TTL_MS : PREWARM_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl).toISOString();

  // Extract primary restaurant ID from response
  const restaurant = responseBody.restaurant as Record<string, unknown> | undefined;
  const primaryRestaurantId = restaurant?.id as string | undefined;

  // Extract ranked queue for Try Another fallback
  const rankedQueue = responseBody.ranked_queue || null;

  // Null out Google-live fields to avoid stale data in cache
  const cachedResponse = { ...responseBody };
  if (cachedResponse.restaurant && typeof cachedResponse.restaurant === "object") {
    const r = { ...(cachedResponse.restaurant as Record<string, unknown>) };
    // These fields come from Google Places API and go stale
    r.photo_urls = null;
    r.opening_hours = null;
    r.review_snippets = null;
    cachedResponse.restaurant = r;
  }

  const dondeMatch = responseBody.donde_match as number | undefined;

  const { error } = await serviceClient
    .from("query_cache")
    .upsert({
      cache_key: cacheKey,
      intent_fingerprint: fingerprint,
      canonical_form: canonicalForm,
      special_request: specialRequest,
      occasion,
      neighborhood,
      price_level: priceLevel,
      response_body: cachedResponse,
      ranked_queue: rankedQueue,
      primary_restaurant_id: primaryRestaurantId || null,
      donde_match: dondeMatch || null,
      score_fit_score: scoreFit,
      blurb_quality_score: blurbQuality,
      source,
      engine_version: "11.0.0",
      expires_at: expiresAt,
    }, {
      onConflict: "cache_key",
    });

  if (error) {
    console.warn("Failed to populate query_cache:", error.message);
    return false;
  }

  return true;
}

/**
 * Try Another handler: find next eligible result from cached ranked_queue.
 * Returns the next restaurant not in the exclude list, or null.
 */
export function getNextFromCachedQueue(
  rankedQueue: unknown[] | null,
  exclude: string[],
): Record<string, unknown> | null {
  if (!rankedQueue || !Array.isArray(rankedQueue) || rankedQueue.length === 0) {
    return null;
  }

  const excludeSet = new Set(exclude);

  for (const item of rankedQueue) {
    const entry = item as Record<string, unknown>;
    const restaurant = entry.restaurant as Record<string, unknown> | undefined;
    const id = restaurant?.id as string | undefined;
    if (id && !excludeSet.has(id)) {
      return entry;
    }
  }

  return null;
}
