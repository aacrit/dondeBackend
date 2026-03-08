/**
 * ATLAS Agent — "The Map Maker"
 *
 * Continuously executes search atlas queries from the gauntlet.
 * Tests cuisine, dish, vibe, chicago-specific, occasion, and reputation queries.
 *
 * API Budget: 20 calls/day
 * Cycle: Every 30 seconds
 *
 * Reuses:
 *   - gauntlet-runner.ts (query execution engine)
 *   - gap-analyzer.ts (failure classification)
 *   - generate-search-atlas.ts (query generation)
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BACKEND_ROOT = join(__dirname, '..', '..', '..');
const ATLAS_PATH = join(BACKEND_ROOT, 'tests', 'search-atlas-v1.jsonl');
const RESULTS_DIR = join(BACKEND_ROOT, 'tests', 'gauntlet-results');

export interface AtlasResult {
  query: string;
  category: string;
  tier: number;
  donde_match: number;
  restaurant_name: string | null;
  relevance_type: string | null;
  pass: boolean;
  gap_type: string | null;
  timestamp: string;
  response_ms: number;
}

// Score thresholds
const PASS_THRESHOLD = 60;
const EXCELLENT_THRESHOLD = 80;
const CRITICAL_THRESHOLD = 40;

// Fallback queries if atlas file not found
const FALLBACK_QUERIES = [
  { query: 'Italian beef sandwich', category: 'dish', tier: 1 },
  { query: 'deep dish pizza', category: 'dish', tier: 1 },
  { query: 'best sushi Chicago', category: 'cuisine', tier: 1 },
  { query: 'authentic Mexican food', category: 'cuisine', tier: 1 },
  { query: 'Ethiopian restaurant', category: 'cuisine', tier: 1 },
  { query: 'date night West Loop', category: 'vibe', tier: 1 },
  { query: 'cheap eats Wicker Park', category: 'vibe', tier: 1 },
  { query: 'brunch Lincoln Park', category: 'occasion', tier: 1 },
  { query: 'late night food', category: 'occasion', tier: 1 },
  { query: 'dinner before Cubs game', category: 'chicago_specific', tier: 1 },
  { query: 'Devon Avenue food', category: 'chicago_specific', tier: 1 },
  { query: 'Chinatown dim sum', category: 'chicago_specific', tier: 1 },
  { query: 'like Portillos', category: 'reputation', tier: 1 },
  { query: 'Michelin star restaurant', category: 'reputation', tier: 1 },
  { query: 'vegan restaurant', category: 'cuisine', tier: 1 },
  { query: 'steakhouse downtown', category: 'cuisine', tier: 1 },
  { query: 'craft cocktails', category: 'vibe', tier: 1 },
  { query: 'farm to table', category: 'vibe', tier: 1 },
  { query: 'hole in the wall', category: 'vibe', tier: 1 },
  { query: 'ramen near me', category: 'dish', tier: 1 },
  { query: 'upscale Italian', category: 'cuisine', tier: 1 },
  { query: 'BBQ ribs', category: 'dish', tier: 1 },
  { query: 'seafood restaurant', category: 'cuisine', tier: 1 },
  { query: 'Mediterranean food', category: 'cuisine', tier: 1 },
  { query: 'food near Navy Pier', category: 'chicago_specific', tier: 1 },
  { query: 'birthday dinner', category: 'occasion', tier: 1 },
  { query: 'solo dining bar', category: 'occasion', tier: 1 },
  { query: 'tavern-style pizza', category: 'dish', tier: 1 },
  { query: 'Chicago hot dog', category: 'dish', tier: 1 },
  { query: 'Pilsen Mexican food', category: 'chicago_specific', tier: 1 },
];

/**
 * Load queries from the search atlas JSONL file or use fallback
 */
export function loadQueries(): Array<{ query: string; category: string; tier: number }> {
  if (existsSync(ATLAS_PATH)) {
    try {
      const lines = readFileSync(ATLAS_PATH, 'utf-8').trim().split('\n');
      return lines.map(line => {
        const obj = JSON.parse(line);
        return {
          query: obj.query || obj.special_request || '',
          category: obj.category || 'unknown',
          tier: obj.tier || 1,
        };
      }).filter(q => q.query.length > 0);
    } catch (err) {
      console.warn('[ATLAS] Failed to parse atlas file, using fallback queries');
    }
  }
  return FALLBACK_QUERIES;
}

/**
 * Pick a random batch of queries
 */
export function sampleQueries(queries: Array<{ query: string; category: string; tier: number }>, batchSize: number): Array<{ query: string; category: string; tier: number }> {
  const shuffled = [...queries].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, batchSize);
}

/**
 * Classify a gap based on score and response data
 */
export function classifyGap(dm: number, response: Record<string, unknown>): string | null {
  if (dm >= PASS_THRESHOLD) return null;
  if (dm === 0) return 'api_error';
  if (dm < CRITICAL_THRESHOLD) {
    const relType = (response as { scoring_v9?: { relevance_type?: string } })?.scoring_v9?.relevance_type;
    if (relType === 'open_ended' || relType === 'unknown') return 'intent';
    return 'scoring';
  }
  return 'scoring';
}

/**
 * Log a result to the results JSONL file
 */
export function logResult(result: AtlasResult) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const file = join(RESULTS_DIR, `atlas-${today}.jsonl`);
  appendFileSync(file, JSON.stringify(result) + '\n');
}

/**
 * Compute aggregate stats from results
 */
export function computeStats(results: AtlasResult[]): {
  total: number;
  passed: number;
  passRate: number;
  avgDm: number;
  excellent: number;
  critical: number;
  gaps: number;
  categoryStats: Record<string, { total: number; avgDm: number; passRate: number }>;
} {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  const excellent = results.filter(r => r.donde_match >= EXCELLENT_THRESHOLD).length;
  const critical = results.filter(r => r.donde_match < CRITICAL_THRESHOLD).length;
  const gaps = results.filter(r => r.gap_type !== null).length;
  const avgDm = total > 0 ? Math.round(results.reduce((s, r) => s + r.donde_match, 0) / total) : 0;

  // Per-category stats
  const cats: Record<string, AtlasResult[]> = {};
  results.forEach(r => {
    if (!cats[r.category]) cats[r.category] = [];
    cats[r.category].push(r);
  });

  const categoryStats: Record<string, { total: number; avgDm: number; passRate: number }> = {};
  for (const [cat, catResults] of Object.entries(cats)) {
    const catTotal = catResults.length;
    const catPassed = catResults.filter(r => r.pass).length;
    categoryStats[cat] = {
      total: catTotal,
      avgDm: Math.round(catResults.reduce((s, r) => s + r.donde_match, 0) / catTotal),
      passRate: Math.round((catPassed / catTotal) * 100),
    };
  }

  return { total, passed, passRate: Math.round((passed / total) * 100), avgDm, excellent, critical, gaps, categoryStats };
}
