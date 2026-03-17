#!/bin/bash
# Run reservation enrichment for OpenTable + Resy
# Prerequisites: SUPAB_URL and SUPAB_SERVICE_ROLE_KEY in .env
set -euo pipefail
cd "$(dirname "$0")"
echo "=== OpenTable Enrichment ==="
npx tsx pipelines/reservation-enrichment.ts --platform opentable
echo "=== Resy Enrichment ==="
npx tsx pipelines/resy-enrichment.ts
echo "=== Done ==="
