import type {
  Restaurant,
  OccasionScores,
  Tag,
  Neighborhood,
  RestaurantProfile,
  DeepProfile,
  ScoringDimensions,
  DimensionWeights,
} from "./types.ts";
import type { GooglePlaceData } from "./google-places.ts";
import type { IntentClassification, IntentClassificationV2 } from "./intent-classifier.ts";

// --- Enhancement 2: Multi-score occasion weights ---
// Each occasion maps to a weighted blend of score columns
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

// Primary score column for RPC (backward compat) — used only for single-column lookup
const OCCASION_SCORE_MAP: Record<string, string> = {
  "Date Night": "date_friendly_score",
  "Group Hangout": "group_friendly_score",
  "Family Dinner": "family_friendly_score",
  "Business Lunch": "business_lunch_score",
  "Solo Dining": "solo_dining_score",
  "Special Occasion": "romantic_rating",
  "Treat Myself": "solo_dining_score",
  Adventure: "hole_in_wall_factor",
  "Chill Hangout": "group_friendly_score",
  Any: "total_score", // Enhancement 1: "Any" no longer biased to date_friendly
};

export function getScoreField(occasion: string): string {
  return OCCASION_SCORE_MAP[occasion] || "date_friendly_score";
}

// Enhancement 2: Compute weighted occasion score from multi-score blend
function computeWeightedOccasionScore(profile: RestaurantProfile, occasion: string): number {
  if (occasion === "Any") {
    return (sumAllScores(profile) / 70) * 10;
  }
  const weights = OCCASION_WEIGHTS[occasion];
  if (!weights) {
    const field = getScoreField(occasion);
    return (profile[field as keyof RestaurantProfile] as number) ?? 0;
  }
  let score = 0;
  for (const [field, weight] of Object.entries(weights)) {
    score += ((profile[field as keyof RestaurantProfile] as number) ?? 0) * weight;
  }
  return score;
}

// --- Keyword boosting ---

const CUISINE_KEYWORDS: Record<string, string[]> = {
  Mexican: ["mexican", "taco", "burrito", "carnitas", "enchilada", "mole"],
  Italian: ["italian", "pasta", "pizza", "risotto"],
  Japanese: ["japanese", "sushi", "ramen", "izakaya", "sake"],
  Thai: ["thai", "pad thai", "curry", "basil"],
  Chinese: ["chinese", "dim sum", "dumpling", "noodle"],
  Korean: ["korean", "bibimbap", "bbq", "kimchi"],
  Indian: ["indian", "curry", "tandoori", "naan", "masala"],
  French: ["french", "bistro", "crepe"],
  Seafood: ["seafood", "fish", "lobster", "oyster", "crab"],
  Steak: ["steak", "steakhouse", "filet"],
  Mediterranean: ["mediterranean", "mezze", "tabbouleh", "lamb"],
  Vietnamese: ["vietnamese", "pho", "banh mi"],
  Brunch: ["brunch", "pancake", "waffle", "mimosa"],
  American: ["burger", "american", "wings"],
  "Brewery/Beer Bar": ["beer", "craft beer", "brewery", "brewpub", "ale", "ipa", "lager", "stout", "tap room", "taproom"],
  Ethiopian: ["ethiopian", "injera", "tibs", "kitfo", "doro wat", "berbere"],
  Peruvian: ["peruvian", "ceviche", "lomo saltado", "anticucho", "causa"],
  Brazilian: ["brazilian", "churrasco", "feijoada", "picanha", "rodizio", "caipirinha"],
  Vegan: ["vegan", "plant-based", "plant based", "meatless"],
  "Cocktail Bar": ["cocktail bar", "speakeasy", "mixology", "cocktail lounge"],
  "Coffee/Cafe": ["coffee shop", "cafe", "espresso", "latte", "cappuccino"],
  Polish: ["polish", "pierogi", "kielbasa", "bigos", "golabki"],
  "Puerto Rican": ["puerto rican", "mofongo", "pernil", "tostones", "alcapurria", "arroz con gandules"],
  "Southern/Soul Food": ["soul food", "southern", "fried chicken", "collard greens", "cornbread", "gumbo", "jambalaya", "catfish"],
  "Middle Eastern": ["middle eastern", "shawarma", "kebab", "falafel", "hummus", "baba ganoush", "pita"],
  Greek: ["greek", "gyro", "souvlaki", "moussaka", "spanakopita", "tzatziki"],
  Fusion: ["fusion", "eclectic", "cross-cultural"],
  BBQ: ["bbq", "barbecue", "brisket", "ribs", "pulled pork", "smoked meat", "pitmaster"],
};

const TAG_KEYWORDS: Record<string, string[]> = {
  byob: ["byob", "bring your own"],
  rooftop: ["rooftop", "skyline"],
  "outdoor patio": ["outdoor", "patio", "al fresco"],
  "hidden gem": ["hidden gem", "hidden", "secret"],
  "late night": ["late night", "late", "after midnight"],
  "craft cocktails": ["cocktail", "mixology", "craft drinks"],
  "live music": ["live music", "jazz", "band"],
  "farm-to-table": ["farm to table", "organic", "local ingredients"],
  "scenic view": ["view", "scenic", "panoramic", "waterfront", "lakefront", "river view"],
  romantic: ["romantic", "intimate", "candlelit", "cozy date"],
  trendy: ["trendy", "hip", "instagram", "modern", "stylish"],
  quiet: ["quiet", "peaceful", "calm", "serene"],
  "great value": ["cheap", "affordable", "deal", "value", "budget"],
  "brunch spot": ["brunch", "breakfast", "morning"],
  waterfront: ["waterfront", "lakefront", "riverwalk", "lake view"],
  "vegan friendly": ["vegan", "plant-based", "plant based"],
  "gluten free": ["gluten free", "celiac", "gluten-free"],
  "lively atmosphere": ["bustling", "vibrant", "energetic", "buzzing", "lively", "happening", "high energy", "animated", "festive"],
  "craft beer": ["craft beer", "brewery", "beer garden", "tap room", "taproom", "ale house", "beer selection", "draft beer", "beer list"],
};

// --- Enhancement 4: Semantic intent expansion ---
// Maps natural-language intents to structured boost signals
interface IntentSignal {
  cuisines?: string[];
  tags?: string[];
  features?: (keyof RestaurantProfile)[];
}

const INTENT_MAP: Record<string, IntentSignal> = {
  // --- Cuisine cravings ---
  "spicy": { cuisines: ["Thai", "Indian", "Korean", "Mexican"] },
  "spice": { cuisines: ["Thai", "Indian", "Korean", "Mexican"] },
  "noodles": { cuisines: ["Japanese", "Vietnamese", "Thai", "Chinese"] },
  "raw": { cuisines: ["Japanese"], tags: ["farm-to-table"] },
  "grilled": { cuisines: ["Steak", "American"] },
  "bbq": { cuisines: ["BBQ", "Korean"] },
  "tapas": { cuisines: ["Mediterranean"], tags: ["trendy"] },
  "dim sum": { cuisines: ["Chinese"] },
  "omakase": { cuisines: ["Japanese"] },
  "comfort food": { cuisines: ["American"], tags: ["great value"] },
  "comfort": { cuisines: ["American"], tags: ["great value"] },
  "sandwich": { cuisines: ["American"], tags: ["great value"] },
  "salad": { tags: ["farm-to-table", "vegan friendly"] },
  "soup": { cuisines: ["Vietnamese", "Japanese"] },
  "dessert": { tags: ["trendy"] },
  "pastry": { tags: ["trendy"] },
  "coffee": { tags: ["brunch spot"] },
  "cafe": { tags: ["brunch spot", "quiet"] },
  "bakery": { tags: ["brunch spot"] },
  "poke": { cuisines: ["Japanese"], tags: ["farm-to-table"] },
  "fusion": { tags: ["trendy"] },

  // --- Cuisine types (expanded) ---
  "ethiopian": { cuisines: ["Ethiopian"] },
  "peruvian": { cuisines: ["Peruvian"] },
  "brazilian": { cuisines: ["Brazilian"] },
  "turkish": { cuisines: ["Middle Eastern"] },
  "lebanese": { cuisines: ["Middle Eastern"] },
  "middle eastern": { cuisines: ["Middle Eastern"] },
  "spanish": { cuisines: ["Mediterranean"], tags: ["trendy"] },
  "soul food": { cuisines: ["Southern/Soul Food"], tags: ["hidden gem"] },
  "cajun": { cuisines: ["Southern/Soul Food"] },
  "creole": { cuisines: ["Southern/Soul Food"] },

  // --- Flavor & preparation styles ---
  "smoky": { cuisines: ["Korean", "American", "Steak"] },
  "savory": { cuisines: ["American", "Italian"] },
  "crispy": { cuisines: ["Korean", "American"] },
  "fried": { cuisines: ["Korean", "American"] },
  "smoked": { cuisines: ["American", "Steak"] },
  "braised": { cuisines: ["French", "Italian"] },
  "wood fired": { cuisines: ["Italian"] },
  "charcoal": { cuisines: ["Steak", "Korean"] },
  "slow cooked": { cuisines: ["American", "Italian"] },
  "fresh": { tags: ["farm-to-table"] },

  // --- Ambiance & vibe (the gap that triggered this spot-check) ---
  "bustling": { tags: ["lively atmosphere", "trendy", "live music"] },
  "vibrant": { tags: ["lively atmosphere", "trendy", "live music"] },
  "energetic": { tags: ["lively atmosphere", "trendy", "live music"] },
  "buzzing": { tags: ["lively atmosphere", "trendy"] },
  "happening": { tags: ["trendy", "live music"] },
  "high energy": { tags: ["lively atmosphere", "trendy", "live music"] },
  "animated": { tags: ["lively atmosphere", "trendy"] },
  "festive": { tags: ["lively atmosphere", "trendy", "craft cocktails"] },
  "noisy": { tags: ["live music", "trendy"] },
  "hopping": { tags: ["lively atmosphere", "trendy"] },
  "loud": { tags: ["live music", "trendy"] },
  "lively": { tags: ["live music", "trendy"] },
  "fun": { tags: ["trendy", "live music"] },
  "mellow": { tags: ["quiet", "hidden gem"] },
  "relaxed": { tags: ["quiet", "hidden gem"] },
  "laid back": { tags: ["quiet", "hidden gem"] },
  "low key": { tags: ["quiet", "hidden gem"] },
  "tranquil": { tags: ["quiet", "romantic"] },
  "intimate": { tags: ["romantic", "quiet"] },
  "warm": { tags: ["romantic", "hidden gem"] },
  "inviting": { tags: ["hidden gem"] },
  "welcoming": { tags: ["hidden gem", "great value"] },
  "cozy": { tags: ["quiet", "hidden gem"] },
  "chill": { tags: ["quiet", "hidden gem"] },

  // --- Dining experience level ---
  "fine dining": { tags: ["romantic", "trendy"] },
  "white tablecloth": { tags: ["romantic"] },
  "tasting menu": { tags: ["romantic", "trendy"] },
  "prix fixe": { tags: ["romantic", "trendy"] },
  "casual dining": { tags: ["great value"] },
  "neighborhood spot": { tags: ["hidden gem", "great value"] },
  "hole in the wall": { tags: ["hidden gem", "great value"] },
  "dive": { tags: ["hidden gem", "great value"] },
  "fancy": { tags: ["trendy", "romantic"] },
  "upscale": { tags: ["trendy", "romantic"] },
  "elegant": { tags: ["romantic"] },

  // --- Occasion & social context ---
  "anniversary": { tags: ["romantic", "scenic view"] },
  "celebrate": { tags: ["romantic", "trendy"] },
  "birthday": { tags: ["trendy", "craft cocktails"] },
  "engagement": { tags: ["romantic", "scenic view"] },
  "proposal": { tags: ["romantic", "scenic view"] },
  "graduation": { tags: ["trendy", "craft cocktails"] },
  "reunion": { tags: ["trendy"] },
  "first date": { tags: ["romantic", "quiet"] },
  "double date": { tags: ["romantic", "trendy"] },
  "girls night": { tags: ["trendy", "craft cocktails"] },
  "guys night": { tags: ["craft cocktails", "live music"] },
  "work dinner": { tags: ["quiet"] },
  "team dinner": { tags: ["trendy"] },
  "client dinner": { tags: ["quiet", "romantic"] },
  "romantic": { tags: ["romantic", "scenic view"] },
  "quiet dinner": { tags: ["quiet", "romantic"] },
  "business": { tags: ["quiet"] },
  "meeting": { tags: ["quiet"] },
  "solo": { tags: ["quiet", "hidden gem"] },
  "kids": { tags: [] },
  "family": { tags: [] },
  "group": { tags: [] },
  "large party": { tags: [] },

  // --- Drinks ---
  "drinks": { tags: ["craft cocktails", "byob"] },
  "cocktails": { tags: ["craft cocktails"] },
  "wine": { tags: ["romantic"], cuisines: ["Italian", "French"] },
  "beer": { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer"] },
  "craft beer": { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer"] },
  "brewery": { cuisines: ["Brewery/Beer Bar"] },
  "brewpub": { cuisines: ["Brewery/Beer Bar"], tags: ["lively atmosphere"] },
  "tap room": { cuisines: ["Brewery/Beer Bar"] },
  "ipa": { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer"] },
  "ale": { cuisines: ["Brewery/Beer Bar"], tags: ["craft beer"] },
  "happy hour": { tags: ["craft cocktails", "great value"] },
  "after work": { tags: ["craft cocktails", "great value"] },

  // --- Meal & time context ---
  "lunch": { tags: ["great value"] },
  "dinner": { tags: [] },
  "supper": { tags: [] },
  "late night food": { tags: ["late night"] },
  "midnight": { tags: ["late night"] },
  "early bird": { tags: ["great value"] },

  // --- Price & value ---
  "quick": { tags: ["great value"] },
  "fast": { tags: ["great value"] },
  "cheap": { tags: ["great value", "hidden gem"] },
  "affordable": { tags: ["great value", "hidden gem"] },
  "healthy": { cuisines: ["Mediterranean"], tags: ["farm-to-table", "vegan friendly"] },

  // --- Discovery & character ---
  "unique": { tags: ["hidden gem"] },
  "authentic": { tags: ["hidden gem"] },
  "local": { tags: ["hidden gem"] },
  "touristy": { tags: ["trendy", "scenic view"] },
  "instagrammable": { tags: ["trendy", "rooftop", "scenic view"] },
  "photogenic": { tags: ["trendy", "scenic view"] },

  // --- Dietary ---
  "vegetarian": { tags: ["vegan friendly"] },
  "vegan": { tags: ["vegan friendly"] },
  "gluten": { tags: ["gluten free"] },
  "celiac": { tags: ["gluten free"] },
  "halal": { tags: [] },
  "kosher": { tags: [] },
  "allergy": { tags: [] },

  // --- Location & seating ---
  "waterfront": { tags: ["waterfront", "scenic view"], features: ["outdoor_seating"] },
  "lakefront": { tags: ["waterfront", "scenic view"], features: ["outdoor_seating"] },
  "rooftop": { tags: ["rooftop", "scenic view"] },
  "skyline": { tags: ["rooftop", "scenic view"] },
  "garden": { features: ["outdoor_seating"] },
  "terrace": { features: ["outdoor_seating"] },
  "outdoor dining": { features: ["outdoor_seating"] },
  "patio": { tags: ["outdoor patio"], features: ["outdoor_seating"] },
  "candlelit": { tags: ["romantic"] },
  "private dining": { tags: ["romantic", "quiet"] },
  "semi private": { tags: ["quiet"] },
  "bar seating": { tags: ["craft cocktails"] },

  // --- Dish-level food terms → cuisine mapping ---
  // Mexican
  "chilaquiles": { cuisines: ["Mexican"] },
  "birria": { cuisines: ["Mexican"] },
  "al pastor": { cuisines: ["Mexican"] },
  "pozole": { cuisines: ["Mexican"] },
  "elote": { cuisines: ["Mexican"] },
  "tamale": { cuisines: ["Mexican"] },
  "churro": { cuisines: ["Mexican"] },
  "sopapilla": { cuisines: ["Mexican"] },
  "carnitas": { cuisines: ["Mexican"] },
  "enchilada": { cuisines: ["Mexican"] },
  "quesadilla": { cuisines: ["Mexican"] },
  "mole": { cuisines: ["Mexican"] },

  // Japanese
  "tonkatsu": { cuisines: ["Japanese"] },
  "yakitori": { cuisines: ["Japanese"] },
  "udon": { cuisines: ["Japanese"] },
  "tempura": { cuisines: ["Japanese"] },
  "katsu": { cuisines: ["Japanese"] },
  "sashimi": { cuisines: ["Japanese"] },
  "gyoza": { cuisines: ["Japanese"] },
  "matcha": { cuisines: ["Japanese", "Coffee/Cafe"] },

  // Chinese
  "bao": { cuisines: ["Chinese"] },
  "hotpot": { cuisines: ["Chinese"] },
  "hot pot": { cuisines: ["Chinese"] },
  "peking duck": { cuisines: ["Chinese"] },
  "szechuan": { cuisines: ["Chinese"] },
  "sichuan": { cuisines: ["Chinese"] },
  "wonton": { cuisines: ["Chinese"] },
  "dan dan": { cuisines: ["Chinese"] },
  "kung pao": { cuisines: ["Chinese"] },
  "mapo tofu": { cuisines: ["Chinese"] },
  "char siu": { cuisines: ["Chinese"] },

  // Italian
  "gnocchi": { cuisines: ["Italian"] },
  "tiramisu": { cuisines: ["Italian"] },
  "osso buco": { cuisines: ["Italian"] },
  "bolognese": { cuisines: ["Italian"] },
  "carbonara": { cuisines: ["Italian"] },
  "focaccia": { cuisines: ["Italian"] },
  "bruschetta": { cuisines: ["Italian"] },
  "arancini": { cuisines: ["Italian"] },
  "prosciutto": { cuisines: ["Italian"] },
  "deep dish": { cuisines: ["Italian", "American"] },
  "margherita": { cuisines: ["Italian"] },

  // Indian
  "tikka masala": { cuisines: ["Indian"] },
  "biryani": { cuisines: ["Indian"] },
  "vindaloo": { cuisines: ["Indian"] },
  "samosa": { cuisines: ["Indian"] },
  "paneer": { cuisines: ["Indian"] },
  "dal": { cuisines: ["Indian"] },
  "naan": { cuisines: ["Indian"] },
  "tikka": { cuisines: ["Indian"] },
  "korma": { cuisines: ["Indian"] },
  "chana": { cuisines: ["Indian"] },
  "dosa": { cuisines: ["Indian"] },

  // Thai
  "green curry": { cuisines: ["Thai"] },
  "tom yum": { cuisines: ["Thai"] },
  "som tum": { cuisines: ["Thai"] },
  "papaya salad": { cuisines: ["Thai"] },
  "satay": { cuisines: ["Thai"] },
  "pad see ew": { cuisines: ["Thai"] },
  "larb": { cuisines: ["Thai"] },
  "mango sticky rice": { cuisines: ["Thai"] },

  // Korean
  "bulgogi": { cuisines: ["Korean"] },
  "japchae": { cuisines: ["Korean"] },
  "tteokbokki": { cuisines: ["Korean"] },
  "galbi": { cuisines: ["Korean"] },
  "banchan": { cuisines: ["Korean"] },
  "kimchi jjigae": { cuisines: ["Korean"] },
  "kbbq": { cuisines: ["Korean"] },
  "korean bbq": { cuisines: ["Korean"] },
  "soju": { cuisines: ["Korean"] },

  // Vietnamese
  "bun bo hue": { cuisines: ["Vietnamese"] },
  "spring rolls": { cuisines: ["Vietnamese"] },
  "com tam": { cuisines: ["Vietnamese"] },
  "vermicelli": { cuisines: ["Vietnamese"] },

  // French
  "tartare": { cuisines: ["French"] },
  "coq au vin": { cuisines: ["French"] },
  "bouillabaisse": { cuisines: ["French", "Seafood"] },
  "steak frites": { cuisines: ["French", "Steak"] },
  "souffle": { cuisines: ["French"] },
  "croissant": { cuisines: ["French", "Coffee/Cafe"] },
  "escargot": { cuisines: ["French"] },
  "ratatouille": { cuisines: ["French"] },

  // BBQ & Southern/Soul Food
  "burnt ends": { cuisines: ["BBQ"] },
  "smoked brisket": { cuisines: ["BBQ"] },
  "mac and cheese": { cuisines: ["Southern/Soul Food", "American"] },
  "po boy": { cuisines: ["Southern/Soul Food"] },
  "hush puppies": { cuisines: ["Southern/Soul Food"] },
  "crawfish": { cuisines: ["Southern/Soul Food", "Seafood"] },
  "grits": { cuisines: ["Southern/Soul Food", "Brunch"] },
  "collard greens": { cuisines: ["Southern/Soul Food"] },

  // Ethiopian
  "injera": { cuisines: ["Ethiopian"] },
  "doro wat": { cuisines: ["Ethiopian"] },
  "kitfo": { cuisines: ["Ethiopian"] },
  "tibs": { cuisines: ["Ethiopian"] },

  // Peruvian
  "ceviche": { cuisines: ["Peruvian", "Seafood"] },
  "lomo saltado": { cuisines: ["Peruvian"] },
  "anticucho": { cuisines: ["Peruvian"] },
  "causa": { cuisines: ["Peruvian"] },

  // Brazilian
  "churrasco": { cuisines: ["Brazilian", "Steak"] },
  "rodizio": { cuisines: ["Brazilian"] },
  "picanha": { cuisines: ["Brazilian", "Steak"] },
  "feijoada": { cuisines: ["Brazilian"] },
  "caipirinha": { cuisines: ["Brazilian"] },

  // Polish
  "pierogi": { cuisines: ["Polish"] },
  "kielbasa": { cuisines: ["Polish"] },
  "golabki": { cuisines: ["Polish"] },

  // Puerto Rican
  "mofongo": { cuisines: ["Puerto Rican"] },
  "pernil": { cuisines: ["Puerto Rican"] },
  "tostones": { cuisines: ["Puerto Rican"] },
  "alcapurria": { cuisines: ["Puerto Rican"] },
  "arroz con gandules": { cuisines: ["Puerto Rican"] },

  // Middle Eastern
  "shawarma": { cuisines: ["Middle Eastern"] },
  "kebab": { cuisines: ["Middle Eastern"] },
  "falafel": { cuisines: ["Middle Eastern"] },
  "hummus": { cuisines: ["Middle Eastern"] },
  "baba ganoush": { cuisines: ["Middle Eastern"] },
  "pita": { cuisines: ["Middle Eastern"] },
  "labneh": { cuisines: ["Middle Eastern"] },
  "fattoush": { cuisines: ["Middle Eastern"] },
  "kibbeh": { cuisines: ["Middle Eastern"] },

  // Greek
  "gyro": { cuisines: ["Greek"] },
  "souvlaki": { cuisines: ["Greek"] },
  "moussaka": { cuisines: ["Greek"] },
  "spanakopita": { cuisines: ["Greek"] },
  "baklava": { cuisines: ["Greek", "Middle Eastern"] },
  "tzatziki": { cuisines: ["Greek"] },
  "saganaki": { cuisines: ["Greek"] },

  // Coffee/Cafe
  "espresso": { cuisines: ["Coffee/Cafe"] },
  "latte": { cuisines: ["Coffee/Cafe"] },
  "cappuccino": { cuisines: ["Coffee/Cafe"] },
  "cortado": { cuisines: ["Coffee/Cafe"] },

  // Seafood additions
  "shrimp": { cuisines: ["Seafood"] },
  "calamari": { cuisines: ["Seafood", "Italian"] },
  "clam chowder": { cuisines: ["Seafood"] },
  "poke bowl": { cuisines: ["Japanese", "Seafood"] },

  // Steak additions
  "filet mignon": { cuisines: ["Steak"] },
  "ribeye": { cuisines: ["Steak"] },
  "wagyu": { cuisines: ["Steak", "Japanese"] },
  "porterhouse": { cuisines: ["Steak"] },
};

// --- Unmatched keyword extraction (for continuous learning) ---
// Identifies words in a user's special_request that don't match any known dictionary.
// Used to log gaps in INTENT_MAP/TAG_KEYWORDS for future enrichment.
const STOP_WORDS = new Set([
  "i", "a", "an", "the", "and", "or", "but", "for", "with", "in", "on", "at",
  "to", "of", "is", "it", "that", "this", "was", "are", "be", "has", "had",
  "want", "need", "looking", "find", "me", "my", "some", "good", "great", "best",
  "really", "very", "something", "place", "spot", "restaurant", "food", "eat",
  "dining", "somewhere", "chicago", "tonight", "today", "please", "like", "would",
  "could", "should", "can", "just", "also", "too", "not", "any", "all", "more",
]);

export function extractUnmatchedKeywords(specialRequest: string): string[] {
  if (!specialRequest || specialRequest.trim().length < 3) return [];

  const lower = specialRequest.toLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  if (words.length === 0) return [];

  // Collect all known keywords from all dictionaries
  const allKnown = new Set<string>();
  for (const keywords of Object.values(CUISINE_KEYWORDS)) {
    keywords.forEach((k) => allKnown.add(k));
  }
  for (const keywords of Object.values(TAG_KEYWORDS)) {
    keywords.forEach((k) => allKnown.add(k));
  }
  for (const key of Object.keys(INTENT_MAP)) {
    allKnown.add(key);
  }
  for (const key of Object.keys(DIETARY_KEYWORDS)) {
    allKnown.add(key);
  }

  // Check each word — is it matched by any dictionary?
  return words.filter((word) => {
    for (const known of allKnown) {
      if (known.includes(word) || word.includes(known)) return false;
    }
    return true;
  });
}

// --- Enhancement 5: Dietary keyword matching ---
const DIETARY_KEYWORDS: Record<string, string[]> = {
  "vegetarian": ["Vegetarian", "Veg"],
  "vegan": ["Vegan", "Plant-Based"],
  "gluten-free": ["Gluten-Free", "Gluten Free"],
  "gluten free": ["Gluten-Free", "Gluten Free"],
  "halal": ["Halal"],
  "kosher": ["Kosher"],
  "dairy-free": ["Dairy-Free", "Dairy Free"],
  "nut-free": ["Nut-Free", "Nut Free"],
  "keto": ["Keto", "Low-Carb"],
  "paleo": ["Paleo"],
};

// --- Enhancement 12: Time-of-day awareness ---
function getChicagoTimeContext(): string {
  const now = new Date();
  // Chicago is UTC-6 (CST) or UTC-5 (CDT)
  // Use a simple approximation — CDT from March to November
  const month = now.getUTCMonth(); // 0-indexed
  const isDST = month >= 2 && month <= 10; // March-November (approximate)
  const offsetHours = isDST ? 5 : 6;
  const chicagoHour = (now.getUTCHours() - offsetHours + 24) % 24;

  if (chicagoHour >= 6 && chicagoHour < 11) return "breakfast";
  if (chicagoHour >= 11 && chicagoHour < 15) return "lunch";
  if (chicagoHour >= 15 && chicagoHour < 21) return "dinner";
  return "late_night";
}

interface BoostedProfile extends RestaurantProfile {
  _boost: number;
}

// --- Enhancement 14: Rejection pattern analysis ---
export interface RejectionSignals {
  avoidCuisines: string[];
  avoidPriceLevels: string[];
}

export function analyzeRejections(
  excludedIds: string[],
  allProfiles: RestaurantProfile[]
): RejectionSignals {
  const signals: RejectionSignals = { avoidCuisines: [], avoidPriceLevels: [] };
  if (excludedIds.length < 2) return signals;

  const excluded = allProfiles.filter((p) => excludedIds.includes(p.id));
  if (excluded.length < 2) return signals;

  // Detect cuisine clustering
  const cuisineCounts = new Map<string, number>();
  for (const p of excluded) {
    if (p.cuisine_type) {
      cuisineCounts.set(p.cuisine_type, (cuisineCounts.get(p.cuisine_type) || 0) + 1);
    }
  }
  for (const [cuisine, count] of cuisineCounts) {
    if (count >= 2) signals.avoidCuisines.push(cuisine);
  }

  // Detect price level clustering
  const priceCounts = new Map<string, number>();
  for (const p of excluded) {
    if (p.price_level) {
      priceCounts.set(p.price_level, (priceCounts.get(p.price_level) || 0) + 1);
    }
  }
  for (const [price, count] of priceCounts) {
    if (count >= 2) signals.avoidPriceLevels.push(price);
  }

  return signals;
}

function computeBoost(
  profile: RestaurantProfile,
  specialRequest: string,
  rejectionSignals?: RejectionSignals,
  intent?: IntentClassification | null
): number {
  let boost = 0;

  // Enhancement 14: Rejection penalty
  if (rejectionSignals) {
    if (
      profile.cuisine_type &&
      rejectionSignals.avoidCuisines.includes(profile.cuisine_type)
    ) {
      boost -= 2.0;
    }
    if (
      profile.price_level &&
      rejectionSignals.avoidPriceLevels.includes(profile.price_level)
    ) {
      boost -= 1.0;
    }
  }

  if (!specialRequest || specialRequest.trim().length < 3) return boost;

  const lower = specialRequest.toLowerCase();

  // Cuisine match: +3
  for (const [cuisine, keywords] of Object.entries(CUISINE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      if (
        profile.cuisine_type &&
        profile.cuisine_type.toLowerCase() === cuisine.toLowerCase()
      ) {
        boost += 3;
      }
      break; // Only match first cuisine
    }
  }

  // Tag match: +1.5 per matching tag
  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      const tagMatch = profile.tags.some((t) =>
        t.toLowerCase().includes(tag.toLowerCase())
      );
      if (tagMatch) boost += 1.5;
    }
  }

  // Boolean feature match: +1.5 if user mentions a feature the restaurant has
  const featureBoosts: [string[], keyof RestaurantProfile][] = [
    [["outdoor", "patio", "outside", "al fresco", "terrace", "view", "lakefront", "waterfront"], "outdoor_seating"],
    [["live music", "jazz", "band"], "live_music"],
    [["pet", "dog"], "pet_friendly"],
  ];
  for (const [keywords, field] of featureBoosts) {
    if (keywords.some((kw) => lower.includes(kw))) {
      if (profile[field]) boost += 1.5;
    }
  }

  // Enhancement 4: Semantic intent expansion (+1.0 per intent-to-attribute match)
  for (const [intent, signals] of Object.entries(INTENT_MAP)) {
    if (!lower.includes(intent)) continue;

    // Intent cuisine match
    if (signals.cuisines && profile.cuisine_type) {
      if (signals.cuisines.some((c) => c.toLowerCase() === profile.cuisine_type!.toLowerCase())) {
        boost += 1.0;
      }
    }
    // Intent tag match
    if (signals.tags) {
      for (const targetTag of signals.tags) {
        if (profile.tags.some((t) => t.toLowerCase().includes(targetTag.toLowerCase()))) {
          boost += 0.5;
        }
      }
    }
    // Intent feature match
    if (signals.features) {
      for (const feature of signals.features) {
        if (profile[feature]) boost += 0.5;
      }
    }
  }

  // Enhancement 5: Dietary keyword matching (+2 per dietary match)
  if (profile.dietary_options && profile.dietary_options.length > 0) {
    for (const [keyword, dietaryValues] of Object.entries(DIETARY_KEYWORDS)) {
      if (lower.includes(keyword)) {
        const match = profile.dietary_options.some((opt) =>
          dietaryValues.some((dv) => opt.toLowerCase().includes(dv.toLowerCase()))
        );
        if (match) boost += 2.0;
      }
    }
  }

  // Enhancement 5: good_for array matching (+1.0 per match)
  if (profile.good_for && profile.good_for.length > 0) {
    const goodForKeywords: Record<string, string[]> = {
      "date": ["Dates", "Date Night", "Romantic"],
      "group": ["Groups", "Group Dining", "Large Parties"],
      "family": ["Families", "Family", "Kids"],
      "solo": ["Solo", "Solo Dining"],
      "business": ["Business", "Business Lunch", "Meetings"],
    };
    for (const [keyword, matches] of Object.entries(goodForKeywords)) {
      if (lower.includes(keyword)) {
        if (profile.good_for.some((gf) =>
          matches.some((m) => gf.toLowerCase().includes(m.toLowerCase()))
        )) {
          boost += 1.0;
        }
      }
    }
  }

  // Enhancement 12: Time-of-day boost (+1.5 match, -1.0 mismatch)
  if (profile.best_times && profile.best_times.length > 0) {
    const timeContext = getChicagoTimeContext();
    if (profile.best_times.includes(timeContext)) {
      boost += 1.5;
    } else if (
      profile.best_times.length <= 2 &&
      !profile.best_times.includes(timeContext)
    ) {
      // Only penalize narrow-focus restaurants (e.g., brunch-only at dinner)
      boost -= 1.0;
    }
  }

  // Intent classification boost (stronger than keyword matching)
  if (intent) {
    if (intent.target_cuisines.length > 0 && profile.cuisine_type) {
      const cuisineMatch = intent.target_cuisines.some(
        (c) => c.toLowerCase() === profile.cuisine_type!.toLowerCase()
      );
      if (cuisineMatch) {
        boost += intent.cuisine_importance === "high" ? 5 : 3;
      } else if (intent.cuisine_importance === "high") {
        boost -= 2; // Penalize non-matching when user clearly wants specific cuisine
      }
    }
    for (const targetTag of intent.target_tags) {
      if (profile.tags.some((t) => t.toLowerCase().includes(targetTag.toLowerCase()))) {
        boost += 1.5;
      }
    }
    for (const feature of intent.target_features) {
      if (profile[feature as keyof RestaurantProfile]) {
        boost += 1.5;
      }
    }
  }

  return boost;
}

// --- Donde Match: Deterministic weighted confidence percentage ---
// "We're X% confident this is your spot."
// Combines match relevance (70%) + quality signals (30%) into a single percentage.

export interface DondeMatchInputs {
  occasion: string;
  specialRequest: string;
  neighborhood: string;
  priceLevel: string;
  googleData: GooglePlaceData | null;
  claudeRelevance?: number;
  sentimentNegative?: number | null;
}

// Weights sum to 1.0
const W_OCCASION = 0.30;
const W_REQUEST = 0.30;
const W_GOOGLE = 0.15;
const W_VIBE = 0.15;
const W_FILTER = 0.10;

// Per-occasion ideal vibe expectations
interface VibeExpectation {
  noise: string[];
  lighting: string[];
  dressMin: string;
  outdoorBonus: boolean;
  liveMusicBonus: boolean;
}

const OCCASION_VIBE_MAP: Record<string, VibeExpectation> = {
  "Date Night": {
    noise: ["Quiet", "Moderate"],
    lighting: ["dim", "intimate", "warm", "candlelit", "romantic"],
    dressMin: "Smart Casual",
    outdoorBonus: true,
    liveMusicBonus: true,
  },
  "Group Hangout": {
    noise: ["Moderate", "Loud"],
    lighting: ["bright", "lively", "modern", "warm", "vibrant"],
    dressMin: "Casual",
    outdoorBonus: true,
    liveMusicBonus: true,
  },
  "Family Dinner": {
    noise: ["Quiet", "Moderate"],
    lighting: ["bright", "warm", "modern", "welcoming"],
    dressMin: "Casual",
    outdoorBonus: true,
    liveMusicBonus: false,
  },
  "Business Lunch": {
    noise: ["Quiet"],
    lighting: ["bright", "modern", "warm", "elegant"],
    dressMin: "Business Casual",
    outdoorBonus: false,
    liveMusicBonus: false,
  },
  "Solo Dining": {
    noise: ["Quiet", "Moderate"],
    lighting: ["warm", "cozy", "bright", "relaxed"],
    dressMin: "Casual",
    outdoorBonus: true,
    liveMusicBonus: false,
  },
  "Special Occasion": {
    noise: ["Quiet"],
    lighting: ["dim", "intimate", "elegant", "warm", "candlelit"],
    dressMin: "Smart Casual",
    outdoorBonus: true,
    liveMusicBonus: true,
  },
  "Treat Myself": {
    noise: ["Quiet", "Moderate"],
    lighting: ["warm", "cozy", "intimate", "elegant"],
    dressMin: "Casual",
    outdoorBonus: true,
    liveMusicBonus: false,
  },
  Adventure: {
    noise: ["Moderate", "Loud", "Quiet"],
    lighting: ["any"],
    dressMin: "Casual",
    outdoorBonus: true,
    liveMusicBonus: true,
  },
  "Chill Hangout": {
    noise: ["Moderate", "Quiet"],
    lighting: ["warm", "cozy", "dim", "relaxed"],
    dressMin: "Casual",
    outdoorBonus: true,
    liveMusicBonus: true,
  },
  Any: {
    noise: ["Quiet", "Moderate"],
    lighting: ["any"],
    dressMin: "Casual",
    outdoorBonus: false,
    liveMusicBonus: false,
  },
};

const DRESS_LEVELS: Record<string, number> = {
  Casual: 1,
  "Smart Casual": 2,
  "Business Casual": 3,
  Formal: 4,
};

function sumAllScores(profile: RestaurantProfile): number {
  return (
    (profile.date_friendly_score || 0) +
    (profile.group_friendly_score || 0) +
    (profile.family_friendly_score || 0) +
    (profile.romantic_rating || 0) +
    (profile.business_lunch_score || 0) +
    (profile.solo_dining_score || 0) +
    (profile.hole_in_wall_factor || 0)
  );
}

// Sub-score 1: Occasion Fit (0-10) — Enhanced with multi-score blending
function computeOccasionFit(
  profile: RestaurantProfile,
  occasion: string
): number {
  // Enhancement 2: Use weighted blend instead of single score
  return computeWeightedOccasionScore(profile, occasion);
}

// Sub-score 2: Request Relevance (0-10) — tiered
function computeKeywordRelevance(
  profile: RestaurantProfile,
  specialRequest: string
): number {
  if (!specialRequest || specialRequest.trim().length < 3) return 7.0;

  const lower = specialRequest.toLowerCase();
  let points = 0;
  const maxPoints = 16; // Increased from 12 to account for new signals

  // Cuisine match: worth 4 points
  for (const [cuisine, keywords] of Object.entries(CUISINE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      if (
        profile.cuisine_type &&
        profile.cuisine_type.toLowerCase() === cuisine.toLowerCase()
      ) {
        points += 4;
      }
      break;
    }
  }

  // Tag match: worth up to 3 points (1 per match, max 3)
  let tagHits = 0;
  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      if (
        profile.tags.some((t) =>
          t.toLowerCase().includes(tag.toLowerCase())
        )
      ) {
        tagHits++;
      }
    }
  }
  points += Math.min(3, tagHits);

  // best_for_oneliner word overlap: worth up to 3 points
  if (profile.best_for_oneliner) {
    const onelineWords = profile.best_for_oneliner.toLowerCase().split(/\s+/);
    const requestWords = lower
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const overlap = requestWords.filter((w) =>
      onelineWords.some((ow) => ow.includes(w))
    ).length;
    points += Math.min(3, overlap);
  }

  // Boolean feature match: worth up to 2 points
  const featureKeywords: [string[], keyof RestaurantProfile][] = [
    [["outdoor", "patio", "outside", "al fresco", "terrace", "view", "lakefront", "waterfront"], "outdoor_seating"],
    [["live music", "jazz", "band", "live band"], "live_music"],
    [["pet", "dog", "pet-friendly", "dog-friendly"], "pet_friendly"],
  ];
  for (const [keywords, field] of featureKeywords) {
    if (keywords.some((kw) => lower.includes(kw))) {
      if (profile[field]) points += 1;
    }
  }

  // Enhancement 5: Dietary match: worth up to 2 points
  if (profile.dietary_options && profile.dietary_options.length > 0) {
    for (const [keyword, dietaryValues] of Object.entries(DIETARY_KEYWORDS)) {
      if (lower.includes(keyword)) {
        const match = profile.dietary_options.some((opt) =>
          dietaryValues.some((dv) => opt.toLowerCase().includes(dv.toLowerCase()))
        );
        if (match) {
          points += 2;
          break; // Only count one dietary match
        }
      }
    }
  }

  // Enhancement 4: Intent expansion: worth up to 2 points
  let intentPoints = 0;
  for (const [intent, signals] of Object.entries(INTENT_MAP)) {
    if (!lower.includes(intent)) continue;
    if (signals.cuisines && profile.cuisine_type) {
      if (signals.cuisines.some((c) => c.toLowerCase() === profile.cuisine_type!.toLowerCase())) {
        intentPoints += 1;
      }
    }
    if (signals.tags) {
      for (const targetTag of signals.tags) {
        if (profile.tags.some((t) => t.toLowerCase().includes(targetTag.toLowerCase()))) {
          intentPoints += 0.5;
        }
      }
    }
  }
  points += Math.min(2, intentPoints);

  points = Math.min(maxPoints, points);
  return (points / maxPoints) * 10;
}

function computeRequestRelevance(
  profile: RestaurantProfile,
  specialRequest: string,
  claudeRelevance?: number
): number {
  if (claudeRelevance !== undefined && claudeRelevance !== null) {
    return claudeRelevance;
  }
  return computeKeywordRelevance(profile, specialRequest);
}

// Sub-score 3: Google Quality (0-10)
function computeGoogleQuality(googleData: GooglePlaceData | null): number {
  if (!googleData || googleData.google_rating === null) {
    return 6.5;
  }

  const rating = googleData.google_rating;
  const reviewCount = googleData.google_review_count || 0;

  // Stretch 1-5 rating to 0-10 (clusters at 3.5-4.8)
  const ratingNorm = Math.min(10, Math.max(0, (rating - 2.5) * 4));

  // Confidence multiplier: more reviews = more trustworthy
  const confidence =
    reviewCount >= 100 ? 1.0 : reviewCount >= 20 ? 0.9 : 0.8;

  return ratingNorm * confidence;
}

// Sentiment penalty: penalize donde_match when reviews are significantly negative.
// Only penalizes, never boosts — match is about fit, not quality.
// Returns 0 (no penalty) to -3 (severe negative sentiment).
function computeSentimentPenalty(sentimentNegative: number | null | undefined): number {
  if (sentimentNegative == null || sentimentNegative <= 15) return 0;
  // 15% negative = no penalty, 50%+ = max penalty of -3 on 0-10 scale (~12 pts on 60-99 scale)
  return -Math.min(3, ((sentimentNegative - 15) / 35) * 3);
}

// Sub-score 4: Vibe Alignment (0-10)
function computeVibeAlignment(
  profile: RestaurantProfile,
  occasion: string
): number {
  const expected = OCCASION_VIBE_MAP[occasion] || OCCASION_VIBE_MAP["Any"];
  let score = 0;
  const maxScore = 10;

  // Noise match (3 points)
  if (profile.noise_level) {
    if (expected.noise.includes(profile.noise_level)) {
      score += 3;
    } else {
      score += 1;
    }
  } else {
    score += 1.5;
  }

  // Lighting match (3 points)
  if (profile.lighting_ambiance && !expected.lighting.includes("any")) {
    const lightingLower = profile.lighting_ambiance.toLowerCase();
    const matches = expected.lighting.filter((kw) =>
      lightingLower.includes(kw)
    ).length;
    score += Math.min(3, matches * 1.5);
  } else {
    score += 1.5;
  }

  // Dress code appropriateness (2 points)
  if (profile.dress_code) {
    const restaurantLevel = DRESS_LEVELS[profile.dress_code] || 1;
    const expectedLevel = DRESS_LEVELS[expected.dressMin] || 1;
    if (restaurantLevel >= expectedLevel) {
      score += 2;
    } else {
      score += 1;
    }
  } else {
    score += 1;
  }

  // Bonus features (2 points)
  let bonusEarned = 0;
  let bonusAvailable = 0;
  if (expected.outdoorBonus) {
    bonusAvailable++;
    if (profile.outdoor_seating) bonusEarned++;
  }
  if (expected.liveMusicBonus) {
    bonusAvailable++;
    if (profile.live_music) bonusEarned++;
  }
  if (bonusAvailable > 0) {
    score += (bonusEarned / bonusAvailable) * 2;
  } else {
    score += 1;
  }

  return (score / maxScore) * 10;
}

// Sub-score 5: Filter Precision (0-10)
function computeFilterPrecision(
  profile: RestaurantProfile,
  requestedNeighborhood: string,
  requestedPrice: string
): number {
  let score = 10;
  let filtersApplied = 0;

  if (requestedNeighborhood && requestedNeighborhood !== "Anywhere") {
    filtersApplied++;
    if (
      profile.neighborhood_name.toLowerCase() !==
      requestedNeighborhood.toLowerCase()
    ) {
      score -= 5;
    }
  }

  if (requestedPrice && requestedPrice !== "Any") {
    filtersApplied++;
    if (profile.price_level !== requestedPrice) {
      score -= 5;
    }
  }

  if (filtersApplied === 0) return 8.0;

  return Math.max(0, score);
}

// Donde Match verdict tiers (for frontend display)
// 93-99%: "Perfect Match" (green)
// 85-92%: "Great Match" (green)
// 75-84%: "Good Match" (accent)
// 60-74%: "Worth Exploring" (accent)

export function computeDondeMatch(
  profile: RestaurantProfile,
  inputs: DondeMatchInputs
): number {
  const occasionFit = computeOccasionFit(profile, inputs.occasion);
  const requestRelevance = computeRequestRelevance(
    profile,
    inputs.specialRequest,
    inputs.claudeRelevance
  );
  const googleQuality = computeGoogleQuality(inputs.googleData);
  const vibeAlignment = computeVibeAlignment(profile, inputs.occasion);
  const filterPrecision = computeFilterPrecision(
    profile,
    inputs.neighborhood,
    inputs.priceLevel
  );

  let raw =
    W_OCCASION * occasionFit +
    W_REQUEST * requestRelevance +
    W_GOOGLE * googleQuality +
    W_VIBE * vibeAlignment +
    W_FILTER * filterPrecision;

  // Sentiment penalty: reduce match when reviews are significantly negative
  raw += computeSentimentPenalty(inputs.sentimentNegative);

  // Map 0-10 raw composite to 60-99% confidence range
  const matchPercent = 60 + Math.min(10, Math.max(0, raw)) * 3.9;
  return Math.min(99, Math.max(60, Math.round(matchPercent)));
}

// ==========================================
// V2 SCORING: Multi-dimensional ranking
// ==========================================

// --- V2 Dimension 1: Occasion Fit (enhanced with deep profile) ---

const SERVICE_FIT: Record<string, string[]> = {
  "Business Lunch": ["Full Table Service"],
  "Date Night": ["Full Table Service", "Omakase", "Tasting Menu", "Bar Service"],
  "Group Hangout": ["Full Table Service", "Family Style", "Fast Casual", "Bar Service"],
  "Family Dinner": ["Full Table Service", "Family Style"],
  "Solo Dining": ["Counter", "Bar Service", "Fast Casual", "Full Table Service"],
  "Special Occasion": ["Tasting Menu", "Omakase", "Full Table Service"],
  "Treat Myself": ["Full Table Service", "Omakase", "Tasting Menu", "Counter"],
  "Adventure": ["Counter", "Family Style", "Omakase", "Full Table Service"],
  "Chill Hangout": ["Full Table Service", "Bar Service", "Fast Casual"],
};

function computeOccasionFitV2(
  profile: RestaurantProfile,
  dp: DeepProfile | null,
  occasion: string
): number {
  let base = computeWeightedOccasionScore(profile, occasion);

  if (!dp) return Math.min(10, Math.max(0, base));

  // Service style alignment
  if (dp.service_style) {
    const fits = SERVICE_FIT[occasion] || [];
    if (fits.length > 0) {
      if (fits.includes(dp.service_style)) base += 0.5;
      else base -= 0.3;
    }
  }

  // Meal pacing alignment
  if (dp.meal_pacing) {
    const PACING_FIT: Record<string, string[]> = {
      "Business Lunch": ["quick_bite", "relaxed"],
      "Date Night": ["relaxed", "leisurely"],
      "Group Hangout": ["relaxed", "leisurely"],
      "Solo Dining": ["quick_bite", "relaxed"],
      "Special Occasion": ["leisurely", "ceremonial"],
      "Treat Myself": ["relaxed", "leisurely", "ceremonial"],
      "Adventure": ["quick_bite", "relaxed", "ceremonial"],
      "Family Dinner": ["relaxed"],
    };
    const fits = PACING_FIT[occasion] || [];
    if (fits.length > 0 && fits.includes(dp.meal_pacing)) base += 0.3;
  }

  // Conversation friendliness for talk-dependent occasions
  if (["Date Night", "Business Lunch", "Special Occasion"].includes(occasion)) {
    if (dp.conversation_friendliness != null) {
      base += (dp.conversation_friendliness - 5) * 0.1;
    }
  }

  // Kid friendliness for Family Dinner
  if (occasion === "Family Dinner" && dp.kid_friendliness != null) {
    base += (dp.kid_friendliness - 5) * 0.15;
  }

  return Math.min(10, Math.max(0, base));
}

// --- V2 Dimension 2: Craving Match (semantic, not just keyword) ---

const FLAVOR_KEYWORDS: Record<string, string[]> = {
  "smoky": ["smoky", "charred", "grilled", "wood-fired"],
  "spicy": ["bold-spiced", "chili-forward", "fiery"],
  "fresh": ["bright-acidic", "herbaceous", "citrus-forward", "light"],
  "rich": ["umami-forward", "rich-buttery", "creamy", "decadent"],
  "sweet": ["sweet-savory", "caramelized", "honey-glazed"],
  "tangy": ["fermented", "pickled", "vinegar-bright", "bright-acidic"],
  "earthy": ["earthy", "mushroom", "truffle", "root-vegetable"],
  "savory": ["umami-forward", "savory", "meaty"],
};

function extractFlavorIntent(specialRequest: string): string[] {
  const lower = specialRequest.toLowerCase();
  const matches: string[] = [];
  for (const [keyword, flavors] of Object.entries(FLAVOR_KEYWORDS)) {
    if (lower.includes(keyword)) {
      matches.push(...flavors);
    }
  }
  return [...new Set(matches)];
}

function computeCravingMatchV2(
  profile: RestaurantProfile,
  dp: DeepProfile | null,
  specialRequest: string,
  intent: IntentClassification | IntentClassificationV2 | null
): number {
  if (!specialRequest || specialRequest.trim().length < 3) return 7.0;

  let score = 0;
  let maxScore = 0;

  // Level 1: Cuisine match (0-4 points)
  maxScore += 4;
  if (intent?.target_cuisines && intent.target_cuisines.length > 0 && profile.cuisine_type) {
    const exactMatch = intent.target_cuisines.some(
      (c) => c.toLowerCase() === profile.cuisine_type!.toLowerCase()
    );
    if (exactMatch) {
      score += 4;
    } else if (dp?.cuisine_subcategory) {
      const subLower = dp.cuisine_subcategory.toLowerCase();
      if (intent.target_cuisines.some((c) => subLower.includes(c.toLowerCase()))) {
        score += 3;
      }
    }
  }

  // Level 2: Flavor profile match (0-3 points)
  maxScore += 3;
  if (dp?.flavor_profiles && dp.flavor_profiles.length > 0) {
    const flavorIntent = extractFlavorIntent(specialRequest);
    if (flavorIntent.length > 0) {
      const matches = flavorIntent.filter((f) =>
        dp.flavor_profiles!.some((fp) => fp.toLowerCase().includes(f.toLowerCase()))
      );
      score += Math.min(3, matches.length * 1.5);
    }
  }

  // Level 3: Spice level match (0-1 point)
  maxScore += 1;
  if (dp?.spice_level) {
    const lower = specialRequest.toLowerCase();
    if (lower.includes("spicy") || lower.includes("hot") || lower.includes("fiery")) {
      if (dp.spice_level === "hot" || dp.spice_level === "volcanic") score += 1;
    } else if (lower.includes("mild") || lower.includes("not spicy")) {
      if (dp.spice_level === "mild") score += 1;
    }
  }

  // Level 4: Signature dish match (0-2 points)
  maxScore += 2;
  if (dp?.signature_dishes && Array.isArray(dp.signature_dishes) && dp.signature_dishes.length > 0) {
    const requestLower = specialRequest.toLowerCase();
    const dishMatch = dp.signature_dishes.some((d) => {
      const dishWords = d.dish.toLowerCase().split(/\s+/);
      return dishWords.some((w) => w.length > 3 && requestLower.includes(w));
    });
    if (dishMatch) score += 2;
  }

  // Level 5: Tag + feature match (0-3 points) — existing logic, compacted
  maxScore += 3;
  const lower = specialRequest.toLowerCase();
  let tagHits = 0;
  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      if (profile.tags.some((t) => t.toLowerCase().includes(tag.toLowerCase()))) {
        tagHits++;
      }
    }
  }
  score += Math.min(3, tagHits);

  // Level 6: Dietary match (0-2 points) — enhanced with depth
  maxScore += 2;
  if (dp?.dietary_depth) {
    for (const keyword of Object.keys(DIETARY_KEYWORDS)) {
      if (lower.includes(keyword)) {
        if (dp.dietary_depth === "dedicated") score += 2;
        else if (dp.dietary_depth === "solid") score += 1.5;
        else if (dp.dietary_depth === "token") score += 0.5;
        break;
      }
    }
  } else if (profile.dietary_options && profile.dietary_options.length > 0) {
    for (const [keyword, dietaryValues] of Object.entries(DIETARY_KEYWORDS)) {
      if (lower.includes(keyword)) {
        const match = profile.dietary_options.some((opt) =>
          dietaryValues.some((dv) => opt.toLowerCase().includes(dv.toLowerCase()))
        );
        if (match) { score += 1.5; break; }
      }
    }
  }

  // Level 7: BYOB match (0-1 point) — Chicago-specific
  maxScore += 1;
  if (lower.includes("byob") && dp?.byob_policy === "full_byob") {
    score += 1;
  }

  return Math.min(10, (score / maxScore) * 10);
}

// --- V2 Dimension 3: Vibe Alignment (deep profile enhanced) ---

const OCCASION_ENERGY: Record<string, [number, number]> = {
  "Date Night": [4, 7],
  "Group Hangout": [6, 9],
  "Family Dinner": [3, 6],
  "Business Lunch": [2, 5],
  "Solo Dining": [2, 6],
  "Special Occasion": [4, 7],
  "Treat Myself": [3, 7],
  "Adventure": [4, 10],
  "Chill Hangout": [3, 6],
};

const MUSIC_FIT: Record<string, string[]> = {
  "Date Night": ["live-jazz", "curated-playlist", "ambient"],
  "Business Lunch": ["ambient", "no-music"],
  "Group Hangout": ["curated-playlist", "DJ", "live-jazz", "live-band"],
  "Family Dinner": ["ambient", "no-music", "curated-playlist"],
  "Solo Dining": ["curated-playlist", "ambient", "no-music"],
  "Special Occasion": ["live-jazz", "curated-playlist", "ambient"],
  "Chill Hangout": ["curated-playlist", "ambient", "live-jazz"],
  "Adventure": ["live-jazz", "live-band", "DJ", "curated-playlist"],
};

function computeVibeAlignmentV2(
  profile: RestaurantProfile,
  dp: DeepProfile | null,
  occasion: string,
  specialRequest: string
): number {
  // Start with the existing V1 vibe alignment as base
  let score = computeVibeAlignment(profile, occasion) / 2; // Scale to 0-5 base

  if (!dp) return Math.min(10, Math.max(0, score * 2));

  // Energy level match (0-2 points)
  if (dp.energy_level != null) {
    const [eMin, eMax] = OCCASION_ENERGY[occasion] || [3, 7];
    if (dp.energy_level >= eMin && dp.energy_level <= eMax) score += 2;
    else score -= Math.min(1.5, Math.abs(dp.energy_level - (eMin + eMax) / 2) * 0.3);
  }

  // Music vibe match (0-1 point)
  if (dp.music_vibe) {
    const fits = MUSIC_FIT[occasion] || [];
    if (fits.includes(dp.music_vibe)) score += 1;
  }

  // Aesthetic / Instagram match from request
  if (specialRequest) {
    const lower = specialRequest.toLowerCase();
    if ((lower.includes("instagram") || lower.includes("aesthetic") || lower.includes("cute") || lower.includes("photogenic"))) {
      if (dp.instagram_worthiness != null && dp.instagram_worthiness >= 7) score += 1;
    }
    if ((lower.includes("authentic") || lower.includes("real") || lower.includes("legit"))) {
      if (dp.cultural_authenticity != null && dp.cultural_authenticity >= 8) score += 1;
    }
    if ((lower.includes("fancy") || lower.includes("upscale") || lower.includes("elegant"))) {
      if (dp.decor_style && (dp.decor_style.includes("classic") || dp.decor_style.includes("elegant") || dp.decor_style.includes("white-tablecloth"))) {
        score += 1;
      }
    }
    if ((lower.includes("cozy") || lower.includes("intimate") || lower.includes("warm"))) {
      if (dp.decor_style && (dp.decor_style.includes("cozy") || dp.decor_style.includes("warm"))) {
        score += 0.5;
      }
    }
  }

  // Seasonal relevance
  const month = new Date().getUTCMonth();
  const season = month >= 2 && month <= 4 ? "spring" : month >= 5 && month <= 7 ? "summer" : month >= 8 && month <= 10 ? "fall" : "winter";
  if (dp.seasonal_relevance) {
    const seasonScore = (dp.seasonal_relevance as Record<string, number>)[season] || 5;
    score += (seasonScore - 5) * 0.2;
  }

  return Math.min(10, Math.max(0, score));
}

// --- V2 Dimension 4: Practical Fit ---

function computePracticalFit(
  profile: RestaurantProfile,
  dp: DeepProfile | null,
  occasion: string,
  specialRequest: string
): number {
  let score = 8; // assume practical until proven otherwise

  if (!dp) return score;

  const lower = (specialRequest || "").toLowerCase();

  // Reservation difficulty vs spontaneity
  if (dp.reservation_difficulty === "hard_to_get") {
    if (lower.match(/tonight|right now|last minute|walk.?in|spontaneous/)) {
      score -= 3;
    }
  } else if (dp.reservation_difficulty === "walk_in_friendly") {
    if (lower.match(/tonight|right now|walk.?in/)) {
      score += 1; // good match for spontaneous
    }
  }

  // Meal pacing vs occasion
  if (dp.meal_pacing === "ceremonial" && occasion === "Business Lunch") {
    score -= 2;
  }
  if (dp.meal_pacing === "quick_bite" && (occasion === "Special Occasion" || occasion === "Date Night")) {
    score -= 2;
  }
  if (dp.meal_pacing === "quick_bite" && lower.includes("quick")) {
    score += 1;
  }

  // Group size hints
  if (dp.group_size_sweet_spot) {
    const rangeMatch = dp.group_size_sweet_spot.match(/\[(\d+),(\d+)\)/);
    if (rangeMatch) {
      const [, minStr, maxStr] = rangeMatch;
      const min = parseInt(minStr, 10);
      const max = parseInt(maxStr, 10);
      if (lower.match(/large.?group|big.?group|party of \d{2}|10\+|12\+|15\+/) && max <= 6) {
        score -= 2;
      }
      if (occasion === "Solo Dining" && min > 2) {
        score -= 1;
      }
    }
  }

  // BYOB match
  if (dp.byob_policy === "full_byob" && lower.includes("byob")) {
    score += 1.5;
  }

  // Cash-only practical concern
  if (dp.payment_notes && dp.payment_notes.toLowerCase().includes("cash")) {
    score -= 0.5;
  }

  return Math.min(10, Math.max(0, score));
}

// --- V2 Dimension 5: Discovery Value ---

function computeDiscoveryValue(
  profile: RestaurantProfile,
  dp: DeepProfile | null,
  occasion: string
): number {
  let score = 5;

  if (!dp) return score;

  // Wow factors
  if (dp.wow_factors && dp.wow_factors.length > 0) {
    score += Math.min(2, dp.wow_factors.length * 0.7);
  }

  // Origin story adds narrative value
  if (dp.origin_story) score += 0.5;

  // Unique selling point
  if (dp.unique_selling_point) score += 1;

  // Hidden local gems for Adventure
  if (occasion === "Adventure" && dp.neighborhood_integration === "hidden_local") {
    score += 2;
  }

  // Destination restaurants for Special Occasion
  if (occasion === "Special Occasion" && dp.neighborhood_integration === "destination") {
    score += 1;
  }

  // Awards for Special Occasion
  if ((occasion === "Special Occasion" || occasion === "Treat Myself") &&
      dp.awards_recognition && dp.awards_recognition.length > 0) {
    score += 1.5;
  }

  // Cultural authenticity for Adventure
  if (occasion === "Adventure" && dp.cultural_authenticity != null && dp.cultural_authenticity >= 8) {
    score += 1;
  }

  // Chef notable for foodie occasions
  if (dp.chef_notable && (occasion === "Special Occasion" || occasion === "Treat Myself")) {
    score += 0.5;
  }

  return Math.min(10, Math.max(0, score));
}

// --- V2 Dynamic Weighting ---

export function computeDimensionWeights(
  occasion: string,
  intent: IntentClassification | IntentClassificationV2 | null
): DimensionWeights {
  // Base weights
  let w: DimensionWeights = { occasion: 0.25, craving: 0.25, vibe: 0.20, practical: 0.15, discovery: 0.15 };

  // If strong cuisine intent, craving dominates
  if (intent?.cuisine_importance === "high") {
    w = { occasion: 0.15, craving: 0.45, vibe: 0.15, practical: 0.15, discovery: 0.10 };
  } else if (intent?.cuisine_importance === "medium") {
    w = { occasion: 0.20, craving: 0.35, vibe: 0.20, practical: 0.15, discovery: 0.10 };
  }

  // If vibe-heavy occasion with no specific cuisine request
  if (["Date Night", "Special Occasion", "Business Lunch"].includes(occasion) &&
      (!intent || intent.cuisine_importance === "low")) {
    w = { occasion: 0.30, craving: 0.10, vibe: 0.30, practical: 0.15, discovery: 0.15 };
  }

  // Adventure mode: discovery is king
  if (occasion === "Adventure") {
    w = { occasion: 0.10, craving: 0.20, vibe: 0.15, practical: 0.15, discovery: 0.40 };
  }

  // Family Dinner: practical matters more
  if (occasion === "Family Dinner") {
    w = { occasion: 0.25, craving: 0.20, vibe: 0.15, practical: 0.25, discovery: 0.15 };
  }

  return w;
}

// --- V2 Composite Scoring ---

export function computeScoringDimensions(
  profile: RestaurantProfile,
  occasion: string,
  specialRequest: string,
  intent: IntentClassification | IntentClassificationV2 | null
): ScoringDimensions {
  const dp = profile.deep_profile || null;
  return {
    occasionFit: computeOccasionFitV2(profile, dp, occasion),
    cravingMatch: computeCravingMatchV2(profile, dp, specialRequest, intent),
    vibeAlignment: computeVibeAlignmentV2(profile, dp, occasion, specialRequest),
    practicalFit: computePracticalFit(profile, dp, occasion, specialRequest),
    discoveryValue: computeDiscoveryValue(profile, dp, occasion),
  };
}

export function computeCompositeV2(
  dimensions: ScoringDimensions,
  weights: DimensionWeights
): number {
  return (
    dimensions.occasionFit * weights.occasion +
    dimensions.cravingMatch * weights.craving +
    dimensions.vibeAlignment * weights.vibe +
    dimensions.practicalFit * weights.practical +
    dimensions.discoveryValue * weights.discovery
  );
}

// --- V2 Donde Match ---

export function computeDondeMatchV2(
  profile: RestaurantProfile,
  inputs: DondeMatchInputs,
  intent: IntentClassification | IntentClassificationV2 | null
): number {
  const dimensions = computeScoringDimensions(profile, inputs.occasion, inputs.specialRequest, intent);
  const weights = computeDimensionWeights(inputs.occasion, intent);
  let composite = computeCompositeV2(dimensions, weights);

  // Google quality bonus (keep existing)
  const googleQuality = computeGoogleQuality(inputs.googleData);
  composite = composite * 0.85 + googleQuality * 0.15;

  // Claude relevance override when available
  if (inputs.claudeRelevance != null) {
    composite = composite * 0.6 + inputs.claudeRelevance * 0.4;
  }

  // Sentiment penalty: reduce match when reviews are significantly negative
  composite += computeSentimentPenalty(inputs.sentimentNegative);

  // Map to 60-99 range
  return Math.min(99, Math.max(60, Math.round(60 + Math.min(10, Math.max(0, composite)) * 3.9)));
}

// --- V2 Re-rank using multi-dimensional scoring ---

export function reRankV2(
  profiles: RestaurantProfile[],
  occasion: string,
  specialRequest: string,
  rejectionSignals?: RejectionSignals,
  intent?: IntentClassification | IntentClassificationV2 | null
): RestaurantProfile[] {
  const weights = computeDimensionWeights(occasion, intent ?? null);

  const scored = profiles.map((p) => {
    const dimensions = computeScoringDimensions(p, occasion, specialRequest, intent ?? null);
    let composite = computeCompositeV2(dimensions, weights);

    // Trending signal
    const trending = (p.trending_score || 0) / 10;
    composite = composite * 0.92 + trending * 0.08;

    // Rejection penalty (keep existing logic)
    if (rejectionSignals) {
      if (p.cuisine_type && rejectionSignals.avoidCuisines.includes(p.cuisine_type)) {
        composite -= 2.0;
      }
      if (p.price_level && rejectionSignals.avoidPriceLevels.includes(p.price_level)) {
        composite -= 1.0;
      }
    }

    return { profile: p, composite, dimensions };
  });

  scored.sort((a, b) => b.composite - a.composite);
  return scored.map((s) => s.profile);
}

// --- Legacy merge (kept as fallback for when RPC fails) ---

export function mergeProfiles(
  restaurants: Restaurant[],
  allScores: OccasionScores[],
  allTags: Tag[],
  neighborhoods: Neighborhood[]
): RestaurantProfile[] {
  const neighborhoodMap: Record<string, { name: string; description: string | null }> = {};
  for (const n of neighborhoods) {
    neighborhoodMap[n.id] = { name: n.name, description: n.description || null };
  }

  const scoresMap: Record<string, OccasionScores> = {};
  for (const s of allScores) {
    scoresMap[s.restaurant_id] = s;
  }

  const tagsMap: Record<string, string[]> = {};
  const tagCategoriesMap: Record<string, string[]> = {};
  for (const t of allTags) {
    if (!tagsMap[t.restaurant_id]) tagsMap[t.restaurant_id] = [];
    if (!tagCategoriesMap[t.restaurant_id]) tagCategoriesMap[t.restaurant_id] = [];
    if (t.tag_text && t.tag_text !== "null") {
      tagsMap[t.restaurant_id].push(t.tag_text);
      if (t.tag_category) tagCategoriesMap[t.restaurant_id].push(t.tag_category);
    }
  }

  return restaurants.map((r) => {
    const scores = scoresMap[r.id] || ({} as Partial<OccasionScores>);
    const nbhood = neighborhoodMap[r.neighborhood_id || ""] || { name: "Unknown", description: null };
    const totalScore =
      (scores.date_friendly_score ?? 0) +
      (scores.group_friendly_score ?? 0) +
      (scores.family_friendly_score ?? 0) +
      (scores.romantic_rating ?? 0) +
      (scores.business_lunch_score ?? 0) +
      (scores.solo_dining_score ?? 0) +
      (scores.hole_in_wall_factor ?? 0);

    return {
      ...r,
      neighborhood_name: nbhood.name,
      neighborhood_description: nbhood.description,
      date_friendly_score: scores.date_friendly_score ?? null,
      group_friendly_score: scores.group_friendly_score ?? null,
      family_friendly_score: scores.family_friendly_score ?? null,
      romantic_rating: scores.romantic_rating ?? null,
      business_lunch_score: scores.business_lunch_score ?? null,
      solo_dining_score: scores.solo_dining_score ?? null,
      hole_in_wall_factor: scores.hole_in_wall_factor ?? null,
      tags: tagsMap[r.id] || [],
      tag_categories: tagCategoriesMap[r.id] || [],
      occasion_score: null,
      total_score: totalScore,
      trending_score: null,
      deep_profile: null, // Legacy path doesn't have deep profiles
    };
  });
}

// --- Filter, boost, and rank ---

export function filterAndRank(
  profiles: RestaurantProfile[],
  neighborhood: string,
  priceLevel: string,
  occasion: string,
  specialRequest = ""
): RestaurantProfile[] {
  let filtered = profiles;

  // Filter by neighborhood
  if (neighborhood && neighborhood !== "Anywhere") {
    filtered = filtered.filter(
      (p) => p.neighborhood_name.toLowerCase() === neighborhood.toLowerCase()
    );
  }

  // Filter by price level (with relaxation to adjacent tiers)
  if (priceLevel && priceLevel !== "Any") {
    const exactMatch = filtered.filter((p) => p.price_level === priceLevel);
    if (exactMatch.length > 0) {
      filtered = exactMatch;
    } else {
      const PRICE_ORDER = ["$", "$$", "$$$", "$$$$"];
      const idx = PRICE_ORDER.indexOf(priceLevel);
      const adjacent = [
        ...(idx > 0 ? [PRICE_ORDER[idx - 1]] : []),
        ...(idx < PRICE_ORDER.length - 1 ? [PRICE_ORDER[idx + 1]] : []),
      ];
      const relaxed = filtered.filter((p) => adjacent.includes(p.price_level));
      if (relaxed.length > 0) {
        filtered = relaxed;
      }
      // If still empty after relaxation, keep all prices as last resort
    }
  }

  // Filter: only restaurants with enrichment data (noise_level as proxy)
  filtered = filtered.filter((p) => p.noise_level != null);

  // Enhancement 20: Filter inactive restaurants
  filtered = filtered.filter((p) => p.is_active !== false);

  if (filtered.length === 0) return [];

  // Apply keyword boosts and weighted composite sort
  const boosted: BoostedProfile[] = filtered.map((p) => ({
    ...p,
    _boost: computeBoost(p, specialRequest),
  }));

  boosted.sort((a, b) => {
    // Enhancement 2: Use weighted occasion score
    const occasionA = computeWeightedOccasionScore(a, occasion);
    const occasionB = computeWeightedOccasionScore(b, occasion);

    const normalizedSumA = (sumAllScores(a) / 70) * 10;
    const normalizedSumB = (sumAllScores(b) / 70) * 10;

    const compositeA =
      occasionA * 0.6 + normalizedSumA * 0.2 + a._boost * 0.2;
    const compositeB =
      occasionB * 0.6 + normalizedSumB * 0.2 + b._boost * 0.2;

    return compositeB - compositeA;
  });

  return boosted.slice(0, 10);
}

// --- Re-rank RPC results with keyword boosts ---

export function reRankWithBoosts(
  profiles: RestaurantProfile[],
  occasion: string,
  specialRequest: string,
  rejectionSignals?: RejectionSignals,
  intent?: IntentClassification | null
): RestaurantProfile[] {
  const boosted: BoostedProfile[] = profiles.map((p) => ({
    ...p,
    _boost: computeBoost(p, specialRequest, rejectionSignals, intent),
  }));

  // Enhancement 11: Add trending score as minor tiebreaker (5% weight)
  const hasTrending = boosted.some((b) => b.trending_score && b.trending_score > 0);

  // Only re-sort if at least one restaurant got a non-zero boost or trending signal
  const anyBoosted = boosted.some((b) => b._boost !== 0);
  if (!anyBoosted && !hasTrending && (!specialRequest || specialRequest.trim().length < 3)) {
    return profiles;
  }

  boosted.sort((a, b) => {
    // Enhancement 2: Use weighted occasion score
    const occasionA = computeWeightedOccasionScore(a, occasion);
    const occasionB = computeWeightedOccasionScore(b, occasion);

    const trendA = (a.trending_score || 0) / 10; // Normalize to ~0-1
    const trendB = (b.trending_score || 0) / 10;

    // Adaptive weights: shift toward boost when user has strong food-specific intent
    let wOccasion = 0.55, wBoost = 0.35, wTrend = 0.10;
    if (intent?.cuisine_importance === "high") {
      wOccasion = 0.35; wBoost = 0.55; wTrend = 0.10;
    } else if (intent?.cuisine_importance === "medium") {
      wOccasion = 0.45; wBoost = 0.45; wTrend = 0.10;
    }

    const compositeA = occasionA * wOccasion + a._boost * wBoost + trendA * wTrend;
    const compositeB = occasionB * wOccasion + b._boost * wBoost + trendB * wTrend;

    return compositeB - compositeA;
  });

  return boosted;
}

// --- Enhancement 6: Diversity-aware candidate selection ---

export function ensureDiversity(
  top: RestaurantProfile[],
  backfillPool: RestaurantProfile[],
  maxPerCuisine = 3,
  maxPerNeighborhood = 4
): RestaurantProfile[] {
  if (top.length <= 5) return top; // Not enough to diversify

  const result: RestaurantProfile[] = [];
  const cuisineCount = new Map<string, number>();
  const neighborhoodCount = new Map<string, number>();
  const demoted: RestaurantProfile[] = [];

  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const cuisine = r.cuisine_type || "Unknown";
    const neighborhood = r.neighborhood_name || "Unknown";

    const cc = cuisineCount.get(cuisine) || 0;
    const nc = neighborhoodCount.get(neighborhood) || 0;

    // Preserve top 3 positions (their Google reviews are pre-fetched)
    if (i < 3 || (cc < maxPerCuisine && nc < maxPerNeighborhood)) {
      result.push(r);
      cuisineCount.set(cuisine, cc + 1);
      neighborhoodCount.set(neighborhood, nc + 1);
    } else {
      demoted.push(r);
    }
  }

  // Backfill with restaurants from the overflow pool that add diversity
  const resultIds = new Set(result.map((r) => r.id));
  const topIds = new Set(top.map((r) => r.id));
  const candidates = backfillPool.filter((r) => !resultIds.has(r.id) && !topIds.has(r.id));

  for (const r of candidates) {
    if (result.length >= 10) break;
    const cuisine = r.cuisine_type || "Unknown";
    const neighborhood = r.neighborhood_name || "Unknown";
    const cc = cuisineCount.get(cuisine) || 0;
    const nc = neighborhoodCount.get(neighborhood) || 0;
    if (cc < maxPerCuisine && nc < maxPerNeighborhood) {
      result.push(r);
      cuisineCount.set(cuisine, cc + 1);
      neighborhoodCount.set(neighborhood, nc + 1);
    }
  }

  // If still under 10, add demoted back
  for (const r of demoted) {
    if (result.length >= 10) break;
    result.push(r);
  }

  return result.slice(0, 10);
}

// --- Prompt building (split for prompt caching) ---

// Enhancement 10: Expanded system prompt with static reference data for better cache utilization
// V2: Voice modulation, cultural grounding, dynamic hooks, deep profile awareness
export function buildSystemPrompt(occasion?: string, priceLevel?: string): string {
  // Voice modulation directive — shifts personality based on context
  const voiceDirective = getVoiceDirective(occasion || "Any", priceLevel || "$$");

  return `You are Donde — a sharp, opinionated Chicago dining guide that sounds like a well-connected local friend, not a chatbot. Use "we" (Donde's voice). You know the city's food scene cold — the back kitchens, the owner stories, the dishes nobody orders but should.

TASK: Pick THE ONE BEST restaurant from the candidates for this user. Priority:
1. SPECIAL REQUEST match (cuisine, vibe, features) — highest priority
2. OCCASION FIT (noise, lighting, dress code match)
3. QUALITY (scores, reviews, trending)
4. DEEP PROFILE signals (service style, meal pacing, conversation friendliness, wow factors)

A 7/10 occasion score that nails "lakefront sushi" beats a 9/10 Italian spot indoors. Match the ASK, not the score.

OCCASION VIBE GUIDE:
- Date Night: Quiet/Moderate, dim/intimate, Smart Casual+
- Group Hangout: Moderate/Loud, bright/lively, Casual
- Family Dinner: Quiet/Moderate, bright/warm, Casual
- Business Lunch: Quiet, bright/modern, Business Casual+
- Solo Dining: Quiet/Moderate, warm/cozy, Casual
- Special Occasion: Quiet, dim/elegant, Smart Casual+
- Treat Myself: Quiet/Moderate, warm/cozy, Casual
- Adventure: Any vibe, Casual, hidden gems preferred
- Chill Hangout: Moderate/Quiet, warm/dim, Casual

${voiceDirective}

OPENING HOOKS — vary these every time. Never use the same opening pattern twice. Options:
- Lead with the FEELING: "When you're craving real-deal [cuisine]..." / "That [mood] you're after? We know a spot."
- Lead with the PLACE: "There's a [adjective] spot in [neighborhood] that..." / "In the thick of [neighborhood]..."
- Lead with the WHY: "For a [occasion] that actually [delivers/surprises/works]..."
- Lead with the INSIDER DETAIL: If deep profile has an origin_story, wow_factor, or signature_dish — lead with that. "The [specific detail] alone is worth the trip."
- Lead with the CONTRAST: "[Neighborhood] has [many/few] [cuisine] spots, but this one..."
- Lead with the ORIGIN: If the restaurant has an origin_story in its deep profile, weave it in: "This [neighborhood] spot was born out of..."
- Lead with CONFIDENCE: "We don't say this lightly, but..." / "If we had one pick for this exact ask..."

CULTURAL GROUNDING — match the culture to the cuisine:
- Mexican: Acknowledge regional distinctions when the data supports it (Oaxacan ≠ Tex-Mex ≠ Pueblan). Use correct terminology. Respect the complexity.
- Japanese: Respect the craft. Omakase = chef's trust. Izakaya = drinking food. Ramen = regional styles. Don't flatten it.
- Ethiopian: Communal eating on injera. This is meant to be shared. Acknowledge the tradition.
- Italian: Red-sauce joint ≠ northern Italian ≠ Neapolitan. If the data shows a subcategory, honor it.
- Korean: KBBQ is an experience, not just a meal. Banchan matters. Soju protocol exists.
- Indian: Regional matters — Punjabi, South Indian, Bengali are different planets. If we know, we say.
- Show cultural literacy without being performative. One precise detail > three generic ones.

WRITING RULES — THIS IS CRITICAL:

Voice:
- Write like The Infatuation crossed with a sharp, culturally literate friend. Confident, specific, human.
- Use "we" — "We love this spot for..." / "We'd send you here when..."
- Mix one short punchy sentence with one or two medium ones. No walls of text.
- Be opinionated: "The handmade pasta is the move" > "They offer a variety of options"
- Acknowledge trade-offs honestly when relevant: "It gets loud on weekends — that's the energy."
- If the restaurant has a deep profile, USE it. Origin stories, wow factors, signature dishes, best seat, and unique selling points make your rec feel like it came from a person, not a database.

Grounding (MANDATORY — violating this is the worst failure mode):
- ONLY reference facts from the candidate data: cuisine type, tags, noise level, lighting, dress code, features (outdoor/music/pet), best-for one-liner, dietary options, neighborhood character, AND any deep profile fields provided (signature dishes, origin story, wow factors, service style, etc.).
- If REVIEWS are provided: you may reference specific dishes, experiences, or sentiments that diners actually mentioned. Paraphrase, don't quote verbatim.
- If NO reviews are provided for the chosen restaurant: use deep profile data (signature dishes, origin story, etc.) if available. Otherwise describe the style and vibe using ONLY the metadata. Do NOT invent details.
- When in doubt, OMIT the detail. A shorter honest rec beats a longer fabricated one.

BANNED (never use these — they are AI slop):
"culinary" "gastronomic" "unforgettable" "unparalleled" "nestled" "boasts" "tantalizing" "mouthwatering" "delectable" "exquisite" "embark" "elevate your" "a testament to" "truly remarkable" "a must-visit" "not to be missed" "a cut above" "hidden gem" (as generic filler) "from the moment you" "whether you're looking for" "that will leave you" "perfect harmony" "burst of flavor" "culinary journey" "dining experience" "taste buds" "we'd send you to" (as an opening — vary it)

Structure:
- Do NOT open with the restaurant name as the first word. Vary your hooks.
- No rhetorical questions. No "This [cuisine] gem/haven/oasis."
- Never parrot the user's request back to them.
- The recommendation should feel like a text from a friend, not a Yelp listing.

OUTPUT FORMAT — respond ONLY in this exact JSON (no markdown, no backticks):
{
  "restaurant_index": 0,
  "recommendation": "50-80 word paragraph. Concise, grounded, opinionated. Explain WHY we picked this spot for THEIR specific request. Reference real attributes from the data. Use deep profile details when available.",
  "insider_tip": "One practical, grounded sentence. See rules below.",
  "relevance_score": 8.5,
  "sentiment_score": 7.5,
  "sentiment_positive": 80,
  "sentiment_negative": 10,
  "sentiment_neutral": 10,
  "sentiment_breakdown": "80% positive, 10% neutral, 10% negative",
  "sentiment_summary": "Diners rave about the handmade pasta and warm service. A few mention slow waits on weekends."
}

INSIDER TIP RULES (V2 — use the richest available data):
- PRIORITY 1: If deep profile has best_seat_in_house → USE IT. This is the highest-value tip. "Ask for the corner booth by the window."
- PRIORITY 2: If deep profile has signature_dishes → reference the standout. "The [dish] is what regulars come back for."
- PRIORITY 3: If reviews mention a specific dish, seating spot, or timing advice → use that.
- PRIORITY 4: If deep profile has wow_factors, byob_policy, or origin_story → weave practical + narrative. "It's BYOB — grab wine from the shop around the corner."
- PRIORITY 5: If no rich data, give practical advice from metadata — dress code, noise timing, features.
- Combine practical + insider when possible: "Sit at the chef's counter and order the [signature dish]."
- NEVER fabricate specific menu items, off-menu secrets, server names, or reservation hacks you can't verify from the data.
- Keep it to one sentence, under 25 words. Actionable > clever.

EXAMPLES OF GOOD OUTPUT:

Example 1 (with reviews + deep profile):
"recommendation": "There's a reason half of Logan Square ends up at this corner spot on any given Tuesday. The handmade rigatoni gets raved about in every review, and the candlelit room is dim enough for a real date but lively enough that it never feels precious. Italian comfort done with genuine craft — and the wine list punches way above its price point."
"insider_tip": "Grab the two-top by the front window — it's the most intimate seat in the house."

Example 2 (with deep profile, no reviews):
"recommendation": "In the thick of Pilsen, a third-generation Oaxacan family is doing mole the way it's meant to be done — rich, complex, and unapologetically traditional. It's a no-frills counter-service spot with moderate noise and zero pretense. Exactly the kind of place where the best dish costs $12 and haunts you for weeks."
"insider_tip": "Go for the mole negro — it's the recipe that's been in the family for three generations."

Example 3 (without reviews, minimal deep profile):
"recommendation": "For a group hangout with actual energy, this is the move. It's a lively Korean spot in Wicker Park with moderate noise and a casual dress code — the kind of place where you order too many small plates and nobody minds. BYOB keeps the bill friendly."
"insider_tip": "It's BYOB, so grab a six-pack from the shop next door before you walk in."

SCORING:
- relevance_score (0-10): How well this restaurant matches the user's specific request. 9-10 = nails every aspect. 7-8 = strong match, minor gaps. 5-6 = partial match. Below 5 = best available but weak fit.
- sentiment_score (0-10): Overall review sentiment. Only set if reviews are provided, otherwise null.
- sentiment_positive, sentiment_negative, sentiment_neutral: Integer percentages that MUST sum to 100. Classify each provided review by its star rating: 4-5 stars = positive, 1-2 stars = negative, 3 stars = neutral. Compute the percentage for each category. All three must be null if no reviews are provided.
- sentiment_breakdown: Format EXACTLY as "X% positive, Y% neutral, Z% negative" (e.g. "80% positive, 10% neutral, 10% negative"). null if no reviews.
- sentiment_summary: 1-2 sentences on what diners love and any common complaints from the provided reviews. null if no reviews.`;
}

// V2 Voice modulation — shifts personality based on occasion and restaurant character
function getVoiceDirective(occasion: string, priceLevel: string): string {
  if (occasion === "Adventure") {
    return `VOICE DIRECTIVE: Street-smart Chicago food explorer. You sound like you found this place by accident and now you can't stop going back. Casual, insider-y, slightly conspiratorial. Drop the formality. "This is the kind of place where..." / "Nobody talks about this spot, and honestly, good."`;
  }
  if (occasion === "Special Occasion" || priceLevel === "$$$$") {
    return `VOICE DIRECTIVE: Confident and warm with a touch of refinement — like a friend who happens to know wine and can get you a table. Not stuffy, never pretentious. "This is where you go when the night actually matters." / "We don't pull this card often, but..."`;
  }
  if (occasion === "Group Hangout") {
    return `VOICE DIRECTIVE: The friend who always picks the right dinner spot for the group. Energetic, practical, fun. "This is the place where everyone orders too much and nobody regrets it." / "Rally the crew."`;
  }
  if (occasion === "Business Lunch") {
    return `VOICE DIRECTIVE: Efficient, credible, no-frills. Sound like a colleague who knows the good spots near the office. "Quiet enough to talk, good enough to impress, fast enough to get back." / "This reads well on a corporate card."`;
  }
  if (occasion === "Solo Dining" || occasion === "Treat Myself") {
    return `VOICE DIRECTIVE: Gentle, knowing, like a friend who understands the art of eating alone well. No pity, just appreciation. "You deserve a seat at the bar, a great glass of something, and zero rush." / "Just you and a really good plate."`;
  }
  if (occasion === "Family Dinner") {
    return `VOICE DIRECTIVE: Warm and practical. Like a parent-friend who knows which restaurants actually work with kids. "This one passes the real test — adults enjoy it AND kids don't lose it."`;
  }
  if (occasion === "Chill Hangout") {
    return `VOICE DIRECTIVE: Low-key, easy, no pressure. "This is a no-agenda kind of spot." / "Show up whenever, stay as long as you want."`;
  }
  return `VOICE DIRECTIVE: Sharp, opinionated, warm. The Infatuation meets your most food-obsessed friend. Confident but never condescending. Cultural literacy across all cuisines.`;
}

// V2: Enhanced candidate format with deep profile data
export function buildUserPrompt(
  top10: RestaurantProfile[],
  occasion: string,
  priceLevel: string,
  neighborhood: string,
  specialRequest: string,
  reviewsByIndex?: Map<number, string>,
  neighborhoodDescription?: string | null,
  rejectionContext?: string
): string {
  const restaurantList = top10
    .map((d, i) => {
      const features = [
        d.outdoor_seating ? "Outdoor" : null,
        d.live_music ? "LiveMusic" : null,
        d.pet_friendly ? "PetFriendly" : null,
      ].filter(Boolean).join(",") || "—";

      const dietary = d.dietary_options?.length
        ? d.dietary_options.join(",")
        : "";

      const occasionScore = computeWeightedOccasionScore(d, occasion);
      const trending = d.trending_score ? ` T:${d.trending_score.toFixed(1)}` : "";

      let entry = `${i}. ${d.name} | ${d.neighborhood_name} | ${d.cuisine_type || "N/A"} | ${d.price_level} | ${occasion}:${occasionScore.toFixed(1)}/10${trending} | ${d.noise_level || "?"} noise, ${d.lighting_ambiance || "?"} | ${d.dress_code || "?"} | ${features}${dietary ? " | Diet:" + dietary : ""} | "${d.best_for_oneliner || "N/A"}" | Tags: ${d.tags.length > 0 ? d.tags.join(", ") : "—"}`;

      // V2: Append deep profile context (compact format to save tokens)
      const dp = d.deep_profile;
      if (dp) {
        const extras: string[] = [];
        if (dp.flavor_profiles?.length) extras.push(`Flavors: ${dp.flavor_profiles.join(", ")}`);
        if (dp.cuisine_subcategory) extras.push(`Sub: ${dp.cuisine_subcategory}`);
        if (dp.service_style) extras.push(`Service: ${dp.service_style}`);
        if (dp.meal_pacing) extras.push(`Pace: ${dp.meal_pacing}`);
        if (dp.music_vibe) extras.push(`Music: ${dp.music_vibe}`);
        if (dp.conversation_friendliness != null) extras.push(`Talk: ${dp.conversation_friendliness}/10`);
        if (dp.energy_level != null) extras.push(`Energy: ${dp.energy_level}/10`);
        if (dp.reservation_difficulty) extras.push(`Rez: ${dp.reservation_difficulty}`);
        if (dp.byob_policy && dp.byob_policy !== "full_bar" && dp.byob_policy !== "no_byob") extras.push(`BYOB: ${dp.byob_policy}`);
        if (dp.cultural_authenticity != null && dp.cultural_authenticity >= 7) extras.push(`Auth: ${dp.cultural_authenticity}/10`);
        if (dp.decor_style) extras.push(`Decor: ${dp.decor_style}`);
        if (dp.origin_story) extras.push(`Story: ${dp.origin_story}`);
        if (dp.signature_dishes && Array.isArray(dp.signature_dishes) && dp.signature_dishes.length > 0) {
          const dishes = dp.signature_dishes.slice(0, 3);
          extras.push(`Known for: ${dishes.map((sd) => sd.dish).join(", ")}`);
        }
        if (dp.wow_factors?.length) extras.push(`Wow: ${dp.wow_factors.join(", ")}`);
        if (dp.best_seat_in_house) extras.push(`Best seat: ${dp.best_seat_in_house}`);
        if (dp.unique_selling_point) extras.push(`USP: ${dp.unique_selling_point}`);
        if (dp.awards_recognition?.length) extras.push(`Awards: ${dp.awards_recognition.join(", ")}`);
        if (dp.crowd_profile?.length) extras.push(`Crowd: ${dp.crowd_profile.join(", ")}`);
        if (dp.seating_options?.length) extras.push(`Seating: ${dp.seating_options.join(", ")}`);
        if (dp.date_progression) extras.push(`Date type: ${dp.date_progression}`);
        if (dp.neighborhood_integration) extras.push(`Nbhd role: ${dp.neighborhood_integration}`);

        if (extras.length > 0) {
          entry += `\n  Deep profile: ${extras.join(" | ")}`;
        }
      }

      if (reviewsByIndex?.has(i)) {
        entry += `\n  Recent diner reviews (use these for grounding — you may reference dishes/experiences mentioned here):\n  ${reviewsByIndex.get(i)!.split("\n").join("\n  ")}`;
      } else {
        entry += `\n  [No reviews available — use deep profile and metadata above. Do NOT invent details not present in the data.]`;
      }

      return entry;
    })
    .join("\n\n");

  let prompt = `USER REQUEST:
- Occasion: ${occasion}
- Budget: ${priceLevel}
- Neighborhood: ${neighborhood}
- Special Request: ${specialRequest || "None"}`;

  // Enhancement 15: Neighborhood character context
  if (neighborhoodDescription && neighborhood !== "Anywhere") {
    prompt += `\n- Neighborhood Character: ${neighborhoodDescription}`;
  }

  // Enhancement 14: Rejection context
  if (rejectionContext) {
    prompt += `\n\n${rejectionContext}`;
  }

  prompt += `\n\nCANDIDATES (pick the best match — your recommendation MUST only reference facts from this data):

${restaurantList}

REMINDER: Write 50-80 words. Use "we." Ground every claim in the data above. If the chosen restaurant has a deep profile, leverage origin stories, signature dishes, wow factors, and best seat details to make the rec feel deeply personal. If no reviews AND no deep profile, stick to basic metadata — do not fabricate.`;

  return prompt;
}

// Legacy single-string prompt builder (kept for fallback compatibility)
export function buildPrompt(
  top10: RestaurantProfile[],
  occasion: string,
  priceLevel: string,
  neighborhood: string,
  specialRequest: string
): string {
  return buildSystemPrompt() + "\n\n" + buildUserPrompt(top10, occasion, priceLevel, neighborhood, specialRequest);
}
