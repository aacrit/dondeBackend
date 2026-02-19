# DondeAI Backend — System Architecture

## High-Level Overview

```mermaid
graph TB
    subgraph Frontend
        UI[React SPA]
    end

    subgraph "Supabase Edge Function (Deno)"
        EF[POST /recommend]
        EF --> RPC["RPC: get_ranked_restaurants()<br/>(single DB round-trip)"]
        RPC --> PAR["Parallel: Claude call + Google top-3 fetch"]
        PAR --> BUILD[buildSuccessResponse]
        BUILD --> LOG[Log user_query — async]
    end

    subgraph "External Services"
        ANTHROPIC[Anthropic API — Claude Haiku 4.5]
        GOOGLE[Google Places API]
    end

    subgraph "Supabase PostgreSQL"
        DB_REST[(restaurants)]
        DB_SCORES[(occasion_scores)]
        DB_TAGS[(tags)]
        DB_NEIGH[(neighborhoods)]
        DB_QUERIES[(user_queries)]
    end

    subgraph "Data Pipelines (Node.js / GitHub Actions)"
        P1[Discovery Pipeline]
        P2[Enrichment Pipeline]
        P3[Occasion Scores Pipeline]
        P4[Tag Generation Pipeline]
    end

    UI -- "POST /recommend" --> EF
    RPC --> DB_REST
    RPC --> DB_SCORES
    RPC --> DB_TAGS
    RPC --> DB_NEIGH
    PAR --> ANTHROPIC
    PAR --> GOOGLE
    LOG --> DB_QUERIES
    BUILD -- "JSON response" --> UI

    P1 -- "INSERT restaurants" --> DB_REST
    P1 --> GOOGLE
    P2 -- "UPDATE restaurants" --> DB_REST
    P2 --> ANTHROPIC
    P3 -- "INSERT scores" --> DB_SCORES
    P3 --> ANTHROPIC
    P4 -- "INSERT tags" --> DB_TAGS
    P4 --> ANTHROPIC
```

---

## Recommendation Request Flow

Every request goes through Claude for a personalized recommendation with live Google review sentiment analysis.

```mermaid
sequenceDiagram
    participant U as User (React SPA)
    participant EF as Edge Function
    participant DB as Supabase PostgreSQL
    participant C as Claude Haiku 4.5
    participant G as Google Places API

    U->>EF: POST /recommend {special_request, occasion,<br/>neighborhood, price_level, exclude?}

    EF->>DB: RPC get_ranked_restaurants(neighborhood, price, occasion, limit=10+len(exclude))
    Note over DB: Single round-trip: JOIN restaurants +<br/>occasion_scores + neighborhoods,<br/>filter + rank server-side,<br/>random() tiebreaker for same-score variety
    DB-->>EF: Top N ranked restaurant profiles (with scores, tags)

    EF->>EF: Filter out excluded IDs → slice to top 10 → reRankWithBoosts()
    Note over EF: reRankWithBoosts re-sorts by<br/>60% occasion score + 40% keyword boost<br/>(cuisine, tag, feature matches from special_request)

    par Parallel execution
        EF->>C: Single Claude call: recommendation + sentiment<br/>(top 10 profiles + user request + Google reviews)
        EF->>G: Place Details for top 3 restaurants (parallel)
    end
    G-->>EF: {rating, review_count, phone, website, reviews[]}
    C-->>EF: {restaurant_index, recommendation, insider_tip,<br/>relevance_score, sentiment_score, sentiment_breakdown}

    EF->>EF: computeDondeMatch() + buildSuccessResponse()
    EF-->>U: {success, restaurant, recommendation, donde_match, scores, tags}

    EF-)DB: INSERT user_queries (fire-and-forget)
```

---

## Data Pipeline Schedule (Weekly, Sundays)

```mermaid
gantt
    title Weekly Pipeline Schedule (UTC)
    dateFormat HH:mm
    axisFormat %H:%M

    section Discovery
    Google Places text search + insert restaurants :p1, 03:00, 2h

    section Enrichment
    Claude enriches ambiance/dietary/accessibility :p2, 05:00, 2h

    section Scores & Tags
    Claude generates occasion scores (0-10)      :p3, 07:00, 1h
    Claude generates 3-6 tags per restaurant      :p4, 07:00, 1h
```

```mermaid
flowchart LR
    subgraph "Sunday 3:00 AM UTC"
        D1[Load neighborhoods from DB]
        D2["Text search Google Places<br/>(14 neighborhoods × 6 cuisines = 84 queries)"]
        D3[Deduplicate by place_id]
        D4[Fetch place details for new places]
        D5[Map to neighborhood via ZIP/coords]
        D6[INSERT new restaurants]
        D1 --> D2 --> D3 --> D4 --> D5 --> D6
    end

    subgraph "Sunday 5:00 AM UTC"
        E1["Find restaurants with<br/>noise_level IS NULL<br/>OR cuisine_type IS NULL<br/>(catches partial enrichments)"]
        E2["Claude enriches batches of 10:<br/>noise, lighting, dress code,<br/>dietary, accessibility, ambiance,<br/>cuisine_type, insider_tip"]
        E3[UPDATE restaurants]
        E1 --> E2 --> E3
    end

    subgraph "Sunday 7:00 AM UTC"
        S1["Find restaurants without<br/>occasion_scores rows"]
        S2["Claude scores batches of 10:<br/>7 occasion dimensions (0-10)"]
        S3[INSERT occasion_scores]
        S1 --> S2 --> S3

        T1["Find restaurants<br/>without tags"]
        T2["Claude generates 3-6 tags<br/>per restaurant in batches"]
        T3[INSERT tags]
        T1 --> T2 --> T3
    end

    D6 -.->|"2h gap"| E1
    E3 -.->|"2h gap"| S1
    E3 -.->|"2h gap"| T1
```

---

## Database Schema

```mermaid
erDiagram
    neighborhoods {
        uuid id PK
        text name
        timestamptz created_at
    }

    restaurants {
        uuid id PK
        text name
        text address
        uuid neighborhood_id FK
        text google_place_id UK
        text price_level
        text cuisine_type
        text noise_level
        text lighting_ambiance
        text dress_code
        boolean outdoor_seating
        boolean live_music
        boolean pet_friendly
        text parking_availability
        text best_for_oneliner
        text insider_tip
        text[] ambiance
        text[] dietary_options
        text[] good_for
        text[] accessibility_features
        text data_source
        boolean is_seed
        timestamptz created_at
        timestamptz updated_at
        timestamptz last_data_refresh
    }

    occasion_scores {
        uuid id PK
        uuid restaurant_id FK
        int date_friendly_score
        int group_friendly_score
        int family_friendly_score
        int business_lunch_score
        int solo_dining_score
        int hole_in_wall_factor
        int romantic_rating
        timestamptz created_at
    }

    tags {
        uuid id PK
        uuid restaurant_id FK
        text tag_text
        timestamptz created_at
    }

    user_queries {
        uuid id PK
        uuid neighborhood_id FK
        uuid recommended_restaurant_id FK
        text occasion
        text price_level
        text special_request
        timestamptz created_at
    }

    neighborhoods ||--o{ restaurants : "has many"
    restaurants ||--o| occasion_scores : "has one"
    restaurants ||--o{ tags : "has many"
    neighborhoods ||--o{ user_queries : "filtered by"
    restaurants ||--o{ user_queries : "recommended"
```

---

## Google API Compliance Model

Per Google Maps Platform ToS Section 3.2.3, only `place_id` may be stored indefinitely.

```mermaid
flowchart TB
    subgraph "Stored in DB (allowed)"
        STORED["google_place_id<br/>name, address (editorial)<br/>price_level<br/>Claude-generated enrichments:<br/>scores, tags, ambiance, cuisine,<br/>insider_tip"]
    end

    subgraph "Fetched Live (never stored)"
        LIVE["google_rating<br/>google_review_count<br/>phone, website<br/>reviews[]"]
    end

    subgraph "Generated On-the-Fly (never stored)"
        GENERATED["sentiment_score<br/>sentiment_breakdown<br/>(merged into single Claude call)"]
    end

    STORED --> |"Pipelines write weekly"| DB[(PostgreSQL)]
    DB --> |"Read at request time"| EF[Edge Function]
    GOOGLE[Google Places API] --> |"Fetched per request<br/>for top 3 candidates"| EF
    EF --> |"reviews[] + restaurant profiles<br/>in single prompt"| CLAUDE[Claude Haiku 4.5]
    CLAUDE --> |"Returns recommendation<br/>+ sentiment in one call"| EF
    EF --> |"Merged into response<br/>then discarded"| RESP[API Response to Frontend]

    LIVE -.-> GOOGLE
    GENERATED -.-> CLAUDE
```

---

## Occasion Score Mapping

| User Occasion     | DB Score Column         |
|-------------------|-------------------------|
| Date Night        | date_friendly_score     |
| Group Hangout     | group_friendly_score    |
| Family Dinner     | family_friendly_score   |
| Business Lunch    | business_lunch_score    |
| Solo Dining       | solo_dining_score       |
| Special Occasion  | romantic_rating         |
| Treat Myself      | solo_dining_score       |
| Adventure         | hole_in_wall_factor     |
| Chill Hangout     | group_friendly_score    |
| Any (default)     | date_friendly_score     |

---

## Ranking Algorithm

Two-phase ranking: the RPC does broad server-side sorting, then TypeScript applies special_request-aware re-ranking before Claude makes the final pick.

```mermaid
flowchart TD
    ALL["RPC: get_ranked_restaurants()"] --> F1{Neighborhood filter}
    F1 -->|"Anywhere"| F2
    F1 -->|"Specific"| FILT1[Keep matching neighborhood] --> F2
    F2{Price level filter}
    F2 -->|"Any"| F3
    F2 -->|"Specific"| FILT2[Keep matching price_level] --> F3
    F3{Enrichment filter}
    F3 --> FILT3["Keep only enriched<br/>(noise_level IS NOT NULL)"]
    FILT3 --> RPC_SORT["RPC sorts by:<br/>1. occasion_score DESC<br/>2. total_score DESC (sum of all 7)<br/>3. random() tiebreaker"]
    RPC_SORT --> RPC_LIMIT["LIMIT 10 + len(exclude)"]
    RPC_LIMIT --> EXCLUDE{"Exclude filter<br/>(TypeScript)"}
    EXCLUDE --> SLICE["Slice to top 10"]
    SLICE --> RERANK["reRankWithBoosts():<br/>Re-sort by composite =<br/>60% occasion score + 40% keyword boost<br/>(only if special_request matches any restaurant)"]
    RERANK --> CLAUDE_PICK["Claude picks best match<br/>from top 10 based on<br/>user's special_request<br/>(1 Claude call: recommendation + sentiment)"]
    CLAUDE_PICK --> WINNER[Single restaurant recommendation]
```

### Keyword Boost Details (`computeBoost`)

The boost score rewards restaurants whose attributes match the user's `special_request`:

| Match Type | Points | Example |
|-----------|--------|---------|
| Cuisine match | +3.0 | "sushi" matches `cuisine_type: "Japanese"` |
| Tag match (per tag) | +1.5 | "rooftop" matches tag "rooftop" |
| Feature match (per feature) | +1.5 | "outdoor" matches `outdoor_seating: true` |

Keyword dictionaries: 14 cuisine categories, 17 tag categories, 3 boolean features (outdoor_seating, live_music, pet_friendly).

---

## Fallback Strategy

```mermaid
flowchart TD
    REQ[Incoming Request] --> RPC{RPC get_ranked_restaurants}
    RPC -->|"Success"| EXCLUDE["Filter excluded IDs + slice to 10"]
    RPC -->|"Failure"| LEGACY["Fallback: 4 separate queries<br/>(restaurants, scores, tags, neighborhoods)<br/>+ mergeProfiles() + filterAndRank()"]
    LEGACY --> EXCLUDE
    EXCLUDE --> RERANK["reRankWithBoosts()"]
    RERANK --> RANK_OK{Results?}

    RANK_OK --> |"0 results"| NO_RESULTS[buildNoResultsResponse]
    RANK_OK --> |"≥1 result"| CLAUDE[Call Claude for recommendation + sentiment]

    CLAUDE --> |"Success"| GOOGLE_FETCH[Fetch Google Place Details]
    CLAUDE --> |"Failure"| FALLBACK[buildFallbackResponse<br/>Top restaurant without AI text]

    GOOGLE_FETCH --> |"Success"| SUCCESS[buildSuccessResponse<br/>with sentiment from Claude]
    GOOGLE_FETCH --> |"Failure"| SUCCESS2[buildSuccessResponse<br/>without Google data]

    FALLBACK --> RESP[Return response]
    NO_RESULTS --> RESP
    SUCCESS --> RESP
    SUCCESS2 --> RESP
```

---

## Key Optimizations

### 1. RPC-Based Ranking (Single DB Round-Trip)

The `get_ranked_restaurants()` PostgreSQL function replaces 4 separate queries with a single server-side operation:

```
-- Old approach: 4 queries
SELECT * FROM restaurants;
SELECT * FROM occasion_scores;
SELECT * FROM tags;
SELECT * FROM neighborhoods;
-- Then merge, filter, rank in application code

-- New approach: 1 RPC call
SELECT * FROM get_ranked_restaurants(p_neighborhood, p_price_level, p_occasion, p_limit);
-- Server-side JOIN + filter + rank, returns ready-to-use profiles
```

### 2. Merged Claude Call (Recommendation + Sentiment)

Single Claude call combines recommendation generation and sentiment analysis:
- Receives: top 10 restaurant profiles + user request + Google reviews for top restaurants
- Returns: restaurant pick, recommendation text, insider_tip, relevance_score, sentiment_score, sentiment_breakdown
- Prompt caching enabled via `cache_control: { type: "ephemeral" }` on system prompt

### 3. Parallel Google Fetches

During the Claude API call, Google Place Details are fetched in parallel for the top 3 ranked restaurants. If Claude picks from the top 3, the pre-fetched data is reused.

---

## Deployment & CI/CD

```mermaid
flowchart LR
    subgraph "GitHub Actions Triggers"
        PUSH["Push to main or claude/**"]
        CRON_D["Cron: Sunday 3am UTC"]
        CRON_E["Cron: Sunday 5am UTC"]
        CRON_ST["Cron: Sunday 7am UTC"]
        MANUAL["Manual dispatch"]
    end

    subgraph "Workflows"
        DEPLOY["deploy-edge-function.yml<br/>Setup Supabase CLI → Link → Deploy"]
        WF_D["discovery.yml<br/>Node.js 20 → npm ci → tsx discovery.ts"]
        WF_E["enrichment.yml<br/>Node.js 20 → npm ci → tsx enrichment.ts"]
        WF_ST["scores-and-tags.yml<br/>Node.js 20 → npm ci → tsx scores + tags"]
    end

    subgraph "Targets"
        SUPA_EF["Supabase Edge Function<br/>(Deno runtime)"]
        SUPA_DB["Supabase PostgreSQL"]
    end

    PUSH --> DEPLOY
    MANUAL --> DEPLOY
    MANUAL --> WF_D
    MANUAL --> WF_E
    MANUAL --> WF_ST
    CRON_D --> WF_D
    CRON_E --> WF_E
    CRON_ST --> WF_ST

    DEPLOY --> SUPA_EF
    WF_D --> SUPA_DB
    WF_E --> SUPA_DB
    WF_ST --> SUPA_DB
```

---

## Project File Structure

```
dondeBackend/
├── supabase/
│   ├── functions/
│   │   └── recommend/
│   │       ├── index.ts                    # Main Edge Function handler
│   │       └── _shared/
│   │           ├── types.ts                # TypeScript interfaces
│   │           ├── cors.ts                 # CORS headers & JSON helpers
│   │           ├── response-builder.ts     # Response construction (4 builders)
│   │           ├── scoring.ts              # Ranking, keyword boost, donde_match, prompt building
│   │           ├── claude.ts               # Anthropic API client (prompt caching)
│   │           ├── google-places.ts        # Google Places live fetch
│   │           └── supabase.ts             # Supabase DB client
│   └── migrations/
│       ├── *_cleanup_schema.sql            # Remove Yelp/legacy columns, merge dietary
│       ├── *_add_indexes.sql               # Query performance indexes
│       ├── *_google_compliance.sql         # Drop stored Google data columns
│       ├── *_add_cuisine_type.sql          # Add cuisine_type column
│       ├── *_seed_neighborhoods.sql        # 14 Chicago neighborhoods
│       ├── *_optimization.sql              # RPC function, insider_tip
│       ├── *_fix_rpc_null_neighborhood.sql # Handle NULL neighborhood_id in RPC
│       ├── *_rename_donde_score_to_match.sql # Rename donde_score → donde_match
│       ├── *_fix_occasion_scores_id_default.sql # Add uuid_generate_v4() default
│       ├── *_fix_tags_id_default.sql       # Add uuid_generate_v4() default
│       ├── *_drop_pre_recommendations.sql  # Removed pre-recommendations table
│       └── *_rpc_exclude_and_shuffle.sql   # Add random() tiebreaker + dynamic limit to RPC
├── scripts/
│   ├── lib/
│   │   ├── config.ts                       # Neighborhoods, cuisines, coords, ZIP mapping
│   │   ├── claude.ts                       # Node.js Anthropic client
│   │   ├── google-places.ts                # Google Places API wrapper
│   │   ├── supabase.ts                     # Admin Supabase client (service role)
│   │   ├── batch.ts                        # Batch processor utility
│   │   └── types.ts                        # Shared pipeline types
│   └── pipelines/
│       ├── discovery.ts                    # Google Places restaurant discovery
│       ├── enrichment.ts                   # Claude ambiance/dietary/insider_tip enrichment
│       ├── generate-occasion-scores.ts     # Claude occasion scoring (7 dimensions)
│       ├── generate-tags.ts                # Claude tag generation (3-6 per restaurant)
│       ├── backfill-new-fields.ts          # One-time backfill for new columns
│       └── populate-all.ts                 # Orchestrator: runs all pipelines sequentially
├── .github/workflows/
│   ├── deploy-edge-function.yml            # Edge Function deployment (push + manual)
│   ├── discovery.yml                       # Weekly discovery (Sun 3am)
│   ├── enrichment.yml                      # Weekly enrichment (Sun 5am)
│   └── scores-and-tags.yml                 # Weekly scores & tags (Sun 7am)
├── _archive/                               # Reference docs & original workflows
├── CLAUDE.md                               # Project instructions
└── docs/
    ├── system-architecture.md              # This file
    └── api-field-mapping.md                # Complete request/response field mapping
```
