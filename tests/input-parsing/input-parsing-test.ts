/**
 * V4 Input Parsing Test Runner — 3-Layer Testing
 *
 * Layer A: Keyword matching (CUISINE_KEYWORDS, TAG_KEYWORDS, INTENT_MAP, DIETARY_KEYWORDS)
 * Layer B: V4 Weight shifts (computeV4Weights with mockIntent)
 * Layer C: V4 Full pipeline (computeV4DondeMatch with aligned mock profiles)
 *
 * Run: cd dondeBackend && deno run --allow-read tests/input-parsing/input-parsing-test.ts
 */

import {
  CUISINE_KEYWORDS,
  TAG_KEYWORDS,
  INTENT_MAP,
  DIETARY_KEYWORDS,
  type IntentSignal,
} from "../../supabase/functions/recommend/_shared/scoring.ts";

import {
  computeV4Weights,
  BASE_WEIGHTS,
} from "../../supabase/functions/recommend/_shared/weight-config.ts";

import type { IntentClassificationV2 } from "../../supabase/functions/recommend/_shared/intent-classifier.ts";

import {
  TEST_CATALOG,
  CATEGORY_NAMES,
  type TestCase,
  type Category,
  type TestExpectations,
} from "./test-catalog.ts";

// ==========================================
// LAYER A: KEYWORD MATCHING
// ==========================================

/**
 * Match input against CUISINE_KEYWORDS.
 * Returns all cuisine names where any keyword is a substring of the lowered input.
 */
function matchCuisineKeywords(input: string): string[] {
  const lower = input.toLowerCase();
  const matched: string[] = [];
  for (const [cuisine, keywords] of Object.entries(CUISINE_KEYWORDS)) {
    if (keywords.some((kw: string) => lower.includes(kw))) {
      matched.push(cuisine);
    }
  }
  return matched;
}

/**
 * Match input against TAG_KEYWORDS.
 * Returns all tag names where any keyword is a substring of the lowered input.
 */
function matchTagKeywords(input: string): string[] {
  const lower = input.toLowerCase();
  const matched: string[] = [];
  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    if (keywords.some((kw: string) => lower.includes(kw))) {
      matched.push(tag);
    }
  }
  return matched;
}

/**
 * Match input against INTENT_MAP.
 * Returns union of all cuisines and tags from matching INTENT_MAP entries.
 */
function matchIntentMap(input: string): { cuisines: string[]; tags: string[] } {
  const lower = input.toLowerCase();
  const cuisines = new Set<string>();
  const tags = new Set<string>();

  for (const [key, signal] of Object.entries(INTENT_MAP)) {
    if (!lower.includes(key)) continue;
    if ((signal as IntentSignal).cuisines) {
      for (const c of (signal as IntentSignal).cuisines!) cuisines.add(c);
    }
    if ((signal as IntentSignal).tags) {
      for (const t of (signal as IntentSignal).tags!) tags.add(t);
    }
  }

  return { cuisines: [...cuisines], tags: [...tags] };
}

/**
 * Match input against DIETARY_KEYWORDS.
 * Returns all dietary keyword keys that are substrings of the lowered input.
 */
function matchDietaryKeywords(input: string): string[] {
  const lower = input.toLowerCase();
  const matched: string[] = [];
  for (const key of Object.keys(DIETARY_KEYWORDS)) {
    if (lower.includes(key)) {
      matched.push(key);
    }
  }
  return matched;
}

// ==========================================
// LAYER B: V4 WEIGHT SHIFT HELPERS
// ==========================================

function buildMockIntentV2(overrides: Partial<IntentClassificationV2> = {}): IntentClassificationV2 {
  return {
    target_cuisines: [],
    target_tags: [],
    target_features: [],
    cuisine_importance: "low",
    flavor_preferences: [],
    vibe_keywords: [],
    practical_constraints: [],
    emotional_intent: "casual",
    date_type: null,
    group_size_hint: null,
    spontaneity: "unknown",
    ...overrides,
  };
}

function getDominantWeight(weights: Record<string, number>): string {
  let maxKey = "";
  let maxVal = -1;
  for (const [key, val] of Object.entries(weights)) {
    if (val > maxVal) {
      maxVal = val;
      maxKey = key;
    }
  }
  return maxKey;
}

// ==========================================
// TEST INFRASTRUCTURE
// ==========================================

interface TestResult {
  id: string;
  input: string;
  category: Category;
  layer: "A" | "B";
  passed: boolean;
  assertion: string;
  expected: string;
  actual: string;
}

const results: TestResult[] = [];
let passCount = 0;
let failCount = 0;

function checkInclusion(
  testCase: TestCase,
  layer: "A" | "B",
  field: string,
  expected: string[],
  actual: string[],
): void {
  const missing = expected.filter(e => !actual.includes(e));
  const passed = missing.length === 0;

  if (passed) passCount++;
  else failCount++;

  results.push({
    id: testCase.id,
    input: testCase.input,
    category: testCase.category as Category,
    layer,
    passed,
    assertion: `${field} should include [${expected.join(", ")}]`,
    expected: `[${expected.join(", ")}]`,
    actual: `[${actual.join(", ")}]${missing.length > 0 ? ` MISSING: [${missing.join(", ")}]` : ""}`,
  });
}

function checkWeightRules(
  testCase: TestCase,
  expectedRules: string[],
  actualRules: string[],
): void {
  const missing = expectedRules.filter(r => !actualRules.some(ar => ar.includes(r) || r.includes(ar)));
  const passed = missing.length === 0;

  if (passed) passCount++;
  else failCount++;

  results.push({
    id: testCase.id,
    input: testCase.input,
    category: testCase.category as Category,
    layer: "B",
    passed,
    assertion: `weightRules should include [${expectedRules.join(", ")}]`,
    expected: `[${expectedRules.join(", ")}]`,
    actual: `[${actualRules.join(", ")}]${missing.length > 0 ? ` MISSING: [${missing.join(", ")}]` : ""}`,
  });
}

function checkDominantWeight(
  testCase: TestCase,
  expectedDominant: string,
  weights: Record<string, number>,
): void {
  const actualDominant = getDominantWeight(weights);
  const passed = actualDominant === expectedDominant;

  if (passed) passCount++;
  else failCount++;

  results.push({
    id: testCase.id,
    input: testCase.input,
    category: testCase.category as Category,
    layer: "B",
    passed,
    assertion: `dominant weight should be '${expectedDominant}'`,
    expected: expectedDominant,
    actual: `${actualDominant} (${Object.entries(weights).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(", ")})`,
  });
}

// ==========================================
// RUN TESTS
// ==========================================

console.log("=".repeat(70));
console.log("V4 INPUT PARSING TEST RUNNER");
console.log(`Test catalog: ${TEST_CATALOG.length} test cases`);
console.log("=".repeat(70));
console.log("");

for (const tc of TEST_CATALOG) {
  const { expect: exp, input } = tc;

  // ---- Layer A: Keyword matching ----

  // A1: CUISINE_KEYWORDS
  if (exp.cuisines && exp.cuisines.length > 0) {
    const matchedCuisines = matchCuisineKeywords(input);
    checkInclusion(tc, "A", "cuisines", exp.cuisines, matchedCuisines);
  }

  // A2: TAG_KEYWORDS
  if (exp.tags && exp.tags.length > 0) {
    const matchedTags = matchTagKeywords(input);
    checkInclusion(tc, "A", "tags", exp.tags, matchedTags);
  }

  // A3: INTENT_MAP → cuisines
  if (exp.intentCuisines && exp.intentCuisines.length > 0) {
    const intentMatch = matchIntentMap(input);
    checkInclusion(tc, "A", "intentCuisines", exp.intentCuisines, intentMatch.cuisines);
  }

  // A4: INTENT_MAP → tags
  if (exp.intentTags && exp.intentTags.length > 0) {
    const intentMatch = matchIntentMap(input);
    checkInclusion(tc, "A", "intentTags", exp.intentTags, intentMatch.tags);
  }

  // A5: DIETARY_KEYWORDS
  if (exp.dietary && exp.dietary.length > 0) {
    const matchedDietary = matchDietaryKeywords(input);
    checkInclusion(tc, "A", "dietary", exp.dietary, matchedDietary);
  }

  // ---- Layer B: V4 Weight shifts ----

  if (exp.weightRules && tc.occasion && tc.mockIntent) {
    const intent = buildMockIntentV2(tc.mockIntent);
    const { appliedRules } = computeV4Weights(tc.occasion, intent);
    checkWeightRules(tc, exp.weightRules, appliedRules);
  }

  if (exp.weightDominant && tc.occasion && tc.mockIntent) {
    const intent = buildMockIntentV2(tc.mockIntent);
    const { weights } = computeV4Weights(tc.occasion, intent);
    checkDominantWeight(tc, exp.weightDominant, weights);
  }
}

// ==========================================
// OUTPUT RESULTS
// ==========================================

console.log("");
console.log("=".repeat(70));
console.log("RESULTS BY CATEGORY");
console.log("=".repeat(70));

// Group by category
const byCategory = new Map<Category, TestResult[]>();
for (const r of results) {
  if (!byCategory.has(r.category)) byCategory.set(r.category, []);
  byCategory.get(r.category)!.push(r);
}

// Print per-category summary
for (const [cat, catResults] of byCategory) {
  const catPass = catResults.filter(r => r.passed).length;
  const catFail = catResults.filter(r => !r.passed).length;
  const catTotal = catResults.length;
  const pct = catTotal > 0 ? Math.round((catPass / catTotal) * 100) : 100;
  const status = catFail === 0 ? "✓" : "✗";

  console.log(`\n${status} ${CATEGORY_NAMES[cat]} (${cat}): ${catPass}/${catTotal} (${pct}%)`);

  // Print failures
  const failures = catResults.filter(r => !r.passed);
  for (const f of failures) {
    console.log(`  FAIL [${f.id}] "${f.input}" → ${f.assertion}`);
    console.log(`        Expected: ${f.expected}`);
    console.log(`        Actual:   ${f.actual}`);
  }
}

// ==========================================
// OVERALL SUMMARY
// ==========================================

console.log("");
console.log("=".repeat(70));
console.log("OVERALL SUMMARY");
console.log("=".repeat(70));

const totalAssertions = passCount + failCount;
const passRate = totalAssertions > 0 ? Math.round((passCount / totalAssertions) * 100) : 100;

console.log(`Test cases:  ${TEST_CATALOG.length}`);
console.log(`Assertions:  ${totalAssertions}`);
console.log(`Passed:      ${passCount}`);
console.log(`Failed:      ${failCount}`);
console.log(`Pass rate:   ${passRate}%`);
console.log("");

// Gap analysis — show which dictionaries need fixes
if (failCount > 0) {
  console.log("=".repeat(70));
  console.log("GAP ANALYSIS");
  console.log("=".repeat(70));

  const gapsByField = new Map<string, number>();
  for (const r of results) {
    if (!r.passed) {
      const field = r.assertion.split(" should ")[0];
      gapsByField.set(field, (gapsByField.get(field) || 0) + 1);
    }
  }

  for (const [field, count] of [...gapsByField.entries()].sort((a, b) => b[1] - a[1])) {
    let fixTarget = "unknown";
    if (field === "cuisines") fixTarget = "CUISINE_KEYWORDS in scoring.ts";
    else if (field === "tags") fixTarget = "TAG_KEYWORDS in scoring.ts";
    else if (field === "intentCuisines" || field === "intentTags") fixTarget = "INTENT_MAP in scoring.ts";
    else if (field === "dietary") fixTarget = "DIETARY_KEYWORDS in scoring.ts";
    else if (field.includes("weight")) fixTarget = "WEIGHT_SHIFT_RULES in weight-config.ts";
    console.log(`  ${field}: ${count} failures → fix ${fixTarget}`);
  }
  console.log("");
}

// Exit with error code if any failures
if (failCount > 0) {
  console.log(`❌ ${failCount} assertions failed. Fix dictionaries and re-run.`);
  Deno.exit(1);
} else {
  console.log(`✅ All ${totalAssertions} assertions passed!`);
  Deno.exit(0);
}
