#!/bin/bash
# Install the production crontab from deploy/crontab.prod.txt.
# Idempotent — overwrites the existing crontab for the current user (root).
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
src="${repo_dir}/deploy/crontab.prod.txt"

if [ ! -f "$src" ]; then
  echo "Missing $src" >&2
  exit 1
fi

# Preserve any non-Conviction-Atlas cron lines the host has (e.g.
# research-pipeline jobs). Strategy: dump current crontab, strip lines
# referencing run-pipeline-cron.sh, append our managed block.
tmp=$(mktemp)
crontab -l 2>/dev/null | grep -v 'run-pipeline-cron.sh' > "$tmp" || true
cat "$src" >> "$tmp"
crontab "$tmp"
rm -f "$tmp"

echo "Installed production crontab:"
crontab -l | tail -10
