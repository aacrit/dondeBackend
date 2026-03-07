/**
 * Chicago Search Atlas Generator
 * Generates 5-10K queries from taxonomy dimensions for Donde Gauntlet testing.
 *
 * Usage: npx tsx pipelines/generate-search-atlas.ts [--tier N] [--output path]
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data", "taxonomy");
const TESTS_DIR = join(__dirname, "..", "..", "tests");

// ─── Load taxonomy configs ───────────────────────────────────────────────────

function loadJSON(filename: string) {
  return JSON.parse(readFileSync(join(DATA_DIR, filename), "utf-8"));
}

const cuisinesConfig = loadJSON("cuisines.json");
const dishesConfig = loadJSON("dishes.json");
const neighborhoodsConfig = loadJSON("neighborhoods.json");
const vibesConfig = loadJSON("vibes.json");
const occasionsConfig = loadJSON("occasions.json");
const constraintsConfig = loadJSON("constraints.json");
const modifiersConfig = loadJSON("modifiers.json");
const slangConfig = loadJSON("slang.json");
const chicagoConfig = loadJSON("chicago-specific.json");
const scenariosConfig = loadJSON("scenarios.json");

// ─── Types ───────────────────────────────────────────────────────────────────

interface AtlasQuery {
  id: string;
  tier: number;
  category: string;
  subcategory: string;
  query: string;
  params: {
    special_request: string;
    occasion: string;
    neighborhood: string;
    price_level: string;
    dietary_restrictions: string[];
    time_of_day: string | null;
  };
  expected_signals: {
    cuisines?: string[];
    dishes?: string[];
    vibes?: string[];
    relevance_type?: string;
    min_score?: number;
    neighborhood?: string;
  };
  search_volume_estimate: "high" | "medium" | "low";
  tags: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let queryCounter = 0;

function makeId(tier: number, category: string): string {
  queryCounter++;
  return `T${tier}-${category}-${String(queryCounter).padStart(4, "0")}`;
}

function defaultParams(specialRequest: string): AtlasQuery["params"] {
  return {
    special_request: specialRequest,
    occasion: "Any",
    neighborhood: "Anywhere",
    price_level: "Any",
    dietary_restrictions: [],
    time_of_day: null,
  };
}

function stemTokens(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function jaccardSimilarity(a: string, b: string): number {
  const aTokens = new Set(stemTokens(a));
  const bTokens = new Set(stemTokens(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const t of aTokens) if (bTokens.has(t)) intersection++;
  const union = new Set([...aTokens, ...bTokens]).size;
  return intersection / union;
}

/** Sample N items from array (Fisher-Yates) */
function sample<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

/** Pick random item from array */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── All cuisines flat list ──────────────────────────────────────────────────

function getAllCuisines(): { name: string; family: string; volume: string }[] {
  const result: { name: string; family: string; volume: string }[] = [];
  for (const [family, data] of Object.entries(cuisinesConfig.families) as [string, any][]) {
    for (const cuisine of data.cuisines) {
      result.push({ name: cuisine, family, volume: data.search_volume });
    }
  }
  return result;
}

function getAllDishes(): { name: string; cuisine: string; volume: string }[] {
  const result: { name: string; cuisine: string; volume: string }[] = [];
  for (const [category, data] of Object.entries(dishesConfig) as [string, any][]) {
    if (category === "query_templates") continue;
    for (const dish of data.dishes) {
      result.push({ name: dish.name, cuisine: dish.cuisine, volume: data.search_volume });
    }
  }
  return result;
}

const allCuisines = getAllCuisines();
const allDishes = getAllDishes();
const allNeighborhoods = neighborhoodsConfig.canonical;
const allVibes = vibesConfig.vibes;
const allOccasions = occasionsConfig.occasions;
const allConstraints = constraintsConfig.constraints;
const allModifiers = modifiersConfig.modifiers;

// ─── Tier 0: Existing 1000 queries ──────────────────────────────────────────

function generateTier0(): AtlasQuery[] {
  const queries: AtlasQuery[] = [];
  const datasetPath = join(__dirname, "..", "..", "docs", "Chicago Common Searches [Critical DATASET]");

  if (!existsSync(datasetPath)) {
    console.warn("⚠ Tier 0: Chicago Common Searches dataset not found, skipping");
    return queries;
  }

  const lines = readFileSync(datasetPath, "utf-8").split("\n").filter((l) => l.trim());

  const dataLines = lines.slice(1); // Skip header row
  for (const line of dataLines) {
    // Parse CSV: split on "," delimiter — last field may contain commas/semicolons
    const parts = line.split('","').map((s: string) => s.replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;
    const [category, query] = parts;
    queries.push({
      id: makeId(0, "GOLD"),
      tier: 0,
      category: category.toLowerCase(),
      subcategory: "gold_standard",
      query,
      params: defaultParams(query),
      expected_signals: { min_score: 50 },
      search_volume_estimate: "high",
      tags: ["tier0", "gold_standard", category.toLowerCase()],
    });
  }

  return queries;
}

// ─── Tier 1: Core Singles ────────────────────────────────────────────────────

function generateTier1(): AtlasQuery[] {
  const queries: AtlasQuery[] = [];

  // Cuisine queries (~200)
  for (const cuisine of allCuisines) {
    const templates = cuisinesConfig.query_templates;
    const template = pick(templates) as string;
    const query = template.replace("{cuisine}", cuisine.name);
    queries.push({
      id: makeId(1, "CUI"),
      tier: 1,
      category: "cuisine",
      subcategory: cuisine.family.toLowerCase().replace(/\s+/g, "_"),
      query,
      params: defaultParams(query),
      expected_signals: { cuisines: [cuisine.name], relevance_type: "cuisine", min_score: 55 },
      search_volume_estimate: cuisine.volume as any,
      tags: ["tier1", "cuisine", cuisine.name.toLowerCase()],
    });
  }

  // Additional cuisine query variations for high-volume cuisines
  const highVolumeCuisines = allCuisines.filter((c) => c.volume === "high");
  for (const cuisine of highVolumeCuisines) {
    const templates = cuisinesConfig.query_templates;
    for (const template of sample(templates, 2)) {
      const query = (template as string).replace("{cuisine}", cuisine.name);
      if (queries.some((q) => q.query === query)) continue;
      queries.push({
        id: makeId(1, "CUI"),
        tier: 1,
        category: "cuisine",
        subcategory: cuisine.family.toLowerCase().replace(/\s+/g, "_"),
        query,
        params: defaultParams(query),
        expected_signals: { cuisines: [cuisine.name], relevance_type: "cuisine", min_score: 55 },
        search_volume_estimate: "high",
        tags: ["tier1", "cuisine", cuisine.name.toLowerCase()],
      });
    }
  }

  // Dish queries (~200)
  for (const dish of allDishes) {
    const templates = dishesConfig.query_templates;
    const template = pick(templates) as string;
    const query = template.replace("{dish}", dish.name);
    queries.push({
      id: makeId(1, "DSH"),
      tier: 1,
      category: "dish",
      subcategory: dish.cuisine.toLowerCase().replace(/[\/\s]+/g, "_"),
      query,
      params: defaultParams(query),
      expected_signals: { dishes: [dish.name], relevance_type: "dish", min_score: 55 },
      search_volume_estimate: dish.volume as any,
      tags: ["tier1", "dish", dish.name.toLowerCase().replace(/\s+/g, "_")],
    });
  }

  // Vibe queries (~120)
  for (const vibe of allVibes) {
    const templates = vibesConfig.query_templates;
    for (const template of sample(templates, 3)) {
      const query = (template as string).replace("{vibe}", vibe.name);
      queries.push({
        id: makeId(1, "VIB"),
        tier: 1,
        category: "vibe",
        subcategory: vibe.name.replace(/\s+/g, "_"),
        query,
        params: defaultParams(query),
        expected_signals: { vibes: [vibe.name], relevance_type: "vibe", min_score: 45 },
        search_volume_estimate: vibe.search_volume,
        tags: ["tier1", "vibe", vibe.name.replace(/\s+/g, "_")],
      });
    }
  }

  // Occasion queries (~72)
  for (const occ of allOccasions) {
    const templates = occasionsConfig.query_templates;
    for (const template of sample(templates, 3)) {
      const query = (template as string).replace("{occasion}", occ.name);
      queries.push({
        id: makeId(1, "OCC"),
        tier: 1,
        category: "occasion",
        subcategory: occ.name.replace(/\s+/g, "_"),
        query,
        params: { ...defaultParams(query), occasion: occ.api_value || "Any" },
        expected_signals: { relevance_type: "vibe", min_score: 45 },
        search_volume_estimate: occ.search_volume,
        tags: ["tier1", "occasion", occ.name.replace(/\s+/g, "_")],
      });
    }
  }

  // Chicago-specific queries (~50)
  for (const item of chicagoConfig.chicago_terms) {
    queries.push({
      id: makeId(1, "CHI"),
      tier: 1,
      category: "chicago_specific",
      subcategory: item.type,
      query: item.term,
      params: defaultParams(item.term),
      expected_signals: { min_score: 50 },
      search_volume_estimate: item.search_volume,
      tags: ["tier1", "chicago_specific"],
    });
  }
  for (const item of chicagoConfig.chicago_events) {
    queries.push({
      id: makeId(1, "CHI"),
      tier: 1,
      category: "chicago_specific",
      subcategory: item.type,
      query: item.term,
      params: defaultParams(item.term),
      expected_signals: { neighborhood: item.neighborhood_hint, min_score: 40 },
      search_volume_estimate: item.search_volume,
      tags: ["tier1", "chicago_specific", "event"],
    });
  }
  for (const item of chicagoConfig.chicago_cultural_food) {
    queries.push({
      id: makeId(1, "CHI"),
      tier: 1,
      category: "chicago_specific",
      subcategory: "cultural",
      query: item.term,
      params: defaultParams(item.term),
      expected_signals: { cuisines: item.cuisine_hint, min_score: 50 },
      search_volume_estimate: item.search_volume,
      tags: ["tier1", "chicago_specific", "cultural"],
    });
  }

  // Reputation queries (~40)
  const reputationQueries = [
    "michelin star restaurants", "james beard winner chicago", "best restaurant in chicago",
    "bib gourmand chicago", "eater 38 chicago", "michelin recommended", "award winning restaurant",
    "best new restaurant chicago", "critically acclaimed", "world class dining chicago",
    "top rated restaurant", "most popular restaurant chicago", "best chef in chicago",
    "finest dining chicago", "legendary restaurant chicago", "famous restaurant chicago",
    "best food in chicago", "five star restaurant chicago", "best reviewed restaurant",
    "premier dining chicago", "best pizza chicago", "best burger chicago", "best sushi chicago",
    "best steak chicago", "best brunch chicago", "best tacos chicago", "best ramen chicago",
    "best cocktail bar chicago", "best seafood chicago", "best bbq chicago",
    "best vegan restaurant chicago", "best thai chicago", "best korean chicago",
    "best italian chicago", "best mexican chicago", "best indian chicago",
    "best french chicago", "best japanese chicago", "infatuation chicago picks",
    "chicago tribune best restaurants",
  ];
  for (const query of reputationQueries) {
    queries.push({
      id: makeId(1, "REP"),
      tier: 1,
      category: "reputation",
      subcategory: "awards",
      query,
      params: defaultParams(query),
      expected_signals: { relevance_type: "reputation", min_score: 55 },
      search_volume_estimate: "high",
      tags: ["tier1", "reputation"],
    });
  }

  return queries;
}

// ─── Tier 2: Two-Dimension Combos ───────────────────────────────────────────

function generateTier2(): AtlasQuery[] {
  const queries: AtlasQuery[] = [];

  // Cuisine × Neighborhood (500)
  const cuisineNeighPairs: AtlasQuery[] = [];
  for (const cuisine of allCuisines) {
    for (const hood of allNeighborhoods) {
      const query = `${cuisine.name} in ${hood.name}`;
      cuisineNeighPairs.push({
        id: makeId(2, "CxN"),
        tier: 2,
        category: "cuisine_x_neighborhood",
        subcategory: `${cuisine.family}_${hood.name}`.toLowerCase().replace(/\s+/g, "_"),
        query,
        params: defaultParams(query),
        expected_signals: { cuisines: [cuisine.name], neighborhood: hood.name, relevance_type: "cuisine", min_score: 45 },
        search_volume_estimate: (cuisine.volume === "high" && hood.search_volume === "high" ? "high" : "medium") as any,
        tags: ["tier2", "cuisine_x_neighborhood", cuisine.name.toLowerCase()],
      });
    }
  }
  queries.push(...sample(cuisineNeighPairs, 500));

  // Cuisine × Occasion (400)
  const cuisineOccPairs: AtlasQuery[] = [];
  for (const cuisine of allCuisines) {
    for (const occ of allOccasions) {
      const query = `${cuisine.name} ${occ.name}`;
      cuisineOccPairs.push({
        id: makeId(2, "CxO"),
        tier: 2,
        category: "cuisine_x_occasion",
        subcategory: `${cuisine.name}_${occ.name}`.toLowerCase().replace(/\s+/g, "_"),
        query,
        params: { ...defaultParams(query), occasion: occ.api_value || "Any" },
        expected_signals: { cuisines: [cuisine.name], min_score: 45 },
        search_volume_estimate: "medium",
        tags: ["tier2", "cuisine_x_occasion"],
      });
    }
  }
  queries.push(...sample(cuisineOccPairs, 400));

  // Cuisine × Vibe (400)
  const cuisineVibePairs: AtlasQuery[] = [];
  for (const cuisine of allCuisines) {
    for (const vibe of allVibes) {
      const query = `${vibe.name} ${cuisine.name}`;
      cuisineVibePairs.push({
        id: makeId(2, "CxV"),
        tier: 2,
        category: "cuisine_x_vibe",
        subcategory: `${cuisine.name}_${vibe.name}`.toLowerCase().replace(/\s+/g, "_"),
        query,
        params: defaultParams(query),
        expected_signals: { cuisines: [cuisine.name], vibes: [vibe.name], min_score: 45 },
        search_volume_estimate: "medium",
        tags: ["tier2", "cuisine_x_vibe"],
      });
    }
  }
  queries.push(...sample(cuisineVibePairs, 400));

  // Dish × Modifier (400)
  const dishModPairs: AtlasQuery[] = [];
  for (const dish of allDishes) {
    for (const mod of allModifiers) {
      const query = `${mod.name} ${dish.name}`;
      dishModPairs.push({
        id: makeId(2, "DxM"),
        tier: 2,
        category: "dish_x_modifier",
        subcategory: mod.name,
        query,
        params: defaultParams(query),
        expected_signals: { dishes: [dish.name], min_score: 45 },
        search_volume_estimate: "medium",
        tags: ["tier2", "dish_x_modifier"],
      });
    }
  }
  queries.push(...sample(dishModPairs, 400));

  // Cuisine × Constraint (300)
  const cuisineConstPairs: AtlasQuery[] = [];
  for (const cuisine of allCuisines) {
    for (const constraint of allConstraints) {
      const query = `${constraint.name} ${cuisine.name}`;
      cuisineConstPairs.push({
        id: makeId(2, "CxC"),
        tier: 2,
        category: "cuisine_x_constraint",
        subcategory: constraint.name.replace(/\s+/g, "_"),
        query,
        params: defaultParams(query),
        expected_signals: { cuisines: [cuisine.name], min_score: 40 },
        search_volume_estimate: "medium",
        tags: ["tier2", "cuisine_x_constraint"],
      });
    }
  }
  queries.push(...sample(cuisineConstPairs, 300));

  // Neighborhood × Vibe (140)
  for (const hood of allNeighborhoods) {
    for (const vibe of sample(allVibes, 5)) {
      const query = `${vibe.name} restaurant ${hood.name}`;
      queries.push({
        id: makeId(2, "NxV"),
        tier: 2,
        category: "neighborhood_x_vibe",
        subcategory: hood.name.toLowerCase().replace(/\s+/g, "_"),
        query,
        params: defaultParams(query),
        expected_signals: { vibes: [vibe.name], neighborhood: hood.name, min_score: 40 },
        search_volume_estimate: "medium",
        tags: ["tier2", "neighborhood_x_vibe"],
      });
    }
  }

  // Occasion × Neighborhood (160)
  for (const occ of allOccasions) {
    for (const hood of sample(allNeighborhoods, 14)) {
      const query = `${occ.name} ${hood.name}`;
      queries.push({
        id: makeId(2, "OxN"),
        tier: 2,
        category: "occasion_x_neighborhood",
        subcategory: occ.name.replace(/\s+/g, "_"),
        query,
        params: { ...defaultParams(query), occasion: occ.api_value || "Any" },
        expected_signals: { neighborhood: hood.name, min_score: 40 },
        search_volume_estimate: "medium",
        tags: ["tier2", "occasion_x_neighborhood"],
      });
    }
  }

  // Cuisine × Price (200)
  const priceLabels = [
    { level: "$", words: ["cheap", "budget", "affordable"] },
    { level: "$$", words: ["moderate", "mid-range", "reasonably priced"] },
    { level: "$$$", words: ["upscale", "high-end", "fancy"] },
    { level: "$$$$", words: ["fine dining", "luxury", "splurge-worthy"] },
  ];
  const cuisinePricePairs: AtlasQuery[] = [];
  for (const cuisine of allCuisines) {
    for (const price of priceLabels) {
      const word = pick(price.words);
      const query = `${word} ${cuisine.name}`;
      cuisinePricePairs.push({
        id: makeId(2, "CxP"),
        tier: 2,
        category: "cuisine_x_price",
        subcategory: price.level,
        query,
        params: { ...defaultParams(query), price_level: price.level },
        expected_signals: { cuisines: [cuisine.name], min_score: 40 },
        search_volume_estimate: "medium",
        tags: ["tier2", "cuisine_x_price"],
      });
    }
  }
  queries.push(...sample(cuisinePricePairs, 200));

  return queries;
}

// ─── Tier 3: Triple Combos & Natural Language ───────────────────────────────

function generateTier3(): AtlasQuery[] {
  const queries: AtlasQuery[] = [];

  // Three-dimension combos (500)
  for (let i = 0; i < 500; i++) {
    const cuisine = pick(allCuisines);
    const vibe = pick(allVibes);
    const hood = pick(allNeighborhoods);
    const patterns = [
      `${vibe.name} ${cuisine.name} dinner ${hood.name}`,
      `${cuisine.name} ${vibe.name} spot in ${hood.name}`,
      `${vibe.name} ${cuisine.name} restaurant near ${hood.name}`,
      `looking for ${vibe.name} ${cuisine.name} in ${hood.name}`,
    ];
    const query = pick(patterns);
    queries.push({
      id: makeId(3, "TRI"),
      tier: 3,
      category: "triple_combo",
      subcategory: "cuisine_vibe_neighborhood",
      query,
      params: defaultParams(query),
      expected_signals: { cuisines: [cuisine.name], vibes: [vibe.name], neighborhood: hood.name, min_score: 40 },
      search_volume_estimate: "low",
      tags: ["tier3", "triple_combo"],
    });
  }

  // Colloquial/slang (from scenarios + slang config)
  for (const term of slangConfig.slang_terms) {
    const cuisine = pick(allCuisines);
    const patterns = [
      `${term.term} ${cuisine.name}`,
      `${term.term} food`,
      `${term.term} restaurant`,
      `${term.term} spot`,
    ];
    const query = pick(patterns);
    queries.push({
      id: makeId(3, "SLG"),
      tier: 3,
      category: "slang",
      subcategory: term.term.replace(/\s+/g, "_"),
      query,
      params: defaultParams(query),
      expected_signals: { min_score: 35 },
      search_volume_estimate: "medium",
      tags: ["tier3", "slang", term.term],
    });
  }

  // Contextual scenarios
  for (const scenario of scenariosConfig.contextual_scenarios) {
    queries.push({
      id: makeId(3, "CTX"),
      tier: 3,
      category: "contextual",
      subcategory: "scenario",
      query: scenario,
      params: defaultParams(scenario),
      expected_signals: { min_score: 40 },
      search_volume_estimate: "medium",
      tags: ["tier3", "contextual"],
    });
  }

  // Emotional scenarios
  for (const scenario of scenariosConfig.emotional_scenarios) {
    queries.push({
      id: makeId(3, "EMO"),
      tier: 3,
      category: "emotional",
      subcategory: "feeling",
      query: scenario,
      params: defaultParams(scenario),
      expected_signals: { min_score: 35 },
      search_volume_estimate: "low",
      tags: ["tier3", "emotional"],
    });
  }

  // Comparative scenarios
  for (const scenario of scenariosConfig.comparative_scenarios) {
    queries.push({
      id: makeId(3, "CMP"),
      tier: 3,
      category: "comparative",
      subcategory: "comparison",
      query: scenario,
      params: defaultParams(scenario),
      expected_signals: { min_score: 35 },
      search_volume_estimate: "medium",
      tags: ["tier3", "comparative"],
    });
  }

  // Complex NL scenarios
  for (const scenario of scenariosConfig.complex_nl_scenarios) {
    queries.push({
      id: makeId(3, "NLP"),
      tier: 3,
      category: "complex_nl",
      subcategory: "natural_language",
      query: scenario,
      params: defaultParams(scenario),
      expected_signals: { min_score: 35 },
      search_volume_estimate: "medium",
      tags: ["tier3", "complex_nl"],
    });
  }

  // Trending/cultural
  for (const scenario of scenariosConfig.trending_cultural) {
    queries.push({
      id: makeId(3, "TRD"),
      tier: 3,
      category: "trending",
      subcategory: "cultural",
      query: scenario,
      params: defaultParams(scenario),
      expected_signals: { min_score: 35 },
      search_volume_estimate: "medium",
      tags: ["tier3", "trending"],
    });
  }

  // Negative framing
  for (const scenario of scenariosConfig.negative_framing) {
    queries.push({
      id: makeId(3, "NEG"),
      tier: 3,
      category: "negative_framing",
      subcategory: "exclusion",
      query: scenario,
      params: defaultParams(scenario),
      expected_signals: { min_score: 30 },
      search_volume_estimate: "medium",
      tags: ["tier3", "negative_framing"],
    });
  }

  return queries;
}

// ─── Tier 4: Edge Cases & Adversarial ───────────────────────────────────────

function generateTier4(): AtlasQuery[] {
  const queries: AtlasQuery[] = [];

  // Misspellings
  const misspellings = [
    "resturant", "italain food", "suchi", "Mexcian food", "thi food", "resteraunt near me",
    "west loup", "wiker park", "piolsen", "thaai food", "ramen nooble", "pad thi",
    "suchi restarant", "chineese food", "japanees restaurant", "indain food", "etheopian",
    "mediteranean", "vietnameese", "carribean food", "puruvian", "columbain food",
    "middle estern", "polish restarant", "frensh bistro", "koreean bbq", "greak food",
    "brazillian steakhouse", "filipeno food", "malasian", "salvadorean", "venezualan",
    "dim sume", "bahn mi", "bibim bop", "tikka masalla", "swarma", "felafal",
    "empenadas", "pupussas", "giros", "omekase", "biria tacos", "bolgogi",
    "tonkatsu ramen", "shyu ramen", "miso reman", "lo main", "dan dan noodels",
    "briskut", "fried chiken", "smach burger", "lobstar roll", "chease cake",
    "lincon park food", "river noth", "logan sqaure", "bcktown", "hyde prk",
    "andersenville", "gold coats", "ukranian village", "south lop", "streeter ville",
    "deap dish pizza", "italain beef", "chicago hotdog", "tavurn style pizza",
    "jibarito", "gym sho sandwich", "maxwel street polish", "pacski", "kolachki",
    "michlen star", "james berd", "eater 38 chciago", "bob goumand",
    "rooftip bar", "speek easy", "romanic dinner", "famly friendly",
    "gluten fre", "vegun options", "hala food", "koshar restaurant",
    "bybo restaurant", "privat room", "whealchair accessible", "delivry available",
    "happi hour", "bruch spot", "laet night food", "quck lunch",
    "vegatarian", "alergey friendly", "dary free", "nut fre",
    "reservashon needed", "walk in only", "outoor seating", "parkng available",
    "datee night", "grup dinner", "busness lunch", "solo dinning", "birday dinner",
    "aniversary dinner", "celibration dinner", "casul hangout",
    "best restrant chicago", "top ratd food", "hiden gem chicago",
    "awrd winning chef", "authenitic cuisine", "clasic restaurant",
    "cosy dinner spot", "livley bar", "trendie place", "elegent dining",
    "upscall lounge", "rustick charm", "moddern decor", "industral vibe",
    "warm ambianse", "intimat setting", "sophisticatd cocktails",
    "deep dich", "itlian bef", "chicgo dog", "tavren cut",
    "fulfton market", "randolf street", "restrant row", "greektowne",
    "magnificnt mile", "mag mille", "wringly field", "old toun",
    "boystwon", "chintown", "littl italy", "hydr park",
    "souht loop", "golde coast", "edgwater", "argile street",
    "devn avenue", "humbldt park", "rogrs park", "albny park",
    "avondal", "bridgport", "norh center", "rosceo village",
    "lincon square", "irvng park", "portge park", "littl village",
    "streeerville", "nevy pier", "millinium park", "grnt park",
    "unitd center", "solider field", "art instute", "feild museum"
  ];
  for (const query of misspellings) {
    queries.push({
      id: makeId(4, "MIS"),
      tier: 4,
      category: "misspelling",
      subcategory: "typo",
      query,
      params: defaultParams(query),
      expected_signals: { min_score: 30 },
      search_volume_estimate: "medium",
      tags: ["tier4", "misspelling", "edge_case"],
    });
  }

  // Impossible constraints
  const impossibleQueries = [
    "michelin star under $10", "fine dining walk-in Saturday 7pm", "vegan steakhouse",
    "outdoor rooftop December", "kid-friendly speakeasy", "quiet nightclub with food",
    "kosher BBQ chicago", "halal wine bar", "gluten-free deep dish pizza",
    "BYOB fine dining michelin star", "pet-friendly omakase", "free parking downtown Loop",
    "wheelchair accessible rooftop bar", "delivery-only tasting menu",
    "all-you-can-eat michelin restaurant", "healthy fried chicken", "low-calorie deep dish",
    "sugar-free dessert tasting menu", "silent restaurant with live music",
    "intimate restaurant for 50 people", "cheap wagyu", "budget lobster dinner",
    "fast food omakase", "drive-through fine dining", "casual black tie dinner",
    "24 hour michelin star", "breakfast tasting menu midnight", "lunch at 3am",
    "vegan bone marrow", "raw food steakhouse",
  ];
  for (const query of impossibleQueries) {
    queries.push({
      id: makeId(4, "IMP"),
      tier: 4,
      category: "impossible_constraint",
      subcategory: "paradox",
      query,
      params: defaultParams(query),
      expected_signals: { min_score: 25 },
      search_volume_estimate: "low",
      tags: ["tier4", "impossible", "edge_case"],
    });
  }

  // Empty/minimal
  const minimalQueries = [
    "food", "eat", "hungry", "dinner", "lunch", "?", "idk", "anything", "feed me",
    "what's good", "hmm", "restaurant", "something", "whatever", "surprise me",
    "I don't know", "just eat", "need food", "starving", "meal", "eating out",
    "where to go", "help", "recommendation", "suggest something", "open now",
    "close by", "near me", "good food", "decent food",
  ];
  for (const query of minimalQueries) {
    queries.push({
      id: makeId(4, "MIN"),
      tier: 4,
      category: "minimal",
      subcategory: "vague",
      query,
      params: defaultParams(query),
      expected_signals: { relevance_type: "open_ended", min_score: 30 },
      search_volume_estimate: "high",
      tags: ["tier4", "minimal", "edge_case"],
    });
  }

  // Out-of-scope
  const outOfScope = [
    "grocery store", "cooking class", "food truck schedule", "catering for 200",
    "meal kit delivery", "protein powder", "restaurant jobs hiring",
    "how to make deep dish at home", "chicago food history", "restaurant inspection scores",
    "food poisoning lawyer chicago", "restaurant for sale chicago", "cooking school",
    "farmers market schedule", "food bank volunteer", "restaurant supply store",
    "recipe for Italian beef", "calorie count deep dish", "food delivery app",
    "uber eats promo code",
  ];
  for (const query of outOfScope) {
    queries.push({
      id: makeId(4, "OOS"),
      tier: 4,
      category: "out_of_scope",
      subcategory: "non_restaurant",
      query,
      params: defaultParams(query),
      expected_signals: { min_score: 20 },
      search_volume_estimate: "low",
      tags: ["tier4", "out_of_scope", "edge_case"],
    });
  }

  // Seasonal/temporal
  const seasonalQueries = [
    "outdoor dining in summer", "warm cozy spot winter", "Valentine's Day dinner 2026",
    "New Year's Eve dinner", "Thanksgiving open restaurant", "patio season restaurant",
    "rooftop in July", "fireside dining January", "spring brunch", "fall harvest menu",
    "Christmas dinner open", "Easter brunch", "Mother's Day brunch", "Father's Day dinner",
    "4th of July BBQ", "Labor Day weekend brunch", "restaurant week deals",
    "heated patio winter", "snow day comfort food", "summer cocktails rooftop",
  ];
  for (const query of seasonalQueries) {
    queries.push({
      id: makeId(4, "SEA"),
      tier: 4,
      category: "seasonal",
      subcategory: "temporal",
      query,
      params: defaultParams(query),
      expected_signals: { min_score: 35 },
      search_volume_estimate: "medium",
      tags: ["tier4", "seasonal", "edge_case"],
    });
  }

  return queries;
}

// ─── Tier 5: API Parameter Matrix ───────────────────────────────────────────

function generateTier5(existingQueries: AtlasQuery[]): AtlasQuery[] {
  const queries: AtlasQuery[] = [];

  // Get top-performing Tier 1 queries to rerun with params
  const tier1 = existingQueries.filter((q) => q.tier === 1 && q.search_volume_estimate === "high");
  const topQueries = sample(tier1, 200);

  // Time of day variations
  const times = ["breakfast", "lunch", "dinner", "late_night"];
  for (const q of sample(topQueries, 50)) {
    for (const tod of times) {
      queries.push({
        id: makeId(5, "TOD"),
        tier: 5,
        category: "param_time_of_day",
        subcategory: tod,
        query: q.query,
        params: { ...q.params, time_of_day: tod },
        expected_signals: { ...q.expected_signals, min_score: 40 },
        search_volume_estimate: "medium",
        tags: ["tier5", "param_matrix", "time_of_day", tod],
      });
    }
  }

  // Occasion parameter variations
  const occasions = ["Date Night", "Business", "Family", "Group Dinner"];
  for (const q of sample(topQueries, 50)) {
    for (const occ of occasions) {
      queries.push({
        id: makeId(5, "POC"),
        tier: 5,
        category: "param_occasion",
        subcategory: occ.toLowerCase().replace(/\s+/g, "_"),
        query: q.query,
        params: { ...q.params, occasion: occ },
        expected_signals: { ...q.expected_signals, min_score: 40 },
        search_volume_estimate: "medium",
        tags: ["tier5", "param_matrix", "occasion"],
      });
    }
  }

  // Neighborhood parameter variations
  const topHoods = allNeighborhoods.filter((h: any) => h.search_volume === "high").map((h: any) => h.name);
  for (const q of sample(topQueries, 50)) {
    for (const hood of sample(topHoods, 4)) {
      queries.push({
        id: makeId(5, "PNH"),
        tier: 5,
        category: "param_neighborhood",
        subcategory: hood.toLowerCase().replace(/\s+/g, "_"),
        query: q.query,
        params: { ...q.params, neighborhood: hood },
        expected_signals: { ...q.expected_signals, neighborhood: hood, min_score: 40 },
        search_volume_estimate: "medium",
        tags: ["tier5", "param_matrix", "neighborhood"],
      });
    }
  }

  // Price level variations
  const priceLevels = ["$", "$$", "$$$", "$$$$"];
  for (const q of sample(topQueries, 50)) {
    for (const pl of priceLevels) {
      queries.push({
        id: makeId(5, "PPL"),
        tier: 5,
        category: "param_price",
        subcategory: pl,
        query: q.query,
        params: { ...q.params, price_level: pl },
        expected_signals: { ...q.expected_signals, min_score: 40 },
        search_volume_estimate: "medium",
        tags: ["tier5", "param_matrix", "price"],
      });
    }
  }

  // Dietary restriction variations
  const diets = ["vegetarian", "vegan", "gluten-free"];
  for (const q of sample(topQueries, 50)) {
    for (const diet of diets) {
      queries.push({
        id: makeId(5, "PDR"),
        tier: 5,
        category: "param_dietary",
        subcategory: diet.replace(/\s+/g, "_"),
        query: q.query,
        params: { ...q.params, dietary_restrictions: [diet] },
        expected_signals: { ...q.expected_signals, min_score: 35 },
        search_volume_estimate: "medium",
        tags: ["tier5", "param_matrix", "dietary"],
      });
    }
  }

  return queries;
}

// ─── Deduplication ──────────────────────────────────────────────────────────

function deduplicate(queries: AtlasQuery[]): AtlasQuery[] {
  const seen = new Map<string, AtlasQuery>();

  for (const q of queries) {
    // Exact match check (query + params hash)
    const key = `${q.query.toLowerCase()}|${q.params.occasion}|${q.params.neighborhood}|${q.params.price_level}|${q.params.time_of_day}|${q.params.dietary_restrictions.join(",")}`;
    if (seen.has(key)) continue;

    // Jaccard similarity check against existing (only within same tier+category)
    let isDuplicate = false;
    for (const [existKey, existQ] of seen) {
      if (existQ.tier === q.tier && existQ.category === q.category) {
        if (jaccardSimilarity(q.query, existQ.query) > 0.85) {
          isDuplicate = true;
          break;
        }
      }
    }
    if (!isDuplicate) {
      seen.set(key, q);
    }
  }

  return Array.from(seen.values());
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const tierArg = args.indexOf("--tier");
  const targetTier = tierArg >= 0 ? parseInt(args[tierArg + 1]) : -1;
  const outputArg = args.indexOf("--output");
  const outputPath = outputArg >= 0 ? args[outputArg + 1] : join(TESTS_DIR, "search-atlas-v1.jsonl");

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  CHICAGO SEARCH ATLAS GENERATOR                            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  let allQueries: AtlasQuery[] = [];

  const generators: [number, string, () => AtlasQuery[]][] = [
    [0, "Gold Standard (existing 1K)", generateTier0],
    [1, "Core Singles", generateTier1],
    [2, "Two-Dimension Combos", generateTier2],
    [3, "Triple Combos & NL", generateTier3],
    [4, "Edge Cases & Adversarial", generateTier4],
  ];

  for (const [tier, name, generator] of generators) {
    if (targetTier >= 0 && tier !== targetTier) continue;
    console.log(`  Generating Tier ${tier}: ${name}...`);
    const queries = generator();
    console.log(`    → ${queries.length} queries generated`);
    allQueries.push(...queries);
  }

  // Generate Tier 5 (depends on other tiers)
  if (targetTier < 0 || targetTier === 5) {
    console.log("  Generating Tier 5: API Parameter Matrix...");
    const tier5 = generateTier5(allQueries);
    console.log(`    → ${tier5.length} queries generated`);
    allQueries.push(...tier5);
  }

  // Deduplicate
  console.log(`\n  Deduplicating ${allQueries.length} queries...`);
  allQueries = deduplicate(allQueries);
  console.log(`    → ${allQueries.length} unique queries after dedup`);

  // Re-assign sequential IDs
  allQueries.forEach((q, i) => {
    q.id = `T${q.tier}-${q.category.substring(0, 3).toUpperCase()}-${String(i + 1).padStart(5, "0")}`;
  });

  // Write output
  const jsonl = allQueries.map((q) => JSON.stringify(q)).join("\n") + "\n";
  writeFileSync(outputPath, jsonl);

  // Summary
  const tierCounts: Record<number, number> = {};
  const categoryCounts: Record<string, number> = {};
  for (const q of allQueries) {
    tierCounts[q.tier] = (tierCounts[q.tier] || 0) + 1;
    categoryCounts[q.category] = (categoryCounts[q.category] || 0) + 1;
  }

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  ATLAS SUMMARY                                             ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  Total queries: ${String(allQueries.length).padEnd(44)}║`);
  console.log(`║  Output: ${outputPath.substring(outputPath.lastIndexOf("/") + 1).padEnd(51)}║`);
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  By Tier:                                                  ║");
  for (const [tier, count] of Object.entries(tierCounts).sort()) {
    console.log(`║    Tier ${tier}: ${String(count).padEnd(49)}║`);
  }
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  Top Categories:                                           ║");
  const sortedCats = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [cat, count] of sortedCats) {
    console.log(`║    ${cat.padEnd(30)} ${String(count).padEnd(26)}║`);
  }
  console.log("╚══════════════════════════════════════════════════════════════╝");
}

main();
