/**
 * Donde Gauntlet Runner
 * Executes search atlas queries against the recommendation API in parallel.
 *
 * Usage:
 *   npx tsx pipelines/gauntlet-runner.ts <atlas.jsonl> [options]
 *
 * Options:
 *   --tier N          Only run queries from tier N
 *   --category CAT    Only run queries from category CAT
 *   --limit N         Max queries to run
 *   --sample N        Run N random queries
 *   --full            Full-fidelity mode (default: lightweight)
 *   --resume RUN_ID   Resume from checkpoint
 *   --output DIR      Output directory (default: tests/gauntlet-results)
 *   --workers N       Number of parallel workers (default: 3)
 *   --incremental     Skip queries that passed in the last run
 *   --regression      Only run queries that failed in the last run
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

// Configure proxy if HTTPS_PROXY is set (needed in containerized environments)
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY || process.env.https_proxy!));
  } catch {}
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, "..", "..", "tests");
const DEFAULT_OUTPUT = join(TESTS_DIR, "gauntlet-results");

// ─── Config ──────────────────────────────────────────────────────────────────

const API_URL = "https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend";
const API_KEY = process.env.SUPAB_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const RATE_LIMIT_PER_MIN = 30;
const CHECKPOINT_INTERVAL = 100;

// ─── Types ───────────────────────────────────────────────────────────────────

interface AtlasQuery {
  id: string;
  tier: number;
  category: string;
  subcategory: string;
  query: string;
  params: {
    special_request: string;
    occasion: string;
    neighborhood: string;
    price_level: string;
    dietary_restrictions: string[];
    time_of_day: string | null;
  };
  expected_signals: {
    cuisines?: string[];
    dishes?: string[];
    vibes?: string[];
    relevance_type?: string;
    min_score?: number;
    neighborhood?: string;
  };
  search_volume_estimate: string;
  tags: string[];
}

interface QueryResult {
  query_id: string;
  query: string;
  tier: number;
  category: string;
  params: AtlasQuery["params"];
  result: {
    success: boolean;
    restaurant_name: string | null;
    cuisine_type: string | null;
    neighborhood: string | null;
    donde_match: number;
    relevance_score: number;
    relevance_type: string;
    quality_score: number;
    food: number;
    vibe: number;
    service: number;
    reputation: number;
    convenience: number;
    ranked_queue_size: number;
    response_time_ms: number;
    was_lightweight: boolean;
    error?: string;
  };
  evaluation: {
    score_tier: string;
    score_pass: boolean;
    relevance_correct: boolean;
    cuisine_match: boolean | null;
    neighborhood_match: boolean | null;
    gap_type: string | null;
    gap_severity: string | null;
  };
  timestamp: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreTier(dm: number): string {
  if (dm >= 90) return "outstanding";
  if (dm >= 80) return "excellent";
  if (dm >= 70) return "strong";
  if (dm >= 60) return "solid";
  if (dm >= 50) return "marginal";
  return "weak";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sample<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

// ─── API Call ────────────────────────────────────────────────────────────────

async function callAPI(query: AtlasQuery, lightweight: boolean): Promise<QueryResult> {
  const startTime = Date.now();
  const body: Record<string, unknown> = {
    special_request: query.params.special_request,
    occasion: query.params.occasion,
    neighborhood: query.params.neighborhood,
    price_level: query.params.price_level,
  };
  if (query.params.dietary_restrictions.length > 0) {
    body.dietary_restrictions = query.params.dietary_restrictions;
  }
  if (query.params.time_of_day) {
    body.time_of_day = query.params.time_of_day;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
    apikey: API_KEY,
  };
  if (lightweight) {
    headers["x-gauntlet-mode"] = "lightweight";
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), lightweight ? 15000 : 45000);

    const resp = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await resp.json();
    const elapsed = Date.now() - startTime;

    if (!resp.ok || !data.success) {
      return makeResult(query, elapsed, lightweight, {
        success: false,
        error: data.recommendation || data.error || `HTTP ${resp.status}`,
      });
    }

    const scoring = data.scoring_v9 || {};
    const restaurant = data.restaurant || {};

    return makeResult(query, elapsed, lightweight, {
      success: true,
      restaurant_name: restaurant.name || null,
      cuisine_type: restaurant.cuisine_type || null,
      neighborhood: restaurant.neighborhood_name || null,
      donde_match: data.donde_match || 0,
      relevance_score: scoring.relevance_score || 0,
      relevance_type: scoring.relevance_type || "unknown",
      quality_score: scoring.quality_score || 0,
      food: scoring.food || 0,
      vibe: scoring.vibe || 0,
      service: scoring.service || 0,
      reputation: scoring.reputation || 0,
      convenience: scoring.convenience || 0,
      ranked_queue_size: (data.ranked_queue || []).length,
    });
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    return makeResult(query, elapsed, lightweight, {
      success: false,
      error: err.name === "AbortError" ? "timeout" : err.message,
    });
  }
}

function makeResult(
  query: AtlasQuery,
  responseTimeMs: number,
  lightweight: boolean,
  data: Partial<QueryResult["result"]>
): QueryResult {
  const dm = data.donde_match || 0;
  const minScore = query.expected_signals.min_score || 50;
  const scorePassed = dm >= minScore;

  // Evaluate cuisine match
  let cuisineMatch: boolean | null = null;
  if (query.expected_signals.cuisines && data.cuisine_type) {
    const expected = query.expected_signals.cuisines.map((c) => c.toLowerCase());
    cuisineMatch = expected.some((c) => (data.cuisine_type || "").toLowerCase().includes(c));
  }

  // Evaluate neighborhood match
  let neighborhoodMatch: boolean | null = null;
  if (query.expected_signals.neighborhood && data.neighborhood) {
    neighborhoodMatch = (data.neighborhood || "").toLowerCase().includes(
      query.expected_signals.neighborhood.toLowerCase()
    );
  }

  // Evaluate relevance type
  let relevanceCorrect = true;
  if (query.expected_signals.relevance_type && data.relevance_type) {
    relevanceCorrect = data.relevance_type === query.expected_signals.relevance_type;
  }

  // Detect gap type
  let gapType: string | null = null;
  let gapSeverity: string | null = null;

  if (!data.success) {
    gapType = "api_error";
    gapSeverity = "P0";
  } else if (dm < 40 && data.relevance_type === "open_ended" && query.category === "cuisine") {
    gapType = "db_coverage";
    gapSeverity = "P0";
  } else if (dm < 40 && data.relevance_type === "open_ended" && query.category === "dish") {
    gapType = "synonym";
    gapSeverity = "P1";
  } else if (!relevanceCorrect && query.expected_signals.relevance_type) {
    gapType = "intent";
    gapSeverity = "P1";
  } else if (dm >= 40 && dm < 60 && (data.ranked_queue_size || 0) >= 3) {
    gapType = "scoring";
    gapSeverity = "P1";
  } else if (cuisineMatch === false) {
    gapType = "cuisine_mismatch";
    gapSeverity = "P2";
  } else if (neighborhoodMatch === false) {
    gapType = "neighborhood";
    gapSeverity = "P1";
  } else if (dm >= 60 && dm < 70) {
    gapType = "relevance_ceiling";
    gapSeverity = "P2";
  }

  return {
    query_id: query.id,
    query: query.query,
    tier: query.tier,
    category: query.category,
    params: query.params,
    result: {
      success: data.success || false,
      restaurant_name: data.restaurant_name || null,
      cuisine_type: data.cuisine_type || null,
      neighborhood: data.neighborhood || null,
      donde_match: dm,
      relevance_score: data.relevance_score || 0,
      relevance_type: data.relevance_type || "unknown",
      quality_score: data.quality_score || 0,
      food: data.food || 0,
      vibe: data.vibe || 0,
      service: data.service || 0,
      reputation: data.reputation || 0,
      convenience: data.convenience || 0,
      ranked_queue_size: data.ranked_queue_size || 0,
      response_time_ms: responseTimeMs,
      was_lightweight: lightweight,
      error: data.error,
    },
    evaluation: {
      score_tier: scoreTier(dm),
      score_pass: scorePassed,
      relevance_correct: relevanceCorrect,
      cuisine_match: cuisineMatch,
      neighborhood_match: neighborhoodMatch,
      gap_type: gapType,
      gap_severity: gapSeverity,
    },
    timestamp: new Date().toISOString(),
  };
}

// ─── Worker Pool ─────────────────────────────────────────────────────────────

class WorkerPool {
  private queue: AtlasQuery[] = [];
  private results: QueryResult[] = [];
  private completed = 0;
  private total = 0;
  private lightweight: boolean;
  private workers: number;
  private delayMs: number;
  private outputPath: string;
  private startTime = 0;

  constructor(queries: AtlasQuery[], opts: { lightweight: boolean; workers: number; outputPath: string }) {
    this.queue = [...queries];
    this.total = queries.length;
    this.lightweight = opts.lightweight;
    this.workers = opts.workers;
    this.delayMs = (60 * 1000) / RATE_LIMIT_PER_MIN;
    this.outputPath = opts.outputPath;
  }

  async run(): Promise<QueryResult[]> {
    this.startTime = Date.now();
    console.log(`\n  Starting ${this.workers} workers for ${this.total} queries...`);
    console.log(`  Mode: ${this.lightweight ? "LIGHTWEIGHT" : "FULL-FIDELITY"}`);
    console.log(`  Rate: ${RATE_LIMIT_PER_MIN} req/min (${this.delayMs}ms between calls)\n`);

    const workerPromises: Promise<void>[] = [];
    for (let i = 0; i < this.workers; i++) {
      workerPromises.push(this.worker(i));
    }
    await Promise.all(workerPromises);
    return this.results;
  }

  private async worker(id: number): Promise<void> {
    while (this.queue.length > 0) {
      const query = this.queue.shift();
      if (!query) break;

      const result = await callAPI(query, this.lightweight);
      this.results.push(result);
      this.completed++;

      // Progress log every 10 queries
      if (this.completed % 10 === 0 || this.completed === this.total) {
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
        const pct = ((this.completed / this.total) * 100).toFixed(1);
        const passCount = this.results.filter((r) => r.evaluation.score_pass).length;
        const passRate = ((passCount / this.completed) * 100).toFixed(1);
        const avgDM = this.results.reduce((s, r) => s + r.result.donde_match, 0) / this.completed;
        const gapCount = this.results.filter((r) => r.evaluation.gap_type).length;
        process.stdout.write(
          `\r  [${pct}%] ${this.completed}/${this.total} | ` +
            `Pass: ${passRate}% | Avg DM: ${avgDM.toFixed(1)} | ` +
            `Gaps: ${gapCount} | ${elapsed}s elapsed`
        );
      }

      // Checkpoint
      if (this.completed % CHECKPOINT_INTERVAL === 0) {
        this.saveCheckpoint();
      }

      // Rate limiting
      await sleep(this.delayMs / this.workers);
    }
  }

  private saveCheckpoint() {
    const checkpointPath = join(dirname(this.outputPath), `checkpoint-${Date.now()}.json`);
    writeFileSync(
      checkpointPath,
      JSON.stringify({
        completed: this.completed,
        total: this.total,
        remaining_ids: this.queue.map((q) => q.id),
        timestamp: new Date().toISOString(),
      })
    );
  }
}

// ─── Load previous run results ───────────────────────────────────────────────

function loadLatestResults(outputDir: string): Map<string, QueryResult> {
  const map = new Map<string, QueryResult>();
  const files = readdirSync(outputDir).filter((f) => f.startsWith("run-") && f.endsWith(".jsonl")).sort().reverse();
  if (files.length === 0) return map;

  const lines = readFileSync(join(outputDir, files[0]), "utf-8").split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const result = JSON.parse(line) as QueryResult;
      map.set(result.query_id, result);
    } catch {}
  }
  return map;
}

// ─── Supabase Persistence ────────────────────────────────────────────────────

function computeDatasetHash(results: QueryResult[]): string {
  const ids = results.map((r) => r.query_id).sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex").substring(0, 16);
}

async function persistToSupabase(
  results: QueryResult[],
  runId: string,
  opts: { mode: string; atlasVersion: string; incremental: boolean; regression: boolean }
): Promise<void> {
  const serviceKey = process.env.SUPAB_SERVICE_ROLE_KEY;
  const url = process.env.SUPAB_URL;
  if (!serviceKey || !url) {
    console.log("  ℹ Supabase persistence skipped (no SUPAB_SERVICE_ROLE_KEY)");
    return;
  }

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, serviceKey);

  const datasetHash = computeDatasetHash(results);
  const mode = opts.incremental ? "incremental" : opts.regression ? "regression" : opts.mode;

  // Compute summary stats
  const total = results.length;
  const successful = results.filter((r) => r.result.success).length;
  const passed60 = results.filter((r) => r.result.donde_match >= 60).length;
  const passed80 = results.filter((r) => r.result.donde_match >= 80).length;
  const passed90 = results.filter((r) => r.result.donde_match >= 90).length;
  const avgDM = total > 0 ? results.reduce((s, r) => s + r.result.donde_match, 0) / total : 0;
  const gapCount = results.filter((r) => r.evaluation.gap_type).length;
  const avgResponseMs = total > 0 ? Math.round(results.reduce((s, r) => s + r.result.response_time_ms, 0) / total) : 0;

  // Category stats
  const catStats: Record<string, { avg_dm: number; pass_rate: number; gaps: number; total: number }> = {};
  const catAcc: Record<string, { sumDM: number; total: number; passed: number; gaps: number }> = {};
  for (const r of results) {
    if (!catAcc[r.category]) catAcc[r.category] = { sumDM: 0, total: 0, passed: 0, gaps: 0 };
    catAcc[r.category].sumDM += r.result.donde_match;
    catAcc[r.category].total++;
    if (r.result.donde_match >= 60) catAcc[r.category].passed++;
    if (r.evaluation.gap_type) catAcc[r.category].gaps++;
  }
  for (const [cat, acc] of Object.entries(catAcc)) {
    catStats[cat] = {
      avg_dm: Math.round((acc.sumDM / acc.total) * 10) / 10,
      pass_rate: Math.round((acc.passed / acc.total) * 1000) / 10,
      gaps: acc.gaps,
      total: acc.total,
    };
  }

  // Gap type stats
  const gapTypeStats: Record<string, { count: number; avg_dm: number }> = {};
  const gapAcc: Record<string, { sumDM: number; count: number }> = {};
  for (const r of results) {
    if (!r.evaluation.gap_type) continue;
    const gt = r.evaluation.gap_type;
    if (!gapAcc[gt]) gapAcc[gt] = { sumDM: 0, count: 0 };
    gapAcc[gt].sumDM += r.result.donde_match;
    gapAcc[gt].count++;
  }
  for (const [gt, acc] of Object.entries(gapAcc)) {
    gapTypeStats[gt] = { count: acc.count, avg_dm: Math.round((acc.sumDM / acc.count) * 10) / 10 };
  }

  // Factor averages
  const factorAvg: Record<string, number> = {};
  for (const f of ["food", "vibe", "service", "reputation", "convenience"] as const) {
    factorAvg[f] = Math.round((results.reduce((s, r) => s + r.result[f], 0) / total) * 10) / 10;
  }

  // Find previous comparable run
  const { data: prevRuns } = await sb
    .from("gauntlet_runs")
    .select("run_id, avg_dm, passed_60, gap_count")
    .eq("dataset_hash", datasetHash)
    .order("created_at", { ascending: false })
    .limit(1);

  const prev = prevRuns && prevRuns.length > 0 ? prevRuns[0] : null;

  // Build per-query delta map from previous run
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
    run_id: runId,
    dataset_hash: datasetHash,
    dataset_size: total,
    mode,
    atlas_version: opts.atlasVersion,
    total,
    successful,
    passed_60: passed60,
    passed_80: passed80,
    passed_90: passed90,
    avg_dm: Math.round(avgDM * 10) / 10,
    gap_count: gapCount,
    avg_response_ms: avgResponseMs,
    category_stats: catStats,
    gap_type_stats: gapTypeStats,
    factor_averages: factorAvg,
    prev_run_id: prev?.run_id || null,
    delta_avg_dm: prev ? Math.round((avgDM - Number(prev.avg_dm)) * 10) / 10 : null,
    delta_passed_60: prev ? passed60 - prev.passed_60 : null,
    delta_gap_count: prev ? gapCount - prev.gap_count : null,
  });

  if (runError) throw new Error(`Insert run failed: ${runError.message}`);

  // Batch insert results
  const BATCH = 500;
  const rows = results.map((r) => {
    const prevDM = prevResultMap[r.query_id] ?? null;
    return {
      run_id: runId,
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
      prev_dm: prevDM,
      delta_dm: prevDM !== null ? r.result.donde_match - prevDM : null,
    };
  });

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await sb.from("gauntlet_results").insert(batch);
    if (error) throw new Error(`Insert results batch ${i} failed: ${error.message}`);
  }

  console.log(`  ✓ Persisted to Supabase: ${total} results, dataset=${datasetHash.substring(0, 8)}${prev ? `, Δ avg_dm=${Math.round((avgDM - Number(prev.avg_dm)) * 10) / 10}` : " (first run for this dataset)"}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const atlasPath = args.find((a) => !a.startsWith("--")) || join(TESTS_DIR, "search-atlas-v1.jsonl");
  const tierArg = args.indexOf("--tier");
  const targetTier = tierArg >= 0 ? parseInt(args[tierArg + 1]) : -1;
  const catArg = args.indexOf("--category");
  const targetCategory = catArg >= 0 ? args[catArg + 1] : null;
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? parseInt(args[limitArg + 1]) : Infinity;
  const sampleArg = args.indexOf("--sample");
  const sampleSize = sampleArg >= 0 ? parseInt(args[sampleArg + 1]) : 0;
  const lightweight = !args.includes("--full");
  const workersArg = args.indexOf("--workers");
  const workers = workersArg >= 0 ? parseInt(args[workersArg + 1]) : 3;
  const outputArg = args.indexOf("--output");
  const outputDir = outputArg >= 0 ? args[outputArg + 1] : DEFAULT_OUTPUT;
  const incremental = args.includes("--incremental");
  const regression = args.includes("--regression");

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  if (!API_KEY) {
    console.error("ERROR: SUPAB_ANON_KEY or SUPABASE_ANON_KEY environment variable required");
    process.exit(1);
  }

  // Load atlas
  if (!existsSync(atlasPath)) {
    console.error(`ERROR: Atlas file not found: ${atlasPath}`);
    console.error("Run: npx tsx pipelines/generate-search-atlas.ts");
    process.exit(1);
  }

  let queries: AtlasQuery[] = readFileSync(atlasPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  DONDE GAUNTLET RUNNER                                     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  Atlas: ${atlasPath.split("/").pop()} (${queries.length} total queries)`);

  // Apply filters
  if (targetTier >= 0) {
    queries = queries.filter((q) => q.tier === targetTier);
    console.log(`  Filter tier=${targetTier}: ${queries.length} queries`);
  }
  if (targetCategory) {
    queries = queries.filter((q) => q.category === targetCategory);
    console.log(`  Filter category=${targetCategory}: ${queries.length} queries`);
  }

  // Incremental/regression modes
  if (incremental || regression) {
    const prev = loadLatestResults(outputDir);
    if (prev.size > 0) {
      if (incremental) {
        queries = queries.filter((q) => {
          const prevResult = prev.get(q.id);
          return !prevResult || !prevResult.evaluation.score_pass;
        });
        console.log(`  Incremental mode: ${queries.length} queries (skipping passed)`);
      } else if (regression) {
        queries = queries.filter((q) => {
          const prevResult = prev.get(q.id);
          return prevResult && !prevResult.evaluation.score_pass;
        });
        console.log(`  Regression mode: ${queries.length} queries (failed only)`);
      }
    }
  }

  // Sampling
  if (sampleSize > 0) {
    queries = sample(queries, sampleSize);
    console.log(`  Sampled: ${queries.length} queries`);
  }

  // Limit
  if (limit < queries.length) {
    queries = queries.slice(0, limit);
    console.log(`  Limited to: ${queries.length} queries`);
  }

  if (queries.length === 0) {
    console.log("\n  No queries to run. Exiting.");
    process.exit(0);
  }

  // Execute
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)}`;
  const outputPath = join(outputDir, `${runId}.jsonl`);

  const pool = new WorkerPool(queries, { lightweight, workers, outputPath });
  const results = await pool.run();

  // Save results
  const jsonl = results.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(outputPath, jsonl);

  // Persist to Supabase
  try {
    await persistToSupabase(results, runId, {
      mode: lightweight ? "lightweight" : "full",
      atlasVersion: atlasPath.split("/").pop() || "",
      incremental,
      regression,
    });
  } catch (e) {
    console.warn(`  ⚠ Supabase persistence failed: ${(e as Error).message}`);
  }

  // Print summary
  console.log("\n\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  GAUNTLET RESULTS SUMMARY                                  ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");

  const total = results.length;
  const successful = results.filter((r) => r.result.success).length;
  const passed = results.filter((r) => r.evaluation.score_pass).length;
  const excellent = results.filter((r) => r.result.donde_match >= 80).length;
  const avgDM = results.reduce((s, r) => s + r.result.donde_match, 0) / total;
  const gaps = results.filter((r) => r.evaluation.gap_type);
  const avgResponseTime = results.reduce((s, r) => s + r.result.response_time_ms, 0) / total;

  console.log(`║  Total: ${total}  |  Success: ${successful}  |  Pass (DM≥min): ${passed}  ║`);
  console.log(`║  Pass Rate: ${((passed / total) * 100).toFixed(1)}%  |  Excellence (DM≥80): ${((excellent / total) * 100).toFixed(1)}%       ║`);
  console.log(`║  Avg DM: ${avgDM.toFixed(1)}  |  Avg Response: ${avgResponseTime.toFixed(0)}ms               ║`);
  console.log(`║  Gaps Found: ${gaps.length}                                          ║`);
  console.log("╠══════════════════════════════════════════════════════════════╣");

  // Gap breakdown
  const gapCounts: Record<string, number> = {};
  for (const r of gaps) {
    const gt = r.evaluation.gap_type!;
    gapCounts[gt] = (gapCounts[gt] || 0) + 1;
  }
  console.log("║  Gap Breakdown:                                            ║");
  for (const [type, count] of Object.entries(gapCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`║    ${type.padEnd(30)} ${String(count).padEnd(26)}║`);
  }

  // Category breakdown
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  Category Performance:                                     ║");
  const catStats: Record<string, { total: number; passed: number; sumDM: number; gaps: number }> = {};
  for (const r of results) {
    if (!catStats[r.category]) catStats[r.category] = { total: 0, passed: 0, sumDM: 0, gaps: 0 };
    catStats[r.category].total++;
    if (r.evaluation.score_pass) catStats[r.category].passed++;
    catStats[r.category].sumDM += r.result.donde_match;
    if (r.evaluation.gap_type) catStats[r.category].gaps++;
  }
  for (const [cat, stats] of Object.entries(catStats).sort((a, b) => b[1].total - a[1].total).slice(0, 15)) {
    const avgCatDM = (stats.sumDM / stats.total).toFixed(0);
    const passRate = ((stats.passed / stats.total) * 100).toFixed(0);
    console.log(`║    ${cat.padEnd(22)} DM:${avgCatDM.padEnd(4)} Pass:${passRate.padEnd(4)}% Gaps:${String(stats.gaps).padEnd(4)}║`);
  }

  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  Output: ${runId}.jsonl`.padEnd(61) + "║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
}

main().catch(console.error);
