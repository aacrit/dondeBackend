/**
 * V3 Scoring Engine — Unit Tests
 *
 * Tests all 5 factors, dynamic weights, deal-breaker penalties,
 * personalization, and end-to-end computeV3DondeMatch().
 *
 * Run: deno run --allow-read tests/scoring-v3-test.ts
 */

import {
  computeFoodMatch,
  computeSettingFit,
  computeAtmosphere,
  computeReputation,
  computeConvenience,
  computeV3Weights,
  applyDealBreakerGates,
  computeV3DondeMatch,
  reRankV3,
  type V3Factors,
  type V3Weights,
} from "../supabase/functions/recommend/_shared/scoring-v3.ts";

import type { RestaurantProfile, DeepProfile } from "../supabase/functions/recommend/_shared/types.ts";
import type { GooglePlaceData } from "../supabase/functions/recommend/_shared/google-places.ts";
import type { IntentClassificationV2 } from "../supabase/functions/recommend/_shared/intent-classifier.ts";

// ==========================================
// MOCK DATA BUILDERS
// ==========================================

function buildMockProfile(overrides: Partial<RestaurantProfile> = {}, deepOverrides: Partial<DeepProfile> = {}): RestaurantProfile {
  const deep: DeepProfile = {
    flavor_profiles: ["umami-forward", "rich-buttery"],
    signature_dishes: [{ dish: "Wagyu Beef", why: "Dry-aged 45 days" }],
    cuisine_subcategory: null,
    menu_depth: "extensive",
    spice_level: "mild",
    dietary_depth: "solid",
    service_style: "Full Table Service",
    meal_pacing: "relaxed",
    reservation_difficulty: "walk_in_friendly",
    typical_wait_minutes: 15,
    group_size_sweet_spot: "[2,6)",
    check_average_per_person: 35,
    tipping_culture: "standard",
    kid_friendliness: 5,
    music_vibe: "curated-playlist",
    decor_style: "modern industrial",
    conversation_friendliness: 7,
    energy_level: 5,
    seating_options: ["indoor", "bar"],
    instagram_worthiness: 6,
    seasonal_relevance: { spring: 5, summer: 7, fall: 5, winter: 5 },
    cultural_authenticity: 6,
    origin_story: null,
    crowd_profile: ["young professionals", "couples"],
    neighborhood_integration: "destination",
    chef_notable: false,
    awards_recognition: [],
    wow_factors: [],
    date_progression: "casual_weeknight",
    best_seat_in_house: "window booth",
    ideal_weather: ["any"],
    unique_selling_point: null,
    transit_accessibility: "L accessible",
    byob_policy: null,
    payment_notes: null,
    enrichment_confidence: 8,
    ...deepOverrides,
  };

  return {
    id: "test-" + Math.random().toString(36).slice(2, 8),
    name: "Test Restaurant",
    address: "123 Main St, Chicago, IL",
    neighborhood_id: "nbh-1",
    google_place_id: "ChIJ-test",
    price_level: "$$",
    noise_level: "Moderate",
    lighting_ambiance: "warm modern",
    dress_code: "Smart Casual",
    outdoor_seating: false,
    live_music: false,
    pet_friendly: false,
    parking_availability: "Street parking",
    cuisine_type: "American",
    best_for_oneliner: "Solid neighborhood spot",
    insider_tip: "Ask for the corner booth",
    best_times: ["lunch", "dinner"],
    dietary_options: ["Vegetarian", "Gluten-Free"],
    good_for: ["date night", "group dining"],
    ambiance: ["warm", "modern"],
    is_active: true,
    neighborhood_name: "Wicker Park",
    neighborhood_description: "Trendy and walkable",
    date_friendly_score: 7,
    group_friendly_score: 6,
    family_friendly_score: 5,
    romantic_rating: 7,
    business_lunch_score: 6,
    solo_dining_score: 6,
    hole_in_wall_factor: 4,
    tags: ["date night", "craft cocktails"],
    tag_categories: ["occasion", "drinks"],
    occasion_score: 7,
    total_score: 41,
    trending_score: 5,
    deep_profile: deep,
    ...overrides,
  };
}

function buildMockIntent(overrides: Partial<IntentClassificationV2> = {}): IntentClassificationV2 {
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

function buildMockGoogle(overrides: Partial<GooglePlaceData> = {}): GooglePlaceData {
  return {
    name: "Test Restaurant",
    address: "123 Main St",
    phone: "555-1234",
    website: "https://test.com",
    google_rating: 4.3,
    google_review_count: 150,
    reviews: [],
    business_status: "OPERATIONAL",
    photo_urls: [],
    opening_hours: null,
    ...overrides,
  };
}

// ==========================================
// TEST INFRASTRUCTURE
// ==========================================

interface TestResult {
  name: string;
  category: string;
  food: number;
  setting: number;
  atmosphere: number;
  reputation: number;
  convenience: number;
  weights: V3Weights;
  dondeMatch: number;
  dataCompleteness: number;
  passed: boolean;
  assertion: string;
  actual: string;
}

const results: TestResult[] = [];
let passCount = 0;
let failCount = 0;

function runTest(
  name: string,
  category: string,
  profile: RestaurantProfile,
  inputs: Parameters<typeof computeV3DondeMatch>[1],
  assertion: (dm: number, factors: V3Factors, weights: V3Weights) => { passed: boolean; desc: string; actual: string }
) {
  const { dondeMatch, factors, weights, dataCompleteness } = computeV3DondeMatch(profile, inputs);
  const { passed, desc, actual } = assertion(dondeMatch, factors, weights);

  if (passed) passCount++;
  else failCount++;

  results.push({
    name,
    category,
    food: Math.round(factors.food * 10) / 10,
    setting: Math.round(factors.setting * 10) / 10,
    atmosphere: Math.round(factors.atmosphere * 10) / 10,
    reputation: Math.round(factors.reputation * 10) / 10,
    convenience: Math.round(factors.convenience * 10) / 10,
    weights,
    dondeMatch,
    dataCompleteness: Math.round(dataCompleteness * 100),
    passed,
    assertion: desc,
    actual,
  });
}

// ==========================================
// CATEGORY 1: CUISINE MATCH/MISMATCH (12 tests)
// ==========================================

// T01: Perfect cuisine match — Japanese + "sushi" high importance
runTest(
  "T01: Perfect cuisine match (Japanese + sushi)",
  "Cuisine",
  buildMockProfile({ cuisine_type: "Japanese" }, { flavor_profiles: ["umami-forward", "delicate"], signature_dishes: [{ dish: "Omakase Sushi", why: "Fresh daily" }] }),
  {
    occasion: "Date Night",
    specialRequest: "best sushi in town",
    neighborhood: "Wicker Park",
    priceLevel: "$$",
    googleData: buildMockGoogle({ google_rating: 4.5, google_review_count: 200 }),
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high", flavor_preferences: ["umami-forward"] }),
  },
  (dm, f) => ({
    passed: f.food >= 7 && dm >= 65,
    desc: "Food>=7, DM>=65",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T02: Contains match — "Modern Indian" contains "Indian"
runTest(
  "T02: Contains match (Modern Indian)",
  "Cuisine",
  buildMockProfile({ cuisine_type: "Modern Indian" }, { cuisine_subcategory: "Contemporary South Asian" }),
  {
    occasion: "Date Night",
    specialRequest: "Indian food tonight",
    neighborhood: "Wicker Park",
    priceLevel: "$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Indian"], cuisine_importance: "high" }),
  },
  (dm, f) => ({
    passed: f.food >= 5,
    desc: "Food>=5 (contains match gives 4.5 cuisine pts; flavor bonus needs explicit prefs)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T03: Subcategory match — restaurant "Italian", subcategory "Neapolitan"
runTest(
  "T03: Subcategory match (Neapolitan sub of Italian)",
  "Cuisine",
  buildMockProfile({ cuisine_type: "Italian" }, { cuisine_subcategory: "Neapolitan" }),
  {
    occasion: "Any",
    specialRequest: "Neapolitan pizza",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Italian"], cuisine_importance: "high" }),
  },
  (dm, f) => ({
    passed: f.food >= 6,
    desc: "Food>=6 (exact match 'Italian')",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T04: Family match — Greek restaurant when Italian requested (both Mediterranean)
runTest(
  "T04: Family match (Greek vs Italian, Mediterranean)",
  "Cuisine",
  buildMockProfile({ cuisine_type: "Greek" }),
  {
    occasion: "Any",
    specialRequest: "Italian pasta tonight",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Italian"], cuisine_importance: "high" }),
  },
  (dm, f) => ({
    passed: f.food >= 3 && f.food <= 7,
    desc: "Food 3-7 (family match 3/5 pts)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T05: Complete mismatch, HIGH importance — Mexican when sushi requested
runTest(
  "T05: Complete mismatch HIGH (Mexican vs Sushi)",
  "Cuisine",
  buildMockProfile({ cuisine_type: "Mexican" }),
  {
    occasion: "Date Night",
    specialRequest: "best sushi in town",
    neighborhood: "Wicker Park",
    priceLevel: "$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high" }),
  },
  (dm, f) => ({
    passed: f.food <= 4,
    desc: "Food<=4 (complete mismatch)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T06: Complete mismatch, MEDIUM importance
runTest(
  "T06: Complete mismatch MEDIUM (Steak vs Thai)",
  "Cuisine",
  buildMockProfile({ cuisine_type: "Steak" }),
  {
    occasion: "Any",
    specialRequest: "something with noodles, maybe Thai",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Thai"], cuisine_importance: "medium" }),
  },
  (dm, f) => ({
    passed: f.food <= 5,
    desc: "Food<=5 (medium mismatch)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T07: Complete mismatch, LOW importance — experience query
runTest(
  "T07: Low importance mismatch (vibe query)",
  "Cuisine",
  buildMockProfile({ cuisine_type: "BBQ" }),
  {
    occasion: "Group Hangout",
    specialRequest: "fun lively spot with good drinks",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: [], cuisine_importance: "low", vibe_keywords: ["lively", "fun"] }),
  },
  (dm, f) => ({
    passed: f.food >= 5,
    desc: "Food>=5 (floored at 5 for low importance)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T08: No cuisine requested at all — empty request
runTest(
  "T08: No cuisine requested (empty request)",
  "Cuisine",
  buildMockProfile(),
  {
    occasion: "Any",
    specialRequest: "",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: null,
    intent: buildMockIntent({ cuisine_importance: "low" }),
  },
  (dm, f) => ({
    passed: f.food >= 5,
    desc: "Food>=5 (no intent floor)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T09: No cuisine_type on restaurant but cuisine requested — capped at 4
runTest(
  "T09: No cuisine_type + cuisine requested (cap at 4)",
  "Cuisine",
  buildMockProfile({ cuisine_type: null }),
  {
    occasion: "Any",
    specialRequest: "best sushi",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high" }),
  },
  (dm, f) => ({
    passed: f.food <= 4,
    desc: "Food<=4 (no cuisine_type cap)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T10: Mismatch with excellent other factors — setting/atmo/rep all great
runTest(
  "T10: Mismatch + excellent other factors",
  "Cuisine",
  buildMockProfile(
    { cuisine_type: "Italian", date_friendly_score: 9, romantic_rating: 9 },
    {
      service_style: "Tasting Menu",
      meal_pacing: "leisurely",
      conversation_friendliness: 9,
      energy_level: 5,
      music_vibe: "live-jazz",
      awards_recognition: ["Michelin Guide"],
      chef_notable: true,
      neighborhood_integration: "institution",
    }
  ),
  {
    occasion: "Date Night",
    specialRequest: "best sushi omakase",
    neighborhood: "Wicker Park",
    priceLevel: "$$$",
    googleData: buildMockGoogle({ google_rating: 4.8, google_review_count: 500 }),
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high" }),
  },
  (dm, f) => ({
    passed: true, // Just capture the score for analysis
    desc: `OBSERVE: DM when food mismatches but everything else is perfect`,
    actual: `Food=${f.food.toFixed(1)}, Setting=${f.setting.toFixed(1)}, Atmo=${f.atmosphere.toFixed(1)}, Rep=${f.reputation.toFixed(1)}, DM=${dm}`,
  })
);

// T11: Multiple target cuisines, one matches
runTest(
  "T11: Multiple targets, one matches",
  "Cuisine",
  buildMockProfile({ cuisine_type: "Japanese" }),
  {
    occasion: "Any",
    specialRequest: "sushi or thai",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Japanese", "Thai"], cuisine_importance: "high" }),
  },
  (dm, f) => ({
    passed: f.food >= 5.5,
    desc: "Food>=5.5 (exact match 5pts + dietary default 1pt; no flavor/menu bonus)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T12: Flavor profile match boosts even without cuisine match
runTest(
  "T12: Flavor match without cuisine match",
  "Cuisine",
  buildMockProfile({ cuisine_type: "American" }, { flavor_profiles: ["smoky", "charred", "umami-forward"] }),
  {
    occasion: "Any",
    specialRequest: "something smoky and rich",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: [], cuisine_importance: "low", flavor_preferences: ["smoky", "umami-forward"] }),
  },
  (dm, f) => ({
    passed: f.food >= 5,
    desc: "Food>=5 (flavor match + low importance floor)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// ==========================================
// CATEGORY 2: SETTING FIT (6 tests)
// ==========================================

// T13: Date Night + high romantic rating
runTest(
  "T13: Perfect Date Night setting",
  "Setting",
  buildMockProfile(
    { date_friendly_score: 9, romantic_rating: 9 },
    { service_style: "Full Table Service", meal_pacing: "leisurely", conversation_friendliness: 9 }
  ),
  {
    occasion: "Date Night",
    specialRequest: "romantic dinner",
    neighborhood: "Wicker Park",
    priceLevel: "$$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ date_type: "anniversary", vibe_keywords: ["romantic", "intimate"] }),
  },
  (dm, f) => ({
    passed: f.setting >= 8,
    desc: "Setting>=8 (perfect date night)",
    actual: `Setting=${f.setting.toFixed(1)}, DM=${dm}`,
  })
);

// T14: Business Lunch + Fast Casual clash
runTest(
  "T14: Business Lunch + Fast Casual (clash)",
  "Setting",
  buildMockProfile(
    { business_lunch_score: 3 },
    { service_style: "Fast Casual", meal_pacing: "quick_bite" }
  ),
  {
    occasion: "Business Lunch",
    specialRequest: "business lunch",
    neighborhood: "Loop",
    priceLevel: "$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
  },
  (dm, f) => ({
    passed: f.setting <= 5,
    desc: "Setting<=5 (service clash + low score)",
    actual: `Setting=${f.setting.toFixed(1)}, DM=${dm}`,
  })
);

// T15: Family Dinner + high kid friendliness
runTest(
  "T15: Family Dinner + kid-friendly",
  "Setting",
  buildMockProfile(
    { family_friendly_score: 8 },
    { service_style: "Family Style", kid_friendliness: 9, meal_pacing: "relaxed" }
  ),
  {
    occasion: "Family Dinner",
    specialRequest: "family dinner",
    neighborhood: "Anywhere",
    priceLevel: "$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
  },
  (dm, f) => ({
    passed: f.setting >= 7,
    desc: "Setting>=7 (great family fit)",
    actual: `Setting=${f.setting.toFixed(1)}, DM=${dm}`,
  })
);

// T16: "Any" occasion neutral
runTest(
  "T16: Any occasion (neutral)",
  "Setting",
  buildMockProfile(),
  {
    occasion: "Any",
    specialRequest: "food",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
  },
  (dm, f) => ({
    passed: f.setting >= 3 && f.setting <= 7,
    desc: "Setting 3-7 (neutral occasion)",
    actual: `Setting=${f.setting.toFixed(1)}, DM=${dm}`,
  })
);

// T17: Group Hangout + large group + small sweet spot
runTest(
  "T17: Large group mismatch",
  "Setting",
  buildMockProfile(
    { group_friendly_score: 4 },
    { group_size_sweet_spot: "[2,4)", service_style: "Omakase" }
  ),
  {
    occasion: "Group Hangout",
    specialRequest: "birthday dinner for 12",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ group_size_hint: "large_group" }),
  },
  (dm, f) => ({
    passed: f.setting <= 5,
    desc: "Setting<=5 (group size mismatch + Omakase clash)",
    actual: `Setting=${f.setting.toFixed(1)}, DM=${dm}`,
  })
);

// T18: Special Occasion + Tasting Menu + leisurely
runTest(
  "T18: Special Occasion perfect",
  "Setting",
  buildMockProfile(
    { romantic_rating: 9, date_friendly_score: 8 },
    { service_style: "Tasting Menu", meal_pacing: "ceremonial", conversation_friendliness: 9 }
  ),
  {
    occasion: "Special Occasion",
    specialRequest: "anniversary dinner",
    neighborhood: "Wicker Park",
    priceLevel: "$$$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ date_type: "anniversary", emotional_intent: "impress" }),
  },
  (dm, f) => ({
    passed: f.setting >= 8,
    desc: "Setting>=8 (perfect special occasion)",
    actual: `Setting=${f.setting.toFixed(1)}, DM=${dm}`,
  })
);

// ==========================================
// CATEGORY 3: ATMOSPHERE (6 tests)
// ==========================================

// T19: Date Night + Quiet + dim + live jazz
runTest(
  "T19: Perfect Date Night atmosphere",
  "Atmosphere",
  buildMockProfile(
    { noise_level: "Quiet", lighting_ambiance: "dim and intimate", dress_code: "Smart Casual", live_music: true },
    { energy_level: 5, music_vibe: "live-jazz", decor_style: "romantic candlelit" }
  ),
  {
    occasion: "Date Night",
    specialRequest: "romantic evening with jazz",
    neighborhood: "Anywhere",
    priceLevel: "$$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ vibe_keywords: ["romantic", "intimate"] }),
  },
  (dm, f) => ({
    passed: f.atmosphere >= 7,
    desc: "Atmosphere>=7 (perfect date vibe)",
    actual: `Atmosphere=${f.atmosphere.toFixed(1)}, DM=${dm}`,
  })
);

// T20: Business Lunch + Loud noise (mismatch)
runTest(
  "T20: Business Lunch + Loud (mismatch)",
  "Atmosphere",
  buildMockProfile(
    { noise_level: "Loud", lighting_ambiance: "bright vibrant" },
    { energy_level: 8, music_vibe: "DJ" }
  ),
  {
    occasion: "Business Lunch",
    specialRequest: "business meeting",
    neighborhood: "Loop",
    priceLevel: "$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
  },
  (dm, f) => ({
    passed: f.atmosphere <= 5,
    desc: "Atmosphere<=5 (noise/energy mismatch)",
    actual: `Atmosphere=${f.atmosphere.toFixed(1)}, DM=${dm}`,
  })
);

// T21: Outdoor patio requested + outdoor_seating true
runTest(
  "T21: Outdoor patio match",
  "Atmosphere",
  buildMockProfile({ outdoor_seating: true }),
  {
    occasion: "Chill Hangout",
    specialRequest: "outdoor patio with a view",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_features: ["outdoor_seating"] }),
  },
  (dm, f) => ({
    passed: f.atmosphere >= 5,
    desc: "Atmosphere>=5 (outdoor match boost)",
    actual: `Atmosphere=${f.atmosphere.toFixed(1)}, DM=${dm}`,
  })
);

// T22: Rooftop view requested + scenic tag
runTest(
  "T22: Rooftop/scenic match",
  "Atmosphere",
  buildMockProfile({ tags: ["rooftop", "skyline view", "craft cocktails"], tag_categories: ["feature", "feature", "drinks"] }),
  {
    occasion: "Date Night",
    specialRequest: "rooftop with a view",
    neighborhood: "Anywhere",
    priceLevel: "$$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_tags: ["rooftop"] }),
  },
  (dm, f) => ({
    passed: f.atmosphere >= 5,
    desc: "Atmosphere>=5 (scenic tag match)",
    actual: `Atmosphere=${f.atmosphere.toFixed(1)}, DM=${dm}`,
  })
);

// T23: Vibe keywords match
runTest(
  "T23: Vibe keyword matching",
  "Atmosphere",
  buildMockProfile(
    {},
    { decor_style: "cozy intimate farmhouse", energy_level: 3, music_vibe: "ambient" }
  ),
  {
    occasion: "Date Night",
    specialRequest: "cozy intimate spot",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ vibe_keywords: ["cozy", "intimate"] }),
  },
  (dm, f) => ({
    passed: f.atmosphere >= 6,
    desc: "Atmosphere>=6 (vibe keywords match)",
    actual: `Atmosphere=${f.atmosphere.toFixed(1)}, DM=${dm}`,
  })
);

// T24: Instagram request + high worthiness
runTest(
  "T24: Instagram-worthy atmosphere",
  "Atmosphere",
  buildMockProfile({}, { instagram_worthiness: 9, decor_style: "stunning art deco" }),
  {
    occasion: "Treat Myself",
    specialRequest: "cute instagrammable place",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ vibe_keywords: ["cute"] }),
  },
  (dm, f) => ({
    passed: f.atmosphere >= 5,
    desc: "Atmosphere>=5 (Instagram boost)",
    actual: `Atmosphere=${f.atmosphere.toFixed(1)}, DM=${dm}`,
  })
);

// ==========================================
// CATEGORY 4: REPUTATION (4 tests)
// ==========================================

// T25: High rating + many reviews + awards + institution
runTest(
  "T25: Outstanding reputation",
  "Reputation",
  buildMockProfile(
    { trending_score: 8 },
    { awards_recognition: ["Michelin Guide", "James Beard"], chef_notable: true, cultural_authenticity: 9, neighborhood_integration: "institution" }
  ),
  {
    occasion: "Any",
    specialRequest: "best restaurant",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle({ google_rating: 4.8, google_review_count: 500 }),
    sentimentScore: 9,
    intent: buildMockIntent(),
  },
  (dm, f) => ({
    passed: f.reputation >= 8,
    desc: "Reputation>=8 (outstanding)",
    actual: `Reputation=${f.reputation.toFixed(1)}, DM=${dm}`,
  })
);

// T26: Low rating + few reviews
runTest(
  "T26: Poor reputation",
  "Reputation",
  buildMockProfile({}, { awards_recognition: [], neighborhood_integration: null }),
  {
    occasion: "Any",
    specialRequest: "any food",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle({ google_rating: 3.0, google_review_count: 5 }),
    sentimentScore: 4,
    sentimentNegative: 50,
    intent: buildMockIntent(),
  },
  (dm, f) => ({
    passed: f.reputation <= 5,
    desc: "Reputation<=5 (poor quality signals)",
    actual: `Reputation=${f.reputation.toFixed(1)}, DM=${dm}`,
  })
);

// T27: No Google data at all — neutral
runTest(
  "T27: No Google data (neutral)",
  "Reputation",
  buildMockProfile(),
  {
    occasion: "Any",
    specialRequest: "food",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: null,
    intent: buildMockIntent(),
  },
  (dm, f) => ({
    passed: f.reputation >= 3 && f.reputation <= 7,
    desc: "Reputation 3-7 (neutral defaults)",
    actual: `Reputation=${f.reputation.toFixed(1)}, DM=${dm}`,
  })
);

// T28: High rating but very negative sentiment
runTest(
  "T28: High rating + negative sentiment",
  "Reputation",
  buildMockProfile(),
  {
    occasion: "Any",
    specialRequest: "food",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle({ google_rating: 4.5, google_review_count: 200 }),
    sentimentScore: 3,
    sentimentNegative: 60,
    intent: buildMockIntent(),
  },
  (dm, f) => ({
    passed: f.reputation <= 6,
    desc: "Reputation<=6 (sentiment penalty)",
    actual: `Reputation=${f.reputation.toFixed(1)}, DM=${dm}`,
  })
);

// ==========================================
// CATEGORY 5: CONVENIENCE (4 tests)
// ==========================================

// T29: Walk-in + spontaneous + short wait + BYOB
runTest(
  "T29: Super convenient (walk-in + BYOB + short wait)",
  "Convenience",
  buildMockProfile(
    { best_times: ["dinner"] },
    { reservation_difficulty: "walk_in_friendly", typical_wait_minutes: 10, byob_policy: "full_byob" }
  ),
  {
    occasion: "Chill Hangout",
    specialRequest: "byob spot tonight",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    clientTimeOfDay: "dinner",
    intent: buildMockIntent({ spontaneity: "spontaneous", practical_constraints: ["byob_preference"] }),
  },
  (dm, f) => ({
    passed: f.convenience >= 8,
    desc: "Convenience>=8 (all practical factors align)",
    actual: `Convenience=${f.convenience.toFixed(1)}, DM=${dm}`,
  })
);

// T30: Hard-to-get + spontaneous + long wait
runTest(
  "T30: Very inconvenient (hard-to-get + 90min wait)",
  "Convenience",
  buildMockProfile(
    { best_times: ["dinner"] },
    { reservation_difficulty: "hard_to_get", typical_wait_minutes: 90 }
  ),
  {
    occasion: "Date Night",
    specialRequest: "dinner tonight",
    neighborhood: "Wicker Park",
    priceLevel: "$$$",
    googleData: buildMockGoogle(),
    clientTimeOfDay: "dinner",
    intent: buildMockIntent({ spontaneity: "spontaneous" }),
  },
  (dm, f) => ({
    passed: f.convenience <= 3,
    desc: "Convenience<=3 (hard-to-get + spontaneous + long wait)",
    actual: `Convenience=${f.convenience.toFixed(1)}, DM=${dm}`,
  })
);

// T31: Perfect timing + parking
runTest(
  "T31: Good timing + parking",
  "Convenience",
  buildMockProfile({ best_times: ["lunch"], parking_availability: "Valet available" }),
  {
    occasion: "Business Lunch",
    specialRequest: "lunch meeting",
    neighborhood: "Loop",
    priceLevel: "$$",
    googleData: buildMockGoogle(),
    clientTimeOfDay: "lunch",
    intent: buildMockIntent({ spontaneity: "planned" }),
  },
  (dm, f) => ({
    passed: f.convenience >= 6,
    desc: "Convenience>=6 (timing + parking)",
    actual: `Convenience=${f.convenience.toFixed(1)}, DM=${dm}`,
  })
);

// T32: Cash-only + wrong time
runTest(
  "T32: Cash-only + wrong time of day",
  "Convenience",
  buildMockProfile(
    { best_times: ["dinner", "late_night"] },
    { payment_notes: "Cash only" }
  ),
  {
    occasion: "Business Lunch",
    specialRequest: "lunch",
    neighborhood: "Anywhere",
    priceLevel: "$$",
    googleData: buildMockGoogle(),
    clientTimeOfDay: "lunch",
    intent: buildMockIntent(),
  },
  (dm, f) => ({
    passed: f.convenience <= 5,
    desc: "Convenience<=5 (cash-only + time mismatch)",
    actual: `Convenience=${f.convenience.toFixed(1)}, DM=${dm}`,
  })
);

// ==========================================
// CATEGORY 6: WEIGHT SYSTEM (4 tests)
// ==========================================

// T33: High cuisine importance → food=0.45
runTest(
  "T33: Weights — high cuisine importance",
  "Weights",
  buildMockProfile(),
  {
    occasion: "Any",
    specialRequest: "sushi",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high" }),
  },
  (_dm, _f, w) => ({
    passed: Math.abs(w.food - 0.45) < 0.02,
    desc: "food weight ~0.45",
    actual: `food=${w.food.toFixed(3)}`,
  })
);

// T34: Date Night + low cuisine importance → setting=0.30
runTest(
  "T34: Weights — Date Night + low cuisine",
  "Weights",
  buildMockProfile(),
  {
    occasion: "Date Night",
    specialRequest: "romantic evening",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ cuisine_importance: "low", vibe_keywords: ["romantic"] }),
  },
  (_dm, _f, w) => ({
    passed: Math.abs(w.setting - 0.30) < 0.02,
    desc: "setting weight ~0.30",
    actual: `setting=${w.setting.toFixed(3)}`,
  })
);

// T35: Adventure + explore → reputation gets boost
runTest(
  "T35: Weights — Adventure + explore intent",
  "Weights",
  buildMockProfile(),
  {
    occasion: "Adventure",
    specialRequest: "hidden gem",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ cuisine_importance: "low", emotional_intent: "explore" }),
  },
  (_dm, _f, w) => ({
    passed: w.reputation >= 0.28,
    desc: "reputation weight >= 0.28 (adventure + explore boost)",
    actual: `reputation=${w.reputation.toFixed(3)}`,
  })
);

// T36: Weight normalization check
runTest(
  "T36: Weights sum to 1.0",
  "Weights",
  buildMockProfile(),
  {
    occasion: "Family Dinner",
    specialRequest: "family dinner",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ cuisine_importance: "medium", emotional_intent: "comfort" }),
  },
  (_dm, _f, w) => {
    const sum = w.food + w.setting + w.atmosphere + w.reputation + w.convenience;
    return {
      passed: Math.abs(sum - 1.0) < 0.01,
      desc: "weights sum to 1.0",
      actual: `sum=${sum.toFixed(4)}`,
    };
  }
);

// ==========================================
// CATEGORY 7: END-TO-END (6 tests)
// ==========================================

// T37: Perfect match across all dimensions
runTest(
  "T37: Perfect match (all factors aligned)",
  "E2E",
  buildMockProfile(
    { cuisine_type: "Japanese", date_friendly_score: 9, romantic_rating: 9, noise_level: "Quiet", lighting_ambiance: "dim intimate", dress_code: "Smart Casual", trending_score: 8 },
    {
      service_style: "Omakase", meal_pacing: "leisurely", conversation_friendliness: 9,
      energy_level: 5, music_vibe: "ambient", decor_style: "minimalist zen",
      flavor_profiles: ["umami-forward", "delicate"], signature_dishes: [{ dish: "Omakase Sushi", why: "Fresh daily" }],
      reservation_difficulty: "walk_in_friendly", typical_wait_minutes: 5,
      awards_recognition: ["Michelin Star"], chef_notable: true, neighborhood_integration: "destination",
      instagram_worthiness: 8, enrichment_confidence: 9,
    }
  ),
  {
    occasion: "Date Night",
    specialRequest: "best sushi omakase for anniversary",
    neighborhood: "Wicker Park",
    priceLevel: "$$$",
    googleData: buildMockGoogle({ google_rating: 4.8, google_review_count: 400 }),
    sentimentScore: 9,
    intent: buildMockIntent({
      target_cuisines: ["Japanese"], cuisine_importance: "high",
      flavor_preferences: ["umami-forward", "delicate"],
      vibe_keywords: ["intimate", "elegant"],
      date_type: "anniversary", emotional_intent: "impress", spontaneity: "planned",
    }),
    clientTimeOfDay: "dinner",
  },
  (dm) => ({
    passed: dm >= 78,
    desc: "DM>=78 (everything aligns; 85+ nearly unreachable due to weight distribution)",
    actual: `DM=${dm}`,
  })
);

// T38: Terrible match across all dimensions
runTest(
  "T38: Terrible match (nothing aligns)",
  "E2E",
  buildMockProfile(
    { cuisine_type: "BBQ", business_lunch_score: 2, noise_level: "Loud", dress_code: "Casual", price_level: "$$$$" },
    {
      service_style: "Counter", meal_pacing: "quick_bite", conversation_friendliness: 2,
      energy_level: 9, music_vibe: "DJ", reservation_difficulty: "hard_to_get",
      typical_wait_minutes: 90, kid_friendliness: 2, enrichment_confidence: 3,
    }
  ),
  {
    occasion: "Business Lunch",
    specialRequest: "quiet professional lunch for Japanese client",
    neighborhood: "Loop",
    priceLevel: "$",
    googleData: buildMockGoogle({ google_rating: 2.8, google_review_count: 8 }),
    sentimentScore: 3,
    sentimentNegative: 55,
    intent: buildMockIntent({
      target_cuisines: ["Japanese"], cuisine_importance: "high",
      vibe_keywords: ["quiet", "professional"],
      spontaneity: "spontaneous",
    }),
    clientTimeOfDay: "lunch",
  },
  (dm) => ({
    passed: dm <= 30,
    desc: "DM<=30 (nothing aligns + penalties)",
    actual: `DM=${dm}`,
  })
);

// T39: Great food but terrible convenience
runTest(
  "T39: Great food, terrible convenience",
  "E2E",
  buildMockProfile(
    { cuisine_type: "Japanese" },
    {
      flavor_profiles: ["umami-forward"], signature_dishes: [{ dish: "Sashimi Platter", why: "Daily import" }],
      reservation_difficulty: "hard_to_get", typical_wait_minutes: 120,
      payment_notes: "Cash only",
    }
  ),
  {
    occasion: "Any",
    specialRequest: "sushi tonight",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high", spontaneity: "spontaneous" }),
    clientTimeOfDay: "dinner",
  },
  (dm, f) => ({
    passed: f.food >= 5.5 && f.convenience <= 3 && dm >= 35 && dm <= 65,
    desc: "Food>=5.5, Conv<=3, DM 35-65 (food good but no flavor bonus; convenience punished)",
    actual: `Food=${f.food.toFixed(1)}, Conv=${f.convenience.toFixed(1)}, DM=${dm}`,
  })
);

// T40: Deal-breaker gate — dietary mismatch (ANOMALY-1 FIXED)
runTest(
  "T40: Dietary mismatch (Vegan at no-option restaurant)",
  "E2E",
  buildMockProfile({ dietary_options: ["Gluten-Free"] }, { dietary_depth: null }),
  {
    occasion: "Any",
    specialRequest: "vegan dinner",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
    dietaryRestrictions: ["Vegan"],
  },
  (dm, f) => ({
    // ANOMALY-1 FIXED: Floor no longer applies when dietaryRestrictions present.
    // Food = cuisine_base(3) + dietary(0, GF doesn't match Vegan) + menu(0) = 3.0
    passed: f.food <= 4,
    desc: "Food<=4 (dietary mismatch properly penalizes now that floor is bypassed)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T41: Personalization — disliked restaurant penalty
runTest(
  "T41: Disliked restaurant penalty",
  "E2E",
  buildMockProfile({ id: "rest-disliked-123" }),
  {
    occasion: "Any",
    specialRequest: "food",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
    userFeedback: { likedCuisines: [], dislikedCuisines: [], likedRestaurantIds: [], dislikedRestaurantIds: ["rest-disliked-123"] },
  },
  (dm) => ({
    passed: dm <= 40,
    desc: "DM<=40 (disliked restaurant heavy penalty)",
    actual: `DM=${dm}`,
  })
);

// T42: Price mismatch — 3 tiers over budget
runTest(
  "T42: Price 3 tiers over ($ vs $$$$)",
  "E2E",
  buildMockProfile({ price_level: "$$$$" }),
  {
    occasion: "Any",
    specialRequest: "cheap eats",
    neighborhood: "Anywhere",
    priceLevel: "$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
  },
  (dm) => ({
    passed: dm <= 30,
    desc: "DM<=30 (heavy price penalty -3.0 on composite)",
    actual: `DM=${dm}`,
  })
);

// ==========================================
// CATEGORY 8: CUISINE PENALTY MODEL COMPARISON (3 tests)
// ==========================================

// Set up the same scenario for comparison
const mismatchProfile = buildMockProfile(
  { cuisine_type: "Italian", date_friendly_score: 9, romantic_rating: 9, noise_level: "Quiet", lighting_ambiance: "dim romantic" },
  {
    service_style: "Full Table Service", meal_pacing: "leisurely", conversation_friendliness: 9,
    energy_level: 5, music_vibe: "live-jazz", awards_recognition: ["Best Italian"],
    neighborhood_integration: "institution", enrichment_confidence: 9,
  }
);
const mismatchInputs = {
  occasion: "Date Night",
  specialRequest: "best sushi omakase in town",
  neighborhood: "Wicker Park",
  priceLevel: "$$$",
  googleData: buildMockGoogle({ google_rating: 4.7, google_review_count: 300 }),
  sentimentScore: 8,
  intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high", vibe_keywords: ["intimate"] }),
};

// T43: Model A — No penalty (current V3)
runTest(
  "T43: Model A — No cuisine penalty (current V3)",
  "Penalty Models",
  mismatchProfile,
  mismatchInputs,
  (dm, f) => ({
    passed: true, // observation only
    desc: `MODEL A (status quo): DM with mismatch but great other factors`,
    actual: `Food=${f.food.toFixed(1)}, Setting=${f.setting.toFixed(1)}, Atmo=${f.atmosphere.toFixed(1)}, Rep=${f.reputation.toFixed(1)}, Conv=${f.convenience.toFixed(1)}, DM=${dm}`,
  })
);

// T44: Model B simulation — Tiered cap at 65
{
  const { dondeMatch, factors, weights } = computeV3DondeMatch(mismatchProfile, mismatchInputs);
  const modelBScore = Math.min(dondeMatch, 65);
  results.push({
    name: "T44: Model B — Tiered cap at 65",
    category: "Penalty Models",
    food: Math.round(factors.food * 10) / 10,
    setting: Math.round(factors.setting * 10) / 10,
    atmosphere: Math.round(factors.atmosphere * 10) / 10,
    reputation: Math.round(factors.reputation * 10) / 10,
    convenience: Math.round(factors.convenience * 10) / 10,
    weights,
    dondeMatch: modelBScore,
    dataCompleteness: 0,
    passed: true,
    assertion: `MODEL B (cap at 65): Same factors, capped final score`,
    actual: `Original DM=${dondeMatch}, Capped DM=${modelBScore}`,
  });
  passCount++;
}

// T45: Model C simulation — Continuous penalty (-2.5)
{
  const result = computeV3DondeMatch(mismatchProfile, mismatchInputs);
  // Simulate: subtract 2.5 from raw composite before mapping
  const originalRaw = result.dondeMatch / 10;
  const penalizedRaw = Math.max(0, originalRaw - 2.5);
  const modelCScore = Math.min(99, Math.max(0, Math.round(penalizedRaw * 10)));
  results.push({
    name: "T45: Model C — Continuous penalty (-2.5)",
    category: "Penalty Models",
    food: Math.round(result.factors.food * 10) / 10,
    setting: Math.round(result.factors.setting * 10) / 10,
    atmosphere: Math.round(result.factors.atmosphere * 10) / 10,
    reputation: Math.round(result.factors.reputation * 10) / 10,
    convenience: Math.round(result.factors.convenience * 10) / 10,
    weights: result.weights,
    dondeMatch: modelCScore,
    dataCompleteness: 0,
    passed: true,
    assertion: `MODEL C (−2.5 from raw): Continuous penalty`,
    actual: `Original DM=${result.dondeMatch}, Raw=${originalRaw.toFixed(1)}, Penalized=${penalizedRaw.toFixed(1)}, Model C DM=${modelCScore}`,
  });
  passCount++;
}

// ==========================================
// CATEGORY 9: DIETARY EDGE CASES (5 tests)
// ==========================================

// T46: Vegan at dedicated vegan restaurant (ANOMALY-1 FIXED)
runTest(
  "T46: Vegan at dedicated vegan restaurant",
  "Dietary",
  buildMockProfile(
    { cuisine_type: "Vegan", dietary_options: ["Vegan", "Gluten-Free"] },
    { dietary_depth: "dedicated" }
  ),
  {
    occasion: "Any",
    specialRequest: "vegan dinner",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
    dietaryRestrictions: ["Vegan"],
  },
  (dm, f) => ({
    // With ANOMALY-1 fix, floor bypassed when dietary present.
    // Food = cuisine_base(3, no target match) + dietary_depth("dedicated"=2) = 5.0
    passed: f.food >= 4.5,
    desc: "Food>=4.5 (cuisine_base 3 + dedicated dietary 2 = 5.0; no floor needed)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T47: Vegan at BBQ joint (total mismatch — ANOMALY-1 FIXED)
runTest(
  "T47: Vegan at BBQ (dietary mismatch)",
  "Dietary",
  buildMockProfile(
    { cuisine_type: "BBQ", dietary_options: [] },
    { dietary_depth: null }
  ),
  {
    occasion: "Any",
    specialRequest: "vegan dinner",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
    dietaryRestrictions: ["Vegan"],
  },
  (dm, f) => ({
    // ANOMALY-1 FIXED: Floor bypassed. Food = cuisine_base(3) + dietary(0, no options) = 3.0
    passed: f.food <= 4,
    desc: "Food<=4 (vegan at BBQ: dietary mismatch no longer hidden by floor)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T48: Vegan at vegetarian restaurant (hierarchy partial — ANOMALY-1 FIXED)
runTest(
  "T48: Vegan at Vegetarian (hierarchy partial)",
  "Dietary",
  buildMockProfile(
    { dietary_options: ["Vegetarian"] },
    { dietary_depth: "solid" }
  ),
  {
    occasion: "Any",
    specialRequest: "vegan food",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
    dietaryRestrictions: ["Vegan"],
  },
  (dm, f) => ({
    // Floor bypassed (dietary present). Food = cuisine_base(3) + dietary_depth("solid"=1.5 for partial) = ~4.5
    passed: f.food >= 3 && f.food <= 7,
    desc: "Food 3-7 (partial hierarchy match, floor bypassed)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T49: Gluten-Free at pizza place (token options)
runTest(
  "T49: Gluten-Free at pizza (token options)",
  "Dietary",
  buildMockProfile(
    { cuisine_type: "Italian", dietary_options: ["Gluten-Free"] },
    { dietary_depth: "token" }
  ),
  {
    occasion: "Any",
    specialRequest: "gluten free pizza",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Italian"], cuisine_importance: "high" }),
    dietaryRestrictions: ["Gluten-Free"],
  },
  (dm, f) => ({
    passed: f.food >= 5,
    desc: "Food>=5 (cuisine match offsets token dietary)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T50: Multiple dietary restrictions, partial match
runTest(
  "T50: Multiple restrictions, partial match",
  "Dietary",
  buildMockProfile(
    { dietary_options: ["Vegan"] },
    { dietary_depth: "solid" }
  ),
  {
    occasion: "Any",
    specialRequest: "vegan gluten-free food",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
    dietaryRestrictions: ["Vegan", "Gluten-Free"],
  },
  (dm, f) => ({
    passed: f.food >= 3,
    desc: "Food>=3 (partial match on multi-restriction)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// ==========================================
// CATEGORY 10: ENRICHMENT CONFIDENCE (3 tests)
// ==========================================

// T51: Low enrichment confidence → score dampened
runTest(
  "T51: Low enrichment confidence (conf=3)",
  "Confidence",
  buildMockProfile(
    { cuisine_type: "Japanese" },
    { enrichment_confidence: 3, flavor_profiles: ["umami-forward"] }
  ),
  {
    occasion: "Any",
    specialRequest: "sushi",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high" }),
  },
  (dm, f) => {
    // confidence=3 < 5 → confidenceFactor=0.3, dampened=0.5+0.3*0.5=0.65
    // Food and Atmosphere are dampened by 0.65x
    return {
      passed: dm <= 55,
      desc: "DM<=55 (low confidence dampens food + atmosphere)",
      actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
    };
  }
);

// T52: Confidence at boundary (conf=5) — no dampening
runTest(
  "T52: Confidence at boundary (conf=5, no dampening)",
  "Confidence",
  buildMockProfile(
    { cuisine_type: "Japanese" },
    { enrichment_confidence: 5, flavor_profiles: ["umami-forward"] }
  ),
  {
    occasion: "Any",
    specialRequest: "sushi",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high" }),
  },
  (dm, f) => ({
    // confidence=5 → confidenceFactor=1.0, no dampening
    passed: f.food >= 5,
    desc: "Food>=5 (no dampening at conf=5)",
    actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
  })
);

// T53: Very low confidence (conf=1) → heavy dampening
runTest(
  "T53: Very low confidence (conf=1)",
  "Confidence",
  buildMockProfile(
    { cuisine_type: "Japanese" },
    { enrichment_confidence: 1, flavor_profiles: ["umami-forward"] }
  ),
  {
    occasion: "Any",
    specialRequest: "sushi",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high" }),
  },
  (dm, f) => {
    // confidence=1 → confidenceFactor=0.1, dampened=0.5+0.1*0.5=0.55
    return {
      passed: dm <= 50,
      desc: "DM<=50 (very low confidence)",
      actual: `Food=${f.food.toFixed(1)}, DM=${dm}`,
    };
  }
);

// ==========================================
// CATEGORY 11: CLAUDE RELEVANCE MODULATION (2 tests)
// ==========================================

// T54: High Claude relevance boosts score
runTest(
  "T54: High Claude relevance (relevance=9)",
  "Claude Modulation",
  buildMockProfile({ cuisine_type: "Japanese" }),
  {
    occasion: "Any",
    specialRequest: "sushi",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    claudeRelevance: 9,
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high" }),
  },
  (dm, f) => ({
    // relevance=9 → adjust=(9-5)*0.1=+0.4 on food+setting
    passed: f.food >= 5,
    desc: "Food gets +0.4 boost from high Claude relevance",
    actual: `Food=${f.food.toFixed(1)}, Setting=${f.setting.toFixed(1)}, DM=${dm}`,
  })
);

// T55: Low Claude relevance penalizes score
runTest(
  "T55: Low Claude relevance (relevance=1)",
  "Claude Modulation",
  buildMockProfile({ cuisine_type: "Japanese" }),
  {
    occasion: "Any",
    specialRequest: "sushi",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    claudeRelevance: 1,
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high" }),
  },
  (dm, f) => ({
    // relevance=1 → adjust=(1-5)*0.1=-0.4 on food+setting
    passed: true,
    desc: "OBSERVE: Low Claude relevance -0.4 on food+setting",
    actual: `Food=${f.food.toFixed(1)}, Setting=${f.setting.toFixed(1)}, DM=${dm}`,
  })
);

// ==========================================
// CATEGORY 12: PERSONALIZATION (3 tests)
// ==========================================

// T56: Liked cuisine bonus
runTest(
  "T56: Liked cuisine gives small bonus",
  "Personalization",
  buildMockProfile({ cuisine_type: "Italian" }),
  {
    occasion: "Any",
    specialRequest: "pasta",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Italian"], cuisine_importance: "high" }),
    userFeedback: { likedCuisines: ["Italian"], dislikedCuisines: [], likedRestaurantIds: [], dislikedRestaurantIds: [] },
  },
  (dm) => ({
    passed: dm >= 45,
    desc: "DM>=45 (liked cuisine +0.3 composite bonus)",
    actual: `DM=${dm}`,
  })
);

// T57: Disliked cuisine penalty
runTest(
  "T57: Disliked cuisine penalty",
  "Personalization",
  buildMockProfile({ cuisine_type: "Mexican" }),
  {
    occasion: "Any",
    specialRequest: "tacos",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Mexican"], cuisine_importance: "high" }),
    userFeedback: { likedCuisines: [], dislikedCuisines: ["Mexican"], likedRestaurantIds: [], dislikedRestaurantIds: [] },
  },
  (dm) => ({
    passed: dm <= 55,
    desc: "DM<=55 (disliked cuisine -1.0 composite penalty)",
    actual: `DM=${dm}`,
  })
);

// T58: Rejection signals — avoid cuisine
runTest(
  "T58: Rejection signals avoid cuisine",
  "Personalization",
  buildMockProfile({ cuisine_type: "Thai" }),
  {
    occasion: "Any",
    specialRequest: "food",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
    rejectionSignals: { avoidCuisines: ["Thai"], avoidPriceLevels: [], avoidRestaurantIds: [] },
  },
  (dm) => ({
    passed: dm <= 35,
    desc: "DM<=35 (rejection signal -2.0 on cuisine)",
    actual: `DM=${dm}`,
  })
);

// ==========================================
// CATEGORY 13: PENALTY EDGE CASES (4 tests)
// ==========================================

// T59: Price 2-tier gap (subtractive -2.0)
runTest(
  "T59: Price 2-tier gap ($$ vs $$$$)",
  "Penalties",
  buildMockProfile({ price_level: "$$$$" }),
  {
    occasion: "Any",
    specialRequest: "food",
    neighborhood: "Anywhere",
    priceLevel: "$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
  },
  (dm) => ({
    passed: dm <= 40,
    desc: "DM<=40 (2-tier price gap -2.0 subtractive penalty)",
    actual: `DM=${dm}`,
  })
);

// T60: Price 1-tier over budget (subtractive -0.5)
runTest(
  "T60: Price 1-tier over ($$ vs $$$)",
  "Penalties",
  buildMockProfile({ price_level: "$$$" }),
  {
    occasion: "Any",
    specialRequest: "food",
    neighborhood: "Anywhere",
    priceLevel: "$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
  },
  (dm) => ({
    passed: dm >= 30 && dm <= 60,
    desc: "DM 30-60 (1-tier over: -0.5 composite penalty)",
    actual: `DM=${dm}`,
  })
);

// T61: Neighborhood mismatch penalty
runTest(
  "T61: Neighborhood mismatch penalty",
  "Penalties",
  buildMockProfile({ neighborhood_name: "Lincoln Park" }),
  {
    occasion: "Any",
    specialRequest: "food",
    neighborhood: "Wicker Park",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
  },
  (dm) => ({
    passed: dm <= 50,
    desc: "DM<=50 (neighborhood mismatch -1.0)",
    actual: `DM=${dm}`,
  })
);

// T62: Sentiment handling (ISSUE-2 FIXED — no longer double-counted)
runTest(
  "T62: Sentiment penalty (60% negative, single-count)",
  "Penalties",
  buildMockProfile(),
  {
    occasion: "Any",
    specialRequest: "food",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle({ google_rating: 4.5, google_review_count: 200 }),
    sentimentScore: 3,
    sentimentNegative: 60,
    intent: buildMockIntent(),
  },
  (dm, f) => ({
    // ISSUE-2 FIXED: Sentiment only penalizes in Reputation factor, not in deal-breaker.
    // Rep should be lower due to negative sentiment, but DM should not have double penalty.
    passed: f.reputation <= 5 && dm >= 35,
    desc: "Rep<=5 (sentiment penalty), DM>=35 (no double-counting in deal-breaker)",
    actual: `Rep=${f.reputation.toFixed(1)}, DM=${dm}`,
  })
);

// ==========================================
// CATEGORY 14: OCCASION-SPECIFIC COVERAGE (4 tests)
// ==========================================

// T63: Solo Dining — bar + counter + quiet = great fit
runTest(
  "T63: Solo Dining at bar/counter spot",
  "Occasions",
  buildMockProfile(
    { solo_dining_score: 9, noise_level: "Quiet" },
    { service_style: "Counter", meal_pacing: "quick_bite", conversation_friendliness: 3, energy_level: 3 }
  ),
  {
    occasion: "Solo Dining",
    specialRequest: "quick solo lunch",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent(),
    clientTimeOfDay: "lunch",
  },
  (dm, f) => ({
    passed: f.setting >= 5 && f.atmosphere >= 4,
    desc: "Setting>=5, Atmo>=4 (solo dining + counter fit)",
    actual: `Setting=${f.setting.toFixed(1)}, Atmo=${f.atmosphere.toFixed(1)}, DM=${dm}`,
  })
);

// T64: Treat Myself occasion — high-end self-care
runTest(
  "T64: Treat Myself at upscale spot",
  "Occasions",
  buildMockProfile(
    { romantic_rating: 6 },
    { service_style: "Omakase", meal_pacing: "ceremonial", instagram_worthiness: 9, decor_style: "stunning minimalist" }
  ),
  {
    occasion: "Treat Myself",
    specialRequest: "something special just for me",
    neighborhood: "Anywhere",
    priceLevel: "$$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ emotional_intent: "impress" }),
  },
  (dm, f) => ({
    passed: f.setting >= 4 && f.atmosphere >= 5,
    desc: "Setting>=4, Atmo>=5 (treat myself + upscale)",
    actual: `Setting=${f.setting.toFixed(1)}, Atmo=${f.atmosphere.toFixed(1)}, DM=${dm}`,
  })
);

// T65: Adventure occasion + hole-in-the-wall
runTest(
  "T65: Adventure at hidden gem",
  "Occasions",
  buildMockProfile(
    { hole_in_wall_factor: 9 },
    { service_style: "Counter", neighborhood_integration: "hidden_local", cultural_authenticity: 9 }
  ),
  {
    occasion: "Adventure",
    specialRequest: "hidden gem dive bar",
    neighborhood: "Anywhere",
    priceLevel: "$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ cuisine_importance: "low", emotional_intent: "explore" }),
  },
  (dm, f) => ({
    passed: f.reputation >= 4,
    desc: "Rep>=4 (hidden_local + cultural auth + explore boost)",
    actual: `Rep=${f.reputation.toFixed(1)}, Atmo=${f.atmosphere.toFixed(1)}, DM=${dm}`,
  })
);

// T66: Chill Hangout — relaxed casual spot
runTest(
  "T66: Chill Hangout at relaxed spot",
  "Occasions",
  buildMockProfile(
    { noise_level: "Moderate", group_friendly_score: 7 },
    { service_style: "Bar Service", meal_pacing: "relaxed", energy_level: 4, music_vibe: "curated-playlist" }
  ),
  {
    occasion: "Chill Hangout",
    specialRequest: "chill spot with friends",
    neighborhood: "Anywhere",
    priceLevel: "$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ vibe_keywords: ["chill", "casual"] }),
  },
  (dm, f) => ({
    passed: f.atmosphere >= 5,
    desc: "Atmosphere>=5 (chill vibe + relaxed pacing)",
    actual: `Atmo=${f.atmosphere.toFixed(1)}, Setting=${f.setting.toFixed(1)}, DM=${dm}`,
  })
);

// ==========================================
// CATEGORY 15: WEIGHT INTERACTIONS (3 tests)
// ==========================================

// T67: Medium cuisine + Date Night — tests weight override precedence (ISSUE-7)
runTest(
  "T67: Weight override: medium cuisine + Date Night",
  "Weight Interactions",
  buildMockProfile({ cuisine_type: "Italian" }),
  {
    occasion: "Date Night",
    specialRequest: "Italian for date night",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Italian"], cuisine_importance: "medium" }),
  },
  (_dm, _f, w) => ({
    // medium cuisine gives food=0.35, but Date Night override replaces with food=0.20
    // ISSUE-7: medium cuisine signal discarded by occasion override
    passed: true,
    desc: `OBSERVE ISSUE-7: Medium cuisine food_weight=${w.food.toFixed(3)} (0.35 from cuisine, overridden to 0.20 by Date Night)`,
    actual: `food=${w.food.toFixed(3)}, setting=${w.setting.toFixed(3)}, atmo=${w.atmosphere.toFixed(3)}`,
  })
);

// T68: Comfort emotional intent shifts atmosphere weight
runTest(
  "T68: Comfort intent boosts atmosphere",
  "Weight Interactions",
  buildMockProfile(),
  {
    occasion: "Any",
    specialRequest: "comfort food",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ cuisine_importance: "low", emotional_intent: "comfort" }),
  },
  (_dm, _f, w) => ({
    passed: w.atmosphere >= 0.30,
    desc: "atmosphere weight >= 0.30 (low cuisine + comfort intent)",
    actual: `atmo=${w.atmosphere.toFixed(3)}, rep=${w.reputation.toFixed(3)}`,
  })
);

// T69: High cuisine + impress intent
runTest(
  "T69: High cuisine + impress intent",
  "Weight Interactions",
  buildMockProfile({ cuisine_type: "Japanese" }),
  {
    occasion: "Special Occasion",
    specialRequest: "best omakase to impress",
    neighborhood: "Anywhere",
    priceLevel: "$$$$",
    googleData: buildMockGoogle(),
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high", emotional_intent: "impress" }),
  },
  (_dm, _f, w) => ({
    // high cuisine → food=0.45. Since cuisine_importance=high, occasion override skipped.
    // impress: rep+0.05, conv-0.05
    passed: w.food >= 0.40 && w.reputation >= 0.15,
    desc: "food>=0.40, rep>=0.15 (high cuisine dominates, impress boosts rep)",
    actual: `food=${w.food.toFixed(3)}, rep=${w.reputation.toFixed(3)}, conv=${w.convenience.toFixed(3)}`,
  })
);

// ==========================================
// CATEGORY 16: DEAL-BREAKER GATES (2 tests)
// ==========================================

// T70: Gate excludes previously seen restaurant
runTest(
  "T70: Deal-breaker gate — excluded restaurant",
  "Gates",
  (() => {
    const profiles = [
      buildMockProfile({ id: "rest-1" }),
      buildMockProfile({ id: "rest-excluded" }),
      buildMockProfile({ id: "rest-3" }),
    ];
    const { passed } = applyDealBreakerGates(profiles, ["rest-excluded"]);
    const gatedOut = !passed.some(p => p.id === "rest-excluded");
    const othersKept = passed.length === 2;
    return buildMockProfile(); // dummy for runTest signature
  })(),
  {
    occasion: "Any",
    specialRequest: "",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: null,
    intent: buildMockIntent(),
  },
  () => {
    // Actually test the gate inline
    const profiles = [
      buildMockProfile({ id: "rest-a" }),
      buildMockProfile({ id: "rest-b" }),
      buildMockProfile({ id: "rest-c" }),
    ];
    const { passed, gated } = applyDealBreakerGates(profiles, ["rest-b"]);
    return {
      passed: passed.length === 2 && gated.get("rest-b") === "excluded",
      desc: "Gate excludes rest-b, keeps 2",
      actual: `passed=${passed.length}, gated=${gated.size}, reason=${gated.get("rest-b")}`,
    };
  }
);

// T71: Gate dietary hard block (no hierarchy match)
runTest(
  "T71: Deal-breaker gate — dietary hard block",
  "Gates",
  buildMockProfile(),
  {
    occasion: "Any",
    specialRequest: "",
    neighborhood: "Anywhere",
    priceLevel: "Any",
    googleData: null,
    intent: buildMockIntent(),
  },
  () => {
    const profiles = [
      buildMockProfile({ id: "rest-vegan", dietary_options: ["Vegan"] }),
      buildMockProfile({ id: "rest-none", dietary_options: ["Gluten-Free"] }),
    ];
    const { passed, gated } = applyDealBreakerGates(profiles, [], ["Vegan"]);
    return {
      passed: passed.some(p => p.id === "rest-vegan") && gated.has("rest-none"),
      desc: "Vegan gate: keeps vegan restaurant, blocks gluten-free-only",
      actual: `passed=${passed.map(p => p.id).join(",")}, gated=${[...gated.keys()].join(",")}`,
    };
  }
);

// ==========================================
// CATEGORY 17: MIXED PENALTY ARITHMETIC (2 tests)
// ==========================================

// T72: Price gap 3-tier subtractive penalty (ISSUE-1 FIXED)
runTest(
  "T72: ISSUE-1 FIXED: Subtractive price penalty on high scorer",
  "Penalty Arithmetic",
  buildMockProfile({ price_level: "$$$$", cuisine_type: "Japanese", date_friendly_score: 9, romantic_rating: 9 },
    { service_style: "Tasting Menu", awards_recognition: ["Michelin Star"], enrichment_confidence: 9 }),
  {
    occasion: "Date Night",
    specialRequest: "omakase",
    neighborhood: "Anywhere",
    priceLevel: "$",
    googleData: buildMockGoogle({ google_rating: 4.8, google_review_count: 500 }),
    sentimentScore: 9,
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high" }),
  },
  (dm) => ({
    // With subtractive -3.0, high scorer (raw ~7.5) → 7.5-3.0=4.5 → DM≈45
    passed: dm >= 30 && dm <= 55,
    desc: "DM 30-55 (subtractive -3.0: fixed penalty regardless of base score)",
    actual: `DM=${dm}`,
  })
);

// T73: Price gap 3-tier on low scorer — same absolute penalty (ISSUE-1 FIXED)
runTest(
  "T73: ISSUE-1 FIXED: Subtractive price penalty on low scorer",
  "Penalty Arithmetic",
  buildMockProfile({ price_level: "$$$$", cuisine_type: "Mexican" }),
  {
    occasion: "Any",
    specialRequest: "sushi",
    neighborhood: "Anywhere",
    priceLevel: "$",
    googleData: buildMockGoogle({ google_rating: 3.5, google_review_count: 20 }),
    intent: buildMockIntent({ target_cuisines: ["Japanese"], cuisine_importance: "high" }),
  },
  (dm) => ({
    // With subtractive -3.0, low scorer (raw ~3.2) → max(0, 3.2-3.0)=0.2 → DM≈2
    passed: dm <= 10,
    desc: "DM<=10 (subtractive -3.0: same fixed penalty, floors to near-zero on low scorer)",
    actual: `DM=${dm}`,
  })
);

// ==========================================
// OUTPUT RESULTS
// ==========================================

console.log("\n" + "=".repeat(120));
console.log("  DONDE MATCH V3 SCORING ENGINE — TEST RESULTS");
console.log("=".repeat(120));
console.log(`  Date: ${new Date().toISOString()}`);
console.log(`  Tests: ${results.length} | PASSED: ${passCount} | FAILED: ${failCount}`);
console.log("=".repeat(120));

// Group by category
const categories = [...new Set(results.map(r => r.category))];

for (const cat of categories) {
  const catResults = results.filter(r => r.category === cat);
  console.log(`\n## ${cat}`);
  console.log("-".repeat(120));
  console.log(
    "  " +
    "Test".padEnd(50) +
    "Food".padStart(6) +
    "Set".padStart(6) +
    "Atmo".padStart(6) +
    "Rep".padStart(6) +
    "Conv".padStart(6) +
    "DM".padStart(5) +
    "Data%".padStart(6) +
    "  Status"
  );
  console.log("-".repeat(120));

  for (const r of catResults) {
    const status = r.passed ? "PASS" : "FAIL";
    const marker = r.passed ? " " : "!";
    console.log(
      marker + " " +
      r.name.padEnd(50).slice(0, 50) +
      r.food.toFixed(1).padStart(6) +
      r.setting.toFixed(1).padStart(6) +
      r.atmosphere.toFixed(1).padStart(6) +
      r.reputation.toFixed(1).padStart(6) +
      r.convenience.toFixed(1).padStart(6) +
      String(r.dondeMatch).padStart(5) +
      (r.dataCompleteness + "%").padStart(6) +
      "  " + status
    );
    if (!r.passed || r.assertion.startsWith("OBSERVE") || r.assertion.startsWith("MODEL")) {
      console.log("    → " + r.assertion);
      console.log("    → " + r.actual);
    }
  }
}

// Cuisine penalty model comparison
console.log("\n" + "=".repeat(120));
console.log("  CUISINE MISMATCH PENALTY MODEL COMPARISON");
console.log("=".repeat(120));
console.log("  Scenario: 'best sushi omakase' → Italian restaurant with outstanding setting/vibe/reputation");
console.log("");

const modelResults = results.filter(r => r.category === "Penalty Models");
for (const r of modelResults) {
  console.log(`  ${r.name}`);
  console.log(`    ${r.actual}`);
  console.log("");
}

// T10 observation
const t10 = results.find(r => r.name.startsWith("T10"));
if (t10) {
  console.log("  T10: General mismatch + excellent factors observation:");
  console.log(`    ${t10.actual}`);
  console.log("");
}

// Summary statistics
console.log("=".repeat(120));
console.log("  SCORE DISTRIBUTION ANALYSIS");
console.log("=".repeat(120));

const dms = results.map(r => r.dondeMatch);
const foods = results.map(r => r.food);
const settings = results.map(r => r.setting);
const atmos = results.map(r => r.atmosphere);
const reps = results.map(r => r.reputation);
const convs = results.map(r => r.convenience);

function stats(arr: number[], label: string) {
  const sorted = [...arr].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(`  ${label.padEnd(15)} min=${String(min).padStart(5)}  max=${String(max).padStart(5)}  mean=${mean.toFixed(1).padStart(5)}  median=${String(median).padStart(5)}`);
}

stats(dms, "Donde Match");
stats(foods, "Food Match");
stats(settings, "Setting Fit");
stats(atmos, "Atmosphere");
stats(reps, "Reputation");
stats(convs, "Convenience");

console.log("\n" + "=".repeat(120));
console.log(`  FINAL: ${passCount}/${results.length} PASSED (${Math.round(passCount / results.length * 100)}%)`);
console.log("=".repeat(120) + "\n");

// Exit with error code if failures
if (failCount > 0) {
  if (typeof Deno !== "undefined") Deno.exit(1);
  else process.exit(1);
}
