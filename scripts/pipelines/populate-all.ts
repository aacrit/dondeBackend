/**
 * Orchestrator: Run all data pipelines in sequence to fully populate the database.
 * Usage: npm run populate (or DRY_RUN=true npm run populate)
 *
 * Pipeline chain:
 *   1. Discovery    → finds restaurants via Google Places API
 *   2. Enrichment   → adds ambiance, cuisine_type, dietary, booleans via Claude
 *   3. Scores       → generates 7 occasion scores per restaurant via Claude
 *   4. Tags         → generates 3-6 descriptive tags per restaurant via Claude
 *   5. Backfill     → fills cuisine_type + booleans for any already-enriched gaps
 *   6. Summary      → prints row counts for each table
 */

import { execSync } from "child_process";
import { createAdminClient } from "../lib/supabase.js";

const DRY_RUN = process.env.DRY_RUN === "true";

const steps = [
  { name: "Discovery", script: "pipelines/discovery.ts" },
  { name: "Enrichment", script: "pipelines/enrichment.ts" },
  { name: "Occasion Scores", script: "pipelines/generate-occasion-scores.ts" },
  { name: "Tags", script: "pipelines/generate-tags.ts" },
  { name: "Backfill New Fields", script: "pipelines/backfill-new-fields.ts" },
];

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   DondeAI — Full Data Population     ║");
  console.log(`║   Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}                        ║`);
  console.log("╚══════════════════════════════════════╝\n");

  const startTime = Date.now();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepNum = i + 1;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Step ${stepNum}/${steps.length}: ${step.name}`);
    console.log("=".repeat(60));

    try {
      const env = DRY_RUN ? "DRY_RUN=true " : "";
      execSync(`${env}npx tsx ${step.script}`, {
        stdio: "inherit",
        cwd: process.cwd(),
      });
      console.log(`\nStep ${stepNum} (${step.name}): COMPLETE`);
    } catch (err) {
      console.error(`\nStep ${stepNum} (${step.name}): FAILED`);
      console.error("Stopping pipeline chain. Fix the error above and re-run.");
      process.exit(1);
    }
  }

  // Print summary
  const elapsed = Math.round((Date.now() - startTime) / 1000);

  console.log(`\n${"=".repeat(60)}`);
  console.log("POPULATION SUMMARY");
  console.log("=".repeat(60));

  if (!DRY_RUN) {
    try {
      const supabase = createAdminClient();

      const [neighborhoods, restaurants, scores, tags] = await Promise.all([
        supabase.from("neighborhoods").select("id", { count: "exact", head: true }),
        supabase.from("restaurants").select("id", { count: "exact", head: true }),
        supabase.from("occasion_scores").select("id", { count: "exact", head: true }),
        supabase.from("tags").select("id", { count: "exact", head: true }),
      ]);

      console.log(`  Neighborhoods:   ${neighborhoods.count ?? "?"}`);
      console.log(`  Restaurants:     ${restaurants.count ?? "?"}`);
      console.log(`  Occasion Scores: ${scores.count ?? "?"}`);
      console.log(`  Tags:            ${tags.count ?? "?"}`);
    } catch {
      console.log("  (Could not fetch counts — check DB connection)");
    }
  } else {
    console.log("  (Skipped counts — DRY RUN mode)");
  }

  console.log(`\n  Total time: ${elapsed}s`);
  console.log("\nAll pipelines complete. Database is ready for recommendations.");
}

main().catch((err) => {
  console.error("Population orchestrator failed:", err);
  process.exit(1);
});
