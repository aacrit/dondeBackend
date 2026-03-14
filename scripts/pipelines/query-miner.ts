/**
 * Query Miner — Extracts canonical queries from user_queries for cache warming.
 *
 * Steps:
 *   1. Frequency extraction (GROUP BY normalized query, occasion)
 *   2. Canonical normalization (lowercase, sort words, stem)
 *   3. Cluster dedup (same normalized form → keep most common variant)
 *   4. Coverage check (top neighborhoods, cuisines, occasions)
 *   5. Output: tests/canonical-queries.json
 *
 * Usage:
 *   npx tsx pipelines/query-miner.ts [--days 30] [--min-freq 2] [--limit 200]
 */

import { createAdminClient } from '../lib/supabase.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', '..', 'tests', 'canonical-queries.json');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const DAYS = parseInt(getArg('days', '30'), 10);
const MIN_FREQ = parseInt(getArg('min-freq', '2'), 10);
const LIMIT = parseInt(getArg('limit', '200'), 10);

interface CanonicalQuery {
  special_request: string;
  occasion: string;
  neighborhood: string;
  price_level: string;
  frequency: number;
  canonical_key: string;
  last_seen: string;
}

function normalize(text: string): string {
  return text.toLowerCase().trim().split(/\s+/).sort().join(' ');
}

async function main() {
  const sb = createAdminClient();
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();

  console.log(`Mining queries from last ${DAYS} days (min freq: ${MIN_FREQ}, limit: ${LIMIT})...`);

  // Step 1: Extract raw queries with frequency
  const { data: rawQueries, error } = await sb
    .from('user_queries')
    .select('special_request, occasion, price_level, created_at')
    .gte('created_at', since)
    .not('special_request', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) {
    console.error('Failed to query user_queries:', error.message);
    process.exit(1);
  }

  if (!rawQueries || rawQueries.length === 0) {
    console.log('No queries found in the specified period.');
    writeFileSync(OUTPUT_PATH, JSON.stringify([], null, 2));
    return;
  }

  console.log(`  Found ${rawQueries.length} raw queries`);

  // Step 2: Normalize and count frequency
  const freqMap = new Map<string, { count: number; variants: Map<string, number>; occasion: string; price_level: string; last_seen: string }>();

  for (const row of rawQueries) {
    const sr = (row.special_request as string || '').trim();
    if (sr.length < 3) continue;

    const occasion = (row.occasion as string) || 'Any';
    const priceLevel = (row.price_level as string) || 'Any';
    const key = normalize(sr) + '|' + occasion;

    const existing = freqMap.get(key);
    if (existing) {
      existing.count++;
      existing.variants.set(sr, (existing.variants.get(sr) || 0) + 1);
      if (row.created_at > existing.last_seen) existing.last_seen = row.created_at as string;
    } else {
      freqMap.set(key, {
        count: 1,
        variants: new Map([[sr, 1]]),
        occasion,
        price_level: priceLevel,
        last_seen: row.created_at as string,
      });
    }
  }

  // Step 3: Filter by minimum frequency and pick the most common variant
  const candidates: CanonicalQuery[] = [];

  for (const [key, entry] of freqMap) {
    if (entry.count < MIN_FREQ) continue;

    // Pick most common variant as the representative
    let bestVariant = '';
    let bestCount = 0;
    for (const [variant, count] of entry.variants) {
      if (count > bestCount) {
        bestVariant = variant;
        bestCount = count;
      }
    }

    candidates.push({
      special_request: bestVariant,
      occasion: entry.occasion,
      neighborhood: 'Anywhere',
      price_level: entry.price_level,
      frequency: entry.count,
      canonical_key: key,
      last_seen: entry.last_seen,
    });
  }

  // Sort by frequency descending
  candidates.sort((a, b) => b.frequency - a.frequency);

  // Step 4: Deduplicate — very similar canonical keys get merged
  const deduped: CanonicalQuery[] = [];
  const seenNormalized = new Set<string>();

  for (const c of candidates) {
    const normalizedKey = normalize(c.special_request);
    if (seenNormalized.has(normalizedKey)) continue;
    seenNormalized.add(normalizedKey);
    deduped.push(c);
    if (deduped.length >= LIMIT) break;
  }

  // Step 5: Coverage report
  const cuisineCoverage = new Set<string>();
  const occasionCoverage = new Set<string>();
  for (const q of deduped) {
    occasionCoverage.add(q.occasion);
    // Simple cuisine detection from query text
    const lower = q.special_request.toLowerCase();
    for (const cuisine of ['italian', 'mexican', 'japanese', 'thai', 'chinese', 'korean', 'indian', 'french', 'ethiopian', 'vietnamese', 'american', 'greek', 'bbq', 'seafood', 'steak']) {
      if (lower.includes(cuisine)) cuisineCoverage.add(cuisine);
    }
  }

  console.log(`  Canonical queries: ${deduped.length}`);
  console.log(`  Cuisine coverage: ${[...cuisineCoverage].join(', ') || 'none detected'}`);
  console.log(`  Occasion coverage: ${[...occasionCoverage].join(', ')}`);
  console.log(`  Top 5:`);
  for (const q of deduped.slice(0, 5)) {
    console.log(`    "${q.special_request}" (${q.frequency}x, ${q.occasion})`);
  }

  // Output
  writeFileSync(OUTPUT_PATH, JSON.stringify(deduped, null, 2));
  console.log(`\nWritten ${deduped.length} canonical queries to ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error('Query miner crashed:', e);
  process.exit(1);
});
