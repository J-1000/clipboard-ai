#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${CBAI_HTTP_BASE_URL:-http://127.0.0.1:9159}"
TOKEN="${CBAI_HTTP_TOKEN:-}"
ACTION="${1:-summarize}"

if [[ -z "$TOKEN" ]]; then
  echo "error: set CBAI_HTTP_TOKEN" >&2
  exit 1
fi

curl -s "$BASE_URL/action" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"$ACTION\"}"
