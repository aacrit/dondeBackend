/**
 * Project Foxtrot M2 — Reservation Platform Enrichment Pipeline
 *
 * Populates restaurant_reservations with booking deep links for all 2,720 restaurants.
 * Total cost: $0.00 (HTTP validation only, no API keys).
 *
 * Strategy per platform:
 *   OpenTable: HTTP GET validation (200=found, 404=not) — broadest coverage, reliable
 *   Resy:     Optimistic deep links for $$$/$$$$+ restaurants (SPA can't validate server-side)
 *   Tock:     Optimistic deep links for fine dining / $$$$ (403 blocks validation)
 *
 * Modes:
 *   --platform opentable    Full validated scan (1.2s/req, ~55 min for 2,720)
 *   --platform resy         Optimistic links for upscale restaurants (instant, no HTTP)
 *   --platform tock         Optimistic links for fine dining (instant, no HTTP)
 *   (no flag)               All platforms in sequence
 *
 * Usage:
 *   cd scripts && npx tsx pipelines/reservation-enrichment.ts
 *   cd scripts && npx tsx pipelines/reservation-enrichment.ts --platform opentable
 *   cd scripts && npx tsx pipelines/reservation-enrichment.ts --platform opentable --limit 100
 *   cd scripts && npx tsx pipelines/reservation-enrichment.ts --dry-run
 *   cd scripts && npx tsx pipelines/reservation-enrichment.ts --reverify
 *   cd scripts && npx tsx pipelines/reservation-enrichment.ts --verbose
 */

import { createAdminClient } from '../lib/supabase.js';

// ==========================================
// CONFIG
// ==========================================

const RATE_LIMIT_MS = 1200; // 1.2s between requests (safe margin under 1/sec)
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 1;

// ==========================================
// SLUG GENERATORS
// ==========================================

// OpenTable uses "and" for "&": "Girl & The Goat" → "girl-and-the-goat-chicago"
function slugWithAnd(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[''´`]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Resy/Tock drop "&": "Girl & The Goat" → "girl-the-goat"
function slugNoAnd(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[''´`]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ==========================================
// PLATFORM CONFIGS
// ==========================================

interface Restaurant {
  id: string;
  name: string;
  cuisine_type: string | null;
  price_level: string | null;
}

type EnrichFn = (
  restaurants: Restaurant[],
  existingVerified: Set<string>,
  supabase: ReturnType<typeof createAdminClient>,
  opts: { dryRun: boolean; limit: number; reverify: boolean; verbose: boolean },
) => Promise<{ checked: number; found: number; errors: number; skipped: number }>;

// ==========================================
// OPENTABLE — HTTP validated (reliable 200/404)
// ==========================================

async function enrichOpenTable(
  restaurants: Restaurant[],
  existingVerified: Set<string>,
  supabase: ReturnType<typeof createAdminClient>,
  opts: { dryRun: boolean; limit: number; reverify: boolean; verbose: boolean },
) {
  const stats = { checked: 0, found: 0, errors: 0, skipped: 0 };
  const batch: Array<Record<string, unknown>> = [];
  const slice = opts.limit > 0 ? restaurants.slice(0, opts.limit) : restaurants;

  for (let i = 0; i < slice.length; i++) {
    const r = slice[i];
    const key = `${r.id}:opentable`;

    if (existingVerified.has(key) && !opts.reverify) {
      stats.skipped++;
      continue;
    }

    const slug = slugWithAnd(r.name);
    const url = `https://www.opentable.com/r/${slug}-chicago`;

    if (opts.verbose) {
      process.stdout.write(`  [${i + 1}/${slice.length}] ${r.name} → ${url} ... `);
    }

    if (opts.dryRun) {
      if (opts.verbose) console.log('(dry run)');
      stats.checked++;
      continue;
    }

    await sleep(RATE_LIMIT_MS);
    const result = await httpValidate(url);
    stats.checked++;

    if (result.status === 200) {
      stats.found++;
      if (opts.verbose) console.log(`✓ FOUND`);
      batch.push({
        restaurant_id: r.id,
        platform: 'opentable',
        platform_slug: slug,
        booking_url: url,
        url_template: `https://www.opentable.com/r/${slug}-chicago?datetime={date}T{time}&covers={covers}`,
        is_verified: true,
        last_verified_at: new Date().toISOString(),
        priority: 30,
        is_active: true,
      });
    } else {
      if (opts.verbose) console.log(`✗ (${result.status})`);
      if (result.status === 0) stats.errors++;
    }

    if (batch.length >= 50) {
      await upsertBatch(supabase, batch);
      batch.length = 0;
    }

    if ((i + 1) % 100 === 0 && !opts.verbose) {
      console.log(`  [opentable] ${i + 1}/${slice.length} checked, ${stats.found} found`);
    }
  }

  if (batch.length > 0) await upsertBatch(supabase, batch);
  return stats;
}

// ==========================================
// RESY — Optimistic links for upscale restaurants
// ==========================================
// Resy is an SPA (always returns 200). Cannot validate server-side.
// Store unverified deep links for $$/$$$/$$$$ restaurants — these are most
// likely to be on Resy. Users clicking an invalid link see Resy's search page.

function enrichResy(
  restaurants: Restaurant[],
  existingVerified: Set<string>,
  supabase: ReturnType<typeof createAdminClient>,
  opts: { dryRun: boolean; limit: number; reverify: boolean; verbose: boolean },
) {
  return enrichOptimistic(restaurants, existingVerified, supabase, opts, {
    platform: 'resy',
    priority: 20,
    // Resy targets: $$ and above (mid-range to upscale)
    priceFilter: (p: string | null) => !p || p !== '$',
    buildUrl: (slug: string) => `https://resy.com/cities/chi/${slug}`,
    buildTemplate: (slug: string) => `https://resy.com/cities/chi/${slug}?date={date}&seats={covers}`,
    slugFn: slugNoAnd,
  });
}

// ==========================================
// TOCK — Optimistic links for fine dining
// ==========================================
// Tock blocks automated requests (403). Store unverified deep links for
// $$$/$$$$ fine dining and tasting menu restaurants.

function enrichTock(
  restaurants: Restaurant[],
  existingVerified: Set<string>,
  supabase: ReturnType<typeof createAdminClient>,
  opts: { dryRun: boolean; limit: number; reverify: boolean; verbose: boolean },
) {
  return enrichOptimistic(restaurants, existingVerified, supabase, opts, {
    platform: 'tock',
    priority: 25,
    // Tock targets: $$$ and $$$$ only (fine dining, tasting menus)
    priceFilter: (p: string | null) => p === '$$$' || p === '$$$$',
    buildUrl: (slug: string) => `https://www.exploretock.com/${slug}`,
    buildTemplate: (slug: string) => `https://www.exploretock.com/${slug}`,
    slugFn: slugNoAnd,
  });
}

// ==========================================
// OPTIMISTIC ENRICHMENT (no HTTP validation)
// ==========================================

async function enrichOptimistic(
  restaurants: Restaurant[],
  existingVerified: Set<string>,
  supabase: ReturnType<typeof createAdminClient>,
  opts: { dryRun: boolean; limit: number; reverify: boolean; verbose: boolean },
  config: {
    platform: string;
    priority: number;
    priceFilter: (price: string | null) => boolean;
    buildUrl: (slug: string) => string;
    buildTemplate: (slug: string) => string;
    slugFn: (name: string) => string;
  },
) {
  const stats = { checked: 0, found: 0, errors: 0, skipped: 0 };
  const batch: Array<Record<string, unknown>> = [];
  const slice = opts.limit > 0 ? restaurants.slice(0, opts.limit) : restaurants;

  for (const r of slice) {
    const key = `${r.id}:${config.platform}`;

    // Skip if already exists (verified or not — optimistic entries are one-shot)
    if (existingVerified.has(key) && !opts.reverify) {
      stats.skipped++;
      continue;
    }

    // Price filter
    if (!config.priceFilter(r.price_level)) {
      stats.skipped++;
      continue;
    }

    stats.checked++;
    const slug = config.slugFn(r.name);
    const url = config.buildUrl(slug);

    if (opts.verbose) {
      console.log(`  ${r.name} (${r.price_level || '?'}) → ${url}`);
    }

    stats.found++;
    batch.push({
      restaurant_id: r.id,
      platform: config.platform,
      platform_slug: slug,
      booking_url: url,
      url_template: config.buildTemplate(slug),
      is_verified: false, // Not HTTP-validated
      last_verified_at: null,
      priority: config.priority,
      is_active: true,
    });

    if (batch.length >= 100) {
      if (!opts.dryRun) await upsertBatch(supabase, batch);
      batch.length = 0;
    }
  }

  if (batch.length > 0 && !opts.dryRun) await upsertBatch(supabase, batch);
  return stats;
}

// ==========================================
// PHONE FALLBACK — universal fallback for all restaurants
// ==========================================

async function enrichPhoneFallback(
  restaurants: Restaurant[],
  existingVerified: Set<string>,
  supabase: ReturnType<typeof createAdminClient>,
  opts: { dryRun: boolean; limit: number; reverify: boolean; verbose: boolean },
) {
  // Phone fallback is handled by the reservation-links.ts module at runtime
  // using Google Places phone data. No DB entries needed.
  return { checked: 0, found: 0, errors: 0, skipped: restaurants.length };
}

// ==========================================
// HTTP VALIDATION
// ==========================================

async function httpValidate(url: string): Promise<{ status: number }> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DondeAI/1.0)',
          'Accept': 'text/html',
        },
      });

      clearTimeout(timeout);
      // Consume body
      try { await response.text(); } catch {}
      return { status: response.status };
    } catch {
      if (attempt === MAX_RETRIES) return { status: 0 };
      await sleep(2000);
    }
  }
  return { status: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function upsertBatch(
  supabase: ReturnType<typeof createAdminClient>,
  batch: Array<Record<string, unknown>>,
) {
  const { error } = await supabase
    .from('restaurant_reservations')
    .upsert(batch, { onConflict: 'restaurant_id,platform' });
  if (error) console.error(`  Upsert error: ${error.message}`);
}

// ==========================================
// MAIN
// ==========================================

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const targetPlatform = getArg('platform');
const limitArg = parseInt(getArg('limit') || '0', 10) || 0;
const dryRun = hasFlag('dry-run');
const reverify = hasFlag('reverify');
const verbose = hasFlag('verbose');

async function main() {
  const supabase = createAdminClient();

  console.log('='.repeat(60));
  console.log('PROJECT FOXTROT M2: Reservation Platform Enrichment');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Platform: ${targetPlatform || 'ALL (opentable + resy + tock)'}`);
  console.log(`Limit: ${limitArg || 'ALL restaurants'}`);
  console.log('');

  // Fetch all active restaurants with price info
  let allRestaurants: Restaurant[] = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('restaurants')
      .select('id, name, cuisine_type, price_level')
      .eq('is_active', true)
      .order('name', { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) { console.error('Fetch error:', error); process.exit(1); }
    if (!data || data.length === 0) break;
    allRestaurants = allRestaurants.concat(data as Restaurant[]);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  console.log(`Loaded ${allRestaurants.length} active restaurants`);

  // Fetch existing entries
  const { data: existing } = await supabase
    .from('restaurant_reservations')
    .select('restaurant_id, platform, is_verified')
    .eq('is_active', true);

  const existingKeys = new Set(
    (existing || []).map(e => `${e.restaurant_id}:${e.platform}`)
  );
  const verifiedKeys = new Set(
    (existing || []).filter(e => e.is_verified).map(e => `${e.restaurant_id}:${e.platform}`)
  );

  console.log(`Existing entries: ${existingKeys.size} (${verifiedKeys.size} verified)`);

  // Clear bad Resy entries from initial test (all 200s were false positives)
  if (!dryRun) {
    const { error: cleanErr } = await supabase
      .from('restaurant_reservations')
      .delete()
      .eq('platform', 'resy')
      .eq('is_verified', true);
    if (cleanErr) console.warn('Failed to clean false Resy entries:', cleanErr.message);
    else console.log('Cleaned false-positive Resy entries from initial test');
  }

  // Platform dispatch
  const platformMap: Record<string, EnrichFn> = {
    opentable: enrichOpenTable,
    resy: enrichResy,
    tock: enrichTock,
  };

  const platformOrder = targetPlatform ? [targetPlatform] : ['resy', 'tock', 'opentable'];
  const opts = { dryRun, limit: limitArg, reverify, verbose };
  const results: Record<string, { checked: number; found: number; errors: number; skipped: number }> = {};

  for (const pName of platformOrder) {
    const fn = platformMap[pName];
    if (!fn) {
      console.error(`Unknown platform: ${pName}. Options: ${Object.keys(platformMap).join(', ')}`);
      process.exit(1);
    }

    console.log(`\n${'─'.repeat(50)}`);
    const validated = pName === 'opentable';
    console.log(`${pName.toUpperCase()} — ${validated ? 'HTTP validated' : 'optimistic deep links'} (priority ${pName === 'resy' ? 20 : pName === 'tock' ? 25 : 30})`);
    console.log('─'.repeat(50));

    const stats = await fn(allRestaurants, existingKeys, supabase, opts);
    results[pName] = stats;
    console.log(`  ${pName}: ${stats.found} stored / ${stats.checked} eligible / ${stats.skipped} skipped / ${stats.errors} errors`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('ENRICHMENT COMPLETE');
  console.log('='.repeat(60));

  let totalFound = 0;
  let totalChecked = 0;
  for (const [platform, stats] of Object.entries(results)) {
    const validated = platform === 'opentable';
    console.log(`  ${platform.padEnd(12)} ${String(stats.found).padStart(5)} ${validated ? 'verified' : 'optimistic'} / ${String(stats.checked).padStart(5)} eligible (${stats.skipped} skipped)`);
    totalFound += stats.found;
    totalChecked += stats.checked;
  }
  console.log('  ' + '─'.repeat(50));
  console.log(`  ${'TOTAL'.padEnd(12)} ${String(totalFound).padStart(5)} entries / ${String(totalChecked).padStart(5)} checked`);

  const { count } = await supabase
    .from('restaurant_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  console.log(`\n  restaurant_reservations table: ${count} active entries`);
  console.log(`  Cost: $0.00`);
  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
