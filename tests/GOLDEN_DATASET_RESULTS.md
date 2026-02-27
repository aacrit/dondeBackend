# Golden Dataset Test Results

**Date:** 2026-02-27T16:50:31Z
**Endpoint:** https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend
**Tests:** 50 | **Checks:** 88

## Summary

| Metric | Value |
|--------|-------|
| PASSED | 68 |
| FAILED | 2 |
| WARNED | 18 |
| Pass Rate | 77% |

## Category Averages

| Category | Avg DondeMatch | Tests |
|----------|---------------|-------|
| Food | 74 | 15 |
| Vibe | 74 | 10 |
| Service | 78 | 10 |
| Reputation | 73 | 5 |
| Convenience | 79 | 10 |
| **Overall** | **76** | **50** |

## Detailed Results

- **PASS** [GD-F01] donde_match >= 55 (got 61)
- **WARN** [GD-F01] cuisine match — expected one of [American], got Italian
- **WARN** [GD-F01] food_score low — got 3.5
- **PASS** [GD-F02] donde_match >= 55 (got 73)
- **WARN** [GD-F02] cuisine match — expected one of [Chinese], got unknown
- **WARN** [GD-F02] food_score low — got 1.5
- **PASS** [GD-F03] donde_match >= 55 (got 68)
- **WARN** [GD-F03] cuisine match — expected one of [Korean], got Italian
- **WARN** [GD-F03] food_score low — got 4.5
- **PASS** [GD-F04] donde_match >= 55 (got 73)
- **PASS** [GD-F04] cuisine match (Italian)
- **PASS** [GD-F04] food_score >= 5 (got 5.5)
- **PASS** [GD-F05] donde_match >= 50 (got 80)
- **WARN** [GD-F05] cuisine match — expected one of [Caribbean|Cuban], got Middle Eastern
- **PASS** [GD-F05] food_score >= 5 (got 5)
- **PASS** [GD-F06] donde_match >= 55 (got 80)
- **WARN** [GD-F06] cuisine match — expected one of [Japanese], got Middle Eastern
- **PASS** [GD-F06] food_score >= 5 (got 5)
- **PASS** [GD-F07] donde_match >= 45 (got 54)
- **WARN** [GD-F07] food_score low — got 2.5
- **PASS** [GD-F08] donde_match >= 50 (got 80)
- **WARN** [GD-F08] cuisine match — expected one of [Caribbean|Jamaican], got Middle Eastern
- **PASS** [GD-F08] food_score >= 5 (got 5)
- **PASS** [GD-F09] donde_match >= 50 (got 80)
- **WARN** [GD-F09] cuisine match — expected one of [French], got Middle Eastern
- **PASS** [GD-F09] food_score >= 5 (got 5)
- **PASS** [GD-F10] donde_match >= 60 (got 69)
- **PASS** [GD-F10] cuisine match (Italian)
- **WARN** [GD-F10] food_score low — got 4.5
- **PASS** [GD-F11] donde_match >= 50 (got 87)
- **PASS** [GD-F11] cuisine match (Seafood)
- **PASS** [GD-F11] food_score >= 5 (got 8.5)
- **PASS** [GD-F12] donde_match >= 50 (got 80)
- **WARN** [GD-F12] cuisine match — expected one of [Taiwanese|Chinese], got Middle Eastern
- **PASS** [GD-F12] food_score >= 5 (got 5)
- **PASS** [GD-F13] donde_match >= 50 (got 80)
- **WARN** [GD-F13] cuisine match — expected one of [American|Southern], got Middle Eastern
- **PASS** [GD-F13] food_score >= 5 (got 5)
- **PASS** [GD-F14] donde_match >= 50 (got 78)
- **WARN** [GD-F14] cuisine match — expected one of [French|Italian], got Mexican
- **PASS** [GD-F14] food_score >= 5 (got 5)
- **PASS** [GD-F15] donde_match >= 45 (got 80)
- **PASS** [GD-F15] food_score >= 5 (got 5)
- **PASS** [GD-V01] donde_match >= 55 (got 69)
- **PASS** [GD-V01] vibe_score >= 5 (got 9)
- **PASS** [GD-V02] donde_match >= 50 (got 96)
- **PASS** [GD-V02] vibe_score >= 5 (got 5.8)
- **PASS** [GD-V03] donde_match >= 50 (got 80)
- **PASS** [GD-V03] vibe_score >= 5 (got 9)
- **PASS** [GD-V04] donde_match >= 45 (got 76)
- **PASS** [GD-V04] vibe_score >= 5 (got 7)
- **WARN** [GD-V05] donde_match near threshold — got 46, want >= 55
- **PASS** [GD-V05] vibe_score >= 5 (got 6.8)
- **WARN** [GD-V06] donde_match near threshold — got 46, want >= 55
- **PASS** [GD-V06] vibe_score >= 5 (got 7.8)
- **PASS** [GD-V07] donde_match >= 55 (got 80)
- **PASS** [GD-V07] vibe_score >= 5 (got 9)
- **PASS** [GD-V08] donde_match >= 50 (got 80)
- **PASS** [GD-V08] vibe_score >= 5 (got 9)
- **PASS** [GD-V09] donde_match >= 50 (got 80)
- **PASS** [GD-V09] vibe_score >= 5 (got 9)
- **PASS** [GD-V10] donde_match >= 60 (got 92)
- **PASS** [GD-V10] vibe_score >= 5 (got 10)
- **PASS** [GD-S01] donde_match >= 55 (got 83)
- **PASS** [GD-S02] donde_match >= 50 (got 86)
- **PASS** [GD-S03] donde_match >= 55 (got 80)
- **PASS** [GD-S04] donde_match >= 55 (got 59)
- **PASS** [GD-S05] donde_match >= 55 (got 80)
- **PASS** [GD-S06] donde_match >= 55 (got 92)
- **PASS** [GD-S07] donde_match >= 55 (got 84)
- **PASS** [GD-S08] donde_match >= 55 (got 86)
- **WARN** [GD-S09] donde_match near threshold — got 41, want >= 50
- **PASS** [GD-S10] donde_match >= 55 (got 89)
- **PASS** [GD-R01] donde_match >= 60 (got 80)
- **FAIL** [GD-R02] donde_match >= 65 — got 37
- **PASS** [GD-R03] donde_match >= 55 (got 94)
- **PASS** [GD-R04] donde_match >= 55 (got 78)
- **PASS** [GD-R05] donde_match >= 60 (got 80)
- **PASS** [GD-C01] donde_match >= 50 (got 80)
- **PASS** [GD-C02] donde_match >= 55 (got 80)
- **PASS** [GD-C03] donde_match >= 45 (got 80)
- **PASS** [GD-C04] donde_match >= 55 (got 80)
- **PASS** [GD-C05] donde_match >= 55 (got 80)
- **PASS** [GD-C06] donde_match >= 45 (got 80)
- **FAIL** [GD-C07] donde_match >= 55 — got 42
- **PASS** [GD-C08] donde_match >= 50 (got 79)
- **PASS** [GD-C09] donde_match >= 55 (got 99)
- **PASS** [GD-C10] donde_match >= 55 (got 99)
