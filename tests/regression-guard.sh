#!/usr/bin/env bash
set -uo pipefail

###############################################################################
# DONDE SCORING REGRESSION GUARD
# Runs golden-dataset-test.sh, parses results, compares against baseline.
# Fails if pass rate drops by >2 or avg DM drops by >3.
# Saves results to tests/scoring-history.jsonl with timestamp.
#
# Baseline (V10, 2026-03-05): 44P / 4F / 2W, avg DM 70
#
# Usage:  chmod +x tests/regression-guard.sh && ./tests/regression-guard.sh
# Deps:   curl, jq (v1.6+), bash 4+
###############################################################################

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOLDEN_TEST="$SCRIPT_DIR/golden-dataset-test.sh"
HISTORY_FILE="$SCRIPT_DIR/scoring-history.jsonl"

# Baseline values
BASELINE_PASS=44
BASELINE_FAIL=4
BASELINE_WARN=2
BASELINE_AVG_DM=70

# Regression thresholds
MAX_PASS_DROP=2
MAX_DM_DROP=3

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

###############################################################################
# PREFLIGHT
###############################################################################

if [[ ! -x "$GOLDEN_TEST" ]]; then
  echo -e "${RED}ERROR${NC}: golden-dataset-test.sh not found or not executable at $GOLDEN_TEST"
  echo "  Run: chmod +x $GOLDEN_TEST"
  exit 2
fi

echo ""
echo "============================================================"
echo "  DONDE SCORING REGRESSION GUARD"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  Baseline: ${BASELINE_PASS}P / ${BASELINE_FAIL}F / ${BASELINE_WARN}W, avg DM ${BASELINE_AVG_DM}"
echo "  Thresholds: pass drop <= $MAX_PASS_DROP, DM drop <= $MAX_DM_DROP"
echo "============================================================"
echo ""

###############################################################################
# RUN GOLDEN DATASET TEST
###############################################################################

echo -e "${CYAN}Running golden-dataset-test.sh ...${NC}"
echo ""

# Capture output while also printing it
OUTPUT=$("$GOLDEN_TEST" 2>&1) || true
GOLDEN_EXIT=$?

echo "$OUTPUT"
echo ""

###############################################################################
# PARSE RESULTS
###############################################################################

echo -e "${CYAN}Parsing results ...${NC}"

# Extract PASSED/FAILED/WARNED counts from output
CURRENT_PASS=$(echo "$OUTPUT" | grep -oP 'PASSED.*:\s*\K[0-9]+' | head -1)
CURRENT_FAIL=$(echo "$OUTPUT" | grep -oP 'FAILED.*:\s*\K[0-9]+' | head -1)
CURRENT_WARN=$(echo "$OUTPUT" | grep -oP 'WARNED.*:\s*\K[0-9]+' | head -1)

# Extract overall avg DM from output
CURRENT_AVG_DM=$(echo "$OUTPUT" | grep -oP 'Overall:\s+avg DM = \K[0-9]+' | head -1)

# Fallback if parsing failed
CURRENT_PASS=${CURRENT_PASS:-0}
CURRENT_FAIL=${CURRENT_FAIL:-0}
CURRENT_WARN=${CURRENT_WARN:-0}
CURRENT_AVG_DM=${CURRENT_AVG_DM:-0}

echo ""
echo "  Current results: ${CURRENT_PASS}P / ${CURRENT_FAIL}F / ${CURRENT_WARN}W, avg DM ${CURRENT_AVG_DM}"
echo "  Baseline:        ${BASELINE_PASS}P / ${BASELINE_FAIL}F / ${BASELINE_WARN}W, avg DM ${BASELINE_AVG_DM}"

###############################################################################
# COMPARE AGAINST BASELINE
###############################################################################

echo ""
echo -e "${BOLD}── Regression Check ──${NC}"

REGRESSION_FAILED=false

# Check 1: Pass count regression
PASS_DELTA=$((CURRENT_PASS - BASELINE_PASS))
if (( PASS_DELTA < -MAX_PASS_DROP )); then
  echo -e "  ${RED}REGRESSION${NC}: Pass count dropped by ${PASS_DELTA#-} (${BASELINE_PASS} -> ${CURRENT_PASS}, max drop: ${MAX_PASS_DROP})"
  REGRESSION_FAILED=true
elif (( PASS_DELTA < 0 )); then
  echo -e "  ${YELLOW}WARNING${NC}: Pass count dropped by ${PASS_DELTA#-} (${BASELINE_PASS} -> ${CURRENT_PASS}, within tolerance)"
elif (( PASS_DELTA > 0 )); then
  echo -e "  ${GREEN}IMPROVED${NC}: Pass count increased by ${PASS_DELTA} (${BASELINE_PASS} -> ${CURRENT_PASS})"
else
  echo -e "  ${GREEN}STABLE${NC}: Pass count unchanged (${CURRENT_PASS})"
fi

# Check 2: Average DM regression
DM_DELTA=$((CURRENT_AVG_DM - BASELINE_AVG_DM))
if (( DM_DELTA < -MAX_DM_DROP )); then
  echo -e "  ${RED}REGRESSION${NC}: Avg DM dropped by ${DM_DELTA#-} (${BASELINE_AVG_DM} -> ${CURRENT_AVG_DM}, max drop: ${MAX_DM_DROP})"
  REGRESSION_FAILED=true
elif (( DM_DELTA < 0 )); then
  echo -e "  ${YELLOW}WARNING${NC}: Avg DM dropped by ${DM_DELTA#-} (${BASELINE_AVG_DM} -> ${CURRENT_AVG_DM}, within tolerance)"
elif (( DM_DELTA > 0 )); then
  echo -e "  ${GREEN}IMPROVED${NC}: Avg DM increased by ${DM_DELTA} (${BASELINE_AVG_DM} -> ${CURRENT_AVG_DM})"
else
  echo -e "  ${GREEN}STABLE${NC}: Avg DM unchanged (${CURRENT_AVG_DM})"
fi

###############################################################################
# SAVE TO HISTORY
###############################################################################

echo ""
echo -e "${CYAN}Saving to scoring-history.jsonl ...${NC}"

TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
HISTORY_ENTRY=$(jq -n \
  --arg ts "$TIMESTAMP" \
  --argjson pass "$CURRENT_PASS" \
  --argjson fail "$CURRENT_FAIL" \
  --argjson warn "$CURRENT_WARN" \
  --argjson avg_dm "$CURRENT_AVG_DM" \
  --argjson baseline_pass "$BASELINE_PASS" \
  --argjson baseline_dm "$BASELINE_AVG_DM" \
  --argjson pass_delta "$PASS_DELTA" \
  --argjson dm_delta "$DM_DELTA" \
  --argjson regression "$( $REGRESSION_FAILED && echo true || echo false )" \
  --argjson golden_exit "$GOLDEN_EXIT" \
  '{
    timestamp: $ts,
    pass: $pass,
    fail: $fail,
    warn: $warn,
    avg_dm: $avg_dm,
    baseline_pass: $baseline_pass,
    baseline_dm: $baseline_dm,
    pass_delta: $pass_delta,
    dm_delta: $dm_delta,
    regression: $regression,
    golden_exit: $golden_exit
  }')

echo "$HISTORY_ENTRY" >> "$HISTORY_FILE"
echo "  Saved: $HISTORY_FILE"

###############################################################################
# FINAL VERDICT
###############################################################################

echo ""
echo "============================================================"
if $REGRESSION_FAILED; then
  echo -e "  ${RED}${BOLD}REGRESSION DETECTED${NC} — scoring quality has degraded"
  echo "  Review changes to scoring engine before deploying."
  echo "============================================================"
  exit 1
else
  echo -e "  ${GREEN}${BOLD}NO REGRESSION${NC} — scoring quality is within acceptable range"
  echo "============================================================"
  exit 0
fi
