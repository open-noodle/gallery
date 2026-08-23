# PR RC builds: incrementing tags + cleanup on close

**Date:** 2026-07-25
**Status:** Approved (design)
**Supersedes parts of:** [2026-07-23-auto-rc-build-pr-comment-design.md](./2026-07-23-auto-rc-build-pr-comment-design.md)

## Goal

Every RC build of a labelled PR publishes its own immutable image tag — `pr-<number>-rc.0`,
`pr-<number>-rc.1`, … — instead of overwriting a single `pr-<number>` tag on every push.

A tester therefore always knows exactly which build they are running, can stay on a known-good RC
while a fix is in flight, and can bisect a regression across RCs ("rc.2 was fine, rc.3 broke it").
Because tags now accumulate, all of a PR's RC tags are deleted from GHCR when the PR closes.

## What changes

| Behaviour                  | Before                              | After                                         |
| -------------------------- | ----------------------------------- | --------------------------------------------- |
| Server tag                 | `pr-837` (overwritten every build)  | `pr-837-rc.<N>`, N increments per build       |
| ML tag (with `rc-ml`)      | `pr-837`                            | `pr-837-rc.<N>`, same N as the server build   |
| Floating "latest RC" tag   | `pr-837` served this role           | none — dropped deliberately (see below)       |
| Sticky comment             | latest build only; wiped on failure | latest + history table; failure adds a banner |
| GHCR lifecycle             | tags accumulate forever             | all `pr-<n>` RC tags deleted on PR close      |
| Manual `workflow_dispatch` | caller supplies `rc_tag`            | unchanged                                     |

**No floating alias.** Re-pointing `pr-837` at the newest build was considered and rejected: it
would reintroduce exactly the mutable tag this change removes, so a tester pinning it would still
get silently-swapped images and would still have no way back to a previous build. The cost is that
a tester following a PR must update the tag in their override for each new RC; the sticky comment
gives them the line to paste.

## Tag scheme

```
pr-<pr-number>-rc.<n>        n starts at 0, per PR
```

- Numbering is **per PR** — every PR starts at `rc.0`.
- Server and ML share one number per build, so `gallery-server:pr-837-rc.3` and
  `gallery-ml:pr-837-rc.3` are always the same commit.
- Accepted unchanged by the existing `validate` job in `gallery-rc-build.yml`: it matches
  `^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$` and rejects only `release`/`latest`/`v<N>`/`v<N>.<N>.<N>`.

## Where N comes from

**The registry is the source of truth, not the PR comment.** A new `resolve` job queries the GHCR
tag list for `gallery-server`, filters tags matching `^pr-<number>-rc\.([0-9]+)$`, and emits
`max + 1` (or `0` when there are none).

```
GET https://ghcr.io/v2/open-noodle/gallery-server/tags/list?n=1000
```

Verified live against the real registry while designing this: 519 tags return in a single page,
no `Link` header.

Deriving the counter from the sticky comment was rejected — deleting or editing the comment would
reset the counter and overwrite live tags. The registry cannot disagree with itself.

The failure mode that matters is _silently_ resolving a number that already exists, which
reintroduces overwriting. Three guards, all fail-closed:

1. `set -euo pipefail` with `curl -fsS` — any registry/API error fails the job. The build does not
   run, and the comment job reports it as a failed RC (see the gate in §3). Never fall back to `0`.
2. Follow `Link: …; rel="next"` while present. Not needed today, but a silently truncated page past
   the registry's cap would restart the counter at 0.
3. Request the registry token with `GITHUB_TOKEN` (job needs `packages: read`) rather than
   anonymously, so resolution keeps working if the package is ever made private.

### Concurrency grouping (bug found during live validation)

The per-PR group `pr-rc-<number>` with `cancel-in-progress: true` was cancelling builds it had
no business cancelling. **Concurrency is evaluated at workflow level, before any job `if:` gate**,
so a run triggered by an unrelated label — `changelog:chore`, say — joined the group and killed an
in-flight RC build, even though every job in that run then skipped. Observed live: adding
`changelog:chore` to PR #845 cancelled its running `rc.0` build, and because the comment job
correctly declines to run on `cancelled`, the PR was left with no build and no comment.

This predates the change, but numbered tags make it worse: builds die silently instead of producing
their number, so the visible history has holes with no explanation.

Fix: only RC-relevant events share the per-PR group. Everything else gets a unique group keyed on
`github.run_id`, so it cancels nothing.

```yaml
group: >-
  ${{ (github.event.action == 'synchronize' ||
       github.event.label.name == 'rc' ||
       github.event.label.name == 'rc-ml')
      && format('pr-rc-{0}', github.event.pull_request.number)
      || format('pr-rc-ignored-{0}', github.run_id) }}
```

`github.event.label` is absent on `synchronize`; a missing property evaluates to `null`, so the
comparisons are simply false rather than an error.

### Races and cancellation

- Two rapid pushes: the caller's `concurrency: pr-rc-<number>, cancel-in-progress: true` cancels the
  older run. A run cancelled before its manifest push leaves no tag, so the next run resolves the
  **same** number and reuses it. Nothing is lost or skipped.
- If the older run had already pushed its manifest before being cancelled, the tag exists, so the
  next run resolves `N+1`. Correct either way — this falls out of using the registry as the counter.
- A failed build burns no number: the tag was never pushed, so the next attempt resolves the same N.
- Cross-PR builds cannot collide: the pattern is anchored on the PR number, and `^pr-837-rc\.` never
  matches `pr-8371-rc.0`.
- **Reopened PRs restart at `rc.0`** if cleanup already ran on close. The comment's history table
  then references deleted tags. Accepted — reopen-after-close is rare and the images are gone
  anyway.

## Components

### 1. `gallery-rc-build.yml` — unchanged

The reusable workflow already takes `rc_tag` as an input and is agnostic to its shape. No edits.

### 2. `gallery-pr-rc-comment.yml` — new `resolve` job

Runs before `build`, on the same `if:` gate the `build` job uses today (same-repo head, plus the
`labeled`/`synchronize` label conditions).

```yaml
resolve:
  name: Resolve RC number
  if: <same gate as build today>
  runs-on: ubuntu-latest
  permissions:
    packages: read
  outputs:
    rc_tag: ${{ steps.next.outputs.rc_tag }}
```

`build` then gains `needs: resolve` and passes `rc_tag: ${{ needs.resolve.outputs.rc_tag }}`
instead of the literal `pr-<number>`. Its own `if:` gate is **removed** rather than duplicated: a
job whose `needs` was skipped or failed is skipped by default, so the single gate on `resolve` now
controls the whole chain and there is only one place to get it wrong.

The PR number reaches the script through `env:`, never interpolated into the `run:` body
(template-injection / zizmor).

### 3. `gallery-pr-rc-comment.yml` — comment gains history

The comment keeps its existing marker `<!-- gallery-rc-build-comment -->` and the existing
find-by-marker + `user.type === 'Bot'` lookup. It gains a second hidden line holding state:

```
<!-- gallery-rc-state: {"builds":[{"tag":"pr-837-rc.2","sha":"abc1234","runId":123,"at":"…","ml":true}]} -->
```

State lives in the comment (not the registry) because the registry knows tags but not which commit
or run produced them. It is presentation data only — losing it cannot corrupt the counter, which is
the whole point of resolving N from the registry.

Rendered body:

- **Latest RC** — tag, short SHA linked to the commit, link to the build run, the image list, and
  the existing `docker-compose.override.yml` / `docker compose pull` instructions, now pinning the
  numbered tag.
- **Previous builds** — a collapsed table of tag → commit → date, most recent 10, older entries
  dropped with an explicit "older builds omitted" line rather than silently truncated.
- **On failure** — a banner above the latest-RC block naming the failed commit and linking the run.
  The last good RC block stays intact and pullable. This replaces today's behaviour of wiping the
  whole body with a failure message.

Only **successful** builds are appended to the history table. A number retried after a failure
therefore appears exactly once, and the table never shows the same tag twice with different commits.

The job's gate has to widen, because `resolve` sits in front of `build`: if `resolve` fails, `build`
resolves to `skipped`, and today's `needs.build.result != 'skipped'` guard would suppress the
comment entirely — a labelled PR would go silent. New gate:

```yaml
comment:
  needs: [resolve, build]
  if: >
    always() &&
    needs.resolve.result != 'skipped' && needs.resolve.result != 'cancelled' &&
    needs.build.result != 'cancelled'
```

| resolve   | build     | comment                                   |
| --------- | --------- | ----------------------------------------- |
| skipped   | skipped   | none — the PR isn't labelled for RC       |
| failure   | skipped   | failure banner (no tag available to name) |
| success   | failure   | failure banner naming the tag             |
| success   | success   | full RC block, history appended           |
| cancelled | —         | none — superseded run                     |
| success   | cancelled | none — superseded run                     |

Keying on `resolve` rather than `build` preserves the original intent of the `!= 'skipped'` guard
(no comment on unlabelled PRs) while making resolve failures visible. The `cancelled` exclusions
stay: a superseded run must never overwrite a good comment with a spurious failure.

The failure banner must render without an `rc_tag` — when `resolve` is what failed, there is no tag
to name.

### 4. `gallery-pr-rc-cleanup.yml` — new workflow

```yaml
on:
  pull_request_target:
    types: [closed]
```

**`pull_request_target`, not `pull_request`** — corrected after PR #845's own merge. A
`pull_request` run reads its own workflow definition from `refs/pull/<n>/merge`, which GitHub
**deletes when the PR merges**. Lose that race and the run fails at startup with zero jobs
("This run likely failed because of a workflow file issue"), the PR's RC tags are orphaned
forever, and re-running cannot help because the ref is permanently gone (confirmed: attempt 2
failed identically, and `refs/pull/845/merge` returns 404). The same merge took
`cache-cleanup.yml` down with it — same trigger, untouched for months, 19/20 prior successes —
which is what rules out the workflow file itself. It usually works, which makes it worse: the
failure is intermittent and silent.

`pull_request_target` reads the workflow from the base branch, which always exists.

The usual `pull_request_target` hazard — running untrusted PR code with a write-capable token —
does not apply: the job never checks out the PR and never executes anything from it. It is one
first-party `github-script` step whose only PR-derived input is the PR number, an integer
interpolated into a regex. zizmor's `dangerous-triggers` audit is suppressed inline with that
justification, matching the existing `# zizmor: ignore[...]` precedent in `gallery-rc-build.yml`.
`auto-close.yml` and `close-duplicates.yml` already use `pull_request_target` in this repo.

Kept in its own file rather than as a job in
`gallery-pr-rc-comment.yml` so a PR-close event does not join the build workflow's
`cancel-in-progress` group and cancel an in-flight build, and so `packages: write` is scoped to
this workflow alone.

Behaviour: for both `gallery-server` and `gallery-ml`, page through
`GET /orgs/open-noodle/packages/container/{package}/versions` and delete every version whose tags
are **entirely** contained in `^pr-<number>(-rc\.[0-9]+)?$`.

- The bare `pr-<number>` alternative sweeps tags left behind by the previous scheme.
- "Entirely contained" is the safety property: if a version carries any tag outside the set (an
  identical digest also tagged `release`, say), it is left alone. Deleting a version deletes the
  digest and every tag pointing at it.
- Runs for same-repo PRs only. A `pull_request` run from a fork gets a read-only token and could
  not delete anyway.
- Runs regardless of whether the `rc`/`rc-ml` label is still present at close time — a label removed
  before closing would otherwise orphan the tags forever. When there is nothing to delete it is a
  cheap no-op.
- Missing package (`404`) is not an error: a PR that never built ML has no ML versions.

## Risks and open items

- **`GITHUB_TOKEN` package-delete rights.** The repo has no packages PAT — only
  `secrets.GITHUB_TOKEN` (confirmed by grepping every workflow). Deleting org-owned container
  package versions with the workflow token works when the repo has admin on the package, which
  should hold since this repo's workflows push it, but it is a known sharp edge. **Verify live on a
  real PR before calling this done.** If it 403s, the fallback is a PAT with `delete:packages`
  stored as a repo secret; that would be a follow-up decision, not a silent substitution.
- **Untagged child manifests.** Deleting a multi-arch manifest list leaves its per-arch children in
  GHCR as untagged versions. Pruning those is a separate sweep and is out of scope here.

## Testing strategy

`pull_request`-triggered workflows run from the PR branch, so all of this is verifiable on its own
PR before merging. Every case gets observed, not assumed:

1. Label `rc` on a PR with no prior RC tags → builds `pr-<n>-rc.0`; comment shows it with no history
   table.
2. Push again → builds `pr-<n>-rc.1`; **both** tags exist in GHCR; the same comment (single comment,
   same id) now shows rc.1 as latest with rc.0 in history.
3. Confirm `pr-<n>` (unsuffixed) is **not** created or moved.
4. Add `rc-ml` → next build produces `gallery-ml:pr-<n>-rc.<N>` at the same N as the server image,
   and the compose snippet pins both.
5. Force a failure → banner appears, previous latest-RC block and history survive intact.
6. Confirm multi-arch (amd64 + arm64) on a numbered tag.
7. Close the PR → every `pr-<n>` and `pr-<n>-rc.*` tag disappears from both packages; unrelated tags
   untouched.

Workflow YAML has no local unit-test surface beyond the `actionlint`/`zizmor` static checks the repo
already runs, so verification is by observing Actions runs, GHCR tag lists, and the comment.

## Documentation

`AGENTS.md` (and the mirrored `CLAUDE.md` section) documents the old `pr-<number>` tag under
**Automatic PR RC builds** — update to describe the numbered scheme and the delete-on-close
behaviour.

## Out of scope (YAGNI)

- Pruning untagged child manifests left by manifest-list deletion.
- Deleting RC tags when the `rc` label is removed from an open PR (close is the lifecycle boundary).
- Retention while the PR is open — all RCs are kept until close. Revisit only if GHCR gets noisy.
- An interim "building…" comment before the build completes.
