/**
 * V5.1 Scoring Engine Tests — Comprehensive Pre-Boost Verification
 * Tests the ACTUAL production code via esbuild bundle (no inline duplication).
 * Zero API cost: no Claude, no Google Places API calls.
 *
 * Run: cd dondeBackend/scripts && npx tsx test-v5-scoring.ts
 *
 * Prerequisites:
 *   cd dondeBackend && npx esbuild supabase/functions/recommend/_shared/scoring-v5.ts \
 *     --bundle --platform=node --format=esm --outfile=scripts/scoring-v5-bundle.mjs
 */

import { buildSync } from "esbuild";
import { mkdtempSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { pathToFileURL, fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..");

// ==========================================
// Phase 0: Build esbuild bundle of production scoring code
// ==========================================

console.log("Building scoring-v5 bundle...");
const tmpDir = mkdtempSync("/tmp/v5-test-");
const bundlePath = join(tmpDir, "scoring-v5-bundle.mjs");

// Bundle entry that re-exports everything we need
const entryContent = `
  export { computeV5DondeMatch, reRankV5 } from "./scoring-v5.ts";
  export { computeV5Weights, V5_BASE_WEIGHTS } from "./weight-config-v5.ts";
`;

buildSync({
  stdin: {
    contents: entryContent,
    resolveDir: join(PROJECT_ROOT, "supabase/functions/recommend/_shared"),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: bundlePath,
  logLevel: "warning",
});

const scoring: any = await import(pathToFileURL(bundlePath).href);
const { computeV5DondeMatch, reRankV5, computeV5Weights, V5_BASE_WEIGHTS } = scoring;
console.log("Bundle loaded successfully.\n");

// ==========================================
// Inline Types (for TypeScript annotations only — runtime from bundle)
// ==========================================

interface DeepProfile {
  flavor_profiles: string[] | null;
  signature_dishes: Array<{ dish: string; why: string }> | null;
  cuisine_subcategory: string | null;
  menu_depth: string | null;
  spice_level: string | null;
  dietary_depth: string | null;
  service_style: string | null;
  meal_pacing: string | null;
  reservation_difficulty: string | null;
  typical_wait_minutes: number | null;
  group_size_sweet_spot: string | null;
  check_average_per_person: number | null;
  tipping_culture: string | null;
  kid_friendliness: number | null;
  music_vibe: string | null;
  decor_style: string | null;
  conversation_friendliness: number | null;
  energy_level: number | null;
  seating_options: string[] | null;
  instagram_worthiness: number | null;
  seasonal_relevance: Record<string, number> | null;
  cultural_authenticity: number | null;
  origin_story: string | null;
  crowd_profile: string[] | null;
  neighborhood_integration: string | null;
  chef_notable: boolean | null;
  awards_recognition: string[] | null;
  wow_factors: string[] | null;
  date_progression: string | null;
  best_seat_in_house: string | null;
  ideal_weather: string[] | null;
  unique_selling_point: string | null;
  transit_accessibility: string | null;
  byob_policy: string | null;
  payment_notes: string | null;
  enrichment_confidence: number | null;
}

interface RestaurantProfile {
  id: string;
  name: string;
  address: string;
  neighborhood_id: string | null;
  google_place_id: string | null;
  price_level: string | null;
  noise_level: string | null;
  lighting_ambiance: string | null;
  dress_code: string | null;
  outdoor_seating: boolean | null;
  live_music: boolean | null;
  pet_friendly: boolean | null;
  parking_availability: string | null;
  cuisine_type: string | null;
  best_for_oneliner: string | null;
  insider_tip: string | null;
  best_times: string[] | null;
  dietary_options: string[] | null;
  good_for: string[] | null;
  ambiance: string[] | null;
  is_active: boolean | null;
  neighborhood_name: string;
  neighborhood_description: string | null;
  date_friendly_score: number | null;
  group_friendly_score: number | null;
  family_friendly_score: number | null;
  romantic_rating: number | null;
  business_lunch_score: number | null;
  solo_dining_score: number | null;
  hole_in_wall_factor: number | null;
  tags: string[];
  tag_categories: string[];
  occasion_score: number | null;
  total_score: number | null;
  trending_score: number | null;
  deep_profile: DeepProfile | null;
}

interface IntentClassificationV2 {
  target_cuisines: string[];
  target_tags: string[];
  target_features: string[];
  cuisine_importance: "high" | "medium" | "low";
  flavor_preferences: string[];
  vibe_keywords: string[];
  practical_constraints: string[];
  emotional_intent: string;
  date_type: string | null;
  group_size_hint: string | null;
  spontaneity: "planned" | "spontaneous" | "unknown";
}

interface GooglePlaceData {
  name: string;
  address: string;
  phone: string | null;
  website: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  reviews: Array<{ rating: number; text: string }>;
  business_status: string | null;
  photo_urls: string[];
  opening_hours: { open_now: boolean | null; weekday_text: string[] | null } | null;
}

interface V5DondeMatchInputs {
  occasion: string;
  specialRequest: string;
  neighborhood: string;
  priceLevel: string;
  googleData: GooglePlaceData | null;
  sentimentScore?: number | null;
  sentimentNegative?: number | null;
  intent: IntentClassificationV2 | null;
  rejectionSignals?: { avoidCuisines: string[]; avoidPriceLevels: string[]; avoidRestaurantIds: string[] };
  userFeedback?: { likedCuisines: string[]; dislikedCuisines: string[]; likedRestaurantIds: string[]; dislikedRestaurantIds: string[] } | null;
  clientTimeOfDay?: string | null;
  dietaryRestrictions?: string[];
  candidatePoolSize?: number;
}

interface V5DondeMatchResult {
  dondeMatch: number;
  factors: { food: number; vibe: number; service: number; reputation: number; convenience: number };
  weights: { food: number; vibe: number; service: number; reputation: number; convenience: number };
  confidence: { food: string; vibe: string; service: string; reputation: string; convenience: string };
  dataCompleteness: number;
  weightShiftReasons: string[];
  factorDetails?: Record<string, Record<string, { score: number; max: number; signal: string }>>;
}

// ==========================================
// Test Infrastructure
// ==========================================

let passed = 0;
let failed = 0;
let warned = 0;
const failures: string[] = [];

function assert(condition: boolean, testName: string, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    const msg = `  ✗ ${testName}${detail ? ` — ${detail}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function assertApprox(actual: number, expected: number, tolerance: number, testName: string) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, testName, `expected ~${expected}, got ${actual} (diff ${diff.toFixed(4)})`);
}

function assertRange(actual: number, min: number, max: number, testName: string) {
  assert(
    actual >= min && actual <= max,
    testName,
    `expected [${min}-${max}], got ${actual}`
  );
}

function warn(testName: string, detail = "") {
  warned++;
  console.log(`  ⚠ ${testName}${detail ? ` — ${detail}` : ""}`);
}

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

function getTier(score: number): string {
  if (score >= 88) return "Perfect Match";
  if (score >= 75) return "Strong Pick";
  if (score >= 60) return "Solid Option";
  if (score >= 45) return "Worth a Try";
  return "Best Available";
}

// ==========================================
// Mock Builders
// ==========================================

function makeProfile(overrides: Partial<RestaurantProfile> = {}): RestaurantProfile {
  return {
    id: "test-id-1",
    name: "Test Restaurant",
    address: "123 Test St, Chicago, IL",
    neighborhood_id: "nbhd-1",
    google_place_id: "ChIJtest",
    price_level: "$$",
    noise_level: "Moderate",
    lighting_ambiance: "warm, cozy",
    dress_code: "Smart Casual",
    outdoor_seating: false,
    live_music: false,
    pet_friendly: false,
    parking_availability: "Street",
    cuisine_type: "Italian",
    best_for_oneliner: "Handmade pasta in a cozy setting",
    insider_tip: "Try the rigatoni",
    best_times: ["dinner"],
    dietary_options: ["Vegetarian"],
    good_for: ["Dates", "Groups"],
    ambiance: ["Cozy"],
    is_active: true,
    neighborhood_name: "West Loop",
    neighborhood_description: "Trendy dining corridor",
    date_friendly_score: 8,
    group_friendly_score: 6,
    family_friendly_score: 5,
    romantic_rating: 7,
    business_lunch_score: 4,
    solo_dining_score: 5,
    hole_in_wall_factor: 3,
    tags: ["romantic", "craft cocktails", "farm-to-table"],
    tag_categories: ["ambiance", "drinks", "sourcing"],
    occasion_score: 8,
    total_score: 38,
    trending_score: 7.5,
    deep_profile: null,
    ...overrides,
  };
}

function makeDeepProfile(overrides: Partial<DeepProfile> = {}): DeepProfile {
  return {
    flavor_profiles: ["umami-forward", "rich-buttery", "herbaceous"],
    signature_dishes: [{ dish: "Rigatoni alla Vodka", why: "creamy, balanced" }],
    cuisine_subcategory: "Northern Italian",
    menu_depth: "extensive",
    spice_level: "mild",
    dietary_depth: "solid",
    service_style: "Full Table Service",
    meal_pacing: "leisurely",
    reservation_difficulty: "moderate",
    typical_wait_minutes: 15,
    group_size_sweet_spot: "[2,6)",
    check_average_per_person: 45,
    tipping_culture: "standard",
    kid_friendliness: 5,
    music_vibe: "curated-playlist",
    decor_style: "warm Italian, exposed brick",
    conversation_friendliness: 8,
    energy_level: 5,
    seating_options: ["booths", "bar", "outdoor patio"],
    instagram_worthiness: 7,
    seasonal_relevance: { spring: 7, summer: 8, fall: 9, winter: 8 },
    cultural_authenticity: 8,
    origin_story: "Family-run since 1995, recipes from Piedmont",
    crowd_profile: ["Couples", "Food-focused diners"],
    neighborhood_integration: "destination",
    chef_notable: true,
    awards_recognition: ["Best Pasta 2024"],
    wow_factors: ["Handmade pasta daily", "Wine cellar tours"],
    date_progression: "Pre-dinner cocktails at bar, intimate dinner",
    best_seat_in_house: "Corner booth by front window",
    ideal_weather: ["any"],
    unique_selling_point: "Third-generation pasta maker",
    transit_accessibility: "L Blue Line 2 blocks",
    byob_policy: "no_byob",
    payment_notes: "All cards accepted",
    enrichment_confidence: 9,
    ...overrides,
  };
}

function makeIntent(overrides: Partial<IntentClassificationV2> = {}): IntentClassificationV2 {
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

function makeGoogleData(overrides: Partial<GooglePlaceData> = {}): GooglePlaceData {
  return {
    name: "Test Restaurant",
    address: "123 Test St",
    phone: null,
    website: null,
    google_rating: 4.3,
    google_review_count: 200,
    reviews: [],
    business_status: "OPERATIONAL",
    photo_urls: [],
    opening_hours: null,
    ...overrides,
  };
}

function makeV5Inputs(overrides: Partial<V5DondeMatchInputs> = {}): V5DondeMatchInputs {
  return {
    occasion: "Any",
    specialRequest: "",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: null,
    intent: null,
    dietaryRestrictions: [],
    sentimentScore: null,
    sentimentNegative: null,
    userFeedback: null,
    rejectionSignals: undefined,
    candidatePoolSize: 15,
    clientTimeOfDay: null,
    ...overrides,
  };
}

// ==========================================
// Helper: Run scoring and print factor breakdown
// ==========================================

function printBreakdown(label: string, result: V5DondeMatchResult) {
  const f = result.factors;
  const w = result.weights;
  const gm = Math.pow(f.food, w.food) * Math.pow(f.vibe, w.vibe) *
    Math.pow(f.service, w.service) * Math.pow(f.reputation, w.reputation) *
    Math.pow(f.convenience, w.convenience);
  console.log(
    `    ${label}: DM=${result.dondeMatch} (${getTier(result.dondeMatch)}) | ` +
    `F=${f.food.toFixed(1)} V=${f.vibe.toFixed(1)} S=${f.service.toFixed(1)} ` +
    `R=${f.reputation.toFixed(1)} C=${f.convenience.toFixed(1)} | GM=${gm.toFixed(2)} | ` +
    `conf=[${result.confidence.food[0]}${result.confidence.vibe[0]}${result.confidence.service[0]}` +
    `${result.confidence.reputation[0]}${result.confidence.convenience[0]}] | ` +
    `data=${(result.dataCompleteness * 100).toFixed(0)}%`
  );
}

// ============================================================
// PART A: UNIT TESTS WITH MOCK DATA
// ============================================================

console.log("=== V5.1 Scoring Engine Tests (zero API cost) ===\n");

// -----------------------------------------------
section("A1. V5.1 Google Rating Stretch Formula");
// -----------------------------------------------
// Formula: clamp((rating - 3.5) / 1.5 * 10, 0, 10)
// Verified via reputation factorDetails.google.score

{
  const testCases: Array<[number, number, string]> = [
    [3.0, 0.0, "3.0★ → 0 (below floor)"],
    [3.5, 0.0, "3.5★ → 0 (range start)"],
    [4.0, 3.33, "4.0★ → 3.33"],
    [4.25, 5.0, "4.25★ → 5.0 (midpoint)"],
    [4.3, 5.33, "4.3★ → 5.33 (solid)"],
    [4.5, 6.67, "4.5★ → 6.67 (good)"],
    [4.7, 8.0, "4.7★ → 8.0 (great)"],
    [5.0, 10.0, "5.0★ → 10.0 (perfect)"],
  ];

  for (const [rating, expectedRaw, label] of testCases) {
    const profile = makeProfile({ deep_profile: makeDeepProfile() });
    const google = makeGoogleData({ google_rating: rating, google_review_count: 200 });
    const result: V5DondeMatchResult = computeV5DondeMatch(profile, makeV5Inputs({ googleData: google }));

    // The raw google score before review confidence gate.
    // With 200 reviews, confidence = 1.0, so googleScore = rawGoogleScore * 1.0
    const googleDetail = result.factorDetails?.reputation?.google;
    if (googleDetail) {
      assertApprox(googleDetail.score, expectedRaw, 0.1, `Google stretch: ${label}`);
    } else {
      assert(false, `Google stretch: ${label}`, "No google detail in factorDetails");
    }
  }
}

// -----------------------------------------------
section("A2. Adaptive Reputation Denominator");
// -----------------------------------------------

{
  // Base: 4.5★ = rawGoogleScore 6.67, with 200 reviews conf=1.0 → googleScore=6.67
  // Default sentiment = 1.0 (no data)
  // Raw numerator base = 6.67 * 0.65 + 1.0 = 5.335

  // A2.1: No awards, no community → denom = 8.5
  const p1 = makeProfile({ deep_profile: makeDeepProfile({ chef_notable: false, awards_recognition: [], cultural_authenticity: 3 }), trending_score: 3 });
  const r1: V5DondeMatchResult = computeV5DondeMatch(p1, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 200 }),
  }));
  // rep = min(10, 5.335 / 8.5 * 10) = 6.28
  // With high confidence (200 reviews), factor = 6.28
  assertRange(r1.factors.reputation, 5.5, 7.5, "A2.1: No awards/community → rep ~6.3 (denom=8.5)");
  printBreakdown("No awards/community", r1);

  // A2.2: Awards only → denom = 10.0
  const p2 = makeProfile({ deep_profile: makeDeepProfile({ chef_notable: true, awards_recognition: ["Best Pasta"], cultural_authenticity: 3 }), trending_score: 3 });
  const r2: V5DondeMatchResult = computeV5DondeMatch(p2, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 200 }),
  }));
  // awards = min(1.5, 0.75+0.75) = 1.5. raw = 5.335 + 1.5 = 6.835. rep = 6.835/10.0*10 = 6.835
  assertRange(r2.factors.reputation, 6.0, 8.0, "A2.2: Awards only → rep ~6.8 (denom=10.0)");
  printBreakdown("Awards only", r2);

  // A2.3: Community only → denom = 10.0
  const p3 = makeProfile({ deep_profile: makeDeepProfile({ chef_notable: false, awards_recognition: [], cultural_authenticity: 9 }), trending_score: 9 });
  const r3: V5DondeMatchResult = computeV5DondeMatch(p3, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 200 }),
  }));
  assertRange(r3.factors.reputation, 6.0, 8.0, "A2.3: Community only → rep ~6.8 (denom=10.0)");
  printBreakdown("Community only", r3);

  // A2.4: Both awards + community → denom = 11.5
  const p4 = makeProfile({ deep_profile: makeDeepProfile({ chef_notable: true, awards_recognition: ["Best Pasta"], cultural_authenticity: 9 }), trending_score: 9 });
  const r4: V5DondeMatchResult = computeV5DondeMatch(p4, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 200 }),
  }));
  assertRange(r4.factors.reputation, 6.0, 8.5, "A2.4: Both awards+community → rep (denom=11.5)");
  printBreakdown("Both awards+community", r4);

  // Key test: no awards/community should score HIGHER than full denom (not penalized)
  assert(
    r1.factors.reputation >= r4.factors.reputation - 1.0,
    "A2.5: No-awards rep not penalized vs full-data rep (within 1.0)",
    `no-awards=${r1.factors.reputation.toFixed(2)}, full=${r4.factors.reputation.toFixed(2)}`
  );
}

// -----------------------------------------------
section("A3. Convenience +1 Offset");
// -----------------------------------------------

{
  // A3.1: Basic profile, no timing bonuses → V3 base=4, V5=5
  const p1 = makeProfile({
    best_times: null,
    deep_profile: null,
  });
  const r1: V5DondeMatchResult = computeV5DondeMatch(p1, makeV5Inputs());
  // Convenience has "high" confidence → no regression. Factor = raw score.
  assertRange(r1.factors.convenience, 4.5, 6.0, "A3.1: No bonuses → convenience ~5.0 (base 4+1)");
  printBreakdown("No timing bonuses", r1);

  // A3.2: Same profile, with vs without timing match
  // clientTimeOfDay uses meal names: "breakfast", "lunch", "dinner", "late_night"
  const p2 = makeProfile({
    best_times: ["dinner"],
    deep_profile: null,
  });
  const r2NoTime: V5DondeMatchResult = computeV5DondeMatch(p2, makeV5Inputs({ clientTimeOfDay: null }));
  const r2WithTime: V5DondeMatchResult = computeV5DondeMatch(p2, makeV5Inputs({ clientTimeOfDay: "dinner" }));
  assert(
    r2WithTime.factors.convenience >= r2NoTime.factors.convenience,
    "A3.2: Evening time + dinner profile → convenience >= no-time",
    `withTime=${r2WithTime.factors.convenience.toFixed(2)}, noTime=${r2NoTime.factors.convenience.toFixed(2)}`
  );
  printBreakdown("Timing (with)", r2WithTime);
  printBreakdown("Timing (none)", r2NoTime);

  // A3.3: Verify convenience is capped at 10
  const p3 = makeProfile({
    best_times: ["dinner", "lunch", "brunch"],
    parking_availability: "Valet",
    deep_profile: makeDeepProfile({
      reservation_difficulty: "easy",
      typical_wait_minutes: 0,
      byob_policy: "byob_no_fee",
      transit_accessibility: "L stop adjacent",
    }),
  });
  const r3: V5DondeMatchResult = computeV5DondeMatch(p3, makeV5Inputs({
    clientTimeOfDay: "evening",
    specialRequest: "byob",
  }));
  assert(
    r3.factors.convenience <= 10.0,
    "A3.3: Convenience capped at 10.0",
    `got ${r3.factors.convenience}`
  );
  printBreakdown("Max convenience", r3);
}

// -----------------------------------------------
section("A4. Vibe Cold-Start Override");
// -----------------------------------------------

{
  // A4.1: Zero ambiance data → atmosphere dataPoints=0 → score overridden to 5.5
  const pCold = makeProfile({
    noise_level: null,
    lighting_ambiance: null,
    dress_code: null,
    ambiance: null,
    live_music: null,
    outdoor_seating: null,
    deep_profile: null,
  });
  const rCold: V5DondeMatchResult = computeV5DondeMatch(pCold, makeV5Inputs());
  // Vibe confidence = "low" with no data. Regression: 5.5 * 0.5 + 5.5 * 0.5 = 5.5
  assertRange(rCold.factors.vibe, 5.0, 6.0, "A4.1: Cold-start vibe → 5.5 (neutral, not 4.0)");
  printBreakdown("Cold-start vibe", rCold);

  // A4.2: With ambiance data → different from 5.5
  const pRich = makeProfile({
    noise_level: "Moderate",
    lighting_ambiance: "warm, cozy, romantic",
    dress_code: "Smart Casual",
    ambiance: ["Romantic", "Intimate", "Cozy"],
    deep_profile: makeDeepProfile({
      energy_level: 4,
      music_vibe: "jazz",
      conversation_friendliness: 9,
      decor_style: "warm, candlelit, exposed brick",
    }),
  });
  const rRich: V5DondeMatchResult = computeV5DondeMatch(pRich, makeV5Inputs({
    occasion: "Date Night",
    intent: makeIntent({ vibe_keywords: ["romantic", "cozy"], emotional_intent: "impress" }),
  }));
  assert(
    rRich.factors.vibe !== 5.5,
    "A4.2: Rich vibe data → score differs from cold-start 5.5",
    `got ${rRich.factors.vibe.toFixed(2)}`
  );
  printBreakdown("Rich vibe data", rRich);
}

// -----------------------------------------------
section("A5. GM × 12 Formula Verification");
// -----------------------------------------------

{
  // For any result, verify: DM = min(99, max(0, round(GM * 12)))
  // where GM = product(factor_i ^ weight_i)
  const profiles = [
    makeProfile({ deep_profile: makeDeepProfile() }),
    makeProfile({ cuisine_type: "Japanese", deep_profile: makeDeepProfile({ cuisine_subcategory: "Sushi" }) }),
    makeProfile({ deep_profile: null }),
  ];

  const inputs = [
    makeV5Inputs({ googleData: makeGoogleData({ google_rating: 4.3 }) }),
    makeV5Inputs({ googleData: makeGoogleData({ google_rating: 4.7 }), intent: makeIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high" }) }),
    makeV5Inputs(),
  ];

  for (let i = 0; i < profiles.length; i++) {
    const result: V5DondeMatchResult = computeV5DondeMatch(profiles[i], inputs[i]);
    const f = result.factors;
    const w = result.weights;
    const gm = Math.pow(f.food, w.food) * Math.pow(f.vibe, w.vibe) *
      Math.pow(f.service, w.service) * Math.pow(f.reputation, w.reputation) *
      Math.pow(f.convenience, w.convenience);
    const expectedDM = Math.min(99, Math.max(0, Math.round(gm * 12)));
    assert(
      result.dondeMatch === expectedDM,
      `A5.${i + 1}: DM = round(GM * 12) consistency check`,
      `DM=${result.dondeMatch}, expected=${expectedDM}, GM=${gm.toFixed(4)}`
    );
  }
}

// -----------------------------------------------
section("A6. Confidence Regression");
// -----------------------------------------------

{
  // Test reputation confidence levels via google_review_count
  // High: >=200, Medium: >=10, Low: <10

  // Same profile, different review counts → different reputation factors
  const profile = makeProfile({ deep_profile: makeDeepProfile() });

  const rHigh: V5DondeMatchResult = computeV5DondeMatch(profile, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 300 }),
  }));
  const rMed: V5DondeMatchResult = computeV5DondeMatch(profile, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 50 }),
  }));
  const rLow: V5DondeMatchResult = computeV5DondeMatch(profile, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 5 }),
  }));

  assert(
    rHigh.confidence.reputation === "high",
    "A6.1: 300 reviews → high confidence",
    `got ${rHigh.confidence.reputation}`
  );
  assert(
    rMed.confidence.reputation === "medium",
    "A6.2: 50 reviews → medium confidence",
    `got ${rMed.confidence.reputation}`
  );
  assert(
    rLow.confidence.reputation === "low",
    "A6.3: 5 reviews → low confidence",
    `got ${rLow.confidence.reputation}`
  );

  // With confidence regression, high > medium > low in factor values
  // (assuming raw rep > 5.5, regression pulls toward 5.5)
  // Actually, high confidence preserves raw, medium blends toward 5.5, low blends more
  // If raw > 5.5, then high > medium > low
  // If raw < 5.5, then high < medium < low (regression pulls UP toward 5.5)
  // For 4.5★, raw rep should be > 5.5, so order should be high > medium > low
  const rawRep = rHigh.factors.reputation; // high conf = raw score
  if (rawRep > 5.5) {
    assert(
      rHigh.factors.reputation > rMed.factors.reputation,
      "A6.4: High conf rep > Medium conf rep (raw > 5.5)",
      `high=${rHigh.factors.reputation.toFixed(2)}, med=${rMed.factors.reputation.toFixed(2)}`
    );
    assert(
      rMed.factors.reputation > rLow.factors.reputation,
      "A6.5: Medium conf rep > Low conf rep (raw > 5.5)",
      `med=${rMed.factors.reputation.toFixed(2)}, low=${rLow.factors.reputation.toFixed(2)}`
    );
  } else {
    // raw <= 5.5, regression pulls up
    assert(
      rHigh.factors.reputation <= rMed.factors.reputation,
      "A6.4: High conf rep <= Medium conf rep (raw <= 5.5, regression pulls up)",
      `high=${rHigh.factors.reputation.toFixed(2)}, med=${rMed.factors.reputation.toFixed(2)}`
    );
  }
}

// -----------------------------------------------
section("A7. Factor Floor (minimum 1.0)");
// -----------------------------------------------

{
  // Create worst-case profile: no match on anything
  const pWorst = makeProfile({
    cuisine_type: "Ethiopian",
    deep_profile: null,
    noise_level: null,
    lighting_ambiance: null,
    dress_code: null,
    ambiance: null,
    good_for: null,
    tags: [],
    tag_categories: [],
    date_friendly_score: 0,
    group_friendly_score: 0,
    family_friendly_score: 0,
    romantic_rating: 0,
    business_lunch_score: 0,
    solo_dining_score: 0,
    hole_in_wall_factor: 0,
    trending_score: null,
    best_times: null,
    dietary_options: null,
  });

  const rWorst: V5DondeMatchResult = computeV5DondeMatch(pWorst, makeV5Inputs({
    intent: makeIntent({
      target_cuisines: ["French"],
      cuisine_importance: "high",
      vibe_keywords: ["upscale", "elegant"],
      emotional_intent: "impress",
    }),
    googleData: makeGoogleData({ google_rating: 3.2, google_review_count: 3 }),
  }));

  const factors = rWorst.factors;
  assert(factors.food >= 1.0, "A7.1: Factor floor — food >= 1.0", `got ${factors.food}`);
  assert(factors.vibe >= 1.0, "A7.2: Factor floor — vibe >= 1.0", `got ${factors.vibe}`);
  assert(factors.service >= 1.0, "A7.3: Factor floor — service >= 1.0", `got ${factors.service}`);
  assert(factors.reputation >= 1.0, "A7.4: Factor floor — reputation >= 1.0", `got ${factors.reputation}`);
  assert(factors.convenience >= 1.0, "A7.5: Factor floor — convenience >= 1.0", `got ${factors.convenience}`);
  assert(rWorst.dondeMatch > 0, "A7.6: DM > 0 even for worst case", `got ${rWorst.dondeMatch}`);
  printBreakdown("Worst case", rWorst);
}

// -----------------------------------------------
section("A8. Weight Shift Verification");
// -----------------------------------------------

{
  const base = V5_BASE_WEIGHTS;

  // A8.1: Date Night → vibe up, convenience down
  const wDate = computeV5Weights("Date Night", makeIntent({ emotional_intent: "casual" }),
    { food: "high", vibe: "high", service: "high", reputation: "high", convenience: "high" }, 15, null);
  assert(
    wDate.weights.vibe > base.vibe,
    "A8.1: Date Night → vibe weight increases",
    `base=${base.vibe}, date=${wDate.weights.vibe.toFixed(3)}`
  );

  // A8.2: High cuisine importance → food up
  const wCuisine = computeV5Weights("Any", makeIntent({ cuisine_importance: "high", target_cuisines: ["Italian"] }),
    { food: "high", vibe: "high", service: "high", reputation: "high", convenience: "high" }, 15, null);
  assert(
    wCuisine.weights.food > base.food,
    "A8.2: High cuisine importance → food weight increases",
    `base=${base.food}, cuisine=${wCuisine.weights.food.toFixed(3)}`
  );

  // A8.3: Business Lunch → service up
  const wBiz = computeV5Weights("Business Lunch", makeIntent({ emotional_intent: "impress" }),
    { food: "high", vibe: "high", service: "high", reputation: "high", convenience: "high" }, 15, null);
  assert(
    wBiz.weights.service > base.service,
    "A8.3: Business Lunch → service weight increases",
    `base=${base.service}, biz=${wBiz.weights.service.toFixed(3)}`
  );

  // A8.4: All weights sum to 1.0
  for (const [label, w] of [
    ["Date Night", wDate.weights],
    ["High cuisine", wCuisine.weights],
    ["Business Lunch", wBiz.weights],
  ] as [string, any][]) {
    const sum = w.food + w.vibe + w.service + w.reputation + w.convenience;
    assertApprox(sum, 1.0, 0.001, `A8.4: ${label} weights sum to 1.0`);
  }
}

// -----------------------------------------------
section("A9. Full Pipeline Scenarios");
// -----------------------------------------------

{
  // Scenario 1: "brunch place" + matching brunch restaurant + 4.3★
  const brunchProfile = makeProfile({
    cuisine_type: "Brunch",
    best_for_oneliner: "Chicago's coziest brunch with locally sourced ingredients",
    best_times: ["brunch", "lunch"],
    good_for: ["Groups", "Dates", "Brunch"],
    ambiance: ["Bright", "Lively", "Casual"],
    noise_level: "Moderate",
    lighting_ambiance: "bright, airy, natural light",
    dress_code: "Casual",
    date_friendly_score: 7,
    group_friendly_score: 7,
    family_friendly_score: 7,
    romantic_rating: 5,
    business_lunch_score: 5,
    solo_dining_score: 6,
    tags: ["brunch spot", "locally sourced", "outdoor patio"],
    tag_categories: ["meal_type", "sourcing", "feature"],
    deep_profile: makeDeepProfile({
      service_style: "Full Table Service",
      meal_pacing: "relaxed",
      energy_level: 6,
      music_vibe: "curated-playlist",
      enrichment_confidence: 8,
      cultural_authenticity: 6,
      chef_notable: false,
      awards_recognition: [],
    }),
  });
  const r1: V5DondeMatchResult = computeV5DondeMatch(brunchProfile, makeV5Inputs({
    occasion: "Any",
    specialRequest: "brunch place",
    googleData: makeGoogleData({ google_rating: 4.3, google_review_count: 150 }),
    intent: makeIntent({
      target_cuisines: ["Brunch"],
      target_tags: ["brunch spot"],
      cuisine_importance: "high",
      emotional_intent: "casual",
    }),
  }));
  assertRange(r1.dondeMatch, 62, 85, `A9.1: "brunch place" + 4.3★ → ${r1.dondeMatch} (${getTier(r1.dondeMatch)})`);
  printBreakdown("Brunch place", r1);

  // Scenario 2: "best sushi" + matching sushi restaurant + 4.7★
  const sushiProfile = makeProfile({
    cuisine_type: "Japanese",
    best_for_oneliner: "Omakase sushi from a former Nobu chef",
    best_times: ["dinner"],
    good_for: ["Dates", "Special Occasion"],
    ambiance: ["Intimate", "Zen"],
    noise_level: "Quiet",
    lighting_ambiance: "dim, warm, focused",
    dress_code: "Smart Casual",
    date_friendly_score: 9,
    group_friendly_score: 4,
    family_friendly_score: 3,
    romantic_rating: 8,
    business_lunch_score: 6,
    solo_dining_score: 7,
    tags: ["omakase", "fresh fish", "intimate setting", "sushi"],
    tag_categories: ["specialty", "ingredient", "ambiance", "cuisine"],
    deep_profile: makeDeepProfile({
      cuisine_subcategory: "Sushi/Omakase",
      signature_dishes: [{ dish: "Chef's Omakase", why: "12-course seasonal selection" }],
      flavor_profiles: ["delicate", "umami", "clean"],
      service_style: "Counter Service",
      meal_pacing: "chef-paced",
      energy_level: 3,
      music_vibe: "ambient",
      enrichment_confidence: 9,
      cultural_authenticity: 9,
      chef_notable: true,
      awards_recognition: ["Michelin Bib Gourmand"],
    }),
  });
  const r2: V5DondeMatchResult = computeV5DondeMatch(sushiProfile, makeV5Inputs({
    occasion: "Any",
    specialRequest: "best sushi",
    googleData: makeGoogleData({ google_rating: 4.7, google_review_count: 500 }),
    intent: makeIntent({
      target_cuisines: ["Japanese", "Sushi"],
      target_tags: ["sushi", "omakase"],
      cuisine_importance: "high",
      emotional_intent: "explore",
    }),
  }));
  assertRange(r2.dondeMatch, 75, 96, `A9.2: "best sushi" + 4.7★ → ${r2.dondeMatch} (${getTier(r2.dondeMatch)})`);
  printBreakdown("Best sushi", r2);

  // Scenario 3: "date night" + romantic restaurant + 4.5★
  const dateProfile = makeProfile({
    cuisine_type: "Italian",
    ambiance: ["Romantic", "Intimate", "Candlelit"],
    noise_level: "Quiet",
    lighting_ambiance: "dim, romantic, warm candlelight",
    dress_code: "Smart Casual",
    date_friendly_score: 9,
    romantic_rating: 9,
    group_friendly_score: 4,
    family_friendly_score: 3,
    tags: ["romantic", "candlelit", "wine list", "intimate"],
    tag_categories: ["ambiance", "ambiance", "drinks", "ambiance"],
    deep_profile: makeDeepProfile({
      energy_level: 3,
      conversation_friendliness: 9,
      music_vibe: "jazz",
      decor_style: "warm, candlelit, exposed brick",
      date_progression: "Cocktails at bar, intimate dinner, dessert wine",
      enrichment_confidence: 8,
    }),
  });
  const r3: V5DondeMatchResult = computeV5DondeMatch(dateProfile, makeV5Inputs({
    occasion: "Date Night",
    specialRequest: "romantic dinner",
    googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 300 }),
    intent: makeIntent({
      vibe_keywords: ["romantic", "intimate", "cozy"],
      emotional_intent: "impress",
      date_type: "established",
    }),
  }));
  assertRange(r3.dondeMatch, 70, 90, `A9.3: "date night" + 4.5★ → ${r3.dondeMatch} (${getTier(r3.dondeMatch)})`);
  printBreakdown("Date night", r3);

  // Scenario 4: "business lunch" + formal restaurant + 4.4★
  const bizProfile = makeProfile({
    cuisine_type: "American",
    ambiance: ["Professional", "Upscale"],
    noise_level: "Moderate",
    lighting_ambiance: "bright, professional",
    dress_code: "Business Casual",
    business_lunch_score: 9,
    date_friendly_score: 6,
    group_friendly_score: 7,
    tags: ["business lunch", "private dining", "wine list"],
    tag_categories: ["occasion", "feature", "drinks"],
    deep_profile: makeDeepProfile({
      service_style: "Full Table Service",
      meal_pacing: "moderate",
      reservation_difficulty: "easy",
      enrichment_confidence: 7,
    }),
  });
  const r4: V5DondeMatchResult = computeV5DondeMatch(bizProfile, makeV5Inputs({
    occasion: "Business Lunch",
    specialRequest: "business lunch",
    googleData: makeGoogleData({ google_rating: 4.4, google_review_count: 200 }),
    intent: makeIntent({
      emotional_intent: "impress",
      practical_constraints: ["quiet"],
    }),
  }));
  assertRange(r4.dondeMatch, 65, 85, `A9.4: "business lunch" + 4.4★ → ${r4.dondeMatch} (${getTier(r4.dondeMatch)})`);
  printBreakdown("Business lunch", r4);

  // Scenario 5: Cuisine mismatch + low data
  const mismatchProfile = makeProfile({
    cuisine_type: "Thai",
    deep_profile: null,
    ambiance: null,
    noise_level: null,
    tags: ["thai", "spicy"],
    tag_categories: ["cuisine", "flavor"],
    date_friendly_score: 5,
    group_friendly_score: 5,
    family_friendly_score: 5,
  });
  const r5: V5DondeMatchResult = computeV5DondeMatch(mismatchProfile, makeV5Inputs({
    occasion: "Any",
    specialRequest: "best italian pasta",
    googleData: makeGoogleData({ google_rating: 4.0, google_review_count: 80 }),
    intent: makeIntent({
      target_cuisines: ["Italian"],
      cuisine_importance: "high",
      flavor_preferences: ["rich", "creamy"],
    }),
  }));
  assertRange(r5.dondeMatch, 35, 62, `A9.5: Cuisine mismatch → ${r5.dondeMatch} (${getTier(r5.dondeMatch)})`);
  printBreakdown("Cuisine mismatch", r5);

  // Scenario 6: Cold start — no deep profile, no google data
  const coldProfile = makeProfile({
    deep_profile: null,
    noise_level: null,
    lighting_ambiance: null,
    dress_code: null,
    ambiance: null,
    good_for: null,
    tags: [],
    tag_categories: [],
    date_friendly_score: 5,
    group_friendly_score: 5,
    family_friendly_score: 5,
    romantic_rating: 5,
    business_lunch_score: 5,
    solo_dining_score: 5,
  });
  const r6: V5DondeMatchResult = computeV5DondeMatch(coldProfile, makeV5Inputs({
    occasion: "Any",
    specialRequest: "something to eat",
    intent: null,
    googleData: null,
  }));
  assertRange(r6.dondeMatch, 48, 72, `A9.6: Cold start → ${r6.dondeMatch} (${getTier(r6.dondeMatch)})`);
  printBreakdown("Cold start", r6);

  // Scenario 7: Perfect match — rich data + 4.8★
  const perfectProfile = makeProfile({
    cuisine_type: "Italian",
    ambiance: ["Romantic", "Cozy", "Intimate"],
    noise_level: "Quiet",
    lighting_ambiance: "dim, warm, candlelit",
    dress_code: "Smart Casual",
    date_friendly_score: 9,
    romantic_rating: 9,
    group_friendly_score: 7,
    family_friendly_score: 6,
    business_lunch_score: 7,
    solo_dining_score: 6,
    hole_in_wall_factor: 4,
    tags: ["romantic", "farm-to-table", "craft cocktails", "italian", "pasta", "wine list"],
    tag_categories: ["ambiance", "sourcing", "drinks", "cuisine", "food", "drinks"],
    trending_score: 9,
    deep_profile: makeDeepProfile({
      enrichment_confidence: 9,
      cultural_authenticity: 9,
      chef_notable: true,
      awards_recognition: ["James Beard Nominee", "Best Pasta 2024"],
      energy_level: 4,
      conversation_friendliness: 9,
    }),
  });
  const r7: V5DondeMatchResult = computeV5DondeMatch(perfectProfile, makeV5Inputs({
    occasion: "Date Night",
    specialRequest: "best italian for a special date",
    googleData: makeGoogleData({ google_rating: 4.8, google_review_count: 1000 }),
    sentimentScore: 9,
    intent: makeIntent({
      target_cuisines: ["Italian"],
      target_tags: ["romantic", "pasta"],
      cuisine_importance: "high",
      emotional_intent: "impress",
      vibe_keywords: ["romantic", "intimate"],
      date_type: "special",
    }),
  }));
  assertRange(r7.dondeMatch, 82, 99, `A9.7: Perfect match + 4.8★ → ${r7.dondeMatch} (${getTier(r7.dondeMatch)})`);
  printBreakdown("Perfect match", r7);

  // Scenario 8: Phase 1 reRank (no Google data) — good profile
  const r8: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ deep_profile: makeDeepProfile({ enrichment_confidence: 7 }) }),
    makeV5Inputs({
      occasion: "Any",
      specialRequest: "good restaurant",
      googleData: null,
      intent: makeIntent({ emotional_intent: "casual" }),
    }),
  );
  assertRange(r8.dondeMatch, 52, 75, `A9.8: Phase 1 reRank (no Google) → ${r8.dondeMatch} (${getTier(r8.dondeMatch)})`);
  printBreakdown("Phase 1 reRank", r8);

  // Scenario 9: Low-rated restaurant + cuisine mismatch
  const r9: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ cuisine_type: "Pizza", deep_profile: null, ambiance: null, noise_level: null }),
    makeV5Inputs({
      specialRequest: "fine french dining",
      googleData: makeGoogleData({ google_rating: 3.8, google_review_count: 30 }),
      intent: makeIntent({ target_cuisines: ["French"], cuisine_importance: "high", emotional_intent: "impress" }),
    }),
  );
  assertRange(r9.dondeMatch, 30, 58, `A9.9: Low-rated mismatch → ${r9.dondeMatch} (${getTier(r9.dondeMatch)})`);
  printBreakdown("Low-rated mismatch", r9);

  // Scenario 10: "cheap eats" + casual Mexican + 4.0★
  const cheapProfile = makeProfile({
    cuisine_type: "Mexican",
    price_level: "$",
    ambiance: ["Casual", "Fun"],
    noise_level: "Lively",
    good_for: ["Quick Bite", "Groups"],
    tags: ["tacos", "casual", "quick bite", "margaritas"],
    tag_categories: ["food", "ambiance", "meal_type", "drinks"],
    deep_profile: makeDeepProfile({
      service_style: "Counter Service",
      meal_pacing: "quick",
      enrichment_confidence: 6,
      chef_notable: false,
      awards_recognition: [],
    }),
  });
  const r10: V5DondeMatchResult = computeV5DondeMatch(cheapProfile, makeV5Inputs({
    occasion: "Any",
    specialRequest: "cheap tacos",
    googleData: makeGoogleData({ google_rating: 4.0, google_review_count: 120 }),
    intent: makeIntent({
      target_cuisines: ["Mexican"],
      target_tags: ["tacos"],
      cuisine_importance: "high",
      emotional_intent: "casual",
      spontaneity: "spontaneous",
    }),
  }));
  assertRange(r10.dondeMatch, 55, 78, `A9.10: "cheap tacos" + 4.0★ → ${r10.dondeMatch} (${getTier(r10.dondeMatch)})`);
  printBreakdown("Cheap tacos", r10);

  // Summary table
  console.log("\n  --- Full Pipeline Summary ---");
  console.log("  | # | Scenario                  | DM  | Tier           | Food | Vibe | Svc  | Rep  | Conv |");
  console.log("  |---|---------------------------|-----|----------------|------|------|------|------|------|");
  const scenarios = [
    ["1", "Brunch place (4.3★)", r1],
    ["2", "Best sushi (4.7★)", r2],
    ["3", "Date night (4.5★)", r3],
    ["4", "Business lunch (4.4★)", r4],
    ["5", "Cuisine mismatch (4.0★)", r5],
    ["6", "Cold start (no data)", r6],
    ["7", "Perfect match (4.8★)", r7],
    ["8", "Phase 1 no Google", r8],
    ["9", "Low-rated mismatch (3.8★)", r9],
    ["10", "Cheap tacos (4.0★)", r10],
  ] as [string, string, V5DondeMatchResult][];

  for (const [num, label, r] of scenarios) {
    const f = r.factors;
    console.log(
      `  | ${num.padStart(2)}| ${label.padEnd(26)}| ${String(r.dondeMatch).padStart(3)} | ${getTier(r.dondeMatch).padEnd(14)} | ${f.food.toFixed(1).padStart(4)} | ${f.vibe.toFixed(1).padStart(4)} | ${f.service.toFixed(1).padStart(4)} | ${f.reputation.toFixed(1).padStart(4)} | ${f.convenience.toFixed(1).padStart(4)} |`
    );
  }
}

// ============================================================
// PART B: INTEGRATION TESTS WITH SUPABASE DATA
// ============================================================

section("B. Supabase Integration Tests");

async function runPartB() {
  // Load .env manually
  const envPath = join(PROJECT_ROOT, ".env");
  try {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      process.env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
  } catch {
    warn("B0: Could not load .env file — skipping Supabase tests");
    return;
  }

  const url = process.env.SUPAB_URL;
  const key = process.env.SUPAB_SERVICE_ROLE_KEY;
  if (!url || !key) {
    warn("B0: Missing SUPAB_URL or SUPAB_SERVICE_ROLE_KEY — skipping Supabase tests");
    return;
  }

  // Dynamic import to avoid bundling issues
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key);

  // Fetch restaurants + related data from separate tables
  console.log("\n  Fetching restaurant data from Supabase...");

  const [restResult, scoresResult, tagsResult, deepResult, neighborhoodsResult] = await Promise.all([
    supabase.from("restaurants").select("*").eq("is_active", true).limit(25),
    supabase.from("occasion_scores").select("*"),
    supabase.from("tags").select("*"),
    supabase.from("restaurant_deep_profiles").select("*"),
    supabase.from("neighborhoods").select("*"),
  ]);

  if (restResult.error || !restResult.data || restResult.data.length === 0) {
    warn("B0: Supabase restaurant query failed — skipping", restResult.error ? JSON.stringify(restResult.error) : "empty");
    return;
  }

  const rawRestaurants = restResult.data;
  const allScores = scoresResult.data || [];
  const allTags = (tagsResult.data || []).filter((t: any) => t.tag_text && t.tag_text !== "null");
  const allDeep = deepResult.data || [];
  const allNeighborhoods = neighborhoodsResult.data || [];

  console.log(`  Fetched ${rawRestaurants.length} restaurants, ${allScores.length} scores, ${allTags.length} tags, ${allDeep.length} deep profiles.\n`);

  // Build lookup maps
  const scoresMap: Record<string, any> = {};
  for (const s of allScores) scoresMap[s.restaurant_id] = s;

  const tagsMap: Record<string, any[]> = {};
  for (const t of allTags) {
    if (!tagsMap[t.restaurant_id]) tagsMap[t.restaurant_id] = [];
    tagsMap[t.restaurant_id].push(t);
  }

  const deepMap: Record<string, any> = {};
  for (const d of allDeep) deepMap[d.restaurant_id] = d;

  const neighborhoodMap: Record<string, any> = {};
  for (const n of allNeighborhoods) neighborhoodMap[n.id] = n;

  // Transform to RestaurantProfile
  const profiles: RestaurantProfile[] = rawRestaurants.map((r: any) => {
    const scores = scoresMap[r.id];
    const dp = deepMap[r.id];
    const nbhood = neighborhoodMap[r.neighborhood_id];
    const tags = tagsMap[r.id] || [];

    const deep_profile: DeepProfile | null = dp ? {
      flavor_profiles: dp.flavor_profiles || null,
      signature_dishes: dp.signature_dishes || null,
      cuisine_subcategory: dp.cuisine_subcategory || null,
      menu_depth: dp.menu_depth || null,
      spice_level: dp.spice_level || null,
      dietary_depth: dp.dietary_depth || null,
      service_style: dp.service_style || null,
      meal_pacing: dp.meal_pacing || null,
      reservation_difficulty: dp.reservation_difficulty || null,
      typical_wait_minutes: dp.typical_wait_minutes || null,
      group_size_sweet_spot: dp.group_size_sweet_spot || null,
      check_average_per_person: dp.check_average_per_person || null,
      tipping_culture: dp.tipping_culture || null,
      kid_friendliness: dp.kid_friendliness ?? null,
      music_vibe: dp.music_vibe || null,
      decor_style: dp.decor_style || null,
      conversation_friendliness: dp.conversation_friendliness ?? null,
      energy_level: dp.energy_level ?? null,
      seating_options: dp.seating_options || null,
      instagram_worthiness: dp.instagram_worthiness ?? null,
      seasonal_relevance: dp.seasonal_relevance || null,
      cultural_authenticity: dp.cultural_authenticity ?? null,
      origin_story: dp.origin_story || null,
      crowd_profile: dp.crowd_profile || null,
      neighborhood_integration: dp.neighborhood_integration || null,
      chef_notable: dp.chef_notable ?? null,
      awards_recognition: dp.awards_recognition || null,
      wow_factors: dp.wow_factors || null,
      date_progression: dp.date_progression || null,
      best_seat_in_house: dp.best_seat_in_house || null,
      ideal_weather: dp.ideal_weather || null,
      unique_selling_point: dp.unique_selling_point || null,
      transit_accessibility: dp.transit_accessibility || null,
      byob_policy: dp.byob_policy || null,
      payment_notes: dp.payment_notes || null,
      enrichment_confidence: dp.enrichment_confidence ?? null,
    } : null;

    return {
      id: r.id,
      name: r.name,
      address: r.address,
      neighborhood_id: r.neighborhood_id || null,
      google_place_id: r.google_place_id || null,
      price_level: r.price_level || null,
      noise_level: r.noise_level || null,
      lighting_ambiance: r.lighting_ambiance || null,
      dress_code: r.dress_code || null,
      outdoor_seating: r.outdoor_seating ?? null,
      live_music: r.live_music ?? null,
      pet_friendly: r.pet_friendly ?? null,
      parking_availability: r.parking_availability || null,
      cuisine_type: r.cuisine_type || null,
      best_for_oneliner: r.best_for_oneliner || null,
      insider_tip: r.insider_tip || null,
      best_times: r.best_times || null,
      dietary_options: r.dietary_options || null,
      good_for: r.good_for || null,
      ambiance: r.ambiance || null,
      is_active: r.is_active ?? null,
      neighborhood_name: nbhood?.name || "Unknown",
      neighborhood_description: nbhood?.description || null,
      date_friendly_score: scores?.date_friendly_score ?? null,
      group_friendly_score: scores?.group_friendly_score ?? null,
      family_friendly_score: scores?.family_friendly_score ?? null,
      romantic_rating: scores?.romantic_rating ?? null,
      business_lunch_score: scores?.business_lunch_score ?? null,
      solo_dining_score: scores?.solo_dining_score ?? null,
      hole_in_wall_factor: scores?.hole_in_wall_factor ?? null,
      tags: tags.map((t: any) => t.tag_text),
      tag_categories: tags.map((t: any) => t.tag_category).filter(Boolean),
      occasion_score: null,
      total_score: (scores?.date_friendly_score ?? 0) + (scores?.group_friendly_score ?? 0) +
        (scores?.family_friendly_score ?? 0) + (scores?.romantic_rating ?? 0) +
        (scores?.business_lunch_score ?? 0) + (scores?.solo_dining_score ?? 0) +
        (scores?.hole_in_wall_factor ?? 0),
      trending_score: null,
      deep_profile,
    } as RestaurantProfile;
  });

  // -----------------------------------------------
  console.log("--- B1: Score all restaurants with generic prompt (no Google) ---");
  // -----------------------------------------------

  const genericResults: Array<{ name: string; cuisine: string; dm: number; tier: string; factors: V5DondeMatchResult["factors"] }> = [];

  for (const p of profiles) {
    const result: V5DondeMatchResult = computeV5DondeMatch(p, makeV5Inputs({
      occasion: "Any",
      specialRequest: "good dinner",
      intent: makeIntent({ emotional_intent: "casual" }),
    }));
    genericResults.push({
      name: p.name,
      cuisine: p.cuisine_type || "Unknown",
      dm: result.dondeMatch,
      tier: getTier(result.dondeMatch),
      factors: result.factors,
    });
  }

  // Sort by DM descending
  genericResults.sort((a, b) => b.dm - a.dm);

  const allInRange = genericResults.every(r => r.dm >= 30 && r.dm <= 90);
  assert(allInRange, "B1.1: All Phase 1 DM scores in [30, 90] range (no Google data)");

  const noneBelow20 = genericResults.every(r => r.dm >= 20);
  assert(noneBelow20, "B1.2: No DM scores below 20 (floor check)");

  // Print table
  console.log("\n  | # | Restaurant                    | Cuisine     | DM  | Tier           | Food | Vibe | Svc  | Rep  | Conv |");
  console.log("  |---|-------------------------------|-------------|-----|----------------|------|------|------|------|------|");
  genericResults.forEach((r, i) => {
    const f = r.factors;
    console.log(
      `  | ${String(i + 1).padStart(2)}| ${r.name.slice(0, 29).padEnd(30)}| ${r.cuisine.slice(0, 11).padEnd(12)}| ${String(r.dm).padStart(3)} | ${r.tier.padEnd(14)} | ${f.food.toFixed(1).padStart(4)} | ${f.vibe.toFixed(1).padStart(4)} | ${f.service.toFixed(1).padStart(4)} | ${f.reputation.toFixed(1).padStart(4)} | ${f.convenience.toFixed(1).padStart(4)} |`
    );
  });

  // -----------------------------------------------
  console.log("\n--- B2: Score with simulated Google data (4.3★) ---");
  // -----------------------------------------------

  const withGoogleResults: typeof genericResults = [];
  const mockGoogle = makeGoogleData({ google_rating: 4.3, google_review_count: 200 });

  for (const p of profiles) {
    const result: V5DondeMatchResult = computeV5DondeMatch(p, makeV5Inputs({
      occasion: "Any",
      specialRequest: "good dinner",
      googleData: mockGoogle,
      intent: makeIntent({ emotional_intent: "casual" }),
    }));
    withGoogleResults.push({
      name: p.name,
      cuisine: p.cuisine_type || "Unknown",
      dm: result.dondeMatch,
      tier: getTier(result.dondeMatch),
      factors: result.factors,
    });
  }

  withGoogleResults.sort((a, b) => b.dm - a.dm);

  console.log("\n  | # | Restaurant                    | Cuisine     | DM  | Tier           | Food | Vibe | Svc  | Rep  | Conv |");
  console.log("  |---|-------------------------------|-------------|-----|----------------|------|------|------|------|------|");
  withGoogleResults.forEach((r, i) => {
    const f = r.factors;
    console.log(
      `  | ${String(i + 1).padStart(2)}| ${r.name.slice(0, 29).padEnd(30)}| ${r.cuisine.slice(0, 11).padEnd(12)}| ${String(r.dm).padStart(3)} | ${r.tier.padEnd(14)} | ${f.food.toFixed(1).padStart(4)} | ${f.vibe.toFixed(1).padStart(4)} | ${f.service.toFixed(1).padStart(4)} | ${f.reputation.toFixed(1).padStart(4)} | ${f.convenience.toFixed(1).padStart(4)} |`
    );
  });

  // -----------------------------------------------
  console.log("\n--- B3: Google rating monotonicity test ---");
  // -----------------------------------------------

  if (profiles.length > 0) {
    const testProfile = profiles[0];
    const ratings = [3.5, 4.0, 4.3, 4.5, 4.7, 5.0];
    const dmByRating: number[] = [];

    for (const rating of ratings) {
      const result: V5DondeMatchResult = computeV5DondeMatch(testProfile, makeV5Inputs({
        googleData: makeGoogleData({ google_rating: rating, google_review_count: 200 }),
        intent: makeIntent({ emotional_intent: "casual" }),
      }));
      dmByRating.push(result.dondeMatch);
    }

    let monotonic = true;
    for (let i = 1; i < dmByRating.length; i++) {
      if (dmByRating[i] < dmByRating[i - 1]) monotonic = false;
    }
    assert(monotonic, "B3.1: DM increases monotonically with Google rating",
      ratings.map((r, i) => `${r}★=${dmByRating[i]}`).join(", "));
  }

  // -----------------------------------------------
  console.log("\n--- B4: Cuisine matching vs mismatch test ---");
  // -----------------------------------------------

  let matchWins = 0;
  let matchTests = 0;

  for (const p of profiles.slice(0, 15)) {
    if (!p.cuisine_type) continue;
    matchTests++;

    // Matching intent
    const matchResult: V5DondeMatchResult = computeV5DondeMatch(p, makeV5Inputs({
      googleData: mockGoogle,
      intent: makeIntent({
        target_cuisines: [p.cuisine_type],
        cuisine_importance: "high",
      }),
    }));

    // Mismatching intent
    const mismatchCuisine = p.cuisine_type === "Italian" ? "Japanese" : "Italian";
    const mismatchResult: V5DondeMatchResult = computeV5DondeMatch(p, makeV5Inputs({
      googleData: mockGoogle,
      intent: makeIntent({
        target_cuisines: [mismatchCuisine],
        cuisine_importance: "high",
      }),
    }));

    if (matchResult.dondeMatch >= mismatchResult.dondeMatch) matchWins++;
  }

  if (matchTests > 0) {
    const winRate = matchWins / matchTests;
    assert(
      winRate >= 0.7,
      `B4.1: Matching cuisine scores ≥ mismatch for ${matchWins}/${matchTests} (${(winRate * 100).toFixed(0)}%) restaurants`,
      `need ≥70%`
    );
  }

  // -----------------------------------------------
  console.log("\n--- B5: Tier distribution sanity check ---");
  // -----------------------------------------------

  const tierCounts: Record<string, number> = {
    "Perfect Match": 0,
    "Strong Pick": 0,
    "Solid Option": 0,
    "Worth a Try": 0,
    "Best Available": 0,
  };

  for (const r of withGoogleResults) {
    tierCounts[r.tier]++;
  }

  const total = withGoogleResults.length;
  console.log("  Tier distribution (with 4.3★ Google data):");
  for (const [tier, count] of Object.entries(tierCounts)) {
    console.log(`    ${tier}: ${count} (${((count / total) * 100).toFixed(0)}%)`);
  }

  assert(
    tierCounts["Perfect Match"] / total <= 0.3,
    "B5.1: No more than 30% Perfect Match (sanity)",
    `got ${((tierCounts["Perfect Match"] / total) * 100).toFixed(0)}%`
  );
  assert(
    (tierCounts["Solid Option"] + tierCounts["Strong Pick"]) / total >= 0.3,
    "B5.2: At least 30% Solid/Strong (with 4.3★ google)",
    `got ${(((tierCounts["Solid Option"] + tierCounts["Strong Pick"]) / total) * 100).toFixed(0)}%`
  );

  // -----------------------------------------------
  console.log("\n--- B6: Date Night occasion shift test ---");
  // -----------------------------------------------

  // Find a restaurant with high date_friendly_score
  const dateRestaurant = profiles.find(p => (p.date_friendly_score ?? 0) >= 8);
  if (dateRestaurant) {
    const dateResult: V5DondeMatchResult = computeV5DondeMatch(dateRestaurant, makeV5Inputs({
      occasion: "Date Night",
      googleData: mockGoogle,
      intent: makeIntent({ emotional_intent: "impress", vibe_keywords: ["romantic"] }),
    }));
    const casualResult: V5DondeMatchResult = computeV5DondeMatch(dateRestaurant, makeV5Inputs({
      occasion: "Any",
      googleData: mockGoogle,
      intent: makeIntent({ emotional_intent: "casual" }),
    }));

    console.log(`  Testing ${dateRestaurant.name} (date_friendly=${dateRestaurant.date_friendly_score}):`);
    printBreakdown("Date Night", dateResult);
    printBreakdown("Casual Any", casualResult);

    // Date-friendly restaurant should score similarly or higher with Date Night occasion
    // (depends on weight shifts and other factors, so we just check it's reasonable)
    assertRange(dateResult.dondeMatch, 55, 99, `B6.1: Date Night DM is reasonable for ${dateRestaurant.name}`);
  } else {
    warn("B6: No restaurant with date_friendly_score >= 8 found");
  }
}

// Run Part B
await runPartB();

// ============================================================
// SUMMARY
// ============================================================

console.log("\n" + "=".repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${warned} warnings`);
if (failures.length > 0) {
  console.log("\nFailed tests:");
  for (const f of failures) console.log(f);
}
console.log("=".repeat(60));
process.exit(failed > 0 ? 1 : 0);
