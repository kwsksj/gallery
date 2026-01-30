#!/usr/bin/env bash
set -euo pipefail

BUCKET="${1:-woodcarving-photos}"
FILE="${2:-gallery.html}"

if [[ ! -f "$FILE" ]]; then
  echo "ファイルが見つかりません: $FILE" >&2
  exit 1
fi

OBJECT_NAME="$(basename "$FILE")"

npx wrangler r2 object put "${BUCKET}/${OBJECT_NAME}" \
  --file="$FILE" \
  --content-type="text/html" \
  --cache-control="max-age=3600" \
  --remote
