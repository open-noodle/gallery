#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMP_ROOT=""
CHECK_WORKTREE=""
INITIAL_STATUS="$(git -C "$REPO_ROOT" status --short)"

cleanup() {
  local status=$?
  set +e

  if [[ -n "$CHECK_WORKTREE" ]]; then
    git -C "$REPO_ROOT" worktree remove --force "$CHECK_WORKTREE" >/dev/null 2>&1
  fi
  if [[ -n "$TMP_ROOT" ]]; then
    rm -rf "$TMP_ROOT"
  fi

  local final_status
  final_status="$(git -C "$REPO_ROOT" status --short)"
  if [[ "$final_status" != "$INITIAL_STATUS" ]]; then
    echo "ERROR: gallery-branding-check active worktree status changed" >&2
    echo "Before:" >&2
    printf '%s\n' "$INITIAL_STATUS" >&2
    echo "After:" >&2
    printf '%s\n' "$final_status" >&2
    exit 1
  fi

  exit "$status"
}
trap cleanup EXIT

if [[ "$(uname)" == "Darwin" ]]; then
  export PATH="/opt/homebrew/opt/gnu-sed/libexec/gnubin:/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
fi

TMP_ROOT="$(mktemp -d)"
CHECK_WORKTREE="$TMP_ROOT/worktree"

echo "=== Gallery branding check ==="
echo "Creating temporary worktree at $CHECK_WORKTREE"
git -C "$REPO_ROOT" worktree add --quiet --detach "$CHECK_WORKTREE" HEAD

cd "$CHECK_WORKTREE"

echo "--- Checking branding action dependencies ---"
ruby .github/actions/apply-branding/dependencies_test.rb

echo "--- Checking email branding transform ---"
branding/scripts/test-email-branding.sh

echo "--- Checking app download branding transform ---"
branding/scripts/test-app-download-branding.sh

echo "--- Checking i18n branding overrides (issues #703, #672) ---"
branding/scripts/test-i18n-branding.sh

echo "--- Checking OAuth mobile callback branding (dual-scheme regression) ---"
branding/scripts/test-oauth-callback-branding.sh

echo "--- Applying branding overlay ---"
branding/scripts/apply-branding.sh

echo "--- Verifying applied branding ---"
branding/scripts/verify-branding.sh

echo "=== Gallery branding check passed ==="
