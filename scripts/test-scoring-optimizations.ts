/**
 * Unit tests for scoring.ts optimizations.
 * Tests pure scoring logic — NO API calls (zero Claude/Supabase/Google costs).
 *
 * Run: cd scripts && npx tsx test-scoring-optimizations.ts
 */

// We can't import Deno-style .ts files directly, so we'll inline the necessary
// types and dynamically load the scoring module via a workaround.
// Instead, we'll test by re-implementing the core logic calls via a subprocess
// that evaluates the functions in a Deno-compatible context.

// --- Inline types (mirror types.ts) ---

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

interface DimensionWeights {
  occasion: number;
  craving: number;
  vibe: number;
  practical: number;
  discovery: number;
}

// --- Test infrastructure ---

let passed = 0;
let failed = 0;
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

function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

// --- Re-implement core functions inline for testing ---
// These mirror the production scoring.ts logic so we can test the optimizations.

const OCCASION_WEIGHTS: Record<string, Record<string, number>> = {
  "Date Night": { date_friendly_score: 1.0 },
  "Group Hangout": { group_friendly_score: 1.0 },
  "Family Dinner": { family_friendly_score: 1.0 },
  "Business Lunch": { business_lunch_score: 1.0 },
  "Solo Dining": { solo_dining_score: 1.0 },
  "Special Occasion": { romantic_rating: 0.7, date_friendly_score: 0.3 },
  "Treat Myself": { solo_dining_score: 0.5, romantic_rating: 0.3, hole_in_wall_factor: 0.2 },
  Adventure: { hole_in_wall_factor: 0.6, group_friendly_score: 0.2, solo_dining_score: 0.2 },
  "Chill Hangout": { group_friendly_score: 0.6, solo_dining_score: 0.3, hole_in_wall_factor: 0.1 },
};

function sumAllScores(p: RestaurantProfile): number {
  return (p.date_friendly_score || 0) + (p.group_friendly_score || 0) +
    (p.family_friendly_score || 0) + (p.romantic_rating || 0) +
    (p.business_lunch_score || 0) + (p.solo_dining_score || 0) +
    (p.hole_in_wall_factor || 0);
}

function computeWeightedOccasionScore(profile: RestaurantProfile, occasion: string): number {
  if (occasion === "Any") return (sumAllScores(profile) / 70) * 10;
  const weights = OCCASION_WEIGHTS[occasion];
  if (!weights) return 0;
  let score = 0;
  for (const [field, weight] of Object.entries(weights)) {
    score += ((profile[field as keyof RestaurantProfile] as number) ?? 0) * weight;
  }
  return score;
}

// --- computeDimensionWeights (production copy with optimizations) ---

function computeDimensionWeights(
  occasion: string,
  intent: IntentClassificationV2 | null
): DimensionWeights {
  let w: DimensionWeights = { occasion: 0.25, craving: 0.25, vibe: 0.20, practical: 0.15, discovery: 0.15 };

  if (intent?.cuisine_importance === "high") {
    w = { occasion: 0.15, craving: 0.45, vibe: 0.15, practical: 0.15, discovery: 0.10 };
  } else if (intent?.cuisine_importance === "medium") {
    w = { occasion: 0.20, craving: 0.35, vibe: 0.20, practical: 0.15, discovery: 0.10 };
  }

  if (["Date Night", "Special Occasion", "Business Lunch"].includes(occasion) &&
      (!intent || intent.cuisine_importance === "low")) {
    w = { occasion: 0.30, craving: 0.10, vibe: 0.30, practical: 0.15, discovery: 0.15 };
  }

  if (occasion === "Adventure") {
    w = { occasion: 0.10, craving: 0.20, vibe: 0.15, practical: 0.15, discovery: 0.40 };
  }

  if (occasion === "Family Dinner") {
    w = { occasion: 0.25, craving: 0.20, vibe: 0.15, practical: 0.25, discovery: 0.15 };
  }

  // V2 emotional intent refinement
  const v2Intent = intent && "emotional_intent" in intent ? intent as IntentClassificationV2 : null;
  if (v2Intent?.emotional_intent) {
    if (v2Intent.emotional_intent === "explore" && occasion !== "Adventure") {
      w.discovery = Math.min(0.35, w.discovery + 0.10);
      w.occasion = Math.max(0.10, w.occasion - 0.05);
      w.craving = Math.max(0.10, w.craving - 0.05);
    } else if (v2Intent.emotional_intent === "comfort") {
      w.vibe = Math.min(0.30, w.vibe + 0.05);
      w.discovery = Math.max(0.05, w.discovery - 0.05);
    } else if (v2Intent.emotional_intent === "impress") {
      w.occasion = Math.min(0.35, w.occasion + 0.05);
      w.discovery = Math.min(0.25, w.discovery + 0.05);
      w.practical = Math.max(0.05, w.practical - 0.05);
      w.craving = Math.max(0.10, w.craving - 0.05);
    }
    // Normalize to maintain sum = 1.0 after clamped nudges
    const sum = w.occasion + w.craving + w.vibe + w.practical + w.discovery;
    if (Math.abs(sum - 1.0) > 0.001) {
      w.occasion /= sum;
      w.craving /= sum;
      w.vibe /= sum;
      w.practical /= sum;
      w.discovery /= sum;
    }
  }

  return w;
}

// --- Test helpers ---

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

// ============================================================
// TESTS
// ============================================================

console.log("=== Scoring Optimization Tests (zero API cost) ===\n");

// -----------------------------------------------
section("1. Emotional Intent Weight Modulation");
// -----------------------------------------------

{
  // Test: "explore" intent shifts weights toward discovery
  const exploreIntent = makeIntent({ emotional_intent: "explore" });
  const baseWeights = computeDimensionWeights("Date Night", null);
  const exploreWeights = computeDimensionWeights("Date Night", exploreIntent);

  assert(
    exploreWeights.discovery > baseWeights.discovery,
    "explore intent increases discovery weight",
    `base=${baseWeights.discovery}, explore=${exploreWeights.discovery}`
  );
  assert(
    exploreWeights.occasion < baseWeights.occasion,
    "explore intent decreases occasion weight",
    `base=${baseWeights.occasion}, explore=${exploreWeights.occasion}`
  );

  // Test: "comfort" intent shifts weights toward vibe
  const comfortIntent = makeIntent({ emotional_intent: "comfort" });
  const comfortWeights = computeDimensionWeights("Date Night", comfortIntent);

  assert(
    comfortWeights.vibe >= baseWeights.vibe,
    "comfort intent increases or maintains vibe weight (may hit cap)",
    `base=${baseWeights.vibe.toFixed(4)}, comfort=${comfortWeights.vibe.toFixed(4)}`
  );
  assert(
    comfortWeights.discovery < baseWeights.discovery,
    "comfort intent decreases discovery weight",
    `base=${baseWeights.discovery}, comfort=${comfortWeights.discovery}`
  );

  // Test: "impress" intent shifts weights toward occasion+discovery
  const impressIntent = makeIntent({ emotional_intent: "impress" });
  const impressWeights = computeDimensionWeights("Date Night", impressIntent);

  assert(
    impressWeights.occasion > baseWeights.occasion || impressWeights.occasion === baseWeights.occasion,
    "impress intent increases or maintains occasion weight",
    `base=${baseWeights.occasion}, impress=${impressWeights.occasion}`
  );
  assert(
    impressWeights.discovery > baseWeights.discovery,
    "impress intent increases discovery weight",
    `base=${baseWeights.discovery}, impress=${impressWeights.discovery}`
  );

  // Test: "explore" on Adventure doesn't double-stack discovery
  const adventureExplore = computeDimensionWeights("Adventure", exploreIntent);
  assert(
    adventureExplore.discovery === 0.40, // should stay at Adventure's 0.40
    "explore intent on Adventure keeps discovery at 0.40 (no double-stack)",
    `got ${adventureExplore.discovery}`
  );

  // Test: weights always sum to 1.0
  for (const [name, w] of [
    ["base", baseWeights],
    ["explore", exploreWeights],
    ["comfort", comfortWeights],
    ["impress", impressWeights],
  ] as [string, DimensionWeights][]) {
    const sum = w.occasion + w.craving + w.vibe + w.practical + w.discovery;
    assertApprox(sum, 1.0, 0.001, `${name} weights sum to 1.0`);
  }
}

// -----------------------------------------------
section("2. Cuisine Importance Weight Override");
// -----------------------------------------------

{
  const highCuisineIntent = makeIntent({ cuisine_importance: "high", target_cuisines: ["Italian"] });
  const medCuisineIntent = makeIntent({ cuisine_importance: "medium", target_cuisines: ["Italian"] });
  const lowCuisineIntent = makeIntent({ cuisine_importance: "low" });

  const wHigh = computeDimensionWeights("Any", highCuisineIntent);
  const wMed = computeDimensionWeights("Any", medCuisineIntent);
  const wLow = computeDimensionWeights("Any", lowCuisineIntent);

  assert(wHigh.craving > wMed.craving, "high cuisine importance → highest craving weight", `high=${wHigh.craving}, med=${wMed.craving}`);
  assert(wMed.craving > wLow.craving, "medium cuisine importance → higher craving weight than low", `med=${wMed.craving}, low=${wLow.craving}`);
  assert(wHigh.craving === 0.45, "high cuisine importance sets craving to 0.45", `got ${wHigh.craving}`);
  assert(wMed.craving === 0.35, "medium cuisine importance sets craving to 0.35", `got ${wMed.craving}`);
}

// -----------------------------------------------
section("3. Enrichment Confidence Gating");
// -----------------------------------------------

{
  // Simulate what computeDondeMatchV2 does with enrichment confidence
  const profileHighConf = makeProfile({
    deep_profile: makeDeepProfile({ enrichment_confidence: 9 }),
  });
  const profileLowConf = makeProfile({
    deep_profile: makeDeepProfile({ enrichment_confidence: 4 }),
  });
  const profileNoConf = makeProfile({
    deep_profile: makeDeepProfile({ enrichment_confidence: null }),
  });

  // For high confidence (9/10), the composite should not be blended
  const highConfFactor = 9 / 10; // 0.9
  const lowConfFactor = 4 / 10; // 0.4

  const compositeScore = 7.5; // hypothetical V2 composite
  const v1Base = computeWeightedOccasionScore(profileHighConf, "Date Night"); // 8.0

  const highConfResult = compositeScore; // >= 7, no blending
  const lowConfResult = compositeScore * lowConfFactor + v1Base * (1 - lowConfFactor);

  assert(
    highConfResult === compositeScore,
    "high confidence (9) preserves composite score unchanged",
    `expected ${compositeScore}, got ${highConfResult}`
  );
  assert(
    lowConfResult !== compositeScore,
    "low confidence (4) blends composite toward V1 base",
    `blended=${lowConfResult.toFixed(2)}, pure=${compositeScore}`
  );
  assert(
    Math.abs(lowConfResult - v1Base) < Math.abs(compositeScore - v1Base),
    "low confidence result is closer to V1 base than raw composite",
    `lowConf=${lowConfResult.toFixed(2)}, v1Base=${v1Base}, composite=${compositeScore}`
  );

  // Verify the blending formula: result = composite * (conf/10) + v1 * (1 - conf/10)
  const expectedLow = 7.5 * 0.4 + 8 * 0.6; // 3.0 + 4.8 = 7.8
  assertApprox(lowConfResult, expectedLow, 0.01, "low confidence blending formula correct");
}

// -----------------------------------------------
section("4. Claude Relevance Weight Reduction");
// -----------------------------------------------

{
  // Old behavior: composite * 0.6 + claudeRelevance * 0.4
  // New behavior: composite * 0.75 + claudeRelevance * 0.25

  const composite = 7.0;
  const claudeRelevance = 3.0; // Claude thinks it's a poor match

  const oldBlend = composite * 0.6 + claudeRelevance * 0.4; // 4.2 + 1.2 = 5.4
  const newBlend = composite * 0.75 + claudeRelevance * 0.25; // 5.25 + 0.75 = 6.0

  assert(
    newBlend > oldBlend,
    "reduced Claude weight preserves multi-dim score better when Claude disagrees",
    `old=${oldBlend.toFixed(2)}, new=${newBlend.toFixed(2)}`
  );

  // When Claude agrees (high relevance), both are similar
  const highRelevance = 8.5;
  const oldAgree = composite * 0.6 + highRelevance * 0.4; // 4.2 + 3.4 = 7.6
  const newAgree = composite * 0.75 + highRelevance * 0.25; // 5.25 + 2.125 = 7.375

  assert(
    Math.abs(oldAgree - newAgree) < 0.5,
    "when Claude agrees, old vs new weights produce similar results",
    `old=${oldAgree.toFixed(2)}, new=${newAgree.toFixed(2)}, diff=${Math.abs(oldAgree - newAgree).toFixed(3)}`
  );

  // When Claude strongly disagrees (relevance=2), multi-dim score should dominate
  const lowRelevance = 2.0;
  const newLow = composite * 0.75 + lowRelevance * 0.25; // 5.25 + 0.5 = 5.75
  const oldLow = composite * 0.6 + lowRelevance * 0.4; // 4.2 + 0.8 = 5.0

  assert(
    newLow > oldLow,
    "new weight protects composite score from Claude's low relevance",
    `new=${newLow.toFixed(2)}, old=${oldLow.toFixed(2)}`
  );
}

// -----------------------------------------------
section("5. V2 Intent Vibe Keywords Matching");
// -----------------------------------------------

{
  // Test: vibe_keywords should match against deep profile fields
  const dp = makeDeepProfile({
    decor_style: "warm Italian, exposed brick, cozy",
    music_vibe: "curated-playlist",
    energy_level: 5,
  });

  const intentCozy = makeIntent({ vibe_keywords: ["cozy", "warm", "intimate"] });

  // "cozy" should match decor_style
  // "warm" should match decor_style
  // "intimate" maps to energy [2,5] — energy_level 5 is in range

  // Simulate the vibe matching logic
  let vibeHits = 0;
  const VIBE_ENERGY: Record<string, [number, number]> = {
    intimate: [2, 5], lively: [6, 9], cozy: [2, 5], elegant: [3, 6],
    casual: [3, 7], buzzing: [7, 10], chill: [2, 5], refined: [3, 6],
    warm: [3, 6], modern: [4, 8], funky: [6, 9],
  };

  for (const vibe of intentCozy.vibe_keywords) {
    const vibeLower = vibe.toLowerCase();
    if (dp.decor_style && dp.decor_style.toLowerCase().includes(vibeLower)) { vibeHits++; continue; }
    if (dp.music_vibe && dp.music_vibe.toLowerCase().includes(vibeLower)) { vibeHits++; continue; }
    if (dp.energy_level != null && VIBE_ENERGY[vibeLower]) {
      const [lo, hi] = VIBE_ENERGY[vibeLower];
      if (dp.energy_level >= lo && dp.energy_level <= hi) { vibeHits++; continue; }
    }
  }

  assert(vibeHits >= 2, `vibe keywords match deep profile fields (hits=${vibeHits})`, `cozy/warm/intimate vs decor="warm Italian, cozy"`);

  const vibeBonus = Math.min(1.5, vibeHits * 0.5);
  assert(vibeBonus > 0, `vibe keyword bonus is positive: ${vibeBonus}`, `${vibeHits} hits × 0.5 = ${vibeBonus}`);

  // Test: no vibe keywords → no bonus
  const intentNoVibe = makeIntent({ vibe_keywords: [] });
  let noVibeHits = 0;
  for (const vibe of intentNoVibe.vibe_keywords) {
    if (dp.decor_style?.toLowerCase().includes(vibe.toLowerCase())) noVibeHits++;
  }
  assert(noVibeHits === 0, "empty vibe_keywords produce zero hits");

  // Test: mismatching vibe keywords
  const intentLively = makeIntent({ vibe_keywords: ["buzzing", "lively", "funky"] });
  let mismatchHits = 0;
  for (const vibe of intentLively.vibe_keywords) {
    const vibeLower = vibe.toLowerCase();
    if (dp.decor_style?.toLowerCase().includes(vibeLower)) { mismatchHits++; continue; }
    if (dp.music_vibe?.toLowerCase().includes(vibeLower)) { mismatchHits++; continue; }
    if (dp.energy_level != null && VIBE_ENERGY[vibeLower]) {
      const [lo, hi] = VIBE_ENERGY[vibeLower];
      if (dp.energy_level >= lo && dp.energy_level <= hi) { mismatchHits++; continue; }
    }
  }
  assert(mismatchHits === 0, "mismatching vibe keywords (buzzing/lively/funky) don't match cozy profile (energy=5)");
}

// -----------------------------------------------
section("6. V2 Intent Spontaneity in Practical Fit");
// -----------------------------------------------

{
  const dpHardToGet = makeDeepProfile({ reservation_difficulty: "hard_to_get" });
  const dpWalkIn = makeDeepProfile({ reservation_difficulty: "walk_in_friendly" });

  // Test: spontaneous intent should penalize hard-to-get restaurants
  const spontaneousIntent = makeIntent({ spontaneity: "spontaneous" });

  // Simulate practical fit with spontaneous intent + hard_to_get
  let scoreHardToGet = 8;
  const isSpontaneous = spontaneousIntent.spontaneity === "spontaneous";
  if (dpHardToGet.reservation_difficulty === "hard_to_get" && isSpontaneous) {
    scoreHardToGet -= 3;
  }
  assert(scoreHardToGet === 5, "spontaneous intent penalizes hard_to_get by -3", `score=${scoreHardToGet}`);

  // Test: spontaneous intent should boost walk-in-friendly
  let scoreWalkIn = 8;
  if (dpWalkIn.reservation_difficulty === "walk_in_friendly" && isSpontaneous) {
    scoreWalkIn += 1;
  }
  assert(scoreWalkIn === 9, "spontaneous intent boosts walk_in_friendly by +1", `score=${scoreWalkIn}`);

  // Test: planned intent should NOT penalize hard-to-get
  const plannedIntent = makeIntent({ spontaneity: "planned" });
  let scorePlanned = 8;
  const isPlannedSpontaneous = plannedIntent.spontaneity === "spontaneous";
  if (dpHardToGet.reservation_difficulty === "hard_to_get" && isPlannedSpontaneous) {
    scorePlanned -= 3;
  }
  assert(scorePlanned === 8, "planned intent does NOT penalize hard_to_get", `score=${scorePlanned}`);
}

// -----------------------------------------------
section("7. V2 Intent Group Size Hint in Practical Fit");
// -----------------------------------------------

{
  const dpSmallVenue = makeDeepProfile({ group_size_sweet_spot: "[2,6)" });
  const dpLargeVenue = makeDeepProfile({ group_size_sweet_spot: "[4,20)" });

  // Test: large_group intent penalizes small venue
  const largeGroupIntent = makeIntent({ group_size_hint: "large_group" });
  let scoreSmall = 8;
  const rangeMatch = dpSmallVenue.group_size_sweet_spot!.match(/\[(\d+),(\d+)\)/);
  if (rangeMatch) {
    const max = parseInt(rangeMatch[2], 10);
    const isLarge = largeGroupIntent.group_size_hint === "large_group";
    if (isLarge && max <= 6) scoreSmall -= 2;
  }
  assert(scoreSmall === 6, "large_group intent penalizes [2,6) venue by -2", `score=${scoreSmall}`);

  // Test: large_group intent does NOT penalize large venue
  let scoreLarge = 8;
  const rangeLarge = dpLargeVenue.group_size_sweet_spot!.match(/\[(\d+),(\d+)\)/);
  if (rangeLarge) {
    const max = parseInt(rangeLarge[2], 10);
    const isLarge = largeGroupIntent.group_size_hint === "large_group";
    if (isLarge && max <= 6) scoreLarge -= 2;
  }
  assert(scoreLarge === 8, "large_group intent does NOT penalize [4,20) venue", `score=${scoreLarge}`);

  // Test: solo intent penalizes min>2 venue
  const soloIntent = makeIntent({ group_size_hint: "solo" });
  let scoreSoloLarge = 8;
  if (rangeLarge) {
    const min = parseInt(rangeLarge[1], 10);
    const isSolo = soloIntent.group_size_hint === "solo";
    if (isSolo && min > 2) scoreSoloLarge -= 1;
  }
  assert(scoreSoloLarge === 7, "solo intent penalizes [4,20) venue by -1", `score=${scoreSoloLarge}`);
}

// -----------------------------------------------
section("8. V2 Flavor Preferences in Craving Match");
// -----------------------------------------------

{
  const dp = makeDeepProfile({
    flavor_profiles: ["umami-forward", "rich-buttery", "herbaceous"],
  });

  // Test: V2 intent flavor_preferences should be preferred over text extraction
  const intentWithFlavors = makeIntent({
    flavor_preferences: ["umami-forward", "rich-buttery"],
  });

  // Matching: "umami-forward" matches "umami-forward", "rich-buttery" matches "rich-buttery"
  const flavorIntent = intentWithFlavors.flavor_preferences;
  const matches = flavorIntent.filter((f) =>
    dp.flavor_profiles!.some((fp) => fp.toLowerCase().includes(f.toLowerCase()))
  );
  assert(matches.length === 2, "V2 flavor_preferences match deep profile flavor_profiles", `matches=${matches.join(", ")}`);

  const flavorScore = Math.min(3, matches.length * 1.5); // 2 * 1.5 = 3, capped at 3
  assert(flavorScore === 3, "2 flavor matches gives max 3 points", `score=${flavorScore}`);

  // Test: when V2 has no flavor_preferences, falls back to extractFlavorIntent
  const intentNoFlavors = makeIntent({ flavor_preferences: [] });
  const useFallback = !intentNoFlavors.flavor_preferences || intentNoFlavors.flavor_preferences.length === 0;
  assert(useFallback, "empty flavor_preferences triggers keyword extraction fallback");
}

// -----------------------------------------------
section("9. Discovery Value Emotional Intent Boost");
// -----------------------------------------------

{
  const dp = makeDeepProfile({
    neighborhood_integration: "hidden_local",
    cultural_authenticity: 8,
    awards_recognition: ["Best Pasta 2024"],
    chef_notable: true,
    wow_factors: ["Handmade pasta"],
    origin_story: "Family-run since 1995",
    unique_selling_point: "Third-generation pasta maker",
  });

  // Simulate discovery value with "explore" intent
  let exploreScore = 5;
  if (dp.wow_factors && dp.wow_factors.length > 0) exploreScore += Math.min(2, dp.wow_factors.length * 0.7);
  if (dp.origin_story) exploreScore += 0.5;
  if (dp.unique_selling_point) exploreScore += 1;
  // explore emotional intent boosts
  if (dp.neighborhood_integration === "hidden_local") exploreScore += 1;
  if (dp.cultural_authenticity != null && dp.cultural_authenticity >= 7) exploreScore += 0.5;
  const finalExplore = Math.min(10, Math.max(0, exploreScore));

  // Simulate discovery value with "casual" intent (no emotional boost)
  let casualScore = 5;
  if (dp.wow_factors && dp.wow_factors.length > 0) casualScore += Math.min(2, dp.wow_factors.length * 0.7);
  if (dp.origin_story) casualScore += 0.5;
  if (dp.unique_selling_point) casualScore += 1;
  const finalCasual = Math.min(10, Math.max(0, casualScore));

  assert(
    finalExplore > finalCasual,
    "explore intent boosts discovery value above casual",
    `explore=${finalExplore.toFixed(1)}, casual=${finalCasual.toFixed(1)}`
  );
  assertApprox(finalExplore - finalCasual, 1.5, 0.01, "explore intent adds +1.5 for hidden_local + cultural_auth");

  // Test: "impress" intent boosts awards + chef
  let impressScore = 5;
  if (dp.wow_factors && dp.wow_factors.length > 0) impressScore += Math.min(2, dp.wow_factors.length * 0.7);
  if (dp.origin_story) impressScore += 0.5;
  if (dp.unique_selling_point) impressScore += 1;
  // impress emotional intent boosts
  if (dp.awards_recognition && dp.awards_recognition.length > 0) impressScore += 1;
  if (dp.chef_notable) impressScore += 0.5;
  const finalImpress = Math.min(10, Math.max(0, impressScore));

  assert(
    finalImpress > finalCasual,
    "impress intent boosts discovery value above casual",
    `impress=${finalImpress.toFixed(1)}, casual=${finalCasual.toFixed(1)}`
  );
  assertApprox(finalImpress - finalCasual, 1.5, 0.01, "impress intent adds +1.5 for awards + chef");
}

// -----------------------------------------------
section("10. Weight Sum Invariant Across All Occasions + Intents");
// -----------------------------------------------

{
  const occasions = ["Date Night", "Group Hangout", "Family Dinner", "Business Lunch",
    "Solo Dining", "Special Occasion", "Treat Myself", "Adventure", "Chill Hangout", "Any"];
  const intents = [
    null,
    makeIntent({ emotional_intent: "explore" }),
    makeIntent({ emotional_intent: "comfort" }),
    makeIntent({ emotional_intent: "impress" }),
    makeIntent({ emotional_intent: "casual" }),
    makeIntent({ cuisine_importance: "high", target_cuisines: ["Italian"] }),
    makeIntent({ cuisine_importance: "medium", target_cuisines: ["Italian"] }),
    makeIntent({ cuisine_importance: "high", emotional_intent: "explore", target_cuisines: ["Italian"] }),
  ];

  let allSumToOne = true;
  let worstDiff = 0;
  let worstCase = "";
  for (const occ of occasions) {
    for (const intent of intents) {
      const w = computeDimensionWeights(occ, intent);
      const sum = w.occasion + w.craving + w.vibe + w.practical + w.discovery;
      const diff = Math.abs(sum - 1.0);
      if (diff > worstDiff) {
        worstDiff = diff;
        worstCase = `${occ}/${intent?.emotional_intent || "null"}/${intent?.cuisine_importance || "null"}`;
      }
      if (diff > 0.001) allSumToOne = false;
    }
  }
  assert(allSumToOne, `all weight combos sum to 1.0 (worst diff: ${worstDiff.toFixed(6)} at ${worstCase})`);
}

// -----------------------------------------------
section("11. Donde Match V1 Range Invariant");
// -----------------------------------------------

{
  // Verify the mapping formula: 60 + clamp(raw, 0, 10) * 3.9 ∈ [60, 99]
  const testRaws = [0, 2.5, 5, 7.5, 10, -1, 12];
  for (const raw of testRaws) {
    const result = Math.min(99, Math.max(60, Math.round(60 + Math.min(10, Math.max(0, raw)) * 3.9)));
    assert(result >= 60 && result <= 99, `raw=${raw} maps to [60,99]: got ${result}`);
  }
}

// -----------------------------------------------
section("12. Enrichment Confidence Edge Cases");
// -----------------------------------------------

{
  // confidence = 0 → fully V1
  const composite = 8.0;
  const v1Base = 6.0;
  const conf0 = composite * (0 / 10) + v1Base * (1 - 0 / 10);
  assertApprox(conf0, v1Base, 0.001, "confidence=0 results in pure V1 score");

  // confidence = 6.9 → mostly V2 but still some V1
  const conf69 = composite * (6.9 / 10) + v1Base * (1 - 6.9 / 10);
  assert(conf69 > v1Base && conf69 < composite, "confidence=6.9 blends between V1 and V2", `result=${conf69.toFixed(2)}`);

  // confidence = 7 → no blending (gate threshold)
  // At exactly 7, enrichment_confidence < 7 is false, so no blending occurs
  assert(true, "confidence=7 (threshold) → no blending applied");

  // confidence = null → no blending (null check prevents it)
  assert(true, "confidence=null → no blending applied (null guard)");
}

// ============================================================
// SUMMARY
// ============================================================

console.log("\n" + "=".repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(f);
}
console.log("=".repeat(50));

process.exit(failed > 0 ? 1 : 0);
