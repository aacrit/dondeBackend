/**
 * HUNTER Agent — "The Rogue"
 *
 * Probes API boundaries, error handling, and edge cases.
 * Tests dietary restriction combinations, adversarial inputs,
 * and validates full API response contract.
 *
 * API Budget: 10 calls/day
 * Cycle: Every 40 seconds
 */

// ═══════════════════════════════════════════════════════════════════
// Edge Case Probes
// ═══════════════════════════════════════════════════════════════════

export interface Probe {
  id: string;
  name: string;
  category: 'edge_case' | 'dietary' | 'contract' | 'injection' | 'boundary';
  input: string;
  params?: Record<string, unknown>;
  expectSuccess: boolean;
  description: string;
}

export const PROBE_REGISTRY: Probe[] = [
  // Edge Cases
  {
    id: 'EC-01', name: 'Empty request', category: 'edge_case',
    input: '', expectSuccess: true,
    description: 'Empty special_request should return a result with base weights',
  },
  {
    id: 'EC-02', name: 'Max length input', category: 'boundary',
    input: 'a'.repeat(500), expectSuccess: true,
    description: '500-char input should not crash the API',
  },
  {
    id: 'EC-03', name: 'Unicode characters', category: 'edge_case',
    input: 'caf\u00e9 r\u00e9sum\u00e9 na\u00efve', expectSuccess: true,
    description: 'Unicode chars should not cause encoding errors',
  },
  {
    id: 'EC-04', name: 'SQL injection', category: 'injection',
    input: "'; DROP TABLE restaurants; --", expectSuccess: true,
    description: 'SQL injection should be safely handled',
  },
  {
    id: 'EC-05', name: 'Invalid neighborhood', category: 'boundary',
    input: 'dinner', params: { neighborhood: 'Mars' }, expectSuccess: true,
    description: 'Invalid neighborhood should fallback to Anywhere',
  },
  {
    id: 'EC-06', name: 'All dietary restrictions', category: 'dietary',
    input: 'dinner',
    params: { dietary_restrictions: ['vegan', 'gluten_free', 'halal', 'kosher', 'nut_free'] },
    expectSuccess: true,
    description: 'Max restrictions should return result or graceful fallback',
  },
  {
    id: 'EC-07', name: 'Contradictory request', category: 'edge_case',
    input: 'vegan steakhouse', expectSuccess: true,
    description: 'Contradictory signals should resolve without crash',
  },
  {
    id: 'EC-08', name: 'XSS attempt', category: 'injection',
    input: '<script>alert("xss")</script>', expectSuccess: true,
    description: 'XSS payload should be safely handled',
  },
  {
    id: 'EC-09', name: 'Invalid price level', category: 'boundary',
    input: 'dinner', params: { price_level: '$$$$$$' }, expectSuccess: true,
    description: 'Invalid price should fallback to Any',
  },
  {
    id: 'EC-10', name: 'Ultra-short cold start', category: 'edge_case',
    input: 'hmm', expectSuccess: true,
    description: 'Minimal input should return result with base weights',
  },
  {
    id: 'EC-11', name: 'Non-existent exclusion UUID', category: 'boundary',
    input: 'dinner',
    params: { exclude: ['00000000-0000-0000-0000-000000000000'] },
    expectSuccess: true,
    description: 'Fake exclusion UUID should be ignored gracefully',
  },
  {
    id: 'EC-12', name: 'Heavy exclusion list', category: 'boundary',
    input: 'dinner',
    params: { exclude: Array.from({ length: 15 }, (_, i) => `00000000-0000-0000-0000-00000000000${i}`) },
    expectSuccess: true,
    description: '15 exclusion UUIDs should still return result',
  },

  // Dietary-focused probes
  {
    id: 'DR-01', name: 'Single restriction: vegan', category: 'dietary',
    input: 'dinner', params: { dietary_restrictions: ['vegan'] }, expectSuccess: true,
    description: 'Vegan restriction should influence food_quality scoring',
  },
  {
    id: 'DR-02', name: 'Multiple: gluten-free + vegan', category: 'dietary',
    input: 'dinner',
    params: { dietary_restrictions: ['gluten_free', 'vegan'] },
    expectSuccess: true,
    description: 'Multiple restrictions handled gracefully',
  },
  {
    id: 'DR-03', name: 'Rare: halal', category: 'dietary',
    input: 'dinner', params: { dietary_restrictions: ['halal'] }, expectSuccess: true,
    description: 'Halal restriction handled, may widen search',
  },
  {
    id: 'DR-04', name: 'Vegan + steakhouse conflict', category: 'dietary',
    input: 'steakhouse',
    params: { dietary_restrictions: ['vegan'] },
    expectSuccess: true,
    description: 'Conflicting craving + restriction should resolve gracefully',
  },
];

// ═══════════════════════════════════════════════════════════════════
// API Contract Validation
// ═══════════════════════════════════════════════════════════════════

export interface ContractCheck {
  id: string;
  name: string;
  check: (response: Record<string, unknown>) => boolean;
}

export const CONTRACT_CHECKS: ContractCheck[] = [
  {
    id: 'RC-01', name: 'success is boolean',
    check: (r) => typeof r.success === 'boolean',
  },
  {
    id: 'RC-02', name: 'donde_match is integer 0-99',
    check: (r) => typeof r.donde_match === 'number' && r.donde_match >= 0 && r.donde_match <= 99 && Number.isInteger(r.donde_match),
  },
  {
    id: 'RC-03', name: 'restaurant object present',
    check: (r) => r.success ? typeof r.restaurant === 'object' && r.restaurant !== null : true,
  },
  {
    id: 'RC-04', name: 'restaurant.id is UUID',
    check: (r) => {
      if (!r.success) return true;
      const rest = r.restaurant as Record<string, unknown>;
      return typeof rest?.id === 'string' && /^[0-9a-f-]{36}$/i.test(rest.id as string);
    },
  },
  {
    id: 'RC-05', name: 'restaurant.name not null',
    check: (r) => {
      if (!r.success) return true;
      const rest = r.restaurant as Record<string, unknown>;
      return typeof rest?.name === 'string' && (rest.name as string).length > 0;
    },
  },
  {
    id: 'RC-06', name: 'timestamp is ISO 8601',
    check: (r) => typeof r.timestamp === 'string' && !isNaN(Date.parse(r.timestamp as string)),
  },
  {
    id: 'RC-07', name: 'tags is array of strings',
    check: (r) => {
      if (!r.success) return true;
      return Array.isArray(r.tags) && (r.tags as unknown[]).every(t => typeof t === 'string');
    },
  },
  {
    id: 'RC-08', name: 'recommendation is string',
    check: (r) => typeof r.recommendation === 'string',
  },
  {
    id: 'RC-09', name: 'scoring_v9 present',
    check: (r) => {
      if (!r.success) return true;
      return typeof r.scoring_v9 === 'object' && r.scoring_v9 !== null;
    },
  },
  {
    id: 'RC-10', name: 'no null critical restaurant fields',
    check: (r) => {
      if (!r.success) return true;
      const rest = r.restaurant as Record<string, unknown>;
      return rest?.name != null && rest?.address != null;
    },
  },
];

/**
 * Run all contract checks against a response
 */
export function validateContract(response: Record<string, unknown>): {
  passed: boolean;
  results: Array<{ id: string; name: string; passed: boolean }>;
} {
  const results = CONTRACT_CHECKS.map(check => ({
    id: check.id,
    name: check.name,
    passed: check.check(response),
  }));

  return {
    passed: results.every(r => r.passed),
    results,
  };
}

/**
 * Pick random probes for a cycle, respecting rotation
 */
export function sampleProbes(count: number, recentIds: string[] = []): Probe[] {
  // Prefer probes not recently tested
  const available = PROBE_REGISTRY.filter(p => !recentIds.includes(p.id));
  const pool = available.length >= count ? available : PROBE_REGISTRY;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
