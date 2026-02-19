/**
 * Pipeline: Analytics — Compute trending and popularity signals
 * Enhancement 11: Query analytics pipeline
 * Reads user_queries to compute recommendation counts and trending scores.
 * Schedule: Daily (or triggered manually)
 */

import { createAdminClient } from "../lib/supabase.js";

const DRY_RUN = process.env.DRY_RUN === "true";

async function main() {
  console.log("=== Analytics Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const supabase = createAdminClient();

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Get recommendation counts per restaurant for 7d and 30d windows
  const { data: queries7d, error: e7d } = await supabase
    .from("user_queries")
    .select("recommended_restaurant_id")
    .gte("created_at", sevenDaysAgo)
    .not("recommended_restaurant_id", "is", null);

  const { data: queries30d, error: e30d } = await supabase
    .from("user_queries")
    .select("recommended_restaurant_id")
    .gte("created_at", thirtyDaysAgo)
    .not("recommended_restaurant_id", "is", null);

  if (e7d) throw e7d;
  if (e30d) throw e30d;

  // Count recommendations per restaurant
  const counts7d = new Map<string, number>();
  for (const q of queries7d || []) {
    const id = q.recommended_restaurant_id;
    counts7d.set(id, (counts7d.get(id) || 0) + 1);
  }

  const counts30d = new Map<string, number>();
  for (const q of queries30d || []) {
    const id = q.recommended_restaurant_id;
    counts30d.set(id, (counts30d.get(id) || 0) + 1);
  }

  // Get all restaurant IDs
  const allIds = new Set([...counts7d.keys(), ...counts30d.keys()]);
  console.log(`Computing popularity for ${allIds.size} restaurants`);

  const rows: Array<{
    restaurant_id: string;
    recommendation_count_7d: number;
    recommendation_count_30d: number;
    trending_score: number;
    query_demand_score: number;
    computed_at: string;
  }> = [];

  for (const id of allIds) {
    const count7d = counts7d.get(id) || 0;
    const count30d = counts30d.get(id) || 0;

    // Trending score: ratio of 7d to weekly average from 30d
    // A score > 1.0 means the restaurant is trending upward
    const weeklyAvg30d = count30d / 4.3; // ~4.3 weeks in 30 days
    const trending = weeklyAvg30d > 0 ? count7d / weeklyAvg30d : (count7d > 0 ? 2.0 : 0);
    const trendingScore = Math.min(10, Math.max(0, trending * 2)); // Scale to 0-10

    // Query demand score: based on absolute recommendation frequency
    const demandScore = Math.min(10, count30d / 3); // 30 recs/month = max score

    rows.push({
      restaurant_id: id,
      recommendation_count_7d: count7d,
      recommendation_count_30d: count30d,
      trending_score: parseFloat(trendingScore.toFixed(2)),
      query_demand_score: parseFloat(demandScore.toFixed(2)),
      computed_at: now.toISOString(),
    });
  }

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would upsert ${rows.length} popularity records`);
    const top5 = rows.sort((a, b) => b.trending_score - a.trending_score).slice(0, 5);
    console.log("Top 5 trending:");
    for (const r of top5) {
      console.log(`  ${r.restaurant_id}: 7d=${r.recommendation_count_7d}, 30d=${r.recommendation_count_30d}, trending=${r.trending_score}`);
    }
    return;
  }

  // Upsert in batches of 50
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error: upsertError } = await supabase
      .from("restaurant_popularity")
      .upsert(batch, { onConflict: "restaurant_id" });

    if (upsertError) {
      console.error(`Failed to upsert batch starting at ${i}:`, upsertError);
    }
  }

  console.log(`Updated popularity for ${rows.length} restaurants`);
  console.log("Analytics pipeline complete.");
}

main().catch((err) => {
  console.error("Analytics pipeline failed:", err);
  process.exit(1);
});
