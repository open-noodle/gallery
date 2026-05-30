#!/usr/bin/env bash
#
# Regression test for issue #636 — Immich branding in default email/notification
# templates. Runs the REAL patch_emails() from apply-branding.sh against a
# throwaway copy of the affected files, then asserts every user-facing Immich
# reference (logo, store links/badges, project credit, body copy, subjects) has
# been rebranded to Noodle Gallery.
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

# Source apply-branding.sh to pull in patch_emails() and the config-derived
# globals (NAME, REPO_URL, APP_STORE_URL, PLAY_STORE_URL, EMAIL_ASSET_BASE_URL).
# The script guards `main` behind a BASH_SOURCE check, so sourcing only defines
# functions and reads config — it does not run a branding pass.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/apply-branding.sh"
set +e # apply-branding.sh enables `set -e`; a failed grep must not abort the run

# Mirror only the files patch_emails() touches into a temporary REPO_ROOT.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/server/src/emails/components" "$TMP/server/src/services"
cp "$REPO/server/src/emails/components/immich.layout.tsx" "$TMP/server/src/emails/components/"
cp "$REPO/server/src/emails/components/footer.template.tsx" "$TMP/server/src/emails/components/"
cp "$REPO/server/src/emails/test.email.tsx" "$TMP/server/src/emails/"
cp "$REPO/server/src/emails/welcome.email.tsx" "$TMP/server/src/emails/"
cp "$REPO/server/src/services/notification.service.ts" "$TMP/server/src/services/"
cp "$REPO/server/src/services/notification-admin.service.ts" "$TMP/server/src/services/"

# Apply the real transformation against the mirror.
REPO_ROOT="$TMP" patch_emails >/dev/null

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

LAYOUT="server/src/emails/components/immich.layout.tsx"
FOOTER="server/src/emails/components/footer.template.tsx"
TEST_EMAIL="server/src/emails/test.email.tsx"
WELCOME="server/src/emails/welcome.email.tsx"
NOTIFY="server/src/services/notification.service.ts"
NOTIFY_ADMIN="server/src/services/notification-admin.service.ts"

echo "Layout logo:"
absent "$LAYOUT" 'immich\.app/img' 'logo no longer served from immich.app'
absent "$LAYOUT" 'alt="Immich"' 'logo alt text rebranded'
present "$LAYOUT" "${EMAIL_ASSET_BASE_URL}/immich-logo-inline-light.png" 'logo points to Gallery asset host'
present "$LAYOUT" "alt=\"${NAME}\"" 'logo alt text is Noodle Gallery'

echo "Footer store badges + credit:"
absent "$FOOTER" 'immich\.app' 'no immich.app badge/credit URLs remain'
absent "$FOOTER" 'app\.alextran\.immich' 'play store link repointed off Immich app'
absent "$FOOTER" 'apps\.apple\.com/sg/app/immich' 'app store link repointed off Immich app'
absent "$FOOTER" '>Immich</Link>' 'project credit rebranded'
present "$FOOTER" "$PLAY_STORE_URL" 'play store link is Gallery'
present "$FOOTER" "$APP_STORE_URL" 'app store link is Gallery'
present "$FOOTER" "${EMAIL_ASSET_BASE_URL}/google-play-badge.png" 'play badge from Gallery asset host'
present "$FOOTER" "${EMAIL_ASSET_BASE_URL}/ios-app-store-badge.png" 'app store badge from Gallery asset host'
present "$FOOTER" ">${NAME}</Link>" 'credit names Noodle Gallery'

echo "Body copy + subjects:"
absent "$TEST_EMAIL" 'test email from Immich' 'test email preview rebranded'
absent "$TEST_EMAIL" 'Immich Instance' 'test email body rebranded'
absent "$WELCOME" 'a new Immich instance' 'welcome preview rebranded'
absent "$NOTIFY" "from Immich'" 'test email subject rebranded'
absent "$NOTIFY" "Welcome to Immich'" 'welcome subject rebranded'
absent "$NOTIFY_ADMIN" "from Immich'" 'admin test email subject rebranded'
present "$TEST_EMAIL" "test email from ${NAME}" 'test email names Noodle Gallery'
present "$WELCOME" "a new ${NAME} instance" 'welcome preview names Noodle Gallery'
present "$NOTIFY" "from ${NAME}'" 'test subject names Noodle Gallery'
present "$NOTIFY" "Welcome to ${NAME}'" 'welcome subject names Noodle Gallery'
present "$NOTIFY_ADMIN" "from ${NAME}'" 'admin test subject names Noodle Gallery'

echo
if [[ $fails -gt 0 ]]; then
  echo "FAILED: $fails assertion(s)"
  exit 1
fi
echo "PASSED: email/notification templates fully rebranded to ${NAME}"
