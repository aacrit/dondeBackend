/**
 * Blurb Upgrader — Upgrades deterministic cache blurbs to Claude-tailored blurbs.
 *
 * Reads cache entries from query_cache, constructs prompts matching the live API's
 * prompt builder (voice system, query context, restaurant data), and generates
 * tailored blurbs using Claude Max CLI ($0 marginal cost).
 *
 * Uses `claude -p` (Claude Code CLI) instead of the Anthropic API to avoid costs.
 * Processes in batches of 5 for efficiency (~30-45 min for 700+ entries).
 *
 * Usage:
 *   npx tsx pipelines/blurb-upgrader.ts [--limit 50] [--dry-run] [--batch-size 5]
 */

import { createAdminClient } from '../lib/supabase.js';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const LIMIT = parseInt(getArg('limit', '999'), 10);
const BATCH_SIZE = parseInt(getArg('batch-size', '3'), 10);
const DRY_RUN = args.includes('--dry-run');
const ONLY_DETERMINISTIC = !args.includes('--all'); // By default, only upgrade deterministic blurbs

// ─── Voice System (simplified from prompts-v5.ts) ───────────────────────────

interface VoiceKeywords { primary: string[]; secondary: string[] }

const VOICE_CUISINE_MAP: Record<string, VoiceKeywords> = {
  wanderer:    { primary: ['street food', 'hole in wall', 'food truck', 'counter service', 'dive'], secondary: ['halal', 'shawarma', 'falafel', 'banh mi', 'jerk', 'gyro'] },
  sensualist:  { primary: ['fine dining', 'prix fixe', 'tasting menu', 'omakase', 'michelin'], secondary: ['french', 'wine bar', 'champagne', 'truffle', 'romantic'] },
  neighbor:    { primary: ['neighborhood', 'local gem', 'hidden', 'corner spot', 'community'], secondary: ['pilsen', 'bridgeport', 'logan square', 'humboldt park', 'albany park'] },
  philosopher: { primary: ['comfort food', 'soul food', 'homestyle', 'diner'], secondary: ['southern', 'breakfast', 'pancake', 'family dinner'] },
  craftsman:   { primary: ['handmade', 'house-made', 'fermented', 'smoked', 'wood fired'], secondary: ['chef notable', 'awards', 'seasonal', 'farm to table', 'pasta', 'ramen'] },
  nightowl:    { primary: ['late night', 'dive bar', 'sports bar', 'karaoke', 'cheap eats'], secondary: ['wings', 'bar food', 'pub', 'tavern'] },
  host:        { primary: ['indian', 'ethiopian', 'curry', 'tandoori', 'biryani', 'shared plates'], secondary: ['middle eastern', 'kebab', 'nepalese', 'pakistani', 'afghan', 'group', 'family style'] },
  minimalist:  { primary: ['japanese', 'sushi', 'omakase', 'izakaya'], secondary: ['ramen', 'dim sum', 'dumpling', 'chinese', 'thai', 'vietnamese', 'korean', 'taiwanese'] },
  celebrant:   { primary: ['mexican', 'taco', 'mole', 'mezcal', 'al pastor'], secondary: ['caribbean', 'jamaican', 'cuban', 'peruvian', 'brazilian', 'nigerian', 'soul food'] },
  scout:       { primary: ['american', 'burger', 'bbq', 'smash burger', 'hot dog', 'fried chicken'], secondary: ['steakhouse', 'wings', 'ribs', 'brisket', 'deep dish'] },
  connoisseur: { primary: ['seafood', 'lobster', 'oyster', 'wine bar', 'cocktail bar', 'speakeasy'], secondary: ['french', 'bistro', 'champagne', 'martini', 'raw bar'] },
  local:       { primary: ['chicago', 'institution', 'iconic', 'classic', 'old school'], secondary: ['brunch', 'breakfast', 'bakery', 'deli', 'hot dog', 'deep dish'] },
};

const VOICE_VIBE_MAP: Record<string, string[]> = {
  wanderer:    ['adventurous', 'explore', 'hole in wall', 'authentic', 'no frills'],
  sensualist:  ['romantic', 'intimate', 'candlelit', 'elegant', 'upscale', 'fine'],
  neighbor:    ['neighborhood', 'local', 'hidden', 'gem', 'community'],
  philosopher: ['comfort', 'cozy', 'warm', 'homey', 'soul', 'nostalgic'],
  craftsman:   ['technique', 'handmade', 'artisan', 'craft', 'smoked'],
  nightowl:    ['late', 'night', 'dive', 'cheap', 'beer', 'sports', 'karaoke'],
  host:        ['shared', 'communal', 'generous', 'family', 'group', 'feast'],
  minimalist:  ['quiet', 'zen', 'minimal', 'clean', 'precise', 'calm'],
  celebrant:   ['festive', 'colorful', 'lively', 'music', 'celebration'],
  scout:       ['best', 'top', 'ranked', 'rated', 'famous', 'popular', 'classic'],
  connoisseur: ['cocktail', 'wine', 'martini', 'speakeasy', 'bar', 'lounge', 'tasting'],
  local:       ['chicago', 'institution', 'iconic', 'classic', 'tradition', 'old school'],
};

function detectVoice(cuisine: string, query: string): string {
  const textLower = (cuisine || '').toLowerCase();
  const queryLower = (query || '').toLowerCase();
  const scores: Record<string, number> = {};

  for (const [voice, kw] of Object.entries(VOICE_CUISINE_MAP)) {
    let cuisineScore = 0;
    for (const k of kw.primary) { if (textLower.includes(k) || queryLower.includes(k)) { cuisineScore = 10; break; } }
    if (cuisineScore === 0) { for (const k of kw.secondary) { if (textLower.includes(k) || queryLower.includes(k)) { cuisineScore = 5; break; } } }

    let vibeScore = 0;
    for (const k of VOICE_VIBE_MAP[voice]) { if (queryLower.includes(k)) { vibeScore = 10; break; } }

    scores[voice] = cuisineScore * 0.6 + vibeScore * 0.4;
  }

  let best = 'scout';
  let bestScore = -1;
  for (const [voice, score] of Object.entries(scores)) {
    if (score > bestScore) { bestScore = score; best = voice; }
  }
  return best;
}

const VOICE_DESCRIPTIONS: Record<string, string> = {
  wanderer:    'Bourdain energy — run-on sentences, sensory overload, no-BS street authority. Admit being wrong. Beauty in the unexpected.',
  sensualist:  'Ruth Reichl — lush sensory prose, light on the plate, weight of the glass. Unhurried pacing. Indulgence without guilt.',
  neighbor:    'Jonathan Gold — neighborhood storytelling, community context. Ground geographically. The restaurant exists in a place.',
  philosopher: 'MFK Fisher — meditative warmth, food as care. Slow pacing. Nostalgia earned by specificity.',
  craftsman:   'Bill Buford — technique obsession, process fascination. Reference how things are made. Curiosity runs the prose.',
  nightowl:    'Bukowski — blunt economy. Paper plates, cold beer. Short sentences. Fewer adjectives. Affectionate understatement.',
  host:        'Madhur Jaffrey — generous warmth. The food arrives before you order. Spices are biography. Reference aromatics by name.',
  minimalist:  'Murakami — quiet precision. Counts, temperatures, silence. Clean short sentences. Emotion from restraint.',
  celebrant:   'Marquez — sensory abundance, mythic warmth. Colors, heat, stacking clauses. Nobody checked the time.',
  scout:       'Calvin Trillin — deadpan quest. Numbers matter. Dry humor earned through comparison. The verdict is final.',
  connoisseur: 'AJ Liebling — educated palate without snobbery. Name the grape, not the adjective. Bar seat authority.',
  local:       'Studs Terkel — Chicago voice, working-class poetry. Reference the neighborhood. Democratic warmth.',
};

// ─── Prompt Builder ──────────────────────────────────────────────────────────

interface CacheEntry {
  id: string;
  cache_key: string;
  special_request: string;
  occasion: string;
  neighborhood: string;
  price_level: string;
  response_body: Record<string, unknown>;
  donde_match: number | null;
}

function buildBlurbPrompt(entry: CacheEntry): string {
  const rb = entry.response_body;
  const restaurant = rb.restaurant as Record<string, unknown> || {};
  const scoring = rb.scoring_v9 as Record<string, unknown> || {};
  const deepCtx = rb.deep_context as Record<string, unknown> || {};
  const narrative = rb.match_narrative as Record<string, unknown> || {};

  const name = restaurant.name as string || 'Unknown';
  const cuisine = restaurant.cuisine_type as string || '';
  const hood = restaurant.neighborhood_name as string || '';
  const price = restaurant.price_level as string || '';
  const noise = restaurant.noise_level as string || '';
  const lighting = restaurant.lighting_ambiance as string || '';
  const dress = restaurant.dress_code as string || '';
  const outdoor = restaurant.outdoor_seating ? 'Yes' : 'No';

  const sigDishes = (deepCtx.signature_dishes as Array<Record<string, string>> || [])
    .slice(0, 3).map(d => `${d.dish}${d.why ? ` (${d.why})` : ''}`).join('; ');
  const flavors = (deepCtx.flavor_profiles as string[] || []).slice(0, 4).join(', ');
  const serviceStyle = deepCtx.service_style as string || '';
  const reserveDiff = deepCtx.reservation_difficulty as string || '';
  const usp = deepCtx.unique_selling_point as string || '';
  const bestSeat = deepCtx.best_seat_in_house as string || '';
  const awards = (deepCtx.awards_recognition as string[] || []).slice(0, 2).join('; ');
  const crowd = (deepCtx.crowd_profile as string[] || []).slice(0, 3).join(', ');
  const wowFactors = (deepCtx.wow_factors as string[] || []).slice(0, 3).join(', ');
  const menuHL = (deepCtx.menu_highlights as string[] || []).slice(0, 4).join(', ');

  const dm = entry.donde_match || rb.donde_match as number || 0;
  const relType = scoring.relevance_type as string || '';
  const food = scoring.food as number || 0;
  const vibe = scoring.vibe as number || 0;

  const keySignals = (narrative.key_signals as string[] || []).slice(0, 3).join('; ');
  const weakSpots = (narrative.weak_spots as string[] || []).slice(0, 2).join('; ');

  const voice = detectVoice(cuisine, entry.special_request);
  const voiceDesc = VOICE_DESCRIPTIONS[voice] || VOICE_DESCRIPTIONS.scout;

  // Score tier
  let tone = 'confident';
  if (dm >= 80) tone = 'declarative authority — don\'t hedge, you\'re confident about this pick';
  else if (dm >= 70) tone = 'confident with texture — name one real trade-off without apologizing';
  else if (dm >= 60) tone = 'measured honesty — be specific about what works and what doesn\'t';
  else tone = 'frank, not apologetic — lead with one genuine positive';

  return `QUERY: "${entry.special_request}"
OCCASION: ${entry.occasion || 'Any'}
NEIGHBORHOOD FILTER: ${entry.neighborhood || 'Anywhere'}

RESTAURANT: ${name}
CUISINE: ${cuisine}
NEIGHBORHOOD: ${hood}
PRICE: ${price}
DONDE MATCH: ${dm}/100
RELEVANCE: ${relType} | Food: ${food}/10 | Vibe: ${vibe}/10
${sigDishes ? `SIGNATURE DISHES: ${sigDishes}` : ''}
${menuHL ? `MENU HIGHLIGHTS: ${menuHL}` : ''}
${flavors ? `FLAVOR PROFILES: ${flavors}` : ''}
${serviceStyle ? `SERVICE: ${serviceStyle}` : ''}
${reserveDiff ? `RESERVATION: ${reserveDiff}` : ''}
${noise ? `NOISE: ${noise}` : ''}${lighting ? ` | LIGHTING: ${lighting}` : ''}${dress ? ` | DRESS: ${dress}` : ''}
${outdoor !== 'No' ? `OUTDOOR SEATING: Yes` : ''}
${usp ? `USP: ${usp}` : ''}
${bestSeat ? `BEST SEAT: ${bestSeat}` : ''}
${awards ? `AWARDS: ${awards}` : ''}
${wowFactors ? `WOW FACTORS: ${wowFactors}` : ''}
${crowd ? `CROWD: ${crowd}` : ''}
${keySignals ? `KEY SIGNALS: ${keySignals}` : ''}
${weakSpots ? `HONEST CAVEAT MATERIAL: ${weakSpots}` : ''}

VOICE: ${voice} — ${voiceDesc}
TONE: ${tone}`.replace(/\n{3,}/g, '\n\n').trim();
}

function buildBatchPrompt(entries: CacheEntry[]): string {
  const restaurantBlocks = entries.map((e, i) => {
    return `=== BLURB #${i + 1} ===\n${buildBlurbPrompt(e)}`;
  }).join('\n\n');

  return `You are Donde — a sharp, literate Chicago food and bar critic. You speak as "we/our" (a collective of opinionated friends). You're warm, knowing, subtly sarcastic, and impossible to bullshit about food.

RULES:
- 100-115 words per blurb, single paragraph
- Use "we/our" naturally 1-3 times
- Include the restaurant name somewhere (not first word)
- Tailor each blurb to the SPECIFIC user query — reference their search terms
- One honest caveat per blurb
- Close with a punchy sentence (<=8 words)
- Include at least one sensory texture word (charred, crispy, smoky, tangy, spicy, creamy, buttery, tender, bright, bold)
- BANNED: "culinary", "mouthwatering", "nestled", "hidden gem", "elevated", "must-visit", "dining experience", "every bite", em dashes, "whether you're", "if you're looking for"
- Match the VOICE and TONE specified for each blurb

Generate ${entries.length} tailored recommendation blurbs. Output ONLY a JSON array of strings, no explanation:
["blurb 1 text here", "blurb 2 text here", ...]

${restaurantBlocks}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Blurb Upgrader — batch: ${BATCH_SIZE}, limit: ${LIMIT}${DRY_RUN ? ', DRY RUN' : ''}`);

  const sb = createAdminClient();

  // Fetch cache entries that need upgrading
  const { data: entries, error } = await sb
    .from('query_cache')
    .select('id, cache_key, special_request, occasion, neighborhood, price_level, response_body, donde_match')
    .gt('expires_at', new Date().toISOString())
    .order('hit_count', { ascending: false }) // Prioritize most-hit entries
    .limit(LIMIT);

  if (error || !entries) {
    console.error('Failed to fetch cache entries:', error?.message);
    process.exit(1);
  }

  console.log(`  Found ${entries.length} cache entries to upgrade`);

  // Process in batches
  let upgraded = 0;
  let failed = 0;
  let skipped = 0;
  const startTime = Date.now();

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = (entries as CacheEntry[]).slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(entries.length / BATCH_SIZE);

    console.log(`  [Batch ${batchNum}/${totalBatches}] Processing ${batch.length} entries...`);

    if (DRY_RUN) {
      // Just show the prompt for the first batch
      if (batchNum === 1) {
        console.log('\n--- DRY RUN PROMPT ---');
        console.log(buildBatchPrompt(batch).slice(0, 2000) + '...\n');
      }
      skipped += batch.length;
      continue;
    }

    try {
      const prompt = buildBatchPrompt(batch);

      // Write prompt to temp file and pipe to Claude Max CLI
      const tmpFile = join(tmpdir(), `donde-blurb-${Date.now()}.txt`);
      // Sanitize prompt: remove null bytes and control chars that break shell
      const sanitized = prompt.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');
      writeFileSync(tmpFile, sanitized, 'utf-8');
      console.log(`    Prompt written to ${tmpFile} (${sanitized.length} chars)`);

      let result: string;
      try {
        // Strip ANTHROPIC_API_KEY so claude CLI uses Max subscription instead of API auth
        const cleanEnv = { ...process.env, LANG: 'en_US.UTF-8' };
        delete cleanEnv.ANTHROPIC_API_KEY;

        result = execSync(
          `cat "${tmpFile}" | claude -p --output-format text --model sonnet`,
          {
            timeout: 300000, // 5 min per batch (claude -p can be slow)
            maxBuffer: 2 * 1024 * 1024,
            encoding: 'utf-8',
            env: cleanEnv,
            shell: '/bin/bash',
          }
        ).trim();
      } finally {
        try { unlinkSync(tmpFile); } catch {}
      }

      // Parse JSON array from Claude's output
      let blurbs: string[];
      try {
        // Try to extract JSON array from the response
        const jsonMatch = result.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('No JSON array found in response');
        blurbs = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        console.warn(`    Parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
        // Fallback: try splitting by separator patterns
        blurbs = result.split(/\n---?\n/).map(b => b.trim()).filter(b => b.length > 50);
        if (blurbs.length !== batch.length) {
          console.warn(`    Expected ${batch.length} blurbs, got ${blurbs.length}. Skipping batch.`);
          failed += batch.length;
          continue;
        }
      }

      if (blurbs.length !== batch.length) {
        console.warn(`    Blurb count mismatch: expected ${batch.length}, got ${blurbs.length}. Skipping batch.`);
        failed += batch.length;
        continue;
      }

      // Update each cache entry
      for (let j = 0; j < batch.length; j++) {
        const entry = batch[j];
        const blurb = blurbs[j];

        // Validate blurb quality
        const wordCount = blurb.split(/\s+/).length;
        if (wordCount < 60 || wordCount > 150) {
          console.warn(`    Skip "${entry.special_request.slice(0, 30)}": word count ${wordCount}`);
          skipped++;
          continue;
        }

        // Check for banned patterns
        const lower = blurb.toLowerCase();
        const hasBanned = ['culinary', 'mouthwatering', 'nestled', 'hidden gem', 'elevated', 'must-visit', 'dining experience'].some(p => lower.includes(p));
        if (hasBanned) {
          console.warn(`    Skip "${entry.special_request.slice(0, 30)}": contains banned pattern`);
          skipped++;
          continue;
        }

        // Update response_body.recommendation
        const updatedBody = { ...entry.response_body, recommendation: blurb };

        // Also update ranked_queue[0].recommendation if it exists
        const queue = updatedBody.ranked_queue as Array<Record<string, unknown>> | undefined;
        if (queue && queue.length > 0) {
          queue[0] = { ...queue[0], recommendation: blurb };
        }

        const { error: updateErr } = await sb
          .from('query_cache')
          .update({ response_body: updatedBody })
          .eq('id', entry.id);

        if (updateErr) {
          console.warn(`    Update failed for "${entry.special_request.slice(0, 30)}": ${updateErr.message}`);
          failed++;
        } else {
          upgraded++;
          console.log(`    OK "${entry.special_request.slice(0, 40)}" (${wordCount}w)`);
        }
      }
    } catch (err) {
      const errObj = err as { stderr?: string; message?: string };
      const msg = errObj.stderr || errObj.message || String(err);
      console.error(`    Batch ${batchNum} failed: ${msg.slice(0, 500)}`);
      failed += batch.length;
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Blurb Upgrade Complete — ${duration}s`);
  console.log(`  Upgraded: ${upgraded}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  Total:    ${entries.length}`);
  console.log(`  Cost:     $0.00 (Claude Max CLI)`);
  console.log(`${'='.repeat(60)}`);
}

main().catch(e => {
  console.error('Blurb upgrader crashed:', e);
  process.exit(1);
});
