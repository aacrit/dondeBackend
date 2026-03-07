# Donde Gauntlet Dashboard — 2026-03-07

## Executive Summary

```
┌──────────────────────────────────────────────────────┐
│  Queries Tested:    200                                 │
│  API Success Rate:  100.0%                              │
│  Pass Rate (DM≥60): 77.5%                               │
│  Excellence (DM≥80):44.0%                               │
│  Outstanding(DM≥90):0.5%                                │
│  Average DondeMatch:72.2                                │
│  Gaps Detected:     85                                  │
│  Avg Response Time:  5674ms                             │
│  Mode:              Lightweight                         │
│  Est. Cost:         ~$0.01                              │
└──────────────────────────────────────────────────────┘
```

## Tier Performance

| Tier | Name | Queries | Avg DM | Pass (≥60) | Excel (≥80) | Weak (<40) | Gaps |
|------|------|---------|--------|------------|-------------|------------|------|
| 0 | Gold Standard | 200 | 72.2 | 77.5% | 44.0% | 0.0% | 85 |

## Category Performance

| Category | Queries | Avg DM | Pass (≥60) | Excel (≥80) | Weak (<40) | Gaps |
|----------|---------|--------|------------|-------------|------------|------|
| food | 40 | 74.6 | 87.5% | 42.5% | 0.0% | 18 |
| reputation | 40 | 77.9 | 95.0% | 72.5% | 0.0% | 6 |
| convenience | 40 | 65.4 | 45.0% | 20.0% | 0.0% | 26 |
| vibe | 40 | 69.6 | 80.0% | 25.0% | 0.0% | 22 |
| service | 40 | 73.4 | 80.0% | 60.0% | 0.0% | 13 |

## Relevance Type Distribution

| Type | Count | % |
|------|-------|---|
| vibe | 54 | 27.0% |
| open_ended | 53 | 26.5% |
| cuisine | 36 | 18.0% |
| reputation | 29 | 14.5% |
| dish | 28 | 14.0% |

## Gap Summary

| Gap Type | Count | Severity |
|----------|-------|----------|
| scoring | 45 | P1 |
| relevance_ceiling | 25 | P2 |
| cuisine_mismatch | 15 | P2 |

## Top 20 Gaps (Lowest Scores)

| # | Query | DM | Type | Category | Restaurant |
|---|-------|-----|------|----------|------------|
| 1 | near thalia hall | 45 | scoring | convenience | Nepal House (Divisio |
| 2 | house butchery | 46 | scoring | service | Saigon Sisters |
| 3 | private chef consultation | 46 | scoring | service | Saigon Sisters |
| 4 | teppanyaki | 47 | scoring | food | Tamu Sushi |
| 5 | bustling brasserie | 47 | scoring | vibe | Galit |
| 6 | shabu shabu | 47 | scoring | food | Tamu Sushi |
| 7 | chef interaction | 49 | scoring | vibe | Little Vietnam Resta |
| 8 | cheap eats | 49 | scoring | convenience | Sunset Phở Caffe |
| 9 | wheelchair accessible | 50 | scoring | convenience | Eggholic - Indian St |
| 10 | craft beer | 50 | scoring | food | Pilot Project Brewin |
| 11 | cajun food | 51 | scoring | food | Roux |
| 12 | turkish food | 51 | scoring | food | Avaspi |
| 13 | valentine's day dinner | 51 | scoring | service | Fancy Plants Cafe |
| 14 | best thai chicago | 52 | scoring | reputation | Eat Fine Design By K |
| 15 | arcade bar | 54 | scoring | vibe | Bavette's Bar & Boeu |
| 16 | greenhouse dining | 54 | scoring | vibe | Bavette's Bar & Boeu |
| 17 | water sommelier | 54 | scoring | service | Bavette's Bar & Boeu |
| 18 | near lakefront trail | 54 | scoring | convenience | Bavette's Bar & Boeu |
| 19 | takeout only | 54 | scoring | service | Bavette's Bar & Boeu |
| 20 | most reviewed restaurant | 54 | scoring | reputation | Bavette's Bar & Boeu |

## Score Distribution

| Range | Count | % | Bar |
|-------|-------|---|-----|
| 90-99 (Outstanding) | 1 | 0.5% |  |
| 80-89 (Excellent) | 87 | 43.5% | █████████████████ |
| 70-79 (Strong) | 41 | 20.5% | ████████ |
| 60-69 (Solid) | 26 | 13.0% | █████ |
| 50-59 (Marginal) | 37 | 18.5% | ███████ |
| 40-49 (Weak) | 8 | 4.0% | ██ |
| < 40 (Critical) | 0 | 0.0% |  |

---

*Generated: 2026-03-07T18:32:17.376Z | Source: run-2026-03-07T18-24-44.jsonl*
