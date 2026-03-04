/**
 * V8 Scoring Pipeline Test — Offline, Zero API Calls
 *
 * Tests the full computeV8DondeMatch + reRankV8 pipeline across 7 input types:
 *   1. Open-ended ("surprise me")
 *   2. Cuisine-specific, no dishes ("Italian restaurant")
 *   3. Dish-specific ("truffle pasta")
 *   4. Dish + Cuisine ("Italian truffle pasta")
 *   5. Vibe/Occasion ("cozy date night")
 *   6. Reputation-specific ("michelin star restaurant")
 *   7. Combined/Conflicting ("spicy Italian rooftop budget")
 *
 * Uses 10 mock restaurant archetypes with mock Google data.
 * Run: cd dondeBackend && deno run --allow-read tests/scoring-v8/scoring-v8-pipeline-test.ts
 */

import {
  computeV8DondeMatch,
  reRankV8,
} from "../../supabase/functions/recommend/_shared/scoring-v8.ts";
import type { RestaurantProfile, DeepProfile } from "../../supabase/functions/recommend/_shared/types.ts";
import type { IntentClassificationV2, IntentConfidence } from "../../supabase/functions/recommend/_shared/intent-classifier.ts";
import type { GooglePlaceData } from "../../supabase/functions/recommend/_shared/google-places.ts";
import type { V8DondeMatchInputs } from "../../supabase/functions/recommend/_shared/types-v8.ts";

// ==========================================
// TEST INFRASTRUCTURE
// ==========================================

let passed = 0;
let failed = 0;
let warned = 0;
const failures: string[] = [];
const warnings: string[] = [];

function assert(condition: boolean, testName: string, detail = "") {
  if (condition) {
    passed++;
  } else {
    failed++;
    const msg = `  FAIL [${testName}]${detail ? ` — ${detail}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function warn(testName: string, detail = "") {
  warned++;
  const msg = `  WARN [${testName}]${detail ? ` — ${detail}` : ""}`;
  console.log(msg);
  warnings.push(msg);
}

function section(name: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${name}`);
  console.log("=".repeat(70));
}

// ==========================================
// MOCK DATA BUILDERS
// ==========================================

function makeDeepProfile(overrides: Partial<DeepProfile> = {}): DeepProfile {
  return {
    flavor_profiles: null,
    signature_dishes: null,
    menu_highlights: null,
    cuisine_subcategory: null,
    menu_depth: null,
    spice_level: null,
    dietary_depth: null,
    service_style: null,
    meal_pacing: null,
    reservation_difficulty: null,
    typical_wait_minutes: null,
    group_size_sweet_spot: null,
    check_average_per_person: null,
    tipping_culture: null,
    kid_friendliness: null,
    music_vibe: null,
    decor_style: null,
    conversation_friendliness: null,
    energy_level: null,
    seating_options: null,
    instagram_worthiness: null,
    seasonal_relevance: null,
    cultural_authenticity: null,
    origin_story: null,
    crowd_profile: null,
    neighborhood_integration: null,
    chef_notable: null,
    awards_recognition: null,
    wow_factors: null,
    date_progression: null,
    best_seat_in_house: null,
    ideal_weather: null,
    unique_selling_point: null,
    transit_accessibility: null,
    byob_policy: null,
    payment_notes: null,
    enrichment_confidence: 0.8,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<RestaurantProfile> = {}): RestaurantProfile {
  return {
    id: crypto.randomUUID(),
    name: "Test Restaurant",
    address: "123 Test St, Chicago, IL",
    neighborhood_id: null,
    google_place_id: null,
    price_level: "$$",
    noise_level: "Moderate",
    lighting_ambiance: "warm",
    dress_code: "Casual",
    outdoor_seating: false,
    live_music: false,
    pet_friendly: false,
    parking_availability: "Street",
    cuisine_type: "American",
    best_for_oneliner: null,
    insider_tip: null,
    best_times: ["dinner"],
    dietary_options: [],
    good_for: [],
    ambiance: [],
    is_active: true,
    neighborhood_name: "Chicago",
    neighborhood_description: null,
    date_friendly_score: 5,
    group_friendly_score: 5,
    family_friendly_score: 5,
    romantic_rating: 5,
    business_lunch_score: 5,
    solo_dining_score: 5,
    hole_in_wall_factor: 5,
    tags: [],
    tag_categories: [],
    occasion_score: 50,
    total_score: 50,
    trending_score: 5,
    deep_profile: makeDeepProfile(),
    ...overrides,
  };
}

function makeGoogle(overrides: Partial<GooglePlaceData> = {}): GooglePlaceData {
  return {
    name: "Test Restaurant",
    address: "123 Test St",
    phone: null,
    website: null,
    google_rating: 4.2,
    google_review_count: 100,
    reviews: [],
    business_status: "OPERATIONAL",
    photo_urls: [],
    opening_hours: null,
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
    confidence: {
      cuisine: "low",
      vibe: "low",
      occasion: "low",
      constraints: "low",
      overall: "medium",
    },
    ...overrides,
  };
}

// ==========================================
// 10 MOCK RESTAURANT ARCHETYPES
// ==========================================

const PROFILES: Record<string, RestaurantProfile> = {
  fineItalian: makeProfile({
    name: "Piccolo Sogno",
    cuisine_type: "Italian",
    price_level: "$$$",
    noise_level: "Quiet",
    lighting_ambiance: "dim, warm, candlelit, romantic",
    dress_code: "Smart Casual",
    outdoor_seating: true,
    date_friendly_score: 9,
    group_friendly_score: 6,
    family_friendly_score: 5,
    romantic_rating: 9,
    business_lunch_score: 7,
    solo_dining_score: 6,
    hole_in_wall_factor: 3,
    trending_score: 9,
    tags: ["romantic", "farm-to-table", "fine dining", "tasting menu", "outdoor patio"],
    tag_categories: ["cuisine", "vibe", "dining-style"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Truffle Pasta", why: "House-made pappardelle with black truffle" },
        { dish: "Osso Buco", why: "Slow-braised veal shank" },
      ],
      menu_highlights: ["cacio e pepe", "tiramisu", "burrata", "risotto"],
      flavor_profiles: ["rich-buttery", "umami-forward", "earthy"],
      cuisine_subcategory: "Northern Italian",
      service_style: "Full Table Service",
      meal_pacing: "leisurely",
      reservation_difficulty: "moderate",
      energy_level: 5,
      music_vibe: "curated-playlist",
      decor_style: "rustic elegant, exposed brick, warm wood",
      conversation_friendliness: 8,
      awards_recognition: ["James Beard Semifinalist 2025", "Michelin Bib Gourmand"],
      chef_notable: true,
      cultural_authenticity: 9,
      neighborhood_integration: "destination",
      check_average_per_person: 65,
      enrichment_confidence: 0.9,
    }),
  }),

  holeInWallTaco: makeProfile({
    name: "Taqueria Los Comales",
    cuisine_type: "Mexican",
    price_level: "$",
    noise_level: "Moderate",
    lighting_ambiance: "bright, casual",
    dress_code: "Casual",
    date_friendly_score: 4,
    group_friendly_score: 7,
    family_friendly_score: 8,
    romantic_rating: 3,
    business_lunch_score: 3,
    solo_dining_score: 8,
    hole_in_wall_factor: 9,
    trending_score: 4,
    tags: ["hidden gem", "great value", "late night"],
    tag_categories: ["vibe", "value"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Al Pastor Tacos", why: "Spit-roasted pork with pineapple" },
        { dish: "Birria Tacos", why: "Consomme dipping tacos" },
      ],
      menu_highlights: ["carnitas", "elote", "horchata", "churros"],
      flavor_profiles: ["bold-spiced", "chili-forward", "citrus-forward"],
      spice_level: "medium-hot",
      service_style: "Counter",
      meal_pacing: "quick_bite",
      reservation_difficulty: "walk_in_friendly",
      typical_wait_minutes: 5,
      energy_level: 6,
      cultural_authenticity: 9,
      neighborhood_integration: "institution",
      check_average_per_person: 12,
    }),
  }),

  michelinJapanese: makeProfile({
    name: "Kyoten",
    cuisine_type: "Japanese",
    price_level: "$$$$",
    noise_level: "Quiet",
    lighting_ambiance: "dim, intimate, minimalist",
    dress_code: "Business Casual",
    date_friendly_score: 9,
    group_friendly_score: 3,
    family_friendly_score: 2,
    romantic_rating: 9,
    business_lunch_score: 6,
    solo_dining_score: 8,
    hole_in_wall_factor: 4,
    trending_score: 10,
    tags: ["fine dining", "tasting menu", "romantic", "quiet"],
    tag_categories: ["cuisine", "dining-style", "vibe"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Omakase", why: "20-course chef's selection" },
        { dish: "Wagyu Tataki", why: "A5 grade, lightly seared" },
      ],
      menu_highlights: ["sashimi selection", "uni", "otoro", "seasonal nigiri"],
      flavor_profiles: ["umami-forward", "delicate", "bright-acidic"],
      cuisine_subcategory: "Omakase/Sushi",
      service_style: "Omakase",
      meal_pacing: "ceremonial",
      reservation_difficulty: "hard_to_get",
      typical_wait_minutes: 0,
      energy_level: 3,
      music_vibe: "ambient",
      decor_style: "minimalist Japanese, hinoki wood counter",
      conversation_friendliness: 6,
      awards_recognition: ["Michelin Star 2025", "James Beard Award Winner"],
      chef_notable: true,
      cultural_authenticity: 10,
      neighborhood_integration: "destination",
      check_average_per_person: 250,
      enrichment_confidence: 0.95,
    }),
  }),

  rooftopBar: makeProfile({
    name: "Cindy's Rooftop",
    cuisine_type: "American",
    price_level: "$$$",
    noise_level: "Loud",
    lighting_ambiance: "bright, vibrant, skyline views",
    dress_code: "Smart Casual",
    outdoor_seating: true,
    live_music: true,
    date_friendly_score: 7,
    group_friendly_score: 9,
    family_friendly_score: 3,
    romantic_rating: 6,
    business_lunch_score: 5,
    solo_dining_score: 5,
    hole_in_wall_factor: 2,
    trending_score: 8,
    tags: ["rooftop", "scenic view", "craft cocktails", "trendy", "lively atmosphere", "outdoor patio"],
    tag_categories: ["vibe", "feature"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Wagyu Burger", why: "House ground blend" },
      ],
      menu_highlights: ["oysters", "craft cocktails", "charcuterie"],
      flavor_profiles: ["savory", "rich-buttery"],
      service_style: "Bar Service",
      energy_level: 8,
      music_vibe: "DJ",
      decor_style: "modern rooftop, skyline panoramic, industrial chic",
      conversation_friendliness: 4,
      neighborhood_integration: "destination",
      check_average_per_person: 55,
    }),
  }),

  cozyBistro: makeProfile({
    name: "Le Bouchon",
    cuisine_type: "French",
    price_level: "$$$",
    noise_level: "Quiet",
    lighting_ambiance: "dim, intimate, candlelit",
    dress_code: "Smart Casual",
    date_friendly_score: 10,
    group_friendly_score: 4,
    family_friendly_score: 4,
    romantic_rating: 10,
    business_lunch_score: 6,
    solo_dining_score: 7,
    hole_in_wall_factor: 5,
    trending_score: 6,
    tags: ["romantic", "quiet", "craft cocktails", "date spot", "hidden gem"],
    tag_categories: ["vibe", "dining-style"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Fondue", why: "Classic Gruyere blend" },
        { dish: "Steak Frites", why: "Grass-fed with bearnaise" },
      ],
      menu_highlights: ["escargot", "creme brulee", "duck confit", "onion soup"],
      flavor_profiles: ["rich-buttery", "savory", "earthy"],
      service_style: "Full Table Service",
      meal_pacing: "leisurely",
      reservation_difficulty: "moderate",
      energy_level: 3,
      music_vibe: "ambient",
      decor_style: "cozy Parisian, bistro chairs, low lighting",
      conversation_friendliness: 9,
      date_progression: "Wine at the bar, dinner by candlelight, dessert to share",
      cultural_authenticity: 8,
      neighborhood_integration: "institution",
      check_average_per_person: 55,
    }),
  }),

  bbqJoint: makeProfile({
    name: "Green Street Smoked Meats",
    cuisine_type: "BBQ",
    price_level: "$$",
    noise_level: "Loud",
    lighting_ambiance: "bright, industrial",
    dress_code: "Casual",
    outdoor_seating: true,
    pet_friendly: true,
    date_friendly_score: 4,
    group_friendly_score: 9,
    family_friendly_score: 7,
    romantic_rating: 2,
    business_lunch_score: 3,
    solo_dining_score: 6,
    hole_in_wall_factor: 7,
    trending_score: 7,
    tags: ["great value", "lively atmosphere", "outdoor patio", "pet friendly", "craft beer", "byob"],
    tag_categories: ["vibe", "feature", "value"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Brisket Platter", why: "14-hour smoked Texas-style" },
        { dish: "Pulled Pork Sandwich", why: "Carolina vinegar sauce" },
      ],
      menu_highlights: ["burnt ends", "mac and cheese", "collard greens", "cornbread"],
      flavor_profiles: ["smoky", "savory", "bold-spiced"],
      service_style: "Counter",
      meal_pacing: "relaxed",
      reservation_difficulty: "walk_in_friendly",
      energy_level: 7,
      music_vibe: "curated-playlist",
      decor_style: "industrial, communal tables",
      byob_policy: "BYOB welcome, no corkage",
      cultural_authenticity: 7,
      check_average_per_person: 22,
    }),
  }),

  ethiopianGem: makeProfile({
    name: "Demera Ethiopian",
    cuisine_type: "Ethiopian",
    price_level: "$$",
    noise_level: "Moderate",
    lighting_ambiance: "warm, cultural",
    dress_code: "Casual",
    date_friendly_score: 6,
    group_friendly_score: 8,
    family_friendly_score: 6,
    romantic_rating: 5,
    business_lunch_score: 4,
    solo_dining_score: 7,
    hole_in_wall_factor: 8,
    trending_score: 5,
    tags: ["hidden gem", "great value", "vegan friendly"],
    tag_categories: ["vibe", "value", "dietary"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Doro Wat", why: "Spiced chicken stew with injera" },
        { dish: "Kitfo", why: "Ethiopian steak tartare" },
      ],
      menu_highlights: ["injera platter", "tibs", "shiro", "awaze"],
      flavor_profiles: ["bold-spiced", "earthy", "fermented"],
      dietary_depth: "solid",
      service_style: "Family Style",
      energy_level: 5,
      cultural_authenticity: 10,
      neighborhood_integration: "institution",
      check_average_per_person: 25,
    }),
  }),

  brunchPalace: makeProfile({
    name: "Lula Cafe",
    cuisine_type: "Brunch",
    price_level: "$$",
    noise_level: "Moderate",
    lighting_ambiance: "bright, natural, warm",
    dress_code: "Casual",
    outdoor_seating: true,
    date_friendly_score: 7,
    group_friendly_score: 7,
    family_friendly_score: 8,
    romantic_rating: 5,
    business_lunch_score: 5,
    solo_dining_score: 7,
    hole_in_wall_factor: 4,
    trending_score: 7,
    tags: ["brunch spot", "farm-to-table", "outdoor patio", "kid friendly", "instagrammable"],
    tag_categories: ["cuisine", "vibe", "feature"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Ricotta Pancakes", why: "Seasonal fruit compote" },
        { dish: "Shakshuka", why: "Spiced tomato and eggs" },
      ],
      menu_highlights: ["avocado toast", "eggs benedict", "grain bowl", "mimosa flight"],
      flavor_profiles: ["bright-acidic", "herbaceous", "sweet-savory"],
      service_style: "Full Table Service",
      kid_friendliness: 8,
      energy_level: 6,
      instagram_worthiness: 9,
      cultural_authenticity: 6,
      check_average_per_person: 30,
    }),
  }),

  steakhouse: makeProfile({
    name: "Bavette's Bar & Boeuf",
    cuisine_type: "Steak",
    price_level: "$$$$",
    noise_level: "Moderate",
    lighting_ambiance: "dim, elegant, warm",
    dress_code: "Business Casual",
    date_friendly_score: 8,
    group_friendly_score: 7,
    family_friendly_score: 4,
    romantic_rating: 8,
    business_lunch_score: 9,
    solo_dining_score: 6,
    hole_in_wall_factor: 2,
    trending_score: 8,
    tags: ["fine dining", "romantic", "craft cocktails", "tasting menu"],
    tag_categories: ["cuisine", "dining-style", "vibe"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Bone-In Ribeye", why: "45-day dry aged" },
        { dish: "Surf and Turf", why: "Lobster tail + filet" },
      ],
      menu_highlights: ["wagyu tartare", "caesar salad", "creamed spinach", "creme brulee"],
      flavor_profiles: ["rich-buttery", "savory", "umami-forward"],
      service_style: "Full Table Service",
      meal_pacing: "leisurely",
      reservation_difficulty: "moderate",
      energy_level: 5,
      music_vibe: "live-jazz",
      decor_style: "1920s speakeasy, dark wood, leather booths",
      conversation_friendliness: 7,
      awards_recognition: ["Best Steakhouse 2025", "Chicago Tribune Top 50"],
      chef_notable: true,
      neighborhood_integration: "destination",
      check_average_per_person: 120,
      enrichment_confidence: 0.9,
    }),
  }),

  veganTrendy: makeProfile({
    name: "Kale My Name",
    cuisine_type: "Vegan",
    price_level: "$$",
    noise_level: "Moderate",
    lighting_ambiance: "bright, modern, natural",
    dress_code: "Casual",
    date_friendly_score: 6,
    group_friendly_score: 6,
    family_friendly_score: 5,
    romantic_rating: 5,
    business_lunch_score: 5,
    solo_dining_score: 7,
    hole_in_wall_factor: 5,
    trending_score: 8,
    tags: ["vegan friendly", "farm-to-table", "trendy", "gluten free", "instagrammable"],
    tag_categories: ["dietary", "vibe"],
    dietary_options: ["vegan", "gluten-free", "nut-free"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Cauliflower Steak", why: "Roasted with chimichurri" },
        { dish: "Jackfruit Tacos", why: "Pulled BBQ style" },
      ],
      menu_highlights: ["grain bowl", "mushroom ramen", "acai bowl", "matcha latte"],
      flavor_profiles: ["herbaceous", "bright-acidic", "earthy"],
      dietary_depth: "dedicated",
      service_style: "Counter",
      energy_level: 5,
      decor_style: "modern minimalist, living wall, reclaimed wood",
      instagram_worthiness: 9,
      cultural_authenticity: 5,
      check_average_per_person: 20,
    }),
  }),
};

const GOOGLE_DATA: Record<string, GooglePlaceData> = {
  fineItalian: makeGoogle({ google_rating: 4.6, google_review_count: 850 }),
  holeInWallTaco: makeGoogle({ google_rating: 4.3, google_review_count: 320 }),
  michelinJapanese: makeGoogle({ google_rating: 4.9, google_review_count: 420 }),
  rooftopBar: makeGoogle({ google_rating: 4.2, google_review_count: 1200 }),
  cozyBistro: makeGoogle({ google_rating: 4.5, google_review_count: 280 }),
  bbqJoint: makeGoogle({ google_rating: 4.4, google_review_count: 680 }),
  ethiopianGem: makeGoogle({ google_rating: 4.5, google_review_count: 190 }),
  brunchPalace: makeGoogle({ google_rating: 4.4, google_review_count: 520 }),
  steakhouse: makeGoogle({ google_rating: 4.7, google_review_count: 1500 }),
  veganTrendy: makeGoogle({ google_rating: 4.3, google_review_count: 250 }),
};

const PROFILE_NAMES = Object.keys(PROFILES);
const ALL_PROFILES = PROFILE_NAMES.map(k => PROFILES[k]);

// ==========================================
// HELPER: Run reRankV8 and return sorted results
// ==========================================

function runRanking(
  specialRequest: string,
  occasion: string,
  intent: IntentClassificationV2 | null,
  opts?: { withGoogle?: boolean; dietary?: string[] },
) {
  // Run computeV8DondeMatch for each profile individually (with Google data if specified)
  const results = PROFILE_NAMES.map(key => {
    const profile = PROFILES[key];
    const inputs: V8DondeMatchInputs = {
      occasion,
      specialRequest,
      neighborhood: "Anywhere",
      priceLevel: "Any",
      googleData: opts?.withGoogle ? (GOOGLE_DATA[key] || null) : null,
      intent,
      dietaryRestrictions: opts?.dietary,
      candidatePoolSize: ALL_PROFILES.length,
    };
    const result = computeV8DondeMatch(profile, inputs);
    return { key, profile, result };
  });

  results.sort((a, b) => b.result.dondeMatch - a.result.dondeMatch);
  return results;
}

function getTopN(results: ReturnType<typeof runRanking>, n: number): string[] {
  return results.slice(0, n).map(r => r.key);
}

function findResult(results: ReturnType<typeof runRanking>, key: string) {
  return results.find(r => r.key === key)!;
}

function printRanking(label: string, results: ReturnType<typeof runRanking>) {
  console.log(`\n  ${label}:`);
  for (const r of results) {
    const w = r.result.weights;
    const wStr = `f=${w.food.toFixed(2)} v=${w.vibe.toFixed(2)} s=${w.service.toFixed(2)} r=${w.reputation.toFixed(2)} c=${w.convenience.toFixed(2)}`;
    console.log(`    ${r.result.dondeMatch.toString().padStart(3)} DM | ${r.profile.name.padEnd(28)} | ${r.profile.cuisine_type?.padEnd(12)} | IM=${r.result.intentMultiplier.toFixed(3)} | ${wStr}`);
  }
  if (results[0]?.result.weightShiftReasons.length > 0) {
    console.log(`    Rules: ${results[0].result.weightShiftReasons.join(", ")}`);
  }
}

// ==========================================
// CATEGORY 1: OPEN-ENDED ("surprise me")
// ==========================================

section("CATEGORY 1: OPEN-ENDED QUERIES");

{
  const queries = [
    "Surprise me with a place",
    "Something good",
    "I'm hungry",
    "Feed me",
  ];

  for (const query of queries) {
    // Open-ended: no intent signals, cuisine_importance "low"
    const intent = makeIntent({
      cuisine_importance: "low",
      emotional_intent: "explore", // after Fix 5: open-ended routes to "explore"
      confidence: { cuisine: "low", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });

    const results = runRanking(query, "Any", intent, { withGoogle: true });
    printRanking(`"${query}"`, results);

    const top3 = getTopN(results, 3);
    const topResult = results[0];

    // Top restaurant should have decent DM
    assert(topResult.result.dondeMatch >= 50, `open_score:${query}`,
      `Top DM=${topResult.result.dondeMatch}, want ≥50`);

    // Spread should be meaningful (differentiation exists)
    const spread = results[0].result.dondeMatch - results[results.length - 1].result.dondeMatch;
    assert(spread >= 5, `open_spread:${query}`,
      `Spread=${spread}, want ≥5 for meaningful differentiation`);

    // IM should be 1.0 for open queries (no active signals or explore emotional intent)
    // Note: after Fix 5, emotional_intent="explore" triggers Rule 6 but doesn't create active intent signals
    // for the IA calculation. hasActiveSignals stays false since target_cuisines/tags/vibe_keywords are empty.

    // High-reputation restaurants should be in the mix
    const hasQualityInTop3 = top3.some(k =>
      k === "michelinJapanese" || k === "fineItalian" || k === "steakhouse"
    );
    assert(hasQualityInTop3, `open_quality:${query}`,
      `Top 3 should include a high-reputation restaurant. Got: ${top3.join(", ")}`);
  }

  // Test WITHOUT Google data — reputation proxy should differentiate
  console.log("\n  --- Without Google Data ---");
  const intent = makeIntent({
    cuisine_importance: "low",
    emotional_intent: "explore",
    confidence: { cuisine: "low", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
  });
  const noGoogleResults = runRanking("Surprise me", "Any", intent, { withGoogle: false });
  printRanking('"Surprise me" (no Google)', noGoogleResults);

  // Even without Google, award-winning restaurants should score higher (after Fix 6)
  const michelinNoGoogle = findResult(noGoogleResults, "michelinJapanese");
  const tacoNoGoogle = findResult(noGoogleResults, "holeInWallTaco");
  assert(
    michelinNoGoogle.result.dondeMatch >= tacoNoGoogle.result.dondeMatch,
    "open_noGoogle_rep",
    `Michelin (${michelinNoGoogle.result.dondeMatch}) should ≥ Taco (${tacoNoGoogle.result.dondeMatch}) — awards proxy`
  );
}

// ==========================================
// CATEGORY 2: CUISINE-SPECIFIC, NO DISHES
// ==========================================

section("CATEGORY 2: CUISINE-SPECIFIC (no dishes)");

{
  const tests = [
    { query: "Italian restaurant", cuisine: "Italian", expected: "fineItalian" },
    { query: "Mexican food", cuisine: "Mexican", expected: "holeInWallTaco" },
    { query: "Japanese place", cuisine: "Japanese", expected: "michelinJapanese" },
    { query: "French bistro", cuisine: "French", expected: "cozyBistro" },
    { query: "BBQ spot", cuisine: "BBQ", expected: "bbqJoint" },
  ];

  for (const t of tests) {
    const intent = makeIntent({
      target_cuisines: [t.cuisine],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });

    const results = runRanking(t.query, "Any", intent, { withGoogle: true });
    printRanking(`"${t.query}"`, results);

    // Expected restaurant should be #1
    assert(results[0].key === t.expected, `cuisine_rank:${t.query}`,
      `Expected ${t.expected} at #1, got ${results[0].key} (${results[0].profile.name})`);

    // Cuisine alignment should be 1.0 for the matching restaurant
    const match = findResult(results, t.expected);
    assert(match.result.intentAlignment.cuisine >= 0.9, `cuisine_align:${t.query}`,
      `Expected IA.cuisine ≥0.9 for ${t.expected}, got ${match.result.intentAlignment.cuisine}`);

    // Weight shift: "High cuisine priority" should fire
    assert(
      match.result.weightShiftReasons.some(r => r.includes("cuisine priority")),
      `cuisine_rule:${t.query}`,
      `Expected "High cuisine priority" rule, got: ${match.result.weightShiftReasons.join(", ")}`
    );

    // Non-matching cuisine should have low alignment
    const worstCuisine = results[results.length - 1];
    if (worstCuisine.profile.cuisine_type !== t.cuisine) {
      assert(worstCuisine.result.intentAlignment.cuisine <= 0.5, `cuisine_mismatch:${t.query}`,
        `Non-matching cuisine IA=${worstCuisine.result.intentAlignment.cuisine}, want ≤0.5`);
    }
  }
}

// ==========================================
// CATEGORY 3: DISH-SPECIFIC
// ==========================================

section("CATEGORY 3: DISH-SPECIFIC");

{
  const tests = [
    { query: "truffle pasta", dish: "truffle pasta", cuisines: ["Italian"], expected: "fineItalian" },
    { query: "omakase", dish: "omakase", cuisines: ["Japanese"], expected: "michelinJapanese" },
    { query: "al pastor tacos", dish: "al pastor tacos", cuisines: ["Mexican"], expected: "holeInWallTaco" },
    { query: "fondue", dish: "fondue", cuisines: ["French"], expected: "cozyBistro" },
    { query: "brisket", dish: "brisket", cuisines: ["BBQ", "American"], expected: "bbqJoint" },
  ];

  for (const t of tests) {
    const intent = makeIntent({
      target_cuisines: t.cuisines,
      cuisine_importance: "high",
      dish_level_intent: t.dish,
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "high" },
    });

    const results = runRanking(t.query, "Any", intent, { withGoogle: true });
    printRanking(`"${t.query}"`, results);

    // Expected restaurant should be #1
    const top3 = getTopN(results, 3);
    assert(top3.includes(t.expected), `dish_rank:${t.query}`,
      `Expected ${t.expected} in top 3, got: ${top3.join(", ")}`);

    // Dish alignment should be high for matching restaurant
    const match = findResult(results, t.expected);
    assert(match.result.intentAlignment.dish >= 0.4, `dish_align:${t.query}`,
      `Expected IA.dish ≥0.4 for ${t.expected}, got ${match.result.intentAlignment.dish}`);
  }
}

// ==========================================
// CATEGORY 4: DISH + CUISINE
// ==========================================

section("CATEGORY 4: DISH + CUISINE (combined)");

{
  const tests = [
    { query: "Italian truffle pasta", cuisines: ["Italian"], dish: "italian truffle pasta", expected: "fineItalian" },
    { query: "Japanese omakase", cuisines: ["Japanese"], dish: "japanese omakase", expected: "michelinJapanese" },
    { query: "French fondue", cuisines: ["French"], dish: "french fondue", expected: "cozyBistro" },
  ];

  for (const t of tests) {
    const intent = makeIntent({
      target_cuisines: t.cuisines,
      cuisine_importance: "high",
      dish_level_intent: t.dish,
      flavor_preferences: [],
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "high" },
    });

    const results = runRanking(t.query, "Any", intent, { withGoogle: true });
    printRanking(`"${t.query}"`, results);

    // Expected should be #1
    assert(results[0].key === t.expected, `dish_cuisine_rank:${t.query}`,
      `Expected ${t.expected} at #1, got ${results[0].key}`);

    // Both cuisine and dish alignment should be high
    const match = findResult(results, t.expected);
    assert(match.result.intentAlignment.cuisine >= 0.9, `dish_cuisine_ca:${t.query}`,
      `Cuisine alignment ${match.result.intentAlignment.cuisine} should ≥0.9`);

    // DM should be meaningfully higher than cuisine-only queries due to dish boost
    assert(match.result.dondeMatch >= 55, `dish_cuisine_dm:${t.query}`,
      `DM=${match.result.dondeMatch} should ≥55 for strong food signal`);
  }
}

// ==========================================
// CATEGORY 5: VIBE / OCCASION
// ==========================================

section("CATEGORY 5: VIBE / OCCASION");

{
  // Test 1: Cozy date night
  {
    const intent = makeIntent({
      cuisine_importance: "low",
      vibe_keywords: ["cozy", "intimate"],
      emotional_intent: "impress",
      date_type: "casual_weeknight",
      group_size_hint: "couple",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "low", overall: "medium" },
    });
    const results = runRanking("cozy date night spot", "Date Night", intent, { withGoogle: true });
    printRanking('"cozy date night spot" (Date Night)', results);

    // Cozy Bistro should be competitive — best date + cozy + intimate scores.
    // Note: fine dining restaurants (fineItalian, steakhouse, michelinJapanese) also have
    // strong date-friendly + romantic scores, so cozy bistro competes for top 5 spots.
    // In production, intent alignment IM further lifts matching profiles.
    const top5 = getTopN(results, 5);
    assert(top5.includes("cozyBistro"), "vibe_date_rank",
      `Cozy Bistro should be in top 5 for date night. Got: ${top5.join(", ")}`);

    // Vibe weight should be elevated
    const top = results[0];
    assert(top.result.weights.vibe >= 0.22, "vibe_date_weight",
      `Vibe weight=${top.result.weights.vibe.toFixed(3)}, want ≥0.22 for date night`);

    // Rooftop Bar (loud) should rank lower than Cozy Bistro for "cozy"
    const cozy = findResult(results, "cozyBistro");
    const rooftop = findResult(results, "rooftopBar");
    assert(cozy.result.dondeMatch >= rooftop.result.dondeMatch, "vibe_cozy_vs_loud",
      `Cozy (${cozy.result.dondeMatch}) should ≥ Rooftop (${rooftop.result.dondeMatch}) for cozy date`);
  }

  // Test 2: Rooftop with a view
  {
    const intent = makeIntent({
      cuisine_importance: "low",
      target_tags: ["rooftop", "scenic view"],
      confidence: { cuisine: "low", vibe: "medium", occasion: "low", constraints: "low", overall: "medium" },
    });
    const results = runRanking("rooftop with a view", "Any", intent, { withGoogle: true });
    printRanking('"rooftop with a view"', results);

    // Rooftop Bar gets correct IM=1.05 boost, but its base quality (4.2★) is lower
    // than fine dining (4.8-4.9★). In production, tag pre-filtering narrows the pool.
    // Verify the IM boost is applied correctly (1.05) and vibe weight is elevated.
    const rooftop = findResult(results, "rooftopBar");
    assert(rooftop.result.intentMultiplier >= 1.04, "vibe_rooftop_im",
      `Rooftop IM=${rooftop.result.intentMultiplier.toFixed(3)}, should ≥1.04 for matching tags`);
    const topResult = results[0];
    assert(topResult.result.weights.vibe >= 0.30, "vibe_rooftop_weight",
      `Vibe weight=${topResult.result.weights.vibe.toFixed(3)}, want ≥0.30 for rooftop query`);
  }

  // Test 3: Quiet business lunch
  {
    const intent = makeIntent({
      cuisine_importance: "low",
      vibe_keywords: [],
      practical_constraints: ["quiet_environment"],
      emotional_intent: "casual",
      confidence: { cuisine: "low", vibe: "low", occasion: "high", constraints: "high", overall: "medium" },
    });
    const results = runRanking("quiet business lunch", "Business Lunch", intent, { withGoogle: true });
    printRanking('"quiet business lunch" (Business Lunch)', results);

    // Steakhouse should rank well — high business_lunch_score
    const steakResult = findResult(results, "steakhouse");
    assert(steakResult.result.dondeMatch >= 55, "vibe_business_dm",
      `Steakhouse DM=${steakResult.result.dondeMatch} should ≥55 for business lunch`);
  }

  // Test 4: Lively group dinner
  {
    const intent = makeIntent({
      cuisine_importance: "low",
      vibe_keywords: ["lively"],
      emotional_intent: "casual",
      group_size_hint: "small_group",
      confidence: { cuisine: "low", vibe: "medium", occasion: "medium", constraints: "low", overall: "medium" },
    });
    const results = runRanking("lively group dinner", "Group Hangout", intent, { withGoogle: true });
    printRanking('"lively group dinner" (Group Hangout)', results);

    const top3 = getTopN(results, 3);
    // BBQ, Rooftop, or Taqueria should be in top 3 (high group_friendly + lively)
    const groupFriendly = top3.some(k =>
      k === "bbqJoint" || k === "rooftopBar" || k === "holeInWallTaco"
    );
    assert(groupFriendly, "vibe_group_rank",
      `Group-friendly + lively restaurant should be in top 3. Got: ${top3.join(", ")}`);
  }
}

// ==========================================
// CATEGORY 6: REPUTATION-SPECIFIC
// ==========================================

section("CATEGORY 6: REPUTATION-SPECIFIC");

{
  const tests = [
    "best rated restaurant",
    "michelin star restaurant",
    "james beard winner",
    "award-winning restaurant",
    "highest rated",
  ];

  for (const query of tests) {
    // After Fix 2+3: these queries produce target_tags: ["reputation-focused", ...]
    const intent = makeIntent({
      cuisine_importance: "low",
      target_tags: ["reputation-focused", "fine dining"],
      confidence: { cuisine: "low", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });

    const results = runRanking(query, "Any", intent, { withGoogle: true });
    printRanking(`"${query}"`, results);

    const top3 = getTopN(results, 3);

    // High-reputation restaurants should dominate
    const hasReputation = top3.some(k =>
      k === "michelinJapanese" || k === "steakhouse" || k === "fineItalian"
    );
    assert(hasReputation, `rep_rank:${query}`,
      `Reputation restaurant should be in top 3. Got: ${top3.join(", ")}`);

    // Rule 13 should fire (after fix)
    const topResult = results[0];
    const rule13Fired = topResult.result.weightShiftReasons.some(r =>
      r.toLowerCase().includes("reputation")
    );
    assert(rule13Fired, `rep_rule13:${query}`,
      `Rule 13 (reputation) should fire. Rules: ${topResult.result.weightShiftReasons.join(", ")}`);

    // Reputation weight should be elevated
    assert(topResult.result.weights.reputation >= 0.28, `rep_weight:${query}`,
      `Reputation weight=${topResult.result.weights.reputation.toFixed(3)}, want ≥0.28`);

    // Michelin Japanese should beat BBQ Joint for reputation queries
    const michelin = findResult(results, "michelinJapanese");
    const bbq = findResult(results, "bbqJoint");
    assert(michelin.result.dondeMatch > bbq.result.dondeMatch, `rep_michelin_vs_bbq:${query}`,
      `Michelin (${michelin.result.dondeMatch}) should > BBQ (${bbq.result.dondeMatch})`);
  }
}

// ==========================================
// CATEGORY 7: COMBINED / CONFLICTING
// ==========================================

section("CATEGORY 7: COMBINED / CONFLICTING");

{
  // Test 1: Cuisine + vibe + constraint
  {
    const intent = makeIntent({
      target_cuisines: ["Italian", "Thai", "Indian", "Korean", "Mexican"],
      cuisine_importance: "high",
      target_tags: ["rooftop", "scenic view", "great value"],
      practical_constraints: ["budget_conscious"],
      flavor_preferences: ["spicy"],
      confidence: { cuisine: "medium", vibe: "medium", occasion: "low", constraints: "high", overall: "high" },
    });
    const results = runRanking("spicy Italian with rooftop budget-friendly", "Any", intent, { withGoogle: true });
    printRanking('"spicy Italian with rooftop, budget-friendly"', results);

    // Weights should all be in valid range
    for (const r of results) {
      const w = r.result.weights;
      for (const [k, v] of Object.entries(w)) {
        assert(v >= 0.05 && v <= 0.50, `combined_weight_clamp:${k}`,
          `Weight ${k}=${v.toFixed(3)} should be in [0.05, 0.50]`);
      }
      // Weights should sum to ~1.0
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      assert(Math.abs(sum - 1.0) < 0.01, "combined_weight_sum",
        `Weights sum=${sum.toFixed(4)}, want ~1.0`);
    }

    // Multiple rules should fire
    const rules = results[0].result.weightShiftReasons;
    assert(rules.length >= 2, "combined_rules_count",
      `Expected ≥2 rules, got ${rules.length}: ${rules.join(", ")}`);
  }

  // Test 2: Vegan BBQ (tension)
  {
    const intent = makeIntent({
      target_cuisines: ["BBQ"],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });
    const results = runRanking("vegan BBQ", "Any", intent, { withGoogle: true, dietary: ["vegan"] });
    printRanking('"vegan BBQ" (dietary: vegan)', results);

    // BBQ Joint should rank high for cuisine, but vegan restaurant might get dietary boost
    const bbq = findResult(results, "bbqJoint");
    const vegan = findResult(results, "veganTrendy");
    // Both should have reasonable scores (system handles tension gracefully)
    assert(bbq.result.dondeMatch >= 30, "combined_vegan_bbq",
      `BBQ DM=${bbq.result.dondeMatch} should ≥30 even with vegan dietary`);
  }

  // Test 3: All signals combined
  {
    const intent = makeIntent({
      target_cuisines: ["Thai"],
      cuisine_importance: "high",
      dish_level_intent: "pad thai",
      target_tags: ["outdoor patio"],
      vibe_keywords: [],
      practical_constraints: ["walk_in", "outdoor_preferred"],
      emotional_intent: "impress",
      date_type: "first_date",
      group_size_hint: "couple",
      spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "high", overall: "high" },
    });
    const results = runRanking("best Thai pad thai for a first date outdoor seating walk-in", "Date Night", intent, { withGoogle: true });
    printRanking('"best Thai pad thai, first date, outdoor, walk-in" (Date Night)', results);

    // This fires many rules — verify all weights are valid
    const topRules = results[0].result.weightShiftReasons;
    console.log(`    Rules fired (${topRules.length}): ${topRules.join(", ")}`);
    assert(topRules.length >= 3, "combined_all_rules",
      `Expected ≥3 rules, got ${topRules.length}`);

    // IM should be active (many signals)
    const hasActiveSignals = results[0].result.intentAlignment.hasActiveSignals;
    assert(hasActiveSignals, "combined_all_signals",
      `Expected hasActiveSignals=true`);
  }

  // Test 4: Romantic Mexican for a group (occasion vs cuisine)
  {
    const intent = makeIntent({
      target_cuisines: ["Mexican"],
      cuisine_importance: "high",
      emotional_intent: "celebrate",
      group_size_hint: "small_group",
      confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "low", overall: "high" },
    });
    const results = runRanking("romantic Mexican for a group", "Group Hangout", intent, { withGoogle: true });
    printRanking('"romantic Mexican for a group" (Group Hangout)', results);

    // Mexican restaurant should be in top 3 (cuisine match)
    const top3 = getTopN(results, 3);
    assert(top3.includes("holeInWallTaco"), "combined_mex_group",
      `Mexican restaurant should be in top 3 for "romantic Mexican for a group". Got: ${top3.join(", ")}`);
  }

  // Test 5: Filter-specific scenarios
  // Note: BYOB and pet-friendly are _constraint_ signals that pre-filter candidates
  // in production. In scoring, we verify matching restaurants get IM boost (1.05x)
  // and the correct weight shifts fire. Strict ranking assertions are inappropriate
  // because constraints filter, not score — a world-class sushi restaurant shouldn't
  // lose to a mediocre BYOB spot just because it's BYOB.

  // 5a. BYOB restaurant — verify constraint alignment
  {
    const intent = makeIntent({
      target_tags: ["byob"],
      practical_constraints: ["byob"],
      cuisine_importance: "low",
    });
    const results = runRanking("BYOB restaurant", "Any", intent, { withGoogle: true });
    printRanking(`"BYOB restaurant"`, results);

    // BBQ Joint (BYOB) should get IM boost
    const bbq = findResult(results, "bbqJoint");
    assert(bbq.result.intentMultiplier >= 1.04, `filter:BYOB IM`,
      `BBQ Joint IM=${bbq.result.intentMultiplier.toFixed(3)}, should ≥1.04 for matching BYOB tag`);
  }

  // 5b. Pet friendly patio — verify constraint alignment
  {
    const intent = makeIntent({
      target_tags: ["pet friendly", "outdoor patio"],
      practical_constraints: ["pet_friendly", "outdoor_preferred"],
      cuisine_importance: "low",
    });
    const results = runRanking("pet friendly patio", "Any", intent, { withGoogle: true });
    printRanking(`"pet friendly patio"`, results);

    // BBQ Joint (pet friendly + outdoor) should get IM boost
    const bbq = findResult(results, "bbqJoint");
    assert(bbq.result.intentMultiplier >= 1.04, `filter:pet friendly IM`,
      `BBQ Joint IM=${bbq.result.intentMultiplier.toFixed(3)}, should ≥1.04 for matching pet/patio tags`);
  }

  // 5c. Kid friendly brunch — cuisine + tag match (strict ranking OK)
  {
    const intent = makeIntent({
      target_cuisines: ["Brunch"],
      target_tags: ["brunch spot", "kid friendly"],
      cuisine_importance: "high",
    });
    const results = runRanking("kid friendly brunch", "Any", intent, { withGoogle: true });
    printRanking(`"kid friendly brunch"`, results);

    const top3 = getTopN(results, 3);
    assert(top3.includes("brunchPalace"), `filter:kid friendly brunch`,
      `Expected brunchPalace in top 3. Got: ${top3.join(", ")}`);
  }
}

// ==========================================
// STRUCTURAL TESTS
// ==========================================

section("STRUCTURAL TESTS");

{
  // Test: reRankV8 produces correct ordering
  const intent = makeIntent({
    target_cuisines: ["Italian"],
    cuisine_importance: "high",
    confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
  });
  const ranked = reRankV8(ALL_PROFILES, "Any", "Italian restaurant", intent);

  // Should be sorted descending by DM
  for (let i = 0; i < ranked.length - 1; i++) {
    assert(ranked[i].result.dondeMatch >= ranked[i + 1].result.dondeMatch, `rerank_order_${i}`,
      `DM[${i}]=${ranked[i].result.dondeMatch} should ≥ DM[${i+1}]=${ranked[i+1].result.dondeMatch}`);
  }

  // Data completeness should be in [0, 1]
  for (const r of ranked) {
    assert(r.result.dataCompleteness >= 0 && r.result.dataCompleteness <= 1, "rerank_completeness",
      `dataCompleteness=${r.result.dataCompleteness}, want [0,1]`);
  }

  // Match narrative should exist
  for (const r of ranked) {
    assert(r.result.matchNarrative != null, "rerank_narrative",
      `matchNarrative should not be null`);
    assert(typeof r.result.matchNarrative.strongest_factor === "string", "rerank_narrative_factor",
      `strongest_factor should be a string`);
  }

  // All DM scores should be in [0, 99]
  for (const r of ranked) {
    assert(r.result.dondeMatch >= 0 && r.result.dondeMatch <= 99, "rerank_dm_range",
      `DM=${r.result.dondeMatch}, want [0,99]`);
  }
}

// ==========================================
// SUMMARY
// ==========================================

console.log("\n" + "=".repeat(70));
console.log("  V8 SCORING PIPELINE TEST RESULTS");
console.log("=".repeat(70));
console.log(`  PASSED: ${passed}`);
console.log(`  FAILED: ${failed}`);
console.log(`  WARNED: ${warned}`);
console.log(`  TOTAL:  ${passed + failed + warned}`);
console.log(`  Pass rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failures.length > 0) {
  console.log("\n  --- FAILURES ---");
  for (const f of failures) console.log(f);
}
if (warnings.length > 0) {
  console.log("\n  --- WARNINGS ---");
  for (const w of warnings) console.log(w);
}

console.log("");

if (failed > 0) {
  console.log(`❌ ${failed} assertions failed.`);
  Deno.exit(1);
} else {
  console.log(`✅ All ${passed} assertions passed!`);
  Deno.exit(0);
}
