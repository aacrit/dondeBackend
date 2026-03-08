/**
 * SENTINEL Agent — "The Watchman"
 *
 * Watches for score regressions against golden dataset baselines.
 * Tests Try Another monotonicity and maintains rolling score history.
 *
 * API Budget: 15 calls/day
 * Cycle: Every 60 seconds
 *
 * Reuses:
 *   - golden-dataset-test.sh (golden query definitions)
 *   - regression-guard.sh (baseline comparison logic)
 *   - compare-scores.sh (A/B delta computation)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BACKEND_ROOT = join(__dirname, '..', '..', '..');
const BASELINE_FILE = join(BACKEND_ROOT, 'tests', 'gauntlet-results', 'sentinel-baseline.json');

// ═══════════════════════════════════════════════════════════════════
// Golden Dataset — 50 queries
// ═══════════════════════════════════════════════════════════════════

export interface GoldenQuery {
  id: string;
  category: 'Food' | 'Vibe' | 'Service' | 'Reputation' | 'Convenience';
  query: string;
  minScore: number;
  expectedCuisines?: string[];
}

export const GOLDEN_DATASET: GoldenQuery[] = [
  // Food (15)
  { id: 'GD-F01', category: 'Food', query: 'best burger in Chicago', minScore: 55, expectedCuisines: ['American'] },
  { id: 'GD-F02', category: 'Food', query: 'authentic Chinese food', minScore: 55, expectedCuisines: ['Chinese'] },
  { id: 'GD-F03', category: 'Food', query: 'Korean BBQ', minScore: 55, expectedCuisines: ['Korean'] },
  { id: 'GD-F04', category: 'Food', query: 'best pasta in the city', minScore: 55, expectedCuisines: ['Italian'] },
  { id: 'GD-F05', category: 'Food', query: 'Caribbean food', minScore: 50, expectedCuisines: ['Caribbean', 'Cuban'] },
  { id: 'GD-F06', category: 'Food', query: 'omakase sushi', minScore: 55, expectedCuisines: ['Japanese'] },
  { id: 'GD-F07', category: 'Food', query: 'street tacos', minScore: 45 },
  { id: 'GD-F08', category: 'Food', query: 'jerk chicken', minScore: 50, expectedCuisines: ['Caribbean', 'Jamaican'] },
  { id: 'GD-F09', category: 'Food', query: 'French bistro', minScore: 50, expectedCuisines: ['French'] },
  { id: 'GD-F10', category: 'Food', query: 'wood-fired pizza', minScore: 60, expectedCuisines: ['Italian'] },
  { id: 'GD-F11', category: 'Food', query: 'oyster bar', minScore: 50, expectedCuisines: ['Seafood', 'French'] },
  { id: 'GD-F12', category: 'Food', query: 'soup dumplings', minScore: 50, expectedCuisines: ['Taiwanese', 'Chinese'] },
  { id: 'GD-F13', category: 'Food', query: 'Chicago hot dog', minScore: 50, expectedCuisines: ['American'] },
  { id: 'GD-F14', category: 'Food', query: 'fine dining tasting menu', minScore: 50 },
  { id: 'GD-F15', category: 'Food', query: 'pho', minScore: 45, expectedCuisines: ['Vietnamese'] },
  // Vibe (10)
  { id: 'GD-V01', category: 'Vibe', query: 'romantic dinner', minScore: 55 },
  { id: 'GD-V02', category: 'Vibe', query: 'rooftop bar', minScore: 50 },
  { id: 'GD-V03', category: 'Vibe', query: 'cozy spot', minScore: 50 },
  { id: 'GD-V04', category: 'Vibe', query: 'trendy restaurant', minScore: 45 },
  { id: 'GD-V05', category: 'Vibe', query: 'outdoor dining', minScore: 55 },
  { id: 'GD-V06', category: 'Vibe', query: 'quiet place to talk', minScore: 55 },
  { id: 'GD-V07', category: 'Vibe', query: 'lively atmosphere', minScore: 55 },
  { id: 'GD-V08', category: 'Vibe', query: 'late night eats', minScore: 50 },
  { id: 'GD-V09', category: 'Vibe', query: 'hole in the wall', minScore: 50 },
  { id: 'GD-V10', category: 'Vibe', query: 'brunch spot', minScore: 60 },
  // Service (10)
  { id: 'GD-S01', category: 'Service', query: 'business lunch', minScore: 55 },
  { id: 'GD-S02', category: 'Service', query: 'group dinner 10 people', minScore: 50 },
  { id: 'GD-S03', category: 'Service', query: 'family friendly restaurant', minScore: 55 },
  { id: 'GD-S04', category: 'Service', query: 'special occasion dinner', minScore: 55 },
  { id: 'GD-S05', category: 'Service', query: 'quick lunch', minScore: 55 },
  { id: 'GD-S06', category: 'Service', query: 'dinner before a show', minScore: 55 },
  { id: 'GD-S07', category: 'Service', query: 'work happy hour', minScore: 55 },
  { id: 'GD-S08', category: 'Service', query: 'anniversary dinner', minScore: 55 },
  { id: 'GD-S09', category: 'Service', query: 'solo dining', minScore: 50 },
  { id: 'GD-S10', category: 'Service', query: 'birthday celebration', minScore: 55 },
  // Reputation (5)
  { id: 'GD-R01', category: 'Reputation', query: 'best restaurant in Chicago', minScore: 60 },
  { id: 'GD-R02', category: 'Reputation', query: 'Michelin star restaurant', minScore: 65 },
  { id: 'GD-R03', category: 'Reputation', query: 'award winning chef', minScore: 55 },
  { id: 'GD-R04', category: 'Reputation', query: 'famous Chicago restaurant', minScore: 55 },
  { id: 'GD-R05', category: 'Reputation', query: 'most popular restaurant', minScore: 60 },
  // Convenience (10)
  { id: 'GD-C01', category: 'Convenience', query: 'open right now', minScore: 50 },
  { id: 'GD-C02', category: 'Convenience', query: 'no reservation needed', minScore: 55 },
  { id: 'GD-C03', category: 'Convenience', query: 'cheap eats', minScore: 45 },
  { id: 'GD-C04', category: 'Convenience', query: 'BYOB restaurant', minScore: 55 },
  { id: 'GD-C05', category: 'Convenience', query: 'delivery available', minScore: 55 },
  { id: 'GD-C06', category: 'Convenience', query: 'parking available', minScore: 45 },
  { id: 'GD-C07', category: 'Convenience', query: 'near the Loop', minScore: 55 },
  { id: 'GD-C08', category: 'Convenience', query: 'wheelchair accessible', minScore: 50 },
  { id: 'GD-C09', category: 'Convenience', query: 'dog friendly patio', minScore: 55 },
  { id: 'GD-C10', category: 'Convenience', query: 'vegan options', minScore: 55 },
];

// ═══════════════════════════════════════════════════════════════════
// Baseline Management
// ═══════════════════════════════════════════════════════════════════

export interface BaselineEntry {
  id: string;
  scores: Array<{ dm: number; timestamp: string }>;
  lastScore: number;
}

export function loadBaseline(): Record<string, BaselineEntry> {
  if (existsSync(BASELINE_FILE)) {
    try {
      return JSON.parse(readFileSync(BASELINE_FILE, 'utf-8'));
    } catch { /* start fresh */ }
  }
  return {};
}

export function saveBaseline(baseline: Record<string, BaselineEntry>) {
  writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
}

export function updateBaseline(
  baseline: Record<string, BaselineEntry>,
  queryId: string,
  dm: number
): { regression: boolean; delta: number } {
  if (!baseline[queryId]) {
    baseline[queryId] = { id: queryId, scores: [], lastScore: dm };
  }

  const entry = baseline[queryId];
  const lastScore = entry.lastScore;
  const delta = dm - lastScore;
  const regression = delta < -5; // Drop of more than 5 points

  entry.scores.push({ dm, timestamp: new Date().toISOString() });
  // Keep last 7 days of history (assuming ~24 checks/day)
  if (entry.scores.length > 168) entry.scores.shift();
  entry.lastScore = dm;

  return { regression, delta };
}

/**
 * Detect trend degradation: 3+ consecutive drops on same query
 */
export function detectTrendDegradation(entry: BaselineEntry): boolean {
  if (entry.scores.length < 3) return false;
  const recent = entry.scores.slice(-3);
  return recent[0].dm > recent[1].dm && recent[1].dm > recent[2].dm;
}

// ═══════════════════════════════════════════════════════════════════
// Try Another Monotonicity Check
// ═══════════════════════════════════════════════════════════════════

export interface TryAnotherResult {
  query: string;
  chain: Array<{ rank: number; dm: number; restaurant: string }>;
  monotonic: boolean;
  duplicates: boolean;
  maxDelta: number;
}

export function validateTryAnotherChain(
  chain: Array<{ rank: number; dm: number; restaurant: string }>
): { monotonic: boolean; duplicates: boolean; maxDelta: number } {
  let monotonic = true;
  let maxDelta = 0;
  const names = new Set<string>();
  let duplicates = false;

  for (let i = 0; i < chain.length; i++) {
    if (names.has(chain[i].restaurant)) duplicates = true;
    names.add(chain[i].restaurant);

    if (i > 0) {
      const delta = chain[i - 1].dm - chain[i].dm;
      if (delta < 0) monotonic = false; // Score increased (not monotonic non-increasing)
      maxDelta = Math.max(maxDelta, Math.abs(delta));
    }
  }

  return { monotonic, duplicates, maxDelta };
}
