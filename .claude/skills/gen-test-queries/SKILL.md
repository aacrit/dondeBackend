---
name: gen-test-queries
description: "Generates 10 diverse, persona-driven test queries simulating real Chicago users. Maintains a 1000-query repository at tests/generated-queries.json. Covers demographics: time of day, gender, age, religion, cultural background, occasion. Invoke with: /gen-test-queries"
user-invocable: true
allowed-tools: [Read, Write, Edit, Bash]
---

# DondeAI Test Query Generator

You are a test query generation agent for DondeAI, the AI restaurant recommendation engine for Chicago. Your job is to generate **10 realistic, diverse test queries** per invocation that simulate how real people search for restaurants, and append them to `tests/generated-queries.json`.

## Why This Skill Exists

Static test suites (golden-50, benchmark-200) are hand-crafted and limited. Real users are diverse — they search differently based on their background, time of day, mood, dietary needs, and occasion. This skill builds a living test corpus of 1000 queries that stress-tests the scoring engine across the full spectrum of human restaurant search behavior.

## Execution Protocol

### Step 1: Read Current State

```
1. Read tests/generated-queries.json (if it doesn't exist, create the seed structure)
2. Use bash/jq to extract distribution summary:
   - Total query count
   - Count per category
   - Count per time_of_day
   - Count per cultural_background
   - Count per age_group
   - Count per occasion
3. Read tests/golden-dataset-test.sh to note the 50 existing golden queries (avoid duplicating)
4. Read tests/benchmark-200.sh to note the 200 existing benchmark queries (avoid duplicating)
```

If `total_queries >= 1000`, report "Repository full (1000/1000). No new queries generated." and stop.

### Step 2: Distribution Audit

Compute gap analysis across all dimensions. Identify the most underrepresented values:

```
Target per 1000 queries:
  - Category: 100 each × 10 categories
  - Time of day: 250 each × 4 slots
  - Age group: ~167 each × 6 groups
  - Gender: ~450/450/100 (male/female/non_binary)
  - Cultural background: ~59 each × 17 backgrounds
  - Occasion: 100 each × 10 occasions
  - Queries with dietary restrictions: ~200 (20%)
  - Queries with misspellings/slang: ~300 (30%)
```

Identify the 3 most underrepresented values in each dimension. The 10 new queries should prioritize filling these gaps.

### Step 3: Generate 10 Personas

For each of the 10 queries, construct a unique persona by selecting one value from each dimension. Prioritize underrepresented combinations from Step 2.

### Step 4: Generate Queries

For each persona, think deeply: "What would this specific person actually type into a restaurant search app?" Write the `special_request` in their authentic voice. Fill in all API request fields based on what's natural for this persona.

### Step 5: Deduplication Check

Before finalizing, verify:
1. No exact `special_request` match (case-insensitive) with existing queries
2. No close paraphrase of golden dataset or benchmark-200 queries
3. If a duplicate is found, regenerate that query with a different angle

### Step 6: Write Output

1. Append the 10 new query objects to the `queries` array in `tests/generated-queries.json`
2. Update `metadata.total_queries` to the new count
3. Update `metadata.last_generated` to the current ISO timestamp
4. Recompute all `metadata.distribution` counts
5. Validate JSON with: `cat tests/generated-queries.json | jq . > /dev/null`
6. Display the generation report (see Output Format below)

## Persona Dimensions

### Age Group
| Value | Age Range | Search Behavior |
|-------|-----------|-----------------|
| `college_student` | 18-22 | Budget-conscious, trendy, social media influenced, late night, slang-heavy |
| `young_professional` | 23-34 | Foodie culture, date spots, after-work, Instagram-worthy, adventurous |
| `mid_career` | 35-49 | Quality-focused, client entertaining, neighborhood regulars, wine knowledge |
| `family_parent` | 30-50 | Kid-friendly, practical constraints, value, weekend brunch, parking needs |
| `empty_nester` | 50-65 | Fine dining, wine lists, classic spots, exploring new cuisines, travel-inspired |
| `retiree` | 65+ | Lunch crowd, familiar cuisines, quiet atmospheres, early dinner, good service |

### Gender
`male`, `female`, `non_binary`

### Cultural Background (reflecting Chicago demographics)
| Value | Food Affinities | Neighborhoods |
|-------|-----------------|---------------|
| `Mexican-American` | Tacos, mole, pozole, tamales, birria, elote | Pilsen, Little Village, Logan Square |
| `Polish-American` | Pierogi, kielbasa, borscht, placki | Avondale, Irving Park |
| `Chinese-American` | Dim sum, hot pot, hand-pulled noodles, congee | Chinatown, Bridgeport |
| `Indian-American` | Biryani, dosa, chaat, tandoori, thali | Devon Ave (Rogers Park) |
| `Korean-American` | KBBQ, jjajangmyeon, tteokbokki, kimchi jjigae | Albany Park, Lincoln Square |
| `African-American` | Soul food, BBQ, comfort food, Southern, catfish | South Loop, Hyde Park, Bronzeville |
| `Irish-American` | Pub fare, brunch, whiskey bars, shepherd's pie | Beverly, Bridgeport |
| `Italian-American` | Pasta, deep dish, Italian beef, cannoli | Taylor Street, various |
| `Filipino-American` | Adobo, lumpia, sinigang, lechon | Lincoln Square, North Side |
| `Puerto-Rican` | Mofongo, pernil, jibaritos, tostones | Humboldt Park, Logan Square |
| `Middle-Eastern` | Shawarma, falafel, kebab, hummus, baklava | Albany Park, North Side |
| `Eastern-European` | Pelmeni, schnitzel, goulash, blini | Ukrainian Village, Lincoln Square |
| `Japanese-American` | Sushi, ramen, izakaya, omakase, udon | Various |
| `Vietnamese-American` | Pho, banh mi, bun bo hue, spring rolls | Uptown, Argyle |
| `Caribbean-American` | Jerk chicken, oxtail, patties, curry goat | Various |
| `mainstream-American` | Burgers, steaks, brunch, cocktails, wings | Various |
| `mixed-multicultural` | Fusion, diverse, exploratory, open-minded | Various |

### Religion & Dietary Influence
| Religion | Dietary Effect |
|----------|---------------|
| `none` | No restrictions |
| `Christian` | No restrictions typically |
| `Catholic` | Fish on Fridays (contextual) |
| `Muslim` | Halal requirement → `dietary_restrictions: ["halal"]` |
| `Jewish` | Kosher requirement → `dietary_restrictions: ["kosher"]` |
| `Hindu` | Often vegetarian → `dietary_restrictions: ["vegetarian"]` |
| `Buddhist` | Sometimes vegetarian |
| `Sikh` | Sometimes vegetarian, no beef |

### Time of Day
| Value | Typical Queries |
|-------|-----------------|
| `breakfast` | "brunch spot", "good pancakes", "coffee and pastry", "egg sandwich", "acai bowl" |
| `lunch` | "quick lunch", "business lunch", "lunch near the loop", "salad spot", "soup" |
| `dinner` | "date night", "family dinner", "nice restaurant", "sushi tonight", "steak" |
| `late_night` | "late night eats", "after bar food", "open late", "drunk food", "4am tacos" |

### Occasion
`Any`, `Date Night`, `Group Hangout`, `Family Dinner`, `Business Lunch`, `Solo Dining`, `Special Occasion`, `Treat Myself`, `Adventure`, `Chill Hangout`

### Query Category
| Category | Threshold | Description |
|----------|-----------|-------------|
| `Cuisine` | 55 | Direct cuisine type ("thai food", "italian") |
| `Dish` | 55 | Specific dish ("birria tacos", "ramen") |
| `Vibe` | 50 | Atmosphere ("cozy date spot", "lively bar") |
| `Multi` | 45 | Multiple signals ("romantic Italian near river north") |
| `Discovery` | 40 | Surprise/explore ("surprise me", "hidden gem") |
| `Contextual` | 45 | Situation-based ("dinner before Bulls game") |
| `Reputation` | 55 | Awards/prestige ("michelin star", "best in chicago") |
| `Constraints` | 45 | Practical needs ("BYOB", "outdoor patio") |
| `Niche` | 35 | Uncommon cuisines ("Georgian food", "Oaxacan mole") |
| `Complex` | 40 | Natural language ("where do chefs eat on their night off") |

## Valid API Field Values

### Neighborhoods (use these exact strings or "Anywhere")
The Loop, River North, Streeterville, West Loop, Lincoln Park, Lakeview, Wicker Park, Logan Square, Pilsen, Chinatown, South Loop, Hyde Park, Edgewater, Lincoln Square, Andersonville, Uptown, Rogers Park, Gold Coast, Ukrainian Village, Bucktown, North Center, Avondale, Humboldt Park, Little Village, Bridgeport, Irving Park, Portage Park, Albany Park, Anywhere

### Price Levels
`$`, `$$`, `$$$`, `$$$$`, `Any`

### Dietary Restrictions (array, can be empty)
`vegetarian`, `vegan`, `gluten_free`, `halal`, `kosher`

## 50 Example Persona-to-Query Mappings

Study these carefully. They define the generation style and voice.

### Food / Cuisine / Dish Queries
1. **Maria, 42, Mexican-American, Catholic, dinner, Family Dinner** → `"looking for a place like my abuela's cooking, maybe mole or enchiladas suizas, somewhere the kids can come"` | neighborhood: Pilsen, price: $$, category: Multi
2. **Kenji, 35, Japanese-American, Buddhist, dinner, Treat Myself** → `"real omakase, not the americanized stuff"` | neighborhood: Anywhere, price: $$$$, category: Dish
3. **Anika, 29, Indian-American, Hindu, lunch, Solo Dining** → `"good dosa place, south indian not just north"` | neighborhood: Rogers Park, price: $, dietary: ["vegetarian"], category: Dish
4. **Wei, 55, Chinese-American, none, lunch, Family Dinner** → `"dim sum for sunday family lunch, gotta have har gow and siu mai"` | neighborhood: Chinatown, price: $$, category: Dish
5. **Tomasz, 62, Polish-American, Catholic, dinner, Any** → `"where can I get good pierogi? not the frozen kind"` | neighborhood: Avondale, price: $$, category: Dish
6. **Amara, 27, African-American, Christian, dinner, Chill Hangout** → `"soul food or good bbq, like real deal not fancy bbq"` | neighborhood: Hyde Park, price: $$, category: Cuisine
7. **Carlos, 33, Puerto-Rican, Catholic, lunch, Any** → `"jibarito near humboldt park"` | neighborhood: Humboldt Park, price: $, category: Dish
8. **Thanh, 24, Vietnamese-American, Buddhist, lunch, Solo Dining** → `"pho near argyle, the real stuff"` | neighborhood: Uptown, price: $, category: Dish
9. **Seamus, 45, Irish-American, Catholic, dinner, Group Hangout** → `"good pub grub, needs to have proper whiskey selection"` | neighborhood: Anywhere, price: $$, category: Multi
10. **Yuki, 30, Japanese-American, none, dinner, Date Night** → `"izakaya style, small plates and sake"` | neighborhood: Anywhere, price: $$$, category: Vibe

### Vibe / Atmosphere Queries
11. **Jake, 26, mainstream-American, none, late_night, Chill Hangout** → `"drunk food near wicker park, pizza or tacos idc"` | neighborhood: Wicker Park, price: $, category: Complex
12. **Sophia, 28, Italian-American, none, dinner, Date Night** → `"somewhere dark and moody with good wine, kinda romantic"` | neighborhood: Anywhere, price: $$$, category: Vibe
13. **DeShawn, 31, African-American, none, dinner, Date Night** → `"rooftop dinner with a view, trying to impress someone"` | neighborhood: River North, price: $$$, category: Vibe
14. **Emma, 22, mainstream-American, none, lunch, Chill Hangout** → `"cute cafe vibes, good for working on laptop"` | neighborhood: Wicker Park, price: $$, category: Vibe
15. **Raj, 40, Indian-American, Hindu, dinner, Business Lunch** → `"upscale but not pretentious, good for client dinner"` | neighborhood: West Loop, price: $$$$, dietary: ["vegetarian"], category: Vibe
16. **Catalina, 23, mixed-multicultural, none, late_night, Adventure** → `"speakeasy type place, hidden entrance kinda deal"` | neighborhood: Anywhere, price: $$$, category: Vibe
17. **Marcus, 55, African-American, Christian, dinner, Special Occasion** → `"jazz club with good food, anniversary dinner"` | neighborhood: South Loop, price: $$$, category: Multi
18. **Hannah, 32, Eastern-European, Jewish, dinner, Group Hangout** → `"lively dinner spot for like 8 people, somewhere fun not boring"` | neighborhood: Lincoln Park, price: $$, category: Constraints
19. **Tyler, 21, mainstream-American, none, late_night, Chill Hangout** → `"best late night spot open past midnight"` | neighborhood: Anywhere, price: $, category: Constraints
20. **Nina, 38, Eastern-European, none, dinner, Treat Myself** → `"cozy wine bar with charcuterie, just me tonight"` | neighborhood: Andersonville, price: $$$, category: Multi

### Contextual / Situational Queries
21. **Mike, 34, Irish-American, Catholic, dinner, Group Hangout** → `"dinner before the cubs game, walking distance to wrigley"` | neighborhood: Lakeview, price: $$, category: Contextual
22. **Priya, 31, Indian-American, Hindu, lunch, Business Lunch** → `"nice vegetarian-friendly spot for a client lunch, somewhere impressive but not stuffy"` | neighborhood: The Loop, price: $$$, dietary: ["vegetarian"], category: Multi
23. **Omar, 28, Middle-Eastern, Muslim, dinner, Date Night** → `"halal fine dining for anniversary, something really special"` | neighborhood: Anywhere, price: $$$$, dietary: ["halal"], category: Multi
24. **Lisa, 45, mainstream-American, none, dinner, Family Dinner** → `"birthday dinner for my 10 year old, she likes pasta, need room for 12"` | neighborhood: Anywhere, price: $$, category: Contextual
25. **David, 52, Jewish, Jewish, lunch, Business Lunch** → `"kosher lunch near the loop, meeting with a client"` | neighborhood: The Loop, price: $$$, dietary: ["kosher"], category: Multi
26. **Mei, 26, Chinese-American, none, dinner, Group Hangout** → `"hot pot for 6, somewhere with good broth options"` | neighborhood: Chinatown, price: $$, category: Multi
27. **Ahmad, 35, Middle-Eastern, Muslim, lunch, Solo Dining** → `"halal chicken spot near devon ave"` | neighborhood: Rogers Park, price: $, dietary: ["halal"], category: Cuisine
28. **Sarah, 29, mainstream-American, none, breakfast, Any** → `"best brunch cocktails, bottomless mimosa situation"` | neighborhood: Anywhere, price: $$, category: Vibe
29. **Roberto, 60, Italian-American, Catholic, dinner, Special Occasion** → `"old school italian, white tablecloth, the kind of place my father used to take us"` | neighborhood: Anywhere, price: $$$$, category: Complex
30. **Jasmine, 19, African-American, Christian, late_night, Chill Hangout** → `"cheap eats open late near UChicago"` | neighborhood: Hyde Park, price: $, category: Contextual

### Discovery / Reputation Queries
31. **Alex, 33, mixed-multicultural, none, dinner, Adventure** → `"surprise me with something I've never tried, I'm adventurous"` | neighborhood: Anywhere, price: Any, category: Discovery
32. **Grace, 48, mainstream-American, none, dinner, Special Occasion** → `"best restaurant in chicago, no budget, michelin preferred"` | neighborhood: Anywhere, price: $$$$, category: Reputation
33. **Jordan, 27, mainstream-American, none, dinner, Treat Myself** → `"that restaurant everyone on tiktok is posting about"` | neighborhood: Anywhere, price: Any, category: Complex
34. **Chen, 41, Chinese-American, none, dinner, Any** → `"where do chicago chefs eat on their night off"` | neighborhood: Anywhere, price: Any, category: Complex
35. **Fatima, 25, Middle-Eastern, Muslim, dinner, Group Hangout** → `"best middle eastern in chicago, like lebanese or syrian, halal obv"` | neighborhood: Anywhere, price: $$, dietary: ["halal"], category: Cuisine

### Constraint / Practical Queries
36. **Becky, 36, mainstream-American, none, lunch, Family Dinner** → `"gluten free options that are actually good, not just a sad salad"` | neighborhood: Anywhere, price: $$, dietary: ["gluten_free"], category: Constraints
37. **Dan, 44, mainstream-American, none, dinner, Any** → `"byob near logan square, bringing my own wine"` | neighborhood: Logan Square, price: $$, category: Constraints
38. **Soo-jin, 29, Korean-American, none, dinner, Date Night** → `"outdoor patio dinner, somewhere pretty for instagram"` | neighborhood: Anywhere, price: $$$, category: Multi
39. **Tom, 70, mainstream-American, Christian, lunch, Solo Dining** → `"quiet lunch spot, not too loud, good soup maybe"` | neighborhood: Lincoln Park, price: $$, category: Multi
40. **Lupita, 38, Mexican-American, Catholic, dinner, Family Dinner** → `"good for big family, like 15 people, mexican or american, parking would be nice"` | neighborhood: Anywhere, price: $$, category: Constraints

### Niche / Complex Natural Language
41. **Andrei, 32, Eastern-European, none, dinner, Adventure** → `"georgian food, khachapuri and khinkali, does that even exist here"` | neighborhood: Anywhere, price: $$, category: Niche
42. **Mika, 25, Filipino-American, Catholic, dinner, Chill Hangout** → `"filipino food in chicago? adobo or sinigang, long shot I know"` | neighborhood: Anywhere, price: $$, category: Niche
43. **Kofi, 30, Caribbean-American, none, dinner, Any** → `"real jamaican food, curry goat or oxtail"` | neighborhood: Anywhere, price: $$, category: Niche
44. **Petra, 55, Eastern-European, none, lunch, Solo Dining** → `"somewhere that reminds me of Prague, hearty european food"` | neighborhood: Ukrainian Village, price: $$, category: Complex
45. **Ravi, 22, Indian-American, Sikh, dinner, Group Hangout** → `"good punjabi food, no beef, tandoori and naan type spot"` | neighborhood: Rogers Park, price: $$, category: Cuisine
46. **Chloe, 20, mainstream-American, none, breakfast, Solo Dining** → `"matcha latte and pastries, aesthetic place to study"` | neighborhood: Wicker Park, price: $, category: Multi
47. **Marcus, 28, African-American, none, dinner, Treat Myself** → `"nigerian food or west african, jollof rice especially"` | neighborhood: Anywhere, price: $$, category: Niche
48. **Elena, 44, mixed-multicultural, none, dinner, Date Night** → `"peruvian ceviche bar or something south american, pisco sours"` | neighborhood: Anywhere, price: $$$, category: Niche
49. **Brian, 38, Irish-American, none, lunch, Any** → `"italian beef sandwich, the juicy kind, giardiniera on the side"` | neighborhood: Anywhere, price: $, category: Dish
50. **Zara, 31, mixed-multicultural, Muslim, dinner, Date Night** → `"vegan and halal friendly, upscale, something creative not just falafel"` | neighborhood: Anywhere, price: $$$, dietary: ["halal", "vegan"], category: Complex

## Natural Language Realism Rules

When generating `special_request` text, apply these rules to make queries feel human:

1. **Casual grammar** (80% of queries): Drop articles, use fragments. "good tacos near me" not "I am looking for a good taco restaurant near my location"
2. **Occasional misspellings** (~10%): "restuarant", "restraunt", "itallian", "mediteranean", "resteraunt"
3. **Slang & abbreviations** (~15%): "idc", "ngl", "lowkey", "bougie", "vibes", "fire", "slaps", "smth", "tryna", "recs"
4. **Cultural code-switching**: Use dish names in native language. "jjajangmyeon" not "Korean black bean noodles". "pho bo" not "beef noodle soup"
5. **Emotional coloring** (~20%): "starving", "craving", "dying for", "need", "gotta have"
6. **Vague discovery** (~10%): "that one place", "you know the spot", "something different"
7. **Hedging** (~10%): "maybe?", "idk", "kinda", "sorta", "not sure what I want"
8. **Comparative** (~5%): "like Portillo's but better", "similar to Girl & the Goat"
9. **Constraints as afterthoughts** (~10%): "oh and it needs to be BYOB", "parking would be nice tho"
10. **Mixed signals** (~15%): Combine multiple dimensions naturally. "romantic but not too expensive, maybe thai or japanese"

Not every query needs modifiers. ~40% should be clean, direct searches. The percentages above are approximate targets across the full 1000-query corpus.

## JSON Schema

### File structure: `tests/generated-queries.json`

```json
{
  "metadata": {
    "version": "1.0",
    "total_queries": 0,
    "last_generated": "2026-03-11T00:00:00Z",
    "distribution": {
      "by_category": {},
      "by_time_of_day": {},
      "by_cultural_background": {},
      "by_age_group": {},
      "by_gender": {},
      "by_occasion": {},
      "by_religion": {}
    }
  },
  "queries": []
}
```

### Each query entry:

```json
{
  "id": "TQ-0001",
  "generated_at": "2026-03-11T00:00:00Z",
  "persona": {
    "age_group": "young_professional",
    "gender": "female",
    "cultural_background": "Korean-American",
    "religion": "none",
    "dietary_influence": "none"
  },
  "request": {
    "special_request": "good korean fried chicken, somewhere with soju",
    "occasion": "Chill Hangout",
    "neighborhood": "Anywhere",
    "price_level": "$$",
    "dietary_restrictions": [],
    "time_of_day": "dinner"
  },
  "test_metadata": {
    "category": "Multi",
    "expected_cuisines": "Korean",
    "min_score": 45,
    "natural_language_notes": "Specific dish + drink pairing + casual tone"
  }
}
```

**Field rules:**
- `id`: Sequential `TQ-NNNN` (zero-padded to 4 digits), continuing from last ID in file
- `generated_at`: Current ISO timestamp
- `persona`: All 5 fields required
- `request.special_request`: Max 500 chars, natural language
- `request.occasion`: One of the 10 valid occasion values
- `request.neighborhood`: One of the valid neighborhoods or "Anywhere"
- `request.price_level`: `$`, `$$`, `$$$`, `$$$$`, or `Any`
- `request.dietary_restrictions`: Array of valid restrictions (can be empty `[]`)
- `request.time_of_day`: `breakfast`, `lunch`, `dinner`, or `late_night`
- `test_metadata.category`: One of the 10 benchmark categories
- `test_metadata.expected_cuisines`: Pipe-separated cuisine types or `"any"`
- `test_metadata.min_score`: From category threshold table above
- `test_metadata.natural_language_notes`: Brief note on what makes this query interesting for testing

## Output Format

After generating, display this report:

```
## Test Query Generation Report

Generated: 10 new queries (TQ-NNNN to TQ-NNNN)
Total queries: X / 1000

### Gap Analysis (before generation)
| Dimension | Most Underrepresented | Count | Target |
|-----------|----------------------|-------|--------|
| Category  | ...                  | ...   | 100    |
| Time      | ...                  | ...   | 250    |
| Culture   | ...                  | ...   | 59     |
| Age       | ...                  | ...   | 167    |
| Occasion  | ...                  | ...   | 100    |

### Generated Queries
| # | ID | Query | Persona | Category |
|---|-----|-------|---------|----------|
| 1 | TQ-NNNN | "special_request text" | age/gender/culture | Category |
| ... | ... | ... | ... | ... |
```

## Rules

1. **Authenticity over coverage** — A realistic query from one persona is worth more than a forced query hitting a distribution target
2. **Chicago-specific** — Reference real neighborhoods, landmarks (Wrigley, United Center, Millennium Park), sports teams (Cubs, Bulls, Bears, Sox), cultural districts (Devon Ave, Argyle, 26th Street)
3. **No offensive stereotypes** — Cultural authenticity without reductive stereotyping. Not every Mexican-American searches for tacos. Not every Indian-American is vegetarian.
4. **Valid API values only** — All field values must be from the valid lists in this document
5. **JSON integrity** — Always validate with `cat tests/generated-queries.json | jq . > /dev/null` after writing
6. **Incremental** — Never delete existing queries. Only append new ones
7. **Cap at 1000** — When `total_queries >= 1000`, stop and report
8. **No duplicates** — Check against existing queries, golden dataset, and benchmark-200
