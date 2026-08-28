#!/usr/bin/env bash
set -euo pipefail

# usage: ./bin/generate-dart-sdk.sh

TEMPLATE_DIR=$(mktemp -d)
trap 'rm -rf "$TEMPLATE_DIR"' EXIT

# Installed via mise
openapi-generator-cli author template -g dart -o "$TEMPLATE_DIR"
patch --no-backup-if-mismatch -u "$TEMPLATE_DIR/api.mustache" <./templates/mobile/api.mustache.patch
# openapi-generator 7.25 (immich-30995) absorbed every hunk of upstream's
# native_class patch into the shipped template, so applying it now reports
# "previously applied" and exits non-zero under `set -e`. Skip already-applied
# hunks, but still fail on a genuine rejection -- the two are indistinguishable
# by exit status, so match on patch's own wording.
apply_tolerating_already_applied() {
  local target=$1 patchfile=$2 out
  out=$(patch --forward --no-backup-if-mismatch -u "$target" <"$patchfile" 2>&1) || true
  printf '%s\n' "$out"
  if grep -qE 'hunks? failed' <<<"$out"; then
    echo "ERROR: $patchfile has genuinely rejected hunks" >&2
    return 1
  fi
  return 0
}
apply_tolerating_already_applied "$TEMPLATE_DIR/serialization/native/native_class.mustache" ./templates/mobile/serialization/native/native_class.mustache.patch
# Must apply AFTER native_class.mustache.patch — its hunks are authored against the
# patched template. Types nullable-item arrays as List<T?> (issue #743 item 3).
patch --no-backup-if-mismatch -u "$TEMPLATE_DIR/serialization/native/native_class.mustache" <./templates/mobile/serialization/native/native_class_nullable_items_in_arrays.patch

rm -rf ../mobile/generated/openapi

openapi-generator-cli generate -g dart -i ./immich-openapi-specs.json -o ../mobile/generated/openapi -t "$TEMPLATE_DIR" --additional-properties=useOptional=true

# Post generate patches
patch --no-backup-if-mismatch -u ../mobile/generated/openapi/lib/api_client.dart <./patch/api_client.dart.patch
patch --no-backup-if-mismatch -u ../mobile/generated/openapi/lib/api.dart <./patch/api.dart.patch
patch --no-backup-if-mismatch -u ../mobile/generated/openapi/pubspec.yaml <./patch/pubspec_immich_mobile.yaml.patch
patch --no-backup-if-mismatch -u ../mobile/generated/openapi/lib/model/asset_edit_action_item_dto.dart <./patch/asset_edit_action_item_dto.dart.patch
# Don't include analysis_options.yaml for the generated openapi files
# so that language servers can properly exclude the mobile/generated/openapi directory
rm ../mobile/generated/openapi/analysis_options.yaml
