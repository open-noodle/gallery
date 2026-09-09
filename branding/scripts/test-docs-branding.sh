#!/usr/bin/env bash
#
# Guards docs prose against inheriting upstream branding on an upstream rebase.
#
# Unlike the web/mobile/email surfaces, docs prose is NOT rewritten at build time:
# apply-branding.sh's patch_docs() only touches docs/docusaurus.config.js (title + url).
# Everything under docs/docs/ is branded IN SOURCE, and gallery-docs-deploy.yml runs no
# branding step at all — so whatever the rebase leaves in a markdown file is what
# docs.opennoodle.de serves.
#
# That failed silently once: upstream's FAQ gained an "Other" section (immich-31227)
# whose two entries market the upstream product key and describe the upstream team's
# funding. FAQ.mdx went from 0 upstream-brand mentions to 3, and shipped, because no
# gate reads docs prose.
#
# Two assertions, both deliberately narrow so this stays quiet on legitimate content:
#
#   1. Upstream COMMERCIAL/marketing URLs are forbidden everywhere under docs/.
#      There is no context in which Gallery's own documentation should funnel readers
#      to upstream's storefront or company blog.
#
#   2. Files outside ALLOWED_BRAND_FILES must not name the upstream brand at all.
#      The allowlist holds the files that legitimately discuss upstream — the
#      switch-to/from-Immich guides, the rebase process, upstream attribution — so a
#      brand mention appearing in any OTHER page is new drift from a rebase.
#
# Adding a file to the allowlist is a deliberate act: it means "this page is ABOUT
# upstream". Do not add a page just to silence this test.
#
# Read-only; safe to run locally. No network, no image tooling.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO" || exit 1

UPSTREAM_NAME="Immich"
DOCS_DIR="docs/docs"

# Pages that are legitimately ABOUT upstream. Anything not listed here must be brand-free.
ALLOWED_BRAND_FILES=(
  "docs/docs/administration/oauth.md"
  "docs/docs/administration/system-integrity.md"
  "docs/docs/developer/img/app-architecture.drawio.xml"
  "docs/docs/developer/releases.md"
  "docs/docs/developer/setup.md"
  "docs/docs/developer/ubiquitous-language.md"
  "docs/docs/developer/upstream-rebase-process.md"
  "docs/docs/features/duplicates-utility.md"
  "docs/docs/features/google-photos-import.md"
  "docs/docs/features/s3-storage.md"
  "docs/docs/guides/smtp-microsoft365.md"
  "docs/docs/guides/switch-back-to-immich.md"
  "docs/docs/install/config-file.md"
  "docs/docs/install/requirements.md"
  "docs/docs/install/unraid.md"
  "docs/docs/overview/release-notes.md"
)

# Upstream commercial funnels — never acceptable in Gallery's own docs.
FORBIDDEN_URLS=(
  "buy.immich.app"
  "immich.app/blog"
)

fails=0

echo "--- Upstream commercial URLs ---"
for url in "${FORBIDDEN_URLS[@]}"; do
  # -F: the patterns contain dots that must not act as wildcards.
  if hits="$(grep -rInF "$url" docs/ 2>/dev/null)"; then
    while IFS= read -r hit; do
      echo "  FAIL: upstream commercial URL '$url' -> $hit"
      fails=$((fails + 1))
    done <<<"$hits"
  fi
done
[[ $fails -eq 0 ]] && echo "  ok:   no upstream commercial URLs under docs/"

echo "--- Upstream brand in non-upstream pages ---"
brand_fails=0
while IFS= read -r file; do
  allowed=0
  for a in "${ALLOWED_BRAND_FILES[@]}"; do
    [[ "$file" == "$a" ]] && allowed=1 && break
  done
  [[ $allowed -eq 1 ]] && continue

  count="$(grep -c "$UPSTREAM_NAME" "$file" 2>/dev/null || true)"
  if [[ "${count:-0}" -gt 0 ]]; then
    echo "  FAIL: $file names '$UPSTREAM_NAME' ${count}x but is not an upstream-topic page"
    grep -n "$UPSTREAM_NAME" "$file" | head -3 | sed 's/^/          /'
    brand_fails=$((brand_fails + 1))
  fi
done < <(find "$DOCS_DIR" -type f \( -name '*.md' -o -name '*.mdx' \) | sort)

if [[ $brand_fails -eq 0 ]]; then
  echo "  ok:   no upstream brand outside the ${#ALLOWED_BRAND_FILES[@]} upstream-topic pages"
else
  fails=$((fails + brand_fails))
fi

# A stale allowlist entry hides future drift in that file, so surface it.
echo "--- Allowlist hygiene ---"
stale=0
for a in "${ALLOWED_BRAND_FILES[@]}"; do
  if [[ ! -f "$a" ]]; then
    echo "  FAIL: allowlisted file no longer exists: $a"
    stale=$((stale + 1))
  elif ! grep -q "$UPSTREAM_NAME" "$a" 2>/dev/null; then
    echo "  FAIL: allowlisted file no longer names '$UPSTREAM_NAME' (drop it): $a"
    stale=$((stale + 1))
  fi
done
[[ $stale -eq 0 ]] && echo "  ok:   all ${#ALLOWED_BRAND_FILES[@]} allowlist entries still earn their place"
fails=$((fails + stale))

echo
if [[ $fails -gt 0 ]]; then
  echo "FAILED: $fails assertion(s)"
  exit 1
fi
echo "PASSED: docs prose carries no inherited upstream branding"
