#!/bin/bash
# Daily incremental pipeline. Runs the ingest -> signal -> decision ->
# rebalance -> snapshot chain once a day, then asserts the resulting NAV
# row for today exists in the DB. Any failure (HTTP error, snapshot
# missing) exits non-zero so cron's MAILTO surfaces the incident.
#
# This script is intentionally a thin curl-driven runner: heavy logic
# lives in the NestJS services so it can be exercised from tests and the
# Swagger UI too.
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
DB=/root/workspace/ConvictionAtlas/prisma/conviction-atlas.db
TODAY=$(date -u '+%Y-%m-%d')

STEPS=(
  '/api/internal/ingest/coingecko'
  '/api/internal/ingest/polymarket'
  '/api/internal/normalize/opportunities'
  '/api/internal/ingest/news'
  '/api/internal/ingest/ohlcv'
  '/api/internal/signals/recompute'
  '/api/internal/managers/run'
  '/api/internal/portfolio/rebalance'
  '/api/internal/performance/snapshot'
  '/api/internal/memos/generate'
)

failures=0
echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') Pipeline started (dateKey=${TODAY})"
for step in "${STEPS[@]}"; do
  echo "  Running $step ..."
  HTTP_CODE=$(curl -s -o /tmp/last-pipeline-step.json -w '%{http_code}' \
    -X POST "${BASE}${step}" -H 'Content-Type: application/json' -d '{}')
  if [ "$HTTP_CODE" -ge 400 ]; then
    echo "  FAILED: $step returned HTTP $HTTP_CODE"
    echo "  Body: $(head -c 800 /tmp/last-pipeline-step.json)"
    failures=$((failures + 1))
  else
    echo "  OK: $step ($HTTP_CODE)"
  fi
done

# Health check: today's NAV must be present for every active manager.
# (`Manager` rows are seed-controlled; we don't filter on isActive because
#  the schema doesn't carry it. If a manager is meant to be paused, remove
#  it from the seed.)
expected=$(sqlite3 "$DB" 'SELECT COUNT(*) FROM Manager;')
actual=$(sqlite3 "$DB" "SELECT COUNT(*) FROM PerformanceSnapshot WHERE dateKey = '${TODAY}';")
echo "  Health check: PerformanceSnapshot rows for ${TODAY} = ${actual}/${expected}"
if [ "$actual" -lt "$expected" ]; then
  echo "  ALERT: only ${actual}/${expected} managers wrote a NAV row for ${TODAY}"
  failures=$((failures + 1))
fi

echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') Pipeline finished (failures=${failures})"
exit $failures
