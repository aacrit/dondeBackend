/**
 * Cache Warmer — Pre-warming pipeline for DondeCache.
 *
 * Proactively computes recommendation results for popular/expected queries
 * and stores them in query_cache (quality-gated at B-/80).
 *
 * Follows the WorkerPool pattern from gauntlet-runner.ts (3 workers, rate limiting).
 *
 * Query sources (3 modes):
 *   --source popular   Mine user_queries for top canonical queries (last 30 days)
 *   --source golden    Use 50 golden dataset queries
 *   --source manual    Accept a JSON file of queries (--file path/to/queries.json)
 *
 * Usage:
 *   npx tsx pipelines/cache-warmer.ts --source popular --budget 5.00
 *   npx tsx pipelines/cache-warmer.ts --source golden --budget 3.70
 *   npx tsx pipelines/cache-warmer.ts --source manual --file tests/canonical-queries.json --budget 5.00
 */

import { createAdminClient } from '../lib/supabase.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Configure proxy if needed
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY || process.env.https_proxy!));
  } catch {}
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = join(__dirname, '..', '..', 'tests');

// Config
const API_URL = 'https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend';
const API_KEY = process.env.SUPAB_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const COST_PER_QUERY = 0.074;
const RATE_LIMIT_PER_MIN = 30;
const WORKERS = 3;

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const SOURCE = getArg('source', 'popular');
const BUDGET = parseFloat(getArg('budget', '5.00'));
const MANUAL_FILE = getArg('file', '');

interface WarmingQuery {
  special_request: string;
  occasion: string;
  neighborhood: string;
  price_level: string;
}

interface WarmingResult {
  query: string;
  success: boolean;
  donde_match: number;
  score_fit: number;
  blurb_quality: number;
  cached: boolean;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Query Sources ──────────────────────────────────────────────────────────

async function loadPopularQueries(sb: ReturnType<typeof createAdminClient>): Promise<WarmingQuery[]> {
  // First try canonical-queries.json from query-miner
  const canonicalPath = join(TESTS_DIR, 'canonical-queries.json');
  if (existsSync(canonicalPath)) {
    const data = JSON.parse(readFileSync(canonicalPath, 'utf-8'));
    console.log(`  Loaded ${data.length} canonical queries from query-miner output`);
    return data.map((q: Record<string, string>) => ({
      special_request: q.special_request,
      occasion: q.occasion || 'Any',
      neighborhood: q.neighborhood || 'Anywhere',
      price_level: q.price_level || 'Any',
    }));
  }

  // Fallback: mine directly from user_queries
  console.log('  No canonical-queries.json found, mining user_queries directly...');
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('user_queries')
    .select('special_request, occasion, price_level')
    .gte('created_at', since)
    .not('special_request', 'is', null)
    .limit(3000);

  if (error || !data) {
    console.error('Failed to mine user_queries:', error?.message);
    return [];
  }

  // Count and dedup
  const freqMap = new Map<string, { sr: string; occasion: string; price: string; count: number }>();
  for (const row of data) {
    const sr = (row.special_request as string).trim();
    if (sr.length < 3) continue;
    const key = sr.toLowerCase().split(/\s+/).sort().join(' ') + '|' + (row.occasion || 'Any');
    const existing = freqMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      freqMap.set(key, { sr, occasion: (row.occasion as string) || 'Any', price: (row.price_level as string) || 'Any', count: 1 });
    }
  }

  return [...freqMap.values()]
    .filter(e => e.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 200)
    .map(e => ({
      special_request: e.sr,
      occasion: e.occasion,
      neighborhood: 'Anywhere',
      price_level: e.price,
    }));
}

function loadGoldenQueries(): WarmingQuery[] {
  // Parse golden dataset queries from the shell test script
  const goldenPath = join(TESTS_DIR, 'golden-dataset-test.sh');
  if (!existsSync(goldenPath)) {
    console.error('Golden dataset test not found at', goldenPath);
    return [];
  }

  const content = readFileSync(goldenPath, 'utf-8');
  const queries: WarmingQuery[] = [];

  // Match patterns like: run_query "romantic Italian dinner" "Date Night" "Anywhere" "Any"
  const regex = /run_query\s+"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    queries.push({
      special_request: match[1],
      occasion: match[2],
      neighborhood: match[3],
      price_level: match[4],
    });
  }

  // Also try: test_query "query" "occasion" "neighborhood" "price"
  const regex2 = /test_query\s+"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"/g;
  while ((match = regex2.exec(content)) !== null) {
    queries.push({
      special_request: match[1],
      occasion: match[2],
      neighborhood: match[3],
      price_level: match[4],
    });
  }

  console.log(`  Loaded ${queries.length} golden dataset queries`);
  return queries;
}

function loadManualQueries(filePath: string): WarmingQuery[] {
  if (!existsSync(filePath)) {
    console.error('Manual query file not found:', filePath);
    return [];
  }

  const data = JSON.parse(readFileSync(filePath, 'utf-8'));
  const queries = (Array.isArray(data) ? data : []).map((q: Record<string, string>) => ({
    special_request: q.special_request || q.query || '',
    occasion: q.occasion || 'Any',
    neighborhood: q.neighborhood || 'Anywhere',
    price_level: q.price_level || 'Any',
  })).filter((q: WarmingQuery) => q.special_request.length > 2);

  console.log(`  Loaded ${queries.length} manual queries from ${filePath}`);
  return queries;
}

// ─── Dedup Against Existing Cache ───────────────────────────────────────────

async function dedupAgainstCache(sb: ReturnType<typeof createAdminClient>, queries: WarmingQuery[]): Promise<WarmingQuery[]> {
  // Build exact cache keys and check which are already cached
  const keys = queries.map(q =>
    `${q.occasion}|${q.neighborhood}|${q.price_level}|${q.special_request.toLowerCase().trim().split(/\s+/).sort().join(' ')}`
  );

  const { data: existing } = await sb
    .from('query_cache')
    .select('cache_key')
    .in('cache_key', keys)
    .gt('expires_at', new Date().toISOString());

  const existingKeys = new Set((existing || []).map((e: Record<string, string>) => e.cache_key));
  const filtered = queries.filter((q, i) => !existingKeys.has(keys[i]));

  console.log(`  Dedup: ${queries.length} → ${filtered.length} (${queries.length - filtered.length} already cached)`);
  return filtered;
}

// ─── API Call ───────────────────────────────────────────────────────────────

async function warmQuery(query: WarmingQuery): Promise<WarmingResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        apikey: API_KEY,
        'x-donde-source': 'cache-warmer',
      },
      body: JSON.stringify({
        special_request: query.special_request,
        occasion: query.occasion,
        neighborhood: query.neighborhood,
        price_level: query.price_level,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await resp.json();

    if (!resp.ok || !data.success) {
      return {
        query: query.special_request,
        success: false,
        donde_match: 0,
        score_fit: 0,
        blurb_quality: 0,
        cached: false,
        error: data.recommendation || `HTTP ${resp.status}`,
      };
    }

    // The engine's Step 9.5 will automatically cache this if quality >= B-/80
    const scoreFit = data.scoring_v9?.score_fit_score || 0;
    const blurbQuality = data.scoring_v9?.blurb_quality_score || 0;

    return {
      query: query.special_request,
      success: true,
      donde_match: data.donde_match || 0,
      score_fit: scoreFit,
      blurb_quality: blurbQuality,
      cached: scoreFit >= 80 && blurbQuality >= 80,
    };
  } catch (err) {
    return {
      query: query.special_request,
      success: false,
      donde_match: 0,
      score_fit: 0,
      blurb_quality: 0,
      cached: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Worker Pool ────────────────────────────────────────────────────────────

async function runWorkerPool(queries: WarmingQuery[], maxBudget: number): Promise<WarmingResult[]> {
  const results: WarmingResult[] = [];
  let index = 0;
  let budgetUsed = 0;
  const delayBetweenRequests = Math.ceil(60000 / RATE_LIMIT_PER_MIN);

  async function worker(workerId: number) {
    while (true) {
      const qi = index++;
      if (qi >= queries.length) break;
      if (budgetUsed >= maxBudget) {
        console.log(`  Worker ${workerId}: Budget exhausted ($${budgetUsed.toFixed(2)}/$${maxBudget.toFixed(2)})`);
        break;
      }

      const query = queries[qi];
      const result = await warmQuery(query);
      budgetUsed += COST_PER_QUERY;
      results.push(result);

      const status = result.success ? (result.cached ? 'CACHED' : 'SKIP') : 'FAIL';
      console.log(`  [${qi + 1}/${queries.length}] ${status} DM:${result.donde_match} "${query.special_request.slice(0, 40)}"`);

      // Rate limit
      await sleep(delayBetweenRequests);
    }
  }

  const workers = Array.from({ length: WORKERS }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  return results;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`DondeCache Warmer — source: ${SOURCE}, budget: $${BUDGET.toFixed(2)}`);

  if (!API_KEY) {
    console.error('Missing SUPAB_ANON_KEY environment variable');
    process.exit(1);
  }

  const sb = createAdminClient();
  const runId = `warm-${SOURCE}-${Date.now()}`;

  // Load queries based on source
  let queries: WarmingQuery[];
  switch (SOURCE) {
    case 'popular':
      queries = await loadPopularQueries(sb);
      break;
    case 'golden':
      queries = loadGoldenQueries();
      break;
    case 'manual':
      queries = loadManualQueries(MANUAL_FILE);
      break;
    default:
      console.error(`Unknown source: ${SOURCE}. Use: popular, golden, manual`);
      process.exit(1);
  }

  if (queries.length === 0) {
    console.log('No queries to warm. Exiting.');
    return;
  }

  // Dedup against existing cache
  queries = await dedupAgainstCache(sb, queries);

  if (queries.length === 0) {
    console.log('All queries already cached. Exiting.');
    return;
  }

  // Budget check
  const estimatedCost = queries.length * COST_PER_QUERY;
  const maxQueries = Math.floor(BUDGET / COST_PER_QUERY);
  if (queries.length > maxQueries) {
    console.log(`  Budget allows ${maxQueries} queries (${queries.length} available). Trimming.`);
    queries = queries.slice(0, maxQueries);
  }

  console.log(`  Warming ${queries.length} queries (est. cost: $${(queries.length * COST_PER_QUERY).toFixed(2)})`);

  // Create warming_runs entry
  await sb.from('warming_runs').insert({
    run_id: runId,
    mode: SOURCE,
    budget_dollars: BUDGET,
    budget_used: 0,
    total_queries: queries.length,
  }).then(() => {}).catch(() => {});

  // Run workers
  const startTime = Date.now();
  const results = await runWorkerPool(queries, BUDGET);
  const duration = Math.round((Date.now() - startTime) / 1000);

  // Compute stats
  const successful = results.filter(r => r.success);
  const cached = results.filter(r => r.cached);
  const failed = results.filter(r => !r.success);
  const avgDM = successful.length > 0 ? successful.reduce((s, r) => s + r.donde_match, 0) / successful.length : 0;
  const avgSF = successful.length > 0 ? successful.reduce((s, r) => s + r.score_fit, 0) / successful.length : 0;
  const avgBQ = successful.length > 0 ? successful.reduce((s, r) => s + r.blurb_quality, 0) / successful.length : 0;

  // Update warming_runs
  await sb.from('warming_runs').update({
    budget_used: results.length * COST_PER_QUERY,
    cached_count: cached.length,
    skipped_count: results.length - cached.length - failed.length,
    failed_count: failed.length,
    avg_donde_match: Math.round(avgDM * 10) / 10,
    avg_score_fit: Math.round(avgSF * 10) / 10,
    avg_blurb_quality: Math.round(avgBQ * 10) / 10,
    completed_at: new Date().toISOString(),
  }).eq('run_id', runId).then(() => {}).catch(() => {});

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Cache Warming Complete — ${duration}s`);
  console.log(`  Total:  ${results.length}`);
  console.log(`  Cached: ${cached.length}`);
  console.log(`  Failed: ${failed.length}`);
  console.log(`  Avg DM: ${avgDM.toFixed(1)}`);
  console.log(`  Avg SF: ${avgSF.toFixed(1)}`);
  console.log(`  Avg BQ: ${avgBQ.toFixed(1)}`);
  console.log(`  Cost:   $${(results.length * COST_PER_QUERY).toFixed(2)}`);
  console.log(`${'='.repeat(60)}`);

  if (failed.length > 0) {
    console.log('\nFailed queries:');
    for (const r of failed.slice(0, 10)) {
      console.log(`  "${r.query}": ${r.error}`);
    }
  }
}

main().catch(e => {
  console.error('Cache warmer crashed:', e);
  process.exit(1);
});
