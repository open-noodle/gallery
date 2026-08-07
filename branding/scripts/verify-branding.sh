#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$BRANDING_DIR")"
CONFIG="$BRANDING_DIR/config.json"

NAME=$(jq -r '.name' "$CONFIG")
UPSTREAM_NAME=$(jq -r '.upstream_name' "$CONFIG")
AUTHOR_NAME=$(jq -r '.author.name' "$CONFIG")
AUTHOR_SIGNOFF_KEY=$(jq -r '.author.signoff_key' "$CONFIG")
# read loop rather than `mapfile`, which is bash 4+ — macOS still ships bash 3.2 at
# /bin/bash, and the rest of this repo's scripts stay runnable there.
UPSTREAM_AUTHOR_NAMES=()
while IFS= read -r author_spelling; do
  UPSTREAM_AUTHOR_NAMES+=("$author_spelling")
done < <(jq -r '.upstream.author_names[]' "$CONFIG")
DEEP_LINK_SCHEME=$(jq -r '.mobile.deep_link_scheme' "$CONFIG")
BUNDLE_ID=$(jq -r '.mobile.bundle_id' "$CONFIG")
OAUTH_CALLBACK=$(jq -r '.mobile.oauth_callback' "$CONFIG")
OAUTH_CALLBACK_SCHEME="${OAUTH_CALLBACK%%:*}"
# Used by the modal checks below to assert the Noodle URLs are actually PRESENT, not
# merely that the Immich ones are gone. Same keys apply-branding.sh patches them from.
APP_STORE_URL=$(jq -r '.mobile.app_store_url' "$CONFIG")
PLAY_STORE_URL=$(jq -r '.mobile.play_store_url' "$CONFIG")
REPO_DOCS_URL=$(jq -r '.repository.docs_url' "$CONFIG")
REPO_ISSUES_URL=$(jq -r '.repository.issues_url' "$CONFIG")
REPO_RELEASES_URL=$(jq -r '.repository.releases_url' "$CONFIG")
EXIT_CODE=0

echo "=== Verifying branding: $NAME ==="

# Files where upstream name must NOT appear in user-facing positions
check_files=(
  "web/src/routes/+layout.svelte"
  "web/src/app.html"
  "web/static/manifest.json"
  "mobile/android/app/src/main/AndroidManifest.xml"
  "mobile/android/app/build.gradle"
  "docs/docusaurus.config.js"
  "open-api/immich-openapi-specs.json"
  "packages/cli/package.json"
  "web/src/lib/modals/HelpAndFeedbackModal.svelte"
  "web/src/lib/modals/ServerAboutModal.svelte"
)

for file in "${check_files[@]}"; do
  filepath="$REPO_ROOT/$file"
  if [[ -f "$filepath" ]]; then
    # Exclude known code-internal patterns (function names, class names, CSS classes)
    matches=$(grep -c "$UPSTREAM_NAME" "$filepath" 2>/dev/null || true)
    allowed=$(grep -cE "(Immich(App|Service|Link)|immich-|bg-immich|getMyImmich|// .*[Ii]mmich)" "$filepath" 2>/dev/null || true)
    if [[ "$matches" -gt 0 && "$matches" -gt "$allowed" ]]; then
      echo "  WARN: '$UPSTREAM_NAME' still found in $file ($matches hits, $allowed allowed)"
      EXIT_CODE=1
    else
      echo "  OK: $file"
    fi
  fi
done

# Check i18n — verify overrides were applied
i18n_file="$REPO_ROOT/i18n/en.json"
overrides_file="$BRANDING_DIR/i18n/overrides-en.json"
if [[ -f "$overrides_file" && -f "$i18n_file" ]]; then
  # Overrides may nest (e.g. admin.* — issue #672), so iterate the override's leaf
  # paths and resolve each as a dot-path in en.json. A top-level-only lookup would
  # return null for nested keys and report a false "patched" for an unbranded value.
  override_count=$(jq '[paths(scalars)] | length' "$overrides_file")
  leaked=0
  while IFS= read -r keypath; do
    value=$(jq -r --arg p "$keypath" 'getpath($p | split(".")) // ""' "$i18n_file")
    if echo "$value" | grep -q "$UPSTREAM_NAME"; then
      echo "  WARN: i18n key '$keypath' still contains '$UPSTREAM_NAME'"
      leaked=$((leaked + 1))
      EXIT_CODE=1
    fi
  done < <(jq -r '[paths(scalars)] | .[] | join(".")' "$overrides_file")
  echo "  i18n: $((override_count - leaked))/$override_count keys patched"

  # Issue #743: the loop above only checks keys that HAVE overrides — a leaking
  # key missing from overrides-en.json passed silently. Scan every string value
  # in the branded en.json so that class can't slip through again.
  en_leaks=0
  while IFS= read -r keypath; do
    [[ -n "$keypath" ]] || continue
    echo "  WARN: i18n key '$keypath' contains '$UPSTREAM_NAME' but has no override in overrides-en.json"
    en_leaks=$((en_leaks + 1))
    EXIT_CODE=1
  done < <(jq -r --arg up "$UPSTREAM_NAME" '
    paths(scalars) as $p
    | select((getpath($p) | type) == "string" and (getpath($p) | contains($up)))
    | ($p | join("."))' "$i18n_file")
  if [[ $en_leaks -eq 0 ]]; then
    echo "  i18n: no unbranded '$UPSTREAM_NAME' values remain in en.json"
  fi

  # Issue #703: the upstream name must not leak through *any* locale for a key
  # the fork rebrands. Non-English locales carry upstream Weblate translations
  # of these keys; patch_i18n() replaces them with a per-locale override where
  # one exists, then rewrites the upstream name in place everywhere else so the
  # translation survives (issue #844). Verify every locale.
  locale_leaks=0
  for locale_file in "$REPO_ROOT"/i18n/*.json; do
    [[ -f "$locale_file" ]] || continue
    lang=$(basename "$locale_file" .json)
    for key in $(jq -r --slurpfile ov "$overrides_file" --arg up "$UPSTREAM_NAME" '
      . as $loc
      | [$ov[0] | paths(scalars) as $p
          | select(($loc | getpath($p)) as $v | ($v | type) == "string" and ($v | contains($up)))
          | $p]
      | .[]
      | join(".")' "$locale_file"); do
      echo "  WARN: i18n locale '$lang' leaks '$UPSTREAM_NAME' in rebranded key '$key'"
      locale_leaks=$((locale_leaks + 1))
      EXIT_CODE=1
    done
  done
  if [[ $locale_leaks -eq 0 ]]; then
    echo "  i18n: no '$UPSTREAM_NAME' leaks across rebranded keys in any locale"
  fi

  # The release sign-off names a PERSON, so none of the brand-name scans above can
  # see it: "Your friend, Alex" contains no upstream product name and passes every
  # one of them. patch_i18n's swap covers the spellings listed in config.json, but
  # upstream gains locales continuously and Weblate translators keep transliterating
  # the name into new scripts — a Georgian "ალექსი" landing in a future rebase would
  # be a spelling the list has never seen.
  #
  # So assert the OUTCOME rather than the substitution: every locale that defines
  # the key must name the fork's author. An unrecognised spelling survives the swap
  # with no "$AUTHOR_NAME" in it and fails here, which turns a silent ship into a red
  # build. Locales that never define the key are skipped — they inherit branded en.
  signoff_leaks=0
  signoff_checked=0
  for locale_file in "$REPO_ROOT"/i18n/*.json; do
    [[ -f "$locale_file" ]] || continue
    lang=$(basename "$locale_file" .json)
    signoff=$(jq -r --arg k "$AUTHOR_SIGNOFF_KEY" '.[$k] // empty' "$locale_file")
    [[ -n "$signoff" ]] || continue
    signoff_checked=$((signoff_checked + 1))
    if ! printf '%s' "$signoff" | grep -qF "$AUTHOR_NAME"; then
      echo "  WARN: i18n locale '$lang' sign-off does not name '$AUTHOR_NAME': '$signoff'"
      echo "        add its spelling of the upstream author to .upstream.author_names in branding/config.json"
      signoff_leaks=$((signoff_leaks + 1))
      EXIT_CODE=1
      continue
    fi
    for upstream_author in "${UPSTREAM_AUTHOR_NAMES[@]}"; do
      if printf '%s' "$signoff" | grep -qF "$upstream_author"; then
        echo "  WARN: i18n locale '$lang' sign-off still contains '$upstream_author': '$signoff'"
        signoff_leaks=$((signoff_leaks + 1))
        EXIT_CODE=1
        break
      fi
    done
  done
  if [[ $signoff_leaks -eq 0 ]]; then
    echo "  i18n: release sign-off names '$AUTHOR_NAME' in all $signoff_checked locales that define it"
  fi
fi

# Check iOS bundle ID
pbxproj="$REPO_ROOT/mobile/ios/Runner.xcodeproj/project.pbxproj"
if [[ -f "$pbxproj" ]]; then
  # Match both the legacy app.alextran.immich prefix and the newer
  # app.futo.immich debug/profile prefix (upstream futo rename) so a stale
  # bundle ID from either era is caught.
  if grep -qE "app\.(alextran|futo)\.immich" "$pbxproj"; then
    echo "  WARN: Old bundle ID still found in project.pbxproj"
    EXIT_CODE=1
  else
    echo "  OK: project.pbxproj"
  fi
fi

# Check iOS signing identity — #29077 moved bundle id / team / app group into
# mobile/ios/Signing.xcconfig (project.pbxproj now references $(IMMICH_*)), so the
# pbxproj check above passes trivially; verify the branded values were written here.
signing_xcconfig="$REPO_ROOT/mobile/ios/Signing.xcconfig"
if [[ -f "$signing_xcconfig" ]]; then
  if grep -qE "app\.(alextran|futo)\.immich|2W7AC6T8T5|group\.app\.immich\.share" "$signing_xcconfig"; then
    echo "  WARN: Upstream signing identity still present in Signing.xcconfig"
    EXIT_CODE=1
  else
    echo "  OK: Signing.xcconfig"
  fi
fi

# Check that hardcoded upstream URLs are patched in user-facing frontend
echo "--- Checking URL replacements ---"

# Files where ALL `github.com/immich-app/immich` references must be patched away
url_check_files=(
  "web/src/lib/components/shared-components/side-bar/ServerStatus.svelte"
  "web/src/lib/modals/VersionAnnouncementModal.svelte"
  "web/src/routes/ErrorLayout.svelte"
  "web/static/.well-known/security.txt"
)

for file in "${url_check_files[@]}"; do
  filepath="$REPO_ROOT/$file"
  if [[ -f "$filepath" ]]; then
    if grep -q "github\.com/immich-app/immich" "$filepath"; then
      echo "  WARN: Upstream GitHub URL still present in $file"
      EXIT_CODE=1
    else
      echo "  OK: $file"
    fi
  fi
done

help_modal="$REPO_ROOT/web/src/lib/modals/HelpAndFeedbackModal.svelte"
if [[ -f "$help_modal" ]]; then
  # Extract content outside BRANDING:UPSTREAM markers
  outside_upstream=$(sed '/BRANDING:UPSTREAM_START/,/BRANDING:UPSTREAM_END/d' "$help_modal")
  if echo "$outside_upstream" | grep -q "github\.com/immich-app/immich"; then
    echo "  WARN: Upstream GitHub URL found outside upstream section in HelpAndFeedbackModal.svelte"
    EXIT_CODE=1
  else
    # Same absent-only weakness as the app-download check below: if upstream restructures
    # these hrefs the Immich pattern vanishes and this passes vacuously. Require the
    # patched-in Noodle URLs to be present too.
    missing=""
    grep -qF "$REPO_DOCS_URL" "$help_modal" || missing="$missing docs"
    grep -qF "$REPO_ISSUES_URL" "$help_modal" || missing="$missing issues"
    if [[ -n "$missing" ]]; then
      echo "  WARN: HelpAndFeedbackModal.svelte is missing Noodle URL(s):$missing"
      echo "        (no upstream URL either — the hrefs likely moved and apply-branding no-opped)"
      EXIT_CODE=1
    else
      echo "  OK: HelpAndFeedbackModal.svelte (URLs patched)"
    fi
  fi
fi

# App download modal (issue #649) — store badges must not point at the Immich apps.
# Noodle has no F-Droid listing, so that badge is replaced with a GitHub link.
app_download_modal="$REPO_ROOT/web/src/lib/modals/AppDownloadModal.svelte"
if [[ -f "$app_download_modal" ]]; then
  if grep -qE "app\.alextran\.immich|app/immich/id1613945652|f-droid\.org|fdroidBadge" "$app_download_modal"; then
    echo "  WARN: Immich store link/F-Droid badge still present in AppDownloadModal.svelte"
    EXIT_CODE=1
  else
    # Absence is not proof of branding. If upstream moves the hrefs out of this file the
    # Immich patterns disappear too, so the check above passes while the branded build
    # still ships upstream's links. Upstream #30527 did exactly that — it replaced the
    # literal URLs with @immich/ui `Constants.Get.*` expressions, silently neutering
    # apply-branding's seds. So also require the Noodle links to actually be here;
    # apply-branding resolves both the literal and the Constants form to literals.
    missing=""
    grep -qF "$PLAY_STORE_URL" "$app_download_modal" || missing="$missing play-store"
    grep -qF "$APP_STORE_URL" "$app_download_modal" || missing="$missing app-store"
    grep -qF "$REPO_RELEASES_URL" "$app_download_modal" || missing="$missing github-releases"
    if [[ -n "$missing" ]]; then
      echo "  WARN: AppDownloadModal.svelte is missing Noodle link(s):$missing"
      echo "        (no Immich links either — the hrefs likely moved and apply-branding no-opped)"
      EXIT_CODE=1
    else
      echo "  OK: AppDownloadModal.svelte (store links patched)"
    fi
  fi
fi

# Check Dockerfiles for upstream repo references
echo "--- Checking Dockerfiles ---"
for dockerfile in "server/Dockerfile" "machine-learning/Dockerfile"; do
  filepath="$REPO_ROOT/$dockerfile"
  if [[ -f "$filepath" ]]; then
    if grep -q "immich-app/immich" "$filepath"; then
      echo "  WARN: Upstream repo reference found in $dockerfile"
      EXIT_CODE=1
    else
      echo "  OK: $dockerfile"
    fi
  fi
done

# Verify Docker env vars are set
env_example="$REPO_ROOT/docker/example.env"
if [[ -f "$env_example" ]]; then
  if grep -q "IMMICH_REPOSITORY=" "$env_example"; then
    echo "  OK: example.env has IMMICH_REPOSITORY"
  else
    echo "  WARN: example.env missing IMMICH_REPOSITORY"
    EXIT_CODE=1
  fi
fi

# Open-in-app scheme registration: web rewrite + Android/iOS dual-scheme
echo "--- Checking open-in-app scheme registration ---"

open_in_app="$REPO_ROOT/web/src/lib/utils/open-in-app.ts"
if [[ -f "$open_in_app" ]]; then
  if grep -q "immich://" "$open_in_app"; then
    echo "  FAIL: open-in-app.ts still contains 'immich://' — branding rewrite did not run"
    EXIT_CODE=1
  elif ! grep -q "${DEEP_LINK_SCHEME}://" "$open_in_app"; then
    echo "  FAIL: open-in-app.ts does not contain '${DEEP_LINK_SCHEME}://'"
    EXIT_CODE=1
  else
    echo "  OK: open-in-app.ts uses ${DEEP_LINK_SCHEME}://"
  fi
else
  echo "  FAIL: open-in-app.ts not found at $open_in_app"
  EXIT_CODE=1
fi

android_manifest="$REPO_ROOT/mobile/android/app/src/main/AndroidManifest.xml"
if [[ -f "$android_manifest" ]]; then
  if ! grep -q "android:scheme=\"immich\"" "$android_manifest"; then
    echo "  FAIL: AndroidManifest.xml missing android:scheme=\"immich\" (legacy scheme must remain)"
    EXIT_CODE=1
  elif ! grep -q "android:scheme=\"${DEEP_LINK_SCHEME}\"" "$android_manifest"; then
    echo "  FAIL: AndroidManifest.xml missing android:scheme=\"${DEEP_LINK_SCHEME}\""
    EXIT_CODE=1
  else
    echo "  OK: AndroidManifest.xml registers both immich and ${DEEP_LINK_SCHEME}"
  fi
fi

info_plist="$REPO_ROOT/mobile/ios/Runner/Info.plist"
if [[ -f "$info_plist" ]]; then
  # CFBundleURLSchemes entries sit at 4-tab indent; anchor to that to avoid matching
  # CFBundleName (<string>${NAME_SLUG}</string>) at 1-tab indent.
  # Use $'\t' ANSI-C quoting for literal tabs — BSD grep (macOS) lacks -P.
  indent=$'\t\t\t\t'
  if ! grep -q "^${indent}<string>immich</string>" "$info_plist"; then
    echo "  FAIL: Info.plist missing <string>immich</string> in CFBundleURLSchemes (legacy scheme must remain)"
    EXIT_CODE=1
  elif ! grep -q "^${indent}<string>${DEEP_LINK_SCHEME}</string>" "$info_plist"; then
    echo "  FAIL: Info.plist missing <string>${DEEP_LINK_SCHEME}</string> in CFBundleURLSchemes"
    EXIT_CODE=1
  else
    echo "  OK: Info.plist CFBundleURLSchemes registers both immich and ${DEEP_LINK_SCHEME}"
  fi
fi

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "Open-in-app scheme registration verified"
fi

# OAuth mobile callback: the scheme the app SENDS, the scheme Android REGISTERS and the
# scheme the server EMITS must all agree, and the legacy app.immich scheme must stay
# registered so existing IdP configs keep working. Drift here silently breaks Android
# OIDC login: the browser lands on a scheme no app claims and dead-ends on a blank page.
echo "--- Checking OAuth mobile callback scheme ---"

oauth_dart="$REPO_ROOT/mobile/lib/services/oauth.service.dart"
android_manifest="$REPO_ROOT/mobile/android/app/src/main/AndroidManifest.xml"
server_constants="$REPO_ROOT/server/src/constants.ts"

if [[ -f "$oauth_dart" ]]; then
  if ! grep -q "kOAuthCallbackUri = '${OAUTH_CALLBACK}'" "$oauth_dart"; then
    echo "  FAIL: oauth.service.dart does not send '${OAUTH_CALLBACK}'"
    EXIT_CODE=1
  else
    echo "  OK: app sends ${OAUTH_CALLBACK}"
  fi
else
  echo "  FAIL: oauth.service.dart not found at $oauth_dart"
  EXIT_CODE=1
fi

if [[ -f "$android_manifest" ]]; then
  # The scheme the app sends MUST be registered, or the callback can never reach the app.
  if ! grep -q "android:scheme=\"${OAUTH_CALLBACK_SCHEME}\" android:pathPrefix=\"/oauth-callback\"" "$android_manifest"; then
    echo "  FAIL: AndroidManifest.xml does not register the scheme the app sends (${OAUTH_CALLBACK_SCHEME}) for /oauth-callback"
    EXIT_CODE=1
  # The legacy scheme must stay registered for backwards compatibility.
  elif ! grep -q "android:scheme=\"app.immich\" android:pathPrefix=\"/oauth-callback\"" "$android_manifest"; then
    echo "  FAIL: AndroidManifest.xml missing android:scheme=\"app.immich\" for /oauth-callback (legacy scheme must remain)"
    EXIT_CODE=1
  # The branded scheme must be registered too, so flipping oauth_callback needs no manifest change.
  elif ! grep -q "android:scheme=\"${BUNDLE_ID}\" android:pathPrefix=\"/oauth-callback\"" "$android_manifest"; then
    echo "  FAIL: AndroidManifest.xml missing android:scheme=\"${BUNDLE_ID}\" for /oauth-callback"
    EXIT_CODE=1
  else
    echo "  OK: AndroidManifest.xml registers both app.immich and ${BUNDLE_ID} for /oauth-callback"
  fi
else
  echo "  FAIL: AndroidManifest.xml not found at $android_manifest"
  EXIT_CODE=1
fi

if [[ -f "$server_constants" ]]; then
  if ! grep -q "MOBILE_REDIRECT = '${OAUTH_CALLBACK}'" "$server_constants"; then
    echo "  FAIL: server MOBILE_REDIRECT is not '${OAUTH_CALLBACK}' — the mobile-redirect override would bounce the browser to a scheme the app does not listen on"
    EXIT_CODE=1
  else
    echo "  OK: server MOBILE_REDIRECT emits ${OAUTH_CALLBACK}"
  fi
else
  echo "  FAIL: constants.ts not found at $server_constants"
  EXIT_CODE=1
fi

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "OAuth mobile callback scheme verified"
fi

# Email/notification templates must not leak upstream branding (issue #636):
# logo image, "Immich" wordmark, app-store badges/links, project credit, subjects.
echo "--- Checking email templates ---"

email_layout="$REPO_ROOT/server/src/emails/components/immich.layout.tsx"
if [[ -f "$email_layout" ]]; then
  if grep -q "immich\.app/img" "$email_layout" || grep -q 'alt="Immich"' "$email_layout"; then
    echo "  WARN: Immich logo/branding still in immich.layout.tsx"
    EXIT_CODE=1
  else
    echo "  OK: immich.layout.tsx"
  fi
fi

email_footer="$REPO_ROOT/server/src/emails/components/footer.template.tsx"
if [[ -f "$email_footer" ]]; then
  if grep -qE "immich\.app|app\.alextran\.immich|apps\.apple\.com/sg/app/immich|>Immich</Link>" "$email_footer"; then
    echo "  WARN: Immich store links/credit still in footer.template.tsx"
    EXIT_CODE=1
  else
    echo "  OK: footer.template.tsx"
  fi
fi

email_test="$REPO_ROOT/server/src/emails/test.email.tsx"
if [[ -f "$email_test" ]]; then
  if grep -qE "test email from Immich|Immich Instance" "$email_test"; then
    echo "  WARN: Immich wordmark still in test.email.tsx"
    EXIT_CODE=1
  else
    echo "  OK: test.email.tsx"
  fi
fi

email_welcome="$REPO_ROOT/server/src/emails/welcome.email.tsx"
if [[ -f "$email_welcome" ]]; then
  if grep -q "a new Immich instance" "$email_welcome"; then
    echo "  WARN: Immich wordmark still in welcome.email.tsx"
    EXIT_CODE=1
  else
    echo "  OK: welcome.email.tsx"
  fi
fi

for notification_svc in \
  "$REPO_ROOT/server/src/services/notification.service.ts" \
  "$REPO_ROOT/server/src/services/notification-admin.service.ts"; do
  if [[ -f "$notification_svc" ]]; then
    if grep -qE "subject: 'Test email from Immich'|subject: 'Welcome to Immich'" "$notification_svc"; then
      echo "  WARN: Immich wordmark still in $(basename "$notification_svc") subjects"
      EXIT_CODE=1
    else
      echo "  OK: $(basename "$notification_svc") subjects"
    fi
  fi
done

echo "--- Checking mobile image assets ---"
if ! bash "$SCRIPT_DIR/verify-mobile-assets.sh"; then
  EXIT_CODE=1
fi

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "=== Branding verification passed ==="
else
  echo "=== Branding verification FAILED — see warnings above ==="
fi

exit $EXIT_CODE
