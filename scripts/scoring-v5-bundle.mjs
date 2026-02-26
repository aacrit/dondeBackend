// supabase/functions/recommend/_shared/scoring.ts
var OCCASION_WEIGHTS = {
  "Date Night": { date_friendly_score: 1 },
  "Group Hangout": { group_friendly_score: 1 },
  "Family Dinner": { family_friendly_score: 1 },
  "Business Lunch": { business_lunch_score: 1 },
  "Solo Dining": { solo_dining_score: 1 },
  "Special Occasion": { romantic_rating: 0.7, date_friendly_score: 0.3 },
  "Treat Myself": { solo_dining_score: 0.5, romantic_rating: 0.3, hole_in_wall_factor: 0.2 },
  Adventure: { hole_in_wall_factor: 0.6, group_friendly_score: 0.2, solo_dining_score: 0.2 },
  "Chill Hangout": { group_friendly_score: 0.6, solo_dining_score: 0.3, hole_in_wall_factor: 0.1 }
};
var TAG_KEYWORDS = {
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
  "kid friendly": ["kid friendly", "kids menu", "children", "family", "high chair"]
};
var DIETARY_KEYWORDS = {
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
  "paleo": ["Paleo"]
};

// supabase/functions/recommend/_shared/scoring-v3.ts
var CUISINE_FAMILIES = {
  Mediterranean: ["Greek", "Italian", "Middle Eastern"],
  "East Asian": ["Japanese", "Chinese", "Korean"],
  "Southeast Asian": ["Thai", "Vietnamese"],
  "Latin American": ["Mexican", "Peruvian", "Brazilian", "Puerto Rican"],
  "South Asian": ["Indian"]
};
var CUISINE_TO_FAMILY = {};
for (const [family, cuisines] of Object.entries(CUISINE_FAMILIES)) {
  for (const c of cuisines) {
    CUISINE_TO_FAMILY[c] = family;
  }
}
var OCCASION_NOISE = {
  "Date Night": ["Quiet", "Moderate"],
  "Group Hangout": ["Moderate", "Loud"],
  "Family Dinner": ["Quiet", "Moderate"],
  "Business Lunch": ["Quiet"],
  "Solo Dining": ["Quiet", "Moderate"],
  "Special Occasion": ["Quiet"],
  "Treat Myself": ["Quiet", "Moderate"],
  Adventure: ["Moderate", "Loud", "Quiet"],
  "Chill Hangout": ["Moderate", "Quiet"],
  Any: ["Quiet", "Moderate"]
};
var OCCASION_LIGHTING = {
  "Date Night": ["dim", "intimate", "warm", "candlelit", "romantic"],
  "Group Hangout": ["bright", "lively", "modern", "warm", "vibrant"],
  "Family Dinner": ["bright", "warm", "modern", "welcoming"],
  "Business Lunch": ["bright", "modern", "warm", "elegant"],
  "Solo Dining": ["warm", "cozy", "bright", "relaxed"],
  "Special Occasion": ["dim", "intimate", "elegant", "warm", "candlelit"],
  "Treat Myself": ["warm", "cozy", "intimate", "elegant"],
  Adventure: [],
  // any lighting
  "Chill Hangout": ["warm", "cozy", "dim", "relaxed"],
  Any: []
};
var OCCASION_ENERGY = {
  "Date Night": [4, 7],
  "Group Hangout": [6, 9],
  "Family Dinner": [3, 6],
  "Business Lunch": [2, 5],
  "Solo Dining": [2, 6],
  "Special Occasion": [4, 7],
  "Treat Myself": [3, 7],
  Adventure: [4, 10],
  "Chill Hangout": [3, 6],
  Any: [3, 7]
};
var MUSIC_FIT = {
  "Date Night": ["live-jazz", "curated-playlist", "ambient"],
  "Business Lunch": ["ambient", "no-music"],
  "Group Hangout": ["curated-playlist", "DJ", "live-jazz", "live-band"],
  "Family Dinner": ["ambient", "no-music", "curated-playlist"],
  "Solo Dining": ["curated-playlist", "ambient", "no-music"],
  "Special Occasion": ["live-jazz", "curated-playlist", "ambient"],
  "Chill Hangout": ["curated-playlist", "ambient", "live-jazz"],
  Adventure: ["live-jazz", "live-band", "DJ", "curated-playlist"],
  "Treat Myself": ["curated-playlist", "ambient", "live-jazz"],
  Any: ["curated-playlist", "ambient"]
};
var SERVICE_FIT = {
  "Business Lunch": ["Full Table Service"],
  "Date Night": ["Full Table Service", "Omakase", "Tasting Menu", "Bar Service"],
  "Group Hangout": ["Full Table Service", "Family Style", "Fast Casual", "Bar Service"],
  "Family Dinner": ["Full Table Service", "Family Style"],
  "Solo Dining": ["Counter", "Bar Service", "Fast Casual", "Full Table Service"],
  "Special Occasion": ["Tasting Menu", "Omakase", "Full Table Service"],
  "Treat Myself": ["Full Table Service", "Omakase", "Tasting Menu", "Counter"],
  Adventure: ["Counter", "Family Style", "Omakase", "Full Table Service"],
  "Chill Hangout": ["Full Table Service", "Bar Service", "Fast Casual"]
};
var SERVICE_CLASH = {
  "Special Occasion": ["Fast Casual", "Counter"],
  "Date Night": ["Fast Casual"],
  "Business Lunch": ["Counter", "Fast Casual"],
  "Group Hangout": ["Omakase"]
};
var DRESS_LEVELS = {
  Casual: 1,
  "Smart Casual": 2,
  "Business Casual": 3,
  Formal: 4
};
var OCCASION_DRESS_MIN = {
  "Date Night": "Smart Casual",
  "Business Lunch": "Business Casual",
  "Special Occasion": "Smart Casual",
  "Group Hangout": "Casual",
  "Family Dinner": "Casual",
  "Solo Dining": "Casual",
  "Treat Myself": "Casual",
  Adventure: "Casual",
  "Chill Hangout": "Casual",
  Any: "Casual"
};
var PACING_FIT = {
  "Business Lunch": ["quick_bite", "relaxed"],
  "Date Night": ["relaxed", "leisurely"],
  "Group Hangout": ["relaxed", "leisurely"],
  "Solo Dining": ["quick_bite", "relaxed"],
  "Special Occasion": ["leisurely", "ceremonial"],
  "Treat Myself": ["relaxed", "leisurely", "ceremonial"],
  Adventure: ["quick_bite", "relaxed", "ceremonial"],
  "Family Dinner": ["relaxed"],
  "Chill Hangout": ["relaxed", "leisurely"]
};
function computeWeightedOccasionScore(profile, occasion) {
  if (occasion === "Any") {
    const total = (profile.date_friendly_score || 0) + (profile.group_friendly_score || 0) + (profile.family_friendly_score || 0) + (profile.romantic_rating || 0) + (profile.business_lunch_score || 0) + (profile.solo_dining_score || 0) + (profile.hole_in_wall_factor || 0);
    return total / 70 * 10;
  }
  const weights = OCCASION_WEIGHTS[occasion];
  if (!weights) {
    return profile.date_friendly_score || 0;
  }
  let score = 0;
  for (const [field, weight] of Object.entries(weights)) {
    score += (profile[field] ?? 0) * weight;
  }
  return score;
}
function computeFoodMatch(profile, intent, dietaryRestrictions, specialRequest) {
  let score = 0;
  let dataPoints = 0;
  let maxDataPoints = 0;
  const details = {};
  const dp = profile.deep_profile;
  const v2Intent = intent && "flavor_preferences" in intent ? intent : null;
  maxDataPoints++;
  const targetCuisines = intent?.target_cuisines || [];
  let cuisineScore = 0;
  let cuisineSignal = "";
  if (targetCuisines.length > 0) {
    dataPoints++;
    if (profile.cuisine_type) {
      const cuisineLower = profile.cuisine_type.toLowerCase();
      const exactMatch = targetCuisines.some((c) => c.toLowerCase() === cuisineLower);
      const containsMatch = !exactMatch && targetCuisines.some(
        (c) => cuisineLower.includes(c.toLowerCase()) || c.toLowerCase().includes(cuisineLower)
      );
      if (exactMatch) {
        cuisineScore = 6;
        cuisineSignal = `Exact: ${profile.cuisine_type}`;
      } else if (containsMatch) {
        cuisineScore = 5.5;
        cuisineSignal = `Close: ${profile.cuisine_type}`;
      } else if (dp?.cuisine_subcategory) {
        const subLower = dp.cuisine_subcategory.toLowerCase();
        if (targetCuisines.some((c) => subLower.includes(c.toLowerCase()))) {
          cuisineScore = 5;
          cuisineSignal = `Sub-match: ${dp.cuisine_subcategory}`;
        } else if (isRelatedCuisine(profile.cuisine_type, targetCuisines)) {
          cuisineScore = 3.5;
          cuisineSignal = `Related: ${profile.cuisine_type}`;
        }
      } else if (isRelatedCuisine(profile.cuisine_type, targetCuisines)) {
        cuisineScore = 3.5;
        cuisineSignal = `Related: ${profile.cuisine_type}`;
      }
      if (cuisineScore === 0) cuisineSignal = `No match: ${profile.cuisine_type}`;
    } else {
      cuisineSignal = "No cuisine listed";
    }
  } else {
    cuisineScore = 2.5;
    cuisineSignal = "No cuisine filter";
  }
  score += cuisineScore;
  details.cuisine = { score: cuisineScore, max: 6, signal: cuisineSignal };
  maxDataPoints++;
  let flavorScore = 0;
  let flavorSignal = "";
  if (dp?.flavor_profiles && dp.flavor_profiles.length > 0) {
    dataPoints++;
    const flavorPrefs = v2Intent?.flavor_preferences || extractFlavorIntent(specialRequest || "");
    if (flavorPrefs.length > 0) {
      const overlapCount = flavorPrefs.filter(
        (f) => dp.flavor_profiles.some((fp) => fp.toLowerCase().includes(f.toLowerCase()))
      ).length;
      flavorScore = Math.min(2, overlapCount * 0.7);
      flavorSignal = overlapCount > 0 ? `${overlapCount} flavor overlap` : "No flavor overlap";
    } else {
      flavorSignal = "No flavor preference";
    }
  } else {
    flavorSignal = "No flavor data";
  }
  score += flavorScore;
  details.flavor = { score: flavorScore, max: 2, signal: flavorSignal };
  maxDataPoints++;
  let dietScore = 0;
  let dietSignal = "";
  if (dietaryRestrictions && dietaryRestrictions.length > 0) {
    if (dp?.dietary_depth) {
      dataPoints++;
      if (dp.dietary_depth === "dedicated") {
        dietScore = 2;
        dietSignal = "Dedicated options";
      } else if (dp.dietary_depth === "solid") {
        dietScore = 1.5;
        dietSignal = "Solid options";
      } else if (dp.dietary_depth === "token") {
        dietScore = 0.5;
        dietSignal = "Limited options";
      } else dietSignal = "Unknown depth";
    } else if (profile.dietary_options && profile.dietary_options.length > 0) {
      dataPoints++;
      const allMatch = dietaryRestrictions.every((dr) => {
        const keywords = DIETARY_KEYWORDS[dr.toLowerCase()];
        if (!keywords) return false;
        return profile.dietary_options.some(
          (opt) => keywords.some((kw) => opt.toLowerCase().includes(kw.toLowerCase()))
        );
      });
      if (allMatch) {
        dietScore = 1;
        dietSignal = "All restrictions met";
      } else {
        const someMatch = dietaryRestrictions.some((dr) => {
          const keywords = DIETARY_KEYWORDS[dr.toLowerCase()];
          if (!keywords) return false;
          return profile.dietary_options.some(
            (opt) => keywords.some((kw) => opt.toLowerCase().includes(kw.toLowerCase()))
          );
        });
        if (someMatch) {
          dietScore = 0.5;
          dietSignal = "Partial match";
        } else dietSignal = "No dietary match";
      }
    } else {
      dietSignal = "No dietary data";
    }
  } else {
    dietScore = 0.5;
    dietSignal = "No restrictions";
    dataPoints++;
  }
  score += dietScore;
  details.dietary = { score: dietScore, max: 2, signal: dietSignal };
  maxDataPoints++;
  const requestLower = (specialRequest || "").toLowerCase();
  let menuScore = 0;
  let menuSignal = "";
  if (dp?.signature_dishes && Array.isArray(dp.signature_dishes) && dp.signature_dishes.length > 0 && requestLower.length > 2) {
    dataPoints++;
    const dishMatch = dp.signature_dishes.some((d) => {
      const dishWords = d.dish.toLowerCase().split(/\s+/);
      return dishWords.some((w) => w.length > 3 && requestLower.includes(w));
    });
    if (dishMatch) {
      menuScore = 1;
      menuSignal = "Dish match found";
    } else menuSignal = "No dish match";
  } else if (profile.tags.length > 0 && requestLower.length > 2) {
    dataPoints++;
    let tagMatch = false;
    const foodTags = ["farm-to-table", "brunch spot", "vegan friendly", "gluten free"];
    for (const ft of foodTags) {
      const tagKws = TAG_KEYWORDS[ft];
      if (tagKws && tagKws.some((kw) => requestLower.includes(kw))) {
        if (profile.tags.some((t) => t.toLowerCase().includes(ft))) {
          tagMatch = true;
          break;
        }
      }
    }
    if (tagMatch) {
      menuScore = 0.5;
      menuSignal = "Tag match";
    } else menuSignal = "No tag match";
  } else {
    menuSignal = "No menu data";
  }
  score += menuScore;
  details.menu = { score: menuScore, max: 1, signal: menuSignal };
  const hasFlavorData = dp?.flavor_profiles && dp.flavor_profiles.length > 0 && (v2Intent?.flavor_preferences?.length || extractFlavorIntent(specialRequest || "").length > 0);
  const hasMenuData = dp?.signature_dishes && Array.isArray(dp.signature_dishes) && dp.signature_dishes.length > 0 && requestLower.length > 2 || profile.tags.length > 0 && requestLower.length > 2;
  const maxPossible = 6 + (hasFlavorData ? 2 : 0) + 2 + (hasMenuData ? 1 : 0);
  const effectiveDenom = Math.max(maxPossible, 8);
  const normalized = Math.min(10, score / effectiveDenom * 10);
  if (!profile.cuisine_type && targetCuisines.length > 0) {
    return { score: Math.min(4, normalized), dataPoints, maxDataPoints, details };
  }
  if (targetCuisines.length === 0) {
    if ((intent?.cuisine_importance === "low" || !specialRequest || specialRequest.trim().length < 3) && (!dietaryRestrictions || dietaryRestrictions.length === 0)) {
      return { score: Math.max(normalized, 5), dataPoints, maxDataPoints, details };
    }
  }
  return { score: normalized, dataPoints, maxDataPoints, details };
}
function computeSettingFit(profile, occasion, intent) {
  let score = 0;
  let dataPoints = 0;
  let maxDataPoints = 0;
  const details = {};
  const dp = profile.deep_profile;
  const v2Intent = intent && "group_size_hint" in intent ? intent : null;
  maxDataPoints++;
  const occasionBase = computeWeightedOccasionScore(profile, occasion);
  if (occasionBase > 0) {
    dataPoints++;
    const stretched = Math.pow(occasionBase / 10, 0.85) * 7;
    score += stretched;
  } else {
    score += 2.5;
  }
  maxDataPoints++;
  if (dp?.service_style) {
    dataPoints++;
    const fits = SERVICE_FIT[occasion] || [];
    if (fits.length > 0 && fits.includes(dp.service_style)) {
      score += 1.5;
    }
    const clashes = SERVICE_CLASH[occasion] || [];
    if (clashes.includes(dp.service_style)) {
      score -= 0.5;
    }
  }
  maxDataPoints++;
  if (dp) {
    let socialPoints = 0;
    let socialDataUsed = false;
    if (dp.meal_pacing) {
      const pacingFits = PACING_FIT[occasion] || [];
      if (pacingFits.length > 0 && pacingFits.includes(dp.meal_pacing)) {
        socialPoints += 0.5;
        socialDataUsed = true;
      }
    }
    if (occasion === "Family Dinner" && dp.kid_friendliness != null) {
      if (dp.kid_friendliness >= 7) socialPoints += 0.75;
      else if (dp.kid_friendliness >= 5) socialPoints += 0.25;
      socialDataUsed = true;
    }
    if (["Date Night", "Business Lunch", "Special Occasion"].includes(occasion) && dp.conversation_friendliness != null) {
      if (dp.conversation_friendliness >= 7) socialPoints += 0.5;
      socialDataUsed = true;
    }
    if (dp.group_size_sweet_spot) {
      const rangeMatch = dp.group_size_sweet_spot.match(/\[(\d+),(\d+)\)/);
      if (rangeMatch) {
        const max = parseInt(rangeMatch[2], 10);
        const isLargeGroup = v2Intent?.group_size_hint === "large_group";
        if (isLargeGroup && max <= 6) {
          socialPoints -= 1;
          socialDataUsed = true;
        }
      }
    }
    if (dp.date_progression && v2Intent?.date_type) {
      if (dp.date_progression.toLowerCase().includes(v2Intent.date_type.toLowerCase())) {
        socialPoints += 0.5;
        socialDataUsed = true;
      }
    }
    if (socialDataUsed) {
      dataPoints++;
      score += Math.min(1.5, Math.max(-1, socialPoints));
    }
  }
  const clamped = Math.min(10, Math.max(0, score));
  const occasionStretched = occasionBase > 0 ? Math.pow(occasionBase / 10, 0.85) * 7 : 2.5;
  details.occasion = { score: Math.round(occasionStretched * 10) / 10, max: 7, signal: occasionBase > 0 ? `${occasion} ${occasionBase.toFixed(1)}/10` : "No occasion data" };
  let serviceScore = 0;
  if (dp?.service_style) {
    const fits = SERVICE_FIT[occasion] || [];
    if (fits.length > 0 && fits.includes(dp.service_style)) serviceScore = 1.5;
    const clashes = SERVICE_CLASH[occasion] || [];
    if (clashes.includes(dp.service_style)) serviceScore -= 0.5;
  }
  details.service = { score: Math.max(0, serviceScore), max: 1.5, signal: dp?.service_style || "No data" };
  details.social = { score: Math.max(0, clamped - occasionStretched - Math.max(0, serviceScore)), max: 1.5, signal: "Pacing + social dynamics" };
  if (occasion === "Any" && occasionBase === 0) {
    return { score: 4, dataPoints, maxDataPoints, details };
  }
  return { score: clamped, dataPoints, maxDataPoints, details };
}
function computeAtmosphere(profile, occasion, intent, specialRequest) {
  let noiseScore = 0, lightingScore = 0, dressScore = 0, energyScore = 0, musicScore = 0, vibeScore = 0;
  let score = 0;
  let dataPoints = 0;
  let maxDataPoints = 0;
  const dp = profile.deep_profile;
  const v2Intent = intent && "vibe_keywords" in intent ? intent : null;
  const requestLower = (specialRequest || "").toLowerCase();
  let atmoMaxPossible = 0;
  let atmoMaxAbsolute = 0;
  maxDataPoints++;
  atmoMaxAbsolute += 2;
  const expectedNoise = OCCASION_NOISE[occasion] || OCCASION_NOISE.Any;
  if (profile.noise_level) {
    dataPoints++;
    atmoMaxPossible += 2;
    if (expectedNoise.includes(profile.noise_level)) {
      score += 2;
    } else {
      score += 0.3;
    }
  }
  maxDataPoints++;
  atmoMaxAbsolute += 2;
  const expectedLighting = OCCASION_LIGHTING[occasion] || [];
  if (profile.lighting_ambiance && expectedLighting.length > 0) {
    dataPoints++;
    atmoMaxPossible += 2;
    const lightingLower = profile.lighting_ambiance.toLowerCase();
    const lightingMatches = expectedLighting.filter((kw) => lightingLower.includes(kw)).length;
    if (lightingMatches > 0) {
      score += Math.min(2, lightingMatches * 1);
    }
  } else if (expectedLighting.length === 0) {
    score += 0.5;
    atmoMaxPossible += 0.5;
  }
  maxDataPoints++;
  atmoMaxAbsolute += 1;
  const expectedDressMin = OCCASION_DRESS_MIN[occasion] || "Casual";
  if (profile.dress_code) {
    dataPoints++;
    atmoMaxPossible += 1;
    const restaurantLevel = DRESS_LEVELS[profile.dress_code] || 1;
    const expectedLevel = DRESS_LEVELS[expectedDressMin] || 1;
    if (restaurantLevel >= expectedLevel) {
      score += 1;
    } else {
      score += 0.3;
    }
  }
  maxDataPoints++;
  atmoMaxAbsolute += 2;
  if (dp?.energy_level != null) {
    dataPoints++;
    atmoMaxPossible += 2;
    const [eMin, eMax] = OCCASION_ENERGY[occasion] || [3, 7];
    const midpoint = (eMin + eMax) / 2;
    if (dp.energy_level >= eMin && dp.energy_level <= eMax) {
      score += 2;
    } else {
      score += Math.max(0, 2 - Math.abs(dp.energy_level - midpoint) * 0.4);
    }
  }
  maxDataPoints++;
  atmoMaxAbsolute += 1.5;
  if (dp?.music_vibe) {
    dataPoints++;
    atmoMaxPossible += 1.5;
    const fits = MUSIC_FIT[occasion] || [];
    if (fits.includes(dp.music_vibe)) score += 1.5;
  }
  maxDataPoints++;
  atmoMaxAbsolute += 1.5;
  if (v2Intent?.vibe_keywords && v2Intent.vibe_keywords.length > 0 && dp) {
    let vibeHits = 0;
    for (const vibe of v2Intent.vibe_keywords) {
      const vibeLower = vibe.toLowerCase();
      if (dp.decor_style && dp.decor_style.toLowerCase().includes(vibeLower)) {
        vibeHits++;
        continue;
      }
      if (dp.music_vibe && dp.music_vibe.toLowerCase().includes(vibeLower)) {
        vibeHits++;
        continue;
      }
      const VIBE_ENERGY = {
        intimate: [2, 5],
        lively: [6, 9],
        cozy: [2, 5],
        elegant: [3, 6],
        casual: [3, 7],
        buzzing: [7, 10],
        chill: [2, 5],
        refined: [3, 6],
        warm: [3, 6],
        modern: [4, 8],
        funky: [6, 9]
      };
      if (dp.energy_level != null && VIBE_ENERGY[vibeLower]) {
        const [lo, hi] = VIBE_ENERGY[vibeLower];
        if (dp.energy_level >= lo && dp.energy_level <= hi) {
          vibeHits++;
          continue;
        }
      }
    }
    if (vibeHits > 0) {
      dataPoints++;
      atmoMaxPossible += 1.5;
      score += Math.min(1.5, vibeHits * 0.5);
    }
  }
  const targetTags = intent?.target_tags || [];
  const targetFeatures = intent?.target_features || [];
  const wantsLiveMusic = requestLower.match(/live music|live band|live jazz|live dj|karaoke|entertainment/) || targetTags.some((t) => /music|entertainment|dj|karaoke/i.test(t)) || targetFeatures.includes("live_music");
  if (wantsLiveMusic) {
    maxDataPoints++;
    atmoMaxPossible += 1.5;
    if (profile.live_music) {
      score += 1.5;
      dataPoints++;
    } else if (dp?.music_vibe && /live/.test(dp.music_vibe)) {
      score += 1;
      dataPoints++;
    } else if (profile.tags.some((t) => /live music|live band|live jazz/i.test(t))) {
      score += 1;
      dataPoints++;
    }
  }
  const musicStyleMatch = requestLower.match(/\bjazz\b|\bacoustic\b|\bblues\b/);
  if (musicStyleMatch && dp?.music_vibe) {
    maxDataPoints++;
    atmoMaxPossible += 1;
    if (dp.music_vibe.toLowerCase().includes(musicStyleMatch[0])) {
      score += 1;
      dataPoints++;
    }
  }
  if (requestLower.match(/outdoor|patio|outside|al fresco|terrace/)) {
    maxDataPoints++;
    atmoMaxPossible += 1;
    if (profile.outdoor_seating) {
      score += 1;
      dataPoints++;
    }
  }
  if (requestLower.match(/view|scenic|waterfront|lakefront|rooftop/)) {
    maxDataPoints++;
    atmoMaxPossible += 1;
    const hasScenic = profile.tags.some(
      (t) => /waterfront|lakefront|rooftop|scenic|skyline|river view/i.test(t)
    );
    if (hasScenic) {
      score += 1;
      dataPoints++;
    }
  }
  if (dp?.seasonal_relevance) {
    maxDataPoints++;
    atmoMaxPossible += 0.5;
    const month = (/* @__PURE__ */ new Date()).getUTCMonth();
    const season = month >= 2 && month <= 4 ? "spring" : month >= 5 && month <= 7 ? "summer" : month >= 8 && month <= 10 ? "fall" : "winter";
    const seasonScore = dp.seasonal_relevance[season] || 5;
    if (seasonScore >= 7) {
      score += 0.5;
      dataPoints++;
    }
  }
  if (requestLower.match(/instagram|aesthetic|photogenic|cute/)) {
    maxDataPoints++;
    atmoMaxPossible += 1;
    if (dp?.instagram_worthiness != null && dp.instagram_worthiness >= 8) {
      score += 1;
      dataPoints++;
    }
  }
  if (dataPoints === 0) {
    return { score: 4, dataPoints: 0, maxDataPoints, details: { ambiance: { score: 0, max: 5, signal: "No data" }, energy: { score: 0, max: 3.5, signal: "No data" } } };
  }
  const effectiveMax = Math.max(atmoMaxPossible, 5);
  const normalizedAtmo = effectiveMax > 0 ? Math.min(10, score / effectiveMax * 10) : Math.min(10, score);
  const details = {};
  details.noise = { score: profile.noise_level && expectedNoise.includes(profile.noise_level) ? 2 : profile.noise_level ? 0.3 : 0, max: 2, signal: profile.noise_level || "No data" };
  details.lighting = { score: profile.lighting_ambiance && expectedLighting.length > 0 ? Math.min(2, expectedLighting.filter((kw) => profile.lighting_ambiance.toLowerCase().includes(kw)).length * 1) : 0, max: 2, signal: profile.lighting_ambiance || "No data" };
  details.dress = { score: profile.dress_code && (DRESS_LEVELS[profile.dress_code] || 1) >= (DRESS_LEVELS[expectedDressMin] || 1) ? 1 : profile.dress_code ? 0.3 : 0, max: 1, signal: profile.dress_code || "No data" };
  details.energy = { score: dp?.energy_level != null ? Math.min(2, Math.max(0, 2 - Math.abs(dp.energy_level - ((OCCASION_ENERGY[occasion] || [3, 7])[0] + (OCCASION_ENERGY[occasion] || [3, 7])[1]) / 2) * 0.4)) : 0, max: 2, signal: dp?.energy_level != null ? `Energy ${dp.energy_level}/10` : "No data" };
  details.music = { score: dp?.music_vibe && (MUSIC_FIT[occasion] || []).includes(dp.music_vibe) ? 1.5 : 0, max: 1.5, signal: dp?.music_vibe || "No data" };
  return {
    score: Math.max(0, normalizedAtmo),
    dataPoints,
    maxDataPoints,
    details
  };
}
function computeConvenience(profile, intent, clientTimeOfDay, specialRequest) {
  let score = 4;
  let dataPoints = 0;
  let maxDataPoints = 0;
  const dp = profile.deep_profile;
  const v2Intent = intent && "spontaneity" in intent ? intent : null;
  const requestLower = (specialRequest || "").toLowerCase();
  maxDataPoints++;
  const timeOfDay = clientTimeOfDay || null;
  if (timeOfDay && profile.best_times && profile.best_times.length > 0) {
    dataPoints++;
    if (profile.best_times.includes(timeOfDay)) {
      score += 2;
    } else if (profile.best_times.length <= 2) {
      score -= 2;
    } else {
      score -= 0.5;
    }
  }
  maxDataPoints++;
  if (dp?.reservation_difficulty) {
    dataPoints++;
    const isSpontaneous = v2Intent?.spontaneity === "spontaneous" || requestLower.match(/tonight|right now|last minute|walk.?in|spontaneous/);
    if (dp.reservation_difficulty === "hard_to_get" && isSpontaneous) {
      score -= 2.5;
    } else if (dp.reservation_difficulty === "walk_in_friendly") {
      score += isSpontaneous ? 2 : 0.5;
    }
  }
  maxDataPoints++;
  if (dp?.typical_wait_minutes != null) {
    dataPoints++;
    if (dp.typical_wait_minutes > 60) score -= 1;
    else if (dp.typical_wait_minutes > 30) score -= 0.5;
    else score += 1;
  }
  if (dp?.payment_notes && dp.payment_notes.toLowerCase().includes("cash")) {
    maxDataPoints++;
    dataPoints++;
    score -= 0.5;
  }
  const v2IntentForConstraints = intent && "practical_constraints" in intent ? intent : null;
  const constraints = v2IntentForConstraints?.practical_constraints || [];
  const wantsByob = requestLower.includes("byob") || constraints.includes("byob_preference");
  if (wantsByob) {
    maxDataPoints++;
    if (dp?.byob_policy && dp.byob_policy.toLowerCase().includes("byob")) {
      dataPoints++;
      score += 1.5;
    } else if (profile.tags.some((t) => /byob/i.test(t))) {
      dataPoints++;
      score += 1.5;
    }
  }
  if (profile.parking_availability && !/none|no /i.test(profile.parking_availability)) {
    score += 0.5;
  }
  const finalScore = Math.min(10, Math.max(0, score));
  const details = {};
  const timingDelta = timeOfDay && profile.best_times?.includes(timeOfDay) ? 2 : timeOfDay && profile.best_times?.length ? profile.best_times.length <= 2 ? -2 : -0.5 : 0;
  details.timing = { score: Math.max(0, 4 + timingDelta), max: 6, signal: timeOfDay && profile.best_times?.includes(timeOfDay) ? `Good for ${timeOfDay}` : timeOfDay ? "Off-peak" : "No time data" };
  details.reservation = { score: dp?.reservation_difficulty === "walk_in_friendly" ? 2 : dp?.reservation_difficulty === "hard_to_get" ? 0 : 1, max: 2, signal: dp?.reservation_difficulty || "No data" };
  details.practical = { score: Math.max(0, finalScore - (4 + timingDelta) - (dp?.reservation_difficulty === "walk_in_friendly" ? 2 : dp?.reservation_difficulty === "hard_to_get" ? -2.5 : 0)), max: 2, signal: profile.parking_availability || "Standard" };
  return {
    score: finalScore,
    dataPoints,
    maxDataPoints,
    details
  };
}
function isRelatedCuisine(cuisine, targets) {
  let family = CUISINE_TO_FAMILY[cuisine];
  if (!family) {
    const cuisineLower = cuisine.toLowerCase();
    const match = Object.entries(CUISINE_TO_FAMILY).find(
      ([key]) => cuisineLower.includes(key.toLowerCase())
    );
    if (match) family = match[1];
  }
  if (!family) return false;
  return targets.some((t) => {
    if (t.toLowerCase() === family.toLowerCase()) return true;
    let targetFamily = CUISINE_TO_FAMILY[t];
    if (!targetFamily) {
      const tLower = t.toLowerCase();
      const tmatch = Object.entries(CUISINE_TO_FAMILY).find(
        ([key]) => tLower.includes(key.toLowerCase())
      );
      if (tmatch) targetFamily = tmatch[1];
    }
    return targetFamily === family;
  });
}
var FLAVOR_KEYWORDS = {
  smoky: ["smoky", "charred", "grilled", "wood-fired"],
  spicy: ["bold-spiced", "chili-forward", "fiery"],
  fresh: ["bright-acidic", "herbaceous", "citrus-forward", "light"],
  rich: ["umami-forward", "rich-buttery", "creamy", "decadent"],
  sweet: ["sweet-savory", "caramelized", "honey-glazed"],
  tangy: ["fermented", "pickled", "vinegar-bright", "bright-acidic"],
  earthy: ["earthy", "mushroom", "truffle", "root-vegetable"],
  savory: ["umami-forward", "savory", "meaty"]
};
function extractFlavorIntent(specialRequest) {
  const lower = specialRequest.toLowerCase();
  const matches = [];
  for (const [keyword, flavors] of Object.entries(FLAVOR_KEYWORDS)) {
    if (lower.includes(keyword)) {
      matches.push(...flavors);
    }
  }
  return [...new Set(matches)];
}

// supabase/functions/recommend/_shared/weight-config-v5.ts
var V5_BASE_WEIGHTS = {
  food: 0.25,
  vibe: 0.18,
  service: 0.17,
  reputation: 0.25,
  convenience: 0.15
};
var V5_WEIGHT_SHIFT_RULES = [
  // --- Category A: Occasion shifts (8 rules) ---
  {
    condition: { occasion: ["Date Night", "Special Occasion"] },
    deltas: { vibe: 0.08, service: 0.04, convenience: -0.08, reputation: -0.04 },
    label: "Date/special: vibe + service up, convenience down"
  },
  {
    condition: { occasion: ["Business Lunch"] },
    deltas: { service: 0.08, vibe: 0.04, food: -0.04, convenience: -0.04, reputation: -0.04 },
    label: "Business: service + vibe up, food down"
  },
  {
    condition: { occasion: ["Adventure"] },
    deltas: { reputation: 0.05, food: -0.03, service: -0.02 },
    label: "Adventure: reputation up (hidden gems)"
  },
  {
    condition: { occasion: ["Family Dinner"] },
    deltas: { service: 0.05, convenience: 0.08, vibe: -0.08, reputation: -0.05 },
    label: "Family: convenience + service up, vibe down"
  },
  {
    condition: { occasion: ["Solo Dining"] },
    deltas: { convenience: 0.08, food: 0.05, service: -0.08, vibe: -0.05 },
    label: "Solo: convenience + food up, service down"
  },
  {
    condition: { occasion: ["Treat Myself"] },
    deltas: { food: 0.05, vibe: 0.05, convenience: -0.1 },
    label: "Treat myself: food + vibe up, convenience down"
  },
  {
    condition: { occasion: ["Chill Hangout"] },
    deltas: { vibe: 0.08, convenience: 0.05, food: -0.08, reputation: -0.05 },
    label: "Chill: vibe + convenience up, food down"
  },
  {
    condition: { occasion: ["Group Hangout"] },
    deltas: { service: 0.05, vibe: 0.05, food: -0.05, reputation: -0.05 },
    label: "Group: service + vibe up, food + reputation down"
  },
  // --- Category B: Cuisine importance shifts (3 rules) ---
  {
    condition: { cuisineImportance: "high" },
    deltas: { food: 0.15, vibe: -0.05, service: -0.05, reputation: -0.05 },
    label: "High cuisine priority: food dominates"
  },
  {
    condition: { cuisineImportance: "medium" },
    deltas: { food: 0.05, vibe: -0.025, convenience: -0.025 },
    label: "Medium cuisine priority: food slightly up"
  },
  {
    condition: { cuisineImportance: "low" },
    deltas: { vibe: 0.05, service: 0.03, food: -0.08 },
    label: "Low cuisine priority: vibe + service up, food down"
  },
  // --- Category C: Emotional intent shifts (6 rules) ---
  {
    condition: { emotionalIntent: "impress" },
    deltas: { reputation: 0.08, service: 0.04, convenience: -0.07, food: -0.05 },
    label: "Impress: reputation + service up"
  },
  {
    condition: { emotionalIntent: "comfort" },
    deltas: { vibe: 0.08, food: 0.03, reputation: -0.06, service: -0.05 },
    label: "Comfort: vibe + food up"
  },
  {
    condition: { emotionalIntent: "explore" },
    deltas: { reputation: 0.05, food: 0.03, vibe: -0.04, convenience: -0.04 },
    label: "Explore: reputation + food up (discovery)"
  },
  {
    condition: { emotionalIntent: "celebrate" },
    deltas: { vibe: 0.07, service: 0.05, reputation: 0.03, food: -0.08, convenience: -0.07 },
    label: "Celebrate: vibe + service + reputation up"
  },
  {
    condition: { emotionalIntent: "casual" },
    deltas: { convenience: 0.05, food: -0.03, service: -0.02 },
    label: "Casual: convenience up, low effort"
  },
  {
    condition: { emotionalIntent: "indulge" },
    deltas: { food: 0.08, vibe: 0.04, convenience: -0.08, service: -0.04 },
    label: "Indulge: food + vibe up, convenience down"
  },
  // --- Category D: Constraint shifts (3 rules) ---
  {
    condition: { priceSensitive: true },
    deltas: { convenience: 0.1, food: -0.05, vibe: -0.05 },
    label: "Price sensitive: convenience up"
  },
  {
    condition: { spontaneous: true },
    deltas: { convenience: 0.12, service: -0.05, vibe: -0.07 },
    label: "Spontaneous: convenience up (walk-in, no wait)"
  },
  {
    condition: { planned: true },
    deltas: { service: 0.05, vibe: 0.05, convenience: -0.1 },
    label: "Planned: service + vibe up, convenience down"
  },
  // --- Category E: Context signals (8 rules) ---
  {
    condition: { dateType: "first_date" },
    deltas: { vibe: 0.1, reputation: 0.05, food: -0.07, convenience: -0.08 },
    label: "First date: vibe + reputation up (safe pick)"
  },
  {
    condition: { dateType: "anniversary" },
    deltas: { vibe: 0.08, service: 0.05, reputation: 0.05, food: -0.08, convenience: -0.1 },
    label: "Anniversary: must be special"
  },
  {
    condition: { groupSizeHint: "large_group" },
    deltas: { service: 0.08, convenience: 0.07, vibe: -0.05, food: -0.05, reputation: -0.05 },
    label: "Large group: logistics dominate"
  },
  {
    condition: { groupSizeHint: "solo" },
    deltas: { food: 0.05, convenience: 0.05, service: -0.05, vibe: -0.05 },
    label: "Solo: food + convenience up"
  },
  {
    condition: { timeOfDay: "late_night" },
    deltas: { convenience: 0.08, vibe: 0.05, service: -0.08, reputation: -0.05 },
    label: "Late night: open late matters most"
  },
  {
    condition: { timeOfDay: "breakfast" },
    deltas: { food: 0.05, convenience: 0.05, vibe: -0.05, reputation: -0.05 },
    label: "Breakfast: quality + quick"
  }
];
var WEIGHT_MIN = 0.05;
var WEIGHT_MAX = 0.5;
function matchesCondition(condition, occasion, intent, clientTimeOfDay) {
  if (condition.occasion && !condition.occasion.includes(occasion)) return false;
  if (condition.cuisineImportance && intent?.cuisine_importance !== condition.cuisineImportance) return false;
  if (condition.emotionalIntent && intent?.emotional_intent !== condition.emotionalIntent) return false;
  if (condition.priceSensitive !== void 0) {
    const isPriceSensitive = intent?.practical_constraints?.some(
      (c) => /budget|cheap|affordable|value|price/i.test(c)
    ) ?? false;
    if (condition.priceSensitive !== isPriceSensitive) return false;
  }
  if (condition.spontaneous !== void 0) {
    const isSpontaneous = intent?.spontaneity === "spontaneous";
    if (condition.spontaneous !== isSpontaneous) return false;
  }
  if (condition.planned !== void 0) {
    const isPlanned = intent?.spontaneity === "planned";
    if (condition.planned !== isPlanned) return false;
  }
  if (condition.dateType && intent?.date_type !== condition.dateType) return false;
  if (condition.groupSizeHint && intent?.group_size_hint !== condition.groupSizeHint) return false;
  if (condition.timeOfDay) {
    const tod = clientTimeOfDay || null;
    if (tod !== condition.timeOfDay) return false;
  }
  return true;
}
function adaptWeightsToDataQuality(weights, confidence) {
  const adapted = { ...weights };
  const BOOST_HIGH = 1.15;
  const KEEP_MEDIUM = 1;
  const REDUCE_LOW = 0.8;
  const getMultiplier = (c) => {
    if (c === "high") return BOOST_HIGH;
    if (c === "medium") return KEEP_MEDIUM;
    return REDUCE_LOW;
  };
  adapted.food *= getMultiplier(confidence.food);
  adapted.vibe *= getMultiplier(confidence.vibe);
  adapted.service *= getMultiplier(confidence.service);
  adapted.reputation *= getMultiplier(confidence.reputation);
  adapted.convenience *= getMultiplier(confidence.convenience);
  return adapted;
}
function adaptWeightsToPoolSize(weights, candidatePoolSize) {
  const adapted = { ...weights };
  if (candidatePoolSize <= 5) {
    adapted.reputation += 0.05;
    adapted.food += 0.05;
    adapted.vibe -= 0.05;
    adapted.convenience -= 0.05;
  }
  return adapted;
}
function clampAndNormalize(weights) {
  const w = { ...weights };
  w.food = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.food));
  w.vibe = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.vibe));
  w.service = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.service));
  w.reputation = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.reputation));
  w.convenience = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w.convenience));
  const sum = w.food + w.vibe + w.service + w.reputation + w.convenience;
  if (Math.abs(sum - 1) > 1e-3) {
    w.food /= sum;
    w.vibe /= sum;
    w.service /= sum;
    w.reputation /= sum;
    w.convenience /= sum;
  }
  return w;
}
function computeV5Weights(occasion, intent, confidence, candidatePoolSize = 15, clientTimeOfDay) {
  let w = { ...V5_BASE_WEIGHTS };
  const appliedRules = [];
  for (const rule of V5_WEIGHT_SHIFT_RULES) {
    if (matchesCondition(rule.condition, occasion, intent, clientTimeOfDay)) {
      if (rule.deltas.food) w.food += rule.deltas.food;
      if (rule.deltas.vibe) w.vibe += rule.deltas.vibe;
      if (rule.deltas.service) w.service += rule.deltas.service;
      if (rule.deltas.reputation) w.reputation += rule.deltas.reputation;
      if (rule.deltas.convenience) w.convenience += rule.deltas.convenience;
      if (rule.label) appliedRules.push(rule.label);
    }
  }
  w = adaptWeightsToDataQuality(w, confidence);
  const lowConfFactors = [];
  const highConfFactors = [];
  for (const [factor, level] of Object.entries(confidence)) {
    if (level === "low") lowConfFactors.push(factor);
    if (level === "high") highConfFactors.push(factor);
  }
  if (lowConfFactors.length > 0) {
    appliedRules.push(`Data-quality: ${lowConfFactors.join(", ")} downweighted (sparse data)`);
  }
  if (highConfFactors.length > 0 && lowConfFactors.length > 0) {
    appliedRules.push(`Data-quality: ${highConfFactors.join(", ")} upweighted (strong data)`);
  }
  if (candidatePoolSize <= 5) {
    w = adaptWeightsToPoolSize(w, candidatePoolSize);
    appliedRules.push(`Pool-size: slim pickings (${candidatePoolSize}), quality prioritized`);
  }
  w = clampAndNormalize(w);
  return { weights: w, appliedRules };
}

// supabase/functions/recommend/_shared/scoring-v5.ts
var CONFIDENCE_MULTIPLIER = {
  high: 1,
  medium: 0.75,
  low: 0.5
};
var CONFIDENCE_PRIOR = 5.5;
var FACTOR_FLOOR = 1;
function adjustForConfidence(rawScore, confidence) {
  const mult = CONFIDENCE_MULTIPLIER[confidence];
  return rawScore * mult + CONFIDENCE_PRIOR * (1 - mult);
}
function computeFoodConfidence(profile, intent) {
  const dp = profile.deep_profile;
  const enrichConf = dp?.enrichment_confidence ?? 0;
  if (enrichConf >= 0.5 && intent?.cuisine_importance === "high") return "high";
  if (enrichConf >= 0.5 && profile.cuisine_type) return "high";
  if (enrichConf >= 0.3 || profile.cuisine_type) return "medium";
  return "low";
}
function computeVibeConfidence(profile, vibeDataPoints, vibeMaxDataPoints) {
  const dp = profile.deep_profile;
  const enrichConf = dp?.enrichment_confidence ?? 0;
  const dataRatio = vibeMaxDataPoints > 0 ? vibeDataPoints / vibeMaxDataPoints : 0;
  if (enrichConf >= 0.5 && dataRatio >= 0.5) return "high";
  if (enrichConf >= 0.3 || dataRatio >= 0.3) return "medium";
  return "low";
}
function computeServiceConfidence(profile) {
  const dp = profile.deep_profile;
  const enrichConf = dp?.enrichment_confidence ?? 0;
  const hasOccasionScores = (profile.date_friendly_score ?? 0) > 0 || (profile.group_friendly_score ?? 0) > 0 || (profile.family_friendly_score ?? 0) > 0;
  if (enrichConf >= 0.5 && hasOccasionScores) return "high";
  if (enrichConf >= 0.3 || hasOccasionScores) return "medium";
  return "low";
}
function computeReputationConfidence(googleData) {
  if (!googleData) return "low";
  const count = googleData.google_review_count || 0;
  if (count >= 200) return "high";
  if (count >= 10) return "medium";
  return "low";
}
function computeReputationV5(profile, googleData, sentimentScore, sentimentNegative) {
  let dataPoints = 0;
  let maxDataPoints = 0;
  const details = {};
  const dp = profile.deep_profile;
  maxDataPoints++;
  let googleScore = 0;
  if (googleData && googleData.google_rating != null) {
    dataPoints++;
    const rating = googleData.google_rating;
    const reviewCount = googleData.google_review_count || 0;
    const rawGoogleScore = Math.max(0, Math.min(10, (rating - 3.5) / 1.5 * 10));
    const reviewConfidence = reviewCount >= 200 ? 1 : reviewCount >= 50 ? 0.9 : reviewCount >= 10 ? 0.8 : 0.7;
    googleScore = rawGoogleScore * reviewConfidence;
    details.google = {
      score: googleScore,
      max: 10,
      signal: `${rating}\u2605 (${reviewCount} reviews, conf=${reviewConfidence})`
    };
  } else {
    googleScore = 5;
    details.google = { score: 5, max: 10, signal: "No Google data (neutral)" };
  }
  maxDataPoints++;
  let sentScore = 0;
  if (sentimentScore != null) {
    dataPoints++;
    sentScore = sentimentScore / 10 * 2;
    if (sentimentNegative != null && sentimentNegative > 30) {
      sentScore -= Math.min(1.5, (sentimentNegative - 30) / 40 * 1.5);
    }
    sentScore = Math.max(0, sentScore);
    details.sentiment = {
      score: sentScore,
      max: 2,
      signal: `Sentiment ${sentimentScore}/10`
    };
  } else {
    sentScore = 1;
    details.sentiment = { score: 1, max: 2, signal: "No sentiment data" };
  }
  maxDataPoints++;
  let awardsScore = 0;
  let awardsUsed = false;
  if (dp) {
    if (dp.chef_notable) {
      awardsScore += 0.75;
      awardsUsed = true;
    }
    if (dp.awards_recognition && dp.awards_recognition.length > 0) {
      awardsScore += 0.75;
      awardsUsed = true;
    }
    if (awardsUsed) {
      dataPoints++;
      awardsScore = Math.min(1.5, awardsScore);
    }
  }
  if (!awardsUsed) {
    awardsScore = 0;
    details.awards = { score: 0, max: 1.5, signal: "No awards data" };
  } else {
    details.awards = {
      score: awardsScore,
      max: 1.5,
      signal: dp?.awards_recognition?.join(", ") || (dp?.chef_notable ? "Notable chef" : "Recognized")
    };
  }
  maxDataPoints++;
  let communityScore = 0;
  let communityUsed = false;
  if (dp) {
    if (profile.trending_score != null && profile.trending_score >= 7) {
      communityScore += 0.75;
      communityUsed = true;
    }
    if (dp.cultural_authenticity != null && dp.cultural_authenticity >= 7) {
      communityScore += 0.75;
      communityUsed = true;
    }
    if (communityUsed) {
      dataPoints++;
      communityScore = Math.min(1.5, communityScore);
    }
  }
  if (!communityUsed) {
    communityScore = 0;
    details.community = { score: 0, max: 1.5, signal: "No community data" };
  } else {
    const signals = [];
    if (profile.trending_score != null && profile.trending_score >= 7) signals.push("Trending");
    if (dp?.cultural_authenticity != null && dp.cultural_authenticity >= 7) signals.push("Culturally authentic");
    details.community = {
      score: communityScore,
      max: 1.5,
      signal: signals.join(", ") || "Community signal"
    };
  }
  const adaptiveMax = 10 * 0.65 + 2 + (awardsUsed ? 1.5 : 0) + (communityUsed ? 1.5 : 0);
  const effectiveDenom = Math.max(adaptiveMax, 8.5);
  const rawReputation = googleScore * 0.65 + sentScore + awardsScore + communityScore;
  const reputation = Math.min(10, Math.max(0, rawReputation / effectiveDenom * 10));
  return {
    score: reputation,
    confidence: computeReputationConfidence(googleData),
    dataPoints,
    maxDataPoints,
    details
  };
}
function computeConvenienceV5(profile, intent, clientTimeOfDay, specialRequest) {
  const v3Result = computeConvenience(profile, intent, clientTimeOfDay, specialRequest);
  const v5Score = Math.min(10, v3Result.score + 1);
  return {
    score: v5Score,
    confidence: "high",
    // Convenience always has high confidence
    dataPoints: v3Result.dataPoints,
    maxDataPoints: v3Result.maxDataPoints,
    details: v3Result.details ? convertDetails(v3Result.details) : void 0
  };
}
function foodAbsorbedAdjustmentV5(rawScore, profile, userFeedback, rejectionSignals) {
  let adjusted = rawScore;
  if (userFeedback && profile.cuisine_type) {
    if (userFeedback.likedCuisines.includes(profile.cuisine_type)) {
      adjusted += 0.8;
    }
    if (userFeedback.dislikedCuisines.includes(profile.cuisine_type)) {
      adjusted -= 1;
    }
  }
  if (rejectionSignals && profile.cuisine_type) {
    if (rejectionSignals.avoidCuisines.includes(profile.cuisine_type)) {
      const alreadyPenalized = userFeedback?.dislikedCuisines.includes(profile.cuisine_type);
      if (!alreadyPenalized) {
        adjusted -= 0.5;
      }
    }
  }
  if (userFeedback?.dislikedRestaurantIds.includes(profile.id)) {
    adjusted -= 1.5;
  }
  return adjusted;
}
function computeV5DondeMatch(profile, inputs) {
  const foodResult = computeFoodMatch(
    profile,
    inputs.intent,
    inputs.dietaryRestrictions,
    inputs.specialRequest
  );
  const settingResult = computeSettingFit(profile, inputs.occasion, inputs.intent);
  let atmosphereResult = computeAtmosphere(
    profile,
    inputs.occasion,
    inputs.intent,
    inputs.specialRequest
  );
  if (atmosphereResult.dataPoints === 0) {
    atmosphereResult = { ...atmosphereResult, score: 5.5 };
  }
  const reputationResult = computeReputationV5(
    profile,
    inputs.googleData,
    inputs.sentimentScore,
    inputs.sentimentNegative
  );
  const convenienceResult = computeConvenienceV5(
    profile,
    inputs.intent,
    inputs.clientTimeOfDay,
    inputs.specialRequest
  );
  const adjustedFood = foodAbsorbedAdjustmentV5(
    foodResult.score,
    profile,
    inputs.userFeedback,
    inputs.rejectionSignals
  );
  const confidence = {
    food: computeFoodConfidence(profile, inputs.intent),
    vibe: computeVibeConfidence(profile, atmosphereResult.dataPoints, atmosphereResult.maxDataPoints),
    service: computeServiceConfidence(profile),
    reputation: computeReputationConfidence(inputs.googleData),
    convenience: "high"
    // Convenience always has high confidence
  };
  const factors = {
    food: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(adjustedFood, confidence.food))),
    vibe: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(atmosphereResult.score, confidence.vibe))),
    service: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(settingResult.score, confidence.service))),
    reputation: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(reputationResult.score, confidence.reputation))),
    convenience: Math.max(FACTOR_FLOOR, Math.min(10, adjustForConfidence(convenienceResult.score, confidence.convenience)))
  };
  const { weights, appliedRules } = computeV5Weights(
    inputs.occasion,
    inputs.intent,
    confidence,
    inputs.candidatePoolSize ?? 15,
    inputs.clientTimeOfDay
  );
  const geometricMean = Math.pow(factors.food, weights.food) * Math.pow(factors.vibe, weights.vibe) * Math.pow(factors.service, weights.service) * Math.pow(factors.reputation, weights.reputation) * Math.pow(factors.convenience, weights.convenience);
  const dondeMatch = Math.min(99, Math.max(0, Math.round(geometricMean * 12)));
  const totalDataPoints = foodResult.dataPoints + settingResult.dataPoints + atmosphereResult.dataPoints + reputationResult.dataPoints + convenienceResult.dataPoints;
  const totalMaxPoints = foodResult.maxDataPoints + settingResult.maxDataPoints + atmosphereResult.maxDataPoints + reputationResult.maxDataPoints + convenienceResult.maxDataPoints;
  const dataCompleteness = totalMaxPoints > 0 ? totalDataPoints / totalMaxPoints : 0;
  const factorDetails = {};
  if (foodResult.details) factorDetails.food = convertDetails(foodResult.details);
  if (settingResult.details) factorDetails.service = convertDetails(settingResult.details);
  if (atmosphereResult.details) factorDetails.vibe = convertDetails(atmosphereResult.details);
  if (reputationResult.details) factorDetails.reputation = reputationResult.details;
  if (convenienceResult.details) factorDetails.convenience = convenienceResult.details;
  return {
    dondeMatch,
    factors,
    weights,
    confidence,
    dataCompleteness,
    weightShiftReasons: appliedRules,
    factorDetails
  };
}
function reRankV5(profiles, occasion, specialRequest, intent, dietaryRestrictions, candidatePoolSize, clientTimeOfDay) {
  const scored = profiles.map((profile) => {
    const result = computeV5DondeMatch(profile, {
      occasion,
      specialRequest,
      neighborhood: "Anywhere",
      // Already filtered
      priceLevel: "Any",
      // Already filtered
      googleData: null,
      // Not yet available at ranking time
      intent,
      dietaryRestrictions,
      candidatePoolSize: candidatePoolSize ?? profiles.length,
      clientTimeOfDay
    });
    return { profile, result };
  });
  scored.sort((a, b) => b.result.dondeMatch - a.result.dondeMatch);
  return scored;
}
function convertDetails(details) {
  const result = {};
  for (const [key, sub] of Object.entries(details)) {
    result[key] = { score: sub.score, max: sub.max, signal: sub.signal };
  }
  return result;
}
export {
  computeV5DondeMatch,
  reRankV5
};
