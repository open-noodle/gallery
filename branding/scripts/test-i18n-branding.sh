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
#   - every other locale drops the key so it falls back to branded English,
#   - no locale renders the upstream name for any overridden key.
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
absent() { # <lang> <key> <description>  — key must be deleted (falls back to en)
  local got
  got=$(jq -r --arg k "$2" 'has($k)' "$TMP/i18n/$1.json")
  if [[ "$got" == "false" ]]; then
    echo "  ok:   $3"
  else
    echo "  FAIL: $3 — ${1}.json still defines '$2' = '$(jq -r --arg k "$2" '.[$k]' "$TMP/i18n/$1.json")'"
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
absent_at() { # <lang> <dotpath> <description>  — leaf undefined (falls back to en)
  local got
  got=$(jq -r --arg k "$2" 'getpath($k | split(".")) == null' "$TMP/i18n/$1.json")
  if [[ "$got" == "true" ]]; then
    echo "  ok:   $3"
  else
    echo "  FAIL: $3 — ${1}.json still defines '$2' = '$(val_at "$1" "$2")'"
    fails=$((fails + 1))
  fi
}

KEY="purchase_button_buy_immich"

echo "English override applied:"
eq en "$KEY" "Support Noodle Gallery" 'en buy button is the branded English override'

echo "Per-locale branded translations applied (de, fr):"
eq de "$KEY" "Noodle Gallery unterstützen" 'de buy button is branded German (issue #703 screenshot)'
eq fr "$KEY" "Soutenir Noodle Gallery" 'fr buy button is branded French'
eq de purchase_panel_info_2 "$(jq -r '.purchase_panel_info_2' "$REPO/branding/i18n/overrides-de.json")" 'de purchase panel is branded German'

echo "Locales without an override fall back to branded English:"
absent es "$KEY" 'es buy button dropped -> falls back to en override'
absent it "$KEY" 'it buy button dropped -> falls back to en override'
absent nl "$KEY" 'nl buy button dropped -> falls back to en override'
absent de welcome_to_immich 'de non-panel brand key dropped -> falls back to en override'

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
# These admin descriptions have no per-locale override, so every non-English locale
# must drop them (their upstream-named translation) and fall back to branded en.
absent_at de admin.theme_settings_description 'de drops admin.theme_settings_description -> falls back to en'
absent_at fr admin.maintenance_settings_description 'fr drops admin.maintenance_settings_description -> falls back to en'

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
