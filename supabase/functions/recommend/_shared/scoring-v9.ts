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
  "tacos": ["taco", "street tacos", "birria tacos", "al pastor tacos", "fish tacos", "carnitas tacos"],
  "burger": ["burgers", "hamburger", "hamburgers", "smash burger", "smashburger"],
  "smash burger": ["burger", "smashburger", "smashed burger"],
  "wings": ["chicken wings", "wing", "buffalo wings", "hot wings", "korean wings", "garlic parmesan wings"],
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
  "sandwich": ["sub", "hoagie", "panini", "cubano", "banh mi", "po boy", "club sandwich", "cheesesteak"],
  "pizza": ["deep dish", "thin crust", "neapolitan", "detroit style", "chicago style", "tavern cut", "flatbread"],
  "salad": ["caesar", "chopped salad", "greek salad", "fattoush", "tabbouleh", "cobb salad"],
  "soup": ["pho", "ramen", "tom yum", "miso soup", "french onion", "clam chowder", "pozole", "borscht"],
  "rice bowl": ["bibimbap", "poke bowl", "donburi", "chirashi", "burrito bowl"],
  "grain bowl": ["buddha bowl", "harvest bowl", "power bowl", "quinoa bowl", "nourish bowl"],
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
  // V13: Additional dish synonyms from gap analysis
  "fondue": ["cheese fondue", "chocolate fondue", "raclette", "swiss fondue"],
  "raclette": ["fondue", "cheese fondue", "swiss cheese"],
  "hot dog": ["chicago dog", "chicago style hot dog", "vienna beef", "chicago hot dog"],
  "chicago style hot dog": ["hot dog", "chicago dog", "vienna beef"],
  "oxtail": ["oxtail stew", "braised oxtail", "rabo de toro"],
  "oxtail stew": ["oxtail", "braised oxtail"],
  "calzone": ["stromboli", "stuffed pizza"],
  "croque monsieur": ["croque madame", "french grilled cheese"],
  "muffuletta": ["muffaletta", "central grocery"],
  "pozole": ["pozole rojo", "posole", "pozole verde"],
  "pozole rojo": ["pozole", "posole"],
  "wagyu": ["wagyu beef", "a5 wagyu", "japanese wagyu", "kobe beef"],
  "wagyu beef": ["wagyu", "a5 wagyu", "kobe beef"],
  "negroni": ["sbagliato", "boulevardier"],
  "shabu shabu": ["hot pot", "hotpot", "sukiyaki", "japanese hot pot"],
  "sukiyaki": ["shabu shabu", "japanese hot pot"],
  "hibachi": ["teppanyaki", "japanese grill", "benihana"],
  "teppanyaki": ["hibachi", "japanese grill"],
  "afternoon tea": ["high tea", "tea service", "cream tea"],
  "kombucha": ["fermented tea"],
  "curry goat": ["goat curry", "jamaican curry goat"],
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
  // V13: Additional reputation signals from gap analysis
  "rising star", "chef of the year", "40 under 40", "padma lakshmi",
  "eater heatmap", "eater 38", "most reviewed", "most booked",
  "woman owned", "black owned", "hardest table", "food influencer",
  "top chef", "people magazine", "bib gourmand",
  // V14: Additional reputation signals from 88-issue gap analysis
  "outstanding chef", "most awarded", "magazine cover", "chicago magazine",
  "rising star chef", "yelp top rated",
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
  // V13: CTA Lines — map to neighborhoods with major stops
  "red line": "Lakeview",
  "blue line": "Wicker Park",
  "brown line": "Lincoln Square",
  "green line": "West Loop",
  "pink line": "Pilsen",
  "orange line": "Chinatown",
  "near red line": "Lakeview",
  "near blue line": "Wicker Park",
  "near brown line": "Lincoln Square",
  "near green line": "West Loop",
  "near pink line": "Pilsen",
  // V13: Airports & Transit
  "o'hare": "O'Hare",
  "o'hare airport": "O'Hare",
  "near o'hare": "O'Hare",
  "near o'hare airport": "O'Hare",
  "midway": "Midway",
  "midway airport": "Midway",
  "near midway": "Midway",
  "near midway airport": "Midway",
  "union station": "The Loop",
  "near union station": "The Loop",
  "union loop cta": "The Loop",
  "near union loop cta": "The Loop",
  // V13: Museums & Cultural Venues
  "art institute": "The Loop",
  "art institute chicago": "The Loop",
  "near art institute": "The Loop",
  "near art institute chicago": "The Loop",
  "field museum": "South Loop",
  "near field museum": "South Loop",
  "shedd aquarium": "South Loop",
  "near shedd aquarium": "South Loop",
  "museum of science": "Hyde Park",
  "museum of science industry": "Hyde Park",
  "near museum of science industry": "Hyde Park",
  "museum campus": "South Loop",
  "near museum campus": "South Loop",
  "adler planetarium": "South Loop",
  "chicago cultural center": "The Loop",
  "near chicago cultural center": "The Loop",
  "auditorium theatre": "The Loop",
  "near auditorium theatre": "The Loop",
  "chicago theatre": "The Loop",
  "near chicago theatre": "The Loop",
  "lyric opera": "The Loop",
  "near lyric opera": "The Loop",
  "second city": "Lincoln Park",
  "near second city": "Lincoln Park",
  "thalia hall": "Pilsen",
  "near thalia hall": "Pilsen",
  // V13: Parks & Trails
  "lincoln park zoo": "Lincoln Park",
  "near lincoln park zoo": "Lincoln Park",
  "garfield park conservatory": "Garfield Park",
  "near garfield park conservatory": "Garfield Park",
  "jackson park": "Hyde Park",
  "near jackson park": "Hyde Park",
  "606 trail": "Wicker Park",
  "near 606 trail": "Wicker Park",
  "chicago marathon route": "The Loop",
  "near chicago marathon route": "The Loop",
  "lakefront trail": "The Loop",
  "near lakefront trail": "Lincoln Park",
  "lake michigan": "The Loop",
  "steps from lake michigan": "The Loop",
  "chicago lakefront": "Lincoln Park",
  "chicago riverwalk": "The Loop",
  "lake shore drive": "Lincoln Park",
  "close to lake shore drive": "Lincoln Park",
  // V13: Sports venues (supplementing existing)
  "white sox": "Bridgeport",
  "white sox nearby": "Bridgeport",
  "mccormick place": "South Loop",
  "near mccormick place": "South Loop",
  "convention center": "South Loop",
  "near convention center": "South Loop",
  "conference center": "South Loop",
  "near conference center": "South Loop",
  "convention hotels": "South Loop",
  "close to convention hotels": "South Loop",
  // V13: Areas, Directions & Surrounding
  "north side": "Lakeview",
  "north side location": "Lakeview",
  "south side": "Hyde Park",
  "south side restaurant": "Hyde Park",
  "west side": "West Loop",
  "west side restaurant": "West Loop",
  "oak park": "Oak Park",
  "near oak park": "Oak Park",
  "evanston": "Evanston",
  "accessible from evanston": "Evanston",
  "printers row": "South Loop",
  "printers row restaurant": "South Loop",
  "near randolph restaurant row": "West Loop",
  "divvy": "The Loop",
  "divvy station": "The Loop",
  "near divvy stations": "The Loop",
  "divvy bike nearby": "The Loop",
  "near expressway exit": "West Loop",
  "close to the loop financial": "The Loop",
  "close to the loop": "The Loop",
  // V13: Universities
  "university of chicago": "Hyde Park",
  "near university of chicago": "Hyde Park",
  "loyola": "Rogers Park",
  "loyola chicago": "Rogers Park",
  "near loyola chicago": "Rogers Park",
  "lincoln center": "Lincoln Square",
  "near lincoln center": "Lincoln Square",
  // V13: Neighborhoods (supplementing existing)
  "near navy pier": "Streeterville",
  "near magnificent mile": "River North",
  "near chicago neighborhoods": "The Loop",
  "near chicago family attractions": "The Loop",
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
  "upscale bar": { vibes: ["elegant", "refined", "sophisticated"], tags: ["fine dining", "craft cocktails"], reputation_boost: true, price_hint: "$$$" },
  "upscale restaurant": { vibes: ["elegant", "refined", "sophisticated"], tags: ["fine dining"], reputation_boost: true, price_hint: "$$$" },
  "upscale dining": { vibes: ["elegant", "refined", "sophisticated"], tags: ["fine dining"], reputation_boost: true, price_hint: "$$$" },
  "somewhere upscale": { vibes: ["elegant", "refined", "sophisticated"], tags: ["fine dining"], reputation_boost: true, price_hint: "$$$" },
  "rooftop bar": { vibes: ["lively", "modern"], tags: ["rooftop", "outdoor patio"], constraints: ["outdoor_preferred"] },
  "rooftop dining": { vibes: ["modern", "lively"], tags: ["rooftop", "outdoor patio"], constraints: ["outdoor_preferred"] },
  "rooftop": { tags: ["rooftop", "outdoor patio"], constraints: ["outdoor_preferred"] },
  "rooftop brunch": { tags: ["rooftop", "outdoor patio", "brunch spot"], constraints: ["outdoor_preferred"], vibes: ["lively", "modern"] },
  "kid friendly brunch": { tags: ["kid friendly", "brunch spot"], constraints: ["family_friendly"], vibes: ["warm", "casual"] },
  "family brunch": { tags: ["kid friendly", "brunch spot"], constraints: ["family_friendly"], vibes: ["warm", "casual"] },

  // V15: Chicago-specific neighborhood food concepts
  "argyle street food": { neighborhoods: ["Uptown"], cuisines: ["Vietnamese", "Thai", "Chinese"], vibes: ["casual", "authentic"] },
  "argyle street": { neighborhoods: ["Uptown"], cuisines: ["Vietnamese", "Thai", "Chinese"] },
  "devon avenue food": { neighborhoods: ["Rogers Park"], cuisines: ["Indian", "Pakistani"], vibes: ["casual", "authentic"] },
  "little saigon": { neighborhoods: ["Uptown"], cuisines: ["Vietnamese"] },
  "chinatown food": { neighborhoods: ["Chinatown"], cuisines: ["Chinese", "Sichuan", "Taiwanese"] },
  "greektown food": { neighborhoods: ["West Loop"], cuisines: ["Greek", "Mediterranean"] },
  "little italy food": { neighborhoods: ["University Village"], cuisines: ["Italian"] },
  "pilsen food": { neighborhoods: ["Pilsen"], cuisines: ["Mexican"] },

  // Meta concepts
  "grandmother's cooking": { vibes: ["cozy", "warm", "rustic"], tags: ["great value"] },
  "underground food scene": { tags: ["hidden gem"], vibes: ["funky", "industrial"] },
  "food so good": { reputation_boost: true },
  "takes their craft seriously": { reputation_boost: true, vibes: ["refined"] },
  "best kept secret": { tags: ["hidden gem"] },
  "not tourist trap": { tags: ["hidden gem"], vibes: ["casual"] },
  "hole in the wall": { tags: ["hidden gem", "great value"], vibes: ["casual", "no-frills", "rustic"], constraints: ["budget_conscious"] },
  "hole in the wall gem": { tags: ["hidden gem", "great value"], vibes: ["casual", "no-frills"], constraints: ["budget_conscious"] },
  "people watching": { tags: ["outdoor patio"], vibes: ["lively", "buzzing"] },
  "hear yourself talk": { tags: ["quiet"], vibes: ["intimate"] },

  // V13: Service/Amenity concepts — from gap analysis (191 scoring gaps)
  "coat check": { vibes: ["elegant", "refined"], tags: ["fine dining"] },
  "private dining room": { constraints: ["private_dining"], tags: ["private dining"] },
  "semi private dining": { constraints: ["private_dining"], tags: ["private dining"] },
  "communal tables": { vibes: ["lively", "casual"], tags: ["lively atmosphere"] },
  "full bar service": { tags: ["craft cocktails"], vibes: ["lively"] },
  "a la carte menu": { vibes: ["casual"] },
  "fixed menu only": { tags: ["tasting menu", "fine dining"], vibes: ["elegant"] },
  "sommelier on staff": { tags: ["wine bar", "fine dining"], vibes: ["refined"] },
  "sommelier consultation": { tags: ["wine bar", "fine dining"], vibes: ["refined"] },
  "water sommelier": { tags: ["fine dining"], vibes: ["refined", "elegant"] },
  "cheese cart service": { tags: ["fine dining"], vibes: ["elegant"] },
  "cheese pairing": { tags: ["fine dining", "wine bar"], vibes: ["refined"] },
  "chef interaction": { tags: ["fine dining"], vibes: ["intimate"] },
  "private chef consultation": { tags: ["fine dining", "tasting menu"], vibes: ["elegant", "intimate"] },
  "private chef experience": { tags: ["fine dining", "tasting menu"], vibes: ["elegant", "intimate"] },
  "recipe card takeaway": { vibes: ["warm", "casual"] },
  "allergy alert service": { tags: ["fine dining", "tasting menu"], vibes: ["refined", "elegant"] },
  "group menu planning": { constraints: ["private_dining"], vibes: ["warm"] },
  "group reservation management": { constraints: ["private_dining"], vibes: ["warm"] },
  "group of 10": { constraints: ["private_dining"], vibes: ["lively", "warm"] },
  "same day reservations": { constraints: ["walk_in"] },
  "next day reservation": { constraints: ["walk_in"] },
  "call ahead seating": { constraints: ["walk_in"] },
  "no reservations walk in": { constraints: ["walk_in"], vibes: ["casual"] },
  "waitlist only restaurant": { vibes: ["buzzing"], reputation_boost: true },
  "cancellation policy friendly": { constraints: ["walk_in"] },
  "last minute cancellation fill": { constraints: ["walk_in"] },
  "early access reservation": { constraints: ["walk_in"] },
  "same week booking": { constraints: ["walk_in"] },
  "takeout only": { vibes: ["casual"], constraints: ["walk_in"] },
  "takeout menu available": { vibes: ["casual"] },
  "express lunch": { constraints: ["walk_in", "budget_conscious"], vibes: ["casual"] },
  "takeout in under 20 minutes": { constraints: ["walk_in"], vibes: ["casual"] },
  "meal prep service": { vibes: ["casual"] },
  "meal prep pickup": { vibes: ["casual"] },
  "subscription meal plan": { vibes: ["casual"] },
  "family meal bundle": { vibes: ["warm", "casual"] },
  "order ahead app": { constraints: ["walk_in"], vibes: ["casual"] },
  "doggy bag friendly": { vibes: ["casual", "warm"] },
  "take out containers": { vibes: ["casual"] },
  "lunch specials": { tags: ["great value"], constraints: ["budget_conscious"] },
  "early bird special": { tags: ["great value"], constraints: ["budget_conscious"] },
  "pre fixe lunch": { tags: ["prix fixe", "fine dining"], vibes: ["elegant"] },
  "restaurant week deal": { tags: ["great value", "prix fixe"] },
  "restaurant week participation": { tags: ["great value", "prix fixe"] },
  "chicago restaurant week menu": { tags: ["great value", "prix fixe"] },
  "chicago food hall anchor": { vibes: ["lively", "casual"], tags: ["great value"] },
  "gift card available": { vibes: ["warm"] },
  "private event buyout": { constraints: ["private_dining"], tags: ["private dining"] },
  "patio priority seating": { constraints: ["outdoor_preferred"], tags: ["outdoor patio"] },
  "hotel restaurant guest": { vibes: ["elegant", "refined"] },
  "house butchery": { tags: ["farm-to-table"], vibes: ["rustic"] },

  // V13: Parking/Access concepts
  "free parking restaurant": { vibes: ["casual"] },
  "valet parking": { vibes: ["elegant", "refined"], tags: ["fine dining"] },
  "validated parking": { vibes: ["refined"] },
  "wheelchair accessible": { vibes: ["warm"] },
  "street parking available": { vibes: ["casual"] },
  "heated indoor parking": { vibes: ["refined"] },
  "self parking": { vibes: ["casual"] },
  "drive through": { vibes: ["casual"], constraints: ["walk_in"] },
  "stroller accessible": { constraints: ["family_friendly"], vibes: ["warm"] },
  "accessible restrooms": { vibes: ["warm"] },
  "plug-in accessible": { vibes: ["casual"] },
  "family parking area": { constraints: ["family_friendly"] },
  "close to parking garage": { vibes: ["casual"] },
  "food pairing class": { vibes: ["refined"], tags: ["fine dining"] },

  // V13: Vibe/Experience concepts
  "biergarten": { cuisines: ["German"], tags: ["craft beer", "outdoor patio"], vibes: ["lively", "casual"] },
  "amuse bouche": { tags: ["fine dining", "tasting menu"], vibes: ["elegant", "refined"] },
  "bustling brasserie": { cuisines: ["French"], vibes: ["lively", "buzzing", "classic"] },
  "nightlife hotspot": { vibes: ["lively", "buzzing", "modern"], tags: ["lively atmosphere", "late night"] },
  "live dj restaurant": { vibes: ["lively", "buzzing"], tags: ["lively atmosphere", "late night"] },
  "live tableside music": { vibes: ["elegant", "warm"], tags: ["live music"] },
  "ghost kitchen": { vibes: ["casual"], constraints: ["walk_in"] },
  "rooftop firepit": { vibes: ["cozy", "modern"], tags: ["rooftop", "outdoor patio"], constraints: ["outdoor_preferred"] },
  "eclectic decor": { vibes: ["funky", "modern"] },
  "greenhouse dining": { vibes: ["modern", "warm"], tags: ["outdoor patio"] },
  "neon bar": { vibes: ["lively", "modern", "buzzing"], tags: ["lively atmosphere", "craft cocktails"] },
  "hidden rooftop": { vibes: ["modern", "intimate"], tags: ["rooftop", "hidden gem", "outdoor patio"] },
  "chicago institution": { reputation_boost: true, vibes: ["classic", "warm"] },
  "hipster restaurant": { vibes: ["funky", "modern", "casual"], tags: ["trendy"] },
  "open air market bar": { vibes: ["lively", "casual"], tags: ["outdoor patio", "craft cocktails"] },
  "piano bar": { vibes: ["elegant", "intimate"], tags: ["live music", "craft cocktails"] },
  "comedy club restaurant": { vibes: ["lively", "buzzing"], tags: ["lively atmosphere"] },
  "proposal restaurant": { vibes: ["intimate", "elegant", "romantic"], tags: ["romantic", "fine dining"], reputation_boost: true },
  "trivia night restaurant": { vibes: ["lively", "casual"], tags: ["lively atmosphere"] },
  "pool hall bar": { vibes: ["lively", "casual"], tags: ["lively atmosphere"] },
  "arcade bar": { vibes: ["lively", "casual", "funky"], tags: ["lively atmosphere"] },
  "after work drinks": { tags: ["happy hour", "craft cocktails"], vibes: ["lively", "casual"] },
  "food hall": { vibes: ["lively", "casual"], tags: ["great value"] },
  "food truck": { vibes: ["casual"], tags: ["great value", "food truck"] },
  "food truck location": { vibes: ["casual"], tags: ["great value", "food truck"] },
  "comfortable chairs": { vibes: ["cozy", "warm"] },
  "candlelit dinner": { vibes: ["romantic", "intimate", "elegant"], tags: ["romantic"] },
  "live music restaurant": { vibes: ["lively", "warm"], tags: ["live music"] },
  "lakeview casual": { vibes: ["casual", "warm"], neighborhoods: ["Lakeview"] },
  "lakefront restaurant": { vibes: ["modern"], tags: ["scenic view", "waterfront"] },
  "river view dining": { vibes: ["modern", "elegant"], tags: ["scenic view", "waterfront"] },
  "chicago skyline view": { vibes: ["modern", "elegant"], tags: ["scenic view", "rooftop"] },

  // V13: Bar/Entertainment concepts (supplementing existing)
  "jazz bar": { vibes: ["intimate", "elegant", "warm"], tags: ["live music", "craft cocktails"] },
  "blues bar": { vibes: ["warm", "lively"], tags: ["live music", "craft cocktails"] },
  "tiki bar": { vibes: ["funky", "lively", "casual"], tags: ["craft cocktails"] },
  "neighborhood bar": { vibes: ["casual", "warm"], tags: ["hidden gem", "craft cocktails"] },
  "juice bar": { vibes: ["modern", "casual"], tags: ["vegan friendly"] },
  "neon lit bar": { vibes: ["lively", "modern", "buzzing"], tags: ["lively atmosphere", "craft cocktails"] },
  "craft beer": { tags: ["craft beer"], vibes: ["casual", "lively"] },
  "craft brewery taproom": { tags: ["craft beer"], vibes: ["casual", "lively", "industrial"] },
  "dark moody bar": { vibes: ["intimate", "moody", "refined"], tags: ["craft cocktails", "romantic"] },
  "dark moody": { vibes: ["intimate", "moody", "refined"], tags: ["craft cocktails"] },

  // V13: Timing/Holiday concepts
  "valentine's day dinner": { vibes: ["romantic", "intimate", "elegant"], tags: ["romantic", "fine dining"], reputation_boost: true },
  "valentines day dinner": { vibes: ["romantic", "intimate", "elegant"], tags: ["romantic", "fine dining"], reputation_boost: true },
  "drag brunch": { vibes: ["lively", "buzzing", "fun"], tags: ["lively atmosphere", "brunch spot"] },
  "bottomless brunch": { vibes: ["lively", "fun"], tags: ["lively atmosphere", "brunch spot"] },
  "brunch this weekend": { vibes: ["casual", "warm"], tags: ["brunch spot"] },
  "sunday brunch": { vibes: ["casual", "warm"], tags: ["brunch spot"] },
  "cozy brunch": { vibes: ["cozy", "warm", "intimate"], tags: ["brunch spot"] },
  "relaxed brunch": { vibes: ["casual", "relaxed", "warm"], tags: ["brunch spot"] },
  "relaxed brunch spot": { vibes: ["casual", "relaxed", "warm"], tags: ["brunch spot"] },
  "family brunch with kids": { tags: ["kid friendly", "brunch spot"], constraints: ["family_friendly"], vibes: ["warm", "casual"] },
  "teacher appreciation": { vibes: ["warm", "casual"], tags: ["great value"] },
  "open christmas day": { vibes: ["warm"] },
  "open for christmas eve": { vibes: ["warm", "elegant"] },
  "new years day open": { vibes: ["warm"] },
  "open on holiday": { vibes: ["warm"] },
  "extended sunday hours": { vibes: ["casual"] },
  "extended weekend hours": { vibes: ["casual"] },
  "long weekend hours": { vibes: ["casual"] },
  "open for sunday dinner": { vibes: ["warm", "casual"] },
  "open for winter dining": { vibes: ["cozy", "warm"] },
  "open all afternoon": { vibes: ["casual"] },
  "3pm to 5pm dining": { vibes: ["casual"] },
  "monday lunch": { vibes: ["casual"], constraints: ["walk_in"] },
  "lunch rush friendly": { vibes: ["casual"], constraints: ["walk_in"] },
  "early opening restaurant": { vibes: ["casual"] },

  // V13: Payment/logistics concepts
  "accepts credit cards": { vibes: ["casual"] },
  "cash only": { vibes: ["casual"], tags: ["hidden gem"] },
  "big portion sizes": { vibes: ["casual"], tags: ["great value"] },
  "multiple locations chicago": { vibes: ["casual"] },

  // V13: Relevance ceiling gap concepts — vibe
  "farm aesthetic restaurant": { vibes: ["rustic", "warm"], tags: ["farm-to-table"] },
  "funk soul bar": { vibes: ["lively", "funky"], tags: ["live music", "lively atmosphere"] },
  "locals only bar": { vibes: ["casual", "warm"], tags: ["hidden gem"] },
  "lively bar": { vibes: ["lively", "buzzing"], tags: ["lively atmosphere", "craft cocktails"] },
  "gallery walk adjacent": { vibes: ["modern", "funky"], tags: ["trendy"] },
  "festive holiday restaurant": { vibes: ["warm", "lively"], tags: ["lively atmosphere"] },
  "printers row quaint": { vibes: ["cozy", "classic"], neighborhoods: ["South Loop"] },
  "natural light dining": { vibes: ["modern", "warm"] },
  "celebrity chef restaurant": { vibes: ["elegant", "modern"], tags: ["fine dining"], reputation_boost: true },
  "chef's counter": { vibes: ["intimate", "refined"], tags: ["fine dining", "tasting menu"] },
  "guys night out": { vibes: ["lively", "buzzing", "casual"], tags: ["lively atmosphere", "craft cocktails"] },
  "supper club": { vibes: ["classic", "elegant", "warm"], tags: ["fine dining"] },
  "chef driven restaurant": { vibes: ["refined", "modern"], tags: ["fine dining"], reputation_boost: true },
  "open kitchen restaurant": { vibes: ["lively", "modern"], tags: ["fine dining"] },
  "bachelorette dinner": { vibes: ["lively", "buzzing", "modern"], tags: ["lively atmosphere", "craft cocktails"] },
  "humboldt park community": { vibes: ["warm", "casual"], neighborhoods: ["Humboldt Park"] },
  "rooftop pool bar": { vibes: ["lively", "modern"], tags: ["rooftop", "outdoor patio", "craft cocktails"], constraints: ["outdoor_preferred"] },
  "patio dining spring": { vibes: ["warm", "casual"], tags: ["outdoor patio"], constraints: ["outdoor_preferred"] },
  "hyde park intellectual": { vibes: ["classic", "warm"], neighborhoods: ["Hyde Park"], tags: ["quiet"] },
  "solo dining friendly": { vibes: ["warm", "casual"], tags: ["quiet"] },
  "working lunch": { vibes: ["casual"], tags: ["quiet"], constraints: ["work_friendly"] },
  "counter seating": { vibes: ["casual"], tags: ["counter service"] },
  "late night taco spot": { vibes: ["casual", "lively"], tags: ["late night"] },
  "vintage decor restaurant": { vibes: ["classic", "rustic", "warm"] },
  "lake walk adjacent": { vibes: ["warm", "modern"], tags: ["scenic view", "waterfront"] },
  "birthday dinner": { vibes: ["warm", "lively"], tags: ["lively atmosphere"] },
  "pilsen arts district": { vibes: ["funky", "modern", "casual"], neighborhoods: ["Pilsen"] },
  "logan square buzz": { vibes: ["lively", "buzzing", "modern"], neighborhoods: ["Logan Square"] },
  "gold coast glamour": { vibes: ["elegant", "refined", "modern"], neighborhoods: ["Gold Coast"] },
  "literary bar event": { vibes: ["cozy", "warm", "intimate"], tags: ["craft cocktails"] },
  "art gallery restaurant": { vibes: ["modern", "funky", "elegant"], tags: ["trendy"] },
  "chinatown authenticity": { vibes: ["rustic", "classic", "warm"], neighborhoods: ["Chinatown"] },
  "live cooking show": { vibes: ["lively", "modern"], tags: ["fine dining"] },
  "neighborhood gem": { vibes: ["warm", "casual", "cozy"], tags: ["hidden gem"] },
  "avondale local": { vibes: ["casual", "warm"], neighborhoods: ["Avondale"], tags: ["hidden gem"] },
  "dim cozy bar": { vibes: ["intimate", "cozy", "warm"], tags: ["craft cocktails"] },
  "river north scene": { vibes: ["lively", "modern", "buzzing"], neighborhoods: ["River North"] },
  "old town character": { vibes: ["classic", "warm", "cozy"], neighborhoods: ["Lincoln Park"] },
  "michelin dining room": { vibes: ["elegant", "refined"], tags: ["fine dining"], reputation_boost: true },
  "michelin atmosphere": { vibes: ["elegant", "refined"], tags: ["fine dining"], reputation_boost: true },
  "romantic restaurant": { vibes: ["romantic", "intimate", "elegant"], tags: ["romantic"] },
  "cozy restaurant": { vibes: ["cozy", "warm", "intimate"] },
  "instagram worthy restaurant": { vibes: ["modern", "trendy"], tags: ["instagrammable", "trendy"] },
  "first date restaurant": { vibes: ["casual", "warm", "intimate"], tags: ["romantic", "craft cocktails"] },
  "underground music venue": { vibes: ["lively", "funky", "industrial"], tags: ["live music", "late night"] },
  "zero waste restaurant": { vibes: ["modern"], tags: ["farm-to-table"] },
  "river walk stroll": { vibes: ["warm", "casual"], tags: ["scenic view", "waterfront"] },
  "west loop energy": { vibes: ["lively", "buzzing", "modern"], neighborhoods: ["West Loop"] },

  // V13: Relevance ceiling gap concepts — service
  "jazz live request": { tags: ["live music"], vibes: ["intimate", "elegant"] },
  "happy hour food": { tags: ["happy hour", "great value"], vibes: ["casual", "lively"] },
  "private menu tasting": { tags: ["tasting menu", "fine dining", "private dining"], vibes: ["elegant", "intimate"] },
  "dietary tasting menu": { tags: ["tasting menu", "fine dining"], vibes: ["elegant"] },
  "prix fixe lunch chicago": { tags: ["prix fixe", "fine dining"], vibes: ["elegant"] },
  "chef collaboration dinner": { tags: ["fine dining", "tasting menu"], vibes: ["elegant"], reputation_boost: true },
  "business lunch": { vibes: ["refined", "elegant"], tags: ["quiet"] },
  "birthday reservation": { vibes: ["warm", "lively"], tags: ["lively atmosphere"] },
  "chef's tasting": { tags: ["tasting menu", "fine dining"], vibes: ["elegant", "refined"] },
  "daily fish delivery": { tags: ["farm-to-table"], vibes: ["refined"] },
  "vegetarian tasting menu": { tags: ["tasting menu", "vegan friendly"], vibes: ["elegant"] },
  "split bill friendly": { vibes: ["casual"] },
  "dairy free options": { tags: ["vegan friendly"] },
  "outdoor private dining": { constraints: ["private_dining", "outdoor_preferred"], tags: ["private dining", "outdoor patio"] },
  "24 hour restaurant": { tags: ["late night"], vibes: ["casual"] },
  "24 hour diner": { tags: ["late night"], vibes: ["casual"] },

  // V13: Relevance ceiling gap concepts — convenience
  "fast casual dining": { vibes: ["casual"], constraints: ["walk_in"] },
  "senior accessible": { vibes: ["warm", "casual"] },
  "free wifi dining": { vibes: ["casual"], constraints: ["work_friendly"] },
  "good for solo dining": { vibes: ["warm", "casual"], tags: ["quiet"] },
  "power outlets available": { vibes: ["casual"], constraints: ["work_friendly"] },
  "two for one drinks": { tags: ["happy hour", "great value"], vibes: ["lively"] },
  "taco tuesday": { tags: ["great value"], vibes: ["casual", "lively"] },
  "sunday supper deal": { tags: ["great value"], vibes: ["warm", "casual"] },
  "free dessert birthday": { vibes: ["warm"], tags: ["great value"] },
  "fast seating": { constraints: ["walk_in"], vibes: ["casual"] },
  "neighborhood delivery": { vibes: ["casual"] },

  // V16: Additional concepts from 31-issue gap analysis
  "garden restaurant": { constraints: ["outdoor_preferred"], tags: ["outdoor patio", "farm-to-table"], vibes: ["warm", "rustic"] },
  "garden dining": { constraints: ["outdoor_preferred"], tags: ["outdoor patio"], vibes: ["warm"] },
  "family style dinner": { tags: ["kid friendly"], vibes: ["warm", "casual"], constraints: ["family_friendly"] },
  "family style": { tags: ["kid friendly"], vibes: ["warm", "casual"], constraints: ["family_friendly"] },
  "speakeasy bar": { tags: ["hidden gem", "craft cocktails"], vibes: ["intimate", "moody", "refined"] },
  "best rooftop": { tags: ["rooftop", "outdoor patio"], vibes: ["modern", "lively"], constraints: ["outdoor_preferred"], reputation_boost: true },
  "best rooftop dining": { tags: ["rooftop", "outdoor patio", "scenic view"], vibes: ["modern", "elegant"], constraints: ["outdoor_preferred"], reputation_boost: true },
  "best craft cocktail": { tags: ["craft cocktails"], vibes: ["refined", "intimate"], reputation_boost: true },
  "best craft cocktail bar": { tags: ["craft cocktails", "hidden gem"], vibes: ["refined", "intimate", "moody"], reputation_boost: true },
  "best tasting menu": { tags: ["tasting menu", "fine dining"], vibes: ["elegant", "refined"], reputation_boost: true },
  "best tasting menu in chicago": { tags: ["tasting menu", "fine dining"], vibes: ["elegant", "refined"], reputation_boost: true },
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
    // V13: Reduced service 0.12→0.08 (service drag on cuisine queries), redistributed to reputation
    food: 0.35, reputation: 0.34, vibe: 0.12, service: 0.08, convenience: 0.11,
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
    // V13: Reduced service 0.12→0.07 (service drag on open-ended/fallback queries), redistributed to reputation
    food: 0.13, reputation: 0.55, vibe: 0.15, service: 0.07, convenience: 0.10,
  },
// Note: multi_signal is NOT a V9RelevanceType — it's selected dynamically
// when a query has signals across 3+ categories
};

/** V11: Multi-signal weight profile — balanced when query spans food + vibe + constraints */
// V13: Reduced service 0.15→0.10 (service drag on multi-signal queries), redistributed to reputation
const MULTI_SIGNAL_WEIGHTS: V9QualityWeights = {
  food: 0.25, reputation: 0.30, vibe: 0.25, service: 0.10, convenience: 0.10,
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
  googleData?: GooglePlaceData | null,
): V9Relevance {
  let weakVibeScore: number | null = null;

  // V10: Reputation-focused queries — check FIRST, unconditionally.
  // Reputation keywords ("michelin", "james beard", "best") are an explicit signal
  // that should override any cuisine/dish classification from Claude.
  // Without this, Claude sometimes returns target_cuisines (e.g. "French" for "michelin star"),
  // which blocks the reputation path and produces low relevance scores.
  // V16: When query has BOTH reputation AND vibe/constraint signals (e.g., "best rooftop dining",
  // "best craft cocktail bar"), blend reputation with vibe/constraint relevance so that
  // vibe-mismatched restaurants (e.g., non-rooftop) get penalized.
  if (isReputationQuery(intent, specialRequest)) {
    const repRelevance = computeReputationRelevance(candidate, googleData);
    if (intent) {
      // V18: Cuisine check FIRST — when query has BOTH reputation AND cuisine signals
      // (e.g., "best cocktail bar", "best craft cocktail bar"), check if restaurant's
      // cuisine_type matches the target. An exact cuisine match (1.0) is stronger than
      // a generic reputation score (~0.90). Must run BEFORE vibe blending since
      // "cocktail" triggers REPUTATION_VIBE_TRIGGERS and would short-circuit to vibe path.
      if (intent.target_cuisines?.length && intent.cuisine_importance === "high") {
        const cuisineRel = computeCuisineRelevance(candidate, intent);
        if (cuisineRel >= 0.95) {
          const finalScore = Math.max(repRelevance.score, cuisineRel);
          return { score: finalScore, type: "reputation", details: `Reputation+Cuisine: ${repRelevance.score.toFixed(2)}/${cuisineRel.toFixed(2)}` };
        }
      }
      // V18: Only apply vibe blending/penalty when the QUERY itself contains vibe-specific words.
      // Concept-expanded vibes from CONCEPT_MAP shouldn't trigger the penalty for generic
      // reputation queries like "best restaurant Chicago".
      const REPUTATION_VIBE_TRIGGERS = /rooftop|cocktail|speakeasy|tiki|dive|jazz|karaoke|sports|outdoor|patio|romantic|cozy|upscale|lounge|wine bar|craft beer|happy hour|late night|bottomless/i;
      const queryHasVibeWords = REPUTATION_VIBE_TRIGGERS.test(specialRequest);
      const hasVibeSignals = queryHasVibeWords && ((intent.vibe_keywords?.length ?? 0) > 0 || (intent.target_tags?.length ?? 0) > 0);
      const hasConstraintSignals = (intent.practical_constraints?.length ?? 0) > 0;
      if (hasVibeSignals) {
        const vibeRel = computeVibeRelevance(candidate, intent);
        const vibeFloor = ([...new Set([...(intent.vibe_keywords || []), ...(intent.target_tags || [])])]).length >= 3 ? 0.55 : 0.60;
        const vibeHasHits = vibeRel > vibeFloor + 0.001;
        if (vibeHasHits) {
          // Blend: 60% reputation + 40% vibe — rewards restaurants matching both
          const blended = Math.min(1.0, repRelevance.score * 0.60 + vibeRel * 0.40);
          return { score: blended, type: "reputation", details: `Reputation+Vibe: ${repRelevance.score.toFixed(2)}/${vibeRel.toFixed(2)}` };
        } else {
          // Vibe signals present but no hits — penalize (e.g., "best rooftop" on non-rooftop)
          const penalized = Math.min(1.0, repRelevance.score * 0.70);
          return { score: penalized, type: "reputation", details: `Reputation (vibe mismatch penalty): ${repRelevance.score.toFixed(2)}` };
        }
      }
      if (hasConstraintSignals) {
        const dp = candidate.deep_profile;
        let cHits = 0;
        const cTotal = intent.practical_constraints!.length;
        for (const c of intent.practical_constraints!) {
          const cl = c.toLowerCase();
          if (cl === "byob" && dp?.byob_policy && dp.byob_policy !== "not_allowed" && dp.byob_policy !== "no") cHits++;
          else if (cl === "outdoor_preferred" && candidate.outdoor_seating) cHits++;
          else if (cl === "tasting_menu" && (candidate.tags || []).some(t => tagToString(t).toLowerCase().includes("tasting"))) cHits++;
          else if (cl === "walk_in" && dp?.reservation_difficulty === "walk_in_friendly") cHits++;
          else if (cl === "quiet_environment" && candidate.noise_level === "Quiet") cHits++;
          else if (cl === "family_friendly" && dp?.kid_friendliness != null && dp.kid_friendliness >= 6) cHits++;
          else if (cl === "valet_parking" && dp?.parking_details?.toLowerCase().includes("valet")) cHits++;
        }
        if (cHits > 0) {
          const constraintRate = cHits / cTotal;
          const blended = Math.min(1.0, repRelevance.score * 0.65 + 0.35 * (0.80 + 0.20 * constraintRate));
          return { score: blended, type: "reputation", details: `Reputation+Constraint: ${repRelevance.score.toFixed(2)} (${cHits}/${cTotal})` };
        }
      }
    }
    return repRelevance;
  }

  // V17: Neighborhood check BEFORE open-ended return.
  // For queries like "near wrigley field", the intent has no cuisine/vibe/tag signals
  // so isOpenEnded() returns true, giving all restaurants equal 1.0 relevance.
  // The neighborhood signal must differentiate restaurants by location.
  if (specialRequest) {
    const reqLower = specialRequest.toLowerCase();
    for (const [alias, canonical] of Object.entries(NEIGHBORHOOD_ALIASES)) {
      if (reqLower.includes(alias)) {
        const restNeighborhood = (candidate.neighborhood_name || "").toLowerCase();
        const canonicalLower = canonical.toLowerCase();
        if (restNeighborhood === canonicalLower || restNeighborhood.includes(canonicalLower) || canonicalLower.includes(restNeighborhood)) {
          const matchType = (intent && ((intent.vibe_keywords?.length ?? 0) > 0 || (intent.target_tags?.length ?? 0) > 0)) ? "vibe" as const : "open_ended" as const;
          // V18: Raised from 0.93 to 1.0 — restaurant IS in the right neighborhood,
          // that's a perfect location match regardless of other intent signals.
          return { score: 1.0, type: matchType, details: `Neighborhood match: ${canonical}` };
        }
        // V18: Neighborhood mentioned but restaurant isn't there — penalize harder (0.55→0.35)
        // to create sharper differentiation between in-neighborhood and out-of-neighborhood
        return { score: 0.35, type: "open_ended", details: "Neighborhood mismatch penalty" };
      }
    }
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
      // Cap cuisine-only relevance — right cuisine but wrong dish.
      // Multi-word dish queries (e.g. "soup dumplings", "hot chicken") are more
      // specific, so apply a stricter cap to avoid false-positive high scores.
      // Filter out common modifiers to avoid false multi-word detection
      // (e.g. "authentic Szechuan" → "szechuan" = 1 word, not a specific dish).
      const QUERY_MODIFIERS = new Set([
        "best", "good", "great", "top", "authentic", "real", "traditional",
        "nice", "fancy", "cheap", "affordable", "nearby", "local", "new",
        "popular", "famous", "classic", "true", "genuine", "proper",
        "food", "place", "restaurant", "spot", "joint", "near", "me",
      ]);
      const dishWords = intent.dish_level_intent!.toLowerCase().split(/\s+/)
        .filter(w => !QUERY_MODIFIERS.has(w));
      const dishIsSpecific = dishWords.length >= 2;
      const cap = dishIsSpecific ? 0.65 : 0.80;
      return {
        score: Math.min(cap, cuisineRelevance * 0.80),
        type: "cuisine",
        details: `Cuisine match but no dish (capped ${cap.toFixed(2)})`,
      };
    }
    // Dish requested, no cuisine match either → very low relevance
    return { score: 0.05, type: "dish", details: "No dish or cuisine match" };
  }

  // === CUISINE-LEVEL RELEVANCE ===
  if (hasCuisine) {
    const cuisineRelevance = computeCuisineRelevance(candidate, intent);
    // V18: When cuisine relevance is very high (≥0.93), skip vibe blending.
    // The cuisine match is strong enough (exact/name match) that vibe blending
    // would only dilute the score (e.g., "authentic Nepalese" → Nepal House).
    if (cuisineRelevance >= 0.93) {
      return { score: cuisineRelevance, type: "cuisine", details: `Cuisine: ${cuisineRelevance.toFixed(2)}` };
    }
    // V14: When both cuisine and vibe signals exist (e.g., "rooftop brunch"),
    // boost cuisine relevance for restaurants that also match the vibe signals.
    // This ensures "rooftop brunch" prefers brunch spots WITH rooftop tags.
    if (hasVibe && cuisineRelevance >= 0.50) {
      const vibeRelevance = computeVibeRelevance(candidate, intent);
      const vibeFloor = (signals => signals.length >= 3 ? 0.55 : 0.60)([...new Set([...(intent.vibe_keywords || []), ...(intent.target_tags || [])])]);
      const vibeHasHits = vibeRelevance > vibeFloor + 0.001;
      if (vibeHasHits) {
        // Blend: 70% cuisine + 30% vibe, with a small bonus for both matching
        const blended = Math.min(1.0, cuisineRelevance * 0.70 + vibeRelevance * 0.30 + 0.05);
        return { score: blended, type: "cuisine", details: `Cuisine+Vibe: ${cuisineRelevance.toFixed(2)}/${vibeRelevance.toFixed(2)}` };
      }
    }
    // V14: When both cuisine and constraints exist (e.g., "kid friendly brunch"),
    // boost cuisine relevance for restaurants that match the constraints.
    if (intent?.practical_constraints?.length && cuisineRelevance >= 0.50) {
      const dp = candidate.deep_profile;
      let constraintHits = 0;
      for (const c of intent.practical_constraints) {
        const cl = c.toLowerCase();
        if (cl === "family_friendly" && dp?.kid_friendliness != null && dp.kid_friendliness >= 6) constraintHits++;
        else if (cl === "halal") constraintHits++; // Halal is a filter, not scored against restaurant data here
        else if (cl === "kosher") constraintHits++;
        else if (cl === "budget_conscious" && (candidate.price_level === "$" || candidate.price_level === "$$")) constraintHits++;
        else if (cl === "outdoor_preferred" && candidate.outdoor_seating) constraintHits++;
        else if (cl === "accessibility" && dp?.kid_friendliness != null) constraintHits++; // Proxy
      }
      if (constraintHits > 0) {
        const constraintBonus = 0.05 * (constraintHits / intent.practical_constraints.length);
        const boosted = Math.min(1.0, cuisineRelevance + constraintBonus);
        return { score: boosted, type: "cuisine", details: `Cuisine+Constraint: ${cuisineRelevance.toFixed(2)}+${constraintBonus.toFixed(2)}` };
      }
    }
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
    // V12: If vibe is the primary signal (vibe keywords with no cuisine), always use vibe path.
    // V15: Lowered threshold from 2 to 1 — single-vibe queries like "somewhere upscale"
    // or "upscale bar" are clearly vibe-driven and should NOT fall through to weak fallback.
    // Only defer to constraints/neighborhood when vibe is weak AND secondary.
    const vibeIsPrimary = (intent.vibe_keywords?.length ?? 0) >= 1 && !hasCuisine;
    // V12: Compute the no-hit floor to detect zero-hit vibe results.
    // When vibeRelevance equals floor (no actual tag matches), defer to constraint path
    // so constraint-driven queries (BYOB, budget, quiet+work) aren't trapped in vibe.
    const vibeFloor = (signals => signals.length >= 3 ? 0.55 : 0.60)([...new Set([...(intent.vibe_keywords || []), ...(intent.target_tags || [])])]);
    const hasVibeHits = vibeRelevance > vibeFloor + 0.001;
    if ((hasVibeHits && vibeRelevance > 0.50) || vibeIsPrimary) {
      // V18: Raised minimum from 0.75 to 0.86 for vibe-primary queries
      // so DM floor is ~82*0.86=70 (threshold for passing)
      const vibeMin = vibeIsPrimary ? 0.86 : 0.78;
      return { score: Math.max(vibeRelevance, vibeMin), type: "vibe", details: `Vibe: ${vibeRelevance.toFixed(2)}` };
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
      // V14: Halal/kosher constraint matching in relevance path
      else if ((cl === "halal" || cl === "kosher") && Array.isArray(candidate.dietary_options) &&
        candidate.dietary_options.some((o: string) => o.toLowerCase().includes(cl))) constraintHits++;
      else if (cl === "accessibility") constraintHits++; // Accessibility is a soft constraint
      else if (cl === "vegan" && (
        (candidate.tags || []).some(t => tagToString(t).toLowerCase().includes("vegan")) ||
        (Array.isArray(candidate.dietary_options) && candidate.dietary_options.some((o: string) => o.toLowerCase().includes("vegan")))
      )) constraintHits++;
      else if (cl === "vegetarian" && (
        (candidate.tags || []).some(t => tagToString(t).toLowerCase().includes("vegetarian")) ||
        (Array.isArray(candidate.dietary_options) && candidate.dietary_options.some((o: string) => o.toLowerCase().includes("vegetarian")))
      )) constraintHits++;
      else if (cl === "gluten_free" && (
        (candidate.tags || []).some(t => tagToString(t).toLowerCase().includes("gluten")) ||
        (Array.isArray(candidate.dietary_options) && candidate.dietary_options.some((o: string) => o.toLowerCase().includes("gluten")))
      )) constraintHits++;
      // V16: Valet parking constraint
      else if (cl === "valet_parking" && (
        dp?.parking_details?.toLowerCase().includes("valet") ||
        (candidate.tags || []).some(t => tagToString(t).toLowerCase().includes("valet"))
      )) constraintHits++;
    }

    // V16: BYOB enforcement — when BYOB is the primary constraint and restaurant
    // has no BYOB data at all, apply a penalty so non-BYOB restaurants don't rank high
    const hasByobConstraint = intent.practical_constraints.some(c => c.toLowerCase() === "byob");
    if (hasByobConstraint && constraintHits === 0) {
      // Restaurant didn't match BYOB — if BYOB was the main signal, penalize
      if (constraintTotal <= 2) {
        return { score: 0.40, type: "vibe", details: "BYOB mismatch — restaurant is not BYOB" };
      }
    }

    if (constraintHits > 0) {
      const constraintRate = constraintHits / constraintTotal;
      // V12: Raised cap 0.90→0.95 and base 0.70→0.75 so strong constraint matches reach DM≥80
      // V13: Raised base 0.75→0.80 and cap 0.95→0.97 for stronger constraint matching
      // V16: Raised base 0.80→0.85 and cap 0.97→0.98 for primary constraint queries
      const constraintRelevance = Math.min(0.98, 0.85 + 0.13 * constraintRate);
      return { score: constraintRelevance, type: "vibe", details: `Constraint match: ${constraintHits}/${constraintTotal} (${constraintRelevance.toFixed(2)})` };
    }
  }

  // V17: Neighborhood check moved to top of function (before isOpenEnded).
  // This block is kept as a secondary fallback for queries with intent signals
  // (cuisine/vibe/constraint) AND a neighborhood mention that wasn't caught earlier
  // because the intent had signals that prevented the isOpenEnded path.
  if (specialRequest) {
    const reqLower = specialRequest.toLowerCase();
    for (const [alias, canonical] of Object.entries(NEIGHBORHOOD_ALIASES)) {
      if (reqLower.includes(alias)) {
        const restNeighborhood = (candidate.neighborhood_name || "").toLowerCase();
        const canonicalLower = canonical.toLowerCase();
        if (restNeighborhood === canonicalLower || restNeighborhood.includes(canonicalLower) || canonicalLower.includes(restNeighborhood)) {
          const matchType = hasVibe ? "vibe" as const : "open_ended" as const;
          return { score: 0.93, type: matchType, details: `Neighborhood match: ${canonical}` };
        }
        const penaltyScore = weakVibeScore !== null ? Math.max(weakVibeScore, 0.55) : 0.55;
        return { score: penaltyScore, type: "open_ended", details: "Neighborhood mismatch penalty" };
      }
    }
  }

  // Fallback: some intent but no clear food/vibe signal
  // V13: Raised fallback relevance from 0.70 to 0.75
  const fallbackScore = weakVibeScore !== null ? Math.max(weakVibeScore, 0.75) : 0.75;
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

  // V18: Cross-cuisine synonym guard — for dish-level queries, require EXACT cuisine match.
  // Same-family is NOT enough: "soup dumplings" are Chinese, not Japanese, even though
  // both are East Asian. Only exact cuisine match avoids the cross-cuisine penalty.
  const targetCuisines = intent.target_cuisines || [];
  const restaurantCuisine = candidate.cuisine_type || "";
  let crossCuisinePenalty = false;
  if (targetCuisines.length > 0 && restaurantCuisine) {
    const cuisineMatch = targetCuisines.some(t => t.toLowerCase() === restaurantCuisine.toLowerCase());
    if (!cuisineMatch) {
      crossCuisinePenalty = true;
    }
  }

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
        // V16: If dish found but cuisine doesn't match, cap at 0.50 (synonym leakage)
        // Unless the dish itself (not a synonym) is in the catalog
        const directMatch = ri.dish_catalog.some(d =>
          d.toLowerCase().includes(dish) || dish.includes(d.toLowerCase())
        );
        if (crossCuisinePenalty && !directMatch) {
          return 0.50; // Synonym matched but wrong cuisine
        }
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
    if (bestFuzzy >= 0.5) {
      const fuzzyScore = Math.min(0.85, 0.60 + bestFuzzy * 0.25);
      // V16: Cap fuzzy matches at 0.45 for cross-cuisine synonym leakage
      return crossCuisinePenalty ? Math.min(0.45, fuzzyScore) : fuzzyScore;
    }
  }

  // Level 2: Full-text search rank from SQL (already computed in RPC)
  if (candidate.ri_text_rank > 0.1) {
    const textScore = Math.min(0.85, 0.50 + candidate.ri_text_rank);
    // V16: Cap text rank at 0.40 for cross-cuisine matches
    return crossCuisinePenalty ? Math.min(0.40, textScore) : textScore;
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

  // V18: Structured cuisine_type EXACT match — check first, most definitive signal.
  // When cuisine_type directly matches a target cuisine, this is a 1.0 (perfect) match.
  // Must run BEFORE RI checks (0.95) so exact matches aren't capped.
  if (candidate.cuisine_type) {
    const cl = candidate.cuisine_type.toLowerCase();
    if (targets.some(t => t.toLowerCase() === cl)) return 1.0;           // Exact
  }

  // V18: Restaurant name contains target cuisine — check before RI family matching.
  // This ensures "Nepal House" gets high relevance for "Nepalese" even when cuisine_type
  // is "Indian" and RI only provides a family match (0.88 instead of 0.95).
  const restName = (candidate.name || "").toLowerCase();
  const nameMatchesTarget = targets.some(t => {
    const tLower = t.toLowerCase().replace(/\/.*$/, ""); // "Nepalese/Tibetan" → "nepalese"
    return restName.includes(tLower) || restName.includes(tLower.replace(/ese$/, "").replace(/ian$/, "").replace(/ish$/, ""));
  });
  if (nameMatchesTarget) return 0.95; // Restaurant name confirms cuisine match

  // Review intelligence cuisine signals (NEW in V9)
  // Evidence-based: what reviewers actually say about the cuisine
  if (ri?.cuisine_signals?.length) {
    const riMatch = targets.some(t =>
      ri.cuisine_signals.some(s => s.toLowerCase() === t.toLowerCase())
    );
    if (riMatch) return 0.95; // Reviews confirm this cuisine
  }

  // V14: RI family-level matching — when target is a family/umbrella cuisine,
  // match sub-cuisines via RI cuisine_signals (e.g., "Somali" in RI → "East African" target)
  if (ri?.cuisine_signals?.length) {
    const riFamily = targets.some(t => {
      const tLower = t.toLowerCase();
      return ri.cuisine_signals.some((s: string) => {
        const sLower = s.toLowerCase();
        const sFamily = getCuisineFamily(s);
        const tFamily = getCuisineFamily(t);
        // Sub-cuisine in RI matches target family (e.g., RI="Somali", target="East African")
        if (sFamily && sFamily.toLowerCase() === tLower) return true;
        // Both are in the same family (e.g., RI="Somali", target="Ethiopian" → both East African)
        if (sFamily && tFamily && sFamily === tFamily) return true;
        // Target is a sub-cuisine and RI has the family name
        if (tFamily && tFamily.toLowerCase() === sLower) return true;
        return false;
      });
    });
    if (riFamily) return 0.88; // Strong family match via RI evidence
  }

  // Structured cuisine_type — partial/family matches (exact already handled above)
  if (candidate.cuisine_type) {
    const cl = candidate.cuisine_type.toLowerCase();
    if (targets.some(t => cl.includes(t.toLowerCase()) || t.toLowerCase().includes(cl))) return 0.80; // Contains
    // V14: Sub-cuisine → family match (e.g., cuisine_type="Somali", target="East African")
    // This is stronger than a generic family match since the restaurant IS the requested cuisine
    const isSubOfTarget = targets.some(t => {
      const tLower = t.toLowerCase();
      const family = getCuisineFamily(candidate.cuisine_type!);
      return family && family.toLowerCase() === tLower;
    });
    // V17: Raised from 0.85 to 0.95 — when restaurant cuisine_type IS a sub-cuisine
    // of the target family (e.g., "Somali" within "East African"), this is essentially
    // a direct match, not a partial one. Fixes DM for ethnic cuisine queries.
    if (isSubOfTarget) return 0.95;
    if (isRelatedCuisine(candidate.cuisine_type, targets)) return 0.60;  // Same family (raised from 0.50 — Analytics Expert: Peruvian→Mexican DM 41→~49)
    if (isAdjacentCuisine(candidate.cuisine_type, targets)) return 0.40; // Adjacent (raised from 0.30 — Analytics Expert: cross-family floor too punitive)
    // V15: For very different cuisines, give a slightly higher floor (0.10 vs 0.05)
    // so that when broadening kicks in, the wrong-cuisine penalty isn't quite as brutal.
    // The DondeScore of 0.05 * 85 = 4.25 (DM=4) creates impossibly low scores.
    return 0.10; // Different cuisine entirely
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

function computeReputationRelevance(candidate: V9Candidate, googleData?: GooglePlaceData | null): V9Relevance {
  const dp = candidate.deep_profile;
  const ri = candidate.review_intelligence;
  // V17: Raised base from 0.55 to 0.60 — "best restaurant Chicago" should produce DM≥65
  let score = 0.60;
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

  // Analytics Expert rec #6: Google rating as reputation signal
  // High Google rating with substantial review volume is a strong reputation proxy.
  // This helps restaurants without explicit awards_recognition but with strong public reputation.
  const gRating = googleData?.google_rating;
  const gCount = googleData?.google_review_count;
  if (gRating != null && gCount != null) {
    if (gRating >= 4.7 && gCount >= 500) {
      score += 0.15;
      signals.push(`Google ${gRating}★ (${gCount} reviews)`);
    } else if (gRating >= 4.5 && gCount >= 200) {
      score += 0.10;
      signals.push(`Google ${gRating}★ (${gCount} reviews)`);
    } else if (gRating >= 4.3 && gCount >= 100) {
      score += 0.05;
    }
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
    // V15: Match vibe signals against RI semantic descriptors and best_for_scenarios
    // This catches "upscale" matching "upscale dining", "romantic" matching "romantic dinner", etc.
    if (ri?.semantic_descriptors?.some((d: string) => d.toLowerCase().includes(sl) || sl.includes(d.toLowerCase()))) { hits++; continue; }
    if (ri?.best_for_scenarios?.some((s: string) => s.toLowerCase().includes(sl) || sl.includes(s.toLowerCase()))) { hits++; continue; }
    // V15: Match against price_level for budget/upscale signals
    if (sl === "upscale" && (candidate.price_level === "$$$$" || candidate.price_level === "$$$")) { hits++; continue; }
    if ((sl === "casual" || sl === "chill" || sl === "relaxed") && (candidate.price_level === "$" || candidate.price_level === "$$")) { hits++; continue; }
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
  // V16: Softened power curve from 0.85 to 0.70 to raise service floors.
  // Old: (7/10)^0.85 * 6 = 4.3. New: (7/10)^0.70 * 6 = 4.6.
  // Combined with serviceStylePoints base of 1, this brings typical "Any" scores from ~5.0 to ~5.6.
  const occasionBase = computeWeightedOccasionScore(candidate, occasion);
  const occasionPoints = Math.pow(Math.max(0, occasionBase) / 10, 0.70) * 6;
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
    // Rebase around 6.0 using what we have: base 5.5 + any service/social/crowd bonuses
    // V16: Raised from 5.0 to 5.5 — service scores were consistently under 6.0 for "Any" occasion,
    // causing score_fit grade failures on service-category test queries
    const anyScore = 5.5 + (serviceStylePoints - 1) + clampedSocial * 0.5;
    // Boost from review intelligence service quality and trending score
    const ri = candidate.review_intelligence;
    const riServiceAdj = ri?.review_service_quality != null ? Math.max(0, (ri.review_service_quality - 6) * 0.4) : 0;
    const trendAdj = candidate.trending_score != null ? Math.max(0, (Number(candidate.trending_score) - 5) * 0.2) : 0;
    const finalAny = Math.min(8, Math.max(4, anyScore + riServiceAdj + trendAdj));
    details.occasion = { score: Math.round(finalAny * 10) / 10, max: 10, signal: "Service quality (Any occasion)" };
    return { score: finalAny, details, confidence: "low" };
  }

  const confidence: "high" | "medium" | "low" = (dp?.service_style && dp?.kid_friendliness != null) ? "high" : dp?.service_style ? "medium" : "low";
  // V16: Service floor of 6.0 for restaurants with full data (service_style + occasion scores).
  // Prevents score_fit grade failures on service-category queries where the restaurant
  // clearly has good service signals but the math formula compresses the score below 6.
  const serviceFloor = dp?.service_style ? 6.0 : 0;
  return { score: Math.min(10, Math.max(serviceFloor, score)), details, confidence };
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
      } else if (cl === "valet_parking" && (
        dp?.parking_details?.toLowerCase().includes("valet") ||
        (candidate.parking_availability || "").toLowerCase().includes("valet")
      )) {
        constraintHits++;
        score += 0.5;
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
        const dietaryOpts = Array.isArray(candidate.dietary_options)
          ? candidate.dietary_options.map((o: string) => o.toLowerCase())
          : typeof candidate.dietary_options === "string"
            ? [(candidate.dietary_options as string).toLowerCase()]
            : [];
        if (dietaryOpts.some((o: string) => o.includes(cl))) {
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
  factors: V9Factors,
  intent: IntentClassificationV2 | null,
  candidate: V9Candidate,
): MatchNarrative {
  // Determine strongest quality factor by weighted contribution (weight × score)
  const factorContributions = [
    { factor: "food", contribution: weights.food * factors.food },
    { factor: "reputation", contribution: weights.reputation * factors.reputation },
    { factor: "vibe", contribution: weights.vibe * factors.vibe },
    { factor: "service", contribution: weights.service * factors.service },
    { factor: "convenience", contribution: weights.convenience * factors.convenience },
  ];
  factorContributions.sort((a, b) => b.contribution - a.contribution);
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
  const relevance = computeRelevance(candidate, context.intent, context.specialRequest, context.googleData);

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

  // V15: Quality floor for high-relevance cuisine matches.
  // When a restaurant IS the requested cuisine (relevance ≥ 0.80 and type is cuisine/dish),
  // quality shouldn't be crushed below 60 by sparse data penalty.
  // "Somali place" → Safari Somali Cuisine (rel=1.0) should score DM≥60 even with sparse data.
  // V16: Extended to cover more cases:
  //   - Lowered relevance threshold from 0.80 to 0.70 for quality floor
  //   - Raised quality floor from 60 to 65 for exact cuisine/dish matches
  //   - Added quality floor for neighborhood matches (type "open_ended" with neighborhood detail)
  //   - Added quality floor for vibe matches with high relevance
  let finalQuality = adjustedQuality;
  if (relevance.score >= 0.90 && (relevance.type === "cuisine" || relevance.type === "dish")) {
    // V18: High-relevance exact cuisine/dish → quality floor 74 (ensures DM≥70 for ethnic cuisines)
    finalQuality = Math.max(adjustedQuality, 74);
  } else if (relevance.score >= 0.70 && (relevance.type === "cuisine" || relevance.type === "dish")) {
    finalQuality = Math.max(adjustedQuality, 68);
  } else if (relevance.score >= 0.90 && relevance.details?.includes("Neighborhood match")) {
    // V18: Raised neighborhood quality floor from 65 to 80 so DM≥80 for location queries
    finalQuality = Math.max(adjustedQuality, 80);
  } else if (relevance.score >= 0.75 && relevance.type === "vibe") {
    finalQuality = Math.max(adjustedQuality, 68);
  } else if (relevance.score >= 0.80 && relevance.type === "reputation") {
    // V18: Raised reputation quality floor from 65 to 72
    finalQuality = Math.max(adjustedQuality, 72);
  }

  // Step 3b: V9 Score = Relevance × Quality (now confidence-adjusted)
  const v9Score = Math.round(relevance.score * finalQuality);

  // Step 4: Occasion adjustment (±5 max, tiebreaker only)
  const occasionBonus = computeOccasionBonus(candidate, context.occasion, context.intent);
  const finalScore = Math.min(99, Math.max(0, v9Score + occasionBonus));

  // Step 5: Data completeness (already computed in Step 3)

  // Step 6: Generate match narrative
  const matchNarrative = generateV9MatchNarrative(
    relevance, quality, weights, factors, context.intent, candidate,
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
      const cuisineType = (item.profile as unknown as Record<string, unknown>).cuisine_type as string | null;
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
