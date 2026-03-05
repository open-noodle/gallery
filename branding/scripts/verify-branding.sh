#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANDING_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$BRANDING_DIR")"
CONFIG="$BRANDING_DIR/config.json"

NAME=$(jq -r '.name' "$CONFIG")
UPSTREAM_NAME=$(jq -r '.upstream_name' "$CONFIG")
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
  "cli/package.json"
)

for file in "${check_files[@]}"; do
  filepath="$REPO_ROOT/$file"
  if [[ -f "$filepath" ]]; then
    # Case-sensitive grep for the upstream brand name
    if grep -q "$UPSTREAM_NAME" "$filepath"; then
      echo "  WARN: '$UPSTREAM_NAME' still found in $file"
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
  override_count=$(jq 'length' "$overrides_file")
  leaked=0
  for key in $(jq -r 'keys[]' "$overrides_file"); do
    value=$(jq -r --arg k "$key" '.[$k]' "$i18n_file")
    if echo "$value" | grep -q "$UPSTREAM_NAME"; then
      echo "  WARN: i18n key '$key' still contains '$UPSTREAM_NAME'"
      leaked=$((leaked + 1))
      EXIT_CODE=1
    fi
  done
  echo "  i18n: $((override_count - leaked))/$override_count keys patched"
fi

# Check iOS bundle ID
pbxproj="$REPO_ROOT/mobile/ios/Runner.xcodeproj/project.pbxproj"
if [[ -f "$pbxproj" ]]; then
  if grep -q "app\.alextran\.immich" "$pbxproj"; then
    echo "  WARN: Old bundle ID still found in project.pbxproj"
    EXIT_CODE=1
  else
    echo "  OK: project.pbxproj"
  fi
fi

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "=== Branding verification passed ==="
else
  echo "=== Branding verification FAILED — see warnings above ==="
fi

exit $EXIT_CODE
