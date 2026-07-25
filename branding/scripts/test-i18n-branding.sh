#!/usr/bin/env bash
#
# Regression test for issue #703 — the "Buy Immich" label leaking into
# non-English locales (German: "Immich kaufen", French: "Acheter Immich", ...).
#
# Immich crowdsources every non-English locale through Weblate, which the fork
# doesn't run, so the fork can only brand strings at build time. patch_i18n()
# merges branding/i18n/overrides-en.json into en.json, but the upstream-synced
# locale files (i18n/de.json, fr.json, ...) keep their own translations of the
# rebranded keys — so the upstream brand leaks in every translated language and
# regresses on each Weblate sync.
#
# This test runs the REAL patch_i18n() from apply-branding.sh against a throwaway
# copy of i18n/ and asserts that for every branded key:
#   - en.json carries the branded English override,
#   - locales with a per-locale override (de, fr) carry the branded translation,
#   - every other locale KEEPS its own translation with the name swapped,
#   - no locale renders the upstream name for any overridden key.
#
# That third rule is issue #844. Leaking keys used to be deleted so the locale
# fell back to branded English, which silently reverted ~2,100 already-translated
# strings across 69 locales — so the assertions below check that a translation
# survives, not merely that the brand name is correct.
#
# The working tree is never mutated (patch runs against a temp REPO_ROOT), so
# this is safe to run locally and in CI. No image tooling or network required.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"

# GNU sed/coreutils on macOS (mirrors .github/actions/apply-branding/action.yml).
if [[ "$(uname)" == "Darwin" ]]; then
  export PATH="/opt/homebrew/opt/gnu-sed/libexec/gnubin:/opt/homebrew/opt/coreutils/libexec/gnubin:$PATH"
fi

# Source apply-branding.sh to pull in patch_i18n() and the config-derived globals
# (NAME, UPSTREAM_NAME, BRANDING_DIR). The script guards `main` behind a
# BASH_SOURCE check, so sourcing only defines functions and reads config.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/apply-branding.sh"
set +e # apply-branding.sh enables `set -e`; a failed grep/jq must not abort the run

# Mirror the whole i18n/ tree into a temp REPO_ROOT and patch the mirror.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/i18n"
cp "$REPO"/i18n/*.json "$TMP/i18n/"

REPO_ROOT="$TMP" patch_i18n >/dev/null

fails=0
eq() { # <lang> <key> <expected> <description>
  local got
  got=$(jq -r --arg k "$2" '.[$k] // " ABSENT"' "$TMP/i18n/$1.json")
  if [[ "$got" == "$3" ]]; then
    echo "  ok:   $4"
  else
    echo "  FAIL: $4 — ${1}.json[$2] = '$got' (expected '$3')"
    fails=$((fails + 1))
  fi
}

# Dot-path variants for nested keys (issue #672 — overrides that live under
# .admin.*). `getpath(split("."))` resolves a dotted path into the locale object.
val_at() { # <lang> <dotpath>  — prints the resolved value, or empty if undefined
  jq -r --arg k "$2" 'getpath($k | split(".")) // empty' "$TMP/i18n/$1.json"
}
branded_at() { # <lang> <dotpath> <description>  — present, carries $NAME, no $UPSTREAM_NAME
  local got
  got=$(val_at "$1" "$2")
  if [[ -z "$got" ]]; then
    echo "  FAIL: $3 — ${1}.json[$2] is ABSENT (expected branded value)"
    fails=$((fails + 1))
  elif echo "$got" | grep -q "$UPSTREAM_NAME"; then
    echo "  FAIL: $3 — ${1}.json[$2] still contains '$UPSTREAM_NAME': '$got'"
    fails=$((fails + 1))
  elif ! echo "$got" | grep -qF "$NAME"; then
    echo "  FAIL: $3 — ${1}.json[$2] is not branded with '$NAME': '$got'"
    fails=$((fails + 1))
  else
    echo "  ok:   $3"
  fi
}
KEY="purchase_button_buy_immich"

echo "English override applied:"
eq en "$KEY" "Support Noodle Gallery" 'en buy button is the branded English override'

echo "Per-locale branded translations applied (de, fr):"
eq de "$KEY" "Noodle Gallery unterstützen" 'de buy button is branded German (issue #703 screenshot)'
eq fr "$KEY" "Soutenir Noodle Gallery" 'fr buy button is branded French'
eq de purchase_panel_info_2 "$(jq -r '.purchase_panel_info_2' "$REPO/branding/i18n/overrides-de.json")" 'de purchase panel is branded German'

# Issue #844: these used to be DELETED so the locale fell back to branded
# English. That threw away a real translation for every leaking key — ~2,100
# strings across 69 locales. They must now keep their translation with only the
# brand name swapped.
echo "Locales without an override keep their translation, rebranded (issue #844):"
branded_at es "$KEY" 'es buy button stays Spanish, rebranded'
branded_at it "$KEY" 'it buy button stays Italian, rebranded'
branded_at nl "$KEY" 'nl buy button stays Dutch, rebranded'
branded_at de welcome_to_immich 'de non-panel brand key stays German, rebranded'

# Issue #844 verbatim: the mobile "Endgültig löschen" dialog. Its title and three
# buttons never named the upstream project so they stayed German, while this one
# explanatory sentence — the only part that did — was deleted and fell back to
# English, on a destructive, irreversible action. Assert the German survives, not
# just that the brand is right: a fallback to branded English would pass
# branded_at on its own.
echo "Mobile delete-dialog body keeps its translation (issue #844):"
d844=$(val_at de delete_dialog_alert_local_non_backed_up)
if [[ -z "$d844" ]]; then
  echo "  FAIL: de delete_dialog_alert_local_non_backed_up is ABSENT (regressed to en fallback)"
  fails=$((fails + 1))
elif echo "$d844" | grep -q "$UPSTREAM_NAME"; then
  echo "  FAIL: de delete_dialog_alert_local_non_backed_up still names '$UPSTREAM_NAME': '$d844'"
  fails=$((fails + 1))
elif ! echo "$d844" | grep -qF "$NAME"; then
  echo "  FAIL: de delete_dialog_alert_local_non_backed_up is not branded '$NAME': '$d844'"
  fails=$((fails + 1))
elif ! echo "$d844" | grep -q "gesichert"; then
  echo "  FAIL: de delete_dialog_alert_local_non_backed_up is no longer German: '$d844'"
  fails=$((fails + 1))
else
  echo "  ok:   de delete-dialog body stays German and branded ('$d844')"
fi

# Issue #672: nine admin.* descriptions were overridden as TOP-LEVEL keys, so the
# top-level shallow merge ('.[0] * .[1]') added dead top-level keys while the real
# .admin.* values kept the upstream name. They must now be branded under .admin in
# en.json (recursive merge) and dropped from every locale so they fall back to en.
echo "Nested admin.* overrides applied (issue #672):"
ADMIN_KEYS=(
  admin.backup_onboarding_description
  admin.backup_onboarding_footer
  admin.confirm_delete_library_assets
  admin.maintenance_restore_backup_description
  admin.maintenance_restore_backup_different_version
  admin.maintenance_settings_description
  admin.notification_email_from_address_description
  admin.theme_custom_css_settings_description
  admin.theme_settings_description
)
for admin_key in "${ADMIN_KEYS[@]}"; do
  branded_at en "$admin_key" "en $admin_key branded under .admin (not a dead top-level key)"
done
# These admin descriptions have no per-locale override. `walk` must still reach
# them at .admin.* depth and rebrand them in place, keeping the translation.
branded_at de admin.theme_settings_description 'de keeps admin.theme_settings_description, rebranded'
branded_at fr admin.maintenance_settings_description 'fr keeps admin.maintenance_settings_description, rebranded'

# Issue #743 item 4: asset_offline_description exists BOTH top-level and under
# .admin — a top-level-only override recreates the #672 bug shape (the override
# clobbers the user-facing key with the admin text while admin.* keeps leaking).
echo "asset_offline_description branded at BOTH nesting levels (issue #743):"
branded_at en admin.asset_offline_description 'en admin.asset_offline_description branded under .admin'
top_offline=$(val_at en asset_offline_description)
if echo "$top_offline" | grep -q "$UPSTREAM_NAME"; then
  echo "  FAIL: en top-level asset_offline_description still contains '$UPSTREAM_NAME': '$top_offline'"
  fails=$((fails + 1))
elif ! echo "$top_offline" | grep -q "administrator"; then
  echo "  FAIL: en top-level asset_offline_description lost its user-facing text (got the admin text?): '$top_offline'"
  fails=$((fails + 1))
else
  echo "  ok:   en top-level asset_offline_description keeps its user-facing text, branded"
fi

# Issue #743 item 4: the override-driven checks above only cover keys that HAVE
# overrides. Scan every string value in the branded en.json so a missing override
# can never pass silently again.
echo "Whole-file scan: branded en.json leaks the upstream name nowhere:"
en_leaks=$(jq -r --arg up "$UPSTREAM_NAME" '
  paths(scalars) as $p
  | select((getpath($p) | type) == "string" and (getpath($p) | contains($up)))
  | ($p | join("."))' "$TMP/i18n/en.json")
if [[ -n "$en_leaks" ]]; then
  while IFS= read -r k; do
    echo "  FAIL: en.json still contains '$UPSTREAM_NAME' in key '$k' (missing from overrides-en.json)"
    fails=$((fails + 1))
  done <<<"$en_leaks"
else
  echo "  ok:   0 upstream-name values in branded en.json"
fi

echo "Unrelated localized strings are preserved (no collateral damage):"
# 'albums' is a generic key the fork does not rebrand; it must keep its German value.
de_albums=$(jq -r '.albums // " ABSENT"' "$TMP/i18n/de.json")
if [[ "$de_albums" != $' ABSENT' && "$de_albums" != "Alben" ]]; then
  echo "  WARN: de.json['albums'] unexpectedly = '$de_albums' (informational)"
fi
if [[ "$de_albums" == $' ABSENT' ]]; then
  echo "  FAIL: de.json lost unrelated key 'albums'"
  fails=$((fails + 1))
else
  echo "  ok:   de keeps unrelated localized keys (albums = '$de_albums')"
fi

echo "No overridden key leaks the upstream name in ANY locale:"
leaks=0
for f in "$TMP"/i18n/*.json; do
  lang=$(basename "$f" .json)
  leaked_keys=$(jq -r --slurpfile ov "$REPO/branding/i18n/overrides-en.json" --arg up "$UPSTREAM_NAME" '
    . as $loc
    | [$ov[0] | paths(scalars)]
    | map(. as $p | select(($loc | getpath($p)) as $v | ($v | type) == "string" and ($v | contains($up))))
    | .[]
    | join(".")' "$f")
  if [[ -n "$leaked_keys" ]]; then
    while IFS= read -r k; do
      echo "  FAIL: ${lang}.json leaks '$UPSTREAM_NAME' in overridden key '$k'"
      leaks=$((leaks + 1))
    done <<<"$leaked_keys"
  fi
done
if [[ $leaks -eq 0 ]]; then
  locale_count=("$TMP"/i18n/*.json)
  echo "  ok:   0 brand leaks across ${#locale_count[@]} locales"
else
  fails=$((fails + leaks))
fi

echo
if [[ $fails -gt 0 ]]; then
  echo "FAILED: $fails assertion(s)"
  exit 1
fi
echo "PASSED: i18n branding leak-proof across all locales (${NAME})"
