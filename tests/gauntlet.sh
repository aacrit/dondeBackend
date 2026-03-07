#!/usr/bin/env bash
###############################################################################
# Donde Gauntlet — Search Quality Testing Orchestrator
#
# Usage:
#   ./tests/gauntlet.sh [options]
#
# Options:
#   --generate           (Re)generate the search atlas from taxonomy configs
#   --tier N             Only run queries from tier N (0-5)
#   --category CAT       Only run queries from category CAT
#   --limit N            Max queries to run
#   --sample N           Run N random queries
#   --full               Full-fidelity mode (includes Google Places + Claude blurb)
#   --incremental        Skip queries that passed in previous run
#   --regression         Only re-run previously failed queries
#   --workers N          Parallel workers (default: 3)
#   --analyze-only FILE  Skip runner, just analyze existing results
#   --diff RUN1 RUN2     Compare two runs
#
# Examples:
#   ./tests/gauntlet.sh --generate                    # Generate atlas only
#   ./tests/gauntlet.sh --tier 1 --limit 50           # Quick Tier 1 test (50 queries)
#   ./tests/gauntlet.sh --tier 1                      # Full Tier 1 run
#   ./tests/gauntlet.sh --sample 100                  # Random 100 queries
#   ./tests/gauntlet.sh --incremental                 # Run new/failed queries only
#   ./tests/gauntlet.sh --regression                  # Re-run failures
#   ./tests/gauntlet.sh --full --tier 1 --limit 20    # Full-fidelity mode (20 queries)
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPTS_DIR="$BACKEND_DIR/scripts"
RESULTS_DIR="$SCRIPT_DIR/gauntlet-results"
ATLAS_PATH="$SCRIPT_DIR/search-atlas-v1.jsonl"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Ensure results directory exists
mkdir -p "$RESULTS_DIR"

# Parse arguments — forward all to the runner
GENERATE=false
ANALYZE_ONLY=""
RUNNER_ARGS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --generate)
      GENERATE=true
      shift
      ;;
    --analyze-only)
      ANALYZE_ONLY="$2"
      shift 2
      ;;
    *)
      RUNNER_ARGS+=("$1")
      shift
      ;;
  esac
done

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  DONDE GAUNTLET — Search Quality Testing Framework         ║${NC}"
echo -e "${BOLD}║  $(date -u '+%Y-%m-%dT%H:%M:%SZ')                                    ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"

# Step 1: Generate atlas if requested or if it doesn't exist
if [[ "$GENERATE" == "true" ]] || [[ ! -f "$ATLAS_PATH" ]]; then
  echo ""
  echo -e "${BLUE}━━━ Step 1: Generating Search Atlas ━━━${NC}"
  cd "$SCRIPTS_DIR"
  npx tsx pipelines/generate-search-atlas.ts --output "$ATLAS_PATH"
  QUERY_COUNT=$(wc -l < "$ATLAS_PATH")
  echo -e "${GREEN}  ✓ Atlas generated: $QUERY_COUNT queries${NC}"
fi

# If generate-only, stop here
if [[ "$GENERATE" == "true" ]] && [[ ${#RUNNER_ARGS[@]} -eq 0 ]] && [[ -z "$ANALYZE_ONLY" ]]; then
  echo ""
  echo -e "${GREEN}Atlas generation complete. Run without --generate to execute tests.${NC}"
  exit 0
fi

# Step 2: Run queries (unless analyze-only)
if [[ -z "$ANALYZE_ONLY" ]]; then
  echo ""
  echo -e "${BLUE}━━━ Step 2: Running Gauntlet ━━━${NC}"
  cd "$SCRIPTS_DIR"
  npx tsx pipelines/gauntlet-runner.ts "$ATLAS_PATH" --output "$RESULTS_DIR" "${RUNNER_ARGS[@]}"

  # Find the latest result file
  LATEST_RESULT=$(ls -t "$RESULTS_DIR"/run-*.jsonl 2>/dev/null | head -1)
else
  # Resolve to absolute path
  LATEST_RESULT="$(cd "$(dirname "$ANALYZE_ONLY")" && pwd)/$(basename "$ANALYZE_ONLY")"
fi

if [[ -z "$LATEST_RESULT" ]] || [[ ! -f "$LATEST_RESULT" ]]; then
  echo -e "${RED}  ✗ No results file found to analyze${NC}"
  exit 1
fi

RESULT_COUNT=$(wc -l < "$LATEST_RESULT")
echo ""
echo -e "${GREEN}  ✓ Results: $RESULT_COUNT queries in $(basename "$LATEST_RESULT")${NC}"

# Step 3: Gap Analysis
echo ""
echo -e "${BLUE}━━━ Step 3: Gap Analysis ━━━${NC}"
cd "$SCRIPTS_DIR"
npx tsx pipelines/gap-analyzer.ts "$LATEST_RESULT"

# Step 4: Dashboard Generation
echo ""
echo -e "${BLUE}━━━ Step 4: Generating Dashboard ━━━${NC}"
cd "$SCRIPTS_DIR"
npx tsx pipelines/gauntlet-dashboard.ts "$LATEST_RESULT"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  GAUNTLET COMPLETE                                         ║${NC}"
echo -e "${BOLD}║                                                            ║${NC}"
echo -e "${BOLD}║  Results: tests/gauntlet-results/$(basename "$LATEST_RESULT")${NC}"
echo -e "${BOLD}║  Dashboard: tests/GAUNTLET_DASHBOARD.md                    ║${NC}"
echo -e "${BOLD}║  Gap Report: tests/gauntlet-results/gap-report-*.md        ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
