/**
 * Generates vector embeddings for all restaurants using a local sentence-transformer model.
 * Requires either Ollama with all-minilm model or a compatible OpenAI-style embeddings API.
 *
 * Pipeline: Embedding Generation for pgvector Semantic Retrieval
 *
 * Fetches restaurant data from restaurants, restaurant_deep_profiles, and
 * restaurant_review_intelligence tables, concatenates into a single text document
 * per restaurant, computes MD5 hash (skips unchanged), calls embedding API,
 * and upserts to restaurant_embeddings table.
 *
 * Env vars:
 *   EMBEDDING_API_URL  — Embedding endpoint (default: http://localhost:11434/api/embeddings for Ollama)
 *   EMBEDDING_MODEL    — Model name (default: all-minilm)
 *   SUPAB_URL          — Supabase project URL
 *   SUPAB_SERVICE_ROLE_KEY — Supabase service role key
 *   DRY_RUN            — "true" to preview without writing
 *
 * CLI flags:
 *   --model-api <url>  — Override EMBEDDING_API_URL
 *   --model <name>     — Override EMBEDDING_MODEL
 *   --batch-size <n>   — Batch size for DB operations (default: 50)
 *   --dry-run          — Preview mode, no writes
 *   --force            — Re-embed even if text hash unchanged
 *
 * Usage:
 *   npx tsx pipelines/generate-embeddings.ts
 *   npx tsx pipelines/generate-embeddings.ts --dry-run
 *   npx tsx pipelines/generate-embeddings.ts --model-api http://localhost:11434/api/embeddings --model all-minilm
 *   EMBEDDING_API_URL=http://localhost:1234/v1/embeddings npx tsx pipelines/generate-embeddings.ts
 *
 * Schedule: On-demand / after enrichment refresh
 */

import { createAdminClient } from '../lib/supabase.js';
import { createHash } from 'crypto';
import { processBatches } from '../lib/batch.js';

// --- CLI arg parsing ---

const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const DRY_RUN = process.env.DRY_RUN === 'true' || args.includes('--dry-run');
const FORCE = args.includes('--force');
const BATCH_SIZE = parseInt(getArg('batch-size', '50'), 10);
const EMBEDDING_API_URL =
  getArg('model-api', '') ||
  process.env.EMBEDDING_API_URL ||
  'http://localhost:11434/api/embeddings';
const EMBEDDING_MODEL =
  getArg('model', '') ||
  process.env.EMBEDDING_MODEL ||
  'all-minilm';

// --- Types ---

interface RestaurantRow {
  id: string;
  name: string;
  cuisine_type: string | null;
  best_for_oneliner: string | null;
  neighborhood_name: string | null;
}

interface DeepProfileRow {
  restaurant_id: string;
  origin_story: string | null;
  unique_selling_point: string | null;
  signature_dishes: unknown;
  wow_factors: string[] | null;
  crowd_profile: string[] | null;
  best_seat_in_house: string | null;
  insider_knowledge: string | null;
  seasonal_relevance: string | null;
}

interface ReviewIntelligenceRow {
  restaurant_id: string;
  semantic_descriptors: string[] | null;
  best_for_scenarios: string[] | null;
  cuisine_signals: unknown;
  popular_dishes: unknown;
  dish_catalog: unknown;
}

interface EmbeddingRecord {
  restaurant_id: string;
  text_hash: string | null;
}

// --- Helpers ---

function stringify(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.join(', ');
  return JSON.stringify(val);
}

function buildTextDocument(
  r: RestaurantRow,
  dp: DeepProfileRow | undefined,
  ri: ReviewIntelligenceRow | undefined
): string {
  const parts: string[] = [];

  // Restaurant basics
  parts.push(`Restaurant: ${r.name}`);
  if (r.cuisine_type) parts.push(`Cuisine: ${r.cuisine_type}`);
  if (r.neighborhood_name) parts.push(`Neighborhood: ${r.neighborhood_name}`);
  if (r.best_for_oneliner) parts.push(`Best for: ${r.best_for_oneliner}`);

  // Deep profile
  if (dp) {
    if (dp.origin_story) parts.push(`Origin: ${dp.origin_story}`);
    if (dp.unique_selling_point) parts.push(`Unique: ${dp.unique_selling_point}`);
    const sigDishes = stringify(dp.signature_dishes);
    if (sigDishes) parts.push(`Signature dishes: ${sigDishes}`);
    if (dp.wow_factors?.length) parts.push(`Wow factors: ${dp.wow_factors.join(', ')}`);
    if (dp.crowd_profile?.length) parts.push(`Crowd: ${dp.crowd_profile.join(', ')}`);
    if (dp.best_seat_in_house) parts.push(`Best seat: ${dp.best_seat_in_house}`);
    if (dp.insider_knowledge) parts.push(`Insider tip: ${dp.insider_knowledge}`);
    if (dp.seasonal_relevance) parts.push(`Seasonal: ${dp.seasonal_relevance}`);
  }

  // Review intelligence
  if (ri) {
    if (ri.semantic_descriptors?.length) parts.push(`Descriptors: ${ri.semantic_descriptors.join(', ')}`);
    if (ri.best_for_scenarios?.length) parts.push(`Scenarios: ${ri.best_for_scenarios.join(', ')}`);
    const cuisineSignals = stringify(ri.cuisine_signals);
    if (cuisineSignals) parts.push(`Cuisine signals: ${cuisineSignals}`);
    const popularDishes = stringify(ri.popular_dishes);
    if (popularDishes) parts.push(`Popular dishes: ${popularDishes}`);
    const dishCatalog = stringify(ri.dish_catalog);
    if (dishCatalog) parts.push(`Dish catalog: ${dishCatalog}`);
  }

  return parts.join('\n');
}

function computeHash(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

async function fetchEmbedding(text: string): Promise<number[]> {
  // Support both Ollama-style and OpenAI-style APIs
  const isOllama = EMBEDDING_API_URL.includes('/api/embeddings');

  const body = isOllama
    ? { model: EMBEDDING_MODEL, prompt: text }
    : { model: EMBEDDING_MODEL, input: text };

  const response = await fetch(EMBEDDING_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Embedding API error ${response.status}: ${errText}`);
  }

  const data = await response.json();

  // Ollama returns { embedding: number[] }
  // OpenAI returns { data: [{ embedding: number[] }] }
  if (data.embedding) return data.embedding;
  if (data.data?.[0]?.embedding) return data.data[0].embedding;

  throw new Error(`Unexpected embedding API response format: ${JSON.stringify(data).slice(0, 200)}`);
}

function formatVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

// --- Main ---

async function main() {
  console.log('=== Embedding Generation Pipeline ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`API: ${EMBEDDING_API_URL}`);
  console.log(`Model: ${EMBEDDING_MODEL}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Force re-embed: ${FORCE}`);
  console.log('');

  const supabase = createAdminClient();

  // --- Fetch all restaurant data ---

  console.log('Fetching restaurants...');
  const { data: restaurants, error: rErr } = await supabase
    .from('restaurants')
    .select('id, name, cuisine_type, best_for_oneliner, neighborhood_name')
    .or('is_active.is.null,is_active.eq.true');
  if (rErr) throw new Error(`Failed to fetch restaurants: ${rErr.message}`);
  if (!restaurants?.length) {
    console.log('No active restaurants found.');
    return;
  }
  console.log(`  ${restaurants.length} active restaurants`);

  console.log('Fetching deep profiles...');
  const { data: deepProfiles, error: dpErr } = await supabase
    .from('restaurant_deep_profiles')
    .select('restaurant_id, origin_story, unique_selling_point, signature_dishes, wow_factors, crowd_profile, best_seat_in_house, insider_knowledge, seasonal_relevance');
  if (dpErr) throw new Error(`Failed to fetch deep profiles: ${dpErr.message}`);
  console.log(`  ${deepProfiles?.length || 0} deep profiles`);

  console.log('Fetching review intelligence...');
  const { data: reviewIntel, error: riErr } = await supabase
    .from('restaurant_review_intelligence')
    .select('restaurant_id, semantic_descriptors, best_for_scenarios, cuisine_signals, popular_dishes, dish_catalog');
  if (riErr) throw new Error(`Failed to fetch review intelligence: ${riErr.message}`);
  console.log(`  ${reviewIntel?.length || 0} review intelligence records`);

  // Build lookup maps
  const dpMap = new Map<string, DeepProfileRow>();
  for (const dp of (deepProfiles || [])) {
    dpMap.set(dp.restaurant_id, dp as DeepProfileRow);
  }
  const riMap = new Map<string, ReviewIntelligenceRow>();
  for (const ri of (reviewIntel || [])) {
    riMap.set(ri.restaurant_id, ri as ReviewIntelligenceRow);
  }

  // Fetch existing embeddings for staleness check
  console.log('Fetching existing embeddings for staleness check...');
  const { data: existingEmbeddings, error: eeErr } = await supabase
    .from('restaurant_embeddings')
    .select('restaurant_id, text_hash');
  if (eeErr) {
    console.warn(`  Warning: Could not fetch existing embeddings (table may not exist yet): ${eeErr.message}`);
  }
  const existingMap = new Map<string, string | null>();
  for (const e of (existingEmbeddings || [])) {
    existingMap.set(e.restaurant_id, e.text_hash);
  }
  console.log(`  ${existingMap.size} existing embeddings`);

  // --- Build text documents and check staleness ---

  interface EmbeddingTask {
    restaurantId: string;
    restaurantName: string;
    text: string;
    textHash: string;
  }

  const tasks: EmbeddingTask[] = [];
  let skippedUnchanged = 0;

  for (const r of restaurants) {
    const dp = dpMap.get(r.id);
    const ri = riMap.get(r.id);
    const text = buildTextDocument(r as RestaurantRow, dp, ri);
    const textHash = computeHash(text);

    // Skip if hash is unchanged (unless --force)
    if (!FORCE && existingMap.has(r.id) && existingMap.get(r.id) === textHash) {
      skippedUnchanged++;
      continue;
    }

    tasks.push({
      restaurantId: r.id,
      restaurantName: r.name,
      text,
      textHash,
    });
  }

  console.log('');
  console.log(`Embedding tasks: ${tasks.length}`);
  console.log(`Skipped (unchanged): ${skippedUnchanged}`);
  console.log(`Total restaurants: ${restaurants.length}`);
  console.log('');

  if (tasks.length === 0) {
    console.log('All embeddings are up to date. Nothing to do.');
    return;
  }

  if (DRY_RUN) {
    console.log('DRY RUN — would embed these restaurants:');
    for (const task of tasks.slice(0, 20)) {
      console.log(`  - ${task.restaurantName} (${task.restaurantId})`);
      console.log(`    Text length: ${task.text.length} chars, hash: ${task.textHash}`);
    }
    if (tasks.length > 20) {
      console.log(`  ... and ${tasks.length - 20} more`);
    }
    return;
  }

  // --- Generate embeddings and upsert ---

  let embedded = 0;
  let errors = 0;

  await processBatches(tasks, BATCH_SIZE, async (batch) => {
    const upsertRows: Array<{
      restaurant_id: string;
      embedding: string;
      text_hash: string;
      model_version: string;
      updated_at: string;
    }> = [];

    for (const task of batch) {
      try {
        const embedding = await fetchEmbedding(task.text);

        if (embedding.length !== 384) {
          console.warn(`  WARNING: ${task.restaurantName} — expected 384 dims, got ${embedding.length}. Skipping.`);
          errors++;
          continue;
        }

        upsertRows.push({
          restaurant_id: task.restaurantId,
          embedding: formatVector(embedding),
          text_hash: task.textHash,
          model_version: EMBEDDING_MODEL,
          updated_at: new Date().toISOString(),
        });

        embedded++;
        if (embedded % 100 === 0 || embedded === tasks.length) {
          console.log(`  Progress: ${embedded}/${tasks.length} restaurants embedded`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ERROR embedding ${task.restaurantName}: ${msg}`);
        errors++;
      }
    }

    // Batch upsert to Supabase
    if (upsertRows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('restaurant_embeddings')
        .upsert(upsertRows, { onConflict: 'restaurant_id' });

      if (upsertErr) {
        console.error(`  DB upsert error: ${upsertErr.message}`);
        errors += upsertRows.length;
        embedded -= upsertRows.length;
      }
    }
  }, 500); // 500ms delay between batches

  // --- Summary ---

  console.log('');
  console.log('=== Embedding Generation Complete ===');
  console.log(`  Embedded: ${embedded}`);
  console.log(`  Skipped (unchanged): ${skippedUnchanged}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total restaurants: ${restaurants.length}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
