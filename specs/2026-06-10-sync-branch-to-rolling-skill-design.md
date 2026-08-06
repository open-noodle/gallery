# sync-branch-to-rolling Skill — Design

**Date:** 2026-06-10
**Status:** Implemented 2026-06-10 (skill at `~/.claude/skills/sync-branch-to-rolling/`)
**Artifact:** a new user-level Claude Code skill at `~/.claude/skills/sync-branch-to-rolling/`

## Problem

Long-running feature branches are based on `origin/main`, but the fork's true future base is
the rolling upstream rebase branch (`rebase/upstream-rolling-complete-20260604`), which
replays all fork commits onto new upstream tips and force-pushes per batch. When the rolling
branch eventually force-lands on `main` (held for Immich v3.0.0), every main-based
long-running branch faces a giant one-shot transfer. We want branches to ride the rolling
branch continuously instead, so the final transfer is a no-op.

The first consumer is `explore/pi-agent-brainstorm` (PR #574). Measurements from 2026-06-10:

- Branch tip `50e5bf3818`, forked from `origin/main` at `ca92ca6598`, **1403 own commits**
  including 4 "merge origin/main" commits (epochs of 1148 / 103 / 82 / 16 / 54 commits).
- Rolling canonical tip `e21f9d73` (batch 227); integrates origin/main through `a169f51aaa`,
  which is **ahead of** pi-agent's fork point.
- Collision surface: pi-agent touches 1028 files, rolling-vs-main delta touches 2067,
  **intersection only 88 files**, roughly half generated (open-api, `mobile/openapi/`,
  `.sql` query docs, lockfile).
- pi-agent adds 10 migrations to upstream-owned `server/src/schema/migrations/` and 2 to
  `migrations-gallery/` — a fork-convention violation to audit during onboarding.

Because the rolling branch is force-pushed each batch, a dependent branch must be re-rebased
with explicit old-base bookkeeping (`git rebase --onto NEW OLD`); git's fork-point detection
cannot work. This bookkeeping, plus regen/CI discipline, is what evaporates between sessions
— hence a skill.

## Decisions (brainstorm outcomes)

1. **Generic over any branch** — skill takes a branch name; per-branch state markers.
2. **Two modes** — one-time **onboard** (main-based → rolling-based) and recurring
   **maintain** (catch up after rolling batches).
3. **Manual trigger** — slash-command invocation only; no cron, no hook into the rolling
   batch flow.
4. **Skill + bundled script** — deterministic mechanics live in a helper script inside the
   skill directory (pattern: `clone-personal`); judgment (audit, conflict resolution, regen,
   CI) lives in the skill markdown.

## Design

### 1. Identity

User-level skill at `~/.claude/skills/sync-branch-to-rolling/`, sibling to
`rebase-upstream-report` and `push-rebase`. Description triggers on: onboarding a main-based
long-running branch onto the rolling rebase branch, or re-syncing such a branch after
rolling batches land.

### 2. State model

- **Base marker:** lightweight git tag `rolling-base/<branch>` pointing at the rolling-tip
  SHA the branch currently sits on (resolve via `rev-parse <tag>^{commit}`). Pushed to
  origin for recovery; moving it needs a forced tag push. The tag also pins the old —
  otherwise unreachable — base commits against GC after the rolling branch force-moves,
  which is what keeps future `--onto` invocations possible.
- **Backups:** before every force-push, create `backup/<branch>-YYYYMMDD-<short-sha>`
  (remote ref; SHA suffix avoids same-day collisions). Delete backups a few days after the
  sync proves stable, matching the `push-rebase` family convention.
- **Canonical rolling ref** is a named constant at the top of the skill
  (`origin/rebase/upstream-rolling-complete-20260604`), with an explicit instruction to
  update the constant if the rolling branch is restarted under a new name (stale
  `rolling-base/*` tags then require lineage verification / re-onboarding).
- **Hard rule:** the skill never writes `rolling-state.json` and never runs the
  `upstream-*` make targets. It is strictly downstream of the rolling operation.

### 3. Modes (auto-detected)

Tag `rolling-base/<branch>` **missing → onboard**:

1. Base = `git merge-base origin/main <branch>`. Onboarding precondition:
   `git merge-base --is-ancestor <base> <integratedForkHead>` — rolling must already
   contain everything the branch was built on. If the branch forked from a main commit
   newer than `integratedForkHead`, stop and wait until the rolling flow next runs
   `upstream-sync-fork-main`.
2. **Collision-surface audit → user checkpoint** (mini version of
   `rebase-upstream-report` step 2): changed-file intersection table with per-file risk;
   migration timestamp-collision check (server `migrations/` + `migrations-gallery/`,
   mobile Drift if touched); pattern-propagation check (upstream refactors in rolling that
   the branch's fork-only code should adopt, e.g. PUT→PATCH, dependency majors).
3. **rerere seeding**: if the branch contains "merge origin/main" commits, run
   `rerere-train.sh` over them (Homebrew git ships it at
   `/opt/homebrew/share/git-core/contrib/rerere-train.sh`; verified present, git 2.54.0).
   This pre-caches resolutions where the same conflict text recurs during the flattening
   rebase — helpful, not a guarantee. It temporarily checks out commits, so it needs a
   clean worktree.
4. **Segmented replay** at merge-commit epoch boundaries (sub-gate very large epochs at
   feature-milestone SHAs). Only the FIRST segment rebases onto the pinned rolling tip;
   every later segment chains onto the previous segment's rebased result:

   ```bash
   git rebase --onto <pinned-rolling-tip> <merge-base> <epoch1-tip>   # → H1 (detached HEAD)
   git rebase --onto H1 <epoch1-tip> <epoch2-tip>                     # → H2
   # ...repeat per epoch; after the final segment, create the publish-target branch
   # (the original <branch> stays frozen at its main-based head — see section 6):
   git switch -c <branch>-rolling
   ```

   Build/type gate per segment (`make check-server` + direct `tsc --noEmit`). Conflict
   resolutions documented in the `rebase-upstream-report` entry format. Commits whose
   content already exists in rolling (e.g. fork-synced via origin/main) are auto-dropped
   by rebase — expected, and the final range-diff accounts for them.

5. Regen pass, verification tiers, publish (sections 5–6).

Tag **present → maintain**:

1. `NEW = rev-parse <canonical rolling ref>` after fetch; if the tip's batch is not yet
   CI-green, use the last green batch SHA instead. Authoritative source: `appendHistory`
   in `rolling-state.json` on the rolling branch (read-only), which records each batch's
   CI runs; fallback `gh --repo open-noodle/gallery run list` on the batch branch.
2. `git rebase --onto NEW $(git rev-parse 'rolling-base/<branch>^{commit}') <branch>` —
   replays only the branch's own commits; near-zero conflicts expected thanks to rerere.
3. Gate, retag, push (sections 5–6).

### 4. Bundled script (`sync.sh` in the skill directory)

Deterministic mechanics only. Inputs: branch name, optional explicit new-base ref.

- **Refuses to run when:** worktree dirty; rebase/cherry-pick already in progress; tag
  missing (instructs to use onboard mode); branch not checked out in the current worktree.
- **Does:** `git fetch`; resolve full SHAs via `rev-parse` (never hand-pasted SHAs);
  create backup ref; run the `rebase --onto`; on success print a `git range-diff` summary
  and own-commit-count comparison; move the `rolling-base/<branch>` tag; print next-step
  gates.
- **On conflict:** exits non-zero leaving the rebase in progress; the skill prose takes
  over with the documented-resolution discipline. The script also detects merge commits in
  the replay range (new "merge origin/main" merges since last sync) and stops for judgment.

### 5. Verification tiers + branch profiles

- **Tier 1 — every sync:** `make check-server` + direct `tsc --noEmit` + the profile's
  fast suites.
- **Tier 2 — conflicts occurred, or the computed overlap is non-empty** (per sync,
  intersect `git diff --name-only OLD NEW` with the branch's own touched files; the
  profile's hotspot list is advisory context, not the trigger, since each batch changes
  the overlap): full regen pass (OpenAPI
  TypeScript **and** Dart, `make sql`, generated manifests, lockfile, i18n format) + full
  local suites + dispatch `test.yml` (`gh --repo open-noodle/gallery`).
- **Tier 3 — before an RC deploy or after jumping many batches:** the full workflow
  dispatch set (test, docker, static_analysis, gallery-build-mobile, gallery-rebase-smoke,
  storage-migration ×2), plus profile-specific live checks.

**Branch profiles** are a table in the skill markdown; each registered branch lists its
fast suites, full suites, regen targets, overlap hotspots, and publish target. First
profile — `explore/pi-agent-brainstorm`: agent-runner + server vitest suites, L1 eval,
factory↔manifest parity test, overlap hotspots from the 88-file audit, publish target =
rolling-suffixed branch name (see section 6), RC tag convention for live L3.

### 6. Safety rules

- Force-push only after Tier 1 is green and the range-diff has been reviewed; backup ref
  must exist.
- Publish target is per-profile: a rolling-based branch must **not** be force-pushed over
  the head of a PR that targets `main` (merge-base becomes ancient; diff explodes). For
  pi-agent: keep PR #574 frozen on the main-based head; push the rolling-based line as
  `explore/pi-agent-brainstorm-rolling` until the rolling branch lands on main, then
  force-push over the PR branch (diff snaps back to clean).
- To make accidental pushes structurally impossible, onboarding **renames the local
  branch to match the publish target** (e.g. local `explore/pi-agent-brainstorm-rolling`),
  leaving the old local name frozen at the main-based head alongside the backup ref. A
  habitual `git push` then targets the rolling-suffixed remote branch, never the PR head.
  The profile records both names.
- Always `git rev-parse` full SHAs before use (mistyped-SHA burn from the rolling work).
- If the canonical rolling branch was restarted/renamed, stop and verify lineage before
  trusting any `rolling-base/*` tag.

### 7. Out of scope

- Automation (cron/loop) and hooks into the rolling batch flow.
- A dependent-branch registry inside `rolling-state.json`.
- The actual pi-agent onboarding execution — that is the skill's first run, with the user
  at the checkpoints, not part of building the skill.

### 8. Validation plan

- **Maintain mode:** dry-run on a scratch branch cut from one batch behind the rolling tip
  (a real, conflict-free sync); exercise the script's refusal paths (dirty worktree,
  missing tag, merge-in-range).
- **Onboard mode:** validated by the real pi-agent transfer (audit checkpoint → segmented
  replay → tiers → publish), with results fed back into the skill (per
  `superpowers:writing-skills` discipline).

## Appendix: pi-agent first-onboarding facts (2026-06-10)

For the skill's first onboard run; re-measure before executing if days have passed.

- Branch: `explore/pi-agent-brainstorm` @ `50e5bf3818`; merge-base with origin/main:
  `ca92ca6598`; 1403 own commits; main-merge epoch boundaries (cumulative own-commit
  counts from base): `77ed209fdd` (1148), `85678669a1` (1251), `16774a22ca` (1333),
  `c3b434fa4a` (1349), tip (1403).
- Rolling canonical: `rebase/upstream-rolling-complete-20260604` @ `e21f9d73` (batch 227,
  2026-06-10) — pin only a CI-green batch tip.
- 88 overlapping files; hand-resolution hotspots: `asset.service/controller`,
  `media.repository` (sharp edits), `job/queue.service`, `enum.ts`/`types.ts`,
  `i18n/en.json`, people/spaces web routes, `docker-compose*`, `test.yml`.
- Audit flags: 10 agent migrations live in upstream-owned `server/src/schema/migrations/`
  (decide relocation to `migrations-gallery/`); check PUT→PATCH (#28859) against agent
  endpoints; pnpm v11 / vitest 3.2.6 ripple.
- No mobile Drift exposure (only generated `mobile/openapi/` touched — regen covers it).
