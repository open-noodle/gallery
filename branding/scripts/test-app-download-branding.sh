#!/usr/bin/env bash
#
# Regression test for issue #649 — the "App download links" modal
# (web/src/lib/modals/AppDownloadModal.svelte) ships upstream Immich store links.
# Runs the REAL patch_app_download_modal() from apply-branding.sh against a
# throwaway copy of the modal, then asserts the Play/App Store badges point at
# the Noodle Gallery apps and the F-Droid badge (no Noodle F-Droid app exists)
# has been replaced with a GitHub releases link.
#
# The working tree is never mutated (patch runs against a temp mirror), so this
# is safe to run locally and in CI. No image tooling or network access required.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"

# GNU sed/coreutils on macOS (mirrors .github/actions/apply-branding/action.yml).
if [[ "$(uname)" == "Darwin" ]]; then
  export PATH="/opt/homebrew/opt/gnu-sed/libexec/gnubin:/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
fi

# Source apply-branding.sh to pull in patch_app_download_modal() and the
# config-derived globals (PLAY_STORE_URL, APP_STORE_URL, REPO_RELEASES_URL).
# The script guards `main` behind a BASH_SOURCE check, so sourcing only defines
# functions and reads config — it does not run a branding pass.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/apply-branding.sh"
set +e # apply-branding.sh enables `set -e`; a failed grep must not abort the run

# Mirror only the file patch_app_download_modal() touches into a temp REPO_ROOT.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/web/src/lib/modals"
cp "$REPO/web/src/lib/modals/AppDownloadModal.svelte" "$TMP/web/src/lib/modals/"

# Apply the real transformation against the mirror.
REPO_ROOT="$TMP" patch_app_download_modal >/dev/null

fails=0
absent() { # <file> <regex> <description>  — regex must NOT match
  if grep -Eq "$2" "$TMP/$1"; then
    echo "  FAIL: $3 — '$2' still present in $1"
    fails=$((fails + 1))
  else
    echo "  ok:   $3"
  fi
}
present() { # <file> <literal> <description>  — literal must match
  if grep -Fq "$2" "$TMP/$1"; then
    echo "  ok:   $3"
  else
    echo "  FAIL: $3 — '$2' missing from $1"
    fails=$((fails + 1))
  fi
}

MODAL="web/src/lib/modals/AppDownloadModal.svelte"

echo "Store badges repointed off Immich:"
absent "$MODAL" 'app\.alextran\.immich' 'play store link no longer targets the Immich app'
absent "$MODAL" 'apps\.apple\.com/us/app/immich/id1613945652' 'app store link no longer targets the Immich app'
absent "$MODAL" 'f-droid\.org' 'F-Droid link removed (no Noodle F-Droid app)'
absent "$MODAL" 'fdroidBadge' 'unused fdroidBadge import dropped'
# Upstream #30527 routes the hrefs through Constants.Get.* from @immich/ui. Once
# all three are rewritten to literals the import is dead, and leaving it behind
# breaks the branded build's zero-warning lint.
absent "$MODAL" 'Constants' 'unused Constants import dropped (upstream #30527)'

echo "Badges + fallback point at Noodle Gallery:"
present "$MODAL" "$PLAY_STORE_URL" 'play store link is the Noodle Gallery app'
present "$MODAL" "$APP_STORE_URL" 'app store link is the Noodle Gallery app'
present "$MODAL" "$REPO_RELEASES_URL" 'F-Droid badge replaced with GitHub releases link'
present "$MODAL" 'id="github-release-link"' 'GitHub releases link rendered'

echo
if [[ $fails -gt 0 ]]; then
  echo "FAILED: $fails assertion(s)"
  exit 1
fi
echo "PASSED: app download modal fully rebranded to ${NAME}"
