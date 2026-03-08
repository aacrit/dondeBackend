# Donde Gauntlet Dashboard — 2026-03-08

## Executive Summary

```
┌──────────────────────────────────────────────────────┐
│  Queries Tested:    375                                 │
│  API Success Rate:  99.2%                               │
│  Pass Rate (DM≥60): 81.6%                               │
│  Excellence (DM≥80):32.8%                               │
│  Outstanding(DM≥90):0.3%                                │
│  Average DondeMatch:71.0                                │
│  Gaps Detected:     215                                 │
│  Avg Response Time:  6025ms                             │
│  Mode:              Lightweight                         │
│  Est. Cost:         ~$0.01                              │
└──────────────────────────────────────────────────────┘
```

## Tier Performance

| Tier | Name | Queries | Avg DM | Pass (≥60) | Excel (≥80) | Weak (<40) | Gaps |
|------|------|---------|--------|------------|-------------|------------|------|
| 1 | Core Singles | 375 | 71.0 | 81.6% | 32.8% | 3.2% | 215 |

## Category Performance

| Category | Queries | Avg DM | Pass (≥60) | Excel (≥80) | Weak (<40) | Gaps |
|----------|---------|--------|------------|-------------|------------|------|
| cuisine | 143 | 69.8 | 79.0% | 26.6% | 4.2% | 86 |
| dish | 77 | 75.6 | 94.8% | 48.1% | 2.6% | 44 |
| vibe | 58 | 65.8 | 74.1% | 24.1% | 5.2% | 34 |
| chicago_specific | 42 | 72.0 | 71.4% | 31.0% | 2.4% | 20 |
| occasion | 36 | 68.5 | 77.8% | 11.1% | 0.0% | 27 |
| reputation | 19 | 80.7 | 100.0% | 89.5% | 0.0% | 4 |

## Relevance Type Distribution

| Type | Count | % |
|------|-------|---|
| cuisine | 123 | 32.8% |
| vibe | 89 | 23.7% |
| reputation | 71 | 18.9% |
| dish | 55 | 14.7% |
| open_ended | 34 | 9.1% |
| unknown | 3 | 0.8% |

## Gap Summary

| Gap Type | Count | Severity |
|----------|-------|----------|
| intent | 109 | P1 |
| scoring | 47 | P1 |
| relevance_ceiling | 28 | P2 |
| cuisine_mismatch | 22 | P2 |
| neighborhood | 6 | P1 |
| api_error | 3 | P0 |

## Top 20 Gaps (Lowest Scores)

| # | Query | DM | Type | Category | Restaurant |
|---|-------|-----|------|----------|------------|
| 1 | Ecuadorian food near me | 0 | api_error | cuisine | none |
| 2 | where to get pancakes | 0 | api_error | dish | none |
| 3 | where to get cheesecake | 0 | api_error | dish | none |
| 4 | somewhere upscale | 7 | intent | vibe | Ever Restaurant |
| 5 | upscale restaurant Chicago | 7 | intent | vibe | Ever Restaurant |
| 6 | upscale bar | 7 | intent | vibe | Ever Restaurant |
| 7 | Nepalese food | 12 | cuisine_mismatch | cuisine | HaiSous Vietnamese K |
| 8 | where to get Nepalese food | 12 | cuisine_mismatch | cuisine | HaiSous Vietnamese K |
| 9 | Argyle Street food | 38 | cuisine_mismatch | chicago_specific | Bavette's Bar & Boeu |
| 10 | Somali place | 41 | scoring | cuisine | Safari Somali Cuisin |
| 11 | good Eritrean restaurant | 45 | scoring | cuisine | Awash Ethiopian Rest |
| 12 | authentic Nepalese | 46 | intent | cuisine | Nepal House (South L |
| 13 | authentic Nigerian | 46 | scoring | cuisine | Teranga African Rest |
| 14 | Senegalese food near me | 46 | scoring | cuisine | Teranga African Rest |
| 15 | where to get Tibetan food | 46 | scoring | cuisine | Revolution Brewing - |
| 16 | authentic Malaysian | 47 | scoring | cuisine | Serai |
| 17 | Malaysian restaurant | 47 | scoring | cuisine | Serai |
| 18 | good Lebanese restaurant | 48 | scoring | cuisine | Suda's |
| 19 | Southern restaurant | 48 | scoring | cuisine | Big Jones |
| 20 | Creole restaurant | 48 | scoring | cuisine | Big Jones |

## Score Distribution

| Range | Count | % | Bar |
|-------|-------|---|-----|
| 90-99 (Outstanding) | 1 | 0.3% |  |
| 80-89 (Excellent) | 122 | 32.5% | █████████████ |
| 70-79 (Strong) | 146 | 38.9% | ████████████████ |
| 60-69 (Solid) | 37 | 9.9% | ████ |
| 50-59 (Marginal) | 43 | 11.5% | █████ |
| 40-49 (Weak) | 14 | 3.7% | █ |
| < 40 (Critical) | 12 | 3.2% | █ |

---

*Generated: 2026-03-08T04:30:54.887Z | Source: run-2026-03-08T04-22-43.jsonl*
