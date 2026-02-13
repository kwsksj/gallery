#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CANONICAL_REPO_DIR="$(cd "$REPO_ROOT/.." && pwd)/media-platform"
LEGACY_REPO_DIR="$(cd "$REPO_ROOT/.." && pwd)/auto-post"

DEFAULT_ENV_FILE="$CANONICAL_REPO_DIR/.env"
if [[ ! -f "$DEFAULT_ENV_FILE" ]]; then
  DEFAULT_ENV_FILE="$LEGACY_REPO_DIR/.env"
fi

BUCKET="${1:-woodcarving-photos}"
ENV_FILE="${2:-$DEFAULT_ENV_FILE}"
OUT_DIR="${3:-$(mktemp -d)}"

cleanup() {
  if [[ "${3:-}" == "" ]] && [[ -d "$OUT_DIR" ]]; then
    rm -rf "$OUT_DIR"
  fi
}
trap cleanup EXIT

cd "$REPO_ROOT"

echo "[1/3] Build students_index.json and tags_index.json"
node ./scripts/build-admin-indexes.mjs --env-file "$ENV_FILE" --out-dir "$OUT_DIR"

echo "[2/3] Upload students_index.json to R2 ($BUCKET)"
npx wrangler r2 object put "${BUCKET}/students_index.json" \
  --file="${OUT_DIR}/students_index.json" \
  --content-type="application/json; charset=utf-8" \
  --cache-control="max-age=300" \
  --remote

echo "[3/3] Upload tags_index.json to R2 ($BUCKET)"
npx wrangler r2 object put "${BUCKET}/tags_index.json" \
  --file="${OUT_DIR}/tags_index.json" \
  --content-type="application/json; charset=utf-8" \
  --cache-control="max-age=300" \
  --remote

echo "Done. Uploaded:"
echo "  - students_index.json"
echo "  - tags_index.json"
