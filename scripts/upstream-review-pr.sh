#!/usr/bin/env bash
# Build a review-only PR that shows a rolling upstream rebase as a normal diff against main.
#
#   commit A = git's automatic merge of the new upstream base into main (conflict markers left in)
#   commit B = the rolling branch's exact tree on top of A  -> B's diff is every rebase decision
#
# The GitHub PR for the rolling branch itself diffs against the OLD upstream base and re-adds the
# whole fork (~750k lines); this one diffs against main.
#
# Usage: make upstream-review-pr [ROLLING=<branch>] [BASE=<upstream-ref>] [DRY_RUN=1]
#    or: scripts/upstream-review-pr.sh [--rolling <branch>] [--base <upstream-ref>] [--dry-run]
set -euo pipefail

ROLLING=""
BASE=""
DRY_RUN=0
MAIN_REF=origin/main
while [ $# -gt 0 ]; do
  case "$1" in
    --rolling) ROLLING="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"
git fetch -q origin
git fetch -q upstream

# Newest rolling branch on origin unless given.
if [ -z "$ROLLING" ]; then
  ROLLING=$(git for-each-ref --sort=-committerdate --format='%(refname:short)' 'refs/remotes/origin/rebase/upstream-rolling-*' | head -1)
  [ -n "$ROLLING" ] || { echo "no origin/rebase/upstream-rolling-* branch found; pass --rolling" >&2; exit 1; }
fi
case "$ROLLING" in origin/*) ;; *) ROLLING="origin/$ROLLING" ;; esac
git rev-parse -q --verify "$ROLLING^{commit}" >/dev/null || { echo "no such ref: $ROLLING" >&2; exit 1; }

if git merge-base --is-ancestor "$MAIN_REF" "$ROLLING"; then
  echo "$ROLLING already contains $MAIN_REF — a normal PR diff is fine, no review branch needed." >&2
  exit 1
fi

# New upstream base: the newest merge-base of the rolling branch with upstream/main or any
# upstream/release/* branch (upstream tags are cut on release branches).
pick_newest() { # $1 current best, $2 candidate -> echo the descendant
  if [ -z "$1" ] || git merge-base --is-ancestor "$1" "$2"; then echo "$2"; else echo "$1"; fi
}
if [ -z "$BASE" ]; then
  for ref in upstream/main $(git for-each-ref --format='%(refname:short)' 'refs/remotes/upstream/release/*'); do
    mb=$(git merge-base "$ROLLING" "$ref" 2>/dev/null || true)
    [ -n "$mb" ] && BASE=$(pick_newest "$BASE" "$mb")
  done
fi
NB=$(git rev-parse "$BASE^{commit}")
OB=$(git merge-base "$MAIN_REF" "$NB")
if [ "$OB" = "$NB" ]; then
  echo "upstream base $NB is already in $MAIN_REF — nothing upstream to review." >&2
  exit 1
fi

M=$(git rev-parse "$MAIN_REF")
R=$(git rev-parse "$ROLLING")
short() { git rev-parse --short=11 "$1"; }
label() { git describe --tags --exact-match "$1" 2>/dev/null || short "$1"; }

# merge-tree exits 1 when there are conflicts; the tree (with markers) is still written on line 1.
T=$( { git merge-tree --write-tree "$M" "$NB" || true; } | head -1)
A=$(git commit-tree "$T" -p "$M" -p "$NB" -m "review: upstream base $(label "$NB") auto-merged into main

Tree is git's automatic merge (git merge-tree). Conflicted files still contain
conflict markers. Review-only commit; never merged.

[skip ci]")
B=$(git commit-tree "$R^{tree}" -p "$A" -m "review: conflict resolutions and fork adaptations from the rolling branch

Tree is exactly the rolling branch tip $(short "$R"). This commit's diff is every
decision the rebase made on top of the automatic merge. Review-only; never merged.

[skip ci]")

[ "$(git rev-parse "$B^{tree}")" = "$(git rev-parse "$R^{tree}")" ] || { echo "BUG: review tree != rolling tree" >&2; exit 1; }

stat() { git diff --shortstat "$@" | sed 's/^ *//'; }
conflicts=$(git diff "$A" "$B" | grep -c '^-<<<<<<<' || true)
rd=$(git range-diff --no-color "$OB..$M" "$NB..$R" 2>/dev/null || true)
rd_same=$(printf '%s\n' "$rd" | grep -cE '^ *[0-9]+: +[0-9a-f]+ = ' || true)
rd_changed=$(printf '%s\n' "$rd" | grep -cE '^ *[0-9]+: +[0-9a-f]+ ! ' || true)
rd_dropped=$(printf '%s\n' "$rd" | grep -cE '^ *[0-9]+: +[0-9a-f]+ < ' || true)
rd_new=$(printf '%s\n' "$rd" | grep -cE '^ *-: +-+ > ' || true)

REVIEW_BRANCH="review/${ROLLING#origin/rebase/}"
BODY=$(mktemp)
cat >"$BODY" <<EOF
**Review-only — do not merge.** Landing still happens by force-pushing the rolling branch at the tag.

This PR shows \`${ROLLING#origin/}\` (tip \`$(short "$R")\`) as a change to \`main\`, instead of the
whole-fork diff GitHub renders for the rolling branch itself (that diff is taken against the old
upstream base, so it re-adds every fork commit). The tree at the head of this branch is byte-identical
to the rolling tip.

Upstream base: \`$(label "$OB")\` → \`$(label "$NB")\`

### How to read it

| Where | What it shows | Size |
|---|---|---|
| **Files changed** | What \`main\` becomes after the cutover | $(stat "$M" "$B") |
| Commit \`$(short "$A")\` | Upstream's changes auto-merged into \`main\` by \`git merge-tree\`; conflicted files still hold conflict markers | $(stat "$M" "$A") |
| Commit \`$(short "$B")\` | **Every decision the rebase made**: conflict resolutions (markers → chosen code) plus fork adaptations and new fork commits | $(stat "$A" "$B"); $conflicts conflict hunks |

Review commit \`$(short "$B")\` most closely. Generated files (\`pnpm-lock.yaml\`, \`uv.lock\`,
\`mobile/drift_schemas/**\`, \`*.sql\` query docs) can be marked Viewed.

### Fork commits (\`git range-diff\`)

$rd_same unchanged · **$rd_changed changed during replay** · $rd_dropped only on main · $rd_new only on rolling

Inspect locally: \`git range-diff $(short "$OB")..$(short "$M") $(short "$NB")..$(short "$R")\`
EOF

echo "rolling:  $ROLLING $(short "$R")"
echo "main:     $(short "$M")   old base: $(label "$OB")   new base: $(label "$NB")"
echo "A: $(short "$A")  ($(stat "$M" "$A"))"
echo "B: $(short "$B")  ($(stat "$A" "$B"); $conflicts conflict hunks)"
echo "range-diff: $rd_same same, $rd_changed changed, $rd_dropped main-only, $rd_new rolling-only"
if [ "$DRY_RUN" = 1 ]; then
  echo "--- dry run: would push $REVIEW_BRANCH with body:"; cat "$BODY"; rm -f "$BODY"; exit 0
fi

git push -q --force origin "${B}:refs/heads/${REVIEW_BRANCH}"
TITLE="review: ${ROLLING#origin/rebase/} as a diff against main (do not merge)"
PR=$(gh pr list --head "$REVIEW_BRANCH" --state open --json number --jq '.[0].number // empty')
if [ -n "$PR" ]; then
  gh pr edit "$PR" --title "$TITLE" --body-file "$BODY" --add-label changelog:skip >/dev/null
  echo "updated PR #$PR: $(gh pr view "$PR" --json url --jq .url)"
else
  gh pr create --draft --base main --head "$REVIEW_BRANCH" --label changelog:skip --title "$TITLE" --body-file "$BODY"
fi
rm -f "$BODY"
