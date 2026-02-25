/**
 * V4 Enrichment Gap Audit
 *
 * Read-only script that reports which restaurants are missing:
 * - insider_tip (on restaurants table)
 * - origin_story (on restaurant_deep_profiles table)
 *
 * Usage:
 *   npx tsx scripts/pipelines/audit-enrichment-gaps.ts
 */

import { createAdminClient } from "../lib/supabase";

async function main() {
  const supabase = createAdminClient();

  console.log("=== DondeAI V4 Enrichment Gap Audit ===\n");

  // 1. Total active restaurants
  const { count: totalCount } = await supabase
    .from("restaurants")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  console.log(`Total active restaurants: ${totalCount}\n`);

  // 2. Missing insider_tip
  const { data: missingTips, count: missingTipCount } = await supabase
    .from("restaurants")
    .select("id, name, cuisine_type, neighborhood_id", { count: "exact" })
    .eq("is_active", true)
    .or("insider_tip.is.null,insider_tip.eq.");

  console.log(`Missing insider_tip: ${missingTipCount}/${totalCount}`);
  if (missingTips && missingTips.length > 0) {
    console.log("  Sample restaurants missing tips:");
    missingTips.slice(0, 10).forEach((r) => {
      console.log(`    - ${r.name} (${r.cuisine_type || "no cuisine"})`);
    });
    if (missingTips.length > 10) {
      console.log(`    ... and ${missingTips.length - 10} more`);
    }
  }

  // 3. Missing origin_story in deep profiles
  const { data: missingStories, count: missingStoryCount } = await supabase
    .from("restaurant_deep_profiles")
    .select("restaurant_id", { count: "exact" })
    .or("origin_story.is.null,origin_story.eq.");

  console.log(`\nMissing origin_story: ${missingStoryCount}`);

  // 4. Restaurants with NO deep profile at all
  const { data: allRestaurants } = await supabase
    .from("restaurants")
    .select("id")
    .eq("is_active", true);

  const { data: enrichedProfiles } = await supabase
    .from("restaurant_deep_profiles")
    .select("restaurant_id");

  const enrichedIds = new Set(enrichedProfiles?.map((p) => p.restaurant_id) || []);
  const unenriched = allRestaurants?.filter((r) => !enrichedIds.has(r.id)) || [];

  console.log(`\nNo deep profile at all: ${unenriched.length}/${totalCount}`);

  // 5. Low enrichment confidence
  const { data: lowConf, count: lowConfCount } = await supabase
    .from("restaurant_deep_profiles")
    .select("restaurant_id, enrichment_confidence", { count: "exact" })
    .lt("enrichment_confidence", 3);

  console.log(`Low enrichment confidence (<3): ${lowConfCount}`);

  // 6. Summary
  console.log("\n=== Summary ===");
  console.log(`Restaurants needing insider_tip backfill: ${missingTipCount}`);
  console.log(`Restaurants needing origin_story backfill: ${missingStoryCount}`);
  console.log(`Restaurants needing full enrichment: ${unenriched.length}`);
  console.log(`Total restaurants needing any V4 enrichment: ${
    new Set([
      ...(missingTips?.map((r) => r.id) || []),
      ...(missingStories?.map((r) => r.restaurant_id) || []),
      ...unenriched.map((r) => r.id),
    ]).size
  }`);
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
