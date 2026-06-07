#!/usr/bin/env bash
# Remove .env.test from ALL git history in SmokeNear.
#
# PREREQUISITES (do these FIRST):
#   1. Rotate EVM_PRIVATE_KEY and WALLETCONNECT_PROJECT_ID — history rewrite does not
#      invalidate keys that were already public in commit dabc9c7.
#   2. Install git-filter-repo: pip install git-filter-repo
#   3. Coordinate with anyone who cloned the repo — they must re-clone after force-push.
#
# Usage:
#   ./scripts/purge-smokenear-history.sh
#
# Dry-run (shows what would be removed, no push):
#   DRY_RUN=1 ./scripts/purge-smokenear-history.sh

set -euo pipefail

REPO_URL="${SMOKENEAR_REPO_URL:-git@github.com:SvetlanaSerebrennikova/SmokeNear.git}"
WORKDIR="${SMOKENEAR_MIRROR_DIR:-/tmp/smokenear-mirror-$(date +%s)}"
DRY_RUN="${DRY_RUN:-0}"

FILTER_REPO=(git-filter-repo)
if ! command -v git-filter-repo >/dev/null 2>&1; then
  if python3 -m git_filter_repo --version >/dev/null 2>&1; then
    FILTER_REPO=(python3 -m git_filter_repo)
  else
    echo "ERROR: git-filter-repo not found. Install: pip3 install git-filter-repo"
    exit 1
  fi
fi

echo "Cloning mirror of ${REPO_URL} → ${WORKDIR}"
rm -rf "$WORKDIR"
git clone --mirror "$REPO_URL" "$WORKDIR"
cd "$WORKDIR"

echo "Rewriting history: removing .env.test from all commits..."
"${FILTER_REPO[@]}" --path .env.test --invert-paths --force

if [[ "$DRY_RUN" == "1" ]]; then
  echo ""
  echo "DRY_RUN=1 — rewrite done locally, NOT pushed."
  echo "Inspect: cd ${WORKDIR} && git log --oneline -- .env.test"
  echo "To push for real: cd ${WORKDIR} && git remote add origin ${REPO_URL} && git push --force origin --all && git push --force origin --tags"
  exit 0
fi

echo ""
echo "About to FORCE-PUSH rewritten history to ${REPO_URL}"
echo "Press Ctrl+C within 10s to abort..."
sleep 10

git remote add origin "$REPO_URL"
git push --force origin --all
git push --force origin --tags

echo "Done. Ask all collaborators to delete local clones and re-clone."
