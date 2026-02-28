# Golden Dataset V8 — 100-Case Test Results

**Date:** 2026-02-27T23:44:51Z
**Endpoint:** https://vwbzkgsxmgwcvmvuxnbe.supabase.co/functions/v1/recommend
**Tests:** 100 | **Checks:** 191

## Summary

| Metric | Value |
|--------|-------|
| PASSED | 95 |
| FAILED | 16 |
| WARNED | 80 |
| Pass Rate | 49% |
| Avg DondeMatch | 53 |

## Category Averages

| Category | Avg DM | Tests | Pass | Fail | Warn |
|----------|--------|-------|------|------|------|
| Food | 53 | 43 | 23 | 9 | 11 |
| Vibe | 53 | 14 | 9 | 2 | 3 |
| Service | 54 | 18 | 8 | 1 | 9 |
| Reputation | 49 | 5 | 1 | 2 | 2 |
| Convenience | 55 | 20 | 13 | 2 | 5 |

## Detailed Results

- **PASS** [GD-F01] donde_match >= 55 (got 65)
- **WARN** [GD-F01] cuisine match — expected one of [American], got unknown
- **WARN** [GD-F01] food_score low — got 2.6
- **PASS** [GD-F02] donde_match >= 55 (got 56)
- **WARN** [GD-F02] cuisine match — expected one of [Chinese], got Vietnamese
- **PASS** [GD-F02] food_score >= 5 (got 5.5)
- **WARN** [GD-F03] donde_match near threshold — got 53, want >= 55
- **WARN** [GD-F03] cuisine match — expected one of [Korean], got Italian
- **PASS** [GD-F03] food_score >= 5 (got 5.1)
- **PASS** [GD-F04] donde_match >= 55 (got 63)
- **PASS** [GD-F04] cuisine match (Italian)
- **PASS** [GD-F04] food_score >= 5 (got 6.5)
- **FAIL** [GD-F05] donde_match >= 50 — got 37
- **WARN** [GD-F05] cuisine match — expected one of [Caribbean|Cuban], got Mexican
- **WARN** [GD-F05] food_score low — got 1.7
- **WARN** [GD-F06] donde_match near threshold — got 49, want >= 55
- **WARN** [GD-F06] cuisine match — expected one of [Japanese], got Cocktail Bar
- **PASS** [GD-F06] food_score >= 5 (got 5.1)
- **PASS** [GD-F07] donde_match >= 45 (got 45)
- **WARN** [GD-F07] food_score low — got 3.1
- **WARN** [GD-F08] donde_match near threshold — got 42, want >= 50
- **WARN** [GD-F08] cuisine match — expected one of [Caribbean|Jamaican], got Middle Eastern
- **WARN** [GD-F08] food_score low — got 2.6
- **FAIL** [GD-F09] donde_match >= 50 — got 37
- **WARN** [GD-F09] cuisine match — expected one of [French], got Middle Eastern
- **WARN** [GD-F09] food_score low — got 1.7
- **WARN** [GD-F10] donde_match near threshold — got 57, want >= 60
- **PASS** [GD-F10] cuisine match (Italian)
- **PASS** [GD-F10] food_score >= 5 (got 5.5)
- **PASS** [GD-F11] donde_match >= 50 (got 73)
- **PASS** [GD-F11] cuisine match (Seafood)
- **PASS** [GD-F11] food_score >= 5 (got 8.5)
- **FAIL** [GD-F12] donde_match >= 50 — got 39
- **WARN** [GD-F12] cuisine match — expected one of [Taiwanese|Chinese], got Mexican
- **WARN** [GD-F12] food_score low — got 1.9
- **PASS** [GD-F13] donde_match >= 50 (got 53)
- **WARN** [GD-F13] cuisine match — expected one of [American|Southern], got Italian
- **PASS** [GD-F13] food_score >= 5 (got 5.1)
- **PASS** [GD-F14] donde_match >= 50 (got 64)
- **WARN** [GD-F14] cuisine match — expected one of [French|Italian], got unknown
- **WARN** [GD-F14] food_score low — got 3.2
- **PASS** [GD-F15] donde_match >= 45 (got 59)
- **WARN** [GD-F15] food_score low — got 4.6
- **WARN** [GD-V01] donde_match near threshold — got 54, want >= 55
- **PASS** [GD-V01] vibe_score >= 5 (got 9.2)
- **PASS** [GD-V02] donde_match >= 50 (got 62)
- **PASS** [GD-V02] vibe_score >= 5 (got 8.3)
- **PASS** [GD-V03] donde_match >= 50 (got 56)
- **PASS** [GD-V03] vibe_score >= 5 (got 9.2)
- **PASS** [GD-V04] donde_match >= 45 (got 46)
- **PASS** [GD-V04] vibe_score >= 5 (got 8.1)
- **FAIL** [GD-V05] donde_match >= 55 — got 36
- **PASS** [GD-V05] vibe_score >= 5 (got 7.5)
- **FAIL** [GD-V06] donde_match >= 55 — got 38
- **PASS** [GD-V06] vibe_score >= 5 (got 9.4)
- **WARN** [GD-V07] donde_match near threshold — got 48, want >= 55
- **PASS** [GD-V07] vibe_score >= 5 (got 9.4)
- **PASS** [GD-V08] donde_match >= 50 (got 54)
- **PASS** [GD-V08] vibe_score >= 5 (got 9.2)
- **WARN** [GD-V09] donde_match near threshold — got 49, want >= 50
- **PASS** [GD-V09] vibe_score >= 5 (got 9.4)
- **PASS** [GD-V10] donde_match >= 60 (got 62)
- **PASS** [GD-V10] vibe_score >= 5 (got 7.7)
- **PASS** [GD-S01] donde_match >= 55 (got 60)
- **PASS** [GD-S02] donde_match >= 50 (got 72)
- **WARN** [GD-S03] donde_match near threshold — got 50, want >= 55
- **WARN** [GD-S04] donde_match near threshold — got 45, want >= 55
- **WARN** [GD-S05] donde_match near threshold — got 49, want >= 55
- **PASS** [GD-S06] donde_match >= 55 (got 57)
- **PASS** [GD-S07] donde_match >= 55 (got 64)
- **WARN** [GD-S08] donde_match near threshold — got 49, want >= 55
- **FAIL** [GD-S09] donde_match >= 50 — got 39
- **WARN** [GD-S10] donde_match near threshold — got 53, want >= 55
- **WARN** [GD-R01] donde_match near threshold — got 51, want >= 60
- **FAIL** [GD-R02] donde_match >= 65 — got 37
- **PASS** [GD-R03] donde_match >= 55 (got 67)
- **WARN** [GD-R04] donde_match near threshold — got 46, want >= 55
- **FAIL** [GD-R05] donde_match >= 60 — got 48
- **WARN** [GD-C01] donde_match near threshold — got 49, want >= 50
- **PASS** [GD-C02] donde_match >= 55 (got 69)
- **PASS** [GD-C03] donde_match >= 45 (got 69)
- **WARN** [GD-C04] donde_match near threshold — got 49, want >= 55
- **WARN** [GD-C05] donde_match near threshold — got 49, want >= 55
- **PASS** [GD-C06] donde_match >= 45 (got 47)
- **FAIL** [GD-C07] donde_match >= 55 — got 37
- **PASS** [GD-C08] donde_match >= 50 (got 57)
- **PASS** [GD-C09] donde_match >= 55 (got 69)
- **PASS** [GD-C10] donde_match >= 55 (got 69)
- **PASS** [GD-N01] donde_match >= 60 (got 70)
- **PASS** [GD-N01] cuisine match (Italian)
- **PASS** [GD-N01] food_score >= 5 (got 6.9)
- **FAIL** [GD-N02] donde_match >= 55 — got 44
- **WARN** [GD-N02] cuisine match — expected one of [Japanese], got Cocktail Bar
- **WARN** [GD-N02] food_score low — got 4.1
- **WARN** [GD-N03] donde_match near threshold — got 48, want >= 55
- **WARN** [GD-N03] cuisine match — expected one of [Japanese], got Cocktail Bar
- **PASS** [GD-N03] food_score >= 5 (got 5.1)
- **PASS** [GD-N04] donde_match >= 55 (got 65)
- **PASS** [GD-N04] vibe_score >= 5 (got 7.4)
- **FAIL** [GD-N05] donde_match >= 60 — got 48
- **PASS** [GD-N05] cuisine match (American)
- **PASS** [GD-N05] food_score >= 5 (got 5.1)
- **PASS** [GD-N06] donde_match >= 55 (got 72)
- **PASS** [GD-N06] vibe_score >= 5 (got 8.6)
- **FAIL** [GD-N07] donde_match >= 55 — got 35
- **WARN** [GD-N07] cuisine match — expected one of [Thai], got Seafood
- **WARN** [GD-N07] food_score low — got 1.9
- **WARN** [GD-N08] donde_match near threshold — got 48, want >= 55
- **WARN** [GD-N08] cuisine match — expected one of [Indian], got Cocktail Bar
- **WARN** [GD-N08] food_score low — got 4.1
- **PASS** [GD-N09] donde_match >= 55 (got 57)
- **WARN** [GD-N09] cuisine match — expected one of [Thai], got Cocktail Bar
- **PASS** [GD-N09] food_score >= 5 (got 6.3)
- **PASS** [GD-N10] donde_match >= 55 (got 63)
- **PASS** [GD-N10] cuisine match (Italian)
- **PASS** [GD-N10] food_score >= 5 (got 6.5)
- **FAIL** [GD-N11] donde_match >= 55 — got 37
- **WARN** [GD-N11] cuisine match — expected one of [Vietnamese], got Middle Eastern
- **WARN** [GD-N11] food_score low — got 1.7
- **PASS** [GD-N12] donde_match >= 55 (got 66)
- **PASS** [GD-N12] cuisine match (Mexican)
- **PASS** [GD-N12] food_score >= 5 (got 6.5)
- **WARN** [GD-N13] donde_match near threshold — got 42, want >= 50
- **WARN** [GD-N13] cuisine match — expected one of [Indian], got Middle Eastern
- **WARN** [GD-N13] food_score low — got 2.6
- **WARN** [GD-N14] donde_match near threshold — got 45, want >= 55
- **WARN** [GD-N14] cuisine match — expected one of [Japanese], got Cocktail Bar
- **WARN** [GD-N14] food_score low — got 4.1
- **WARN** [GD-N15] donde_match near threshold — got 42, want >= 50
- **WARN** [GD-N15] food_score low — got 1.9
- **PASS** [GD-N16] donde_match >= 50 (got 66)
- **WARN** [GD-N16] food_score low — got 4.6
- **PASS** [GD-N17] donde_match >= 45 (got 73)
- **WARN** [GD-N17] food_score low — got 4.6
- **PASS** [GD-N18] donde_match >= 50 (got 61)
- **WARN** [GD-N18] food_score low — got 4.6
- **PASS** [GD-N19] donde_match >= 45 (got 68)
- **WARN** [GD-N19] food_score low — got 4.6
- **PASS** [GD-N20] donde_match >= 45 (got 47)
- **WARN** [GD-N20] food_score low — got 4.1
- **PASS** [GD-N21] donde_match >= 55 (got 63)
- **PASS** [GD-N22] donde_match >= 60 (got 60)
- **PASS** [GD-N23] donde_match >= 55 (got 73)
- **WARN** [GD-N24] donde_match near threshold — got 47, want >= 55
- **PASS** [GD-N25] donde_match >= 50 (got 50)
- **WARN** [GD-N26] donde_match near threshold — got 50, want >= 55
- **WARN** [GD-N27] donde_match near threshold — got 40, want >= 50
- **WARN** [GD-N28] donde_match near threshold — got 52, want >= 55
- **PASS** [GD-N29] donde_match >= 55 (got 76)
- **WARN** [GD-N29] cuisine match — expected one of [Thai], got Cocktail Bar
- **PASS** [GD-N29] food_score >= 5 (got 5.6)
- **PASS** [GD-N30] donde_match >= 50 (got 55)
- **PASS** [GD-N30] cuisine match (Mexican)
- **PASS** [GD-N30] food_score >= 5 (got 5.5)
- **PASS** [GD-N31] donde_match >= 55 (got 55)
- **PASS** [GD-N31] vibe_score >= 5 (got 10)
- **PASS** [GD-N32] donde_match >= 50 (got 55)
- **PASS** [GD-N32] cuisine match (Italian)
- **PASS** [GD-N32] food_score >= 5 (got 5.5)
- **PASS** [GD-N33] donde_match >= 50 (got 55)
- **PASS** [GD-N33] vibe_score >= 5 (got 8.4)
- **PASS** [GD-N34] donde_match >= 45 (got 65)
- **PASS** [GD-N34] food_score >= 5 (got 8.2)
- **PASS** [GD-N35] donde_match >= 45 (got 70)
- **WARN** [GD-N35] cuisine match — expected one of [Ethiopian], got unknown
- **WARN** [GD-N35] food_score low — got 3.2
- **PASS** [GD-N36] donde_match >= 45 (got 58)
- **WARN** [GD-N36] cuisine match — expected one of [Peruvian|Latin], got Mexican
- **PASS** [GD-N36] food_score >= 5 (got 6)
- **WARN** [GD-N37] donde_match near threshold — got 43, want >= 50
- **WARN** [GD-N37] cuisine match — expected one of [Greek|Mediterranean], got Middle Eastern
- **WARN** [GD-N37] food_score low — got 3.8
- **WARN** [GD-N38] donde_match near threshold — got 39, want >= 45
- **WARN** [GD-N38] cuisine match — expected one of [Polish|European], got Mexican
- **WARN** [GD-N38] food_score low — got 1.9
- **FAIL** [GD-N39] donde_match >= 55 — got 41
- **WARN** [GD-N39] cuisine match — expected one of [American|BBQ], got Chinese
- **WARN** [GD-N39] food_score low — got 3.8
- **FAIL** [GD-N40] donde_match >= 55 — got 37
- **WARN** [GD-N40] cuisine match — expected one of [Chinese], got Middle Eastern
- **WARN** [GD-N40] food_score low — got 1.7
- **PASS** [GD-N41] donde_match >= 45 (got 53)
- **PASS** [GD-N42] donde_match >= 55 (got 57)
- **PASS** [GD-N43] donde_match >= 55 (got 59)
- **PASS** [GD-N44] donde_match >= 50 (got 50)
- **WARN** [GD-N45] donde_match near threshold — got 49, want >= 55
- **PASS** [GD-N46] donde_match >= 50 (got 65)
- **FAIL** [GD-N47] donde_match >= 55 — got 38
- **PASS** [GD-N48] donde_match >= 45 (got 49)
- **WARN** [GD-N49] donde_match near threshold — got 49, want >= 55
- **PASS** [GD-N50] donde_match >= 55 (got 73)
