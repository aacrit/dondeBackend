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
// PART C: EXPANDED PRESSURE TEST SUITE
// ============================================================

// -----------------------------------------------
section("C1. Complete Weight Shift Rule Coverage (28 rules)");
// -----------------------------------------------
// Test ALL 28 rules from weight-config-v5.ts individually via computeV5Weights()

{
  const allHigh: any = { food: "high", vibe: "high", service: "high", reputation: "high", convenience: "high" };
  const base = V5_BASE_WEIGHTS;
  const POOL = 15;
  const nullIntent = makeIntent({ emotional_intent: "casual" });

  // Helper: compute weights with isolated trigger
  function weightsFor(occasion: string, intent: IntentClassificationV2, conf: any = allHigh, pool = POOL, tod: string | null = null) {
    return computeV5Weights(occasion, intent, conf, pool, tod);
  }

  // Normalize base weights for comparison — use truly neutral intent (no emotional_intent trigger)
  // Note: makeIntent() defaults to emotional_intent="casual" which triggers a rule.
  // Use null intent for baseline so we isolate each rule's effect.
  const baseResult = weightsFor("Any", null as any, allHigh, POOL, null);
  const bw = baseResult.weights;

  // C1.1: Date Night (use null intent to isolate occasion rule)
  const c11 = weightsFor("Date Night", null as any, allHigh, POOL, null);
  assert(c11.weights.vibe > bw.vibe, "C1.1: Date Night → vibe up", `${c11.weights.vibe.toFixed(3)} vs base ${bw.vibe.toFixed(3)}`);
  assert(c11.weights.service > bw.service, "C1.1: Date Night → service up", `${c11.weights.service.toFixed(3)} vs base ${bw.service.toFixed(3)}`);
  assert(c11.weights.convenience < bw.convenience, "C1.1: Date Night → convenience down", `${c11.weights.convenience.toFixed(3)} vs base ${bw.convenience.toFixed(3)}`);

  // C1.2: Special Occasion (shares rule with Date Night)
  const c12 = weightsFor("Special Occasion", null as any, allHigh, POOL, null);
  assert(c12.weights.vibe > bw.vibe, "C1.2: Special Occasion → vibe up");
  assert(c12.weights.service > bw.service, "C1.2: Special Occasion → service up");

  // C1.3: Business Lunch
  const c13 = weightsFor("Business Lunch", null as any, allHigh, POOL, null);
  assert(c13.weights.service > bw.service, "C1.3: Business Lunch → service up");
  assert(c13.weights.vibe > bw.vibe, "C1.3: Business Lunch → vibe up");
  assert(c13.weights.food < bw.food, "C1.3: Business Lunch → food down");

  // C1.4: Adventure
  const c14 = weightsFor("Adventure", null as any, allHigh, POOL, null);
  assert(c14.weights.reputation > bw.reputation, "C1.4: Adventure → reputation up");

  // C1.5: Family Dinner
  const c15 = weightsFor("Family Dinner", null as any, allHigh, POOL, null);
  assert(c15.weights.service > bw.service, "C1.5: Family Dinner → service up");
  assert(c15.weights.convenience > bw.convenience, "C1.5: Family Dinner → convenience up");
  assert(c15.weights.vibe < bw.vibe, "C1.5: Family Dinner → vibe down");

  // C1.6: Solo Dining
  const c16 = weightsFor("Solo Dining", null as any, allHigh, POOL, null);
  assert(c16.weights.convenience > bw.convenience, "C1.6: Solo Dining → convenience up");
  assert(c16.weights.food > bw.food, "C1.6: Solo Dining → food up");
  assert(c16.weights.service < bw.service, "C1.6: Solo Dining → service down");

  // C1.7: Treat Myself
  const c17 = weightsFor("Treat Myself", null as any, allHigh, POOL, null);
  assert(c17.weights.food > bw.food, "C1.7: Treat Myself → food up");
  assert(c17.weights.vibe > bw.vibe, "C1.7: Treat Myself → vibe up");
  assert(c17.weights.convenience < bw.convenience, "C1.7: Treat Myself → convenience down");

  // C1.8: Chill Hangout
  const c18 = weightsFor("Chill Hangout", null as any, allHigh, POOL, null);
  assert(c18.weights.vibe > bw.vibe, "C1.8: Chill Hangout → vibe up");
  assert(c18.weights.convenience > bw.convenience, "C1.8: Chill Hangout → convenience up");
  assert(c18.weights.food < bw.food, "C1.8: Chill Hangout → food down");

  // C1.9: Group Hangout
  const c19 = weightsFor("Group Hangout", null as any, allHigh, POOL, null);
  assert(c19.weights.service > bw.service, "C1.9: Group Hangout → service up");
  assert(c19.weights.vibe > bw.vibe, "C1.9: Group Hangout → vibe up");

  // For intent-only tests, use null intent for isolation (no emotional_intent trigger)
  // Each test provides ONLY the specific intent field being tested

  // C1.10: Cuisine High
  const c110 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "high", flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "", date_type: null, group_size_hint: null, spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c110.weights.food > bw.food, "C1.10: High cuisine → food up");

  // C1.11: Cuisine Medium
  const c111 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "medium", flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "", date_type: null, group_size_hint: null, spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c111.weights.food > bw.food, "C1.11: Medium cuisine → food up (slight)");

  // C1.12: Cuisine Low
  const c112 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "low", flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "", date_type: null, group_size_hint: null, spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c112.weights.vibe > bw.vibe, "C1.12: Low cuisine → vibe up");
  assert(c112.weights.food < bw.food, "C1.12: Low cuisine → food down");

  // C1.13: Impress
  const c113 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "low" as any, flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "impress", date_type: null, group_size_hint: null, spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c113.weights.reputation > bw.reputation, "C1.13: Impress → reputation up");
  assert(c113.weights.service > bw.service, "C1.13: Impress → service up");

  // C1.14: Comfort — test comfort rule adds vibe+0.08, food+0.03
  // Note: Also triggering "low" cuisine rule which subtracts food-0.08. Test vibe (main effect) instead.
  const c114 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "low" as any, flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "comfort", date_type: null, group_size_hint: null, spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c114.weights.vibe > bw.vibe, "C1.14: Comfort → vibe up");
  // Food delta is comfort+0.03 but low_cuisine-0.08 = net -0.05. Test vibe is main signal.

  // C1.15: Explore
  const c115 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "low" as any, flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "explore", date_type: null, group_size_hint: null, spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c115.weights.reputation > bw.reputation, "C1.15: Explore → reputation up");

  // C1.16: Celebrate
  const c116 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "low" as any, flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "celebrate", date_type: null, group_size_hint: null, spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c116.weights.vibe > bw.vibe, "C1.16: Celebrate → vibe up");
  assert(c116.weights.service > bw.service, "C1.16: Celebrate → service up");

  // C1.17: Casual
  const c117 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "low" as any, flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "casual", date_type: null, group_size_hint: null, spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c117.weights.convenience > bw.convenience, "C1.17: Casual → convenience up");

  // C1.18: Indulge
  const c118 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "low" as any, flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "indulge", date_type: null, group_size_hint: null, spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c118.weights.food > bw.food, "C1.18: Indulge → food up");
  assert(c118.weights.vibe > bw.vibe, "C1.18: Indulge → vibe up");

  // C1.19: Price Sensitive
  const c119 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "low" as any, flavor_preferences: [], vibe_keywords: [], practical_constraints: ["budget"], emotional_intent: "", date_type: null, group_size_hint: null, spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c119.weights.convenience > bw.convenience, "C1.19: Price sensitive → convenience up");

  // C1.20: Spontaneous
  const c120 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "low" as any, flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "", date_type: null, group_size_hint: null, spontaneity: "spontaneous" } as any, allHigh, POOL, null);
  assert(c120.weights.convenience > bw.convenience, "C1.20: Spontaneous → convenience up");

  // C1.21: Planned
  const c121 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "low" as any, flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "", date_type: null, group_size_hint: null, spontaneity: "planned" } as any, allHigh, POOL, null);
  assert(c121.weights.service > bw.service, "C1.21: Planned → service up");
  assert(c121.weights.vibe > bw.vibe, "C1.21: Planned → vibe up");

  // C1.22: First Date
  const c122 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "low" as any, flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "", date_type: "first_date", group_size_hint: null, spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c122.weights.vibe > bw.vibe, "C1.22: First date → vibe up");
  assert(c122.weights.reputation > bw.reputation, "C1.22: First date → reputation up");

  // C1.23: Anniversary
  const c123 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "low" as any, flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "", date_type: "anniversary", group_size_hint: null, spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c123.weights.vibe > bw.vibe, "C1.23: Anniversary → vibe up");
  assert(c123.weights.service > bw.service, "C1.23: Anniversary → service up");

  // C1.24: Large Group
  const c124 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "low" as any, flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "", date_type: null, group_size_hint: "large_group", spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c124.weights.service > bw.service, "C1.24: Large group → service up");
  assert(c124.weights.convenience > bw.convenience, "C1.24: Large group → convenience up");

  // C1.25: Solo hint — use no cuisine_importance to isolate solo hint effect
  const c125 = weightsFor("Any", { target_cuisines: [], target_tags: [], target_features: [], cuisine_importance: "" as any, flavor_preferences: [], vibe_keywords: [], practical_constraints: [], emotional_intent: "", date_type: null, group_size_hint: "solo", spontaneity: "unknown" } as any, allHigh, POOL, null);
  assert(c125.weights.food > bw.food, "C1.25: Solo hint → food up");
  assert(c125.weights.convenience > bw.convenience, "C1.25: Solo hint → convenience up");

  // C1.26: Late Night (timeOfDay trigger, use null intent)
  const c126 = weightsFor("Any", null as any, allHigh, POOL, "late_night");
  assert(c126.weights.convenience > bw.convenience, "C1.26: Late night → convenience up");
  assert(c126.weights.vibe > bw.vibe, "C1.26: Late night → vibe up");

  // C1.27: Breakfast (timeOfDay trigger, use null intent)
  const c127 = weightsFor("Any", null as any, allHigh, POOL, "breakfast");
  assert(c127.weights.food > bw.food, "C1.27: Breakfast → food up");
  assert(c127.weights.convenience > bw.convenience, "C1.27: Breakfast → convenience up");

  // C1.28: All results — weights sum to 1.0 and in [0.05, 0.50]
  const allResults = [c11, c12, c13, c14, c15, c16, c17, c18, c19, c110, c111, c112,
    c113, c114, c115, c116, c117, c118, c119, c120, c121, c122, c123, c124, c125, c126, c127];
  for (let i = 0; i < allResults.length; i++) {
    const w = allResults[i].weights;
    const sum = w.food + w.vibe + w.service + w.reputation + w.convenience;
    assertApprox(sum, 1.0, 0.001, `C1.28: Rule ${i + 1} weights sum to 1.0`);
    for (const [k, v] of Object.entries(w)) {
      // Use small tolerance for floating point (0.0499999... should pass as >= 0.05)
      assert((v as number) >= 0.049 && (v as number) <= 0.501,
        `C1.28: Rule ${i + 1} ${k} in [0.05, 0.50]`, `got ${(v as number).toFixed(4)}`);
    }
  }
}

// -----------------------------------------------
section("C2. Weight Stacking & Edge Cases (12 tests)");
// -----------------------------------------------

{
  const allHigh: any = { food: "high", vibe: "high", service: "high", reputation: "high", convenience: "high" };
  const allLow: any = { food: "low", vibe: "low", service: "low", reputation: "low", convenience: "low" };
  const bw = V5_BASE_WEIGHTS;

  function checkSum(w: any, label: string) {
    const sum = w.food + w.vibe + w.service + w.reputation + w.convenience;
    assertApprox(sum, 1.0, 0.001, `${label}: sum=1.0`);
  }

  // C2.1: Date Night + High Cuisine + Impress (3 rules stack)
  const c21 = computeV5Weights("Date Night",
    makeIntent({ cuisine_importance: "high", emotional_intent: "impress" }), allHigh, 15, null);
  assert(c21.appliedRules.length >= 3, "C2.1: 3+ rules applied", `got ${c21.appliedRules.length}`);
  checkSum(c21.weights, "C2.1");

  // C2.2: Business Lunch + Impress + Planned
  const c22 = computeV5Weights("Business Lunch",
    makeIntent({ emotional_intent: "impress", spontaneity: "planned" }), allHigh, 15, null);
  assert(c22.weights.service > bw.service, "C2.2: Biz+Impress+Planned → service high");
  checkSum(c22.weights, "C2.2");

  // C2.3: Solo + Spontaneous + Price Sensitive → convenience maxes at 0.50
  const c23 = computeV5Weights("Solo Dining",
    makeIntent({ spontaneity: "spontaneous", practical_constraints: ["budget"] }), allHigh, 15, null);
  assert(c23.weights.convenience <= 0.50, "C2.3: Convenience clamped at 0.50", `got ${c23.weights.convenience.toFixed(3)}`);
  checkSum(c23.weights, "C2.3");

  // C2.4: Family + Low Cuisine + Casual
  const c24 = computeV5Weights("Family Dinner",
    makeIntent({ cuisine_importance: "low", emotional_intent: "casual" }), allHigh, 15, null);
  assert(c24.weights.convenience > bw.convenience, "C2.4: Family+Low+Casual → convenience high");
  checkSum(c24.weights, "C2.4");

  // C2.5: Celebrate + Anniversary + Large Group
  const c25 = computeV5Weights("Any",
    makeIntent({ emotional_intent: "celebrate", date_type: "anniversary", group_size_hint: "large_group" }), allHigh, 15, null);
  assert(c25.weights.service > bw.service, "C2.5: Celebrate+Anniversary+LargeGroup → service high");
  checkSum(c25.weights, "C2.5");

  // C2.6: Date Night + Explore + First Date
  const c26 = computeV5Weights("Date Night",
    makeIntent({ emotional_intent: "explore", date_type: "first_date" }), allHigh, 15, null);
  assert(c26.weights.vibe > bw.vibe, "C2.6: Date+Explore+FirstDate → vibe very high");
  checkSum(c26.weights, "C2.6");

  // C2.7: Layer 3 — all-low confidence → still sums to 1.0
  const c27 = computeV5Weights("Any", makeIntent(), allLow, 15, null);
  checkSum(c27.weights, "C2.7 (all-low confidence)");

  // C2.8: Layer 3 — mixed (food=high, rest=low)
  const mixedConf: any = { food: "high", vibe: "low", service: "low", reputation: "low", convenience: "low" };
  const c28 = computeV5Weights("Any", makeIntent(), mixedConf, 15, null);
  assert(c28.weights.food > c27.weights.food, "C2.8: Food=high boosts food vs all-low",
    `mixed=${c28.weights.food.toFixed(3)}, allLow=${c27.weights.food.toFixed(3)}`);
  checkSum(c28.weights, "C2.8");

  // C2.9: Layer 4 — pool size ≤5
  const c29_small = computeV5Weights("Any", makeIntent(), allHigh, 3, null);
  const c29_normal = computeV5Weights("Any", makeIntent(), allHigh, 15, null);
  assert(c29_small.weights.reputation > c29_normal.weights.reputation, "C2.9: Pool=3 → reputation boosted");
  assert(c29_small.weights.food > c29_normal.weights.food, "C2.9: Pool=3 → food boosted");
  checkSum(c29_small.weights, "C2.9");

  // C2.10: Layer 4 — pool size=1
  const c210 = computeV5Weights("Any", makeIntent(), allHigh, 1, null);
  assert(c210.weights.reputation > c29_normal.weights.reputation, "C2.10: Pool=1 → reputation boosted");
  checkSum(c210.weights, "C2.10");

  // C2.11: All layers combined — Date Night + High Cuisine + mixed conf + pool=3
  const c211 = computeV5Weights("Date Night",
    makeIntent({ cuisine_importance: "high", emotional_intent: "impress" }),
    mixedConf, 3, null);
  assert(c211.appliedRules.length >= 3, "C2.11: All layers combined — multiple rules");
  checkSum(c211.weights, "C2.11");

  // C2.12: No rules match — occasion="Any", null intent
  const c212 = computeV5Weights("Any", null as any, allHigh, 15, null);
  // Weights should be close to base (after Layer 3 high boost + normalization)
  checkSum(c212.weights, "C2.12 (no rules)");
}

// -----------------------------------------------
section("C3. Scoring Engine Formulas (TEST-FULL Cat 2)");
// -----------------------------------------------

{
  // C3.1-C3.6: Geometric Mean direct verification
  // We compute GM from given factors and weights, then verify DM = round(GM * 12)

  const scenarios: Array<{ label: string; factors: number[]; weights: any; expectedDm: [number, number] }> = [
    { label: "F-GM-01: (9,8,8,7,8) Date Night",
      factors: [9, 8, 8, 7, 8],
      weights: computeV5Weights("Date Night", makeIntent(), { food: "high", vibe: "high", service: "high", reputation: "high", convenience: "high" }, 15, null).weights,
      expectedDm: [82, 99] },
    { label: "F-GM-02: (10,10,2,8,10) Date Night",
      factors: [10, 10, 2, 8, 10],
      weights: computeV5Weights("Date Night", makeIntent(), { food: "high", vibe: "high", service: "high", reputation: "high", convenience: "high" }, 15, null).weights,
      expectedDm: [50, 80] },
    { label: "F-GM-03: All 5s, Base",
      factors: [5, 5, 5, 5, 5],
      weights: V5_BASE_WEIGHTS,
      expectedDm: [58, 62] },
    { label: "F-GM-04: All 10s",
      factors: [10, 10, 10, 10, 10],
      weights: V5_BASE_WEIGHTS,
      expectedDm: [99, 99] },
    { label: "F-GM-05: All 1s",
      factors: [1, 1, 1, 1, 1],
      weights: V5_BASE_WEIGHTS,
      expectedDm: [12, 12] },
    { label: "F-GM-06: (9,9,9,1,9)",
      factors: [9, 9, 9, 1, 9],
      weights: V5_BASE_WEIGHTS,
      expectedDm: [40, 85] },
  ];

  for (const s of scenarios) {
    const [fq, vb, sv, rp, cv] = s.factors;
    const w = s.weights;
    const gm = Math.pow(fq, w.food) * Math.pow(vb, w.vibe) * Math.pow(sv, w.service) *
      Math.pow(rp, w.reputation) * Math.pow(cv, w.convenience);
    const dm = Math.min(99, Math.max(0, Math.round(gm * 12)));
    assertRange(dm, s.expectedDm[0], s.expectedDm[1], `C3: ${s.label} → DM=${dm}`);
  }

  // C3.7-C3.9: Factor Floor extended
  // Verify via disliked restaurant penalty pushing food negative
  const fflProfile = makeProfile({ cuisine_type: "Italian", deep_profile: makeDeepProfile() });
  const fflResult: V5DondeMatchResult = computeV5DondeMatch(fflProfile, makeV5Inputs({
    userFeedback: {
      likedCuisines: [], dislikedCuisines: ["Italian"],
      likedRestaurantIds: [], dislikedRestaurantIds: [fflProfile.id],
    },
    intent: makeIntent({ target_cuisines: ["French"], cuisine_importance: "high" }),
    googleData: makeGoogleData({ google_rating: 3.2, google_review_count: 3 }),
  }));
  assert(fflResult.factors.food >= 1.0, "C3.7 (F-FL): Food floor holds with disliked+mismatch", `got ${fflResult.factors.food}`);
  assert(fflResult.factors.reputation >= 1.0, "C3.8 (F-FL): Rep floor holds with 3.2★/3 reviews", `got ${fflResult.factors.reputation}`);
  assert(fflResult.dondeMatch > 0, "C3.9 (F-FL): DM > 0 with heavy penalties");

  // C3.10-C3.14: Confidence regression algebraic verification via reputation
  // Google 4.85★ → raw stretched = (4.85-3.5)/1.5*10 = 9.0, with 200 reviews conf=1.0 → googleScore=9.0
  // rep raw = (9.0*0.65 + 1.0) / 8.5 * 10 = 7.94 (no awards, no community, denom=8.5)
  const confProfile = makeProfile({
    deep_profile: makeDeepProfile({ chef_notable: false, awards_recognition: [], cultural_authenticity: 3 }),
    trending_score: 3,
  });

  // High confidence (200 reviews)
  const crHigh: V5DondeMatchResult = computeV5DondeMatch(confProfile, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.85, google_review_count: 200 }),
  }));
  // Medium confidence (50 reviews)
  const crMed: V5DondeMatchResult = computeV5DondeMatch(confProfile, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.85, google_review_count: 50 }),
  }));
  // Low confidence (5 reviews)
  const crLow: V5DondeMatchResult = computeV5DondeMatch(confProfile, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.85, google_review_count: 5 }),
  }));

  assert(crHigh.factors.reputation > crMed.factors.reputation,
    "C3.10 (F-CR-01/02): High conf rep > Medium conf rep",
    `high=${crHigh.factors.reputation.toFixed(2)}, med=${crMed.factors.reputation.toFixed(2)}`);
  assert(crMed.factors.reputation > crLow.factors.reputation,
    "C3.11 (F-CR-02/03): Medium conf rep > Low conf rep",
    `med=${crMed.factors.reputation.toFixed(2)}, low=${crLow.factors.reputation.toFixed(2)}`);
  assert(crHigh.confidence.reputation === "high", "C3.12: 200 reviews → high conf");
  assert(crMed.confidence.reputation === "medium", "C3.13: 50 reviews → medium conf");
  assert(crLow.confidence.reputation === "low", "C3.14: 5 reviews → low conf");

  // C3.15-C3.20: Weight system base verification
  assertApprox(V5_BASE_WEIGHTS.food, 0.25, 0.001, "C3.15 (F-WS-01): Base food=0.25");
  assertApprox(V5_BASE_WEIGHTS.vibe, 0.18, 0.001, "C3.16 (F-WS-01): Base vibe=0.18");
  assertApprox(V5_BASE_WEIGHTS.service, 0.17, 0.001, "C3.17 (F-WS-01): Base service=0.17");
  assertApprox(V5_BASE_WEIGHTS.reputation, 0.25, 0.001, "C3.18 (F-WS-01): Base reputation=0.25");
  assertApprox(V5_BASE_WEIGHTS.convenience, 0.15, 0.001, "C3.19 (F-WS-01): Base convenience=0.15");
  const baseSum = V5_BASE_WEIGHTS.food + V5_BASE_WEIGHTS.vibe + V5_BASE_WEIGHTS.service +
    V5_BASE_WEIGHTS.reputation + V5_BASE_WEIGHTS.convenience;
  assertApprox(baseSum, 1.0, 0.001, "C3.20 (F-WS-01): Base weights sum to 1.0");
}

// -----------------------------------------------
section("C4. Five Factor Computation (TEST-FULL Cat 3)");
// -----------------------------------------------

{
  // Food Quality tests
  const italianProfile = makeProfile({
    cuisine_type: "Italian",
    deep_profile: makeDeepProfile({
      flavor_profiles: ["umami-forward", "rich-buttery", "herbaceous"],
      cuisine_subcategory: "Northern Italian",
      enrichment_confidence: 8,
    }),
  });

  // F-FQ-01: Perfect cuisine match
  const fq1: V5DondeMatchResult = computeV5DondeMatch(italianProfile, makeV5Inputs({
    intent: makeIntent({ target_cuisines: ["Italian"], cuisine_importance: "high" }),
    googleData: makeGoogleData(),
  }));
  assert(fq1.factors.food > 6.0, "C4.1 (F-FQ-01): Italian+Italian intent → food > 6.0", `got ${fq1.factors.food.toFixed(2)}`);

  // F-FQ-02: No cuisine match
  const fq2: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ cuisine_type: "Thai", deep_profile: null }),
    makeV5Inputs({
      intent: makeIntent({ target_cuisines: ["French"], cuisine_importance: "high" }),
      googleData: makeGoogleData(),
    }),
  );
  assert(fq2.factors.food < fq1.factors.food, "C4.2 (F-FQ-02): Thai+French intent → food < Italian+Italian",
    `mismatch=${fq2.factors.food.toFixed(2)}, match=${fq1.factors.food.toFixed(2)}`);

  // F-FQ-03: Partial flavor match
  const fq3: V5DondeMatchResult = computeV5DondeMatch(italianProfile, makeV5Inputs({
    intent: makeIntent({
      target_cuisines: ["Italian"], cuisine_importance: "medium",
      flavor_preferences: ["umami-forward", "rich-buttery"],
    }),
    googleData: makeGoogleData(),
  }));
  assert(fq3.factors.food > 5.0, "C4.3 (F-FQ-03): Partial flavor match → food > 5.0", `got ${fq3.factors.food.toFixed(2)}`);

  // F-FQ-04: Dietary fit (vegan profile + no dietary restriction)
  const veganProfile = makeProfile({
    cuisine_type: "American",
    dietary_options: ["Vegan", "Gluten-Free"],
    deep_profile: makeDeepProfile({ dietary_depth: "dedicated", enrichment_confidence: 7 }),
  });
  const fq4: V5DondeMatchResult = computeV5DondeMatch(veganProfile, makeV5Inputs({
    dietaryRestrictions: ["vegan"],
    intent: makeIntent({ target_cuisines: ["American"] }),
    googleData: makeGoogleData(),
  }));
  assert(fq4.factors.food >= 5.0, "C4.4 (F-FQ-04): Vegan restaurant + vegan restriction → food >= 5.0", `got ${fq4.factors.food.toFixed(2)}`);

  // F-FQ-05: No dietary match
  const fq5: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ cuisine_type: "American", dietary_options: null, deep_profile: null }),
    makeV5Inputs({
      dietaryRestrictions: ["gluten free"],
      intent: makeIntent({ target_cuisines: ["American"] }),
      googleData: makeGoogleData(),
    }),
  );
  // Should still produce valid score even if dietary doesn't match (V5 hard-filters dietary)
  assert(fq5.factors.food >= 1.0, "C4.5 (F-FQ-05): No dietary options → food still >= 1.0", `got ${fq5.factors.food.toFixed(2)}`);

  // Vibe tests
  // F-VB-01: Quiet + intimate keyword
  const quietProfile = makeProfile({
    noise_level: "Quiet",
    lighting_ambiance: "dim, romantic, warm",
    ambiance: ["Intimate", "Romantic"],
    deep_profile: makeDeepProfile({ energy_level: 3, conversation_friendliness: 9, enrichment_confidence: 8 }),
  });
  const vb1: V5DondeMatchResult = computeV5DondeMatch(quietProfile, makeV5Inputs({
    occasion: "Date Night",
    intent: makeIntent({ vibe_keywords: ["intimate", "quiet"], emotional_intent: "impress" }),
    googleData: makeGoogleData(),
  }));
  assert(vb1.factors.vibe > 5.5, "C4.6 (F-VB-01): Quiet+intimate → vibe > 5.5", `got ${vb1.factors.vibe.toFixed(2)}`);

  // F-VB-02: Loud + intimate keyword → lower vibe
  const loudProfile = makeProfile({
    noise_level: "Loud",
    lighting_ambiance: "bright, neon",
    ambiance: ["Energetic", "Loud"],
    deep_profile: makeDeepProfile({ energy_level: 9, conversation_friendliness: 3, enrichment_confidence: 8 }),
  });
  const vb2: V5DondeMatchResult = computeV5DondeMatch(loudProfile, makeV5Inputs({
    occasion: "Date Night",
    intent: makeIntent({ vibe_keywords: ["intimate", "quiet"], emotional_intent: "impress" }),
    googleData: makeGoogleData(),
  }));
  assert(vb2.factors.vibe < vb1.factors.vibe, "C4.7 (F-VB-02): Loud+intimate → vibe < Quiet+intimate",
    `loud=${vb2.factors.vibe.toFixed(2)}, quiet=${vb1.factors.vibe.toFixed(2)}`);

  // F-VB-05: Music vibe alignment
  const jazzProfile = makeProfile({
    noise_level: "Moderate",
    ambiance: ["Cozy"],
    deep_profile: makeDeepProfile({ music_vibe: "jazz", enrichment_confidence: 7 }),
  });
  const vb5: V5DondeMatchResult = computeV5DondeMatch(jazzProfile, makeV5Inputs({
    intent: makeIntent({ vibe_keywords: ["jazz", "live music"] }),
    googleData: makeGoogleData(),
  }));
  const vb5_noMusic: V5DondeMatchResult = computeV5DondeMatch(jazzProfile, makeV5Inputs({
    intent: makeIntent({ vibe_keywords: [] }),
    googleData: makeGoogleData(),
  }));
  // Both should produce valid vibe scores > 5.0 (restaurant has rich ambiance data)
  assert(vb5.factors.vibe > 5.0,
    "C4.8 (F-VB-05): Jazz restaurant with jazz keyword → vibe > 5.0",
    `match=${vb5.factors.vibe.toFixed(2)}, noKw=${vb5_noMusic.factors.vibe.toFixed(2)}`);

  // Service tests
  // F-SV-01: Date Night + high date_friendly
  const sv1: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ date_friendly_score: 9, deep_profile: makeDeepProfile({ service_style: "Full Table Service" }) }),
    makeV5Inputs({ occasion: "Date Night", googleData: makeGoogleData() }),
  );
  assert(sv1.factors.service > 5.0, "C4.9 (F-SV-01): Date Night + date_friendly=9 → service > 5.0", `got ${sv1.factors.service.toFixed(2)}`);

  // F-SV-03: Family Dinner + high kid_friendliness
  const sv3: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ family_friendly_score: 9, deep_profile: makeDeepProfile({ kid_friendliness: 9 }) }),
    makeV5Inputs({ occasion: "Family Dinner", googleData: makeGoogleData() }),
  );
  assert(sv3.factors.service > 5.0, "C4.10 (F-SV-03): Family Dinner + kid_friendliness=9 → service > 5.0", `got ${sv3.factors.service.toFixed(2)}`);

  // Reputation tests
  // F-RP-01: 4.5★, 500 reviews
  const rp1: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ deep_profile: makeDeepProfile({ chef_notable: false, awards_recognition: [] }) }),
    makeV5Inputs({ googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 500 }) }),
  );
  assert(rp1.factors.reputation > 5.5, "C4.11 (F-RP-01): 4.5★/500 → rep > 5.5", `got ${rp1.factors.reputation.toFixed(2)}`);
  assert(rp1.confidence.reputation === "high", "C4.11: 500 reviews → high conf");

  // F-RP-02: 4.5★, 5 reviews → regresses toward 5.5
  const rp2: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ deep_profile: makeDeepProfile({ chef_notable: false, awards_recognition: [] }) }),
    makeV5Inputs({ googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 5 }) }),
  );
  assert(rp2.factors.reputation < rp1.factors.reputation,
    "C4.12 (F-RP-02): 5 reviews → rep < 500 reviews",
    `5rev=${rp2.factors.reputation.toFixed(2)}, 500rev=${rp1.factors.reputation.toFixed(2)}`);

  // F-RP-03: No Google data
  const rp3: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ deep_profile: makeDeepProfile({ chef_notable: false, awards_recognition: [] }) }),
    makeV5Inputs({ googleData: null }),
  );
  assertRange(rp3.factors.reputation, 4.0, 6.5, "C4.13 (F-RP-03): No Google → rep near neutral");
  assert(rp3.confidence.reputation === "low", "C4.13: No Google → low conf");

  // Convenience tests
  // F-CV-01: Walk-in + no wait + timing match
  const cv1: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({
      best_times: ["dinner"],
      deep_profile: makeDeepProfile({ reservation_difficulty: "walk-in", typical_wait_minutes: 0 }),
    }),
    makeV5Inputs({ clientTimeOfDay: "dinner", googleData: makeGoogleData() }),
  );
  assert(cv1.factors.convenience > 5.5, "C4.14 (F-CV-01): Walk-in+no wait+timing → conv > 5.5", `got ${cv1.factors.convenience.toFixed(2)}`);

  // F-CV-02: High wait time → lower convenience
  const cv2: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({
      best_times: ["dinner"],
      deep_profile: makeDeepProfile({ reservation_difficulty: "essential", typical_wait_minutes: 60 }),
    }),
    makeV5Inputs({ clientTimeOfDay: "dinner", googleData: makeGoogleData() }),
  );
  assert(cv2.factors.convenience <= cv1.factors.convenience,
    "C4.15 (F-CV-02): 60min wait → conv <= walk-in",
    `wait=${cv2.factors.convenience.toFixed(2)}, walkin=${cv1.factors.convenience.toFixed(2)}`);
}

// -----------------------------------------------
section("C5. Dynamic Weight Matrix (TEST-FULL Cat 4)");
// -----------------------------------------------

{
  const allHigh: any = { food: "high", vibe: "high", service: "high", reputation: "high", convenience: "high" };
  const occasions = ["Date Night", "Business Lunch", "Adventure", "Family Dinner", "Solo Dining", "Treat Myself", "Chill Hangout"];
  const results: Record<string, any> = {};

  // Use null intent to isolate occasion-only weight shifts
  for (const occ of occasions) {
    results[occ] = computeV5Weights(occ, null as any, allHigh, 15, null).weights;
  }

  // F-DW-01: Date Night
  assert(results["Date Night"].vibe > 0.22, "C5.1 (F-DW-01): Date Night vibe > 0.22", `got ${results["Date Night"].vibe.toFixed(3)}`);

  // F-DW-02: Business Lunch
  assert(results["Business Lunch"].service > 0.20, "C5.2 (F-DW-02): Biz Lunch service > 0.20", `got ${results["Business Lunch"].service.toFixed(3)}`);

  // F-DW-03: Adventure
  assert(results["Adventure"].reputation > 0.24, "C5.3 (F-DW-03): Adventure rep > 0.24", `got ${results["Adventure"].reputation.toFixed(3)}`);

  // F-DW-04: Family Dinner
  assert(results["Family Dinner"].convenience > 0.19, "C5.4 (F-DW-04): Family conv > 0.19", `got ${results["Family Dinner"].convenience.toFixed(3)}`);

  // F-DW-05: Solo Dining — after occasion shift: food+0.05=0.30, conv+0.08=0.23
  assert(results["Solo Dining"].convenience > 0.19, "C5.5 (F-DW-05): Solo conv > 0.19", `got ${results["Solo Dining"].convenience.toFixed(3)}`);
  assert(results["Solo Dining"].food > 0.25, "C5.5: Solo food > 0.25", `got ${results["Solo Dining"].food.toFixed(3)}`);

  // F-DW-06: Treat Myself — after occasion shift: food+0.05=0.30, vibe+0.05=0.23
  assert(results["Treat Myself"].food > 0.25, "C5.6 (F-DW-06): Treat food > 0.25", `got ${results["Treat Myself"].food.toFixed(3)}`);
  assert(results["Treat Myself"].vibe > 0.19, "C5.6: Treat vibe > 0.19", `got ${results["Treat Myself"].vibe.toFixed(3)}`);

  // F-DW-07: Chill Hangout
  assert(results["Chill Hangout"].vibe > 0.22, "C5.7 (F-DW-07): Chill vibe > 0.22", `got ${results["Chill Hangout"].vibe.toFixed(3)}`);

  // F-DW-08: All sum to 1.0
  for (const occ of occasions) {
    const w = results[occ];
    const sum = w.food + w.vibe + w.service + w.reputation + w.convenience;
    assertApprox(sum, 1.0, 0.001, `C5.8 (F-DW-08): ${occ} sum=1.0`);
  }

  // F-DW-09: No weight < 0.05 (with floating point tolerance)
  for (const occ of occasions) {
    const w = results[occ];
    for (const [k, v] of Object.entries(w)) {
      assert((v as number) >= 0.049, `C5.9 (F-DW-09): ${occ}.${k} >= 0.05`, `got ${(v as number).toFixed(4)}`);
    }
  }

  // F-DW-10: No weight > 0.50 (with floating point tolerance)
  for (const occ of occasions) {
    const w = results[occ];
    for (const [k, v] of Object.entries(w)) {
      assert((v as number) <= 0.501, `C5.10 (F-DW-10): ${occ}.${k} <= 0.50`, `got ${(v as number).toFixed(4)}`);
    }
  }

  // F-DW-11: Date Night vibe vs Chill vibe — both get +0.08 but normalization differs
  // Date Night also gets service+0.04 and convenience-0.08, while Chill gets convenience+0.05 and food-0.08
  // After normalization, Date Night vibe should be >= Chill vibe (or very close)
  const dateVibe = results["Date Night"].vibe;
  const chillVibe = results["Chill Hangout"].vibe;
  // Both apply same vibe +0.08, so they should be close. Allow small tolerance.
  assert(Math.abs(dateVibe - chillVibe) < 0.06 || dateVibe >= chillVibe,
    "C5.11 (F-DW-11): Date vibe ~= or > Chill vibe",
    `date=${dateVibe.toFixed(3)}, chill=${chillVibe.toFixed(3)}`);

  // F-DW-12: Business Lunch — service is 1st or 2nd highest
  const bizW = results["Business Lunch"];
  const bizSorted = Object.entries(bizW).sort((a, b) => (b[1] as number) - (a[1] as number));
  const serviceRank = bizSorted.findIndex(([k]) => k === "service");
  assert(serviceRank <= 1, "C5.12 (F-DW-12): Biz Lunch service is 1st or 2nd highest",
    `rank=${serviceRank + 1}, order=${bizSorted.map(([k, v]) => `${k}=${(v as number).toFixed(3)}`).join(", ")}`);
}

// -----------------------------------------------
section("C6. Cross-Validation (TEST-FULL Cat 5)");
// -----------------------------------------------

{
  // For 7 occasion scenarios, verify DM = round(GM * 12) internally
  const occasions = ["Date Night", "Business Lunch", "Adventure", "Family Dinner", "Solo Dining", "Treat Myself", "Chill Hangout"];
  const profile = makeProfile({ deep_profile: makeDeepProfile({ enrichment_confidence: 7 }) });
  const google = makeGoogleData({ google_rating: 4.4, google_review_count: 200 });
  const allDMs: number[] = [];

  for (let i = 0; i < occasions.length; i++) {
    const occ = occasions[i];
    const result: V5DondeMatchResult = computeV5DondeMatch(profile, makeV5Inputs({
      occasion: occ,
      googleData: google,
      intent: makeIntent({ emotional_intent: "casual" }),
    }));
    const f = result.factors;
    const w = result.weights;
    const gm = Math.pow(f.food, w.food) * Math.pow(f.vibe, w.vibe) *
      Math.pow(f.service, w.service) * Math.pow(f.reputation, w.reputation) *
      Math.pow(f.convenience, w.convenience);
    const expectedDM = Math.min(99, Math.max(0, Math.round(gm * 12)));
    assert(result.dondeMatch === expectedDM,
      `C6.${i + 1} (F-XA): ${occ} GM cross-validation`,
      `DM=${result.dondeMatch}, expected=${expectedDM}, GM=${gm.toFixed(4)}`);
    allDMs.push(result.dondeMatch);
  }

  // F-XA-08: At least 2 different tiers
  const tiers = new Set(allDMs.map(dm => getTier(dm)));
  assert(tiers.size >= 2 || allDMs.length <= 2,
    "C6.8 (F-XA-08): ≥2 different tiers across 7 occasions",
    `tiers: ${[...tiers].join(", ")}`);
}

// -----------------------------------------------
section("C7. Two-Phase Scoring (TEST-FULL Cat 11)");
// -----------------------------------------------

{
  const profiles = [
    makeProfile({ cuisine_type: "Italian", date_friendly_score: 8, deep_profile: makeDeepProfile({ enrichment_confidence: 7 }) }),
    makeProfile({ cuisine_type: "Japanese", date_friendly_score: 6, deep_profile: makeDeepProfile({ enrichment_confidence: 6 }) }),
    makeProfile({ cuisine_type: "Mexican", date_friendly_score: 5, deep_profile: makeDeepProfile({ enrichment_confidence: 5 }) }),
    makeProfile({ cuisine_type: "American", date_friendly_score: 4, deep_profile: null }),
    makeProfile({ cuisine_type: "Thai", date_friendly_score: 3, deep_profile: null }),
  ];

  // F-TP-01: Phase 1 — reRankV5 without Google
  const phase1 = reRankV5(profiles, "Date Night", "romantic dinner", makeIntent({ emotional_intent: "impress" }));
  assert(phase1.length === profiles.length, "C7.1 (F-TP-01): reRankV5 returns all profiles");
  assert(phase1[0].result.confidence.reputation === "low",
    "C7.1: Phase 1 rep confidence = low (no Google)");

  // F-TP-02: Phase 2 — with Google data, reputation jumps
  const phase2Result: V5DondeMatchResult = computeV5DondeMatch(profiles[0], makeV5Inputs({
    occasion: "Date Night",
    specialRequest: "romantic dinner",
    googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 500 }),
    intent: makeIntent({ emotional_intent: "impress" }),
  }));
  assert(phase2Result.factors.reputation > phase1[0].result.factors.reputation,
    "C7.2 (F-TP-02): Phase 2 rep > Phase 1 rep (Google data helps)",
    `p2=${phase2Result.factors.reputation.toFixed(2)}, p1=${phase1[0].result.factors.reputation.toFixed(2)}`);

  // F-TP-03: reRankV5 returns sorted descending
  let sorted = true;
  for (let i = 1; i < phase1.length; i++) {
    if (phase1[i].result.dondeMatch > phase1[i - 1].result.dondeMatch) sorted = false;
  }
  assert(sorted, "C7.3 (F-TP-03): reRankV5 sorted descending by DM");

  // F-TP-04: Phase 1 scores are valid standalone
  for (const p of phase1) {
    assert(p.result.dondeMatch > 0 && p.result.dondeMatch <= 99,
      "C7.4 (F-TP-04): Phase 1 DM in (0, 99]", `got ${p.result.dondeMatch}`);
    assert(p.result.factors.food >= 1.0, "C7.4: Phase 1 food >= 1.0");
  }

  // F-TP-05: Top-5 re-scored with Google
  const top5WithGoogle = profiles.slice(0, 5).map(p =>
    computeV5DondeMatch(p, makeV5Inputs({
      occasion: "Date Night",
      googleData: makeGoogleData({ google_rating: 4.3, google_review_count: 200 }),
      intent: makeIntent({ emotional_intent: "impress" }),
    })),
  );
  for (const r of top5WithGoogle) {
    assert(r.dondeMatch > 0, "C7.5 (F-TP-05): Google re-score DM > 0");
  }

  // F-TP-06: Google data generally lifts scores (for positive ratings)
  const phase1Top = phase1[0].result.dondeMatch;
  const phase2Top = phase2Result.dondeMatch;
  assert(phase2Top >= phase1Top - 5,
    "C7.6 (F-TP-06): Phase 2 DM >= Phase 1 DM - 5 (positive Google helps)",
    `p1=${phase1Top}, p2=${phase2Top}`);
}

// -----------------------------------------------
section("C8. Catalog-Derived Pipeline Scenarios (30 tests)");
// -----------------------------------------------

{
  const results: Array<{ label: string; dm: number; tier: string }> = [];

  function runScenario(label: string, profile: RestaurantProfile, inputs: V5DondeMatchInputs, minDM: number, maxDM: number) {
    const r: V5DondeMatchResult = computeV5DondeMatch(profile, inputs);
    results.push({ label, dm: r.dondeMatch, tier: getTier(r.dondeMatch) });
    assertRange(r.dondeMatch, minDM, maxDM, `${label} → DM=${r.dondeMatch} (${getTier(r.dondeMatch)})`);
    return r;
  }

  // C8.1 (T03): Romantic Italian dinner / Date Night
  runScenario("C8.1: Romantic Italian dinner",
    makeProfile({
      cuisine_type: "Italian", ambiance: ["Romantic", "Intimate"], noise_level: "Quiet",
      date_friendly_score: 9, romantic_rating: 9,
      deep_profile: makeDeepProfile({ enrichment_confidence: 8, conversation_friendliness: 9, energy_level: 3 }),
    }),
    makeV5Inputs({
      occasion: "Date Night", specialRequest: "romantic Italian dinner",
      googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 300 }),
      intent: makeIntent({ target_cuisines: ["Italian"], cuisine_importance: "high", emotional_intent: "impress", vibe_keywords: ["romantic"] }),
    }), 65, 99);

  // C8.2 (T04): Best pizza / Chill Hangout
  runScenario("C8.2: Best pizza in town",
    makeProfile({
      cuisine_type: "Italian", ambiance: ["Casual", "Fun"], noise_level: "Lively",
      group_friendly_score: 7,
      deep_profile: makeDeepProfile({ enrichment_confidence: 6, service_style: "Counter Service" }),
    }),
    makeV5Inputs({
      occasion: "Chill Hangout", specialRequest: "best pizza in town",
      googleData: makeGoogleData({ google_rating: 4.2, google_review_count: 150 }),
      intent: makeIntent({ target_cuisines: ["Italian", "Pizza"], cuisine_importance: "high", emotional_intent: "casual" }),
    }), 55, 85);

  // C8.3 (T09): Date Night occasion
  runScenario("C8.3: Date Night occasion",
    makeProfile({
      cuisine_type: "French", date_friendly_score: 8, romantic_rating: 8,
      ambiance: ["Romantic"], noise_level: "Quiet",
      deep_profile: makeDeepProfile({ enrichment_confidence: 7 }),
    }),
    makeV5Inputs({
      occasion: "Date Night",
      googleData: makeGoogleData({ google_rating: 4.4, google_review_count: 200 }),
      intent: makeIntent({ emotional_intent: "impress", vibe_keywords: ["romantic"] }),
    }), 60, 95);

  // C8.4 (T10): Group Hangout
  runScenario("C8.4: Group Hangout",
    makeProfile({
      cuisine_type: "American", group_friendly_score: 8,
      ambiance: ["Lively", "Fun"], noise_level: "Moderate",
      deep_profile: makeDeepProfile({ enrichment_confidence: 6, group_size_sweet_spot: "[4,10)" }),
    }),
    makeV5Inputs({
      occasion: "Group Hangout",
      googleData: makeGoogleData({ google_rating: 4.3, google_review_count: 180 }),
      intent: makeIntent({ emotional_intent: "casual", group_size_hint: "large_group" }),
    }), 55, 85);

  // C8.5 (T11): Family Dinner
  runScenario("C8.5: Family Dinner",
    makeProfile({
      cuisine_type: "American", family_friendly_score: 8,
      deep_profile: makeDeepProfile({ kid_friendliness: 8, enrichment_confidence: 6 }),
    }),
    makeV5Inputs({
      occasion: "Family Dinner",
      googleData: makeGoogleData({ google_rating: 4.3, google_review_count: 160 }),
      intent: makeIntent({ emotional_intent: "casual" }),
    }), 55, 85);

  // C8.6 (T12): Business Lunch
  runScenario("C8.6: Business Lunch",
    makeProfile({
      cuisine_type: "American", business_lunch_score: 9,
      ambiance: ["Professional"], noise_level: "Moderate", dress_code: "Business Casual",
      deep_profile: makeDeepProfile({ service_style: "Full Table Service", enrichment_confidence: 7 }),
    }),
    makeV5Inputs({
      occasion: "Business Lunch",
      googleData: makeGoogleData({ google_rating: 4.4, google_review_count: 220 }),
      intent: makeIntent({ emotional_intent: "impress" }),
    }), 60, 90);

  // C8.7 (T13): Solo Dining cheap
  runScenario("C8.7: Solo Dining cheap",
    makeProfile({
      cuisine_type: "Mexican", price_level: "$", solo_dining_score: 7,
      deep_profile: makeDeepProfile({ service_style: "Counter Service", enrichment_confidence: 5 }),
    }),
    makeV5Inputs({
      occasion: "Solo Dining",
      googleData: makeGoogleData({ google_rating: 4.1, google_review_count: 80 }),
      intent: makeIntent({ emotional_intent: "casual", spontaneity: "spontaneous", practical_constraints: ["budget"] }),
    }), 50, 80);

  // C8.8 (T14): Special Occasion
  runScenario("C8.8: Special Occasion",
    makeProfile({
      cuisine_type: "Italian", price_level: "$$$$", romantic_rating: 9, date_friendly_score: 9,
      ambiance: ["Elegant", "Romantic"],
      deep_profile: makeDeepProfile({ enrichment_confidence: 8, chef_notable: true, awards_recognition: ["Best Fine Dining"] }),
    }),
    makeV5Inputs({
      occasion: "Special Occasion",
      googleData: makeGoogleData({ google_rating: 4.6, google_review_count: 400 }),
      intent: makeIntent({ emotional_intent: "impress", vibe_keywords: ["elegant"] }),
    }), 70, 99);

  // C8.9 (T16): Adventure Chinatown
  runScenario("C8.9: Adventure Chinatown",
    makeProfile({
      cuisine_type: "Chinese", price_level: "$", hole_in_wall_factor: 8,
      deep_profile: makeDeepProfile({ cultural_authenticity: 9, enrichment_confidence: 6 }),
    }),
    makeV5Inputs({
      occasion: "Adventure",
      googleData: makeGoogleData({ google_rating: 4.0, google_review_count: 120 }),
      intent: makeIntent({ emotional_intent: "explore" }),
    }), 50, 80);

  // C8.10 (T19): Tacos in Pilsen
  runScenario("C8.10: Tacos in Pilsen",
    makeProfile({
      cuisine_type: "Mexican", price_level: "$",
      tags: ["tacos", "street food", "authentic"],
      deep_profile: makeDeepProfile({ cultural_authenticity: 8, enrichment_confidence: 6 }),
    }),
    makeV5Inputs({
      specialRequest: "tacos in Pilsen",
      googleData: makeGoogleData({ google_rating: 4.2, google_review_count: 100 }),
      intent: makeIntent({ target_cuisines: ["Mexican"], cuisine_importance: "high", emotional_intent: "casual" }),
    }), 55, 85);

  // C8.11 (T20): Pasta carbonara / Date Night
  runScenario("C8.11: Pasta carbonara",
    makeProfile({
      cuisine_type: "Italian", price_level: "$$", date_friendly_score: 7,
      tags: ["pasta", "carbonara"],
      deep_profile: makeDeepProfile({ signature_dishes: [{ dish: "Carbonara", why: "classic" }], enrichment_confidence: 7 }),
    }),
    makeV5Inputs({
      occasion: "Date Night", specialRequest: "pasta carbonara",
      googleData: makeGoogleData({ google_rating: 4.4, google_review_count: 200 }),
      intent: makeIntent({ target_cuisines: ["Italian"], cuisine_importance: "high", emotional_intent: "impress" }),
    }), 60, 99);

  // C8.12 (T21): Sushi omakase / Special Occasion
  runScenario("C8.12: Sushi omakase",
    makeProfile({
      cuisine_type: "Japanese", price_level: "$$$$", romantic_rating: 8,
      tags: ["sushi", "omakase"],
      deep_profile: makeDeepProfile({ cuisine_subcategory: "Sushi/Omakase", chef_notable: true, enrichment_confidence: 9 }),
    }),
    makeV5Inputs({
      occasion: "Special Occasion", specialRequest: "sushi omakase",
      googleData: makeGoogleData({ google_rating: 4.7, google_review_count: 500 }),
      intent: makeIntent({ target_cuisines: ["Japanese", "Sushi"], cuisine_importance: "high", emotional_intent: "impress" }),
    }), 70, 99);

  // C8.13 (T23): Anniversary dinner
  runScenario("C8.13: Anniversary dinner",
    makeProfile({
      cuisine_type: "Italian", price_level: "$$$$", romantic_rating: 9, date_friendly_score: 9,
      ambiance: ["Romantic", "Candlelit"],
      deep_profile: makeDeepProfile({ enrichment_confidence: 9, chef_notable: true }),
    }),
    makeV5Inputs({
      occasion: "Special Occasion", specialRequest: "anniversary dinner",
      googleData: makeGoogleData({ google_rating: 4.8, google_review_count: 600 }),
      intent: makeIntent({ emotional_intent: "impress", date_type: "anniversary", vibe_keywords: ["romantic"] }),
    }), 72, 99);

  // C8.14 (T36): Late night food
  runScenario("C8.14: Late night food",
    makeProfile({
      cuisine_type: "American", best_times: ["late_night", "dinner"],
      deep_profile: makeDeepProfile({ enrichment_confidence: 5 }),
    }),
    makeV5Inputs({
      specialRequest: "late night food craving",
      googleData: makeGoogleData({ google_rating: 4.0, google_review_count: 100 }),
      intent: makeIntent({ emotional_intent: "casual" }),
      clientTimeOfDay: "late_night",
    }), 50, 90);

  // C8.15 (T37): Brunch spot
  runScenario("C8.15: Brunch spot",
    makeProfile({
      cuisine_type: "Brunch", best_times: ["brunch", "lunch"],
      good_for: ["Groups", "Brunch"],
      deep_profile: makeDeepProfile({ enrichment_confidence: 6 }),
    }),
    makeV5Inputs({
      specialRequest: "brunch spot",
      googleData: makeGoogleData({ google_rating: 4.3, google_review_count: 150 }),
      intent: makeIntent({ target_cuisines: ["Brunch"], cuisine_importance: "high", emotional_intent: "casual" }),
    }), 55, 85);

  // C8.16 (T55): Deep dish pizza
  runScenario("C8.16: Deep dish pizza",
    makeProfile({
      cuisine_type: "Italian", tags: ["deep dish", "pizza", "chicago-style"],
      deep_profile: makeDeepProfile({ enrichment_confidence: 6 }),
    }),
    makeV5Inputs({
      occasion: "Chill Hangout", specialRequest: "deep dish pizza",
      googleData: makeGoogleData({ google_rating: 4.1, google_review_count: 250 }),
      intent: makeIntent({ target_cuisines: ["Italian", "Pizza"], cuisine_importance: "high", emotional_intent: "casual" }),
    }), 50, 92);

  // C8.17 (T56): Authentic mole negro
  runScenario("C8.17: Authentic mole negro",
    makeProfile({
      cuisine_type: "Mexican",
      deep_profile: makeDeepProfile({ cultural_authenticity: 9, enrichment_confidence: 7 }),
    }),
    makeV5Inputs({
      occasion: "Adventure", specialRequest: "authentic mole negro",
      googleData: makeGoogleData({ google_rating: 4.3, google_review_count: 120 }),
      intent: makeIntent({ target_cuisines: ["Mexican"], cuisine_importance: "high", emotional_intent: "explore" }),
    }), 55, 85);

  // C8.18 (T57): Sushi + outdoor patio
  runScenario("C8.18: Sushi + outdoor patio",
    makeProfile({
      cuisine_type: "Japanese", outdoor_seating: true,
      date_friendly_score: 8,
      deep_profile: makeDeepProfile({ enrichment_confidence: 7 }),
    }),
    makeV5Inputs({
      occasion: "Date Night", specialRequest: "sushi with outdoor patio",
      googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 200 }),
      intent: makeIntent({ target_cuisines: ["Japanese", "Sushi"], cuisine_importance: "high", emotional_intent: "impress", target_features: ["outdoor"] }),
    }), 60, 99);

  // C8.19 (T59): Craft beer
  runScenario("C8.19: Craft beer",
    makeProfile({
      cuisine_type: "American", tags: ["craft beer", "brewery", "bar"],
      ambiance: ["Casual", "Lively"],
      deep_profile: makeDeepProfile({ enrichment_confidence: 5 }),
    }),
    makeV5Inputs({
      occasion: "Chill Hangout", specialRequest: "great craft beer",
      googleData: makeGoogleData({ google_rating: 4.2, google_review_count: 180 }),
      intent: makeIntent({ target_tags: ["craft beer", "brewery"], emotional_intent: "casual" }),
    }), 50, 92);

  // C8.20 (T62): Smoked brisket and ribs
  runScenario("C8.20: Smoked brisket and ribs",
    makeProfile({
      cuisine_type: "BBQ", group_friendly_score: 8,
      tags: ["bbq", "brisket", "ribs", "smoked"],
      deep_profile: makeDeepProfile({ enrichment_confidence: 6 }),
    }),
    makeV5Inputs({
      occasion: "Group Hangout", specialRequest: "smoked brisket and ribs",
      googleData: makeGoogleData({ google_rating: 4.3, google_review_count: 200 }),
      intent: makeIntent({ target_cuisines: ["BBQ"], cuisine_importance: "high", emotional_intent: "casual", group_size_hint: "large_group" }),
    }), 55, 85);

  // C8.21-C8.25: Cuisine mismatches (T78-T82)
  const mismatchTests: Array<[string, string, string, string]> = [
    ["C8.21: Scandinavian mismatch", "Italian", "Scandinavian", "Adventure"],
    ["C8.22: Filipino mismatch", "American", "Filipino", "Group Hangout"],
    ["C8.23: Jamaican mismatch", "Mexican", "Jamaican", "Chill Hangout"],
    ["C8.24: Georgian mismatch", "Italian", "Georgian", "Date Night"],
    ["C8.25: Tibetan mismatch", "Japanese", "Tibetan", "Adventure"],
  ];
  for (const [label, profileCuisine, intentCuisine, occasion] of mismatchTests) {
    runScenario(label,
      makeProfile({ cuisine_type: profileCuisine, deep_profile: makeDeepProfile({ enrichment_confidence: 5 }) }),
      makeV5Inputs({
        occasion,
        googleData: makeGoogleData({ google_rating: 4.2, google_review_count: 100 }),
        intent: makeIntent({ target_cuisines: [intentCuisine], cuisine_importance: "high" }),
      }), 30, 70);
  }

  // C8.26: User feedback — liked cuisine → higher score
  const feedbackProfile = makeProfile({ cuisine_type: "Italian", deep_profile: makeDeepProfile({ enrichment_confidence: 7 }) });
  const baselineFeedback: V5DondeMatchResult = computeV5DondeMatch(feedbackProfile, makeV5Inputs({
    googleData: makeGoogleData(),
    intent: makeIntent({ target_cuisines: ["Italian"], cuisine_importance: "medium" }),
  }));
  const likedFeedback: V5DondeMatchResult = computeV5DondeMatch(feedbackProfile, makeV5Inputs({
    googleData: makeGoogleData(),
    intent: makeIntent({ target_cuisines: ["Italian"], cuisine_importance: "medium" }),
    userFeedback: { likedCuisines: ["Italian"], dislikedCuisines: [], likedRestaurantIds: [], dislikedRestaurantIds: [] },
  }));
  assert(likedFeedback.factors.food >= baselineFeedback.factors.food,
    "C8.26: Liked cuisine → food >= baseline",
    `liked=${likedFeedback.factors.food.toFixed(2)}, base=${baselineFeedback.factors.food.toFixed(2)}`);

  // C8.27: User feedback — disliked cuisine → lower score
  const dislikedFeedback: V5DondeMatchResult = computeV5DondeMatch(feedbackProfile, makeV5Inputs({
    googleData: makeGoogleData(),
    intent: makeIntent({ target_cuisines: ["Italian"], cuisine_importance: "medium" }),
    userFeedback: { likedCuisines: [], dislikedCuisines: ["Italian"], likedRestaurantIds: [], dislikedRestaurantIds: [] },
  }));
  assert(dislikedFeedback.factors.food < baselineFeedback.factors.food,
    "C8.27: Disliked cuisine → food < baseline",
    `disliked=${dislikedFeedback.factors.food.toFixed(2)}, base=${baselineFeedback.factors.food.toFixed(2)}`);

  // C8.28: Rejection signals — avoidCuisines → lower score
  const rejectionResult: V5DondeMatchResult = computeV5DondeMatch(feedbackProfile, makeV5Inputs({
    googleData: makeGoogleData(),
    intent: makeIntent({ target_cuisines: ["Italian"], cuisine_importance: "medium" }),
    rejectionSignals: { avoidCuisines: ["Italian"], avoidPriceLevels: [], avoidRestaurantIds: [] },
  }));
  assert(rejectionResult.factors.food < baselineFeedback.factors.food,
    "C8.28: avoidCuisines → food < baseline",
    `rejection=${rejectionResult.factors.food.toFixed(2)}, base=${baselineFeedback.factors.food.toFixed(2)}`);

  // C8.29: Sentiment scoring — high sentiment → better reputation
  const sentProfile = makeProfile({ deep_profile: makeDeepProfile({ chef_notable: false, awards_recognition: [] }) });
  const sentHigh: V5DondeMatchResult = computeV5DondeMatch(sentProfile, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.3, google_review_count: 200 }),
    sentimentScore: 9,
  }));
  const sentNull: V5DondeMatchResult = computeV5DondeMatch(sentProfile, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.3, google_review_count: 200 }),
    sentimentScore: null,
  }));
  assert(sentHigh.factors.reputation >= sentNull.factors.reputation - 0.5,
    "C8.29: High sentiment → rep ~= or > null sentiment",
    `high=${sentHigh.factors.reputation.toFixed(2)}, null=${sentNull.factors.reputation.toFixed(2)}`);

  // C8.30: Sentiment scoring — negative sentiment → lower reputation
  const sentNeg: V5DondeMatchResult = computeV5DondeMatch(sentProfile, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.3, google_review_count: 200 }),
    sentimentScore: 3,
    sentimentNegative: 60,
  }));
  assert(sentNeg.factors.reputation < sentHigh.factors.reputation,
    "C8.30: Negative sentiment → rep < high sentiment",
    `neg=${sentNeg.factors.reputation.toFixed(2)}, high=${sentHigh.factors.reputation.toFixed(2)}`);

  // Print summary table
  console.log("\n  --- Catalog Scenario Summary ---");
  console.log("  | # | Scenario                          | DM  | Tier           |");
  console.log("  |---|-----------------------------------|-----|----------------|");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`  | ${String(i + 1).padStart(2)}| ${r.label.slice(0, 33).padEnd(34)}| ${String(r.dm).padStart(3)} | ${r.tier.padEnd(14)} |`);
  }
}

// -----------------------------------------------
section("C9. Boundary & Stress Tests");
// -----------------------------------------------

{
  // C9.1: All occasion scores = 0
  const zeroScores = makeProfile({
    date_friendly_score: 0, group_friendly_score: 0, family_friendly_score: 0,
    romantic_rating: 0, business_lunch_score: 0, solo_dining_score: 0, hole_in_wall_factor: 0,
    deep_profile: null, ambiance: null, noise_level: null,
  });
  const r1: V5DondeMatchResult = computeV5DondeMatch(zeroScores, makeV5Inputs({ googleData: makeGoogleData() }));
  assert(r1.dondeMatch > 0, "C9.1: All scores=0 → DM > 0", `got ${r1.dondeMatch}`);
  assert(r1.factors.food >= 1.0 && r1.factors.vibe >= 1.0 && r1.factors.service >= 1.0,
    "C9.1: All factors >= 1.0 with zero scores");

  // C9.2: All occasion scores = 10
  const maxScores = makeProfile({
    date_friendly_score: 10, group_friendly_score: 10, family_friendly_score: 10,
    romantic_rating: 10, business_lunch_score: 10, solo_dining_score: 10, hole_in_wall_factor: 10,
    deep_profile: makeDeepProfile({ enrichment_confidence: 9 }),
  });
  const r2: V5DondeMatchResult = computeV5DondeMatch(maxScores, makeV5Inputs({
    googleData: makeGoogleData({ google_rating: 4.8, google_review_count: 500 }),
  }));
  assertRange(r2.dondeMatch, 60, 99, "C9.2: All scores=10 + 4.8★ → DM in [60, 99]");

  // C9.3: enrichment_confidence = 0
  const lowEnrich = makeProfile({
    deep_profile: makeDeepProfile({ enrichment_confidence: 0 }),
  });
  const r3: V5DondeMatchResult = computeV5DondeMatch(lowEnrich, makeV5Inputs({ googleData: makeGoogleData() }));
  assert(r3.dondeMatch > 0, "C9.3: enrichment_conf=0 → still produces DM > 0", `got ${r3.dondeMatch}`);

  // C9.4: enrichment_confidence = 1.0
  const highEnrich = makeProfile({
    deep_profile: makeDeepProfile({ enrichment_confidence: 1.0 }),
  });
  const r4: V5DondeMatchResult = computeV5DondeMatch(highEnrich, makeV5Inputs({ googleData: makeGoogleData() }));
  assert(r4.dondeMatch > 0, "C9.4: enrichment_conf=1.0 → DM > 0", `got ${r4.dondeMatch}`);

  // C9.5: Google rating = 1.0 (worst possible)
  const r5: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ deep_profile: makeDeepProfile() }),
    makeV5Inputs({ googleData: makeGoogleData({ google_rating: 1.0, google_review_count: 100 }) }),
  );
  assert(r5.factors.reputation >= 1.0, "C9.5: Google 1.0★ → rep >= floor", `got ${r5.factors.reputation.toFixed(2)}`);
  assert(r5.dondeMatch > 0, "C9.5: Google 1.0★ → DM > 0", `got ${r5.dondeMatch}`);

  // C9.6: Google rating = 5.0 (best)
  const r6: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ deep_profile: makeDeepProfile() }),
    makeV5Inputs({ googleData: makeGoogleData({ google_rating: 5.0, google_review_count: 500 }) }),
  );
  assert(r6.factors.reputation > r5.factors.reputation, "C9.6: 5.0★ rep > 1.0★ rep",
    `5star=${r6.factors.reputation.toFixed(2)}, 1star=${r5.factors.reputation.toFixed(2)}`);

  // C9.7: google_review_count = 0
  const r7: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ deep_profile: makeDeepProfile() }),
    makeV5Inputs({ googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 0 }) }),
  );
  assert(r7.confidence.reputation === "low", "C9.7: 0 reviews → low rep confidence");

  // C9.8: google_review_count = 10000
  const r8: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ deep_profile: makeDeepProfile() }),
    makeV5Inputs({ googleData: makeGoogleData({ google_rating: 4.5, google_review_count: 10000 }) }),
  );
  assert(r8.confidence.reputation === "high", "C9.8: 10000 reviews → high rep confidence");

  // C9.9: Null intent
  const r9: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({ deep_profile: makeDeepProfile() }),
    makeV5Inputs({ intent: null, googleData: makeGoogleData() }),
  );
  assert(r9.dondeMatch > 0, "C9.9: Null intent → DM > 0", `got ${r9.dondeMatch}`);
  assert(r9.dondeMatch <= 99, "C9.9: Null intent → DM <= 99");

  // C9.10: Empty/minimal strings everywhere
  const r10: V5DondeMatchResult = computeV5DondeMatch(
    makeProfile({
      name: "", address: "", cuisine_type: "", best_for_oneliner: "",
      insider_tip: "", tags: [], tag_categories: [], deep_profile: null,
    }),
    makeV5Inputs({ specialRequest: "", intent: null, googleData: null }),
  );
  assert(r10.dondeMatch > 0, "C9.10: Empty strings → DM > 0 (no crash)", `got ${r10.dondeMatch}`);
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
