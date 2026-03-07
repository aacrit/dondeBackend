# Golden Dataset Test Results

**Date:** 2026-03-07T16:39:00Z
**Endpoint:** https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend
**Tests:** 50 | **Checks:** 88

## Summary

| Metric | Value |
|--------|-------|
| PASSED | 52 |
| FAILED | 1 |
| WARNED | 35 |
| Pass Rate | 59% |

## Category Averages

| Category | Avg DondeMatch | Tests |
|----------|---------------|-------|
| Food | 76 | 15 |
| Vibe | 65 | 10 |
| Service | 62 | 10 |
| Reputation | 79 | 5 |
| Convenience | 64 | 10 |
| **Overall** | **69** | **50** |

## Detailed Results

- **PASS** [GD-F01] donde_match >= 55 (got 81)
- **PASS** [GD-F01] cuisine match (American)
- **WARN** [GD-F01] food_score low — got 0
- **PASS** [GD-F02] donde_match >= 55 (got 80)
- **WARN** [GD-F02] cuisine match — expected one of [Chinese], got unknown
- **WARN** [GD-F02] food_score low — got 0
- **PASS** [GD-F03] donde_match >= 55 (got 83)
- **PASS** [GD-F03] cuisine match (Korean)
- **WARN** [GD-F03] food_score low — got 0
- **PASS** [GD-F04] donde_match >= 55 (got 76)
- **PASS** [GD-F04] cuisine match (Italian)
- **WARN** [GD-F04] food_score low — got 0
- **PASS** [GD-F05] donde_match >= 50 (got 77)
- **WARN** [GD-F05] cuisine match — expected one of [Caribbean|Cuban], got unknown
- **WARN** [GD-F05] food_score low — got 0
- **PASS** [GD-F06] donde_match >= 55 (got 86)
- **WARN** [GD-F06] cuisine match — expected one of [Japanese], got unknown
- **WARN** [GD-F06] food_score low — got 0
- **PASS** [GD-F07] donde_match >= 45 (got 74)
- **WARN** [GD-F07] food_score low — got 0
- **PASS** [GD-F08] donde_match >= 50 (got 81)
- **WARN** [GD-F08] cuisine match — expected one of [Caribbean|Jamaican], got unknown
- **WARN** [GD-F08] food_score low — got 0
- **WARN** [GD-F09] donde_match near threshold — got 45, want >= 50
- **WARN** [GD-F09] cuisine match — expected one of [French], got unknown
- **WARN** [GD-F09] food_score low — got 0
- **PASS** [GD-F10] donde_match >= 60 (got 83)
- **PASS** [GD-F10] cuisine match (Italian)
- **WARN** [GD-F10] food_score low — got 0
- **PASS** [GD-F11] donde_match >= 50 (got 77)
- **WARN** [GD-F11] cuisine match — expected one of [Seafood|French], got Cocktail Bar
- **WARN** [GD-F11] food_score low — got 0
- **PASS** [GD-F12] donde_match >= 50 (got 77)
- **WARN** [GD-F12] cuisine match — expected one of [Taiwanese|Chinese], got unknown
- **WARN** [GD-F12] food_score low — got 0
- **PASS** [GD-F13] donde_match >= 50 (got 74)
- **PASS** [GD-F13] cuisine match (American)
- **WARN** [GD-F13] food_score low — got 0
- **PASS** [GD-F14] donde_match >= 50 (got 81)
- **WARN** [GD-F14] cuisine match — expected one of [French|Italian], got unknown
- **WARN** [GD-F14] food_score low — got 0
- **PASS** [GD-F15] donde_match >= 45 (got 78)
- **WARN** [GD-F15] food_score low — got 0
- **PASS** [GD-V01] donde_match >= 55 (got 83)
- **WARN** [GD-V01] vibe_score low — got 0
- **PASS** [GD-V02] donde_match >= 50 (got 71)
- **WARN** [GD-V02] vibe_score low — got 0
- **WARN** [GD-V03] donde_match near threshold — got 48, want >= 50
- **WARN** [GD-V03] vibe_score low — got 0
- **PASS** [GD-V04] donde_match >= 45 (got 54)
- **WARN** [GD-V04] vibe_score low — got 0
- **PASS** [GD-V05] donde_match >= 55 (got 76)
- **WARN** [GD-V05] vibe_score low — got 0
- **PASS** [GD-V06] donde_match >= 55 (got 76)
- **WARN** [GD-V06] vibe_score low — got 0
- **PASS** [GD-V07] donde_match >= 55 (got 69)
- **WARN** [GD-V07] vibe_score low — got 0
- **PASS** [GD-V08] donde_match >= 50 (got 54)
- **WARN** [GD-V08] vibe_score low — got 0
- **PASS** [GD-V09] donde_match >= 50 (got 54)
- **WARN** [GD-V09] vibe_score low — got 0
- **PASS** [GD-V10] donde_match >= 60 (got 67)
- **WARN** [GD-V10] vibe_score low — got 0
- **PASS** [GD-S01] donde_match >= 55 (got 57)
- **PASS** [GD-S02] donde_match >= 50 (got 67)
- **PASS** [GD-S03] donde_match >= 55 (got 61)
- **PASS** [GD-S04] donde_match >= 55 (got 83)
- **PASS** [GD-S05] donde_match >= 55 (got 63)
- **PASS** [GD-S06] donde_match >= 55 (got 66)
- **PASS** [GD-S07] donde_match >= 55 (got 66)
- **PASS** [GD-S08] donde_match >= 55 (got 86)
- **FAIL** [GD-S09] donde_match >= 50 — got 7
- **PASS** [GD-S10] donde_match >= 55 (got 71)
- **PASS** [GD-R01] donde_match >= 60 (got 83)
- **PASS** [GD-R02] donde_match >= 65 (got 67)
- **PASS** [GD-R03] donde_match >= 55 (got 81)
- **PASS** [GD-R04] donde_match >= 55 (got 83)
- **PASS** [GD-R05] donde_match >= 60 (got 83)
- **PASS** [GD-C01] donde_match >= 50 (got 76)
- **PASS** [GD-C02] donde_match >= 55 (got 58)
- **PASS** [GD-C03] donde_match >= 45 (got 58)
- **PASS** [GD-C04] donde_match >= 55 (got 57)
- **PASS** [GD-C05] donde_match >= 55 (got 58)
- **PASS** [GD-C06] donde_match >= 45 (got 73)
- **PASS** [GD-C07] donde_match >= 55 (got 82)
- **PASS** [GD-C08] donde_match >= 50 (got 66)
- **PASS** [GD-C09] donde_match >= 55 (got 58)
- **PASS** [GD-C10] donde_match >= 55 (got 58)
