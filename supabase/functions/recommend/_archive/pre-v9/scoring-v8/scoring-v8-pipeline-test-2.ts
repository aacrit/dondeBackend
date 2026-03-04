/**
 * V8 Scoring Pipeline Test 2 — Second Dataset, 196 Assertions
 *
 * Validates the same computeV8DondeMatch + reRankV8 pipeline with 10 COMPLETELY
 * DIFFERENT restaurant archetypes and 30+ fresh scenarios inspired by golden dataset.
 *
 * New archetypes: Thai, Indian, Korean, Greek, Vietnamese, Peruvian, Cuban,
 *   Southern/Soul, Cocktail Bar, Polish Diner
 *
 * Run: cd dondeBackend && deno run --allow-read tests/scoring-v8/scoring-v8-pipeline-test-2.ts
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
    flavor_profiles: null, signature_dishes: null, menu_highlights: null,
    cuisine_subcategory: null, menu_depth: null, spice_level: null,
    dietary_depth: null, service_style: null, meal_pacing: null,
    reservation_difficulty: null, typical_wait_minutes: null,
    group_size_sweet_spot: null, check_average_per_person: null,
    tipping_culture: null, kid_friendliness: null, music_vibe: null,
    decor_style: null, conversation_friendliness: null, energy_level: null,
    seating_options: null, instagram_worthiness: null, seasonal_relevance: null,
    cultural_authenticity: null, origin_story: null, crowd_profile: null,
    neighborhood_integration: null, chef_notable: null, awards_recognition: null,
    wow_factors: null, date_progression: null, best_seat_in_house: null,
    ideal_weather: null, unique_selling_point: null, transit_accessibility: null,
    byob_policy: null, payment_notes: null, enrichment_confidence: 0.8,
    ...overrides,
  };
}

function makeProfile(overrides: Partial<RestaurantProfile> = {}): RestaurantProfile {
  return {
    id: crypto.randomUUID(), name: "Test Restaurant",
    address: "123 Test St, Chicago, IL", neighborhood_id: null,
    google_place_id: null, price_level: "$$", noise_level: "Moderate",
    lighting_ambiance: "warm", dress_code: "Casual", outdoor_seating: false,
    live_music: false, pet_friendly: false, parking_availability: "Street",
    cuisine_type: "American", best_for_oneliner: null, insider_tip: null,
    best_times: ["dinner"], dietary_options: [], good_for: [], ambiance: [],
    is_active: true, neighborhood_name: "Chicago",
    neighborhood_description: null, date_friendly_score: 5,
    group_friendly_score: 5, family_friendly_score: 5, romantic_rating: 5,
    business_lunch_score: 5, solo_dining_score: 5, hole_in_wall_factor: 5,
    tags: [], tag_categories: [], occasion_score: 50, total_score: 50,
    trending_score: 5, deep_profile: makeDeepProfile(), ...overrides,
  };
}

function makeGoogle(overrides: Partial<GooglePlaceData> = {}): GooglePlaceData {
  return {
    name: "Test Restaurant", address: "123 Test St", phone: null,
    website: null, google_rating: 4.2, google_review_count: 100,
    reviews: [], business_status: "OPERATIONAL", photo_urls: [],
    opening_hours: null, ...overrides,
  };
}

function makeIntent(overrides: Partial<IntentClassificationV2> = {}): IntentClassificationV2 {
  return {
    target_cuisines: [], target_tags: [], target_features: [],
    cuisine_importance: "low", flavor_preferences: [], vibe_keywords: [],
    practical_constraints: [], emotional_intent: "casual", date_type: null,
    group_size_hint: null, spontaneity: "unknown",
    confidence: { cuisine: "low", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    ...overrides,
  };
}

// ==========================================
// 10 NEW RESTAURANT ARCHETYPES
// ==========================================

const PROFILES: Record<string, RestaurantProfile> = {
  thaiStreet: makeProfile({
    name: "Aroy Thai",
    cuisine_type: "Thai",
    price_level: "$",
    noise_level: "Moderate",
    lighting_ambiance: "bright, casual, warm",
    dress_code: "Casual",
    outdoor_seating: true,
    date_friendly_score: 5,
    group_friendly_score: 7,
    family_friendly_score: 7,
    romantic_rating: 4,
    business_lunch_score: 4,
    solo_dining_score: 8,
    hole_in_wall_factor: 8,
    trending_score: 6,
    tags: ["great value", "hidden gem", "late night"],
    tag_categories: ["vibe", "value"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Pad Thai", why: "Classic wok-fried noodles with tamarind" },
        { dish: "Green Curry", why: "Coconut-based with Thai basil" },
      ],
      menu_highlights: ["tom yum soup", "papaya salad", "mango sticky rice", "thai iced tea"],
      flavor_profiles: ["bold-spiced", "citrus-forward", "sweet-savory"],
      spice_level: "medium-hot",
      cuisine_subcategory: "Central Thai",
      service_style: "Counter",
      meal_pacing: "quick_bite",
      reservation_difficulty: "walk_in_friendly",
      typical_wait_minutes: 10,
      energy_level: 6,
      cultural_authenticity: 9,
      neighborhood_integration: "institution",
      check_average_per_person: 15,
    }),
  }),

  indianFine: makeProfile({
    name: "Vermillion",
    cuisine_type: "Indian",
    price_level: "$$$",
    noise_level: "Moderate",
    lighting_ambiance: "dim, warm, elegant, intimate",
    dress_code: "Smart Casual",
    date_friendly_score: 8,
    group_friendly_score: 6,
    family_friendly_score: 5,
    romantic_rating: 8,
    business_lunch_score: 7,
    solo_dining_score: 5,
    hole_in_wall_factor: 3,
    trending_score: 8,
    tags: ["romantic", "craft cocktails", "fine dining", "trendy"],
    tag_categories: ["vibe", "dining-style"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Chicken Tikka Masala", why: "Tandoor-roasted in clay oven" },
        { dish: "Lamb Biryani", why: "Saffron-infused basmati layers" },
      ],
      menu_highlights: ["samosa chaat", "butter chicken", "naan bread", "gulab jamun"],
      flavor_profiles: ["bold-spiced", "rich-buttery", "earthy"],
      cuisine_subcategory: "North Indian/Mughlai",
      service_style: "Full Table Service",
      meal_pacing: "leisurely",
      reservation_difficulty: "moderate",
      energy_level: 5,
      music_vibe: "ambient",
      decor_style: "modern Indian, warm wood, brass accents",
      conversation_friendliness: 8,
      awards_recognition: ["Chicago Magazine Best New Restaurant"],
      chef_notable: true,
      cultural_authenticity: 8,
      neighborhood_integration: "destination",
      check_average_per_person: 55,
      enrichment_confidence: 0.9,
    }),
  }),

  koreanBBQ: makeProfile({
    name: "San Soo Gab San",
    cuisine_type: "Korean",
    price_level: "$$",
    noise_level: "Loud",
    lighting_ambiance: "bright, lively, modern",
    dress_code: "Casual",
    date_friendly_score: 5,
    group_friendly_score: 9,
    family_friendly_score: 6,
    romantic_rating: 4,
    business_lunch_score: 3,
    solo_dining_score: 4,
    hole_in_wall_factor: 6,
    trending_score: 7,
    tags: ["great value", "lively atmosphere", "late night"],
    tag_categories: ["vibe", "value"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Bulgogi", why: "Marinated beef grilled tableside" },
        { dish: "Galbi", why: "Short ribs with soy garlic glaze" },
      ],
      menu_highlights: ["kimchi jjigae", "japchae", "bibimbap", "soju cocktails"],
      flavor_profiles: ["umami-forward", "bold-spiced", "fermented"],
      cuisine_subcategory: "Korean BBQ",
      service_style: "Family Style",
      meal_pacing: "relaxed",
      reservation_difficulty: "walk_in_friendly",
      energy_level: 8,
      music_vibe: "curated-playlist",
      decor_style: "modern Korean, grill tables, K-pop aesthetic",
      cultural_authenticity: 9,
      neighborhood_integration: "institution",
      check_average_per_person: 35,
    }),
  }),

  greekTaverna: makeProfile({
    name: "Avli Taverna",
    cuisine_type: "Greek",
    price_level: "$$$",
    noise_level: "Moderate",
    lighting_ambiance: "warm, Mediterranean, bright",
    dress_code: "Smart Casual",
    outdoor_seating: true,
    date_friendly_score: 8,
    group_friendly_score: 8,
    family_friendly_score: 7,
    romantic_rating: 7,
    business_lunch_score: 6,
    solo_dining_score: 5,
    hole_in_wall_factor: 4,
    trending_score: 7,
    tags: ["outdoor patio", "romantic", "farm-to-table", "scenic view"],
    tag_categories: ["vibe", "feature"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Lamb Chops", why: "Herb-crusted, chargrilled" },
        { dish: "Grilled Octopus", why: "Lemon oregano finish" },
      ],
      menu_highlights: ["spanakopita", "tzatziki", "baklava", "saganaki"],
      flavor_profiles: ["herbaceous", "bright-acidic", "savory"],
      cuisine_subcategory: "Modern Greek",
      service_style: "Full Table Service",
      meal_pacing: "relaxed",
      reservation_difficulty: "moderate",
      energy_level: 5,
      music_vibe: "curated-playlist",
      decor_style: "whitewashed Mediterranean, olive branches, terracotta",
      conversation_friendliness: 7,
      cultural_authenticity: 8,
      neighborhood_integration: "destination",
      check_average_per_person: 50,
    }),
  }),

  phoShop: makeProfile({
    name: "Tank Noodle",
    cuisine_type: "Vietnamese",
    price_level: "$",
    noise_level: "Moderate",
    lighting_ambiance: "bright, fluorescent, casual",
    dress_code: "Casual",
    date_friendly_score: 3,
    group_friendly_score: 7,
    family_friendly_score: 8,
    romantic_rating: 2,
    business_lunch_score: 3,
    solo_dining_score: 9,
    hole_in_wall_factor: 9,
    trending_score: 5,
    tags: ["great value", "hidden gem", "late night"],
    tag_categories: ["vibe", "value"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Pho Tai", why: "Rare beef in 12-hour bone broth" },
        { dish: "Banh Mi", why: "Vietnamese baguette with pork" },
      ],
      menu_highlights: ["spring rolls", "bun bo hue", "vermicelli bowl", "vietnamese iced coffee"],
      flavor_profiles: ["bright-acidic", "herbaceous", "umami-forward"],
      cuisine_subcategory: "Vietnamese Street Food",
      service_style: "Counter",
      meal_pacing: "quick_bite",
      reservation_difficulty: "walk_in_friendly",
      typical_wait_minutes: 15,
      energy_level: 6,
      cultural_authenticity: 10,
      neighborhood_integration: "institution",
      check_average_per_person: 14,
    }),
  }),

  peruvianFusion: makeProfile({
    name: "Tanta",
    cuisine_type: "Peruvian",
    price_level: "$$$",
    noise_level: "Moderate",
    lighting_ambiance: "warm, vibrant, modern",
    dress_code: "Smart Casual",
    outdoor_seating: true,
    date_friendly_score: 7,
    group_friendly_score: 8,
    family_friendly_score: 6,
    romantic_rating: 6,
    business_lunch_score: 7,
    solo_dining_score: 6,
    hole_in_wall_factor: 3,
    trending_score: 8,
    tags: ["trendy", "craft cocktails", "outdoor patio", "instagrammable"],
    tag_categories: ["vibe", "feature"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Ceviche", why: "Leche de tigre with aji amarillo" },
        { dish: "Lomo Saltado", why: "Stir-fried beef, Peruvian-Chinese fusion" },
      ],
      menu_highlights: ["anticuchos", "causa", "pisco sour", "alfajores"],
      flavor_profiles: ["bright-acidic", "bold-spiced", "citrus-forward"],
      cuisine_subcategory: "Modern Peruvian",
      service_style: "Full Table Service",
      meal_pacing: "relaxed",
      reservation_difficulty: "moderate",
      energy_level: 6,
      music_vibe: "curated-playlist",
      decor_style: "colorful, modern Latin, exposed brick",
      conversation_friendliness: 7,
      awards_recognition: ["James Beard Nominee"],
      chef_notable: true,
      cultural_authenticity: 7,
      neighborhood_integration: "destination",
      check_average_per_person: 48,
      enrichment_confidence: 0.9,
    }),
  }),

  cubanCafe: makeProfile({
    name: "Cafe Laguardia",
    cuisine_type: "Cuban",
    price_level: "$$",
    noise_level: "Moderate",
    lighting_ambiance: "warm, colorful, tropical",
    dress_code: "Casual",
    live_music: true,
    date_friendly_score: 6,
    group_friendly_score: 7,
    family_friendly_score: 7,
    romantic_rating: 6,
    business_lunch_score: 4,
    solo_dining_score: 6,
    hole_in_wall_factor: 7,
    trending_score: 5,
    tags: ["live music", "hidden gem", "great value", "lively atmosphere"],
    tag_categories: ["vibe", "feature", "value"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Ropa Vieja", why: "Slow-braised shredded beef" },
        { dish: "Cuban Sandwich", why: "Pressed with roasted pork and Swiss" },
      ],
      menu_highlights: ["plantains", "black beans", "mojito", "tres leches"],
      flavor_profiles: ["savory", "bold-spiced", "citrus-forward"],
      cuisine_subcategory: "Traditional Cuban",
      service_style: "Full Table Service",
      meal_pacing: "relaxed",
      reservation_difficulty: "walk_in_friendly",
      energy_level: 7,
      music_vibe: "live-jazz",
      decor_style: "vintage Havana, tropical colors, ceiling fans",
      conversation_friendliness: 6,
      cultural_authenticity: 9,
      neighborhood_integration: "institution",
      check_average_per_person: 28,
    }),
  }),

  southernSoul: makeProfile({
    name: "Big Jones",
    cuisine_type: "Southern/Soul Food",
    price_level: "$$",
    noise_level: "Moderate",
    lighting_ambiance: "warm, cozy, rustic",
    dress_code: "Casual",
    pet_friendly: true,
    outdoor_seating: true,
    date_friendly_score: 6,
    group_friendly_score: 8,
    family_friendly_score: 9,
    romantic_rating: 5,
    business_lunch_score: 5,
    solo_dining_score: 6,
    hole_in_wall_factor: 6,
    trending_score: 6,
    tags: ["great value", "outdoor patio", "pet friendly", "kid friendly", "brunch spot"],
    tag_categories: ["vibe", "feature", "value"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Fried Chicken", why: "Buttermilk-brined, cast iron" },
        { dish: "Shrimp and Grits", why: "Stone-ground with Tasso gravy" },
      ],
      menu_highlights: ["biscuits", "collard greens", "cornbread", "peach cobbler"],
      flavor_profiles: ["savory", "rich-buttery", "smoky"],
      service_style: "Full Table Service",
      meal_pacing: "relaxed",
      reservation_difficulty: "walk_in_friendly",
      kid_friendliness: 9,
      energy_level: 5,
      music_vibe: "curated-playlist",
      decor_style: "Southern farmhouse, reclaimed wood, mason jars",
      conversation_friendliness: 8,
      cultural_authenticity: 8,
      neighborhood_integration: "institution",
      check_average_per_person: 25,
    }),
  }),

  cocktailLounge: makeProfile({
    name: "The Violet Hour",
    cuisine_type: "Cocktail Bar",
    price_level: "$$$",
    noise_level: "Quiet",
    lighting_ambiance: "dim, intimate, sophisticated",
    dress_code: "Smart Casual",
    date_friendly_score: 9,
    group_friendly_score: 4,
    family_friendly_score: 1,
    romantic_rating: 9,
    business_lunch_score: 3,
    solo_dining_score: 7,
    hole_in_wall_factor: 6,
    trending_score: 9,
    tags: ["craft cocktails", "romantic", "quiet", "hidden gem", "speakeasy"],
    tag_categories: ["vibe", "feature"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Seasonal Cocktail Flight", why: "Rotating 4-course tasting" },
      ],
      menu_highlights: ["old fashioned", "negroni", "charcuterie", "oysters"],
      flavor_profiles: ["rich-buttery", "bright-acidic", "herbaceous"],
      service_style: "Bar Service",
      meal_pacing: "leisurely",
      reservation_difficulty: "hard_to_get",
      energy_level: 3,
      music_vibe: "ambient",
      decor_style: "speakeasy, velvet curtains, candlelit, dark wood",
      conversation_friendliness: 9,
      date_progression: "Cocktails at the bar, whispered conversation, nightcap",
      awards_recognition: ["James Beard Outstanding Bar Program"],
      cultural_authenticity: 7,
      neighborhood_integration: "destination",
      check_average_per_person: 45,
      enrichment_confidence: 0.95,
    }),
  }),

  polishDiner: makeProfile({
    name: "Staropolska",
    cuisine_type: "Polish",
    price_level: "$",
    noise_level: "Moderate",
    lighting_ambiance: "bright, homey, warm",
    dress_code: "Casual",
    date_friendly_score: 4,
    group_friendly_score: 7,
    family_friendly_score: 9,
    romantic_rating: 3,
    business_lunch_score: 4,
    solo_dining_score: 7,
    hole_in_wall_factor: 9,
    trending_score: 4,
    tags: ["great value", "hidden gem", "kid friendly"],
    tag_categories: ["value", "vibe"],
    dietary_options: ["vegetarian"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Pierogi", why: "Hand-pinched, 8 fillings" },
        { dish: "Kielbasa Plate", why: "House-smoked sausage" },
      ],
      menu_highlights: ["borscht", "golabki", "potato pancakes", "paczki"],
      flavor_profiles: ["savory", "earthy", "rich-buttery"],
      cuisine_subcategory: "Traditional Polish",
      service_style: "Full Table Service",
      meal_pacing: "relaxed",
      reservation_difficulty: "walk_in_friendly",
      typical_wait_minutes: 5,
      kid_friendliness: 9,
      energy_level: 4,
      decor_style: "old-world European, lace curtains, wood paneling",
      conversation_friendliness: 8,
      cultural_authenticity: 10,
      neighborhood_integration: "institution",
      check_average_per_person: 16,
    }),
  }),
};

const GOOGLE_DATA: Record<string, GooglePlaceData> = {
  thaiStreet: makeGoogle({ google_rating: 4.4, google_review_count: 380 }),
  indianFine: makeGoogle({ google_rating: 4.5, google_review_count: 520 }),
  koreanBBQ: makeGoogle({ google_rating: 4.3, google_review_count: 710 }),
  greekTaverna: makeGoogle({ google_rating: 4.6, google_review_count: 450 }),
  phoShop: makeGoogle({ google_rating: 4.2, google_review_count: 920 }),
  peruvianFusion: makeGoogle({ google_rating: 4.7, google_review_count: 380 }),
  cubanCafe: makeGoogle({ google_rating: 4.3, google_review_count: 210 }),
  southernSoul: makeGoogle({ google_rating: 4.4, google_review_count: 340 }),
  cocktailLounge: makeGoogle({ google_rating: 4.8, google_review_count: 290 }),
  polishDiner: makeGoogle({ google_rating: 4.1, google_review_count: 160 }),
};

const PROFILE_NAMES = Object.keys(PROFILES);
const ALL_PROFILES = PROFILE_NAMES.map(k => PROFILES[k]);

// ==========================================
// HELPER: Run ranking
// ==========================================

function runRanking(
  specialRequest: string,
  occasion: string,
  intent: IntentClassificationV2 | null,
  opts?: { withGoogle?: boolean; dietary?: string[] },
) {
  const results = PROFILE_NAMES.map(key => {
    const profile = PROFILES[key];
    const inputs: V8DondeMatchInputs = {
      occasion, specialRequest, neighborhood: "Anywhere", priceLevel: "Any",
      googleData: opts?.withGoogle ? (GOOGLE_DATA[key] || null) : null,
      intent, dietaryRestrictions: opts?.dietary,
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
    console.log(`    ${r.result.dondeMatch.toString().padStart(3)} DM | ${r.profile.name.padEnd(28)} | ${r.profile.cuisine_type?.padEnd(16)} | IM=${r.result.intentMultiplier.toFixed(3)} | ${wStr}`);
  }
  if (results[0]?.result.weightShiftReasons.length > 0) {
    console.log(`    Rules: ${results[0].result.weightShiftReasons.join(", ")}`);
  }
}

// ==========================================
// CATEGORY 1: OPEN-ENDED (different queries)
// ==========================================

section("CATEGORY 1: OPEN-ENDED (new queries)");

{
  const queries = [
    "What's good around here",
    "Just pick something",
    "Dealer's choice",
    "Feeling adventurous",
  ];

  for (const query of queries) {
    const intent = makeIntent({
      cuisine_importance: "low",
      emotional_intent: "explore",
      confidence: { cuisine: "low", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });

    const results = runRanking(query, "Any", intent, { withGoogle: true });
    printRanking(`"${query}"`, results);

    const topResult = results[0];

    // Top DM should be decent
    assert(topResult.result.dondeMatch >= 50, `open_score:${query}`,
      `Top DM=${topResult.result.dondeMatch}, want ≥50`);

    // Spread should differentiate
    const spread = results[0].result.dondeMatch - results[results.length - 1].result.dondeMatch;
    assert(spread >= 5, `open_spread:${query}`,
      `Spread=${spread}, want ≥5`);

    // High-quality restaurants should surface
    const top3 = getTopN(results, 3);
    const hasQuality = top3.some(k =>
      k === "cocktailLounge" || k === "peruvianFusion" || k === "indianFine" || k === "greekTaverna"
    );
    assert(hasQuality, `open_quality:${query}`,
      `Top 3 should include a high-reputation restaurant. Got: ${top3.join(", ")}`);
  }

  // No-Google variant
  console.log("\n  --- Without Google Data ---");
  const intent = makeIntent({
    cuisine_importance: "low", emotional_intent: "explore",
    confidence: { cuisine: "low", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
  });
  const noGoogleResults = runRanking("Just pick something", "Any", intent, { withGoogle: false });
  printRanking('"Just pick something" (no Google)', noGoogleResults);

  // Award-winning restaurants should still differentiate without Google
  const cocktail = findResult(noGoogleResults, "cocktailLounge");
  const pho = findResult(noGoogleResults, "phoShop");
  assert(
    cocktail.result.dondeMatch >= pho.result.dondeMatch,
    "open_noGoogle_rep",
    `Cocktail Lounge (${cocktail.result.dondeMatch}) should ≥ Pho Shop (${pho.result.dondeMatch}) — awards proxy`
  );
}

// ==========================================
// CATEGORY 2: CUISINE-SPECIFIC (new cuisines)
// ==========================================

section("CATEGORY 2: CUISINE-SPECIFIC (new cuisines)");

{
  const tests = [
    { query: "Thai food", cuisine: "Thai", expected: "thaiStreet" },
    { query: "Indian restaurant", cuisine: "Indian", expected: "indianFine" },
    { query: "Korean BBQ", cuisine: "Korean", expected: "koreanBBQ" },
    { query: "Greek food", cuisine: "Greek", expected: "greekTaverna" },
    { query: "Vietnamese pho place", cuisine: "Vietnamese", expected: "phoShop" },
    { query: "Peruvian restaurant", cuisine: "Peruvian", expected: "peruvianFusion" },
    { query: "Polish food", cuisine: "Polish", expected: "polishDiner" },
  ];

  for (const t of tests) {
    const intent = makeIntent({
      target_cuisines: [t.cuisine],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });

    const results = runRanking(t.query, "Any", intent, { withGoogle: true });
    printRanking(`"${t.query}"`, results);

    // Expected should be #1
    assert(results[0].key === t.expected, `cuisine_rank:${t.query}`,
      `Expected ${t.expected} at #1, got ${results[0].key} (${results[0].profile.name})`);

    // Cuisine alignment should be high for match
    const match = findResult(results, t.expected);
    assert(match.result.intentAlignment.cuisine >= 0.9, `cuisine_align:${t.query}`,
      `IA.cuisine=${match.result.intentAlignment.cuisine}, want ≥0.9`);

    // Weight shift: high cuisine priority should fire
    assert(
      match.result.weightShiftReasons.some(r => r.includes("cuisine priority")),
      `cuisine_rule:${t.query}`,
      `Expected "High cuisine priority" rule. Got: ${match.result.weightShiftReasons.join(", ")}`
    );

    // Non-matching worst should have low cuisine alignment
    const worst = results[results.length - 1];
    if (worst.profile.cuisine_type !== t.cuisine) {
      assert(worst.result.intentAlignment.cuisine <= 0.5, `cuisine_mismatch:${t.query}`,
        `Non-matching IA.cuisine=${worst.result.intentAlignment.cuisine}, want ≤0.5`);
    }
  }
}

// ==========================================
// CATEGORY 3: DISH-SPECIFIC (new dishes)
// ==========================================

section("CATEGORY 3: DISH-SPECIFIC (new dishes)");

{
  const tests = [
    { query: "pad thai", dish: "pad thai", cuisines: ["Thai"], expected: "thaiStreet" },
    { query: "chicken tikka masala", dish: "chicken tikka masala", cuisines: ["Indian"], expected: "indianFine" },
    { query: "bulgogi", dish: "bulgogi", cuisines: ["Korean"], expected: "koreanBBQ" },
    { query: "ceviche", dish: "ceviche", cuisines: ["Peruvian"], expected: "peruvianFusion" },
    { query: "pierogi", dish: "pierogi", cuisines: ["Polish"], expected: "polishDiner" },
    { query: "pho", dish: "pho", cuisines: ["Vietnamese"], expected: "phoShop" },
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

    const top3 = getTopN(results, 3);
    assert(top3.includes(t.expected), `dish_rank:${t.query}`,
      `Expected ${t.expected} in top 3, got: ${top3.join(", ")}`);

    const match = findResult(results, t.expected);
    assert(match.result.intentAlignment.dish >= 0.4, `dish_align:${t.query}`,
      `IA.dish=${match.result.intentAlignment.dish}, want ≥0.4 for ${t.expected}`);
  }
}

// ==========================================
// CATEGORY 4: DISH + CUISINE COMBINED (new combos)
// ==========================================

section("CATEGORY 4: DISH + CUISINE (new combos)");

{
  const tests = [
    { query: "Thai pad thai", cuisines: ["Thai"], dish: "thai pad thai", expected: "thaiStreet" },
    { query: "Indian chicken tikka", cuisines: ["Indian"], dish: "indian chicken tikka", expected: "indianFine" },
    { query: "Korean bulgogi", cuisines: ["Korean"], dish: "korean bulgogi", expected: "koreanBBQ" },
    { query: "Peruvian ceviche", cuisines: ["Peruvian"], dish: "peruvian ceviche", expected: "peruvianFusion" },
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

    assert(results[0].key === t.expected, `dish_cuisine_rank:${t.query}`,
      `Expected ${t.expected} at #1, got ${results[0].key}`);

    const match = findResult(results, t.expected);
    assert(match.result.intentAlignment.cuisine >= 0.9, `dish_cuisine_ca:${t.query}`,
      `Cuisine alignment=${match.result.intentAlignment.cuisine}, want ≥0.9`);

    assert(match.result.dondeMatch >= 55, `dish_cuisine_dm:${t.query}`,
      `DM=${match.result.dondeMatch}, want ≥55`);
  }
}

// ==========================================
// CATEGORY 5: VIBE / OCCASION (new scenarios)
// ==========================================

section("CATEGORY 5: VIBE / OCCASION (new scenarios)");

{
  // Test 1: Speakeasy date night
  {
    const intent = makeIntent({
      cuisine_importance: "low",
      vibe_keywords: ["intimate", "elegant"],
      target_tags: ["craft cocktails", "speakeasy"],
      emotional_intent: "impress",
      date_type: "first_date",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "low", overall: "medium" },
    });
    const results = runRanking("speakeasy cocktail date", "Date Night", intent, { withGoogle: true });
    printRanking('"speakeasy cocktail date" (Date Night)', results);

    // Cocktail lounge has speakeasy tags and high date score
    const top5 = getTopN(results, 5);
    assert(top5.includes("cocktailLounge"), "vibe_speakeasy_rank",
      `Cocktail Lounge should be in top 5 for speakeasy date. Got: ${top5.join(", ")}`);

    // Vibe weight should be elevated for date
    const top = results[0];
    assert(top.result.weights.vibe >= 0.22, "vibe_speakeasy_weight",
      `Vibe weight=${top.result.weights.vibe.toFixed(3)}, want ≥0.22`);

    // Korean BBQ (loud) should rank below cocktail lounge for intimate date
    const cocktail = findResult(results, "cocktailLounge");
    const korean = findResult(results, "koreanBBQ");
    assert(cocktail.result.dondeMatch >= korean.result.dondeMatch, "vibe_intimate_vs_loud",
      `Cocktail (${cocktail.result.dondeMatch}) should ≥ Korean BBQ (${korean.result.dondeMatch})`);
  }

  // Test 2: Family dinner, kid-friendly
  {
    const intent = makeIntent({
      cuisine_importance: "low",
      emotional_intent: "casual",
      group_size_hint: "small_group",
      confidence: { cuisine: "low", vibe: "low", occasion: "high", constraints: "low", overall: "medium" },
    });
    const results = runRanking("family dinner with kids", "Family Dinner", intent, { withGoogle: true });
    printRanking('"family dinner with kids" (Family Dinner)', results);

    // Southern Soul (family_friendly_score=9, kid_friendliness=9) should rank well
    const top5 = getTopN(results, 5);
    assert(top5.includes("southernSoul"), "vibe_family_rank",
      `Southern Soul should be in top 5 for family. Got: ${top5.join(", ")}`);

    // Cocktail bar (family=1) should be near bottom
    const southern = findResult(results, "southernSoul");
    const cocktail = findResult(results, "cocktailLounge");
    assert(southern.result.dondeMatch > cocktail.result.dondeMatch, "vibe_family_vs_bar",
      `Southern (${southern.result.dondeMatch}) should > Cocktail (${cocktail.result.dondeMatch}) for family`);
  }

  // Test 3: Solo quick lunch
  {
    const intent = makeIntent({
      cuisine_importance: "low",
      emotional_intent: "casual",
      confidence: { cuisine: "low", vibe: "low", occasion: "medium", constraints: "low", overall: "medium" },
    });
    const results = runRanking("quick solo lunch", "Solo Dining", intent, { withGoogle: true });
    printRanking('"quick solo lunch" (Solo Dining)', results);

    // Convenience weight should be elevated for solo
    const top = results[0];
    // V8.8: Base convenience lowered 0.20→0.18; solo rule still adds +0.10
    // Post-normalization convenience ≈ 0.20 (was 0.22)
    assert(top.result.weights.convenience >= 0.19, "vibe_solo_conv",
      `Convenience weight=${top.result.weights.convenience.toFixed(3)}, want ≥0.19 for solo`);
  }

  // Test 4: Lively group outing
  {
    const intent = makeIntent({
      cuisine_importance: "low",
      vibe_keywords: ["lively"],
      emotional_intent: "celebrate",
      group_size_hint: "small_group",
      confidence: { cuisine: "low", vibe: "medium", occasion: "medium", constraints: "low", overall: "medium" },
    });
    const results = runRanking("lively group celebration", "Group Hangout", intent, { withGoogle: true });
    printRanking('"lively group celebration" (Group Hangout)', results);

    const top3 = getTopN(results, 3);
    const groupFriendly = top3.some(k =>
      k === "koreanBBQ" || k === "greekTaverna" || k === "southernSoul" || k === "peruvianFusion"
    );
    assert(groupFriendly, "vibe_group_rank",
      `Group-friendly restaurant should be in top 3. Got: ${top3.join(", ")}`);
  }

  // Test 5: Live music evening
  {
    const intent = makeIntent({
      cuisine_importance: "low",
      target_tags: ["live music"],
      target_features: ["live_music"],
      confidence: { cuisine: "low", vibe: "medium", occasion: "low", constraints: "low", overall: "medium" },
    });
    const results = runRanking("live music restaurant", "Any", intent, { withGoogle: true });
    printRanking('"live music restaurant"', results);

    // Cuban cafe has live_music=true
    const cuban = findResult(results, "cubanCafe");
    assert(cuban.result.dondeMatch >= 50, "vibe_livemusic_dm",
      `Cuban cafe DM=${cuban.result.dondeMatch}, want ≥50 for live music query`);
  }
}

// ==========================================
// CATEGORY 6: CUISINE FAMILY & ADJACENCY
// ==========================================

section("CATEGORY 6: CUISINE FAMILY & ADJACENCY");

{
  // Test 1: Mediterranean query — Greek should rank high
  {
    const intent = makeIntent({
      target_cuisines: ["Mediterranean"],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });
    const results = runRanking("Mediterranean food", "Any", intent, { withGoogle: true });
    printRanking('"Mediterranean food"', results);

    const top3 = getTopN(results, 3);
    assert(top3.includes("greekTaverna"), "family_med_greek",
      `Greek taverna should be in top 3 for Mediterranean. Got: ${top3.join(", ")}`);

    // Greek should have family-level cuisine alignment
    const greek = findResult(results, "greekTaverna");
    assert(greek.result.intentAlignment.cuisine >= 0.3, "family_med_greek_ca",
      `Greek IA.cuisine=${greek.result.intentAlignment.cuisine}, want ≥0.3 for Mediterranean family`);
  }

  // Test 2: East Asian query — Korean should get family-level credit
  // Note: Family-level matches (IA=0.40) hit the IA floor of 0.52, same as non-matches.
  // Korean gets food score uplift via isRelatedCuisine, but may not crack top 3 if
  // higher-rated restaurants (4.7-4.8★ vs 4.3★) dominate on reputation.
  // Verify the family mechanism works: Korean gets IA.cuisine ≥ 0.3 (family credit).
  {
    const intent = makeIntent({
      target_cuisines: ["East Asian"],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });
    const results = runRanking("East Asian food", "Any", intent, { withGoogle: true });
    printRanking('"East Asian food"', results);

    const korean = findResult(results, "koreanBBQ");
    assert(korean.result.intentAlignment.cuisine >= 0.3, "family_ea_korean_ca",
      `Korean IA.cuisine=${korean.result.intentAlignment.cuisine}, want ≥0.3 for East Asian family`);

    // Korean should beat restaurants with no Asian family connection
    const polish = findResult(results, "polishDiner");
    assert(korean.result.dondeMatch >= polish.result.dondeMatch, "family_ea_korean_vs_polish",
      `Korean (${korean.result.dondeMatch}) should ≥ Polish (${polish.result.dondeMatch}) for East Asian query`);
  }

  // Test 3: Latin American query — Peruvian and Cuban should surface
  {
    const intent = makeIntent({
      target_cuisines: ["Latin American"],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });
    const results = runRanking("Latin American food", "Any", intent, { withGoogle: true });
    printRanking('"Latin American food"', results);

    const top5 = getTopN(results, 5);
    assert(top5.includes("peruvianFusion"), "family_latam_peruvian",
      `Peruvian should be in top 5 for Latin American. Got: ${top5.join(", ")}`);
  }

  // Test 4: Southeast Asian query — Thai and Vietnamese should surface
  {
    const intent = makeIntent({
      target_cuisines: ["Southeast Asian"],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });
    const results = runRanking("Southeast Asian food", "Any", intent, { withGoogle: true });
    printRanking('"Southeast Asian food"', results);

    const top3 = getTopN(results, 3);
    const hasSEA = top3.includes("thaiStreet") || top3.includes("phoShop");
    assert(hasSEA, "family_sea",
      `Thai or Vietnamese should be in top 3 for SE Asian. Got: ${top3.join(", ")}`);
  }

  // Test 5: European query — Polish should get family credit
  {
    const intent = makeIntent({
      target_cuisines: ["European"],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });
    const results = runRanking("European food", "Any", intent, { withGoogle: true });
    printRanking('"European food"', results);

    const polish = findResult(results, "polishDiner");
    assert(polish.result.intentAlignment.cuisine >= 0.3, "family_eu_polish_ca",
      `Polish IA.cuisine=${polish.result.intentAlignment.cuisine}, want ≥0.3 for European family`);
  }
}

// ==========================================
// CATEGORY 7: REPUTATION-SPECIFIC (new queries)
// ==========================================

section("CATEGORY 7: REPUTATION-SPECIFIC (new queries)");

{
  const tests = [
    "top-rated restaurants",
    "award winning places",
    "best in chicago",
    "critically acclaimed dining",
  ];

  for (const query of tests) {
    const intent = makeIntent({
      cuisine_importance: "low",
      target_tags: ["reputation-focused", "fine dining"],
      confidence: { cuisine: "low", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });

    const results = runRanking(query, "Any", intent, { withGoogle: true });
    printRanking(`"${query}"`, results);

    const top3 = getTopN(results, 3);

    // High-rep restaurants should dominate
    const hasRep = top3.some(k =>
      k === "cocktailLounge" || k === "peruvianFusion" || k === "indianFine" || k === "greekTaverna"
    );
    assert(hasRep, `rep_rank:${query}`,
      `Reputation restaurant should be in top 3. Got: ${top3.join(", ")}`);

    // Rule 13 should fire
    const topResult = results[0];
    const rule13Fired = topResult.result.weightShiftReasons.some(r =>
      r.toLowerCase().includes("reputation")
    );
    assert(rule13Fired, `rep_rule13:${query}`,
      `Rule 13 (reputation) should fire. Rules: ${topResult.result.weightShiftReasons.join(", ")}`);

    // Reputation weight should be elevated
    assert(topResult.result.weights.reputation >= 0.28, `rep_weight:${query}`,
      `Rep weight=${topResult.result.weights.reputation.toFixed(3)}, want ≥0.28`);

    // Peruvian (awards) should beat Polish Diner for reputation queries
    const peru = findResult(results, "peruvianFusion");
    const polish = findResult(results, "polishDiner");
    assert(peru.result.dondeMatch > polish.result.dondeMatch, `rep_awards_vs_none:${query}`,
      `Peruvian (${peru.result.dondeMatch}) should > Polish (${polish.result.dondeMatch})`);
  }
}

// ==========================================
// CATEGORY 8: COMBINED / CONFLICTING (new scenarios)
// ==========================================

section("CATEGORY 8: COMBINED / CONFLICTING (new scenarios)");

{
  // Test 1: Multiple cuisine signals + vibe
  {
    const intent = makeIntent({
      target_cuisines: ["Thai", "Vietnamese", "Korean", "Indian"],
      cuisine_importance: "high",
      target_tags: ["great value"],
      practical_constraints: ["budget_conscious"],
      confidence: { cuisine: "medium", vibe: "low", occasion: "low", constraints: "high", overall: "high" },
    });
    const results = runRanking("cheap Asian food", "Any", intent, { withGoogle: true });
    printRanking('"cheap Asian food"', results);

    // All weights valid
    for (const r of results) {
      const w = r.result.weights;
      for (const [k, v] of Object.entries(w)) {
        assert(v >= 0.05 && v <= 0.50, `combined_weight_clamp:${k}`,
          `Weight ${k}=${v.toFixed(3)} should be in [0.05, 0.50]`);
      }
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      assert(Math.abs(sum - 1.0) < 0.01, "combined_weight_sum",
        `Weights sum=${sum.toFixed(4)}, want ~1.0`);
    }

    // Thai/Vietnamese/Korean should be near the top
    const top5 = getTopN(results, 5);
    const hasAsian = top5.some(k =>
      k === "thaiStreet" || k === "phoShop" || k === "koreanBBQ"
    );
    assert(hasAsian, "combined_cheap_asian",
      `Asian budget restaurant should be in top 5. Got: ${top5.join(", ")}`);
  }

  // Test 2: Vegan Indian (dietary tension)
  {
    const intent = makeIntent({
      target_cuisines: ["Indian"],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });
    const results = runRanking("vegan Indian food", "Any", intent, { withGoogle: true, dietary: ["vegan"] });
    printRanking('"vegan Indian food" (dietary: vegan)', results);

    const indian = findResult(results, "indianFine");
    assert(indian.result.dondeMatch >= 30, "combined_vegan_indian",
      `Indian DM=${indian.result.dondeMatch}, want ≥30 even with vegan dietary`);
  }

  // Test 3: All signals combined — Cuban, live music, spontaneous date
  {
    const intent = makeIntent({
      target_cuisines: ["Cuban"],
      cuisine_importance: "high",
      target_tags: ["live music"],
      target_features: ["live_music"],
      emotional_intent: "impress",
      date_type: "first_date",
      group_size_hint: "couple",
      spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "medium", overall: "high" },
    });
    const results = runRanking("spontaneous Cuban dinner with live music for a date", "Date Night", intent, { withGoogle: true });
    printRanking('"spontaneous Cuban dinner with live music, date night"', results);

    const topRules = results[0].result.weightShiftReasons;
    console.log(`    Rules fired (${topRules.length}): ${topRules.join(", ")}`);
    assert(topRules.length >= 3, "combined_cuban_rules",
      `Expected ≥3 rules, got ${topRules.length}`);

    const hasActiveSignals = results[0].result.intentAlignment.hasActiveSignals;
    assert(hasActiveSignals, "combined_cuban_signals",
      `Expected hasActiveSignals=true`);
  }

  // Test 4: Group Korean BBQ celebration
  {
    const intent = makeIntent({
      target_cuisines: ["Korean"],
      cuisine_importance: "high",
      emotional_intent: "celebrate",
      group_size_hint: "small_group",
      confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "low", overall: "high" },
    });
    const results = runRanking("Korean BBQ for group celebration", "Group Hangout", intent, { withGoogle: true });
    printRanking('"Korean BBQ for group celebration" (Group Hangout)', results);

    const top3 = getTopN(results, 3);
    assert(top3.includes("koreanBBQ"), "combined_korean_group",
      `Korean BBQ should be in top 3. Got: ${top3.join(", ")}`);
  }

  // Test 5: Outdoor patio constraint
  {
    const intent = makeIntent({
      target_tags: ["outdoor patio"],
      practical_constraints: ["outdoor_preferred"],
      cuisine_importance: "low",
    });
    const results = runRanking("outdoor patio dining", "Any", intent, { withGoogle: true });
    printRanking('"outdoor patio dining"', results);

    const greek = findResult(results, "greekTaverna");
    assert(greek.result.intentMultiplier >= 1.04, "filter:outdoor IM",
      `Greek IM=${greek.result.intentMultiplier.toFixed(3)}, should ≥1.04 for outdoor match`);
  }

  // Test 6: Pet-friendly outdoor
  {
    const intent = makeIntent({
      target_tags: ["pet friendly", "outdoor patio"],
      practical_constraints: ["pet_friendly", "outdoor_preferred"],
      cuisine_importance: "low",
    });
    const results = runRanking("pet friendly patio restaurant", "Any", intent, { withGoogle: true });
    printRanking('"pet friendly patio restaurant"', results);

    const southern = findResult(results, "southernSoul");
    assert(southern.result.intentMultiplier >= 1.04, "filter:pet IM",
      `Southern IM=${southern.result.intentMultiplier.toFixed(3)}, should ≥1.04 for pet/outdoor match`);
  }

  // Test 7: Walk-in spontaneous
  {
    const intent = makeIntent({
      practical_constraints: ["walk_in"],
      spontaneity: "spontaneous",
      cuisine_importance: "low",
    });
    const results = runRanking("walk-in tonight", "Any", intent, { withGoogle: true });
    printRanking('"walk-in tonight"', results);

    // Convenience should be elevated for spontaneous
    const top = results[0];
    assert(top.result.weights.convenience >= 0.22, "filter:walkin_conv",
      `Convenience weight=${top.result.weights.convenience.toFixed(3)}, want ≥0.22 for spontaneous`);
  }
}

// ==========================================
// CATEGORY 9: DIETARY RESTRICTIONS
// ==========================================

section("CATEGORY 9: DIETARY RESTRICTIONS");

{
  // Test 1: Vegetarian — Polish diner has vegetarian options
  {
    const intent = makeIntent({
      cuisine_importance: "low",
      confidence: { cuisine: "low", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });
    const results = runRanking("vegetarian restaurant", "Any", intent, { withGoogle: true, dietary: ["vegetarian"] });
    printRanking('"vegetarian restaurant"', results);

    // All scores should be valid
    for (const r of results) {
      assert(r.result.dondeMatch >= 0 && r.result.dondeMatch <= 99, "diet_veg_range",
        `DM=${r.result.dondeMatch}, want [0,99]`);
    }
  }

  // Test 2: Gluten-free Thai
  {
    const intent = makeIntent({
      target_cuisines: ["Thai"],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });
    const results = runRanking("gluten-free Thai food", "Any", intent, { withGoogle: true, dietary: ["gluten-free"] });
    printRanking('"gluten-free Thai food"', results);

    // Thai should still rank #1 (cuisine match dominates)
    assert(results[0].key === "thaiStreet", "diet_gf_thai",
      `Thai should be #1 even with GF restriction. Got ${results[0].key}`);
  }
}

// ==========================================
// CATEGORY 10: EDGE CASES / STRESS TESTS
// ==========================================

section("CATEGORY 10: EDGE CASES / STRESS TESTS");

{
  // Test 1: Empty query, null intent
  {
    const results = runRanking("", "Any", null, { withGoogle: true });
    printRanking('"" (null intent)', results);

    for (const r of results) {
      assert(r.result.dondeMatch >= 0 && r.result.dondeMatch <= 99, "edge_null_dm",
        `DM=${r.result.dondeMatch}, want [0,99]`);
      assert(r.result.intentMultiplier === 1.0, "edge_null_im",
        `IM=${r.result.intentMultiplier} should be 1.0 for null intent`);
    }
  }

  // Test 2: Very specific niche query — no perfect match in pool
  {
    const intent = makeIntent({
      target_cuisines: ["Moroccan"],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    });
    const results = runRanking("authentic Moroccan tagine", "Any", intent, { withGoogle: true });
    printRanking('"authentic Moroccan tagine" (no Moroccan in pool)', results);

    // No crash, all scores valid
    for (const r of results) {
      assert(r.result.dondeMatch >= 0 && r.result.dondeMatch <= 99, "edge_niche_range",
        `DM=${r.result.dondeMatch}, want [0,99]`);
    }

    // Intent multiplier should still penalize mismatches (active signals)
    const top = results[0];
    assert(top.result.intentMultiplier < 1.0, "edge_niche_im",
      `IM=${top.result.intentMultiplier} should < 1.0 when no cuisine matches`);
  }

  // Test 3: Extremely long query
  {
    const longQuery = "I want a cozy intimate romantic fine dining restaurant with live jazz music outdoor patio pet friendly farm to table seasonal menu craft cocktails wine pairing tasting menu for a special anniversary celebration with my partner somewhere quiet in the West Loop neighborhood with valet parking and late night hours";
    const intent = makeIntent({
      target_tags: ["romantic", "live music", "outdoor patio", "pet friendly", "farm-to-table", "craft cocktails"],
      vibe_keywords: ["cozy", "intimate"],
      emotional_intent: "impress",
      date_type: "anniversary",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    });
    const results = runRanking(longQuery, "Special Occasion", intent, { withGoogle: true });
    printRanking('"extremely long query" (Special Occasion)', results);

    // Should not crash, scores should be valid
    for (const r of results) {
      assert(r.result.dondeMatch >= 0 && r.result.dondeMatch <= 99, "edge_long_range",
        `DM=${r.result.dondeMatch}, want [0,99]`);
    }
    assert(results[0].result.dondeMatch >= 40, "edge_long_score",
      `Top DM=${results[0].result.dondeMatch}, want ≥40 even for complex query`);
  }

  // Test 4: Contradicting signals — cheap fine dining
  {
    const intent = makeIntent({
      target_tags: ["fine dining", "great value"],
      practical_constraints: ["budget_conscious"],
      cuisine_importance: "low",
      confidence: { cuisine: "low", vibe: "medium", occasion: "low", constraints: "high", overall: "medium" },
    });
    const results = runRanking("cheap fine dining", "Any", intent, { withGoogle: true });
    printRanking('"cheap fine dining" (contradicting)', results);

    for (const r of results) {
      assert(r.result.dondeMatch >= 0 && r.result.dondeMatch <= 99, "edge_contradict_range",
        `DM=${r.result.dondeMatch}, want [0,99]`);
    }
  }
}

// ==========================================
// STRUCTURAL TESTS
// ==========================================

section("STRUCTURAL TESTS");

{
  // Test: reRankV8 ordering
  const intent = makeIntent({
    target_cuisines: ["Thai"],
    cuisine_importance: "high",
    confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
  });
  const ranked = reRankV8(ALL_PROFILES, "Any", "Thai food", intent);

  for (let i = 0; i < ranked.length - 1; i++) {
    assert(ranked[i].result.dondeMatch >= ranked[i + 1].result.dondeMatch, `rerank_order_${i}`,
      `DM[${i}]=${ranked[i].result.dondeMatch} should ≥ DM[${i+1}]=${ranked[i+1].result.dondeMatch}`);
  }

  for (const r of ranked) {
    assert(r.result.dataCompleteness >= 0 && r.result.dataCompleteness <= 1, "rerank_completeness",
      `dataCompleteness=${r.result.dataCompleteness}, want [0,1]`);
  }

  for (const r of ranked) {
    assert(r.result.matchNarrative != null, "rerank_narrative",
      `matchNarrative should not be null`);
    assert(typeof r.result.matchNarrative.strongest_factor === "string", "rerank_narrative_factor",
      `strongest_factor should be a string`);
  }

  for (const r of ranked) {
    assert(r.result.dondeMatch >= 0 && r.result.dondeMatch <= 99, "rerank_dm_range",
      `DM=${r.result.dondeMatch}, want [0,99]`);
  }
}

// ==========================================
// SUMMARY
// ==========================================

console.log("\n" + "=".repeat(70));
console.log("  V8 SCORING PIPELINE TEST 2 RESULTS");
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
