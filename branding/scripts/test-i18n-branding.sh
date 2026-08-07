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

# The "Buy Noodle Gallery" CTA seen on the personal instance (2026-08-07). en_GB
# is a PARTIAL Weblate locale — 2,278 of en's 3,123 keys — that svelte-i18n
# resolves on top of en (web/src/lib/utils.ts inits with
# `fallbackLocale: defaultLang.code` = 'en'), so every key en_GB omits already
# renders the branded English. The keys it DOES define carry upstream's wording,
# and step 3's name swap turns "Buy Immich" into "Buy Noodle Gallery": branded,
# grammatical, and wrong, because the fork sells nothing. Every leak scan above is
# blind to it — the string contains no upstream name. Same shape for
# version_announcement_closing, which signs the release note "Your friend, Alex".
echo "English-variant locales carry the fork's English wording (en_GB):"
eq en_GB "$KEY" "Support Noodle Gallery" 'en_GB buy button is the branded English CTA, not "Buy"'
eq en_GB version_announcement_closing "Your friend, Pierre" "en_GB release sign-off names the fork author, not upstream's"

# Structural guard, not a spot check: for EVERY overridden key, branded en_GB must
# equal branded en unless the difference is a deliberate UK variant listed below.
# A Weblate sync that retranslates one of these now fails here instead of shipping
# upstream's wording under the fork's brand.
# Genuine en_GB English, not upstream wording — keep Weblate's version. Each entry
# is a conscious decision to let en_GB differ; adding a key here waives future
# drift on it too, so only list keys whose divergence is purely dialectal.
EN_GB_ALLOWED_VARIANTS=(
  empty_trash_confirmation                                    # "bin" for "trash"
  backup_controller_page_background_battery_info_message      # "optimisations"
  admin.asset_offline_description                             # "moved to the bin"
  admin.theme_custom_css_settings_description                 # "customised"
  admin.theme_settings_description                            # "customisation"
  admin.maintenance_integrity_checksum_mismatch_description   # "which ... had stored"
)
en_gb_variant_allowed() {
  local candidate
  for candidate in "${EN_GB_ALLOWED_VARIANTS[@]}"; do
    [[ "$candidate" == "$1" ]] && return 0
  done
  return 1
}
gb_drift=0
while IFS= read -r ov_key; do
  gb_val=$(val_at en_GB "$ov_key")
  [[ -z "$gb_val" ]] && continue          # undefined in en_GB -> falls back to branded en
  en_val=$(val_at en "$ov_key")
  [[ "$gb_val" == "$en_val" ]] && continue
  if en_gb_variant_allowed "$ov_key"; then
    echo "  ok:   en_GB keeps a deliberate UK variant of '$ov_key'"
  else
    echo "  FAIL: en_GB[$ov_key] = '$gb_val' but the fork's English is '$en_val'"
    gb_drift=$((gb_drift + 1))
  fi
done < <(jq -r '[paths(scalars)] | .[] | join(".")' "$REPO/branding/i18n/overrides-en.json")
if [[ $gb_drift -eq 0 ]]; then
  echo "  ok:   en_GB matches the fork's English on every overridden key (${#EN_GB_ALLOWED_VARIANTS[@]} UK variants waived)"
else
  fails=$((fails + gb_drift))
fi

# Some overrides don't just swap the brand name, they say something DIFFERENT from
# upstream: the fork sells nothing ("Buy Immich" -> "Support Noodle Gallery"), is
# written by someone else ("Your friend, Alex" -> "...Pierre"), and links to the
# instance rather than my.immich.app. Step 3's name swap cannot express any of
# that — it only renames — so a locale with no override of its own keeps saying
# upstream's thing under the fork's brand ("Kup Noodle Gallery"). Those keys need a
# real translation in every locale the product actually ships in.
SHIPPED_LOCALES=(de fr nl it es pl)   # en and en_GB are asserted above
FORK_VOICE_KEYS=(
  admin.notification_email_from_address_description
  buy
  install_app_title
  my_immich_description
  my_immich_title
  purchase_button_buy_immich
  purchase_discord_title
  purchase_github_description
  purchase_panel_info_2
  version_announcement_closing
)

# Keep FORK_VOICE_KEYS honest: derive the same set from the files and fail if the
# list is missing anything. A key qualifies when the fork's override says something
# the brand swap alone would not produce. version_announcement_closing is the one
# exception — the fork edited i18n/en.json in place (commit 4adfd17eafb) so source
# and override already agree, and no derivation can see it.
echo "FORK_VOICE_KEYS covers every override that changed the meaning:"
derived=$(jq -n --slurpfile s "$REPO/i18n/en.json" --slurpfile o "$REPO/branding/i18n/overrides-en.json" -r '
  [$o[0] | paths(scalars)] as $ps
  | [ $ps[] | . as $p | ($s[0] | getpath($p)) as $u | ($o[0] | getpath($p)) as $f
      | select($u != null and ($u | type) == "string")
      | select(($u | split("Immich") | join("Noodle Gallery")) != $f)
      | ($p | join(".")) ] | .[]')
missing_from_list=0
while IFS= read -r d; do
  [[ -z "$d" ]] && continue
  if ! printf '%s\n' "${FORK_VOICE_KEYS[@]}" | grep -qxF "$d"; then
    echo "  FAIL: '$d' changes meaning vs i18n/en.json but is not in FORK_VOICE_KEYS — add it, and translate it in ${SHIPPED_LOCALES[*]}"
    missing_from_list=$((missing_from_list + 1))
  fi
done <<<"$derived"
if [[ $missing_from_list -eq 0 ]]; then
  echo "  ok:   all $(echo "$derived" | grep -c .) derived keys are listed"
else
  fails=$((fails + missing_from_list))
fi

echo "Every shipped locale translates the fork's own wording:"
voice_gaps=0
for lang in "${SHIPPED_LOCALES[@]}"; do
  lang_ov="$REPO/branding/i18n/overrides-${lang}.json"
  for vkey in "${FORK_VOICE_KEYS[@]}"; do
    if [[ ! -f "$lang_ov" ]] || [[ -z "$(jq -r --arg k "$vkey" 'getpath($k | split(".")) // empty' "$lang_ov")" ]]; then
      echo "  FAIL: ${lang} has no override for '$vkey' — it will render upstream's meaning under the fork's brand"
      voice_gaps=$((voice_gaps + 1))
    fi
  done
done
if [[ $voice_gaps -eq 0 ]]; then
  echo "  ok:   ${#SHIPPED_LOCALES[@]} locales x ${#FORK_VOICE_KEYS[@]} fork-voice keys all translated"
else
  fails=$((fails + voice_gaps))
fi

# Spot-check the two that started this, so a failure reads as the bug not a count.
echo "The reported strings, in every shipped locale:"
for lang in "${SHIPPED_LOCALES[@]}"; do
  cta=$(val_at "$lang" "$KEY")
  sign=$(val_at "$lang" version_announcement_closing)
  if echo "$sign" | grep -qiE 'alex|aleks'; then
    echo "  FAIL: ${lang} release sign-off still names upstream's author: '$sign'"
    fails=$((fails + 1))
  elif [[ "$cta" == "$(jq -r --arg k "$KEY" '.[$k] // ""' "$REPO/branding/i18n/overrides-${lang}.json")" && -n "$cta" ]]; then
    echo "  ok:   ${lang} — CTA '$cta', sign-off '$sign'"
  else
    echo "  FAIL: ${lang} CTA did not come from its override file: '$cta'"
    fails=$((fails + 1))
  fi
done

# The CTA is the one string where upstream's meaning is not merely off-brand but
# false: the fork sells nothing, so "Kup Noodle Gallery" offers a purchase that
# does not exist. Unlike the fork-voice keys above — scoped to the locales the
# product ships in — this one is enforced for ALL 89, because a wrong CTA is worse
# than an untranslated one. A locale that never defines the key is fine: it
# inherits the branded English via svelte-i18n's fallbackLocale.
echo "No locale offers to sell the fork (CTA keys, all locales):"
CTA_KEYS=(buy purchase_button_buy_immich)
cta_gaps=0
cta_checked=0
for locale_src in "$REPO"/i18n/*.json; do
  lang=$(basename "$locale_src" .json)
  [[ "$lang" == "en" ]] && continue
  for cta_key in "${CTA_KEYS[@]}"; do
    # Only locales that define the key can render upstream's wording; the rest
    # fall back to en and are already correct.
    [[ -z "$(jq -r --arg k "$cta_key" '.[$k] // empty' "$locale_src")" ]] && continue
    cta_checked=$((cta_checked + 1))
    lang_ov="$REPO/branding/i18n/overrides-${lang}.json"
    ov_val=$([[ -f "$lang_ov" ]] && jq -r --arg k "$cta_key" '.[$k] // empty' "$lang_ov" || echo "")
    if [[ -z "$ov_val" ]]; then
      echo "  FAIL: ${lang} defines '$cta_key' but has no override — renders '$(jq -r --arg k "$cta_key" '.[$k]' "$locale_src")' rebranded"
      cta_gaps=$((cta_gaps + 1))
      continue
    fi
    got=$(val_at "$lang" "$cta_key")
    if [[ "$got" != "$ov_val" ]]; then
      echo "  FAIL: ${lang}[$cta_key] = '$got' but its override says '$ov_val' (merge did not apply)"
      cta_gaps=$((cta_gaps + 1))
    fi
  done
done
if [[ $cta_gaps -eq 0 ]]; then
  echo "  ok:   $cta_checked locale/key CTA pairs all served by an override"
else
  fails=$((fails + cta_gaps))
fi

# The rebrand is case-sensitive so that docs.immich.app and the app.immich://
# scheme survive it. The cost is that a translator who lowercased the brand in
# prose — "Witamy w immich", "ברוכים הבאים אל immich" — leaks it, and the scans
# above cannot see it either: they grep the capitalised name. Shielding the real
# identifiers first lets the bare mentions be rewritten without touching them.
#
# Asserted over the SHIELDED text, so this stays honest as translations change:
# anything still naming the upstream project in lowercase is either a leak or a
# new identifier form that belongs in UPSTREAM_IDENTIFIERS_JSON.
echo "No lowercase brand mention survives, outside real identifiers:"
lower_leaks=0
for locale_file in "$TMP"/i18n/*.json; do
  lang=$(basename "$locale_file" .json)
  leaked=$(jq -r --arg lower "$UPSTREAM_NAME_LOWER" --argjson ids "$UPSTREAM_IDENTIFIERS_JSON" '
    def shield: reduce $ids[] as $id (.; split($id) | join(" "));
    paths(scalars) as $p
    | select((getpath($p) | type) == "string")
    | select((getpath($p) | shield | contains($lower)))
    | "\($p | join(".")) = \(getpath($p))"' "$locale_file")
  if [[ -n "$leaked" ]]; then
    while IFS= read -r line; do
      echo "  FAIL: ${lang}.json leaks the lowercase name — $line"
      lower_leaks=$((lower_leaks + 1))
    done <<<"$leaked"
  fi
done
if [[ $lower_leaks -eq 0 ]]; then
  lower_locales=("$TMP"/i18n/*.json)
  echo "  ok:   0 lowercase leaks across ${#lower_locales[@]} locales"
else
  fails=$((fails + lower_leaks))
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
