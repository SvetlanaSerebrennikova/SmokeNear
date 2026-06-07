#!/usr/bin/env bash
# Fail if secret env files are tracked or staged. Safe to run locally and in CI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0

check_not_tracked() {
  local path="$1"
  if git ls-files --error-unmatch "$path" >/dev/null 2>&1; then
    echo "ERROR: $path is tracked by git — remove with: git rm --cached $path"
    fail=1
  fi
}

for f in .env .env.test .env.local .env.test.backup; do
  check_not_tracked "$f"
done

# Flag only non-empty secret assignments in diffs (empty placeholders in .env.test.example are OK).
# Env-file shape only (KEY=value at line start), not code mentioning these names.
secret_assign_re='^\+(WALLETCONNECT_PROJECT_ID|EVM_PRIVATE_KEY|ONECLICK_API_KEY|ONECLICK_JWT)=[[:space:]]*[^[:space:]]'
diff_exclude=(-- . ':!scripts/rotate-env-test.mjs')

if git diff --cached -U0 "${diff_exclude[@]}" | grep -E "$secret_assign_re" >/dev/null 2>&1; then
  echo "ERROR: staged diff contains secret-like env assignments with values"
  fail=1
fi

if git diff -U0 "${diff_exclude[@]}" | grep -E "$secret_assign_re" >/dev/null 2>&1; then
  echo "ERROR: unstaged diff contains secret-like env assignments with values"
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "OK: no tracked secret env files; no secret assignments in git diff."
