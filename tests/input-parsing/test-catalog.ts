/**
 * V4 Input Parsing Test Catalog — ~1000 Chicago Restaurant Search Test Cases
 *
 * Tests keyword matching (CUISINE_KEYWORDS, TAG_KEYWORDS, INTENT_MAP, DIETARY_KEYWORDS),
 * V4 weight shifts (computeV4Weights), and V4 pipeline (computeV4DondeMatch).
 *
 * Run: deno run --allow-read tests/input-parsing/input-parsing-test.ts
 */

import type { IntentClassificationV2 } from "../../supabase/functions/recommend/_shared/intent-classifier.ts";

// ==========================================
// TEST CASE TYPES
// ==========================================

export type Category = "CHI" | "CUI" | "DSH" | "BAR" | "OCC" | "VIB" | "NBH" | "DIT" | "FTR" | "NLP" | "MLT" | "REP" | "OPN" | "FLT";

export interface TestExpectations {
  /** Expected CUISINE_KEYWORDS matches (inclusion check) */
  cuisines?: string[];
  /** Expected TAG_KEYWORDS matches (inclusion check) */
  tags?: string[];
  /** Expected INTENT_MAP → cuisines (union of all matching keys) */
  intentCuisines?: string[];
  /** Expected INTENT_MAP → tags (union of all matching keys) */
  intentTags?: string[];
  /** Expected DIETARY_KEYWORDS matches */
  dietary?: string[];
  /** Expected WEIGHT_SHIFT_RULES labels that should fire */
  weightRules?: string[];
  /** Factor key with highest weight after shifts */
  weightDominant?: string;
  /** Min dondeMatch score (V4 pipeline, with aligned mock profile) */
  minDondeMatch?: number;
  /** Min food quality factor score */
  foodQualityMin?: number;
}

export interface TestCase {
  id: string;
  input: string;
  category: Category;
  subcategory?: string;
  occasion?: string;
  mockIntent?: Partial<IntentClassificationV2>;
  expect: TestExpectations;
}

// ==========================================
// HELPER BUILDERS
// ==========================================

const _counter: Record<string, number> = {};

function nextId(prefix: string): string {
  _counter[prefix] = (_counter[prefix] || 0) + 1;
  return `${prefix}-${String(_counter[prefix]).padStart(3, "0")}`;
}

function tc(
  category: Category,
  input: string,
  expect: TestExpectations,
  extra?: { subcategory?: string; occasion?: string; mockIntent?: Partial<IntentClassificationV2> },
): TestCase {
  return {
    id: nextId(category),
    input,
    category,
    ...extra,
    expect,
  };
}

// ==========================================
// CHI — CHICAGO ICONIC (50 tests)
// ==========================================

const CHI_TESTS: TestCase[] = [
  // Deep dish pizza
  tc("CHI", "deep dish pizza", { cuisines: ["Italian"], intentCuisines: ["Italian", "American"] }),
  tc("CHI", "best deep dish in Chicago", { intentCuisines: ["Italian", "American"] }),
  tc("CHI", "deep dish near me", { intentCuisines: ["Italian", "American"] }),
  tc("CHI", "Chicago deep dish", { intentCuisines: ["Italian", "American"] }),
  tc("CHI", "stuffed deep dish pizza", { cuisines: ["Italian"], intentCuisines: ["Italian", "American"] }),
  // Tavern-style pizza
  tc("CHI", "tavern-style pizza", { cuisines: ["Italian"] }),
  tc("CHI", "thin crust tavern pizza", { cuisines: ["Italian"] }),
  tc("CHI", "square cut pizza Chicago", { cuisines: ["Italian"] }),
  // Italian beef
  tc("CHI", "Italian beef sandwich", { cuisines: ["Italian"], intentCuisines: ["American"], intentTags: ["great value"] }, { subcategory: "italian-beef" }),
  tc("CHI", "best Italian beef", { cuisines: ["Italian"] }, { subcategory: "italian-beef" }),
  tc("CHI", "Italian beef dipped", { cuisines: ["Italian"] }, { subcategory: "italian-beef" }),
  tc("CHI", "Italian beef with giardiniera", { cuisines: ["Italian"] }, { subcategory: "italian-beef" }),
  tc("CHI", "Italian combo beef and sausage", { cuisines: ["Italian"] }, { subcategory: "italian-beef" }),
  // Chicago hot dog
  tc("CHI", "Chicago hot dog", { cuisines: ["American"] }, { subcategory: "hot-dog" }),
  tc("CHI", "Chicago style hot dog", { cuisines: ["American"] }, { subcategory: "hot-dog" }),
  tc("CHI", "best hot dogs in Chicago", { cuisines: ["American"] }, { subcategory: "hot-dog" }),
  tc("CHI", "Vienna beef hot dog", { cuisines: ["American"] }, { subcategory: "hot-dog" }),
  // Pierogi & Polish
  tc("CHI", "pierogi", { cuisines: ["Polish"], intentCuisines: ["Polish"] }),
  tc("CHI", "best pierogi in Chicago", { cuisines: ["Polish"], intentCuisines: ["Polish"] }),
  tc("CHI", "Polish food Chicago", { cuisines: ["Polish"] }),
  tc("CHI", "kielbasa and pierogi", { cuisines: ["Polish"], intentCuisines: ["Polish"] }),
  // Puerto Rican / Jibarito
  tc("CHI", "jibarito", { cuisines: ["Puerto Rican"] }, { subcategory: "jibarito" }),
  tc("CHI", "best jibarito in Humboldt Park", { cuisines: ["Puerto Rican"] }, { subcategory: "jibarito" }),
  tc("CHI", "mofongo", { cuisines: ["Puerto Rican"], intentCuisines: ["Puerto Rican"] }),
  tc("CHI", "Puerto Rican food Chicago", { cuisines: ["Puerto Rican"] }),
  // Maxwell Street Polish
  tc("CHI", "Maxwell Street Polish sausage", { cuisines: ["Polish"] }),
  tc("CHI", "Maxwell Street Polish", { cuisines: ["Polish"] }),
  // Garrett's / popcorn
  tc("CHI", "Chicago mix popcorn", {}),
  tc("CHI", "caramel and cheese popcorn", {}),
  // Giardiniera
  tc("CHI", "giardiniera", { cuisines: ["Italian"] }, { subcategory: "giardiniera" }),
  // Rainbow cone
  tc("CHI", "rainbow cone", {}),
  // Malort
  tc("CHI", "Malort shot bar", {}),
  // Portillo's style
  tc("CHI", "chocolate cake shake", {}),
  tc("CHI", "Chicago combo Italian beef", { cuisines: ["Italian"] }),
  // Gyros (Greek Town)
  tc("CHI", "gyro in Greektown", { cuisines: ["Greek"], intentCuisines: ["Greek"] }),
  tc("CHI", "best gyros Chicago", { cuisines: ["Greek"], intentCuisines: ["Greek"] }),
  // Soul food / Southern (South Side)
  tc("CHI", "soul food South Side", { cuisines: ["Southern/Soul Food"], intentCuisines: ["Southern/Soul Food"], intentTags: ["hidden gem"] }),
  tc("CHI", "Harold's fried chicken style", { cuisines: ["Southern/Soul Food"], intentCuisines: ["Korean", "American"] }),
  tc("CHI", "Chicago fried chicken", { cuisines: ["Southern/Soul Food"], intentCuisines: ["Korean", "American"] }),
  // Dim sum / Chinatown
  tc("CHI", "dim sum Chinatown", { cuisines: ["Chinese"], intentCuisines: ["Chinese"] }),
  tc("CHI", "Chinatown noodles", { cuisines: ["Chinese"], intentCuisines: ["Japanese", "Vietnamese", "Thai", "Chinese"] }),
  // Mexican / Pilsen
  tc("CHI", "tacos in Pilsen", { cuisines: ["Mexican"] }),
  tc("CHI", "best tacos in Chicago", { cuisines: ["Mexican"] }),
  tc("CHI", "elote and birria", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }),
  tc("CHI", "tamales Chicago", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }),
  // Indian / Devon Ave
  tc("CHI", "Indian food Devon Avenue", { cuisines: ["Indian"] }),
  tc("CHI", "biryani on Devon", { cuisines: ["Indian"], intentCuisines: ["Indian"] }),
  // Brunch culture
  tc("CHI", "Chicago brunch spot", { cuisines: ["Brunch"], tags: ["brunch spot"] }),
  tc("CHI", "bottomless mimosas Chicago", { cuisines: ["Brunch"] }),
  // Ethiopian / Uptown
  tc("CHI", "Ethiopian food in Uptown", { cuisines: ["Ethiopian"] }),
  tc("CHI", "injera and doro wat", { cuisines: ["Ethiopian"], intentCuisines: ["Ethiopian"] }),
];

// ==========================================
// CUI — CUISINE-SPECIFIC (200 tests)
// 28 cuisines × ~7 phrasings each
// ==========================================

const CUI_TESTS: TestCase[] = [
  // --- Mexican (7) ---
  tc("CUI", "mexican food", { cuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("CUI", "best Mexican restaurant", { cuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("CUI", "authentic Mexican tacos", { cuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("CUI", "taco and burrito spot", { cuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("CUI", "carnitas plate", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("CUI", "enchiladas and mole", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("CUI", "Mexican street food", { cuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  // --- Italian (7) ---
  tc("CUI", "italian restaurant", { cuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("CUI", "best pasta in Chicago", { cuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("CUI", "pizza and risotto", { cuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("CUI", "homemade pasta", { cuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("CUI", "Italian fine dining", { cuisines: ["Italian"], intentTags: ["romantic", "trendy"] }, { subcategory: "Italian" }),
  tc("CUI", "wood fired pizza place", { cuisines: ["Italian"], intentCuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("CUI", "fresh pasta carbonara", { cuisines: ["Italian"], intentCuisines: ["Italian"], intentTags: ["farm-to-table"] }, { subcategory: "Italian" }),
  // --- Japanese (7) ---
  tc("CUI", "japanese restaurant", { cuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("CUI", "best sushi Chicago", { cuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("CUI", "ramen shop", { cuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("CUI", "sushi omakase", { cuisines: ["Japanese"], intentCuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("CUI", "izakaya style dining", { cuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("CUI", "sake bar with sushi", { cuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("CUI", "fresh sushi rolls", { cuisines: ["Japanese"], intentTags: ["farm-to-table"] }, { subcategory: "Japanese" }),
  // --- Thai (7) ---
  tc("CUI", "thai food", { cuisines: ["Thai"] }, { subcategory: "Thai" }),
  tc("CUI", "best Thai restaurant", { cuisines: ["Thai"] }, { subcategory: "Thai" }),
  tc("CUI", "pad thai noodles", { cuisines: ["Thai"] }, { subcategory: "Thai" }),
  tc("CUI", "thai curry", { cuisines: ["Thai", "Indian"] }, { subcategory: "Thai" }),
  tc("CUI", "spicy Thai basil", { cuisines: ["Thai"], intentCuisines: ["Thai", "Indian", "Korean", "Mexican"] }, { subcategory: "Thai" }),
  tc("CUI", "authentic Thai street food", { cuisines: ["Thai"] }, { subcategory: "Thai" }),
  tc("CUI", "Thai iced tea and curry", { cuisines: ["Thai", "Indian"] }, { subcategory: "Thai" }),
  // --- Chinese (7) ---
  tc("CUI", "chinese food", { cuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("CUI", "best Chinese restaurant", { cuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("CUI", "dim sum brunch", { cuisines: ["Chinese", "Brunch"], tags: ["brunch spot"], intentCuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("CUI", "dumpling house", { cuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("CUI", "hand pulled noodles", { cuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("CUI", "Chinese noodle soup", { cuisines: ["Chinese"], intentCuisines: ["Vietnamese", "Japanese"] }, { subcategory: "Chinese" }),
  tc("CUI", "Szechuan Chinese food", { cuisines: ["Chinese"], intentCuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  // --- Korean (7) ---
  tc("CUI", "korean restaurant", { cuisines: ["Korean"] }, { subcategory: "Korean" }),
  tc("CUI", "best Korean BBQ", { cuisines: ["Korean", "BBQ"], intentCuisines: ["BBQ", "Korean"] }, { subcategory: "Korean" }),
  tc("CUI", "bibimbap and kimchi", { cuisines: ["Korean"] }, { subcategory: "Korean" }),
  tc("CUI", "korean fried chicken", { cuisines: ["Korean", "Southern/Soul Food"], intentCuisines: ["Korean", "American"] }, { subcategory: "Korean" }),
  tc("CUI", "KBBQ all you can eat", { cuisines: ["Korean"], intentCuisines: ["Korean"] }, { subcategory: "Korean" }),
  tc("CUI", "soju and Korean food", { cuisines: ["Korean"], intentCuisines: ["Korean"] }, { subcategory: "Korean" }),
  tc("CUI", "Korean hot pot", { cuisines: ["Korean"], intentCuisines: ["Chinese"] }, { subcategory: "Korean" }),
  // --- Indian (7) ---
  tc("CUI", "indian restaurant", { cuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("CUI", "best Indian food Chicago", { cuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("CUI", "butter chicken and naan", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("CUI", "tandoori and biryani", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("CUI", "tikka masala", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("CUI", "south Indian dosa and idli", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("CUI", "Indian curry house", { cuisines: ["Indian", "Thai"] }, { subcategory: "Indian" }),
  // --- French (7) ---
  tc("CUI", "french restaurant", { cuisines: ["French"] }, { subcategory: "French" }),
  tc("CUI", "best French bistro", { cuisines: ["French"] }, { subcategory: "French" }),
  tc("CUI", "crepe and croissant", { cuisines: ["French"], intentCuisines: ["French", "Coffee/Cafe"] }, { subcategory: "French" }),
  tc("CUI", "French fine dining", { cuisines: ["French"], intentTags: ["romantic", "trendy"] }, { subcategory: "French" }),
  tc("CUI", "coq au vin dinner", { cuisines: ["French"], intentCuisines: ["French"] }, { subcategory: "French" }),
  tc("CUI", "steak frites bistro", { cuisines: ["French", "Steak"], intentCuisines: ["French", "Steak"] }, { subcategory: "French" }),
  tc("CUI", "French pastry cafe", { cuisines: ["French"], intentTags: ["trendy"] }, { subcategory: "French" }),
  // --- Seafood (7) ---
  tc("CUI", "seafood restaurant", { cuisines: ["Seafood"] }, { subcategory: "Seafood" }),
  tc("CUI", "best seafood in Chicago", { cuisines: ["Seafood"] }, { subcategory: "Seafood" }),
  tc("CUI", "fresh oyster bar", { cuisines: ["Seafood"] }, { subcategory: "Seafood" }),
  tc("CUI", "lobster and crab dinner", { cuisines: ["Seafood"] }, { subcategory: "Seafood" }),
  tc("CUI", "fish tacos", { cuisines: ["Seafood", "Mexican"] }, { subcategory: "Seafood" }),
  tc("CUI", "raw oysters and seafood tower", { cuisines: ["Seafood"], intentCuisines: ["Japanese"], intentTags: ["farm-to-table"] }, { subcategory: "Seafood" }),
  tc("CUI", "seafood boil", { cuisines: ["Seafood"] }, { subcategory: "Seafood" }),
  // --- Steak (7) ---
  tc("CUI", "steakhouse", { cuisines: ["Steak"] }, { subcategory: "Steak" }),
  tc("CUI", "best steak in Chicago", { cuisines: ["Steak"] }, { subcategory: "Steak" }),
  tc("CUI", "filet mignon dinner", { cuisines: ["Steak"], intentCuisines: ["Steak"] }, { subcategory: "Steak" }),
  tc("CUI", "dry aged steak", { cuisines: ["Steak"] }, { subcategory: "Steak" }),
  tc("CUI", "wagyu beef", { cuisines: ["Steak"], intentCuisines: ["Steak", "Japanese"] }, { subcategory: "Steak" }),
  tc("CUI", "ribeye steakhouse", { cuisines: ["Steak"], intentCuisines: ["Steak"] }, { subcategory: "Steak" }),
  tc("CUI", "porterhouse for two", { cuisines: ["Steak"], intentCuisines: ["Steak"] }, { subcategory: "Steak" }),
  // --- Mediterranean (7) ---
  tc("CUI", "mediterranean restaurant", { cuisines: ["Mediterranean"] }, { subcategory: "Mediterranean" }),
  tc("CUI", "best Mediterranean food", { cuisines: ["Mediterranean"] }, { subcategory: "Mediterranean" }),
  tc("CUI", "mezze platter", { cuisines: ["Mediterranean"] }, { subcategory: "Mediterranean" }),
  tc("CUI", "tabbouleh and hummus", { cuisines: ["Mediterranean", "Middle Eastern"], intentCuisines: ["Middle Eastern"] }, { subcategory: "Mediterranean" }),
  tc("CUI", "grilled lamb Mediterranean", { cuisines: ["Mediterranean"] }, { subcategory: "Mediterranean" }),
  tc("CUI", "tapas and mezze", { cuisines: ["Mediterranean"], intentCuisines: ["Mediterranean"], intentTags: ["trendy"] }, { subcategory: "Mediterranean" }),
  tc("CUI", "healthy Mediterranean bowl", { cuisines: ["Mediterranean"], intentCuisines: ["Mediterranean"], intentTags: ["farm-to-table", "vegan friendly"] }, { subcategory: "Mediterranean" }),
  // --- Vietnamese (7) ---
  tc("CUI", "vietnamese restaurant", { cuisines: ["Vietnamese"] }, { subcategory: "Vietnamese" }),
  tc("CUI", "best pho in Chicago", { cuisines: ["Vietnamese"] }, { subcategory: "Vietnamese" }),
  tc("CUI", "banh mi sandwich", { cuisines: ["Vietnamese"], intentCuisines: ["American"], intentTags: ["great value"] }, { subcategory: "Vietnamese" }),
  tc("CUI", "pho and spring rolls", { cuisines: ["Vietnamese"], intentCuisines: ["Vietnamese"] }, { subcategory: "Vietnamese" }),
  tc("CUI", "Vietnamese noodle soup", { cuisines: ["Vietnamese", "Chinese"], intentCuisines: ["Vietnamese", "Japanese"] }, { subcategory: "Vietnamese" }),
  tc("CUI", "bun bo hue", { cuisines: ["Vietnamese"], intentCuisines: ["Vietnamese"] }, { subcategory: "Vietnamese" }),
  tc("CUI", "Vietnamese coffee and banh mi", { cuisines: ["Vietnamese"], intentCuisines: ["Vietnamese", "Coffee/Cafe"], intentTags: ["brunch spot"] }, { subcategory: "Vietnamese" }),
  // --- Brunch (7) ---
  tc("CUI", "brunch restaurant", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "Brunch" }),
  tc("CUI", "best brunch Chicago", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "Brunch" }),
  tc("CUI", "pancake house", { cuisines: ["Brunch"] }, { subcategory: "Brunch" }),
  tc("CUI", "waffles and mimosas", { cuisines: ["Brunch"] }, { subcategory: "Brunch" }),
  tc("CUI", "eggs benedict brunch", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "Brunch" }),
  tc("CUI", "Sunday brunch spot", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "Brunch" }),
  tc("CUI", "bottomless brunch mimosa", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "Brunch" }),
  // --- American (7) ---
  tc("CUI", "american restaurant", { cuisines: ["American"] }, { subcategory: "American" }),
  tc("CUI", "best burger in Chicago", { cuisines: ["American"] }, { subcategory: "American" }),
  tc("CUI", "classic American diner", { cuisines: ["American"] }, { subcategory: "American" }),
  tc("CUI", "burger and wings", { cuisines: ["American"] }, { subcategory: "American" }),
  tc("CUI", "american comfort food", { cuisines: ["American"], intentCuisines: ["American"], intentTags: ["great value"] }, { subcategory: "American" }),
  tc("CUI", "gourmet burger spot", { cuisines: ["American"] }, { subcategory: "American" }),
  tc("CUI", "chicken wings bar", { cuisines: ["American"] }, { subcategory: "American" }),
  // --- Brewery/Beer Bar (7) ---
  tc("CUI", "brewery tour", { cuisines: ["Brewery/Beer Bar"], intentCuisines: ["Brewery/Beer Bar"] }, { subcategory: "Brewery" }),
  tc("CUI", "best craft beer Chicago", { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "Brewery" }),
  tc("CUI", "brewpub with food", { cuisines: ["Brewery/Beer Bar"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["lively atmosphere"] }, { subcategory: "Brewery" }),
  tc("CUI", "IPA and ale bar", { cuisines: ["Brewery/Beer Bar"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "Brewery" }),
  tc("CUI", "tap room beer flights", { cuisines: ["Brewery/Beer Bar"], intentCuisines: ["Brewery/Beer Bar"] }, { subcategory: "Brewery" }),
  tc("CUI", "lager and stout selection", { cuisines: ["Brewery/Beer Bar"] }, { subcategory: "Brewery" }),
  tc("CUI", "beer garden Chicago", { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "Brewery" }),
  // --- Ethiopian (7) ---
  tc("CUI", "ethiopian restaurant", { cuisines: ["Ethiopian"] }, { subcategory: "Ethiopian" }),
  tc("CUI", "best Ethiopian food Chicago", { cuisines: ["Ethiopian"] }, { subcategory: "Ethiopian" }),
  tc("CUI", "injera platter", { cuisines: ["Ethiopian"], intentCuisines: ["Ethiopian"] }, { subcategory: "Ethiopian" }),
  tc("CUI", "tibs and kitfo", { cuisines: ["Ethiopian"], intentCuisines: ["Ethiopian"] }, { subcategory: "Ethiopian" }),
  tc("CUI", "doro wat dinner", { cuisines: ["Ethiopian"], intentCuisines: ["Ethiopian"] }, { subcategory: "Ethiopian" }),
  tc("CUI", "Ethiopian vegetarian combo", { cuisines: ["Ethiopian"], dietary: ["vegetarian"] }, { subcategory: "Ethiopian" }),
  tc("CUI", "berbere spiced Ethiopian", { cuisines: ["Ethiopian"], intentCuisines: ["Thai", "Indian", "Korean", "Mexican"] }, { subcategory: "Ethiopian" }),
  // --- Peruvian (7) ---
  tc("CUI", "peruvian restaurant", { cuisines: ["Peruvian"] }, { subcategory: "Peruvian" }),
  tc("CUI", "best Peruvian food Chicago", { cuisines: ["Peruvian"] }, { subcategory: "Peruvian" }),
  tc("CUI", "ceviche bar", { cuisines: ["Peruvian"], intentCuisines: ["Peruvian", "Seafood"] }, { subcategory: "Peruvian" }),
  tc("CUI", "lomo saltado", { cuisines: ["Peruvian"], intentCuisines: ["Peruvian"] }, { subcategory: "Peruvian" }),
  tc("CUI", "anticucho and causa", { cuisines: ["Peruvian"], intentCuisines: ["Peruvian"] }, { subcategory: "Peruvian" }),
  tc("CUI", "Peruvian chicken", { cuisines: ["Peruvian"] }, { subcategory: "Peruvian" }),
  tc("CUI", "Peruvian seafood ceviche", { cuisines: ["Peruvian", "Seafood"], intentCuisines: ["Peruvian", "Seafood"] }, { subcategory: "Peruvian" }),
  // --- Brazilian (7) ---
  tc("CUI", "brazilian restaurant", { cuisines: ["Brazilian"] }, { subcategory: "Brazilian" }),
  tc("CUI", "best Brazilian steakhouse", { cuisines: ["Brazilian", "Steak"], intentCuisines: ["Brazilian", "Steak"] }, { subcategory: "Brazilian" }),
  tc("CUI", "churrasco grill", { cuisines: ["Brazilian"], intentCuisines: ["Brazilian", "Steak"] }, { subcategory: "Brazilian" }),
  tc("CUI", "rodizio all you can eat", { cuisines: ["Brazilian"], intentCuisines: ["Brazilian"] }, { subcategory: "Brazilian" }),
  tc("CUI", "picanha and caipirinha", { cuisines: ["Brazilian"], intentCuisines: ["Brazilian", "Steak"] }, { subcategory: "Brazilian" }),
  tc("CUI", "feijoada Brazilian dinner", { cuisines: ["Brazilian"], intentCuisines: ["Brazilian"] }, { subcategory: "Brazilian" }),
  tc("CUI", "Brazilian BBQ night", { cuisines: ["Brazilian", "BBQ"], intentCuisines: ["BBQ", "Korean"] }, { subcategory: "Brazilian" }),
  // --- Vegan (7) ---
  tc("CUI", "vegan restaurant", { cuisines: ["Vegan"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, { subcategory: "Vegan" }),
  tc("CUI", "best vegan food Chicago", { cuisines: ["Vegan"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, { subcategory: "Vegan" }),
  tc("CUI", "plant-based dining", { cuisines: ["Vegan"], tags: ["vegan friendly"] }, { subcategory: "Vegan" }),
  tc("CUI", "vegan brunch spot", { cuisines: ["Vegan", "Brunch"], tags: ["vegan friendly", "brunch spot"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, { subcategory: "Vegan" }),
  tc("CUI", "meatless burger", { cuisines: ["Vegan", "American"] }, { subcategory: "Vegan" }),
  tc("CUI", "vegan sushi rolls", { cuisines: ["Vegan", "Japanese"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, { subcategory: "Vegan" }),
  tc("CUI", "plant based comfort food", { cuisines: ["Vegan"], tags: ["vegan friendly"], intentCuisines: ["American"], intentTags: ["great value"] }, { subcategory: "Vegan" }),
  // --- Cocktail Bar (7) ---
  tc("CUI", "cocktail bar", { cuisines: ["Cocktail Bar"], tags: ["craft cocktails"] }, { subcategory: "Cocktail Bar" }),
  tc("CUI", "best cocktail lounge Chicago", { cuisines: ["Cocktail Bar"], tags: ["craft cocktails"] }, { subcategory: "Cocktail Bar" }),
  tc("CUI", "speakeasy bar", { cuisines: ["Cocktail Bar"] }, { subcategory: "Cocktail Bar" }),
  tc("CUI", "mixology bar downtown", { cuisines: ["Cocktail Bar"], tags: ["craft cocktails"] }, { subcategory: "Cocktail Bar" }),
  tc("CUI", "craft cocktails lounge", { cuisines: ["Cocktail Bar"], tags: ["craft cocktails"], intentTags: ["craft cocktails"] }, { subcategory: "Cocktail Bar" }),
  tc("CUI", "speakeasy hidden bar", { cuisines: ["Cocktail Bar"], tags: ["hidden gem"] }, { subcategory: "Cocktail Bar" }),
  tc("CUI", "upscale cocktail experience", { cuisines: ["Cocktail Bar"], tags: ["craft cocktails"], intentTags: ["trendy", "romantic"] }, { subcategory: "Cocktail Bar" }),
  // --- Coffee/Cafe (7) ---
  tc("CUI", "coffee shop", { cuisines: ["Coffee/Cafe"], intentTags: ["brunch spot"] }, { subcategory: "Coffee/Cafe" }),
  tc("CUI", "best cafe Chicago", { cuisines: ["Coffee/Cafe"], intentTags: ["brunch spot", "quiet"] }, { subcategory: "Coffee/Cafe" }),
  tc("CUI", "espresso bar", { cuisines: ["Coffee/Cafe"], intentCuisines: ["Coffee/Cafe"] }, { subcategory: "Coffee/Cafe" }),
  tc("CUI", "latte and pastry", { cuisines: ["Coffee/Cafe"], intentCuisines: ["Coffee/Cafe"], intentTags: ["trendy"] }, { subcategory: "Coffee/Cafe" }),
  tc("CUI", "cappuccino cafe", { cuisines: ["Coffee/Cafe"], intentCuisines: ["Coffee/Cafe"], intentTags: ["brunch spot", "quiet"] }, { subcategory: "Coffee/Cafe" }),
  tc("CUI", "cortado and croissant", { cuisines: ["Coffee/Cafe"], intentCuisines: ["Coffee/Cafe", "French"] }, { subcategory: "Coffee/Cafe" }),
  tc("CUI", "cozy coffee shop study spot", { cuisines: ["Coffee/Cafe"], intentTags: ["brunch spot", "quiet", "hidden gem"] }, { subcategory: "Coffee/Cafe" }),
  // --- Polish (7) ---
  tc("CUI", "polish restaurant", { cuisines: ["Polish"] }, { subcategory: "Polish" }),
  tc("CUI", "best Polish food Chicago", { cuisines: ["Polish"] }, { subcategory: "Polish" }),
  tc("CUI", "pierogi dinner", { cuisines: ["Polish"], intentCuisines: ["Polish"] }, { subcategory: "Polish" }),
  tc("CUI", "kielbasa and beer", { cuisines: ["Polish", "Brewery/Beer Bar"], intentCuisines: ["Polish", "Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "Polish" }),
  tc("CUI", "golabki and bigos", { cuisines: ["Polish"], intentCuisines: ["Polish"] }, { subcategory: "Polish" }),
  tc("CUI", "Polish deli food", { cuisines: ["Polish"] }, { subcategory: "Polish" }),
  tc("CUI", "authentic Polish spot", { cuisines: ["Polish"], intentTags: ["hidden gem"] }, { subcategory: "Polish" }),
  // --- Puerto Rican (7) ---
  tc("CUI", "puerto rican restaurant", { cuisines: ["Puerto Rican"] }, { subcategory: "Puerto Rican" }),
  tc("CUI", "best Puerto Rican food", { cuisines: ["Puerto Rican"] }, { subcategory: "Puerto Rican" }),
  tc("CUI", "mofongo and pernil", { cuisines: ["Puerto Rican"], intentCuisines: ["Puerto Rican"] }, { subcategory: "Puerto Rican" }),
  tc("CUI", "tostones and alcapurria", { cuisines: ["Puerto Rican"], intentCuisines: ["Puerto Rican"] }, { subcategory: "Puerto Rican" }),
  tc("CUI", "arroz con gandules", { cuisines: ["Puerto Rican"], intentCuisines: ["Puerto Rican"] }, { subcategory: "Puerto Rican" }),
  tc("CUI", "Puerto Rican comfort food", { cuisines: ["Puerto Rican"], intentCuisines: ["American"], intentTags: ["great value"] }, { subcategory: "Puerto Rican" }),
  tc("CUI", "Humboldt Park Puerto Rican", { cuisines: ["Puerto Rican"] }, { subcategory: "Puerto Rican" }),
  // --- Southern/Soul Food (7) ---
  tc("CUI", "soul food restaurant", { cuisines: ["Southern/Soul Food"], intentCuisines: ["Southern/Soul Food"], intentTags: ["hidden gem"] }, { subcategory: "Southern" }),
  tc("CUI", "best southern food Chicago", { cuisines: ["Southern/Soul Food"] }, { subcategory: "Southern" }),
  tc("CUI", "fried chicken and waffles", { cuisines: ["Southern/Soul Food", "Brunch"], intentCuisines: ["Korean", "American"] }, { subcategory: "Southern" }),
  tc("CUI", "collard greens and cornbread", { cuisines: ["Southern/Soul Food"], intentCuisines: ["Southern/Soul Food"] }, { subcategory: "Southern" }),
  tc("CUI", "gumbo and jambalaya", { cuisines: ["Southern/Soul Food"] }, { subcategory: "Southern" }),
  tc("CUI", "catfish dinner", { cuisines: ["Southern/Soul Food"] }, { subcategory: "Southern" }),
  tc("CUI", "cajun and creole food", { cuisines: ["Southern/Soul Food"], intentCuisines: ["Southern/Soul Food"] }, { subcategory: "Southern" }),
  // --- Middle Eastern (7) ---
  tc("CUI", "middle eastern restaurant", { cuisines: ["Middle Eastern"], intentCuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("CUI", "best Middle Eastern food", { cuisines: ["Middle Eastern"], intentCuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("CUI", "shawarma and falafel", { cuisines: ["Middle Eastern"], intentCuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("CUI", "hummus and pita", { cuisines: ["Middle Eastern"], intentCuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("CUI", "kebab restaurant", { cuisines: ["Middle Eastern"], intentCuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("CUI", "Lebanese food Chicago", { cuisines: ["Middle Eastern"], intentCuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("CUI", "Turkish kebab and baklava", { cuisines: ["Middle Eastern"], intentCuisines: ["Middle Eastern", "Greek"] }, { subcategory: "Middle Eastern" }),
  // --- Greek (7) ---
  tc("CUI", "greek restaurant", { cuisines: ["Greek"] }, { subcategory: "Greek" }),
  tc("CUI", "best Greek food Greektown", { cuisines: ["Greek"] }, { subcategory: "Greek" }),
  tc("CUI", "gyro and souvlaki", { cuisines: ["Greek"], intentCuisines: ["Greek"] }, { subcategory: "Greek" }),
  tc("CUI", "moussaka dinner", { cuisines: ["Greek"], intentCuisines: ["Greek"] }, { subcategory: "Greek" }),
  tc("CUI", "spanakopita and tzatziki", { cuisines: ["Greek"], intentCuisines: ["Greek"] }, { subcategory: "Greek" }),
  tc("CUI", "saganaki flaming cheese", { cuisines: ["Greek"], intentCuisines: ["Greek"] }, { subcategory: "Greek" }),
  tc("CUI", "Greek taverna", { cuisines: ["Greek"] }, { subcategory: "Greek" }),
  // --- Fusion (7) ---
  tc("CUI", "fusion restaurant", { cuisines: ["Fusion"] }, { subcategory: "Fusion" }),
  tc("CUI", "Asian fusion", { cuisines: ["Fusion"], intentTags: ["trendy"] }, { subcategory: "Fusion" }),
  tc("CUI", "eclectic fusion dining", { cuisines: ["Fusion"] }, { subcategory: "Fusion" }),
  tc("CUI", "cross-cultural cuisine", { cuisines: ["Fusion"] }, { subcategory: "Fusion" }),
  tc("CUI", "fusion tacos", { cuisines: ["Fusion", "Mexican"], intentTags: ["trendy"] }, { subcategory: "Fusion" }),
  tc("CUI", "creative fusion menu", { cuisines: ["Fusion"], intentTags: ["trendy"] }, { subcategory: "Fusion" }),
  tc("CUI", "fusion sushi burritos", { cuisines: ["Fusion", "Japanese", "Mexican"], intentTags: ["trendy"] }, { subcategory: "Fusion" }),
  // --- BBQ (7) ---
  tc("CUI", "bbq restaurant", { cuisines: ["Korean", "BBQ"], intentCuisines: ["BBQ", "Korean"] }, { subcategory: "BBQ" }),
  tc("CUI", "best barbecue Chicago", { cuisines: ["BBQ"] }, { subcategory: "BBQ" }),
  tc("CUI", "smoked brisket", { cuisines: ["BBQ"], intentCuisines: ["BBQ"] }, { subcategory: "BBQ" }),
  tc("CUI", "ribs and pulled pork", { cuisines: ["BBQ"] }, { subcategory: "BBQ" }),
  tc("CUI", "pitmaster bbq joint", { cuisines: ["Korean", "BBQ"], intentCuisines: ["BBQ", "Korean"] }, { subcategory: "BBQ" }),
  tc("CUI", "smoked meat platter", { cuisines: ["BBQ"] }, { subcategory: "BBQ" }),
  tc("CUI", "barbecue ribs and cornbread", { cuisines: ["BBQ", "Southern/Soul Food"] }, { subcategory: "BBQ" }),
];

// ==========================================
// DSH — SPECIFIC DISHES (200 tests)
// ==========================================

const DSH_TESTS: TestCase[] = [
  // --- Mexican dishes ---
  tc("DSH", "birria tacos", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("DSH", "chilaquiles for brunch", { cuisines: ["Brunch"], tags: ["brunch spot"], intentCuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("DSH", "al pastor tacos", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("DSH", "pozole soup", { cuisines: ["Mexican"], intentCuisines: ["Mexican", "Vietnamese", "Japanese"] }, { subcategory: "Mexican" }),
  tc("DSH", "elote street corn", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("DSH", "tamales fresh", { cuisines: ["Mexican"], intentCuisines: ["Mexican"], intentTags: ["farm-to-table"] }, { subcategory: "Mexican" }),
  tc("DSH", "churros and chocolate", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("DSH", "sopapilla dessert", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("DSH", "carnitas tacos", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("DSH", "enchilada plate", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("DSH", "quesadilla and guac", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("DSH", "mole negro", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("DSH", "birria ramen fusion", { cuisines: ["Japanese", "Mexican"], intentCuisines: ["Mexican"], intentTags: ["trendy"] }, { subcategory: "Mexican" }),
  tc("DSH", "street tacos al pastor", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  tc("DSH", "burrito bowl", { cuisines: ["Mexican"] }, { subcategory: "Mexican" }),
  // --- Japanese dishes ---
  tc("DSH", "tonkatsu curry", { cuisines: ["Thai", "Indian"], intentCuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("DSH", "yakitori skewers", { intentCuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("DSH", "udon noodle soup", { cuisines: ["Chinese"], intentCuisines: ["Japanese", "Vietnamese"] }, { subcategory: "Japanese" }),
  tc("DSH", "tempura dinner", { intentCuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("DSH", "katsu sandwich", { intentCuisines: ["Japanese", "American"], intentTags: ["great value"] }, { subcategory: "Japanese" }),
  tc("DSH", "sashimi platter", { intentCuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("DSH", "gyoza dumplings", { cuisines: ["Chinese"], intentCuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("DSH", "matcha dessert cafe", { intentCuisines: ["Japanese", "Coffee/Cafe"], intentTags: ["brunch spot", "quiet"] }, { subcategory: "Japanese" }),
  tc("DSH", "poke bowl lunch", { intentCuisines: ["Japanese", "Seafood"], intentTags: ["farm-to-table", "great value"] }, { subcategory: "Japanese" }),
  tc("DSH", "sushi omakase experience", { cuisines: ["Japanese"], intentCuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("DSH", "ramen and gyoza combo", { cuisines: ["Japanese"], intentCuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("DSH", "wagyu steak dinner", { cuisines: ["Steak"], intentCuisines: ["Steak", "Japanese"] }, { subcategory: "Japanese" }),
  tc("DSH", "izakaya small plates", { cuisines: ["Japanese"], intentTags: ["trendy"] }, { subcategory: "Japanese" }),
  tc("DSH", "sake flight pairing", { cuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  tc("DSH", "chirashi bowl", { cuisines: ["Japanese"] }, { subcategory: "Japanese" }),
  // --- Chinese dishes ---
  tc("DSH", "bao buns", { intentCuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("DSH", "hotpot dinner", { intentCuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("DSH", "hot pot all you can eat", { intentCuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("DSH", "peking duck", { intentCuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("DSH", "szechuan spicy noodles", { cuisines: ["Chinese"], intentCuisines: ["Chinese", "Thai", "Indian", "Korean", "Mexican"] }, { subcategory: "Chinese" }),
  tc("DSH", "wonton soup", { intentCuisines: ["Chinese", "Vietnamese", "Japanese"] }, { subcategory: "Chinese" }),
  tc("DSH", "dan dan noodles", { cuisines: ["Chinese"], intentCuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("DSH", "kung pao chicken", { intentCuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("DSH", "mapo tofu", { intentCuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("DSH", "char siu pork", { intentCuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("DSH", "xiao long bao dumplings", { cuisines: ["Chinese"], intentCuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("DSH", "sichuan hot pot", { intentCuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("DSH", "dim sum cart service", { cuisines: ["Chinese"], intentCuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  tc("DSH", "crispy peking duck", { intentCuisines: ["Chinese", "Korean", "American"] }, { subcategory: "Chinese" }),
  tc("DSH", "hand pulled noodle bowl", { cuisines: ["Chinese"] }, { subcategory: "Chinese" }),
  // --- Italian dishes ---
  tc("DSH", "gnocchi with pesto", { intentCuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("DSH", "tiramisu dessert", { intentCuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("DSH", "osso buco dinner", { intentCuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("DSH", "bolognese pasta", { cuisines: ["Italian"], intentCuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("DSH", "carbonara and wine", { cuisines: ["Italian"], intentCuisines: ["Italian"], intentTags: ["romantic"] }, { subcategory: "Italian" }),
  tc("DSH", "focaccia and bruschetta", { intentCuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("DSH", "arancini appetizer", { intentCuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("DSH", "prosciutto and melon", { intentCuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("DSH", "margherita pizza", { cuisines: ["Italian"], intentCuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("DSH", "fresh ricotta ravioli", { cuisines: ["Italian"], intentTags: ["farm-to-table"] }, { subcategory: "Italian" }),
  tc("DSH", "eggplant parmigiana", { cuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("DSH", "cacio e pepe", { cuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("DSH", "wood fired margherita", { cuisines: ["Italian"], intentCuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("DSH", "lasagna dinner", { cuisines: ["Italian"] }, { subcategory: "Italian" }),
  tc("DSH", "risotto with truffle", { cuisines: ["Italian"] }, { subcategory: "Italian" }),
  // --- Indian dishes ---
  tc("DSH", "tikka masala dinner", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("DSH", "biryani and naan", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("DSH", "vindaloo spicy curry", { cuisines: ["Indian", "Thai"], intentCuisines: ["Indian", "Thai", "Korean", "Mexican"] }, { subcategory: "Indian" }),
  tc("DSH", "samosa appetizer", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("DSH", "paneer tikka", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("DSH", "dal and rice", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("DSH", "korma mild curry", { cuisines: ["Indian", "Thai"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("DSH", "chana masala plate", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("DSH", "dosa and sambar", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("DSH", "butter chicken naan", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("DSH", "tandoori chicken", { cuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("DSH", "palak paneer", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("DSH", "rogan josh lamb", { cuisines: ["Indian", "Mediterranean"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("DSH", "idli and vada", { cuisines: ["Indian"], intentCuisines: ["Indian"] }, { subcategory: "Indian" }),
  tc("DSH", "masala dosa breakfast", { cuisines: ["Indian"], intentCuisines: ["Indian"], tags: ["brunch spot"] }, { subcategory: "Indian" }),
  // --- Thai dishes ---
  tc("DSH", "green curry chicken", { cuisines: ["Thai", "Indian"], intentCuisines: ["Thai"] }, { subcategory: "Thai" }),
  tc("DSH", "tom yum soup", { intentCuisines: ["Thai", "Vietnamese", "Japanese"] }, { subcategory: "Thai" }),
  tc("DSH", "som tum papaya salad", { intentCuisines: ["Thai"], intentTags: ["farm-to-table", "vegan friendly"] }, { subcategory: "Thai" }),
  tc("DSH", "chicken satay", { intentCuisines: ["Thai"] }, { subcategory: "Thai" }),
  tc("DSH", "pad see ew noodles", { cuisines: ["Chinese"], intentCuisines: ["Thai"] }, { subcategory: "Thai" }),
  tc("DSH", "larb salad", { intentCuisines: ["Thai"], intentTags: ["farm-to-table", "vegan friendly"] }, { subcategory: "Thai" }),
  tc("DSH", "mango sticky rice dessert", { intentCuisines: ["Thai"] }, { subcategory: "Thai" }),
  tc("DSH", "pad thai and spring rolls", { cuisines: ["Thai"], intentCuisines: ["Vietnamese"] }, { subcategory: "Thai" }),
  tc("DSH", "Thai basil stir fry", { cuisines: ["Thai"] }, { subcategory: "Thai" }),
  tc("DSH", "massaman curry", { cuisines: ["Thai", "Indian"] }, { subcategory: "Thai" }),
  tc("DSH", "papaya salad spicy", { intentCuisines: ["Thai", "Indian", "Korean", "Mexican"] }, { subcategory: "Thai" }),
  tc("DSH", "Thai coconut soup", { cuisines: ["Thai"], intentCuisines: ["Vietnamese", "Japanese"] }, { subcategory: "Thai" }),
  // --- Korean dishes ---
  tc("DSH", "bulgogi beef", { intentCuisines: ["Korean"] }, { subcategory: "Korean" }),
  tc("DSH", "japchae noodles", { cuisines: ["Chinese"], intentCuisines: ["Korean"] }, { subcategory: "Korean" }),
  tc("DSH", "tteokbokki snack", { intentCuisines: ["Korean"] }, { subcategory: "Korean" }),
  tc("DSH", "galbi short ribs", { cuisines: ["BBQ"], intentCuisines: ["Korean"] }, { subcategory: "Korean" }),
  tc("DSH", "banchan spread", { intentCuisines: ["Korean"] }, { subcategory: "Korean" }),
  tc("DSH", "kimchi jjigae stew", { cuisines: ["Korean"], intentCuisines: ["Korean"] }, { subcategory: "Korean" }),
  tc("DSH", "korean bbq all you can eat", { cuisines: ["Korean", "BBQ"], intentCuisines: ["Korean", "BBQ"] }, { subcategory: "Korean" }),
  tc("DSH", "soju bomb night", { intentCuisines: ["Korean"] }, { subcategory: "Korean" }),
  tc("DSH", "bibimbap bowl", { cuisines: ["Korean"] }, { subcategory: "Korean" }),
  tc("DSH", "Korean corn dog", { cuisines: ["Korean"] }, { subcategory: "Korean" }),
  tc("DSH", "kimchi fried rice", { cuisines: ["Korean"], intentCuisines: ["Korean", "American"] }, { subcategory: "Korean" }),
  tc("DSH", "army stew budae jjigae", { cuisines: ["Korean"] }, { subcategory: "Korean" }),
  // --- Vietnamese dishes ---
  tc("DSH", "bun bo hue spicy", { cuisines: ["Vietnamese"], intentCuisines: ["Vietnamese", "Thai", "Indian", "Korean", "Mexican"] }, { subcategory: "Vietnamese" }),
  tc("DSH", "spring rolls fresh", { intentCuisines: ["Vietnamese"], intentTags: ["farm-to-table"] }, { subcategory: "Vietnamese" }),
  tc("DSH", "com tam broken rice", { intentCuisines: ["Vietnamese"] }, { subcategory: "Vietnamese" }),
  tc("DSH", "vermicelli bowl", { intentCuisines: ["Vietnamese"] }, { subcategory: "Vietnamese" }),
  tc("DSH", "pho bo beef noodle soup", { cuisines: ["Vietnamese", "Chinese"], intentCuisines: ["Vietnamese", "Japanese"] }, { subcategory: "Vietnamese" }),
  tc("DSH", "banh mi crispy pork", { cuisines: ["Vietnamese"], intentCuisines: ["Korean", "American"] }, { subcategory: "Vietnamese" }),
  tc("DSH", "Vietnamese iced coffee", { cuisines: ["Vietnamese"], intentTags: ["brunch spot"] }, { subcategory: "Vietnamese" }),
  tc("DSH", "lemongrass chicken pho", { cuisines: ["Vietnamese"] }, { subcategory: "Vietnamese" }),
  // --- French dishes ---
  tc("DSH", "tartare appetizer", { intentCuisines: ["French"] }, { subcategory: "French" }),
  tc("DSH", "coq au vin classic", { intentCuisines: ["French"] }, { subcategory: "French" }),
  tc("DSH", "bouillabaisse seafood stew", { cuisines: ["Seafood"], intentCuisines: ["French", "Seafood"] }, { subcategory: "French" }),
  tc("DSH", "steak frites dinner", { cuisines: ["Steak"], intentCuisines: ["French", "Steak"] }, { subcategory: "French" }),
  tc("DSH", "chocolate souffle", { intentCuisines: ["French"] }, { subcategory: "French" }),
  tc("DSH", "croissant and espresso", { intentCuisines: ["French", "Coffee/Cafe"] }, { subcategory: "French" }),
  tc("DSH", "escargot appetizer", { intentCuisines: ["French"] }, { subcategory: "French" }),
  tc("DSH", "ratatouille dinner", { intentCuisines: ["French"] }, { subcategory: "French" }),
  tc("DSH", "French onion soup", { cuisines: ["French"], intentCuisines: ["Vietnamese", "Japanese"] }, { subcategory: "French" }),
  tc("DSH", "duck confit", { cuisines: ["French"] }, { subcategory: "French" }),
  tc("DSH", "creme brulee dessert", { cuisines: ["French"] }, { subcategory: "French" }),
  tc("DSH", "beef bourguignon", { cuisines: ["French"] }, { subcategory: "French" }),
  // --- BBQ & Southern dishes ---
  tc("DSH", "burnt ends sandwich", { intentCuisines: ["BBQ"], intentTags: ["great value"] }, { subcategory: "BBQ" }),
  tc("DSH", "smoked brisket platter", { cuisines: ["BBQ"], intentCuisines: ["BBQ", "American", "Steak"] }, { subcategory: "BBQ" }),
  tc("DSH", "mac and cheese side", { intentCuisines: ["Southern/Soul Food", "American"] }, { subcategory: "Southern" }),
  tc("DSH", "po boy sandwich", { intentCuisines: ["Southern/Soul Food"], intentTags: ["great value"] }, { subcategory: "Southern" }),
  tc("DSH", "hush puppies", { intentCuisines: ["Southern/Soul Food"] }, { subcategory: "Southern" }),
  tc("DSH", "crawfish boil", { cuisines: ["Seafood"], intentCuisines: ["Southern/Soul Food", "Seafood"] }, { subcategory: "Southern" }),
  tc("DSH", "shrimp and grits", { cuisines: ["Seafood"], intentCuisines: ["Seafood", "Southern/Soul Food", "Brunch"] }, { subcategory: "Southern" }),
  tc("DSH", "pulled pork sandwich", { cuisines: ["BBQ"], intentCuisines: ["American"], intentTags: ["great value"] }, { subcategory: "BBQ" }),
  tc("DSH", "ribs and coleslaw", { cuisines: ["BBQ"] }, { subcategory: "BBQ" }),
  tc("DSH", "brisket burnt ends", { cuisines: ["BBQ"], intentCuisines: ["BBQ"] }, { subcategory: "BBQ" }),
  tc("DSH", "smoked wings", { cuisines: ["American", "BBQ"], intentCuisines: ["American", "Steak"] }, { subcategory: "BBQ" }),
  tc("DSH", "collard greens and cornbread", { cuisines: ["Southern/Soul Food"], intentCuisines: ["Southern/Soul Food"] }, { subcategory: "Southern" }),
  // --- Ethiopian dishes ---
  tc("DSH", "injera and stew", { cuisines: ["Ethiopian"], intentCuisines: ["Ethiopian"] }, { subcategory: "Ethiopian" }),
  tc("DSH", "doro wat chicken", { cuisines: ["Ethiopian"], intentCuisines: ["Ethiopian"] }, { subcategory: "Ethiopian" }),
  tc("DSH", "kitfo raw beef", { cuisines: ["Ethiopian"], intentCuisines: ["Ethiopian", "Japanese"], intentTags: ["farm-to-table"] }, { subcategory: "Ethiopian" }),
  tc("DSH", "tibs sauteed meat", { cuisines: ["Ethiopian"], intentCuisines: ["Ethiopian"] }, { subcategory: "Ethiopian" }),
  tc("DSH", "Ethiopian veggie combo", { cuisines: ["Ethiopian"], dietary: ["veggie"] }, { subcategory: "Ethiopian" }),
  tc("DSH", "misir wot lentils", { cuisines: ["Ethiopian"] }, { subcategory: "Ethiopian" }),
  tc("DSH", "Ethiopian coffee ceremony", { cuisines: ["Ethiopian"], intentTags: ["brunch spot"] }, { subcategory: "Ethiopian" }),
  tc("DSH", "berbere spiced tibs", { cuisines: ["Ethiopian"], intentCuisines: ["Ethiopian", "Thai", "Indian", "Korean", "Mexican"] }, { subcategory: "Ethiopian" }),
  // --- Peruvian dishes ---
  tc("DSH", "ceviche fresh lime", { intentCuisines: ["Peruvian", "Seafood"], intentTags: ["farm-to-table"] }, { subcategory: "Peruvian" }),
  tc("DSH", "lomo saltado stir fry", { intentCuisines: ["Peruvian"] }, { subcategory: "Peruvian" }),
  tc("DSH", "anticucho skewers", { intentCuisines: ["Peruvian"] }, { subcategory: "Peruvian" }),
  tc("DSH", "causa layered potato", { intentCuisines: ["Peruvian"] }, { subcategory: "Peruvian" }),
  tc("DSH", "aji de gallina", { cuisines: ["Peruvian"] }, { subcategory: "Peruvian" }),
  tc("DSH", "Peruvian ceviche and pisco sour", { cuisines: ["Peruvian"], intentCuisines: ["Peruvian", "Seafood"] }, { subcategory: "Peruvian" }),
  tc("DSH", "papa a la huancaina", { cuisines: ["Peruvian"] }, { subcategory: "Peruvian" }),
  tc("DSH", "tiradito sashimi style", { cuisines: ["Peruvian"], intentCuisines: ["Japanese"] }, { subcategory: "Peruvian" }),
  // --- Brazilian dishes ---
  tc("DSH", "churrasco steak dinner", { cuisines: ["Steak"], intentCuisines: ["Brazilian", "Steak"] }, { subcategory: "Brazilian" }),
  tc("DSH", "rodizio experience", { intentCuisines: ["Brazilian"] }, { subcategory: "Brazilian" }),
  tc("DSH", "picanha grilled", { intentCuisines: ["Brazilian", "Steak"], intentTags: [] }, { subcategory: "Brazilian" }),
  tc("DSH", "feijoada black bean stew", { intentCuisines: ["Brazilian"] }, { subcategory: "Brazilian" }),
  tc("DSH", "caipirinha cocktail", { intentCuisines: ["Brazilian"], tags: ["craft cocktails"] }, { subcategory: "Brazilian" }),
  tc("DSH", "pao de queijo cheese bread", { intentCuisines: ["Brazilian"] }, { subcategory: "Brazilian" }),
  tc("DSH", "Brazilian acai bowl", { cuisines: ["Brazilian"] }, { subcategory: "Brazilian" }),
  tc("DSH", "coxinha and pastels", { cuisines: ["Brazilian"] }, { subcategory: "Brazilian" }),
  // --- Middle Eastern dishes ---
  tc("DSH", "shawarma wrap", { intentCuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("DSH", "falafel plate", { intentCuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("DSH", "hummus and warm pita", { intentCuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("DSH", "baba ganoush dip", { intentCuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("DSH", "labneh breakfast", { intentCuisines: ["Middle Eastern"], tags: ["brunch spot"] }, { subcategory: "Middle Eastern" }),
  tc("DSH", "fattoush salad", { intentCuisines: ["Middle Eastern"], intentTags: ["farm-to-table", "vegan friendly"] }, { subcategory: "Middle Eastern" }),
  tc("DSH", "kibbeh appetizer", { intentCuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("DSH", "kebab platter mixed grill", { cuisines: ["Middle Eastern"], intentCuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("DSH", "manakeesh flatbread", { cuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("DSH", "lamb shawarma plate", { cuisines: ["Mediterranean", "Middle Eastern"], intentCuisines: ["Middle Eastern"] }, { subcategory: "Middle Eastern" }),
  tc("DSH", "Turkish coffee and baklava", { intentCuisines: ["Middle Eastern", "Greek", "Coffee/Cafe"] }, { subcategory: "Middle Eastern" }),
  tc("DSH", "shakshuka brunch", { cuisines: ["Middle Eastern", "Brunch"], tags: ["brunch spot"] }, { subcategory: "Middle Eastern" }),
  // --- Greek dishes ---
  tc("DSH", "gyro platter", { cuisines: ["Greek"], intentCuisines: ["Greek"] }, { subcategory: "Greek" }),
  tc("DSH", "souvlaki skewers", { intentCuisines: ["Greek"] }, { subcategory: "Greek" }),
  tc("DSH", "moussaka baked", { intentCuisines: ["Greek"] }, { subcategory: "Greek" }),
  tc("DSH", "spanakopita appetizer", { cuisines: ["Greek"], intentCuisines: ["Greek"] }, { subcategory: "Greek" }),
  tc("DSH", "baklava dessert", { intentCuisines: ["Greek", "Middle Eastern"] }, { subcategory: "Greek" }),
  tc("DSH", "tzatziki and pita", { cuisines: ["Greek", "Middle Eastern"], intentCuisines: ["Greek", "Middle Eastern"] }, { subcategory: "Greek" }),
  tc("DSH", "saganaki cheese", { intentCuisines: ["Greek"] }, { subcategory: "Greek" }),
  tc("DSH", "lamb chops souvlaki", { cuisines: ["Mediterranean"], intentCuisines: ["Greek"] }, { subcategory: "Greek" }),
  tc("DSH", "Greek salad and gyro", { cuisines: ["Greek"], intentCuisines: ["Greek"], intentTags: ["farm-to-table", "vegan friendly"] }, { subcategory: "Greek" }),
  tc("DSH", "pastitsio Greek pasta", { cuisines: ["Greek", "Italian"] }, { subcategory: "Greek" }),
  // --- Seafood dishes ---
  tc("DSH", "shrimp scampi", { cuisines: ["Seafood"], intentCuisines: ["Seafood"] }, { subcategory: "Seafood" }),
  tc("DSH", "calamari appetizer", { intentCuisines: ["Seafood", "Italian"] }, { subcategory: "Seafood" }),
  tc("DSH", "clam chowder bowl", { intentCuisines: ["Seafood"] }, { subcategory: "Seafood" }),
  tc("DSH", "poke bowl fresh", { intentCuisines: ["Japanese", "Seafood"], intentTags: ["farm-to-table"] }, { subcategory: "Seafood" }),
  tc("DSH", "lobster roll", { cuisines: ["Seafood"] }, { subcategory: "Seafood" }),
  tc("DSH", "oysters on the half shell", { cuisines: ["Seafood"] }, { subcategory: "Seafood" }),
  tc("DSH", "grilled octopus", { cuisines: ["Seafood"] }, { subcategory: "Seafood" }),
  tc("DSH", "fish and chips", { cuisines: ["Seafood"] }, { subcategory: "Seafood" }),
  // --- Steak dishes ---
  tc("DSH", "filet mignon dinner", { cuisines: ["Steak"], intentCuisines: ["Steak"] }, { subcategory: "Steak" }),
  tc("DSH", "ribeye medium rare", { cuisines: ["Steak"], intentCuisines: ["Steak"] }, { subcategory: "Steak" }),
  tc("DSH", "porterhouse for two", { cuisines: ["Steak"], intentCuisines: ["Steak"] }, { subcategory: "Steak" }),
  tc("DSH", "wagyu A5 omakase", { intentCuisines: ["Steak", "Japanese"] }, { subcategory: "Steak" }),
  tc("DSH", "tomahawk steak", { cuisines: ["Steak"] }, { subcategory: "Steak" }),
  tc("DSH", "steak tartare", { cuisines: ["Steak"], intentCuisines: ["French"] }, { subcategory: "Steak" }),
  tc("DSH", "bone marrow and steak", { cuisines: ["Steak"] }, { subcategory: "Steak" }),
  tc("DSH", "surf and turf dinner", { cuisines: ["Steak"] }, { subcategory: "Steak" }),
  // --- Polish dishes ---
  tc("DSH", "pierogi platter", { cuisines: ["Polish"], intentCuisines: ["Polish"] }, { subcategory: "Polish" }),
  tc("DSH", "kielbasa grilled", { cuisines: ["Polish"], intentCuisines: ["Polish", "American", "Steak"] }, { subcategory: "Polish" }),
  tc("DSH", "golabki stuffed cabbage", { cuisines: ["Polish"], intentCuisines: ["Polish"] }, { subcategory: "Polish" }),
  tc("DSH", "bigos hunters stew", { cuisines: ["Polish"] }, { subcategory: "Polish" }),
  tc("DSH", "potato pancakes", { cuisines: ["Polish", "Brunch"] }, { subcategory: "Polish" }),
  tc("DSH", "Polish sausage and sauerkraut", { cuisines: ["Polish"] }, { subcategory: "Polish" }),
  // --- Puerto Rican dishes ---
  tc("DSH", "mofongo with garlic", { intentCuisines: ["Puerto Rican"] }, { subcategory: "Puerto Rican" }),
  tc("DSH", "pernil roast pork", { intentCuisines: ["Puerto Rican"] }, { subcategory: "Puerto Rican" }),
  tc("DSH", "tostones and dip", { intentCuisines: ["Puerto Rican"] }, { subcategory: "Puerto Rican" }),
  tc("DSH", "alcapurria fried", { intentCuisines: ["Puerto Rican", "Korean", "American"] }, { subcategory: "Puerto Rican" }),
  tc("DSH", "arroz con gandules plate", { intentCuisines: ["Puerto Rican"] }, { subcategory: "Puerto Rican" }),
  tc("DSH", "pastelillo snack", { cuisines: ["Puerto Rican"] }, { subcategory: "Puerto Rican" }),
  tc("DSH", "empanadilla Puerto Rican", { cuisines: ["Puerto Rican"] }, { subcategory: "Puerto Rican" }),
  tc("DSH", "jibarito plantain sandwich", { cuisines: ["Puerto Rican"], intentCuisines: ["American"], intentTags: ["great value"] }, { subcategory: "Puerto Rican" }),
  // --- Coffee/Cafe items ---
  tc("DSH", "espresso and pastry", { cuisines: ["Coffee/Cafe"], intentCuisines: ["Coffee/Cafe"], intentTags: ["trendy"] }, { subcategory: "Coffee" }),
  tc("DSH", "cortado coffee", { intentCuisines: ["Coffee/Cafe"], intentTags: ["brunch spot"] }, { subcategory: "Coffee" }),
  tc("DSH", "oat milk latte", { intentCuisines: ["Coffee/Cafe"] }, { subcategory: "Coffee" }),
  tc("DSH", "matcha latte", { intentCuisines: ["Japanese", "Coffee/Cafe"] }, { subcategory: "Coffee" }),
  tc("DSH", "cold brew coffee", { intentTags: ["brunch spot"] }, { subcategory: "Coffee" }),
  tc("DSH", "cappuccino and croissant", { cuisines: ["Coffee/Cafe"], intentCuisines: ["Coffee/Cafe", "French"] }, { subcategory: "Coffee" }),
];


// ==========================================
// BAR — BAR & DRINKS (100 tests)
// ==========================================

const BAR_TESTS: TestCase[] = [
  // --- Cocktail bars ---
  tc("BAR", "cocktail bar downtown", { cuisines: ["Cocktail Bar"], tags: ["craft cocktails"] }, { subcategory: "cocktail" }),
  tc("BAR", "best cocktails in Chicago", { tags: ["craft cocktails"], intentTags: ["craft cocktails"] }, { subcategory: "cocktail" }),
  tc("BAR", "speakeasy bar", { cuisines: ["Cocktail Bar"] }, { subcategory: "cocktail" }),
  tc("BAR", "hidden speakeasy lounge", { cuisines: ["Cocktail Bar"], tags: ["hidden gem"] }, { subcategory: "cocktail" }),
  tc("BAR", "mixology experience", { cuisines: ["Cocktail Bar"], tags: ["craft cocktails"] }, { subcategory: "cocktail" }),
  tc("BAR", "cocktail lounge date", { cuisines: ["Cocktail Bar"], tags: ["craft cocktails"] }, { subcategory: "cocktail" }),
  tc("BAR", "artisan cocktails", { tags: ["craft cocktails"], intentTags: ["craft cocktails"] }, { subcategory: "cocktail" }),
  tc("BAR", "old fashioned bar", { tags: ["craft cocktails"] }, { subcategory: "cocktail" }),
  tc("BAR", "martini lounge", { tags: ["craft cocktails"] }, { subcategory: "cocktail" }),
  tc("BAR", "tiki bar cocktails", { tags: ["craft cocktails"], intentTags: ["craft cocktails"] }, { subcategory: "cocktail" }),
  tc("BAR", "prohibition era speakeasy", { cuisines: ["Cocktail Bar"] }, { subcategory: "cocktail" }),
  tc("BAR", "fancy cocktail spot", { tags: ["craft cocktails"], intentTags: ["trendy", "romantic", "craft cocktails"] }, { subcategory: "cocktail" }),
  tc("BAR", "underground cocktail bar", { cuisines: ["Cocktail Bar"], tags: ["craft cocktails"] }, { subcategory: "cocktail" }),
  tc("BAR", "mezcal bar", { tags: ["craft cocktails"] }, { subcategory: "cocktail" }),
  tc("BAR", "whiskey bar Chicago", { tags: ["craft cocktails"] }, { subcategory: "cocktail" }),
  // --- Craft beer / brewery ---
  tc("BAR", "craft beer bar", { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "beer" }),
  tc("BAR", "brewery taproom", { cuisines: ["Brewery/Beer Bar"], intentCuisines: ["Brewery/Beer Bar"] }, { subcategory: "beer" }),
  tc("BAR", "beer garden outdoor", { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer", "outdoor patio"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "beer" }),
  tc("BAR", "IPA selection bar", { cuisines: ["Brewery/Beer Bar"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "beer" }),
  tc("BAR", "local brewery tour", { cuisines: ["Brewery/Beer Bar"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["hidden gem"] }, { subcategory: "beer" }),
  tc("BAR", "brewpub with wings", { cuisines: ["Brewery/Beer Bar", "American"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["lively atmosphere"] }, { subcategory: "beer" }),
  tc("BAR", "craft ale house", { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "beer" }),
  tc("BAR", "stout and porter bar", { cuisines: ["Brewery/Beer Bar"] }, { subcategory: "beer" }),
  tc("BAR", "beer flight tasting", { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "beer" }),
  tc("BAR", "tap room draft beers", { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer"], intentCuisines: ["Brewery/Beer Bar"] }, { subcategory: "beer" }),
  tc("BAR", "beer and pizza place", { cuisines: ["Brewery/Beer Bar", "Italian"], tags: ["craft beer"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "beer" }),
  tc("BAR", "microbrewery Chicago", { cuisines: ["Brewery/Beer Bar"], intentCuisines: ["Brewery/Beer Bar"] }, { subcategory: "beer" }),
  tc("BAR", "beer hall Chicago", { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "beer" }),
  tc("BAR", "lager bar", { cuisines: ["Brewery/Beer Bar"] }, { subcategory: "beer" }),
  tc("BAR", "hoppy IPA bar", { cuisines: ["Brewery/Beer Bar"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "beer" }),
  // --- Wine ---
  tc("BAR", "wine bar", { intentTags: ["romantic"], intentCuisines: ["Italian", "French"] }, { subcategory: "wine" }),
  tc("BAR", "best wine list Chicago", { intentTags: ["romantic"], intentCuisines: ["Italian", "French"] }, { subcategory: "wine" }),
  tc("BAR", "wine tasting dinner", { intentTags: ["romantic"], intentCuisines: ["Italian", "French"] }, { subcategory: "wine" }),
  tc("BAR", "natural wine bar", { intentTags: ["romantic"], intentCuisines: ["Italian", "French"] }, { subcategory: "wine" }),
  tc("BAR", "wine and cheese night", { intentTags: ["romantic"], intentCuisines: ["Italian", "French"] }, { subcategory: "wine" }),
  tc("BAR", "sommelier wine pairing", { intentTags: ["romantic"], intentCuisines: ["Italian", "French"] }, { subcategory: "wine" }),
  tc("BAR", "wine flight tasting", { intentTags: ["romantic"], intentCuisines: ["Italian", "French"] }, { subcategory: "wine" }),
  tc("BAR", "red wine bar date", { intentTags: ["romantic"], intentCuisines: ["Italian", "French"] }, { subcategory: "wine" }),
  tc("BAR", "champagne lounge", { intentTags: ["romantic"] }, { subcategory: "wine" }),
  tc("BAR", "prosecco and appetizers", { intentTags: ["romantic"] }, { subcategory: "wine" }),
  // --- Happy hour ---
  tc("BAR", "happy hour specials", { intentTags: ["craft cocktails", "great value"] }, { subcategory: "happy-hour" }),
  tc("BAR", "after work drinks", { intentTags: ["craft cocktails", "great value"] }, { subcategory: "happy-hour" }),
  tc("BAR", "best happy hour downtown", { intentTags: ["craft cocktails", "great value"] }, { subcategory: "happy-hour" }),
  tc("BAR", "cheap happy hour drinks", { tags: ["great value"], intentTags: ["craft cocktails", "great value", "hidden gem"] }, { subcategory: "happy-hour" }),
  tc("BAR", "Friday happy hour bar", { intentTags: ["craft cocktails", "great value"] }, { subcategory: "happy-hour" }),
  tc("BAR", "half price happy hour", { intentTags: ["craft cocktails", "great value"] }, { subcategory: "happy-hour" }),
  tc("BAR", "happy hour River North", { intentTags: ["craft cocktails", "great value"] }, { subcategory: "happy-hour" }),
  tc("BAR", "after work happy hour spot", { intentTags: ["craft cocktails", "great value"] }, { subcategory: "happy-hour" }),
  // --- Specific drinks ---
  tc("BAR", "margarita bar", { cuisines: ["Mexican"] }, { subcategory: "drinks" }),
  tc("BAR", "sake bar Japanese", { cuisines: ["Japanese"] }, { subcategory: "drinks" }),
  tc("BAR", "mojito and rum bar", { cuisines: ["Cocktail Bar"] }, { subcategory: "drinks" }),
  tc("BAR", "tequila bar", { cuisines: ["Mexican"] }, { subcategory: "drinks" }),
  tc("BAR", "bourbon whiskey bar", { tags: ["craft cocktails"] }, { subcategory: "drinks" }),
  tc("BAR", "gin bar cocktails", { tags: ["craft cocktails"], intentTags: ["craft cocktails"] }, { subcategory: "drinks" }),
  tc("BAR", "aperol spritz bar", { tags: ["craft cocktails"] }, { subcategory: "drinks" }),
  tc("BAR", "espresso martini bar", { cuisines: ["Coffee/Cafe"], tags: ["craft cocktails"], intentCuisines: ["Coffee/Cafe"] }, { subcategory: "drinks" }),
  tc("BAR", "caipirinha Brazilian bar", { cuisines: ["Brazilian"], intentCuisines: ["Brazilian"] }, { subcategory: "drinks" }),
  tc("BAR", "soju bar Korean", { cuisines: ["Korean"], intentCuisines: ["Korean"] }, { subcategory: "drinks" }),
  tc("BAR", "absinthe bar", { tags: ["craft cocktails"] }, { subcategory: "drinks" }),
  tc("BAR", "mead and cider bar", {}, { subcategory: "drinks" }),
  tc("BAR", "sangria and tapas", { cuisines: ["Mediterranean"], intentCuisines: ["Mediterranean"], intentTags: ["trendy"] }, { subcategory: "drinks" }),
  tc("BAR", "Malort and Old Style", { cuisines: ["Brewery/Beer Bar"] }, { subcategory: "drinks" }),
  tc("BAR", "champagne brunch", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "drinks" }),
  // --- Bar food ---
  tc("BAR", "bar food and drinks", { intentTags: ["craft cocktails", "byob"] }, { subcategory: "bar-food" }),
  tc("BAR", "wings and beer", { cuisines: ["American", "Brewery/Beer Bar"], tags: ["craft beer"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "bar-food" }),
  tc("BAR", "burger bar", { cuisines: ["American"] }, { subcategory: "bar-food" }),
  tc("BAR", "nachos and margaritas", { cuisines: ["Mexican"] }, { subcategory: "bar-food" }),
  tc("BAR", "oyster and cocktail bar", { cuisines: ["Seafood", "Cocktail Bar"], tags: ["craft cocktails"] }, { subcategory: "bar-food" }),
  tc("BAR", "charcuterie and wine", { intentTags: ["romantic"], intentCuisines: ["Italian", "French"] }, { subcategory: "bar-food" }),
  tc("BAR", "late night bar bites", { tags: ["late night"], intentTags: ["late night"] }, { subcategory: "bar-food" }),
  tc("BAR", "pub grub and pints", { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer"] }, { subcategory: "bar-food" }),
  tc("BAR", "tacos and tequila bar", { cuisines: ["Mexican"] }, { subcategory: "bar-food" }),
  tc("BAR", "sliders and craft beer", { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "bar-food" }),
  // --- Pub / tavern ---
  tc("BAR", "Irish pub", { tags: ["craft beer"] }, { subcategory: "pub" }),
  tc("BAR", "neighborhood bar", { intentTags: ["hidden gem", "great value"] }, { subcategory: "pub" }),
  tc("BAR", "dive bar", { intentTags: ["hidden gem", "great value"] }, { subcategory: "pub" }),
  tc("BAR", "sports bar", { tags: ["lively atmosphere"] }, { subcategory: "pub" }),
  tc("BAR", "pool hall bar", { tags: ["lively atmosphere"] }, { subcategory: "pub" }),
  tc("BAR", "karaoke bar", { tags: ["lively atmosphere"] }, { subcategory: "pub" }),
  tc("BAR", "rooftop bar downtown", { tags: ["rooftop"], intentTags: ["rooftop", "scenic view"] }, { subcategory: "pub" }),
  tc("BAR", "waterfront bar", { tags: ["waterfront", "scenic view"], intentTags: ["waterfront", "scenic view"] }, { subcategory: "pub" }),
  tc("BAR", "live music bar", { tags: ["live music"], intentTags: ["live music"] }, { subcategory: "pub" }),
  tc("BAR", "jazz bar Chicago", { tags: ["live music"] }, { subcategory: "pub" }),
  tc("BAR", "blues bar Chicago", { tags: ["live music"] }, { subcategory: "pub" }),
];

// ==========================================
// OCC — OCCASION-BASED (80 tests)
// ==========================================

const OCC_TESTS: TestCase[] = [
  // --- Date Night (12) ---
  tc("OCC", "date night dinner", { intentTags: ["romantic"] }, {
    subcategory: "date", occasion: "Date Night",
    mockIntent: { cuisine_importance: "low", emotional_intent: "impress", date_type: "casual_weeknight" },
  }),
  tc("OCC", "romantic dinner for two", { tags: ["romantic"], intentTags: ["romantic", "scenic view"] }, {
    subcategory: "date", occasion: "Date Night",
    mockIntent: { cuisine_importance: "low", emotional_intent: "impress", date_type: "casual_weeknight" },
  }),
  tc("OCC", "first date restaurant", { intentTags: ["romantic", "quiet"] }, {
    subcategory: "date", occasion: "Date Night",
    mockIntent: { cuisine_importance: "low", emotional_intent: "impress", date_type: "first_date" },
  }),
  tc("OCC", "cozy date night spot", { tags: ["romantic"], intentTags: ["quiet", "hidden gem", "romantic"] }, {
    subcategory: "date", occasion: "Date Night",
    mockIntent: { cuisine_importance: "low", emotional_intent: "impress" },
  }),
  tc("OCC", "candlelit dinner date", { tags: ["romantic"], intentTags: ["romantic"] }, {
    subcategory: "date", occasion: "Date Night",
    mockIntent: { cuisine_importance: "low", emotional_intent: "impress" },
  }),
  tc("OCC", "intimate dinner for two", { tags: ["romantic"], intentTags: ["romantic", "quiet"] }, {
    subcategory: "date", occasion: "Date Night",
    mockIntent: { cuisine_importance: "low", emotional_intent: "impress" },
  }),
  tc("OCC", "double date restaurant", { intentTags: ["romantic", "trendy"] }, {
    subcategory: "date", occasion: "Date Night",
    mockIntent: { cuisine_importance: "low", emotional_intent: "casual", group_size_hint: "small_group" },
  }),
  tc("OCC", "date night sushi", { cuisines: ["Japanese"], intentTags: ["romantic"] }, {
    subcategory: "date", occasion: "Date Night",
    mockIntent: { target_cuisines: ["Japanese"], cuisine_importance: "high", emotional_intent: "impress" },
  }),
  tc("OCC", "romantic Italian dinner", { cuisines: ["Italian"], tags: ["romantic"], intentTags: ["romantic", "scenic view"] }, {
    subcategory: "date", occasion: "Date Night",
    mockIntent: { target_cuisines: ["Italian"], cuisine_importance: "high", emotional_intent: "impress" },
  }),
  tc("OCC", "upscale date restaurant", { intentTags: ["trendy", "romantic"] }, {
    subcategory: "date", occasion: "Date Night",
    mockIntent: { cuisine_importance: "low", emotional_intent: "impress" },
  }),
  tc("OCC", "date night cocktails", { tags: ["craft cocktails"], intentTags: ["craft cocktails"] }, {
    subcategory: "date", occasion: "Date Night",
    mockIntent: { cuisine_importance: "low", emotional_intent: "impress" },
  }),
  tc("OCC", "wine bar date night", { intentTags: ["romantic"], intentCuisines: ["Italian", "French"] }, {
    subcategory: "date", occasion: "Date Night",
    mockIntent: { cuisine_importance: "low", emotional_intent: "impress" },
  }),
  // --- Birthday (8) ---
  tc("OCC", "birthday dinner", { intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "birthday", occasion: "Special Occasion",
    mockIntent: { cuisine_importance: "low", emotional_intent: "celebrate" },
  }),
  tc("OCC", "birthday dinner fancy", { intentTags: ["trendy", "craft cocktails", "romantic"] }, {
    subcategory: "birthday", occasion: "Special Occasion",
    mockIntent: { cuisine_importance: "low", emotional_intent: "celebrate" },
  }),
  tc("OCC", "best birthday restaurant", { intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "birthday", occasion: "Special Occasion",
    mockIntent: { cuisine_importance: "low", emotional_intent: "celebrate" },
  }),
  tc("OCC", "birthday brunch spot", { cuisines: ["Brunch"], tags: ["brunch spot"], intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "birthday", occasion: "Special Occasion",
  }),
  tc("OCC", "surprise birthday dinner", { intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "birthday", occasion: "Special Occasion",
    mockIntent: { cuisine_importance: "low", emotional_intent: "celebrate" },
  }),
  tc("OCC", "21st birthday bar", { intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "birthday", occasion: "Special Occasion",
  }),
  tc("OCC", "birthday dinner group", { intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "birthday", occasion: "Special Occasion",
    mockIntent: { group_size_hint: "large_group", emotional_intent: "celebrate" },
  }),
  tc("OCC", "birthday steakhouse", { cuisines: ["Steak"], intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "birthday", occasion: "Special Occasion",
    mockIntent: { target_cuisines: ["Steak"], cuisine_importance: "high", emotional_intent: "celebrate" },
  }),
  // --- Anniversary (8) ---
  tc("OCC", "anniversary dinner", { intentTags: ["romantic", "scenic view"] }, {
    subcategory: "anniversary", occasion: "Special Occasion",
    mockIntent: { cuisine_importance: "low", emotional_intent: "impress", date_type: "anniversary" },
  }),
  tc("OCC", "wedding anniversary restaurant", { intentTags: ["romantic", "scenic view"] }, {
    subcategory: "anniversary", occasion: "Special Occasion",
    mockIntent: { emotional_intent: "impress" },
  }),
  tc("OCC", "10th anniversary dinner special", { intentTags: ["romantic", "scenic view"] }, {
    subcategory: "anniversary", occasion: "Special Occasion",
  }),
  tc("OCC", "romantic anniversary meal", { tags: ["romantic"], intentTags: ["romantic", "scenic view"] }, {
    subcategory: "anniversary", occasion: "Special Occasion",
    mockIntent: { emotional_intent: "impress" },
  }),
  tc("OCC", "anniversary fine dining", { intentTags: ["romantic", "trendy", "scenic view"] }, {
    subcategory: "anniversary", occasion: "Special Occasion",
    mockIntent: { emotional_intent: "impress" },
  }),
  tc("OCC", "engagement dinner celebration", { intentTags: ["romantic", "scenic view"] }, {
    subcategory: "anniversary", occasion: "Special Occasion",
    mockIntent: { emotional_intent: "impress" },
  }),
  tc("OCC", "proposal restaurant scenic", { tags: ["scenic view"], intentTags: ["romantic", "scenic view"] }, {
    subcategory: "anniversary", occasion: "Special Occasion",
    mockIntent: { emotional_intent: "impress" },
  }),
  tc("OCC", "anniversary tasting menu", { intentTags: ["romantic", "trendy", "scenic view"] }, {
    subcategory: "anniversary", occasion: "Special Occasion",
    mockIntent: { emotional_intent: "impress" },
  }),
  // --- Business Lunch (8) ---
  tc("OCC", "business lunch downtown", { intentTags: ["great value", "quiet"] }, {
    subcategory: "business", occasion: "Business Lunch",
    mockIntent: { cuisine_importance: "low", emotional_intent: "casual" },
  }),
  tc("OCC", "client dinner quiet", { tags: ["quiet"], intentTags: ["quiet", "romantic"] }, {
    subcategory: "business", occasion: "Business Lunch",
    mockIntent: { emotional_intent: "impress" },
  }),
  tc("OCC", "work lunch meeting", { intentTags: ["quiet", "great value"] }, {
    subcategory: "business", occasion: "Business Lunch",
    mockIntent: { emotional_intent: "casual" },
  }),
  tc("OCC", "corporate dinner event", { intentTags: ["quiet"] }, {
    subcategory: "business", occasion: "Business Lunch",
    mockIntent: { emotional_intent: "impress", group_size_hint: "large_group" },
  }),
  tc("OCC", "team lunch casual", { intentTags: ["great value"] }, {
    subcategory: "business", occasion: "Business Lunch",
    mockIntent: { emotional_intent: "casual", group_size_hint: "small_group" },
  }),
  tc("OCC", "business dinner steakhouse", { cuisines: ["Steak"], intentTags: ["quiet"] }, {
    subcategory: "business", occasion: "Business Lunch",
    mockIntent: { target_cuisines: ["Steak"], cuisine_importance: "high", emotional_intent: "impress" },
  }),
  tc("OCC", "professional lunch spot", { intentTags: ["great value"] }, {
    subcategory: "business", occasion: "Business Lunch",
  }),
  tc("OCC", "networking dinner venue", { intentTags: ["quiet"] }, {
    subcategory: "business", occasion: "Business Lunch",
    mockIntent: { emotional_intent: "impress" },
  }),
  // --- Girls/Guys Night (8) ---
  tc("OCC", "girls night out", { intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "social", occasion: "Group Hangout",
    mockIntent: { emotional_intent: "celebrate", group_size_hint: "small_group" },
  }),
  tc("OCC", "girls night cocktails", { tags: ["craft cocktails"], intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "social", occasion: "Group Hangout",
  }),
  tc("OCC", "guys night bar", { intentTags: ["craft cocktails", "live music"] }, {
    subcategory: "social", occasion: "Group Hangout",
    mockIntent: { emotional_intent: "casual", group_size_hint: "small_group" },
  }),
  tc("OCC", "bachelorette dinner", { intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "social", occasion: "Special Occasion",
    mockIntent: { emotional_intent: "celebrate", group_size_hint: "large_group" },
  }),
  tc("OCC", "group dinner 10 people", { intentTags: [] }, {
    subcategory: "social", occasion: "Group Hangout",
    mockIntent: { emotional_intent: "casual", group_size_hint: "large_group" },
  }),
  tc("OCC", "large party restaurant", { intentTags: [] }, {
    subcategory: "social", occasion: "Group Hangout",
    mockIntent: { group_size_hint: "large_group" },
  }),
  tc("OCC", "friends dinner fun", { intentTags: ["trendy", "live music"] }, {
    subcategory: "social", occasion: "Group Hangout",
    mockIntent: { emotional_intent: "casual", group_size_hint: "small_group" },
  }),
  tc("OCC", "reunion dinner Chicago", { intentTags: ["trendy"] }, {
    subcategory: "social", occasion: "Group Hangout",
    mockIntent: { emotional_intent: "celebrate", group_size_hint: "large_group" },
  }),
  // --- Family Dinner (8) ---
  tc("OCC", "family dinner restaurant", { intentTags: [] }, {
    subcategory: "family", occasion: "Family Dinner",
    mockIntent: { emotional_intent: "casual", group_size_hint: "small_group" },
  }),
  tc("OCC", "kid friendly restaurant", { intentTags: [] }, {
    subcategory: "family", occasion: "Family Dinner",
    mockIntent: { emotional_intent: "casual" },
  }),
  tc("OCC", "family brunch Sunday", { cuisines: ["Brunch"], tags: ["brunch spot"] }, {
    subcategory: "family", occasion: "Family Dinner",
  }),
  tc("OCC", "family Italian dinner", { cuisines: ["Italian"], intentTags: [] }, {
    subcategory: "family", occasion: "Family Dinner",
    mockIntent: { target_cuisines: ["Italian"], cuisine_importance: "high" },
  }),
  tc("OCC", "kids menu restaurant", { intentTags: [] }, {
    subcategory: "family", occasion: "Family Dinner",
  }),
  tc("OCC", "family friendly pizza", { cuisines: ["Italian"] }, {
    subcategory: "family", occasion: "Family Dinner",
    mockIntent: { target_cuisines: ["Italian"], cuisine_importance: "high" },
  }),
  tc("OCC", "multigenerational dinner out", { intentTags: [] }, {
    subcategory: "family", occasion: "Family Dinner",
    mockIntent: { group_size_hint: "large_group" },
  }),
  tc("OCC", "family celebration dinner", { intentTags: ["romantic", "trendy"] }, {
    subcategory: "family", occasion: "Family Dinner",
    mockIntent: { emotional_intent: "celebrate" },
  }),
  // --- Solo Dining (8) ---
  tc("OCC", "solo dining spot", { intentTags: ["quiet", "hidden gem"] }, {
    subcategory: "solo", occasion: "Solo Dining",
    mockIntent: { emotional_intent: "casual", group_size_hint: "solo" },
  }),
  tc("OCC", "eating alone restaurant", { intentTags: ["quiet", "hidden gem"] }, {
    subcategory: "solo", occasion: "Solo Dining",
    mockIntent: { group_size_hint: "solo" },
  }),
  tc("OCC", "bar seating solo meal", { intentTags: ["craft cocktails", "quiet", "hidden gem"] }, {
    subcategory: "solo", occasion: "Solo Dining",
    mockIntent: { group_size_hint: "solo" },
  }),
  tc("OCC", "solo sushi counter", { cuisines: ["Japanese"], intentTags: ["quiet", "hidden gem"] }, {
    subcategory: "solo", occasion: "Solo Dining",
    mockIntent: { target_cuisines: ["Japanese"], cuisine_importance: "high", group_size_hint: "solo" },
  }),
  tc("OCC", "solo ramen lunch", { cuisines: ["Japanese"], intentTags: ["quiet", "hidden gem", "great value"] }, {
    subcategory: "solo", occasion: "Solo Dining",
    mockIntent: { target_cuisines: ["Japanese"], cuisine_importance: "high", group_size_hint: "solo" },
  }),
  tc("OCC", "counter seating restaurant", {}, {
    subcategory: "solo", occasion: "Solo Dining",
  }),
  tc("OCC", "solo treat myself dinner", { intentTags: ["quiet", "hidden gem"] }, {
    subcategory: "solo", occasion: "Solo Dining",
    mockIntent: { emotional_intent: "indulge", group_size_hint: "solo" },
  }),
  tc("OCC", "quick solo lunch spot", { intentTags: ["great value", "quiet", "hidden gem"] }, {
    subcategory: "solo", occasion: "Solo Dining",
    mockIntent: { group_size_hint: "solo", spontaneity: "spontaneous" },
  }),
  // --- Special Occasion (8) ---
  tc("OCC", "graduation dinner", { intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "special", occasion: "Special Occasion",
    mockIntent: { emotional_intent: "celebrate" },
  }),
  tc("OCC", "promotion celebration dinner", { intentTags: ["romantic", "trendy"] }, {
    subcategory: "special", occasion: "Special Occasion",
    mockIntent: { emotional_intent: "celebrate" },
  }),
  tc("OCC", "special occasion restaurant", { intentTags: ["romantic"] }, {
    subcategory: "special", occasion: "Special Occasion",
    mockIntent: { emotional_intent: "celebrate" },
  }),
  tc("OCC", "treat myself dinner", { intentTags: ["quiet", "hidden gem"] }, {
    subcategory: "special", occasion: "Treat Myself",
    mockIntent: { emotional_intent: "indulge", group_size_hint: "solo" },
  }),
  tc("OCC", "self care dinner out", { intentTags: ["quiet", "hidden gem"] }, {
    subcategory: "special", occasion: "Treat Myself",
    mockIntent: { emotional_intent: "indulge" },
  }),
  tc("OCC", "adventure dining new experience", { intentTags: ["hidden gem"] }, {
    subcategory: "special", occasion: "Adventure",
    mockIntent: { emotional_intent: "explore" },
  }),
  tc("OCC", "try something new tonight", { intentTags: ["hidden gem"] }, {
    subcategory: "special", occasion: "Adventure",
    mockIntent: { emotional_intent: "explore", spontaneity: "spontaneous" },
  }),
  tc("OCC", "chill hangout food", { intentTags: ["quiet", "hidden gem"] }, {
    subcategory: "special", occasion: "Chill Hangout",
    mockIntent: { emotional_intent: "casual" },
  }),
];


// ==========================================
// VIB — VIBE/AMBIANCE (80 tests)
// ==========================================

const VIB_TESTS: TestCase[] = [
  // --- Cozy/Warm (8) ---
  tc("VIB", "cozy restaurant", { intentTags: ["quiet", "hidden gem"] }, { subcategory: "cozy" }),
  tc("VIB", "cozy dinner spot", { intentTags: ["quiet", "hidden gem"] }, { subcategory: "cozy" }),
  tc("VIB", "warm and inviting restaurant", { intentTags: ["romantic", "hidden gem"] }, { subcategory: "cozy" }),
  tc("VIB", "cozy cafe winter", { cuisines: ["Coffee/Cafe"], intentTags: ["quiet", "hidden gem", "brunch spot"] }, { subcategory: "cozy" }),
  tc("VIB", "fireplace restaurant cozy", { intentTags: ["quiet", "hidden gem"] }, { subcategory: "cozy" }),
  tc("VIB", "cozy Italian restaurant", { cuisines: ["Italian"], intentTags: ["quiet", "hidden gem"] }, { subcategory: "cozy" }),
  tc("VIB", "welcoming neighborhood spot", { intentTags: ["hidden gem", "great value"] }, { subcategory: "cozy" }),
  tc("VIB", "warm ambiance dinner", { intentTags: ["romantic", "hidden gem"] }, { subcategory: "cozy" }),
  // --- Romantic/Intimate (8) ---
  tc("VIB", "romantic restaurant", { tags: ["romantic"], intentTags: ["romantic", "scenic view"] }, { subcategory: "romantic" }),
  tc("VIB", "intimate dinner spot", { tags: ["romantic"], intentTags: ["romantic", "quiet"] }, { subcategory: "romantic" }),
  tc("VIB", "candlelit restaurant", { tags: ["romantic"], intentTags: ["romantic"] }, { subcategory: "romantic" }),
  tc("VIB", "romantic and quiet dinner", { tags: ["romantic", "quiet"], intentTags: ["romantic", "scenic view", "quiet"] }, { subcategory: "romantic" }),
  tc("VIB", "intimate Italian date", { cuisines: ["Italian"], tags: ["romantic"], intentTags: ["romantic", "quiet"] }, { subcategory: "romantic" }),
  tc("VIB", "romantic waterfront dinner", { tags: ["romantic", "waterfront", "scenic view"], intentTags: ["romantic", "scenic view", "waterfront"] }, { subcategory: "romantic" }),
  tc("VIB", "quiet romantic evening", { tags: ["romantic", "quiet"], intentTags: ["romantic", "scenic view"] }, { subcategory: "romantic" }),
  tc("VIB", "romantic rooftop dinner", { tags: ["romantic", "rooftop"], intentTags: ["romantic", "scenic view", "rooftop"] }, { subcategory: "romantic" }),
  // --- Lively/Energetic (10) ---
  tc("VIB", "lively restaurant", { intentTags: ["live music", "trendy"] }, { subcategory: "lively" }),
  tc("VIB", "bustling dinner spot", { tags: ["lively atmosphere"], intentTags: ["lively atmosphere", "trendy", "live music"] }, { subcategory: "lively" }),
  tc("VIB", "vibrant atmosphere dining", { tags: ["lively atmosphere"], intentTags: ["lively atmosphere", "trendy", "live music"] }, { subcategory: "lively" }),
  tc("VIB", "energetic restaurant scene", { tags: ["lively atmosphere"], intentTags: ["lively atmosphere", "trendy", "live music"] }, { subcategory: "lively" }),
  tc("VIB", "buzzing bar and grill", { tags: ["lively atmosphere"], intentTags: ["lively atmosphere", "trendy"] }, { subcategory: "lively" }),
  tc("VIB", "happening spot tonight", { intentTags: ["trendy", "live music"] }, { subcategory: "lively" }),
  tc("VIB", "high energy bar", { tags: ["lively atmosphere"], intentTags: ["lively atmosphere", "trendy", "live music"] }, { subcategory: "lively" }),
  tc("VIB", "festive dinner party", { tags: ["lively atmosphere"], intentTags: ["lively atmosphere", "trendy", "craft cocktails"] }, { subcategory: "lively" }),
  tc("VIB", "animated and fun restaurant", { tags: ["lively atmosphere"], intentTags: ["lively atmosphere", "trendy", "live music"] }, { subcategory: "lively" }),
  tc("VIB", "hopping bar downtown", { intentTags: ["lively atmosphere", "trendy"] }, { subcategory: "lively" }),
  // --- Quiet/Peaceful (8) ---
  tc("VIB", "quiet restaurant", { tags: ["quiet"], intentTags: ["quiet"] }, { subcategory: "quiet" }),
  tc("VIB", "peaceful dinner spot", { tags: ["quiet"] }, { subcategory: "quiet" }),
  tc("VIB", "calm and serene dining", { tags: ["quiet"] }, { subcategory: "quiet" }),
  tc("VIB", "quiet dinner conversation", { tags: ["quiet"] }, { subcategory: "quiet" }),
  tc("VIB", "tranquil restaurant", { intentTags: ["quiet", "romantic"] }, { subcategory: "quiet" }),
  tc("VIB", "quiet sushi dinner", { cuisines: ["Japanese"], tags: ["quiet"] }, { subcategory: "quiet" }),
  tc("VIB", "mellow dinner spot", { intentTags: ["quiet", "hidden gem"] }, { subcategory: "quiet" }),
  tc("VIB", "relaxed atmosphere dining", { intentTags: ["quiet", "hidden gem"] }, { subcategory: "quiet" }),
  // --- Upscale/Fancy (8) ---
  tc("VIB", "upscale restaurant", { intentTags: ["trendy", "romantic"] }, { subcategory: "upscale" }),
  tc("VIB", "fancy dinner Chicago", { intentTags: ["trendy", "romantic"] }, { subcategory: "upscale" }),
  tc("VIB", "elegant dining room", { intentTags: ["romantic"] }, { subcategory: "upscale" }),
  tc("VIB", "white tablecloth restaurant", { intentTags: ["romantic"] }, { subcategory: "upscale" }),
  tc("VIB", "upscale steakhouse", { cuisines: ["Steak"], intentTags: ["trendy", "romantic"] }, { subcategory: "upscale" }),
  tc("VIB", "fancy French restaurant", { cuisines: ["French"], intentTags: ["trendy", "romantic"] }, { subcategory: "upscale" }),
  tc("VIB", "upscale Japanese omakase", { cuisines: ["Japanese"], intentCuisines: ["Japanese"], intentTags: ["trendy", "romantic"] }, { subcategory: "upscale" }),
  tc("VIB", "luxurious dining experience", { intentTags: ["trendy", "romantic"] }, { subcategory: "upscale" }),
  // --- Casual (8) ---
  tc("VIB", "casual dining spot", { intentTags: ["great value"] }, { subcategory: "casual" }),
  tc("VIB", "laid back restaurant", { intentTags: ["quiet", "hidden gem"] }, { subcategory: "casual" }),
  tc("VIB", "chill dinner place", { intentTags: ["quiet", "hidden gem"] }, { subcategory: "casual" }),
  tc("VIB", "low key dinner spot", { intentTags: ["quiet", "hidden gem"] }, { subcategory: "casual" }),
  tc("VIB", "relaxed casual dinner", { intentTags: ["quiet", "hidden gem"] }, { subcategory: "casual" }),
  tc("VIB", "no fuss restaurant", {}, { subcategory: "casual" }),
  tc("VIB", "casual Mexican place", { cuisines: ["Mexican"], intentTags: ["great value"] }, { subcategory: "casual" }),
  tc("VIB", "easygoing cafe", { cuisines: ["Coffee/Cafe"], intentTags: ["brunch spot", "quiet"] }, { subcategory: "casual" }),
  // --- Trendy/Hip (8) ---
  tc("VIB", "trendy restaurant", { tags: ["trendy"], intentTags: ["trendy"] }, { subcategory: "trendy" }),
  tc("VIB", "hip new restaurant", { tags: ["trendy"] }, { subcategory: "trendy" }),
  tc("VIB", "instagrammable restaurant", { tags: ["trendy"], intentTags: ["trendy", "rooftop", "scenic view"] }, { subcategory: "trendy" }),
  tc("VIB", "modern stylish dining", { tags: ["trendy"] }, { subcategory: "trendy" }),
  tc("VIB", "photogenic food spot", { intentTags: ["trendy", "scenic view"] }, { subcategory: "trendy" }),
  tc("VIB", "trendy brunch spot", { cuisines: ["Brunch"], tags: ["trendy", "brunch spot"] }, { subcategory: "trendy" }),
  tc("VIB", "stylish cocktail restaurant", { tags: ["trendy", "craft cocktails"], intentTags: ["craft cocktails"] }, { subcategory: "trendy" }),
  tc("VIB", "Instagram worthy food", { tags: ["trendy"], intentTags: ["trendy", "rooftop", "scenic view"] }, { subcategory: "trendy" }),
  // --- Fine Dining (6) ---
  tc("VIB", "fine dining Chicago", { intentTags: ["romantic", "trendy"] }, { subcategory: "fine-dining" }),
  tc("VIB", "tasting menu restaurant", { intentTags: ["romantic", "trendy"] }, { subcategory: "fine-dining" }),
  tc("VIB", "prix fixe dinner", { intentTags: ["romantic", "trendy"] }, { subcategory: "fine-dining" }),
  tc("VIB", "Michelin star restaurant", { intentTags: ["romantic", "trendy"] }, { subcategory: "fine-dining" }),
  tc("VIB", "chef's table experience", { intentTags: ["trendy"] }, { subcategory: "fine-dining" }),
  tc("VIB", "multi course tasting menu", { intentTags: ["romantic", "trendy"] }, { subcategory: "fine-dining" }),
  // --- Hidden Gem / Dive (6) ---
  tc("VIB", "hidden gem restaurant", { tags: ["hidden gem"], intentTags: ["hidden gem"] }, { subcategory: "hidden-gem" }),
  tc("VIB", "neighborhood spot local", { intentTags: ["hidden gem", "great value"] }, { subcategory: "hidden-gem" }),
  tc("VIB", "hole in the wall food", { intentTags: ["hidden gem", "great value"] }, { subcategory: "hidden-gem" }),
  tc("VIB", "secret restaurant Chicago", { tags: ["hidden gem"] }, { subcategory: "hidden-gem" }),
  tc("VIB", "authentic local gem", { intentTags: ["hidden gem"] }, { subcategory: "hidden-gem" }),
  tc("VIB", "dive bar with great food", { intentTags: ["hidden gem", "great value"] }, { subcategory: "hidden-gem" }),
];

// ==========================================
// NBH — NEIGHBORHOOD + FOOD (60 tests)
// ==========================================

const NBH_TESTS: TestCase[] = [
  // --- Pilsen (6) ---
  tc("NBH", "tacos in Pilsen", { cuisines: ["Mexican"] }, { subcategory: "Pilsen" }),
  tc("NBH", "best Mexican food Pilsen", { cuisines: ["Mexican"] }, { subcategory: "Pilsen" }),
  tc("NBH", "Pilsen brunch spot", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "Pilsen" }),
  tc("NBH", "birria tacos Pilsen", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "Pilsen" }),
  tc("NBH", "Pilsen cocktail bar", { cuisines: ["Cocktail Bar"], tags: ["craft cocktails"] }, { subcategory: "Pilsen" }),
  tc("NBH", "Pilsen date night dinner", { intentTags: ["romantic"] }, { subcategory: "Pilsen" }),
  // --- West Loop (6) ---
  tc("NBH", "sushi West Loop", { cuisines: ["Japanese"] }, { subcategory: "West Loop" }),
  tc("NBH", "best restaurant West Loop", {}, { subcategory: "West Loop" }),
  tc("NBH", "West Loop Italian", { cuisines: ["Italian"] }, { subcategory: "West Loop" }),
  tc("NBH", "fine dining West Loop", { intentTags: ["romantic", "trendy"] }, { subcategory: "West Loop" }),
  tc("NBH", "West Loop brunch", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "West Loop" }),
  tc("NBH", "West Loop steakhouse", { cuisines: ["Steak"] }, { subcategory: "West Loop" }),
  // --- Chinatown (6) ---
  tc("NBH", "dim sum Chinatown", { cuisines: ["Chinese"], intentCuisines: ["Chinese"] }, { subcategory: "Chinatown" }),
  tc("NBH", "best Chinese food Chinatown", { cuisines: ["Chinese"] }, { subcategory: "Chinatown" }),
  tc("NBH", "Chinatown noodles", { cuisines: ["Chinese"], intentCuisines: ["Japanese", "Vietnamese", "Thai", "Chinese"] }, { subcategory: "Chinatown" }),
  tc("NBH", "hotpot Chinatown", { intentCuisines: ["Chinese"] }, { subcategory: "Chinatown" }),
  tc("NBH", "Chinatown dumpling house", { cuisines: ["Chinese"] }, { subcategory: "Chinatown" }),
  tc("NBH", "BBQ duck Chinatown", { cuisines: ["Korean", "BBQ"], intentCuisines: ["BBQ", "Korean"] }, { subcategory: "Chinatown" }),
  // --- Wicker Park (6) ---
  tc("NBH", "pizza Wicker Park", { cuisines: ["Italian"] }, { subcategory: "Wicker Park" }),
  tc("NBH", "Wicker Park brunch", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "Wicker Park" }),
  tc("NBH", "trendy restaurant Wicker Park", { tags: ["trendy"] }, { subcategory: "Wicker Park" }),
  tc("NBH", "Wicker Park cocktail bar", { cuisines: ["Cocktail Bar"], tags: ["craft cocktails"] }, { subcategory: "Wicker Park" }),
  tc("NBH", "vegan food Wicker Park", { cuisines: ["Vegan"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, { subcategory: "Wicker Park" }),
  tc("NBH", "Wicker Park ramen", { cuisines: ["Japanese"] }, { subcategory: "Wicker Park" }),
  // --- Lincoln Park (6) ---
  tc("NBH", "Lincoln Park sushi", { cuisines: ["Japanese"] }, { subcategory: "Lincoln Park" }),
  tc("NBH", "brunch Lincoln Park", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "Lincoln Park" }),
  tc("NBH", "Lincoln Park Italian", { cuisines: ["Italian"] }, { subcategory: "Lincoln Park" }),
  tc("NBH", "Lincoln Park date night", { intentTags: ["romantic"] }, { subcategory: "Lincoln Park" }),
  tc("NBH", "burger joint Lincoln Park", { cuisines: ["American"] }, { subcategory: "Lincoln Park" }),
  tc("NBH", "Lincoln Park Thai food", { cuisines: ["Thai"] }, { subcategory: "Lincoln Park" }),
  // --- Logan Square (6) ---
  tc("NBH", "Logan Square tacos", { cuisines: ["Mexican"] }, { subcategory: "Logan Square" }),
  tc("NBH", "Logan Square cocktails", { tags: ["craft cocktails"], intentTags: ["craft cocktails"] }, { subcategory: "Logan Square" }),
  tc("NBH", "trendy Logan Square restaurant", { tags: ["trendy"] }, { subcategory: "Logan Square" }),
  tc("NBH", "Logan Square brewery", { cuisines: ["Brewery/Beer Bar"], intentCuisines: ["Brewery/Beer Bar"] }, { subcategory: "Logan Square" }),
  tc("NBH", "Logan Square brunch", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "Logan Square" }),
  tc("NBH", "Logan Square ramen shop", { cuisines: ["Japanese"] }, { subcategory: "Logan Square" }),
  // --- River North (6) ---
  tc("NBH", "River North steakhouse", { cuisines: ["Steak"] }, { subcategory: "River North" }),
  tc("NBH", "River North sushi", { cuisines: ["Japanese"] }, { subcategory: "River North" }),
  tc("NBH", "rooftop bar River North", { tags: ["rooftop"], intentTags: ["rooftop", "scenic view"] }, { subcategory: "River North" }),
  tc("NBH", "River North Italian", { cuisines: ["Italian"] }, { subcategory: "River North" }),
  tc("NBH", "River North nightlife bar", { tags: ["lively atmosphere"] }, { subcategory: "River North" }),
  tc("NBH", "River North fine dining", { intentTags: ["romantic", "trendy"] }, { subcategory: "River North" }),
  // --- Downtown/Loop (6) ---
  tc("NBH", "downtown lunch spot", { intentTags: ["great value"] }, { subcategory: "Downtown" }),
  tc("NBH", "Loop business lunch", { intentTags: ["quiet", "great value"] }, { subcategory: "Downtown" }),
  tc("NBH", "downtown Chicago pizza", { cuisines: ["Italian"] }, { subcategory: "Downtown" }),
  tc("NBH", "Magnificent Mile restaurant", {}, { subcategory: "Downtown" }),
  tc("NBH", "downtown seafood restaurant", { cuisines: ["Seafood"] }, { subcategory: "Downtown" }),
  tc("NBH", "Loop quick lunch", { intentTags: ["great value"] }, { subcategory: "Downtown" }),
  // --- Andersonville (4) ---
  tc("NBH", "Andersonville brunch", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "Andersonville" }),
  tc("NBH", "Andersonville Ethiopian", { cuisines: ["Ethiopian"] }, { subcategory: "Andersonville" }),
  tc("NBH", "Andersonville Swedish food", {}, { subcategory: "Andersonville" }),
  tc("NBH", "Andersonville coffee shop", { cuisines: ["Coffee/Cafe"], intentTags: ["brunch spot"] }, { subcategory: "Andersonville" }),
  // --- Hyde Park (4) ---
  tc("NBH", "Hyde Park restaurant", {}, { subcategory: "Hyde Park" }),
  tc("NBH", "Hyde Park soul food", { cuisines: ["Southern/Soul Food"], intentCuisines: ["Southern/Soul Food"], intentTags: ["hidden gem"] }, { subcategory: "Hyde Park" }),
  tc("NBH", "Hyde Park sushi", { cuisines: ["Japanese"] }, { subcategory: "Hyde Park" }),
  tc("NBH", "Hyde Park brunch", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "Hyde Park" }),
  // --- Bridgeport (4) ---
  tc("NBH", "Bridgeport pizza", { cuisines: ["Italian"] }, { subcategory: "Bridgeport" }),
  tc("NBH", "Bridgeport Mexican food", { cuisines: ["Mexican"] }, { subcategory: "Bridgeport" }),
  tc("NBH", "Bridgeport bar", {}, { subcategory: "Bridgeport" }),
  tc("NBH", "Bridgeport Chinese food", { cuisines: ["Chinese"] }, { subcategory: "Bridgeport" }),
];

// ==========================================
// DIT — DIETARY (50 tests)
// ==========================================

const DIT_TESTS: TestCase[] = [
  // --- Vegan (10) ---
  tc("DIT", "vegan restaurant Chicago", { cuisines: ["Vegan"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, { subcategory: "vegan" }),
  tc("DIT", "best vegan food", { cuisines: ["Vegan"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, { subcategory: "vegan" }),
  tc("DIT", "vegan pizza", { cuisines: ["Vegan", "Italian"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, { subcategory: "vegan" }),
  tc("DIT", "vegan sushi", { cuisines: ["Vegan", "Japanese"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, { subcategory: "vegan" }),
  tc("DIT", "vegan Mexican food", { cuisines: ["Vegan", "Mexican"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, { subcategory: "vegan" }),
  tc("DIT", "plant-based restaurant", { cuisines: ["Vegan"], tags: ["vegan friendly"] }, { subcategory: "vegan" }),
  tc("DIT", "vegan brunch", { cuisines: ["Vegan", "Brunch"], tags: ["vegan friendly", "brunch spot"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, { subcategory: "vegan" }),
  tc("DIT", "vegan Thai food", { cuisines: ["Vegan", "Thai"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, { subcategory: "vegan" }),
  tc("DIT", "vegan dessert spot", { cuisines: ["Vegan"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly", "trendy"] }, { subcategory: "vegan" }),
  tc("DIT", "plant based burger", { cuisines: ["Vegan", "American"], tags: ["vegan friendly"] }, { subcategory: "vegan" }),
  // --- Vegetarian (8) ---
  tc("DIT", "vegetarian restaurant", { dietary: ["vegetarian"], intentTags: ["vegan friendly"] }, { subcategory: "vegetarian" }),
  tc("DIT", "best vegetarian food Chicago", { dietary: ["vegetarian"], intentTags: ["vegan friendly"] }, { subcategory: "vegetarian" }),
  tc("DIT", "vegetarian Indian food", { cuisines: ["Indian"], dietary: ["vegetarian"], intentTags: ["vegan friendly"] }, { subcategory: "vegetarian" }),
  tc("DIT", "vegetarian sushi rolls", { cuisines: ["Japanese"], dietary: ["vegetarian"], intentTags: ["vegan friendly"] }, { subcategory: "vegetarian" }),
  tc("DIT", "vegetarian Italian pasta", { cuisines: ["Italian"], dietary: ["vegetarian"], intentTags: ["vegan friendly"] }, { subcategory: "vegetarian" }),
  tc("DIT", "vegetarian Thai curry", { cuisines: ["Thai", "Indian"], dietary: ["vegetarian"], intentTags: ["vegan friendly"] }, { subcategory: "vegetarian" }),
  tc("DIT", "vegetarian brunch", { cuisines: ["Brunch"], tags: ["brunch spot"], dietary: ["vegetarian"], intentTags: ["vegan friendly"] }, { subcategory: "vegetarian" }),
  tc("DIT", "vegetarian Mediterranean", { cuisines: ["Mediterranean"], dietary: ["vegetarian"], intentTags: ["vegan friendly"] }, { subcategory: "vegetarian" }),
  // --- Gluten-free (8) ---
  tc("DIT", "gluten-free restaurant", { tags: ["gluten free"], dietary: ["gluten-free"], intentTags: ["gluten free"] }, { subcategory: "gluten-free" }),
  tc("DIT", "gluten free pizza", { cuisines: ["Italian"], tags: ["gluten free"], dietary: ["gluten free"], intentTags: ["gluten free"] }, { subcategory: "gluten-free" }),
  tc("DIT", "celiac friendly restaurant", { tags: ["gluten free"], intentTags: ["gluten free"] }, { subcategory: "gluten-free" }),
  tc("DIT", "gluten free pasta", { cuisines: ["Italian"], tags: ["gluten free"], dietary: ["gluten free"], intentTags: ["gluten free"] }, { subcategory: "gluten-free" }),
  tc("DIT", "gluten free brunch", { cuisines: ["Brunch"], tags: ["gluten free", "brunch spot"], dietary: ["gluten free"], intentTags: ["gluten free"] }, { subcategory: "gluten-free" }),
  tc("DIT", "gluten-free options dinner", { tags: ["gluten free"], dietary: ["gluten-free"], intentTags: ["gluten free"] }, { subcategory: "gluten-free" }),
  tc("DIT", "gluten free sushi", { cuisines: ["Japanese"], tags: ["gluten free"], dietary: ["gluten free"], intentTags: ["gluten free"] }, { subcategory: "gluten-free" }),
  tc("DIT", "gluten free bakery", { tags: ["gluten free"], dietary: ["gluten free"], intentTags: ["gluten free", "brunch spot"] }, { subcategory: "gluten-free" }),
  // --- Halal (6) ---
  tc("DIT", "halal restaurant Chicago", { dietary: ["halal"] }, { subcategory: "halal" }),
  tc("DIT", "halal Middle Eastern food", { cuisines: ["Middle Eastern"], dietary: ["halal"], intentCuisines: ["Middle Eastern"] }, { subcategory: "halal" }),
  tc("DIT", "halal chicken and rice", { dietary: ["halal"] }, { subcategory: "halal" }),
  tc("DIT", "halal Indian restaurant", { cuisines: ["Indian"], dietary: ["halal"] }, { subcategory: "halal" }),
  tc("DIT", "halal burger spot", { cuisines: ["American"], dietary: ["halal"] }, { subcategory: "halal" }),
  tc("DIT", "halal meat restaurant", { dietary: ["halal"] }, { subcategory: "halal" }),
  // --- Kosher (4) ---
  tc("DIT", "kosher restaurant Chicago", { dietary: ["kosher"] }, { subcategory: "kosher" }),
  tc("DIT", "kosher deli", { dietary: ["kosher"] }, { subcategory: "kosher" }),
  tc("DIT", "kosher pizza", { cuisines: ["Italian"], dietary: ["kosher"] }, { subcategory: "kosher" }),
  tc("DIT", "kosher friendly dining", { dietary: ["kosher"] }, { subcategory: "kosher" }),
  // --- Keto/Paleo (6) ---
  tc("DIT", "keto friendly restaurant", { dietary: ["keto"] }, { subcategory: "keto" }),
  tc("DIT", "keto meal Chicago", { dietary: ["keto"] }, { subcategory: "keto" }),
  tc("DIT", "paleo restaurant options", { dietary: ["paleo"] }, { subcategory: "paleo" }),
  tc("DIT", "low carb restaurant", { dietary: ["low carb"] }, { subcategory: "keto" }),
  tc("DIT", "keto burger no bun", { cuisines: ["American"], dietary: ["keto"] }, { subcategory: "keto" }),
  tc("DIT", "paleo brunch", { cuisines: ["Brunch"], tags: ["brunch spot"], dietary: ["paleo"] }, { subcategory: "paleo" }),
  // --- Dairy-free / Nut-free (8) ---
  tc("DIT", "dairy-free restaurant", { dietary: ["dairy-free"] }, { subcategory: "dairy-free" }),
  tc("DIT", "dairy free pizza", { cuisines: ["Italian"], dietary: ["dairy free"] }, { subcategory: "dairy-free" }),
  tc("DIT", "nut-free restaurant", { dietary: ["nut-free"] }, { subcategory: "nut-free" }),
  tc("DIT", "nut free bakery", { dietary: ["nut free"], intentTags: ["brunch spot"] }, { subcategory: "nut-free" }),
  tc("DIT", "allergy friendly restaurant", { intentTags: [] }, { subcategory: "allergy" }),
  tc("DIT", "food allergy safe dining", { intentTags: [] }, { subcategory: "allergy" }),
  tc("DIT", "dairy free ice cream", { dietary: ["dairy free"] }, { subcategory: "dairy-free" }),
  tc("DIT", "nut free dessert spot", { dietary: ["nut free"], intentTags: ["trendy"] }, { subcategory: "nut-free" }),
];

// ==========================================
// FTR — FEATURE-BASED (50 tests)
// ==========================================

const FTR_TESTS: TestCase[] = [
  // --- Rooftop (8) ---
  tc("FTR", "rooftop restaurant", { tags: ["rooftop"], intentTags: ["rooftop", "scenic view"] }, { subcategory: "rooftop" }),
  tc("FTR", "rooftop bar downtown", { tags: ["rooftop"], intentTags: ["rooftop", "scenic view"] }, { subcategory: "rooftop" }),
  tc("FTR", "best rooftop dining Chicago", { tags: ["rooftop"], intentTags: ["rooftop", "scenic view"] }, { subcategory: "rooftop" }),
  tc("FTR", "skyline view restaurant", { tags: ["rooftop", "scenic view"], intentTags: ["rooftop", "scenic view"] }, { subcategory: "rooftop" }),
  tc("FTR", "rooftop brunch", { cuisines: ["Brunch"], tags: ["rooftop", "brunch spot"], intentTags: ["rooftop", "scenic view"] }, { subcategory: "rooftop" }),
  tc("FTR", "rooftop cocktails sunset", { tags: ["rooftop", "craft cocktails"], intentTags: ["rooftop", "scenic view", "craft cocktails"] }, { subcategory: "rooftop" }),
  tc("FTR", "rooftop sushi bar", { cuisines: ["Japanese"], tags: ["rooftop"], intentTags: ["rooftop", "scenic view"] }, { subcategory: "rooftop" }),
  tc("FTR", "panoramic view restaurant", { tags: ["scenic view"] }, { subcategory: "rooftop" }),
  // --- BYOB (6) ---
  tc("FTR", "BYOB restaurant", { tags: ["byob"] }, { subcategory: "byob" }),
  tc("FTR", "best BYOB Chicago", { tags: ["byob"] }, { subcategory: "byob" }),
  tc("FTR", "BYOB Italian dinner", { cuisines: ["Italian"], tags: ["byob"] }, { subcategory: "byob" }),
  tc("FTR", "bring your own wine restaurant", { tags: ["byob"], intentTags: ["romantic"], intentCuisines: ["Italian", "French"] }, { subcategory: "byob" }),
  tc("FTR", "BYOB Thai food", { cuisines: ["Thai"], tags: ["byob"] }, { subcategory: "byob" }),
  tc("FTR", "BYOB sushi", { cuisines: ["Japanese"], tags: ["byob"] }, { subcategory: "byob" }),
  // --- Late night (8) ---
  tc("FTR", "late night food", { tags: ["late night"], intentTags: ["late night"] }, { subcategory: "late-night" }),
  tc("FTR", "late night eats Chicago", { tags: ["late night"] }, { subcategory: "late-night" }),
  tc("FTR", "after midnight food", { tags: ["late night"] }, { subcategory: "late-night" }),
  tc("FTR", "late night tacos", { cuisines: ["Mexican"], tags: ["late night"] }, { subcategory: "late-night" }),
  tc("FTR", "late night pizza", { cuisines: ["Italian"], tags: ["late night"] }, { subcategory: "late-night" }),
  tc("FTR", "24 hour restaurant", { tags: ["late night"] }, { subcategory: "late-night" }),
  tc("FTR", "late night ramen", { cuisines: ["Japanese"], tags: ["late night"] }, { subcategory: "late-night" }),
  tc("FTR", "midnight snack spot", { tags: ["late night"], intentTags: ["late night"] }, { subcategory: "late-night" }),
  // --- Outdoor patio (8) ---
  tc("FTR", "outdoor patio restaurant", { tags: ["outdoor patio"] }, { subcategory: "patio" }),
  tc("FTR", "patio dining Chicago", { tags: ["outdoor patio"], intentTags: ["outdoor patio"] }, { subcategory: "patio" }),
  tc("FTR", "al fresco dinner", { tags: ["outdoor patio"] }, { subcategory: "patio" }),
  tc("FTR", "outdoor seating restaurant", { tags: ["outdoor patio"] }, { subcategory: "patio" }),
  tc("FTR", "garden patio brunch", { cuisines: ["Brunch"], tags: ["outdoor patio", "brunch spot"] }, { subcategory: "patio" }),
  tc("FTR", "terrace dining summer", { tags: ["outdoor patio"] }, { subcategory: "patio" }),
  tc("FTR", "outdoor pizza and beer", { cuisines: ["Italian", "Brewery/Beer Bar"], tags: ["outdoor patio", "craft beer"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, { subcategory: "patio" }),
  tc("FTR", "sidewalk cafe seating", { cuisines: ["Coffee/Cafe"], tags: ["outdoor patio"], intentTags: ["brunch spot", "quiet"] }, { subcategory: "patio" }),
  // --- Live music (6) ---
  tc("FTR", "live music restaurant", { tags: ["live music"] }, { subcategory: "music" }),
  tc("FTR", "jazz dinner Chicago", { tags: ["live music"] }, { subcategory: "music" }),
  tc("FTR", "live band restaurant", { tags: ["live music"] }, { subcategory: "music" }),
  tc("FTR", "jazz club with food", { tags: ["live music"] }, { subcategory: "music" }),
  tc("FTR", "live music brunch", { cuisines: ["Brunch"], tags: ["live music", "brunch spot"] }, { subcategory: "music" }),
  tc("FTR", "blues dinner show", { tags: ["live music"] }, { subcategory: "music" }),
  // --- Waterfront (6) ---
  tc("FTR", "waterfront restaurant", { tags: ["waterfront", "scenic view"], intentTags: ["waterfront", "scenic view"] }, { subcategory: "waterfront" }),
  tc("FTR", "lakefront dining", { tags: ["waterfront", "scenic view"], intentTags: ["waterfront", "scenic view"] }, { subcategory: "waterfront" }),
  tc("FTR", "riverwalk restaurant", { tags: ["waterfront"] }, { subcategory: "waterfront" }),
  tc("FTR", "lake view dinner", { tags: ["waterfront", "scenic view"] }, { subcategory: "waterfront" }),
  tc("FTR", "waterfront brunch", { cuisines: ["Brunch"], tags: ["waterfront", "scenic view", "brunch spot"], intentTags: ["waterfront", "scenic view"] }, { subcategory: "waterfront" }),
  tc("FTR", "river view cocktails", { tags: ["waterfront", "scenic view", "craft cocktails"], intentTags: ["waterfront", "scenic view", "craft cocktails"] }, { subcategory: "waterfront" }),
  // --- Other features (8) ---
  tc("FTR", "pet friendly restaurant", { tags: [] }, { subcategory: "other" }),
  tc("FTR", "dog friendly patio", { tags: ["outdoor patio"] }, { subcategory: "other" }),
  tc("FTR", "farm-to-table restaurant", { tags: ["farm-to-table"], intentTags: ["farm-to-table"] }, { subcategory: "other" }),
  tc("FTR", "organic local ingredients", { tags: ["farm-to-table"] }, { subcategory: "other" }),
  tc("FTR", "private dining room", { intentTags: ["romantic", "quiet"] }, { subcategory: "other" }),
  tc("FTR", "semi private dinner", { intentTags: ["quiet"] }, { subcategory: "other" }),
  tc("FTR", "wheelchair accessible restaurant", {}, { subcategory: "other" }),
  tc("FTR", "reservation restaurant Chicago", {}, { subcategory: "other" }),
];


// ==========================================
// NLP — NATURAL LANGUAGE (80 tests)
// ==========================================

const NLP_TESTS: TestCase[] = [
  // --- "Craving..." queries (15) ---
  tc("NLP", "craving something spicy tonight", { intentCuisines: ["Thai", "Indian", "Korean", "Mexican"] }, { subcategory: "craving" }),
  tc("NLP", "craving sushi bad", { cuisines: ["Japanese"] }, { subcategory: "craving" }),
  tc("NLP", "craving tacos and margaritas", { cuisines: ["Mexican"] }, { subcategory: "craving" }),
  tc("NLP", "craving pasta carbonara", { cuisines: ["Italian"], intentCuisines: ["Italian"] }, { subcategory: "craving" }),
  tc("NLP", "craving something sweet", { intentTags: [] }, { subcategory: "craving" }),
  tc("NLP", "craving noodles tonight", { cuisines: ["Chinese"], intentCuisines: ["Japanese", "Vietnamese", "Thai", "Chinese"] }, { subcategory: "craving" }),
  tc("NLP", "craving comfort food", { intentCuisines: ["American"], intentTags: ["great value"] }, { subcategory: "craving" }),
  tc("NLP", "craving BBQ ribs", { cuisines: ["BBQ"], intentCuisines: ["BBQ", "Korean"] }, { subcategory: "craving" }),
  tc("NLP", "craving something fresh and light", { intentTags: ["farm-to-table"] }, { subcategory: "craving" }),
  tc("NLP", "craving fried chicken", { cuisines: ["Southern/Soul Food"], intentCuisines: ["Korean", "American"] }, { subcategory: "craving" }),
  tc("NLP", "craving dim sum dumplings", { cuisines: ["Chinese"], intentCuisines: ["Chinese"] }, { subcategory: "craving" }),
  tc("NLP", "craving a good burger", { cuisines: ["American"] }, { subcategory: "craving" }),
  tc("NLP", "craving Mediterranean food", { cuisines: ["Mediterranean"] }, { subcategory: "craving" }),
  tc("NLP", "craving smoky flavors", { intentCuisines: ["Korean", "American", "Steak"] }, { subcategory: "craving" }),
  tc("NLP", "craving something savory and rich", { intentCuisines: ["American", "Italian"] }, { subcategory: "craving" }),
  // --- "In the mood for..." queries (10) ---
  tc("NLP", "in the mood for Italian", { cuisines: ["Italian"] }, { subcategory: "mood" }),
  tc("NLP", "in the mood for something cozy", { intentTags: ["quiet", "hidden gem"] }, { subcategory: "mood" }),
  tc("NLP", "in the mood for seafood", { cuisines: ["Seafood"] }, { subcategory: "mood" }),
  tc("NLP", "feeling like Thai tonight", { cuisines: ["Thai"] }, { subcategory: "mood" }),
  tc("NLP", "feeling like ramen", { cuisines: ["Japanese"] }, { subcategory: "mood" }),
  tc("NLP", "in the mood for steak", { cuisines: ["Steak"] }, { subcategory: "mood" }),
  tc("NLP", "feeling fancy tonight", { intentTags: ["trendy", "romantic"] }, { subcategory: "mood" }),
  tc("NLP", "in the mood for Indian curry", { cuisines: ["Indian", "Thai"] }, { subcategory: "mood" }),
  tc("NLP", "feeling adventurous food wise", { intentTags: ["hidden gem"] }, { subcategory: "mood" }),
  tc("NLP", "in the mood for something unique", { intentTags: ["hidden gem"] }, { subcategory: "mood" }),
  // --- "Somewhere nice for..." queries (10) ---
  tc("NLP", "somewhere nice for our anniversary", { intentTags: ["romantic", "scenic view"] }, {
    subcategory: "somewhere",
    mockIntent: { emotional_intent: "impress", date_type: "anniversary" },
  }),
  tc("NLP", "somewhere special for a birthday", { intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "somewhere",
    mockIntent: { emotional_intent: "celebrate" },
  }),
  tc("NLP", "somewhere quiet for a conversation", { tags: ["quiet"], intentTags: ["quiet"] }, {
    subcategory: "somewhere",
    mockIntent: { emotional_intent: "casual" },
  }),
  tc("NLP", "somewhere fun for a group", { intentTags: ["trendy", "live music"] }, {
    subcategory: "somewhere",
    mockIntent: { emotional_intent: "casual", group_size_hint: "small_group" },
  }),
  tc("NLP", "somewhere romantic and intimate", { tags: ["romantic"], intentTags: ["romantic", "scenic view", "quiet"] }, {
    subcategory: "somewhere",
    mockIntent: { emotional_intent: "impress" },
  }),
  tc("NLP", "somewhere with a great view", { tags: ["scenic view"] }, {
    subcategory: "somewhere",
    mockIntent: { emotional_intent: "impress" },
  }),
  tc("NLP", "somewhere trendy and hip for girls night", { tags: ["trendy"], intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "somewhere",
    mockIntent: { emotional_intent: "celebrate", group_size_hint: "small_group" },
  }),
  tc("NLP", "somewhere with live music and good food", { tags: ["live music"] }, {
    subcategory: "somewhere",
    mockIntent: { emotional_intent: "casual" },
  }),
  tc("NLP", "somewhere cheap and good", { tags: ["great value"], intentTags: ["great value", "hidden gem"] }, {
    subcategory: "somewhere",
    mockIntent: { emotional_intent: "casual", practical_constraints: ["budget"] },
  }),
  tc("NLP", "somewhere to impress a date", { intentTags: ["romantic"] }, {
    subcategory: "somewhere",
    mockIntent: { emotional_intent: "impress", date_type: "first_date" },
  }),
  // --- "Looking for..." queries (10) ---
  tc("NLP", "looking for a good sushi place", { cuisines: ["Japanese"] }, { subcategory: "looking" }),
  tc("NLP", "looking for authentic Mexican", { cuisines: ["Mexican"], intentTags: ["hidden gem"] }, { subcategory: "looking" }),
  tc("NLP", "looking for a brunch spot", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "looking" }),
  tc("NLP", "looking for rooftop dining", { tags: ["rooftop"], intentTags: ["rooftop", "scenic view"] }, { subcategory: "looking" }),
  tc("NLP", "looking for BYOB Italian", { cuisines: ["Italian"], tags: ["byob"] }, { subcategory: "looking" }),
  tc("NLP", "looking for late night eats", { tags: ["late night"] }, { subcategory: "looking" }),
  tc("NLP", "looking for a hidden gem", { tags: ["hidden gem"], intentTags: ["hidden gem"] }, { subcategory: "looking" }),
  tc("NLP", "looking for affordable dinner", { tags: ["great value"], intentTags: ["great value", "hidden gem"] }, { subcategory: "looking" }),
  tc("NLP", "looking for vegan options", { cuisines: ["Vegan"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, { subcategory: "looking" }),
  tc("NLP", "looking for a quiet place to eat", { tags: ["quiet"], intentTags: ["quiet"] }, { subcategory: "looking" }),
  // --- "Want to try..." queries (10) ---
  tc("NLP", "want to try Ethiopian food", { cuisines: ["Ethiopian"] }, { subcategory: "try" }),
  tc("NLP", "want to try something new", { intentTags: ["hidden gem"] }, {
    subcategory: "try",
    mockIntent: { emotional_intent: "explore" },
  }),
  tc("NLP", "want to try omakase", { cuisines: ["Japanese"], intentCuisines: ["Japanese"] }, { subcategory: "try" }),
  tc("NLP", "want to try Korean BBQ", { cuisines: ["Korean", "BBQ"], intentCuisines: ["BBQ", "Korean"] }, { subcategory: "try" }),
  tc("NLP", "want to try a speakeasy", { cuisines: ["Cocktail Bar"] }, { subcategory: "try" }),
  tc("NLP", "want to try Peruvian ceviche", { cuisines: ["Peruvian"], intentCuisines: ["Peruvian", "Seafood"] }, { subcategory: "try" }),
  tc("NLP", "want to try dim sum", { cuisines: ["Chinese"], intentCuisines: ["Chinese"] }, { subcategory: "try" }),
  tc("NLP", "want to try farm-to-table", { tags: ["farm-to-table"], intentTags: ["farm-to-table"] }, { subcategory: "try" }),
  tc("NLP", "want to try birria tacos", { cuisines: ["Mexican"], intentCuisines: ["Mexican"] }, { subcategory: "try" }),
  tc("NLP", "want to try fusion cuisine", { cuisines: ["Fusion"], intentTags: ["trendy"] }, { subcategory: "try" }),
  // --- Question format queries (10) ---
  tc("NLP", "where can I get good pizza?", { cuisines: ["Italian"] }, { subcategory: "question" }),
  tc("NLP", "what's the best ramen in Chicago?", { cuisines: ["Japanese"] }, { subcategory: "question" }),
  tc("NLP", "where to eat sushi downtown?", { cuisines: ["Japanese"] }, { subcategory: "question" }),
  tc("NLP", "any good Mexican restaurants nearby?", { cuisines: ["Mexican"] }, { subcategory: "question" }),
  tc("NLP", "know any good brunch spots?", { cuisines: ["Brunch"], tags: ["brunch spot"] }, { subcategory: "question" }),
  tc("NLP", "what's good for a date night?", { intentTags: ["romantic"] }, { subcategory: "question" }),
  tc("NLP", "where should we go for happy hour?", { intentTags: ["craft cocktails", "great value"] }, { subcategory: "question" }),
  tc("NLP", "any recommendations for Thai food?", { cuisines: ["Thai"] }, { subcategory: "question" }),
  tc("NLP", "what are the best tacos in Pilsen?", { cuisines: ["Mexican"] }, { subcategory: "question" }),
  tc("NLP", "where to get craft cocktails?", { tags: ["craft cocktails"], intentTags: ["craft cocktails"] }, { subcategory: "question" }),
  // --- Long descriptive queries (15) ---
  tc("NLP", "I want a cozy Italian restaurant with good pasta and wine for a date", { cuisines: ["Italian"], intentTags: ["quiet", "hidden gem", "romantic"], intentCuisines: ["Italian", "French"] }, {
    subcategory: "descriptive",
    mockIntent: { target_cuisines: ["Italian"], cuisine_importance: "high", emotional_intent: "impress", date_type: "casual_weeknight" },
  }),
  tc("NLP", "need a place with outdoor seating that serves brunch and mimosas", { cuisines: ["Brunch"], tags: ["outdoor patio", "brunch spot"] }, {
    subcategory: "descriptive",
  }),
  tc("NLP", "looking for an upscale steakhouse for a business dinner", { cuisines: ["Steak"], intentTags: ["trendy", "romantic", "quiet"] }, {
    subcategory: "descriptive",
    mockIntent: { target_cuisines: ["Steak"], cuisine_importance: "high", emotional_intent: "impress" },
  }),
  tc("NLP", "want something casual and cheap with good tacos", { cuisines: ["Mexican"], tags: ["great value"], intentTags: ["great value", "hidden gem"] }, {
    subcategory: "descriptive",
    mockIntent: { target_cuisines: ["Mexican"], cuisine_importance: "high", emotional_intent: "casual", practical_constraints: ["budget"] },
  }),
  tc("NLP", "somewhere with a lively atmosphere and craft cocktails for girls night", { tags: ["lively atmosphere", "craft cocktails"], intentTags: ["trendy", "craft cocktails", "lively atmosphere", "live music"] }, {
    subcategory: "descriptive",
    mockIntent: { emotional_intent: "celebrate", group_size_hint: "small_group" },
  }),
  tc("NLP", "quiet Japanese restaurant for solo omakase dinner", { cuisines: ["Japanese"], tags: ["quiet"], intentCuisines: ["Japanese"], intentTags: ["quiet", "hidden gem"] }, {
    subcategory: "descriptive",
    mockIntent: { target_cuisines: ["Japanese"], cuisine_importance: "high", emotional_intent: "indulge", group_size_hint: "solo" },
  }),
  tc("NLP", "family friendly pizza place with outdoor seating", { cuisines: ["Italian"], tags: ["outdoor patio"] }, {
    subcategory: "descriptive",
    mockIntent: { target_cuisines: ["Italian"], cuisine_importance: "high", emotional_intent: "casual" },
  }),
  tc("NLP", "hidden gem Ethiopian restaurant authentic experience", { cuisines: ["Ethiopian"], tags: ["hidden gem"], intentTags: ["hidden gem"] }, {
    subcategory: "descriptive",
    mockIntent: { target_cuisines: ["Ethiopian"], cuisine_importance: "high", emotional_intent: "explore" },
  }),
  tc("NLP", "romantic waterfront restaurant with a view for our anniversary", { tags: ["romantic", "waterfront", "scenic view"], intentTags: ["romantic", "scenic view", "waterfront"] }, {
    subcategory: "descriptive",
    mockIntent: { emotional_intent: "impress", date_type: "anniversary" },
  }),
  tc("NLP", "best vegan brunch with gluten free options", { cuisines: ["Vegan", "Brunch"], tags: ["vegan friendly", "brunch spot", "gluten free"], dietary: ["vegan", "gluten free"], intentTags: ["vegan friendly", "gluten free"] }, {
    subcategory: "descriptive",
  }),
  tc("NLP", "trendy Asian fusion with craft cocktails downtown", { cuisines: ["Fusion"], tags: ["trendy", "craft cocktails"], intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "descriptive",
    mockIntent: { cuisine_importance: "medium", emotional_intent: "casual" },
  }),
  tc("NLP", "I'm visiting Chicago and want deep dish pizza and a speakeasy", { cuisines: ["Italian", "Cocktail Bar"], intentCuisines: ["Italian", "American"] }, {
    subcategory: "descriptive",
  }),
  tc("NLP", "budget friendly late night food after a concert", { tags: ["late night", "great value"], intentTags: ["great value", "hidden gem", "late night"] }, {
    subcategory: "descriptive",
    mockIntent: { emotional_intent: "casual", practical_constraints: ["budget"], spontaneity: "spontaneous" },
  }),
  tc("NLP", "quick lunch near the Loop something healthy", { intentTags: ["great value", "farm-to-table", "vegan friendly"], intentCuisines: ["Mediterranean"] }, {
    subcategory: "descriptive",
    mockIntent: { emotional_intent: "casual", spontaneity: "spontaneous" },
  }),
  tc("NLP", "want to take my parents somewhere nice for dinner not too loud", {}, {
    subcategory: "descriptive",
    mockIntent: { emotional_intent: "impress", group_size_hint: "small_group" },
  }),
];

// ==========================================
// MLT — MULTI-SIGNAL (50 tests)
// ==========================================

const MLT_TESTS: TestCase[] = [
  // --- Cuisine + Occasion (10) ---
  tc("MLT", "romantic sushi dinner date night", { cuisines: ["Japanese"], tags: ["romantic"], intentTags: ["romantic", "scenic view"] }, {
    subcategory: "cuisine+occasion",
    occasion: "Date Night",
    mockIntent: { target_cuisines: ["Japanese"], cuisine_importance: "high", emotional_intent: "impress" },
  }),
  tc("MLT", "Italian birthday dinner celebration", { cuisines: ["Italian"], intentTags: ["trendy", "craft cocktails", "romantic"] }, {
    subcategory: "cuisine+occasion",
    occasion: "Special Occasion",
    mockIntent: { target_cuisines: ["Italian"], cuisine_importance: "high", emotional_intent: "celebrate" },
  }),
  tc("MLT", "steak business lunch client", { cuisines: ["Steak"], intentTags: ["quiet"] }, {
    subcategory: "cuisine+occasion",
    occasion: "Business Lunch",
    mockIntent: { target_cuisines: ["Steak"], cuisine_importance: "high", emotional_intent: "impress" },
  }),
  tc("MLT", "family Mexican dinner kids friendly", { cuisines: ["Mexican"] }, {
    subcategory: "cuisine+occasion",
    occasion: "Family Dinner",
    mockIntent: { target_cuisines: ["Mexican"], cuisine_importance: "high", emotional_intent: "casual" },
  }),
  tc("MLT", "solo ramen lunch adventure", { cuisines: ["Japanese"], intentTags: ["quiet", "hidden gem", "great value"] }, {
    subcategory: "cuisine+occasion",
    occasion: "Solo Dining",
    mockIntent: { target_cuisines: ["Japanese"], cuisine_importance: "high", emotional_intent: "explore", group_size_hint: "solo" },
  }),
  tc("MLT", "group Korean BBQ fun night", { cuisines: ["Korean", "BBQ"], intentCuisines: ["BBQ", "Korean"], intentTags: ["trendy", "live music"] }, {
    subcategory: "cuisine+occasion",
    occasion: "Group Hangout",
    mockIntent: { target_cuisines: ["Korean"], cuisine_importance: "high", emotional_intent: "casual", group_size_hint: "large_group" },
  }),
  tc("MLT", "anniversary French fine dining", { cuisines: ["French"], intentTags: ["romantic", "scenic view", "trendy"] }, {
    subcategory: "cuisine+occasion",
    occasion: "Special Occasion",
    mockIntent: { target_cuisines: ["French"], cuisine_importance: "high", emotional_intent: "impress", date_type: "anniversary" },
  }),
  tc("MLT", "treat myself omakase sushi", { cuisines: ["Japanese"], intentCuisines: ["Japanese"], intentTags: ["quiet", "hidden gem"] }, {
    subcategory: "cuisine+occasion",
    occasion: "Treat Myself",
    mockIntent: { target_cuisines: ["Japanese"], cuisine_importance: "high", emotional_intent: "indulge", group_size_hint: "solo" },
  }),
  tc("MLT", "chill hangout pizza and beer", { cuisines: ["Italian", "Brewery/Beer Bar"], tags: ["craft beer"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer"] }, {
    subcategory: "cuisine+occasion",
    occasion: "Chill Hangout",
    mockIntent: { target_cuisines: ["Italian"], cuisine_importance: "medium", emotional_intent: "casual" },
  }),
  tc("MLT", "Ethiopian adventure dining explore", { cuisines: ["Ethiopian"], intentTags: ["hidden gem"] }, {
    subcategory: "cuisine+occasion",
    occasion: "Adventure",
    mockIntent: { target_cuisines: ["Ethiopian"], cuisine_importance: "high", emotional_intent: "explore" },
  }),
  // --- Cuisine + Vibe + Feature (10) ---
  tc("MLT", "romantic rooftop sushi bar", { cuisines: ["Japanese"], tags: ["romantic", "rooftop"], intentTags: ["romantic", "scenic view", "rooftop"] }, {
    subcategory: "cuisine+vibe+feature",
    mockIntent: { target_cuisines: ["Japanese"], cuisine_importance: "high", emotional_intent: "impress" },
  }),
  tc("MLT", "cozy Italian BYOB dinner", { cuisines: ["Italian"], tags: ["byob"], intentTags: ["quiet", "hidden gem"] }, {
    subcategory: "cuisine+vibe+feature",
    mockIntent: { target_cuisines: ["Italian"], cuisine_importance: "high", emotional_intent: "comfort" },
  }),
  tc("MLT", "lively Mexican patio bar", { cuisines: ["Mexican"], tags: ["outdoor patio", "lively atmosphere"], intentTags: ["live music", "trendy"] }, {
    subcategory: "cuisine+vibe+feature",
    mockIntent: { target_cuisines: ["Mexican"], cuisine_importance: "high", emotional_intent: "casual" },
  }),
  tc("MLT", "quiet waterfront seafood dinner", { cuisines: ["Seafood"], tags: ["quiet", "waterfront", "scenic view"], intentTags: ["waterfront", "scenic view"] }, {
    subcategory: "cuisine+vibe+feature",
    mockIntent: { target_cuisines: ["Seafood"], cuisine_importance: "high", emotional_intent: "comfort" },
  }),
  tc("MLT", "trendy rooftop cocktails downtown", { tags: ["trendy", "rooftop", "craft cocktails"], intentTags: ["rooftop", "scenic view", "craft cocktails"] }, {
    subcategory: "cuisine+vibe+feature",
    mockIntent: { cuisine_importance: "low", emotional_intent: "casual" },
  }),
  tc("MLT", "hidden gem Thai BYOB spot", { cuisines: ["Thai"], tags: ["hidden gem", "byob"], intentTags: ["hidden gem"] }, {
    subcategory: "cuisine+vibe+feature",
    mockIntent: { target_cuisines: ["Thai"], cuisine_importance: "high", emotional_intent: "explore" },
  }),
  tc("MLT", "upscale steakhouse scenic view", { cuisines: ["Steak"], tags: ["scenic view"], intentTags: ["trendy", "romantic"] }, {
    subcategory: "cuisine+vibe+feature",
    mockIntent: { target_cuisines: ["Steak"], cuisine_importance: "high", emotional_intent: "impress" },
  }),
  tc("MLT", "farm-to-table brunch outdoor patio", { cuisines: ["Brunch"], tags: ["farm-to-table", "outdoor patio", "brunch spot"], intentTags: ["farm-to-table"] }, {
    subcategory: "cuisine+vibe+feature",
    mockIntent: { cuisine_importance: "low", emotional_intent: "casual" },
  }),
  tc("MLT", "energetic live music BBQ bar", { cuisines: ["Korean", "BBQ"], tags: ["live music", "lively atmosphere"], intentCuisines: ["BBQ", "Korean"], intentTags: ["lively atmosphere", "trendy", "live music"] }, {
    subcategory: "cuisine+vibe+feature",
    mockIntent: { target_cuisines: ["BBQ"], cuisine_importance: "high", emotional_intent: "casual" },
  }),
  tc("MLT", "intimate French bistro candlelit", { cuisines: ["French"], tags: ["romantic"], intentTags: ["romantic", "quiet"] }, {
    subcategory: "cuisine+vibe+feature",
    mockIntent: { target_cuisines: ["French"], cuisine_importance: "high", emotional_intent: "impress" },
  }),
  // --- Occasion + Vibe (8) ---
  tc("MLT", "quiet anniversary dinner romantic", { tags: ["quiet", "romantic"], intentTags: ["romantic", "scenic view", "quiet"] }, {
    subcategory: "occasion+vibe",
    occasion: "Special Occasion",
    mockIntent: { emotional_intent: "impress", date_type: "anniversary" },
  }),
  tc("MLT", "lively birthday party dinner", { tags: ["lively atmosphere"], intentTags: ["lively atmosphere", "trendy", "live music", "craft cocktails"] }, {
    subcategory: "occasion+vibe",
    occasion: "Special Occasion",
    mockIntent: { emotional_intent: "celebrate", group_size_hint: "large_group" },
  }),
  tc("MLT", "trendy girls night cocktails", { tags: ["trendy", "craft cocktails"], intentTags: ["trendy", "craft cocktails"] }, {
    subcategory: "occasion+vibe",
    occasion: "Group Hangout",
    mockIntent: { emotional_intent: "casual", group_size_hint: "small_group" },
  }),
  tc("MLT", "cozy solo dining quiet", { tags: ["quiet"], intentTags: ["quiet", "hidden gem"] }, {
    subcategory: "occasion+vibe",
    occasion: "Solo Dining",
    mockIntent: { emotional_intent: "comfort", group_size_hint: "solo" },
  }),
  tc("MLT", "upscale business lunch quiet", { tags: ["quiet"], intentTags: ["trendy", "romantic", "quiet", "great value"] }, {
    subcategory: "occasion+vibe",
    occasion: "Business Lunch",
    mockIntent: { emotional_intent: "impress" },
  }),
  tc("MLT", "casual family brunch outdoor", { cuisines: ["Brunch"], tags: ["outdoor patio", "brunch spot"] }, {
    subcategory: "occasion+vibe",
    occasion: "Family Dinner",
    mockIntent: { emotional_intent: "casual", group_size_hint: "small_group" },
  }),
  tc("MLT", "energetic group hangout bar", { tags: ["lively atmosphere"], intentTags: ["lively atmosphere", "trendy", "live music"] }, {
    subcategory: "occasion+vibe",
    occasion: "Group Hangout",
    mockIntent: { emotional_intent: "casual", group_size_hint: "large_group" },
  }),
  tc("MLT", "romantic date night scenic view", { tags: ["romantic", "scenic view"], intentTags: ["romantic", "scenic view"] }, {
    subcategory: "occasion+vibe",
    occasion: "Date Night",
    mockIntent: { emotional_intent: "impress" },
  }),
  // --- Cuisine + Dietary (8) ---
  tc("MLT", "vegan Thai curry", { cuisines: ["Vegan", "Thai", "Indian"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, {
    subcategory: "cuisine+dietary",
    mockIntent: { target_cuisines: ["Thai"], cuisine_importance: "high" },
  }),
  tc("MLT", "gluten-free Italian pasta", { cuisines: ["Italian"], tags: ["gluten free"], dietary: ["gluten-free"], intentTags: ["gluten free"] }, {
    subcategory: "cuisine+dietary",
    mockIntent: { target_cuisines: ["Italian"], cuisine_importance: "high" },
  }),
  tc("MLT", "halal Indian biryani", { cuisines: ["Indian"], dietary: ["halal"], intentCuisines: ["Indian"] }, {
    subcategory: "cuisine+dietary",
    mockIntent: { target_cuisines: ["Indian"], cuisine_importance: "high" },
  }),
  tc("MLT", "vegan sushi options", { cuisines: ["Vegan", "Japanese"], tags: ["vegan friendly"], dietary: ["vegan"], intentTags: ["vegan friendly"] }, {
    subcategory: "cuisine+dietary",
    mockIntent: { target_cuisines: ["Japanese"], cuisine_importance: "high" },
  }),
  tc("MLT", "keto steak dinner", { cuisines: ["Steak"], dietary: ["keto"] }, {
    subcategory: "cuisine+dietary",
    mockIntent: { target_cuisines: ["Steak"], cuisine_importance: "high" },
  }),
  tc("MLT", "vegetarian Indian thali", { cuisines: ["Indian"], dietary: ["vegetarian"], intentTags: ["vegan friendly"] }, {
    subcategory: "cuisine+dietary",
    mockIntent: { target_cuisines: ["Indian"], cuisine_importance: "high" },
  }),
  tc("MLT", "dairy-free Mexican food", { cuisines: ["Mexican"], dietary: ["dairy-free"] }, {
    subcategory: "cuisine+dietary",
    mockIntent: { target_cuisines: ["Mexican"], cuisine_importance: "high" },
  }),
  tc("MLT", "vegan Ethiopian injera platter", { cuisines: ["Vegan", "Ethiopian"], tags: ["vegan friendly"], dietary: ["vegan"], intentCuisines: ["Ethiopian"], intentTags: ["vegan friendly"] }, {
    subcategory: "cuisine+dietary",
    mockIntent: { target_cuisines: ["Ethiopian"], cuisine_importance: "high" },
  }),
  // --- Feature + Vibe + Drinks (8) ---
  tc("MLT", "rooftop craft cocktails sunset view", { tags: ["rooftop", "craft cocktails", "scenic view"], intentTags: ["rooftop", "scenic view", "craft cocktails"] }, {
    subcategory: "feature+vibe+drinks",
    mockIntent: { emotional_intent: "casual" },
  }),
  tc("MLT", "waterfront wine bar romantic", { tags: ["romantic", "waterfront", "scenic view"], intentTags: ["romantic", "waterfront", "scenic view"], intentCuisines: ["Italian", "French"] }, {
    subcategory: "feature+vibe+drinks",
    mockIntent: { emotional_intent: "impress" },
  }),
  tc("MLT", "outdoor patio beer garden lively", { cuisines: ["Brewery/Beer Bar"], tags: ["outdoor patio", "craft beer", "lively atmosphere"], intentCuisines: ["Brewery/Beer Bar"], intentTags: ["craft beer", "live music", "trendy"] }, {
    subcategory: "feature+vibe+drinks",
    mockIntent: { emotional_intent: "casual" },
  }),
  tc("MLT", "late night cocktails speakeasy", { cuisines: ["Cocktail Bar"], tags: ["late night", "craft cocktails"], intentTags: ["craft cocktails"] }, {
    subcategory: "feature+vibe+drinks",
    mockIntent: { emotional_intent: "explore", spontaneity: "spontaneous" },
  }),
  tc("MLT", "quiet wine bar hidden gem", { tags: ["quiet", "hidden gem"], intentTags: ["hidden gem", "romantic"], intentCuisines: ["Italian", "French"] }, {
    subcategory: "feature+vibe+drinks",
    mockIntent: { emotional_intent: "comfort" },
  }),
  tc("MLT", "live music jazz cocktails intimate", { tags: ["live music", "craft cocktails", "romantic"], intentTags: ["romantic", "quiet", "craft cocktails"] }, {
    subcategory: "feature+vibe+drinks",
    mockIntent: { emotional_intent: "impress" },
  }),
  tc("MLT", "BYOB outdoor patio romantic dinner", { tags: ["byob", "outdoor patio", "romantic"], intentTags: ["romantic", "scenic view"] }, {
    subcategory: "feature+vibe+drinks",
    mockIntent: { emotional_intent: "impress" },
  }),
  tc("MLT", "farm-to-table wine pairing quiet", { tags: ["farm-to-table", "quiet"], intentTags: ["farm-to-table", "romantic"], intentCuisines: ["Italian", "French"] }, {
    subcategory: "feature+vibe+drinks",
    mockIntent: { emotional_intent: "indulge" },
  }),
  // --- Full combo 3+ signals (6) ---
  tc("MLT", "romantic rooftop sushi for anniversary with view", { cuisines: ["Japanese"], tags: ["romantic", "rooftop", "scenic view"], intentTags: ["romantic", "scenic view", "rooftop"] }, {
    subcategory: "full-combo",
    occasion: "Special Occasion",
    mockIntent: { target_cuisines: ["Japanese"], cuisine_importance: "high", emotional_intent: "impress", date_type: "anniversary" },
  }),
  tc("MLT", "cheap late night tacos BYOB Pilsen", { cuisines: ["Mexican"], tags: ["late night", "byob", "great value"], intentTags: ["great value", "hidden gem"] }, {
    subcategory: "full-combo",
    mockIntent: { target_cuisines: ["Mexican"], cuisine_importance: "high", emotional_intent: "casual", practical_constraints: ["budget"], spontaneity: "spontaneous" },
  }),
  tc("MLT", "vegan gluten-free brunch outdoor patio trendy", { cuisines: ["Vegan", "Brunch"], tags: ["vegan friendly", "gluten free", "brunch spot", "outdoor patio", "trendy"], dietary: ["vegan", "gluten-free"], intentTags: ["vegan friendly", "gluten free", "trendy"] }, {
    subcategory: "full-combo",
    mockIntent: { cuisine_importance: "low", emotional_intent: "casual" },
  }),
  tc("MLT", "upscale French tasting menu wine pairing anniversary", { cuisines: ["French"], intentTags: ["romantic", "trendy", "scenic view"], intentCuisines: ["Italian"] }, {
    subcategory: "full-combo",
    occasion: "Special Occasion",
    mockIntent: { target_cuisines: ["French"], cuisine_importance: "high", emotional_intent: "impress", date_type: "anniversary" },
  }),
  tc("MLT", "hidden gem Ethiopian vegetarian BYOB quiet dinner", { cuisines: ["Ethiopian"], tags: ["hidden gem", "byob", "quiet"], dietary: ["vegetarian"], intentTags: ["hidden gem", "vegan friendly"] }, {
    subcategory: "full-combo",
    mockIntent: { target_cuisines: ["Ethiopian"], cuisine_importance: "high", emotional_intent: "explore" },
  }),
  tc("MLT", "lively Korean BBQ group birthday BYOB soju", { cuisines: ["Korean", "BBQ"], tags: ["lively atmosphere", "byob"], intentCuisines: ["BBQ", "Korean"], intentTags: ["live music", "trendy", "craft cocktails", "lively atmosphere"] }, {
    subcategory: "full-combo",
    occasion: "Special Occasion",
    mockIntent: { target_cuisines: ["Korean"], cuisine_importance: "high", emotional_intent: "celebrate", group_size_hint: "large_group" },
  }),
];

// ==========================================
// REP — REPUTATION-SPECIFIC (V8.6)
// ==========================================

const REP_TESTS: TestCase[] = [
  tc("REP", "best rated restaurant", { tags: ["reputation-focused"], intentTags: ["reputation-focused", "fine dining"] }),
  tc("REP", "michelin star restaurant", { tags: ["reputation-focused"], intentTags: ["reputation-focused", "romantic", "trendy", "fine dining"] }),
  tc("REP", "james beard winner", { tags: ["reputation-focused"], intentTags: ["reputation-focused", "trendy"] }),
  tc("REP", "highest rated place", { tags: ["reputation-focused"] }),
  tc("REP", "award-winning restaurant", { tags: ["reputation-focused"], intentTags: ["reputation-focused", "fine dining"] }),
  tc("REP", "top rated Chicago restaurant", { tags: ["reputation-focused"] }),
  tc("REP", "critically acclaimed dining", { tags: ["reputation-focused"], intentTags: ["reputation-focused", "fine dining"] }),
  tc("REP", "best reviewed brunch", { tags: ["reputation-focused", "brunch spot"] }),
  tc("REP", "most popular restaurant", { tags: ["reputation-focused"] }),
  tc("REP", "five star dining", { tags: ["reputation-focused", "fine dining"] }),
];

// ==========================================
// OPN — OPEN-ENDED QUERIES (V8.6)
// ==========================================

const OPN_TESTS: TestCase[] = [
  tc("OPN", "surprise me", {}),
  tc("OPN", "something good", {}),
  tc("OPN", "feed me", {}),
  tc("OPN", "dealer's choice", {}),
  tc("OPN", "I'm hungry", {}),
  tc("OPN", "anything works", {}),
  tc("OPN", "you pick", {}),
  tc("OPN", "chef's choice", { tags: ["fine dining"] }),
];

// ==========================================
// FLT — FILTER-SPECIFIC (V8.6)
// ==========================================

const FLT_TESTS: TestCase[] = [
  tc("FLT", "cheap Italian downtown", { cuisines: ["Italian"], tags: ["great value"] }),
  tc("FLT", "expensive sushi", { cuisines: ["Japanese"], intentCuisines: ["Japanese"] }),
  tc("FLT", "vegan near Logan Square", { dietary: ["vegan"] }),
  tc("FLT", "gluten free pizza", { cuisines: ["Italian"], dietary: ["gluten-free"], intentCuisines: ["Italian"] }),
  tc("FLT", "outdoor seating dog friendly", { tags: ["outdoor seating", "pet friendly"] }),
  tc("FLT", "BYOB Mexican Pilsen", { cuisines: ["Mexican"], tags: ["byob"] }),
  tc("FLT", "late night Korean fried chicken", { cuisines: ["Korean"], tags: ["late night"], intentCuisines: ["Korean", "American"] }),
  tc("FLT", "family friendly brunch with parking", { tags: ["brunch spot", "kid friendly"] }),
];

// ==========================================
// EXPORT COMBINED CATALOG
// ==========================================

export const TEST_CATALOG: TestCase[] = [
  ...CHI_TESTS,
  ...CUI_TESTS,
  ...DSH_TESTS,
  ...BAR_TESTS,
  ...OCC_TESTS,
  ...VIB_TESTS,
  ...NBH_TESTS,
  ...DIT_TESTS,
  ...FTR_TESTS,
  ...NLP_TESTS,
  ...MLT_TESTS,
  ...REP_TESTS,
  ...OPN_TESTS,
  ...FLT_TESTS,
];

// Category summary for reporting
export const CATEGORY_NAMES: Record<Category, string> = {
  CHI: "Chicago Iconic",
  CUI: "Cuisine-Specific",
  DSH: "Specific Dishes",
  BAR: "Bar & Drinks",
  OCC: "Occasion-Based",
  VIB: "Vibe/Ambiance",
  NBH: "Neighborhood + Food",
  DIT: "Dietary",
  FTR: "Feature-Based",
  NLP: "Natural Language",
  MLT: "Multi-Signal",
  REP: "Reputation-Specific",
  OPN: "Open-Ended",
  FLT: "Filter-Specific",
};
