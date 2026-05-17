#!/bin/bash
set -euo pipefail
cd /root/workspace/ConvictionAtlas

# Load env
set -a
source /root/workspace/ConvictionAtlas/.env
if [ -f /etc/conviction-atlas/api.env ]; then
  source /etc/conviction-atlas/api.env
fi
set +a

BASE=http://localhost:3001
STEPS=(
  '/api/internal/ingest/coingecko'
  '/api/internal/ingest/polymarket'
  '/api/internal/normalize/opportunities'
  '/api/internal/ingest/news'
  '/api/internal/signals/recompute'
  '/api/internal/managers/run'
  '/api/internal/portfolio/rebalance'
  '/api/internal/performance/snapshot'
  '/api/internal/memos/generate'
)

echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') Pipeline started"
for step in "${STEPS[@]}"; do
  echo "  Running $step ..."
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}${step}" -H 'Content-Type: application/json' -d '{}')
  if [ "$HTTP_CODE" -ge 400 ]; then
    echo "  FAILED: $step returned HTTP $HTTP_CODE"
  else
    echo "  OK: $step ($HTTP_CODE)"
  fi
done
echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') Pipeline finished"
