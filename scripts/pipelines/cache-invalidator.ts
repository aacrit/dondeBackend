/**
 * Cache Invalidator — Cleanup and invalidation for DondeCache.
 *
 * Operations:
 *   1. DELETE expired entries (expires_at < now())
 *   2. Mark stale entries when engine_version doesn't match current
 *   3. Invalidate entries for recently-enriched restaurants
 *
 * Usage:
 *   npx tsx pipelines/cache-invalidator.ts
 */

import { createAdminClient } from '../lib/supabase.js';

const CURRENT_ENGINE_VERSION = '11.1.0'; // V24: bumped for score inflation fix

async function main() {
  const sb = createAdminClient();
  const now = new Date().toISOString();

  console.log('DondeCache Invalidator starting...');

  // Step 1: Delete expired entries
  const { data: expired, error: expErr } = await sb
    .from('query_cache')
    .delete()
    .lt('expires_at', now)
    .select('id');

  if (expErr) {
    console.error('Failed to delete expired entries:', expErr.message);
  } else {
    const count = expired?.length || 0;
    console.log(`  Deleted ${count} expired cache entries`);
  }

  // Step 2: Delete stale engine version entries
  const { data: stale, error: staleErr } = await sb
    .from('query_cache')
    .delete()
    .neq('engine_version', CURRENT_ENGINE_VERSION)
    .select('id');

  if (staleErr) {
    console.error('Failed to delete stale version entries:', staleErr.message);
  } else {
    const count = stale?.length || 0;
    console.log(`  Deleted ${count} stale engine version entries`);
  }

  // Step 3: Check for recently enriched restaurants (last 24h) and invalidate
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: enriched, error: enrichErr } = await sb
    .from('restaurant_deep_profiles')
    .select('restaurant_id')
    .gte('updated_at', oneDayAgo);

  if (enrichErr) {
    console.warn('Failed to check recently enriched restaurants:', enrichErr.message);
  } else if (enriched && enriched.length > 0) {
    const ids = enriched.map((r: Record<string, string>) => r.restaurant_id);
    const { data: invalidated, error: invErr } = await sb
      .from('query_cache')
      .delete()
      .in('primary_restaurant_id', ids)
      .select('id');

    if (invErr) {
      console.error('Failed to invalidate enriched restaurant entries:', invErr.message);
    } else {
      const count = invalidated?.length || 0;
      console.log(`  Invalidated ${count} entries for ${enriched.length} recently-enriched restaurants`);
    }
  } else {
    console.log('  No recently-enriched restaurants');
  }

  // Step 4: Report cache stats
  const { data: stats } = await sb.rpc('get_cache_dashboard');
  if (stats) {
    const s = stats as Record<string, unknown>;
    console.log(`\nCache Health:`);
    console.log(`  Active entries: ${s.cache_size}`);
    console.log(`  Hit rate (24h): ${s.hit_rate_24h}%`);
    console.log(`  Savings (24h):  $${s.savings_24h_dollars}`);
  }

  console.log('\nCache invalidation complete.');
}

main().catch(e => {
  console.error('Cache invalidator crashed:', e);
  process.exit(1);
});
