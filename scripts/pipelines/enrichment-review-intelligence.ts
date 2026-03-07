/**
 * Pipeline: Enrichment — Review Intelligence Semantic Descriptors
 *
 * Extracts semantic descriptors from restaurant data for V11 semantic matching.
 * Uses Claude Haiku to generate conceptual descriptors, scenario-based tags,
 * and comparable restaurant references from existing review intelligence and
 * deep profile data.
 *
 * Updates: restaurant_review_intelligence.semantic_descriptors,
 *          restaurant_review_intelligence.best_for_scenarios,
 *          restaurant_review_intelligence.comparable_restaurants
 *
 * Schedule: On-demand / after review intelligence refresh
 */

import { createAdminClient } from "../lib/supabase.js";
import { askClaude, parseJsonResponse } from "../lib/claude.js";
import { processBatches } from "../lib/batch.js";

const DRY_RUN = process.env.DRY_RUN === "true";

// --- Schema Auto-Migration ---

const MIGRATION_SQL = `
ALTER TABLE restaurant_review_intelligence
  ADD COLUMN IF NOT EXISTS semantic_descriptors text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS best_for_scenarios text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS comparable_restaurants text[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_ri_semantic ON restaurant_review_intelligence USING GIN (semantic_descriptors);
CREATE INDEX IF NOT EXISTS idx_ri_scenarios ON restaurant_review_intelligence USING GIN (best_for_scenarios);
CREATE INDEX IF NOT EXISTS idx_ri_comparable ON restaurant_review_intelligence USING GIN (comparable_restaurants);
`;

/**
 * Probe the schema and auto-apply migration if semantic columns are missing.
 * A "Bad Request" from PostgREST means the column doesn't exist yet.
 */
async function ensureSchema(supabase: ReturnType<typeof createAdminClient>): Promise<void> {
  const { error } = await supabase
    .from("restaurant_review_intelligence")
    .select("semantic_descriptors")
    .limit(1);

  if (!error) return; // columns already exist

  console.error(
    "\n╔═══════════════════════════════════════════════════════════════╗\n" +
    "║  Missing columns: semantic_descriptors, best_for_scenarios,  ║\n" +
    "║  comparable_restaurants on restaurant_review_intelligence     ║\n" +
    "║                                                              ║\n" +
    "║  Run ONE of these to fix:                                    ║\n" +
    "║   1. supabase db push        (from repo root)                ║\n" +
    "║   2. Paste this SQL in Supabase Dashboard → SQL Editor:      ║\n" +
    "╚═══════════════════════════════════════════════════════════════╝\n"
  );
  console.error(MIGRATION_SQL);
  throw new Error("Schema migration required — see above.");
}

// --- Types ---

interface SemanticEnrichment {
  semantic_descriptors: string[];
  best_for_scenarios: string[];
  comparable_restaurants: string[];
}

interface RestaurantRow {
  id: string;
  name: string;
  cuisine_type: string | null;
  best_for_oneliner: string | null;
  noise_level: string | null;
  lighting_ambiance: string | null;
  dish_catalog: unknown;
  popular_dishes: unknown;
  cuisine_signals: unknown;
  wow_factors: string[] | null;
  crowd_profile: string[] | null;
  origin_story: string | null;
  unique_selling_point: string | null;
  awards_recognition: string[] | null;
  chef_notable: boolean | null;
  service_style: string | null;
  decor_style: string | null;
}

// --- Prompt Builder ---

function buildPrompt(r: RestaurantRow): string {
  const popularDishes =
    r.popular_dishes != null
      ? typeof r.popular_dishes === "string"
        ? r.popular_dishes
        : JSON.stringify(r.popular_dishes)
      : "N/A";

  const wowFactors =
    r.wow_factors && r.wow_factors.length > 0
      ? r.wow_factors.join(", ")
      : "N/A";

  const crowd =
    r.crowd_profile && r.crowd_profile.length > 0
      ? r.crowd_profile.join(", ")
      : "N/A";

  const awards =
    r.awards_recognition && r.awards_recognition.length > 0
      ? r.awards_recognition.join(", ")
      : "N/A";

  return `Given this Chicago restaurant's data, extract semantic descriptors for search matching.

Restaurant: ${r.name}
Cuisine: ${r.cuisine_type || "N/A"}
One-liner: ${r.best_for_oneliner || "N/A"}
Popular dishes: ${popularDishes}
Wow factors: ${wowFactors}
Crowd: ${crowd}
Awards: ${awards}
Service: ${r.service_style || "N/A"}
Ambiance: ${r.noise_level || "N/A"}, ${r.lighting_ambiance || "N/A"}, ${r.decor_style || "N/A"}
Origin: ${r.origin_story || "N/A"}
USP: ${r.unique_selling_point || "N/A"}

Return JSON only:
{
  "semantic_descriptors": ["string (3-8 conceptual descriptors like 'celebrity hotspot', 'power lunch spot', 'Instagram-worthy', 'pre-theater dinner', 'late night hangout')"],
  "best_for_scenarios": ["string (3-6 scenario tags like 'anniversary dinner', 'client entertainment', 'birthday celebration', 'pre-game dinner', 'quick lunch between meetings')"],
  "comparable_restaurants": ["string (0-3 similar restaurants in Chicago, e.g. 'if you like Girl & the Goat', 'comparable to Alinea')"]
}`;
}

// --- Main ---

async function main() {
  console.log("=== Review Intelligence Semantic Descriptors Pipeline ===");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const supabase = createAdminClient();

  // Auto-apply migration if semantic columns don't exist yet
  await ensureSchema(supabase);

  // Fetch all RI rows with semantic_descriptors for filtering
  // (dish_catalog/popular_dishes/cuisine_signals are large JSON — fetch later per-batch)
  const { data: restaurants, error: fetchErr, count } = await supabase
    .from("restaurant_review_intelligence")
    .select("restaurant_id,semantic_descriptors", { count: "exact" });

  if (fetchErr) {
    console.error("Fetch error details:", JSON.stringify(fetchErr, null, 2));
    console.error("Status:", (fetchErr as any).status, "Code:", (fetchErr as any).code);
    throw fetchErr;
  }

  // Filter to those needing enrichment (null or empty array)
  const needsEnrichment = (restaurants || []).filter(
    (ri) =>
      ri.semantic_descriptors === null ||
      (Array.isArray(ri.semantic_descriptors) && ri.semantic_descriptors.length === 0)
  );

  if (needsEnrichment.length === 0) {
    console.log("All restaurants already have semantic descriptors. Done.");
    return;
  }

  // Fetch restaurant details and deep profiles for context
  const restaurantIds = needsEnrichment.map((ri) => ri.restaurant_id);

  const { data: restaurantDetails, error: rErr } = await supabase
    .from("restaurants")
    .select("id, name, cuisine_type, best_for_oneliner, noise_level, lighting_ambiance")
    .in("id", restaurantIds);
  if (rErr) throw rErr;

  const { data: deepProfiles, error: dpErr } = await supabase
    .from("restaurant_deep_profiles")
    .select("restaurant_id, wow_factors, crowd_profile, origin_story, unique_selling_point, awards_recognition, chef_notable, service_style, decor_style")
    .in("restaurant_id", restaurantIds);
  if (dpErr) throw dpErr;

  const restaurantMap = new Map(
    (restaurantDetails || []).map((r) => [r.id, r])
  );
  const deepProfileMap = new Map(
    (deepProfiles || []).map((dp) => [dp.restaurant_id, dp])
  );
  const riMap = new Map(
    needsEnrichment.map((ri) => [ri.restaurant_id, ri])
  );

  // Build combined rows sorted by name
  const combined: RestaurantRow[] = restaurantIds
    .map((id) => {
      const r = restaurantMap.get(id);
      const dp = deepProfileMap.get(id);
      const ri = riMap.get(id);
      if (!r) return null;
      return {
        id: r.id,
        name: r.name,
        cuisine_type: r.cuisine_type,
        best_for_oneliner: r.best_for_oneliner,
        noise_level: r.noise_level,
        lighting_ambiance: r.lighting_ambiance,
        dish_catalog: ri?.dish_catalog ?? null,
        popular_dishes: ri?.popular_dishes ?? null,
        cuisine_signals: ri?.cuisine_signals ?? null,
        wow_factors: dp?.wow_factors ?? null,
        crowd_profile: dp?.crowd_profile ?? null,
        origin_story: dp?.origin_story ?? null,
        unique_selling_point: dp?.unique_selling_point ?? null,
        awards_recognition: dp?.awards_recognition ?? null,
        chef_notable: dp?.chef_notable ?? null,
        service_style: dp?.service_style ?? null,
        decor_style: dp?.decor_style ?? null,
      } as RestaurantRow;
    })
    .filter((r): r is RestaurantRow => r !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`Found ${combined.length} restaurants needing semantic descriptors`);

  // Cost estimate: ~300 input tokens + ~150 output tokens per restaurant (Haiku)
  const estimatedInputTokens = combined.length * 300;
  const estimatedOutputTokens = combined.length * 150;
  const estimatedCost =
    (estimatedInputTokens / 1_000_000) * 0.8 +
    (estimatedOutputTokens / 1_000_000) * 4.0;
  console.log(
    `Estimated cost: ~$${estimatedCost.toFixed(2)} (${combined.length} restaurants × Haiku)`
  );

  let successCount = 0;
  let failCount = 0;

  // Process in batches of 20, 1s delay between batches
  await processBatches(combined, 20, async (batch) => {
    // Process each restaurant individually (one Claude call each for precise extraction)
    for (const restaurant of batch) {
      try {
        const prompt = buildPrompt(restaurant);

        if (DRY_RUN) {
          console.log(`  [DRY RUN] Would extract semantic descriptors for ${restaurant.name}`);
          successCount++;
          continue;
        }

        const response = await askClaude(prompt, {
          model: "claude-haiku-4-5-20251001",
          maxTokens: 1024,
          temperature: 0.3,
        });

        const parsed = parseJsonResponse<SemanticEnrichment>(response);

        // Validate arrays
        const descriptors = Array.isArray(parsed.semantic_descriptors)
          ? parsed.semantic_descriptors
          : [];
        const scenarios = Array.isArray(parsed.best_for_scenarios)
          ? parsed.best_for_scenarios
          : [];
        const comparables = Array.isArray(parsed.comparable_restaurants)
          ? parsed.comparable_restaurants
          : [];

        const { error: updateErr } = await supabase
          .from("restaurant_review_intelligence")
          .update({
            semantic_descriptors: descriptors,
            best_for_scenarios: scenarios,
            comparable_restaurants: comparables,
          })
          .eq("restaurant_id", restaurant.id);

        if (updateErr) {
          console.error(`  Failed to update ${restaurant.name}:`, updateErr);
          failCount++;
        } else {
          console.log(
            `  Enriched: ${restaurant.name} — ${descriptors.length} descriptors, ${scenarios.length} scenarios, ${comparables.length} comparables`
          );
          successCount++;
        }
      } catch (err) {
        console.error(`  Error processing ${restaurant.name}:`, err);
        failCount++;
      }
    }
  }, 1000); // 1s delay between batches

  console.log("\n=== Pipeline Complete ===");
  console.log(`Success: ${successCount} | Failed: ${failCount} | Total: ${combined.length}`);
}

main().catch((err) => {
  console.error("Review Intelligence Semantic Descriptors pipeline failed:", err);
  process.exit(1);
});
