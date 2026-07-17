#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$BRANDING_DIR")"
CONFIG="$BRANDING_DIR/config.json"

# Read config values
NAME=$(jq -r '.name' "$CONFIG")
NAME_SHORT=$(jq -r '.name_short' "$CONFIG")
NAME_SLUG=$(jq -r '.name_slug' "$CONFIG")
DESCRIPTION=$(jq -r '.description' "$CONFIG")
UPSTREAM_NAME=$(jq -r '.upstream_name' "$CONFIG")

# Mobile
BUNDLE_ID=$(jq -r '.mobile.bundle_id' "$CONFIG")
BUNDLE_ID_DEBUG=$(jq -r '.mobile.bundle_id_debug' "$CONFIG")
BUNDLE_ID_PROFILE=$(jq -r '.mobile.bundle_id_profile' "$CONFIG")
DEEP_LINK_SCHEME=$(jq -r '.mobile.deep_link_scheme' "$CONFIG")
OAUTH_CALLBACK=$(jq -r '.mobile.oauth_callback' "$CONFIG")
# Not read in this file — patch_oauth_callback() uses ${BUNDLE_ID} directly. Exported as a
# global so branding/scripts/test-oauth-callback-branding.sh, which sources this script, can
# use it without recomputing the scheme.
# shellcheck disable=SC2034
OAUTH_CALLBACK_SCHEME="${OAUTH_CALLBACK%%:*}"
SHARED_GROUP=$(jq -r '.mobile.shared_group' "$CONFIG")
BG_TASK_PREFIX=$(jq -r '.mobile.background_task_prefix' "$CONFIG")
APPLE_TEAM_ID=$(jq -r '.mobile.apple_team_id' "$CONFIG")
APP_STORE_URL=$(jq -r '.mobile.app_store_url' "$CONFIG")
PLAY_STORE_URL=$(jq -r '.mobile.play_store_url' "$CONFIG")

# Email — public host that serves the brand logo + store badges in sent mail
EMAIL_ASSET_BASE_URL=$(jq -r '.email.asset_base_url' "$CONFIG")

# Repository
REPO_NAME=$(jq -r '.repository.name' "$CONFIG")
REPO_URL=$(jq -r '.repository.url' "$CONFIG")
REPO_DOCS_URL=$(jq -r '.repository.docs_url' "$CONFIG")
REPO_ISSUES_URL=$(jq -r '.repository.issues_url' "$CONFIG")
REPO_RELEASES_URL=$(jq -r '.repository.releases_url' "$CONFIG")

# Docker
DOCKER_REGISTRY=$(jq -r '.docker.registry' "$CONFIG")
DOCKER_SERVER_IMAGE=$(jq -r '.docker.server_image' "$CONFIG")
DOCKER_ML_IMAGE=$(jq -r '.docker.ml_image' "$CONFIG")

# CLI
CLI_BIN_NAME=$(jq -r '.cli.bin_name' "$CONFIG")

# Docs
DOCS_URL=$(jq -r '.docs.url' "$CONFIG")

# Version — from FORK_VERSION env var (set by CI) or latest git tag
if [[ -n "${FORK_VERSION:-}" ]]; then
  FORK_VERSION="${FORK_VERSION#v}"
else
  FORK_VERSION=$(git -C "$REPO_ROOT" describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null || { git -C "$REPO_ROOT" tag -l 'v*.*.*' --sort=-v:refname 2>/dev/null | head -1; })
  FORK_VERSION="${FORK_VERSION#v}"
fi

#
# --- i18n ---
#
patch_i18n() {
  echo "--- Patching i18n strings ---"
  local i18n_dir="$REPO_ROOT/i18n"
  local en_overrides="$BRANDING_DIR/i18n/overrides-en.json"
  local en_target="$i18n_dir/en.json"
  local tmp

  # 1. Merge English overrides into en.json — the canonical branded fallback
  #    every other locale resolves to for any key it doesn't define.
  if [[ -f "$en_overrides" && -f "$en_target" ]]; then
    tmp=$(mktemp)
    jq -s '.[0] * .[1]' "$en_target" "$en_overrides" > "$tmp"
    chmod 644 "$tmp"
    mv "$tmp" "$en_target"
    echo "  Merged $(jq '[paths(scalars)] | length' "$en_overrides") override keys into en.json"
  fi

  # The non-English locale files (i18n/de.json, fr.json, ...) are upstream
  # Immich translations crowdsourced via Weblate, which the fork doesn't run.
  # They carry their own translations of the keys the fork rebrands, so the
  # upstream name leaks in every translated language (issue #703 — "Immich
  # kaufen") and re-leaks on each Weblate sync. Patch them at build time so the
  # leak can't regress in source:
  #   - merge a per-locale branded override (overrides-<lang>.json) when present
  #     so that language keeps a proper localized translation;
  #   - then drop any remaining overridden key whose localized value still
  #     contains the upstream name, so it falls back to the branded en.json.
  [[ -f "$en_overrides" ]] || return 0

  local locale_file lang lang_overrides
  for locale_file in "$i18n_dir"/*.json; do
    lang="$(basename "$locale_file" .json)"
    [[ "$lang" == "en" ]] && continue

    # 2. Apply a per-locale branded override file when one exists (de, fr, ...).
    lang_overrides="$BRANDING_DIR/i18n/overrides-${lang}.json"
    if [[ -f "$lang_overrides" ]]; then
      tmp=$(mktemp)
      jq -s '.[0] * .[1]' "$locale_file" "$lang_overrides" > "$tmp"
      chmod 644 "$tmp"
      mv "$tmp" "$locale_file"
      echo "  Merged $(jq 'length' "$lang_overrides") override keys into ${lang}.json"
    fi

    # 3. Drop overridden keys that still leak the upstream name -> en fallback.
    #    Overrides may nest (e.g. the admin.* descriptions — issue #672), so walk
    #    the override's leaf paths and delete the leaking ones at any depth rather
    #    than only inspecting top-level keys.
    tmp=$(mktemp)
    jq --slurpfile ov "$en_overrides" --arg upstream "$UPSTREAM_NAME" '
      . as $loc
      | [ $ov[0] | paths(scalars) as $p
          | select(($loc | getpath($p)) as $v
                   | ($v | type) == "string" and ($v | contains($upstream)))
          | $p ]
      | . as $leaking
      | $loc | delpaths($leaking)
    ' "$locale_file" > "$tmp"
    chmod 644 "$tmp"
    mv "$tmp" "$locale_file"
  done
  echo "  Stripped upstream-brand leaks from non-English locales (fallback to en.json)"
}

#
# --- Web ---
#
patch_web() {
  echo "--- Patching web branding ---"

  # Page title in layout
  sed -i "s/- Immich<\/title>/- ${NAME}<\/title>/g" \
    "$REPO_ROOT/web/src/routes/+layout.svelte"

  # Noscript fallback in app.html
  sed -i "s/To use Immich,/To use ${NAME},/g" \
    "$REPO_ROOT/web/src/app.html"

  # manifest.json
  local manifest="$REPO_ROOT/web/static/manifest.json"
  if [[ -f "$manifest" ]]; then
    local tmp
    tmp=$(mktemp)
    jq --arg name "$NAME" --arg short "$NAME_SHORT" --arg desc "$DESCRIPTION" \
      '.name = $name | .short_name = $short | .description = $desc' \
      "$manifest" > "$tmp"
    chmod 644 "$tmp"
    mv "$tmp" "$manifest"
    echo "  Patched manifest.json"
  fi

  # About modal — hardcoded product name
  local about_modal="$REPO_ROOT/web/src/lib/modals/ServerAboutModal.svelte"
  if [[ -f "$about_modal" ]]; then
    sed -i "s/title=\"Immich\"/title=\"${NAME}\"/g" "$about_modal"
    echo "  Patched ServerAboutModal.svelte"
  fi

  # Server status — hardcoded repo check and release URL
  local server_status="$REPO_ROOT/web/src/lib/components/shared-components/side-bar/ServerStatus.svelte"
  if [[ -f "$server_status" ]]; then
    sed -i "s|info\.repository === 'immich-app/immich'|info.repository === '${REPO_NAME}'|g" "$server_status"
    sed -i "s|https://github\.com/immich-app/immich/releases/tag/|${REPO_URL}/releases/tag/|g" "$server_status"
    echo "  Patched server-status.svelte"
  fi

  # Version announcement modal — hardcoded "latest releases" link in major/minor update popup
  local version_modal="$REPO_ROOT/web/src/lib/modals/VersionAnnouncementModal.svelte"
  if [[ -f "$version_modal" ]]; then
    sed -i "s|https://github\.com/immich-app/immich/releases/latest|${REPO_URL}/releases/latest|g" "$version_modal"
    echo "  Patched VersionAnnouncementModal.svelte"
  fi

  # Error layout — hardcoded "releases" link on the error page
  local error_layout="$REPO_ROOT/web/src/routes/ErrorLayout.svelte"
  if [[ -f "$error_layout" ]]; then
    sed -i "s|https://github\.com/immich-app/immich/releases|${REPO_URL}/releases|g" "$error_layout"
    echo "  Patched ErrorLayout.svelte"
  fi

  # security.txt — upstream GitHub URLs (Policy / Contact advisories / old SECURITY.md) and "Immich instance" comments.
  # Rewrite ANY immich-app/immich GitHub URL to the fork's repo, preserving the path/query suffix, so upstream
  # reshuffling the security.txt links (e.g. #29940 switched Policy to ?tab=security-ov-file and added an
  # advisories Contact) can't leak an upstream URL past verify-branding.
  local security_txt="$REPO_ROOT/web/static/.well-known/security.txt"
  if [[ -f "$security_txt" ]]; then
    sed -i "s|https://github\.com/immich-app/immich|${REPO_URL}|g" "$security_txt"
    sed -i "s|running an Immich instance|running a ${NAME} instance|g" "$security_txt"
    sed -i "s|Immich-related security problems should be reported to the Immich security team|${NAME}-related security problems should be reported to the ${NAME} security team|g" "$security_txt"
    echo "  Patched security.txt"
  fi

  # Open-in-app deep-link scheme — rewrite immich:// to ${DEEP_LINK_SCHEME}://
  local open_in_app="$REPO_ROOT/web/src/lib/utils/open-in-app.ts"
  if [[ -f "$open_in_app" ]]; then
    sed -i "s|immich://|${DEEP_LINK_SCHEME}://|g" "$open_in_app"
    echo "  Patched open-in-app.ts"
  fi

  # OpenAPI spec
  local openapi="$REPO_ROOT/open-api/immich-openapi-specs.json"
  if [[ -f "$openapi" ]]; then
    local tmp
    tmp=$(mktemp)
    jq --arg name "$NAME" --arg desc "${NAME} API" \
      '.info.title = $name | .info.description = $desc' \
      "$openapi" > "$tmp"
    chmod 644 "$tmp"
    mv "$tmp" "$openapi"
    # Replace remaining user-facing "Immich" in API descriptions
    sed -i "s/Immich/${NAME}/g" "$openapi"
    echo "  Patched OpenAPI spec"
  fi
}

#
# --- App download modal ---
#
# The "App download links" modal (Tools menu + onboarding) hardcodes the upstream
# Immich Play Store, App Store, and F-Droid badges (issue #649). Repoint the two
# store badges to the Noodle Gallery apps. Noodle Gallery is not published on
# F-Droid, so that badge is replaced with a link to the GitHub releases page.
patch_app_download_modal() {
  echo "--- Patching app download modal ---"
  local modal="$REPO_ROOT/web/src/lib/modals/AppDownloadModal.svelte"
  [[ -f "$modal" ]] || return 0

  # Repoint the Play Store + App Store badges to the Noodle Gallery apps.
  sed -i "s|https://play\.google\.com/store/apps/details?id=app\.alextran\.immich|${PLAY_STORE_URL}|g" "$modal"
  sed -i "s|https://apps\.apple\.com/us/app/immich/id1613945652|${APP_STORE_URL}|g" "$modal"

  # Replace the F-Droid badge (no Noodle F-Droid app) with a GitHub releases
  # link. Mirrors patch_help_modal's awk block-rewrite: swap the <a id="fdroid-link">
  # ...</a> anchor for a text link styled like the adjacent Obtainium link.
  local tmp
  tmp=$(mktemp)
  awk -v url="$REPO_RELEASES_URL" '
    /id="fdroid-link"/ { skip = 1 }
    skip && /<\/a>/ {
      skip = 0
      print "    <a"
      print "      href=\"" url "\""
      print "      target=\"_blank\""
      print "      rel=\"noreferrer\""
      print "      id=\"github-release-link\""
      print "      class=\"mt-2 text-center underline text-sm immich-form-label\""
      print "    >"
      print "      Get it on GitHub"
      print "    </a>"
      next
    }
    skip { next }
    { print }
  ' "$modal" > "$tmp"
  chmod 644 "$tmp"
  mv "$tmp" "$modal"

  # fdroidBadge import is now unused — drop it to keep the build lint-clean
  # regardless of where it sits in the destructured import list.
  sed -i "s/, fdroidBadge//g; s/fdroidBadge, //g" "$modal"

  echo "  Patched AppDownloadModal.svelte"
}

#
# --- Emails ---
#
# The notification/email templates (server/src/emails) hardcode upstream Immich
# branding that the system-config UI can't fully override: the logo image, the
# "Immich" wordmark, the app-store badges + links, the project credit, and the
# default subject lines. Rewrite them to Noodle Gallery so sent mail is branded.
patch_emails() {
  echo "--- Patching email templates ---"

  local emails="$REPO_ROOT/server/src/emails"
  local layout="$emails/components/immich.layout.tsx"
  local footer="$emails/components/footer.template.tsx"
  local test_email="$emails/test.email.tsx"
  local welcome_email="$emails/welcome.email.tsx"
  local notification="$REPO_ROOT/server/src/services/notification.service.ts"
  local notification_admin="$REPO_ROOT/server/src/services/notification-admin.service.ts"

  # Shared layout — brand logo image + alt text
  if [[ -f "$layout" ]]; then
    sed -i "s|https://immich\.app/img/immich-logo-inline-light\.png|${EMAIL_ASSET_BASE_URL}/immich-logo-inline-light.png|g" "$layout"
    sed -i "s|alt=\"Immich\"|alt=\"${NAME}\"|g" "$layout"
    echo "  Patched immich.layout.tsx"
  fi

  # Footer — store badges (link + image) and the project credit line
  if [[ -f "$footer" ]]; then
    sed -i "s|https://play\.google\.com/store/apps/details?id=app\.alextran\.immich|${PLAY_STORE_URL}|g" "$footer"
    sed -i "s|https://immich\.app/img/google-play-badge\.png|${EMAIL_ASSET_BASE_URL}/google-play-badge.png|g" "$footer"
    sed -i "s|https://apps\.apple\.com/sg/app/immich/id1613945652|${APP_STORE_URL}|g" "$footer"
    sed -i "s|https://immich\.app/img/ios-app-store-badge\.png|${EMAIL_ASSET_BASE_URL}/ios-app-store-badge.png|g" "$footer"
    sed -i "s|<Link href=\"https://immich\.app\">Immich</Link>|<Link href=\"${REPO_URL}\">${NAME}</Link>|g" "$footer"
    echo "  Patched footer.template.tsx"
  fi

  # Test email — preview + body copy
  if [[ -f "$test_email" ]]; then
    sed -i "s|This is a test email from Immich\.|This is a test email from ${NAME}.|g" "$test_email"
    sed -i "s|This is a test email from your Immich Instance!|This is a test email from your ${NAME} Instance!|g" "$test_email"
    echo "  Patched test.email.tsx"
  fi

  # Welcome email — preview copy
  if [[ -f "$welcome_email" ]]; then
    sed -i "s|You have been invited to a new Immich instance\.|You have been invited to a new ${NAME} instance.|g" "$welcome_email"
    echo "  Patched welcome.email.tsx"
  fi

  # Notification service — default email subject lines
  if [[ -f "$notification" ]]; then
    sed -i "s|subject: 'Test email from Immich'|subject: 'Test email from ${NAME}'|g" "$notification"
    sed -i "s|subject: 'Welcome to Immich'|subject: 'Welcome to ${NAME}'|g" "$notification"
    echo "  Patched notification.service.ts subjects"
  fi

  # Admin notification service — "Send test email" subject
  if [[ -f "$notification_admin" ]]; then
    sed -i "s|subject: 'Test email from Immich'|subject: 'Test email from ${NAME}'|g" "$notification_admin"
    echo "  Patched notification-admin.service.ts subject"
  fi
}

#
# --- Help Modal ---
#
patch_help_modal() {
  echo "--- Patching help modal URLs ---"
  local help_modal="$REPO_ROOT/web/src/lib/modals/HelpAndFeedbackModal.svelte"

  # Replace docs URL (backtick template literal → plain string)
  # Matching literal ${info.version} in Svelte template, not a shell variable
  # shellcheck disable=SC2016
  sed -i 's|`https://docs\.\${info\.version}\.archive\.immich\.app/overview/introduction`|'"'${REPO_DOCS_URL}'"'|g' "$help_modal"

  # Replace bugs/issues URL (only appears once, outside upstream section)
  sed -i "s|https://github\.com/immich-app/immich/issues/new/choose|${REPO_ISSUES_URL}|g" "$help_modal"

  # Replace primary source URL (with trailing slash — upstream section has no trailing slash)
  sed -i "s|https://github\.com/immich-app/immich/|${REPO_URL}|" "$help_modal"

  # Remove Discord link from primary section (outside BRANDING:UPSTREAM markers)
  local tmp
  tmp=$(mktemp)
  awk 'BEGIN{u=0} /BRANDING:UPSTREAM_START/{u=1} /BRANDING:UPSTREAM_END/{u=0; print; next} u==0 && /discord\.immich\.app/{next} {print}' "$help_modal" > "$tmp"
  chmod 644 "$tmp"
  mv "$tmp" "$help_modal"

  echo "  Patched HelpAndFeedbackModal.svelte"
}

#
# --- Assets ---
#
patch_assets() {
  echo "--- Overlaying brand assets ---"
  local assets="$BRANDING_DIR/assets"

  copy_if_exists() {
    local src="$1"
    shift
    if [[ -f "$src" ]]; then
      for dest in "$@"; do
        cp "$src" "$dest"
        echo "  $src -> $dest"
      done
    fi
  }

  # Favicons
  copy_if_exists "$assets/favicon.ico" \
    "$REPO_ROOT/web/static/favicon.ico" \
    "$REPO_ROOT/docs/static/img/favicon.ico"

  copy_if_exists "$assets/favicon.png" \
    "$REPO_ROOT/web/static/favicon.png" \
    "$REPO_ROOT/web/static/apple-icon-180.png" \
    "$REPO_ROOT/docs/static/img/favicon.png"

  # Sized favicons (generated from favicon.png if convert is available)
  if command -v convert &>/dev/null && [[ -f "$assets/favicon.png" ]]; then
    for size in 16 32 48 96 144; do
      convert "$assets/favicon.png" -resize "${size}x${size}" \
        "$REPO_ROOT/web/static/favicon-${size}.png"
    done
    echo "  Generated sized favicons"
  fi

  # PWA manifest icons
  copy_if_exists "$assets/app-icon.png" \
    "$REPO_ROOT/web/static/manifest-icon-192.maskable.png" \
    "$REPO_ROOT/web/static/manifest-icon-512.maskable.png"

  # Logo variants for web, docs, design, mobile
  copy_if_exists "$assets/logo-inline-light.svg" \
    "$REPO_ROOT/design/gallery-logo-inline-light.svg" \
    "$REPO_ROOT/docs/static/img/immich-logo-inline-light.svg" \
    "$REPO_ROOT/mobile/assets/immich-logo-inline-light.svg"

  copy_if_exists "$assets/logo-inline-light.png" \
    "$REPO_ROOT/design/gallery-logo-inline-light.png" \
    "$REPO_ROOT/docs/static/img/immich-logo-inline-light.png" \
    "$REPO_ROOT/mobile/assets/immich-logo-inline-light.png"

  copy_if_exists "$assets/logo-inline-dark.svg" \
    "$REPO_ROOT/design/gallery-logo-inline-dark.svg" \
    "$REPO_ROOT/docs/static/img/immich-logo-inline-dark.svg" \
    "$REPO_ROOT/mobile/assets/immich-logo-inline-dark.svg"

  copy_if_exists "$assets/logo-inline-dark.png" \
    "$REPO_ROOT/design/gallery-logo-inline-dark.png" \
    "$REPO_ROOT/docs/static/img/immich-logo-inline-dark.png" \
    "$REPO_ROOT/mobile/assets/immich-logo-inline-dark.png"

  copy_if_exists "$assets/logo-stacked-light.svg" \
    "$REPO_ROOT/design/gallery-logo-stacked-light.svg" \
    "$REPO_ROOT/docs/static/img/immich-logo-stacked-light.svg"

  copy_if_exists "$assets/logo-stacked-light.png" \
    "$REPO_ROOT/design/gallery-logo-stacked-light.png" \
    "$REPO_ROOT/docs/static/img/immich-logo-stacked-light.png"

  copy_if_exists "$assets/logo-stacked-dark.svg" \
    "$REPO_ROOT/design/gallery-logo-stacked-dark.svg" \
    "$REPO_ROOT/docs/static/img/immich-logo-stacked-dark.svg"

  copy_if_exists "$assets/logo-stacked-dark.png" \
    "$REPO_ROOT/design/gallery-logo-stacked-dark.png" \
    "$REPO_ROOT/docs/static/img/immich-logo-stacked-dark.png"

  # Mobile logo assets
  #
  # immich-logo.png is the IN-APP rotating logo (login form, splash screen,
  # profile avatar fallback, album fallback thumbnail) and must be transparent
  # so it composites onto the surrounding card/scaffold background. The
  # immich-logo-w-bg variants are the launcher icon sources. Android and iOS
  # use different safe-area rules, so keep the Android-padded launcher source
  # separate from the larger opaque iOS source.
  #
  # Two source files in branding/assets/ keep these requirements separate:
  #   app-icon-transparent.png → in-app logo (transparent camera mark)
  #   app-icon.png             → Android/PWA launcher icon (opaque, padded)
  #   app-icon-ios.png         → iOS launcher icon (opaque, larger mark)
  copy_if_exists "$assets/app-icon-transparent.png" \
    "$REPO_ROOT/mobile/assets/immich-logo.png"

  local ios_icon_src="$assets/app-icon-ios.png"
  if [[ ! -f "$ios_icon_src" ]]; then
    ios_icon_src="$assets/app-icon.png"
  fi

  copy_if_exists "$ios_icon_src" \
    "$REPO_ROOT/mobile/assets/immich-logo-w-bg.png"

  copy_if_exists "$assets/app-icon.png" \
    "$REPO_ROOT/mobile/assets/immich-logo-w-bg-android.png" \
    "$REPO_ROOT/docs/static/img/color-logo.png"

  copy_if_exists "$assets/splash.png" \
    "$REPO_ROOT/mobile/assets/immich-splash.png"

  local android12_splash_src="$assets/splash-android12.png"
  if [[ ! -f "$android12_splash_src" ]]; then
    android12_splash_src="$assets/splash.png"
  fi

  copy_if_exists "$android12_splash_src" \
    "$REPO_ROOT/mobile/assets/immich-splash-android12.png"

  resize_android12_splash() {
    local dest="$1"
    local size="$2"
    if [[ -f "$android12_splash_src" ]]; then
      if command -v convert &>/dev/null; then
        convert "$android12_splash_src" -resize "${size}x${size}" "$dest"
      elif command -v magick &>/dev/null; then
        magick "$android12_splash_src" -resize "${size}x${size}" "$dest"
      else
        echo "  ERROR: ImageMagick convert or magick is required to resize Android 12 splash assets"
        return 1
      fi
      echo "  $android12_splash_src -> $dest (${size}x${size})"
    fi
  }

  # Android drawable resources (all density buckets)
  for density in hdpi mdpi xhdpi xxhdpi xxxhdpi; do
    local res_dir="$REPO_ROOT/mobile/android/app/src/main/res/drawable-${density}"
    copy_if_exists "$assets/splash.png" "$res_dir/splash.png"
    local android12_size
    case "$density" in
      mdpi) android12_size=288 ;;
      hdpi) android12_size=432 ;;
      xhdpi) android12_size=576 ;;
      xxhdpi) android12_size=864 ;;
      xxxhdpi) android12_size=1152 ;;
    esac
    resize_android12_splash "$res_dir/android12splash.png" "$android12_size"
    copy_if_exists "$assets/notification-icon.png" "$res_dir/notification_icon.png"

    # Night variants
    local night_dir="$REPO_ROOT/mobile/android/app/src/main/res/drawable-night-${density}"
    if [[ -d "$night_dir" ]]; then
      copy_if_exists "$assets/splash.png" "$night_dir/splash.png"
      resize_android12_splash "$night_dir/android12splash.png" "$android12_size"
    fi
  done

  # Android mipmap launcher icons
  for density in hdpi mdpi xhdpi xxhdpi xxxhdpi; do
    copy_if_exists "$assets/app-icon.png" \
      "$REPO_ROOT/mobile/android/app/src/main/res/mipmap-${density}/ic_launcher.png"
  done

  # Android adaptive icon foreground
  copy_if_exists "$assets/app-icon-adaptive-fg.png" \
    "$REPO_ROOT/mobile/assets/immich-logo-android-adaptive-icon.png"

  # Android adaptive icon drawables (referenced by mipmap-anydpi-v26/ic_launcher.xml)
  copy_if_exists "$assets/mobile/android/ic_launcher_foreground.png" \
    "$REPO_ROOT/mobile/android/app/src/main/res/drawable/ic_launcher_foreground.png"
  copy_if_exists "$assets/mobile/android/ic_launcher_monochrome.png" \
    "$REPO_ROOT/mobile/android/app/src/main/res/drawable/ic_launcher_monochrome.png"

  # Mobile in-app wordmark (camera + "gallery" text shown in app bar dialog)
  copy_if_exists "$assets/mobile/wordmark-light.png" \
    "$REPO_ROOT/mobile/assets/immich-text-light.png"
  copy_if_exists "$assets/mobile/wordmark-dark.png" \
    "$REPO_ROOT/mobile/assets/immich-text-dark.png"

  # iOS launcher icons (AppIcon.appiconset) — Apple-required size matrix.
  # Each PNG is shipped pre-rendered at the correct size in branding/assets/
  # because the original app-icon.png renders are not bit-identical via simple
  # ImageMagick resize, and Apple is strict about icon quality.
  local ios_appicon_src="$assets/mobile/ios/AppIcon"
  local ios_appicon_dest="$REPO_ROOT/mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset"
  if [[ -d "$ios_appicon_src" && -d "$ios_appicon_dest" ]]; then
    for size in 16 20 29 32 40 48 50 55 57 58 60 64 66 72 76 80 87 88 92 100 102 114 120 128 144 152 167 172 180 196 216 256 512 1024; do
      copy_if_exists "$ios_appicon_src/${size}.png" "$ios_appicon_dest/${size}.png"
    done
  fi

  # iOS launch screen image (rotated camera mark on launch storyboard)
  local ios_launchimg_src="$assets/mobile/ios/LaunchImage"
  local ios_launchimg_dest="$REPO_ROOT/mobile/ios/Runner/Assets.xcassets/LaunchImage.imageset"
  if [[ -d "$ios_launchimg_src" && -d "$ios_launchimg_dest" ]]; then
    for variant in LaunchImage LaunchImage@2x LaunchImage@3x; do
      copy_if_exists "$ios_launchimg_src/${variant}.png" "$ios_launchimg_dest/${variant}.png"
    done
  fi

  # iOS launch screen background (1×1 PNGs stretched to fill the storyboard)
  local ios_launchbg_src="$assets/mobile/ios/LaunchBackground"
  local ios_launchbg_dest="$REPO_ROOT/mobile/ios/Runner/Assets.xcassets/LaunchBackground.imageset"
  if [[ -d "$ios_launchbg_src" && -d "$ios_launchbg_dest" ]]; then
    copy_if_exists "$ios_launchbg_src/background.png" "$ios_launchbg_dest/background.png"
    copy_if_exists "$ios_launchbg_src/darkbackground.png" "$ios_launchbg_dest/darkbackground.png"
  fi

  # Docs assets
  copy_if_exists "$assets/logo-mark.svg" \
    "$REPO_ROOT/docs/static/img/immich-logo.svg"
}

#
# --- OAuth mobile callback ---
#
# OAuth mobile callback scheme. The invariant, in one place:
#   the URI the app SENDS (oauth.service.dart)
#     == the URI the server EMITS (constants.ts MOBILE_REDIRECT, used by /api/oauth/mobile-redirect)
#     == a scheme Android REGISTERS (AndroidManifest.xml)
#     == the URI shown to admins (AuthSettings.svelte)
# Breaking that invariant is invisible in dev (dev builds aren't branded, so both halves
# agree) and fatal in release: the browser lands on a scheme no app claims and hangs on a
# blank page. verify-branding.sh and test-oauth-callback-branding.sh both enforce it.
#
# The manifest registration is ADDITIVE — app.immich must stay registered because every
# existing IdP config in the wild has app.immich:///oauth-callback as its redirect URI.
patch_oauth_callback() {
  local oauth_dart="$REPO_ROOT/mobile/lib/services/oauth.service.dart"
  local manifest="$REPO_ROOT/mobile/android/app/src/main/AndroidManifest.xml"
  local server_constants="$REPO_ROOT/server/src/constants.ts"
  local auth_settings="$REPO_ROOT/web/src/routes/admin/system-settings/AuthSettings.svelte"

  # The redirect URI the app asks the IdP to send the user back to.
  if [[ -f "$oauth_dart" ]]; then
    sed -i "s|kOAuthCallbackUri = 'app\.immich:///oauth-callback'|kOAuthCallbackUri = '${OAUTH_CALLBACK}'|g" "$oauth_dart"
  fi

  # Register the branded scheme ALONGSIDE app.immich (idempotent, mirrors the deep-link block).
  if [[ -f "$manifest" ]] && ! grep -q "android:scheme=\"${BUNDLE_ID}\" android:pathPrefix=\"/oauth-callback\"" "$manifest"; then
    sed -i "/<data android:scheme=\"app\.immich\" android:pathPrefix=\"\/oauth-callback\" \/>/a\\        <data android:scheme=\"${BUNDLE_ID}\" android:pathPrefix=\"/oauth-callback\" />" "$manifest"
  fi

  # Where /api/oauth/mobile-redirect bounces the browser to. Must equal what the app sends.
  if [[ -f "$server_constants" ]]; then
    sed -i "s|MOBILE_REDIRECT = 'app\.immich:///oauth-callback'|MOBILE_REDIRECT = '${OAUTH_CALLBACK}'|g" "$server_constants"
  fi

  # The callback URI admins copy into their IdP.
  if [[ -f "$auth_settings" ]]; then
    sed -i "s|callback: 'app\.immich:///oauth-callback'|callback: '${OAUTH_CALLBACK}'|g" "$auth_settings"
  fi

  echo "  Patched OAuth callback scheme (${OAUTH_CALLBACK})"
}

#
# --- Android ---
#
patch_android() {
  echo "--- Patching Android configs ---"

  local build_gradle="$REPO_ROOT/mobile/android/app/build.gradle"
  local manifest="$REPO_ROOT/mobile/android/app/src/main/AndroidManifest.xml"

  # build.gradle — applicationId and namespace
  sed -i "s/applicationId \"app\.alextran\.immich\"/applicationId \"${BUNDLE_ID}\"/g" "$build_gradle"
  sed -i "s/namespace \"app\.alextran\.immich\"/namespace \"${BUNDLE_ID}\"/g" "$build_gradle"

  # AndroidManifest.xml — app label
  sed -i "s/android:label=\"Immich\"/android:label=\"${NAME}\"/g" "$manifest"

  # AndroidManifest.xml — view-intent filter labels + comments (upstream #26109 gallery/viewer)
  sed -i "s/android:label=\"View in Immich\"/android:label=\"View in ${NAME}\"/g" "$manifest"
  sed -i "s/<!-- Allow Immich to act as/<!-- Allow ${NAME} to act as/g" "$manifest"

  # AndroidManifest.xml — register branded deep link scheme alongside immich:// (additive, idempotent)
  if ! grep -q "android:scheme=\"${DEEP_LINK_SCHEME}\"" "$manifest"; then
    sed -i "/        <data android:scheme=\"immich\" \/>/a\\        <data android:scheme=\"${DEEP_LINK_SCHEME}\" />" "$manifest"
  fi

  # AndroidManifest.xml — deep link host
  sed -i "s|android:host=\"my\.immich\.app\"|android:host=\"my.noodle.gallery\"|g" "$manifest"

  # AndroidManifest.xml — share intent labels
  sed -i "s/Upload to Immich/Upload to ${NAME}/g" "$manifest"

  echo "  Patched build.gradle and AndroidManifest.xml"
}

#
# --- iOS ---
#
patch_ios() {
  echo "--- Patching iOS configs ---"

  local pbxproj="$REPO_ROOT/mobile/ios/Runner.xcodeproj/project.pbxproj"
  local info_plist="$REPO_ROOT/mobile/ios/Runner/Info.plist"

  # project.pbxproj — bundle identifiers.
  #
  # Debug + profile targets: upstream (futo rename) moved these from
  # app.alextran.immich.vdebug / app.alextran.immich.profile to
  # app.futo.immich.debug / app.futo.immich.profile, and reordered the suffix so
  # the Widget/ShareExtension debug+profile targets are now app.futo.immich.debug.Widget
  # / app.futo.immich.profile.ShareExtension etc. A single bare prefix swap covers
  # every variant because the .Widget / .ShareExtension suffix is preserved after
  # the prefix is replaced.
  sed -i "s/app\.futo\.immich\.debug/${BUNDLE_ID_DEBUG}/g" "$pbxproj"
  sed -i "s/app\.futo\.immich\.profile/${BUNDLE_ID_PROFILE}/g" "$pbxproj"
  # Release Widget + ShareExtension targets still use app.alextran.immich.*
  sed -i "s/app\.alextran\.immich\.Widget/${BUNDLE_ID}.Widget/g" "$pbxproj"
  sed -i "s/app\.alextran\.immich\.ShareExtension/${BUNDLE_ID}.ShareExtension/g" "$pbxproj"
  # Main bundle ID last (most general pattern)
  sed -i "s/app\.alextran\.immich/${BUNDLE_ID}/g" "$pbxproj"

  # project.pbxproj — product names
  sed -i "s/PRODUCT_NAME = \"Immich-Debug\"/PRODUCT_NAME = \"${NAME}-Debug\"/g" "$pbxproj"
  sed -i "s/PRODUCT_NAME = \"Immich-Profile\"/PRODUCT_NAME = \"${NAME}-Profile\"/g" "$pbxproj"
  sed -i "s/PRODUCT_NAME = Immich/PRODUCT_NAME = \"${NAME}\"/g" "$pbxproj"

  # project.pbxproj — development team
  if [[ -n "${APPLE_TEAM_ID:-}" && "$APPLE_TEAM_ID" != "null" ]]; then
    sed -i "s/DEVELOPMENT_TEAM = [A-Z0-9]*;/DEVELOPMENT_TEAM = ${APPLE_TEAM_ID};/g" "$pbxproj"
  fi

  # Info.plist — bundle name
  sed -i "s|<string>immich_mobile</string>|<string>${NAME_SLUG}</string>|g" "$info_plist"

  # Info.plist — register branded URL scheme alongside immich:// (additive, idempotent)
  # The CFBundleURLSchemes <string>immich</string> entry sits at 4-tab indent inside
  # CFBundleURLTypes; CFBundleName (also <string>${NAME_SLUG}</string>) is at 1-tab indent,
  # so we anchor the idempotency check to the 4-tab prefix to avoid a false-positive when
  # NAME_SLUG happens to equal DEEP_LINK_SCHEME. Use $'\t' ANSI-C quoting for literal
  # tabs — BSD grep (macOS) lacks -P.
  local indent=$'\t\t\t\t'
  if ! grep -q "^${indent}<string>${DEEP_LINK_SCHEME}</string>" "$info_plist"; then
    sed -i $'/\t\t\t\t<string>immich<\\/string>/a\\\n\t\t\t\t<string>'"${DEEP_LINK_SCHEME}"$'<\\/string>' "$info_plist"
  fi

  # Info.plist — background task identifiers
  sed -i "s/app\.alextran\.immich\.background/${BG_TASK_PREFIX}/g" "$info_plist"
  sed -i "s/app\.alextran\.immich\.backgroundFetch/${BUNDLE_ID}.backgroundFetch/g" "$info_plist"
  sed -i "s/app\.alextran\.immich\.backgroundProcessing/${BUNDLE_ID}.backgroundProcessing/g" "$info_plist"

  # Shared app group — patch entitlements in all targets
  local entitlements
  for entitlements in "$REPO_ROOT"/mobile/ios/Runner/*.entitlements \
                      "$REPO_ROOT"/mobile/ios/ShareExtension/*.entitlements \
                      "$REPO_ROOT"/mobile/ios/WidgetExtension/*.entitlements; do
    if [[ -f "$entitlements" ]]; then
      sed -i "s/group\.app\.immich\.share/${SHARED_GROUP}/g" "$entitlements"
    fi
  done

  # Shared app group in project.pbxproj (CUSTOM_GROUP_ID)
  sed -i "s/group\.app\.immich\.share/${SHARED_GROUP}/g" "$pbxproj"

  # Hardcoded app group in Swift source files
  local swift_file
  for swift_file in "$REPO_ROOT/mobile/ios/Runner/Core/URLSessionManager.swift" \
                    "$REPO_ROOT/mobile/ios/WidgetExtension/ImmichAPI.swift"; do
    if [[ -f "$swift_file" ]]; then
      sed -i "s/group\.app\.immich\.share/${SHARED_GROUP}/g" "$swift_file"
    fi
  done

  # Fastlane — Appfile
  local appfile="$REPO_ROOT/mobile/ios/fastlane/Appfile"
  if [[ -f "$appfile" ]]; then
    sed -i "s/app_identifier \"app\.alextran\.immich\"/app_identifier \"${BUNDLE_ID}\"/g" "$appfile"
    sed -i "/apple_id/d" "$appfile"
  fi

  # Fastlane — Fastfile constants
  local fastfile="$REPO_ROOT/mobile/ios/fastlane/Fastfile"
  if [[ -f "$fastfile" ]]; then
    sed -i "s/TEAM_ID = \"2F67MQ8R79\"/TEAM_ID = ENV[\"FASTLANE_TEAM_ID\"] || \"${APPLE_TEAM_ID}\"/g" "$fastfile"
    sed -i "s/CODE_SIGN_IDENTITY = \"Apple Distribution: Hau Tran (#{TEAM_ID})\"/CODE_SIGN_IDENTITY = \"Apple Distribution: David Pierre Marais (#{TEAM_ID})\"/g" "$fastfile"
    sed -i "s/BASE_BUNDLE_ID = \"app\.alextran\.immich\"/BASE_BUNDLE_ID = \"${BUNDLE_ID}\"/g" "$fastfile"
  fi

  echo "  Patched project.pbxproj, Info.plist, entitlements, Swift sources, and Fastlane"
}

#
# --- Docker ---
#
patch_docker() {
  echo "--- Patching Docker configs ---"

  local compose_dir="$REPO_ROOT/docker"
  for f in "$compose_dir"/docker-compose*.yml; do
    if [[ -f "$f" ]]; then
      # Replace upstream image references
      sed -i "s|ghcr\.io/immich-app/immich-server|${DOCKER_REGISTRY}/${DOCKER_SERVER_IMAGE}|g" "$f"
      sed -i "s|ghcr\.io/immich-app/immich-machine-learning|${DOCKER_REGISTRY}/${DOCKER_ML_IMAGE}|g" "$f"
      # Replace upstream repo references in environment variables
      sed -i "s|immich-app/immich|${REPO_NAME}|g" "$f"
      echo "  Patched $(basename "$f")"
    fi
  done

  # Append branding env vars to example.env
  local env_example="$REPO_ROOT/docker/example.env"
  if [[ -f "$env_example" ]]; then
    cat >> "$env_example" <<EOF

# ${NAME} branding
IMMICH_REPOSITORY=${REPO_NAME}
IMMICH_REPOSITORY_URL=${REPO_URL}
EOF
    echo "  Added branding env vars to example.env"
  fi
}

#
# --- CLI ---
#
patch_cli() {
  echo "--- Patching CLI ---"

  local cli_pkg="$REPO_ROOT/packages/cli/package.json"
  if [[ -f "$cli_pkg" ]]; then
    local tmp
    tmp=$(mktemp)
    jq --arg bin "$CLI_BIN_NAME" \
      '.bin = { ($bin): "./bin/immich" } | .description = "Command Line Interface (CLI) for Noodle Gallery"' \
      "$cli_pkg" > "$tmp"
    chmod 644 "$tmp"
    mv "$tmp" "$cli_pkg"
    echo "  Patched cli/package.json bin name"
  fi
}

#
# --- Docs ---
#
patch_docs() {
  echo "--- Patching documentation ---"

  local docusaurus="$REPO_ROOT/docs/docusaurus.config.js"
  if [[ -f "$docusaurus" ]]; then
    sed -i "s/title: 'Immich'/title: '${NAME}'/g" "$docusaurus"
    sed -i "s|url: 'https://docs\.immich\.app'|url: '${DOCS_URL}'|g" "$docusaurus"
    # Replace remaining user-facing "Immich" references (navbar, footer, etc.)
    sed -i "s/Immich/${NAME}/g" "$docusaurus"
    echo "  Patched docusaurus.config.js"
  fi
}

#
# --- Dockerfiles ---
#
patch_dockerfiles() {
  echo "--- Patching Dockerfiles ---"

  for dockerfile in "$REPO_ROOT/server/Dockerfile" "$REPO_ROOT/machine-learning/Dockerfile"; do
    if [[ -f "$dockerfile" ]]; then
      sed -i "s|immich-app/immich/actions/runs|${REPO_NAME}/actions/runs|g" "$dockerfile"
      sed -i "s|immich-app/immich/pkgs/container|${REPO_NAME}/pkgs/container|g" "$dockerfile"
      sed -i "s|ENV IMMICH_REPOSITORY=immich-app/immich|ENV IMMICH_REPOSITORY=${REPO_NAME}|g" "$dockerfile"
      sed -i "s|ENV IMMICH_REPOSITORY_URL=https://github.com/immich-app/immich|ENV IMMICH_REPOSITORY_URL=${REPO_URL}|g" "$dockerfile"
      sed -i "s|immich-app/immich/commit/|${REPO_NAME}/commit/|g" "$dockerfile"
      echo "  Patched $(basename "$(dirname "$dockerfile")")/Dockerfile"
    fi
  done
}

#
# --- Versions ---
#
patch_versions() {
  if [[ -z "${FORK_VERSION:-}" ]]; then
    echo "--- Skipping version patching (no version in config) ---"
    return
  fi

  echo "--- Patching versions to $FORK_VERSION ---"

  for pkg in \
    "$REPO_ROOT/package.json" \
    "$REPO_ROOT/server/package.json" \
    "$REPO_ROOT/web/package.json" \
    "$REPO_ROOT/packages/cli/package.json" \
    "$REPO_ROOT/packages/sdk/package.json" \
    "$REPO_ROOT/e2e/package.json" \
    "$REPO_ROOT/i18n/package.json"; do
    if [[ -f "$pkg" ]]; then
      local tmp
      tmp=$(mktemp)
      jq --arg v "$FORK_VERSION" '.version = $v' "$pkg" > "$tmp"
      chmod 644 "$tmp"
      mv "$tmp" "$pkg"
      echo "  Patched $(realpath --relative-to="$REPO_ROOT" "$pkg")"
    fi
  done

  # Patch mobile/pubspec.yaml (format: version: X.Y.Z+BUILD)
  local pubspec="$REPO_ROOT/mobile/pubspec.yaml"
  if [[ -f "$pubspec" ]]; then
    local build_number="${BUILD_NUMBER:-1}"
    sed -i "s/^version: .*$/version: ${FORK_VERSION}+${build_number}/" "$pubspec"
    echo "  Patched mobile/pubspec.yaml (${FORK_VERSION}+${build_number})"
  fi

  # Patch machine-learning/pyproject.toml (format: version = "X.Y.Z")
  local pyproject="$REPO_ROOT/machine-learning/pyproject.toml"
  if [[ -f "$pyproject" ]]; then
    sed -i "s/^version = \".*\"/version = \"${FORK_VERSION}\"/" "$pyproject"
    echo "  Patched machine-learning/pyproject.toml"
  fi
}

#
# --- Main ---
#
main() {
  echo "=== Applying branding: $NAME ==="
  patch_versions
  patch_i18n
  patch_web
  patch_app_download_modal
  patch_emails
  patch_help_modal
  patch_assets
  patch_android
  patch_ios
  patch_oauth_callback
  patch_docker
  patch_dockerfiles
  patch_cli
  patch_docs
  echo "=== Branding applied successfully ==="
}

# Run main only when executed directly. When sourced (e.g. by the branding
# tests), this guard lets callers invoke individual patch_* functions without
# triggering a full branding pass.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
