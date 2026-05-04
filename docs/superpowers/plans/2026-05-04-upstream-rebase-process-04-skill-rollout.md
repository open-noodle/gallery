# Upstream Rebase Skill Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stale skill-owned fork inventory with repo-owned tooling references and verify the full rebase process.

**Architecture:** Repo tooling stays committed on the implementation branch. The local `rebase-upstream-report` skill is updated separately as an operator workflow file outside the repository.

**Tech Stack:** Markdown, local Codex skill files, Makefile, pnpm, TypeScript, Vitest.

---

## File Structure

- Modify: `/home/pierre/.codex/skills/rebase-upstream-report/SKILL.md`
  - Replaces embedded inventory and one-shot rebase flow with manifest-driven batched orchestration.
- Read: `docs/fork/ownership.yml`
  - Skill source of truth for fork feature ownership.
- Read: `tools/upstream-preflight/src/index.ts`
  - CLI command source.
- Read: `Makefile`
  - Operator command source.

### Task 1: Rewrite Local Rebase Skill

**Files:**

- Modify: `/home/pierre/.codex/skills/rebase-upstream-report/SKILL.md`

- [ ] **Step 1: Back up the current skill file**

Run:

```bash
cp /home/pierre/.codex/skills/rebase-upstream-report/SKILL.md /home/pierre/.codex/skills/rebase-upstream-report/SKILL.md.bak-2026-05-04
test -f /home/pierre/.codex/skills/rebase-upstream-report/SKILL.md.bak-2026-05-04
```

Expected: backup file exists.

- [ ] **Step 2: Replace the source-of-truth section**

Edit `/home/pierre/.codex/skills/rebase-upstream-report/SKILL.md` so the first major section after the intro is:

````markdown
## Source Of Truth

Fork feature ownership lives in `docs/fork/ownership.yml`.

Before any upstream sync, run:

```bash
make upstream-preflight
make upstream-batch-plan
```

Do not manually reconstruct the fork feature inventory from this skill. If the
manifest is missing a fork feature, update the manifest first.
````

- [ ] **Step 3: Replace one-shot rebase flow with batched flow**

Replace the old process section with:

```markdown
## Process

1. Create a fresh worktree.
2. Fetch `upstream/main`.
3. Run `make upstream-preflight`.
4. Review and approve the generated risk report.
5. Run `make upstream-batch-plan`.
6. Rebase one recommended batch at a time.
7. After each batch, run `make upstream-postrebase-audit` and the batch's required checks.
8. Push high-risk batches to `rebase/upstream-batch-NN` when remote CI signal is useful.
9. Continue until the final batch reaches `upstream/main`.
10. Run full local and remote CI.
11. Back up and force-push `main` only after the final result is green.
```

- [ ] **Step 4: Fix the mobile Drift contradiction**

Run:

```bash
rg -n "fork v23/v24 must be renumbered|renumber fork" /home/pierre/.codex/skills/rebase-upstream-report/SKILL.md
```

Replace matching text with:

```markdown
If upstream adds mobile Drift versions that collide with shipped Gallery
versions, keep Gallery's shipped versions unchanged and renumber incoming
upstream migrations above Gallery's current highest version.
```

- [ ] **Step 5: Remove stale inventory facts**

Run:

```bash
rg -n "0\\.69\\.0|27 migrations|Skill Sync Anchor|Fork-Specific Features Checklist|Fork CI Modifications" /home/pierre/.codex/skills/rebase-upstream-report/SKILL.md
```

Replace hardcoded inventory tables with:

````markdown
## Fork Compatibility Checks

Run these checks after each high-risk batch and before final push:

```bash
make upstream-postrebase-audit
make ci-invariants-check
make fork-patches-check
```

These checks read `docs/fork/ownership.yml` and `pnpm-workspace.yaml`.
````

- [ ] **Step 6: Verify the skill has no stale known-bad strings**

Run:

```bash
rg -n "0\\.69\\.0|fork v23/v24 must be renumbered|27 migrations" /home/pierre/.codex/skills/rebase-upstream-report/SKILL.md
```

Expected: no matches.

### Task 2: Full Tool Verification

**Files:**

- Read: `docs/fork/ownership.yml`
- Read: `tools/upstream-preflight/**`
- Read: `Makefile`

- [ ] **Step 1: Run package verification**

Run:

```bash
pnpm --filter @gallery/upstream-preflight run test
pnpm --filter @gallery/upstream-preflight run check
pnpm --filter @gallery/upstream-preflight run format
```

Expected: all commands pass.

- [ ] **Step 2: Run normal Makefile entry points**

Run:

```bash
make upstream-preflight
make upstream-batch-plan
make upstream-postrebase-audit
make ci-invariants-check
make fork-patches-check
```

Expected: commands pass unless a manifest-forbidden workflow string is present. If `make ci-invariants-check` fails, the output identifies the exact workflow and forbidden pattern.

- [ ] **Step 3: Verify intended mobile Drift failure on the current backlog**

Run:

```bash
make mobile-drift-rebase-check
```

Expected on the current upstream backlog: non-zero exit and output containing:

```text
Upstream touches shipped Gallery Drift version v23
Upstream touches shipped Gallery Drift version v24
renumber incoming upstream migrations to v25/v26
```

- [ ] **Step 4: Verify generated artifacts stay out of source**

Run:

```bash
git status --short
find "$(git rev-parse --git-path upstream-preflight)" -maxdepth 2 -type f | sort
```

Expected:

- `git status --short` lists only intentional source edits.
- generated reports live under `$(git rev-parse --git-path upstream-preflight)`.

### Task 3: Final Commit And Handoff

**Files:**

- Modify: `docs/fork/ownership.yml`
- Modify: `tools/upstream-preflight/**`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `Makefile`
- Read: `/home/pierre/.codex/skills/rebase-upstream-report/SKILL.md`

- [ ] **Step 1: Commit remaining repo files**

Run:

```bash
git add docs/fork/ownership.yml tools/upstream-preflight pnpm-workspace.yaml pnpm-lock.yaml Makefile
git commit -m "feat: add upstream rebase process tooling"
```

Expected: commit succeeds if previous phase commits did not already include all files.

- [ ] **Step 2: Record local skill update separately**

Run:

```bash
git status --short
```

Expected: repo status is clean or contains only intentionally uncommitted generated files. The skill update is outside the repo and does not appear in `git status`.

- [ ] **Step 3: Prepare final implementation summary**

Use this summary shape:

```markdown
Implemented:

- ownership manifest
- upstream preflight report
- risk-aware batch planner
- mobile Drift collision audit
- CI invariant and patch checks
- post-rebase audit
- local rebase skill rewrite

Verification:

- pnpm --filter @gallery/upstream-preflight run test
- pnpm --filter @gallery/upstream-preflight run check
- make upstream-preflight
- make upstream-batch-plan
- make upstream-postrebase-audit
- make ci-invariants-check
- make fork-patches-check
- make mobile-drift-rebase-check (expected failure on current upstream v23/v24 collision)
```
