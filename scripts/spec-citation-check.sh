#!/usr/bin/env bash
#
# Every `specs/....md` path cited from source must exist in the tree.
#
# CLAUDE.md permits code to cite design docs by path, and that only works because those docs live
# in-tree at the same commit as the code explaining itself. A citation that does not resolve is
# worse than no citation: it sends a reader looking for a file that was renamed, pruned, or never
# tracked at all. `space_albums.page.dart` shipped pointing at
# `.superpowers/sdd/.../task-2-report.md`, which is gitignored — it resolved for nobody.
#
# Read-only: greps the working tree and exits non-zero on the first unresolved citation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source trees that are allowed to cite specs. Deliberately not the whole repo: specs/ cites itself
# constantly, and those cross-references are the docs' own business.
SOURCE_ROOTS=(mobile/lib web/src server/src e2e/src cli/src)

cd "$REPO_ROOT"

missing=0
scanned=0

for root in "${SOURCE_ROOTS[@]}"; do
  [[ -d "$root" ]] || continue
  scanned=$((scanned + 1))

  # -o prints one match per line; -h suppresses filenames so the sort is over paths alone. The
  # per-citation source lookup below re-greps to report WHERE a bad one came from.
  while IFS= read -r citation; do
    [[ -n "$citation" ]] || continue
    if [[ ! -f "$citation" ]]; then
      echo "ERROR: cited spec does not exist: $citation" >&2
      grep -rn --fixed-strings "$citation" "$root" | sed 's/^/         cited at: /' >&2
      missing=$((missing + 1))
    fi
  done < <(grep -rhoE 'specs/[0-9A-Za-z._/-]+\.md' "$root" 2>/dev/null | sort -u)
done

if [[ "$scanned" -eq 0 ]]; then
  echo "ERROR: spec-citation-check scanned no source trees — SOURCE_ROOTS is wrong" >&2
  exit 1
fi

if [[ "$missing" -gt 0 ]]; then
  echo "" >&2
  echo "$missing unresolved spec citation(s). Either restore the doc, repoint the citation, or" >&2
  echo "drop it — a path that resolves for nobody is worse than no reference at all." >&2
  exit 1
fi

echo "spec-citation-check: all spec citations across ${scanned} source tree(s) resolve"
