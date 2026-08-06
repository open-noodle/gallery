# sync-branch-to-rolling Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `sync-branch-to-rolling` user-level Claude Code skill (per spec `docs/superpowers/specs/2026-06-10-sync-branch-to-rolling-skill-design.md`): a guided flow + deterministic script that onboards long-running feature branches onto the rolling upstream rebase branch and keeps them in sync as it force-moves.

**Architecture:** Three files in `~/.claude/skills/sync-branch-to-rolling/` (backed by the `/Users/pierre/dev/claude-skills` git repo — commit there): `SKILL.md` (judgment flow: onboard/maintain modes, verification tiers, branch profiles, safety rules), `sync.sh` (deterministic maintain-mode mechanics: refusals, backup, `rebase --onto`, tag bookkeeping, conflict hand-off), `test-sync.sh` (self-contained sandbox regression harness in a temp dir — never touches the real repo). Final validation is a dry run on a scratch branch in the real gallery repo.

**Tech Stack:** bash + git (2.54), no other dependencies. Gallery-repo paths only appear in `SKILL.md` content, never in `sync.sh` logic.

**Plan-wide conventions:**

- `SKILL_DIR=~/.claude/skills/sync-branch-to-rolling`
- `~/.claude/skills` is a **symlink** to `/Users/pierre/dev/claude-skills/skills`; `~/.claude` itself belongs to the dotfiles repo. Commits for skill files happen in `/Users/pierre/dev/claude-skills` (never in `~/.claude`). Commits for the spec/plan happen in the gallery worktree `/Users/pierre/dev/gallery/.worktrees/explore-pi-agent-brainstorm`.
- The test harness must stay runnable at any point: `bash $SKILL_DIR/test-sync.sh` — it builds a toy repo under `mktemp -d`, uses `ROLLING_REF=origin/rolling` to override the canonical ref, and cleans up via trap.

---

### Task 1: Scaffold + refusal logic (TDD)

**Files:**

- Create: `~/.claude/skills/sync-branch-to-rolling/test-sync.sh`
- Create: `~/.claude/skills/sync-branch-to-rolling/sync.sh`

- [ ] **Step 1: Write the failing test harness (refusal phase only)**

Create `~/.claude/skills/sync-branch-to-rolling/test-sync.sh`:

```bash
#!/usr/bin/env bash
# test-sync.sh — sandbox regression tests for sync.sh.
# Runs entirely in a temp dir; never touches the real repo. Cleans up on exit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC="$SCRIPT_DIR/sync.sh"
export ROLLING_REF=origin/rolling
# Isolate from user/system git config (rerere, hooks, defaults) and any
# inherited git env (e.g. when run from a hook) that could escape the sandbox
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

# expect_fail <needle> -- <cmd...>: command must exit non-zero and print <needle>
expect_fail() {
  local needle="$1"; shift 2
  local out
  if out="$("$@" 2>&1)"; then
    fail "expected failure, got success: $* :: $out"
  fi
  grep -qF -- "$needle" <<<"$out" || fail "expected '$needle' in output: $out"
}

# ---- fixture: origin with main, rolling v1, onboarded feature branch ----
git init -q --bare "$tmp/origin.git"
git init -q "$tmp/repo"
cd "$tmp/repo"
git config user.email t@example.com
git config user.name tester
git remote add origin "$tmp/origin.git"

echo base > shared.txt
git add shared.txt && git commit -qm "c1: base"
git branch -M main

git checkout -qb rollwork main
echo up1 > upstream1.txt
git add upstream1.txt && git commit -qm "upstream batch 1"
ROLL_V1="$(git rev-parse HEAD)"
git push -q origin main "HEAD:refs/heads/rolling"

git checkout -qb feat "$ROLL_V1"
echo f1 > feat.txt
git add feat.txt && git commit -qm "feat: one"
echo f2 >> feat.txt
git commit -qam "feat: two"
git tag "rolling-base/feat" "$ROLL_V1"
git push -q origin feat

# ---- Phase A: refusals ----
git checkout -qb feat-untagged feat
expect_fail "not onboarded" -- "$SYNC" feat-untagged
pass "refuses branch without rolling-base tag"
git checkout -q feat
git branch -qD feat-untagged

git checkout -q main
expect_fail "not checked out" -- "$SYNC" feat
pass "refuses when branch not checked out"
git checkout -q feat

echo dirty >> feat.txt
expect_fail "dirty" -- "$SYNC" feat
pass "refuses dirty worktree"
git checkout -q -- feat.txt

echo "ALL PHASE-A TESTS PASSED"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash ~/.claude/skills/sync-branch-to-rolling/test-sync.sh`
Expected: FAIL — the first refusal case aborts with `FAIL: expected 'not onboarded' in output: ...` (the captured output is bash's `No such file or directory` for the missing sync.sh).

- [ ] **Step 3: Write sync.sh with usage + refusals (rebase logic still a stub)**

Create `~/.claude/skills/sync-branch-to-rolling/sync.sh`:

```bash
#!/usr/bin/env bash
# sync.sh — deterministic mechanics for the sync-branch-to-rolling skill (MAINTAIN mode).
# Onboarding (first transfer of a main-based branch) is a guided flow in SKILL.md, not scripted.
#
# usage: sync.sh <branch> [new-base-ref]   # run a sync (default new base: canonical rolling ref)
#        sync.sh --finish                  # complete bookkeeping after manual conflict resolution
#
# Env: ROLLING_REF overrides the canonical rolling ref (used by tests).
set -euo pipefail

CANONICAL_ROLLING_REF="${ROLLING_REF:-origin/rebase/upstream-rolling-complete-20260604}"

die() { echo "FATAL: $*" >&2; exit 1; }

if [[ "${1:-}" == "--finish" ]]; then
  die "--finish not implemented yet"
fi

branch="${1:-}"
[[ -n "$branch" ]] || { echo "usage: sync.sh <branch> [new-base-ref] | sync.sh --finish" >&2; exit 2; }
new_base_ref="${2:-$CANONICAL_ROLLING_REF}"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git worktree"

gd="$(git rev-parse --git-dir)"
if [[ -d "$gd/rebase-merge" || -d "$gd/rebase-apply" ]]; then
  die "a rebase is already in progress — resolve it (or run sync.sh --finish) first"
fi
if [[ -f "$gd/CHERRY_PICK_HEAD" ]]; then
  die "a cherry-pick is in progress"
fi

current="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current" != "$branch" ]]; then
  die "$branch is not checked out in this worktree (HEAD=$current)"
fi

# -uno: untracked files don't impede a rebase; only tracked changes block
if [[ -n "$(git status --porcelain -uno)" ]]; then
  die "worktree is dirty — commit or stash first"
fi

if ! git rev-parse -q --verify "refs/tags/rolling-base/$branch^{commit}" >/dev/null; then
  die "tag rolling-base/$branch not found — branch not onboarded; use ONBOARD mode in SKILL.md"
fi

die "sync logic not implemented yet"
```

Then: `chmod +x ~/.claude/skills/sync-branch-to-rolling/sync.sh ~/.claude/skills/sync-branch-to-rolling/test-sync.sh`

- [ ] **Step 4: Run tests to verify Phase A passes**

Run: `bash ~/.claude/skills/sync-branch-to-rolling/test-sync.sh`
Expected: three `ok:` lines, then `ALL PHASE-A TESTS PASSED`.

- [ ] **Step 5: Commit (in the skills repo)**

```bash
cd /Users/pierre/dev/claude-skills
git add skills/sync-branch-to-rolling/sync.sh skills/sync-branch-to-rolling/test-sync.sh
git commit -m "feat(skills): sync-branch-to-rolling scaffold — refusal logic + sandbox harness"
```

---

### Task 2: Happy-path maintain sync

**Files:**

- Modify: `~/.claude/skills/sync-branch-to-rolling/test-sync.sh` (append Phase B before the final echo)
- Modify: `~/.claude/skills/sync-branch-to-rolling/sync.sh` (replace the final `die` stub)

- [ ] **Step 1: Append Phase B tests (happy path + already-up-to-date)**

In `test-sync.sh`, replace the final line `echo "ALL PHASE-A TESTS PASSED"` with:

```bash
# ---- Phase B: rolling force-moves; happy-path sync ----
git checkout -q rollwork
git reset -q --hard main
echo up1 > upstream1.txt
git add upstream1.txt && git commit -qm "upstream batch 1 (rewritten)"
echo up2 > upstream2.txt
git add upstream2.txt && git commit -qm "upstream batch 2"
ROLL_V2="$(git rev-parse HEAD)"
git push -qf origin "HEAD:refs/heads/rolling"
git checkout -q feat
touch stray-untracked.txt # untracked files must not block a sync

"$SYNC" feat
[[ -f upstream2.txt ]] || fail "upstream batch 2 content missing after sync"
[[ "$(git rev-list --count "$ROLL_V2..feat")" == "2" ]] || fail "expected 2 own commits after sync"
[[ "$(git rev-parse 'refs/tags/rolling-base/feat^{commit}')" == "$ROLL_V2" ]] || fail "tag not moved to new base"
git ls-remote --tags origin | grep -q "rolling-base/feat" || fail "tag not pushed to origin"
git ls-remote origin 'refs/heads/backup/feat-*' | grep -q backup/feat || fail "backup ref not pushed"
pass "happy-path sync: rebase, tag move+push, backup"

out="$("$SYNC" feat)"
grep -q "Already up to date" <<<"$out" || fail "expected up-to-date short-circuit: $out"
pass "already-up-to-date short-circuit"

echo "ALL TESTS PASSED (phases A-B)"
```

- [ ] **Step 2: Run tests to verify Phase B fails**

Run: `bash ~/.claude/skills/sync-branch-to-rolling/test-sync.sh`
Expected: Phase A `ok:` lines, then FAIL at `"$SYNC" feat` with `FATAL: sync logic not implemented yet`.

- [ ] **Step 3: Implement the sync logic**

In `sync.sh`, replace the final line `die "sync logic not implemented yet"` with:

```bash
git fetch origin

OLD="$(git rev-parse "refs/tags/rolling-base/$branch^{commit}")"
NEW="$(git rev-parse "$new_base_ref^{commit}")"
OLD_HEAD="$(git rev-parse "$branch")"

if [[ "$OLD" == "$NEW" ]]; then
  echo "Already up to date ($NEW)."
  exit 0
fi

own_before="$(git rev-list --count "$OLD..$branch")"

backup="backup/$branch-$(date +%Y%m%d)-$(git rev-parse --short "$branch")"
git push origin "refs/heads/$branch:refs/heads/$backup"
echo "Backup: origin/$backup"

echo "Rebasing $own_before own commits: $branch from $OLD onto $NEW"
git rebase --onto "$NEW" "$OLD" "$branch"

own_after="$(git rev-list --count "$NEW..$branch")"
echo "== range-diff (old vs new) =="
git --no-pager range-diff "$OLD..$OLD_HEAD" "$NEW..$branch" || true
echo "== own commits: before=$own_before after=$own_after (drops = already in rolling) =="

git tag -f "rolling-base/$branch" "$NEW"
git push --force origin "refs/tags/rolling-base/$branch"
echo "Tag rolling-base/$branch -> $NEW (pushed)."
echo "NEXT: run Tier-1 gates per SKILL.md, then push per the branch profile:"
echo "  git push --force-with-lease origin $branch"
```

- [ ] **Step 4: Run tests to verify phases A-B pass**

Run: `bash ~/.claude/skills/sync-branch-to-rolling/test-sync.sh`
Expected: five `ok:` lines, then `ALL TESTS PASSED (phases A-B)`.

- [ ] **Step 5: Commit (in the skills repo)**

```bash
cd /Users/pierre/dev/claude-skills
git add skills/sync-branch-to-rolling/sync.sh skills/sync-branch-to-rolling/test-sync.sh
git commit -m "feat(skills): sync-branch-to-rolling happy-path maintain sync"
```

---

### Task 3: Merge-in-range refusal + conflict hand-off with --finish

The conflict path needs state to survive between `sync.sh <branch>` (which stops mid-rebase) and `sync.sh --finish` (run after manual resolution): old/new base, pre-rebase head, own-commit count. Persist it in `$(git rev-parse --git-dir)/sync-rolling.state`.

**Files:**

- Modify: `~/.claude/skills/sync-branch-to-rolling/test-sync.sh` (append Phases C-D)
- Modify: `~/.claude/skills/sync-branch-to-rolling/sync.sh` (merge check, state file, `finish()`)

- [ ] **Step 1: Append the Phase C tests (stale-tag + merge-commit refusals)**

In `test-sync.sh`, replace the final line `echo "ALL TESTS PASSED (phases A-B)"` with:

```bash
# ---- Phase C: rolling force-moves again (v3, conflicts with upcoming feat edit) ----
git checkout -q rollwork
git reset -q --hard main
echo up1 > upstream1.txt
git add upstream1.txt && git commit -qm "upstream batch 1 (rewritten again)"
echo up2 > upstream2.txt
git add upstream2.txt && git commit -qm "upstream batch 2 (rewritten)"
echo "upstream edit" > shared.txt
git commit -qam "upstream batch 3: edits shared.txt"
ROLL_V3="$(git rev-parse HEAD)"
git push -qf origin "HEAD:refs/heads/rolling"
git checkout -q feat

# stale/foreign tag (non-ancestor of the branch) must be refused before any rebase
# (ROLL_V1 is no longer in feat's ancestry after the Phase B rebase)
git tag -f "rolling-base/feat" "$ROLL_V1"
expect_fail "not an ancestor" -- "$SYNC" feat
pass "refuses stale/foreign rolling-base tag"
git tag -f "rolling-base/feat" "$ROLL_V2"

# merge commit in replay range must be refused
git checkout -qb side "$(git rev-parse feat)"
echo s > side.txt
git add side.txt && git commit -qm "side work"
git checkout -q feat
git merge -q --no-ff side -m "merge side into feat"
expect_fail "merge commit" -- "$SYNC" feat
pass "refuses merge commits in replay range"
git reset -q --hard HEAD~1   # drop the merge
git branch -qD side

echo "ALL TESTS PASSED (phases A-C)"
```

- [ ] **Step 2: Run tests to verify the Phase C case fails**

Run: `bash ~/.claude/skills/sync-branch-to-rolling/test-sync.sh`
Expected: phases A-B pass, then FAIL with `expected failure, got success` at the stale-tag case — without the ancestor guard, the script happily replays foreign history (in this small fixture the garbage replay even completes cleanly and moves the tag). The sandbox is rebuilt fresh on every run, so that stray state is harmless.

- [ ] **Step 3: Implement the ancestor and merge-commit guards**

In `sync.sh`, insert immediately after the `if [[ "$OLD" == "$NEW" ]] ... fi` block (before the `own_before=` line):

```bash
git merge-base --is-ancestor "$OLD" "$branch" ||
  die "rolling-base/$branch ($OLD) is not an ancestor of $branch — stale/foreign tag; verify lineage per SKILL.md before syncing"

merges="$(git rev-list --merges --count "$OLD..$branch")"
if [[ "$merges" -gt 0 ]]; then
  die "$merges merge commit(s) in $OLD..$branch — new 'merge origin/main' merges need judgment; see SKILL.md failure modes"
fi
```

(The ancestor guard is the single highest-value line in the script given the force-moving base: without it, a stale or mistyped tag silently replays foreign history — at real scale a 1400-commit garbage replay whose conflicts look real enough to start resolving.)

- [ ] **Step 4: Run tests to verify phases A-C pass**

Run: `bash ~/.claude/skills/sync-branch-to-rolling/test-sync.sh`
Expected: seven `ok:` lines, then `ALL TESTS PASSED (phases A-C)`.

- [ ] **Step 5: Append the Phase D test (conflict → resolve → --finish)**

In `test-sync.sh`, replace the final line `echo "ALL TESTS PASSED (phases A-C)"` with:

```bash
# ---- Phase D: conflict -> manual resolve -> --finish ----
expect_fail "no sync in progress" -- "$SYNC" --finish
pass "--finish refuses when no sync in progress"

echo "feat edit" > shared.txt
git commit -qam "feat: edit shared.txt"

set +e
"$SYNC" feat >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" == "3" ]] || fail "expected conflict exit code 3, got $rc"
[[ -d "$(git rev-parse --git-dir)/rebase-merge" || -d "$(git rev-parse --git-dir)/rebase-apply" ]] \
  || fail "expected rebase left in progress"
pass "conflict: exit 3 with rebase in progress"

echo "merged content" > shared.txt
git add shared.txt
GIT_EDITOR=true git rebase --continue >/dev/null 2>&1

"$SYNC" --finish
[[ "$(git rev-parse 'refs/tags/rolling-base/feat^{commit}')" == "$ROLL_V3" ]] || fail "tag not moved by --finish"
[[ "$(git ls-remote origin refs/tags/rolling-base/feat | cut -f1)" == "$ROLL_V3" ]] || fail "remote tag not moved to ROLL_V3"
[[ "$(git rev-list --count "$ROLL_V3..feat")" == "3" ]] || fail "expected 3 own commits after conflict sync"
[[ "$(cat shared.txt)" == "merged content" ]] || fail "resolution content lost"
grep -q f2 feat.txt || fail "branch's own content lost in replay"
[[ ! -f "$(git rev-parse --git-dir)/sync-rolling.state" ]] || fail "state file not cleaned up"
pass "conflict resolution completed via --finish"

echo "ALL TESTS PASSED (phases A-D)"
```

- [ ] **Step 6: Run tests to verify the Phase D cases fail**

Run: `bash ~/.claude/skills/sync-branch-to-rolling/test-sync.sh`
Expected: phases A-C pass, then FAIL with `expected 'no sync in progress' in output` — the stub still dies with `--finish not implemented yet`. (Once that needle existed, the next failure would be `expected conflict exit code 3, got 1`: the bare `git rebase` under `set -e` exits with git's status 1 and leaves the sandbox mid-rebase — harmless, every run rebuilds the temp dir.)

- [ ] **Step 7: Implement the state file, finish(), and conflict exit code**

Rewrite `sync.sh` in full (this is the complete final script):

```bash
#!/usr/bin/env bash
# sync.sh — deterministic mechanics for the sync-branch-to-rolling skill (MAINTAIN mode).
# Onboarding (first transfer of a main-based branch) is a guided flow in SKILL.md, not scripted.
#
# usage: sync.sh <branch> [new-base-ref]   # run a sync (default new base: canonical rolling ref)
#        sync.sh --finish                  # complete bookkeeping after manual conflict resolution
#
# Env: ROLLING_REF overrides the canonical rolling ref (used by tests).
set -euo pipefail

CANONICAL_ROLLING_REF="${ROLLING_REF:-origin/rebase/upstream-rolling-complete-20260604}"

die() { echo "FATAL: $*" >&2; exit 1; }

state_file() { echo "$(git rev-parse --git-dir)/sync-rolling.state"; }

finish() {
  local sf
  sf="$(state_file)"
  [[ -f "$sf" ]] || die "no sync in progress (state file missing)"
  # shellcheck disable=SC1090
  source "$sf"   # sets BRANCH OLD NEW OLD_HEAD OWN_BEFORE BACKUP
  local gd
  gd="$(git rev-parse --git-dir)"
  if [[ -d "$gd/rebase-merge" || -d "$gd/rebase-apply" ]]; then
    die "rebase still in progress — resolve and 'git rebase --continue' first"
  fi
  [[ "$(git rev-parse --abbrev-ref HEAD)" == "$BRANCH" ]] || die "expected $BRANCH checked out"

  # Refuse to finish if the rebase never landed on NEW (e.g. after 'git rebase --abort'):
  # moving the tag then would silently record a sync that never happened.
  git merge-base --is-ancestor "$NEW" "$BRANCH" ||
    die "$BRANCH is not based on $NEW — rebase was aborted or incomplete; nothing to finish"

  # Record the fact first — the rebase completed onto NEW. The report below is
  # advisory and can be slow at real scale; review gates the branch PUSH, not the tag.
  git tag -f "rolling-base/$BRANCH" "$NEW"
  git push --force origin "refs/tags/rolling-base/$BRANCH"

  local own_after
  own_after="$(git rev-list --count "$NEW..$BRANCH")"
  echo "== range-diff (old vs new) =="
  git --no-pager range-diff "$OLD..$OLD_HEAD" "$NEW..$BRANCH" || true
  echo "== own commits: before=$OWN_BEFORE after=$own_after (drops = already in rolling) =="

  rm -f "$sf"
  echo "Tag rolling-base/$BRANCH -> $NEW (pushed). Backup: origin/$BACKUP"
  echo "NEXT: run Tier-1 gates per SKILL.md, then push per the branch profile:"
  echo "  git push --force-with-lease origin $BRANCH"
}

if [[ "${1:-}" == "--finish" ]]; then
  finish
  exit 0
fi

branch="${1:-}"
[[ -n "$branch" ]] || { echo "usage: sync.sh <branch> [new-base-ref] | sync.sh --finish" >&2; exit 2; }
new_base_ref="${2:-$CANONICAL_ROLLING_REF}"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git worktree"

gd="$(git rev-parse --git-dir)"
if [[ -d "$gd/rebase-merge" || -d "$gd/rebase-apply" ]]; then
  die "a rebase is already in progress — resolve it (or run sync.sh --finish) first"
fi
if [[ -f "$gd/CHERRY_PICK_HEAD" ]]; then
  die "a cherry-pick is in progress"
fi

current="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current" != "$branch" ]]; then
  die "$branch is not checked out in this worktree (HEAD=$current)"
fi

# -uno: untracked files don't impede a rebase; only tracked changes block
if [[ -n "$(git status --porcelain -uno)" ]]; then
  die "worktree is dirty — commit or stash first"
fi

if ! git rev-parse -q --verify "refs/tags/rolling-base/$branch^{commit}" >/dev/null; then
  die "tag rolling-base/$branch not found — branch not onboarded; use ONBOARD mode in SKILL.md"
fi

git fetch origin

OLD="$(git rev-parse "refs/tags/rolling-base/$branch^{commit}")"
NEW="$(git rev-parse "$new_base_ref^{commit}")"
OLD_HEAD="$(git rev-parse "$branch")"

if [[ "$OLD" == "$NEW" ]]; then
  echo "Already up to date ($NEW)."
  # heal a previously failed tag push (the local tag is authoritative)
  git push --force origin "refs/tags/rolling-base/$branch" || true
  exit 0
fi

git merge-base --is-ancestor "$OLD" "$branch" ||
  die "rolling-base/$branch ($OLD) is not an ancestor of $branch — stale/foreign tag; verify lineage per SKILL.md before syncing"

merges="$(git rev-list --merges --count "$OLD..$branch")"
if [[ "$merges" -gt 0 ]]; then
  die "$merges merge commit(s) in $OLD..$branch — new 'merge origin/main' merges need judgment; see SKILL.md failure modes"
fi

own_before="$(git rev-list --count "$OLD..$branch")"

backup="backup/$branch-$(date +%Y%m%d)-$(git rev-parse --short "$branch")"
git push origin "refs/heads/$branch:refs/heads/$backup"
echo "Backup: origin/$backup"

cat > "$(state_file)" <<EOF
BRANCH='$branch'
OLD='$OLD'
NEW='$NEW'
OLD_HEAD='$OLD_HEAD'
OWN_BEFORE='$own_before'
BACKUP='$backup'
EOF

echo "Rebasing $own_before own commits: $branch from $OLD onto $NEW"
if ! git rebase --onto "$NEW" "$OLD" "$branch"; then
  echo "CONFLICT: resolve per SKILL.md conflict discipline, 'git rebase --continue' until done, then run: sync.sh --finish" >&2
  exit 3
fi
finish
```

- [ ] **Step 8: Run tests to verify phases A-D pass**

Run: `bash ~/.claude/skills/sync-branch-to-rolling/test-sync.sh`
Expected: ten `ok:` lines, then `ALL TESTS PASSED (phases A-D)`.

- [ ] **Step 9: Commit (in the skills repo)**

```bash
cd /Users/pierre/dev/claude-skills
git add skills/sync-branch-to-rolling/sync.sh skills/sync-branch-to-rolling/test-sync.sh
git commit -m "feat(skills): sync-branch-to-rolling merge guard + conflict hand-off via --finish"
```

---

### Task 3b: Refuse `--finish` after an aborted rebase (quality-review fix)

Found in Task 3's quality review: after a conflict, `git rebase --abort` leaves the branch at OLD_HEAD with the state file present and no rebase in progress — `finish()`'s three checks all pass, so it moved the tag to NEW and the next sync false-no-op'd ("Already up to date") while the branch silently stayed behind. The fix asserts the rebase actually landed on NEW.

**Files:**

- Modify: `~/.claude/skills/sync-branch-to-rolling/test-sync.sh` (append Phase E)
- Modify: `~/.claude/skills/sync-branch-to-rolling/sync.sh` (one guard in `finish()`)

- [ ] **Step 1: Append the Phase E test (abort → --finish must refuse)**

In `test-sync.sh`, replace the final line `echo "ALL TESTS PASSED (phases A-D)"` with:

```bash
# ---- Phase E: --finish after 'git rebase --abort' must refuse (tag must not move) ----
git checkout -q rollwork
git reset -q --hard "$ROLL_V3"
echo up3 > upstream3.txt
git add upstream3.txt && git commit -qm "upstream batch 4"
echo "upstream edit v4" > shared.txt
git commit -qam "upstream batch 5: edits shared.txt again"
ROLL_V4="$(git rev-parse HEAD)"
git push -qf origin "HEAD:refs/heads/rolling"
git checkout -q feat

echo "feat edit 2" > shared.txt
git commit -qam "feat: edit shared.txt again"
FEAT_PRE_ABORT="$(git rev-parse feat)"

set +e
"$SYNC" feat >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" == "3" ]] || fail "expected conflict exit code 3 in phase E, got $rc"
git rebase --abort

expect_fail "aborted or incomplete" -- "$SYNC" --finish
[[ "$(git rev-parse 'refs/tags/rolling-base/feat^{commit}')" == "$ROLL_V3" ]] || fail "tag moved despite aborted rebase"
[[ "$(git rev-parse feat)" == "$FEAT_PRE_ABORT" ]] || fail "branch moved despite abort"
pass "--finish refuses after rebase --abort; tag untouched"

echo "ALL TESTS PASSED (phases A-E)"
```

- [ ] **Step 2: Run tests to verify the Phase E case fails**

Run: `bash ~/.claude/skills/sync-branch-to-rolling/test-sync.sh`
Expected: phases A-D pass, then FAIL with `expected failure, got success` — current `finish()` happily moves the tag after an abort.

- [ ] **Step 3: Implement the landed-on-NEW guard in finish()**

In `sync.sh`, inside `finish()`, insert after the `[[ "$(git rev-parse --abbrev-ref HEAD)" == "$BRANCH" ]] || die "expected $BRANCH checked out"` line:

```bash
  # Refuse to finish if the rebase never landed on NEW (e.g. after 'git rebase --abort'):
  # moving the tag then would silently record a sync that never happened.
  git merge-base --is-ancestor "$NEW" "$BRANCH" ||
    die "$BRANCH is not based on $NEW — rebase was aborted or incomplete; nothing to finish"
```

- [ ] **Step 4: Run tests to verify phases A-E pass**

Run: `bash ~/.claude/skills/sync-branch-to-rolling/test-sync.sh`
Expected: eleven `ok:` lines, then `ALL TESTS PASSED (phases A-E)`.

- [ ] **Step 5: Commit (in the skills repo)**

```bash
cd /Users/pierre/dev/claude-skills
git add skills/sync-branch-to-rolling/sync.sh skills/sync-branch-to-rolling/test-sync.sh
git commit -m "fix(skills): refuse --finish after an aborted rebase"
```

---

### Task 4: Write SKILL.md

**Files:**

- Create: `~/.claude/skills/sync-branch-to-rolling/SKILL.md`

- [ ] **Step 1: Write the skill document**

Create `~/.claude/skills/sync-branch-to-rolling/SKILL.md` with exactly this content:

````markdown
---
name: sync-branch-to-rolling
description: Use when keeping a long-running feature branch based on the rolling upstream rebase branch — onboarding a main-based branch onto it, or re-syncing after rolling batches land. Triggers on "sync to rolling", "rebase onto the rolling branch", "catch the branch up with the rolling rebase".
---

# Sync Branch to Rolling

Keep long-running feature branches based on the rolling upstream rebase branch so that when
it finally force-lands on `main` (held for Immich v3.0.0), the final transfer is a no-op.

Design spec: `docs/superpowers/specs/2026-06-10-sync-branch-to-rolling-skill-design.md` (gallery repo).

## Constants

- **CANONICAL ROLLING REF:** `origin/rebase/upstream-rolling-complete-20260604`
  — if the rolling branch is ever restarted under a new name, update this constant AND
  verify the lineage of every `rolling-base/*` tag before trusting it (re-onboard if broken).
- **State per branch:** lightweight tag `rolling-base/<branch>` = the rolling tip the branch
  currently sits on (pushed to origin; also pins the otherwise-unreachable old base against GC).
- **HARD RULE:** never write `rolling-state.json`, never run `upstream-*` make targets from
  this skill. This skill is strictly downstream of the rolling operation. Reading
  `rolling-state.json` (e.g. `integratedForkHead`, `appendHistory`) is fine — note it is
  UNTRACKED local state in the rolling worktree's gitdir, NOT committed on the rolling
  branch: `$(git rev-parse --git-dir)/upstream-preflight/rolling-state.json` from inside
  that worktree (locate the worktree via `git worktree list`).

## Mode detection

`git rev-parse -q --verify "refs/tags/rolling-base/<branch>^{commit}"` —
missing → **ONBOARD** (first transfer), present → **MAINTAIN**.

Resolve the branch name via Branch Profiles first: for onboarded branches the sync target
is the rolling-suffixed name (`sync.sh <branch>-rolling`); the frozen main-based name will
always look un-onboarded — do not re-onboard it.

## MAINTAIN mode (recurring, per rolling batch)

1. Pick the new base: the canonical rolling tip, **only if its batch is CI-green**.
   Authoritative source: `appendHistory` in the rolling worktree's `rolling-state.json`
   (see Constants for its real location); fallback `gh --repo open-noodle/gallery run list`
   on the batch branch.
   If not green, pass the last green batch SHA as the second argument.
2. From the branch's own worktree, with the branch checked out:
   ```bash
   ~/.claude/skills/sync-branch-to-rolling/sync.sh <branch> [green-base-sha]
   ```
   The script refuses on: dirty worktree, rebase/cherry-pick in progress, branch not checked
   out here, missing or stale (non-ancestor) tag, merge commits in the replay range. It backs
   up the branch to `origin/backup/<branch>-YYYYMMDD-<sha>`, runs
   `git rebase --onto NEW OLD <branch>`, and on clean completion moves + pushes the tag, then
   prints a range-diff + own-commit-count comparison.
3. **On conflict (exit 3):** resolve per the `rebase-upstream-report` conflict discipline —
   read the full file, prefer upstream/rolling for upstream-owned code, preserve branch
   additions, record a Conflict Resolution Entry per file (fork side / upstream side /
   resolution / risk / verification needed). `git rebase --continue` until done, then:
   ```bash
   ~/.claude/skills/sync-branch-to-rolling/sync.sh --finish
   ```
   (If you `git rebase --abort` instead, `--finish` refuses — the tag stays at the old base
   and the sync simply never happened; rerun later.)
4. Review the range-diff output. Own-commit drops are expected only when the same change
   reached rolling via origin/main fork-sync — verify each drop is explainable.
5. Run verification tiers (below), then push per the branch profile:
   `git push --force-with-lease origin <branch>`.

## ONBOARD mode (one-time per branch)

1. **Preconditions:** clean worktree; base = `git merge-base origin/main <branch>`;
   `git merge-base --is-ancestor <base> <integratedForkHead>` must hold (integratedForkHead
   from the rolling worktree's `rolling-state.json` — see Constants). If it doesn't, stop
   and wait for the rolling flow's next `upstream-sync-fork-main`.
2. **Pin the base:** choose a CI-green rolling tip; `git tag pin/onboard-<branch> <sha>`
   (delete after onboarding). Never chase a moving tip mid-onboard.
3. **Collision-surface audit → USER CHECKPOINT.** Present before rewriting anything:
   - `git diff --name-only <base> <branch> | sort > /tmp/own.txt`,
     `git diff --name-only origin/main <pinned-tip> | sort > /tmp/delta.txt`,
     `comm -12 /tmp/own.txt /tmp/delta.txt` → per-file risk table (LOW/MED/HIGH).
   - Migration check: branch-added files under `server/src/schema/migrations*/` vs the
     pinned tip's migration timestamps (collisions, conventions — fork migrations belong in
     `migrations-gallery/`); mobile Drift only if the branch touches non-generated mobile code.
   - Pattern-propagation check: upstream refactors in rolling that the branch's fork-only
     code should adopt (route verb changes, dependency majors, test-API shifts).
4. **rerere seeding:** if the branch contains "merge origin/main" commits:
   ```bash
   git config rerere.enabled true
   sh /opt/homebrew/share/git-core/contrib/rerere-train.sh <base>..<branch>
   ```
   (pass a RANGE, not bare SHAs — bare args walk the whole ancestry and re-merge dozens of
   irrelevant historical merges; needs a clean worktree; helps where the same conflict text
   recurs — not a guarantee).
5. **Segmented replay** at merge-commit epoch boundaries (`git log --merges <base>..<branch>`),
   sub-gating very large epochs at feature milestones. Only the FIRST segment rebases onto
   the pinned tip; later segments chain onto the previous segment's result:
   ```bash
   git rebase --onto <pinned-tip> <base> <epoch1-tip>     # → H1 (detached HEAD)
   git rebase --onto H1 <epoch1-tip> <epoch2-tip>         # → H2 ... repeat
   git switch -c <branch>-rolling                          # after the final segment
   ```
   Use commit SHAs for every segment endpoint — including the final tip
   (`git rev-parse <branch>`), never the branch name, so the frozen `<branch>` never moves.
   Gate per segment: `make check-server` + `cd server && pnpm exec tsc --noEmit` (direct —
   the make target's cache can mask spec errors). Document every conflict resolution.
6. **Regen pass (once, at the end):** resolve generated-file conflicts mechanically during
   replay, then regenerate honestly — `pnpm -C server build` FIRST (the sync scripts run
   from `dist`; without a fresh build they regenerate from pre-rebase code), then
   `pnpm -C server sync:open-api`, `make open-api`
   (TypeScript AND Dart), `make sql`, branch-specific generated artifacts (see profile),
   lockfile, i18n formatting.
7. **Verify:** drop accounting first — `git rev-list --count <base>..<branch>` (before) vs
   `git rev-list --count <pinned-tip>..HEAD` (after); every dropped commit must be
   explainable as already-in-rolling. Then the "lost upstream content" check per conflicted
   file (`git diff <pinned-tip>..HEAD -- <file>` — large `-` blocks of upstream content with
   no `+` re-add = dropped work); Tier-2 suites; Tier-3 before any deploy.
8. **Publish + register:**
   ```bash
   git tag "rolling-base/<branch>-rolling" <pinned-tip>
   git push origin "refs/tags/rolling-base/<branch>-rolling"
   git push -u origin <branch>-rolling
   git tag -d pin/onboard-<branch>
   ```
   The original `<branch>` stays frozen at its main-based head (protects an open PR that
   targets main — its diff would explode if force-pushed). Add a column to Branch Profiles below.

## Verification tiers

- **Tier 1 — every sync:** `make check-server`, direct `cd server && pnpm exec tsc --noEmit`,
  and the profile's fast suites.
- **Tier 2 — conflicts occurred, or computed overlap non-empty**
  (`git diff --name-only OLD NEW` ∩ `git diff --name-only NEW <branch>`, using the OLD/NEW
  SHAs the script printed — compute per sync; the profile hotspot list is advisory only):
  full regen pass + profile full suites +
  `gh --repo open-noodle/gallery workflow run test.yml --ref <pushed-branch>`.
- **Tier 3 — before an RC/deploy from the branch, or after jumping many batches:** dispatch
  the full set — test.yml, docker.yml, static_analysis.yml, gallery-build-mobile.yml
  (`--field environment=development`), gallery-rebase-smoke.yml, storage-migration-tests.yml,
  storage-migration-e2e.yml (`--field branch=<ref>`) — plus profile live checks.

## Branch profiles

| Field            | explore/pi-agent-brainstorm                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rolling branch   | `explore/pi-agent-brainstorm-rolling` (local + origin)                                                                                                                                                                                                        |
| Frozen main line | `explore/pi-agent-brainstorm` (PR #574 — do NOT force-push until rolling lands on main)                                                                                                                                                                       |
| Fast suites (T1) | `pnpm --dir agent-runner test`                                                                                                                                                                                                                                |
| Full suites (T2) | `cd server && pnpm test`; `cd web && pnpm test`; `make check-web`; agent factory↔manifest parity test (in agent-runner suite)                                                                                                                                 |
| Regen targets    | OpenAPI (TS+Dart), `make sql`; capability-matrix doc block: `pnpm -C server run sync:agent-capabilities` (server script, runs from `dist`); workflow manifest: `node agent-runner/src/bin/sync-strict-workflow-manifest.mjs`; then re-run agent-runner vitest |
| Live checks (T3) | L1 eval: `agent-runner/eval/run.mjs` per `agent-runner/eval/README.md`; L3 via clone-personal skill (curated `eval/scenarios/l3-readonly.mjs`)                                                                                                                |
| Overlap hotspots | `asset.service/controller`, `media.repository` (sharp edits), `job/queue.service`, `enum.ts`/`types.ts`, `i18n/en.json`, people/spaces web routes, `docker-compose*`, `.github/workflows/test.yml`                                                            |

## Failure modes

- **Merge commits in replay range** (script refuses): someone merged origin/main into the
  branch since the last sync. Decide: if the merge brought main commits not yet in rolling's
  `integratedForkHead`, wait for fork-sync; otherwise flatten deliberately — seed rerere from
  the merge (`rerere-train.sh --no-walk <merge-sha>`), then rerun. Never auto-flatten.
- **Rolling branch renamed/restarted:** update the constant; `git merge-base --is-ancestor
$(git rev-parse 'rolling-base/<branch>^{commit}') <new-tip>` will fail — re-onboard from the
  branch's current state (its base = old rolling tip, still pinned by the tag).
- **Backups accumulate:** delete `origin/backup/<branch>-*` refs a few days after a sync
  proves stable.
- **Local tag is authoritative; `git fetch` never updates an existing local tag.** On any
  machine that didn't run the last sync, fetch it explicitly first:
  `git fetch origin "refs/tags/rolling-base/<branch>:refs/tags/rolling-base/<branch>" --force`.
  The script's ancestor guard refuses stale/foreign tags before any rebase.
- **Mistyped SHAs:** never hand-paste; always `git rev-parse` and verify with `git log -1`.
````

- [ ] **Step 2: Verify skill conventions**

Check (manually, against `superpowers:writing-skills` conventions): frontmatter has only `name` + `description`; description is third-person and trigger-focused; name is kebab-case matching the directory; no first-person voice in the body.

Run: `head -5 ~/.claude/skills/sync-branch-to-rolling/SKILL.md`
Expected: frontmatter opens with `name: sync-branch-to-rolling`.

- [ ] **Step 3: Re-run the sandbox harness (regression)**

Run: `bash ~/.claude/skills/sync-branch-to-rolling/test-sync.sh`
Expected: `ALL TESTS PASSED (phases A-E)`.

- [ ] **Step 4: Commit (in the skills repo)**

```bash
cd /Users/pierre/dev/claude-skills
git add skills/sync-branch-to-rolling/SKILL.md
git commit -m "feat(skills): sync-branch-to-rolling SKILL.md — modes, tiers, pi-agent profile"
```

---

### Task 5: Real-repo dry run (maintain mode on a scratch branch)

Validates the script against the real gallery repo + origin without touching any real branch. Uses a scratch branch whose "old base" is the parent of the current rolling tip, so the sync replays exactly one commit.

**Files:** none (operational validation)

- [ ] **Step 1: Create scratch worktree + branch + tag**

```bash
cd /Users/pierre/dev/gallery/.worktrees/explore-pi-agent-brainstorm
git fetch origin
ROLL_TIP="$(git rev-parse origin/rebase/upstream-rolling-complete-20260604)"
git worktree add /tmp/rolling-sync-dryrun -b scratch/rolling-sync-dryrun "${ROLL_TIP}^"
cd /tmp/rolling-sync-dryrun
echo "dry-run marker" > .rolling-sync-dryrun.txt
git add .rolling-sync-dryrun.txt
git commit -m "scratch: rolling-sync dry-run marker"
git tag "rolling-base/scratch/rolling-sync-dryrun" "${ROLL_TIP}^"
```

- [ ] **Step 2: Run the sync**

```bash
cd /tmp/rolling-sync-dryrun
~/.claude/skills/sync-branch-to-rolling/sync.sh scratch/rolling-sync-dryrun
```

Expected output: a backup push line, `Rebasing 1 own commits`, a one-row range-diff, `own commits: before=1 after=1`, and `Tag rolling-base/scratch/rolling-sync-dryrun -> <ROLL_TIP-or-newer> (pushed).`

Verify:

```bash
git rev-list --count "$(git rev-parse 'rolling-base/scratch/rolling-sync-dryrun^{commit}')..HEAD"   # expect: 1
ls .rolling-sync-dryrun.txt                                                                          # still present
```

(If the rolling branch gained batches since `ROLL_TIP` was captured, the sync lands on the newer tip — that is correct behavior, not a failure.)

- [ ] **Step 3: Clean up all artifacts (local + origin)**

```bash
cd /Users/pierre/dev/gallery/.worktrees/explore-pi-agent-brainstorm
git worktree remove /tmp/rolling-sync-dryrun --force
git branch -D scratch/rolling-sync-dryrun
git tag -d "rolling-base/scratch/rolling-sync-dryrun"
git push origin --delete "refs/tags/rolling-base/scratch/rolling-sync-dryrun"
git ls-remote origin 'refs/heads/backup/scratch/rolling-sync-dryrun-*' \
  | awk '{print $2}' | xargs -n1 git push origin --delete
```

Expected: `git ls-remote origin 'refs/*/scratch/rolling-sync-dryrun*'` returns nothing afterward.

---

### Task 6: Mark spec implemented + wrap up

**Files:**

- Modify: `docs/superpowers/specs/2026-06-10-sync-branch-to-rolling-skill-design.md:4` (gallery worktree)

- [ ] **Step 1: Update spec status**

Change the `**Status:**` line to:

```markdown
**Status:** Implemented 2026-06-10 (skill at `~/.claude/skills/sync-branch-to-rolling/`)
```

- [ ] **Step 2: Format + commit (gallery worktree)**

```bash
cd /Users/pierre/dev/gallery/.worktrees/explore-pi-agent-brainstorm
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx prettier --write docs/superpowers/specs/2026-06-10-sync-branch-to-rolling-skill-design.md
git add docs/superpowers/specs/2026-06-10-sync-branch-to-rolling-skill-design.md
git commit -m "docs: mark sync-branch-to-rolling spec implemented"
```

- [ ] **Step 3: Final regression run**

Run: `bash ~/.claude/skills/sync-branch-to-rolling/test-sync.sh`
Expected: `ALL TESTS PASSED (phases A-E)`.

---

## Out of scope (per spec)

- Executing the pi-agent onboarding — that is the skill's first ONBOARD run, a separate
  session with user checkpoints (audit table → approval → segmented replay → tiers → publish).
- Automation/cron, hooks into the rolling batch flow, dependent-branch registries.
