/**
 * Cache Score Migration — V24 Score Inflation Fix
 *
 * Recalculates donde_match scores in existing cache entries using the
 * new V24 decompression curve and inflation cap, then stamps them with
 * engine_version 11.1.0 so they're visible to the updated Edge Function.
 *
 * Preserves Claude-generated blurbs — only touches score fields.
 *
 * Usage:
 *   npx tsx pipelines/cache-score-migration.ts          # dry run
 *   npx tsx pipelines/cache-score-migration.ts --apply   # apply changes
 */

import { createAdminClient } from '../lib/supabase.js';

const NEW_ENGINE_VERSION = '11.1.0';
const MAX_INFLATE = 8;

// V24 decompression — must match scoring-v9.ts exactly
function decompressScoreV24(rawScore: number): number {
  if (rawScore <= 0) return 0;
  if (rawScore >= 99) return 99;

  const segments = [
    { inLow: 0,  inHigh: 60, outLow: 0,  outHigh: 50 },
    { inLow: 60, inHigh: 70, outLow: 50, outHigh: 70 },
    { inLow: 70, inHigh: 78, outLow: 70, outHigh: 78 },
    { inLow: 78, inHigh: 88, outLow: 78, outHigh: 89 },  // V24: was [78,92]
    { inLow: 88, inHigh: 99, outLow: 89, outHigh: 99 },  // V24: adjusted
  ];

  for (const seg of segments) {
    if (rawScore >= seg.inLow && rawScore <= seg.inHigh) {
      const t = (rawScore - seg.inLow) / (seg.inHigh - seg.inLow);
      return Math.round(seg.outLow + t * (seg.outHigh - seg.outLow));
    }
  }
  return Math.round(rawScore);
}

// Recalculate a single score from scoring_v9 components
function recalculateScore(
  scoringV9: Record<string, unknown>,
  oldMlAdjustment: number,
): { rawDM: number; newDM: number } {
  const relevance = Number(scoringV9.relevance_score || 0);
  const quality = Number(scoringV9.quality_score || 0);
  const occasion = Number(scoringV9.occasion_bonus || 0);

  // Raw DM = round(relevance × quality) + occasion
  const rawDM = Math.min(99, Math.max(0, Math.round(relevance * quality) + occasion));

  // Apply scaled ML boost: old +5 → new +3, old +2 → new +1
  let newMlBoost = 0;
  if (oldMlAdjustment >= 5) newMlBoost = 3;
  else if (oldMlAdjustment >= 2) newMlBoost = 1;
  const mlBoosted = Math.min(99, rawDM + newMlBoost);

  // Decompress with V24 curve
  const decompressed = decompressScoreV24(mlBoosted);

  // Inflation cap: max +8 from raw (pre-boost)
  const capped = Math.min(rawDM + MAX_INFLATE, decompressed);

  return { rawDM, newDM: capped };
}

async function main() {
  const applyMode = process.argv.includes('--apply');
  const sb = createAdminClient();

  console.log(`Cache Score Migration — V24 Score Inflation Fix`);
  console.log(`Mode: ${applyMode ? 'APPLY' : 'DRY RUN'}\n`);

  // Fetch all cache entries with old engine version
  const { data: entries, error } = await sb
    .from('query_cache')
    .select('id, cache_key, special_request, donde_match, response_body, ranked_queue, engine_version')
    .neq('engine_version', NEW_ENGINE_VERSION);

  if (error) {
    console.error('Failed to fetch cache entries:', error.message);
    process.exit(1);
  }

  if (!entries || entries.length === 0) {
    console.log('No cache entries to migrate. All entries are already on v11.1.0.');
    return;
  }

  console.log(`Found ${entries.length} cache entries to migrate\n`);

  let migrated = 0;
  let skipped = 0;
  let totalDelta = 0;
  const deltas: { query: string; old: number; new: number; delta: number }[] = [];

  for (const entry of entries) {
    const body = entry.response_body as Record<string, unknown> | null;
    if (!body) { skipped++; continue; }

    const scoringV9 = body.scoring_v9 as Record<string, unknown> | null;
    if (!scoringV9) { skipped++; continue; }

    const oldDM = Number(entry.donde_match || body.donde_match || 0);

    // Get old ML adjustment from response
    const mlScoring = body.ml_scoring as Record<string, unknown> | null;
    const adjustments = (mlScoring?.adjustments || []) as Record<string, unknown>[];
    const primaryAdj = adjustments.length > 0 ? Number(adjustments[0].ml_adjustment || 0) : 0;

    // Recalculate primary score
    const { rawDM, newDM } = recalculateScore(scoringV9, primaryAdj);
    const delta = newDM - oldDM;

    deltas.push({
      query: String(entry.special_request || '').slice(0, 40),
      old: oldDM,
      new: newDM,
      delta,
    });
    totalDelta += delta;

    // Update response_body.donde_match
    body.donde_match = newDM;

    // Update ranked_queue scores
    const queue = (entry.ranked_queue || body.ranked_queue || []) as Record<string, unknown>[];
    for (const item of queue) {
      const itemScoringV9 = item.scoring_v9 as Record<string, unknown> | null;
      if (!itemScoringV9) continue;
      const itemOldDM = Number(item.donde_match || 0);
      // Check if this queue item had an ML adjustment
      const itemMlAdj = adjustments.find((a) => {
        const restId = String((item.restaurant as Record<string, unknown>)?.id || '');
        return String(a.restaurant_id || '') === restId;
      });
      const itemOldMl = itemMlAdj ? Number(itemMlAdj.ml_adjustment || 0) : 0;
      const { newDM: itemNewDM } = recalculateScore(itemScoringV9, itemOldMl);
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

  // Show biggest changes
  deltas.sort((a, b) => a.delta - b.delta);
  console.log(`\nBiggest score decreases:`);
  for (const d of deltas.slice(0, 10)) {
    console.log(`  ${d.old} → ${d.new} (${d.delta >= 0 ? '+' : ''}${d.delta})  "${d.query}"`);
  }

  // Distribution of deltas
  const buckets: Record<string, number> = { '<-5': 0, '-5to-3': 0, '-2to0': 0, '+1to+3': 0, '>+3': 0 };
  for (const d of deltas) {
    if (d.delta < -5) buckets['<-5']++;
    else if (d.delta < -2) buckets['-5to-3']++;
    else if (d.delta <= 0) buckets['-2to0']++;
    else if (d.delta <= 3) buckets['+1to+3']++;
    else buckets['>+3']++;
  }
  console.log(`\nDelta distribution:`);
  for (const [k, v] of Object.entries(buckets)) {
    const bar = '#'.repeat(v);
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
