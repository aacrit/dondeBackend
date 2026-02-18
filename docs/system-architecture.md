# DondeAI Backend — System Architecture

## High-Level Overview

```mermaid
graph TB
    subgraph Frontend
        UI[React SPA]
    end

    subgraph "Supabase Edge Function (Deno)"
        EF[POST /recommend]
        EF --> VAL[Input Validation & Defaults]
        VAL --> FETCH[Parallel DB Fetch]
        FETCH --> MERGE[mergeProfiles]
        MERGE --> RANK[filterAndRank → Top 10]
        RANK --> CLAUDE1[Claude Call 1: Recommendation]
        CLAUDE1 --> GOOG_LIVE[Google Places Live Fetch]
        GOOG_LIVE --> CLAUDE2[Claude Call 2: Sentiment Analysis]
        CLAUDE2 --> BUILD[buildSuccessResponse]
        BUILD --> LOG[Log user_query — async]
    end

    subgraph "External Services"
        ANTHROPIC[Anthropic API — Claude Haiku]
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
    FETCH --> DB_REST
    FETCH --> DB_SCORES
    FETCH --> DB_TAGS
    FETCH --> DB_NEIGH
    CLAUDE1 --> ANTHROPIC
    CLAUDE2 --> ANTHROPIC
    GOOG_LIVE --> GOOGLE
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

```mermaid
sequenceDiagram
    participant U as User (React SPA)
    participant EF as Edge Function
    participant DB as Supabase PostgreSQL
    participant C as Claude Haiku
    participant G as Google Places API

    U->>EF: POST /recommend {special_request, occasion, neighborhood, price_level}

    par Parallel DB Fetch
        EF->>DB: SELECT * FROM restaurants
        EF->>DB: SELECT * FROM occasion_scores
        EF->>DB: SELECT * FROM tags
        EF->>DB: SELECT * FROM neighborhoods
    end

    EF->>EF: mergeProfiles() — join base + scores + tags + neighborhoods
    EF->>EF: filterAndRank() — filter neighborhood/price, rank by occasion score → top 10

    EF->>C: Generate recommendation (top 10 profiles + user request)
    C-->>EF: {restaurant_index, recommendation, insider_tip, donde_score}

    EF->>G: Place Details (chosen restaurant's google_place_id)
    G-->>EF: {rating, review_count, phone, website, reviews[]}

    opt Reviews available
        EF->>C: Sentiment analysis (up to 5 reviews)
        C-->>EF: {sentiment_score, sentiment_breakdown}
    end

    EF->>EF: buildSuccessResponse()
    EF-->>U: {success, restaurant, recommendation, donde_score, scores, tags}

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
        E1["Find restaurants with<br/>noise_level IS NULL"]
        E2["Claude enriches batches of 10:<br/>noise, lighting, dress code,<br/>dietary, accessibility, ambiance"]
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
    }

    restaurants {
        uuid id PK
        text name
        text address
        uuid neighborhood_id FK
        text google_place_id UK
        text price_level
        text noise_level
        text lighting_ambiance
        text dress_code
        boolean outdoor_seating
        boolean live_music
        boolean pet_friendly
        text parking_availability
        text cuisine_type
        text best_for_oneliner
        text[] ambiance
        text[] dietary_options
        text[] good_for
        text[] accessibility_features
        text data_source
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
    }

    tags {
        uuid id PK
        uuid restaurant_id FK
        text tag_text
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
        STORED["google_place_id<br/>name, address (editorial)<br/>price_level<br/>Claude-generated enrichments:<br/>scores, tags, ambiance, cuisine"]
    end

    subgraph "Fetched Live (never stored)"
        LIVE["google_rating<br/>google_review_count<br/>phone, website<br/>reviews[]"]
    end

    subgraph "Generated On-the-Fly (never stored)"
        GENERATED["sentiment_score<br/>sentiment_breakdown"]
    end

    STORED --> |"Pipelines write once"| DB[(PostgreSQL)]
    DB --> |"Read at request time"| EF[Edge Function]
    GOOGLE[Google Places API] --> |"Fetched per request<br/>for chosen restaurant only"| EF
    EF --> |"reviews[] passed to"| CLAUDE[Claude Haiku]
    CLAUDE --> |"Returns sentiment"| EF
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

```mermaid
flowchart TD
    ALL[All restaurants from DB] --> F1{Neighborhood filter}
    F1 -->|"Anywhere"| F2
    F1 -->|"Specific"| FILT1[Keep matching neighborhood] --> F2
    F2{Price level filter}
    F2 -->|"Any"| F3
    F2 -->|"Specific"| FILT2[Keep matching price_level] --> F3
    F3{Enrichment filter}
    F3 --> FILT3["Keep only enriched<br/>(noise_level IS NOT NULL)"]
    FILT3 --> SORT["Sort by occasion-specific score DESC<br/>Tiebreak: sum of all 7 scores DESC"]
    SORT --> TOP10[Return top 10]
    TOP10 --> CLAUDE_PICK["Claude picks best match<br/>from top 10 based on<br/>user's special_request"]
    CLAUDE_PICK --> WINNER[Single restaurant recommendation]
```

---

## Fallback Strategy

```mermaid
flowchart TD
    REQ[Incoming Request] --> RANK[Filter & Rank]
    RANK --> |"0 results"| NO_RESULTS[buildNoResultsResponse]
    RANK --> |"≥1 result"| CLAUDE_CALL[Call Claude for recommendation]
    CLAUDE_CALL --> |"Success"| GOOGLE_FETCH[Fetch Google Place Details]
    CLAUDE_CALL --> |"Failure"| FALLBACK[buildFallbackResponse<br/>Top restaurant without AI text]

    GOOGLE_FETCH --> |"Success + reviews"| SENTIMENT[Call Claude for Sentiment]
    GOOGLE_FETCH --> |"Success, no reviews"| SUCCESS[buildSuccessResponse<br/>without sentiment]
    GOOGLE_FETCH --> |"Failure"| SUCCESS2[buildSuccessResponse<br/>without Google data]

    SENTIMENT --> |"Success"| SUCCESS3[buildSuccessResponse<br/>with sentiment]
    SENTIMENT --> |"Failure"| SUCCESS4[buildSuccessResponse<br/>without sentiment]

    FALLBACK --> RESP[Return response]
    NO_RESULTS --> RESP
    SUCCESS --> RESP
    SUCCESS2 --> RESP
    SUCCESS3 --> RESP
    SUCCESS4 --> RESP
```

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
│   │           ├── response-builder.ts     # Response construction
│   │           ├── scoring.ts              # Ranking & prompt building
│   │           ├── claude.ts               # Anthropic API client
│   │           ├── google-places.ts        # Google Places live fetch
│   │           └── supabase.ts             # Supabase DB client
│   └── migrations/
│       ├── *_cleanup_schema.sql
│       ├── *_add_indexes.sql
│       ├── *_google_compliance.sql
│       ├── *_add_cuisine_type.sql
│       └── *_seed_neighborhoods.sql
├── scripts/
│   ├── lib/
│   │   ├── config.ts                       # Neighborhoods, cuisines, coords
│   │   ├── claude.ts                       # Node.js Anthropic client
│   │   ├── google-places.ts                # Google Places API wrapper
│   │   ├── supabase.ts                     # Admin Supabase client
│   │   ├── batch.ts                        # Batch processor utility
│   │   └── types.ts                        # Shared pipeline types
│   └── pipelines/
│       ├── discovery.ts                    # Google Places restaurant discovery
│       ├── enrichment.ts                   # Claude ambiance enrichment
│       ├── generate-occasion-scores.ts     # Claude occasion scoring
│       └── generate-tags.ts                # Claude tag generation
├── .github/workflows/
│   ├── deploy-edge-function.yml            # Edge Function deployment
│   ├── discovery.yml                       # Weekly discovery (Sun 3am)
│   ├── enrichment.yml                      # Weekly enrichment (Sun 5am)
│   └── scores-and-tags.yml                 # Weekly scores & tags (Sun 7am)
├── _archive/                               # Reference docs & original workflows
├── CLAUDE.md                               # Project instructions
└── docs/
    └── system-architecture.md              # This file
```
