#!/usr/bin/env bash
set -euo pipefail

cd /root/workspace/ConvictionAtlas

export NODE_ENV=production
export NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-/atlas/api}"
export NEXT_PUBLIC_API_DOCS_URL="${NEXT_PUBLIC_API_DOCS_URL:-/docs}"
unset GITHUB_PAGES
unset NEXT_PUBLIC_STATIC_DATA_MODE
unset NEXT_PUBLIC_STATIC_DATA_BASE_URL

rm -rf web/.next web/out

node node_modules/next/dist/bin/next build ./web

TARGET_DIR=/usr/share/nginx/html/conviction-atlas
mkdir -p "$TARGET_DIR"
find "$TARGET_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a web/out/. "$TARGET_DIR"/

echo "Deployed frontend to $TARGET_DIR"
