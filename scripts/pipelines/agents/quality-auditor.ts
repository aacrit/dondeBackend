/**
 * QAUDIT Agent — "The Critic"
 *
 * Evaluates blurb quality, tone calibration, and scoring accuracy.
 * Zero API calls — analyzes responses from ATLAS's runs.
 *
 * API Budget: 0 calls/day
 * Cycle: Every 45 seconds
 *
 * Checks:
 *   - Banned word detection (40+ AI slop patterns)
 *   - Tone-score alignment
 *   - "We" voice presence
 *   - Restaurant name presence
 *   - Em dash detection
 *   - Word count validation (60-100)
 *   - Single paragraph check
 */

export const BANNED_PATTERNS = [
  // AI slop — food
  'culinary', 'gastronomic', 'delectable', 'exquisite', 'tantalizing',
  'delightful', 'mouthwatering', 'scrumptious', 'delish', 'yummy',
  'palate', 'palette', 'taste buds', 'flavor explosion', 'burst of flavor',
  'symphony of flavors', 'culinary journey', 'dining experience',
  'food lovers', 'every bite', 'savor every',
  // AI slop — place
  'nestled', 'tucked away', 'hidden gem', 'oasis', 'haven',
  'beckons', 'invites you', 'welcomes you', 'promises',
  'where tradition meets',
  // AI slop — quality
  'impeccable', 'unparalleled', 'masterfully', 'beautifully',
  'stunningly', 'perfectly', 'artisan', 'artisanal', 'handcrafted',
  'crafted with', 'lovingly prepared',
  // AI slop — general
  'elevate', 'elevated', 'transcend', 'journey', 'tapestry',
  'diverse menu', 'wide array', 'something for everyone',
  'must-visit', 'not disappoint', "won't disappoint",
  'fusion of', 'indulge',
  // Structural tells
  'Ah,', 'Oh,', 'Whether you', "If you're looking",
  "Whether it's", 'From...to...',
];

export interface BlurbAuditResult {
  blurbIndex: number;
  restaurantName: string;
  dondeMatch: number;
  wordCount: number;
  issues: BlurbIssue[];
  grade: 'A' | 'B' | 'C' | 'F';
}

export interface BlurbIssue {
  type: 'banned_word' | 'em_dash' | 'no_we_voice' | 'no_restaurant_name' |
        'word_count' | 'multi_paragraph' | 'tone_mismatch' | 'overselling';
  severity: 'critical' | 'major' | 'minor';
  detail: string;
}

/**
 * Audit a single blurb for quality issues
 */
export function auditBlurb(
  blurb: string,
  restaurantName: string,
  dondeMatch: number
): BlurbAuditResult {
  const issues: BlurbIssue[] = [];

  // Word count check (60-100)
  const words = blurb.trim().split(/\s+/);
  const wordCount = words.length;
  if (wordCount < 60) {
    issues.push({ type: 'word_count', severity: 'major', detail: `Too short: ${wordCount} words (min 60)` });
  } else if (wordCount > 100) {
    issues.push({ type: 'word_count', severity: 'minor', detail: `Too long: ${wordCount} words (max 100)` });
  }

  // Banned word detection
  const lowerBlurb = blurb.toLowerCase();
  BANNED_PATTERNS.forEach(pattern => {
    if (lowerBlurb.includes(pattern.toLowerCase())) {
      issues.push({ type: 'banned_word', severity: 'critical', detail: `Found: "${pattern}"` });
    }
  });

  // Em dash check (U+2014)
  if (blurb.includes('\u2014')) {
    issues.push({ type: 'em_dash', severity: 'critical', detail: 'Contains em dash (U+2014)' });
  }

  // "We" voice check
  if (!/\b(we|We|our|Our)\b/.test(blurb)) {
    issues.push({ type: 'no_we_voice', severity: 'critical', detail: 'Missing "We" voice' });
  }

  // Restaurant name check
  if (restaurantName && !blurb.includes(restaurantName)) {
    issues.push({ type: 'no_restaurant_name', severity: 'critical', detail: `Missing restaurant name: "${restaurantName}"` });
  }

  // Single paragraph check
  if (blurb.includes('\n')) {
    issues.push({ type: 'multi_paragraph', severity: 'major', detail: 'Blurb contains line breaks (should be single paragraph)' });
  }

  // Tone-score alignment
  if (dondeMatch >= 85) {
    // High score: should be confident, no hedging
    const hedgeWords = ['might', 'could be', 'if you', 'perhaps', 'maybe'];
    hedgeWords.forEach(hw => {
      if (lowerBlurb.includes(hw)) {
        issues.push({ type: 'tone_mismatch', severity: 'major', detail: `High score (${dondeMatch}) but hedging: "${hw}"` });
      }
    });
  }

  if (dondeMatch < 55) {
    // Low score: should not oversell
    const oversellWords = ['perfect', 'ideal', 'best', 'incredible', 'amazing'];
    oversellWords.forEach(ow => {
      if (lowerBlurb.includes(ow)) {
        issues.push({ type: 'overselling', severity: 'major', detail: `Low score (${dondeMatch}) but overselling: "${ow}"` });
      }
    });
  }

  // Grade
  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const majorCount = issues.filter(i => i.severity === 'major').length;

  let grade: BlurbAuditResult['grade'] = 'A';
  if (criticalCount > 0) grade = 'F';
  else if (majorCount >= 3) grade = 'C';
  else if (majorCount >= 1) grade = 'B';

  return { blurbIndex: 0, restaurantName, dondeMatch, wordCount, issues, grade };
}

/**
 * Compute aggregate audit stats
 */
export function computeAuditStats(results: BlurbAuditResult[]): {
  total: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  gradeF: number;
  overallGrade: string;
  slopDensity: number;
  topIssues: Array<{ type: string; count: number }>;
} {
  const total = results.length;
  const gradeA = results.filter(r => r.grade === 'A').length;
  const gradeB = results.filter(r => r.grade === 'B').length;
  const gradeC = results.filter(r => r.grade === 'C').length;
  const gradeF = results.filter(r => r.grade === 'F').length;

  // Overall grade based on distribution
  let overallGrade = 'A';
  if (gradeF > 0) overallGrade = 'F';
  else if (gradeC / total > 0.2) overallGrade = 'C';
  else if ((gradeB + gradeC) / total > 0.1) overallGrade = 'B';
  else if (gradeA / total < 1) overallGrade = 'A-';

  // Slop density
  const totalBanned = results.reduce((s, r) => s + r.issues.filter(i => i.type === 'banned_word').length, 0);
  const totalWords = results.reduce((s, r) => s + r.wordCount, 0);
  const slopDensity = totalWords > 0 ? Math.round((totalBanned / totalWords) * 10000) / 100 : 0;

  // Top issues
  const issueCounts: Record<string, number> = {};
  results.forEach(r => r.issues.forEach(i => {
    issueCounts[i.type] = (issueCounts[i.type] || 0) + 1;
  }));

  const topIssues = Object.entries(issueCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { total, gradeA, gradeB, gradeC, gradeF, overallGrade, slopDensity, topIssues };
}
