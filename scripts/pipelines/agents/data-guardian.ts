/**
 * GUARDIAN Agent — "The Sage"
 *
 * Validates database integrity, RPC correctness, and data quality.
 * Checks for orphaned records, missing profiles, and enrichment gaps.
 *
 * API Budget: 5 calls/day (mostly direct DB queries)
 * Cycle: Every 90 seconds
 *
 * Reuses:
 *   - scripts/lib/supabase.ts (Supabase client)
 */

// ═══════════════════════════════════════════════════════════════════
// Data Integrity Checks
// ═══════════════════════════════════════════════════════════════════

export interface IntegrityCheck {
  id: string;
  name: string;
  category: 'orphan' | 'completeness' | 'format' | 'range' | 'consistency';
  severity: 'critical' | 'major' | 'minor';
  description: string;
  /** SQL query to run (for reference — actual execution via Supabase client) */
  sql: string;
  expectedResult: string;
}

export const INTEGRITY_CHECKS: IntegrityCheck[] = [
  {
    id: 'DQ-01',
    name: 'No restaurants missing deep_profiles',
    category: 'completeness',
    severity: 'critical',
    description: 'Every active restaurant should have a deep_profiles entry',
    sql: `SELECT count(*) FROM restaurants r
          LEFT JOIN deep_profiles dp ON r.id = dp.restaurant_id
          WHERE dp.id IS NULL AND r.is_active = true`,
    expectedResult: '0',
  },
  {
    id: 'DQ-02',
    name: 'All occasion scores in range 0-10',
    category: 'range',
    severity: 'critical',
    description: 'Occasion scores must be between 0 and 10',
    sql: `SELECT count(*) FROM occasion_scores
          WHERE date_friendly_score NOT BETWEEN 0 AND 10
             OR group_friendly_score NOT BETWEEN 0 AND 10
             OR family_friendly_score NOT BETWEEN 0 AND 10
             OR business_lunch_score NOT BETWEEN 0 AND 10
             OR solo_dining_score NOT BETWEEN 0 AND 10`,
    expectedResult: '0',
  },
  {
    id: 'DQ-03',
    name: 'No orphaned deep_profiles',
    category: 'orphan',
    severity: 'major',
    description: 'No deep_profiles referencing non-existent restaurants',
    sql: `SELECT count(*) FROM deep_profiles dp
          LEFT JOIN restaurants r ON dp.restaurant_id = r.id
          WHERE r.id IS NULL`,
    expectedResult: '0',
  },
  {
    id: 'DQ-04',
    name: 'Tag distribution: all restaurants >= 3 tags',
    category: 'completeness',
    severity: 'major',
    description: 'Every active restaurant should have at least 3 tags',
    sql: `SELECT count(*) FROM restaurants r
          WHERE r.is_active = true
          AND (SELECT count(*) FROM restaurant_tags rt WHERE rt.restaurant_id = r.id) < 3`,
    expectedResult: '0',
  },
  {
    id: 'DQ-05',
    name: 'No NULL critical fields',
    category: 'completeness',
    severity: 'critical',
    description: 'Name and address must never be null for active restaurants',
    sql: `SELECT count(*) FROM restaurants
          WHERE is_active = true AND (name IS NULL OR address IS NULL)`,
    expectedResult: '0',
  },
  {
    id: 'DQ-06',
    name: 'Enrichment confidence values in 0.00-1.00',
    category: 'range',
    severity: 'major',
    description: 'AI enrichment confidence must be between 0 and 1',
    sql: `SELECT count(*) FROM deep_profiles
          WHERE enrichment_confidence IS NOT NULL
          AND (enrichment_confidence < 0 OR enrichment_confidence > 1)`,
    expectedResult: '0',
  },
  {
    id: 'DQ-07',
    name: 'No orphaned occasion_scores',
    category: 'orphan',
    severity: 'major',
    description: 'No occasion_scores referencing non-existent restaurants',
    sql: `SELECT count(*) FROM occasion_scores os
          LEFT JOIN restaurants r ON os.restaurant_id = r.id
          WHERE r.id IS NULL`,
    expectedResult: '0',
  },
  {
    id: 'DQ-08',
    name: 'No orphaned restaurant_tags',
    category: 'orphan',
    severity: 'minor',
    description: 'No tags referencing non-existent restaurants',
    sql: `SELECT count(*) FROM restaurant_tags rt
          LEFT JOIN restaurants r ON rt.restaurant_id = r.id
          WHERE r.id IS NULL`,
    expectedResult: '0',
  },
];

// ═══════════════════════════════════════════════════════════════════
// Insider Tip Validation
// ═══════════════════════════════════════════════════════════════════

const TIP_START_VERBS = ['Ask', 'Grab', 'Sit', 'Try', 'Order', 'Request', 'Get', 'Skip', 'Go', 'Come', 'Book', 'Start', 'Save'];

export interface TipValidation {
  restaurantName: string;
  tip: string;
  startsWithVerb: boolean;
  wordCount: number;
  inRange: boolean;
}

export function validateInsiderTip(restaurantName: string, tip: string): TipValidation {
  const words = tip.trim().split(/\s+/);
  const wordCount = words.length;
  const firstWord = words[0] || '';
  const startsWithVerb = TIP_START_VERBS.some(v => firstWord.startsWith(v));
  const inRange = wordCount >= 15 && wordCount <= 25;

  return { restaurantName, tip, startsWithVerb, wordCount, inRange };
}

// ═══════════════════════════════════════════════════════════════════
// Data Completeness Scoring
// ═══════════════════════════════════════════════════════════════════

export interface RestaurantCompleteness {
  name: string;
  totalFields: number;
  filledFields: number;
  completeness: number;
  missingFields: string[];
}

const EXPECTED_FIELDS = [
  'name', 'address', 'cuisine_type', 'price_level', 'phone', 'website',
  'google_rating', 'google_review_count', 'noise_level', 'lighting_ambiance',
  'dress_code', 'outdoor_seating', 'live_music', 'pet_friendly',
  'parking_availability', 'dietary_options', 'neighborhood_name',
  'sentiment_score', 'sentiment_summary',
];

export function scoreCompleteness(restaurant: Record<string, unknown>): RestaurantCompleteness {
  const filled = EXPECTED_FIELDS.filter(f => restaurant[f] != null);
  const missing = EXPECTED_FIELDS.filter(f => restaurant[f] == null);

  return {
    name: (restaurant.name as string) || 'Unknown',
    totalFields: EXPECTED_FIELDS.length,
    filledFields: filled.length,
    completeness: Math.round((filled.length / EXPECTED_FIELDS.length) * 100),
    missingFields: missing,
  };
}

/**
 * Identify "thin" restaurants (< 50% field coverage) that need enrichment
 */
export function identifyThinRestaurants(
  restaurants: Array<Record<string, unknown>>
): RestaurantCompleteness[] {
  return restaurants
    .map(r => scoreCompleteness(r))
    .filter(r => r.completeness < 50)
    .sort((a, b) => a.completeness - b.completeness);
}
