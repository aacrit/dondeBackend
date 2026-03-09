/**
 * Donde Match V9 — Relevance × Quality Scoring Engine
 *
 * V9 Architecture:
 *   DondeScore = Relevance(0-1) × Quality(0-100) + OccasionBonus(±5)
 *
 * Relevance is a GATE — low relevance = low score regardless of quality.
 *   Priority hierarchy: dish > cuisine > vibe > open_ended
 *   Uses review intelligence (evidence-based) + structured data (fallback)
 *
 * Quality is the RANK — among relevant restaurants, quality determines order.
 *   Weight profiles adapt to query type (no weight-shift rules needed)
 *
 * Occasion is a TIEBREAKER — ±5 points max, never drives the ranking.
 *
 * Statistical foundations:
 * - Bayesian average for Google ratings (C=30, m=4.15) — retained from V8
 * - Wu-Palmer cuisine taxonomy (6-level) — retained from V8
 * - BM25/TF-IDF via PostgreSQL ts_rank() — new, for review intelligence
 * - Conditional probability: P(quality | match_type) — new, query-type weights
 * - Laplace smoothing: vibe/constraint floors — retained from V8
 */

import type { RestaurantProfile } from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { IntentClassificationV2 } from "./intent-classifier.ts";
import type {
  MatchNarrative,
  V9Candidate,
  V9Factors,
  V9FactorDetails,
  V9FactorConfidence,
  V9Relevance,
  V9RelevanceType,
  V9QualityWeights,
  V9QualityResult,
  V9ScoringContext,
  V9ScoreResult,
  V9ScoredCandidate,
  V9SubComponent,
  ReviewIntelligence,
} from "./types-v9.ts";
import {
  OCCASION_WEIGHTS,
  DIETARY_KEYWORDS,
} from "./scoring.ts";

// ==========================================
// CONSTANTS
// ==========================================

// Cuisine family relationships — retained from V8
const CUISINE_FAMILIES: Record<string, string[]> = {
  Mediterranean: ["Greek", "Italian", "Middle Eastern", "Spanish", "Moroccan", "Levantine"],
  "East Asian": ["Japanese", "Chinese", "Korean", "Taiwanese", "Sichuan"],
  "Southeast Asian": ["Thai", "Vietnamese", "Cambodian", "Laotian", "Malaysian", "Singaporean"],
  "Latin American": ["Mexican", "Peruvian", "Brazilian", "Puerto Rican", "Colombian", "Ecuadorian", "Venezuelan", "Salvadoran", "Argentine"],
  Caribbean: ["Cuban", "Jamaican", "Trinidadian", "Caribbean/Jamaican"],
  "South Asian": ["Indian", "Nepalese/Tibetan", "Pakistani"],
  "East African": ["Ethiopian", "Eritrean", "Somali", "East African"],
  "West African": ["Nigerian", "Ghanaian", "Senegalese", "West African", "Liberian"],
  "Central Asian": ["Central Asian", "Georgian", "Azerbaijani"],
  "Middle Eastern": ["Persian", "Yemeni", "Kurdish", "Palestinian", "Lebanese", "Turkish"],
  European: ["Polish", "German", "French", "British", "Ukrainian", "Irish", "Swedish", "Serbian", "Bosnian", "Portuguese", "Spanish"],
  American: ["BBQ", "Southern", "Southern/Soul Food", "Cajun", "Creole", "Hawaiian"],
};

const FAMILY_ADJACENCY: Record<string, string[]> = {
  Mediterranean: ["European", "Middle Eastern", "East African"],
  "East Asian": ["Southeast Asian"],
  "Southeast Asian": ["East Asian", "South Asian"],
  "Latin American": ["Caribbean"],
  Caribbean: ["Latin American", "West African"],
  "South Asian": ["Southeast Asian", "Middle Eastern"],
  "East African": ["Mediterranean", "West African", "Middle Eastern"],
  "West African": ["Caribbean", "East African"],
  "Central Asian": ["Middle Eastern", "South Asian"],
  "Middle Eastern": ["Mediterranean", "South Asian", "Central Asian"],
  European: ["Mediterranean"],
  American: ["European"],
};

const CUISINE_TO_FAMILY: Record<string, string> = {};
for (const [family, cuisines] of Object.entries(CUISINE_FAMILIES)) {
  for (const c of cuisines) CUISINE_TO_FAMILY[c] = family;
}

function getCuisineFamily(cuisine: string): string | null {
  return CUISINE_TO_FAMILY[cuisine] || null;
}

function isRelatedCuisine(cuisine: string, targets: string[]): boolean {
  const family = getCuisineFamily(cuisine);
  if (!family) return false;
  return targets.some(t => {
    if (t.toLowerCase() === family.toLowerCase()) return true;
    const targetFamily = getCuisineFamily(t);
    return targetFamily === family;
  });
}

function isAdjacentCuisine(cuisine: string, targets: string[]): boolean {
  const family = getCuisineFamily(cuisine);
  if (!family) return false;
  const adjacent = FAMILY_ADJACENCY[family] || [];
  return targets.some(t => {
    const targetFamily = getCuisineFamily(t);
    if (!targetFamily) return false;
    return adjacent.includes(targetFamily);
  });
}

function tagToString(t: unknown): string {
  if (typeof t === "string") return t;
  if (t && typeof t === "object" && "name" in t) return (t as { name: string }).name || "";
  if (t && typeof t === "object" && "tag_text" in t) return (t as { tag_text: string }).tag_text || "";
  return "";
}

// ==========================================
// V10 ENHANCEMENTS: Stemming, Synonyms, Reputation
// ==========================================

/** Basic stemming — strip common English suffixes */
function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("es") && w.length > 3) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  return w;
}

/** Tokenize and stem a phrase into word stems */
function stemTokens(phrase: string): string[] {
  return phrase.toLowerCase().split(/\s+/).filter(w => w.length > 1).map(stem);
}

/** Fuzzy match: do two phrases overlap significantly? Uses stemmed word overlap (Jaccard) */
function fuzzyDishMatch(query: string, candidate: string): number {
  const qStems = stemTokens(query);
  const cStems = stemTokens(candidate);
  if (qStems.length === 0 || cStems.length === 0) return 0;
  const intersection = qStems.filter(s => cStems.includes(s)).length;
  const union = new Set([...qStems, ...cStems]).size;
  return intersection / union;
}

/** Dish synonym map — canonical dish → aliases for Chicago restaurants */
const DISH_SYNONYMS: Record<string, string[]> = {
  "soup dumplings": ["xiao long bao", "xlb", "xiaolongbao", "soup dumpling"],
  "xiao long bao": ["soup dumplings", "xlb", "xiaolongbao", "soup dumpling"],
  "deep dish pizza": ["chicago style pizza", "chicago pizza", "deep dish", "stuffed pizza"],
  "chicago style pizza": ["deep dish pizza", "deep dish", "stuffed pizza"],
  "al pastor": ["pastor tacos", "tacos al pastor"],
  "birria": ["birria tacos", "birria quesatacos", "birria quesadillas"],
  "birria tacos": ["birria", "birria quesatacos"],
  "pad thai": ["phad thai", "pad tai"],
  "pho": ["phở", "beef pho", "chicken pho"],
  "ramen": ["tonkotsu ramen", "shoyu ramen", "miso ramen"],
  "gyoza": ["potstickers", "pot stickers", "dumplings"],
  "potstickers": ["gyoza", "pot stickers", "dumplings"],
  "tacos": ["taco", "street tacos"],
  "burger": ["burgers", "hamburger", "hamburgers", "smash burger", "smashburger"],
  "smash burger": ["burger", "smashburger", "smashed burger"],
  "wings": ["chicken wings", "wing", "buffalo wings", "hot wings"],
  "chicken wings": ["wings", "wing", "buffalo wings"],
  "bao": ["bao buns", "steamed buns", "baozi"],
  "momo": ["momos", "tibetan dumplings", "nepali dumplings"],
  "momos": ["momo", "tibetan dumplings", "nepali dumplings"],
  "ceviche": ["cebiche", "seviche"],
  "pupusa": ["pupusas"],
  "empanada": ["empanadas"],
  "arepa": ["arepas"],
  "pierogi": ["pierogies", "pierogy", "perogies"],
  "dim sum": ["dimsum", "yum cha"],
  "shawarma": ["shwarma", "schwarma"],
  "falafel": ["falafels"],
  "kebab": ["kebabs", "kabob", "kabobs"],
  "naan": ["nan", "tandoori naan"],
  "tikka masala": ["chicken tikka masala", "tikka"],
  "chicken tikka masala": ["tikka masala", "tikka"],
  "bulgogi": ["bool kogi", "bul gogi"],
  "bibimbap": ["bibim bap", "bibimbop"],
  "sushi": ["nigiri", "maki", "sashimi"],
  "omakase": ["chef's choice", "chefs tasting"],
  // V11: Cross-cuisine dish mapping
  "dumplings": ["gyoza", "potstickers", "momo", "momos", "pierogi", "xiao long bao", "soup dumplings", "wontons", "mandu"],
  "noodles": ["ramen", "pho", "pad thai", "lo mein", "udon", "soba", "dan dan noodles", "laksa", "japchae", "pad see ew"],
  "curry": ["tikka masala", "green curry", "red curry", "massaman", "panang", "korma", "vindaloo", "japanese curry", "katsu curry"],
  "fried chicken": ["karaage", "nashville hot chicken", "korean fried chicken", "popeyes", "hot chicken", "chicken katsu"],
  "steak": ["ribeye", "filet mignon", "wagyu", "porterhouse", "tomahawk", "t-bone", "strip steak"],
  "tacos": ["taco", "street tacos", "birria tacos", "al pastor tacos", "fish tacos", "carnitas tacos"],
  "sandwich": ["sub", "hoagie", "panini", "cubano", "banh mi", "po boy", "club sandwich", "cheesesteak"],
  "pizza": ["deep dish", "thin crust", "neapolitan", "detroit style", "chicago style", "tavern cut", "flatbread"],
  "salad": ["caesar", "chopped salad", "greek salad", "fattoush", "tabbouleh", "cobb salad"],
  "soup": ["pho", "ramen", "tom yum", "miso soup", "french onion", "clam chowder", "pozole", "borscht"],
  "wings": ["chicken wings", "buffalo wings", "korean wings", "hot wings", "garlic parmesan wings"],
  "rice bowl": ["bibimbap", "poke bowl", "donburi", "chirashi", "burrito bowl"],
  "flatbread": ["naan", "pita", "lavash", "focaccia", "roti"],
  "wrap": ["burrito", "shawarma wrap", "gyro wrap", "spring rolls", "lumpia"],
  "tasting menu": ["prix fixe", "omakase", "chef's table", "multi-course", "degustazione"],
  "brunch": ["pancakes", "waffles", "eggs benedict", "avocado toast", "french toast", "chilaquiles"],
  // V11: Colloquial terms
  "za": ["pizza", "deep dish pizza"],
  "noods": ["noodles", "ramen", "pho", "udon"],
  "burg": ["burger", "hamburger", "smash burger"],
  "chicky": ["chicken", "fried chicken"],
  "nugs": ["chicken nuggets", "nuggets"],
};

/** Expand a dish query into canonical + synonyms */
function expandDishQuery(dish: string): string[] {
  const lower = dish.toLowerCase();
  const expanded = [lower];
  for (const [canonical, aliases] of Object.entries(DISH_SYNONYMS)) {
    if (canonical === lower || aliases.includes(lower)) {
      expanded.push(canonical);
      for (const alias of aliases) {
        if (!expanded.includes(alias)) expanded.push(alias);
      }
    }
  }
  return expanded;
}

/** Reputation keywords that trigger reputation-aware relevance */
const REPUTATION_KEYWORDS = [
  "best", "top rated", "top-rated", "highest rated", "award", "award-winning",
  "michelin", "james beard", "critically acclaimed", "best reviewed", "most popular",
  "five star", "finest", "premier", "legendary", "world class", "world-class",
  "famous", "iconic", "celebrated", "renowned",
];

/** Check if the query/intent signals a reputation-focused search */
function isReputationQuery(intent: IntentClassificationV2 | null, specialRequest: string): boolean {
  const lower = specialRequest.toLowerCase();
  if (REPUTATION_KEYWORDS.some(kw => lower.includes(kw))) return true;
  if (intent?.target_tags?.some((t: string) => t.toLowerCase() === "reputation-focused")) return true;
  return false;
}

// ==========================================
// NEIGHBORHOOD ALIASES (V10)
// ==========================================

export const NEIGHBORHOOD_ALIASES: Record<string, string> = {
  "downtown": "The Loop",
  "the loop": "The Loop",
  "loop": "The Loop",
  "wrigley": "Lakeview",
  "wrigley field": "Lakeview",
  "wrigleyville": "Lakeview",
  "magnificent mile": "River North",
  "mag mile": "River North",
  "navy pier": "Streeterville",
  "streeterville": "Streeterville",
  "united center": "West Loop",
  "millennium park": "The Loop",
  "grant park": "The Loop",
  "old town": "Lincoln Park",
  "boystown": "Lakeview",
  "chinatown": "Chinatown",
  "little italy": "University Village",
  "pilsen": "Pilsen",
  "hyde park": "Hyde Park",
  "south loop": "South Loop",
  "gold coast": "Gold Coast",
  "edgewater": "Edgewater",
  "andersonville": "Andersonville",
  "uptown": "Uptown",
  "ravenswood": "Lincoln Square",
  "albany park": "Albany Park",
  "avondale": "Avondale",
  "humboldt park": "Humboldt Park",
  "little village": "Little Village",
  "bridgeport": "Bridgeport",
  "rogers park": "Rogers Park",
  "devon avenue": "Rogers Park",
  "devon": "Rogers Park",
  "argyle": "Uptown",
  "argyle street": "Uptown",
  "fulton market": "West Loop",
  "randolph street": "West Loop",
  "restaurant row": "West Loop",
  "greektown": "West Loop",
  "ukrainian village": "Ukrainian Village",
  "bucktown": "Bucktown",
  "north center": "North Center",
  "roscoe village": "North Center",
  "irving park": "Irving Park",
  "portage park": "Portage Park",
  "logan square": "Logan Square",
  "river north": "River North",
  "west loop": "West Loop",
  "lincoln park": "Lincoln Park",
  "wicker park": "Wicker Park",
  "lakeview": "Lakeview",
  "near wrigley": "Lakeview",
  // Sports venues — "dinner before X game" queries
  "bulls game": "West Loop",
  "blackhawks game": "West Loop",
  "bears game": "South Loop",
  "soldier field": "South Loop",
  "cubs game": "Lakeview",
  "white sox game": "Bridgeport",
  "sox game": "Bridgeport",
  "guaranteed rate": "Bridgeport",
  "fire game": "Bridgeport",
  "concert at united center": "West Loop",
};

// ==========================================
// V11: CONCEPT MAP — semantic query expansion
// ==========================================

/** Maps abstract concepts to structured restaurant signals */
interface ConceptSignal {
  neighborhoods?: string[];
  tags?: string[];
  constraints?: string[];
  vibes?: string[];
  reputation_boost?: boolean;
  cuisines?: string[];
  price_hint?: string;
}

export const CONCEPT_MAP: Record<string, ConceptSignal> = {
  // Event-based concepts
  "pre-game": { neighborhoods: ["West Loop", "Wrigleyville", "South Loop"], tags: ["lively atmosphere"], constraints: ["walk_in"], vibes: ["lively", "buzzing"] },
  "pre-game dinner": { neighborhoods: ["West Loop", "Wrigleyville", "South Loop"], tags: ["lively atmosphere"], constraints: ["walk_in"], vibes: ["lively"] },
  "pre-concert": { neighborhoods: ["West Loop", "The Loop"], tags: ["lively atmosphere"], constraints: ["walk_in"] },
  "post-theater": { neighborhoods: ["The Loop", "River North"], tags: ["late night", "craft cocktails"], vibes: ["elegant", "refined"] },
  "pre-event dinner": { tags: ["lively atmosphere"], constraints: ["walk_in"], vibes: ["lively"] },
  "post-event dinner": { tags: ["late night", "craft cocktails"] },

  // Experience concepts
  "celebrity": { tags: ["fine dining", "trendy"], reputation_boost: true, vibes: ["elegant", "modern"] },
  "celebrity hotspot": { tags: ["fine dining", "trendy"], reputation_boost: true, vibes: ["elegant", "modern"] },
  "Instagram-worthy": { tags: ["trendy", "instagrammable"], vibes: ["modern"] },
  "instagrammable": { tags: ["trendy", "instagrammable"], vibes: ["modern"] },
  "hidden gem experience": { tags: ["hidden gem"], vibes: ["cozy", "rustic"] },
  "hidden gem": { tags: ["hidden gem"], vibes: ["cozy"] },
  "neighborhood favorite": { tags: ["hidden gem", "great value"] },
  "neighborhood institution": { reputation_boost: true },
  "power lunch": { tags: ["quiet"], vibes: ["refined", "elegant"], constraints: ["walk_in"] },
  "client entertainment": { tags: ["fine dining"], vibes: ["elegant", "refined"], reputation_boost: true },
  "authentic experience": { vibes: ["rustic", "classic"] },

  // Mood/feeling concepts
  "culinary adventure": { tags: ["hidden gem"], vibes: ["funky"] },
  "culinary exploration": { tags: ["hidden gem"], vibes: ["funky", "modern"] },
  "comfort food experience": { cuisines: ["American", "Southern/Soul Food"], vibes: ["cozy", "warm"] },
  "indulgent experience": { tags: ["fine dining", "tasting menu"], vibes: ["elegant"], price_hint: "$$$" },
  "impressive dining": { tags: ["fine dining"], vibes: ["elegant", "refined"], reputation_boost: true },
  "cozy weather retreat": { vibes: ["cozy", "warm"], tags: ["craft cocktails"] },
  "summer dining": { tags: ["outdoor patio", "rooftop"], constraints: ["outdoor_preferred"] },
  "late night eats": { tags: ["late night"], vibes: ["lively", "casual"] },
  "quick meal": { constraints: ["walk_in"], vibes: ["casual"] },

  // Social context concepts
  "date night spot": { tags: ["romantic", "craft cocktails"], vibes: ["intimate", "warm"] },
  "first date": { vibes: ["casual", "warm"], tags: ["craft cocktails"] },
  "anniversary dinner": { tags: ["fine dining", "romantic"], vibes: ["intimate", "elegant"], reputation_boost: true },
  "birthday celebration": { tags: ["lively atmosphere"], vibes: ["lively", "warm"] },
  "graduation celebration": { tags: ["lively atmosphere"], vibes: ["lively"] },
  "bachelor party": { tags: ["lively atmosphere", "craft cocktails"], vibes: ["lively", "buzzing"] },
  "social dinner": { vibes: ["warm", "lively"] },
  "family dinner": { vibes: ["warm", "casual"] },
  "parents visiting dinner": { reputation_boost: true, vibes: ["warm", "classic"] },
  "special occasion": { tags: ["fine dining"], vibes: ["elegant"], reputation_boost: true },

  // Dining format concepts
  "happy hour": { tags: ["craft cocktails", "great value"], vibes: ["lively", "casual"], constraints: ["walk_in"] },
  "prix fixe": { tags: ["fine dining", "tasting menu"], vibes: ["elegant", "refined"] },
  "prix fixe dinner": { tags: ["fine dining", "tasting menu"], vibes: ["elegant", "refined"] },
  "tasting menu": { tags: ["fine dining", "tasting menu"], vibes: ["elegant", "refined"] },
  "sunday dinner": { vibes: ["warm", "classic", "cozy"] },
  "weekday lunch": { constraints: ["walk_in", "budget_conscious"], vibes: ["casual"] },
  "quick lunch": { constraints: ["walk_in", "budget_conscious"], vibes: ["casual"] },
  "budget friendly": { tags: ["great value"], constraints: ["budget_conscious"] },
  "cheap eats": { tags: ["great value"], constraints: ["budget_conscious"] },
  "affordable": { tags: ["great value"], constraints: ["budget_conscious"] },
  "large party": { constraints: ["private_dining"], vibes: ["lively", "warm"] },
  "large party dining": { constraints: ["private_dining"], vibes: ["lively", "warm"] },
  "dog friendly": { constraints: ["pet_friendly"], tags: ["outdoor patio"] },
  "dog friendly patio": { constraints: ["pet_friendly", "outdoor_preferred"], tags: ["outdoor patio"] },
  "outdoor seating": { constraints: ["outdoor_preferred"], tags: ["outdoor patio"] },
  "walk in friendly": { constraints: ["walk_in"], vibes: ["casual"] },
  "walk-in friendly": { constraints: ["walk_in"], vibes: ["casual"] },
  "walk in": { constraints: ["walk_in"] },
  "byob": { constraints: ["byob"], tags: ["great value", "byob"] },
  "byob restaurant": { constraints: ["byob"], tags: ["great value", "byob"] },
  "fancy dinner": { tags: ["fine dining"], vibes: ["elegant", "refined"], reputation_boost: true },
  "fancy dinner splurge": { tags: ["fine dining"], vibes: ["elegant", "refined"], reputation_boost: true, price_hint: "$$$$" },
  "cozy date night": { tags: ["romantic"], vibes: ["cozy", "intimate", "warm"] },
  "affordable date night": { tags: ["romantic", "great value"], vibes: ["cozy", "intimate"], constraints: ["budget_conscious"] },
  "high end tasting menu": { tags: ["fine dining", "tasting menu"], vibes: ["elegant", "refined"], reputation_boost: true, price_hint: "$$$$" },

  // Bar/nightlife concepts
  "dive bar": { vibes: ["casual", "no-frills", "lively"], tags: ["hidden gem", "great value", "craft cocktails"] },
  "karaoke bar": { vibes: ["lively", "buzzing", "casual"], tags: ["lively atmosphere", "late night"] },
  "sports bar": { vibes: ["lively", "casual", "buzzing"], tags: ["lively atmosphere"] },
  "cocktail bar": { vibes: ["refined", "intimate", "modern"], tags: ["craft cocktails"] },
  "wine bar": { vibes: ["cozy", "intimate", "refined"], tags: ["craft cocktails"] },
  "rooftop bar": { vibes: ["lively", "modern"], tags: ["rooftop", "outdoor patio"], constraints: ["outdoor_preferred"] },
  "rooftop dining": { vibes: ["modern", "lively"], tags: ["rooftop", "outdoor patio"], constraints: ["outdoor_preferred"] },
  "rooftop": { tags: ["rooftop", "outdoor patio"], constraints: ["outdoor_preferred"] },

  // Meta concepts
  "grandmother's cooking": { vibes: ["cozy", "warm", "rustic"], tags: ["great value"] },
  "underground food scene": { tags: ["hidden gem"], vibes: ["funky", "industrial"] },
  "food so good": { reputation_boost: true },
  "takes their craft seriously": { reputation_boost: true, vibes: ["refined"] },
  "best kept secret": { tags: ["hidden gem"] },
  "not tourist trap": { tags: ["hidden gem"], vibes: ["casual"] },
  "people watching": { tags: ["outdoor patio"], vibes: ["lively", "buzzing"] },
  "hear yourself talk": { tags: ["quiet"], vibes: ["intimate"] },
};

/**
 * V11: Expand semantic tags and intent into structured concept signals.
 * Merges all CONCEPT_MAP matches into a combined signal set.
 */
export function expandQueryConcepts(
  semanticTags: string[],
  specialRequest: string,
): ConceptSignal {
  const merged: ConceptSignal = {
    neighborhoods: [],
    tags: [],
    constraints: [],
    vibes: [],
    reputation_boost: false,
    cuisines: [],
  };

  const allSignals = [...semanticTags];
  // Also check the raw request for concept map keys
  const requestLower = specialRequest.toLowerCase();
  for (const key of Object.keys(CONCEPT_MAP)) {
    if (requestLower.includes(key.toLowerCase()) && !allSignals.includes(key)) {
      allSignals.push(key);
    }
  }

  for (const tag of allSignals) {
    const signal = CONCEPT_MAP[tag.toLowerCase()];
    if (!signal) continue;
    if (signal.neighborhoods) {
      for (const n of signal.neighborhoods) {
        if (!merged.neighborhoods!.includes(n)) merged.neighborhoods!.push(n);
      }
    }
    if (signal.tags) {
      for (const t of signal.tags) {
        if (!merged.tags!.includes(t)) merged.tags!.push(t);
      }
    }
    if (signal.constraints) {
      for (const c of signal.constraints) {
        if (!merged.constraints!.includes(c)) merged.constraints!.push(c);
      }
    }
    if (signal.vibes) {
      for (const v of signal.vibes) {
        if (!merged.vibes!.includes(v)) merged.vibes!.push(v);
      }
    }
    if (signal.reputation_boost) merged.reputation_boost = true;
    if (signal.cuisines) {
      for (const c of signal.cuisines) {
        if (!merged.cuisines!.includes(c)) merged.cuisines!.push(c);
      }
    }
  }

  return merged;
}

// Occasion noise/service expectations — retained from V8
const OCCASION_NOISE: Record<string, string[]> = {
  "Date Night": ["Quiet", "Moderate"], "Group Hangout": ["Moderate", "Loud"],
  "Family Dinner": ["Quiet", "Moderate"], "Business Lunch": ["Quiet"],
  "Solo Dining": ["Quiet", "Moderate"], "Special Occasion": ["Quiet"],
  "Treat Myself": ["Quiet", "Moderate"], Adventure: ["Moderate", "Loud", "Quiet"],
  "Chill Hangout": ["Moderate", "Quiet"], Any: ["Quiet", "Moderate"],
};

const SERVICE_CLASH: Record<string, string[]> = {
  "Special Occasion": ["Fast Casual", "Counter"],
  "Date Night": ["Fast Casual"],
  "Business Lunch": ["Counter", "Fast Casual"],
  "Group Hangout": ["Omakase"],
};

const SERVICE_FIT: Record<string, string[]> = {
  "Business Lunch": ["Full Table Service"],
  "Date Night": ["Full Table Service", "Omakase", "Tasting Menu", "Bar Service"],
  "Group Hangout": ["Full Table Service", "Family Style", "Fast Casual", "Bar Service"],
  "Family Dinner": ["Full Table Service", "Family Style"],
  "Solo Dining": ["Counter", "Bar Service", "Fast Casual", "Full Table Service"],
  "Special Occasion": ["Tasting Menu", "Omakase", "Full Table Service"],
  "Treat Myself": ["Full Table Service", "Omakase", "Tasting Menu", "Counter"],
  Adventure: ["Counter", "Family Style", "Omakase", "Full Table Service"],
  "Chill Hangout": ["Full Table Service", "Bar Service", "Fast Casual"],
};

const OCCASION_ENERGY: Record<string, [number, number]> = {
  "Date Night": [4, 7], "Group Hangout": [6, 9], "Family Dinner": [3, 6],
  "Business Lunch": [2, 5], "Solo Dining": [2, 6], "Special Occasion": [4, 7],
  "Treat Myself": [3, 7], Adventure: [4, 10], "Chill Hangout": [3, 6], Any: [3, 7],
};

const MUSIC_FIT: Record<string, string[]> = {
  "Date Night": ["live-jazz", "curated-playlist", "ambient"],
  "Business Lunch": ["ambient", "no-music"],
  "Group Hangout": ["curated-playlist", "DJ", "live-jazz", "live-band"],
  "Family Dinner": ["ambient", "no-music", "curated-playlist"],
  "Solo Dining": ["curated-playlist", "ambient", "no-music"],
  "Special Occasion": ["live-jazz", "curated-playlist", "ambient"],
  "Chill Hangout": ["curated-playlist", "ambient", "live-jazz"],
  Adventure: ["live-jazz", "live-band", "DJ", "curated-playlist"],
  "Treat Myself": ["curated-playlist", "ambient", "live-jazz"],
  Any: ["curated-playlist", "ambient"],
};

// ==========================================
// QUALITY WEIGHT PROFILES
// ==========================================

/**
 * Statistical foundation: Conditional probability
 * P(quality | match_type) has different factor distributions depending on query type.
 * This replaces V8's 14 weight-shift rules with 4 static profiles.
 */
const QUALITY_WEIGHTS: Record<V9RelevanceType, V9QualityWeights> = {
  dish: {
    // "I want momos" — food quality is what matters
    food: 0.40, reputation: 0.30, vibe: 0.10, service: 0.10, convenience: 0.10,
  },
  cuisine: {
    // "I want Thai food" — food quality + reputation
    food: 0.35, reputation: 0.30, vibe: 0.12, service: 0.12, convenience: 0.11,
  },
  vibe: {
    // "quiet intimate anniversary" — vibe is what matters
    // V12: Boosted vibe 0.40→0.45, reduced service 0.15→0.10 (low service shouldn't punish vibe matches)
    food: 0.10, reputation: 0.25, vibe: 0.45, service: 0.10, convenience: 0.10,
  },
  reputation: {
    // "michelin star", "best in chicago" — reputation dominates
    food: 0.15, reputation: 0.55, vibe: 0.10, service: 0.10, convenience: 0.10,
  },
  open_ended: {
    // "surprise me" — reputation is the deciding factor
    food: 0.13, reputation: 0.50, vibe: 0.15, service: 0.12, convenience: 0.10,
  },
// Note: multi_signal is NOT a V9RelevanceType — it's selected dynamically
// when a query has signals across 3+ categories
};

/** V11: Multi-signal weight profile — balanced when query spans food + vibe + constraints */
const MULTI_SIGNAL_WEIGHTS: V9QualityWeights = {
  food: 0.25, reputation: 0.25, vibe: 0.25, service: 0.15, convenience: 0.10,
};

// ==========================================
// RELEVANCE COMPUTATION (0-1.0) — THE GATE
// ==========================================

function isOpenEnded(intent: IntentClassificationV2): boolean {
  return (
    (intent.target_cuisines?.length ?? 0) === 0 &&
    (intent.target_tags?.length ?? 0) === 0 &&
    (intent.vibe_keywords?.length ?? 0) === 0 &&
    (intent.practical_constraints?.length ?? 0) === 0 &&
    (intent.flavor_preferences?.length ?? 0) === 0 &&
    !intent.dish_level_intent
  );
}

/**
 * Compute Relevance — "Does this restaurant match what the user is looking for?"
 *
 * Priority: dish > cuisine > vibe > open_ended
 * Uses review intelligence (evidence-based) as primary, structured data as fallback.
 */
export function computeRelevance(
  candidate: V9Candidate,
  intent: IntentClassificationV2 | null,
  specialRequest: string,
): V9Relevance {
  let weakVibeScore: number | null = null;

  // V10: Reputation-focused queries — check FIRST, unconditionally.
  // Reputation keywords ("michelin", "james beard", "best") are an explicit signal
  // that should override any cuisine/dish classification from Claude.
  // Without this, Claude sometimes returns target_cuisines (e.g. "French" for "michelin star"),
  // which blocks the reputation path and produces low relevance scores.
  if (isReputationQuery(intent, specialRequest)) {
    return computeReputationRelevance(candidate);
  }

  // No intent → everything is equally relevant (open-ended query)
  if (!intent || isOpenEnded(intent)) {
    return { score: 1.0, type: "open_ended", details: "No specific request — all restaurants relevant" };
  }

  // V11: Semantic concept matching — when semantic_tags are present, use them
  // as a BONUS relevance path alongside the existing hierarchy.
  // This doesn't override dish/cuisine/vibe — it provides an additional signal.
  const semanticTags = intent?.semantic_tags || [];

  const hasDish = !!intent.dish_level_intent;
  const hasCuisine = (intent.target_cuisines?.length ?? 0) > 0;
  const hasVibe = (intent.vibe_keywords?.length ?? 0) > 0 || (intent.target_tags?.length ?? 0) > 0;

  // === DISH-LEVEL RELEVANCE (highest priority) ===
  if (hasDish) {
    const dishRelevance = computeDishRelevance(candidate, intent, specialRequest);
    if (dishRelevance > 0) {
      return { score: dishRelevance, type: "dish", details: `Dish match: ${dishRelevance.toFixed(2)}` };
    }
    // Dish requested but not found → fall through to cuisine (penalized but not crushed)
    if (hasCuisine) {
      const cuisineRelevance = computeCuisineRelevance(candidate, intent);
      // Cap at 0.80 — right cuisine but wrong dish. The cuisine match still
      // carries significant weight (user wanted Italian → got Italian).
      // 0.75 still left fondue/romantic Italian at DM=57.
      return {
        score: Math.min(0.80, cuisineRelevance * 0.80),
        type: "cuisine",
        details: `Cuisine match but no dish (capped 0.80)`,
      };
    }
    // Dish requested, no cuisine match either → very low relevance
    return { score: 0.05, type: "dish", details: "No dish or cuisine match" };
  }

  // === CUISINE-LEVEL RELEVANCE ===
  if (hasCuisine) {
    const cuisineRelevance = computeCuisineRelevance(candidate, intent);
    return { score: cuisineRelevance, type: "cuisine", details: `Cuisine: ${cuisineRelevance.toFixed(2)}` };
  }

  // === VIBE-LEVEL RELEVANCE ===
  if (hasVibe) {
    const vibeRelevance = computeVibeRelevance(candidate, intent);
    // V11: Boost vibe relevance with semantic signal if available
    if (semanticTags.length > 0) {
      const semanticResult = computeSemanticRelevance(candidate, semanticTags, specialRequest);
      if (semanticResult && semanticResult.score > vibeRelevance) {
        return { score: Math.min(1.0, (vibeRelevance + semanticResult.score) / 2 + 0.10), type: "vibe", details: `Vibe+Semantic: ${((vibeRelevance + semanticResult.score) / 2).toFixed(2)}` };
      }
    }
    // V12: If vibe is the primary signal (2+ vibe keywords with no cuisine), always use vibe path.
    // Only defer to constraints/neighborhood when vibe is weak AND secondary.
    const vibeIsPrimary = (intent.vibe_keywords?.length ?? 0) >= 2 && !hasCuisine;
    // V12: Compute the no-hit floor to detect zero-hit vibe results.
    // When vibeRelevance equals floor (no actual tag matches), defer to constraint path
    // so constraint-driven queries (BYOB, budget, quiet+work) aren't trapped in vibe.
    const vibeFloor = (signals => signals.length >= 3 ? 0.55 : 0.60)([...new Set([...(intent.vibe_keywords || []), ...(intent.target_tags || [])])]);
    const hasVibeHits = vibeRelevance > vibeFloor + 0.001;
    if ((hasVibeHits && vibeRelevance > 0.50) || vibeIsPrimary) {
      // V12: Raised minimum from 0.55 to 0.65 so vibe queries have a viable DM floor
      return { score: Math.max(vibeRelevance, 0.65), type: "vibe", details: `Vibe: ${vibeRelevance.toFixed(2)}` };
    }
    // Store weak vibe as fallback — check constraints below, use max
    weakVibeScore = vibeRelevance;
  }

  // V11: Semantic concept matching for queries with semantic_tags but no food/vibe signals
  if (semanticTags.length > 0) {
    const semanticResult = computeSemanticRelevance(candidate, semanticTags, specialRequest);
    if (semanticResult && semanticResult.score > 0.50) {
      return semanticResult;
    }
  }

  // V12: Practical constraint relevance — when query is constraint-driven
  // (BYOB, outdoor, pet_friendly, walk_in, budget_conscious, tasting_menu, etc.)
  // boost relevance for restaurants that match those constraints
  if (intent?.practical_constraints?.length) {
    const dp = candidate.deep_profile;
    let constraintHits = 0;
    const constraintTotal = intent.practical_constraints.length;
    for (const c of intent.practical_constraints) {
      const cl = c.toLowerCase();
      if (cl === "byob" && dp?.byob_policy && dp.byob_policy !== "not_allowed" && dp.byob_policy !== "no") constraintHits++;
      else if (cl === "outdoor_preferred" && candidate.outdoor_seating) constraintHits++;
      else if (cl === "pet_friendly" && candidate.pet_friendly) constraintHits++;
      else if (cl === "walk_in" && dp?.reservation_difficulty === "walk_in_friendly") constraintHits++;
      else if (cl === "budget_conscious" && (candidate.price_level === "$" || candidate.price_level === "$$" || (dp?.check_average_per_person != null && dp.check_average_per_person <= 30))) constraintHits++;
      else if (cl === "tasting_menu" && (candidate.tags || []).some(t => tagToString(t).toLowerCase().includes("tasting"))) constraintHits++;
      else if (cl === "private_dining" && (candidate.tags || []).some(t => tagToString(t).toLowerCase().includes("private"))) constraintHits++;
      else if (cl === "quiet_environment" && candidate.noise_level === "Quiet") constraintHits++;
      else if (cl === "family_friendly" && dp?.kid_friendliness != null && dp.kid_friendliness >= 6) constraintHits++;
      else if (cl === "work_friendly" && (
        candidate.noise_level === "Quiet" ||
        (candidate.cuisine_type || "").toLowerCase().includes("coffee") ||
        (candidate.cuisine_type || "").toLowerCase().includes("cafe") ||
        (candidate.tags || []).some(t => tagToString(t).toLowerCase().includes("quiet") || tagToString(t).toLowerCase().includes("wifi") || tagToString(t).toLowerCase().includes("cafe"))
      )) constraintHits++;
    }
    if (constraintHits > 0) {
      const constraintRate = constraintHits / constraintTotal;
      // V12: Raised cap 0.90→0.95 and base 0.70→0.75 so strong constraint matches reach DM≥80
      const constraintRelevance = Math.min(0.95, 0.75 + 0.20 * constraintRate);
      return { score: constraintRelevance, type: "vibe", details: `Constraint match: ${constraintHits}/${constraintTotal} (${constraintRelevance.toFixed(2)})` };
    }
  }

  // Neighborhood relevance: if query mentions a neighborhood and restaurant is there, boost
  // V12: Increased neighborhood match to 0.90 (was 0.80) and added mismatch penalty (0.55)
  // to ensure "food near Wrigley Field" strongly prefers Lakeview restaurants
  if (specialRequest) {
    const reqLower = specialRequest.toLowerCase();
    let neighborhoodMentioned = false;
    for (const [alias, canonical] of Object.entries(NEIGHBORHOOD_ALIASES)) {
      if (reqLower.includes(alias)) {
        neighborhoodMentioned = true;
        const restNeighborhood = (candidate.neighborhood_name || "").toLowerCase();
        const canonicalLower = canonical.toLowerCase();
        if (restNeighborhood === canonicalLower || restNeighborhood.includes(canonicalLower) || canonicalLower.includes(restNeighborhood)) {
          // V12: Use vibe weights when tags present (e.g. "Wicker Park brunch") instead of reputation-heavy open_ended
          const matchType = hasVibe ? "vibe" as const : "open_ended" as const;
          return { score: 0.90, type: matchType, details: `Neighborhood match: ${canonical}` };
        }
        break;
      }
    }
    // If neighborhood was mentioned but restaurant isn't there, penalize
    if (neighborhoodMentioned) {
      const penaltyScore = weakVibeScore !== null ? Math.max(weakVibeScore, 0.55) : 0.55;
      return { score: penaltyScore, type: "open_ended", details: "Neighborhood mismatch penalty" };
    }
  }

  // Fallback: some intent but no clear food/vibe signal
  const fallbackScore = weakVibeScore !== null ? Math.max(weakVibeScore, 0.70) : 0.70;
  return { score: fallbackScore, type: "open_ended", details: "Weak signal" };
}

// ---- Dish Relevance (0-1.0) — Uses Review Intelligence ----

function computeDishRelevance(
  candidate: V9Candidate,
  intent: IntentClassificationV2,
  _specialRequest: string,
): number {
  const dish = intent.dish_level_intent!.toLowerCase();
  const ri = candidate.review_intelligence;

  // V10: Expand dish query with synonyms
  const dishVariants = expandDishQuery(dish);

  // Level 1: Review intelligence dish catalog — now with synonyms + fuzzy matching
  if (ri?.dish_catalog?.length) {
    // Exact/substring match against any variant
    for (const variant of dishVariants) {
      const exactDish = ri.dish_catalog.some(d =>
        d.toLowerCase().includes(variant) || variant.includes(d.toLowerCase())
      );
      if (exactDish) {
        const isPopular = ri.popular_dishes?.some(d =>
          dishVariants.some(v => d.toLowerCase().includes(v) || v.includes(d.toLowerCase()))
        );
        return isPopular ? 1.0 : 0.90;
      }
    }

    // V10: Fuzzy match against dish catalog (stemmed word overlap)
    let bestFuzzy = 0;
    for (const catalogDish of ri.dish_catalog) {
      for (const variant of dishVariants) {
        const score = fuzzyDishMatch(variant, catalogDish);
        if (score > bestFuzzy) bestFuzzy = score;
      }
    }
    if (bestFuzzy >= 0.5) return Math.min(0.85, 0.60 + bestFuzzy * 0.25);
  }

  // Level 2: Full-text search rank from SQL (already computed in RPC)
  if (candidate.ri_text_rank > 0.1) {
    return Math.min(0.85, 0.50 + candidate.ri_text_rank);
  }

  // Level 3: Structured data — signature_dishes, menu_highlights (with synonyms)
  const dp = candidate.deep_profile;
  if (dp?.signature_dishes?.length) {
    for (const variant of dishVariants) {
      const match = dp.signature_dishes.some(d =>
        d.dish.toLowerCase().includes(variant) || variant.includes(d.dish.toLowerCase())
      );
      if (match) return 0.85;
    }

    // V10: Fuzzy word-level match with stemming
    const dishStems = stemTokens(dish);
    const wordMatch = dp.signature_dishes.some(d => {
      const sigStems = stemTokens(d.dish);
      return dishStems.some(s => sigStems.includes(s));
    });
    if (wordMatch) return 0.50;
  }

  // Level 4: menu_highlights (AI-predicted) — now with synonyms
  if (dp?.menu_highlights?.length) {
    for (const variant of dishVariants) {
      if (dp.menu_highlights.some(h => h.toLowerCase().includes(variant))) {
        return 0.65;
      }
    }
  }

  // Level 5: No dish data at all
  return 0.0;
}

// ---- Cuisine Relevance (0-1.0) — Reuses V8 6-level Taxonomy ----

function computeCuisineRelevance(
  candidate: V9Candidate,
  intent: IntentClassificationV2,
): number {
  const targets = intent.target_cuisines || [];
  if (targets.length === 0) return 0.5;
  const ri = candidate.review_intelligence;

  // Review intelligence cuisine signals (NEW in V9)
  // Evidence-based: what reviewers actually say about the cuisine
  if (ri?.cuisine_signals?.length) {
    const riMatch = targets.some(t =>
      ri.cuisine_signals.some(s => s.toLowerCase() === t.toLowerCase())
    );
    if (riMatch) return 0.95; // Reviews confirm this cuisine
  }

  // Structured cuisine_type (same as V8 6-level taxonomy)
  if (candidate.cuisine_type) {
    const cl = candidate.cuisine_type.toLowerCase();
    if (targets.some(t => t.toLowerCase() === cl)) return 1.0;           // Exact
    if (targets.some(t => cl.includes(t.toLowerCase()) || t.toLowerCase().includes(cl))) return 0.80; // Contains
    if (isRelatedCuisine(candidate.cuisine_type, targets)) return 0.50;  // Same family
    if (isAdjacentCuisine(candidate.cuisine_type, targets)) return 0.30; // Adjacent
    return 0.05; // Different cuisine entirely
  }

  // No cuisine_type → check review intelligence
  if (ri?.cuisine_signals?.length) {
    // We have review data suggesting a cuisine but no structured match to target
    const riPartial = targets.some(t =>
      ri.cuisine_signals.some(s =>
        s.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(s.toLowerCase())
      )
    );
    return riPartial ? 0.70 : 0.15;
  }

  return 0.10; // No data at all
}

// ---- Reputation Relevance (0-1.0) — V10: Awards, Critics, Recognition ----

function computeReputationRelevance(candidate: V9Candidate): V9Relevance {
  const dp = candidate.deep_profile;
  const ri = candidate.review_intelligence;
  let score = 0.50; // Base: generous floor — reputation queries should still show good restaurants
  const signals: string[] = [];

  // Awards recognition (strongest signal)
  if (dp?.awards_recognition?.length) {
    const awardText = dp.awards_recognition.join(" ").toLowerCase();
    score += 0.25;
    signals.push(dp.awards_recognition[0]);
    // Extra boost for Michelin/James Beard specifically
    if (awardText.includes("michelin") || awardText.includes("james beard")) {
      score += 0.15;
    }
  }

  // Notable chef
  if (dp?.chef_notable) {
    score += 0.10;
    signals.push("Notable chef");
  }

  // High review intelligence food quality (8+/10) — strong indirect reputation signal
  if (ri?.review_food_quality != null && ri.review_food_quality >= 8) {
    score += 0.10;
  }

  // Neighborhood institution/destination — local reputation
  if (dp?.neighborhood_integration === "institution") {
    score += 0.05;
    signals.push("Neighborhood institution");
  } else if (dp?.neighborhood_integration === "destination") {
    score += 0.03;
  }

  // Trending score high — current popularity
  if (candidate.trending_score != null && Number(candidate.trending_score) >= 7) {
    score += 0.05;
  }

  return {
    score: Math.min(1.0, score),
    type: "reputation",
    details: signals.length > 0
      ? `Reputation match: ${signals.join(", ")}`
      : "Quality establishment",
  };
}

// ---- Vibe Relevance (0-1.0) — Tag + Deep Profile Matching ----

function computeVibeRelevance(
  candidate: V9Candidate,
  intent: IntentClassificationV2,
): number {
  // V12: Deduplicate signals — "romantic" appearing in both vibe_keywords and target_tags
  // shouldn't inflate the denominator and reduce hit rate
  const signals = [...new Set([...(intent.vibe_keywords || []), ...(intent.target_tags || [])])];
  if (signals.length === 0) return 0.80;

  const tags = (candidate.tags || []).map(t => tagToString(t).toLowerCase());
  const dp = candidate.deep_profile;
  const oneliner = (candidate.best_for_oneliner || "").toLowerCase();
  const ri = candidate.review_intelligence;

  let hits = 0;
  for (const signal of signals) {
    const sl = signal.toLowerCase();
    const slStemmed = stem(sl);
    // V9 signals
    if (tags.some(t => t.includes(sl) || t.includes(slStemmed))) { hits++; continue; }
    if (dp?.decor_style?.toLowerCase().includes(sl)) { hits++; continue; }
    if (dp?.music_vibe?.toLowerCase().includes(sl)) { hits++; continue; }
    if (dp?.wow_factors?.some(w => w.toLowerCase().includes(sl))) { hits++; continue; }
    if (dp?.service_style?.toLowerCase().includes(sl)) { hits++; continue; }
    if (oneliner.includes(sl)) { hits++; continue; }
    // V10: Additional signal sources for better vibe matching
    if (dp?.crowd_profile?.some((c: string) => c.toLowerCase().includes(sl))) { hits++; continue; }
    if (dp?.origin_story?.toLowerCase().includes(sl)) { hits++; continue; }
    if (dp?.unique_selling_point?.toLowerCase().includes(sl)) { hits++; continue; }
    if (dp?.date_progression?.toLowerCase().includes(sl)) { hits++; continue; }
    if (dp?.best_seat_in_house?.toLowerCase().includes(sl)) { hits++; continue; }
    if (ri?.cuisine_signals?.some(s => s.toLowerCase().includes(sl))) { hits++; continue; }
    // V10: Stemmed matching on tags for "romantic" → "romance", "intimate" → "intimacy" etc
    if (tags.some(t => stem(t).includes(slStemmed) || slStemmed.includes(stem(t)))) { hits++; continue; }
  }

  const hitRate = hits / signals.length;
  // V11: Dynamic floor — more signals = lower floor for differentiation
  // V12: Raised floors: 0.55/0.60 (was 0.45/0.50) to boost vibe queries toward DM≥80
  const floor = signals.length >= 3 ? 0.55 : 0.60;
  const range = 1.0 - floor;
  return floor + range * hitRate;
}

// ---- V11: Semantic Relevance (0-1.0) — Concept + Scenario Matching ----

function computeSemanticRelevance(
  candidate: V9Candidate,
  semanticTags: string[],
  specialRequest: string,
): V9Relevance | null {
  if (!semanticTags || semanticTags.length === 0) return null;

  const ri = candidate.review_intelligence;
  const dp = candidate.deep_profile;
  const tags = (candidate.tags || []).map(t => tagToString(t).toLowerCase());
  const oneliner = (candidate.best_for_oneliner || "").toLowerCase();

  let hits = 0;
  const matchedSignals: string[] = [];

  for (const semTag of semanticTags) {
    const stLower = semTag.toLowerCase();
    const stStemmed = stem(stLower);

    // Check against RI semantic_descriptors (V11 enrichment)
    if (ri?.semantic_descriptors?.some((d: string) => d.toLowerCase().includes(stLower) || stLower.includes(d.toLowerCase()))) {
      hits += 2; // Strong match — purpose-built for this
      matchedSignals.push(semTag);
      continue;
    }

    // Check against RI best_for_scenarios
    if (ri?.best_for_scenarios?.some((s: string) => s.toLowerCase().includes(stLower) || stLower.includes(s.toLowerCase()))) {
      hits += 2;
      matchedSignals.push(semTag);
      continue;
    }

    // Check against existing tags
    if (tags.some(t => t.includes(stLower) || stLower.includes(t))) {
      hits++;
      matchedSignals.push(semTag);
      continue;
    }

    // Check against wow_factors, crowd_profile, unique_selling_point
    if (dp?.wow_factors?.some((w: string) => w.toLowerCase().includes(stLower))) { hits++; matchedSignals.push(semTag); continue; }
    if (dp?.crowd_profile?.some((c: string) => c.toLowerCase().includes(stLower))) { hits++; matchedSignals.push(semTag); continue; }
    if (dp?.unique_selling_point?.toLowerCase().includes(stLower)) { hits++; matchedSignals.push(semTag); continue; }
    if (oneliner.includes(stLower)) { hits++; matchedSignals.push(semTag); continue; }
    if (dp?.origin_story?.toLowerCase().includes(stLower)) { hits++; matchedSignals.push(semTag); continue; }

    // Stemmed matching
    if (tags.some(t => stem(t).includes(stStemmed) || stStemmed.includes(stem(t)))) {
      hits += 0.5;
      matchedSignals.push(semTag);
      continue;
    }
  }

  // Score: each semantic tag has max weight of 2 (from RI) or 1 (from structured data)
  const maxScore = semanticTags.length * 2;
  if (maxScore === 0) return null;

  const hitRate = Math.min(1.0, hits / maxScore);
  const score = 0.40 + 0.60 * hitRate;

  return {
    score,
    type: "vibe", // Semantic queries use vibe relevance type for weight profile
    details: matchedSignals.length > 0
      ? `Semantic match: ${matchedSignals.slice(0, 3).join(", ")} (${hitRate.toFixed(2)})`
      : `Semantic: no direct matches`,
  };
}

// ==========================================
// QUALITY COMPUTATION (0-100) — THE RANK
// ==========================================

/**
 * Compute Quality — "How good is this restaurant at what the user cares about?"
 * Adapts quality weights based on the relevance type (query context).
 */
export function computeQuality(
  candidate: V9Candidate,
  relevanceType: V9RelevanceType,
  context: V9ScoringContext,
): { quality: number; weights: V9QualityWeights; factors: V9Factors; factorDetails: V9FactorDetails; factorConfidence: V9FactorConfidence } {
  // V11: Use multi-signal weights when query spans 3+ signal categories
  let weights = QUALITY_WEIGHTS[relevanceType];
  if (context.intent) {
    const signalCategories = [
      (context.intent.target_cuisines?.length ?? 0) > 0 || !!context.intent.dish_level_intent,
      (context.intent.vibe_keywords?.length ?? 0) > 0 || (context.intent.target_tags?.length ?? 0) > 0,
      (context.intent.practical_constraints?.length ?? 0) > 0,
      context.intent.emotional_intent !== "casual",
      (context.intent.flavor_preferences?.length ?? 0) > 0,
    ].filter(Boolean).length;
    if (signalCategories >= 3) {
      weights = MULTI_SIGNAL_WEIGHTS;
    }
  }

  // Compute raw quality dimensions (0-10 each) — now returns details + confidence
  const foodResult = computeFoodQuality(candidate, context.googleData, context.intent, relevanceType);
  const reputationResult = computeReputationQuality(candidate, context.googleData);
  const vibeResult = computeVibeQuality(candidate, context.occasion, context.intent);
  const serviceResult = computeServiceQuality(candidate, context.occasion, context.intent);
  const convenienceResult = computeConvenienceQuality(candidate, context.intent, context.clientTimeOfDay, context.specialRequest, context.priceLevel);

  const quality = (
    foodResult.score * weights.food +
    reputationResult.score * weights.reputation +
    vibeResult.score * weights.vibe +
    serviceResult.score * weights.service +
    convenienceResult.score * weights.convenience
  ) * 10; // Scale to 0-100

  return {
    quality: Math.min(100, Math.max(0, quality)),
    weights,
    factors: {
      food: foodResult.score,
      vibe: vibeResult.score,
      service: serviceResult.score,
      reputation: reputationResult.score,
      convenience: convenienceResult.score,
    },
    factorDetails: {
      food: foodResult.details,
      vibe: vibeResult.details,
      service: serviceResult.details,
      reputation: reputationResult.details,
      convenience: convenienceResult.details,
    },
    factorConfidence: {
      food: foodResult.confidence,
      vibe: vibeResult.confidence,
      service: serviceResult.confidence,
      reputation: reputationResult.confidence,
      convenience: convenienceResult.confidence,
    },
  };
}

// ---- Food Quality (0-10) — Blends Review Intelligence with Structured Data ----

function computeFoodQuality(
  candidate: V9Candidate,
  googleData: GooglePlaceData | null,
  intent: IntentClassificationV2 | null,
  relevanceType: V9RelevanceType,
): V9QualityResult {
  const ri = candidate.review_intelligence;
  const dp = candidate.deep_profile;
  const details: Record<string, V9SubComponent> = {};

  let score = 5.0; // Neutral starting point
  let signals = 0;
  let confidence: "high" | "medium" | "low" = "low";

  // Review intelligence food quality (strongest signal — from actual reviews)
  if (ri?.review_food_quality != null) {
    score = ri.review_food_quality; // 0-10 from review analysis
    signals += 3; // Weighted heavily (worth 3 other signals)
    details.review_quality = { score: ri.review_food_quality, max: 10, signal: "Review food quality score" };
    confidence = "high";
  }

  // Google rating as food proxy — Bayesian average
  if (googleData?.google_rating != null) {
    const BAYESIAN_C = 30;
    const BAYESIAN_M = 4.15;
    const reviewCount = googleData.google_review_count || 0;
    const bayesianRating = (BAYESIAN_C * BAYESIAN_M + reviewCount * googleData.google_rating) / (BAYESIAN_C + reviewCount);
    const googleFood = Math.max(0, Math.min(10, (bayesianRating - 3.0) / 2.0 * 10));
    score = signals > 0 ? (score * signals + googleFood) / (signals + 1) : googleFood;
    signals += 1;
    details.google = { score: Math.round(googleFood * 10) / 10, max: 10, signal: `Google ${googleData.google_rating} ★ (Bayesian)` };
    if (confidence === "low") confidence = "medium";
  }

  // Deep profile enrichment signals (minor adjustments)
  if (dp?.cultural_authenticity != null && dp.cultural_authenticity >= 8) {
    score += 0.5;
    details.authenticity = { score: 0.5, max: 0.5, signal: "Culturally authentic" };
  }
  if (dp?.awards_recognition?.length) {
    score += 0.3;
    details.awards = { score: 0.3, max: 0.3, signal: dp.awards_recognition[0] };
  }

  // B1: Review value score — blend for open-ended or budget-sensitive queries
  if (ri?.review_value_score != null && relevanceType === "open_ended") {
    score = (score * signals + ri.review_value_score * 0.5) / (signals + 0.5);
    signals += 0.5;
    details.value = { score: ri.review_value_score, max: 10, signal: "Review value score" };
  }

  // B2: Spice level matching — when user wants spicy food
  if (dp?.spice_level && intent) {
    const wantsSpicy = (intent.flavor_preferences || []).some((f: string) =>
      ["spicy", "spice", "hot", "fiery"].includes(f.toLowerCase())
    ) || (intent.vibe_keywords || []).some((v: string) => v.toLowerCase().includes("spic"));
    if (wantsSpicy) {
      const spiceMap: Record<string, number> = { mild: 3, medium: 7, hot: 9, extra_hot: 10, none: 0 };
      const spiceScore = spiceMap[dp.spice_level] ?? 5;
      score += (spiceScore / 10) * 0.5;
      details.spice = { score: spiceScore, max: 10, signal: `Spice level: ${dp.spice_level}` };
    }
  }

  // B3: Flavor profile matching — match intent.flavor_preferences against dp.flavor_profiles
  if (dp?.flavor_profiles?.length && intent?.flavor_preferences?.length) {
    const intentFlavors = intent.flavor_preferences.map((f: string) => f.toLowerCase());
    const profileFlavors = dp.flavor_profiles.map((f: string) => f.toLowerCase());
    const matches = intentFlavors.filter((f: string) =>
      profileFlavors.some((p: string) => p.includes(f) || f.includes(p))
    );
    if (matches.length > 0) {
      const flavorBonus = Math.min(0.8, matches.length * 0.4);
      score += flavorBonus;
      details.flavor = { score: matches.length, max: intentFlavors.length, signal: `Flavor match: ${matches.join(", ")}` };
    }
  }

  return { score: Math.min(10, Math.max(0, score)), details, confidence };
}

// ---- Reputation Quality (0-10) — Bayesian (retained from V8) ----

function computeReputationQuality(
  candidate: V9Candidate,
  googleData: GooglePlaceData | null,
): V9QualityResult {
  const dp = candidate.deep_profile;
  const ri = candidate.review_intelligence;
  const details: Record<string, V9SubComponent> = {};
  let score = 0;
  let confidence: "high" | "medium" | "low" = "low";

  // Google rating — Bayesian average (main reputation signal)
  if (googleData?.google_rating != null) {
    const BAYESIAN_C = 30;
    const BAYESIAN_M = 4.15;
    const reviewCount = googleData.google_review_count || 0;
    const bayesianRating = (BAYESIAN_C * BAYESIAN_M + reviewCount * googleData.google_rating) / (BAYESIAN_C + reviewCount);
    const googleBase = Math.max(0, Math.min(7, (bayesianRating - 3.5) / 1.5 * 10 * 0.85));
    score = googleBase;
    details.google = { score: Math.round(googleBase * 10) / 10, max: 7, signal: `Google ${googleData.google_rating} ★ (Bayesian)` };
    confidence = "medium";
  } else {
    // Internal reputation signals when Google data is absent
    let internalRep = 3.0;
    if (dp?.awards_recognition?.length) internalRep += 1.5;
    if (dp?.chef_notable) internalRep += 1.0;
    if (dp?.cultural_authenticity != null && dp.cultural_authenticity >= 8) internalRep += 0.5;
    if (dp?.neighborhood_integration === "institution") internalRep += 0.5;
    else if (dp?.neighborhood_integration === "destination") internalRep += 0.3;
    if (candidate.trending_score != null && Number(candidate.trending_score) >= 7) internalRep += 0.5;
    score = Math.min(7, internalRep);
  }

  // Review intelligence service quality (NEW in V9 — supplements single Google rating)
  if (ri?.review_service_quality != null) {
    score = (score * 2 + ri.review_service_quality) / 3;
    details.review_service = { score: Math.round(ri.review_service_quality * 10) / 10, max: 10, signal: "Review service quality" };
    confidence = "high";
  }

  // Awards and community bonus (0-1.5)
  let bonus = 0;
  if (dp?.awards_recognition?.length) {
    bonus += 0.4;
    details.awards = { score: 0.4, max: 0.4, signal: dp.awards_recognition[0] };
  }
  if (dp?.chef_notable) {
    bonus += 0.3;
    details.chef = { score: 0.3, max: 0.3, signal: "Notable chef" };
  }
  if (dp?.cultural_authenticity != null && dp.cultural_authenticity >= 8) bonus += 0.3;
  if (dp?.neighborhood_integration === "institution") bonus += 0.2;
  else if (dp?.neighborhood_integration === "destination") bonus += 0.1;
  if (candidate.trending_score != null && Number(candidate.trending_score) >= 7) {
    bonus += 0.2;
    details.trending = { score: 0.2, max: 0.2, signal: "Currently trending" };
  }

  score += Math.min(1.5, bonus);

  return { score: Math.min(10, Math.max(0, score)), details, confidence };
}

// ---- Vibe Quality (0-10) — Occasion + Atmosphere Matching ----

function computeVibeQuality(
  candidate: V9Candidate,
  occasion: string,
  intent: IntentClassificationV2 | null,
): V9QualityResult {
  const dp = candidate.deep_profile;
  const ri = candidate.review_intelligence;
  const details: Record<string, V9SubComponent> = {};
  let score = 0;
  let scorePossible = 0;
  let hasData = false;

  // Noise fit (0-3)
  const expectedNoise = OCCASION_NOISE[occasion] || ["Moderate"];
  scorePossible += 3;
  let noisePoints = 1.5;
  if (candidate.noise_level) {
    noisePoints = expectedNoise.includes(candidate.noise_level) ? 3 : 0.5;
    hasData = true;
  }
  score += noisePoints;
  details.noise = { score: Math.round(noisePoints * 10) / 10, max: 3, signal: candidate.noise_level ? `Noise: ${candidate.noise_level} (expected: ${expectedNoise.join("/")})` : "No noise data" };

  // Energy fit (0-2)
  scorePossible += 2;
  let energyPoints = 1;
  if (dp?.energy_level != null) {
    const [eMin, eMax] = OCCASION_ENERGY[occasion] || [3, 7];
    if (dp.energy_level >= eMin && dp.energy_level <= eMax) energyPoints = 2;
    else {
      const mid = (eMin + eMax) / 2;
      energyPoints = Math.max(0, 2 - Math.abs(dp.energy_level - mid) * 0.4);
    }
    hasData = true;
  }
  score += energyPoints;
  details.energy = { score: Math.round(energyPoints * 10) / 10, max: 2, signal: dp?.energy_level != null ? `Energy level ${dp.energy_level}/10` : "No energy data" };

  // Music fit (0-1.5)
  scorePossible += 1.5;
  let musicPoints = 0.75;
  if (dp?.music_vibe) {
    const fits = MUSIC_FIT[occasion] || [];
    musicPoints = fits.includes(dp.music_vibe) ? 1.5 : 0.5;
    hasData = true;
  }
  score += musicPoints;
  details.music = { score: Math.round(musicPoints * 10) / 10, max: 1.5, signal: dp?.music_vibe || "No music data" };

  // Review intelligence ambiance quality (NEW in V9)
  scorePossible += 3;
  let ambiancePoints = 1.5;
  if (ri?.review_ambiance_quality != null) {
    ambiancePoints = (ri.review_ambiance_quality / 10) * 3;
    hasData = true;
  }
  score += ambiancePoints;
  details.ambiance = { score: Math.round(ambiancePoints * 10) / 10, max: 3, signal: ri?.review_ambiance_quality != null ? `Ambiance quality ${ri.review_ambiance_quality}/10` : "No ambiance data" };

  // B4: Instagram worthiness — bonus when user seeks photogenic/instagrammable
  if (dp?.instagram_worthiness != null && intent) {
    const wantsGram = (intent.target_tags || []).some((t: string) =>
      t.toLowerCase().includes("instagram") || t.toLowerCase().includes("photogenic")
    ) || (intent.vibe_keywords || []).some((v: string) =>
      v.toLowerCase().includes("instagram") || v.toLowerCase().includes("photo")
    );
    if (wantsGram) {
      const gramBonus = (dp.instagram_worthiness / 10) * 1.5;
      score += gramBonus;
      scorePossible += 1.5;
      details.instagram = { score: Math.round(gramBonus * 10) / 10, max: 1.5, signal: `Instagram worthiness: ${dp.instagram_worthiness}/10` };
    }
  }

  // Normalize to 0-10
  const normalized = scorePossible > 0 ? (score / scorePossible) * 10 : 5;
  const confidence: "high" | "medium" | "low" = (ri?.review_ambiance_quality != null && dp?.energy_level != null) ? "high" : hasData ? "medium" : "low";
  return { score: Math.min(10, Math.max(0, normalized)), details, confidence };
}

// ---- Service Quality (0-10) — Occasion Fit + Service Style ----

function computeServiceQuality(
  candidate: V9Candidate,
  occasion: string,
  intent: IntentClassificationV2 | null,
): V9QualityResult {
  const dp = candidate.deep_profile;
  const details: Record<string, V9SubComponent> = {};
  let score = 0;

  // Occasion base score (0-6)
  const occasionBase = computeWeightedOccasionScore(candidate, occasion);
  const occasionPoints = Math.pow(Math.max(0, occasionBase) / 10, 0.85) * 6;
  score += occasionPoints;
  details.occasion = { score: Math.round(occasionPoints * 10) / 10, max: 6, signal: `Occasion score for ${occasion}` };

  // Service style fit (0-2)
  let serviceStylePoints = 1;
  if (dp?.service_style) {
    const fits = SERVICE_FIT[occasion] || [];
    if (fits.includes(dp.service_style)) serviceStylePoints = 2;
    else serviceStylePoints = 1;
    const clashes = SERVICE_CLASH[occasion] || [];
    if (clashes.includes(dp.service_style)) serviceStylePoints -= 2;
  }
  score += serviceStylePoints;
  details.service = { score: Math.max(0, Math.round(serviceStylePoints * 10) / 10), max: 2, signal: dp?.service_style || "No service style data" };

  // Social dynamics (0-2)
  let socialScore = 0;
  let socialSignal = "Social fit";
  if (dp?.kid_friendliness != null && occasion === "Family Dinner") {
    if (dp.kid_friendliness >= 7) { socialScore += 0.75; socialSignal = "Kid-friendly"; }
    else if (dp.kid_friendliness >= 5) { socialScore += 0.25; socialSignal = "Somewhat kid-friendly"; }
  }
  if (dp?.conversation_friendliness != null &&
    ["Date Night", "Business Lunch", "Special Occasion"].includes(occasion)) {
    if (dp.conversation_friendliness >= 7) { socialScore += 0.5; socialSignal = "Great for conversation"; }
  }
  const clampedSocial = Math.min(2, Math.max(0, socialScore));
  score += clampedSocial;
  details.social = { score: Math.round(clampedSocial * 10) / 10, max: 2, signal: socialSignal };

  // B6: Crowd profile matching — bonus when crowd matches occasion
  const CROWD_OCCASION_FIT: Record<string, string[]> = {
    "Group Hangout": ["young_professionals", "college_crowd", "diverse"],
    "Date Night": ["couples", "young_professionals"],
    "Family Dinner": ["families", "mixed_ages"],
    "Business Lunch": ["business_professional", "young_professionals"],
  };
  if (dp?.crowd_profile?.length) {
    const expectedCrowds = CROWD_OCCASION_FIT[occasion] || [];
    if (expectedCrowds.length > 0) {
      const crowdMatch = dp.crowd_profile.some((c: string) => expectedCrowds.includes(c));
      if (crowdMatch) {
        score += 0.5;
        details.crowd = { score: 0.5, max: 0.5, signal: `Crowd: ${dp.crowd_profile.join(", ")}` };
      }
    }
  }

  // Occasion "Any" with no data → use computed service components (style, social, crowd)
  // instead of flat 5.0 which was suppressing differentiation
  if (occasion === "Any" && occasionBase === 0) {
    // score already includes serviceStylePoints (0-2), socialScore (0-2), crowd (0-0.5)
    // Rebase around 5.5 using what we have: base 5.0 + any service/social/crowd bonuses
    const anyScore = 5.0 + (serviceStylePoints - 1) + clampedSocial * 0.5;
    // Boost from review intelligence service quality and trending score
    const ri = candidate.review_intelligence;
    const riServiceAdj = ri?.review_service_quality != null ? Math.max(0, (ri.review_service_quality - 6) * 0.4) : 0;
    const trendAdj = candidate.trending_score != null ? Math.max(0, (Number(candidate.trending_score) - 5) * 0.2) : 0;
    const finalAny = Math.min(8, Math.max(4, anyScore + riServiceAdj + trendAdj));
    details.occasion = { score: Math.round(finalAny * 10) / 10, max: 10, signal: "Service quality (Any occasion)" };
    return { score: finalAny, details, confidence: "low" };
  }

  const confidence: "high" | "medium" | "low" = (dp?.service_style && dp?.kid_friendliness != null) ? "high" : dp?.service_style ? "medium" : "low";
  return { score: Math.min(10, Math.max(0, score)), details, confidence };
}

function computeWeightedOccasionScore(profile: RestaurantProfile, occasion: string): number {
  if (occasion === "Any") {
    const total =
      (profile.date_friendly_score || 0) + (profile.group_friendly_score || 0) +
      (profile.family_friendly_score || 0) + (profile.romantic_rating || 0) +
      (profile.business_lunch_score || 0) + (profile.solo_dining_score || 0) +
      (profile.hole_in_wall_factor || 0);
    return (total / 70) * 10;
  }
  const weights = OCCASION_WEIGHTS[occasion];
  if (!weights) return (profile.date_friendly_score || 0);
  let score = 0;
  for (const [field, weight] of Object.entries(weights)) {
    score += ((profile[field as keyof RestaurantProfile] as number) ?? 0) * weight;
  }
  return score;
}

// ---- Convenience Quality (0-10) — Timing + Accessibility ----

function computeConvenienceQuality(
  candidate: V9Candidate,
  intent: IntentClassificationV2 | null,
  clientTimeOfDay?: string | null,
  specialRequest?: string,
  priceLevel?: string,
): V9QualityResult {
  const dp = candidate.deep_profile;
  const requestLower = (specialRequest || "").toLowerCase();
  const details: Record<string, V9SubComponent> = {};
  let score = 5; // neutral start
  let hasData = false;

  // Timing fit
  let timingAdj = 0;
  if (clientTimeOfDay && candidate.best_times?.length) {
    if (candidate.best_times.includes(clientTimeOfDay)) { timingAdj = 2; }
    else if (candidate.best_times.length <= 2) { timingAdj = -1.5; }
    else { timingAdj = -0.5; }
    hasData = true;
  }
  score += timingAdj;
  details.timing = { score: Math.max(0, 2 + timingAdj), max: 4, signal: clientTimeOfDay ? `Best at ${clientTimeOfDay}` : "No timing data" };

  // Reservation accessibility
  let reservationAdj = 0;
  if (dp?.reservation_difficulty) {
    const isSpontaneous = intent?.spontaneity === "spontaneous"
      || /tonight|right now|last minute|walk.?in|spontaneous/.test(requestLower);
    if (dp.reservation_difficulty === "hard_to_get" && isSpontaneous) reservationAdj = -2;
    else if (dp.reservation_difficulty === "walk_in_friendly") reservationAdj = isSpontaneous ? 1.5 : 0.5;
    hasData = true;
  }
  score += reservationAdj;
  details.reservation = { score: Math.max(0, 1.5 + reservationAdj), max: 3.5, signal: dp?.reservation_difficulty || "No reservation data" };

  // Wait time
  let waitAdj = 0;
  if (dp?.typical_wait_minutes != null) {
    if (dp.typical_wait_minutes > 60) waitAdj = -1.0;
    else if (dp.typical_wait_minutes > 30) waitAdj = -0.5;
    else waitAdj = 0.5;
    hasData = true;
    details.wait = { score: Math.max(0, 0.5 + waitAdj), max: 1.5, signal: `~${dp.typical_wait_minutes} min wait` };
  }
  score += waitAdj;

  // Parking
  let parkingAdj = 0;
  if (candidate.parking_availability && !/none|no /i.test(candidate.parking_availability)) {
    parkingAdj = 0.5;
    hasData = true;
    details.parking = { score: 0.5, max: 0.5, signal: candidate.parking_availability };
  }
  score += parkingAdj;

  // B7: Budget precision — check_average_per_person against price level
  if (dp?.check_average_per_person != null && priceLevel && priceLevel !== "Any") {
    const PRICE_LEVEL_RANGES: Record<string, [number, number]> = {
      "$": [0, 20], "$$": [20, 45], "$$$": [45, 80], "$$$$": [80, 999],
    };
    const range = PRICE_LEVEL_RANGES[priceLevel];
    if (range) {
      const [lo, hi] = range;
      const avg = dp.check_average_per_person;
      if (avg >= lo && avg <= hi) {
        score += 0.5;
        details.budget = { score: 1, max: 1, signal: `~$${avg}/person (within budget)` };
      } else if (avg > hi * 1.3) {
        score -= 1.0;
        details.budget = { score: 0, max: 1, signal: `~$${avg}/person (above budget)` };
      }
      hasData = true;
    }
  }

  // V12: Budget detection from request text (when price_level is "Any")
  if ((!priceLevel || priceLevel === "Any") && /cheap|budget|affordable|under \$?\d+|inexpensive|low.?cost|great value/i.test(requestLower)) {
    if (dp?.check_average_per_person != null && dp.check_average_per_person <= 25) {
      score += 1.0;
      details.budget = { score: 1.5, max: 2, signal: `~$${dp.check_average_per_person}/person (budget match)` };
      hasData = true;
    } else if (candidate.price_level === "$" || candidate.price_level === "$$") {
      score += 0.5;
      details.budget = { score: 1, max: 2, signal: `${candidate.price_level} (budget-friendly)` };
      hasData = true;
    }
  }

  // V10: Practical constraint matching from intent
  if (intent?.practical_constraints?.length) {
    let constraintHits = 0;
    let constraintTotal = 0;
    for (const constraint of intent.practical_constraints) {
      const cl = constraint.toLowerCase();
      constraintTotal++;

      if (cl === "byob" && dp?.byob_policy) {
        if (dp.byob_policy !== "not_allowed" && dp.byob_policy !== "no") {
          constraintHits++;
          score += 0.5;
        } else {
          score -= 0.5;
        }
      } else if (cl === "outdoor_preferred" && candidate.outdoor_seating) {
        constraintHits++;
        score += 0.5;
      } else if (cl === "pet_friendly" && candidate.pet_friendly) {
        constraintHits++;
        score += 0.5;
      } else if (cl === "walk_in" && dp?.reservation_difficulty === "walk_in_friendly") {
        constraintHits++;
        score += 0.5;
      } else if (cl === "parking_needed" && candidate.parking_availability &&
                 !/none|no /i.test(candidate.parking_availability)) {
        constraintHits++;
        score += 0.3;
      } else if (cl === "budget_conscious") {
        if (dp?.check_average_per_person != null && dp.check_average_per_person <= 25) {
          constraintHits++;
          score += 0.5;
        } else if (candidate.price_level === "$" || candidate.price_level === "$$") {
          constraintHits++;
          score += 0.3;
        }
      } else if (cl === "quiet_environment") {
        if (candidate.noise_level === "Quiet") { constraintHits++; score += 0.5; }
        else if (candidate.noise_level === "Moderate") { constraintHits += 0.5; score += 0.2; }
      } else if (cl === "private_dining" && dp?.service_style) {
        if (candidate.tags?.some(t => tagToString(t).toLowerCase().includes("private"))) {
          constraintHits++;
          score += 0.5;
        }
      } else if (cl === "halal" || cl === "kosher") {
        const dietaryOpts = (candidate.dietary_options || "").toLowerCase();
        if (dietaryOpts.includes(cl)) {
          constraintHits++;
          score += 0.5;
        }
      } else if (cl === "family_friendly") {
        if (dp?.kid_friendliness != null && dp.kid_friendliness >= 6) {
          constraintHits++;
          score += 0.5;
        }
      } else if (cl === "tasting_menu") {
        if (candidate.tags?.some(t => tagToString(t).toLowerCase().includes("tasting"))) {
          constraintHits++;
          score += 0.5;
        }
      }
    }
    if (constraintTotal > 0) {
      details.constraints = {
        score: constraintHits,
        max: constraintTotal,
        signal: `${constraintHits}/${constraintTotal} constraints met`,
      };
      hasData = true;
    }
  }

  // V12: Neighborhood match boost — when query mentions a neighborhood,
  // reward restaurants that are actually in that neighborhood
  if (specialRequest) {
    const reqLower = specialRequest.toLowerCase();
    for (const [alias, canonical] of Object.entries(NEIGHBORHOOD_ALIASES)) {
      if (reqLower.includes(alias)) {
        const restNeighborhood = (candidate.neighborhood_name || "").toLowerCase();
        const canonicalLower = canonical.toLowerCase();
        if (restNeighborhood === canonicalLower || restNeighborhood.includes(canonicalLower) || canonicalLower.includes(restNeighborhood)) {
          score += 2.0;
          details.neighborhood = { score: 2, max: 2, signal: `In ${canonical}` };
        } else {
          score -= 0.5;
          details.neighborhood = { score: 0, max: 2, signal: `Not in ${canonical}` };
        }
        hasData = true;
        break;
      }
    }
  }

  const confidence: "high" | "medium" | "low" = (clientTimeOfDay && dp?.reservation_difficulty) ? "high" : hasData ? "medium" : "low";
  return { score: Math.min(10, Math.max(0, score)), details, confidence };
}

// ==========================================
// OCCASION BONUS (±5 tiebreaker)
// ==========================================

// V12: Infer occasion from intent when user sends "Any" (default)
function inferOccasion(intent: IntentClassificationV2 | null): string | null {
  if (!intent) return null;
  const emo = intent.emotional_intent?.toLowerCase() || "";
  const vibes = (intent.vibe_keywords || []).map(v => v.toLowerCase());
  const tags = (intent.target_tags || []).map(t => t.toLowerCase());
  const all = [...vibes, ...tags, emo];
  if (all.some(s => s.includes("birthday") || s.includes("anniversar") || s.includes("celebrat"))) return "Special Occasion";
  if (all.some(s => s.includes("romantic") || s.includes("date") || s.includes("intimate"))) return "Date Night";
  if (all.some(s => s.includes("group") || s.includes("party") || s.includes("friends"))) return "Group Hangout";
  if (all.some(s => s.includes("family") || s.includes("kid"))) return "Family Dinner";
  if (all.some(s => s.includes("business") || s.includes("work") || s.includes("client"))) return "Business Lunch";
  if (all.some(s => s.includes("solo") || s.includes("alone"))) return "Solo Dining";
  if (all.some(s => s.includes("fun") || s.includes("lively") || s.includes("adventure"))) return "Adventure";
  return null;
}

function computeOccasionBonus(
  candidate: V9Candidate,
  occasion: string,
  _intent: IntentClassificationV2 | null,
): number {
  // V12: Infer occasion from intent signals when user didn't specify one
  const inferred = occasion === "Any";
  const effectiveOccasion = !inferred ? occasion : inferOccasion(_intent) || "Any";
  if (effectiveOccasion === "Any") return 0;
  occasion = effectiveOccasion;

  const dp = candidate.deep_profile;

  // Service style clash: -5 (only for explicit occasions — inferred shouldn't penalize)
  if (!inferred) {
    const clashes = SERVICE_CLASH[occasion] || [];
    if (dp?.service_style && clashes.includes(dp.service_style)) return -5;
  }

  // Noise mismatch: -2 (only for explicit occasions)
  if (!inferred) {
    const expectedNoise = OCCASION_NOISE[occasion] || [];
    if (candidate.noise_level && !expectedNoise.includes(candidate.noise_level)) return -2;
  }

  // Good occasion fit: +3 to +5
  const occasionScore = computeWeightedOccasionScore(candidate, occasion);
  if (occasionScore >= 8) return +5;
  if (occasionScore >= 6) return +3;

  return 0;
}

// ==========================================
// MATCH NARRATIVE
// ==========================================

function generateV9MatchNarrative(
  relevance: V9Relevance,
  quality: number,
  weights: V9QualityWeights,
  intent: IntentClassificationV2 | null,
  candidate: V9Candidate,
): MatchNarrative {
  // Determine strongest quality factor
  const factorContributions = [
    { factor: "food", weight: weights.food },
    { factor: "reputation", weight: weights.reputation },
    { factor: "vibe", weight: weights.vibe },
    { factor: "service", weight: weights.service },
    { factor: "convenience", weight: weights.convenience },
  ];
  factorContributions.sort((a, b) => b.weight - a.weight);
  const strongestFactor = factorContributions[0].factor;

  const FACTOR_LABELS: Record<string, Record<string, string>> = {
    food: { high: "Outstanding Cuisine Match", medium: "Good Food Fit", low: "Decent Menu" },
    vibe: { high: "Perfect Atmosphere", medium: "Good Vibe Match", low: "Adequate Setting" },
    service: { high: "Excellent Service Fit", medium: "Good Service Match", low: "Standard Service" },
    reputation: { high: "Highly Regarded", medium: "Well Reviewed", low: "Decent Reputation" },
    convenience: { high: "Very Convenient", medium: "Reasonably Convenient", low: "Some Tradeoffs" },
  };

  const tier = quality >= 70 ? "high" : quality >= 50 ? "medium" : "low";
  const strongestLabel = FACTOR_LABELS[strongestFactor]?.[tier] || "Strong Match";

  // Build key signals
  const keySignals: string[] = [];

  // Relevance-based signals
  if (relevance.type === "dish" && intent?.dish_level_intent) {
    const ri = candidate.review_intelligence;
    if (ri?.popular_dishes?.some(d => d.toLowerCase().includes(intent.dish_level_intent!.toLowerCase()))) {
      keySignals.push(`${intent.dish_level_intent} is a popular menu item`);
    } else if (ri?.dish_catalog?.some(d => d.toLowerCase().includes(intent.dish_level_intent!.toLowerCase()))) {
      keySignals.push(`${intent.dish_level_intent} confirmed by reviews`);
    } else {
      keySignals.push(`Matches ${intent.dish_level_intent}`);
    }
  }
  if (relevance.type === "cuisine" && intent?.target_cuisines?.length) {
    keySignals.push(`Matches ${intent.target_cuisines[0]} cuisine`);
  }
  if (relevance.type === "reputation") {
    keySignals.push("Recognized quality establishment");
  }
  if (relevance.score >= 0.90) {
    keySignals.push("Strong relevance match");
  }

  // Quality signals
  const dp = candidate.deep_profile;
  if (dp?.awards_recognition?.length) {
    keySignals.push(dp.awards_recognition[0]);
  }
  if (dp?.cultural_authenticity != null && dp.cultural_authenticity >= 8) {
    keySignals.push("Culturally authentic");
  }

  const trimmedSignals = keySignals.slice(0, 3);

  let summary = strongestLabel;
  if (trimmedSignals.length > 0) summary += ` \u2014 ${trimmedSignals[0].toLowerCase()}`;

  const weakSpots: string[] = [];
  if (quality < 40) weakSpots.push("Below average quality");
  if (relevance.score < 0.5 && relevance.type !== "open_ended") weakSpots.push("Partial relevance match");

  let confidenceCaveat: string | null = null;
  if (!dp || (dp.enrichment_confidence ?? 0) < 0.3) {
    confidenceCaveat = "Limited data available \u2014 score may update with more information";
  }

  return {
    strongest_factor: strongestFactor,
    strongest_factor_label: strongestLabel,
    key_signals: trimmedSignals,
    comparison_context: null,
    summary,
    weak_spots: weakSpots,
    confidence_caveat: confidenceCaveat,
  };
}

// ==========================================
// V9 DONDE MATCH (full pipeline)
// ==========================================

/**
 * Compute the V9 Donde Match score for a single candidate.
 *
 * Pipeline:
 * 1. Compute Relevance (the GATE) — uses review intelligence + structured data
 * 2. Compute Quality (the RANK) — query-type-aware weighted mean
 * 3. Score = Relevance × Quality
 * 4. Occasion adjustment (±5 tiebreaker)
 * 5. Generate match narrative
 */
export function computeV9Score(
  candidate: V9Candidate,
  context: V9ScoringContext,
): V9ScoreResult {

  // Step 1: Compute Relevance (the GATE)
  const relevance = computeRelevance(candidate, context.intent, context.specialRequest);

  // Step 2: Compute Quality (the RANK)
  const { quality, weights, factors, factorDetails, factorConfidence } = computeQuality(candidate, relevance.type, context);

  // Step 3: V10 confidence-weighted quality adjustment
  // When data is sparse, shrink quality toward conservative mean slightly.
  // This prevents restaurants with missing data from getting inflated neutral scores.
  const dp = candidate.deep_profile;
  const hasRI = candidate.review_intelligence != null;
  const hasDP = dp != null;
  const dataCompleteness = (hasRI ? 0.4 : 0) + (hasDP ? 0.4 : 0) + (dp?.enrichment_confidence ?? 0) * 0.2;
  // V11: Reduced pull-to-center for better score differentiation
  const CONFIDENCE_MEAN = 55;
  const confidenceFactor = 0.80 + 0.20 * dataCompleteness; // 0.80 to 1.0 (gentler penalty)
  const adjustedQuality = CONFIDENCE_MEAN + (quality - CONFIDENCE_MEAN) * confidenceFactor;

  // Step 3b: V9 Score = Relevance × Quality (now confidence-adjusted)
  const v9Score = Math.round(relevance.score * adjustedQuality);

  // Step 4: Occasion adjustment (±5 max, tiebreaker only)
  const occasionBonus = computeOccasionBonus(candidate, context.occasion, context.intent);
  const finalScore = Math.min(99, Math.max(0, v9Score + occasionBonus));

  // Step 5: Data completeness (already computed in Step 3)

  // Step 6: Generate match narrative
  const matchNarrative = generateV9MatchNarrative(
    relevance, quality, weights, context.intent, candidate,
  );

  return {
    dondeMatch: finalScore,
    relevance,
    quality,
    factors,
    qualityWeights: weights,
    occasionBonus,
    matchNarrative,
    dataCompleteness,
    factorDetails,
    factorConfidence,
  };
}

// ==========================================
// V9 RE-RANK
// ==========================================

/**
 * Score and rank a list of V9 candidates.
 * Returns sorted array with comparison context in narratives.
 */
export function reRankV9(
  candidates: V9Candidate[],
  context: V9ScoringContext,
): V9ScoredCandidate[] {
  const scored = candidates.map(candidate => {
    const result = computeV9Score(candidate, context);
    return {
      profile: candidate as RestaurantProfile,
      dondeMatch: result.dondeMatch,
      relevance: result.relevance,
      quality: result.quality,
      factors: result.factors,
      qualityWeights: result.qualityWeights,
      occasionBonus: result.occasionBonus,
      matchNarrative: result.matchNarrative,
      dataCompleteness: result.dataCompleteness,
      factorDetails: result.factorDetails,
      factorConfidence: result.factorConfidence,
      reviewIntelligence: candidate.review_intelligence,
    };
  });

  // Sort by DondeMatch — relevance is already factored in
  scored.sort((a, b) => b.dondeMatch - a.dondeMatch);

  // V12: User preference tiebreaker — boost restaurants matching user's historical preferences
  // Conservative: max +3, only on cuisine match, only for authenticated users with history
  if (context.userPreferences?.topCuisines?.length) {
    const prefs = context.userPreferences;
    for (const item of scored) {
      const cuisineType = (item.profile as Record<string, unknown>).cuisine_type as string | null;
      if (!cuisineType) continue;
      const cuisineLower = cuisineType.toLowerCase();
      const cuisineMatch = prefs.topCuisines.some(c =>
        cuisineLower.includes(c.toLowerCase())
      );
      if (cuisineMatch) {
        item.dondeMatch = Math.min(99, item.dondeMatch + 3);
      }
    }
    // Re-sort after preference adjustment
    scored.sort((a, b) => b.dondeMatch - a.dondeMatch);
  }

  // Add comparison context to narratives
  if (scored.length >= 2) {
    const topScore = scored[0].dondeMatch;
    for (let i = 0; i < scored.length; i++) {
      const gap = topScore - scored[i].dondeMatch;
      if (i === 0 && scored.length > 1) {
        scored[i].matchNarrative.comparison_context =
          `${topScore - scored[1].dondeMatch} points ahead of next option`;
      } else if (gap > 0) {
        scored[i].matchNarrative.comparison_context =
          `${gap} points behind top pick`;
      }
    }
  }

  return scored;
}
