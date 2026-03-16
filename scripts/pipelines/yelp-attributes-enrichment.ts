/**
 * Project Foxtrot — Yelp Attributes Enrichment Pipeline
 *
 * Enriches restaurant_deep_profiles with Yelp business attributes:
 *   - wheelchair_accessible (from Yelp attributes)
 *   - alcohol_type (full_bar, beer_and_wine, none)
 *   - delivery_available (from transactions[])
 *   - takeout_available (from transactions[])
 *   - has_private_dining (logged but not stored — no column yet)
 *
 * Uses Yelp Fusion Business Match API to find the Yelp business by name + address,
 * then fetches business details for attributes.
 *
 * Requires: YELP_API_KEY environment variable (set in .env)
 *
 * Usage:
 *   cd scripts && npx tsx pipelines/yelp-attributes-enrichment.ts
 *   cd scripts && npx tsx pipelines/yelp-attributes-enrichment.ts --limit 10
 *   cd scripts && npx tsx pipelines/yelp-attributes-enrichment.ts --dry-run
 *   cd scripts && npx tsx pipelines/yelp-attributes-enrichment.ts --verbose
 *   cd scripts && npx tsx pipelines/yelp-attributes-enrichment.ts --force  (re-enrich already-enriched restaurants)
 *
 * Cost: $0 (Yelp Fusion API is free for up to 5,000 API calls/day)
 */

import { createAdminClient } from '../lib/supabase.js';

// ==========================================
// CONFIG
// ==========================================

const RATE_LIMIT_MS = 350; // ~3 requests/sec (Yelp allows 5,000/day = ~3.5/sec sustained)
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;
const BATCH_SIZE = 50;
const YELP_API_BASE = 'https://api.yelp.com/v3';

// ==========================================
// TYPES
// ==========================================

interface Restaurant {
  id: string;
  name: string;
  address: string;
}

interface DeepProfileRow {
  restaurant_id: string;
  wheelchair_accessible: boolean | null;
  alcohol_type: string | null;
  delivery_available: boolean | null;
  takeout_available: boolean | null;
}

interface YelpBusiness {
  id: string;
  name: string;
  transactions: string[]; // "delivery", "pickup", "restaurant_reservation"
  attributes?: Record<string, unknown>;
}

interface YelpBusinessDetails {
  id: string;
  name: string;
  transactions: string[];
  attributes?: Record<string, unknown>;
}

// ==========================================
// YELP API FUNCTIONS
// ==========================================

/**
 * Match a restaurant to a Yelp business using the Business Match endpoint.
 * Falls back to Business Search if match fails.
 */
async function findYelpBusiness(
  name: string,
  address: string,
  apiKey: string,
): Promise<string | null> {
  // Parse address for Yelp parameters
  // Typical format: "123 N Main St, Chicago, IL 60601"
  const parts = address.split(',').map(p => p.trim());
  const address1 = parts[0] || '';
  const city = parts[1] || 'Chicago';
  const stateZip = (parts[2] || 'IL').trim().split(/\s+/);
  const state = stateZip[0] || 'IL';

  // Try Business Match first (most accurate)
  try {
    const matchParams = new URLSearchParams({
      name,
      address1,
      city,
      state,
      country: 'US',
    });

    const matchResult = await yelpFetch(
      `${YELP_API_BASE}/businesses/matches?${matchParams}`,
      apiKey,
    );

    if (matchResult?.businesses?.length > 0) {
      return matchResult.businesses[0].id;
    }
  } catch {
    // Fall through to search
  }

  // Fallback: Business Search by name + location
  try {
    const searchParams = new URLSearchParams({
      term: name,
      location: `${address1}, ${city}, ${state}`,
      limit: '1',
    });

    const searchResult = await yelpFetch(
      `${YELP_API_BASE}/businesses/search?${searchParams}`,
      apiKey,
    );

    if (searchResult?.businesses?.length > 0) {
      // Verify name similarity to avoid false matches
      const yelpName = searchResult.businesses[0].name.toLowerCase();
      const ourName = name.toLowerCase();
      if (
        yelpName.includes(ourName) ||
        ourName.includes(yelpName) ||
        levenshteinSimilarity(yelpName, ourName) > 0.6
      ) {
        return searchResult.businesses[0].id;
      }
    }
  } catch {
    // No match found
  }

  return null;
}

/**
 * Fetch full business details from Yelp to get attributes.
 */
async function getYelpBusinessDetails(
  yelpId: string,
  apiKey: string,
): Promise<YelpBusinessDetails | null> {
  try {
    const result = await yelpFetch(
      `${YELP_API_BASE}/businesses/${encodeURIComponent(yelpId)}`,
      apiKey,
    );
    return result as YelpBusinessDetails;
  } catch {
    return null;
  }
}

/**
 * Extract the attributes we care about from a Yelp business response.
 */
function extractAttributes(business: YelpBusinessDetails): {
  wheelchair_accessible: boolean | null;
  alcohol_type: string | null;
  delivery_available: boolean;
  takeout_available: boolean;
  has_private_dining: boolean | null;
} {
  const transactions = business.transactions || [];
  const attrs = business.attributes || {};

  // Delivery & takeout from transactions[]
  const delivery_available = transactions.includes('delivery');
  const takeout_available = transactions.includes('pickup');

  // Wheelchair accessible from attributes
  let wheelchair_accessible: boolean | null = null;
  if (attrs.wheelchair_accessible !== undefined) {
    wheelchair_accessible = attrs.wheelchair_accessible === true ||
      attrs.wheelchair_accessible === 'True' ||
      attrs.wheelchair_accessible === 'true';
  }

  // Alcohol type from attributes
  let alcohol_type: string | null = null;
  if (attrs.alcohol !== undefined) {
    const alcoholVal = String(attrs.alcohol).toLowerCase();
    if (alcoholVal.includes('full_bar') || alcoholVal === 'full_bar') {
      alcohol_type = 'full_bar';
    } else if (alcoholVal.includes('beer_and_wine') || alcoholVal === 'beer_and_wine') {
      alcohol_type = 'beer_and_wine';
    } else if (alcoholVal.includes('none') || alcoholVal === 'none' || alcoholVal === 'dont_allow_byob') {
      alcohol_type = 'none';
    }
  }

  // Private dining from attributes (logged for future use)
  let has_private_dining: boolean | null = null;
  if (attrs.private_dining !== undefined) {
    has_private_dining = attrs.private_dining === true ||
      attrs.private_dining === 'True' ||
      attrs.private_dining === 'true';
  }

  return {
    wheelchair_accessible,
    alcohol_type,
    delivery_available,
    takeout_available,
    has_private_dining,
  };
}

// ==========================================
// HTTP HELPERS
// ==========================================

async function yelpFetch(url: string, apiKey: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeout);

      if (response.status === 429) {
        // Rate limited — back off
        console.warn('  Yelp rate limit hit, waiting 5s...');
        await sleep(5000);
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Yelp API ${response.status}: ${text.slice(0, 200)}`);
      }

      return await response.json() as Record<string, unknown>;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw new Error('Max retries exceeded');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Simple Levenshtein similarity (0-1) for name matching.
 */
function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  const distance = matrix[a.length][b.length];
  return 1 - distance / maxLen;
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

const limitArg = parseInt(getArg('limit') || '0', 10) || 0;
const dryRun = hasFlag('dry-run');
const verbose = hasFlag('verbose');
const force = hasFlag('force');

async function main() {
  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) {
    console.error('ERROR: YELP_API_KEY environment variable is not set.');
    console.error('Add YELP_API_KEY=your_key to your .env file.');
    console.error('Get a free API key at: https://www.yelp.com/developers/v3/manage_app');
    process.exit(1);
  }

  const supabase = createAdminClient();

  console.log('='.repeat(60));
  console.log('PROJECT FOXTROT: Yelp Attributes Enrichment');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Limit: ${limitArg || 'ALL restaurants'}`);
  console.log(`Force re-enrich: ${force ? 'YES' : 'NO'}`);
  console.log('');

  // Fetch all active restaurants
  let allRestaurants: Restaurant[] = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('restaurants')
      .select('id, name, address')
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

  // Check which restaurants already have Yelp data (skip unless --force)
  let alreadyEnriched = new Set<string>();
  if (!force) {
    const { data: existing } = await supabase
      .from('restaurant_deep_profiles')
      .select('restaurant_id')
      .not('delivery_available', 'is', null);

    if (existing) {
      alreadyEnriched = new Set(existing.map((e: { restaurant_id: string }) => e.restaurant_id));
    }
    console.log(`Already enriched: ${alreadyEnriched.size} (skipping unless --force)`);
  }

  // Filter to unenriched restaurants
  const toEnrich = allRestaurants.filter(r => !alreadyEnriched.has(r.id));
  const slice = limitArg > 0 ? toEnrich.slice(0, limitArg) : toEnrich;

  console.log(`To enrich: ${slice.length}`);
  console.log('');

  // Stats
  const stats = {
    checked: 0,
    matched: 0,
    enriched: 0,
    noMatch: 0,
    errors: 0,
    privateDining: 0,
  };

  const updateBatch: Array<{
    restaurant_id: string;
    wheelchair_accessible: boolean | null;
    alcohol_type: string | null;
    delivery_available: boolean;
    takeout_available: boolean;
  }> = [];

  for (let i = 0; i < slice.length; i++) {
    const r = slice[i];
    stats.checked++;

    if (verbose) {
      process.stdout.write(`  [${i + 1}/${slice.length}] ${r.name} ... `);
    }

    if (dryRun) {
      if (verbose) console.log('(dry run)');
      continue;
    }

    try {
      // Rate limit
      await sleep(RATE_LIMIT_MS);

      // Step 1: Find Yelp business
      const yelpId = await findYelpBusiness(r.name, r.address, apiKey);

      if (!yelpId) {
        stats.noMatch++;
        if (verbose) console.log('NO MATCH');
        continue;
      }

      stats.matched++;

      // Step 2: Get full details
      await sleep(RATE_LIMIT_MS);
      const details = await getYelpBusinessDetails(yelpId, apiKey);

      if (!details) {
        if (verbose) console.log('DETAILS FAILED');
        stats.errors++;
        continue;
      }

      // Step 3: Extract attributes
      const attrs = extractAttributes(details);

      if (attrs.has_private_dining) {
        stats.privateDining++;
        if (verbose) console.log(`  (has private dining)`);
      }

      stats.enriched++;
      if (verbose) {
        const parts = [];
        if (attrs.wheelchair_accessible !== null) parts.push(`wheelchair=${attrs.wheelchair_accessible}`);
        if (attrs.alcohol_type) parts.push(`alcohol=${attrs.alcohol_type}`);
        if (attrs.delivery_available) parts.push('delivery');
        if (attrs.takeout_available) parts.push('takeout');
        console.log(parts.length > 0 ? parts.join(', ') : 'no attributes');
      }

      updateBatch.push({
        restaurant_id: r.id,
        wheelchair_accessible: attrs.wheelchair_accessible,
        alcohol_type: attrs.alcohol_type,
        delivery_available: attrs.delivery_available,
        takeout_available: attrs.takeout_available,
      });

      // Flush batch
      if (updateBatch.length >= BATCH_SIZE) {
        await flushBatch(supabase, updateBatch);
        updateBatch.length = 0;
      }
    } catch (err) {
      stats.errors++;
      if (verbose) console.log(`ERROR: ${err instanceof Error ? err.message : err}`);
    }

    // Progress log
    if ((i + 1) % 100 === 0 && !verbose) {
      console.log(`  [${i + 1}/${slice.length}] matched=${stats.matched}, enriched=${stats.enriched}, errors=${stats.errors}`);
    }
  }

  // Flush remaining
  if (updateBatch.length > 0) {
    await flushBatch(supabase, updateBatch);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('ENRICHMENT COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Checked:          ${stats.checked}`);
  console.log(`  Yelp matched:     ${stats.matched}`);
  console.log(`  Enriched:         ${stats.enriched}`);
  console.log(`  No match:         ${stats.noMatch}`);
  console.log(`  Errors:           ${stats.errors}`);
  console.log(`  Private dining:   ${stats.privateDining} (logged only — no column yet)`);
  console.log(`  Cost:             $0.00 (Yelp Fusion free tier)`);
  console.log('');
}

async function flushBatch(
  supabase: ReturnType<typeof createAdminClient>,
  batch: Array<{
    restaurant_id: string;
    wheelchair_accessible: boolean | null;
    alcohol_type: string | null;
    delivery_available: boolean;
    takeout_available: boolean;
  }>,
) {
  for (const row of batch) {
    const { error } = await supabase
      .from('restaurant_deep_profiles')
      .update({
        wheelchair_accessible: row.wheelchair_accessible,
        alcohol_type: row.alcohol_type,
        delivery_available: row.delivery_available,
        takeout_available: row.takeout_available,
      })
      .eq('restaurant_id', row.restaurant_id);

    if (error) {
      console.error(`  Update error for ${row.restaurant_id}: ${error.message}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
