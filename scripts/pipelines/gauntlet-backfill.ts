/**
 * Gauntlet Backfill — Import historical result files into Supabase
 *
 * Reads existing JSONL/JSON result files and inserts them as gauntlet_runs + gauntlet_results.
 * Processes files chronologically so delta chains are computed correctly.
 *
 * Usage: npx tsx pipelines/gauntlet-backfill.ts [--dry-run]
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { createAdminClient } from "../lib/supabase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, "..", "..", "tests");
const DRY_RUN = process.argv.includes("--dry-run");

// ─── V8 Legacy Adapter ─────────────────────────────────────────────────────

interface V8Result {
  test_id: string;
  query: string;
  category: string;
  min_score: number;
  occasion: string;
  donde_match: number;
  restaurant_name: string;
  cuisine_type: string;
  food: number;
  vibe: number;
  service: number;
  reputation: number;
  convenience: number;
  intent_alignment?: { score: number; cuisine: number; dish: number; vibe: number };
}

function adaptV8(r: V8Result, idx: number) {
  const dm = r.donde_match;
  let gapType: string | null = null;
  let gapSev: string | null = null;
  if (dm < 40) { gapType = "db_coverage"; gapSev = "P0"; }
  else if (r.intent_alignment && r.intent_alignment.vibe < 0.3 && r.intent_alignment.cuisine < 0.3) { gapType = "intent"; gapSev = "P1"; }
  else if (dm < 60) { gapType = "scoring"; gapSev = "P1"; }
  else if (dm >= 60 && dm < 70) { gapType = "relevance_ceiling"; gapSev = "P2"; }

  return {
    query_id: r.test_id || `v8-${idx}`,
    query: r.query,
    tier: 1,
    category: r.category?.toLowerCase() || "unknown",
    donde_match: dm,
    relevance_type: null,
    food: r.food,
    vibe: r.vibe,
    service: r.service,
    reputation: r.reputation,
    convenience: r.convenience,
    response_time_ms: 0,
    score_pass: dm >= (r.min_score || 60),
    gap_type: gapType,
    gap_severity: gapSev,
    restaurant_name: r.restaurant_name,
  };
}

// ─── Gauntlet Format Adapter ────────────────────────────────────────────────

interface GauntletResult {
  query_id: string;
  query: string;
  tier: number;
  category: string;
  result: {
    success: boolean;
    restaurant_name: string | null;
    donde_match: number;
    relevance_type: string;
    food: number; vibe: number; service: number; reputation: number; convenience: number;
    response_time_ms: number;
  };
  evaluation: {
    score_pass: boolean;
    gap_type: string | null;
    gap_severity: string | null;
  };
}

function adaptGauntlet(r: GauntletResult) {
  return {
    query_id: r.query_id,
    query: r.query,
    tier: r.tier,
    category: r.category,
    donde_match: r.result.donde_match,
    relevance_type: r.result.relevance_type,
    food: r.result.food,
    vibe: r.result.vibe,
    service: r.result.service,
    reputation: r.result.reputation,
    convenience: r.result.convenience,
    response_time_ms: r.result.response_time_ms,
    score_pass: r.evaluation.score_pass,
    gap_type: r.evaluation.gap_type,
    gap_severity: r.evaluation.gap_severity,
    restaurant_name: r.result.restaurant_name,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type NormalizedResult = ReturnType<typeof adaptV8>;

function computeHash(results: NormalizedResult[]): string {
  const ids = results.map((r) => r.query_id).sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex").substring(0, 16);
}

function computeSummary(results: NormalizedResult[]) {
  const total = results.length;
  const successful = total;
  const passed60 = results.filter((r) => r.donde_match >= 60).length;
  const passed80 = results.filter((r) => r.donde_match >= 80).length;
  const passed90 = results.filter((r) => r.donde_match >= 90).length;
  const avgDM = total > 0 ? results.reduce((s, r) => s + r.donde_match, 0) / total : 0;
  const gapCount = results.filter((r) => r.gap_type).length;
  const avgResponseMs = total > 0 ? Math.round(results.reduce((s, r) => s + (r.response_time_ms || 0), 0) / total) : 0;

  // Category stats
  const catAcc: Record<string, { sumDM: number; total: number; passed: number; gaps: number }> = {};
  for (const r of results) {
    const cat = r.category || "unknown";
    if (!catAcc[cat]) catAcc[cat] = { sumDM: 0, total: 0, passed: 0, gaps: 0 };
    catAcc[cat].sumDM += r.donde_match;
    catAcc[cat].total++;
    if (r.donde_match >= 60) catAcc[cat].passed++;
    if (r.gap_type) catAcc[cat].gaps++;
  }
  const categoryStats: Record<string, { avg_dm: number; pass_rate: number; gaps: number; total: number }> = {};
  for (const [cat, acc] of Object.entries(catAcc)) {
    categoryStats[cat] = {
      avg_dm: Math.round((acc.sumDM / acc.total) * 10) / 10,
      pass_rate: Math.round((acc.passed / acc.total) * 1000) / 10,
      gaps: acc.gaps,
      total: acc.total,
    };
  }

  // Gap type stats
  const gapAcc: Record<string, { sumDM: number; count: number }> = {};
  for (const r of results) {
    if (!r.gap_type) continue;
    if (!gapAcc[r.gap_type]) gapAcc[r.gap_type] = { sumDM: 0, count: 0 };
    gapAcc[r.gap_type].sumDM += r.donde_match;
    gapAcc[r.gap_type].count++;
  }
  const gapTypeStats: Record<string, { count: number; avg_dm: number }> = {};
  for (const [gt, acc] of Object.entries(gapAcc)) {
    gapTypeStats[gt] = { count: acc.count, avg_dm: Math.round((acc.sumDM / acc.count) * 10) / 10 };
  }

  // Factor averages
  const factorAvg: Record<string, number> = {};
  for (const f of ["food", "vibe", "service", "reputation", "convenience"] as const) {
    factorAvg[f] = Math.round((results.reduce((s, r) => s + (r[f] || 0), 0) / total) * 10) / 10;
  }

  return { total, successful, passed60, passed80, passed90, avgDM, gapCount, avgResponseMs, categoryStats, gapTypeStats, factorAvg };
}

// ─── File Discovery ─────────────────────────────────────────────────────────

interface BackfillSource {
  path: string;
  runId: string;
  format: "v8" | "gauntlet";
  mtime: Date;
  atlasVersion: string;
}

function discoverFiles(): BackfillSource[] {
  const sources: BackfillSource[] = [];

  // V8 results
  for (const name of ["V8_RAW_RESULTS.jsonl", "V8_200_RAW_RESULTS.jsonl"]) {
    const p = join(TESTS_DIR, name);
    if (existsSync(p)) {
      const mtime = statSync(p).mtime;
      sources.push({
        path: p,
        runId: `v8-${name.replace(".jsonl", "").toLowerCase()}`,
        format: "v8",
        mtime,
        atlasVersion: "v8-manual",
      });
    }
  }

  // Gauntlet results
  const resultsDir = join(TESTS_DIR, "gauntlet-results");
  if (existsSync(resultsDir)) {
    for (const name of readdirSync(resultsDir).filter((f) => f.startsWith("run-") && f.endsWith(".jsonl")).sort()) {
      const p = join(resultsDir, name);
      const mtime = statSync(p).mtime;
      sources.push({
        path: p,
        runId: name.replace(".jsonl", ""),
        format: "gauntlet",
        mtime,
        atlasVersion: "search-atlas-v1.jsonl",
      });
    }
  }

  // Sort chronologically
  return sources.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  GAUNTLET BACKFILL                                         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  const sources = discoverFiles();
  if (sources.length === 0) {
    console.log("  No result files found to backfill.");
    return;
  }

  console.log(`  Found ${sources.length} result files:\n`);
  for (const s of sources) {
    console.log(`    ${s.runId.padEnd(40)} ${s.format.padEnd(10)} ${s.mtime.toISOString().substring(0, 19)}`);
  }

  if (DRY_RUN) {
    console.log("\n  --dry-run: Exiting without writing to Supabase.");
    return;
  }

  const sb = createAdminClient();

  // Check which runs already exist
  const { data: existingRuns } = await sb
    .from("gauntlet_runs")
    .select("run_id");
  const existing = new Set((existingRuns || []).map((r: { run_id: string }) => r.run_id));

  let imported = 0;
  let skipped = 0;

  for (const source of sources) {
    if (existing.has(source.runId)) {
      console.log(`  ⏭ ${source.runId} — already exists, skipping`);
      skipped++;
      continue;
    }

    // Parse file
    const raw = readFileSync(source.path, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    let results: NormalizedResult[];

    if (source.format === "v8") {
      results = lines.map((l, i) => adaptV8(JSON.parse(l), i));
    } else {
      results = lines.map((l) => adaptGauntlet(JSON.parse(l)));
    }

    if (results.length === 0) {
      console.log(`  ⏭ ${source.runId} — empty file, skipping`);
      skipped++;
      continue;
    }

    const datasetHash = computeHash(results);
    const summary = computeSummary(results);

    // Find previous run with same dataset for deltas
    const { data: prevRuns } = await sb
      .from("gauntlet_runs")
      .select("run_id, avg_dm, passed_60, gap_count")
      .eq("dataset_hash", datasetHash)
      .order("created_at", { ascending: false })
      .limit(1);

    const prev = prevRuns && prevRuns.length > 0 ? prevRuns[0] : null;

    let prevResultMap: Record<string, number> = {};
    if (prev) {
      const { data: prevResults } = await sb
        .from("gauntlet_results")
        .select("query_id, donde_match")
        .eq("run_id", prev.run_id);
      if (prevResults) {
        for (const pr of prevResults) prevResultMap[pr.query_id] = pr.donde_match;
      }
    }

    // Insert run
    const { error: runError } = await sb.from("gauntlet_runs").insert({
      run_id: source.runId,
      created_at: source.mtime.toISOString(),
      dataset_hash: datasetHash,
      dataset_size: results.length,
      mode: source.format === "v8" ? "legacy-v8" : "lightweight",
      atlas_version: source.atlasVersion,
      total: summary.total,
      successful: summary.successful,
      passed_60: summary.passed60,
      passed_80: summary.passed80,
      passed_90: summary.passed90,
      avg_dm: Math.round(summary.avgDM * 10) / 10,
      gap_count: summary.gapCount,
      avg_response_ms: summary.avgResponseMs,
      category_stats: summary.categoryStats,
      gap_type_stats: summary.gapTypeStats,
      factor_averages: summary.factorAvg,
      prev_run_id: prev?.run_id || null,
      delta_avg_dm: prev ? Math.round((summary.avgDM - Number(prev.avg_dm)) * 10) / 10 : null,
      delta_passed_60: prev ? summary.passed60 - prev.passed_60 : null,
      delta_gap_count: prev ? summary.gapCount - prev.gap_count : null,
    });

    if (runError) {
      console.error(`  ✗ ${source.runId} — run insert failed: ${runError.message}`);
      continue;
    }

    // Batch insert results
    const BATCH = 500;
    const rows = results.map((r) => {
      const prevDM = prevResultMap[r.query_id] ?? null;
      return {
        run_id: source.runId,
        query_id: r.query_id,
        query: r.query,
        tier: r.tier,
        category: r.category,
        donde_match: r.donde_match,
        relevance_type: r.relevance_type,
        food: r.food,
        vibe: r.vibe,
        service: r.service,
        reputation: r.reputation,
        convenience: r.convenience,
        response_time_ms: r.response_time_ms,
        score_pass: r.score_pass,
        gap_type: r.gap_type,
        gap_severity: r.gap_severity,
        restaurant_name: r.restaurant_name,
        prev_dm: prevDM,
        delta_dm: prevDM !== null ? r.donde_match - prevDM : null,
      };
    });

    let insertOk = true;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await sb.from("gauntlet_results").insert(batch);
      if (error) {
        console.error(`  ✗ ${source.runId} — results batch ${i} failed: ${error.message}`);
        insertOk = false;
        break;
      }
    }

    if (insertOk) {
      console.log(`  ✓ ${source.runId} — ${results.length} results, hash=${datasetHash.substring(0, 8)}${prev ? `, Δ avg_dm=${Math.round((summary.avgDM - Number(prev.avg_dm)) * 10) / 10}` : ""}`);
      imported++;
    }
  }

  console.log(`\n  Done: ${imported} imported, ${skipped} skipped.`);
}

main().catch(console.error);
