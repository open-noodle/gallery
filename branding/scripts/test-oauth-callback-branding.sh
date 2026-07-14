#!/usr/bin/env bash
#
# Regression test for the Android OIDC login bug shipped through v5.1.0.
#
# apply-branding rewrote the scheme the app LISTENS on (AndroidManifest.xml:
# app.immich -> de.opennoodle.gallery) but not the scheme the app ASKS for
# (oauth.service.dart, still app.immich). The IdP then redirected the browser to
# app.immich:///oauth-callback, no installed app claimed that scheme, and the browser
# dead-ended on a blank page — OIDC login was impossible on every branded Android build.
#
# This test runs the REAL patch_oauth_callback() against a throwaway mirror and asserts
# the invariant: the scheme the app SENDS == the scheme the server EMITS == a scheme the
# manifest REGISTERS, with the legacy app.immich scheme always registered for backwards
# compatibility.
#
# The working tree is never mutated (patch runs against a temp mirror), so this is safe
# to run locally and in CI. No image tooling or network access required.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"

# GNU sed/coreutils on macOS (mirrors .github/actions/apply-branding/action.yml).
if [[ "$(uname)" == "Darwin" ]]; then
  export PATH="/opt/homebrew/opt/gnu-sed/libexec/gnubin:/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
fi

# Sourcing only defines functions and reads config — main is guarded by BASH_SOURCE.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/apply-branding.sh"
set +e # apply-branding.sh enables `set -e`; a failed grep must not abort the run

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/mobile/lib/services" \
  "$TMP/mobile/android/app/src/main" \
  "$TMP/server/src" \
  "$TMP/web/src/routes/admin/system-settings"
cp "$REPO/mobile/lib/services/oauth.service.dart" "$TMP/mobile/lib/services/"
cp "$REPO/mobile/android/app/src/main/AndroidManifest.xml" "$TMP/mobile/android/app/src/main/"
cp "$REPO/server/src/constants.ts" "$TMP/server/src/"
cp "$REPO/web/src/routes/admin/system-settings/AuthSettings.svelte" "$TMP/web/src/routes/admin/system-settings/"

# Apply the real transformation against the mirror, twice — the branding action runs on a
# fresh checkout, but idempotence keeps a double-apply from duplicating the <data> line.
REPO_ROOT="$TMP" patch_oauth_callback >/dev/null
REPO_ROOT="$TMP" patch_oauth_callback >/dev/null

DART="mobile/lib/services/oauth.service.dart"
MANIFEST="mobile/android/app/src/main/AndroidManifest.xml"
CONSTANTS="server/src/constants.ts"
SETTINGS="web/src/routes/admin/system-settings/AuthSettings.svelte"

fails=0
present() { # <file> <literal> <description>
  if grep -Fq "$2" "$TMP/$1"; then
    echo "  ok:   $3"
  else
    echo "  FAIL: $3 — '$2' missing from $1"
    fails=$((fails + 1))
  fi
}
count_is() { # <file> <literal> <expected> <description>
  local actual
  actual=$(grep -Fc "$2" "$TMP/$1")
  if [[ "$actual" == "$3" ]]; then
    echo "  ok:   $4"
  else
    echo "  FAIL: $4 — expected $3 occurrence(s) of '$2' in $1, found $actual"
    fails=$((fails + 1))
  fi
}

echo "The app sends the configured callback URI:"
present "$DART" "kOAuthCallbackUri = '${OAUTH_CALLBACK}'" "oauth.service.dart sends ${OAUTH_CALLBACK}"

echo "Android registers BOTH schemes for /oauth-callback:"
present "$MANIFEST" "android:scheme=\"${OAUTH_CALLBACK_SCHEME}\" android:pathPrefix=\"/oauth-callback\"" \
  "the scheme the app sends (${OAUTH_CALLBACK_SCHEME}) is registered"
present "$MANIFEST" 'android:scheme="app.immich" android:pathPrefix="/oauth-callback"' \
  "the legacy app.immich scheme is still registered"
present "$MANIFEST" "android:scheme=\"${BUNDLE_ID}\" android:pathPrefix=\"/oauth-callback\"" \
  "the branded ${BUNDLE_ID} scheme is registered"
count_is "$MANIFEST" "android:scheme=\"${BUNDLE_ID}\" android:pathPrefix=\"/oauth-callback\"" 1 \
  "double-apply did not duplicate the branded <data> line"

echo "The server emits the same URI the app sends:"
present "$CONSTANTS" "MOBILE_REDIRECT = '${OAUTH_CALLBACK}'" "server MOBILE_REDIRECT emits ${OAUTH_CALLBACK}"

echo "Admins are shown the same URI:"
present "$SETTINGS" "callback: '${OAUTH_CALLBACK}'" "AuthSettings.svelte shows ${OAUTH_CALLBACK}"

# --- Phase 2 flip simulation -------------------------------------------------
# The plan claims flipping mobile.oauth_callback to the branded URI is a one-line
# change. Prove it: re-run the real patch against a FRESH mirror with OAUTH_CALLBACK
# overridden, and assert the invariant still holds (all four sites agree, and the
# legacy scheme stays registered so older installed app builds keep working).
FLIPPED="${BUNDLE_ID}:///oauth-callback"
TMP2="$(mktemp -d)"
trap 'rm -rf "$TMP" "$TMP2"' EXIT
mkdir -p "$TMP2/mobile/lib/services" \
  "$TMP2/mobile/android/app/src/main" \
  "$TMP2/server/src" \
  "$TMP2/web/src/routes/admin/system-settings"
cp "$REPO/mobile/lib/services/oauth.service.dart" "$TMP2/mobile/lib/services/"
cp "$REPO/mobile/android/app/src/main/AndroidManifest.xml" "$TMP2/mobile/android/app/src/main/"
cp "$REPO/server/src/constants.ts" "$TMP2/server/src/"
cp "$REPO/web/src/routes/admin/system-settings/AuthSettings.svelte" "$TMP2/web/src/routes/admin/system-settings/"

REPO_ROOT="$TMP2" OAUTH_CALLBACK="$FLIPPED" OAUTH_CALLBACK_SCHEME="$BUNDLE_ID" patch_oauth_callback >/dev/null

flipped_present() { # <file> <literal> <description>
  if grep -Fq "$2" "$TMP2/$1"; then
    echo "  ok:   $3"
  else
    echo "  FAIL: $3 — '$2' missing from $1"
    fails=$((fails + 1))
  fi
}

echo "Phase 2 flip (oauth_callback -> ${FLIPPED}) keeps the invariant:"
flipped_present "$DART" "kOAuthCallbackUri = '${FLIPPED}'" "app would send ${FLIPPED}"
flipped_present "$CONSTANTS" "MOBILE_REDIRECT = '${FLIPPED}'" "server would emit ${FLIPPED}"
flipped_present "$SETTINGS" "callback: '${FLIPPED}'" "admins would be shown ${FLIPPED}"
flipped_present "$MANIFEST" "android:scheme=\"${BUNDLE_ID}\" android:pathPrefix=\"/oauth-callback\"" \
  "the flipped scheme is already registered (no manifest change needed)"
flipped_present "$MANIFEST" 'android:scheme="app.immich" android:pathPrefix="/oauth-callback"' \
  "the legacy scheme survives the flip (older installed apps keep working)"

if [[ $fails -gt 0 ]]; then
  echo "FAILED: $fails assertion(s)"
  exit 1
fi
echo "OAuth callback branding verified"
