#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GALLERY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
AUTO_POST_DIR="${AUTO_POST_DIR:-$(cd "${GALLERY_DIR}/.." && pwd)/auto-post}"

echo "[1/4] Checking gallery repo path"
if [[ ! -d "${GALLERY_DIR}/.git" ]]; then
  echo "ERROR: gallery git repo not found at ${GALLERY_DIR}" >&2
  exit 1
fi
echo "OK: ${GALLERY_DIR}"

echo "[2/4] Checking auto-post repo path"
if [[ ! -d "${AUTO_POST_DIR}/.git" ]]; then
  echo "ERROR: auto-post git repo not found at ${AUTO_POST_DIR}" >&2
  echo "Hint: set AUTO_POST_DIR=/path/to/auto-post and rerun." >&2
  exit 1
fi
echo "OK: ${AUTO_POST_DIR}"

echo "[3/4] Checking clean working trees"
gallery_dirty="$(git -C "${GALLERY_DIR}" status --porcelain)"
auto_post_dirty="$(git -C "${AUTO_POST_DIR}" status --porcelain)"
if [[ -n "${gallery_dirty}" && "${ALLOW_GALLERY_DIRTY:-0}" != "1" ]]; then
  echo "ERROR: gallery repo has uncommitted changes." >&2
  echo "Hint: commit/stash changes or run with ALLOW_GALLERY_DIRTY=1." >&2
  exit 1
fi
if [[ -n "${auto_post_dirty}" ]]; then
  echo "ERROR: auto-post repo has uncommitted changes." >&2
  exit 1
fi
if [[ -n "${gallery_dirty}" ]]; then
  echo "WARN: gallery repo is dirty, but ALLOW_GALLERY_DIRTY=1 is set."
else
  echo "OK: both repos are clean"
fi

echo "[4/4] Checking subtree support"
IMPORT_MODE="subtree"
if ! git -C "${AUTO_POST_DIR}" subtree --help >/dev/null 2>&1; then
  IMPORT_MODE="rsync"
  echo "WARN: git subtree is not available. Falling back to rsync import instructions."
else
  echo "OK: git subtree is available"
fi

cat <<EOF

Migration is ready.

Recommended next commands:
EOF

if [[ "${IMPORT_MODE}" == "subtree" ]]; then
cat <<EOF
History-preserving import (auto-post is canonical):
  git -C "${AUTO_POST_DIR}" checkout -b codex/monorepo-bootstrap
  git -C "${AUTO_POST_DIR}" remote add gallery-local "${GALLERY_DIR}"
  git -C "${AUTO_POST_DIR}" fetch gallery-local
  git -C "${AUTO_POST_DIR}" subtree add --prefix apps/gallery gallery-local main
EOF
else
cat <<EOF
Copy import (no history, auto-post is canonical):
  git -C "${AUTO_POST_DIR}" checkout -b codex/monorepo-bootstrap
  mkdir -p "${AUTO_POST_DIR}/apps/gallery"
  rsync -a --exclude .git "${GALLERY_DIR}/" "${AUTO_POST_DIR}/apps/gallery/"
  git -C "${AUTO_POST_DIR}" add apps/gallery
  git -C "${AUTO_POST_DIR}" commit -m "Import gallery into apps/gallery (no history)"
EOF
fi

cat <<EOF
Docs:
  - ${AUTO_POST_DIR}/MONOREPO_INTEGRATION.md
  - ${GALLERY_DIR}/docs/monorepo-migration-plan.md
EOF
