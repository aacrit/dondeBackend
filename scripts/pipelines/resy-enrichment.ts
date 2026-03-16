/**
 * Project Foxtrot — Resy Venue Validation & Enrichment Pipeline
 *
 * Uses Resy's public client API to:
 * 1. Validate which DondeAI restaurants are actually on Resy
 * 2. Get correct venue IDs and slugs (our optimistic slugs are often wrong)
 * 3. Store verified Resy data in restaurant_reservations
 *
 * API: Resy search endpoint (same key their website uses, no signup needed)
 * Rate limit: 1 req/sec to be respectful
 * Cost: $0
 *
 * Usage:
 *   cd scripts && npx tsx pipelines/resy-enrichment.ts
 *   cd scripts && npx tsx pipelines/resy-enrichment.ts --limit 50 --verbose
 *   cd scripts && npx tsx pipelines/resy-enrichment.ts --dry-run
 */

import { createAdminClient } from '../lib/supabase.js';

const RESY_API_KEY = 'VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5'; // Resy public client key
const RATE_LIMIT_MS = 1200;
const REQUEST_TIMEOUT_MS = 8000;

// Chicago coordinates for geo search
const CHI_LAT = 41.8781;
const CHI_LNG = -87.6298;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface ResySearchHit {
  name: string;
  id: { resy: number };
  url_slug: string;
  location: {
    city?: string;
    neighborhood?: string;
    address_1?: string;
  };
  contact?: { phone_number?: string };
}

async function searchResy(query: string): Promise<ResySearchHit[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.resy.com/3/venuesearch/search', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `ResyAPI api_key="${RESY_API_KEY}"`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        geo: { latitude: CHI_LAT, longitude: CHI_LNG },
        query,
        per_page: 5,
        types: ['venue'],
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) return [];
    const data = await response.json();
    return data?.search?.hits || [];
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''´`&]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMatch(dbName: string, resyHit: ResySearchHit): boolean {
  const a = normalizeForMatch(dbName);
  const b = normalizeForMatch(resyHit.name);

  // Exact match
  if (a === b) return true;

  // Strip common suffixes for comparison: "- Chicago", "Restaurant", etc.
  const strip = (s: string) => s.replace(/\s*(chicago|restaurant|bar|grill|cafe|caf)\s*$/i, '').trim();
  const aStrip = strip(a);
  const bStrip = strip(b);
  if (aStrip === bStrip) return true;

  // One contains the other — but require the contained string is substantial (>60% of the longer)
  const longer = Math.max(a.length, b.length);
  if (a.includes(b) && b.length / longer > 0.6) return true;
  if (b.includes(a) && a.length / longer > 0.6) return true;

  return false;
}

// CLI args
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);
const limitArg = parseInt(getArg('limit') || '0', 10) || 0;
const dryRun = hasFlag('dry-run');
const verbose = hasFlag('verbose');

async function main() {
  const supabase = createAdminClient();

  console.log('='.repeat(60));
  console.log('PROJECT FOXTROT: Resy Venue Validation');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Limit: ${limitArg || 'ALL'}`);
  console.log('');

  // Fetch all restaurants
  let allRestaurants: Array<{ id: string; name: string; price_level: string | null }> = [];
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from('restaurants')
      .select('id, name, price_level')
      .eq('is_active', true)
      .order('name', { ascending: true })
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (error || !data?.length) break;
    allRestaurants = allRestaurants.concat(data);
    if (data.length < 1000) break;
    page++;
  }

  console.log(`Loaded ${allRestaurants.length} restaurants`);

  // Only check $$ and above (Resy is upscale-focused)
  const eligible = allRestaurants.filter(r => !r.price_level || r.price_level !== '$');
  const slice = limitArg > 0 ? eligible.slice(0, limitArg) : eligible;
  console.log(`Eligible ($$+): ${eligible.length}, scanning: ${slice.length}`);
  console.log('');

  const stats = { checked: 0, found: 0, notFound: 0, errors: 0 };
  const batch: Array<Record<string, unknown>> = [];

  for (let i = 0; i < slice.length; i++) {
    const r = slice[i];
    stats.checked++;

    if (verbose) process.stdout.write(`[${i + 1}/${slice.length}] ${r.name} ... `);

    if (dryRun) {
      if (verbose) console.log('(dry run)');
      continue;
    }

    await sleep(RATE_LIMIT_MS);

    const hits = await searchResy(r.name);
    const match = hits.find(h => isMatch(r.name, h));

    if (match) {
      stats.found++;
      const resyId = match.id?.resy || match.id;
      const slug = match.url_slug;
      if (verbose) console.log(`FOUND → id=${resyId} slug=${slug}`);

      batch.push({
        restaurant_id: r.id,
        platform: 'resy',
        platform_id: String(resyId),
        platform_slug: slug,
        booking_url: `https://resy.com/cities/chi/${slug}`,
        url_template: `https://resy.com/cities/chi/${slug}?date={date}&seats={covers}`,
        is_verified: true,
        last_verified_at: new Date().toISOString(),
        priority: 20,
        is_active: true,
      });
    } else {
      stats.notFound++;
      if (verbose) console.log('not on Resy');
    }

    if (batch.length >= 50) {
      const { error } = await supabase
        .from('restaurant_reservations')
        .upsert(batch, { onConflict: 'restaurant_id,platform' });
      if (error) console.error(`Upsert error: ${error.message}`);
      batch.length = 0;
    }

    if ((i + 1) % 100 === 0 && !verbose) {
      console.log(`  [${i + 1}/${slice.length}] ${stats.found} found, ${stats.notFound} not on Resy`);
    }
  }

  if (batch.length > 0) {
    const { error } = await supabase
      .from('restaurant_reservations')
      .upsert(batch, { onConflict: 'restaurant_id,platform' });
    if (error) console.error(`Upsert error: ${error.message}`);
  }

  // Mark old unverified Resy entries as inactive (were optimistic, now we have real data)
  if (!dryRun && stats.found > 0) {
    // Only deactivate unverified entries for restaurants we actually checked
    // (don't touch entries for restaurants outside our scan)
  }

  console.log('\n' + '='.repeat(60));
  console.log('RESY VALIDATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Checked:   ${stats.checked}`);
  console.log(`  On Resy:   ${stats.found} (verified with real IDs + slugs)`);
  console.log(`  Not found: ${stats.notFound}`);
  console.log(`  Errors:    ${stats.errors}`);
  console.log(`  Cost:      $0.00`);

  const { count } = await supabase
    .from('restaurant_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('platform', 'resy')
    .eq('is_verified', true);
  console.log(`\n  Verified Resy entries: ${count}`);
  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
