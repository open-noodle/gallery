# Upstream Rebase Process Plan Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coordinate the phased implementation of manifest-driven, batch-aware upstream rebase tooling without one oversized plan.

**Architecture:** The work is split into independently reviewable phase plans. Each phase leaves the repository in a working state, commits its own changes, and hands stable contracts to the next phase.

**Tech Stack:** Markdown planning docs, TypeScript, Node.js, commander, yaml, micromatch, Vitest, pnpm workspace, Makefile.

---

## Phase Files

Execute the phase plans in this order:

1. `docs/superpowers/plans/2026-05-04-upstream-rebase-process-01-manifest-foundation.md`
2. `docs/superpowers/plans/2026-05-04-upstream-rebase-process-02-preflight-batching.md`
3. `docs/superpowers/plans/2026-05-04-upstream-rebase-process-03-audits.md`
4. `docs/superpowers/plans/2026-05-04-upstream-rebase-process-04-skill-rollout.md`

The design source is `docs/superpowers/specs/2026-05-04-upstream-rebase-process-design.md`.

## Shared Rules

- Work only in `/home/pierre/dev/gallery/.claude/worktrees/upstream-rebase-process` on branch `plan/upstream-rebase-process`.
- Do not update `main` from this worktree.
- Do not modify unrelated dirty files in `/home/pierre/dev/gallery`.
- Keep generated reports under `$(git rev-parse --git-path upstream-preflight)` so source status stays clean.
- Treat `make mobile-drift-rebase-check` failing on the current upstream backlog as correct only when it identifies the shipped Gallery v23/v24 collision and recommends renumbering incoming upstream migrations above Gallery v24.

## Deferred Follow-Ups

The phase plans implement design phases 1 through 4. They also surface phase 6
fork-surface reduction signals in the preflight report. Phase 5 advisory CI gates
remain a documented follow-up: after the local tooling proves stable, add a
workflow for `rebase/upstream-*` branches that runs `make upstream-preflight`,
`make upstream-postrebase-audit`, `make ci-invariants-check`, and
`make fork-patches-check` without blocking normal development branches.

### Task 0: Baseline Check

**Files:**

- Read: `docs/superpowers/specs/2026-05-04-upstream-rebase-process-design.md`
- Read: `docs/superpowers/plans/2026-05-04-upstream-rebase-process-01-manifest-foundation.md`

- [ ] **Step 1: Confirm the worktree**

Run:

```bash
git status --short --branch
git log --oneline --decorate --max-count=3
```

Expected:

```text
## plan/upstream-rebase-process...origin/main [ahead 2, behind 1]
c27979452 (HEAD -> plan/upstream-rebase-process) docs: split upstream rebase process plan
```

- [ ] **Step 2: Confirm dependency baseline**

Run:

```bash
pnpm install --frozen-lockfile
pnpm --dir docs exec prettier --check superpowers/specs/2026-05-04-upstream-rebase-process-design.md
```

Expected: both commands exit 0.

- [ ] **Step 3: Start Phase 1**

Open:

```bash
sed -n '1,260p' docs/superpowers/plans/2026-05-04-upstream-rebase-process-01-manifest-foundation.md
```

Expected: the phase begins with workspace package scaffolding and ownership manifest work.
