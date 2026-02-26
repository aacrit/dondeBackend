/**
 * DondeAI V3 Full Dataset Enrichment Pipeline
 *
 * One-time comprehensive enrichment for 913 Chicago restaurants.
 * 7 stages: integrity fixes → structured fields → rich content → premium content
 *          → occasion recalibration → tag regeneration → confidence update
 *
 * Usage:
 *   npx tsx scripts/pipelines/enrich-full-dataset.ts                    # Dry run (default)
 *   npx tsx scripts/pipelines/enrich-full-dataset.ts --live             # Write to DB
 *   npx tsx scripts/pipelines/enrich-full-dataset.ts --limit 5          # Process 5 restaurants
 *   npx tsx scripts/pipelines/enrich-full-dataset.ts --stage 3          # Start from stage 3
 *   npx tsx scripts/pipelines/enrich-full-dataset.ts --live --resume    # Resume from checkpoint
 *   npx tsx scripts/pipelines/enrich-full-dataset.ts --realtime         # Use real-time API (no batch)
 *
 * Cost estimate (913 restaurants):
 *   Batch API (default): ~$29     Real-time API: ~$58
 *   Wall-clock time:     ~30-60 min
 */

import { createAdminClient } from "../lib/supabase";
import { askClaude, parseJsonResponse } from "../lib/claude";
import { processBatches } from "../lib/batch";
import * as fs from "fs";

// ==========================================
// CONFIGURATION
// ==========================================

const MODELS = {
  structured: "claude-haiku-4-5-20251001",   // Stage 2, 6
  rich: "claude-sonnet-4-6",                  // Stage 3
  premium: "claude-sonnet-4-6",               // Stage 4
  scoring: "claude-sonnet-4-6",               // Stage 5
  tags: "claude-haiku-4-5-20251001",          // Stage 6
};

const BATCH_SIZES = { haiku: 10, sonnet: 5 };
const RATE_LIMITS_MS = { haiku: 1500, sonnet: 3000 }; // ms between requests in realtime mode

// CLI args
const DRY_RUN = !process.argv.includes("--live");
const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  return idx >= 0 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1], 10) : Infinity;
})();
const START_STAGE = (() => {
  const idx = process.argv.indexOf("--stage");
  return idx >= 0 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1], 10) : 1;
})();
const RESUME = process.argv.includes("--resume");

const CHECKPOINT_FILE = "enrichment-checkpoint.json";
const AUDIT_LOG_FILE = "enrichment-audit-log.csv";
const SUMMARY_FILE = "enrichment-summary.json";
const FAILURES_FILE = "enrichment-failures.json";

// ==========================================
// TYPES
// ==========================================

interface RestaurantFull {
  id: string;
  name: string;
  address: string;
  cuisine_type: string | null;
  price_level: string | null;
  noise_level: string | null;
  lighting_ambiance: string | null;
  dress_code: string | null;
  dietary_options: string[] | null;
  best_for_oneliner: string | null;
  insider_tip: string | null;
  outdoor_seating: boolean | null;
  live_music: boolean | null;
  best_times: string[] | null;
  good_for: string[] | null;
  ambiance: string[] | null;
  neighborhood_name: string | null;
  neighborhood_description: string | null;
  tags: string[];
  deep_profile: Record<string, unknown> | null;
}

interface Checkpoint {
  stage: number;
  lastProcessedIndex: number;
  processedIds: string[];
  startedAt: string;
  batchId?: string;
}

interface StageStats {
  stage: number;
  name: string;
  processed: number;
  success: number;
  errors: number;
  elapsed: number;
  model: string | null;
}

// ==========================================
// GLOBAL STATE
// ==========================================

let failures: Array<{ restaurantId: string; restaurantName: string; stage: number; error: string }> = [];
let stageStats: StageStats[] = [];
let auditLogStream: fs.WriteStream | null = null;

// ==========================================
// HELPERS
// ==========================================

function logAudit(
  restaurantId: string,
  restaurantName: string,
  stage: number,
  field: string,
  oldValue: string,
  newValue: string,
  model: string,
  confidence: string,
) {
  if (!auditLogStream) return;
  const timestamp = new Date().toISOString();
  const row = [timestamp, restaurantId, restaurantName, stage, field, oldValue, newValue, model, confidence]
    .map((v) => `"${String(v).replace(/"/g, '""')}"`)
    .join(",");
  auditLogStream.write(row + "\n");
}

function saveCheckpoint(checkpoint: Checkpoint) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

function loadCheckpoint(): Checkpoint | null {
  if (!fs.existsSync(CHECKPOINT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function askClaudeWithRetry(
  prompt: string,
  options: { model: string; maxTokens?: number; temperature?: number },
  maxRetries = 5,
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await askClaude(prompt, options);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 429 && attempt < maxRetries - 1) {
        const delay = Math.min(60000, 5000 * Math.pow(2, attempt));
        console.log(`    Rate limited. Waiting ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

// ==========================================
// SYSTEM PROMPTS
// ==========================================

const SYSTEM_CONTEXT = `You are a Chicago dining expert with deep knowledge of the local restaurant scene. You provide accurate, specific, and grounded information. Never fabricate details — if uncertain, say so. Your responses must be valid JSON only, no markdown.`;

// ==========================================
// STAGE 1: DATA INTEGRITY FIXES (no LLM)
// ==========================================

async function stage1_integrityFixes(supabase: ReturnType<typeof createAdminClient>, restaurants: RestaurantFull[]) {
  console.log("\n══════════════════════════════════════════");
  console.log("Stage 1: Data Integrity Fixes (no LLM)");
  console.log("══════════════════════════════════════════\n");

  const start = Date.now();
  let fixes = 0;

  // 1a: Create missing deep_profile rows
  const { data: existingDp } = await supabase.from("restaurant_deep_profiles").select("restaurant_id").range(0, 9999);
  const dpIds = new Set((existingDp || []).map((r) => r.restaurant_id));
  const missingDp = restaurants.filter((r) => !dpIds.has(r.id));

  if (missingDp.length > 0) {
    console.log(`Creating ${missingDp.length} missing deep_profile skeleton rows...`);
    if (!DRY_RUN) {
      for (const r of missingDp) {
        const { error } = await supabase
          .from("restaurant_deep_profiles")
          .upsert({ restaurant_id: r.id }, { onConflict: "restaurant_id" });
        if (error) console.error(`  Failed for ${r.name}:`, error.message);
        else {
          fixes++;
          logAudit(r.id, r.name, 1, "deep_profile", "NULL", "skeleton", "none", "1.0");
        }
      }
    } else {
      console.log(`  [DRY RUN] Would create ${missingDp.length} skeleton rows`);
    }
  }

  // 1b: Fix NULL noise_level → "Moderate" (makes restaurants visible to RPC)
  const nullNoise = restaurants.filter((r) => !r.noise_level);
  if (nullNoise.length > 0) {
    console.log(`Fixing ${nullNoise.length} restaurants with NULL noise_level → "Moderate"...`);
    if (!DRY_RUN) {
      for (const r of nullNoise) {
        const { error } = await supabase
          .from("restaurants")
          .update({ noise_level: "Moderate" })
          .eq("id", r.id);
        if (error) console.error(`  Failed for ${r.name}:`, error.message);
        else {
          r.noise_level = "Moderate"; // Update in-memory
          fixes++;
          logAudit(r.id, r.name, 1, "noise_level", "NULL", "Moderate", "none", "1.0");
        }
      }
    } else {
      console.log(`  [DRY RUN] Would set ${nullNoise.length} noise_level → "Moderate"`);
    }
  }

  // 1c: Normalize noise_level values
  const validNoise = new Set(["Quiet", "Moderate", "Loud"]);
  const badNoise = restaurants.filter((r) => r.noise_level && !validNoise.has(r.noise_level));
  if (badNoise.length > 0) {
    console.log(`Normalizing ${badNoise.length} non-standard noise_level values...`);
    for (const r of badNoise) {
      const lower = r.noise_level!.toLowerCase();
      let fixed = "Moderate";
      if (lower.includes("quiet") || lower.includes("soft")) fixed = "Quiet";
      else if (lower.includes("loud") || lower.includes("noisy")) fixed = "Loud";

      if (!DRY_RUN) {
        const { error } = await supabase.from("restaurants").update({ noise_level: fixed }).eq("id", r.id);
        if (!error) {
          logAudit(r.id, r.name, 1, "noise_level", r.noise_level!, fixed, "none", "1.0");
          r.noise_level = fixed;
          fixes++;
        }
      } else {
        console.log(`  [DRY RUN] ${r.name}: "${r.noise_level}" → "${fixed}"`);
      }
    }
  }

  // 1d: Normalize dress_code
  const validDress = new Set(["Casual", "Smart Casual", "Business Casual", "Formal"]);
  const badDress = restaurants.filter((r) => r.dress_code && !validDress.has(r.dress_code));
  if (badDress.length > 0) {
    console.log(`Normalizing ${badDress.length} non-standard dress_code values...`);
    for (const r of badDress) {
      const lower = r.dress_code!.toLowerCase();
      let fixed = "Casual";
      if (lower.includes("formal")) fixed = "Formal";
      else if (lower.includes("business")) fixed = "Business Casual";
      else if (lower.includes("smart")) fixed = "Smart Casual";

      if (!DRY_RUN) {
        const { error } = await supabase.from("restaurants").update({ dress_code: fixed }).eq("id", r.id);
        if (!error) {
          logAudit(r.id, r.name, 1, "dress_code", r.dress_code!, fixed, "none", "1.0");
          r.dress_code = fixed;
          fixes++;
        }
      }
    }
  }

  console.log(`\nStage 1 complete: ${fixes} fixes applied (${Date.now() - start}ms)`);
  stageStats.push({ stage: 1, name: "Data Integrity", processed: restaurants.length, success: fixes, errors: 0, elapsed: Date.now() - start, model: null });
}

// ==========================================
// STAGE 2: STRUCTURED FIELD ENRICHMENT (Haiku 4.5)
// ==========================================

function buildStage2Prompt(batch: RestaurantFull[]): string {
  const entries = batch.map((r, i) => {
    const dp = r.deep_profile || {};
    return `${i + 1}. ${r.name} (ID: ${r.id})
  Address: ${r.address || "N/A"}
  Cuisine: ${r.cuisine_type || "Unknown"} | Price: ${r.price_level || "Unknown"}
  Noise: ${r.noise_level || "N/A"} | Lighting: ${r.lighting_ambiance || "N/A"} | Dress: ${r.dress_code || "N/A"}
  Neighborhood: ${r.neighborhood_name || "Chicago"}${r.neighborhood_description ? ` — ${r.neighborhood_description}` : ""}
  Tags: ${r.tags.join(", ") || "none"}
  Dietary: ${(r.dietary_options || []).join(", ") || "N/A"}
  Best times: ${(r.best_times || []).join(", ") || "N/A"}
  Good for: ${(r.good_for || []).join(", ") || "N/A"}
  Ambiance: ${(r.ambiance || []).join(", ") || "N/A"}
  Existing deep profile: ${JSON.stringify(dp).substring(0, 500)}`;
  });

  return `${SYSTEM_CONTEXT}

Validate existing data and fill gaps for these ${batch.length} Chicago restaurants. For each field, if the existing value looks correct, keep it. If it's missing or wrong, provide the right value. Return null for fields you truly can't determine.

Fields to provide per restaurant:
- price_level: "$", "$$", "$$$", or "$$$$"
- noise_level: "Quiet", "Moderate", or "Loud"
- lighting_ambiance: one word (dim, warm, bright, modern, intimate, candlelit, etc.)
- dress_code: "Casual", "Smart Casual", "Business Casual", or "Formal"
- dietary_options: string[] (e.g., ["Vegetarian", "Vegan", "Gluten-Free"])
- best_times: string[] (e.g., ["dinner", "weekend brunch", "late night"])
- ambiance: string[] of keywords (e.g., ["cozy", "intimate", "lively"])
- good_for: string[] (e.g., ["date night", "groups", "solo dining"])
- service_style: "Full Table Service", "Counter", "Omakase", "Family Style", "Buffet", "Tasting Menu", "Fast Casual", "Bar Service"
- meal_pacing: "quick_bite", "relaxed", "leisurely", "ceremonial"
- reservation_difficulty: "walk_in_friendly", "recommended", "required", "hard_to_get"
- typical_wait_minutes: number or null
- group_size_sweet_spot: PostgreSQL range string "[min,max)" e.g., "[2,6)"
- check_average_per_person: number (dollars)
- tipping_culture: "standard", "included", "counter_tip", "no_tip"
- kid_friendliness: 0-10
- conversation_friendliness: 0-10
- energy_level: 0-10
- instagram_worthiness: 0-10
- cultural_authenticity: 0-10
- menu_depth: "focused", "moderate", "extensive"
- spice_level: "mild", "moderate", "hot", "volcanic"
- dietary_depth: "token", "solid", "dedicated"
- transit_accessibility: "L-accessible", "bus-accessible", "car-recommended", "walkable-strip", "rideshare-recommended"
- byob_policy: "full_byob", "byob_wine_only", "corkage_fee", "no_byob", "full_bar"
- payment_notes: "Cash only", "All cards accepted", or null
- confidence: 0.0-1.0 (your confidence in this enrichment)

Return ONLY valid JSON:
{"restaurants": [{"id": "uuid", "price_level": "$$", "noise_level": "Moderate", ...all fields..., "confidence": 0.7}]}

Restaurants:

${entries.join("\n\n---\n\n")}`;
}

async function stage2_structuredEnrichment(supabase: ReturnType<typeof createAdminClient>, restaurants: RestaurantFull[]) {
  console.log("\n══════════════════════════════════════════");
  console.log("Stage 2: Structured Field Enrichment (Haiku 4.5)");
  console.log("══════════════════════════════════════════\n");

  const start = Date.now();
  let success = 0;
  let errors = 0;

  await processBatches(restaurants, BATCH_SIZES.haiku, async (batch) => {
    try {
      const prompt = buildStage2Prompt(batch);
      const response = await askClaudeWithRetry(prompt, {
        model: MODELS.structured,
        maxTokens: 8192,
        temperature: 0.2,
      });

      const parsed = parseJsonResponse<{ restaurants: Array<Record<string, unknown>> }>(response);
      if (!parsed.restaurants) throw new Error("No restaurants array in response");

      for (const result of parsed.restaurants) {
        const restaurant = batch.find((r) => r.id === result.id);
        if (!restaurant) continue;

        // Update restaurants table fields
        const restaurantUpdate: Record<string, unknown> = {};
        const restaurantFields = ["price_level", "noise_level", "lighting_ambiance", "dress_code"];
        const restaurantArrayFields = ["dietary_options", "best_times", "ambiance", "good_for"];

        for (const f of restaurantFields) {
          if (result[f] !== undefined && result[f] !== null) {
            restaurantUpdate[f] = result[f];
            logAudit(restaurant.id, restaurant.name, 2, f, String((restaurant as Record<string, unknown>)[f] || "NULL"), String(result[f]), MODELS.structured, String(result.confidence || ""));
          }
        }
        for (const f of restaurantArrayFields) {
          if (Array.isArray(result[f]) && result[f].length > 0) {
            restaurantUpdate[f] = result[f];
            logAudit(restaurant.id, restaurant.name, 2, f, JSON.stringify((restaurant as Record<string, unknown>)[f] || []), JSON.stringify(result[f]), MODELS.structured, String(result.confidence || ""));
          }
        }

        // Update deep_profile fields
        const dpUpdate: Record<string, unknown> = { restaurant_id: restaurant.id };
        const dpFields = [
          "service_style", "meal_pacing", "reservation_difficulty", "typical_wait_minutes",
          "group_size_sweet_spot", "check_average_per_person", "tipping_culture",
          "menu_depth", "spice_level", "dietary_depth", "transit_accessibility",
          "byob_policy", "payment_notes",
        ];
        const dpNumericFields = [
          "kid_friendliness", "conversation_friendliness", "energy_level",
          "instagram_worthiness", "cultural_authenticity",
        ];

        for (const f of dpFields) {
          if (result[f] !== undefined && result[f] !== null) {
            dpUpdate[f] = result[f];
            const oldVal = restaurant.deep_profile ? String(restaurant.deep_profile[f] || "NULL") : "NULL";
            logAudit(restaurant.id, restaurant.name, 2, f, oldVal, String(result[f]), MODELS.structured, String(result.confidence || ""));
          }
        }
        for (const f of dpNumericFields) {
          if (result[f] !== undefined && result[f] !== null) {
            dpUpdate[f] = clamp(Number(result[f]), 0, 10);
            const oldVal = restaurant.deep_profile ? String(restaurant.deep_profile[f] || "NULL") : "NULL";
            logAudit(restaurant.id, restaurant.name, 2, f, oldVal, String(dpUpdate[f]), MODELS.structured, String(result.confidence || ""));
          }
        }

        if (DRY_RUN) {
          console.log(`  [DRY RUN] ${restaurant.name}: ${Object.keys(restaurantUpdate).length} restaurant fields, ${Object.keys(dpUpdate).length - 1} dp fields`);
        } else {
          if (Object.keys(restaurantUpdate).length > 0) {
            const { error } = await supabase.from("restaurants").update(restaurantUpdate).eq("id", restaurant.id);
            if (error) console.error(`  Restaurant update failed for ${restaurant.name}:`, error.message);
          }
          if (Object.keys(dpUpdate).length > 1) {
            const { error } = await supabase.from("restaurant_deep_profiles").upsert(dpUpdate, { onConflict: "restaurant_id" });
            if (error) console.error(`  Deep profile upsert failed for ${restaurant.name}:`, error.message);
          }
          // Update in-memory for later stages
          Object.assign(restaurant, restaurantUpdate);
          if (!restaurant.deep_profile) restaurant.deep_profile = {};
          Object.assign(restaurant.deep_profile, dpUpdate);
        }

        success++;
      }
    } catch (err) {
      console.error(`  Batch error:`, err);
      for (const r of batch) {
        failures.push({ restaurantId: r.id, restaurantName: r.name, stage: 2, error: String(err) });
        errors++;
      }
    }
  }, RATE_LIMITS_MS.haiku);

  console.log(`\nStage 2 complete: ${success} success, ${errors} errors (${Date.now() - start}ms)`);
  stageStats.push({ stage: 2, name: "Structured Fields", processed: restaurants.length, success, errors, elapsed: Date.now() - start, model: MODELS.structured });
}

// ==========================================
// STAGE 3: RICH CONTENT ENRICHMENT (Sonnet 4.6)
// ==========================================

function buildStage3Prompt(batch: RestaurantFull[]): string {
  const entries = batch.map((r, i) => {
    const dp = r.deep_profile || {};
    return `${i + 1}. ${r.name} (ID: ${r.id})
  Cuisine: ${r.cuisine_type || "Unknown"} | Price: ${r.price_level || "Unknown"}
  Neighborhood: ${r.neighborhood_name || "Chicago"}${r.neighborhood_description ? ` — ${r.neighborhood_description}` : ""}
  Noise: ${r.noise_level} | Lighting: ${r.lighting_ambiance} | Dress: ${r.dress_code}
  Service: ${dp.service_style || "N/A"} | Pacing: ${dp.meal_pacing || "N/A"}
  Energy: ${dp.energy_level || "N/A"}/10 | Authenticity: ${dp.cultural_authenticity || "N/A"}/10
  Tags: ${r.tags.join(", ") || "none"}`;
  });

  return `${SYSTEM_CONTEXT}

For each restaurant, provide rich content grounded in the data above. Be specific to each restaurant — no generic descriptions. If you can't determine something with confidence, use null.

Fields per restaurant:
- flavor_profiles: array of 3-5 flavor descriptors (e.g., "umami-forward", "charred", "bright-acidic", "bold-spiced")
- signature_dishes: array of 3-5 objects {"dish": "name", "description": "what makes it special (10 words max)"}. Infer from cuisine type and style.
- crowd_profile: array of 2-4 from: "young_professionals", "foodies", "date_night_couples", "families", "tourists", "students", "industry_crowd", "locals_only", "after_work", "late_night_crowd"
- wow_factors: array of 2-4 from: "open_kitchen", "rooftop_skyline_view", "tableside_preparation", "secret_entrance", "live_cooking_show", "river_view", "lake_view", "historic_building", "celebrity_chef", "unique_decor", "speakeasy_vibe", "garden_dining", "fireplace", "chef_interaction"
- seating_options: array from: "bar", "booth", "communal", "private_room", "patio", "chefs_counter", "standard_table", "counter", "rooftop"
- decor_style: one short descriptor (e.g., "industrial-chic", "hole-in-wall-authentic", "minimalist-japanese")
- best_seat_in_house: one specific recommendation sentence or null
- date_progression: "first_date", "casual_weeknight", "anniversary", "proposal_worthy"
- seasonal_relevance: {"spring": 1-10, "summer": 1-10, "fall": 1-10, "winter": 1-10}
- neighborhood_integration: "institution", "newcomer", "hidden_local", "destination", "tourist_draw"
- ideal_weather: array from: "warm_sunny", "mild_evening", "rainy_cozy", "cold_comfort", "any"
- unique_selling_point: one sentence differentiator or null
- awards_recognition: array of specific awards or empty array
- chef_notable: boolean
- confidence: 0.0-1.0

Return ONLY valid JSON:
{"restaurants": [{"id": "uuid", "flavor_profiles": [...], ...all fields..., "confidence": 0.7}]}

Restaurants:

${entries.join("\n\n---\n\n")}`;
}

async function stage3_richContent(supabase: ReturnType<typeof createAdminClient>, restaurants: RestaurantFull[]) {
  console.log("\n══════════════════════════════════════════");
  console.log("Stage 3: Rich Content Enrichment (Sonnet 4.6)");
  console.log("══════════════════════════════════════════\n");

  const start = Date.now();
  let success = 0;
  let errors = 0;

  await processBatches(restaurants, BATCH_SIZES.sonnet, async (batch) => {
    try {
      const prompt = buildStage3Prompt(batch);
      const response = await askClaudeWithRetry(prompt, {
        model: MODELS.rich,
        maxTokens: 8192,
        temperature: 0.3,
      });

      const parsed = parseJsonResponse<{ restaurants: Array<Record<string, unknown>> }>(response);
      if (!parsed.restaurants) throw new Error("No restaurants array in response");

      for (const result of parsed.restaurants) {
        const restaurant = batch.find((r) => r.id === result.id);
        if (!restaurant) continue;

        const dpUpdate: Record<string, unknown> = { restaurant_id: restaurant.id };
        const fields = [
          "flavor_profiles", "signature_dishes", "crowd_profile", "wow_factors",
          "seating_options", "decor_style", "best_seat_in_house", "date_progression",
          "seasonal_relevance", "neighborhood_integration", "ideal_weather",
          "unique_selling_point", "awards_recognition", "chef_notable",
        ];

        for (const f of fields) {
          if (result[f] !== undefined && result[f] !== null) {
            dpUpdate[f] = result[f];
            const oldVal = restaurant.deep_profile ? JSON.stringify(restaurant.deep_profile[f] || null).substring(0, 50) : "NULL";
            logAudit(restaurant.id, restaurant.name, 3, f, oldVal, JSON.stringify(result[f]).substring(0, 80), MODELS.rich, String(result.confidence || ""));
          }
        }

        if (DRY_RUN) {
          console.log(`  [DRY RUN] ${restaurant.name}: ${Object.keys(dpUpdate).length - 1} fields enriched`);
        } else {
          const { error } = await supabase.from("restaurant_deep_profiles").upsert(dpUpdate, { onConflict: "restaurant_id" });
          if (error) console.error(`  Upsert failed for ${restaurant.name}:`, error.message);
          if (!restaurant.deep_profile) restaurant.deep_profile = {};
          Object.assign(restaurant.deep_profile, dpUpdate);
        }

        success++;
      }
    } catch (err) {
      console.error(`  Batch error:`, err);
      for (const r of batch) {
        failures.push({ restaurantId: r.id, restaurantName: r.name, stage: 3, error: String(err) });
        errors++;
      }
    }
  }, RATE_LIMITS_MS.sonnet);

  console.log(`\nStage 3 complete: ${success} success, ${errors} errors (${Date.now() - start}ms)`);
  stageStats.push({ stage: 3, name: "Rich Content", processed: restaurants.length, success, errors, elapsed: Date.now() - start, model: MODELS.rich });
}

// ==========================================
// STAGE 4: PREMIUM CONTENT GENERATION (Sonnet 4.6)
// ==========================================

function buildStage4Prompt(batch: RestaurantFull[]): string {
  const entries = batch.map((r, i) => {
    const dp = r.deep_profile || {};
    return `${i + 1}. ${r.name} (ID: ${r.id})
  Cuisine: ${r.cuisine_type || "Unknown"} | Price: ${r.price_level || "Unknown"}
  Neighborhood: ${r.neighborhood_name || "Chicago"}
  Tags: ${r.tags.join(", ") || "none"}
  Signature dishes: ${dp.signature_dishes ? JSON.stringify(dp.signature_dishes) : "N/A"}
  Best seat: ${dp.best_seat_in_house || "N/A"}
  USP: ${dp.unique_selling_point || "N/A"}
  Wow factors: ${dp.wow_factors ? JSON.stringify(dp.wow_factors) : "N/A"}
  Decor: ${dp.decor_style || "N/A"}
  Awards: ${dp.awards_recognition ? JSON.stringify(dp.awards_recognition) : "N/A"}
  Chef notable: ${dp.chef_notable || "N/A"}
  Authenticity: ${dp.cultural_authenticity || "N/A"}/10
  Energy: ${dp.energy_level || "N/A"}/10
  Service style: ${dp.service_style || "N/A"}
  Existing tip: ${r.insider_tip || "none"}
  Existing oneliner: ${r.best_for_oneliner || "none"}`;
  });

  return `${SYSTEM_CONTEXT}

Generate premium user-facing content for these Chicago restaurants. Every piece of content must be grounded in the data provided — specific to the restaurant, not generic.

For each restaurant provide:

1. insider_tip: A specific, actionable piece of insider advice (15-25 words, one sentence).
   - Start with a verb: "Ask for...", "Grab the...", "Sit at...", "Order the...", "Skip the..."
   - Reference specific details: a dish, a seat, a time, a hidden menu item
   - Feel like a friend whispering a secret, NOT a Yelp review
   - Must be unique to this restaurant

2. origin_story: 2-4 sentences telling the restaurant's story with vivid, engaging storytelling.
   - Include a specific, memorable detail — a founding moment, a chef's turning point, a neighborhood connection
   - Use active voice, sensory language, and narrative tension
   - Ground in cuisine type, neighborhood character, and cultural context
   - Conversational magazine tone — NOT a Wikipedia entry, NOT a fairy tale
   - Examples:
     "A grandmother from Puebla packed her mole recipe in a suitcase and crossed the border with nothing else. Three generations later, that recipe still anchors the menu at this Pilsen corner spot."
     "Two Alinea alums grew tired of white tablecloths and bet everything on tasting-menu quality at neighborhood prices. The gamble paid off — there's now a two-week wait for a table."
     "The building was a speakeasy in the 1920s, and the current owners kept the hidden basement entrance. The cocktail menu pays homage to the original bootleggers who poured here."

3. best_for_oneliner: One sentence (10-20 words) capturing who this restaurant is perfect for.
   - Specific enough that someone can instantly decide if it's for them
   - Examples: "The birthday dinner spot that makes everyone feel like a VIP"
              "Late-night ramen that cures what ails you after a long week"

Return ONLY valid JSON:
{"restaurants": [{"id": "uuid", "insider_tip": "...", "origin_story": "...", "best_for_oneliner": "..."}]}

Restaurants:

${entries.join("\n\n---\n\n")}`;
}

async function stage4_premiumContent(supabase: ReturnType<typeof createAdminClient>, restaurants: RestaurantFull[]) {
  console.log("\n══════════════════════════════════════════");
  console.log("Stage 4: Premium Content Generation (Sonnet 4.6)");
  console.log("══════════════════════════════════════════\n");

  const start = Date.now();
  let success = 0;
  let errors = 0;

  await processBatches(restaurants, BATCH_SIZES.sonnet, async (batch) => {
    try {
      const prompt = buildStage4Prompt(batch);
      const response = await askClaudeWithRetry(prompt, {
        model: MODELS.premium,
        maxTokens: 4096,
        temperature: 0.4,
      });

      const parsed = parseJsonResponse<{ restaurants: Array<{ id: string; insider_tip: string; origin_story: string; best_for_oneliner: string }> }>(response);
      if (!parsed.restaurants) throw new Error("No restaurants array in response");

      for (const result of parsed.restaurants) {
        const restaurant = batch.find((r) => r.id === result.id);
        if (!restaurant) continue;

        if (DRY_RUN) {
          console.log(`  [DRY RUN] ${restaurant.name}:`);
          console.log(`    Tip: ${result.insider_tip}`);
          console.log(`    Story: ${(result.origin_story || "").substring(0, 100)}...`);
          console.log(`    Oneliner: ${result.best_for_oneliner}`);
        } else {
          // insider_tip + best_for_oneliner → restaurants table
          const { error: rErr } = await supabase
            .from("restaurants")
            .update({
              insider_tip: result.insider_tip,
              best_for_oneliner: result.best_for_oneliner,
            })
            .eq("id", restaurant.id);
          if (rErr) console.error(`  Restaurant update failed for ${restaurant.name}:`, rErr.message);

          // origin_story → deep_profiles table
          const { error: dpErr } = await supabase
            .from("restaurant_deep_profiles")
            .upsert({
              restaurant_id: restaurant.id,
              origin_story: result.origin_story,
            }, { onConflict: "restaurant_id" });
          if (dpErr) console.error(`  Deep profile upsert failed for ${restaurant.name}:`, dpErr.message);

          // Update in-memory
          restaurant.insider_tip = result.insider_tip;
          restaurant.best_for_oneliner = result.best_for_oneliner;
          if (!restaurant.deep_profile) restaurant.deep_profile = {};
          restaurant.deep_profile.origin_story = result.origin_story;
        }

        logAudit(restaurant.id, restaurant.name, 4, "insider_tip", restaurant.insider_tip || "NULL", result.insider_tip, MODELS.premium, "");
        logAudit(restaurant.id, restaurant.name, 4, "origin_story", "...", (result.origin_story || "").substring(0, 80), MODELS.premium, "");
        logAudit(restaurant.id, restaurant.name, 4, "best_for_oneliner", restaurant.best_for_oneliner || "NULL", result.best_for_oneliner, MODELS.premium, "");
        success++;
      }
    } catch (err) {
      console.error(`  Batch error:`, err);
      for (const r of batch) {
        failures.push({ restaurantId: r.id, restaurantName: r.name, stage: 4, error: String(err) });
        errors++;
      }
    }
  }, RATE_LIMITS_MS.sonnet);

  console.log(`\nStage 4 complete: ${success} success, ${errors} errors (${Date.now() - start}ms)`);
  stageStats.push({ stage: 4, name: "Premium Content", processed: restaurants.length, success, errors, elapsed: Date.now() - start, model: MODELS.premium });
}

// ==========================================
// STAGE 5: OCCASION SCORE RECALIBRATION (Sonnet 4.6)
// ==========================================

function buildStage5Prompt(batch: RestaurantFull[]): string {
  const entries = batch.map((r, i) => {
    const dp = r.deep_profile || {};
    return `${i + 1}. ${r.name} (ID: ${r.id})
  Cuisine: ${r.cuisine_type || "Unknown"} | Price: ${r.price_level || "Unknown"}
  Noise: ${r.noise_level} | Lighting: ${r.lighting_ambiance} | Dress: ${r.dress_code}
  Service: ${dp.service_style || "N/A"} | Pacing: ${dp.meal_pacing || "N/A"}
  Energy: ${dp.energy_level ?? "N/A"}/10 | Conversation: ${dp.conversation_friendliness ?? "N/A"}/10
  Kid-friendly: ${dp.kid_friendliness ?? "N/A"}/10
  Group size: ${dp.group_size_sweet_spot || "N/A"} | Seating: ${dp.seating_options ? JSON.stringify(dp.seating_options) : "N/A"}
  Music: ${dp.music_vibe || "N/A"} | Crowd: ${dp.crowd_profile ? JSON.stringify(dp.crowd_profile) : "N/A"}
  Decor: ${dp.decor_style || "N/A"} | Wow: ${dp.wow_factors ? JSON.stringify(dp.wow_factors) : "N/A"}
  Oneliner: ${r.best_for_oneliner || "N/A"}`;
  });

  return `${SYSTEM_CONTEXT}

Rate each restaurant on 7 occasion dimensions (0-10 integers). Use the full range: 5 is average, reserve 8+ for genuinely excellent fits, below 3 for clearly poor fits.

Scoring guide:
- date_friendly_score: Romantic atmosphere, intimate seating, good drinks, low noise. High = "I'd bring a date here."
- group_friendly_score: Communal tables, shareable plates, lively, accommodates 4+. High = "Great for a birthday group."
- family_friendly_score: Kid menu, casual, highchairs, not too loud. High = "Bring the whole family."
- romantic_rating: Special occasion worthy, ambiance, presentation, intimacy. High = "Anniversary dinner."
- business_lunch_score: Professional, quiet enough for conversation, efficient, good value. High = "Client lunch spot."
- solo_dining_score: Bar seating, counter service, welcoming to solo diners. High = "I'd happily eat here alone."
- hole_in_wall_factor: Hidden gem, authentic, off-the-radar, local favorite. High = "Only regulars know about this."

Include brief reasoning per score for auditing.

Return ONLY valid JSON:
{"restaurants": [{"id": "uuid", "date_friendly_score": 7, "group_friendly_score": 8, "family_friendly_score": 5, "romantic_rating": 7, "business_lunch_score": 6, "solo_dining_score": 7, "hole_in_wall_factor": 4, "reasoning": {"date": "...", "group": "...", "family": "...", "romantic": "...", "business": "...", "solo": "...", "hole": "..."}}]}

Restaurants:

${entries.join("\n\n---\n\n")}`;
}

async function stage5_occasionScores(supabase: ReturnType<typeof createAdminClient>, restaurants: RestaurantFull[]) {
  console.log("\n══════════════════════════════════════════");
  console.log("Stage 5: Occasion Score Recalibration (Sonnet 4.6)");
  console.log("══════════════════════════════════════════\n");

  const start = Date.now();
  let success = 0;
  let errors = 0;

  await processBatches(restaurants, BATCH_SIZES.sonnet, async (batch) => {
    try {
      const prompt = buildStage5Prompt(batch);
      const response = await askClaudeWithRetry(prompt, {
        model: MODELS.scoring,
        maxTokens: 4096,
        temperature: 0.2,
      });

      const parsed = parseJsonResponse<{ restaurants: Array<Record<string, unknown>> }>(response);
      if (!parsed.restaurants) throw new Error("No restaurants array in response");

      for (const result of parsed.restaurants) {
        const restaurant = batch.find((r) => r.id === result.id);
        if (!restaurant) continue;

        const scoreData = {
          restaurant_id: restaurant.id,
          date_friendly_score: clamp(Number(result.date_friendly_score) || 5, 0, 10),
          group_friendly_score: clamp(Number(result.group_friendly_score) || 5, 0, 10),
          family_friendly_score: clamp(Number(result.family_friendly_score) || 5, 0, 10),
          romantic_rating: clamp(Number(result.romantic_rating) || 5, 0, 10),
          business_lunch_score: clamp(Number(result.business_lunch_score) || 5, 0, 10),
          solo_dining_score: clamp(Number(result.solo_dining_score) || 5, 0, 10),
          hole_in_wall_factor: clamp(Number(result.hole_in_wall_factor) || 5, 0, 10),
        };

        if (DRY_RUN) {
          const scores = Object.entries(scoreData).filter(([k]) => k !== "restaurant_id").map(([k, v]) => `${k.replace(/_score|_rating|_factor/, "")}=${v}`).join(", ");
          console.log(`  [DRY RUN] ${restaurant.name}: ${scores}`);
        } else {
          const { error } = await supabase.from("occasion_scores").upsert(scoreData, { onConflict: "restaurant_id" });
          if (error) console.error(`  Upsert failed for ${restaurant.name}:`, error.message);
        }

        for (const [k, v] of Object.entries(scoreData)) {
          if (k === "restaurant_id") continue;
          logAudit(restaurant.id, restaurant.name, 5, k, "?", String(v), MODELS.scoring, "");
        }
        success++;
      }
    } catch (err) {
      console.error(`  Batch error:`, err);
      for (const r of batch) {
        failures.push({ restaurantId: r.id, restaurantName: r.name, stage: 5, error: String(err) });
        errors++;
      }
    }
  }, RATE_LIMITS_MS.sonnet);

  console.log(`\nStage 5 complete: ${success} success, ${errors} errors (${Date.now() - start}ms)`);
  stageStats.push({ stage: 5, name: "Occasion Scores", processed: restaurants.length, success, errors, elapsed: Date.now() - start, model: MODELS.scoring });
}

// ==========================================
// STAGE 6: TAG REGENERATION (Haiku 4.5)
// ==========================================

function buildStage6Prompt(batch: RestaurantFull[]): string {
  const entries = batch.map((r, i) => {
    const dp = r.deep_profile || {};
    return `${i + 1}. ${r.name} (ID: ${r.id})
  Cuisine: ${r.cuisine_type || "Unknown"} | Price: ${r.price_level || "Unknown"}
  Noise: ${r.noise_level} | Ambiance: ${(r.ambiance || []).join(", ") || "N/A"}
  Good for: ${(r.good_for || []).join(", ") || "N/A"}
  Dietary: ${(r.dietary_options || []).join(", ") || "N/A"}
  Oneliner: ${r.best_for_oneliner || "N/A"}
  Decor: ${dp.decor_style || "N/A"} | Crowd: ${dp.crowd_profile ? JSON.stringify(dp.crowd_profile) : "N/A"}`;
  });

  return `${SYSTEM_CONTEXT}

Generate 5-8 descriptive tags for each restaurant. Each tag must have a category.

Categories: "vibe" (atmosphere/mood), "cuisine" (food style), "feature" (amenities), "dietary" (dietary options)

Rules:
- Tags must be lowercase, 1-3 words each
- Be specific: "craft cocktails" not "drinks", "late night" not "open"
- No duplicates within a restaurant
- Each restaurant should have at least one tag from "vibe" and one from "cuisine"

Return ONLY valid JSON:
{"restaurants": [{"id": "uuid", "tags": [{"text": "hidden gem", "category": "vibe"}, {"text": "craft cocktails", "category": "feature"}]}]}

Restaurants:

${entries.join("\n\n---\n\n")}`;
}

async function stage6_tagRegeneration(supabase: ReturnType<typeof createAdminClient>, restaurants: RestaurantFull[]) {
  console.log("\n══════════════════════════════════════════");
  console.log("Stage 6: Tag Regeneration (Haiku 4.5)");
  console.log("══════════════════════════════════════════\n");

  const start = Date.now();
  let success = 0;
  let errors = 0;

  await processBatches(restaurants, BATCH_SIZES.haiku, async (batch) => {
    try {
      const prompt = buildStage6Prompt(batch);
      const response = await askClaudeWithRetry(prompt, {
        model: MODELS.tags,
        maxTokens: 4096,
        temperature: 0.3,
      });

      const parsed = parseJsonResponse<{ restaurants: Array<{ id: string; tags: Array<{ text: string; category: string }> }> }>(response);
      if (!parsed.restaurants) throw new Error("No restaurants array in response");

      for (const result of parsed.restaurants) {
        const restaurant = batch.find((r) => r.id === result.id);
        if (!restaurant) continue;

        const validTags = (result.tags || [])
          .filter((t) => t.text && t.text.trim().length > 0)
          .map((t) => ({
            restaurant_id: restaurant.id,
            tag_text: t.text.toLowerCase().trim(),
            tag_category: t.category || null,
          }));

        if (DRY_RUN) {
          console.log(`  [DRY RUN] ${restaurant.name}: ${validTags.length} tags → [${validTags.map((t) => t.tag_text).join(", ")}]`);
        } else {
          // Delete existing tags first (idempotency)
          const { error: delErr } = await supabase.from("tags").delete().eq("restaurant_id", restaurant.id);
          if (delErr) console.error(`  Delete tags failed for ${restaurant.name}:`, delErr.message);

          // Insert new tags
          if (validTags.length > 0) {
            const { error: insErr } = await supabase.from("tags").insert(validTags);
            if (insErr) console.error(`  Insert tags failed for ${restaurant.name}:`, insErr.message);
          }

          restaurant.tags = validTags.map((t) => t.tag_text);
        }

        logAudit(restaurant.id, restaurant.name, 6, "tags", `[${restaurant.tags.length} old]`, `[${validTags.length} new]`, MODELS.tags, "");
        success++;
      }
    } catch (err) {
      console.error(`  Batch error:`, err);
      for (const r of batch) {
        failures.push({ restaurantId: r.id, restaurantName: r.name, stage: 6, error: String(err) });
        errors++;
      }
    }
  }, RATE_LIMITS_MS.haiku);

  console.log(`\nStage 6 complete: ${success} success, ${errors} errors (${Date.now() - start}ms)`);
  stageStats.push({ stage: 6, name: "Tag Regeneration", processed: restaurants.length, success, errors, elapsed: Date.now() - start, model: MODELS.tags });
}

// ==========================================
// STAGE 7: CONFIDENCE & METADATA UPDATE (no LLM)
// ==========================================

async function stage7_confidenceUpdate(supabase: ReturnType<typeof createAdminClient>, restaurants: RestaurantFull[]) {
  console.log("\n══════════════════════════════════════════");
  console.log("Stage 7: Confidence & Metadata Update (no LLM)");
  console.log("══════════════════════════════════════════\n");

  const start = Date.now();
  let success = 0;

  // Re-fetch all deep_profiles for accurate confidence calculation
  const { data: allDp } = await supabase.from("restaurant_deep_profiles").select("*").range(0, 9999);
  const dpMap = new Map<string, Record<string, unknown>>();
  for (const dp of allDp || []) {
    dpMap.set(dp.restaurant_id as string, dp as Record<string, unknown>);
  }

  // Re-fetch restaurants for updated values
  const { data: allR } = await supabase.from("restaurants").select("id, cuisine_type, noise_level, lighting_ambiance, dress_code, price_level, dietary_options").eq("is_active", true).range(0, 9999);
  const rMap = new Map<string, Record<string, unknown>>();
  for (const r of allR || []) {
    rMap.set(r.id as string, r as Record<string, unknown>);
  }

  // Weighted field definitions for confidence calculation
  // Critical (weight 3): fields directly used in factor computation that have high scoring impact
  // Important (weight 2): fields used in factor computation with moderate impact
  // Standard (weight 1): contextual fields
  const fieldWeights: Array<{ field: string; weight: number; table: "dp" | "r" }> = [
    // Critical (weight 3)
    { field: "service_style", weight: 3, table: "dp" },
    { field: "meal_pacing", weight: 3, table: "dp" },
    { field: "energy_level", weight: 3, table: "dp" },
    { field: "conversation_friendliness", weight: 3, table: "dp" },
    { field: "kid_friendliness", weight: 3, table: "dp" },
    { field: "music_vibe", weight: 3, table: "dp" },
    { field: "noise_level", weight: 3, table: "r" },
    { field: "cuisine_type", weight: 3, table: "r" },
    { field: "lighting_ambiance", weight: 3, table: "r" },
    { field: "dress_code", weight: 3, table: "r" },
    { field: "price_level", weight: 3, table: "r" },
    { field: "dietary_options", weight: 3, table: "r" },
    // Important (weight 2)
    { field: "flavor_profiles", weight: 2, table: "dp" },
    { field: "signature_dishes", weight: 2, table: "dp" },
    { field: "dietary_depth", weight: 2, table: "dp" },
    { field: "reservation_difficulty", weight: 2, table: "dp" },
    { field: "group_size_sweet_spot", weight: 2, table: "dp" },
    { field: "cultural_authenticity", weight: 2, table: "dp" },
    // Standard (weight 1)
    { field: "cuisine_subcategory", weight: 1, table: "dp" },
    { field: "spice_level", weight: 1, table: "dp" },
    { field: "typical_wait_minutes", weight: 1, table: "dp" },
    { field: "check_average_per_person", weight: 1, table: "dp" },
    { field: "tipping_culture", weight: 1, table: "dp" },
    { field: "menu_depth", weight: 1, table: "dp" },
    { field: "origin_story", weight: 1, table: "dp" },
    { field: "decor_style", weight: 1, table: "dp" },
    { field: "seating_options", weight: 1, table: "dp" },
    { field: "crowd_profile", weight: 1, table: "dp" },
    { field: "neighborhood_integration", weight: 1, table: "dp" },
    { field: "transit_accessibility", weight: 1, table: "dp" },
    { field: "byob_policy", weight: 1, table: "dp" },
    { field: "instagram_worthiness", weight: 1, table: "dp" },
    { field: "date_progression", weight: 1, table: "dp" },
    { field: "seasonal_relevance", weight: 1, table: "dp" },
    { field: "wow_factors", weight: 1, table: "dp" },
    { field: "best_seat_in_house", weight: 1, table: "dp" },
    { field: "unique_selling_point", weight: 1, table: "dp" },
  ];

  const totalWeight = fieldWeights.reduce((sum, f) => sum + f.weight, 0);

  for (const restaurant of restaurants) {
    const dp = dpMap.get(restaurant.id);
    const r = rMap.get(restaurant.id);
    if (!dp) continue;

    let filledWeight = 0;
    for (const fw of fieldWeights) {
      const source = fw.table === "dp" ? dp : r;
      if (!source) continue;
      const val = source[fw.field];
      if (val !== null && val !== undefined) {
        if (typeof val === "string" && val.trim() === "") continue;
        if (Array.isArray(val) && val.length === 0) continue;
        filledWeight += fw.weight;
      }
    }

    const confidence = Math.min(1.0, filledWeight / totalWeight);
    const roundedConf = Math.round(confidence * 100) / 100;

    if (DRY_RUN) {
      console.log(`  [DRY RUN] ${restaurant.name}: confidence=${roundedConf.toFixed(2)} (${filledWeight}/${totalWeight})`);
    } else {
      const { error } = await supabase
        .from("restaurant_deep_profiles")
        .update({
          enrichment_confidence: roundedConf,
          enrichment_version: 3,
          enriched_at: new Date().toISOString(),
        })
        .eq("restaurant_id", restaurant.id);
      if (error) console.error(`  Update failed for ${restaurant.name}:`, error.message);
    }

    logAudit(restaurant.id, restaurant.name, 7, "enrichment_confidence", "?", roundedConf.toFixed(2), "none", "");
    success++;
  }

  console.log(`\nStage 7 complete: ${success} restaurants updated (${Date.now() - start}ms)`);
  stageStats.push({ stage: 7, name: "Confidence Update", processed: restaurants.length, success, errors: 0, elapsed: Date.now() - start, model: null });
}

// ==========================================
// MAIN
// ==========================================

async function main() {
  const supabase = createAdminClient();
  const startTime = Date.now();

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   DondeAI V3 Full Dataset Enrichment Pipeline       ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
  console.log(`Mode:        ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE (writing to DB)"}`);
  console.log(`Limit:       ${LIMIT === Infinity ? "all" : LIMIT}`);
  console.log(`Start stage: ${START_STAGE}`);
  console.log(`Resume:      ${RESUME}`);
  console.log(`Models:      Haiku=${MODELS.structured}, Sonnet=${MODELS.rich}`);
  console.log("");

  // Initialize audit log
  const isNewLog = !RESUME || !fs.existsSync(AUDIT_LOG_FILE);
  auditLogStream = fs.createWriteStream(AUDIT_LOG_FILE, { flags: RESUME ? "a" : "w" });
  if (isNewLog) {
    auditLogStream.write("timestamp,restaurant_id,restaurant_name,stage,field,old_value,new_value,model,confidence\n");
  }

  // Checkpoint handling
  let checkpoint: Checkpoint | null = null;
  if (RESUME) {
    checkpoint = loadCheckpoint();
    if (checkpoint) {
      console.log(`Resuming from checkpoint: stage=${checkpoint.stage}, processed=${checkpoint.processedIds.length}`);
    }
  }

  // Fetch all restaurants with full data
  console.log("Fetching restaurant data...");
  const { data: rawRestaurants, error: rErr } = await supabase
    .from("restaurants")
    .select(`
      id, name, address, cuisine_type, price_level, noise_level, lighting_ambiance,
      dress_code, dietary_options, best_for_oneliner, insider_tip, outdoor_seating,
      live_music, best_times, good_for, ambiance,
      neighborhoods!inner(name, description),
      tags(tag_text),
      restaurant_deep_profiles(*)
    `)
    .eq("is_active", true)
    .limit(10000);

  if (rErr) {
    console.error("Failed to fetch restaurants:", rErr);
    process.exit(1);
  }

  // Flatten joined data
  const restaurants: RestaurantFull[] = ((rawRestaurants || []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    address: r.address as string,
    cuisine_type: r.cuisine_type as string | null,
    price_level: r.price_level as string | null,
    noise_level: r.noise_level as string | null,
    lighting_ambiance: r.lighting_ambiance as string | null,
    dress_code: r.dress_code as string | null,
    dietary_options: r.dietary_options as string[] | null,
    best_for_oneliner: r.best_for_oneliner as string | null,
    insider_tip: r.insider_tip as string | null,
    outdoor_seating: r.outdoor_seating as boolean | null,
    live_music: r.live_music as boolean | null,
    best_times: r.best_times as string[] | null,
    good_for: r.good_for as string[] | null,
    ambiance: r.ambiance as string[] | null,
    neighborhood_name: (r.neighborhoods as Record<string, unknown>)?.name as string | null ?? null,
    neighborhood_description: (r.neighborhoods as Record<string, unknown>)?.description as string | null ?? null,
    tags: ((r.tags as Array<Record<string, unknown>>) || []).map((t) => t.tag_text as string),
    deep_profile: Array.isArray(r.restaurant_deep_profiles) && r.restaurant_deep_profiles.length > 0
      ? r.restaurant_deep_profiles[0] as Record<string, unknown>
      : null,
  }));

  // Apply limit
  const limited = restaurants.slice(0, LIMIT === Infinity ? restaurants.length : LIMIT);

  console.log(`Loaded ${restaurants.length} restaurants (processing ${limited.length})\n`);

  // Run stages
  const stages = [
    { num: 1, fn: () => stage1_integrityFixes(supabase, limited) },
    { num: 2, fn: () => stage2_structuredEnrichment(supabase, limited) },
    { num: 3, fn: () => stage3_richContent(supabase, limited) },
    { num: 4, fn: () => stage4_premiumContent(supabase, limited) },
    { num: 5, fn: () => stage5_occasionScores(supabase, limited) },
    { num: 6, fn: () => stage6_tagRegeneration(supabase, limited) },
    { num: 7, fn: () => stage7_confidenceUpdate(supabase, limited) },
  ];

  for (const stage of stages) {
    if (stage.num < START_STAGE) {
      console.log(`Skipping stage ${stage.num} (starting from ${START_STAGE})`);
      continue;
    }
    if (checkpoint && stage.num < checkpoint.stage) {
      console.log(`Skipping stage ${stage.num} (checkpoint: stage ${checkpoint.stage})`);
      continue;
    }

    await stage.fn();

    // Save checkpoint after each stage
    saveCheckpoint({
      stage: stage.num + 1,
      lastProcessedIndex: limited.length,
      processedIds: limited.map((r) => r.id),
      startedAt: new Date(startTime).toISOString(),
    });
  }

  // Close audit log
  auditLogStream?.end();

  // Write summary
  const totalElapsed = Date.now() - startTime;
  const summary = {
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date().toISOString(),
    elapsedMs: totalElapsed,
    elapsedMinutes: (totalElapsed / 60000).toFixed(1),
    mode: DRY_RUN ? "dry_run" : "live",
    restaurantsProcessed: limited.length,
    stages: stageStats,
    totalSuccess: stageStats.reduce((sum, s) => sum + s.success, 0),
    totalErrors: stageStats.reduce((sum, s) => sum + s.errors, 0),
    failureCount: failures.length,
  };
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));

  // Write failures
  if (failures.length > 0) {
    fs.writeFileSync(FAILURES_FILE, JSON.stringify(failures, null, 2));
  }

  // Clean up checkpoint on successful completion
  if (failures.length === 0 && fs.existsSync(CHECKPOINT_FILE)) {
    fs.unlinkSync(CHECKPOINT_FILE);
  }

  // Print summary
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   ENRICHMENT COMPLETE                                ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  console.log(`Restaurants processed: ${limited.length}`);
  console.log(`Total time:           ${(totalElapsed / 60000).toFixed(1)} minutes`);
  console.log(`Mode:                 ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log("");

  console.log("Per-Stage Results:");
  for (const s of stageStats) {
    console.log(`  Stage ${s.stage} (${s.name}): ${s.success} ok, ${s.errors} errors, ${(s.elapsed / 1000).toFixed(1)}s${s.model ? ` [${s.model}]` : ""}`);
  }

  if (failures.length > 0) {
    console.log(`\n⚠ ${failures.length} failures logged to ${FAILURES_FILE}`);
  }

  console.log(`\nOutput files:`);
  console.log(`  ${AUDIT_LOG_FILE} — Field-level change log`);
  console.log(`  ${SUMMARY_FILE}    — Aggregate stats`);
  if (failures.length > 0) console.log(`  ${FAILURES_FILE}  — Error details`);
}

// ==========================================
// EXPORTS (for enrich-new-or-gaps.ts)
// ==========================================

export {
  // Types
  type RestaurantFull,
  type StageStats,
  type Checkpoint,
  // Config
  MODELS,
  BATCH_SIZES,
  RATE_LIMITS_MS,
  SYSTEM_CONTEXT,
  // Helpers
  logAudit,
  saveCheckpoint,
  loadCheckpoint,
  askClaudeWithRetry,
  clamp,
  // Stages
  stage1_integrityFixes,
  stage2_structuredEnrichment,
  stage3_richContent,
  stage4_premiumContent,
  stage5_occasionScores,
  stage6_tagRegeneration,
  stage7_confidenceUpdate,
};

// Allow external callers to set the shared mutable state
export function initPipelineState(opts: {
  auditStream: fs.WriteStream | null;
}) {
  auditLogStream = opts.auditStream;
  failures = [];
  stageStats = [];
}

export function getPipelineState() {
  return { failures, stageStats };
}

// Only run main() when executed directly (not imported)
const isDirectRun = process.argv[1]?.includes("enrich-full-dataset");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Enrichment pipeline failed:", err);
    process.exit(1);
  });
}
