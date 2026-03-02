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
export const OCCASION_WEIGHTS: Record<string, Record<string, number>> = {
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

export const CUISINE_KEYWORDS: Record<string, string[]> = {
  Mexican: ["mexican", "taco", "burrito", "carnitas", "enchilada", "mole", "elote", "pozole", "tamale", "churro", "sopapilla", "quesadilla", "birria", "chilaquiles", "al pastor", "nachos", "margarita", "tequila", "horchata", "agua fresca", "cochinita pibil", "suadero", "barbacoa", "carne asada", "huarache", "gordita", "sope", "tlayuda", "mezcal"],
  Italian: ["italian", "pasta", "pizza", "risotto", "carbonara", "lasagna", "ravioli", "parmigiana", "margherita", "giardiniera", "gnocchi", "tiramisu", "osso buco", "focaccia", "bruschetta", "arancini", "prosciutto", "cacio e pepe", "cannoli", "panna cotta", "cioppino", "panzanella", "crostini", "affogato", "limoncello", "caprese", "antipasto", "calzone", "flatbread", "gelato", "truffle pasta"],
  Japanese: ["japanese", "sushi", "ramen", "izakaya", "sake", "chirashi", "omakase", "tonkatsu", "yakitori", "udon", "tempura", "katsu", "sashimi", "gyoza", "matcha", "poke", "takoyaki", "okonomiyaki", "miso", "edamame", "katsudon", "tsukemen", "kakigori", "donburi", "onigiri", "natto", "shabu shabu", "sukiyaki", "teppanyaki", "hand rolls", "temaki", "hibachi", "japanese curry", "mochi", "mochi ice cream"],
  Thai: ["thai", "pad thai", "curry", "basil", "khao soi", "mango sticky rice", "som tum", "boat noodles", "larb", "massaman", "panang", "satay", "tom kha", "sticky rice", "pad see ew", "drunken noodles", "papaya salad"],
  Chinese: ["chinese", "dim sum", "dumpling", "noodle", "mapo tofu", "xiao long bao", "dan dan noodles", "char siu", "lo mein", "kung pao", "wonton", "congee", "scallion pancakes", "bubble tea", "boba", "chow mein", "hot pot", "peking duck", "fried rice", "egg drop soup", "soup dumplings"],
  Korean: ["korean", "bibimbap", "bbq", "kimchi", "bulgogi", "japchae", "tteokbokki", "galbi", "banchan", "budae jjigae", "soju", "bingsu", "dak galbi", "sundubu jjigae", "jajangmyeon", "kimbap", "chimaek", "corn dogs", "naengmyeon", "hoddeok", "mandu", "korean fried chicken"],
  Indian: ["indian", "curry", "tandoori", "naan", "masala", "biryani", "tikka", "samosa", "vindaloo", "idli", "dosa", "uttapam", "sambar", "rasam", "vada", "paneer", "dal", "chutney", "appam", "korma", "rogan josh", "butter chicken", "palak", "pongal", "upma", "chana masala", "chai", "lassi", "chaat", "pav bhaji", "chole", "paratha", "thali", "gulab jamun", "jalebi", "kulfi", "kheer", "raita", "panipuri", "bhel puri"],
  French: ["french", "bistro", "crepe", "coq au vin", "duck confit", "creme brulee", "bourguignon", "tartare", "souffle", "ratatouille", "escargot", "croissant", "croque monsieur", "fondue", "raclette", "macaron", "macarons"],
  Seafood: ["seafood", "fish", "lobster", "oyster", "crab", "shrimp", "scampi", "octopus", "clam chowder", "calamari", "lobster roll", "lobster bisque", "fish tacos"],
  Steak: ["steak", "steakhouse", "filet", "wagyu", "porterhouse", "ribeye", "filet mignon", "tomahawk", "surf and turf"],
  Mediterranean: ["mediterranean", "mezze", "tabbouleh", "lamb", "sangria", "tapas", "fattoush", "kibbeh", "borek", "halloumi", "shakshuka", "dolma", "labneh", "manakeesh"],
  Vietnamese: ["vietnamese", "pho", "banh mi", "bun bo hue", "spring rolls", "com tam", "vermicelli", "bo kho", "che", "goi cuon", "bun cha", "cao lau", "mi quang", "banh xeo"],
  Brunch: ["brunch", "pancake", "waffle", "mimosa"],
  American: ["burger", "american", "wings", "hot dog", "mac and cheese", "fried chicken", "cheesesteak", "lobster roll", "corn dog", "meatloaf", "pot pie", "biscuits and gravy", "club sandwich", "philly cheesesteak", "smash burger", "patty melt", "comfort food", "new american", "midwestern"],
  "Brewery/Beer Bar": ["beer", "craft beer", "brewery", "brewpub", "ale", "ipa", "lager", "stout", "tap room", "taproom", "pub", "pint", "old style"],
  Ethiopian: ["ethiopian", "injera", "tibs", "kitfo", "doro wat", "berbere", "misir wot", "shiro", "awaze", "sambusa", "yemisir wot", "gomen"],
  Peruvian: ["peruvian", "ceviche", "lomo saltado", "anticucho", "causa", "aji de gallina", "tiradito", "huancaina"],
  Brazilian: ["brazilian", "churrasco", "feijoada", "picanha", "rodizio", "caipirinha", "coxinha", "pao de queijo", "acai"],
  Vegan: ["vegan", "plant-based", "plant based", "meatless"],
  "Cocktail Bar": ["cocktail bar", "speakeasy", "mixology", "cocktail lounge", "cocktail", "mojito", "martini", "whiskey", "bourbon", "mezcal", "old fashioned", "aperol", "absinthe", "negroni"],
  "Coffee/Cafe": ["coffee shop", "cafe", "espresso", "latte", "cappuccino", "cortado", "chai latte", "cold brew", "pour over", "drip coffee", "matcha latte", "americano", "mocha", "flat white", "nitro cold brew", "juice bar", "kombucha", "afternoon tea"],
  "Caribbean/Jamaican": ["caribbean", "jamaican", "jerk chicken", "oxtail", "curry goat", "cuban", "ropa vieja", "cubano", "plantain", "rice and peas", "ackee", "saltfish", "patties"],
  Polish: ["polish", "pierogi", "kielbasa", "bigos", "golabki", "potato pancake"],
  "Puerto Rican": ["puerto rican", "mofongo", "pernil", "tostones", "alcapurria", "arroz con gandules", "jibarito", "pastelillo"],
  "Southern/Soul Food": ["soul food", "southern", "fried chicken", "collard greens", "cornbread", "gumbo", "jambalaya", "catfish", "cajun", "creole", "grits", "po boy", "hush puppies", "crawfish", "hot chicken", "nashville hot", "muffuletta"],
  "Middle Eastern": ["middle eastern", "shawarma", "kebab", "falafel", "hummus", "baba ganoush", "pita", "lebanese", "turkish", "manakeesh", "shakshuka", "fattoush", "labneh", "kibbeh"],
  Greek: ["greek", "gyro", "souvlaki", "moussaka", "spanakopita", "tzatziki", "saganaki", "baklava"],
  Fusion: ["fusion", "eclectic", "cross-cultural"],
  BBQ: ["bbq", "barbecue", "brisket", "ribs", "pulled pork", "smoked meat", "pitmaster", "burnt ends", "smoked", "tri-tip", "beef rib", "sausage", "hot links", "smoked chicken", "cornbread", "coleslaw"],
};

export const TAG_KEYWORDS: Record<string, string[]> = {
  byob: ["byob", "bring your own"],
  rooftop: ["rooftop", "skyline"],
  "outdoor patio": ["outdoor", "patio", "al fresco", "terrace", "sidewalk"],
  "hidden gem": ["hidden gem", "hidden", "secret"],
  "late night": ["late night", "late", "after midnight", "midnight", "24 hour"],
  "craft cocktails": ["cocktail", "mixology", "craft drinks", "martini", "whiskey", "bourbon", "mezcal", "old fashioned", "aperol", "absinthe", "espresso martini", "tequila", "mojito"],
  "live music": ["live music", "jazz", "band", "blues"],
  "farm-to-table": ["farm to table", "farm-to-table", "organic", "local ingredients"],
  "scenic view": ["view", "scenic", "panoramic", "waterfront", "lakefront", "river view"],
  romantic: ["romantic", "intimate", "candlelit", "cozy date"],
  trendy: ["trendy", "hip", "instagram", "modern", "stylish"],
  quiet: ["quiet", "peaceful", "calm", "serene"],
  "great value": ["cheap", "affordable", "deal", "value", "budget"],
  "brunch spot": ["brunch", "breakfast", "morning"],
  waterfront: ["waterfront", "lakefront", "riverwalk", "lake view", "river view"],
  "vegan friendly": ["vegan", "plant-based", "plant based"],
  "gluten free": ["gluten free", "celiac", "gluten-free"],
  "lively atmosphere": ["bustling", "vibrant", "energetic", "buzzing", "lively", "happening", "high energy", "animated", "festive", "sports bar", "karaoke", "nightlife", "pool hall"],
  "craft beer": ["craft beer", "brewery", "beer garden", "tap room", "taproom", "ale house", "beer selection", "draft beer", "beer list", "beer", "pub", "pint"],
  "date spot": ["date spot", "date night spot", "romantic dinner"],
  "instagrammable": ["instagrammable", "instagram worthy", "photogenic", "aesthetic"],
  "tasting menu": ["tasting menu", "prix fixe", "multi-course", "chef's table"],
  "fine dining": ["fine dining", "upscale", "high end", "white tablecloth"],
  "wine bar": ["wine bar", "wine list", "wine selection", "sommelier", "natural wine"],
  "happy hour": ["happy hour", "drink specials", "after work drinks"],
  "all you can eat": ["all you can eat", "unlimited", "ayce", "buffet"],
  "counter service": ["counter service", "fast casual", "order at counter", "quick service"],
  "food truck": ["food truck", "street food", "food stand", "food cart"],
  "kid friendly": ["kid friendly", "kids menu", "children", "family", "high chair"],
  "pet friendly": ["pet friendly", "dog friendly", "dogs allowed", "dog patio"],
  "private dining": ["private dining", "private room", "private event", "semi private"],
  "prix fixe": ["prix fixe", "multi-course", "tasting menu"],
  "outdoor seating": ["outdoor seating", "patio dining", "sidewalk cafe", "garden seating"],
  // V8.6: Reputation-focused tag — triggers Rule 13 weight shift for reputation-priority queries.
  // These keywords signal the user cares about quality/prestige, not a specific cuisine or vibe.
  "reputation-focused": ["best rated", "top rated", "highly rated", "award", "michelin", "james beard", "critically acclaimed", "best reviewed", "highest rated", "award-winning", "five star", "most popular"],
};

// --- Enhancement 4: Semantic intent expansion ---
// Maps natural-language intents to structured boost signals
export interface IntentSignal {
  cuisines?: string[];
  tags?: string[];
  features?: (keyof RestaurantProfile)[];
}

export const INTENT_MAP: Record<string, IntentSignal> = {
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
  "loud": { tags: ["lively atmosphere", "live music", "trendy"] },
  "lively": { tags: ["lively atmosphere", "live music", "trendy"] },
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
  "cocktail": { tags: ["craft cocktails"] },
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
  "breakfast": { tags: ["brunch spot"] },
  "hangover food": { cuisines: ["American", "Mexican"], tags: ["great value"] },
  "cheap eats": { tags: ["great value", "hidden gem"] },
  "fast casual": { tags: ["counter service", "great value"] },

  // --- Price & value ---
  "quick": { tags: ["great value"] },
  "fast": { tags: ["great value"] },
  "cheap": { tags: ["great value", "hidden gem"] },
  "affordable": { tags: ["great value", "hidden gem"] },
  "healthy": { cuisines: ["Vegan", "Mediterranean"], tags: ["farm-to-table", "vegan friendly"] },

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

  // --- Additional gap-fill entries ---
  "steakhouse": { cuisines: ["Steak"] },
  "hot dog": { cuisines: ["American"] },
  "jibarito": { cuisines: ["Puerto Rican"] },
  "giardiniera": { cuisines: ["Italian"] },
  "hidden gem": { tags: ["hidden gem"] },
  "date night": { tags: ["romantic"] },
  "budget": { tags: ["great value", "hidden gem"] },
  "small plates": { tags: ["trendy"] },
  "coffee": { cuisines: ["Coffee/Cafe"], tags: ["brunch spot"] },

  // --- Vibe & occasion intent entries ---
  "quiet": { tags: ["quiet"] },
  "trendy": { tags: ["trendy"] },
  "luxurious": { tags: ["trendy", "romantic"] },
  "impress": { tags: ["romantic", "trendy"] },
  "celebration": { tags: ["romantic", "trendy"] },
  "bachelorette": { tags: ["trendy", "craft cocktails"] },
  "special occasion": { tags: ["romantic"] },
  "treat myself": { tags: ["quiet", "hidden gem"] },
  "self care": { tags: ["quiet", "hidden gem"] },
  "alone": { tags: ["quiet", "hidden gem"] },
  "adventure": { tags: ["hidden gem"] },
  "adventurous": { tags: ["hidden gem"] },
  "explore": { tags: ["hidden gem"] },
  "something new": { tags: ["hidden gem"] },
  "corporate": { tags: ["quiet"] },
  "networking": { tags: ["quiet"] },
  "neighborhood": { tags: ["hidden gem", "great value"] },

  // --- Additional drink intent entries ---
  "champagne": { tags: ["romantic"] },
  "prosecco": { tags: ["romantic"] },
  "margarita": { cuisines: ["Mexican"], tags: ["craft cocktails"] },
  "tequila": { cuisines: ["Mexican"], tags: ["craft cocktails"] },
  "sangria": { cuisines: ["Mediterranean"], tags: ["craft cocktails"] },
  "mojito": { tags: ["craft cocktails"] },
  "bourbon": { tags: ["craft cocktails"] },
  "whiskey": { tags: ["craft cocktails"] },
  "mezcal": { tags: ["craft cocktails"] },
  "martini": { tags: ["craft cocktails"] },
  "absinthe": { tags: ["craft cocktails"] },
  "aperol": { tags: ["craft cocktails"] },

  // --- Feature/ambiance intent entries ---
  "farm-to-table": { tags: ["farm-to-table"] },
  "farm to table": { tags: ["farm-to-table"] },
  "live music": { tags: ["live music", "lively atmosphere"] },
  "river view": { tags: ["waterfront", "scenic view"] },
  "late night": { tags: ["late night"] },
  "instagram": { tags: ["trendy", "rooftop", "scenic view"] },
  "michelin": { tags: ["reputation-focused", "romantic", "trendy", "fine dining"] },
  "chef": { tags: ["trendy"] },
  "casual": { tags: ["great value"] },
  "kid friendly": { tags: ["kid friendly"] },
  "pet friendly": { features: ["pet_friendly"] },
  "walk-in": { tags: ["great value"] },
  "no reservation": { tags: ["great value"] },
  "quiet spot": { tags: ["quiet"] },
  "crowded": { tags: ["lively atmosphere"] },

  // --- Additional dish → cuisine entries ---
  "rogan josh": { cuisines: ["Indian"] },
  "idli": { cuisines: ["Indian"] },
  "vada": { cuisines: ["Indian"] },
  "pao de queijo": { cuisines: ["Brazilian"] },
  "banh mi": { cuisines: ["Vietnamese"] },
  "pastelillo": { cuisines: ["Puerto Rican"] },
  "huancaina": { cuisines: ["Peruvian"] },
  "surf and turf": { cuisines: ["Steak", "Seafood"] },
  "potato pancake": { cuisines: ["Polish"] },

  // --- Standalone food item → cuisine intents ---
  "sushi": { cuisines: ["Japanese"] },
  "tacos": { cuisines: ["Mexican"] },
  "pizza": { cuisines: ["Italian"] },
  "pasta": { cuisines: ["Italian"] },
  "burger": { cuisines: ["American"] },
  "steak": { cuisines: ["Steak"] },
  "seafood": { cuisines: ["Seafood"] },
  "ramen": { cuisines: ["Japanese"] },
  "brunch": { tags: ["brunch spot"] },
  "chai": { cuisines: ["Indian", "Coffee/Cafe"] },
  "boba": { cuisines: ["Chinese", "Coffee/Cafe"] },
  "bubble tea": { cuisines: ["Chinese", "Coffee/Cafe"] },
  "dumplings": { cuisines: ["Chinese", "Japanese"] },
  "wings": { cuisines: ["American"], tags: ["great value"] },
  "nachos": { cuisines: ["Mexican"] },
  "pho": { cuisines: ["Vietnamese"] },
  "curry": { cuisines: ["Indian", "Thai", "Japanese"] },

  // ============================================================
  // PHASE 2: Golden Dataset Coverage Expansion (~150 new entries)
  // ============================================================

  // --- Missing Cuisine-Type Intents ---
  "cuban": { cuisines: ["Caribbean/Jamaican"] },
  "cuban food": { cuisines: ["Caribbean/Jamaican"] },
  "jamaican": { cuisines: ["Caribbean/Jamaican"] },
  "jamaican food": { cuisines: ["Caribbean/Jamaican"] },
  "filipino": { cuisines: ["Filipino"] },
  "filipino food": { cuisines: ["Filipino"] },
  "taiwanese": { cuisines: ["Chinese"] },
  "taiwanese food": { cuisines: ["Chinese"] },
  "new american": { cuisines: ["American"], tags: ["trendy"] },
  "new american cuisine": { cuisines: ["American"], tags: ["trendy", "farm-to-table"] },
  "scandinavian": { cuisines: ["American"], tags: ["farm-to-table"] },
  "scandinavian food": { cuisines: ["American"], tags: ["farm-to-table"] },
  "midwestern": { cuisines: ["American"] },
  "midwestern cuisine": { cuisines: ["American"] },
  "south american": { cuisines: ["Peruvian", "Brazilian"] },
  "south american food": { cuisines: ["Peruvian", "Brazilian"] },
  "southern food": { cuisines: ["Southern/Soul Food"] },
  "caribbean": { cuisines: ["Caribbean/Jamaican"] },
  "caribbean food": { cuisines: ["Caribbean/Jamaican"] },

  // --- Missing Dish-to-Cuisine Mappings ---
  // Burgers & American
  "smash burger": { cuisines: ["American"] },
  "wagyu burger": { cuisines: ["American", "Steak"] },
  "patty melt": { cuisines: ["American"] },
  "hot chicken": { cuisines: ["American", "Southern/Soul Food"] },
  "nashville hot chicken": { cuisines: ["Southern/Soul Food"] },
  "lobster": { cuisines: ["Seafood"] },
  "lobster roll": { cuisines: ["Seafood"] },
  "lobster bisque": { cuisines: ["Seafood", "French"] },
  "fish tacos": { cuisines: ["Mexican", "Seafood"] },
  "shrimp tacos": { cuisines: ["Mexican", "Seafood"] },
  "cheesesteak": { cuisines: ["American"] },

  // Italian
  "cacio e pepe": { cuisines: ["Italian"] },
  "truffle pasta": { cuisines: ["Italian"] },
  "calzone": { cuisines: ["Italian"] },
  "flatbread": { cuisines: ["Italian"] },
  "gelato": { cuisines: ["Italian"] },
  "cannoli": { cuisines: ["Italian"] },
  "risotto": { cuisines: ["Italian"] },

  // Japanese
  "hand rolls": { cuisines: ["Japanese"] },
  "temaki": { cuisines: ["Japanese"] },
  "okonomiyaki": { cuisines: ["Japanese"] },
  "takoyaki": { cuisines: ["Japanese"] },
  "shabu shabu": { cuisines: ["Japanese"] },
  "sukiyaki": { cuisines: ["Japanese"] },
  "teppanyaki": { cuisines: ["Japanese"] },
  "hibachi": { cuisines: ["Japanese"] },
  "japanese curry": { cuisines: ["Japanese"] },
  "mochi": { cuisines: ["Japanese"] },
  "mochi ice cream": { cuisines: ["Japanese"] },

  // Chinese
  "soup dumplings": { cuisines: ["Chinese"] },
  "xiao long bao": { cuisines: ["Chinese"] },

  // Korean
  "korean fried chicken": { cuisines: ["Korean"] },

  // French
  "croque monsieur": { cuisines: ["French"] },
  "fondue": { cuisines: ["French"] },
  "raclette": { cuisines: ["French"] },
  "macaron": { cuisines: ["French"] },
  "macarons": { cuisines: ["French"] },

  // Caribbean
  "jerk chicken": { cuisines: ["Caribbean/Jamaican"] },
  "oxtail": { cuisines: ["Caribbean/Jamaican", "Southern/Soul Food"] },
  "curry goat": { cuisines: ["Caribbean/Jamaican"] },
  "ropa vieja": { cuisines: ["Caribbean/Jamaican"] },
  "cubano": { cuisines: ["Caribbean/Jamaican"] },
  "plantain": { cuisines: ["Caribbean/Jamaican", "Puerto Rican"] },

  // Pizza variants
  "deep dish pizza": { cuisines: ["Italian", "American"] },
  "chicago pizza": { cuisines: ["Italian", "American"] },
  "thin crust pizza": { cuisines: ["Italian"] },
  "neapolitan pizza": { cuisines: ["Italian"] },
  "stuffed pizza": { cuisines: ["Italian", "American"] },
  "gluten free pizza": { cuisines: ["Italian"], tags: ["gluten free"] },

  // New Orleans / Southern
  "muffuletta": { cuisines: ["Southern/Soul Food"] },
  "gumbo": { cuisines: ["Southern/Soul Food"] },

  // Misc food
  "charcuterie": { cuisines: ["French", "Italian"], tags: ["romantic"] },
  "charcuterie board": { cuisines: ["French", "Italian"], tags: ["romantic"] },
  "steak tartare": { cuisines: ["French", "Steak"] },
  "grain bowl": { tags: ["vegan friendly", "farm-to-table"] },
  "acai bowl": { cuisines: ["Brazilian"], tags: ["vegan friendly"] },
  "acai": { cuisines: ["Brazilian"], tags: ["vegan friendly"] },
  "wrap": { tags: ["great value"] },
  "sub sandwich": { cuisines: ["American"], tags: ["great value"] },
  "sandwich shop": { cuisines: ["American"], tags: ["great value"] },

  // --- Missing Drink/Beverage Intents ---
  "negroni": { cuisines: ["Italian"], tags: ["craft cocktails"] },
  "sake": { cuisines: ["Japanese"], tags: ["craft cocktails"] },
  "sake bar": { cuisines: ["Japanese"], tags: ["craft cocktails"] },
  "mezcal bar": { tags: ["craft cocktails"] },
  "mocktails": { tags: ["craft cocktails"] },
  "mocktail": { tags: ["craft cocktails"] },
  "cold brew": { cuisines: ["Coffee/Cafe"] },
  "cold brew coffee": { cuisines: ["Coffee/Cafe"] },
  "pour over": { cuisines: ["Coffee/Cafe"] },
  "pour over coffee": { cuisines: ["Coffee/Cafe"] },
  "juice bar": { tags: ["vegan friendly", "farm-to-table"] },
  "smoothie": { tags: ["vegan friendly"] },
  "smoothies": { tags: ["vegan friendly"] },
  "kombucha": { tags: ["vegan friendly", "farm-to-table"] },
  "afternoon tea": { cuisines: ["Coffee/Cafe"], tags: ["quiet"] },
  "natural wine": { tags: ["romantic", "trendy"] },
  "natural wine bar": { tags: ["romantic", "trendy"] },
  "wine bar": { tags: ["romantic", "craft cocktails"] },
  "espresso martini": { tags: ["craft cocktails", "trendy"] },

  // --- Missing Dessert Intents ---
  "cheesecake": { cuisines: ["American"] },
  "tres leches": { cuisines: ["Mexican"] },
  "donut": { cuisines: ["American", "Coffee/Cafe"] },
  "donuts": { cuisines: ["American", "Coffee/Cafe"] },
  "matcha desserts": { cuisines: ["Japanese"] },
  "bread bakery": { cuisines: ["Coffee/Cafe"] },
  "ice cream": { tags: ["great value"] },
  "ice cream shop": { tags: ["great value"] },

  // --- Missing Vibe/Occasion Intents ---
  "speakeasy": { tags: ["craft cocktails", "hidden gem"] },
  "dive bar": { tags: ["great value", "hidden gem"] },
  "jazz bar": { tags: ["live music", "craft cocktails"] },
  "jazz": { tags: ["live music"] },
  "blues bar": { tags: ["live music"] },
  "blues": { tags: ["live music"] },
  "karaoke": { tags: ["lively atmosphere"] },
  "karaoke bar": { tags: ["lively atmosphere"] },
  "trivia night": { tags: ["lively atmosphere"] },
  "sports bar": { tags: ["lively atmosphere", "great value"] },
  "arcade bar": { tags: ["lively atmosphere"] },
  "tiki bar": { tags: ["craft cocktails", "lively atmosphere"] },
  "piano bar": { tags: ["live music", "romantic"] },
  "comedy club": { tags: ["lively atmosphere"] },
  "wine cellar": { tags: ["romantic", "quiet"] },
  "bottomless brunch": { tags: ["brunch spot", "lively atmosphere", "great value"] },
  "rooftop brunch": { tags: ["rooftop", "brunch spot", "scenic view"] },
  "drag brunch": { tags: ["brunch spot", "lively atmosphere"] },
  "sunday funday": { tags: ["brunch spot", "great value"] },
  "power lunch": { tags: ["quiet"] },
  "working lunch": { tags: ["quiet"] },
  "people watching": { tags: ["outdoor patio"] },
  "nightlife": { tags: ["lively atmosphere", "craft cocktails", "late night"] },
  "nightlife hotspot": { tags: ["lively atmosphere", "craft cocktails", "late night"] },
  "hipster": { tags: ["hidden gem", "trendy"] },
  "hipster restaurant": { tags: ["hidden gem", "trendy"] },
  "chicago institution": { tags: ["hidden gem"] },
  "food hall": { tags: ["great value", "lively atmosphere"] },
  "food truck": { tags: ["great value", "hidden gem"] },
  "street food": { tags: ["great value", "hidden gem"] },
  "chef's table": { tags: ["trendy", "romantic"] },
  "chefs table": { tags: ["trendy", "romantic"] },
  "open kitchen": { tags: ["trendy"] },
  "communal table": { tags: ["lively atmosphere"] },
  "greenhouse": { tags: ["romantic"], features: ["outdoor_seating"] },
  "greenhouse dining": { tags: ["romantic"], features: ["outdoor_seating"] },
  "dark moody": { tags: ["romantic", "craft cocktails"] },
  "industrial chic": { tags: ["trendy"] },
  "counter seating": { tags: ["quiet", "hidden gem"] },
  "board game cafe": { tags: ["lively atmosphere"] },
  "pool hall": { tags: ["great value"] },
  "neon bar": { tags: ["lively atmosphere", "trendy"] },
  "library bar": { tags: ["quiet", "craft cocktails"] },
  "hotel bar": { tags: ["craft cocktails", "quiet"] },
  "rooftop bar": { tags: ["rooftop", "scenic view", "craft cocktails"] },
  "patio dining": { tags: ["outdoor patio"], features: ["outdoor_seating"] },
  "cozy date": { tags: ["romantic", "quiet"] },
  "cozy date night": { tags: ["romantic", "quiet"] },

  // --- Missing Service/Feature Intents ---
  "walk in": { tags: ["great value"] },
  "walk in friendly": { tags: ["great value"] },
  "group of 10": { tags: [] },
  "party of 20": { tags: [] },
  "delivery": { tags: [] },
  "takeout": { tags: ["great value"] },
  "curbside pickup": { tags: [] },
  "valet": { tags: [] },
  "valet parking": { tags: [] },
  "family style": { tags: [] },
  "small plates": { tags: ["trendy"] },
  "byob": { tags: ["byob", "great value"] },
  "byob restaurant": { tags: ["byob", "great value"] },
  "dog friendly": { features: ["pet_friendly"], tags: ["outdoor patio"] },
  "dog friendly restaurant": { features: ["pet_friendly"], tags: ["outdoor patio"] },
  "wheelchair accessible": { tags: [] },
  "outdoor seating": { features: ["outdoor_seating"], tags: ["outdoor patio"] },
  "outdoor dining": { features: ["outdoor_seating"], tags: ["outdoor patio"] },
  "private dining room": { tags: ["romantic", "quiet"] },

  // --- Reputation-based intents ---
  // V8.6: Added "reputation-focused" tag to trigger Rule 13 weight shift.
  "michelin star": { tags: ["reputation-focused", "romantic", "trendy", "fine dining"] },
  "michelin star restaurant": { tags: ["reputation-focused", "romantic", "trendy", "fine dining"] },
  "michelin two star": { tags: ["reputation-focused", "romantic", "trendy", "fine dining"] },
  "james beard": { tags: ["reputation-focused", "trendy"] },
  "james beard winner": { tags: ["reputation-focused", "trendy"] },
  "eater heatmap": { tags: ["trendy", "hidden gem"] },
  "best of chicago": { tags: ["reputation-focused", "trendy"] },
  // V8.6: New reputation-specific entries
  "best rated": { tags: ["reputation-focused", "fine dining"] },
  "top rated": { tags: ["reputation-focused"] },
  "highly rated": { tags: ["reputation-focused"] },
  "best reviewed": { tags: ["reputation-focused"] },
  "award winning": { tags: ["reputation-focused", "fine dining"] },
  "award-winning": { tags: ["reputation-focused", "fine dining"] },
  "critically acclaimed": { tags: ["reputation-focused", "fine dining"] },
  "highest rated": { tags: ["reputation-focused"] },
  "best restaurant": { tags: ["reputation-focused"] },
  "five star": { tags: ["reputation-focused", "fine dining"] },
  "most popular": { tags: ["reputation-focused"] },

  // --- Convenience/location intents ---
  "near me": { tags: [] },
  "late night food": { tags: ["late night"] },
  "late night eats": { tags: ["late night"] },
  "open late": { tags: ["late night"] },
  "open now": { tags: [] },
  "24 hour": { tags: ["late night"] },
  "24 hour restaurant": { tags: ["late night"] },
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
export const DIETARY_KEYWORDS: Record<string, string[]> = {
  "vegetarian": ["Vegetarian", "Veg"],
  "vegan": ["Vegan", "Plant-Based"],
  "gluten-free": ["Gluten-Free", "Gluten Free"],
  "gluten free": ["Gluten-Free", "Gluten Free"],
  "halal": ["Halal"],
  "kosher": ["Kosher"],
  "dairy-free": ["Dairy-Free", "Dairy Free"],
  "nut-free": ["Nut-Free", "Nut Free"],
  "keto": ["Keto", "Low-Carb"],
  "low carb": ["Keto", "Low-Carb"],
  "dairy free": ["Dairy-Free", "Dairy Free"],
  "nut free": ["Nut-Free", "Nut Free"],
  "veggie": ["Vegetarian", "Veg"],
  "paleo": ["Paleo"],
};

// Dietary hierarchy: stricter diets subsume less strict ones
// Vegan ⊃ Vegetarian (every vegan dish is vegetarian, but not vice versa)
export const DIETARY_HIERARCHY: Record<string, string[]> = {
  "vegan": ["vegetarian"], // Vegan user gets partial credit for Vegetarian-only restaurant
};

// Dietary depth bonus multipliers for dedicated restaurants
// Behavioral psychology: finding a restaurant that fully caters to your restriction
// creates relief/delight. Dedicated > solid > token.
const DIETARY_DEPTH_BONUS: Record<string, number> = {
  "dedicated": 2.0,   // Purely vegan/GF restaurant → max bonus
  "solid": 1.0,       // Strong menu coverage → moderate bonus
  "token": 0.0,       // One or two options → no bonus (just meeting minimum)
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
  // Penalty asymmetry: mismatches hurt more than matches help (Bayesian loss aversion)
  if (intent) {
    if (intent.target_cuisines.length > 0 && profile.cuisine_type) {
      const cuisineMatch = intent.target_cuisines.some(
        (c) => c.toLowerCase() === profile.cuisine_type!.toLowerCase()
      );
      if (cuisineMatch) {
        boost += intent.cuisine_importance === "high" ? 5 : 3;
      } else if (intent.cuisine_importance === "high") {
        boost -= 4.0; // was -2; the single most informative mismatch signal
      } else if (intent.cuisine_importance === "medium") {
        boost -= 2.5; // new: medium importance mismatch also penalized
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
  // V1 alignment: pass same signals used by V1 ranking
  intent?: IntentClassification | IntentClassificationV2 | null;
  rejectionSignals?: RejectionSignals;
  userFeedback?: UserFeedbackSignals | null;
  clientTimeOfDay?: string | null;
  // Hard requirement penalty inputs
  dietaryRestrictions?: string[];
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
// 92-99%: "Perfect Match" (high)
// 82-91%: "Great Match" (high)
// 70-81%: "Good Match" (mid)
// 55-69%: "Fair Match" (low)
// 45-54%: "Stretch" (low)

// --- Hard requirement penalties ---
// Applied multiplicatively to the composite when explicit user requests are unmet.
// Rationale: These are the highest mutual-information signals. A cuisine mismatch when
// the user explicitly asked for a cuisine should be devastating to confidence.
// Penalty asymmetry (Bayesian): negative evidence updates more strongly than positive.

const PRICE_ORDER = ["$", "$$", "$$$", "$$$$"];

function applyHardRequirementPenalties(
  composite: number,
  profile: RestaurantProfile,
  inputs: DondeMatchInputs,
  intent?: IntentClassification | IntentClassificationV2 | null,
): number {
  // 1. Cuisine mismatch when user explicitly requested a cuisine
  if (intent?.target_cuisines && intent.target_cuisines.length > 0 && profile.cuisine_type) {
    const cuisineMatch = intent.target_cuisines.some(
      (c) => c.toLowerCase() === profile.cuisine_type!.toLowerCase()
    );
    if (!cuisineMatch) {
      if (intent.cuisine_importance === "high") {
        // "I want sushi" + gets steakhouse → devastating penalty
        composite *= 0.55;
      } else if (intent.cuisine_importance === "medium") {
        // Less explicit but still a miss
        composite *= 0.75;
      }
    }
  }

  // 2. Dietary restrictions — penalties removed.
  // Most restaurants accommodate vegan/vegetarian without explicitly listing it,
  // so penalties created false negatives for missing data. Positive scoring for
  // dietary matches handled in computeBaseScore() and reRankWithBoosts().
  // Safety nets: hard dietary filter in index.ts, Claude HARD REQUIREMENT directive.

  // 3. Price mismatch — behavioral psychology: budget is a hard constraint.
  // Overspending triggers regret aversion; underspending can feel like settling.
  // Asymmetric: over-budget is worse than under-budget.
  // Uses multiplicative penalties for large gaps (consistent with cuisine mismatch pattern).
  if (inputs.priceLevel && inputs.priceLevel !== "Any" && profile.price_level) {
    const userIdx = PRICE_ORDER.indexOf(inputs.priceLevel);
    const restIdx = PRICE_ORDER.indexOf(profile.price_level);
    if (userIdx >= 0 && restIdx >= 0) {
      const gap = restIdx - userIdx; // positive = over budget, negative = under
      if (gap >= 3) {
        // $→$$$$ : 3-tier over-budget — devastating
        composite *= 0.55;
      } else if (gap === 2) {
        // $→$$$ or $$→$$$$ : 2-tier over-budget — severe
        composite *= 0.70;
      } else if (gap === 1) {
        // One tier over budget — noticeable but not fatal
        composite -= 0.8;
      } else if (gap === -1) {
        // One tier under budget — mild (user might enjoy the value)
        composite -= 0.3;
      } else if (gap <= -2) {
        // 2+ tiers under budget — could signal quality concern
        composite -= 0.5;
      }
    }
  }

  // 4. Neighborhood mismatch — mild penalty since RPC pre-filter usually handles this.
  // Only fires during relaxation cascades when exact neighborhood has no results.
  if (inputs.neighborhood && inputs.neighborhood !== "Anywhere" && profile.neighborhood_name) {
    if (profile.neighborhood_name.toLowerCase() !== inputs.neighborhood.toLowerCase()) {
      composite -= 1.5;
    }
  }

  return Math.max(0, composite);
}

export function computeDondeMatch(
  profile: RestaurantProfile,
  inputs: DondeMatchInputs
): number {
  // V1 alignment fix: pass rejection signals, intent, user feedback, and time-of-day
  // so V1 donde match uses the same inputs as V1 ranking.
  let composite = computeBaseScoreV1(
    profile, inputs.occasion, inputs.specialRequest,
    inputs.rejectionSignals, inputs.intent
  );

  // V1 alignment: user feedback signals (same as reRankWithBoosts)
  if (inputs.userFeedback) {
    if (profile.cuisine_type && inputs.userFeedback.likedCuisines.includes(profile.cuisine_type)) composite += 0.5;
    if (profile.cuisine_type && inputs.userFeedback.dislikedCuisines.includes(profile.cuisine_type)) composite -= 1.5;
    if (inputs.userFeedback.dislikedRestaurantIds.includes(profile.id)) composite -= 3.0;
  }

  // V1 alignment: time-of-day signals
  if (inputs.clientTimeOfDay && profile.best_times && profile.best_times.length > 0) {
    if (profile.best_times.includes(inputs.clientTimeOfDay)) composite += 0.8;
    else if (profile.best_times.length <= 2) composite -= 0.5;
  }

  // --- Late-binding overlays (only available after Google/Claude fetch) ---
  // Reduced dilution: base score retains 76.5% influence (was 64%)

  // Google quality overlay (10% weight, was 15%)
  const googleQuality = computeGoogleQuality(inputs.googleData);
  composite = composite * 0.90 + googleQuality * 0.10;

  // Claude relevance as supplementary signal (15% weight, was 25%)
  if (inputs.claudeRelevance != null) {
    composite = composite * 0.85 + inputs.claudeRelevance * 0.15;
  }

  // Sentiment penalty: reduce match when reviews are significantly negative
  composite += computeSentimentPenalty(inputs.sentimentNegative);

  // Hard requirement penalties: penalize when explicit user requests are unmet
  composite = applyHardRequirementPenalties(composite, profile, inputs, inputs.intent);

  // Map 0-10 raw composite to 45-99% confidence range
  // Wider range (was 60-99) gives 54 points of dynamic range for better discrimination.
  // Each composite point = 5.4 percentage points (was 3.9).
  return Math.min(99, Math.max(45, Math.round(45 + Math.min(10, Math.max(0, composite)) * 5.4)));
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
  // Prefer V2 intent flavor_preferences (Claude-extracted) over keyword extraction
  maxScore += 3;
  if (dp?.flavor_profiles && dp.flavor_profiles.length > 0) {
    const v2Intent = intent && "flavor_preferences" in intent ? intent as IntentClassificationV2 : null;
    const flavorIntent = (v2Intent?.flavor_preferences && v2Intent.flavor_preferences.length > 0)
      ? v2Intent.flavor_preferences
      : extractFlavorIntent(specialRequest);
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
  specialRequest: string,
  intent?: IntentClassification | IntentClassificationV2 | null
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

  // V2 intent vibe_keywords matching against deep profile (0-1.5 points)
  const v2Intent = intent && "vibe_keywords" in intent ? intent as IntentClassificationV2 : null;
  if (v2Intent?.vibe_keywords && v2Intent.vibe_keywords.length > 0) {
    let vibeHits = 0;
    for (const vibe of v2Intent.vibe_keywords) {
      const vibeLower = vibe.toLowerCase();
      // Match against decor_style, music_vibe, energy_level descriptors
      if (dp.decor_style && dp.decor_style.toLowerCase().includes(vibeLower)) { vibeHits++; continue; }
      if (dp.music_vibe && dp.music_vibe.toLowerCase().includes(vibeLower)) { vibeHits++; continue; }
      // Map vibe keywords to energy level ranges
      const VIBE_ENERGY: Record<string, [number, number]> = {
        intimate: [2, 5], lively: [6, 9], cozy: [2, 5], elegant: [3, 6],
        casual: [3, 7], buzzing: [7, 10], chill: [2, 5], refined: [3, 6],
        warm: [3, 6], modern: [4, 8], funky: [6, 9],
      };
      if (dp.energy_level != null && VIBE_ENERGY[vibeLower]) {
        const [lo, hi] = VIBE_ENERGY[vibeLower];
        if (dp.energy_level >= lo && dp.energy_level <= hi) { vibeHits++; continue; }
      }
    }
    score += Math.min(1.5, vibeHits * 0.5);
  }

  // Also match vibe_keywords against restaurant tags (bridges intent→tag system)
  // e.g. "rooftop" in vibe_keywords → restaurant with tags:["rooftop"] gets bonus
  if (v2Intent?.vibe_keywords && v2Intent.vibe_keywords.length > 0 && profile.tags?.length > 0) {
    let tagHits = 0;
    const tagsLower = profile.tags.map((t: string) => t.toLowerCase());
    for (const vibe of v2Intent.vibe_keywords) {
      const vibeLower = vibe.toLowerCase();
      if (tagsLower.some((tag: string) => tag.includes(vibeLower) || vibeLower.includes(tag))) {
        tagHits++;
      }
    }
    score += Math.min(1.5, tagHits * 0.75); // Up to 1.5 bonus per hit
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
  specialRequest: string,
  intent?: IntentClassification | IntentClassificationV2 | null
): number {
  let score = 8; // assume practical until proven otherwise

  if (!dp) return score;

  const lower = (specialRequest || "").toLowerCase();
  const v2Intent = intent && "spontaneity" in intent ? intent as IntentClassificationV2 : null;

  // Reservation difficulty vs spontaneity — prefer V2 intent signal over regex
  const isSpontaneous = v2Intent?.spontaneity === "spontaneous"
    || lower.match(/tonight|right now|last minute|walk.?in|spontaneous/);
  if (dp.reservation_difficulty === "hard_to_get") {
    if (isSpontaneous) {
      score -= 3;
    }
  } else if (dp.reservation_difficulty === "walk_in_friendly") {
    if (isSpontaneous) {
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

  // Group size hints — prefer V2 intent group_size_hint over regex
  if (dp.group_size_sweet_spot) {
    const rangeMatch = dp.group_size_sweet_spot.match(/\[(\d+),(\d+)\)/);
    if (rangeMatch) {
      const [, minStr, maxStr] = rangeMatch;
      const min = parseInt(minStr, 10);
      const max = parseInt(maxStr, 10);
      const isLargeGroup = v2Intent?.group_size_hint === "large_group"
        || lower.match(/large.?group|big.?group|party of \d{2}|10\+|12\+|15\+/);
      if (isLargeGroup && max <= 6) {
        score -= 2;
      }
      const isSolo = v2Intent?.group_size_hint === "solo" || occasion === "Solo Dining";
      if (isSolo && min > 2) {
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
  occasion: string,
  intent?: IntentClassification | IntentClassificationV2 | null
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

  // V2 emotional intent modulation — "explore" and "indulge" boost discovery
  const v2Intent = intent && "emotional_intent" in intent ? intent as IntentClassificationV2 : null;
  if (v2Intent?.emotional_intent === "explore") {
    // User wants to discover something new — boost unique traits
    if (dp.neighborhood_integration === "hidden_local") score += 1;
    if (dp.cultural_authenticity != null && dp.cultural_authenticity >= 7) score += 0.5;
  } else if (v2Intent?.emotional_intent === "impress") {
    // User wants to wow someone — boost awards and chef-notable
    if (dp.awards_recognition && dp.awards_recognition.length > 0) score += 1;
    if (dp.chef_notable) score += 0.5;
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

  // V2 emotional intent refinement — nudge weights based on what the user really wants
  const v2Intent = intent && "emotional_intent" in intent ? intent as IntentClassificationV2 : null;
  if (v2Intent?.emotional_intent) {
    if (v2Intent.emotional_intent === "explore" && occasion !== "Adventure") {
      // Shift toward discovery without overriding occasion-specific overrides above
      w.discovery = Math.min(0.35, w.discovery + 0.10);
      w.occasion = Math.max(0.10, w.occasion - 0.05);
      w.craving = Math.max(0.10, w.craving - 0.05);
    } else if (v2Intent.emotional_intent === "comfort") {
      // Comfort seekers care about vibe and craving match
      w.vibe = Math.min(0.30, w.vibe + 0.05);
      w.discovery = Math.max(0.05, w.discovery - 0.05);
    } else if (v2Intent.emotional_intent === "impress") {
      // Trying to impress — occasion and discovery (awards, wow) matter more
      w.occasion = Math.min(0.35, w.occasion + 0.05);
      w.discovery = Math.min(0.25, w.discovery + 0.05);
      w.practical = Math.max(0.05, w.practical - 0.05);
      w.craving = Math.max(0.10, w.craving - 0.05);
    }
    // Normalize to maintain sum = 1.0 after clamped nudges
    const sum = w.occasion + w.craving + w.vibe + w.practical + w.discovery;
    if (Math.abs(sum - 1.0) > 0.001) {
      w.occasion /= sum;
      w.craving /= sum;
      w.vibe /= sum;
      w.practical /= sum;
      w.discovery /= sum;
    }
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
    vibeAlignment: computeVibeAlignmentV2(profile, dp, occasion, specialRequest, intent),
    practicalFit: computePracticalFit(profile, dp, occasion, specialRequest, intent),
    discoveryValue: computeDiscoveryValue(profile, dp, occasion, intent),
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

// --- V2 Base Score: Shared core for ranking AND donde_match ---

export interface UserFeedbackSignals {
  likedCuisines: string[];
  dislikedCuisines: string[];
  likedRestaurantIds: string[];
  dislikedRestaurantIds: string[];
}

export interface BaseScoreInputs {
  occasion: string;
  specialRequest: string;
  intent: IntentClassification | IntentClassificationV2 | null;
  trendingScore?: number | null;
  rejectionSignals?: RejectionSignals;
  userFeedback?: UserFeedbackSignals | null;
  clientTimeOfDay?: string | null;
  dietaryRestrictions?: string[]; // From filter selection — drives dietary boost/penalty in base score
}

/**
 * Unified base score used by BOTH reRankV2 and computeDondeMatchV2.
 * Includes: V2 multi-dimensional scoring, enrichment confidence gating,
 * trending signal, and rejection penalties.
 * Late-binding overlays (Google, Claude relevance, sentiment) are NOT included —
 * those are applied only in computeDondeMatchV2 after external data is available.
 */
export function computeBaseScore(
  profile: RestaurantProfile,
  inputs: BaseScoreInputs
): number {
  const dimensions = computeScoringDimensions(
    profile, inputs.occasion, inputs.specialRequest, inputs.intent
  );
  const weights = computeDimensionWeights(inputs.occasion, inputs.intent);
  let composite = computeCompositeV2(dimensions, weights);

  // Enrichment confidence gating: blend toward V1 baseline when deep profile is low-confidence
  const dp = profile.deep_profile;
  if (dp?.enrichment_confidence != null && dp.enrichment_confidence < 7) {
    const v1Base = computeWeightedOccasionScore(profile, inputs.occasion);
    const confidenceFactor = dp.enrichment_confidence / 10;
    composite = composite * confidenceFactor + v1Base * (1 - confidenceFactor);
  }

  // Trending signal (available at both ranking and match time)
  if (inputs.trendingScore != null) {
    const trending = inputs.trendingScore / 10;
    composite = composite * 0.92 + trending * 0.08;
  }

  // Rejection penalties — strengthened: user explicitly rejected these patterns
  if (inputs.rejectionSignals) {
    if (profile.cuisine_type && inputs.rejectionSignals.avoidCuisines.includes(profile.cuisine_type)) {
      composite -= 3.5; // was -2.0; user rejected this cuisine type twice = strong negative evidence
    }
    if (profile.price_level && inputs.rejectionSignals.avoidPriceLevels.includes(profile.price_level)) {
      composite -= 2.0; // was -1.0; price is a deliberate filter
    }
  }

  // B7: User feedback personalization signals — strengthened penalties
  if (inputs.userFeedback) {
    const fb = inputs.userFeedback;
    // Boost restaurants matching liked cuisines
    if (profile.cuisine_type && fb.likedCuisines.includes(profile.cuisine_type)) {
      composite += 0.5;
    }
    // Penalize restaurants matching disliked cuisines
    if (profile.cuisine_type && fb.dislikedCuisines.includes(profile.cuisine_type)) {
      composite -= 1.5; // was -0.8; past behavior is a strong predictor
    }
    // Penalize previously disliked specific restaurants
    if (fb.dislikedRestaurantIds.includes(profile.id)) {
      composite -= 3.0; // was -2.0; user explicitly disliked this exact place
    }
  }

  // B2: Client time-of-day override (more accurate than server-side timezone guess)
  if (inputs.clientTimeOfDay && profile.best_times && profile.best_times.length > 0) {
    if (profile.best_times.includes(inputs.clientTimeOfDay)) {
      composite += 0.8;
    } else if (profile.best_times.length <= 2) {
      composite -= 0.5;
    }
  }

  // Dietary filter boost — applied from FILTER SELECTION (not just special_request text).
  // Behavioral psychology: finding a restaurant that caters to your restriction creates
  // relief/delight (positive reinforcement). Magnitude is asymmetric to the penalty in
  // applyHardRequirementPenalties (loss aversion: penalties 2-3x stronger than bonuses).
  if (inputs.dietaryRestrictions && inputs.dietaryRestrictions.length > 0) {
    const restaurantDietary = profile.dietary_options || [];
    const dpDietaryDepth = profile.deep_profile?.dietary_depth;

    const allMatch = inputs.dietaryRestrictions.every((restriction) => {
      const dietaryValues = DIETARY_KEYWORDS[restriction.toLowerCase()];
      if (!dietaryValues) return false;
      return restaurantDietary.some((opt) =>
        dietaryValues.some((dv) => opt.toLowerCase().includes(dv.toLowerCase()))
      );
    });

    if (allMatch) {
      // Base bonus for matching all dietary restrictions from filter
      composite += 1.0;

      // Extra bonus for dedicated dietary restaurants (deep profile signal)
      if (dpDietaryDepth && DIETARY_DEPTH_BONUS[dpDietaryDepth] != null) {
        composite += DIETARY_DEPTH_BONUS[dpDietaryDepth];
      }

      // Vegan-dedicated amplifier: strongly reward dedicated vegan restaurants
      // when the user explicitly selects vegan (total: +1.0 base + 2.0 dedicated + 1.5 = +4.5)
      if (
        inputs.dietaryRestrictions.some((r) => r.toLowerCase() === "vegan") &&
        dpDietaryDepth === "dedicated"
      ) {
        composite += 1.5;
      }
    } else {
      // Check hierarchy for partial credit: e.g., Vegan user at Vegetarian restaurant
      for (const restriction of inputs.dietaryRestrictions) {
        const subsumes = DIETARY_HIERARCHY[restriction.toLowerCase()];
        if (subsumes) {
          const hasSubsumedMatch = subsumes.some((sub) => {
            const subValues = DIETARY_KEYWORDS[sub];
            if (!subValues) return false;
            return restaurantDietary.some((opt) =>
              subValues.some((sv) => opt.toLowerCase().includes(sv.toLowerCase()))
            );
          });
          if (hasSubsumedMatch) {
            composite += 0.5; // partial credit via dietary hierarchy
            break; // only count once
          }
        }
      }
    }
  }

  return composite;
}

// --- V2 Donde Match ---

export function computeDondeMatchV2(
  profile: RestaurantProfile,
  inputs: DondeMatchInputs,
  intent: IntentClassification | IntentClassificationV2 | null
): number {
  // Start with SAME base score as ranking (dimensions + confidence gating + trending)
  let composite = computeBaseScore(profile, {
    occasion: inputs.occasion,
    specialRequest: inputs.specialRequest,
    intent,
    trendingScore: profile.trending_score,
    dietaryRestrictions: inputs.dietaryRestrictions,
  });

  // --- Late-binding overlays (only available after Google/Claude fetch) ---
  // Reduced dilution: base score retains 76.5% influence (was 64%)

  // Google quality overlay (10% weight, was 15%)
  const googleQuality = computeGoogleQuality(inputs.googleData);
  composite = composite * 0.90 + googleQuality * 0.10;

  // Claude relevance as supplementary signal (15% weight, was 25%)
  if (inputs.claudeRelevance != null) {
    composite = composite * 0.85 + inputs.claudeRelevance * 0.15;
  }

  // Sentiment penalty: reduce match when reviews are significantly negative
  composite += computeSentimentPenalty(inputs.sentimentNegative);

  // Hard requirement penalties: penalize when explicit user requests are unmet
  composite = applyHardRequirementPenalties(composite, profile, inputs, intent);

  // Map to 45-99 range (wider for better discrimination)
  return Math.min(99, Math.max(45, Math.round(45 + Math.min(10, Math.max(0, composite)) * 5.4)));
}

// --- V2 Re-rank using multi-dimensional scoring ---

export function reRankV2(
  profiles: RestaurantProfile[],
  occasion: string,
  specialRequest: string,
  rejectionSignals?: RejectionSignals,
  intent?: IntentClassification | IntentClassificationV2 | null,
  userFeedback?: UserFeedbackSignals | null,
  clientTimeOfDay?: string | null,
  dietaryRestrictions?: string[]
): RestaurantProfile[] {
  const scored = profiles.map((p) => {
    const composite = computeBaseScore(p, {
      occasion,
      specialRequest,
      intent: intent ?? null,
      trendingScore: p.trending_score,
      rejectionSignals,
      userFeedback,
      clientTimeOfDay,
      dietaryRestrictions,
    });
    return { profile: p, composite };
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

  return boosted.slice(0, 25);
}

// --- V1 Base Score: Shared core for V1 ranking AND donde_match ---

/**
 * Unified V1 base score used by BOTH reRankWithBoosts and computeDondeMatch.
 * Same formula as the V1 ranking composite: occasion + boost + trending with adaptive weights.
 * Late-binding overlays (Google, Claude relevance, sentiment) are NOT included.
 */
export function computeBaseScoreV1(
  profile: RestaurantProfile,
  occasion: string,
  specialRequest: string,
  rejectionSignals?: RejectionSignals,
  intent?: IntentClassification | null
): number {
  const occasionScore = computeWeightedOccasionScore(profile, occasion);
  const boost = computeBoost(profile, specialRequest, rejectionSignals, intent);
  const trending = (profile.trending_score || 0) / 10;

  let wOccasion = 0.55, wBoost = 0.35, wTrend = 0.10;
  if (intent?.cuisine_importance === "high") {
    wOccasion = 0.35; wBoost = 0.55; wTrend = 0.10;
  } else if (intent?.cuisine_importance === "medium") {
    wOccasion = 0.45; wBoost = 0.45; wTrend = 0.10;
  }

  return occasionScore * wOccasion + boost * wBoost + trending * wTrend;
}

// --- Re-rank RPC results with keyword boosts ---

export function reRankWithBoosts(
  profiles: RestaurantProfile[],
  occasion: string,
  specialRequest: string,
  rejectionSignals?: RejectionSignals,
  intent?: IntentClassification | null,
  userFeedback?: UserFeedbackSignals | null,
  clientTimeOfDay?: string | null,
  dietaryRestrictions?: string[]
): RestaurantProfile[] {
  // Only re-sort if at least one restaurant would get a non-zero boost or trending signal
  const anyBoosted = profiles.some((p) => computeBoost(p, specialRequest, rejectionSignals, intent) !== 0);
  const hasTrending = profiles.some((p) => p.trending_score && p.trending_score > 0);
  const hasFeedback = userFeedback && (userFeedback.likedCuisines.length > 0 || userFeedback.dislikedCuisines.length > 0);
  const hasDietary = dietaryRestrictions && dietaryRestrictions.length > 0;
  if (!anyBoosted && !hasTrending && !hasFeedback && !hasDietary && (!specialRequest || specialRequest.trim().length < 3)) {
    return profiles;
  }

  const scored = profiles.map((p) => {
    let composite = computeBaseScoreV1(p, occasion, specialRequest, rejectionSignals, intent);

    // B7: User feedback signals for V1 path — strengthened penalties
    if (userFeedback) {
      if (p.cuisine_type && userFeedback.likedCuisines.includes(p.cuisine_type)) composite += 0.5;
      if (p.cuisine_type && userFeedback.dislikedCuisines.includes(p.cuisine_type)) composite -= 1.5;
      if (userFeedback.dislikedRestaurantIds.includes(p.id)) composite -= 3.0;
    }

    // B2: Client time-of-day for V1 path
    if (clientTimeOfDay && p.best_times && p.best_times.length > 0) {
      if (p.best_times.includes(clientTimeOfDay)) composite += 0.8;
      else if (p.best_times.length <= 2) composite -= 0.5;
    }

    // Dietary filter boost for V1 path (mirrors V2 computeBaseScore logic)
    if (hasDietary) {
      const restaurantDietary = p.dietary_options || [];
      const allMatch = dietaryRestrictions!.every((restriction) => {
        const dietaryValues = DIETARY_KEYWORDS[restriction.toLowerCase()];
        if (!dietaryValues) return false;
        return restaurantDietary.some((opt) =>
          dietaryValues.some((dv) => opt.toLowerCase().includes(dv.toLowerCase()))
        );
      });
      if (allMatch) {
        composite += 1.0;
        const dpDietaryDepth = p.deep_profile?.dietary_depth;
        if (dpDietaryDepth && DIETARY_DEPTH_BONUS[dpDietaryDepth] != null) {
          composite += DIETARY_DEPTH_BONUS[dpDietaryDepth];
        }
        // Vegan-dedicated amplifier (mirrors computeBaseScore logic)
        if (
          dietaryRestrictions!.some((r) => r.toLowerCase() === "vegan") &&
          dpDietaryDepth === "dedicated"
        ) {
          composite += 1.5;
        }
      } else {
        // Check hierarchy for partial credit
        for (const restriction of dietaryRestrictions!) {
          const subsumes = DIETARY_HIERARCHY[restriction.toLowerCase()];
          if (subsumes) {
            const hasSubsumedMatch = subsumes.some((sub) => {
              const subValues = DIETARY_KEYWORDS[sub];
              if (!subValues) return false;
              return restaurantDietary.some((opt) =>
                subValues.some((sv) => opt.toLowerCase().includes(sv.toLowerCase()))
              );
            });
            if (hasSubsumedMatch) {
              composite += 0.5;
              break;
            }
          }
        }
      }
    }

    return { profile: p, composite };
  });

  scored.sort((a, b) => b.composite - a.composite);
  return scored.map((s) => s.profile);
}

// --- Enhancement 6: Diversity-aware candidate selection ---

export function ensureDiversity(
  top: RestaurantProfile[],
  backfillPool: RestaurantProfile[],
  maxPerCuisine = 3,
  maxPerNeighborhood = 5
): RestaurantProfile[] {
  if (top.length <= 2) return top; // Not enough to diversify

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
// V3.5: Score-aware tone modulation — preliminary DM drives blurb confidence calibration
export function buildSystemPrompt(occasion?: string, priceLevel?: string, includeToneDirective?: boolean): string {
  // Voice modulation directive — shifts personality based on context
  const voiceDirective = getVoiceDirective(occasion || "Any", priceLevel || "$$");
  // V3.5: Tone modulation directive — calibrates confidence to Donde Match score tier
  const toneDirective = includeToneDirective ? `\n\n${getScoreToneDirective()}` : '';

  return `You are Donde, a sharp, opinionated Chicago dining guide. You sound like a food-obsessed friend who eats out five nights a week and has strong opinions about every restaurant in the city. Use "we" as Donde's voice. You write with the confidence of someone who knows the scene cold, but every specific claim must come from the candidate data provided.

TASK: Pick THE ONE BEST restaurant from the candidates for this user. Candidates are ordered by match score (best first). Prefer candidates near the top unless a lower-ranked candidate is a dramatically better fit for the user's specific request. Priority:
0. DIETARY RESTRICTIONS (if present) — absolute deal-breaker, overrides all other criteria. Never recommend a restaurant that cannot accommodate the user's dietary needs.
1. SPECIAL REQUEST match (cuisine, vibe, features), highest priority
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

${voiceDirective}${toneDirective}

CULTURAL GROUNDING, use the actual vocabulary of each cuisine:
- Mexican: Regional distinctions matter (Oaxacan ≠ Tex-Mex ≠ Pueblan). Say "mole negro" not "dark sauce." Say "taquero" not "cook." Respect the complexity.
- Japanese: Omakase = chef's trust. Izakaya = drinking food. Ramen has regional styles. Say "robata" not "grill." Don't flatten it.
- Ethiopian: Communal eating on injera. This is meant to be shared. Say "injera" not "flatbread."
- Italian: Red-sauce joint ≠ northern Italian ≠ Neapolitan. If the data shows a subcategory, honor it. Say "al dente" and "ragù," not "firm pasta" and "meat sauce."
- Korean: KBBQ is an experience. Say "banchan" not "small plates." Say "ssamjang" not "dipping sauce." Soju protocol exists.
- Indian: Regional matters. Punjabi, South Indian, Bengali are different planets. If we know, we say.
- Polish/Eastern European: Say "pierogi" not "dumplings." Acknowledge the tradition.
- One precise, cuisine-correct detail beats three generic English substitutes.

WRITING RULES (THIS IS CRITICAL):

Voice:
- You're texting your best friend who asked where to eat tonight. You happen to know every restaurant in Chicago.
- Use "we" naturally: "We love this spot for..." / "We keep coming back because..."
- Always use contractions (it's, don't, you'll, we'd, they're). Never "it is" or "do not" or "they are."
- Be opinionated and direct: "The rigatoni is the move" not "They offer a variety of pasta options"
- Include at least one concrete sensory detail about the food: a flavor, texture, aroma, temperature, or visual. "The crust blisters in the 900-degree oven" or "the broth is rich with pork fat and topped with a soft egg." Descriptions that don't make the reader hungry aren't doing their job.
- Include one honest caveat or trade-off per blurb. This builds trust. "The wait can test you on weekends, but that first bite makes you forget." "It's loud and a little cramped, which is part of the charm." A rec with zero caveats reads like an ad.
- When possible, position the restaurant: "In a city full of Italian spots, this one earns its crowd because..." or "One of the few places in Pilsen still grinding their own masa daily."

Rhythm:
- Every blurb MUST contain at least one sentence of 6 words or fewer. Short sentences create punch. "Worth the wait." "You'll come back." "Order two." Place the short sentence after a longer one for contrast.
- Alternate between punchy (3-8 words) and flowing (12-20 words). Never three long sentences in a row.
- Vary your sentence openers. Never start two consecutive sentences the same way.

Grounding (MANDATORY, violating this is the worst failure mode):
- ONLY reference facts from the candidate data: cuisine type, tags, noise level, lighting, dress code, features (outdoor/music/pet), best-for one-liner, dietary options, neighborhood character, AND any deep profile fields provided (signature dishes, origin story, wow factors, service style, etc.).
- If REVIEWS are provided: you may reference specific dishes, experiences, or sentiments that diners actually mentioned. Paraphrase, don't quote verbatim.
- If NO reviews are provided for the chosen restaurant: use deep profile data (signature dishes, origin story, etc.) if available. Otherwise write shorter using ONLY the metadata. Do NOT invent details.
- When in doubt, OMIT the detail. A shorter honest rec beats a longer fabricated one.
- If candidate data lacks specifics, write a shorter, more general rec. Never invent details to fill space.

BANNED (never use, these are AI slop):

Punctuation tells:
- NEVER use em dashes ( \u2014 ). Use periods, commas, or "and" instead.
- No semicolons. Split into two sentences.
- No "..." ellipses except in rare, deliberate trailing-off.

Word and phrase slop:
"culinary" "gastronomic" "unforgettable" "unparalleled" "nestled" "boasts" "tantalizing" "mouthwatering" "delectable" "exquisite" "embark" "elevate" "a testament to" "truly remarkable" "a must-visit" "not to be missed" "a cut above" "hidden gem" "from the moment you" "whether you're looking" "that will leave you" "perfect harmony" "perfect blend" "perfect balance" "burst of flavor" "culinary journey" "dining experience" "taste buds" "hits all the right notes" "checks all the boxes" "doesn't disappoint" "will not disappoint" "palate" "genuine" (as vague intensifier) "actual" (as vague intensifier) "unapologetically"

Structural tells:
- Never open with "Ah," "So," "Well," "Look," "Here's the thing"
- No "Whether...or..." constructions
- No "If you're looking for..." openers
- No "Think [X] meets [Y]" descriptions
- No "does [X] right" or "gets [X] right"
- No noun-phrase fragment evaluations ("Italian comfort done with craft"). Use complete sentences.
- Never describe noise or dress code using the exact database field name. Say "you can actually hear each other" not "moderate noise." Say "wear whatever" not "casual dress code."

Structure:
- Do NOT open with the restaurant name as the first word. Vary your opening approach: sometimes lead with the food, sometimes the story, sometimes a bold claim, sometimes the vibe.
- No rhetorical questions. No "This [cuisine] gem/haven/oasis."
- Never parrot the user's request back to them.
- Vary your structure. Not every blurb should follow the same pattern. Sometimes lead with the dish, sometimes the neighborhood, sometimes a personal take, sometimes a contrast.

OUTPUT FORMAT, respond ONLY in this exact JSON (no markdown, no backticks):
{
  "restaurant_index": 0,
  "recommendation": "60-100 word paragraph. Grounded, opinionated, score-aware. One sensory detail. One honest caveat. One sentence under 6 words. If weight shifts apply (e.g., vibe weighted higher for date night), mention it naturally.",
  "insider_tip": "One practical, grounded sentence. Under 20 words. See rules below.",
  "relevance_score": 8.5,
  "sentiment_score": 7.5,
  "sentiment_positive": 80,
  "sentiment_negative": 10,
  "sentiment_neutral": 10,
  "sentiment_breakdown": "80% positive, 10% neutral, 10% negative",
  "sentiment_summary": "Diners rave about the handmade pasta and warm service. A few mention slow waits on weekends."
}

INSIDER TIP RULES (V3):
The tip should feel like it's coming from a friend who's been here 20 times. One sentence, whispered, not announced.

- BLEND seat + food when both are noteworthy: "Sit at the chef's counter and order the [signature dish]."
- USE seat info ONLY when the seat genuinely adds to the experience: a great view, notably quieter, you watch the chef cook, a hidden patio, a romantic corner. If the seat is just "a table," skip it.
- If deep profile has best_seat_in_house AND it describes something noteworthy (view, quiet, chef interaction, ambiance), weave it into the tip naturally. Don't prefix with "Best seat:" or label it. Just say it as if you're telling a friend.
- If deep profile has signature_dishes, reference the standout: "The [dish] is what regulars come back for."
- If reviews mention a specific dish, seating spot, or timing advice, use that.
- If deep profile has wow_factors, byob_policy, or origin_story, weave practical + narrative: "It's BYOB. Grab a bottle from the shop around the corner."
- If no rich data, give practical advice from metadata.
- Start with a verb when possible: "Ask for..." "Grab the..." "Skip the... go for the..." "Sit at..."
- Never start with "Be sure to" or "Don't miss" or "Make sure to"
- NEVER fabricate specific menu items, off-menu secrets, server names, or reservation hacks you can't verify from the data.
- Keep it to one sentence, under 20 words. Actionable over clever.

EXAMPLES OF GOOD OUTPUT:

Example 1 (Date Night, Italian, with reviews + deep profile):
"recommendation": "Half of Logan Square shows up here on a Tuesday, and there's no reservation trick that helps. The handmade rigatoni has this ridged texture that traps every drop of the slow-cooked ragù. Lighting is low, the room has energy, and it never tries too hard. The wine list is way better than it needs to be."
"insider_tip": "The two-top by the front window is the most intimate seat. Get there by 5:30."

Example 2 (Adventure, Oaxacan, with deep profile, no reviews):
"recommendation": "Three generations of the same Oaxacan family. Same mole recipe. Pilsen hasn't gotten tired of it. Counter service, no frills, and the mole negro has a slow-building bitterness from charred chiles with just enough chocolate to round it out. Best plate is $12. You'll think about it for weeks."
"insider_tip": "The mole negro is the one. It's the recipe that started everything."

Example 3 (Group Hangout, Korean, minimal deep profile):
"recommendation": "For a group hangout with energy, this is the move. Korean spot in Wicker Park where you'll order too many banchan and nobody will mind. It gets loud, which is part of the fun. BYOB keeps the bill low."
"insider_tip": "It's BYOB, so grab a six-pack from the shop next door before you walk in."

Example 4 (Solo Dining, Japanese, with deep profile):
"recommendation": "We keep sending solo diners here for a reason. The counter seats face the open kitchen, and watching the chef work the robata is half the experience. It's quiet enough to think, warm enough to linger. The omakase changes daily, so you never get the same meal twice. Not cheap, but worth treating yourself."
"insider_tip": "Sit at the counter. Ask the chef what's freshest today."

Example 5 (Family Dinner, Mexican, with reviews):
"recommendation": "The real test for a family spot: adults enjoy it AND kids don't lose it. This one passes. The tortillas are made fresh every hour, and you can smell the corn masa from the door. Portions are generous, the salsa verde has real heat, and the staff genuinely likes kids. Parking can be tricky on weekends, but the food makes up for it."
"insider_tip": "Order the queso fundido as a table starter. It arrives bubbling."

Example 6 (Cuisine mismatch, user asked for cuisine we don't carry, subtle pivot):
"recommendation": "The lamb barbacoa biryani here is beautiful plating, and the patio has the kind of low-lit energy that works for a date. Not the straight-up tacos and margs you described, but the carne apache is bold, addictive, and the Mexican-Indian fusion scratches a similar itch. Worth the detour."
"insider_tip": "The carne apache is the move. Pair it with the orange-infused coffee."

BAD EXAMPLE (do NOT write like this):
"recommendation": "Nestled in the heart of River North, this culinary gem boasts an unforgettable dining experience. The exquisite menu offers a tantalizing array of options that will elevate your taste buds. Whether you're looking for a romantic evening or a casual night out, this restaurant delivers. The mouthwatering dishes and impeccable service make it a must-visit destination."
Why this is bad: em dashes, banned words everywhere, no specifics, no sensory detail, reads like a bot wrote it.

SCORING:
- relevance_score (0-10): How well this restaurant matches the user's specific request. 9-10 = nails every aspect. 7-8 = strong match, minor gaps. 5-6 = partial match. Below 5 = best available but weak fit.
- sentiment_score (0-10): Overall review sentiment. Only set if reviews are provided, otherwise null.
- sentiment_positive, sentiment_negative, sentiment_neutral: Integer percentages that MUST sum to 100. Classify each provided review by its star rating: 4-5 stars = positive, 1-2 stars = negative, 3 stars = neutral. Compute the percentage for each category. All three must be null if no reviews are provided.
- sentiment_breakdown: Format EXACTLY as "X% positive, Y% neutral, Z% negative" (e.g. "80% positive, 10% neutral, 10% negative"). null if no reviews.
- sentiment_summary: 1-2 sentences on what diners love and any common complaints from the provided reviews. null if no reviews.

FINAL CHECK: Raw JSON only. 60-100 words. Zero em dashes. Zero semicolons. One sensory food detail. One honest caveat. Every fact from candidate data. Sound like a friend, not a bot.`;
}

// V3 Voice modulation, shifts personality based on occasion and restaurant character
// NOTE: All directives must avoid em dashes, the model mimics prompt text
function getVoiceDirective(occasion: string, priceLevel: string): string {
  if (occasion === "Adventure") {
    return `VOICE: Street-smart Chicago food explorer. You sound like you found this place by accident and now you can't stop going back. Casual, conspiratorial, a little excited.
DO: Use slang naturally. Lead with discovery or surprise. Drop details that signal "I actually go here."
DON'T: Sound like a tourism guide. Don't oversell. Let the place speak for itself.
Example openers: "Nobody talks about this spot, and honestly, good." / "We stumbled on this one last year and haven't stopped going back."`;
  }
  if (occasion === "Special Occasion" || priceLevel === "$$$$") {
    return `VOICE: Confident and warm with a touch of polish. Like a friend who knows wine and can get you a table. Not stuffy, never pretentious.
DO: Use refined but accessible language. Acknowledge the stakes. Reference specific luxuries from the data (wine program, tasting menu, service style).
DON'T: Sound like a Michelin guide. Don't use words like "exquisite" or "impeccable." Keep it human.
Example openers: "This is where you go when the night actually matters." / "We don't pull this card often, but this is it."`;
  }
  if (occasion === "Group Hangout") {
    return `VOICE: The friend who always picks the right dinner spot for the group. Energetic, practical, fun. You've organized enough group dinners to know what actually works.
DO: Emphasize shared experiences (ordering style, group dynamics, bill splitting). Mention BYOB, large tables, shareable plates.
DON'T: Be vague about group logistics. Don't ignore the practical stuff (space, noise, ordering format).
Example openers: "Rally the crew." / "Everyone's gonna order too much and nobody's gonna regret it."`;
  }
  if (occasion === "Business Lunch") {
    return `VOICE: Efficient, credible, no-frills. Sound like a colleague who knows the good spots near the office and doesn't waste your time.
DO: Be concise. Lead with practical info (noise level, speed, impression factor). Keep it professional but not stiff.
DON'T: Get flowery. Don't oversell the food. This is about making a smart, safe choice that still impresses.
Example openers: "Quiet enough to talk, good enough to impress, fast enough to get back." / "This reads well on a corporate card."`;
  }
  if (occasion === "Solo Dining" || occasion === "Treat Myself") {
    return `VOICE: Gentle, knowing, appreciative. Like a friend who understands the joy of eating alone well. No pity, just respect for the ritual.
DO: Reference counter/bar seating, people-watching, pace of the meal. Acknowledge this as a deliberate choice, not a fallback.
DON'T: Sound sorry for the person. Don't overcompensate with "you deserve this!" energy. Just be warm.
Example openers: "Just you and a really good plate." / "A seat at the bar, a glass of something nice, and zero rush."`;
  }
  if (occasion === "Family Dinner") {
    return `VOICE: Warm and practical. Like a parent-friend who knows which restaurants actually work with kids AND adults. You've done the research so they don't have to.
DO: Mention kid-friendliness concretely (high chairs, menu options, noise tolerance). Acknowledge the adult experience too.
DON'T: Make it all about the kids. Don't ignore that parents want to enjoy the meal too.
Example openers: "The real test: adults enjoy it AND kids don't lose it. This one passes." / "We've brought our own kids here. It works."`;
  }
  if (occasion === "Chill Hangout") {
    return `VOICE: Low-key, easy, no pressure. You're the friend who knows the perfect spot where nobody needs an agenda.
DO: Emphasize laid-back vibes, flexible timing, casual energy. Mention if it's good for lingering.
DON'T: Oversell. The whole point is that this is effortless.
Example openers: "No agenda needed." / "Show up whenever, stay as long as you want."`;
  }
  if (occasion === "Date Night") {
    return `VOICE: Quietly confident. Like a friend who has been on enough dates to know what works. Warm, a little romantic, but never cheesy.
DO: Reference lighting, intimacy, noise level in human terms ("you can actually hear each other"). Mention wine/cocktail programs if data supports it.
DON'T: Be corny or over-the-top romantic. No "sparks will fly." Keep it grounded.
Example openers: "The lighting alone does half the work." / "We've sent a lot of first dates here. They tend to turn into second ones."`;
  }
  return `VOICE: Sharp, opinionated, warm. A food-obsessed friend who eats out constantly, knows the city cold, and gives honest recommendations. Confident but never condescending. Culturally literate across all cuisines.
DO: Be specific. Lead with the strongest detail. Use "we" naturally.
DON'T: Sound generic. Don't hedge. If you're recommending it, own it.`;
}

// V4: Score-aware tone modulation — calibrated for geometric mean distribution
// Geometric mean produces tighter, more intuitive score ranges than V3's power-law
// Synthesized from expert reviews: Copywriter (CW), UX Writer (UX), Behavioral Psychologist (BP), Food Critic (FC)
export function getScoreToneDirective(): string {
  return `TONE MODULATION (V4, match score-aware):
Each candidate below includes a preliminary Donde Match (DM) score computed via geometric mean. The five factors are Food Quality, Vibe, Service, Reputation, Convenience. Dynamic weights shift based on the user's intent (e.g., Vibe weighted higher for date night). Calibrate your tone to the DM:

OUTSTANDING (DM 85+):
- Full confidence. Declarative, direct. "This is the one." "Order the whole fish."
- Lead with specific, verifiable detail: the dish, the technique, the ingredient. Let specificity carry the confidence, not adjectives.
- If a dynamic weight shift contributed to the high score, reference it naturally: "We put extra weight on vibe for your date night, and this place delivers."
- Caveat goes LAST, as a minor qualifier the reader barely worries about. "The wait can test you on weekends, but that first bite makes you forget."
- Insider tip: Absolute authority. Commands without softening. "Ask for the off-menu aguachile."

EXCELLENT (DM 70-84):
- Confident but acknowledge the one or two factors that aren't perfect.
- Open with what genuinely works, then name an honest trade-off, then close on a strength tied to what the user asked for.
- Be specific about the restaurant's real excellence: "Come for the handmade pasta. The rest of the menu is more variable."
- Never apologize for the recommendation. Frame trade-offs as useful context, not confessions. "The room gets loud, which matters less when the short rib shows up."
- Insider tip: Navigational and practical. "Go on a weeknight. The kitchen runs better with a smaller room."

SOLID PICK (DM 55-69):
- Measured and honest. Highlight the 1-2 factors that score well, acknowledge the gaps.
- "The food carries this one, though service can be uneven on busy nights."
- If the user's query emphasis doesn't align with the restaurant's strengths, note it: "Not the lively vibe you described, but the food makes up for a quieter room."
- Insider tip: Strategic. "Order the dumplings and skip the rest. That is where the kitchen's attention lives."

WORTH A TRY (DM below 55):
- Lead with the strongest genuine positive. One specific thing the restaurant does well.
- Name the gap briefly and neutrally: "Not the ramen you described, but..." then pivot to the genuine appeal.
- End with something actionable: a specific dish to order, a time to go.
- Insider tip: Honest navigation. "The lunch special is the best value. Skip the dinner menu."

ACROSS ALL TIERS: The reader should be able to cover the score and correctly guess the tier from your tone alone. Never oversell a low match or undersell a high one. Specificity is how you reconcile honesty with confidence at every tier.`;
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
  rejectionContext?: string,
  cuisineMismatchContext?: string | null,
  dietaryRestrictions?: string[],
  prelimScores?: number[],      // V3.5: preliminary Donde Match scores for tone calibration
  prelimFactors?: { food: number; setting: number; atmosphere: number; reputation: number; convenience: number }[]  // V3.6: factor scores for blurb emphasis
): string {
  const restaurantList = top10
    .map((d, i) => {
      const features = [
        d.outdoor_seating ? "Outdoor" : null,
        d.live_music ? "LiveMusic" : null,
        d.pet_friendly ? "PetFriendly" : null,
      ].filter(Boolean).join(",") || "none";

      const dietary = d.dietary_options?.length
        ? d.dietary_options.join(",")
        : "";

      const occasionScore = computeWeightedOccasionScore(d, occasion);
      const trending = d.trending_score ? ` T:${d.trending_score.toFixed(1)}` : "";

      // V3.5: Include preliminary Donde Match score for tone calibration
      const dmTag = prelimScores && prelimScores[i] != null ? ` | DM:${prelimScores[i]}` : '';
      // V4: Include factor scores (V4 names) so Claude can emphasize strengths and acknowledge trade-offs
      const f = prelimFactors?.[i];
      const factorTag = f ? ` | FQ:${f.food.toFixed(1)}/VB:${f.setting.toFixed(1)}/SV:${f.atmosphere.toFixed(1)}/RP:${f.reputation.toFixed(1)}/CV:${f.convenience.toFixed(1)}` : '';
      let entry = `${i}. ${d.name} | ${d.neighborhood_name} | ${d.cuisine_type || "N/A"} | ${d.price_level} | ${occasion}:${occasionScore.toFixed(1)}/10${trending} | ${d.noise_level || "?"} noise, ${d.lighting_ambiance || "?"} | ${d.dress_code || "?"} | ${features}${dietary ? " | Diet:" + dietary : ""} | "${d.best_for_oneliner || "N/A"}" | Tags: ${d.tags.length > 0 ? d.tags.join(", ") : "none"}${dmTag}${factorTag}`;

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
        entry += `\n  Recent diner reviews (use these for grounding, you may reference dishes/experiences mentioned here):\n  ${reviewsByIndex.get(i)!.split("\n").join("\n  ")}`;
      } else {
        entry += `\n  [No reviews available. Use deep profile and metadata above. Do NOT invent details not present in the data.]`;
      }

      return entry;
    })
    .join("\n\n");

  let prompt = `USER REQUEST:
- Occasion: ${occasion}
- Budget: ${priceLevel}
- Neighborhood: ${neighborhood}
- Special Request: ${specialRequest || "None"}`;

  // Dietary restrictions — HARD REQUIREMENT communicated to Claude
  if (dietaryRestrictions && dietaryRestrictions.length > 0) {
    prompt += `\n- Dietary Restrictions: ${dietaryRestrictions.join(", ")} (HARD REQUIREMENT. Do NOT recommend a restaurant that cannot accommodate these restrictions. If the best-scoring restaurant does not clearly support these dietary needs, pick one that does, even if ranked slightly lower. Mention the dietary fit naturally in your recommendation.)`;
  }

  // Enhancement 15: Neighborhood character context
  if (neighborhoodDescription && neighborhood !== "Anywhere") {
    prompt += `\n- Neighborhood Character: ${neighborhoodDescription}`;
  }

  // Enhancement 14: Rejection context
  if (rejectionContext) {
    prompt += `\n\n${rejectionContext}`;
  }

  // Cuisine mismatch context: tell Claude to be honest when none of the candidates match the request
  if (cuisineMismatchContext) {
    prompt += `\n\n${cuisineMismatchContext}`;
  }

  // V3.6: Add factor score legend when factor data is present
  const factorLegend = prelimFactors && prelimFactors.length > 0
    ? `\nFactor scores (F:Food/Setting/Atmo/Rep/Conv, each 0-10): Lead with the restaurant's strongest factor(s). If one factor is notably weak (<4), briefly acknowledge the trade-off rather than pretending it's perfect.`
    : '';

  prompt += `\n\nCANDIDATES (pick the best match, your recommendation MUST only reference facts from this data):${factorLegend}

${restaurantList}

REMINDER: Write 50-80 words. Zero em dashes. Use "we." Ground every claim in the data above. If the chosen restaurant has a deep profile, leverage origin stories, signature dishes, wow factors, and best seat details to make the rec feel deeply personal. If no reviews AND no deep profile, stick to basic metadata. Do not fabricate.${dietaryRestrictions && dietaryRestrictions.length > 0 ? `\nCRITICAL: The user has ${dietaryRestrictions.join(" + ")} dietary restrictions. Your pick MUST accommodate these. Mention how the restaurant handles their dietary needs naturally in your recommendation.` : ""}`;

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
