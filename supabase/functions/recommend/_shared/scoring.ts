/**
 * Scoring Constants & Utilities (Version Alpha)
 *
 * Shared dictionaries used by scoring-v9.ts and intent-classifier-v5.ts.
 * Contains: OCCASION_WEIGHTS, CUISINE_KEYWORDS, TAG_KEYWORDS, INTENT_MAP,
 * DIETARY_KEYWORDS, extractUnmatchedKeywords(), ensureDiversity().
 */

import type { RestaurantProfile } from "./types.ts";

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

// --- Keyword boosting ---

export const CUISINE_KEYWORDS: Record<string, string[]> = {
  // V22: Added plural forms (tamales, enchiladas, churros, nachos already covered) to prevent
  // "best tamales" from failing the deterministic classifier when only "tamale" existed.
  Mexican: ["mexican", "taco", "tacos", "burrito", "burritos", "carnitas", "enchilada", "enchiladas", "mole", "elote", "pozole", "tamale", "tamales", "churro", "churros", "sopapilla", "quesadilla", "quesadillas", "birria", "chilaquiles", "al pastor", "nachos", "margarita", "tequila", "horchata", "agua fresca", "cochinita pibil", "suadero", "barbacoa", "carne asada", "huarache", "gordita", "sope", "tlayuda", "mezcal"],
  Italian: ["italian", "pasta", "pizza", "risotto", "carbonara", "lasagna", "ravioli", "parmigiana", "margherita", "giardiniera", "gnocchi", "tiramisu", "osso buco", "focaccia", "bruschetta", "arancini", "prosciutto", "cacio e pepe", "cannoli", "panna cotta", "cioppino", "panzanella", "crostini", "affogato", "limoncello", "caprese", "antipasto", "calzone", "flatbread", "gelato", "truffle pasta"],
  Japanese: ["japanese", "sushi", "ramen", "izakaya", "sake", "chirashi", "omakase", "tonkatsu", "yakitori", "udon", "tempura", "katsu", "sashimi", "gyoza", "matcha", "poke", "takoyaki", "okonomiyaki", "miso", "edamame", "katsudon", "tsukemen", "kakigori", "donburi", "onigiri", "natto", "shabu shabu", "sukiyaki", "teppanyaki", "hand rolls", "temaki", "hibachi", "japanese curry", "mochi", "mochi ice cream"],
  Thai: ["thai", "pad thai", "curry", "basil", "khao soi", "mango sticky rice", "som tum", "boat noodles", "larb", "massaman", "panang", "satay", "tom kha", "sticky rice", "pad see ew", "drunken noodles", "papaya salad"],
  // V22: Added "dumplings" plural, "noodles" plural, "wontons" plural
  Chinese: ["chinese", "dim sum", "dumpling", "dumplings", "noodle", "noodles", "mapo tofu", "xiao long bao", "dan dan noodles", "char siu", "lo mein", "kung pao", "wonton", "wontons", "congee", "scallion pancakes", "bubble tea", "boba", "chow mein", "hot pot", "peking duck", "fried rice", "egg drop soup", "soup dumplings"],
  Korean: ["korean", "bibimbap", "kimchi", "bulgogi", "japchae", "tteokbokki", "galbi", "banchan", "budae jjigae", "soju", "bingsu", "dak galbi", "sundubu jjigae", "jajangmyeon", "kimbap", "chimaek", "corn dogs", "naengmyeon", "hoddeok", "mandu", "korean fried chicken"],
  Indian: ["indian", "curry", "tandoori", "naan", "masala", "biryani", "tikka", "samosa", "vindaloo", "idli", "dosa", "uttapam", "sambar", "rasam", "vada", "paneer", "dal", "chutney", "appam", "korma", "rogan josh", "butter chicken", "palak", "pongal", "upma", "chana masala", "chai", "lassi", "chaat", "pav bhaji", "chole", "paratha", "thali", "gulab jamun", "jalebi", "kulfi", "kheer", "raita", "panipuri", "bhel puri"],
  French: ["french", "bistro", "brasserie", "crepe", "coq au vin", "duck confit", "creme brulee", "bourguignon", "tartare", "souffle", "ratatouille", "escargot", "croissant", "croque monsieur", "fondue", "raclette", "macaron", "macarons", "amuse bouche"],
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
  "Cocktail Bar": ["cocktail bar", "speakeasy", "mixology", "cocktail lounge", "cocktail", "mojito", "martini", "whiskey", "bourbon", "mezcal", "old fashioned", "aperol", "absinthe", "negroni", "tiki", "tiki bar"],
  "Coffee/Cafe": ["coffee shop", "cafe", "espresso", "latte", "cappuccino", "cortado", "chai latte", "cold brew", "pour over", "drip coffee", "matcha latte", "americano", "mocha", "flat white", "nitro cold brew", "juice bar", "kombucha", "afternoon tea"],
  // V22: Added "haitian" to Caribbean family — Haitian cuisine belongs with Caribbean
  "Caribbean/Jamaican": ["caribbean", "jamaican", "jamaican food", "haitian", "haitian food", "jerk chicken", "jerk", "oxtail", "oxtail stew", "curry goat", "cuban", "ropa vieja", "cubano", "plantain", "rice and peas", "ackee", "saltfish", "patties", "griyo", "griot", "diri kole", "pikliz", "tassot", "accra"],
  Polish: ["polish", "pierogi", "kielbasa", "bigos", "golabki", "potato pancake"],
  "Puerto Rican": ["puerto rican", "mofongo", "pernil", "tostones", "alcapurria", "arroz con gandules", "jibarito", "pastelillo"],
  "Southern/Soul Food": ["soul food", "southern", "southern food", "fried chicken", "collard greens", "cornbread", "gumbo", "jambalaya", "catfish", "cajun", "cajun food", "creole", "creole food", "grits", "po boy", "hush puppies", "crawfish", "hot chicken", "nashville hot", "muffuletta", "midwestern"],
  "Middle Eastern": ["middle eastern", "shawarma", "kebab", "falafel", "hummus", "baba ganoush", "pita", "lebanese", "turkish", "manakeesh", "shakshuka", "fattoush", "labneh", "kibbeh"],
  Greek: ["greek", "gyro", "souvlaki", "moussaka", "spanakopita", "tzatziki", "saganaki", "baklava"],
  Fusion: ["fusion", "eclectic", "cross-cultural"],
  "Nepalese/Tibetan": ["nepalese", "nepali", "tibetan", "momo", "momos", "dal bhat", "thukpa", "sel roti", "chatamari", "newari", "gundruk", "achar", "sekuwa", "choila", "yomari"],
  Filipino: ["filipino", "adobo", "sinigang", "lumpia", "lechon", "sisig", "kare-kare", "pancit", "halo-halo", "tocino", "longganisa", "tapa", "bibingka", "balut", "kamayan"],
  BBQ: ["bbq", "barbecue", "brisket", "ribs", "pulled pork", "smoked meat", "pitmaster", "burnt ends", "smoked", "tri-tip", "beef rib", "sausage", "hot links", "smoked chicken", "cornbread", "coleslaw"],
  Colombian: ["colombian", "arepa", "empanada", "bandeja paisa", "sancocho", "ajiaco", "patacon", "buñuelo", "pandebono", "chicharron", "almojabana", "changua", "lechona"],
  "West African": ["west african", "nigerian", "ghanaian", "senegalese", "jollof rice", "jollof", "fufu", "suya", "egusi", "pepper soup", "puff puff", "moi moi", "waakye", "thieboudienne", "yassa", "plantain chips", "liberian"],
  Sichuan: ["sichuan", "szechuan", "szechwan", "chili oil", "numbing", "mala", "hot pot", "hotpot", "mapo tofu", "dan dan", "kung pao", "twice cooked pork", "sichuan pepper", "spicy chinese"],
  Cuban: ["cuban", "cubano", "ropa vieja", "lechon asado", "croqueta", "vaca frita", "moros y cristianos", "cortadito", "cuban coffee", "cuban sandwich", "media noche", "masitas", "picadillo"],
  Taiwanese: ["taiwanese", "boba", "bubble tea", "gua bao", "beef noodle soup", "lu rou fan", "oyster omelette", "scallion pancake", "taiwanese fried chicken", "shaved ice", "night market", "popcorn chicken", "dan bing", "milk tea", "tapioca"],
  Persian: ["persian", "iranian", "tahdig", "koobideh", "ghormeh sabzi", "zereshk polo", "joojeh kebab", "ash reshteh", "fesenjan", "dizi", "sangak", "lavash", "kashk", "saffron rice", "baghali polo"],
  German: ["german", "schnitzel", "bratwurst", "pretzel", "sauerkraut", "strudel", "currywurst", "spätzle", "schweinshaxe", "kartoffelpuffer", "weisswurst", "bier", "biergarten", "beer hall", "rouladen"],
  Hawaiian: ["hawaiian", "poke bowl", "spam musubi", "loco moco", "kalua pork", "manapua", "plate lunch", "poi", "lau lau", "shave ice", "acai bowl"],
  Venezuelan: ["venezuelan", "arepa", "cachapa", "tequeño", "pabellón", "hallaca", "mandoca", "empanada venezolana", "patacón"],
  Ukrainian: ["ukrainian", "borscht", "varenyky", "holubtsi", "salo", "kovbasa", "deruny", "pampushky", "banosh"],
  Ecuadorian: ["ecuadorian", "encebollado", "llapingacho", "hornado", "ceviche ecuatoriano", "fanesca", "bolon de verde", "guatita"],
  Salvadoran: ["salvadoran", "salvadorean", "pupusa", "pupusas", "curtido", "yuca frita", "tamales de elote", "sopa de pata", "platano frito"],
  Argentine: ["argentine", "argentinean", "asado", "chimichurri", "empanada argentina", "milanesa", "choripan", "dulce de leche", "provoleta", "matambre", "parrilla"],
  Moroccan: ["moroccan", "tagine", "couscous", "pastilla", "harira", "msemen", "rfissa", "zaalouk", "chermoula", "ras el hanout"],
  Pakistani: ["pakistani", "nihari", "haleem", "chapli kebab", "seekh kebab", "karahi", "biryani", "paya", "sajji", "bun kebab", "desi"],
  Cambodian: ["cambodian", "khmer", "amok", "lok lak", "num pang", "prahok", "bai sach chrouk", "kuy teav"],
  // V23: Added Burmese cuisine — was completely missing, causing "best Burmese food" → Southern/Soul Food
  Burmese: ["burmese", "myanmar", "mohinga", "tea leaf salad", "shan noodles", "burmese tofu", "laphet thoke", "nan gyi thoke", "mont di", "kyet thar hin"],
  Laotian: ["laotian", "lao", "sticky rice", "laap", "tam mak hoong", "ping kai", "khao piak sen", "jeow bong"],
  Irish: ["irish", "shepherd's pie", "boxty", "colcannon", "bangers and mash", "soda bread", "irish stew", "guinness"],
  Spanish: ["spanish", "paella", "patatas bravas", "croquetas", "gazpacho", "churros con chocolate", "jamon", "pimientos de padron", "tortilla española", "sangria"],
  Yemeni: ["yemeni", "mandi", "saltah", "zurbian", "fahsa", "salta", "malawah", "jachnun"],
  "East African": ["east african", "somali", "eritrean", "ugandan", "injera", "suqaar", "sambusa", "kitfo", "zigni", "canjeero"],
  Malaysian: ["malaysian", "nasi lemak", "roti canai", "laksa", "char kway teow", "rendang", "satay", "hainanese chicken rice", "nasi goreng"],
  Georgian: ["georgian", "khachapuri", "khinkali", "lobio", "churchkhela", "pkhali", "badrijani"],
  "Central Asian": ["uzbek", "kazakh", "kyrgyz", "plov", "manti", "lagman", "samsa", "shashlik", "beshbarmak", "central asian"],
  // Version Alpha: Missing cuisine keywords identified from 500-case deep analysis
  Cantonese: ["cantonese", "cantonese food", "wonton noodle", "roast goose", "clay pot rice", "congee", "har gow", "siu mai", "cheung fun", "char siu", "lo mai gai", "egg tart"],
  Oaxacan: ["oaxacan", "oaxaca", "tlayuda", "mole negro", "mole oaxaqueño", "chapulines", "mezcal", "tasajo", "memela"],
  Honduran: ["honduran", "baleada", "pastelito", "catrachita", "sopa de caracol", "plato tipico hondureno"],
  Guatemalan: ["guatemalan", "pepian", "kak'ik", "chiles rellenos", "rellenitos", "hilachas"],
};

export const TAG_KEYWORDS: Record<string, string[]> = {
  byob: ["byob", "bring your own"],
  rooftop: ["rooftop", "skyline"],
  "outdoor patio": ["outdoor", "patio", "al fresco", "terrace", "sidewalk"],
  "hidden gem": ["hidden gem", "hidden", "secret"],
  "late night": ["late night", "late", "after midnight", "midnight", "24 hour"],
  "craft cocktails": ["cocktail", "mixology", "craft drinks", "martini", "whiskey", "bourbon", "mezcal", "old fashioned", "aperol", "absinthe", "espresso martini", "tequila", "mojito", "drinks", "bar", "negroni"],
  "live music": ["live music", "jazz", "band", "blues"],
  "farm-to-table": ["farm to table", "farm-to-table", "organic", "local ingredients"],
  "scenic view": ["view", "scenic", "panoramic", "waterfront", "lakefront", "river view"],
  romantic: ["romantic", "intimate", "candlelit", "cozy date"],
  trendy: ["trendy", "hip", "instagram", "modern", "stylish"],
  quiet: ["quiet", "peaceful", "calm", "serene"],
  "great value": ["cheap", "affordable", "deal", "value", "budget", "eats"],
  "brunch spot": ["brunch", "breakfast", "morning"],
  waterfront: ["waterfront", "lakefront", "riverwalk", "lake view", "river view"],
  "vegan friendly": ["vegan", "plant-based", "plant based"],
  "gluten free": ["gluten free", "celiac", "gluten-free"],
  "lively atmosphere": ["bustling", "vibrant", "energetic", "buzzing", "lively", "happening", "high energy", "animated", "festive", "sports bar", "karaoke", "nightlife", "pool hall", "fun", "party", "blues bar", "jazz bar", "funk", "soul bar", "comedy club", "arcade bar", "trivia night"],
  "craft beer": ["craft beer", "brewery", "beer garden", "tap room", "taproom", "ale house", "beer selection", "draft beer", "beer list", "beer", "pub", "pint"],
  "date spot": ["date spot", "date night spot", "romantic dinner"],
  "instagrammable": ["instagrammable", "instagram worthy", "photogenic", "aesthetic"],
  "tasting menu": ["tasting menu", "prix fixe", "multi-course", "chef's table"],
  "fine dining": ["fine dining", "upscale", "high end", "white tablecloth", "amuse bouche", "sommelier", "chef's counter", "chef's tasting", "chef driven", "chef collaboration"],
  "wine bar": ["wine bar", "wine list", "wine selection", "sommelier", "natural wine"],
  "happy hour": ["happy hour", "drink specials", "after work drinks", "happy hour food"],
  "all you can eat": ["all you can eat", "unlimited", "ayce", "buffet"],
  "counter service": ["counter service", "fast casual", "order at counter", "quick service", "counter seating"],
  "food truck": ["food truck", "street food", "food stand", "food cart", "ghost kitchen"],
  "kid friendly": ["kid friendly", "kids menu", "children", "family", "high chair"],
  "pet friendly": ["pet friendly", "dog friendly", "dogs allowed", "dog patio"],
  "private dining": ["private dining", "private room", "private event", "semi private", "buyout", "private event buyout"],
  "prix fixe": ["prix fixe", "multi-course", "tasting menu"],
  "outdoor seating": ["outdoor seating", "patio dining", "sidewalk cafe", "garden seating"],
  // V8.6: Reputation-focused tag — triggers Rule 13 weight shift for reputation-priority queries.
  // These keywords signal the user cares about quality/prestige, not a specific cuisine or vibe.
  "reputation-focused": ["best rated", "top rated", "highly rated", "award", "michelin", "james beard", "critically acclaimed", "best reviewed", "highest rated", "award-winning", "five star", "most popular", "bib gourmand", "eater 38", "eater", "infatuation", "infatuation picks"],
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
  "comfort": { cuisines: ["American"], tags: ["great value"] },
  "sandwich": { cuisines: ["American"], tags: ["great value"] },
  "salad": { tags: ["farm-to-table", "vegan friendly"] },
  "soup": { cuisines: ["Vietnamese", "Japanese"] },
  "dessert": { tags: ["trendy"] },
  "pastry": { tags: ["trendy"] },
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
  "spanish": { cuisines: ["Spanish", "Mediterranean"], tags: ["trendy"] },
  "soul food": { cuisines: ["Southern/Soul Food"], tags: ["hidden gem"] },
  "cajun": { cuisines: ["Southern/Soul Food"] },
  "creole": { cuisines: ["Southern/Soul Food"] },
  "colombian": { cuisines: ["Colombian"] },
  "west african": { cuisines: ["West African"] },
  "nigerian": { cuisines: ["West African"] },
  "ghanaian": { cuisines: ["West African"] },
  "sichuan": { cuisines: ["Sichuan", "Chinese"] },
  "szechuan": { cuisines: ["Sichuan", "Chinese"] },
  "persian": { cuisines: ["Persian", "Middle Eastern"] },
  "iranian": { cuisines: ["Persian", "Middle Eastern"] },
  "german": { cuisines: ["German"] },
  "hawaiian": { cuisines: ["Hawaiian"] },
  "venezuelan": { cuisines: ["Venezuelan"] },
  "ukrainian": { cuisines: ["Ukrainian"] },
  "ecuadorian": { cuisines: ["Ecuadorian"] },
  "salvadoran": { cuisines: ["Salvadoran"] },
  "argentine": { cuisines: ["Argentine"] },
  // V23: Removed "Mediterranean" — Moroccan food is specific. Mediterranean restaurants
  // (avec, mfk.) should NOT win "best Moroccan food". Family matching handles the fallback.
  "moroccan": { cuisines: ["Moroccan"] },
  // V23: Removed "Indian" — Pakistani food is distinct (shared South Asian family handles fallback).
  "pakistani": { cuisines: ["Pakistani"] },
  "cambodian": { cuisines: ["Cambodian"] },
  // V23: Added Burmese to INTENT_MAP
  "burmese": { cuisines: ["Burmese"] },
  "burmese food": { cuisines: ["Burmese"] },
  "myanmar": { cuisines: ["Burmese"] },
  "myanmar food": { cuisines: ["Burmese"] },
  "laotian": { cuisines: ["Laotian"] },
  "irish": { cuisines: ["Irish"] },
  "malaysian": { cuisines: ["Malaysian"] },
  "georgian": { cuisines: ["Georgian"] },
  "yemeni": { cuisines: ["Yemeni", "Middle Eastern"] },
  "somali": { cuisines: ["East African"] },
  "eritrean": { cuisines: ["East African", "Ethiopian"] },
  "uzbek": { cuisines: ["Central Asian"] },

  // --- Filipino dishes ---
  "adobo": { cuisines: ["Filipino"] },
  "sinigang": { cuisines: ["Filipino"] },
  "lumpia": { cuisines: ["Filipino"] },
  "lechon": { cuisines: ["Filipino"] },
  "sisig": { cuisines: ["Filipino"] },
  "kare-kare": { cuisines: ["Filipino"] },
  "pancit": { cuisines: ["Filipino"] },
  "halo-halo": { cuisines: ["Filipino"] },
  "kamayan": { cuisines: ["Filipino"] },
  "filipino": { cuisines: ["Filipino"] },

  // --- Colombian dishes ---
  "arepa": { cuisines: ["Colombian"] },
  "bandeja paisa": { cuisines: ["Colombian"] },
  "sancocho": { cuisines: ["Colombian"] },

  // --- Taiwanese dishes ---
  "boba": { cuisines: ["Taiwanese", "Chinese"] },
  "beef noodle soup": { cuisines: ["Taiwanese"] },

  // --- Persian dishes ---
  "tahdig": { cuisines: ["Persian", "Middle Eastern"] },
  "ghormeh sabzi": { cuisines: ["Persian", "Middle Eastern"] },
  "koobideh": { cuisines: ["Persian", "Middle Eastern"] },

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
  "fun": { tags: ["lively atmosphere", "live music", "trendy"] },
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
  "fancy": { tags: ["fine dining", "romantic"] },
  "upscale": { tags: ["fine dining", "romantic"] },
  "elegant": { tags: ["fine dining", "romantic"] },

  // --- Occasion & social context ---
  "anniversary": { tags: ["romantic", "scenic view"] },
  "celebrate": { tags: ["romantic", "trendy"] },
  "birthday": { tags: ["lively atmosphere", "craft cocktails", "private dining"] },
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
  "kids": { tags: ["kid friendly"] },
  "family": { tags: ["kid friendly", "family style dining"] },
  "group": { tags: ["great for groups"] },
  "large party": { tags: ["private dining", "great for groups"] },

  // --- Reputation / Quality ---
  "legendary": { tags: ["reputation-focused", "hidden gem"] },
  "iconic": { tags: ["reputation-focused"] },
  "famous": { tags: ["reputation-focused", "trendy"] },
  "world class": { tags: ["reputation-focused", "fine dining"] },
  "best in chicago": { tags: ["reputation-focused"] },
  "finest": { tags: ["reputation-focused", "fine dining"] },

  // --- Dining styles (gap fills) ---
  "counter dining": { tags: ["hidden gem"] },
  "counter service": { tags: ["counter service", "great value"] },
  "bar dining": { tags: ["craft cocktails"] },
  "chef's table": { tags: ["fine dining", "tasting menu"] },
  "speakeasy": { tags: ["craft cocktails", "hidden gem"] },
  "supper club": { tags: ["romantic", "fine dining"] },
  "pop up": { tags: ["trendy"] },

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
  "cheap eats": { tags: ["great value", "hidden gem", "counter service"] },
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
  "halal": { tags: ["halal"] },
  "kosher": { tags: ["kosher"] },
  "allergy": { tags: [] },

  // --- Location & seating ---
  "waterfront": { tags: ["waterfront", "scenic view"], features: ["outdoor_seating"] },
  "lakefront": { tags: ["waterfront", "scenic view"], features: ["outdoor_seating"] },
  "rooftop": { tags: ["rooftop", "scenic view"] },
  "rooftop drinks": { tags: ["rooftop", "scenic view", "craft cocktails"] },
  "skyline": { tags: ["rooftop", "scenic view"] },
  "garden": { features: ["outdoor_seating"] },
  "terrace": { features: ["outdoor_seating"] },
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
  "tamales": { cuisines: ["Mexican"] },  // V22: plural form
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
  "bao buns": { cuisines: ["Chinese"] },  // V22: explicit bigram
  "hotpot": { cuisines: ["Chinese"] },
  "hot pot": { cuisines: ["Chinese"] },
  "peking duck": { cuisines: ["Chinese"] },
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
  "cuban": { cuisines: ["Cuban", "Caribbean/Jamaican"] },
  "cuban food": { cuisines: ["Cuban", "Caribbean/Jamaican"] },
  "jamaican": { cuisines: ["Caribbean/Jamaican"] },
  "jamaican food": { cuisines: ["Caribbean/Jamaican"] },
  "filipino food": { cuisines: ["Filipino"] },
  // V23: Removed "Chinese" — Taiwanese food is distinct. Chinese restaurants should NOT
  // win "best Taiwanese food". East Asian family handles fallback.
  "taiwanese": { cuisines: ["Taiwanese"] },
  "taiwanese food": { cuisines: ["Taiwanese"] },
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
  "grain bowl": { cuisines: ["American", "Fusion"], tags: ["vegan friendly", "farm-to-table"] },
  "acai bowl": { cuisines: ["Brazilian"], tags: ["vegan friendly"] },
  "acai": { cuisines: ["Brazilian"], tags: ["vegan friendly"] },
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
  "late night eats": { tags: ["late night"] },
  "open late": { tags: ["late night"] },
  "open now": { tags: [] },
  "24 hour": { tags: ["late night"] },
  "24 hour restaurant": { tags: ["late night"] },

  // ============================================================
  // PHASE 3: 109-Gap Coverage Expansion
  // ============================================================

  // --- Missing Cuisine-Type Mappings (to closest existing categories) ---
  "bangladeshi": { cuisines: ["Indian"] },
  "bangladeshi food": { cuisines: ["Indian"] },
  // V22: Sri Lankan is NOT Indian — separate cuisine with distinct flavors (coconut milk curries,
  // hoppers, kottu roti). Map to South Asian family but keep as own target for exact matching.
  "sri lankan": { cuisines: ["Indian", "Sri Lankan"] },
  "sri lankan food": { cuisines: ["Indian", "Sri Lankan"] },
  "azerbaijani": { cuisines: ["Middle Eastern", "Georgian"] },
  "swedish": { cuisines: ["German"] },
  "kurdish": { cuisines: ["Middle Eastern"] },
  "serbian": { cuisines: ["Mediterranean"] },
  "levantine": { cuisines: ["Middle Eastern"] },
  "levantine food": { cuisines: ["Middle Eastern"] },
  "bosnian": { cuisines: ["Middle Eastern", "Mediterranean"] },
  "bosnian food": { cuisines: ["Middle Eastern", "Mediterranean"] },
  "portuguese": { cuisines: ["Mediterranean", "Spanish"] },
  "portuguese place": { cuisines: ["Mediterranean", "Spanish"] },
  "british": { cuisines: ["Irish"] },
  "british food": { cuisines: ["Irish"] },
  "israeli": { cuisines: ["Middle Eastern"] },
  "israeli place": { cuisines: ["Middle Eastern"] },
  "trinidadian": { cuisines: ["Caribbean/Jamaican"] },
  "trinidadian food": { cuisines: ["Caribbean/Jamaican"] },
  "singaporean": { cuisines: ["Malaysian"] },
  "singaporean restaurant": { cuisines: ["Malaysian"] },
  "singaporean place": { cuisines: ["Malaysian"] },
  // V23: Removed "Indian" — Afghan food is distinct from Indian. Indian restaurants should NOT
  // win "best Afghan food". Middle Eastern is the closest family match.
  "afghan": { cuisines: ["Middle Eastern"] },
  "afghan food": { cuisines: ["Middle Eastern"] },
  "afghani": { cuisines: ["Middle Eastern"] },
  "afghani food": { cuisines: ["Middle Eastern"] },
  "indonesian": { cuisines: ["Malaysian"] },
  "indonesian place": { cuisines: ["Malaysian"] },
  "indonesian food": { cuisines: ["Malaysian"] },
  "nepalese food": { cuisines: ["Nepalese/Tibetan"] },
  "nepalese": { cuisines: ["Nepalese/Tibetan"] },

  // --- Chicago-Specific Dish Intents ---
  "italian beef": { cuisines: ["American", "Italian"] },
  "gym shoe": { cuisines: ["American"] },
  "gym shoe sandwich": { cuisines: ["American"] },
  "mother-in-law": { cuisines: ["American", "Mexican"] },
  "sport peppers": { cuisines: ["American"] },
  "chicago mix popcorn": { cuisines: ["American"] },
  "chicago mix": { cuisines: ["American"] },
  "maxwell street polish": { cuisines: ["Polish", "American"] },
  "maxwell street": { cuisines: ["Polish", "American"] },
  "rainbow cone": { cuisines: ["Italian", "American"] },
  "italian ice": { cuisines: ["Italian"] },
  "south side rib tips": { cuisines: ["BBQ", "Southern/Soul Food"] },
  "rib tips": { cuisines: ["BBQ", "Southern/Soul Food"] },
  "chicago cheesesteak": { cuisines: ["American"] },
  "paczki": { cuisines: ["Polish"] },
  "kolaczki": { cuisines: ["Polish"] },

  // --- Missing Dish-to-Cuisine Mappings ---
  "eggs benedict": { cuisines: ["Brunch", "American"], tags: ["brunch spot"] },
  "french toast": { cuisines: ["Brunch", "American"], tags: ["brunch spot"] },
  "omelette": { cuisines: ["Brunch", "American"], tags: ["brunch spot"] },
  "avocado toast": { cuisines: ["Brunch", "American"], tags: ["brunch spot"] },
  "birria tacos": { cuisines: ["Mexican"] },
  "breaded steak sandwich": { cuisines: ["American"] },
  "pad thai": { cuisines: ["Thai"] },
  "butter chicken": { cuisines: ["Indian"] },
  "churros": { cuisines: ["Mexican", "Spanish"] },
  "cocktails": { tags: ["craft cocktails"] },
  "cocktails restaurant": { tags: ["craft cocktails"] },

  // --- Reputation-Specific Intents ---
  "bib gourmand": { tags: ["reputation-focused"] },
  "bib gourmand chicago": { tags: ["reputation-focused"] },
  "eater 38": { tags: ["reputation-focused", "trendy"] },
  "eater 38 chicago": { tags: ["reputation-focused", "trendy"] },
  "infatuation": { tags: ["reputation-focused", "trendy"] },
  "infatuation picks": { tags: ["reputation-focused", "trendy"] },
  "infatuation chicago": { tags: ["reputation-focused", "trendy"] },
  "infatuation chicago picks": { tags: ["reputation-focused", "trendy"] },

  // --- Occasion-Specific Intents ---
  "date night restaurant": { tags: ["romantic", "quiet"] },
  "birthday restaurant": { tags: ["trendy", "craft cocktails", "lively atmosphere"] },
  "best birthday": { tags: ["trendy", "craft cocktails", "lively atmosphere"] },
  "anniversary restaurant": { tags: ["romantic", "fine dining"] },
  "best anniversary": { tags: ["romantic", "fine dining"] },
  "business lunch": { tags: ["quiet"] },
  "business lunch restaurant": { tags: ["quiet"] },
  "casual hangout": { tags: ["great value", "lively atmosphere"] },
  "casual hangout restaurant": { tags: ["great value", "lively atmosphere"] },
  "group dinner": { tags: ["lively atmosphere"] },
  "group dinner restaurant": { tags: ["lively atmosphere"] },
  "brunch spot": { tags: ["brunch spot"] },
  "brunch restaurant": { tags: ["brunch spot"] },
  "best brunch": { tags: ["brunch spot", "reputation-focused"] },
  "best brunch restaurant": { tags: ["brunch spot", "reputation-focused"] },

  // --- Missing Dish Intents (from API error & gap analysis) ---
  "pancakes": { cuisines: ["Brunch", "American"], tags: ["brunch spot"] },
  "waffles": { cuisines: ["Brunch", "American"], tags: ["brunch spot"] },
  "waffle": { cuisines: ["Brunch", "American"], tags: ["brunch spot"] },
  "pancake": { cuisines: ["Brunch", "American"], tags: ["brunch spot"] },
  "crepes": { cuisines: ["French", "Brunch"], tags: ["brunch spot"] },
  "gelato shop": { cuisines: ["Italian"], tags: ["great value"] },

  // --- "where to get X" pattern coverage ---
  "soul food food": { cuisines: ["Southern/Soul Food"] },

  // V13: Additional INTENT_MAP entries from gap analysis (346 gaps)
  "fondue": { cuisines: ["French"], tags: ["romantic"] },
  "spanish tapas": { cuisines: ["Spanish", "Mediterranean"], tags: ["trendy"] },
  "oxtail stew": { cuisines: ["Caribbean/Jamaican", "Southern/Soul Food"] },
  "chicago style hot dog": { cuisines: ["American"] },
  "chicago hot dog": { cuisines: ["American"] },
  "wagyu beef": { cuisines: ["Japanese", "Steak"], tags: ["fine dining"] },
  "wagyu": { cuisines: ["Japanese", "Steak"], tags: ["fine dining"] },
  "pozole rojo": { cuisines: ["Mexican"] },
  "street food": { tags: ["great value", "food truck"] },
  "wrap": { cuisines: ["American"], tags: ["great value"] },
  "dairy free": { tags: ["vegan friendly"] },
  "dairy free options": { tags: ["vegan friendly"] },
  "comfort food": { cuisines: ["American", "Southern/Soul Food"], tags: ["great value"] },
  "lebanese food": { cuisines: ["Middle Eastern"] },
  "turkish food": { cuisines: ["Middle Eastern"] },
  "cajun food": { cuisines: ["Southern/Soul Food"] },
  "creole food": { cuisines: ["Southern/Soul Food"] },

  // V14: Missing INTENT_MAP entries from gap analysis (88 DondeMatch issues)
  // --- Cuisine/dish gaps ---
  "boba tea": { cuisines: ["Chinese", "Taiwanese", "Coffee/Cafe"] },
  "chicken tikka masala": { cuisines: ["Indian"] },
  "polish": { cuisines: ["Polish"] },
  "polish food": { cuisines: ["Polish"] },
  "senegalese": { cuisines: ["West African"] },
  "senegalese food": { cuisines: ["West African"] },
  "southern": { cuisines: ["Southern/Soul Food"] },
  "southern restaurant": { cuisines: ["Southern/Soul Food"] },
  "uzbek food": { cuisines: ["Central Asian"] },
  "tibetan": { cuisines: ["Nepalese/Tibetan"] },
  "tibetan food": { cuisines: ["Nepalese/Tibetan"] },
  "cajun restaurant": { cuisines: ["Southern/Soul Food"] },
  "creole restaurant": { cuisines: ["Southern/Soul Food"] },
  "creole place": { cuisines: ["Southern/Soul Food"] },
  // V15: Additional cuisine query patterns from P0 gap analysis
  "somali place": { cuisines: ["East African"] },
  "somali food": { cuisines: ["East African"] },
  "somali restaurant": { cuisines: ["East African"] },
  "eritrean food": { cuisines: ["East African", "Ethiopian"] },
  "eritrean restaurant": { cuisines: ["East African", "Ethiopian"] },
  "good eritrean": { cuisines: ["East African", "Ethiopian"] },
  "good eritrean restaurant": { cuisines: ["East African", "Ethiopian"] },
  "nigerian food": { cuisines: ["West African"] },
  "nigerian restaurant": { cuisines: ["West African"] },
  "authentic nigerian": { cuisines: ["West African"] },
  "authentic nepalese": { cuisines: ["Nepalese/Tibetan"] },
  "nepalese restaurant": { cuisines: ["Nepalese/Tibetan"] },
  "nepalese place": { cuisines: ["Nepalese/Tibetan"] },
  "authentic malaysian": { cuisines: ["Malaysian"] },
  "malaysian restaurant": { cuisines: ["Malaysian"] },
  "malaysian place": { cuisines: ["Malaysian"] },
  "good lebanese": { cuisines: ["Middle Eastern"] },
  "good lebanese restaurant": { cuisines: ["Middle Eastern"] },
  "lebanese restaurant": { cuisines: ["Middle Eastern"] },
  "lebanese place": { cuisines: ["Middle Eastern"] },
  "senegalese place": { cuisines: ["West African"] },
  "senegalese restaurant": { cuisines: ["West African"] },
  "southern food": { cuisines: ["Southern/Soul Food"] },
  "southern place": { cuisines: ["Southern/Soul Food"] },
  "creole food": { cuisines: ["Southern/Soul Food"] },
  "vegan restaurant": { tags: ["vegan friendly"] },
  "vegan food": { tags: ["vegan friendly"] },
  // --- Reputation gaps ---
  "rising star": { tags: ["reputation-focused", "fine dining"] },
  "rising star chef": { tags: ["reputation-focused", "fine dining"] },
  "chef of the year": { tags: ["reputation-focused"] },
  "40 under 40": { tags: ["reputation-focused"] },
  "most awarded": { tags: ["reputation-focused", "fine dining"] },
  "outstanding chef": { tags: ["reputation-focused", "fine dining"] },
  "magazine cover": { tags: ["reputation-focused"] },
  "chicago magazine": { tags: ["reputation-focused"] },
  "yelp": { tags: ["reputation-focused"] },
  "yelp top rated": { tags: ["reputation-focused"] },
  // --- Vibe/service gaps ---
  "dark moody bar": { tags: ["craft cocktails", "romantic"], cuisines: [] },
  "buzzing restaurant": { tags: ["lively atmosphere"] },
  "lively dinner": { tags: ["lively atmosphere"] },
  "lively dinner spot": { tags: ["lively atmosphere"] },
  "trendy sushi": { cuisines: ["Japanese"], tags: ["trendy"] },
  "trendy sushi spot": { cuisines: ["Japanese"], tags: ["trendy"] },
  "sunday morning cafe": { cuisines: ["Coffee/Cafe", "Brunch"], tags: ["brunch spot", "quiet"] },
  "sunday morning": { cuisines: ["Brunch"], tags: ["brunch spot"] },

  // V16: Additional entries from 31-issue gap analysis
  "garden restaurant": { tags: ["outdoor patio"], features: ["outdoor_seating"] },
  "garden dining": { tags: ["outdoor patio"], features: ["outdoor_seating"] },
  "family style dinner": { tags: ["kid friendly"] },
  "family style": { tags: ["kid friendly"] },
  "valet": { tags: ["fine dining"] },
  "breakfast burrito": { cuisines: ["Mexican", "Brunch"], tags: ["brunch spot"] },
  "breakfast burritos": { cuisines: ["Mexican", "Brunch"], tags: ["brunch spot"] },
  "craft cocktail bar": { tags: ["craft cocktails", "hidden gem"] },
  "best craft cocktail bar": { tags: ["craft cocktails", "reputation-focused"] },
  "best craft cocktail": { tags: ["craft cocktails", "reputation-focused"] },
  "best rooftop": { tags: ["rooftop", "scenic view", "reputation-focused"] },
  "best rooftop dining": { tags: ["rooftop", "scenic view", "reputation-focused"] },
  "best tasting menu": { tags: ["tasting menu", "fine dining", "reputation-focused"] },
  "best tasting menu in chicago": { tags: ["tasting menu", "fine dining", "reputation-focused"] },
  "tiki": { tags: ["craft cocktails", "lively atmosphere"] },
  "tiki bar": { tags: ["craft cocktails", "lively atmosphere"] },
  "speakeasy bar": { tags: ["craft cocktails", "hidden gem"] },

  // Version Alpha: 40+ missing INTENT_MAP entries from 500-case deep analysis
  // Cuisine gaps (queries falling to open_ended)
  "cantonese": { cuisines: ["Cantonese", "Chinese"] },
  "cantonese food": { cuisines: ["Cantonese", "Chinese"] },
  "cantonese restaurant": { cuisines: ["Cantonese", "Chinese"] },
  "oaxacan": { cuisines: ["Oaxacan", "Mexican"] },
  "oaxacan food": { cuisines: ["Oaxacan", "Mexican"] },
  "oaxacan restaurant": { cuisines: ["Oaxacan", "Mexican"] },
  "argentinian": { cuisines: ["Argentine"] },
  "argentinian food": { cuisines: ["Argentine"] },
  "argentinian restaurant": { cuisines: ["Argentine"] },
  "empanadas": { cuisines: ["Argentine", "Colombian", "Mexican"] },
  "empanada": { cuisines: ["Argentine", "Colombian", "Mexican"] },
  "bone marrow": { cuisines: ["Steak", "French"] },
  "burrata": { cuisines: ["Italian"] },
  "truffle fries": { cuisines: ["French", "American"] },
  "beef tartare": { cuisines: ["French", "Steak"] },
  "pork belly": { cuisines: ["American", "Korean", "Chinese"] },
  "oysters": { cuisines: ["Seafood"], tags: ["fine dining"] },
  "croissant": { cuisines: ["French"], tags: ["brunch spot"] },
  "eggs benedict": { cuisines: ["American", "Brunch"], tags: ["brunch spot"] },

  // Constraint gaps (queries falling to open_ended)
  "kosher": { tags: ["great value"] },
  "kosher restaurant": { tags: ["great value"] },
  "keto": { tags: ["great value"] },
  "keto friendly": { tags: ["vegan friendly"] },
  "paleo": { tags: ["farm-to-table"] },
  "paleo options": { tags: ["farm-to-table"] },
  "buffet": { tags: ["all you can eat"] },
  "buffet restaurant": { tags: ["all you can eat"] },
  "counter": { tags: ["counter service"] },
  "delivery": { tags: ["great value"] },
  "delivery nearby": { tags: ["great value"] },
  "takeout": { tags: ["great value"] },
  "dine in": { tags: ["great value"] },
  "nut free": { tags: ["great value"] },
  "nut free restaurant": { tags: ["great value"] },
  "dairy free": { tags: ["vegan friendly"] },
  "air conditioned": { tags: ["quiet"] },
  "heated patio": { tags: ["outdoor patio"] },
  "parking": { tags: ["great value"] },
  "valet": { tags: ["fine dining"] },

  // Vibe gaps
  "waterfront": { tags: ["waterfront", "scenic view"] },
  "waterfront dining": { tags: ["waterfront", "scenic view"] },
  "scenic": { tags: ["scenic view", "rooftop"] },
  "scenic views": { tags: ["scenic view", "rooftop"] },
  "hipster": { tags: ["trendy", "hidden gem"] },
  "hipster spot": { tags: ["trendy", "hidden gem"] },
  "funky": { tags: ["trendy", "lively atmosphere"] },
  "eclectic": { tags: ["trendy", "hidden gem"] },
  "funky eclectic": { tags: ["trendy", "lively atmosphere", "hidden gem"] },
  "arcade": { tags: ["lively atmosphere"] },
  "arcade bar": { tags: ["lively atmosphere", "craft beer"] },
  "activities": { tags: ["lively atmosphere"] },

  // Service/occasion gaps
  "networking": { tags: ["fine dining"] },
  "networking dinner": { tags: ["fine dining"] },
  "post-game": { tags: ["lively atmosphere", "craft beer"] },
  "post game": { tags: ["lively atmosphere", "craft beer"] },
  "pre-game": { tags: ["lively atmosphere"] },
  "comfort food": { cuisines: ["American", "Southern/Soul Food"], tags: ["great value"] },
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
