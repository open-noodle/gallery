# Auto RC build + sticky PR comment

**Date:** 2026-07-23
**Status:** Approved (design)

## Goal

When a pull request is labelled for release-candidate testing, automatically build a
release-candidate `gallery-server` image from the PR's current commit and post a single,
always-current PR comment telling a tester how to run it. Every subsequent push to the PR
rebuilds and updates that same comment, so the comment always points at the latest RC build.

Machine-learning image builds are opt-in via a second label.

## Triggering model

Opt-in by label, no CI "green" gate (dropped during brainstorming — the RC build compiles the
server itself, so gating on the test suite added complexity without value here).

- **`rc`** label → build the server RC image.
- **`rc-ml`** label → additionally build the CPU ML image under the same tag.

A build fires when:

- the PR receives the `rc` **or** `rc-ml` label (`labeled` event), or
- a new commit is pushed to a PR that already carries `rc` **or** `rc-ml` (`synchronize` event).

`build_ml` is true **only** when the `rc-ml` label is present; otherwise the build is server-only
and ML continues to be pulled from its usual `release` tag.

Fork PRs are skipped (not failed): a `pull_request` run from a fork gets a read-only token with no
package-write permission, so the GHCR push would fail. Guarding on same-repo head avoids a
confusing red run on external contributions.

## Components

### 1. `gallery-rc-build.yml` — make reusable (edit)

Add a `workflow_call:` trigger next to the existing `workflow_dispatch:`, mirroring the same four
inputs so `inputs.*` resolves identically for both entry points:

| input          | type    | required | default | notes                                |
| -------------- | ------- | -------- | ------- | ------------------------------------ |
| `rc_tag`       | string  | yes      | —       | custom image tag                     |
| `ref`          | string  | no       | `''`    | git ref/SHA to build                 |
| `fork_version` | string  | no       | `''`    | override stamped fork version        |
| `build_ml`     | boolean | no       | `false` | also build CPU ML under the same tag |

**Nothing else changes.** Job bodies (`validate`, `build-server`, `merge-server`, `build-ml`,
`merge-ml`, `summary`) are untouched — they already read `inputs.*` and are agnostic to which
trigger fired. The manual `workflow_dispatch` path keeps working exactly as before. The existing
tag-shape validation (`validate` job) already rejects reserved tags and accepts `pr-<number>`.

The reusable workflow keeps its own `concurrency` block. When called, `github.workflow` resolves to
the **caller** workflow name, so the manual-dispatch path and the auto path land in **different**
concurrency groups — a manual dispatch using a colliding `rc_tag` (e.g. `pr-123`) could therefore run
concurrently with the auto PR build and race on pushing that tag (last writer wins). This is
accepted as low-likelihood and non-destructive; the per-PR caller group (`pr-rc-<number>`,
`cancel-in-progress: true`) is what actually prevents stacked builds for the same PR.

### 2. `gallery-pr-rc-comment.yml` — new orchestrator

```yaml
on:
  pull_request:
    types: [labeled, synchronize]

concurrency:
  group: pr-rc-${{ github.event.pull_request.number }}
  cancel-in-progress: true # a newer push supersedes an in-flight build+comment

permissions: {}
```

`cancel-in-progress: true` means rapid pushes don't pile up N builds — the newest supersedes older
in-flight runs, and only the newest comment survives.

#### Job `build` (calls the reusable workflow)

```yaml
build:
  if: >
    github.event.pull_request.head.repo.full_name == github.repository &&
    (
      (github.event.action == 'labeled'
        && (github.event.label.name == 'rc' || github.event.label.name == 'rc-ml'))
      ||
      (github.event.action == 'synchronize'
        && (contains(github.event.pull_request.labels.*.name, 'rc')
            || contains(github.event.pull_request.labels.*.name, 'rc-ml')))
    )
  permissions:
    contents: read
    packages: write
  uses: ./.github/workflows/gallery-rc-build.yml
  with:
    rc_tag: pr-${{ github.event.pull_request.number }}
    ref: ${{ github.event.pull_request.head.sha }}
    build_ml: ${{ contains(github.event.pull_request.labels.*.name, 'rc-ml') }}
```

- The whole gate lives in the job-level `if:` — when it is false, no runner is consumed and the
  job is `skipped`.
- **Tag `pr-<number>`** is stable and overwritten on every build. A tester pins
  `image: …:pr-123` once and just re-pulls to get each new build.
- **`ref: head.sha`** builds the exact pushed commit (immutable provenance), not a base-merge.
- `GITHUB_TOKEN` is automatically available to the reusable workflow — no `secrets: inherit` needed
  (the build uses only `secrets.GITHUB_TOKEN`).

#### Job `comment` (sticky comment)

```yaml
comment:
  needs: build
  if: always() && needs.build.result != 'skipped'
  runs-on: ubuntu-latest
  permissions:
    pull-requests: write
  steps:
    - uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
      with:
        script: | # find-by-marker then edit-or-create
```

- Runs whenever the build actually ran (`!= 'skipped'`), covering **both** success and failure —
  so the comment is never left showing a stale success after a failed rebuild.
- Finds an existing comment by a hidden HTML marker `<!-- gallery-rc-build-comment -->` and edits
  it in place via `github.rest.issues.updateComment`; otherwise creates one with
  `github.rest.issues.createComment`. First-party `actions/github-script`, pinned to the SHA already
  used elsewhere in the repo — no new third-party dependency.
- `needs.build.result` distinguishes success from failure; the comment body branches accordingly.
- The job deliberately does **not** run when `needs.build.result == 'cancelled'`, so a superseded
  run (cancelled by a newer push via `cancel-in-progress`) cannot overwrite a good comment with a
  spurious failure message.

## Comment content

The body mirrors the tester instructions the existing `summary` job writes to the run summary,
adapted for a PR comment and kept always-current.

On **success**:

- heading, e.g. `🧪 Release candidate build`
- latest image: `ghcr.io/open-noodle/gallery-server:pr-<number>` (and the ML image line only when
  `rc-ml` built it)
- the commit SHA it was built from (short, linked) + a link to the build run
- `docker-compose.override.yml` snippet pinning the server image (and ML image when built)
- `docker compose pull … && docker compose up -d` instructions + rollback note
- a "last updated" line

On **failure**: the same comment is updated to state the latest RC build failed, with a link to the
run logs, so the visible comment always reflects reality.

Untrusted PR data (branch name, title) is passed to `github-script` via `env`/context, never
interpolated into a shell `run:` — avoids template-injection (zizmor).

## Setup / one-time

- Create the `rc` and `rc-ml` labels in the repo (neither exists today). `rc-ml` does not imply
  `rc` — adding `rc-ml` alone triggers a server + ML build; the trigger fires on either label.

## Security & correctness notes

- **Same-repo only:** the `head.repo.full_name == github.repository` guard skips fork PRs cleanly.
- **Permissions are least-privilege per job:** workflow-level `permissions: {}`; the build job gets
  `contents: read` + `packages: write` (passed through to the reusable workflow — a caller cannot
  grant a called workflow more than it holds); the comment job gets only `pull-requests: write`.
- **Actions pinned by SHA** (github-script), consistent with repo policy.
- **Concurrency** keyed per-PR with cancel-in-progress prevents stacked builds and stale comments.

## Testing strategy

`pull_request`-triggered workflows run the workflow definition **from the PR branch**, so this can
be validated end-to-end on its own PR without first merging to main:

1. Open the PR for this branch.
2. Create the `rc` / `rc-ml` labels.
3. Add `rc` → confirm a server-only RC build runs, `ghcr.io/open-noodle/gallery-server:pr-<n>` is
   pushed, and a sticky comment appears.
4. Push a new commit → confirm a fresh build runs and the **same** comment is edited (not
   duplicated) with the new commit SHA.
5. Add `rc-ml` → confirm the next build also produces the ML image and the comment's compose snippet
   pins both images.
6. (Optional) Force a build failure → confirm the comment updates to the failure state.

Because these workflows only run in GitHub's CI environment, verification is by observing the PR's
Actions runs and the comment — there is no local unit test surface for workflow YAML beyond
`actionlint`/`zizmor` static checks the repo already runs.

## Out of scope (YAGNI)

- Deleting the `pr-<number>` GHCR tag when the PR closes or the label is removed (manual RC builds
  already leave tags; `cache-cleanup.yml` handles registry hygiene separately). Could be a later
  enhancement via an `unlabeled`/`closed` handler with `packages: delete`.
- An interim "building…" comment before the build completes. The comment posts on completion only.
- Gating on CI "green" — explicitly dropped.
