/**
 * DondeAI Incremental Enrichment Pipeline — New & Gaps Only
 *
 * Identifies restaurants that are new (never enriched) or have incomplete
 * enrichment, then runs them through all 7 stages of the full pipeline.
 *
 * Candidate identification:
 *   1. No deep_profile row at all (brand new restaurant)
 *   2. enriched_at IS NULL (skeleton row, never completed)
 *   3. enrichment_version < 3 (ran through older pipeline)
 *   4. enrichment_confidence < threshold (incomplete enrichment)
 *   5. Missing critical fields: insider_tip, best_for_oneliner, origin_story
 *   6. No occasion_scores row
 *   7. No tags
 *
 * Usage:
 *   npx tsx scripts/pipelines/enrich-new-or-gaps.ts                        # Dry run audit
 *   npx tsx scripts/pipelines/enrich-new-or-gaps.ts --live                 # Write to DB
 *   npx tsx scripts/pipelines/enrich-new-or-gaps.ts --limit 10             # Cap at 10
 *   npx tsx scripts/pipelines/enrich-new-or-gaps.ts --confidence 0.7       # Custom threshold
 *   npx tsx scripts/pipelines/enrich-new-or-gaps.ts --audit-only           # Just report, no enrichment
 *   npx tsx scripts/pipelines/enrich-new-or-gaps.ts --stage 3              # Start from stage 3
 */

import { createAdminClient } from "../lib/supabase";
import * as fs from "fs";
import {
  type RestaurantFull,
  initPipelineState,
  getPipelineState,
  stage1_integrityFixes,
  stage2_structuredEnrichment,
  stage3_richContent,
  stage4_premiumContent,
  stage5_occasionScores,
  stage6_tagRegeneration,
  stage7_confidenceUpdate,
} from "./enrich-full-dataset";

// ==========================================
// CLI ARGS
// ==========================================

const DRY_RUN = !process.argv.includes("--live");
const AUDIT_ONLY = process.argv.includes("--audit-only");

const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  return idx >= 0 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1], 10) : Infinity;
})();

const CONFIDENCE_THRESHOLD = (() => {
  const idx = process.argv.indexOf("--confidence");
  return idx >= 0 && process.argv[idx + 1] ? parseFloat(process.argv[idx + 1]) : 0.6;
})();

const START_STAGE = (() => {
  const idx = process.argv.indexOf("--stage");
  return idx >= 0 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1], 10) : 1;
})();

// Output files (prefixed to distinguish from full pipeline)
const AUDIT_LOG_FILE = "incremental-enrichment-audit-log.csv";
const SUMMARY_FILE = "incremental-enrichment-summary.json";
const FAILURES_FILE = "incremental-enrichment-failures.json";

// ==========================================
// CANDIDATE IDENTIFICATION
// ==========================================

interface CandidateReason {
  restaurantId: string;
  restaurantName: string;
  reasons: string[];
}

async function identifyCandidates(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{ candidateIds: Set<string>; candidateReasons: CandidateReason[] }> {
  console.log("Identifying enrichment candidates...\n");

  const candidateMap = new Map<string, { name: string; reasons: string[] }>();

  function addCandidate(id: string, name: string, reason: string) {
    const existing = candidateMap.get(id);
    if (existing) {
      existing.reasons.push(reason);
    } else {
      candidateMap.set(id, { name, reasons: [reason] });
    }
  }

  // Fetch all active restaurant IDs
  const { data: allRestaurants, error: allErr } = await supabase
    .from("restaurants")
    .select("id, name, insider_tip, best_for_oneliner")
    .eq("is_active", true)
    .range(0, 9999);

  if (allErr) throw new Error(`Failed to fetch restaurants: ${allErr.message}`);
  const allIds = new Set((allRestaurants || []).map((r) => r.id));
  const restaurantNameMap = new Map((allRestaurants || []).map((r) => [r.id, r.name]));

  console.log(`  Total active restaurants: ${allIds.size}`);

  // --- Check 1: No deep_profile row at all ---
  const { data: dpRows } = await supabase
    .from("restaurant_deep_profiles")
    .select("restaurant_id, enriched_at, enrichment_version, enrichment_confidence, origin_story")
    .range(0, 9999);

  const dpMap = new Map((dpRows || []).map((d) => [d.restaurant_id, d]));
  let noProfileCount = 0;
  for (const id of allIds) {
    if (!dpMap.has(id)) {
      addCandidate(id, restaurantNameMap.get(id) || "?", "no deep_profile row");
      noProfileCount++;
    }
  }
  console.log(`  No deep_profile row:              ${noProfileCount}`);

  // --- Check 2: enriched_at IS NULL ---
  let nullEnrichedCount = 0;
  for (const [id, dp] of dpMap) {
    if (!allIds.has(id)) continue;
    if (dp.enriched_at === null) {
      addCandidate(id, restaurantNameMap.get(id) || "?", "enriched_at is NULL");
      nullEnrichedCount++;
    }
  }
  console.log(`  enriched_at IS NULL:              ${nullEnrichedCount}`);

  // --- Check 3: enrichment_version < 3 ---
  let oldVersionCount = 0;
  for (const [id, dp] of dpMap) {
    if (!allIds.has(id)) continue;
    if (dp.enrichment_version !== null && dp.enrichment_version < 3) {
      addCandidate(id, restaurantNameMap.get(id) || "?", `enrichment_version=${dp.enrichment_version} (< 3)`);
      oldVersionCount++;
    }
  }
  console.log(`  enrichment_version < 3:           ${oldVersionCount}`);

  // --- Check 4: Low confidence ---
  let lowConfCount = 0;
  for (const [id, dp] of dpMap) {
    if (!allIds.has(id)) continue;
    if (dp.enrichment_confidence !== null && dp.enrichment_confidence < CONFIDENCE_THRESHOLD) {
      addCandidate(id, restaurantNameMap.get(id) || "?", `confidence=${dp.enrichment_confidence} (< ${CONFIDENCE_THRESHOLD})`);
      lowConfCount++;
    }
  }
  console.log(`  confidence < ${CONFIDENCE_THRESHOLD}:              ${lowConfCount}`);

  // --- Check 5: Missing critical fields ---
  let missingCriticalCount = 0;
  for (const r of allRestaurants || []) {
    const reasons: string[] = [];
    if (!r.insider_tip) reasons.push("missing insider_tip");
    if (!r.best_for_oneliner) reasons.push("missing best_for_oneliner");

    const dp = dpMap.get(r.id);
    if (dp && !dp.origin_story) reasons.push("missing origin_story");

    if (reasons.length > 0) {
      for (const reason of reasons) addCandidate(r.id, r.name, reason);
      missingCriticalCount++;
    }
  }
  console.log(`  Missing critical fields:          ${missingCriticalCount}`);

  // --- Check 6: No occasion_scores row ---
  const { data: scoreRows } = await supabase
    .from("occasion_scores")
    .select("restaurant_id")
    .range(0, 9999);

  const scoreIds = new Set((scoreRows || []).map((s) => s.restaurant_id));
  let noScoresCount = 0;
  for (const id of allIds) {
    if (!scoreIds.has(id)) {
      addCandidate(id, restaurantNameMap.get(id) || "?", "no occasion_scores");
      noScoresCount++;
    }
  }
  console.log(`  No occasion_scores:               ${noScoresCount}`);

  // --- Check 7: No tags ---
  const { data: tagRows } = await supabase
    .from("tags")
    .select("restaurant_id")
    .range(0, 9999);

  const tagIds = new Set((tagRows || []).map((t) => t.restaurant_id));
  let noTagsCount = 0;
  for (const id of allIds) {
    if (!tagIds.has(id)) {
      addCandidate(id, restaurantNameMap.get(id) || "?", "no tags");
      noTagsCount++;
    }
  }
  console.log(`  No tags:                          ${noTagsCount}`);

  // Build deduplicated result
  const candidateReasons: CandidateReason[] = [];
  for (const [id, info] of candidateMap) {
    candidateReasons.push({ restaurantId: id, restaurantName: info.name, reasons: info.reasons });
  }

  // Sort by number of reasons (worst first)
  candidateReasons.sort((a, b) => b.reasons.length - a.reasons.length);

  return { candidateIds: new Set(candidateMap.keys()), candidateReasons };
}

// ==========================================
// MAIN
// ==========================================

async function main() {
  const supabase = createAdminClient();
  const startTime = Date.now();

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   DondeAI Incremental Enrichment — New & Gaps       ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
  console.log(`Mode:                 ${AUDIT_ONLY ? "AUDIT ONLY" : DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE (writing to DB)"}`);
  console.log(`Confidence threshold: ${CONFIDENCE_THRESHOLD}`);
  console.log(`Limit:                ${LIMIT === Infinity ? "all" : LIMIT}`);
  console.log(`Start stage:          ${START_STAGE}`);
  console.log("");

  // Step 1: Identify candidates
  const { candidateIds, candidateReasons } = await identifyCandidates(supabase);

  console.log(`\n══════════════════════════════════════════`);
  console.log(`  CANDIDATES: ${candidateIds.size} restaurants need enrichment`);
  console.log(`══════════════════════════════════════════\n`);

  if (candidateIds.size === 0) {
    console.log("All restaurants are fully enriched. Nothing to do.");
    return;
  }

  // Print candidate details
  const displayLimit = Math.min(candidateReasons.length, 30);
  for (let i = 0; i < displayLimit; i++) {
    const c = candidateReasons[i];
    console.log(`  ${i + 1}. ${c.restaurantName}`);
    console.log(`     Reasons: ${c.reasons.join(", ")}`);
  }
  if (candidateReasons.length > displayLimit) {
    console.log(`  ... and ${candidateReasons.length - displayLimit} more`);
  }

  // Save candidate report
  const reportFile = "incremental-enrichment-candidates.json";
  fs.writeFileSync(reportFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    totalCandidates: candidateIds.size,
    candidates: candidateReasons,
  }, null, 2));
  console.log(`\nCandidate report saved to ${reportFile}`);

  if (AUDIT_ONLY) {
    console.log("\n--audit-only flag set. Stopping here.");
    return;
  }

  // Step 2: Fetch full restaurant data for candidates only
  console.log("\nFetching full data for candidates...");

  // Apply limit
  const targetIds = Array.from(candidateIds).slice(0, LIMIT === Infinity ? candidateIds.size : LIMIT);

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
    .in("id", targetIds);

  if (rErr) {
    console.error("Failed to fetch restaurants:", rErr);
    process.exit(1);
  }

  // Flatten joined data (same as full pipeline)
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

  console.log(`Loaded ${restaurants.length} restaurants for enrichment\n`);

  // Step 3: Initialize pipeline state and run all 7 stages
  const auditStream = fs.createWriteStream(AUDIT_LOG_FILE, { flags: "w" });
  auditStream.write("timestamp,restaurant_id,restaurant_name,stage,field,old_value,new_value,model,confidence\n");

  initPipelineState({ auditStream });

  const stages = [
    { num: 1, fn: () => stage1_integrityFixes(supabase, restaurants) },
    { num: 2, fn: () => stage2_structuredEnrichment(supabase, restaurants) },
    { num: 3, fn: () => stage3_richContent(supabase, restaurants) },
    { num: 4, fn: () => stage4_premiumContent(supabase, restaurants) },
    { num: 5, fn: () => stage5_occasionScores(supabase, restaurants) },
    { num: 6, fn: () => stage6_tagRegeneration(supabase, restaurants) },
    { num: 7, fn: () => stage7_confidenceUpdate(supabase, restaurants) },
  ];

  for (const stage of stages) {
    if (stage.num < START_STAGE) {
      console.log(`Skipping stage ${stage.num} (starting from ${START_STAGE})`);
      continue;
    }
    await stage.fn();
  }

  // Close audit log
  auditStream.end();

  // Step 4: Write summary
  const { failures, stageStats } = getPipelineState();
  const totalElapsed = Date.now() - startTime;

  const summary = {
    type: "incremental",
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date().toISOString(),
    elapsedMs: totalElapsed,
    elapsedMinutes: (totalElapsed / 60000).toFixed(1),
    mode: DRY_RUN ? "dry_run" : "live",
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    totalCandidatesFound: candidateIds.size,
    restaurantsProcessed: restaurants.length,
    stages: stageStats,
    totalSuccess: stageStats.reduce((sum, s) => sum + s.success, 0),
    totalErrors: stageStats.reduce((sum, s) => sum + s.errors, 0),
    failureCount: failures.length,
  };
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    fs.writeFileSync(FAILURES_FILE, JSON.stringify(failures, null, 2));
  }

  // Print summary
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   INCREMENTAL ENRICHMENT COMPLETE                    ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  console.log(`Candidates found:     ${candidateIds.size}`);
  console.log(`Restaurants processed: ${restaurants.length}`);
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
  console.log(`  ${reportFile}           — Candidate details`);
  console.log(`  ${AUDIT_LOG_FILE}  — Field-level change log`);
  console.log(`  ${SUMMARY_FILE}     — Aggregate stats`);
  if (failures.length > 0) console.log(`  ${FAILURES_FILE}    — Error details`);
}

main().catch((err) => {
  console.error("Incremental enrichment pipeline failed:", err);
  process.exit(1);
});
