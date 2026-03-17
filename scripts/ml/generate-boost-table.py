#!/usr/bin/env python3
"""
Generate boost table from teacher-ranked training data.

Reads training-data.json (210 queries x 5 restaurants = 1,050 pairs)
and builds a boost lookup table for the scoring engine with:
  1. Direct query -> restaurant ID mappings
  2. Fuzzy matching keys (stripped adjectives, location, single keyword)
  3. Cuisine-based keyword mappings
  4. Neighborhood-based keyword mappings
  5. Dish-based keyword mappings
  6. Consistent winners (restaurants appearing in 3+ rankings with high scores)

Output: boost-table.json
"""

import json
import re
import sys
from collections import defaultdict
from datetime import date

# ─── Stop words to strip for fuzzy keys ─────────────────────────────────────
STOP_WORDS = {
    "a", "an", "the", "in", "on", "at", "for", "with", "and", "or", "of",
    "to", "from", "by", "is", "my", "me", "i", "we", "our", "best", "good",
    "great", "amazing", "awesome", "excellent", "top", "really", "very",
    "most", "some", "any", "that", "this", "those", "these", "find",
    "want", "looking", "need", "get", "try", "like", "love", "near",
    "restaurant", "place", "spot", "food", "cuisine", "dining", "dinner",
    "lunch", "brunch", "breakfast", "eat", "eating", "chicago",
}

# Words that indicate adjectives/qualifiers (strip for fuzzy matching)
ADJECTIVE_WORDS = {
    "authentic", "real", "traditional", "genuine", "true", "classic",
    "modern", "contemporary", "new", "old", "trendy", "hip", "hot",
    "upscale", "fancy", "elegant", "casual", "relaxed", "chill", "cozy",
    "lively", "buzzing", "vibrant", "quiet", "intimate", "romantic",
    "cheap", "affordable", "budget", "expensive", "high-end", "fine",
    "friendly", "nice", "cool", "fun", "popular", "famous", "underrated",
    "hidden", "secret", "local", "neighborhood", "artisan", "craft",
    "organic", "fresh", "homemade", "handmade", "unique", "creative",
    "innovative", "world-class", "award-winning", "critically-acclaimed",
}

# Location words (neighborhoods) — strip to get cuisine/dish only
NEIGHBORHOOD_WORDS = {
    "andersonville", "beverly", "bridgeport", "bronzeville", "bucktown",
    "chinatown", "edgewater", "fulton market", "gold coast", "greektown",
    "humboldt park", "hyde park", "lakeview", "lincoln park", "lincoln square",
    "little italy", "little village", "logan square", "loop", "near north",
    "near west", "noble square", "north center", "old town", "pilsen",
    "printer's row", "ravenswood", "river north", "roscoe village",
    "south loop", "streeterville", "ukrainian village", "university village",
    "uptown", "west loop", "west town", "wicker park", "wrigleyville",
    "downtown", "west side", "north side", "south side",
    # Common prepositions before neighborhoods
    "wrigley field", "united center", "soldier field", "millennium park",
}

# Cuisine keywords — map from keyword to canonical cuisine name
CUISINE_KEYWORDS = {
    "mexican": "Mexican", "italian": "Italian", "japanese": "Japanese",
    "chinese": "Chinese", "thai": "Thai", "indian": "Indian",
    "french": "French", "korean": "Korean", "ethiopian": "Ethiopian",
    "vietnamese": "Vietnamese", "mediterranean": "Mediterranean",
    "greek": "Greek", "middle eastern": "Middle Eastern",
    "polish": "Polish", "southern": "Southern", "seafood": "Seafood",
    "steak": "Steakhouse", "steakhouse": "Steakhouse",
    "brazilian": "Brazilian", "peruvian": "Peruvian",
    "american": "American", "cuban": "Cuban", "taiwanese": "Taiwanese",
    "sushi": "Japanese", "ramen": "Japanese", "pho": "Vietnamese",
    "dim sum": "Chinese", "dumpling": "Chinese", "dumplings": "Chinese",
    "taco": "Mexican", "tacos": "Mexican", "burrito": "Mexican",
    "pizza": "Italian", "pasta": "Italian",
    "curry": "Indian", "tandoori": "Indian", "dosa": "Indian",
    "bibimbap": "Korean", "bbq": "BBQ", "barbecue": "BBQ",
    "burger": "American", "fried chicken": "American",
    "gyro": "Greek", "pierogi": "Polish", "banh mi": "Vietnamese",
    "ceviche": "Peruvian", "mole": "Mexican",
    "halal": "Halal", "kosher": "Kosher", "vegan": "Vegan",
}

# Dish keywords — specific dish names from training data
DISH_KEYWORDS = {
    "smash burger", "soup dumplings", "korean fried chicken",
    "truffle pasta", "hand rolls", "acai bowl", "jerk chicken", "fondue",
    "deep dish pizza", "lobster bisque", "hot chicken", "charcuterie board",
    "grain bowl", "birria tacos", "pad thai", "ramen", "tandoori chicken",
    "al pastor tacos", "lobster roll", "sushi omakase", "fried chicken",
    "brisket", "pho bo", "pho", "ceviche", "gyro", "pierogi", "dosa",
    "bibimbap", "mole negro", "banh mi", "butter chicken",
    "deep dish", "soup dumpling", "fried chicken sandwich",
    "dim sum", "sushi", "pizza", "pasta", "taco", "tacos",
    "burger", "steak", "lobster", "chicken", "ribs",
}

# Vibe keywords
VIBE_KEYWORDS = {
    "speakeasy", "jazz", "tiki", "karaoke", "rooftop", "brunch",
    "dive bar", "sports bar", "cozy", "romantic", "intimate",
    "elegant", "fine dining", "lively", "quiet", "dark", "moody",
    "trendy", "hip", "modern", "funky", "eclectic", "classic",
    "sophisticated", "upscale", "lounge", "patio", "outdoor",
    "rustic", "warm", "buzzing",
}

# Constraint keywords
CONSTRAINT_KEYWORDS = {
    "byob", "outdoor", "patio", "walk-in", "no reservation",
    "wheelchair", "accessible", "late night", "parking", "valet",
    "private dining", "gluten free", "vegan", "kosher", "halal",
    "dog friendly", "pet friendly", "large group", "quick",
    "prix fixe", "delivery", "cash only", "wifi",
    "budget", "affordable", "cheap",
}


def canonical(text: str) -> str:
    """Lowercase, strip, collapse whitespace."""
    return re.sub(r"\s+", " ", text.lower().strip())


def strip_adjectives(text: str) -> str:
    """Remove adjective/qualifier words from text."""
    words = text.split()
    kept = [w for w in words if w not in ADJECTIVE_WORDS]
    return " ".join(kept).strip()


def strip_location(text: str) -> str:
    """Remove neighborhood and location references from text."""
    result = text
    # Remove multi-word neighborhoods first
    for nb in sorted(NEIGHBORHOOD_WORDS, key=len, reverse=True):
        result = result.replace(nb, " ")
    # Remove prepositions left hanging
    result = re.sub(r"\b(in|near|around|by|at|from)\b", " ", result)
    return re.sub(r"\s+", " ", result).strip()


def strip_stop_words(text: str) -> str:
    """Remove stop words from text."""
    words = text.split()
    kept = [w for w in words if w not in STOP_WORDS]
    return " ".join(kept).strip()


def extract_keywords(text: str) -> list[str]:
    """Extract meaningful single keywords from text."""
    words = text.split()
    kept = [w for w in words if w not in STOP_WORDS and len(w) > 2]
    return kept


def generate_fuzzy_keys(query: str) -> list[str]:
    """Generate multiple fuzzy matching keys from a query."""
    q = canonical(query)
    keys = set()

    # Level 1: stripped adjectives
    stripped = strip_adjectives(q)
    if stripped and stripped != q:
        keys.add(stripped)

    # Level 2: stripped location
    no_loc = strip_location(q)
    if no_loc and no_loc != q:
        keys.add(no_loc)

    # Level 3: stripped adjectives AND location
    both = strip_location(strip_adjectives(q))
    if both and both != q:
        keys.add(both)

    # Level 4: stop words stripped
    no_stop = strip_stop_words(q)
    if no_stop and no_stop != q and len(no_stop) > 2:
        keys.add(no_stop)

    # Level 5: stop words + adjectives + location stripped
    minimal = strip_stop_words(strip_location(strip_adjectives(q)))
    if minimal and minimal != q and len(minimal) > 2:
        keys.add(minimal)

    # Level 6: individual meaningful keywords (only if 2+ chars)
    kws = extract_keywords(q)
    for kw in kws:
        if len(kw) > 3:  # Only add single keywords if they're substantive
            keys.add(kw)

    # Remove the original query from fuzzy keys
    keys.discard(q)

    return sorted(keys)


def extract_cuisine_from_query(query: str, expected_cuisines: list[str]) -> list[str]:
    """Extract cuisine identifiers from query text and expected cuisines."""
    cuisines = set()

    # From expected_cuisines (teacher-provided)
    for c in expected_cuisines:
        cuisines.add(c)

    # From keyword matching
    q = canonical(query)
    for kw, cuisine in CUISINE_KEYWORDS.items():
        if kw in q:
            cuisines.add(cuisine)

    return sorted(cuisines)


def extract_neighborhood_from_query(query: str, rankings: list) -> list[str]:
    """Extract neighborhoods from query text and ranking data."""
    neighborhoods = set()
    q = canonical(query)

    # From query text
    for nb in NEIGHBORHOOD_WORDS:
        if nb in q:
            neighborhoods.add(nb.title())

    # From rankings (teacher's chosen neighborhoods)
    for r in rankings:
        nb = r.get("neighborhood", "")
        if nb:
            neighborhoods.add(nb)

    return sorted(neighborhoods)


def extract_dishes_from_query(query: str) -> list[str]:
    """Extract dish keywords from query text."""
    dishes = set()
    q = canonical(query)

    for dish in sorted(DISH_KEYWORDS, key=len, reverse=True):
        if dish in q:
            dishes.add(dish)

    return sorted(dishes)


def extract_vibes_from_query(query: str) -> list[str]:
    """Extract vibe keywords from query."""
    vibes = set()
    q = canonical(query)

    for vibe in VIBE_KEYWORDS:
        if vibe in q:
            vibes.add(vibe)

    return sorted(vibes)


def extract_constraints_from_query(query: str) -> list[str]:
    """Extract constraint keywords from query."""
    constraints = set()
    q = canonical(query)

    for constraint in CONSTRAINT_KEYWORDS:
        if constraint in q:
            constraints.add(constraint)

    return sorted(constraints)


def main():
    # ─── Load training data ──────────────────────────────────────────────
    with open("scripts/ml/training-data.json") as f:
        training_data = json.load(f)

    print(f"Loaded {len(training_data)} training queries with "
          f"{sum(len(e['ideal_ranking']) for e in training_data)} total pairs")

    # ─── Build query_boosts (direct mappings) ────────────────────────────
    query_boosts: dict[str, list[str]] = {}
    fuzzy_boosts: dict[str, list[str]] = {}

    # Track per-restaurant stats for consistent winners
    restaurant_stats: dict[str, dict] = defaultdict(lambda: {
        "name": "", "scores": [], "ranks": [], "appearances": 0
    })

    # Track cuisine/neighborhood/dish/vibe/constraint -> restaurant mappings
    cuisine_restaurants: dict[str, list[tuple[str, float, int]]] = defaultdict(list)
    neighborhood_restaurants: dict[str, list[tuple[str, float, int]]] = defaultdict(list)
    dish_restaurants: dict[str, list[tuple[str, float, int]]] = defaultdict(list)
    vibe_restaurants: dict[str, list[tuple[str, float, int]]] = defaultdict(list)
    constraint_restaurants: dict[str, list[tuple[str, float, int]]] = defaultdict(list)

    for entry in training_data:
        query = canonical(entry["query"])
        rankings = entry["ideal_ranking"]
        expected_cuisines = entry.get("expected_cuisines", [])
        category = entry.get("category", "")

        # Direct mapping: query -> top-5 restaurant IDs
        restaurant_ids = [r["restaurant_id"] for r in rankings]
        query_boosts[query] = restaurant_ids

        # Track restaurant stats
        for r in rankings:
            rid = r["restaurant_id"]
            restaurant_stats[rid]["name"] = r["restaurant_name"]
            restaurant_stats[rid]["scores"].append(r["score"])
            restaurant_stats[rid]["ranks"].append(r["rank"])
            restaurant_stats[rid]["appearances"] += 1

        # Generate fuzzy keys
        fuzzy_keys = generate_fuzzy_keys(query)
        for fk in fuzzy_keys:
            if fk not in query_boosts:  # Don't overwrite direct mappings
                if fk not in fuzzy_boosts:
                    fuzzy_boosts[fk] = []
                # Merge: add IDs not already present, up to 5
                for rid in restaurant_ids:
                    if rid not in fuzzy_boosts[fk]:
                        fuzzy_boosts[fk].append(rid)

        # ─── Keyword-based mappings ──────────────────────────────────────
        # Cuisine mappings
        cuisines = extract_cuisine_from_query(query, expected_cuisines)
        for cuisine in cuisines:
            ck = canonical(cuisine)
            for r in rankings:
                cuisine_restaurants[ck].append(
                    (r["restaurant_id"], r["score"], r["rank"])
                )

        # Neighborhood mappings
        neighborhoods = extract_neighborhood_from_query(query, rankings)
        for nb in neighborhoods:
            nk = canonical(nb)
            for r in rankings:
                neighborhood_restaurants[nk].append(
                    (r["restaurant_id"], r["score"], r["rank"])
                )

        # Dish mappings
        dishes = extract_dishes_from_query(query)
        for dish in dishes:
            dk = canonical(dish)
            for r in rankings:
                dish_restaurants[dk].append(
                    (r["restaurant_id"], r["score"], r["rank"])
                )

        # Vibe mappings
        vibes = extract_vibes_from_query(query)
        for vibe in vibes:
            vk = canonical(vibe)
            for r in rankings:
                vibe_restaurants[vk].append(
                    (r["restaurant_id"], r["score"], r["rank"])
                )

        # Constraint mappings
        constraints = extract_constraints_from_query(query)
        for constraint in constraints:
            ck = canonical(constraint)
            for r in rankings:
                constraint_restaurants[ck].append(
                    (r["restaurant_id"], r["score"], r["rank"])
                )

    # ─── Deduplicate and rank keyword-based mappings ─────────────────────
    def dedupe_and_rank(mapping: dict, top_n: int = 5) -> dict[str, list[str]]:
        """Deduplicate restaurant entries by averaging scores, return top-N IDs."""
        result = {}
        for key, entries in mapping.items():
            # Aggregate by restaurant_id
            agg: dict[str, dict] = {}
            for rid, score, rank in entries:
                if rid not in agg:
                    agg[rid] = {"scores": [], "ranks": []}
                agg[rid]["scores"].append(score)
                agg[rid]["ranks"].append(rank)

            # Sort by average score descending, then by average rank ascending
            ranked = sorted(
                agg.items(),
                key=lambda x: (-sum(x[1]["scores"]) / len(x[1]["scores"]),
                               sum(x[1]["ranks"]) / len(x[1]["ranks"]))
            )

            result[key] = [rid for rid, _ in ranked[:top_n]]
        return result

    cuisine_boosts = dedupe_and_rank(cuisine_restaurants)
    neighborhood_boosts = dedupe_and_rank(neighborhood_restaurants)
    dish_boosts = dedupe_and_rank(dish_restaurants)
    vibe_boosts = dedupe_and_rank(vibe_restaurants)
    constraint_boosts = dedupe_and_rank(constraint_restaurants)

    # Trim fuzzy_boosts entries to top 5
    for key in fuzzy_boosts:
        fuzzy_boosts[key] = fuzzy_boosts[key][:5]

    # ─── Build consistent winners ────────────────────────────────────────
    consistent_winners = {}
    for rid, stats in restaurant_stats.items():
        appearances = stats["appearances"]
        avg_score = sum(stats["scores"]) / len(stats["scores"])
        avg_rank = sum(stats["ranks"]) / len(stats["ranks"])

        if appearances >= 3 and avg_score >= 85 and avg_rank <= 2:
            consistent_winners[rid] = {
                "name": stats["name"],
                "appearances": appearances,
                "avg_score": round(avg_score, 1),
                "avg_rank": round(avg_rank, 1),
            }

    # Sort consistent winners by appearances desc, avg_score desc
    consistent_winners = dict(sorted(
        consistent_winners.items(),
        key=lambda x: (-x[1]["appearances"], -x[1]["avg_score"])
    ))

    # ─── Merge all boost keys ────────────────────────────────────────────
    # Combine direct + fuzzy + keyword-based into unified query_boosts
    all_boosts = dict(query_boosts)  # Start with direct mappings

    # Add fuzzy keys (lower priority — don't overwrite direct)
    for key, ids in fuzzy_boosts.items():
        if key not in all_boosts:
            all_boosts[key] = ids

    # Add keyword-based (even lower priority)
    for source_name, source_map in [
        ("cuisine", cuisine_boosts),
        ("dish", dish_boosts),
        ("vibe", vibe_boosts),
        ("neighborhood", neighborhood_boosts),
        ("constraint", constraint_boosts),
    ]:
        for key, ids in source_map.items():
            if key not in all_boosts:
                all_boosts[key] = ids

    # Sort all_boosts by key for readability
    all_boosts = dict(sorted(all_boosts.items()))

    # ─── Compute stats ───────────────────────────────────────────────────
    direct_count = len(query_boosts)
    fuzzy_count = len(fuzzy_boosts)
    cuisine_count = len(cuisine_boosts)
    neighborhood_count = len(neighborhood_boosts)
    dish_count = len(dish_boosts)
    vibe_count = len(vibe_boosts)
    constraint_count = len(constraint_boosts)
    total_entries = sum(len(v) for v in all_boosts.values())
    unique_restaurants = len(set(
        rid for ids in all_boosts.values() for rid in ids
    ))

    stats = {
        "total_queries": direct_count,
        "total_training_pairs": direct_count * 5,
        "total_boost_keys": len(all_boosts),
        "total_boost_entries": total_entries,
        "direct_query_keys": direct_count,
        "fuzzy_keys": fuzzy_count,
        "cuisine_keys": cuisine_count,
        "neighborhood_keys": neighborhood_count,
        "dish_keys": dish_count,
        "vibe_keys": vibe_count,
        "constraint_keys": constraint_count,
        "consistent_winners": len(consistent_winners),
        "unique_restaurants_boosted": unique_restaurants,
    }

    # ─── Build output ────────────────────────────────────────────────────
    boost_table = {
        "version": "1.0.0",
        "created": str(date.today()),
        "description": (
            "Teacher-validated boost table mapping query patterns to "
            "top-ranked restaurant IDs. Generated from 210 Opus-ranked "
            "training queries x 5 restaurants each."
        ),
        "query_boosts": all_boosts,
        "consistent_winners": consistent_winners,
        "direct_boost": 5,
        "winner_boost": 2,
        "stats": stats,
    }

    # ─── Write output ────────────────────────────────────────────────────
    output_path = "scripts/ml/boost-table.json"
    with open(output_path, "w") as f:
        json.dump(boost_table, f, indent=2)

    print(f"\nBoost table written to {output_path}")
    print(f"\n{'='*60}")
    print(f"  BOOST TABLE STATS")
    print(f"{'='*60}")
    print(f"  Training queries:       {stats['total_queries']}")
    print(f"  Training pairs:         {stats['total_training_pairs']}")
    print(f"  Total boost keys:       {stats['total_boost_keys']}")
    print(f"    Direct query keys:    {stats['direct_query_keys']}")
    print(f"    Fuzzy keys:           {stats['fuzzy_keys']}")
    print(f"    Cuisine keys:         {stats['cuisine_keys']}")
    print(f"    Neighborhood keys:    {stats['neighborhood_keys']}")
    print(f"    Dish keys:            {stats['dish_keys']}")
    print(f"    Vibe keys:            {stats['vibe_keys']}")
    print(f"    Constraint keys:      {stats['constraint_keys']}")
    print(f"  Total boost entries:    {stats['total_boost_entries']}")
    print(f"  Unique restaurants:     {stats['unique_restaurants_boosted']}")
    print(f"  Consistent winners:     {stats['consistent_winners']}")
    print(f"{'='*60}")

    # Print top consistent winners
    if consistent_winners:
        print(f"\n  TOP CONSISTENT WINNERS (3+ appearances, avg score >= 85, avg rank <= 2)")
        print(f"  {'Name':<40} {'Apps':>4} {'Avg Score':>9} {'Avg Rank':>8}")
        print(f"  {'-'*40} {'----':>4} {'---------':>9} {'--------':>8}")
        for rid, info in list(consistent_winners.items())[:20]:
            print(f"  {info['name']:<40} {info['appearances']:>4} "
                  f"{info['avg_score']:>9.1f} {info['avg_rank']:>8.1f}")

    # Print sample boost keys
    print(f"\n  SAMPLE BOOST KEYS (first 15)")
    for i, (key, ids) in enumerate(list(all_boosts.items())[:15]):
        print(f"  '{key}' -> {len(ids)} restaurants")


if __name__ == "__main__":
    main()
