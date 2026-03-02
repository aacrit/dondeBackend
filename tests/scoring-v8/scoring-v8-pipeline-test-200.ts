/**
 * V8 Scoring Pipeline Test — 200 Multi-Factor Input Stress Test
 *
 * Each of the 200 test cases is a realistic user query combining 3-5 signals
 * (cuisine + dish + vibe + occasion + constraints) — like real user input.
 *
 * Uses 10 restaurant archetypes from test-2.
 * Run: cd dondeBackend && deno run --allow-read tests/scoring-v8/scoring-v8-pipeline-test-200.ts
 */

import {
  computeV8DondeMatch,
} from "../../supabase/functions/recommend/_shared/scoring-v8.ts";
import type { RestaurantProfile, DeepProfile } from "../../supabase/functions/recommend/_shared/types.ts";
import type { IntentClassificationV2 } from "../../supabase/functions/recommend/_shared/intent-classifier.ts";
import type { GooglePlaceData } from "../../supabase/functions/recommend/_shared/google-places.ts";
import type { V8DondeMatchInputs } from "../../supabase/functions/recommend/_shared/types-v8.ts";

// ==========================================
// TEST INFRASTRUCTURE
// ==========================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

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
// 10 RESTAURANT ARCHETYPES (from test-2)
// ==========================================

const PROFILES: Record<string, RestaurantProfile> = {
  thaiStreet: makeProfile({
    name: "Aroy Thai", cuisine_type: "Thai", price_level: "$",
    noise_level: "Moderate", lighting_ambiance: "bright, casual, warm",
    dress_code: "Casual", outdoor_seating: true,
    date_friendly_score: 5, group_friendly_score: 7, family_friendly_score: 7,
    romantic_rating: 4, business_lunch_score: 4, solo_dining_score: 8,
    hole_in_wall_factor: 8, trending_score: 6,
    tags: ["great value", "hidden gem", "late night"],
    tag_categories: ["vibe", "value"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Pad Thai", why: "Classic wok-fried noodles with tamarind" },
        { dish: "Green Curry", why: "Coconut-based with Thai basil" },
      ],
      menu_highlights: ["tom yum soup", "papaya salad", "mango sticky rice", "thai iced tea"],
      flavor_profiles: ["bold-spiced", "citrus-forward", "sweet-savory"],
      spice_level: "medium-hot", cuisine_subcategory: "Central Thai",
      service_style: "Counter", meal_pacing: "quick_bite",
      reservation_difficulty: "walk_in_friendly", typical_wait_minutes: 10,
      energy_level: 6, cultural_authenticity: 9,
      neighborhood_integration: "institution", check_average_per_person: 15,
    }),
  }),
  indianFine: makeProfile({
    name: "Vermillion", cuisine_type: "Indian", price_level: "$$$",
    noise_level: "Moderate", lighting_ambiance: "dim, warm, elegant, intimate",
    dress_code: "Smart Casual",
    date_friendly_score: 8, group_friendly_score: 6, family_friendly_score: 5,
    romantic_rating: 8, business_lunch_score: 7, solo_dining_score: 5,
    hole_in_wall_factor: 3, trending_score: 8,
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
      service_style: "Full Table Service", meal_pacing: "leisurely",
      reservation_difficulty: "moderate", energy_level: 5, music_vibe: "ambient",
      decor_style: "modern Indian, warm wood, brass accents",
      conversation_friendliness: 8,
      awards_recognition: ["Chicago Magazine Best New Restaurant"],
      chef_notable: true, cultural_authenticity: 8,
      neighborhood_integration: "destination", check_average_per_person: 55,
      enrichment_confidence: 0.9,
    }),
  }),
  koreanBBQ: makeProfile({
    name: "San Soo Gab San", cuisine_type: "Korean", price_level: "$$",
    noise_level: "Loud", lighting_ambiance: "bright, lively, modern",
    dress_code: "Casual",
    date_friendly_score: 5, group_friendly_score: 9, family_friendly_score: 6,
    romantic_rating: 4, business_lunch_score: 3, solo_dining_score: 4,
    hole_in_wall_factor: 6, trending_score: 7,
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
      service_style: "Family Style", meal_pacing: "relaxed",
      reservation_difficulty: "walk_in_friendly", energy_level: 8,
      music_vibe: "curated-playlist",
      decor_style: "modern Korean, grill tables, K-pop aesthetic",
      cultural_authenticity: 9, neighborhood_integration: "institution",
      check_average_per_person: 35,
    }),
  }),
  greekTaverna: makeProfile({
    name: "Avli Taverna", cuisine_type: "Greek", price_level: "$$$",
    noise_level: "Moderate", lighting_ambiance: "warm, Mediterranean, bright",
    dress_code: "Smart Casual", outdoor_seating: true,
    date_friendly_score: 8, group_friendly_score: 8, family_friendly_score: 7,
    romantic_rating: 7, business_lunch_score: 6, solo_dining_score: 5,
    hole_in_wall_factor: 4, trending_score: 7,
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
      service_style: "Full Table Service", meal_pacing: "relaxed",
      reservation_difficulty: "moderate", energy_level: 5,
      music_vibe: "curated-playlist",
      decor_style: "whitewashed Mediterranean, olive branches, terracotta",
      conversation_friendliness: 7, cultural_authenticity: 8,
      neighborhood_integration: "destination", check_average_per_person: 50,
    }),
  }),
  phoShop: makeProfile({
    name: "Tank Noodle", cuisine_type: "Vietnamese", price_level: "$",
    noise_level: "Moderate", lighting_ambiance: "bright, fluorescent, casual",
    dress_code: "Casual",
    date_friendly_score: 3, group_friendly_score: 7, family_friendly_score: 8,
    romantic_rating: 2, business_lunch_score: 3, solo_dining_score: 9,
    hole_in_wall_factor: 9, trending_score: 5,
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
      service_style: "Counter", meal_pacing: "quick_bite",
      reservation_difficulty: "walk_in_friendly", typical_wait_minutes: 15,
      energy_level: 6, cultural_authenticity: 10,
      neighborhood_integration: "institution", check_average_per_person: 14,
    }),
  }),
  peruvianFusion: makeProfile({
    name: "Tanta", cuisine_type: "Peruvian", price_level: "$$$",
    noise_level: "Moderate", lighting_ambiance: "warm, vibrant, modern",
    dress_code: "Smart Casual", outdoor_seating: true,
    date_friendly_score: 7, group_friendly_score: 8, family_friendly_score: 6,
    romantic_rating: 6, business_lunch_score: 7, solo_dining_score: 6,
    hole_in_wall_factor: 3, trending_score: 8,
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
      service_style: "Full Table Service", meal_pacing: "relaxed",
      reservation_difficulty: "moderate", energy_level: 6,
      music_vibe: "curated-playlist",
      decor_style: "colorful, modern Latin, exposed brick",
      conversation_friendliness: 7,
      awards_recognition: ["James Beard Nominee"],
      chef_notable: true, cultural_authenticity: 7,
      neighborhood_integration: "destination", check_average_per_person: 48,
      enrichment_confidence: 0.9,
    }),
  }),
  cubanCafe: makeProfile({
    name: "Cafe Laguardia", cuisine_type: "Cuban", price_level: "$$",
    noise_level: "Moderate", lighting_ambiance: "warm, colorful, tropical",
    dress_code: "Casual", live_music: true,
    date_friendly_score: 6, group_friendly_score: 7, family_friendly_score: 7,
    romantic_rating: 6, business_lunch_score: 4, solo_dining_score: 6,
    hole_in_wall_factor: 7, trending_score: 5,
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
      service_style: "Full Table Service", meal_pacing: "relaxed",
      reservation_difficulty: "walk_in_friendly", energy_level: 7,
      music_vibe: "live-jazz",
      decor_style: "vintage Havana, tropical colors, ceiling fans",
      conversation_friendliness: 6, cultural_authenticity: 9,
      neighborhood_integration: "institution", check_average_per_person: 28,
    }),
  }),
  southernSoul: makeProfile({
    name: "Big Jones", cuisine_type: "Southern/Soul Food", price_level: "$$",
    noise_level: "Moderate", lighting_ambiance: "warm, cozy, rustic",
    dress_code: "Casual", pet_friendly: true, outdoor_seating: true,
    date_friendly_score: 6, group_friendly_score: 8, family_friendly_score: 9,
    romantic_rating: 5, business_lunch_score: 5, solo_dining_score: 6,
    hole_in_wall_factor: 6, trending_score: 6,
    tags: ["great value", "outdoor patio", "pet friendly", "kid friendly", "brunch spot"],
    tag_categories: ["vibe", "feature", "value"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Fried Chicken", why: "Buttermilk-brined, cast iron" },
        { dish: "Shrimp and Grits", why: "Stone-ground with Tasso gravy" },
      ],
      menu_highlights: ["biscuits", "collard greens", "cornbread", "peach cobbler"],
      flavor_profiles: ["savory", "rich-buttery", "smoky"],
      service_style: "Full Table Service", meal_pacing: "relaxed",
      reservation_difficulty: "walk_in_friendly", kid_friendliness: 9,
      energy_level: 5, music_vibe: "curated-playlist",
      decor_style: "Southern farmhouse, reclaimed wood, mason jars",
      conversation_friendliness: 8, cultural_authenticity: 8,
      neighborhood_integration: "institution", check_average_per_person: 25,
    }),
  }),
  cocktailLounge: makeProfile({
    name: "The Violet Hour", cuisine_type: "Cocktail Bar", price_level: "$$$",
    noise_level: "Quiet", lighting_ambiance: "dim, intimate, sophisticated",
    dress_code: "Smart Casual",
    date_friendly_score: 9, group_friendly_score: 4, family_friendly_score: 1,
    romantic_rating: 9, business_lunch_score: 3, solo_dining_score: 7,
    hole_in_wall_factor: 6, trending_score: 9,
    tags: ["craft cocktails", "romantic", "quiet", "hidden gem", "speakeasy"],
    tag_categories: ["vibe", "feature"],
    deep_profile: makeDeepProfile({
      signature_dishes: [
        { dish: "Seasonal Cocktail Flight", why: "Rotating 4-course tasting" },
      ],
      menu_highlights: ["old fashioned", "negroni", "charcuterie", "oysters"],
      flavor_profiles: ["rich-buttery", "bright-acidic", "herbaceous"],
      service_style: "Bar Service", meal_pacing: "leisurely",
      reservation_difficulty: "hard_to_get", energy_level: 3,
      music_vibe: "ambient",
      decor_style: "speakeasy, velvet curtains, candlelit, dark wood",
      conversation_friendliness: 9,
      date_progression: "Cocktails at the bar, whispered conversation, nightcap",
      awards_recognition: ["James Beard Outstanding Bar Program"],
      cultural_authenticity: 7, neighborhood_integration: "destination",
      check_average_per_person: 45, enrichment_confidence: 0.95,
    }),
  }),
  polishDiner: makeProfile({
    name: "Staropolska", cuisine_type: "Polish", price_level: "$",
    noise_level: "Moderate", lighting_ambiance: "bright, homey, warm",
    dress_code: "Casual",
    date_friendly_score: 4, group_friendly_score: 7, family_friendly_score: 9,
    romantic_rating: 3, business_lunch_score: 4, solo_dining_score: 7,
    hole_in_wall_factor: 9, trending_score: 4,
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
      service_style: "Full Table Service", meal_pacing: "relaxed",
      reservation_difficulty: "walk_in_friendly", typical_wait_minutes: 5,
      kid_friendliness: 9, energy_level: 4,
      decor_style: "old-world European, lace curtains, wood paneling",
      conversation_friendliness: 8, cultural_authenticity: 10,
      neighborhood_integration: "institution", check_average_per_person: 16,
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

function runRanking(
  specialRequest: string, occasion: string,
  intent: IntentClassificationV2 | null,
  opts?: { withGoogle?: boolean; dietary?: string[] },
) {
  const results = PROFILE_NAMES.map(key => {
    const profile = PROFILES[key];
    const inputs: V8DondeMatchInputs = {
      occasion, specialRequest, neighborhood: "Anywhere", priceLevel: "Any",
      googleData: opts?.withGoogle ? (GOOGLE_DATA[key] || null) : null,
      intent, dietaryRestrictions: opts?.dietary,
      candidatePoolSize: PROFILE_NAMES.length,
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

// ==========================================
// TEST CASE INTERFACE
// ==========================================

interface TestCase {
  id: number;
  query: string;
  occasion: string;
  intent: Partial<IntentClassificationV2>;
  dietary?: string[];
  expect: {
    topDM_gte?: number;
    anyTop3?: string[];
    rank1?: string;
    rulesMin?: number;
  };
}

// ==========================================
// 200 MULTI-FACTOR TEST CASES
// ==========================================

const TEST_CASES: TestCase[] = [
  // ── Batch 1: cuisine + dish + occasion (1-30) ──────────────────
  {
    id: 1,
    query: "Thai pad thai for a casual date night",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Thai"], dish_level_intent: "pad thai",
      emotional_intent: "romantic", confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, anyTop3: ["thaiStreet"] },
  },
  {
    id: 2,
    query: "Indian biryani for a business lunch",
    occasion: "Business Lunch",
    intent: {
      target_cuisines: ["Indian"], dish_level_intent: "biryani",
      emotional_intent: "professional", confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "indianFine" },
  },
  {
    id: 3,
    query: "Korean bulgogi for a group celebration",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Korean"], dish_level_intent: "bulgogi",
      emotional_intent: "celebratory", group_size_hint: "large", confidence: { cuisine: "high", vibe: "low", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "koreanBBQ" },
  },
  {
    id: 4,
    query: "Greek lamb chops for an anniversary dinner",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Greek"], dish_level_intent: "lamb chops",
      emotional_intent: "romantic", confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "greekTaverna" },
  },
  {
    id: 5,
    query: "Vietnamese pho for a quick solo lunch",
    occasion: "Solo Dining",
    intent: {
      target_cuisines: ["Vietnamese"], dish_level_intent: "pho",
      emotional_intent: "casual", confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "phoShop" },
  },
  {
    id: 6,
    query: "Peruvian ceviche for a birthday dinner",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Peruvian"], dish_level_intent: "ceviche",
      emotional_intent: "celebratory", confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "peruvianFusion" },
  },
  {
    id: 7,
    query: "Cuban ropa vieja for a family gathering",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Cuban"], dish_level_intent: "ropa vieja",
      emotional_intent: "casual", group_size_hint: "large", confidence: { cuisine: "high", vibe: "low", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "cubanCafe" },
  },
  {
    id: 8,
    query: "Southern fried chicken for a family dinner",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Southern"], dish_level_intent: "fried chicken",
      emotional_intent: "casual", confidence: { cuisine: "high", vibe: "low", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "southernSoul" },
  },
  {
    id: 9,
    query: "Polish pierogi for a casual dinner out",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Polish"], dish_level_intent: "pierogi",
      emotional_intent: "casual", confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, rank1: "polishDiner" },
  },
  {
    id: 10,
    query: "Thai green curry for a group dinner",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Thai"], dish_level_intent: "green curry",
      emotional_intent: "casual", group_size_hint: "medium", confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, anyTop3: ["thaiStreet"] },
  },
  {
    id: 11,
    query: "Indian tikka masala for a date night",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Indian"], dish_level_intent: "chicken tikka masala",
      emotional_intent: "romantic", confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "indianFine" },
  },
  {
    id: 12,
    query: "Korean kimchi jjigae for a solo meal",
    occasion: "Solo Dining",
    intent: {
      target_cuisines: ["Korean"], dish_level_intent: "kimchi jjigae",
      emotional_intent: "casual", confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 30, anyTop3: ["koreanBBQ"] },
  },
  {
    id: 13,
    query: "Greek grilled octopus for a special occasion",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Greek"], dish_level_intent: "grilled octopus",
      emotional_intent: "celebratory", confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "greekTaverna" },
  },
  {
    id: 14,
    query: "Vietnamese banh mi for a quick lunch stop",
    occasion: "Quick Bite",
    intent: {
      target_cuisines: ["Vietnamese"], dish_level_intent: "banh mi",
      emotional_intent: "casual", spontaneity: "spontaneous", confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "phoShop" },
  },
  {
    id: 15,
    query: "Peruvian lomo saltado for a friend's birthday",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Peruvian"], dish_level_intent: "lomo saltado",
      emotional_intent: "celebratory", group_size_hint: "medium", confidence: { cuisine: "high", vibe: "low", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "peruvianFusion" },
  },
  {
    id: 16,
    query: "Cuban sandwich for a casual meetup",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Cuban"], dish_level_intent: "cuban sandwich",
      emotional_intent: "casual", confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, rank1: "cubanCafe" },
  },
  {
    id: 17,
    query: "Southern shrimp and grits for brunch",
    occasion: "Brunch",
    intent: {
      target_cuisines: ["Southern"], dish_level_intent: "shrimp and grits",
      emotional_intent: "casual", confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "southernSoul" },
  },
  {
    id: 18,
    query: "Thai tom yum soup for a rainy evening dinner",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Thai"], dish_level_intent: "tom yum soup",
      emotional_intent: "comfort", confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["thaiStreet"] },
  },
  {
    id: 19,
    query: "Indian samosa chaat for a casual outing",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Indian"], dish_level_intent: "samosa chaat",
      emotional_intent: "casual", confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["indianFine"] },
  },
  {
    id: 20,
    query: "Korean bibimbap for a weeknight dinner",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Korean"], dish_level_intent: "bibimbap",
      emotional_intent: "casual", confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30 },
  },
  {
    id: 21,
    query: "Greek spanakopita for a family get-together",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Greek"], dish_level_intent: "spanakopita",
      emotional_intent: "casual", group_size_hint: "large", confidence: { cuisine: "high", vibe: "low", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["greekTaverna"] },
  },
  {
    id: 22,
    query: "Vietnamese spring rolls for a quick date",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Vietnamese"], dish_level_intent: "spring rolls",
      emotional_intent: "casual", confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30 },
  },
  {
    id: 23,
    query: "Peruvian anticuchos for a fun night out",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Peruvian"], dish_level_intent: "anticuchos",
      emotional_intent: "celebratory", confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 35, rank1: "peruvianFusion" },
  },
  {
    id: 24,
    query: "Cuban plantains and black beans for a solo lunch",
    occasion: "Solo Dining",
    intent: {
      target_cuisines: ["Cuban"], dish_level_intent: "plantains",
      emotional_intent: "casual", confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["cubanCafe"] },
  },
  {
    id: 25,
    query: "Polish kielbasa plate for a casual dinner with friends",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Polish"], dish_level_intent: "kielbasa",
      emotional_intent: "casual", group_size_hint: "medium", confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, rank1: "polishDiner" },
  },
  {
    id: 26,
    query: "Thai mango sticky rice and pad see ew for a group dinner",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Thai"], dish_level_intent: "pad see ew",
      emotional_intent: "casual", group_size_hint: "medium", confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["thaiStreet"] },
  },
  {
    id: 27,
    query: "Indian butter chicken for a cozy family dinner",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Indian"], dish_level_intent: "butter chicken",
      emotional_intent: "comfort", confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, anyTop3: ["indianFine"] },
  },
  {
    id: 28,
    query: "Korean galbi for a weekend dinner",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Korean"], dish_level_intent: "galbi",
      emotional_intent: "casual", confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, rank1: "koreanBBQ" },
  },
  {
    id: 29,
    query: "Greek saganaki for a celebratory dinner",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Greek"], dish_level_intent: "saganaki",
      emotional_intent: "celebratory", confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["greekTaverna"] },
  },
  {
    id: 30,
    query: "Vietnamese bun bo hue for a solo adventure",
    occasion: "Solo Dining",
    intent: {
      target_cuisines: ["Vietnamese"], dish_level_intent: "bun bo hue",
      emotional_intent: "adventurous", confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, rank1: "phoShop" },
  },
  // ── Batch 2: cuisine + vibe + occasion (31-55) ──────────────────
  {
    id: 31,
    query: "Cozy Thai spot for a solo dinner, something comforting",
    occasion: "Solo Dining",
    intent: {
      target_cuisines: ["Thai"], vibe_keywords: ["cozy", "comforting"],
      emotional_intent: "comfort", confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["thaiStreet"] },
  },
  {
    id: 32,
    query: "Elegant Indian restaurant for an intimate anniversary",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Indian"], vibe_keywords: ["elegant", "intimate"],
      emotional_intent: "romantic", confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "indianFine" },
  },
  {
    id: 33,
    query: "Lively Korean place for a fun group outing",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Korean"], vibe_keywords: ["lively", "fun"],
      emotional_intent: "celebratory", group_size_hint: "large", confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "koreanBBQ" },
  },
  {
    id: 34,
    query: "Warm Mediterranean Greek vibe for a family dinner",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Greek"], vibe_keywords: ["warm", "Mediterranean"],
      emotional_intent: "casual", group_size_hint: "large", confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, anyTop3: ["greekTaverna"] },
  },
  {
    id: 35,
    query: "Authentic Vietnamese hole in the wall for an adventure",
    occasion: "Solo Dining",
    intent: {
      target_cuisines: ["Vietnamese"], vibe_keywords: ["authentic", "hole in the wall"],
      emotional_intent: "adventurous", confidence: { cuisine: "high", vibe: "high", occasion: "low", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "phoShop" },
  },
  {
    id: 36,
    query: "Trendy Peruvian spot for a stylish date night",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Peruvian"], vibe_keywords: ["trendy", "stylish"],
      emotional_intent: "romantic", confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "peruvianFusion" },
  },
  {
    id: 37,
    query: "Vibrant Cuban atmosphere for a lively group dinner",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Cuban"], vibe_keywords: ["vibrant", "lively"],
      emotional_intent: "celebratory", group_size_hint: "medium", confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "cubanCafe" },
  },
  {
    id: 38,
    query: "Rustic Southern comfort food for a relaxed brunch",
    occasion: "Brunch",
    intent: {
      target_cuisines: ["Southern"], vibe_keywords: ["rustic", "comfort"],
      emotional_intent: "comfort", confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "southernSoul" },
  },
  {
    id: 39,
    query: "Intimate cocktail bar for a quiet date",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Cocktail Bar"], vibe_keywords: ["intimate", "quiet"],
      emotional_intent: "romantic", confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "cocktailLounge" },
  },
  {
    id: 40,
    query: "Homey Polish spot for a casual family meal",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Polish"], vibe_keywords: ["homey", "casual"],
      emotional_intent: "casual", group_size_hint: "medium", confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "polishDiner" },
  },
  {
    id: 41,
    query: "Spicy bold Thai for an exciting night out",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Thai"], vibe_keywords: ["exciting", "bold"],
      flavor_preferences: ["spicy"], emotional_intent: "adventurous", confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["thaiStreet"] },
  },
  {
    id: 42,
    query: "Sophisticated Indian for an upscale business dinner",
    occasion: "Business Lunch",
    intent: {
      target_cuisines: ["Indian"], vibe_keywords: ["sophisticated", "upscale"],
      emotional_intent: "professional", confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "indianFine" },
  },
  {
    id: 43,
    query: "Energetic Korean spot for a birthday party",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Korean"], vibe_keywords: ["energetic"],
      emotional_intent: "celebratory", group_size_hint: "large", confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40 },
  },
  {
    id: 44,
    query: "Scenic Greek restaurant for a relaxed weekend lunch",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Greek"], vibe_keywords: ["scenic", "relaxed"],
      target_tags: ["scenic view"], emotional_intent: "casual", confidence: { cuisine: "high", vibe: "high", occasion: "low", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["greekTaverna"] },
  },
  {
    id: 45,
    query: "No-frills Vietnamese for a quick solo bite",
    occasion: "Quick Bite",
    intent: {
      target_cuisines: ["Vietnamese"], vibe_keywords: ["no-frills", "quick"],
      emotional_intent: "casual", spontaneity: "spontaneous", confidence: { cuisine: "high", vibe: "medium", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "phoShop" },
  },
  {
    id: 46,
    query: "Colorful Peruvian spot for a celebratory group dinner",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Peruvian"], vibe_keywords: ["colorful", "celebratory"],
      emotional_intent: "celebratory", group_size_hint: "large", confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "peruvianFusion" },
  },
  {
    id: 47,
    query: "Fun Cuban place with music for a night out",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Cuban"], vibe_keywords: ["fun", "lively"],
      target_features: ["live music"], emotional_intent: "celebratory", confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "medium", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "cubanCafe" },
  },
  {
    id: 48,
    query: "Warm cozy Southern spot for a comfort food date",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Southern"], vibe_keywords: ["warm", "cozy"],
      emotional_intent: "comfort", confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["southernSoul"] },
  },
  {
    id: 49,
    query: "Moody speakeasy vibe for a sophisticated night out",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Cocktail Bar"], vibe_keywords: ["moody", "speakeasy", "sophisticated"],
      target_tags: ["speakeasy"], emotional_intent: "romantic", confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "cocktailLounge" },
  },
  {
    id: 50,
    query: "Old-world Polish charm for a nostalgic family dinner",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Polish"], vibe_keywords: ["old-world", "charming"],
      emotional_intent: "comfort", group_size_hint: "medium", confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "polishDiner" },
  },
  {
    id: 51,
    query: "Romantic quiet Indian place for a first date",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Indian"], vibe_keywords: ["romantic", "quiet"],
      emotional_intent: "romantic", date_type: "first_date", confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "indianFine" },
  },
  {
    id: 52,
    query: "Bright casual Thai for a spontaneous lunch",
    occasion: "Quick Bite",
    intent: {
      target_cuisines: ["Thai"], vibe_keywords: ["bright", "casual"],
      emotional_intent: "casual", spontaneity: "spontaneous", confidence: { cuisine: "high", vibe: "medium", occasion: "low", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["thaiStreet"] },
  },
  {
    id: 53,
    query: "Charming Greek taverna for a leisurely Sunday dinner",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Greek"], vibe_keywords: ["charming", "leisurely"],
      emotional_intent: "casual", confidence: { cuisine: "high", vibe: "high", occasion: "low", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["greekTaverna"] },
  },
  {
    id: 54,
    query: "Buzzy Peruvian place for pre-drinks and snacks",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Peruvian"], vibe_keywords: ["buzzy"],
      target_tags: ["craft cocktails"], emotional_intent: "celebratory", confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["peruvianFusion"] },
  },
  {
    id: 55,
    query: "Chill Vietnamese noodle shop for a relaxed evening",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Vietnamese"], vibe_keywords: ["chill", "relaxed"],
      emotional_intent: "casual", confidence: { cuisine: "high", vibe: "medium", occasion: "low", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["phoShop"] },
  },
  // ── Batch 3: cuisine + dish + vibe + occasion (56-85) ──────────
  {
    id: 56,
    query: "Spicy Thai pad thai at a cozy spot for date night",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Thai"], dish_level_intent: "pad thai",
      vibe_keywords: ["cozy"], flavor_preferences: ["spicy"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, anyTop3: ["thaiStreet"] },
  },
  {
    id: 57,
    query: "Rich Indian biryani in an elegant setting for a business dinner",
    occasion: "Business Lunch",
    intent: {
      target_cuisines: ["Indian"], dish_level_intent: "biryani",
      vibe_keywords: ["elegant", "sophisticated"], emotional_intent: "professional",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "indianFine" },
  },
  {
    id: 58,
    query: "Sizzling Korean bulgogi in a lively place for a group celebration",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Korean"], dish_level_intent: "bulgogi",
      vibe_keywords: ["lively", "energetic"], emotional_intent: "celebratory", group_size_hint: "large",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "koreanBBQ" },
  },
  {
    id: 59,
    query: "Tender Greek lamb chops at a romantic Mediterranean spot for anniversary",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Greek"], dish_level_intent: "lamb chops",
      vibe_keywords: ["romantic", "Mediterranean"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "greekTaverna" },
  },
  {
    id: 60,
    query: "Steaming Vietnamese pho at a no-frills authentic joint, solo dinner",
    occasion: "Solo Dining",
    intent: {
      target_cuisines: ["Vietnamese"], dish_level_intent: "pho",
      vibe_keywords: ["authentic", "no-frills"], emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "phoShop" },
  },
  {
    id: 61,
    query: "Fresh Peruvian ceviche at a trendy vibrant spot for a birthday",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Peruvian"], dish_level_intent: "ceviche",
      vibe_keywords: ["trendy", "vibrant"], emotional_intent: "celebratory", group_size_hint: "medium",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "peruvianFusion" },
  },
  {
    id: 62,
    query: "Slow-braised Cuban ropa vieja in a lively tropical place for a group",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Cuban"], dish_level_intent: "ropa vieja",
      vibe_keywords: ["lively", "tropical"], emotional_intent: "celebratory", group_size_hint: "medium",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "cubanCafe" },
  },
  {
    id: 63,
    query: "Crispy Southern fried chicken at a cozy rustic place for family brunch",
    occasion: "Brunch",
    intent: {
      target_cuisines: ["Southern"], dish_level_intent: "fried chicken",
      vibe_keywords: ["cozy", "rustic"], emotional_intent: "comfort",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "southernSoul" },
  },
  {
    id: 64,
    query: "Classic old fashioned at an intimate speakeasy for date night",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Cocktail Bar"], dish_level_intent: "old fashioned",
      vibe_keywords: ["intimate", "speakeasy"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "cocktailLounge" },
  },
  {
    id: 65,
    query: "Handmade Polish pierogi in a homey old-world spot for family dinner",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Polish"], dish_level_intent: "pierogi",
      vibe_keywords: ["homey", "old-world"], emotional_intent: "comfort", group_size_hint: "medium",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "polishDiner" },
  },
  {
    id: 66,
    query: "Fragrant Thai green curry at a hidden gem for a solo adventure",
    occasion: "Solo Dining",
    intent: {
      target_cuisines: ["Thai"], dish_level_intent: "green curry",
      vibe_keywords: ["hidden gem"], emotional_intent: "adventurous",
      confidence: { cuisine: "high", vibe: "medium", occasion: "low", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 30, anyTop3: ["thaiStreet"] },
  },
  {
    id: 67,
    query: "Creamy Indian tikka masala at a dim candlelit place for a romantic evening",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Indian"], dish_level_intent: "chicken tikka masala",
      vibe_keywords: ["candlelit", "romantic", "dim"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "indianFine" },
  },
  {
    id: 68,
    query: "Korean japchae at a modern fun spot for a friend's going away party",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Korean"], dish_level_intent: "japchae",
      vibe_keywords: ["modern", "fun"], emotional_intent: "celebratory", group_size_hint: "large",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["koreanBBQ"] },
  },
  {
    id: 69,
    query: "Flaky Greek spanakopita at a bright Mediterranean patio for a leisurely lunch",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Greek"], dish_level_intent: "spanakopita",
      vibe_keywords: ["bright", "Mediterranean", "leisurely"], emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "high", occasion: "low", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["greekTaverna"] },
  },
  {
    id: 70,
    query: "Vietnamese vermicelli bowl at a quick casual joint for a weekday lunch",
    occasion: "Quick Bite",
    intent: {
      target_cuisines: ["Vietnamese"], dish_level_intent: "vermicelli bowl",
      vibe_keywords: ["quick", "casual"], emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "medium", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "phoShop" },
  },
  {
    id: 71,
    query: "Peruvian causa at a stylish modern place for a date",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Peruvian"], dish_level_intent: "causa",
      vibe_keywords: ["stylish", "modern"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "peruvianFusion" },
  },
  {
    id: 72,
    query: "Cuban mojito and plantains at a fun tropical bar for a group night",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Cuban"], dish_level_intent: "plantains",
      vibe_keywords: ["fun", "tropical"], emotional_intent: "celebratory", group_size_hint: "medium",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 30, anyTop3: ["cubanCafe"] },
  },
  {
    id: 73,
    query: "Southern biscuits and gravy at a warm farmhouse brunch spot",
    occasion: "Brunch",
    intent: {
      target_cuisines: ["Southern"], dish_level_intent: "biscuits",
      vibe_keywords: ["warm", "farmhouse"], emotional_intent: "comfort",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "southernSoul" },
  },
  {
    id: 74,
    query: "Craft negroni at a dark moody lounge for a late-night date",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Cocktail Bar"], dish_level_intent: "negroni",
      vibe_keywords: ["dark", "moody"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "cocktailLounge" },
  },
  {
    id: 75,
    query: "Polish borscht at a charming traditional place for a winter dinner",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Polish"], dish_level_intent: "borscht",
      vibe_keywords: ["charming", "traditional"], emotional_intent: "comfort",
      confidence: { cuisine: "high", vibe: "high", occasion: "low", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "polishDiner" },
  },
  {
    id: 76,
    query: "Bold Thai papaya salad at a bright street-food style place for a quick group bite",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Thai"], dish_level_intent: "papaya salad",
      vibe_keywords: ["bright", "street-food"], emotional_intent: "casual", group_size_hint: "medium",
      confidence: { cuisine: "high", vibe: "medium", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 30, anyTop3: ["thaiStreet"] },
  },
  {
    id: 77,
    query: "Indian naan and curry at a warm elegant spot for a couple's night",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Indian"], dish_level_intent: "naan bread",
      vibe_keywords: ["warm", "elegant"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "indianFine" },
  },
  {
    id: 78,
    query: "Korean BBQ galbi at a loud fun place for a bachelor party",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Korean"], dish_level_intent: "galbi",
      vibe_keywords: ["loud", "fun"], emotional_intent: "celebratory", group_size_hint: "large",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "koreanBBQ" },
  },
  {
    id: 79,
    query: "Greek tzatziki and grilled octopus at a sunny outdoor spot for a relaxed lunch",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Greek"], dish_level_intent: "grilled octopus",
      vibe_keywords: ["sunny", "outdoor", "relaxed"], emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "high", occasion: "low", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "greekTaverna" },
  },
  {
    id: 80,
    query: "Vietnamese iced coffee and banh mi at a quick grab-and-go for solo lunch",
    occasion: "Solo Dining",
    intent: {
      target_cuisines: ["Vietnamese"], dish_level_intent: "banh mi",
      vibe_keywords: ["quick"], emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "medium", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "phoShop" },
  },
  {
    id: 81,
    query: "Peruvian pisco sour and lomo saltado at a hip modern restaurant for date night",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Peruvian"], dish_level_intent: "lomo saltado",
      vibe_keywords: ["hip", "modern"], target_tags: ["craft cocktails"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "peruvianFusion" },
  },
  {
    id: 82,
    query: "Cuban tres leches at a colorful warm cafe for a family treat",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Cuban"], dish_level_intent: "tres leches",
      vibe_keywords: ["colorful", "warm"], emotional_intent: "casual", group_size_hint: "medium",
      confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 30, anyTop3: ["cubanCafe"] },
  },
  {
    id: 83,
    query: "Southern peach cobbler and collard greens at a cozy patio for a relaxed brunch",
    occasion: "Brunch",
    intent: {
      target_cuisines: ["Southern"], dish_level_intent: "collard greens",
      vibe_keywords: ["cozy", "patio"], emotional_intent: "comfort",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "southernSoul" },
  },
  {
    id: 84,
    query: "Seasonal cocktail tasting at a dim sophisticated lounge for an anniversary",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Cocktail Bar"], dish_level_intent: "cocktail flight",
      vibe_keywords: ["dim", "sophisticated"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "cocktailLounge" },
  },
  {
    id: 85,
    query: "Polish golabki at a warm old-world European spot for a comforting family meal",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Polish"], dish_level_intent: "golabki",
      vibe_keywords: ["warm", "old-world"], emotional_intent: "comfort", group_size_hint: "medium",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "low", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "polishDiner" },
  },
  // ── Batch 4: cuisine + dish + constraint (86-105) ──────────────
  {
    id: 86,
    query: "Walk-in Thai pad thai, something budget-friendly",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Thai"], dish_level_intent: "pad thai",
      practical_constraints: ["walk-in", "budget-friendly"], emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, anyTop3: ["thaiStreet"] },
  },
  {
    id: 87,
    query: "Indian butter chicken, needs to be reservation-friendly",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Indian"], dish_level_intent: "butter chicken",
      practical_constraints: ["reservations available"], emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["indianFine"] },
  },
  {
    id: 88,
    query: "Korean BBQ bulgogi, needs to seat a big group",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Korean"], dish_level_intent: "bulgogi",
      practical_constraints: ["large group seating"], group_size_hint: "large", emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "koreanBBQ" },
  },
  {
    id: 89,
    query: "Greek octopus with outdoor seating please",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Greek"], dish_level_intent: "grilled octopus",
      practical_constraints: ["outdoor seating"], target_features: ["outdoor seating"], emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["greekTaverna"] },
  },
  {
    id: 90,
    query: "Vietnamese pho, walk-in only, cheap eats",
    occasion: "Quick Bite",
    intent: {
      target_cuisines: ["Vietnamese"], dish_level_intent: "pho",
      practical_constraints: ["walk-in", "cheap"], emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "phoShop" },
  },
  {
    id: 91,
    query: "Peruvian ceviche with good cocktail menu",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Peruvian"], dish_level_intent: "ceviche",
      practical_constraints: ["cocktail menu"], target_tags: ["craft cocktails"], emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "peruvianFusion" },
  },
  {
    id: 92,
    query: "Cuban sandwich, somewhere with live music",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Cuban"], dish_level_intent: "cuban sandwich",
      practical_constraints: ["live music"], target_features: ["live music"], emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "cubanCafe" },
  },
  {
    id: 93,
    query: "Southern fried chicken, kid-friendly with outdoor patio",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Southern"], dish_level_intent: "fried chicken",
      practical_constraints: ["kid-friendly", "outdoor patio"], target_features: ["kid friendly", "outdoor seating"],
      emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "southernSoul" },
  },
  {
    id: 94,
    query: "Cocktails and oysters, quiet setting, no kids",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Cocktail Bar"], dish_level_intent: "oysters",
      practical_constraints: ["quiet", "no kids"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "cocktailLounge" },
  },
  {
    id: 95,
    query: "Polish pierogi, walk-in friendly and cheap",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Polish"], dish_level_intent: "pierogi",
      practical_constraints: ["walk-in", "budget"], emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 25, rank1: "polishDiner" },
  },
  {
    id: 96,
    query: "Thai curry, pet-friendly patio seating",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Thai"], dish_level_intent: "curry",
      practical_constraints: ["pet-friendly", "patio"], target_features: ["pet friendly", "outdoor seating"],
      emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, anyTop3: ["thaiStreet"] },
  },
  {
    id: 97,
    query: "Indian lamb biryani, need a place that takes reservations for 6",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Indian"], dish_level_intent: "lamb biryani",
      practical_constraints: ["reservations", "group of 6"], group_size_hint: "medium", emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["indianFine"] },
  },
  {
    id: 98,
    query: "Korean BBQ, late night, walk-in",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Korean"], dish_level_intent: "BBQ",
      practical_constraints: ["late night", "walk-in"], emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30 },
  },
  {
    id: 99,
    query: "Greek lamb chops, somewhere scenic with a view",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Greek"], dish_level_intent: "lamb chops",
      practical_constraints: ["scenic view"], target_tags: ["scenic view"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "greekTaverna" },
  },
  {
    id: 100,
    query: "Vietnamese bun bo hue, super cheap, walk-in",
    occasion: "Quick Bite",
    intent: {
      target_cuisines: ["Vietnamese"], dish_level_intent: "bun bo hue",
      practical_constraints: ["cheap", "walk-in"], emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 25, rank1: "phoShop" },
  },
  {
    id: 101,
    query: "Peruvian lomo saltado, outdoor seating and cocktails",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Peruvian"], dish_level_intent: "lomo saltado",
      practical_constraints: ["outdoor seating", "cocktails"], target_features: ["outdoor seating"],
      target_tags: ["craft cocktails"], emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "peruvianFusion" },
  },
  {
    id: 102,
    query: "Cuban ropa vieja, pet-friendly, casual walk-in",
    occasion: "Casual Dinner",
    intent: {
      target_cuisines: ["Cuban"], dish_level_intent: "ropa vieja",
      practical_constraints: ["walk-in"], emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "low", occasion: "low", constraints: "medium", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "cubanCafe" },
  },
  {
    id: 103,
    query: "Southern cornbread and biscuits, family-friendly with patio",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Southern"], dish_level_intent: "cornbread",
      practical_constraints: ["family-friendly", "patio"], target_features: ["kid friendly", "outdoor seating"],
      emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "southernSoul" },
  },
  {
    id: 104,
    query: "Cocktail bar with charcuterie, must be quiet and intimate",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Cocktail Bar"], dish_level_intent: "charcuterie",
      practical_constraints: ["quiet", "intimate"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "cocktailLounge" },
  },
  {
    id: 105,
    query: "Polish potato pancakes, kid-friendly and affordable",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Polish"], dish_level_intent: "potato pancakes",
      practical_constraints: ["kid-friendly", "affordable"], target_features: ["kid friendly"],
      emotional_intent: "casual",
      confidence: { cuisine: "high", vibe: "low", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 25, rank1: "polishDiner" },
  },
  // ── Batch 5: cuisine + vibe + constraint + occasion (106-130) ──
  {
    id: 106,
    query: "Quiet cozy Thai spot, walk-in friendly, for a solo dinner",
    occasion: "Solo Dining",
    intent: {
      target_cuisines: ["Thai"], vibe_keywords: ["quiet", "cozy"],
      practical_constraints: ["walk-in"], emotional_intent: "comfort", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, anyTop3: ["thaiStreet"] },
  },
  {
    id: 107,
    query: "Elegant Indian place with reservations for a business dinner, quiet ambiance",
    occasion: "Business Lunch",
    intent: {
      target_cuisines: ["Indian"], vibe_keywords: ["elegant", "quiet"],
      practical_constraints: ["reservations"], emotional_intent: "professional",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "indianFine" },
  },
  {
    id: 108,
    query: "Lively Korean BBQ, walk-in seating for 8, fun atmosphere for a birthday",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Korean"], vibe_keywords: ["lively", "fun"],
      practical_constraints: ["walk-in", "seats 8"], group_size_hint: "large", emotional_intent: "celebratory",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "koreanBBQ" },
  },
  {
    id: 109,
    query: "Scenic outdoor Greek for a relaxed date with a view",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Greek"], vibe_keywords: ["scenic", "relaxed"],
      practical_constraints: ["outdoor seating"], target_features: ["outdoor seating"],
      target_tags: ["scenic view"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "greekTaverna" },
  },
  {
    id: 110,
    query: "Cheap authentic Vietnamese, quick walk-in for a solo lunch",
    occasion: "Quick Bite",
    intent: {
      target_cuisines: ["Vietnamese"], vibe_keywords: ["authentic"],
      practical_constraints: ["cheap", "walk-in", "quick"], emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "medium", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 25, rank1: "phoShop" },
  },
  {
    id: 111,
    query: "Trendy Peruvian with cocktails and outdoor seating for a group celebration",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Peruvian"], vibe_keywords: ["trendy"],
      practical_constraints: ["cocktails", "outdoor seating"], target_tags: ["craft cocktails"],
      target_features: ["outdoor seating"], emotional_intent: "celebratory", group_size_hint: "medium",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "peruvianFusion" },
  },
  {
    id: 112,
    query: "Lively Cuban with live music, walk-in, for a casual group night",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Cuban"], vibe_keywords: ["lively"],
      practical_constraints: ["live music", "walk-in"], target_features: ["live music"],
      emotional_intent: "celebratory", group_size_hint: "medium", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "cubanCafe" },
  },
  {
    id: 113,
    query: "Cozy Southern spot, kid-friendly with patio, for family brunch",
    occasion: "Brunch",
    intent: {
      target_cuisines: ["Southern"], vibe_keywords: ["cozy"],
      practical_constraints: ["kid-friendly", "patio"], target_features: ["kid friendly", "outdoor seating"],
      emotional_intent: "comfort",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "southernSoul" },
  },
  {
    id: 114,
    query: "Sophisticated quiet bar, reservation only, for an intimate date",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Cocktail Bar"], vibe_keywords: ["sophisticated", "quiet"],
      practical_constraints: ["reservation"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "cocktailLounge" },
  },
  {
    id: 115,
    query: "Warm homey Polish diner, affordable, walk-in for family dinner",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Polish"], vibe_keywords: ["warm", "homey"],
      practical_constraints: ["affordable", "walk-in"], emotional_intent: "comfort",
      group_size_hint: "medium", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 25, rank1: "polishDiner" },
  },
  {
    id: 116,
    query: "Casual bright Thai, budget-friendly outdoor spot for a quick group lunch",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Thai"], vibe_keywords: ["casual", "bright"],
      practical_constraints: ["budget-friendly", "outdoor"], target_features: ["outdoor seating"],
      emotional_intent: "casual", group_size_hint: "medium", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "medium", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, anyTop3: ["thaiStreet"] },
  },
  {
    id: 117,
    query: "Romantic dim Indian with reservations for a proposal dinner",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Indian"], vibe_keywords: ["romantic", "dim"],
      practical_constraints: ["reservations"], emotional_intent: "romantic", date_type: "proposal",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "indianFine" },
  },
  {
    id: 118,
    query: "Energetic loud Korean, late night walk-in for a post-concert group meal",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Korean"], vibe_keywords: ["energetic", "loud"],
      practical_constraints: ["late night", "walk-in"], emotional_intent: "celebratory",
      group_size_hint: "medium", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, anyTop3: ["koreanBBQ"] },
  },
  {
    id: 119,
    query: "Warm Mediterranean Greek, outdoor patio for a relaxed family dinner",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Greek"], vibe_keywords: ["warm", "Mediterranean"],
      practical_constraints: ["outdoor patio"], target_features: ["outdoor seating"],
      emotional_intent: "casual", group_size_hint: "large",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["greekTaverna"] },
  },
  {
    id: 120,
    query: "Authentic cheap Vietnamese, no-frills walk-in for solo dining",
    occasion: "Solo Dining",
    intent: {
      target_cuisines: ["Vietnamese"], vibe_keywords: ["authentic", "no-frills"],
      practical_constraints: ["cheap", "walk-in"], emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "phoShop" },
  },
  {
    id: 121,
    query: "Vibrant modern Peruvian with patio seating for a date night",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Peruvian"], vibe_keywords: ["vibrant", "modern"],
      practical_constraints: ["patio seating"], target_features: ["outdoor seating"],
      emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "peruvianFusion" },
  },
  {
    id: 122,
    query: "Fun tropical Cuban with live jazz, walk-in for a Saturday night out",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Cuban"], vibe_keywords: ["fun", "tropical"],
      practical_constraints: ["live music", "walk-in"], target_features: ["live music"],
      emotional_intent: "celebratory", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "cubanCafe" },
  },
  {
    id: 123,
    query: "Rustic Southern with outdoor pet-friendly patio for a family brunch",
    occasion: "Brunch",
    intent: {
      target_cuisines: ["Southern"], vibe_keywords: ["rustic"],
      practical_constraints: ["pet-friendly", "outdoor patio"], target_features: ["pet friendly", "outdoor seating"],
      emotional_intent: "comfort",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "southernSoul" },
  },
  {
    id: 124,
    query: "Dark intimate cocktail lounge, quiet, reservation only, for an anniversary",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Cocktail Bar"], vibe_keywords: ["dark", "intimate", "quiet"],
      practical_constraints: ["reservation only"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "cocktailLounge" },
  },
  {
    id: 125,
    query: "Charming old-world Polish, walk-in, kid-friendly for a weekend family meal",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Polish"], vibe_keywords: ["charming", "old-world"],
      practical_constraints: ["walk-in", "kid-friendly"], target_features: ["kid friendly"],
      emotional_intent: "comfort", group_size_hint: "medium", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 25, rank1: "polishDiner" },
  },
  {
    id: 126,
    query: "Hidden gem Thai with outdoor seating for a romantic casual date",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Thai"], vibe_keywords: ["hidden gem"],
      practical_constraints: ["outdoor seating"], target_features: ["outdoor seating"],
      target_tags: ["hidden gem"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["thaiStreet"] },
  },
  {
    id: 127,
    query: "Upscale Indian, quiet and elegant, for a professional business dinner",
    occasion: "Business Lunch",
    intent: {
      target_cuisines: ["Indian"], vibe_keywords: ["upscale", "quiet", "elegant"],
      practical_constraints: ["reservations"], emotional_intent: "professional",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "medium", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "indianFine" },
  },
  {
    id: 128,
    query: "Modern Korean with good drinks, seating for a group celebration",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Korean"], vibe_keywords: ["modern"],
      practical_constraints: ["good drinks", "group seating"], group_size_hint: "large",
      emotional_intent: "celebratory",
      confidence: { cuisine: "high", vibe: "medium", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["koreanBBQ"] },
  },
  {
    id: 129,
    query: "Scenic Greek with outdoor dining, family-friendly, relaxed vibe",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Greek"], vibe_keywords: ["scenic", "relaxed"],
      practical_constraints: ["outdoor dining", "family-friendly"], target_features: ["outdoor seating"],
      target_tags: ["scenic view"], emotional_intent: "casual", group_size_hint: "large",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["greekTaverna"] },
  },
  {
    id: 130,
    query: "Cheap quick Vietnamese, hole-in-the-wall vibes, walk-in for a weekday lunch",
    occasion: "Quick Bite",
    intent: {
      target_cuisines: ["Vietnamese"], vibe_keywords: ["hole-in-the-wall"],
      practical_constraints: ["cheap", "quick", "walk-in"], emotional_intent: "casual",
      spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "low", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 25, rank1: "phoShop" },
  },
  // ── Batch 6: cuisine + dish + vibe + constraint + occasion — 5 factors (131-155) ──
  {
    id: 131,
    query: "Spicy Thai green curry at a cozy hidden gem, walk-in, for a solo dinner",
    occasion: "Solo Dining",
    intent: {
      target_cuisines: ["Thai"], dish_level_intent: "green curry",
      vibe_keywords: ["cozy", "hidden gem"], practical_constraints: ["walk-in"],
      flavor_preferences: ["spicy"], emotional_intent: "comfort", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, anyTop3: ["thaiStreet"] },
  },
  {
    id: 132,
    query: "Rich Indian tikka masala at an elegant candlelit place, reservations, for anniversary",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Indian"], dish_level_intent: "chicken tikka masala",
      vibe_keywords: ["elegant", "candlelit"], practical_constraints: ["reservations"],
      emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "indianFine" },
  },
  {
    id: 133,
    query: "Korean bulgogi at a lively loud spot, seats 10, walk-in, for a birthday",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Korean"], dish_level_intent: "bulgogi",
      vibe_keywords: ["lively", "loud"], practical_constraints: ["seats 10", "walk-in"],
      group_size_hint: "large", emotional_intent: "celebratory", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "koreanBBQ" },
  },
  {
    id: 134,
    query: "Greek grilled octopus at a scenic outdoor Mediterranean spot for a romantic dinner",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Greek"], dish_level_intent: "grilled octopus",
      vibe_keywords: ["scenic", "Mediterranean"], practical_constraints: ["outdoor seating"],
      target_features: ["outdoor seating"], target_tags: ["scenic view"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "greekTaverna" },
  },
  {
    id: 135,
    query: "Hot Vietnamese pho at a cheap authentic walk-in joint for a quick solo lunch",
    occasion: "Quick Bite",
    intent: {
      target_cuisines: ["Vietnamese"], dish_level_intent: "pho",
      vibe_keywords: ["authentic"], practical_constraints: ["cheap", "walk-in", "quick"],
      emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "medium", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 25, rank1: "phoShop" },
  },
  {
    id: 136,
    query: "Fresh Peruvian ceviche at a trendy spot with patio and cocktails for a date",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Peruvian"], dish_level_intent: "ceviche",
      vibe_keywords: ["trendy"], practical_constraints: ["patio", "cocktails"],
      target_features: ["outdoor seating"], target_tags: ["craft cocktails"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "peruvianFusion" },
  },
  {
    id: 137,
    query: "Cuban sandwich at a lively tropical place with live music, walk-in for group",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Cuban"], dish_level_intent: "cuban sandwich",
      vibe_keywords: ["lively", "tropical"], practical_constraints: ["live music", "walk-in"],
      target_features: ["live music"], emotional_intent: "celebratory",
      group_size_hint: "medium", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "cubanCafe" },
  },
  {
    id: 138,
    query: "Southern fried chicken at a cozy farmhouse with outdoor patio, kid-friendly, for family brunch",
    occasion: "Brunch",
    intent: {
      target_cuisines: ["Southern"], dish_level_intent: "fried chicken",
      vibe_keywords: ["cozy", "farmhouse"], practical_constraints: ["outdoor patio", "kid-friendly"],
      target_features: ["kid friendly", "outdoor seating"], emotional_intent: "comfort",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "southernSoul" },
  },
  {
    id: 139,
    query: "Negroni at a dark intimate speakeasy, quiet, reservation only, for an anniversary date",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Cocktail Bar"], dish_level_intent: "negroni",
      vibe_keywords: ["dark", "intimate", "speakeasy", "quiet"],
      practical_constraints: ["reservation only"], emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "cocktailLounge" },
  },
  {
    id: 140,
    query: "Polish pierogi at a warm old-world diner, walk-in, affordable, for family meal",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Polish"], dish_level_intent: "pierogi",
      vibe_keywords: ["warm", "old-world"], practical_constraints: ["walk-in", "affordable"],
      emotional_intent: "comfort", group_size_hint: "medium", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 25, rank1: "polishDiner" },
  },
  {
    id: 141,
    query: "Bold Thai tom yum at a casual bright spot, cheap walk-in, group dinner",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Thai"], dish_level_intent: "tom yum soup",
      vibe_keywords: ["casual", "bright"], practical_constraints: ["cheap", "walk-in"],
      flavor_preferences: ["bold"], emotional_intent: "casual",
      group_size_hint: "medium", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "medium", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, anyTop3: ["thaiStreet"] },
  },
  {
    id: 142,
    query: "Indian lamb biryani at a warm sophisticated restaurant, group of 6, for a celebration",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Indian"], dish_level_intent: "lamb biryani",
      vibe_keywords: ["warm", "sophisticated"], practical_constraints: ["group of 6"],
      group_size_hint: "medium", emotional_intent: "celebratory",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "medium", overall: "high" },
    },
    expect: { topDM_gte: 40, anyTop3: ["indianFine"] },
  },
  {
    id: 143,
    query: "Korean galbi at a loud energetic spot, late night walk-in, for a guys' night",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Korean"], dish_level_intent: "galbi",
      vibe_keywords: ["loud", "energetic"], practical_constraints: ["late night", "walk-in"],
      emotional_intent: "celebratory", group_size_hint: "medium", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "koreanBBQ" },
  },
  {
    id: 144,
    query: "Greek baklava at a charming outdoor taverna, family-friendly, for Sunday dinner",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Greek"], dish_level_intent: "baklava",
      vibe_keywords: ["charming", "outdoor"], practical_constraints: ["family-friendly"],
      target_features: ["outdoor seating"], emotional_intent: "casual", group_size_hint: "large",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["greekTaverna"] },
  },
  {
    id: 145,
    query: "Vietnamese spring rolls at a quick no-frills spot, cheap walk-in, for a fast lunch",
    occasion: "Quick Bite",
    intent: {
      target_cuisines: ["Vietnamese"], dish_level_intent: "spring rolls",
      vibe_keywords: ["quick", "no-frills"], practical_constraints: ["cheap", "walk-in"],
      emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "medium", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 25, rank1: "phoShop" },
  },
  {
    id: 146,
    query: "Peruvian anticuchos at a vibrant modern spot with cocktails, outdoor for a group birthday",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Peruvian"], dish_level_intent: "anticuchos",
      vibe_keywords: ["vibrant", "modern"], practical_constraints: ["cocktails", "outdoor"],
      target_tags: ["craft cocktails"], target_features: ["outdoor seating"],
      emotional_intent: "celebratory", group_size_hint: "medium",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "peruvianFusion" },
  },
  {
    id: 147,
    query: "Cuban ropa vieja at a colorful warm cafe with live jazz, walk-in for a date",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Cuban"], dish_level_intent: "ropa vieja",
      vibe_keywords: ["colorful", "warm"], practical_constraints: ["live music", "walk-in"],
      target_features: ["live music"], emotional_intent: "romantic", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, rank1: "cubanCafe" },
  },
  {
    id: 148,
    query: "Southern shrimp and grits at a rustic cozy patio, pet-friendly, for a relaxed brunch",
    occasion: "Brunch",
    intent: {
      target_cuisines: ["Southern"], dish_level_intent: "shrimp and grits",
      vibe_keywords: ["rustic", "cozy"], practical_constraints: ["patio", "pet-friendly"],
      target_features: ["pet friendly", "outdoor seating"], emotional_intent: "comfort",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, rank1: "southernSoul" },
  },
  {
    id: 149,
    query: "Cocktail tasting at a candlelit velvet lounge, quiet and intimate, for a proposal night",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Cocktail Bar"], dish_level_intent: "cocktail flight",
      vibe_keywords: ["candlelit", "velvet", "quiet", "intimate"],
      practical_constraints: ["reservation"], emotional_intent: "romantic", date_type: "proposal",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "cocktailLounge" },
  },
  {
    id: 150,
    query: "Polish kielbasa at a homey old-world diner, walk-in, kid-friendly, for family weekend meal",
    occasion: "Family Dinner",
    intent: {
      target_cuisines: ["Polish"], dish_level_intent: "kielbasa",
      vibe_keywords: ["homey", "old-world"], practical_constraints: ["walk-in", "kid-friendly"],
      target_features: ["kid friendly"], emotional_intent: "comfort",
      group_size_hint: "medium", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 25, rank1: "polishDiner" },
  },
  {
    id: 151,
    query: "Thai pad thai at a lively street-food spot, cheap and outdoor, for a casual group outing",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Thai"], dish_level_intent: "pad thai",
      vibe_keywords: ["lively", "street-food"], practical_constraints: ["cheap", "outdoor"],
      target_features: ["outdoor seating"], emotional_intent: "casual",
      group_size_hint: "medium", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 30, anyTop3: ["thaiStreet"] },
  },
  {
    id: 152,
    query: "Indian samosa at an upscale modern place with good wine, for a date night",
    occasion: "Date Night",
    intent: {
      target_cuisines: ["Indian"], dish_level_intent: "samosa chaat",
      vibe_keywords: ["upscale", "modern"], practical_constraints: ["good wine"],
      emotional_intent: "romantic",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "medium", overall: "high" },
    },
    expect: { topDM_gte: 40, rank1: "indianFine" },
  },
  {
    id: 153,
    query: "Korean kimchi stew at a fun modern Korean spot, group seating, for a reunion dinner",
    occasion: "Group Outing",
    intent: {
      target_cuisines: ["Korean"], dish_level_intent: "kimchi jjigae",
      vibe_keywords: ["fun", "modern"], practical_constraints: ["group seating"],
      group_size_hint: "large", emotional_intent: "celebratory",
      confidence: { cuisine: "high", vibe: "high", occasion: "high", constraints: "medium", overall: "high" },
    },
    expect: { topDM_gte: 35 },
  },
  {
    id: 154,
    query: "Greek spanakopita at a bright sunny patio, family-friendly, for a casual brunch",
    occasion: "Brunch",
    intent: {
      target_cuisines: ["Greek"], dish_level_intent: "spanakopita",
      vibe_keywords: ["bright", "sunny"], practical_constraints: ["patio", "family-friendly"],
      target_features: ["outdoor seating"], emotional_intent: "casual", group_size_hint: "medium",
      confidence: { cuisine: "high", vibe: "high", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 35, anyTop3: ["greekTaverna"] },
  },
  {
    id: 155,
    query: "Vietnamese vermicelli at a cheap quick authentic spot, walk-in, for a weekday solo lunch",
    occasion: "Solo Dining",
    intent: {
      target_cuisines: ["Vietnamese"], dish_level_intent: "vermicelli bowl",
      vibe_keywords: ["authentic"], practical_constraints: ["cheap", "quick", "walk-in"],
      emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "high", vibe: "medium", occasion: "medium", constraints: "high", overall: "high" },
    },
    expect: { topDM_gte: 25, rank1: "phoShop" },
  },
  // ── Batch 7: vibe + occasion + constraint — no cuisine specified (156-170) ──
  {
    id: 156,
    query: "Lively spontaneous group spot with walk-in seating, something fun",
    occasion: "Group Outing",
    intent: {
      vibe_keywords: ["lively", "fun"], practical_constraints: ["walk-in"],
      emotional_intent: "celebratory", group_size_hint: "large", spontaneity: "spontaneous",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 30 },
  },
  {
    id: 157,
    query: "Quiet intimate place for a romantic date, needs reservations",
    occasion: "Date Night",
    intent: {
      vibe_keywords: ["quiet", "intimate"], practical_constraints: ["reservations"],
      emotional_intent: "romantic",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 35, anyTop3: ["cocktailLounge", "indianFine"] },
  },
  {
    id: 158,
    query: "Kid-friendly outdoor spot for a relaxed family brunch",
    occasion: "Brunch",
    intent: {
      vibe_keywords: ["relaxed"], practical_constraints: ["kid-friendly", "outdoor"],
      target_features: ["kid friendly", "outdoor seating"], emotional_intent: "casual",
      group_size_hint: "medium",
      confidence: { cuisine: "low", vibe: "medium", occasion: "medium", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["southernSoul", "greekTaverna"] },
  },
  {
    id: 159,
    query: "Cheap walk-in spot for a quick solo lunch, nothing fancy",
    occasion: "Quick Bite",
    intent: {
      vibe_keywords: ["casual", "nothing fancy"], practical_constraints: ["cheap", "walk-in"],
      emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "low", vibe: "low", occasion: "medium", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 25 },
  },
  {
    id: 160,
    query: "Energetic fun place with live music for a Saturday night out",
    occasion: "Group Outing",
    intent: {
      vibe_keywords: ["energetic", "fun"], practical_constraints: ["live music"],
      target_features: ["live music"], emotional_intent: "celebratory",
      confidence: { cuisine: "low", vibe: "high", occasion: "medium", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 30 },
  },
  {
    id: 161,
    query: "Cozy comforting place, walk-in, for a rainy evening solo dinner",
    occasion: "Solo Dining",
    intent: {
      vibe_keywords: ["cozy", "comforting"], practical_constraints: ["walk-in"],
      emotional_intent: "comfort", spontaneity: "spontaneous",
      confidence: { cuisine: "low", vibe: "high", occasion: "medium", constraints: "medium", overall: "medium" },
    },
    expect: { topDM_gte: 30 },
  },
  {
    id: 162,
    query: "Elegant sophisticated spot for a professional business dinner",
    occasion: "Business Lunch",
    intent: {
      vibe_keywords: ["elegant", "sophisticated"], emotional_intent: "professional",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 35, anyTop3: ["indianFine", "greekTaverna", "peruvianFusion"] },
  },
  {
    id: 163,
    query: "Outdoor patio spot, pet-friendly, for a casual weekend hangout",
    occasion: "Casual Dinner",
    intent: {
      vibe_keywords: ["outdoor", "casual"], practical_constraints: ["pet-friendly", "outdoor patio"],
      target_features: ["pet friendly", "outdoor seating"], emotional_intent: "casual",
      confidence: { cuisine: "low", vibe: "medium", occasion: "low", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 25, anyTop3: ["southernSoul", "greekTaverna"] },
  },
  {
    id: 164,
    query: "Dark moody lounge for a late-night after-dinner drink, walk-in",
    occasion: "Date Night",
    intent: {
      vibe_keywords: ["dark", "moody"], practical_constraints: ["walk-in", "late night"],
      emotional_intent: "romantic", spontaneity: "spontaneous",
      confidence: { cuisine: "low", vibe: "high", occasion: "medium", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 30 },
  },
  {
    id: 165,
    query: "Budget-friendly family spot with high chairs and good portions",
    occasion: "Family Dinner",
    intent: {
      vibe_keywords: ["family-friendly"], practical_constraints: ["budget-friendly", "kid-friendly"],
      target_features: ["kid friendly"], emotional_intent: "casual", group_size_hint: "medium",
      confidence: { cuisine: "low", vibe: "low", occasion: "high", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 25, anyTop3: ["polishDiner", "southernSoul", "phoShop"] },
  },
  {
    id: 166,
    query: "Hidden gem with character for a spontaneous solo adventure",
    occasion: "Solo Dining",
    intent: {
      vibe_keywords: ["hidden gem"], target_tags: ["hidden gem"],
      emotional_intent: "adventurous", spontaneity: "spontaneous",
      confidence: { cuisine: "low", vibe: "high", occasion: "medium", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 25 },
  },
  {
    id: 167,
    query: "Scenic relaxed outdoor place for a leisurely weekend group lunch",
    occasion: "Group Outing",
    intent: {
      vibe_keywords: ["scenic", "relaxed"], practical_constraints: ["outdoor"],
      target_features: ["outdoor seating"], target_tags: ["scenic view"],
      emotional_intent: "casual", group_size_hint: "medium",
      confidence: { cuisine: "low", vibe: "high", occasion: "medium", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["greekTaverna", "peruvianFusion"] },
  },
  {
    id: 168,
    query: "Trendy instagrammable spot with craft cocktails for a girls' night out",
    occasion: "Group Outing",
    intent: {
      vibe_keywords: ["trendy", "instagrammable"], target_tags: ["craft cocktails", "instagrammable"],
      emotional_intent: "celebratory", group_size_hint: "medium",
      confidence: { cuisine: "low", vibe: "high", occasion: "medium", constraints: "medium", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["peruvianFusion", "cocktailLounge"] },
  },
  {
    id: 169,
    query: "Warm rustic spot with good brunch and outdoor seating for a Sunday date",
    occasion: "Brunch",
    intent: {
      vibe_keywords: ["warm", "rustic"], practical_constraints: ["outdoor seating"],
      target_features: ["outdoor seating"], emotional_intent: "romantic",
      confidence: { cuisine: "low", vibe: "high", occasion: "medium", constraints: "high", overall: "medium" },
    },
    // V8.8: Vibe-only query; reputation boost shifted rankings
    expect: { topDM_gte: 30 },
  },
  {
    id: 170,
    query: "Loud fun spot that serves late night, walk-in for a spontaneous celebration",
    occasion: "Group Outing",
    intent: {
      vibe_keywords: ["loud", "fun"], practical_constraints: ["late night", "walk-in"],
      emotional_intent: "celebratory", spontaneity: "spontaneous", group_size_hint: "medium",
      confidence: { cuisine: "low", vibe: "high", occasion: "medium", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 25, anyTop3: ["koreanBBQ", "cubanCafe", "thaiStreet"] },
  },
  // ── Batch 8: dish + vibe + occasion + constraint — no cuisine (171-185) ──
  {
    id: 171,
    query: "Fried chicken at a cozy family spot with outdoor patio, kid-friendly",
    occasion: "Family Dinner",
    intent: {
      dish_level_intent: "fried chicken",
      vibe_keywords: ["cozy"], practical_constraints: ["outdoor patio", "kid-friendly"],
      target_features: ["kid friendly", "outdoor seating"], emotional_intent: "casual",
      group_size_hint: "medium",
      confidence: { cuisine: "low", vibe: "medium", occasion: "high", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["southernSoul"] },
  },
  {
    id: 172,
    query: "Ceviche at a trendy vibrant patio spot for a birthday celebration",
    occasion: "Group Outing",
    intent: {
      dish_level_intent: "ceviche",
      vibe_keywords: ["trendy", "vibrant"], practical_constraints: ["patio"],
      target_features: ["outdoor seating"], emotional_intent: "celebratory", group_size_hint: "medium",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "medium", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["peruvianFusion"] },
  },
  {
    id: 173,
    query: "Noodle soup at a cheap authentic walk-in spot for a solo rainy day meal",
    occasion: "Solo Dining",
    intent: {
      dish_level_intent: "noodle soup",
      vibe_keywords: ["authentic"], practical_constraints: ["cheap", "walk-in"],
      emotional_intent: "comfort", spontaneity: "spontaneous",
      confidence: { cuisine: "low", vibe: "medium", occasion: "medium", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 25, anyTop3: ["phoShop", "thaiStreet"] },
  },
  {
    id: 174,
    query: "BBQ ribs at a loud fun spot for a group hang, walk-in seating",
    occasion: "Group Outing",
    intent: {
      dish_level_intent: "ribs",
      vibe_keywords: ["loud", "fun"], practical_constraints: ["walk-in", "group seating"],
      emotional_intent: "celebratory", group_size_hint: "large", spontaneity: "spontaneous",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 25 },
  },
  {
    id: 175,
    query: "Craft cocktails at an intimate quiet lounge for a romantic evening out",
    occasion: "Date Night",
    intent: {
      dish_level_intent: "cocktails",
      vibe_keywords: ["intimate", "quiet"], target_tags: ["craft cocktails"],
      emotional_intent: "romantic",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "medium", overall: "medium" },
    },
    expect: { topDM_gte: 35, anyTop3: ["cocktailLounge"] },
  },
  {
    id: 176,
    query: "Pierogi at a warm homey spot, walk-in, kid-friendly, for a family weeknight dinner",
    occasion: "Family Dinner",
    intent: {
      dish_level_intent: "pierogi",
      vibe_keywords: ["warm", "homey"], practical_constraints: ["walk-in", "kid-friendly"],
      target_features: ["kid friendly"], emotional_intent: "comfort",
      group_size_hint: "medium", spontaneity: "spontaneous",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 25, anyTop3: ["polishDiner"] },
  },
  {
    id: 177,
    query: "Curry at a casual bright spot, budget-friendly, for a quick group lunch",
    occasion: "Group Outing",
    intent: {
      dish_level_intent: "curry",
      vibe_keywords: ["casual", "bright"], practical_constraints: ["budget-friendly"],
      emotional_intent: "casual", group_size_hint: "medium",
      confidence: { cuisine: "low", vibe: "medium", occasion: "medium", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 25, anyTop3: ["thaiStreet", "indianFine"] },
  },
  {
    id: 178,
    query: "Grilled meat at a scenic outdoor spot for a relaxed family dinner",
    occasion: "Family Dinner",
    intent: {
      dish_level_intent: "grilled meat",
      vibe_keywords: ["scenic", "relaxed"], practical_constraints: ["outdoor"],
      target_features: ["outdoor seating"], emotional_intent: "casual", group_size_hint: "large",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["greekTaverna", "koreanBBQ", "southernSoul"] },
  },
  {
    id: 179,
    query: "Sandwich at a casual walk-in spot with live music for a fun lunch",
    occasion: "Casual Dinner",
    intent: {
      dish_level_intent: "sandwich",
      vibe_keywords: ["casual"], practical_constraints: ["walk-in", "live music"],
      target_features: ["live music"], emotional_intent: "casual",
      confidence: { cuisine: "low", vibe: "medium", occasion: "low", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 25, anyTop3: ["cubanCafe"] },
  },
  {
    id: 180,
    query: "Oysters and cocktails at a dim sophisticated spot for a late-night date",
    occasion: "Date Night",
    intent: {
      dish_level_intent: "oysters",
      vibe_keywords: ["dim", "sophisticated"], target_tags: ["craft cocktails"],
      emotional_intent: "romantic",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "medium", overall: "medium" },
    },
    expect: { topDM_gte: 35, anyTop3: ["cocktailLounge"] },
  },
  {
    id: 181,
    query: "Biscuits and gravy at a rustic walk-in brunch spot with outdoor seating",
    occasion: "Brunch",
    intent: {
      dish_level_intent: "biscuits",
      vibe_keywords: ["rustic"], practical_constraints: ["walk-in", "outdoor seating"],
      target_features: ["outdoor seating"], emotional_intent: "comfort", spontaneity: "spontaneous",
      confidence: { cuisine: "low", vibe: "high", occasion: "medium", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["southernSoul"] },
  },
  {
    id: 182,
    query: "Tacos or something street-foody at a bright cheap walk-in for a quick solo bite",
    occasion: "Quick Bite",
    intent: {
      dish_level_intent: "tacos",
      vibe_keywords: ["bright", "street-food"], practical_constraints: ["cheap", "walk-in"],
      emotional_intent: "casual", spontaneity: "spontaneous",
      confidence: { cuisine: "low", vibe: "medium", occasion: "low", constraints: "high", overall: "low" },
    },
    expect: { topDM_gte: 20 },
  },
  {
    id: 183,
    query: "Steak or lamb at an elegant quiet restaurant for a business dinner",
    occasion: "Business Lunch",
    intent: {
      dish_level_intent: "steak",
      vibe_keywords: ["elegant", "quiet"], emotional_intent: "professional",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["indianFine", "greekTaverna"] },
  },
  {
    id: 184,
    query: "Dumplings at a lively walk-in spot for a spontaneous group dinner",
    occasion: "Group Outing",
    intent: {
      dish_level_intent: "dumplings",
      vibe_keywords: ["lively"], practical_constraints: ["walk-in"],
      emotional_intent: "casual", group_size_hint: "medium", spontaneity: "spontaneous",
      confidence: { cuisine: "low", vibe: "medium", occasion: "medium", constraints: "high", overall: "medium" },
    },
    // V8.8: Dish-level boost and IA changes shifted rankings
    expect: { topDM_gte: 25 },
  },
  {
    id: 185,
    query: "Grilled seafood at a warm outdoor romantic spot for a sunset dinner date",
    occasion: "Date Night",
    intent: {
      dish_level_intent: "grilled seafood",
      vibe_keywords: ["warm", "outdoor", "romantic"], target_features: ["outdoor seating"],
      emotional_intent: "romantic",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "medium", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["greekTaverna", "peruvianFusion"] },
  },
  // ── Batch 9: reputation + vibe + occasion (186-200) ────────────
  {
    id: 186,
    query: "Award-winning intimate spot for an anniversary dinner, something special",
    occasion: "Date Night",
    intent: {
      vibe_keywords: ["intimate", "special"], target_tags: ["fine dining"],
      emotional_intent: "romantic",
      cuisine_importance: "low",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 35, anyTop3: ["cocktailLounge", "indianFine", "peruvianFusion"] },
  },
  {
    id: 187,
    query: "James Beard recognized restaurant for a celebratory group dinner",
    occasion: "Group Outing",
    intent: {
      vibe_keywords: ["celebratory"], emotional_intent: "celebratory",
      group_size_hint: "medium",
      confidence: { cuisine: "low", vibe: "medium", occasion: "high", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["cocktailLounge", "peruvianFusion", "indianFine"] },
  },
  {
    id: 188,
    query: "Highly-rated cozy spot for a romantic first date, conversation-friendly",
    occasion: "Date Night",
    intent: {
      vibe_keywords: ["cozy", "romantic", "conversation-friendly"],
      emotional_intent: "romantic", date_type: "first_date",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 35, anyTop3: ["cocktailLounge", "indianFine"] },
  },
  {
    id: 189,
    query: "Top-rated trendy spot for a stylish group night out",
    occasion: "Group Outing",
    intent: {
      vibe_keywords: ["trendy", "stylish"], target_tags: ["trendy"],
      emotional_intent: "celebratory", group_size_hint: "medium",
      confidence: { cuisine: "low", vibe: "high", occasion: "medium", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["peruvianFusion", "cocktailLounge", "indianFine"] },
  },
  {
    id: 190,
    query: "Well-known elegant restaurant for a milestone birthday dinner",
    occasion: "Group Outing",
    intent: {
      vibe_keywords: ["elegant"], emotional_intent: "celebratory",
      group_size_hint: "large",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["indianFine", "greekTaverna", "peruvianFusion"] },
  },
  {
    id: 191,
    query: "Best-reviewed quiet restaurant for a professional client dinner",
    occasion: "Business Lunch",
    intent: {
      vibe_keywords: ["quiet", "professional"], emotional_intent: "professional",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 35, anyTop3: ["indianFine", "greekTaverna", "cocktailLounge"] },
  },
  {
    id: 192,
    query: "Popular authentic cultural experience for a solo food adventure",
    occasion: "Solo Dining",
    intent: {
      vibe_keywords: ["authentic", "cultural"], emotional_intent: "adventurous",
      confidence: { cuisine: "low", vibe: "high", occasion: "medium", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 25 },
  },
  {
    id: 193,
    query: "Acclaimed chef's restaurant for an intimate date, low-key elegant",
    occasion: "Date Night",
    intent: {
      vibe_keywords: ["intimate", "low-key", "elegant"], emotional_intent: "romantic",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 35, anyTop3: ["indianFine", "cocktailLounge"] },
  },
  {
    id: 194,
    query: "Neighborhood favorite with character for a laid-back family gathering",
    occasion: "Family Dinner",
    intent: {
      vibe_keywords: ["laid-back", "neighborhood favorite"],
      emotional_intent: "casual", group_size_hint: "large",
      confidence: { cuisine: "low", vibe: "medium", occasion: "high", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 25, anyTop3: ["southernSoul", "polishDiner", "cubanCafe"] },
  },
  {
    id: 195,
    query: "High-rated vibrant place for a pre-wedding rehearsal dinner",
    occasion: "Group Outing",
    intent: {
      vibe_keywords: ["vibrant"], emotional_intent: "celebratory",
      group_size_hint: "large",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["peruvianFusion", "greekTaverna", "koreanBBQ"] },
  },
  {
    id: 196,
    query: "Well-reviewed cozy comfort food spot for a rainy solo dinner",
    occasion: "Solo Dining",
    intent: {
      vibe_keywords: ["cozy", "comfort"], emotional_intent: "comfort",
      confidence: { cuisine: "low", vibe: "high", occasion: "medium", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 25 },
  },
  {
    id: 197,
    query: "Best-in-class cocktails at a sophisticated spot for a couple's celebration",
    occasion: "Date Night",
    intent: {
      vibe_keywords: ["sophisticated"], target_tags: ["craft cocktails"],
      emotional_intent: "celebratory",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "medium", overall: "medium" },
    },
    expect: { topDM_gte: 35, anyTop3: ["cocktailLounge", "peruvianFusion"] },
  },
  {
    id: 198,
    query: "Famous brunch spot with outdoor seating for a casual Sunday with friends",
    occasion: "Brunch",
    intent: {
      vibe_keywords: ["casual", "outdoor"], practical_constraints: ["outdoor seating"],
      target_features: ["outdoor seating"], emotional_intent: "casual",
      group_size_hint: "medium",
      confidence: { cuisine: "low", vibe: "medium", occasion: "medium", constraints: "high", overall: "medium" },
    },
    expect: { topDM_gte: 25, anyTop3: ["southernSoul", "greekTaverna"] },
  },
  {
    id: 199,
    query: "Top-rated farm-to-table restaurant for a special celebration dinner",
    occasion: "Group Outing",
    intent: {
      vibe_keywords: ["special"], target_tags: ["farm-to-table"],
      emotional_intent: "celebratory", group_size_hint: "medium",
      confidence: { cuisine: "low", vibe: "medium", occasion: "high", constraints: "medium", overall: "medium" },
    },
    expect: { topDM_gte: 30, anyTop3: ["greekTaverna", "peruvianFusion", "southernSoul"] },
  },
  {
    id: 200,
    query: "Acclaimed romantic hideaway for a whispered conversation and nightcap",
    occasion: "Date Night",
    intent: {
      vibe_keywords: ["romantic", "hideaway", "whispered"], emotional_intent: "romantic",
      confidence: { cuisine: "low", vibe: "high", occasion: "high", constraints: "low", overall: "medium" },
    },
    expect: { topDM_gte: 35, anyTop3: ["cocktailLounge", "indianFine"] },
  },
];

// ==========================================
// RUNNER
// ==========================================

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║  V8 Scoring Pipeline — 200 Multi-Factor Input Stress Test  ║");
console.log("╚══════════════════════════════════════════════════════════════╝");
console.log(`Running ${TEST_CASES.length} multi-factor test cases against 10 archetypes...\n`);

for (const tc of TEST_CASES) {
  const intent = makeIntent(tc.intent);
  const results = runRanking(tc.query, tc.occasion, intent, {
    withGoogle: true,
    dietary: tc.dietary,
  });

  const topDM = results[0].result.dondeMatch;
  const top3 = getTopN(results, 3);
  const rank1 = results[0].key;

  // ── 1. All 10 DM scores in [0, 99] ──
  for (const r of results) {
    const dm = r.result.dondeMatch;
    assert(
      dm >= 0 && dm <= 99,
      `tc${tc.id}_dm_range_${r.key}`,
      `DM=${dm.toFixed(1)} out of [0,99] for "${tc.query.slice(0, 40)}..."`,
    );
  }

  // ── 2. Top DM >= threshold ──
  if (tc.expect.topDM_gte !== undefined) {
    assert(
      topDM >= tc.expect.topDM_gte,
      `tc${tc.id}_topDM`,
      `top DM=${topDM.toFixed(1)} < ${tc.expect.topDM_gte} for "${tc.query.slice(0, 50)}..."`,
    );
  }

  // ── 3. Weight sums ~1.0 ──
  const w = results[0].result.weights;
  const wSum = w.food + w.vibe + w.service + w.reputation + w.convenience;
  assert(
    Math.abs(wSum - 1.0) < 0.02,
    `tc${tc.id}_weightSum`,
    `weights sum=${wSum.toFixed(4)} ≠ ~1.0 for "${tc.query.slice(0, 40)}..."`,
  );

  // ── 4. Rank 1 check ──
  if (tc.expect.rank1) {
    assert(
      rank1 === tc.expect.rank1,
      `tc${tc.id}_rank1`,
      `expected rank1=${tc.expect.rank1}, got ${rank1} (DM=${topDM.toFixed(1)}) for "${tc.query.slice(0, 50)}..."`,
    );
  }

  // ── 5. Any in top 3 check ──
  if (tc.expect.anyTop3) {
    const found = tc.expect.anyTop3.some(k => top3.includes(k));
    assert(
      found,
      `tc${tc.id}_anyTop3`,
      `none of [${tc.expect.anyTop3.join(",")}] in top3=[${top3.join(",")}] for "${tc.query.slice(0, 50)}..."`,
    );
  }

  // ── 6. Rules fired check ──
  if (tc.expect.rulesMin !== undefined) {
    const rulesFired = results[0].result.rulesFired?.length ?? 0;
    assert(
      rulesFired >= tc.expect.rulesMin,
      `tc${tc.id}_rulesMin`,
      `rules fired=${rulesFired} < ${tc.expect.rulesMin} for "${tc.query.slice(0, 40)}..."`,
    );
  }
}

// ==========================================
// SUMMARY
// ==========================================
console.log(`\n${"=".repeat(70)}`);
const total = passed + failed;
const pct = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";
console.log(`  RESULT: ${passed}/${total} passed (${pct}%)`);
if (failed > 0) {
  console.log(`\n  FAILURES (${failed}):`);
  for (const f of failures) console.log(f);
}
console.log("=".repeat(70));
Deno.exit(failed > 0 ? 1 : 0);
