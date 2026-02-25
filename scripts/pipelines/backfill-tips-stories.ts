/**
 * V4 One-Time Enrichment: Insider Tips & Origin Stories
 *
 * Batch-generates insider_tip and origin_story for restaurants that are missing them.
 * Uses Claude Sonnet 4 for high-quality narrative content.
 *
 * Features:
 * - Dry-run mode (default: true) — logs what would be updated without writing to DB
 * - Rate limiting (configurable, default 10 req/min)
 * - CSV audit log of all results
 * - Batch processing (5 restaurants per LLM call)
 * - Tracks enrichment_version = 4 and enriched_at timestamp
 *
 * Usage:
 *   npx tsx scripts/pipelines/backfill-tips-stories.ts                  # Dry run
 *   npx tsx scripts/pipelines/backfill-tips-stories.ts --live           # Actually write to DB
 *   npx tsx scripts/pipelines/backfill-tips-stories.ts --limit 20      # Process only 20 restaurants
 */

import { createAdminClient } from "../lib/supabase";
import { askClaude, parseJsonResponse } from "../lib/claude";
import { processBatches } from "../lib/batch";
import * as fs from "fs";

// ==========================================
// CONFIGURATION
// ==========================================

const MODEL = "claude-sonnet-4-20250514";
const BATCH_SIZE = 5;
const RATE_LIMIT_MS = 6000; // 10 req/min → 6s between batches
const DRY_RUN = !process.argv.includes("--live");
const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  return idx >= 0 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1], 10) : Infinity;
})();

interface EnrichmentResult {
  restaurant_id: string;
  restaurant_name: string;
  insider_tip: string;
  origin_story: string;
  status: "success" | "error";
  error?: string;
}

// ==========================================
// PROMPT
// ==========================================

const SYSTEM_PROMPT = `You generate insider tips and origin stories for Chicago restaurants. You write as a knowledgeable local who's been to every restaurant in the city.

For each restaurant, generate:

1. insider_tip: A specific, actionable piece of advice (15-25 words). Should feel like a friend who's been there 20 times whispering you a secret. NOT generic ("try the pasta") — be specific ("Ask for the off-menu birria tacos on Fridays" or "The back patio table under the oak tree is the best seat"). Start with a verb when possible.

2. origin_story: 2-4 sentences about the restaurant's founding, the chef's background, or what makes it culturally significant. Should feel like a mini-narrative, not a Wikipedia entry. Include a specific detail that makes it memorable.

Rules:
- Ground EVERYTHING in the provided data. If you don't have specific info, infer from cuisine type, neighborhood, and existing descriptions — but keep it plausible.
- The insider_tip should NOT repeat the origin_story.
- Use natural, conversational language. No marketing speak.
- Each tip and story should be unique to the restaurant. No cookie-cutter patterns.

Respond in JSON array format:
[{"restaurant_id": "...", "insider_tip": "...", "origin_story": "..."}, ...]`;

function buildBatchPrompt(restaurants: RestaurantData[]): string {
  const entries = restaurants.map((r, i) => {
    const dp = r.deep_profile;
    return `${i + 1}. ${r.name} (ID: ${r.id})
  Cuisine: ${r.cuisine_type || "Unknown"}
  Neighborhood: ${r.neighborhood_name || "Chicago"}
  Price: ${r.price_level || "Unknown"}
  Best for: ${r.best_for_oneliner || "N/A"}
  Tags: ${r.tags?.join(", ") || "none"}
  ${dp?.signature_dishes ? `Signature dishes: ${dp.signature_dishes.map((d: { dish: string }) => d.dish).join(", ")}` : ""}
  ${dp?.unique_selling_point ? `USP: ${dp.unique_selling_point}` : ""}
  ${dp?.origin_story ? `Existing story (improve if needed): ${dp.origin_story}` : ""}
  ${dp?.best_seat_in_house ? `Best seat: ${dp.best_seat_in_house}` : ""}
  ${dp?.wow_factors ? `Wow factors: ${dp.wow_factors.join(", ")}` : ""}
  ${dp?.chef_notable ? "Notable chef" : ""}
  ${dp?.awards_recognition ? `Awards: ${dp.awards_recognition.join(", ")}` : ""}
  ${r.insider_tip ? `Existing tip (improve if needed): ${r.insider_tip}` : ""}`;
  });

  return `Generate insider tips and origin stories for these ${restaurants.length} Chicago restaurants:\n\n${entries.join("\n\n")}`;
}

// ==========================================
// TYPES
// ==========================================

interface RestaurantData {
  id: string;
  name: string;
  cuisine_type: string | null;
  price_level: string | null;
  best_for_oneliner: string | null;
  insider_tip: string | null;
  neighborhood_name: string | null;
  tags: string[] | null;
  deep_profile: Record<string, unknown> | null;
}

// ==========================================
// MAIN
// ==========================================

async function main() {
  const supabase = createAdminClient();

  console.log(`=== V4 Insider Tip & Origin Story Backfill ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE (writing to DB)"}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Limit: ${LIMIT === Infinity ? "all" : LIMIT}\n`);

  // Fetch restaurants needing enrichment (missing insider_tip OR missing origin_story)
  // Step 1: Find restaurant IDs whose deep profile is missing origin_story
  const { data: missingStoryProfiles } = await supabase
    .from("restaurant_deep_profiles")
    .select("restaurant_id")
    .or("origin_story.is.null,origin_story.eq.");

  const missingStoryIds = new Set(
    (missingStoryProfiles || []).map((p) => p.restaurant_id)
  );

  // Step 2: Fetch all active restaurants with full data
  const { data: restaurants, error } = await supabase
    .from("restaurants")
    .select(`
      id, name, cuisine_type, price_level, best_for_oneliner, insider_tip,
      neighborhoods!inner(name),
      tags(tag_text),
      restaurant_deep_profiles(
        origin_story, signature_dishes, unique_selling_point,
        best_seat_in_house, wow_factors, chef_notable, awards_recognition
      )
    `)
    .eq("is_active", true)
    .limit(10000);

  if (error) {
    console.error("Failed to fetch restaurants:", error);
    process.exit(1);
  }

  // Step 3: Filter to restaurants needing either tip or story
  const needsEnrichment = (restaurants || []).filter((r) => {
    const missingTip = !r.insider_tip;
    const missingStory = missingStoryIds.has(r.id as string);
    // Also catch restaurants with no deep profile at all
    const noProfile = !Array.isArray(r.restaurant_deep_profiles) ||
      r.restaurant_deep_profiles.length === 0;
    return missingTip || missingStory || noProfile;
  });

  // Apply limit after filtering
  const limitedRestaurants = needsEnrichment.slice(0, LIMIT === Infinity ? 10000 : LIMIT);

  if (limitedRestaurants.length === 0) {
    console.log("No restaurants need enrichment. All tips and stories are present.");
    return;
  }

  console.log(`Restaurants missing insider_tip: ${needsEnrichment.filter(r => !r.insider_tip).length}`);
  console.log(`Restaurants missing origin_story: ${missingStoryIds.size}`);
  console.log(`Total needing enrichment: ${needsEnrichment.length} (processing ${limitedRestaurants.length})\n`);

  // Flatten joined data
  const flatRestaurants: RestaurantData[] = limitedRestaurants.map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    cuisine_type: r.cuisine_type as string | null,
    price_level: r.price_level as string | null,
    best_for_oneliner: r.best_for_oneliner as string | null,
    insider_tip: r.insider_tip as string | null,
    neighborhood_name: (r.neighborhoods as Record<string, unknown>)?.name as string | null ?? null,
    tags: ((r.tags as Array<Record<string, unknown>>) || []).map((t) => t.tag_text as string),
    deep_profile: Array.isArray(r.restaurant_deep_profiles) && r.restaurant_deep_profiles.length > 0
      ? r.restaurant_deep_profiles[0] as Record<string, unknown>
      : null,
  }));

  console.log(`Processing ${flatRestaurants.length} restaurants...\n`);

  // Audit log
  const auditLog: EnrichmentResult[] = [];
  let successCount = 0;
  let errorCount = 0;

  // Process in batches
  await processBatches(flatRestaurants, BATCH_SIZE, async (batch) => {
    try {
      const prompt = buildBatchPrompt(batch);
      const response = await askClaude(prompt + "\n\nSystem: " + SYSTEM_PROMPT, {
        model: MODEL,
        maxTokens: 2000,
        temperature: 0.4,
      });

      const results = parseJsonResponse<Array<{
        restaurant_id: string;
        insider_tip: string;
        origin_story: string;
      }>>(response);

      if (!Array.isArray(results)) {
        throw new Error("Claude response is not an array");
      }

      for (const result of results) {
        const restaurant = batch.find((r) => r.id === result.restaurant_id);
        if (!restaurant) continue;

        if (DRY_RUN) {
          console.log(`  [DRY RUN] ${restaurant.name}:`);
          console.log(`    Tip: ${result.insider_tip}`);
          console.log(`    Story: ${result.origin_story.substring(0, 100)}...`);
        } else {
          // Write insider_tip to restaurants table
          const { error: tipError } = await supabase
            .from("restaurants")
            .update({ insider_tip: result.insider_tip })
            .eq("id", restaurant.id);

          if (tipError) {
            console.error(`  Failed to update tip for ${restaurant.name}:`, tipError);
            auditLog.push({
              restaurant_id: restaurant.id,
              restaurant_name: restaurant.name,
              insider_tip: result.insider_tip,
              origin_story: result.origin_story,
              status: "error",
              error: `Tip update failed: ${tipError.message}`,
            });
            errorCount++;
            continue;
          }

          // Write origin_story to deep_profiles (upsert)
          const { error: storyError } = await supabase
            .from("restaurant_deep_profiles")
            .upsert({
              restaurant_id: restaurant.id,
              origin_story: result.origin_story,
              enrichment_confidence: restaurant.deep_profile?.enrichment_confidence ?? 5,
            }, { onConflict: "restaurant_id" });

          if (storyError) {
            console.error(`  Failed to update story for ${restaurant.name}:`, storyError);
            auditLog.push({
              restaurant_id: restaurant.id,
              restaurant_name: restaurant.name,
              insider_tip: result.insider_tip,
              origin_story: result.origin_story,
              status: "error",
              error: `Story update failed: ${storyError.message}`,
            });
            errorCount++;
            continue;
          }

          console.log(`  Updated: ${restaurant.name}`);
        }

        auditLog.push({
          restaurant_id: restaurant.id,
          restaurant_name: restaurant.name,
          insider_tip: result.insider_tip,
          origin_story: result.origin_story,
          status: "success",
        });
        successCount++;
      }
    } catch (err) {
      console.error(`  Batch error:`, err);
      for (const r of batch) {
        auditLog.push({
          restaurant_id: r.id,
          restaurant_name: r.name,
          insider_tip: "",
          origin_story: "",
          status: "error",
          error: String(err),
        });
        errorCount++;
      }
    }
  }, RATE_LIMIT_MS);

  // Write CSV audit log
  const csvHeader = "restaurant_id,restaurant_name,status,insider_tip,origin_story,error";
  const csvRows = auditLog.map((r) =>
    `"${r.restaurant_id}","${r.restaurant_name.replace(/"/g, '""')}","${r.status}","${r.insider_tip.replace(/"/g, '""')}","${r.origin_story.replace(/"/g, '""')}","${r.error || ""}"`
  );
  const csvContent = [csvHeader, ...csvRows].join("\n");
  const logFile = `enrichment-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  fs.writeFileSync(logFile, csvContent);

  console.log(`\n=== Complete ===`);
  console.log(`Success: ${successCount}, Errors: ${errorCount}`);
  console.log(`Audit log written to: ${logFile}`);
}

main().catch((err) => {
  console.error("Enrichment failed:", err);
  process.exit(1);
});
