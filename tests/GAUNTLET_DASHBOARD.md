# Donde Gauntlet Dashboard — 2026-03-07

## Executive Summary

```
┌──────────────────────────────────────────────────────┐
│  Queries Tested:    200                                 │
│  API Success Rate:  100.0%                              │
│  Pass Rate (DM≥60): 79.0%                               │
│  Excellence (DM≥80):0.5%                                │
│  Outstanding(DM≥90):0.0%                                │
│  Average DondeMatch:62.2                                │
│  Gaps Detected:     186                                 │
│  Avg Response Time:  0ms                                │
│  Mode:              Full-fidelity                       │
│  Est. Cost:         ~$3.60                              │
└──────────────────────────────────────────────────────┘
```

## Tier Performance

| Tier | Name | Queries | Avg DM | Pass (≥60) | Excel (≥80) | Weak (<40) | Gaps |
|------|------|---------|--------|------------|-------------|------------|------|
| 0 | Gold Standard | 200 | 62.2 | 79.0% | 0.5% | 0.0% | 186 |

## Category Performance

| Category | Queries | Avg DM | Pass (≥60) | Excel (≥80) | Weak (<40) | Gaps |
|----------|---------|--------|------------|-------------|------------|------|
| reputation | 40 | 62.2 | 85.0% | 0.0% | 0.0% | 40 |
| food | 40 | 59.4 | 50.0% | 0.0% | 0.0% | 33 |
| convenience | 40 | 63.4 | 90.0% | 0.0% | 0.0% | 39 |
| vibe | 40 | 62.5 | 80.0% | 2.5% | 0.0% | 36 |
| service | 40 | 63.6 | 90.0% | 0.0% | 0.0% | 38 |

## Relevance Type Distribution

| Type | Count | % |
|------|-------|---|
| unknown | 200 | 100.0% |

## Gap Summary

| Gap Type | Count | Severity |
|----------|-------|----------|
| relevance_ceiling | 144 | P2 |
| scoring | 31 | P1 |
| intent | 11 | P1 |

## Top 20 Gaps (Lowest Scores)

| # | Query | DM | Type | Category | Restaurant |
|---|-------|-----|------|----------|------------|
| 1 | relaxed brunch spot | 45 | intent | vibe | Twin Anchors Restaur |
| 2 | james beard outstanding chef | 47 | intent | reputation | The Gundis Kurdish K |
| 3 | craft beer | 47 | intent | food | The Gundis Kurdish K |
| 4 | sunday morning cafe | 48 | intent | vibe | Mirella’s Tavern |
| 5 | soul food | 48 | intent | food | Tepalcates |
| 6 | cozy brunch | 48 | intent | vibe | Geraldine's |
| 7 | valentine's day dinner | 48 | scoring | service | The Gundis Kurdish K |
| 8 | wheelchair accessible | 48 | scoring | convenience | The Gundis Kurdish K |
| 9 | boba tea | 48 | scoring | food | The Gundis Kurdish K |
| 10 | best vietnamese chicago | 49 | scoring | reputation | The Gundis Kurdish K |
| 11 | drag brunch | 50 | intent | vibe | Geraldine's |
| 12 | cajun food | 50 | scoring | food | S & T Steakhouse |
| 13 | private chef consultation | 50 | intent | service | MingHin Cuisine |
| 14 | hot pot | 50 | scoring | food | Sochi Saigonese Kitc |
| 15 | macarons | 51 | scoring | food | Suda's |
| 16 | korean bbq | 51 | scoring | food | Sochi Saigonese Kitc |
| 17 | most awarded chicago chef | 51 | intent | reputation | MingHin Cuisine |
| 18 | yelp top rated brunch | 51 | intent | reputation | Geraldine's |
| 19 | house butchery | 51 | scoring | service | MingHin Cuisine |
| 20 | oxtail stew | 51 | scoring | food | The Gundis Kurdish K |

## Score Distribution

| Range | Count | % | Bar |
|-------|-------|---|-----|
| 90-99 (Outstanding) | 0 | 0.0% |  |
| 80-89 (Excellent) | 1 | 0.5% |  |
| 70-79 (Strong) | 13 | 6.5% | ███ |
| 60-69 (Solid) | 144 | 72.0% | █████████████████████████████ |
| 50-59 (Marginal) | 32 | 16.0% | ██████ |
| 40-49 (Weak) | 10 | 5.0% | ██ |
| < 40 (Critical) | 0 | 0.0% |  |

---

*Generated: 2026-03-07T16:44:46.754Z | Source: V8_200_RAW_RESULTS.jsonl*
