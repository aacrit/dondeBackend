export const NEIGHBORHOODS = [
  "Pilsen",
  "Wicker Park",
  "Logan Square",
  "Lincoln Park",
  "West Loop",
  "Bucktown",
  "Hyde Park",
  "Chinatown",
  "Little Italy",
  "Andersonville",
  "River North",
  "Old Town",
  "Lakeview",
  "Fulton Market",
] as const;

export const CUISINE_TYPES = [
  "Mexican",
  "American",
  "Italian",
  "Japanese",
  "Thai",
  "Chinese",
  "Korean",
  "French",
  "Seafood",
  "Steak",
  "Mediterranean",
  "Vietnamese",
  "Indian",
  "Ethiopian",
  "Peruvian",
  "Brazilian",
  "Brunch",
  "Vegan",
  "Cocktail Bar",
  "Coffee/Cafe",
  "Polish",
  "Puerto Rican",
  "Southern/Soul Food",
  "Middle Eastern",
  "Greek",
  "Fusion",
  "BBQ",
] as const;

export const CHICAGO_COORDS = { lat: 41.8781, lng: -87.6298 };
export const SEARCH_RADIUS = 50000;

export const PRICE_MAP: Record<number, string> = {
  0: "$",
  1: "$",
  2: "$$",
  3: "$$$",
  4: "$$$$",
};

export const ZIP_TO_NEIGHBORHOOD: Record<string, string> = {
  "60608": "Pilsen",
  "60601": "Loop",
  "60602": "Loop",
  "60603": "Loop",
  "60604": "Loop",
  "60605": "Loop",
  "60606": "Loop",
  "60622": "Wicker Park",
  "60647": "Logan Square",
  "60614": "Lincoln Park",
  "60607": "West Loop",
  "60661": "West Loop",
  "60654": "River North",
  "60610": "Old Town",
  "60625": "Andersonville",
  "60640": "Andersonville",
  "60616": "Chinatown",
  "60612": "Little Italy",
  "60657": "Lakeview",
  "60637": "Hyde Park",
  "60642": "Bucktown",
};

// Coordinate bounding boxes for neighborhood detection (fallback when ZIP is ambiguous)
export const NEIGHBORHOOD_BOUNDS: Record<
  string,
  { latMin: number; latMax: number; lngMin: number; lngMax: number }
> = {
  Pilsen: { latMin: 41.845, latMax: 41.865, lngMin: -87.685, lngMax: -87.645 },
  "Wicker Park": { latMin: 41.905, latMax: 41.915, lngMin: -87.685, lngMax: -87.665 },
  "Logan Square": { latMin: 41.915, latMax: 41.935, lngMin: -87.72, lngMax: -87.685 },
  "Lincoln Park": { latMin: 41.915, latMax: 41.945, lngMin: -87.66, lngMax: -87.63 },
  "West Loop": { latMin: 41.878, latMax: 41.89, lngMin: -87.66, lngMax: -87.635 },
  Bucktown: { latMin: 41.915, latMax: 41.925, lngMin: -87.685, lngMax: -87.665 },
  "Hyde Park": { latMin: 41.788, latMax: 41.808, lngMin: -87.605, lngMax: -87.58 },
  Chinatown: { latMin: 41.848, latMax: 41.856, lngMin: -87.64, lngMax: -87.625 },
  "Little Italy": { latMin: 41.865, latMax: 41.875, lngMin: -87.665, lngMax: -87.65 },
  Andersonville: { latMin: 41.976, latMax: 41.986, lngMin: -87.675, lngMax: -87.66 },
  "River North": { latMin: 41.888, latMax: 41.9, lngMin: -87.64, lngMax: -87.62 },
  "Old Town": { latMin: 41.905, latMax: 41.915, lngMin: -87.645, lngMax: -87.63 },
  Lakeview: { latMin: 41.94, latMax: 41.955, lngMin: -87.66, lngMax: -87.635 },
  "Fulton Market": { latMin: 41.882, latMax: 41.89, lngMin: -87.66, lngMax: -87.645 },
};

export const OCCASION_SCORE_MAP: Record<string, string> = {
  "Date Night": "date_friendly_score",
  "Group Hangout": "group_friendly_score",
  "Family Dinner": "family_friendly_score",
  "Business Lunch": "business_lunch_score",
  "Solo Dining": "solo_dining_score",
  "Special Occasion": "romantic_rating",
  "Treat Myself": "solo_dining_score",
  Adventure: "hole_in_wall_factor",
  "Chill Hangout": "group_friendly_score",
  Any: "date_friendly_score",
};
