/**
 * Cache Score Migration — V24 Score Inflation Fix
 *
 * Strategy: Reverse the OLD pipeline to recover raw scores, then apply
 * the NEW V24 pipeline. This preserves Claude blurbs while correcting
 * the inflated donde_match numbers.
 *
 * Old pipeline: raw → old_decompress → +ML_boost(+5/+2) = cached_dm
 * Recovery:     cached_dm - old_ML = old_decompressed → inverse_decompress = raw
 * New pipeline: raw → +new_ML(+3/+1) → new_decompress → inflation_cap = new_dm
 *
 * Usage:
 *   npx tsx pipelines/cache-score-migration.ts          # dry run
 *   npx tsx pipelines/cache-score-migration.ts --apply   # apply changes
 */

import { createAdminClient } from '../lib/supabase.js';

const NEW_ENGINE_VERSION = '11.1.0';
const MAX_INFLATE = 8;

// ============================================================================
// OLD decompression (pre-V24) — for reversing cached scores
// ============================================================================
const OLD_SEGMENTS = [
  { inLow: 0,  inHigh: 60, outLow: 0,  outHigh: 50 },
  { inLow: 60, inHigh: 70, outLow: 50, outHigh: 70 },
  { inLow: 70, inHigh: 78, outLow: 70, outHigh: 78 },
  { inLow: 78, inHigh: 88, outLow: 78, outHigh: 92 },
  { inLow: 88, inHigh: 99, outLow: 92, outHigh: 99 },
];

/** Inverse of old decompression: given decompressed value, recover raw score */
function inverseOldDecompress(decompressed: number): number {
  if (decompressed <= 0) return 0;
  if (decompressed >= 99) return 99;

  // Inverse: swap in/out ranges
  for (const seg of OLD_SEGMENTS) {
    if (decompressed >= seg.outLow && decompressed <= seg.outHigh) {
      const range = seg.outHigh - seg.outLow;
      if (range === 0) return seg.inLow;
      const t = (decompressed - seg.outLow) / range;
      return Math.round(seg.inLow + t * (seg.inHigh - seg.inLow));
    }
  }
  return Math.round(decompressed);
}

// ============================================================================
// NEW V24 decompression — must match scoring-v9.ts exactly
// ============================================================================
function decompressScoreV24(rawScore: number): number {
  if (rawScore <= 0) return 0;
  if (rawScore >= 99) return 99;

  const segments = [
    { inLow: 0,  inHigh: 60, outLow: 0,  outHigh: 50 },
    { inLow: 60, inHigh: 70, outLow: 50, outHigh: 70 },
    { inLow: 70, inHigh: 78, outLow: 70, outHigh: 78 },
    { inLow: 78, inHigh: 88, outLow: 78, outHigh: 89 },
    { inLow: 88, inHigh: 99, outLow: 89, outHigh: 99 },
  ];

  for (const seg of segments) {
    if (rawScore >= seg.inLow && rawScore <= seg.inHigh) {
      const t = (rawScore - seg.inLow) / (seg.inHigh - seg.inLow);
      return Math.round(seg.outLow + t * (seg.outHigh - seg.outLow));
    }
  }
  return Math.round(rawScore);
}

// ============================================================================
// Migration logic: reverse old pipeline → apply new pipeline
// ============================================================================

function migrateScore(oldFinalDM: number, oldMlAdjustment: number): {
  rawDM: number;
  newDM: number;
} {
  // Step 1: Reverse old ML boost (was applied AFTER decompression)
  const oldDecompressed = Math.max(0, oldFinalDM - oldMlAdjustment);

  // Step 2: Reverse old decompression to recover raw score
  const rawDM = inverseOldDecompress(oldDecompressed);

  // Step 3: Apply new ML boost (scaled: +5→+3, +2→+1) BEFORE decompression
  let newMlBoost = 0;
  if (oldMlAdjustment >= 5) newMlBoost = 3;
  else if (oldMlAdjustment >= 2) newMlBoost = 1;
  const mlBoosted = Math.min(99, rawDM + newMlBoost);

  // Step 4: Apply new V24 decompression
  const newDecompressed = decompressScoreV24(mlBoosted);

  // Step 5: Apply inflation cap (max +8 from raw)
  const newDM = Math.min(rawDM + MAX_INFLATE, newDecompressed);

  return { rawDM, newDM };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const applyMode = process.argv.includes('--apply');
  const sb = createAdminClient();

  console.log(`Cache Score Migration — V24 Score Inflation Fix`);
  console.log(`Strategy: Reverse old pipeline → apply new V24 pipeline`);
  console.log(`Mode: ${applyMode ? 'APPLY' : 'DRY RUN'}\n`);

  // Fetch cache entries in pages to avoid statement timeout
  const PAGE_SIZE = 100;
  let entries: Record<string, unknown>[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: page, error } = await sb
      .from('query_cache')
      .select('id, special_request, donde_match, response_body, ranked_queue, engine_version')
      .neq('engine_version', NEW_ENGINE_VERSION)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('Failed to fetch cache entries:', error.message);
      process.exit(1);
    }

    if (!page || page.length === 0) {
      hasMore = false;
    } else {
      entries = entries.concat(page as Record<string, unknown>[]);
      offset += PAGE_SIZE;
      if (page.length < PAGE_SIZE) hasMore = false;
      console.log(`  Fetched ${entries.length} entries so far...`);
    }
  }

  if (entries.length === 0) {
    console.log('No cache entries to migrate. All entries are already on v11.1.0.');
    return;
  }

  console.log(`Found ${entries.length} cache entries to migrate\n`);

  let migrated = 0;
  let skipped = 0;
  let totalDelta = 0;
  const deltas: { query: string; old: number; new: number; raw: number; delta: number }[] = [];

  for (const entry of entries) {
    const body = entry.response_body as Record<string, unknown> | null;
    if (!body) { skipped++; continue; }

    const oldDM = Number(entry.donde_match || body.donde_match || 0);
    if (oldDM === 0) { skipped++; continue; }

    // Get old ML adjustment from response
    const mlScoring = body.ml_scoring as Record<string, unknown> | null;
    const adjustments = (mlScoring?.adjustments || []) as Record<string, unknown>[];
    const primaryAdj = adjustments.length > 0 ? Number(adjustments[0].ml_adjustment || 0) : 0;

    // Migrate primary score
    const { rawDM, newDM } = migrateScore(oldDM, primaryAdj);
    const delta = newDM - oldDM;

    deltas.push({
      query: String(entry.special_request || '').slice(0, 40),
      old: oldDM,
      new: newDM,
      raw: rawDM,
      delta,
    });
    totalDelta += delta;

    // Update response_body.donde_match
    body.donde_match = newDM;

    // Update ranked_queue scores
    const queue = (entry.ranked_queue || body.ranked_queue || []) as Record<string, unknown>[];
    for (const item of queue) {
      const itemOldDM = Number(item.donde_match || 0);
      if (itemOldDM === 0) continue;

      // Find ML adjustment for this queue item
      const restId = String((item.restaurant as Record<string, unknown>)?.id || '');
      const itemMlAdj = adjustments.find((a) =>
        String(a.restaurant_id || '') === restId
      );
      const itemOldMl = itemMlAdj ? Number(itemMlAdj.ml_adjustment || 0) : 0;
      const { newDM: itemNewDM } = migrateScore(itemOldDM, itemOldMl);
      item.donde_match = itemNewDM;
    }

    if (applyMode) {
      const { error: updateErr } = await sb
        .from('query_cache')
        .update({
          donde_match: newDM,
          response_body: body,
          ranked_queue: queue.length > 0 ? queue : null,
          engine_version: NEW_ENGINE_VERSION,
        })
        .eq('id', entry.id);

      if (updateErr) {
        console.error(`  Failed to update ${entry.id}:`, updateErr.message);
        skipped++;
        continue;
      }
    }

    migrated++;
  }

  // Print summary
  console.log('\n=== Migration Summary ===\n');
  console.log(`Migrated: ${migrated}`);
  console.log(`Skipped:  ${skipped}`);
  console.log(`Avg delta: ${(totalDelta / Math.max(migrated, 1)).toFixed(1)} points`);

  // Show sample migrations
  deltas.sort((a, b) => a.delta - b.delta);
  console.log(`\nBiggest score decreases:`);
  for (const d of deltas.slice(0, 10)) {
    console.log(`  ${d.old} → ${d.new} (raw=${d.raw}, ${d.delta >= 0 ? '+' : ''}${d.delta})  "${d.query}"`);
  }
  console.log(`\nSmallest changes (near zero):`);
  const nearZero = deltas.filter(d => Math.abs(d.delta) <= 1).slice(0, 5);
  for (const d of nearZero) {
    console.log(`  ${d.old} → ${d.new} (raw=${d.raw}, ${d.delta >= 0 ? '+' : ''}${d.delta})  "${d.query}"`);
  }

  // Distribution of deltas
  const buckets: Record<string, number> = {
    '<-8': 0, '-8to-5': 0, '-4to-3': 0, '-2to-1': 0, '0': 0, '+1to+2': 0, '>+2': 0,
  };
  for (const d of deltas) {
    if (d.delta < -8) buckets['<-8']++;
    else if (d.delta < -4) buckets['-8to-5']++;
    else if (d.delta < -2) buckets['-4to-3']++;
    else if (d.delta < 0) buckets['-2to-1']++;
    else if (d.delta === 0) buckets['0']++;
    else if (d.delta <= 2) buckets['+1to+2']++;
    else buckets['>+2']++;
  }
  console.log(`\nDelta distribution:`);
  for (const [k, v] of Object.entries(buckets)) {
    const bar = '#'.repeat(Math.min(v, 80));
    console.log(`  ${k.padEnd(8)} ${bar} (${v})`);
  }

  if (!applyMode) {
    console.log('\n** DRY RUN — no changes written. Use --apply to commit. **');
  } else {
    console.log(`\nDone. ${migrated} cache entries migrated to engine_version ${NEW_ENGINE_VERSION}.`);
  }
}

main().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
