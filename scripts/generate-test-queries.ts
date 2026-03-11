#!/usr/bin/env npx tsx
/**
 * DondeAI Test Query Generator
 * Generates 100 diverse, persona-driven test queries per invocation.
 * Appends to tests/generated-queries.json with full distribution tracking.
 *
 * Usage: cd scripts && npx tsx generate-test-queries.ts
 * Options: COUNT=50 npx tsx generate-test-queries.ts  (override count)
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Constants & dimension pools
// ---------------------------------------------------------------------------

const BATCH_SIZE = parseInt(process.env.COUNT ?? "100", 10);
const OUTPUT = resolve(import.meta.dirname ?? ".", "../tests/generated-queries.json");

const AGE_GROUPS = [
  "college_student",
  "young_professional",
  "mid_career",
  "family_parent",
  "empty_nester",
  "retiree",
] as const;

const GENDERS = ["male", "female", "non_binary"] as const;
const GENDER_WEIGHTS = [0.41, 0.41, 0.18]; // ~450/450/100 over 1000

const CULTURES = [
  "Mexican-American",
  "Polish-American",
  "Chinese-American",
  "Indian-American",
  "Korean-American",
  "African-American",
  "Irish-American",
  "Italian-American",
  "Filipino-American",
  "Puerto-Rican",
  "Middle-Eastern",
  "Eastern-European",
  "Japanese-American",
  "Vietnamese-American",
  "Caribbean-American",
  "mainstream-American",
  "mixed-multicultural",
] as const;

const RELIGIONS = [
  "none",
  "Christian",
  "Catholic",
  "Muslim",
  "Jewish",
  "Hindu",
  "Buddhist",
  "Sikh",
] as const;

const TIMES = ["breakfast", "lunch", "dinner", "late_night"] as const;

const OCCASIONS = [
  "Any",
  "Date Night",
  "Group Hangout",
  "Family Dinner",
  "Business Lunch",
  "Solo Dining",
  "Special Occasion",
  "Treat Myself",
  "Adventure",
  "Chill Hangout",
] as const;

const CATEGORIES = [
  "Cuisine",
  "Dish",
  "Vibe",
  "Multi",
  "Discovery",
  "Contextual",
  "Reputation",
  "Constraints",
  "Niche",
  "Complex",
] as const;

const CATEGORY_THRESHOLDS: Record<string, number> = {
  Cuisine: 55, Dish: 55, Vibe: 50, Multi: 45, Discovery: 40,
  Contextual: 45, Reputation: 55, Constraints: 45, Niche: 35, Complex: 40,
};

const NEIGHBORHOODS = [
  "The Loop", "River North", "Streeterville", "West Loop", "Lincoln Park",
  "Lakeview", "Wicker Park", "Logan Square", "Pilsen", "Chinatown",
  "South Loop", "Hyde Park", "Edgewater", "Lincoln Square", "Andersonville",
  "Uptown", "Rogers Park", "Gold Coast", "Ukrainian Village", "Bucktown",
  "North Center", "Avondale", "Humboldt Park", "Little Village", "Bridgeport",
  "Irving Park", "Portage Park", "Albany Park", "Anywhere",
] as const;

const PRICES = ["$", "$$", "$$$", "$$$$", "Any"] as const;
const DIETARY = ["vegetarian", "vegan", "gluten_free", "halal", "kosher"] as const;

// ---------------------------------------------------------------------------
// Query templates — grouped by category. Each template is a function that
// takes a persona and returns { special_request, expected_cuisines, notes }.
// We have ~15-20 templates per category = 150+ total to ensure no repeats.
// ---------------------------------------------------------------------------

type Persona = {
  age_group: string;
  gender: string;
  cultural_background: string;
  religion: string;
};

type QueryTemplate = (p: Persona) => {
  sr: string;
  cuisines: string;
  notes: string;
  neighborhood?: string;
  price?: string;
  dietary?: string[];
  occasion?: string;
  time?: string;
};

const CUISINE_TEMPLATES: QueryTemplate[] = [
  () => ({ sr: "thai food, something spicy", cuisines: "Thai", notes: "Direct cuisine + flavor preference" }),
  () => ({ sr: "indian restaurant, not a buffet", cuisines: "Indian", notes: "Cuisine + negative constraint" }),
  () => ({ sr: "ethiopian food", cuisines: "Ethiopian", notes: "Clean direct cuisine search" }),
  () => ({ sr: "good greek food around here", cuisines: "Greek", notes: "Casual tone, no specific dish" }),
  () => ({ sr: "korean bbq spot", cuisines: "Korean", notes: "Cuisine with format specifier", neighborhood: "Albany Park" }),
  () => ({ sr: "legit mexican food, not tex-mex", cuisines: "Mexican", notes: "Authenticity qualifier" }),
  () => ({ sr: "japanese food tonight", cuisines: "Japanese", notes: "Cuisine + time context" }),
  () => ({ sr: "southern comfort food", cuisines: "Southern|Soul Food", notes: "Regional cuisine style" }),
  () => ({ sr: "french bistro vibes", cuisines: "French", notes: "Cuisine + vibe crossover" }),
  () => ({ sr: "szechuan chinese, the spicier the better", cuisines: "Chinese|Szechuan", notes: "Sub-cuisine specificity + preference" }),
  () => ({ sr: "turkish food, kebabs and stuff", cuisines: "Turkish|Middle Eastern", notes: "Cuisine + vague dish reference" }),
  () => ({ sr: "cuban restaurant", cuisines: "Cuban|Caribbean", notes: "Clean cuisine search" }),
  () => ({ sr: "mediterranean, like actual mediterranean not just hummus", cuisines: "Mediterranean", notes: "Authenticity concern" }),
  () => ({ sr: "good sushi place", cuisines: "Japanese", notes: "Dish-implied cuisine search" }),
  (p) => ({ sr: p.cultural_background === "African-American" ? "west african cuisine, not just nigerian" : "african food, maybe ethiopian or west african", cuisines: "African|Ethiopian|West African", notes: "Broad continent with sub-specificity" }),
];

const DISH_TEMPLATES: QueryTemplate[] = [
  () => ({ sr: "birria tacos with the consome", cuisines: "Mexican", notes: "Trending dish + specific component" }),
  () => ({ sr: "hand pulled noodles", cuisines: "Chinese", notes: "Specific preparation method", neighborhood: "Chinatown" }),
  () => ({ sr: "Nashville hot chicken sandwich", cuisines: "American|Southern", notes: "Specific regional dish" }),
  () => ({ sr: "tonkotsu ramen, rich broth", cuisines: "Japanese", notes: "Ramen sub-type specification" }),
  () => ({ sr: "elote and street corn", cuisines: "Mexican", notes: "Street food dish, native name" }),
  () => ({ sr: "khao soi", cuisines: "Thai", notes: "Niche Thai dish, native name" }),
  () => ({ sr: "cacio e pepe, the real deal", cuisines: "Italian", notes: "Specific Italian pasta dish" }),
  () => ({ sr: "al pastor from a trompo", cuisines: "Mexican", notes: "Dish + preparation method", neighborhood: "Pilsen" }),
  () => ({ sr: "xiaolongbao, soup dumplings", cuisines: "Chinese", notes: "Native name + English translation" }),
  () => ({ sr: "lobster roll, new england style", cuisines: "Seafood|American", notes: "Regional style specification" }),
  () => ({ sr: "poutine", cuisines: "Canadian|American", notes: "Single-word dish search" }),
  () => ({ sr: "shakshuka for brunch", cuisines: "Middle Eastern|Mediterranean", notes: "Dish + meal context", time: "breakfast" }),
  () => ({ sr: "beef wellington", cuisines: "British|European", notes: "Specific upscale dish" }),
  () => ({ sr: "banh mi, the crispy kind with pate", cuisines: "Vietnamese", notes: "Dish + texture + component preference", neighborhood: "Uptown" }),
  () => ({ sr: "jerk chicken plate", cuisines: "Caribbean|Jamaican", notes: "Caribbean staple dish" }),
];

const VIBE_TEMPLATES: QueryTemplate[] = [
  () => ({ sr: "dark moody cocktail bar with food", cuisines: "any", notes: "Atmosphere-first search" }),
  () => ({ sr: "lively brunch spot, music playing", cuisines: "any", notes: "Energy + meal type", time: "breakfast" }),
  () => ({ sr: "romantic candelit dinner", cuisines: "any", notes: "Classic romance vibe, slight misspelling", occasion: "Date Night" }),
  () => ({ sr: "chill patio spot, not too crowded", cuisines: "any", notes: "Outdoor + crowd preference" }),
  () => ({ sr: "trendy place my friends would be jealous of", cuisines: "any", notes: "Social status motivation" }),
  () => ({ sr: "old school diner feel, checkered floors", cuisines: "American", notes: "Nostalgic aesthetic specificity" }),
  () => ({ sr: "somewhere loud and fun for a birthday", cuisines: "any", notes: "Energy level + occasion", occasion: "Special Occasion" }),
  () => ({ sr: "upscale but chill, not stuffy", cuisines: "any", notes: "Contradictory vibe balancing" }),
  () => ({ sr: "exposed brick, industrial vibes, good cocktails", cuisines: "any", notes: "Decor-specific + drink pairing" }),
  () => ({ sr: "cozy rainy day restaurant", cuisines: "any", notes: "Weather-driven mood search" }),
  () => ({ sr: "garden patio fairy lights kinda place", cuisines: "any", notes: "Specific aesthetic visual", occasion: "Date Night" }),
  () => ({ sr: "dive bar with surprisingly good food", cuisines: "any", notes: "Contrasting expectations" }),
  () => ({ sr: "bougie dinner, wanna feel fancy", cuisines: "any", notes: "Slang + emotional motivation", price: "$$$" }),
  () => ({ sr: "hipster coffee shop vibes but for dinner", cuisines: "any", notes: "Cross-meal vibe reference" }),
  () => ({ sr: "waterfront dining, nice sunset view", cuisines: "any", notes: "Location + time-of-day aesthetic" }),
];

const MULTI_TEMPLATES: QueryTemplate[] = [
  () => ({ sr: "romantic italian near the west loop, good wine list", cuisines: "Italian", notes: "Vibe + cuisine + neighborhood + drink" }),
  () => ({ sr: "family friendly mexican with outdoor seating", cuisines: "Mexican", notes: "Occasion + cuisine + constraint", occasion: "Family Dinner" }),
  () => ({ sr: "cheap thai food, spicy, open late", cuisines: "Thai", notes: "Price + cuisine + flavor + time", price: "$" }),
  () => ({ sr: "upscale steakhouse for client dinner, private room if possible", cuisines: "American|Steakhouse", notes: "Cuisine + occasion + constraint", occasion: "Business Lunch", price: "$$$$" }),
  () => ({ sr: "cozy ramen spot for a cold night", cuisines: "Japanese", notes: "Vibe + dish + weather context" }),
  () => ({ sr: "brunch with live jazz, somewhere classy", cuisines: "any", notes: "Meal + entertainment + vibe", time: "breakfast" }),
  () => ({ sr: "sushi and sake, quiet enough to talk", cuisines: "Japanese", notes: "Food + drink + noise preference", occasion: "Date Night" }),
  () => ({ sr: "wood fired pizza, craft beer, kid friendly", cuisines: "Italian|Pizza", notes: "Dish + drink + family constraint", occasion: "Family Dinner" }),
  () => ({ sr: "healthy lunch, salads or bowls, fast service near the loop", cuisines: "American|Health", notes: "Diet + format + speed + location", time: "lunch", neighborhood: "The Loop" }),
  () => ({ sr: "taco tuesday specials with margs", cuisines: "Mexican", notes: "Day-specific deal + drink pairing" }),
  () => ({ sr: "dim sum brunch, gotta have the carts rolling around", cuisines: "Chinese", notes: "Dish + service style specification", neighborhood: "Chinatown", time: "breakfast" }),
  () => ({ sr: "steak and whiskey, old fashioned kind of place", cuisines: "American|Steakhouse", notes: "Food + drink + nostalgic vibe" }),
  () => ({ sr: "thai curry and pad see ew, outdoor if possible", cuisines: "Thai", notes: "Multiple dishes + constraint" }),
  () => ({ sr: "greek food with a view, maybe seafood", cuisines: "Greek|Seafood", notes: "Cuisine + location pref + hedging" }),
  () => ({ sr: "late night korean fried chicken and beer", cuisines: "Korean", notes: "Time + dish + drink combo", time: "late_night" }),
];

const DISCOVERY_TEMPLATES: QueryTemplate[] = [
  () => ({ sr: "surprise me, I'll eat anything", cuisines: "any", notes: "Fully open discovery" }),
  () => ({ sr: "what's the most underrated restaurant in chicago", cuisines: "any", notes: "Reputation-discovery hybrid" }),
  () => ({ sr: "take me somewhere new, tired of the same spots", cuisines: "any", notes: "Novelty-seeking with frustration" }),
  () => ({ sr: "dealer's choice, just make it good", cuisines: "any", notes: "Trust-based open query" }),
  () => ({ sr: "something I can't get anywhere else in the city", cuisines: "any", notes: "Uniqueness-driven discovery" }),
  () => ({ sr: "hole in the wall gem, the kind locals know about", cuisines: "any", notes: "Insider knowledge seeking" }),
  () => ({ sr: "idk what I want, just not pizza or burgers", cuisines: "any", notes: "Discovery with exclusion" }),
  () => ({ sr: "feed me something weird, I'm adventurous", cuisines: "any", notes: "Adventure-seeking open query" }),
  () => ({ sr: "best kept secret in logan square", cuisines: "any", notes: "Neighborhood-specific discovery", neighborhood: "Logan Square" }),
  () => ({ sr: "random pick, feeling lucky", cuisines: "any", notes: "Minimal effort discovery" }),
  () => ({ sr: "show me what Chicago does best", cuisines: "any", notes: "City pride discovery" }),
  () => ({ sr: "something totally different from what I usually eat", cuisines: "any", notes: "Personal novelty, vague" }),
  () => ({ sr: "a place that'll change my life ngl", cuisines: "any", notes: "Hyperbolic emotional discovery" }),
  () => ({ sr: "chef's table experience, something immersive", cuisines: "any", notes: "Experience-driven discovery", price: "$$$$" }),
  () => ({ sr: "smth good idk", cuisines: "any", notes: "Ultra-minimal slang query" }),
];

const CONTEXTUAL_TEMPLATES: QueryTemplate[] = [
  () => ({ sr: "dinner before the Bulls game at United Center", cuisines: "any", notes: "Sports event + venue reference", neighborhood: "West Loop" }),
  () => ({ sr: "quick bite near Millennium Park, tourists in town", cuisines: "any", notes: "Landmark + visitor context", neighborhood: "The Loop" }),
  () => ({ sr: "post-concert food near metro chicago", cuisines: "any", notes: "Event afterparty dining", time: "late_night" }),
  () => ({ sr: "lunch meeting in 30 min, need something fast near river north", cuisines: "any", notes: "Urgent time constraint", time: "lunch", neighborhood: "River North" }),
  () => ({ sr: "rehearsal dinner for 20, somewhere with a private area", cuisines: "any", notes: "Event type + group size + constraint", occasion: "Special Occasion" }),
  () => ({ sr: "hungover brunch, nothing too heavy", cuisines: "any", notes: "Physical state + negative constraint", time: "breakfast" }),
  () => ({ sr: "dinner before a show at the Chicago Theatre", cuisines: "any", notes: "Pre-event + venue", neighborhood: "The Loop" }),
  () => ({ sr: "graduation dinner for my daughter, she loves pasta", cuisines: "Italian", notes: "Life event + person + preference", occasion: "Special Occasion" }),
  () => ({ sr: "feeding 6 hungry dudes after softball", cuisines: "any", notes: "Group + appetite + activity context", occasion: "Group Hangout" }),
  () => ({ sr: "rainy day comfort food, don't want to walk far from the L", cuisines: "any", notes: "Weather + transit proximity" }),
  () => ({ sr: "first date, somewhere impressive but not trying too hard", cuisines: "any", notes: "Social situation balancing", occasion: "Date Night" }),
  () => ({ sr: "work from a cafe all afternoon, need good wifi and food", cuisines: "any", notes: "Productivity context", time: "lunch", occasion: "Solo Dining" }),
  () => ({ sr: "picking up food for the office, like 10 people", cuisines: "any", notes: "Takeout + group size", occasion: "Business Lunch" }),
  () => ({ sr: "anniversary dinner, 25 years, make it count", cuisines: "any", notes: "Milestone celebration emotional weight", occasion: "Special Occasion", price: "$$$$" }),
  () => ({ sr: "parents visiting from out of town, show them chicago food", cuisines: "American|Chicago", notes: "Visitor entertainment + city pride" }),
];

const REPUTATION_TEMPLATES: QueryTemplate[] = [
  () => ({ sr: "michelin star restuarant, special occasion", cuisines: "any", notes: "Prestige + misspelling + occasion", occasion: "Special Occasion", price: "$$$$" }),
  () => ({ sr: "best steak in chicago, period", cuisines: "American|Steakhouse", notes: "Superlative + emphatic" }),
  () => ({ sr: "where do food critics eat", cuisines: "any", notes: "Expert opinion seeking" }),
  () => ({ sr: "james beard award winner", cuisines: "any", notes: "Specific award reference" }),
  () => ({ sr: "top rated on google, like 4.8 stars minimum", cuisines: "any", notes: "Rating-specific threshold" }),
  () => ({ sr: "chicago's best deep dish, the real answer", cuisines: "Italian|Pizza", notes: "City icon + definitive answer seeking" }),
  () => ({ sr: "that place that was on chef's table netflix", cuisines: "any", notes: "Media reference" }),
  () => ({ sr: "legendary chicago steakhouse, the classic ones", cuisines: "American|Steakhouse", notes: "Legacy + category" }),
  () => ({ sr: "most instagrammed restaurant in chicago", cuisines: "any", notes: "Social media reputation" }),
  () => ({ sr: "best new restaurant 2025", cuisines: "any", notes: "Recency + superlative" }),
  () => ({ sr: "fine dining worth the splurge", cuisines: "any", notes: "Value judgment on luxury", price: "$$$$" }),
  () => ({ sr: "most talked about place right now", cuisines: "any", notes: "Trend-seeking current buzz" }),
  () => ({ sr: "bib gourmand spots, affordable excellence", cuisines: "any", notes: "Specific Michelin tier" }),
  () => ({ sr: "award winning pizza", cuisines: "Italian|Pizza", notes: "Award + dish category" }),
  () => ({ sr: "the one restaurant everyone says you have to try in chicago", cuisines: "any", notes: "Consensus-seeking" }),
];

const CONSTRAINTS_TEMPLATES: QueryTemplate[] = [
  () => ({ sr: "byob, bringing a nice bottle tonight", cuisines: "any", notes: "BYOB constraint + context" }),
  () => ({ sr: "outdoor patio, dog friendly", cuisines: "any", notes: "Two practical constraints" }),
  () => ({ sr: "open past 11pm on a tuesday", cuisines: "any", notes: "Specific hours + day" }),
  () => ({ sr: "wheelchair accessible, this matters", cuisines: "any", notes: "Accessibility + emphasis" }),
  () => ({ sr: "takes reservations for large party, 12 people", cuisines: "any", notes: "Booking + group size", occasion: "Group Hangout" }),
  () => ({ sr: "free parking or valet, hate looking for street parking", cuisines: "any", notes: "Parking constraint + frustration" }),
  () => ({ sr: "gluten free menu that's actually extensive, not just 2 options", cuisines: "any", notes: "Dietary + quality expectation", dietary: ["gluten_free"] }),
  () => ({ sr: "walk-in only, no reservation needed", cuisines: "any", notes: "Booking style preference" }),
  () => ({ sr: "delivery available, too cold to go out", cuisines: "any", notes: "Service mode + weather" }),
  () => ({ sr: "prix fixe under $60 per person", cuisines: "any", notes: "Format + specific budget" }),
  () => ({ sr: "private dining room for a proposal", cuisines: "any", notes: "Space type + occasion", occasion: "Special Occasion", price: "$$$" }),
  () => ({ sr: "counter seating, I like watching the chefs", cuisines: "any", notes: "Seating preference + reason", occasion: "Solo Dining" }),
  () => ({ sr: "open for breakfast at 7am", cuisines: "any", notes: "Specific early hours", time: "breakfast" }),
  () => ({ sr: "takeout friendly, good packaging", cuisines: "any", notes: "Service mode + quality detail" }),
  () => ({ sr: "vegan options for my gf and regular food for me", cuisines: "any", notes: "Split dietary needs", dietary: ["vegan"] }),
];

const NICHE_TEMPLATES: QueryTemplate[] = [
  () => ({ sr: "georgian food, khachapuri specifically", cuisines: "Georgian", notes: "Rare cuisine + specific dish" }),
  () => ({ sr: "basque pintxos bar", cuisines: "Spanish|Basque", notes: "Sub-regional European niche" }),
  () => ({ sr: "oaxacan mole, not just regular mole", cuisines: "Mexican|Oaxacan", notes: "Regional Mexican sub-cuisine" }),
  () => ({ sr: "sri lankan food, hoppers and kottu", cuisines: "Sri Lankan", notes: "Niche South Asian + specific dishes" }),
  () => ({ sr: "uyghur food, laghman noodles", cuisines: "Uyghur|Chinese", notes: "Very niche Central Asian" }),
  () => ({ sr: "haitian food in chicago, griot or tasso", cuisines: "Haitian|Caribbean", notes: "Niche Caribbean + specific dishes" }),
  () => ({ sr: "burmese food, tea leaf salad", cuisines: "Burmese", notes: "Rare Southeast Asian + signature dish" }),
  () => ({ sr: "argentinian empanadas and chimichurri", cuisines: "Argentinian|South American", notes: "South American niche dishes" }),
  () => ({ sr: "scandinavian restaurant, like new nordic style", cuisines: "Scandinavian|Nordic", notes: "Food movement reference" }),
  () => ({ sr: "real neapolitan pizza, VPN certified", cuisines: "Italian|Pizza", notes: "Certification-level authenticity" }),
  () => ({ sr: "moroccan tagine, somewhere with the clay pots", cuisines: "Moroccan|North African", notes: "Dish + cookware authenticity" }),
  () => ({ sr: "peruvian food, lomo saltado or ceviche", cuisines: "Peruvian|South American", notes: "South American + multiple dish options" }),
  () => ({ sr: "tibetan momos", cuisines: "Tibetan|Himalayan", notes: "Ultra-niche dumpling variety" }),
  () => ({ sr: "colombian bandeja paisa", cuisines: "Colombian|South American", notes: "Specific national dish" }),
  () => ({ sr: "hungarian goulash, the real thick kind", cuisines: "Hungarian|Eastern European", notes: "Specific European dish + texture preference" }),
];

const COMPLEX_TEMPLATES: QueryTemplate[] = [
  () => ({ sr: "where would Anthony Bourdain eat in Chicago", cuisines: "any", notes: "Celebrity chef reference" }),
  () => ({ sr: "not sure what I want but I had amazing pad kee mao last week and want something in that lane", cuisines: "Thai|Asian", notes: "Reference-based indecisive query" }),
  () => ({ sr: "my ex took me to this place in river north, it had the blue lighting and great cocktails, what was it", cuisines: "any", notes: "Memory reconstruction search", neighborhood: "River North" }),
  () => ({ sr: "I just moved to chicago from LA, where do I eat first", cuisines: "any", notes: "Newcomer context + open discovery" }),
  () => ({ sr: "something like Girl & the Goat but less wait", cuisines: "any", notes: "Comparative reference + constraint" }),
  () => ({ sr: "my therapist says I should try new things so surprise me with something bold", cuisines: "any", notes: "Personal context + discovery" }),
  () => ({ sr: "food that pairs well with a first date where you're both nervous", cuisines: "any", notes: "Emotional situation + food pairing", occasion: "Date Night" }),
  () => ({ sr: "I've eaten at every restaurant in west loop, prove me wrong", cuisines: "any", notes: "Challenge-based discovery", neighborhood: "West Loop" }),
  () => ({ sr: "grandma is visiting from korea, need somewhere she'd feel comfortable but my kids are picky", cuisines: "Korean|American", notes: "Multi-generational compromise", occasion: "Family Dinner" }),
  () => ({ sr: "birthday dinner but half the group is vegan and half wants steak", cuisines: "any", notes: "Conflicting group dietary needs", occasion: "Special Occasion" }),
  () => ({ sr: "the kind of place a novelist would write in, coffee and melancholy", cuisines: "any", notes: "Literary/artistic mood query", occasion: "Solo Dining" }),
  () => ({ sr: "want to feel like I'm in Tokyo for one night", cuisines: "Japanese", notes: "Immersive cultural experience" }),
  () => ({ sr: "place that makes you forget you're in a midwest city", cuisines: "any", notes: "Escapist vibe query" }),
  () => ({ sr: "somewhere my Nigerian mom would approve of, she's picky about spice levels", cuisines: "African|Nigerian", notes: "Family approval + cultural specificity" }),
  () => ({ sr: "restaurant equivalent of a warm hug", cuisines: "any", notes: "Emotional metaphor query" }),
];

const ALL_TEMPLATES: Record<string, QueryTemplate[]> = {
  Cuisine: CUISINE_TEMPLATES,
  Dish: DISH_TEMPLATES,
  Vibe: VIBE_TEMPLATES,
  Multi: MULTI_TEMPLATES,
  Discovery: DISCOVERY_TEMPLATES,
  Contextual: CONTEXTUAL_TEMPLATES,
  Reputation: REPUTATION_TEMPLATES,
  Constraints: CONSTRAINTS_TEMPLATES,
  Niche: NICHE_TEMPLATES,
  Complex: COMPLEX_TEMPLATES,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Variation modifiers applied to template text on 2nd+ use to avoid dedup collisions
const PREFIXES = [
  "", "yo ", "hey ", "need ", "craving ", "looking for ", "find me ", "want ", "gimme ",
  "show me ", "where's ", "rec me ", "hook me up with ", "dying for ", "in the mood for ",
  "help me find ", "any good ", "know any ", "tryna find ", "lowkey want ",
];
const SUFFIXES = [
  "", ", thanks", ", any recs?", " please", " near me", ", what do you got", " rn", " asap", ", help",
  " tonight", ", seriously", " tho", ", not picky", " lol", ", thoughts?", " fr", " maybe?",
  ", down for anything", ", open to suggestions", " ideally",
];

function varyText(base: string, cycle: number): string {
  if (cycle === 0) return base;
  // Use both cycle and a hash of the base text to spread across the variation grid
  const baseHash = base.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const prefixIdx = (cycle + baseHash) % PREFIXES.length;
  const suffixIdx = (Math.floor(cycle / PREFIXES.length) + baseHash) % SUFFIXES.length;
  const prefix = PREFIXES[prefixIdx];
  const suffix = SUFFIXES[suffixIdx];
  // Don't double-prefix if base already starts casually
  const startsWithCasual = /^(yo |hey |need |looking |find |want |gimme |craving |show |where|rec |hook |dying |in the mood|help |any |know |tryna |lowkey )/.test(base);
  const finalPrefix = startsWithCasual ? "" : prefix;
  return `${finalPrefix}${base}${suffix}`.trim();
}

function weightedPick<T>(arr: readonly T[], weights: number[]): T {
  const r = Math.random();
  let cum = 0;
  for (let i = 0; i < arr.length; i++) {
    cum += weights[i];
    if (r < cum) return arr[i];
  }
  return arr[arr.length - 1];
}

function pickLeast(counts: Record<string, number>, pool: readonly string[]): string {
  let min = Infinity;
  const candidates: string[] = [];
  for (const v of pool) {
    const c = counts[v] ?? 0;
    if (c < min) { min = c; candidates.length = 0; candidates.push(v); }
    else if (c === min) candidates.push(v);
  }
  return pick(candidates);
}

function dietaryForReligion(religion: string): string[] {
  if (religion === "Muslim") return ["halal"];
  if (religion === "Jewish") return ["kosher"];
  if (religion === "Hindu") return Math.random() < 0.7 ? ["vegetarian"] : [];
  if (religion === "Buddhist") return Math.random() < 0.4 ? ["vegetarian"] : [];
  if (religion === "Sikh") return Math.random() < 0.4 ? ["vegetarian"] : [];
  return [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface QueryEntry {
  id: string;
  generated_at: string;
  persona: {
    age_group: string;
    gender: string;
    cultural_background: string;
    religion: string;
    dietary_influence: string;
  };
  request: {
    special_request: string;
    occasion: string;
    neighborhood: string;
    price_level: string;
    dietary_restrictions: string[];
    time_of_day: string;
  };
  test_metadata: {
    category: string;
    expected_cuisines: string;
    min_score: number;
    natural_language_notes: string;
  };
}

interface GeneratedFile {
  metadata: {
    version: string;
    total_queries: number;
    last_generated: string | null;
    distribution: {
      by_category: Record<string, number>;
      by_time_of_day: Record<string, number>;
      by_cultural_background: Record<string, number>;
      by_age_group: Record<string, number>;
      by_gender: Record<string, number>;
      by_occasion: Record<string, number>;
      by_religion: Record<string, number>;
    };
  };
  queries: QueryEntry[];
}

// Read existing file
let data: GeneratedFile;
try {
  data = JSON.parse(readFileSync(OUTPUT, "utf-8"));
} catch {
  data = {
    metadata: {
      version: "1.0",
      total_queries: 0,
      last_generated: null,
      distribution: {
        by_category: {}, by_time_of_day: {}, by_cultural_background: {},
        by_age_group: {}, by_gender: {}, by_occasion: {}, by_religion: {},
      },
    },
    queries: [],
  };
}

if (data.metadata.total_queries >= 1000) {
  console.log("Repository full (1000/1000). No new queries generated.");
  process.exit(0);
}

const cap = Math.min(BATCH_SIZE, 1000 - data.metadata.total_queries);
const existingSRs = new Set(data.queries.map(q => q.request.special_request.toLowerCase()));

// Rebuild distribution counts from actual data
const dist = data.metadata.distribution;
for (const key of Object.keys(dist)) {
  (dist as any)[key] = {};
}
for (const q of data.queries) {
  dist.by_category[q.test_metadata.category] = (dist.by_category[q.test_metadata.category] ?? 0) + 1;
  dist.by_time_of_day[q.request.time_of_day] = (dist.by_time_of_day[q.request.time_of_day] ?? 0) + 1;
  dist.by_cultural_background[q.persona.cultural_background] = (dist.by_cultural_background[q.persona.cultural_background] ?? 0) + 1;
  dist.by_age_group[q.persona.age_group] = (dist.by_age_group[q.persona.age_group] ?? 0) + 1;
  dist.by_gender[q.persona.gender] = (dist.by_gender[q.persona.gender] ?? 0) + 1;
  dist.by_occasion[q.request.occasion] = (dist.by_occasion[q.request.occasion] ?? 0) + 1;
  dist.by_religion[q.persona.religion] = (dist.by_religion[q.persona.religion] ?? 0) + 1;
}

// Track template cycle counts per category (how many times we've gone through all templates)
const templateCycleCount: Record<string, number> = {};
const usedTemplateIdx: Record<string, Set<number>> = {};
for (const cat of CATEGORIES) {
  usedTemplateIdx[cat] = new Set();
  templateCycleCount[cat] = 0;
}

// Check existing queries against templates to pre-mark used ones
for (const q of data.queries) {
  const cat = q.test_metadata.category;
  const templates = ALL_TEMPLATES[cat];
  if (!templates) continue;
  const sr = q.request.special_request.toLowerCase();
  for (let i = 0; i < templates.length; i++) {
    const dummy = templates[i]({ age_group: "", gender: "", cultural_background: "", religion: "" });
    if (dummy.sr.toLowerCase() === sr) {
      usedTemplateIdx[cat].add(i);
    }
  }
}

const startId = data.queries.length + 1;
const now = new Date().toISOString();
const newQueries: QueryEntry[] = [];
let retries = 0;
const MAX_RETRIES = cap * 3; // safety valve

for (let i = 0; i < cap && retries < MAX_RETRIES; i++) {
  // Pick least-represented category
  const category = pickLeast(dist.by_category, CATEGORIES);

  // Pick unused template from that category
  const templates = ALL_TEMPLATES[category];
  const availableIdx = [];
  for (let t = 0; t < templates.length; t++) {
    if (!usedTemplateIdx[category].has(t)) availableIdx.push(t);
  }
  // If all used, reset and bump cycle count (enables text variation)
  if (availableIdx.length === 0) {
    usedTemplateIdx[category].clear();
    templateCycleCount[category] = (templateCycleCount[category] ?? 0) + 1;
    for (let t = 0; t < templates.length; t++) availableIdx.push(t);
  }
  const tIdx = pick(availableIdx);
  usedTemplateIdx[category].add(tIdx);

  // Build persona prioritizing underrepresented dimensions
  const age_group = pickLeast(dist.by_age_group, AGE_GROUPS);
  const gender = pickLeast(dist.by_gender, GENDERS);
  const cultural_background = pickLeast(dist.by_cultural_background, CULTURES);
  const religion = pickLeast(dist.by_religion, RELIGIONS);

  const persona: Persona = { age_group, gender, cultural_background, religion };
  const result = templates[tIdx](persona);

  // Apply text variation based on cycle count to produce unique queries on re-use
  const cycle = templateCycleCount[category] ?? 0;
  const variedSR = varyText(result.sr, cycle);

  // Dedup check
  if (existingSRs.has(variedSR.toLowerCase())) {
    i--;
    retries++;
    continue;
  }
  // Use the varied text
  result.sr = variedSR;

  const religionDietary = dietaryForReligion(religion);
  const templateDietary = result.dietary ?? [];
  const mergedDietary = [...new Set([...templateDietary, ...religionDietary])];

  const dietaryInfluence = religionDietary.length > 0 ? religionDietary.join(", ") : "none";

  const time = result.time ?? pickLeast(dist.by_time_of_day, TIMES);
  const occasion = result.occasion ?? pickLeast(dist.by_occasion, OCCASIONS);
  const neighborhood = result.neighborhood ?? pick(NEIGHBORHOODS);
  const price = result.price ?? pick(PRICES.slice(0, 4)); // exclude "Any" mostly

  const entry: QueryEntry = {
    id: `TQ-${String(startId + newQueries.length).padStart(4, "0")}`,
    generated_at: now,
    persona: {
      age_group,
      gender,
      cultural_background,
      religion,
      dietary_influence: dietaryInfluence,
    },
    request: {
      special_request: result.sr,
      occasion,
      neighborhood,
      price_level: price,
      dietary_restrictions: mergedDietary,
      time_of_day: time,
    },
    test_metadata: {
      category,
      expected_cuisines: result.cuisines,
      min_score: CATEGORY_THRESHOLDS[category] ?? 40,
      natural_language_notes: result.notes,
    },
  };

  newQueries.push(entry);
  existingSRs.add(result.sr.toLowerCase());

  // Update running distribution
  dist.by_category[category] = (dist.by_category[category] ?? 0) + 1;
  dist.by_time_of_day[time] = (dist.by_time_of_day[time] ?? 0) + 1;
  dist.by_cultural_background[cultural_background] = (dist.by_cultural_background[cultural_background] ?? 0) + 1;
  dist.by_age_group[age_group] = (dist.by_age_group[age_group] ?? 0) + 1;
  dist.by_gender[gender] = (dist.by_gender[gender] ?? 0) + 1;
  dist.by_occasion[occasion] = (dist.by_occasion[occasion] ?? 0) + 1;
  dist.by_religion[religion] = (dist.by_religion[religion] ?? 0) + 1;
}

// Append and write
data.queries.push(...newQueries);
data.metadata.total_queries = data.queries.length;
data.metadata.last_generated = now;

writeFileSync(OUTPUT, JSON.stringify(data, null, 2) + "\n");

// Report
const lastId = `TQ-${String(startId + newQueries.length - 1).padStart(4, "0")}`;
const firstId = `TQ-${String(startId).padStart(4, "0")}`;

console.log(`\n## Test Query Generation Report\n`);
console.log(`Generated: ${newQueries.length} new queries (${firstId} to ${lastId})`);
console.log(`Total queries: ${data.metadata.total_queries} / 1000\n`);

console.log(`### Distribution After Generation`);
console.log(`| Dimension | Values |`);
console.log(`|-----------|--------|`);
for (const [dim, counts] of Object.entries(dist)) {
  const summary = Object.entries(counts as Record<string, number>)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");
  console.log(`| ${dim.replace("by_", "")} | ${summary} |`);
}

console.log(`\n### Generated Queries`);
console.log(`| # | ID | Query | Persona | Category |`);
console.log(`|---|------|-------|---------|----------|`);
for (let i = 0; i < newQueries.length; i++) {
  const q = newQueries[i];
  const persona = `${q.persona.age_group}/${q.persona.gender}/${q.persona.cultural_background}`;
  const sr = q.request.special_request.length > 60
    ? q.request.special_request.slice(0, 57) + "..."
    : q.request.special_request;
  console.log(`| ${i + 1} | ${q.id} | "${sr}" | ${persona} | ${q.test_metadata.category} |`);
}
