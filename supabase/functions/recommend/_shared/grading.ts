/**
 * DondeAI Score Validation Grading — Server-side computation
 * Mirrors cc-grading.js logic for live production monitoring.
 *
 * Two independent grades:
 *   1. Score Fit: Does the DondeScore accurately reflect restaurant-query fit?
 *   2. Blurb Quality: Is the recommendation text high-quality and relevant?
 */

// ═══════════════════════════════════════════════════════════════════
// Letter Grade Mapping
// ═══════════════════════════════════════════════════════════════════

function letterGrade(score: number): string {
  if (score >= 97) return "A+";
  if (score >= 93) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B-";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C-";
  if (score >= 60) return "D";
  return "F";
}

// ═══════════════════════════════════════════════════════════════════
// Query Intent Classification
// ═══════════════════════════════════════════════════════════════════

const CUISINE_MAP: Record<string, string[]> = {
  italian: ["italian", "pasta", "pizza", "risotto"],
  japanese: ["japanese", "sushi", "ramen", "izakaya", "omakase", "tempura", "udon"],
  chinese: ["chinese", "dim sum", "dumpling", "szechuan", "sichuan", "cantonese", "wonton"],
  korean: ["korean", "bibimbap", "bulgogi", "kimchi"],
  mexican: ["mexican", "taco", "burrito", "enchilada", "mole", "tamale"],
  thai: ["thai", "pad thai", "curry", "tom yum"],
  indian: ["indian", "tikka", "biryani", "naan", "samosa", "vindaloo", "masala"],
  french: ["french", "bistro", "brasserie", "fondue", "crêpe", "croissant"],
  mediterranean: ["mediterranean", "greek", "hummus", "falafel", "shawarma"],
  american: ["american", "burger", "bbq", "barbecue", "steakhouse", "wings"],
  seafood: ["seafood", "lobster", "crab", "oyster", "fish"],
  caribbean: ["caribbean", "jamaican", "cuban", "jerk"],
  vietnamese: ["vietnamese", "pho", "banh mi"],
  ethiopian: ["ethiopian", "injera"],
  peruvian: ["peruvian", "ceviche"],
  taiwanese: ["taiwanese", "boba"],
  southern: ["southern", "soul food", "fried chicken", "hot chicken"],
};

const VIBE_KEYWORDS = [
  "rooftop", "speakeasy", "dive bar", "jazz", "tiki", "karaoke", "cozy",
  "romantic", "date night", "upscale", "casual", "trendy", "chill",
  "lively", "intimate", "hidden", "outdoor", "patio", "garden",
  "sports bar", "lounge", "cocktail", "wine bar",
];

const SERVICE_KEYWORDS = [
  "brunch", "happy hour", "prix fixe", "tasting menu", "omakase",
  "byob", "delivery", "takeout", "catering", "private dining",
  "group", "large party", "family", "kid friendly", "dog friendly",
  "outdoor seating", "valet", "walk-in", "reservation", "late night",
  "bottomless", "power lunch", "business",
];

interface QueryIntent {
  type: string;
  cuisine?: string;
  dish?: string;
  keywords: string[];
}

function classifyQueryIntent(query: string): QueryIntent {
  const q = query.toLowerCase();

  for (const [cuisine, keywords] of Object.entries(CUISINE_MAP)) {
    if (keywords.some((kw) => q.includes(kw))) {
      return { type: "cuisine", cuisine, keywords: keywords.filter((kw) => q.includes(kw)) };
    }
  }

  const dishPatterns = [
    "deep dish", "thin crust", "smash burger", "grain bowl", "acai",
    "charcuterie", "fondue", "hand roll", "soup dumpling", "truffle",
    "lobster bisque", "fried chicken", "hot chicken",
  ];
  const dishMatch = dishPatterns.find((d) => q.includes(d));
  if (dishMatch) return { type: "dish", dish: dishMatch, keywords: [dishMatch] };

  const vibeMatch = VIBE_KEYWORDS.filter((v) => q.includes(v));
  if (vibeMatch.length > 0) return { type: "vibe", keywords: vibeMatch };

  const serviceMatch = SERVICE_KEYWORDS.filter((s) => q.includes(s));
  if (serviceMatch.length > 0) return { type: "service", keywords: serviceMatch };

  return { type: "general", keywords: q.split(/\s+/).filter((w) => w.length > 3) };
}

// ═══════════════════════════════════════════════════════════════════
// Score Fit Grade
// ═══════════════════════════════════════════════════════════════════

export function computeScoreFitGrade(
  query: string,
  responseBody: Record<string, unknown>,
): { score: number; grade: string } {
  let total = 0;

  const scoring = (responseBody.scoring_v9 || responseBody.scores || {}) as Record<string, unknown>;
  const dm = (responseBody.donde_match as number) || 0;
  const narrative = (responseBody.match_narrative || {}) as Record<string, unknown>;
  const restaurant = (responseBody.restaurant || {}) as Record<string, unknown>;
  const intent = classifyQueryIntent(query);

  // Check 1: Relevance type alignment (30 pts)
  const relType = ((scoring.relevance_type as string) || "").toLowerCase();
  let relPoints = 0;

  if (intent.type === "dish") {
    if (relType === "dish" || relType === "dish_match") relPoints = 30;
    else if (relType === "cuisine" || relType === "cuisine_match") relPoints = 15;
    else relPoints = 5;
  } else if (intent.type === "cuisine") {
    if (relType === "cuisine" || relType === "cuisine_match") relPoints = 30;
    else if (relType === "dish" || relType === "dish_match") relPoints = 15;
    else relPoints = 5;
  } else if (intent.type === "vibe") {
    if (relType === "vibe" || relType.includes("vibe") || relType.includes("atmosphere")) relPoints = 30;
    else if (relType.includes("semantic") || relType.includes("concept")) relPoints = 20;
    else relPoints = 10;
  } else if (intent.type === "service") {
    if (relType.includes("service") || relType.includes("feature") || relType.includes("semantic")) relPoints = 30;
    else relPoints = 15;
  } else {
    relPoints = 20;
  }
  total += relPoints;

  // Check 2: Cuisine match (25 pts)
  let cuisinePoints = 0;
  if (intent.type === "cuisine" || intent.type === "dish") {
    const restCuisine = ((restaurant.cuisine_type as string) || "").toLowerCase();
    if (intent.cuisine) {
      if (restCuisine.includes(intent.cuisine) || intent.keywords.some((kw) => restCuisine.includes(kw))) {
        cuisinePoints = 25;
      } else {
        const families: Record<string, string[]> = {
          chinese: ["taiwanese", "dim sum"],
          italian: ["pizza"],
          american: ["burger", "bbq", "southern"],
          caribbean: ["jamaican", "cuban"],
        };
        const family = families[intent.cuisine] || [];
        cuisinePoints = family.some((f) => restCuisine.includes(f)) ? 15 : 0;
      }
    } else if (intent.dish) {
      const dishCuisineMap: Record<string, string[]> = {
        "deep dish": ["italian", "pizza", "american"],
        "soup dumpling": ["chinese", "taiwanese", "dim sum"],
        "hand roll": ["japanese", "sushi"],
        "truffle": ["italian", "french", "american"],
        "lobster bisque": ["seafood", "french", "american"],
        "smash burger": ["american", "burger"],
        "fondue": ["french", "swiss"],
        "charcuterie": ["french", "italian", "wine"],
        "acai": ["brazilian", "health", "juice", "cafe"],
        "grain bowl": ["health", "cafe", "american"],
        "fried chicken": ["american", "southern", "korean"],
        "hot chicken": ["american", "southern"],
      };
      const expected = dishCuisineMap[intent.dish] || [];
      cuisinePoints = expected.length === 0 || expected.some((e) => restCuisine.includes(e)) ? 25 : 5;
    }
  } else {
    cuisinePoints = 25;
  }
  total += cuisinePoints;

  // Check 3: Dominant factor alignment (25 pts)
  let factorPoints = 0;
  const food = Number(scoring.food) || 0;
  const vibe = Number(scoring.vibe) || 0;
  const service = Number(scoring.service) || 0;
  const maxFactor = Math.max(food, vibe, service);

  if (intent.type === "dish" || intent.type === "cuisine") {
    if (food === maxFactor && food >= 6) factorPoints = 25;
    else if (food >= 6) factorPoints = 15;
    else if (food >= 4) factorPoints = 5;
  } else if (intent.type === "vibe") {
    if (vibe === maxFactor && vibe >= 6) factorPoints = 25;
    else if (vibe >= 6) factorPoints = 15;
    else if (vibe >= 4) factorPoints = 5;
  } else if (intent.type === "service") {
    if (service === maxFactor && service >= 6) factorPoints = 25;
    else if (service >= 6) factorPoints = 15;
    else if (service >= 4) factorPoints = 5;
  } else {
    factorPoints = maxFactor >= 6 ? 20 : 10;
  }
  total += factorPoints;

  // Check 4: Score compression penalty (10 pts)
  let compressionPoints = 0;
  const relScore = Number(scoring.relevance_score) || 0;
  if (dm >= 70 && dm <= 85 && relScore < 0.6) {
    compressionPoints = 0;
  } else if (relScore >= 0.8) {
    compressionPoints = 10;
  } else {
    compressionPoints = Math.round((relScore - 0.5) * 33.3);
    compressionPoints = Math.max(0, Math.min(10, compressionPoints));
  }
  total += compressionPoints;

  // Check 5: Weak spots coherence (10 pts)
  let weakPoints = 0;
  const weakSpots = narrative.weak_spots;
  const hasWeakSpots = weakSpots && (Array.isArray(weakSpots) ? weakSpots.length > 0 : !!weakSpots);

  if (!hasWeakSpots) {
    weakPoints = 10;
  } else if (hasWeakSpots && dm >= 80) {
    weakPoints = 5;
  } else {
    weakPoints = 10;
  }
  total += weakPoints;

  return { score: total, grade: letterGrade(total) };
}

// ═══════════════════════════════════════════════════════════════════
// Blurb Quality Grade
// ═══════════════════════════════════════════════════════════════════

const BANNED_PATTERNS = [
  "hidden gem", "best-kept secret", "culinary journey", "taste buds", "flavor explosion",
  "mouthwatering", "delectable", "delightful", "exquisite", "impeccable", "nestled",
  "tucked away", "foodie", "gastronomic", "epicurean", "palate", "tantalizing",
  "sumptuous", "delicacy", "indulge", "savor every", "feast for", "a cut above",
  "second to none", "worth every penny", "not to be missed", "a must-visit",
  "you won't regret", "look no further", "stands out from", "elevate your",
  "take your taste", "redefine", "reimagine", "transcend", "next level",
  "game changer", "game-changer", "blown away", "pleasantly surprised",
  "exceeded expectations", "won't disappoint", "never disappoints", "consistently delivers",
  "truly special", "something special", "one-of-a-kind", "like no other",
  "in the heart of", "bustling", "vibrant scene", "warm and inviting",
  "cozy atmosphere", "welcoming ambiance", "rustic charm", "elegant setting",
  "step into", "transport you", "whisk you away", "escape to",
  "perfect blend", "harmonious", "symphony of", "dance of flavors",
  "artfully crafted", "lovingly prepared", "passion for", "dedication to",
  "attention to detail", "craft", "artisan",
  "\u2014",
];

export function computeBlurbQualityGrade(
  query: string,
  responseBody: Record<string, unknown>,
): { score: number; grade: string } {
  let total = 0;

  const blurb = (responseBody.recommendation as string) || "";
  const blurbLower = blurb.toLowerCase();
  const intent = classifyQueryIntent(query);

  // Check 1: Slop-free (25 pts)
  const slopHits = BANNED_PATTERNS.filter((p) => blurbLower.includes(p.toLowerCase()));
  let slopPoints: number;
  if (slopHits.length === 0) slopPoints = 25;
  else if (slopHits.length === 1) slopPoints = 15;
  else if (slopHits.length === 2) slopPoints = 5;
  else slopPoints = 0;
  total += slopPoints;

  // Check 2: Query relevance (25 pts)
  const queryWords = intent.keywords || query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const stopWords = ["best", "good", "great", "nice", "find", "want", "looking", "near", "restaurant", "food", "place", "chicago"];
  const significantWords = queryWords.filter((w) => !stopWords.includes(w));

  let relevancePoints = 0;
  if (significantWords.length === 0) {
    relevancePoints = 15;
  } else {
    const matchCount = significantWords.filter((w) => blurbLower.includes(w.toLowerCase())).length;
    const matchRatio = matchCount / significantWords.length;
    if (matchRatio >= 0.8) relevancePoints = 25;
    else if (matchRatio >= 0.5) relevancePoints = 15;
    else if (matchRatio >= 0.2) relevancePoints = 5;
    else relevancePoints = 0;
  }
  total += relevancePoints;

  // Check 3: Restaurant specificity (20 pts)
  const specificitySignals: string[] = [];
  const restaurant = (responseBody.restaurant || {}) as Record<string, unknown>;
  const restName = ((restaurant.name as string) || "").toLowerCase();
  if (restName && blurbLower.includes(restName.split(/\s+/)[0])) specificitySignals.push("name");
  if (/\$\d+|\d{4}|rated \d|\d\.\d/.test(blurb)) specificitySignals.push("specifics");
  const properNouns = blurb.match(/(?<=[.!?]\s+|,\s+)\b[A-Z][a-z]+\b/g) || [];
  if (properNouns.length > 0) specificitySignals.push("proper_nouns");
  const specificAdj = ["charred", "crispy", "smoky", "tangy", "spicy", "creamy", "buttery", "flaky", "tender", "rich", "bright", "bold"];
  if (specificAdj.some((adj) => blurbLower.includes(adj))) specificitySignals.push("descriptive");
  const neighborhoods = ["west loop", "lincoln park", "wicker park", "logan square", "river north", "old town", "lakeview", "pilsen", "hyde park", "bucktown", "andersonville", "chinatown", "bridgeport", "ukrainian village"];
  if (neighborhoods.some((n) => blurbLower.includes(n))) specificitySignals.push("neighborhood");

  let specificityPoints: number;
  if (specificitySignals.length >= 3) specificityPoints = 20;
  else if (specificitySignals.length === 2) specificityPoints = 15;
  else if (specificitySignals.length === 1) specificityPoints = 10;
  else specificityPoints = 5;
  total += specificityPoints;

  // Check 4: Voice compliance — "we"/"our" (15 pts)
  const hasVoice = /\bwe\b|\bour\b/i.test(blurb);
  total += hasVoice ? 15 : 0;

  // Check 5: Word count (15 pts)
  const wordCount = blurb.split(/\s+/).filter((w) => w.length > 0).length;
  let wordPoints: number;
  if (wordCount >= 100 && wordCount <= 120) wordPoints = 15;
  else if (wordCount >= 80 && wordCount <= 130) wordPoints = 10;
  else if (wordCount >= 60 && wordCount <= 150) wordPoints = 5;
  else wordPoints = 0;
  total += wordPoints;

  return { score: total, grade: letterGrade(total) };
}
