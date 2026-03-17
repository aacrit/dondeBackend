# DondeAI Knowledge Distillation Pipeline

Knowledge distillation compresses the DondeAI scoring engine (V11/V18 — a hand-tuned rule system with 2,700+ lines of TypeScript) into a lightweight XGBoost model that can score restaurants in microseconds.

## Why Knowledge Distillation?

The current scoring engine (`scoring-v9.ts`) is excellent but slow:
- ~50-200ms per restaurant through the full pipeline
- Requires loading review intelligence, intent classification, and 5 quality factors
- Complex rule interactions make it hard to A/B test scoring changes

An XGBoost student model provides:
- **Sub-millisecond scoring** — score all 2,720 restaurants in <100ms
- **Offline evaluation** — test scoring changes without deploying
- **Feature importance** — discover which signals actually drive rankings
- **Fallback path** — fast degradation when the full engine is slow

## $0 Cost Approach

Traditional distillation uses API calls to a teacher model (expensive). We use **Claude Code CLI agents** running on a Max subscription ($0 incremental cost) to:

1. **Prepare candidates** — Call the DondeAI API with `skip_claude=true` and `skip_google=true` (zero API cost) to get scored candidate data
2. **Rank with CLI agents** — Use Claude Code agents to review and label training pairs (covered by Max subscription)
3. **Train locally** — XGBoost training runs on your machine

Total API cost: **$0.00**

## Pipeline Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Step 1: PREPARE                                                 │
│  distill-prepare.sh → candidates-batch.json                      │
│  Calls DondeAI API (skip_claude + skip_google = $0)              │
│  Collects: 50+ queries × 5 candidates = 250+ scored pairs        │
├──────────────────────────────────────────────────────────────────┤
│  Step 2: RANK (Teacher Labeling)                                 │
│  CLI agent reviews candidates-batch.json                         │
│  Produces: training-data.json with teacher-assigned scores        │
│  Cost: $0 (Claude Code Max subscription)                         │
├──────────────────────────────────────────────────────────────────┤
│  Step 3: TRAIN                                                   │
│  distill-train.ts → model.json                                   │
│  XGBoost regression on 22 features → DondeMatch prediction        │
│  Validates on held-out 20% of queries                             │
├──────────────────────────────────────────────────────────────────┤
│  Step 4: DEPLOY                                                  │
│  xgboost-inference.ts loads model.json                           │
│  Pure TypeScript tree traversal — no external dependencies        │
│  Can be embedded in Supabase Edge Function                        │
└──────────────────────────────────────────────────────────────────┘
```

## How to Run

### Step 1: Prepare candidate data

```bash
# All 50 golden dataset queries (default)
./scripts/ml/distill-prepare.sh

# Process a subset
./scripts/ml/distill-prepare.sh --batch-start 0 --batch-size 20

# Use only golden dataset queries
./scripts/ml/distill-prepare.sh --source golden

# Use generated queries (from gen-test-queries agent)
./scripts/ml/distill-prepare.sh --source generated
```

Output: `scripts/ml/candidates-batch.json`

### Step 2: Teacher labeling (CLI agent)

Use a Claude Code CLI agent to review candidates and assign quality labels. The agent compares ranked candidates for each query and produces `training-data.json`.

```bash
# Copy candidates to training data (using rule engine scores as initial labels)
cp scripts/ml/candidates-batch.json scripts/ml/training-data.json

# Or: Use CLI agent for refined labeling (recommended)
# The agent reviews each query group, adjusts scores, and saves to training-data.json
```

### Step 3: Train the model

```bash
# Install XGBoost (one-time)
cd scripts && npm install xgboost

# Train
cd scripts && npx tsx ml/distill-train.ts

# Train with validation report
cd scripts && npx tsx ml/distill-train.ts --validate

# Custom output path
cd scripts && npx tsx ml/distill-train.ts --output ml/model-v2.json
```

Output: `scripts/ml/model.json`

### Step 4: Test inference

```bash
cd scripts && npx tsx ml/xgboost-inference.ts ml/model.json
```

## Feature List (22 features)

| # | Feature | Type | Source | Description |
|---|---------|------|--------|-------------|
| 1 | `relevance_score` | float | Engine | Relevance gate score (0-1) |
| 2 | `relevance_type_dish` | binary | Engine | One-hot: dish match |
| 3 | `relevance_type_cuisine` | binary | Engine | One-hot: cuisine match |
| 4 | `relevance_type_vibe` | binary | Engine | One-hot: vibe match |
| 5 | `relevance_type_reputation` | binary | Engine | One-hot: reputation match |
| 6 | `relevance_type_open_ended` | binary | Engine | One-hot: open-ended match |
| 7 | `food_score` | float | Engine | Food quality factor (0-10) |
| 8 | `vibe_score` | float | Engine | Vibe quality factor (0-10) |
| 9 | `service_score` | float | Engine | Service quality factor (0-10) |
| 10 | `reputation_score` | float | Engine | Reputation quality factor (0-10) |
| 11 | `convenience_score` | float | Engine | Convenience quality factor (0-10) |
| 12 | `data_completeness` | float | Engine | Data completeness (0-1) |
| 13 | `cuisine_match_exact` | binary | Restaurant | Exact cuisine keyword match |
| 14 | `neighborhood_match` | binary | Restaurant | Neighborhood keyword match |
| 15 | `price_match` | binary | Restaurant | Price level matches query intent |
| 16 | `trending_score` | float | Restaurant | Trending signal (placeholder) |
| 17 | `google_rating_bayesian` | float | Restaurant | Bayesian Google rating (C=30, m=4.15) |
| 18 | `query_word_count` | int | Query | Number of words in query |
| 19 | `query_has_cuisine` | binary | Query | Contains cuisine keyword |
| 20 | `query_has_dish` | binary | Query | Contains dish keyword |
| 21 | `query_has_vibe` | binary | Query | Contains vibe keyword |
| 22 | `query_has_neighborhood` | binary | Query | Contains neighborhood keyword |

## Model Architecture

**Algorithm:** XGBoost Gradient Boosted Decision Trees

**Configuration:**
- Objective: `reg:squarederror` (predict DondeMatch 0-99)
- Trees: 200 boosting rounds
- Max depth: 6
- Learning rate: 0.1
- Subsample: 0.8 (row sampling)
- Column sample: 0.8 (feature sampling)
- Min child weight: 3

**Inference:** Pure tree traversal in TypeScript — no ML library needed at runtime.

**Model size:** ~50-200KB JSON (200 trees x depth 6 = ~12,800 nodes max)

## Retraining

Retrain when:
- The scoring engine (`scoring-v9.ts`) has significant changes
- New restaurants are added (cuisine distribution shifts)
- Feature data changes (new review intelligence, enrichment pipeline runs)
- Validation metrics degrade below threshold

```bash
# Full retrain cycle
./scripts/ml/distill-prepare.sh                       # Fresh candidate data
cp scripts/ml/candidates-batch.json scripts/ml/training-data.json
cd scripts && npx tsx ml/distill-train.ts --validate   # Train + validate
```

## File Reference

| File | Description |
|------|-------------|
| `distill-prepare.sh` | Fetches candidate data from DondeAI API ($0 cost) |
| `distill-train.ts` | Feature extraction + XGBoost training pipeline |
| `xgboost-inference.ts` | Pure TypeScript tree traversal for fast prediction |
| `training-data.json` | Accumulated training pairs (teacher labels) |
| `candidates-batch.json` | Raw API candidate data (generated by prepare step) |
| `model.json` | Trained XGBoost model (generated by train step) |
