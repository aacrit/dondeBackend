#!/bin/bash
# Transform raw API responses into training data format
# Reads from subjective-raw/ and outputs training-data-subjective.json

set -euo pipefail

RAW_DIR="/home/aacrit/projects/dondeBackend/scripts/ml/subjective-raw"
OUTPUT="/home/aacrit/projects/dondeBackend/scripts/ml/training-data-subjective.json"
BOOST_OUTPUT="/home/aacrit/projects/dondeBackend/scripts/ml/boost-updates.json"

# All 150 queries with metadata: index|query|category|expected_cuisines|round
# Using a heredoc for the query list to avoid bash array escaping issues
cat > /tmp/subjective_queries.tsv << 'QUERYEOF'
1	best Italian restaurant	cuisine	Italian	R1
2	authentic Mexican food	cuisine	Mexican	R1
3	best sushi	dish	Japanese	R1
4	best Indian food	cuisine	Indian	R1
5	best Thai food	cuisine	Thai	R1
6	best Korean food	cuisine	Korean	R1
7	best BBQ	cuisine	BBQ,American	R1
8	best Chinese food	cuisine	Chinese	R1
9	romantic dinner	vibe	Any	R1
10	business lunch downtown	occasion	Any	R1
11	family friendly restaurant	occasion	Any	R1
12	birthday dinner	occasion	Any	R1
13	solo dining	occasion	Any	R1
14	best rooftop restaurant	vibe	Any	R1
15	cozy restaurant	vibe	Any	R1
16	best brunch	concept	Any	R1
17	best steakhouse	cuisine	Steakhouse,American	R1
18	hidden gem restaurant	vibe	Any	R1
19	best restaurant in West Loop	neighborhood	Any	R1
20	best restaurant in Logan Square	neighborhood	Any	R1
21	best restaurant in Chinatown	neighborhood	Any	R1
22	best deep dish pizza	dish	Italian,Pizza	R1
23	best tacos	dish	Mexican	R1
24	best ramen	dish	Japanese,Ramen	R1
25	best burger	dish	American	R1
26	best Vietnamese food	cuisine	Vietnamese	R2
27	best Japanese food	cuisine	Japanese	R2
28	best Ethiopian food	cuisine	Ethiopian	R2
29	best Peruvian food	cuisine	Peruvian	R2
30	best Greek food	cuisine	Greek	R2
31	best Filipino food	cuisine	Filipino	R2
32	best Lebanese food	cuisine	Lebanese	R2
33	best Polish food	cuisine	Polish	R2
34	best gyoza	dish	Japanese	R2
35	best pho	dish	Vietnamese	R2
36	best al pastor tacos	dish	Mexican	R2
37	best chicken wings	dish	American	R2
38	best dim sum	dish	Chinese	R2
39	best pierogi	dish	Polish	R2
40	best lobster roll	dish	Seafood,American	R2
41	best Nashville hot chicken	dish	American,Southern	R2
42	best restaurant in Lincoln Park	neighborhood	Any	R2
43	best restaurant in Wicker Park	neighborhood	Any	R2
44	best restaurant in River North	neighborhood	Any	R2
45	best restaurant in Pilsen	neighborhood	Any	R2
46	best restaurant in Andersonville	neighborhood	Any	R2
47	best patio restaurant	vibe	Any	R2
48	best restaurant with live music	vibe	Any	R2
49	best late night food	concept	Any	R2
50	best outdoor dining	vibe	Any	R2
51	best empanadas	dish	Latin American,Argentine	R3
52	best banh mi	dish	Vietnamese	R3
53	best falafel	dish	Middle Eastern	R3
54	best elote	dish	Mexican	R3
55	best ceviche	dish	Peruvian,Latin American	R3
56	best jerk chicken	dish	Jamaican,Caribbean	R3
57	best bibimbap	dish	Korean	R3
58	best pupusa	dish	Salvadoran,Central American	R3
59	best Moroccan food	cuisine	Moroccan	R3
60	best Colombian food	cuisine	Colombian	R3
61	best Taiwanese food	cuisine	Taiwanese	R3
62	best Cuban food	cuisine	Cuban	R3
63	best Burmese food	cuisine	Burmese	R3
64	best Afghan food	cuisine	Afghan	R3
65	best Jamaican food	cuisine	Jamaican	R3
66	best waterfront restaurant	vibe	Any	R3
67	best fireplace restaurant	vibe	Any	R3
68	best private dining	vibe	Any	R3
69	best quiet restaurant for conversation	vibe	Any	R3
70	best restaurant with a view	vibe	Any	R3
71	best speakeasy	vibe	Any	R3
72	best restaurant in Hyde Park	neighborhood	Any	R3
73	best restaurant in Humboldt Park	neighborhood	Any	R3
74	best restaurant in Bridgeport	neighborhood	Any	R3
75	best restaurant in Uptown	neighborhood	Any	R3
76	best croissant	dish	French,Bakery	R4
77	best arepa	dish	Venezuelan,Colombian	R4
78	best tamales	dish	Mexican	R4
79	best dumplings	dish	Chinese,Asian	R4
80	best gelato	dish	Italian	R4
81	best fried chicken	dish	American,Southern	R4
82	best fish tacos	dish	Mexican,Seafood	R4
83	best shawarma	dish	Middle Eastern	R4
84	best bao buns	dish	Chinese,Taiwanese	R4
85	best carnitas	dish	Mexican	R4
86	best restaurant in Ravenswood	neighborhood	Any	R4
87	best restaurant in Ukrainian Village	neighborhood	Any	R4
88	best restaurant in Albany Park	neighborhood	Any	R4
89	best restaurant in Edgewater	neighborhood	Any	R4
90	best restaurant in Little Italy	neighborhood	Any	R4
91	best Senegalese food	cuisine	Senegalese	R4
92	best Haitian food	cuisine	Haitian	R4
93	best Cambodian food	cuisine	Cambodian	R4
94	best Uzbek food	cuisine	Uzbek	R4
95	best Sri Lankan food	cuisine	Sri Lankan	R4
96	cheap late night tacos	concept	Mexican	R4
97	upscale sushi for a date	concept	Japanese	R4
98	family friendly Italian near Lincoln Park	concept	Italian	R4
99	best cocktails and small plates	concept	Any	R4
100	casual brunch with outdoor seating	concept	Any	R4
101	best hot dog	dish	American	R5
102	best donut	dish	Bakery	R5
103	best bagel	dish	Bakery	R5
104	best slice of pizza	dish	Italian,Pizza	R5
105	best torta	dish	Mexican	R5
106	best Italian beef	dish	Italian,American	R5
107	best gyro	dish	Greek,Middle Eastern	R5
108	best ice cream	dish	Dessert	R5
109	best cookie	dish	Bakery	R5
110	best poke bowl	dish	Hawaiian,Japanese	R5
111	romantic wine bar	vibe	Any	R5
112	fun group dinner spot	occasion	Any	R5
113	trendy new restaurant	vibe	Any	R5
114	quiet coffee shop for work	vibe	Any	R5
115	lively sports bar with good food	vibe	Any	R5
116	best restaurant in Bronzeville	neighborhood	Any	R5
117	best restaurant in Rogers Park	neighborhood	Any	R5
118	best restaurant in Irving Park	neighborhood	Any	R5
119	best restaurant in North Center	neighborhood	Any	R5
120	best restaurant in Old Town	neighborhood	Any	R5
121	best Venezuelan food	cuisine	Venezuelan	R5
122	best Tibetan food	cuisine	Tibetan	R5
123	best Eritrean food	cuisine	Eritrean	R5
124	best Laotian food	cuisine	Laotian	R5
125	best Trinidadian food	cuisine	Trinidadian	R5
126	best cheap eats in Chicago	concept	Any	R6
127	best fine dining experience	concept	Any	R6
128	best Michelin star restaurant	concept	Any	R6
129	best affordable date night	concept	Any	R6
130	best splurge-worthy restaurant	concept	Any	R6
131	best breakfast spot	concept	Any	R6
132	best happy hour	concept	Any	R6
133	best after-work drinks and food	concept	Any	R6
134	best Sunday brunch	concept	Any	R6
135	best dessert restaurant	concept	Any	R6
136	best vegan restaurant	dietary	Any	R6
137	best gluten free restaurant	dietary	Any	R6
138	best halal restaurant	dietary	Any	R6
139	best kosher restaurant	dietary	Any	R6
140	best vegetarian friendly	dietary	Any	R6
141	best food truck	format	Any	R6
142	best buffet	format	Any	R6
143	best tasting menu	format	Any	R6
144	best omakase	format	Japanese	R6
145	best prix fixe	format	Any	R6
146	best soul food	cuisine	Soul Food,Southern	R6
147	best Chinatown dim sum	dish	Chinese	R6
148	best Little Village Mexican	cuisine	Mexican	R6
149	best Devon Avenue Indian	cuisine	Indian	R6
150	best Argyle Street Vietnamese	cuisine	Vietnamese	R6
QUERYEOF

echo "Transforming raw API responses into training data..."

# Start JSON array
echo "[" > "$OUTPUT"

FIRST=true
BOOST_ENTRIES=""
SKIPPED_LOW_DM=0
TOTAL_ENTRIES=0

while IFS=$'\t' read -r idx query category expected_cuisines round; do
  # Find the raw file
  safe_name=$(echo "$query" | tr ' ' '_' | tr -cd '[:alnum:]_' | head -c 60)
  raw_file="$RAW_DIR/${idx}_${safe_name}.json"

  if [ ! -f "$raw_file" ]; then
    echo "WARN: Missing raw file for query $idx: $query"
    continue
  fi

  # Extract DM score
  dm=$(jq -r '.donde_match // 0' "$raw_file")

  # Build expected cuisines as JSON array
  cuisine_json=$(echo "$expected_cuisines" | tr ',' '\n' | jq -R . | jq -s .)

  # Format test_id with round and zero-padded index within round
  round_num="${round#R}"
  round_idx=$(( ((idx - 1) % 25) + 1 ))
  test_id=$(printf "SUB-%s-%02d" "$round" "$round_idx")

  # Extract top restaurant (primary)
  primary_id=$(jq -r '.restaurant.id // ""' "$raw_file")
  primary_name=$(jq -r '.restaurant.name // ""' "$raw_file")
  primary_cuisine=$(jq -r '.restaurant.cuisine_type // ""' "$raw_file")
  primary_neighborhood=$(jq -r '.restaurant.neighborhood_name // ""' "$raw_file")
  primary_price=$(jq -r '.restaurant.price_level // ""' "$raw_file")
  primary_score=$(jq -r '.donde_match // 0' "$raw_file")
  primary_rel_type=$(jq -r '.scoring_v9.relevance_type // ""' "$raw_file")

  # Build ranking array: primary + queue items
  ranking="["

  # Primary restaurant (rank 1)
  reasoning="Cuisine: ${primary_cuisine}; in ${primary_neighborhood}; relevance: ${primary_rel_type}"
  ranking+="{\"rank\":1,\"restaurant_id\":\"${primary_id}\",\"restaurant_name\":$(echo "$primary_name" | jq -R .),\"cuisine_type\":$(echo "$primary_cuisine" | jq -R .),\"neighborhood\":$(echo "$primary_neighborhood" | jq -R .),\"price_level\":$(echo "$primary_price" | jq -R .),\"score\":${primary_score},\"reasoning\":$(echo "$reasoning" | jq -R .)}"

  # Queue items (ranks 2-5)
  queue_len=$(jq -r '.ranked_queue | length' "$raw_file")
  for rank_idx in $(seq 0 $((queue_len < 4 ? queue_len - 1 : 3))); do
    q_id=$(jq -r ".ranked_queue[$rank_idx].restaurant.id // \"\"" "$raw_file")
    q_name=$(jq -r ".ranked_queue[$rank_idx].restaurant.name // \"\"" "$raw_file")
    q_cuisine=$(jq -r ".ranked_queue[$rank_idx].restaurant.cuisine_type // \"\"" "$raw_file")
    q_neighborhood=$(jq -r ".ranked_queue[$rank_idx].restaurant.neighborhood_name // \"\"" "$raw_file")
    q_price=$(jq -r ".ranked_queue[$rank_idx].restaurant.price_level // \"\"" "$raw_file")
    q_score=$(jq -r ".ranked_queue[$rank_idx].donde_match // 0" "$raw_file")
    q_rel_type=$(jq -r ".ranked_queue[$rank_idx].scoring_v9.relevance_type // \"\"" "$raw_file")

    # Skip empty entries
    if [ -z "$q_id" ] || [ "$q_id" = "null" ]; then continue; fi
    # Skip duplicates (queue sometimes includes primary)
    if [ "$q_id" = "$primary_id" ]; then continue; fi

    actual_rank=$((rank_idx + 2))
    q_reasoning="Cuisine: ${q_cuisine}; in ${q_neighborhood}; relevance: ${q_rel_type}"
    ranking+=",{\"rank\":${actual_rank},\"restaurant_id\":\"${q_id}\",\"restaurant_name\":$(echo "$q_name" | jq -R .),\"cuisine_type\":$(echo "$q_cuisine" | jq -R .),\"neighborhood\":$(echo "$q_neighborhood" | jq -R .),\"price_level\":$(echo "$q_price" | jq -R .),\"score\":${q_score},\"reasoning\":$(echo "$q_reasoning" | jq -R .)}"
  done

  ranking+="]"

  # Add separator
  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    echo "," >> "$OUTPUT"
  fi

  # Write training entry
  cat >> "$OUTPUT" << ENTRYEOF
  {
    "query_id": $idx,
    "test_id": "$test_id",
    "category": "$category",
    "query": $(echo "$query" | jq -R .),
    "occasion": "Any",
    "expected_cuisines": $cuisine_json,
    "ideal_ranking": $ranking
  }
ENTRYEOF

  TOTAL_ENTRIES=$((TOTAL_ENTRIES + 1))

done < /tmp/subjective_queries.tsv

# Close JSON array
echo "]" >> "$OUTPUT"

# Validate JSON
if jq . "$OUTPUT" > /dev/null 2>&1; then
  echo "Training data valid JSON: $OUTPUT"
  entry_count=$(jq length "$OUTPUT")
  echo "Total entries: $entry_count"
else
  echo "ERROR: Invalid JSON in $OUTPUT"
  exit 1
fi

echo ""
echo "=== Training Data Summary ==="
echo "Total entries: $TOTAL_ENTRIES"

# Category breakdown
echo ""
echo "Category breakdown:"
jq -r '[.[] | .category] | group_by(.) | .[] | "\(.[0]): \(length)"' "$OUTPUT"

# Score distribution
echo ""
echo "Score distribution:"
jq -r '[.[] | .ideal_ranking[0].score] | "Min: \(min) | Max: \(max) | Avg: \(add/length | floor)"' "$OUTPUT"

# Low DM queries (< 30)
echo ""
echo "Low DM queries (skip for boost):"
jq -r '.[] | select(.ideal_ranking[0].score < 30) | "  \(.query): DM=\(.ideal_ranking[0].score)"' "$OUTPUT"

echo ""
echo "Done! Output: $OUTPUT"
