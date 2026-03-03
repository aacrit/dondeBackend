/**
 * V9 Scoring Pipeline Test — Offline, Zero API Calls
 *
 * Tests the V9 Relevance × Quality scoring engine across 8 scenarios:
 *   1. Open-ended ("surprise me") — Relevance=1.0, reputation dominates quality
 *   2. Dish-specific ("momos") — Dish relevance gates, review intelligence used
 *   3. Cuisine-specific ("Thai food") — Cuisine relevance gates
 *   4. Vibe-specific ("quiet romantic") — Vibe relevance gates
 *   5. Dish + Cuisine mismatch ("momos at Italian place") — Low relevance
 *   6. Review intelligence vs menu_highlights — RI > menu_highlights
 *   7. No review intelligence fallback — Uses structured data only
 *   8. Neighborhood post-scoring gate — Not a hard filter
 *
 * Uses 10 mock restaurant archetypes with mock review intelligence data.
 * Run: cd dondeBackend && deno run --allow-read tests/scoring-v9/scoring-v9-pipeline-test.ts
 */

import {
  computeV9Score,
  computeRelevance,
  computeQuality,
  reRankV9,
} from "../../supabase/functions/recommend/_shared/scoring-v9.ts";
import type { RestaurantProfile, DeepProfile } from "../../supabase/functions/recommend/_shared/types.ts";
import type { IntentClassificationV2, IntentConfidence } from "../../supabase/functions/recommend/_shared/intent-classifier.ts";
import type { GooglePlaceData } from "../../supabase/functions/recommend/_shared/google-places.ts";
import type { V9Candidate, V9ScoringContext, ReviewIntelligence } from "../../supabase/functions/recommend/_shared/types-v9.ts";

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

function makeRI(overrides: Partial<ReviewIntelligence> = {}): ReviewIntelligence {
  return {
    dish_catalog: [],
    popular_dishes: [],
    cuisine_signals: [],
    review_food_quality: null,
    review_service_quality: null,
    review_ambiance_quality: null,
    review_value_score: null,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<V9Candidate> & { name?: string } = {}): V9Candidate {
  const base: V9Candidate = {
    id: crypto.randomUUID(),
    name: overrides.name || "Test Restaurant",
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
    review_intelligence: null,
    ri_text_rank: 0,
    dp_menu_highlights: null,
    ...overrides,
  } as V9Candidate;
  return base;
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
    practical_constraints: [], emotional_intent: "casual",
    date_type: null, group_size_hint: null, spontaneity: "unknown",
    confidence: {
      cuisine: "low", vibe: "low", occasion: "low",
      constraints: "low", overall: "medium",
    },
    ...overrides,
  };
}

function makeContext(overrides: Partial<V9ScoringContext> = {}): V9ScoringContext {
  return {
    occasion: "Any",
    specialRequest: "",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: makeGoogle(),
    intent: null,
    ...overrides,
  };
}

// ==========================================
// 10 MOCK RESTAURANT ARCHETYPES (with Review Intelligence)
// ==========================================

const CANDIDATES: Record<string, V9Candidate> = {
  // Momo World — Tibetan/Nepali restaurant WITH momos in review intelligence
  momoWorld: makeCandidate({
    name: "Momo World",
    cuisine_type: "Indian",  // Misclassified as Indian (common for Tibetan/Nepali)
    noise_level: "Moderate",
    date_friendly_score: 4,
    group_friendly_score: 7,
    family_friendly_score: 6,
    romantic_rating: 3,
    business_lunch_score: 3,
    solo_dining_score: 7,
    hole_in_wall_factor: 8,
    review_intelligence: makeRI({
      dish_catalog: ["momos", "steamed momo", "fried momo", "jhol momo", "thukpa", "chowmein", "butter chicken"],
      popular_dishes: ["momos", "steamed momo", "fried momo"],
      cuisine_signals: ["Tibetan", "Nepali", "Indian", "momos"],
      review_food_quality: 7.5,
      review_service_quality: 6.0,
      review_ambiance_quality: 5.5,
      review_value_score: 8.0,
    }),
    ri_text_rank: 0.85,
    deep_profile: makeDeepProfile({
      signature_dishes: [{ dish: "Butter Chicken", why: "Popular main" }],
      menu_highlights: ["tandoori chicken", "naan", "biryani"],  // No momos in AI-predicted
      cultural_authenticity: 8,
      service_style: "Counter",
    }),
  }),

  // Giordano's — Deep dish pizza restaurant
  giordanos: makeCandidate({
    name: "Giordano's",
    cuisine_type: "Pizza",
    noise_level: "Moderate",
    date_friendly_score: 5,
    group_friendly_score: 8,
    family_friendly_score: 9,
    romantic_rating: 4,
    business_lunch_score: 5,
    solo_dining_score: 6,
    hole_in_wall_factor: 5,
    trending_score: 7,
    review_intelligence: makeRI({
      dish_catalog: ["deep dish pizza", "stuffed pizza", "thin crust", "garlic bread", "tiramisu", "cheese pizza"],
      popular_dishes: ["deep dish pizza", "stuffed pizza"],
      cuisine_signals: ["Italian", "pizza", "Chicago-style"],
      review_food_quality: 7.8,
      review_service_quality: 6.5,
      review_ambiance_quality: 6.0,
      review_value_score: 7.0,
    }),
    ri_text_rank: 0.0,
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Chicago Deep Dish", why: "Iconic stuffed deep dish" },
        { dish: "Thin Crust Pizza", why: "Classic tavern cut" },
      ],
      service_style: "Full Table Service",
      cultural_authenticity: 7,
      neighborhood_integration: "institution",
    }),
  }),

  // Fine Italian (NO momos, NO deep dish)
  fineItalian: makeCandidate({
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
    review_intelligence: makeRI({
      dish_catalog: ["truffle pasta", "osso buco", "risotto", "tiramisu", "burrata"],
      popular_dishes: ["truffle pasta", "osso buco"],
      cuisine_signals: ["Italian", "Northern Italian", "fine dining"],
      review_food_quality: 8.5,
      review_service_quality: 8.0,
      review_ambiance_quality: 9.0,
      review_value_score: 6.5,
    }),
    ri_text_rank: 0.0,
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Truffle Pasta", why: "House-made pappardelle with black truffle" },
        { dish: "Osso Buco", why: "Slow-braised veal shank" },
      ],
      menu_highlights: ["cacio e pepe", "tiramisu", "burrata", "risotto"],
      service_style: "Full Table Service",
      meal_pacing: "leisurely",
      energy_level: 5,
      music_vibe: "curated-playlist",
      decor_style: "rustic elegant, exposed brick, warm wood",
      conversation_friendliness: 8,
      awards_recognition: ["James Beard Semifinalist 2025"],
      chef_notable: true,
      cultural_authenticity: 9,
      neighborhood_integration: "destination",
      enrichment_confidence: 0.9,
    }),
  }),

  // Hole-in-wall Mexican
  tacoShack: makeCandidate({
    name: "Taqueria Los Comales",
    cuisine_type: "Mexican",
    price_level: "$",
    noise_level: "Moderate",
    date_friendly_score: 4,
    group_friendly_score: 7,
    family_friendly_score: 8,
    romantic_rating: 3,
    business_lunch_score: 3,
    solo_dining_score: 8,
    hole_in_wall_factor: 9,
    review_intelligence: makeRI({
      dish_catalog: ["al pastor tacos", "birria tacos", "carnitas", "elote", "churros"],
      popular_dishes: ["al pastor tacos", "birria tacos"],
      cuisine_signals: ["Mexican", "tacos", "street food"],
      review_food_quality: 8.0,
      review_service_quality: 5.5,
      review_ambiance_quality: 4.0,
      review_value_score: 9.0,
    }),
    ri_text_rank: 0.0,
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Al Pastor Tacos", why: "Spit-roasted pork" },
        { dish: "Birria Tacos", why: "Consomme dipping tacos" },
      ],
      service_style: "Counter",
      cultural_authenticity: 9,
      neighborhood_integration: "institution",
    }),
  }),

  // Michelin Japanese
  michelinJapanese: makeCandidate({
    name: "Kyoten",
    cuisine_type: "Japanese",
    price_level: "$$$$",
    noise_level: "Quiet",
    lighting_ambiance: "dim, intimate, minimalist",
    dress_code: "Business Casual",
    date_friendly_score: 9,
    romantic_rating: 9,
    solo_dining_score: 8,
    trending_score: 10,
    tags: ["fine dining", "tasting menu", "romantic", "quiet"],
    review_intelligence: makeRI({
      dish_catalog: ["omakase", "wagyu tataki", "uni", "otoro", "seasonal nigiri"],
      popular_dishes: ["omakase", "wagyu tataki"],
      cuisine_signals: ["Japanese", "sushi", "omakase"],
      review_food_quality: 9.5,
      review_service_quality: 9.0,
      review_ambiance_quality: 9.0,
      review_value_score: 6.0,
    }),
    ri_text_rank: 0.0,
    deep_profile: makeDeepProfile({
      signature_dishes: [{ dish: "Omakase", why: "20-course chef's selection" }],
      service_style: "Omakase",
      meal_pacing: "ceremonial",
      reservation_difficulty: "hard_to_get",
      energy_level: 3,
      music_vibe: "ambient",
      awards_recognition: ["Michelin Star 2024"],
      chef_notable: true,
      enrichment_confidence: 0.95,
    }),
  }),

  // Thai restaurant
  thaiPlace: makeCandidate({
    name: "Aroy Thai",
    cuisine_type: "Thai",
    noise_level: "Moderate",
    date_friendly_score: 6,
    group_friendly_score: 7,
    family_friendly_score: 7,
    romantic_rating: 5,
    review_intelligence: makeRI({
      dish_catalog: ["pad thai", "green curry", "tom yum", "mango sticky rice", "papaya salad"],
      popular_dishes: ["pad thai", "green curry"],
      cuisine_signals: ["Thai", "Southeast Asian"],
      review_food_quality: 7.0,
      review_service_quality: 6.5,
      review_ambiance_quality: 5.5,
      review_value_score: 7.5,
    }),
    ri_text_rank: 0.0,
    deep_profile: makeDeepProfile({
      signature_dishes: [{ dish: "Pad Thai", why: "Classic" }],
      service_style: "Full Table Service",
      cultural_authenticity: 7,
    }),
  }),

  // No review intelligence (sparse data restaurant)
  sparseData: makeCandidate({
    name: "Mystery Bistro",
    cuisine_type: "French",
    review_intelligence: null,
    ri_text_rank: 0,
    deep_profile: makeDeepProfile({
      signature_dishes: [{ dish: "Croque Monsieur", why: "Classic French" }],
      service_style: "Full Table Service",
    }),
  }),

  // Bar (wrong for food queries)
  cocktailBar: makeCandidate({
    name: "The Violet Hour",
    cuisine_type: "Cocktail Bar",
    noise_level: "Moderate",
    tags: ["speakeasy", "cocktails", "date night"],
    review_intelligence: makeRI({
      dish_catalog: ["craft cocktails", "small plates", "charcuterie"],
      cuisine_signals: ["Cocktail Bar", "speakeasy"],
      review_food_quality: 5.0,
      review_ambiance_quality: 9.0,
    }),
    ri_text_rank: 0.0,
    deep_profile: makeDeepProfile({
      service_style: "Bar Service",
      music_vibe: "curated-playlist",
      decor_style: "speakeasy, intimate",
      energy_level: 5,
      conversation_friendliness: 7,
    }),
  }),

  // KAI ZAN (NULL cuisine_type — data quality issue)
  kaiZan: makeCandidate({
    name: "KAI ZAN",
    cuisine_type: null,  // Data quality issue!
    noise_level: "Quiet",
    date_friendly_score: 8,
    romantic_rating: 8,
    trending_score: 8,
    review_intelligence: makeRI({
      dish_catalog: ["omakase", "sushi", "sashimi", "wagyu"],
      popular_dishes: ["omakase"],
      cuisine_signals: ["Japanese", "sushi", "omakase"],  // Self-healing!
      review_food_quality: 9.0,
      review_service_quality: 8.5,
      review_ambiance_quality: 8.0,
    }),
    ri_text_rank: 0.0,
    deep_profile: makeDeepProfile({
      service_style: "Omakase",
      awards_recognition: ["Best Sushi 2024"],
      chef_notable: true,
    }),
  }),

  // Steakhouse
  steakhouse: makeCandidate({
    name: "RPM Steak",
    cuisine_type: "Steakhouse",
    price_level: "$$$$",
    noise_level: "Moderate",
    neighborhood_name: "River North",
    date_friendly_score: 8,
    group_friendly_score: 7,
    business_lunch_score: 9,
    romantic_rating: 7,
    trending_score: 8,
    review_intelligence: makeRI({
      dish_catalog: ["ribeye", "filet mignon", "bone marrow", "wedge salad", "lobster tail"],
      popular_dishes: ["ribeye", "filet mignon"],
      cuisine_signals: ["Steakhouse", "American", "fine dining"],
      review_food_quality: 8.5,
      review_service_quality: 8.0,
      review_ambiance_quality: 8.0,
      review_value_score: 5.5,
    }),
    ri_text_rank: 0.0,
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Ribeye", why: "Prime aged 28 days" },
        { dish: "Filet Mignon", why: "Butter-topped center cut" },
      ],
      service_style: "Full Table Service",
      awards_recognition: ["Best Steakhouse Chicago 2024"],
      chef_notable: true,
    }),
  }),
};

// ==========================================
// TEST 1: OPEN-ENDED ("surprise me")
// ==========================================

section("Test 1: Open-Ended — Reputation Dominates");
{
  const context = makeContext({
    occasion: "Any",
    specialRequest: "surprise me",
    intent: null,
  });

  // All candidates should have Relevance = 1.0
  const allCandidates = Object.values(CANDIDATES);
  const ranked = reRankV9(allCandidates, context);

  assert(ranked.length === allCandidates.length, "T1.1 All candidates scored");
  assert(ranked[0].relevance.score === 1.0, "T1.2 Top pick relevance = 1.0",
    `Got: ${ranked[0].relevance.score}`);
  assert(ranked[0].relevance.type === "open_ended", "T1.3 Relevance type = open_ended",
    `Got: ${ranked[0].relevance.type}`);

  // Reputation-heavy quality weights should be used
  assert(ranked[0].qualityWeights.reputation === 0.45, "T1.4 Open-ended uses reputation weight 0.45",
    `Got: ${ranked[0].qualityWeights.reputation}`);

  // Top pick should be a high-reputation restaurant
  const topName = ranked[0].profile.name;
  const isHighRep = ["Kyoten", "Piccolo Sogno", "RPM Steak"].includes(topName);
  assert(isHighRep, "T1.5 Top pick is high-reputation restaurant",
    `Got: ${topName} (DM=${ranked[0].dondeMatch})`);

  // All scores should be non-zero (open-ended = everyone relevant)
  assert(ranked.every(r => r.dondeMatch > 0), "T1.6 All scores > 0");

  console.log(`  Top 3: ${ranked.slice(0, 3).map(r => `${r.profile.name} (${r.dondeMatch})`).join(", ")}`);
}

// ==========================================
// TEST 2: DISH-SPECIFIC ("momos") — THE V9 KEY TEST
// ==========================================

section("Test 2: Dish-Specific — Review Intelligence Gates");
{
  const context = makeContext({
    occasion: "Any",
    specialRequest: "momos",
    intent: makeIntent({
      dish_level_intent: "momos",
      target_cuisines: [],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "high" },
    }),
  });

  const candidates = [
    CANDIDATES.momoWorld,
    CANDIDATES.fineItalian,
    CANDIDATES.cocktailBar,
    CANDIDATES.thaiPlace,
    CANDIDATES.tacoShack,
  ];
  const ranked = reRankV9(candidates, context);

  // Momo World should be #1 (review intelligence has "momos" in dish_catalog)
  assert(ranked[0].profile.name === "Momo World", "T2.1 Momo World is #1",
    `Got: ${ranked[0].profile.name} (DM=${ranked[0].dondeMatch})`);

  // Momo World should have high relevance (dish match in review intelligence)
  assert(ranked[0].relevance.score >= 0.90, "T2.2 Momo World relevance >= 0.90",
    `Got: ${ranked[0].relevance.score}`);
  assert(ranked[0].relevance.type === "dish", "T2.3 Relevance type = dish");

  // Fine Italian should have very low relevance (no momos anywhere)
  const italian = ranked.find(r => r.profile.name === "Piccolo Sogno")!;
  assert(italian.relevance.score <= 0.10, "T2.4 Fine Italian relevance <= 0.10 (no momos)",
    `Got: ${italian.relevance.score}`);

  // Momo World score should be much higher than Italian
  assert(ranked[0].dondeMatch > italian.dondeMatch + 20,
    "T2.5 Momo World scores 20+ points above Italian",
    `Momo World: ${ranked[0].dondeMatch}, Italian: ${italian.dondeMatch}`);

  // Cocktail bar should also be near bottom
  const bar = ranked.find(r => r.profile.name === "The Violet Hour")!;
  assert(bar.dondeMatch < 15, "T2.6 Cocktail bar very low for momos query",
    `Got: ${bar.dondeMatch}`);

  console.log(`  Ranked: ${ranked.map(r => `${r.profile.name} (R=${r.relevance.score.toFixed(2)}, DM=${r.dondeMatch})`).join(", ")}`);
}

// ==========================================
// TEST 3: CUISINE-SPECIFIC ("Thai food")
// ==========================================

section("Test 3: Cuisine-Specific — Cuisine Relevance Gates");
{
  const context = makeContext({
    occasion: "Any",
    specialRequest: "Thai food",
    intent: makeIntent({
      target_cuisines: ["Thai"],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "high" },
    }),
  });

  const candidates = [
    CANDIDATES.thaiPlace,
    CANDIDATES.fineItalian,
    CANDIDATES.tacoShack,
    CANDIDATES.cocktailBar,
  ];
  const ranked = reRankV9(candidates, context);

  // Thai restaurant should be #1
  assert(ranked[0].profile.name === "Aroy Thai", "T3.1 Thai restaurant is #1",
    `Got: ${ranked[0].profile.name} (DM=${ranked[0].dondeMatch})`);

  // Thai should have high cuisine relevance
  assert(ranked[0].relevance.score >= 0.90, "T3.2 Thai relevance >= 0.90",
    `Got: ${ranked[0].relevance.score}`);
  assert(ranked[0].relevance.type === "cuisine", "T3.3 Relevance type = cuisine");

  // Italian should have low relevance for Thai query
  const italian = ranked.find(r => r.profile.name === "Piccolo Sogno")!;
  assert(italian.relevance.score <= 0.10, "T3.4 Italian relevance low for Thai",
    `Got: ${italian.relevance.score}`);

  // Mexican should also be low (not same family)
  const mexican = ranked.find(r => r.profile.name === "Taqueria Los Comales")!;
  assert(mexican.relevance.score <= 0.10, "T3.5 Mexican low for Thai query",
    `Got: ${mexican.relevance.score}`);

  console.log(`  Ranked: ${ranked.map(r => `${r.profile.name} (R=${r.relevance.score.toFixed(2)}, DM=${r.dondeMatch})`).join(", ")}`);
}

// ==========================================
// TEST 4: DEEP DISH PIZZA — Review Intelligence for Iconic Dish
// ==========================================

section("Test 4: Deep Dish Pizza — Iconic Dish in Review Intelligence");
{
  const context = makeContext({
    occasion: "Family Dinner",
    specialRequest: "deep dish pizza",
    intent: makeIntent({
      dish_level_intent: "deep dish pizza",
      target_cuisines: ["Pizza", "Italian"],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "low", overall: "high" },
    }),
  });

  const candidates = [
    CANDIDATES.giordanos,
    CANDIDATES.fineItalian,
    CANDIDATES.tacoShack,
  ];
  const ranked = reRankV9(candidates, context);

  // Giordano's should be #1 (review intelligence has "deep dish pizza" as popular dish)
  assert(ranked[0].profile.name === "Giordano's", "T4.1 Giordano's is #1",
    `Got: ${ranked[0].profile.name} (DM=${ranked[0].dondeMatch})`);

  // Giordano's should have perfect dish relevance
  assert(ranked[0].relevance.score === 1.0, "T4.2 Giordano's relevance = 1.0 (popular dish)",
    `Got: ${ranked[0].relevance.score}`);

  // Fine Italian should get SOME relevance (Italian cuisine family) but capped
  const italian = ranked.find(r => r.profile.name === "Piccolo Sogno")!;
  assert(italian.relevance.score <= 0.40, "T4.3 Italian capped at 0.40 (right cuisine, wrong dish)",
    `Got: ${italian.relevance.score}`);

  console.log(`  Ranked: ${ranked.map(r => `${r.profile.name} (R=${r.relevance.score.toFixed(2)}, DM=${r.dondeMatch})`).join(", ")}`);
}

// ==========================================
// TEST 5: VIBE-SPECIFIC ("quiet romantic anniversary")
// ==========================================

section("Test 5: Vibe-Specific — Atmosphere Gates");
{
  const context = makeContext({
    occasion: "Special Occasion",
    specialRequest: "quiet romantic anniversary dinner",
    intent: makeIntent({
      vibe_keywords: ["quiet", "romantic"],
      target_tags: ["romantic", "fine dining"],
      emotional_intent: "romantic",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    }),
  });

  const candidates = [
    CANDIDATES.fineItalian,
    CANDIDATES.michelinJapanese,
    CANDIDATES.tacoShack,
    CANDIDATES.cocktailBar,
  ];
  const ranked = reRankV9(candidates, context);

  // Top pick should be romantic (Italian or Japanese)
  const topName = ranked[0].profile.name;
  assert(
    topName === "Piccolo Sogno" || topName === "Kyoten",
    "T5.1 Top pick is romantic restaurant",
    `Got: ${topName} (DM=${ranked[0].dondeMatch})`,
  );
  assert(ranked[0].relevance.type === "vibe", "T5.2 Relevance type = vibe");

  // Vibe quality weights should dominate
  assert(ranked[0].qualityWeights.vibe === 0.35, "T5.3 Vibe weight = 0.35",
    `Got: ${ranked[0].qualityWeights.vibe}`);

  // Taco shack should be low (wrong vibe for romantic dinner)
  const taco = ranked.find(r => r.profile.name === "Taqueria Los Comales")!;
  assert(taco.dondeMatch < ranked[0].dondeMatch - 10,
    "T5.4 Taco shack scores much lower",
    `Taco: ${taco.dondeMatch}, Top: ${ranked[0].dondeMatch}`);

  console.log(`  Ranked: ${ranked.map(r => `${r.profile.name} (R=${r.relevance.score.toFixed(2)}, DM=${r.dondeMatch})`).join(", ")}`);
}

// ==========================================
// TEST 6: SELF-HEALING DATA (KAI ZAN with cuisine_type=NULL)
// ==========================================

section("Test 6: Self-Healing — Review Intelligence Fixes NULL cuisine_type");
{
  const context = makeContext({
    occasion: "Date Night",
    specialRequest: "sushi omakase",
    intent: makeIntent({
      dish_level_intent: "omakase",
      target_cuisines: ["Japanese"],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "medium", occasion: "medium", constraints: "low", overall: "high" },
    }),
  });

  const candidates = [
    CANDIDATES.kaiZan,
    CANDIDATES.fineItalian,
    CANDIDATES.tacoShack,
  ];
  const ranked = reRankV9(candidates, context);

  // KAI ZAN should rank high despite cuisine_type=NULL
  // Because review intelligence has cuisine_signals: ["Japanese", "sushi", "omakase"]
  assert(ranked[0].profile.name === "KAI ZAN", "T6.1 KAI ZAN is #1 despite NULL cuisine_type",
    `Got: ${ranked[0].profile.name} (DM=${ranked[0].dondeMatch})`);

  // Dish relevance should be high (omakase in dish_catalog)
  assert(ranked[0].relevance.score >= 0.85, "T6.2 KAI ZAN relevance >= 0.85",
    `Got: ${ranked[0].relevance.score}`);

  console.log(`  KAI ZAN: R=${ranked[0].relevance.score.toFixed(2)}, DM=${ranked[0].dondeMatch}`);
}

// ==========================================
// TEST 7: NO REVIEW INTELLIGENCE — Structured Data Fallback
// ==========================================

section("Test 7: No Review Intelligence — Falls Back to Structured Data");
{
  const context = makeContext({
    occasion: "Any",
    specialRequest: "croque monsieur",
    intent: makeIntent({
      dish_level_intent: "croque monsieur",
      target_cuisines: ["French"],
      cuisine_importance: "high",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "high" },
    }),
  });

  const sparseCandidate = CANDIDATES.sparseData;
  const result = computeV9Score(sparseCandidate, context);

  // Should still get dish relevance from signature_dishes (no RI)
  assert(result.relevance.score >= 0.50, "T7.1 Structured data dish match >= 0.50",
    `Got: ${result.relevance.score}`);
  assert(result.relevance.type === "dish", "T7.2 Relevance type = dish");
  assert(result.dondeMatch > 0, "T7.3 Score > 0 even without RI",
    `Got: ${result.dondeMatch}`);

  console.log(`  Mystery Bistro: R=${result.relevance.score.toFixed(2)}, DM=${result.dondeMatch}`);
}

// ==========================================
// TEST 8: REVIEW INTELLIGENCE > MENU HIGHLIGHTS
// ==========================================

section("Test 8: Review Intelligence Outranks menu_highlights");
{
  // Create two restaurants:
  // A: Has "birria tacos" in review intelligence
  // B: Has "birria tacos" in menu_highlights only (AI-predicted)
  const withRI = makeCandidate({
    name: "RI Restaurant",
    cuisine_type: "Mexican",
    review_intelligence: makeRI({
      dish_catalog: ["birria tacos", "consomme", "quesabirria"],
      popular_dishes: ["birria tacos"],
      cuisine_signals: ["Mexican"],
      review_food_quality: 7.5,
    }),
    ri_text_rank: 0.5,
    deep_profile: makeDeepProfile({
      menu_highlights: ["tacos", "burritos"], // Does NOT have "birria tacos"
    }),
  });

  const withMenuHighlightsOnly = makeCandidate({
    name: "MH Restaurant",
    cuisine_type: "Mexican",
    review_intelligence: null,
    ri_text_rank: 0,
    deep_profile: makeDeepProfile({
      menu_highlights: ["birria tacos", "carnitas", "elote"], // Has it in menu_highlights
    }),
  });

  const context = makeContext({
    specialRequest: "birria tacos",
    intent: makeIntent({
      dish_level_intent: "birria tacos",
      target_cuisines: ["Mexican"],
      cuisine_importance: "high",
    }),
  });

  const riResult = computeV9Score(withRI, context);
  const mhResult = computeV9Score(withMenuHighlightsOnly, context);

  // RI restaurant should have higher relevance than menu_highlights-only
  assert(riResult.relevance.score > mhResult.relevance.score,
    "T8.1 RI relevance > menu_highlights relevance",
    `RI: ${riResult.relevance.score.toFixed(2)}, MH: ${mhResult.relevance.score.toFixed(2)}`);

  // RI restaurant should score higher overall
  assert(riResult.dondeMatch > mhResult.dondeMatch,
    "T8.2 RI overall score > MH overall score",
    `RI: ${riResult.dondeMatch}, MH: ${mhResult.dondeMatch}`);

  console.log(`  RI: R=${riResult.relevance.score.toFixed(2)}, DM=${riResult.dondeMatch}`);
  console.log(`  MH: R=${mhResult.relevance.score.toFixed(2)}, DM=${mhResult.dondeMatch}`);
}

// ==========================================
// TEST 9: STEAKHOUSE + BUSINESS OCCASION
// ==========================================

section("Test 9: Steakhouse Business Lunch — Occasion as Tiebreaker");
{
  const context = makeContext({
    occasion: "Business Lunch",
    specialRequest: "steakhouse for client meeting",
    intent: makeIntent({
      target_cuisines: ["Steakhouse"],
      cuisine_importance: "high",
      emotional_intent: "impress",
      confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "low", overall: "high" },
    }),
  });

  const candidates = [
    CANDIDATES.steakhouse,
    CANDIDATES.fineItalian,
    CANDIDATES.tacoShack,
    CANDIDATES.cocktailBar,
  ];
  const ranked = reRankV9(candidates, context);

  // RPM Steak should be #1
  assert(ranked[0].profile.name === "RPM Steak", "T9.1 RPM Steak is #1",
    `Got: ${ranked[0].profile.name} (DM=${ranked[0].dondeMatch})`);

  // Should have high cuisine relevance
  assert(ranked[0].relevance.score >= 0.90, "T9.2 Steakhouse relevance >= 0.90",
    `Got: ${ranked[0].relevance.score}`);

  // Occasion bonus: RPM Steak noise=Moderate, Business Lunch expects Quiet → -2 is correct
  assert(ranked[0].occasionBonus >= -5, "T9.3 Occasion bonus in valid range",
    `Got: ${ranked[0].occasionBonus}`);

  // Taco shack very low (wrong cuisine + wrong occasion)
  const taco = ranked.find(r => r.profile.name === "Taqueria Los Comales")!;
  assert(taco.dondeMatch < 10, "T9.4 Taco shack very low for steakhouse+business",
    `Got: ${taco.dondeMatch}`);

  console.log(`  Ranked: ${ranked.map(r => `${r.profile.name} (R=${r.relevance.score.toFixed(2)}, DM=${r.dondeMatch})`).join(", ")}`);
}

// ==========================================
// TEST 10: SCORE SANITY CHECKS
// ==========================================

section("Test 10: Score Sanity Checks");
{
  const allCandidates = Object.values(CANDIDATES);

  // All scores should be in valid range
  for (const candidate of allCandidates) {
    const context = makeContext({ intent: null });
    const result = computeV9Score(candidate, context);
    assert(result.dondeMatch >= 0 && result.dondeMatch <= 99,
      `T10.1 ${candidate.name} score in [0,99]`,
      `Got: ${result.dondeMatch}`);
    assert(result.relevance.score >= 0 && result.relevance.score <= 1.0,
      `T10.2 ${candidate.name} relevance in [0,1]`,
      `Got: ${result.relevance.score}`);
    assert(result.quality >= 0 && result.quality <= 100,
      `T10.3 ${candidate.name} quality in [0,100]`,
      `Got: ${result.quality}`);
    assert(result.matchNarrative != null,
      `T10.4 ${candidate.name} has match narrative`);
  }

  // Relevance × Quality structure check
  // Use fresh candidates with ri_text_rank=0 to simulate impossible query
  // (In production, PostgreSQL ts_rank would return 0 for non-matching queries)
  for (const candidate of allCandidates) {
    const freshCandidate = { ...candidate, ri_text_rank: 0 } as V9Candidate;
    const context = makeContext({
      specialRequest: "something random xyz123",
      intent: makeIntent({
        dish_level_intent: "xyz123",
        target_cuisines: ["Klingon"],
        cuisine_importance: "high",
      }),
    });
    const result = computeV9Score(freshCandidate, context);
    // With impossible dish/cuisine and zero text rank, relevance should gate low
    assert(result.relevance.score <= 0.15,
      `T10.5 ${candidate.name} low relevance for impossible query`,
      `Got: ${result.relevance.score}`);
    assert(result.dondeMatch <= 20,
      `T10.6 ${candidate.name} low score for impossible query`,
      `Got: ${result.dondeMatch}`);
  }
}

// ==========================================
// SUMMARY
// ==========================================

console.log(`\n${"=".repeat(70)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${warned} warnings`);
console.log("=".repeat(70));

if (failures.length > 0) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(f));
}
if (warnings.length > 0) {
  console.log("\nWarnings:");
  warnings.forEach(w => console.log(w));
}

if (failed > 0) {
  Deno.exit(1);
}
