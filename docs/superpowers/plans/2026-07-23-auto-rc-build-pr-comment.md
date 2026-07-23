# Auto RC build + sticky PR comment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a PR is labelled `rc` (or `rc-ml`), automatically build a release-candidate `gallery-server` image from the PR's current commit and keep one always-current PR comment showing how to run the latest build.

**Architecture:** Refactor the existing manual `gallery-rc-build.yml` into a reusable workflow (`workflow_call`) without changing its behavior. A new `gallery-pr-rc-comment.yml` fires on `pull_request` `[labeled, synchronize]`, gated by label, calls the reusable build, then posts/edits a single sticky comment via `actions/github-script`.

**Tech Stack:** GitHub Actions (reusable workflows, `pull_request` triggers), `actions/github-script` (Node/Octokit), Docker Buildx (inherited from the reusable workflow), GHCR.

**Verification note (read first):** Workflow YAML has no unit-test surface. "Testing" in this plan means **static validation** — `actionlint` (syntax, expressions, and cross-checking the reusable-workflow call against its declared inputs) and `zizmor` (the same security linter CI runs) — followed by **one live end-to-end run on this feature's own PR** (Task 3). `pull_request` workflows execute the copy of the YAML that lives on the PR branch, so the feature validates itself before merging to main.

## Global Constraints

- **Pin every action by commit SHA.** `actions/github-script` pin = `3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0` (already used elsewhere in this repo). Do not introduce any new third-party action.
- **Least privilege.** Workflow-level `permissions: {}`; grant per job only what it needs (`contents: read` + `packages: write` for the build job; `pull-requests: write` for the comment job).
- **No `pull_request_target`.** Use `pull_request` and guard to same-repo head (`github.event.pull_request.head.repo.full_name == github.repository`).
- **No untrusted data in shell.** PR title / branch name must never be interpolated into a `run:` block. The comment step uses `github-script` and reads PR data from `context`, never from shell.
- **Image tag scheme:** `pr-<number>` (stable, overwritten each push).
- **Labels:** `rc` → server RC; `rc-ml` → server + CPU ML RC. `rc-ml` does not imply `rc`; either label triggers a build.
- **Commit style:** Conventional Commits. Do NOT add any `Co-Authored-By` / "Generated with" trailer.

## File Structure

- **Modify** `.github/workflows/gallery-rc-build.yml` — add a `workflow_call:` trigger mirroring the existing `workflow_dispatch:` inputs. Job bodies untouched.
- **Create** `.github/workflows/gallery-pr-rc-comment.yml` — the PR orchestrator (build job + sticky-comment job).
- **Setup (one-time, not a file)** — create the `rc` and `rc-ml` labels in `open-noodle/gallery`.

---

### Task 1: Make `gallery-rc-build.yml` reusable

**Files:**

- Modify: `.github/workflows/gallery-rc-build.yml` (insert a `workflow_call:` block into the `on:` section, after the `workflow_dispatch:` block and before `concurrency:`)

**Interfaces:**

- Produces: a reusable workflow callable as `uses: ./.github/workflows/gallery-rc-build.yml` with inputs `rc_tag` (string, required), `ref` (string, optional), `fork_version` (string, optional), `build_ml` (boolean, optional, default `false`). These names/types are what Task 2 depends on and must match the existing `workflow_dispatch` inputs exactly.

- [ ] **Step 1: Insert the `workflow_call` trigger**

In `.github/workflows/gallery-rc-build.yml`, the `on:` block currently contains only `workflow_dispatch:` with its `inputs:`. Immediately **after** the `workflow_dispatch` inputs block and **before** the `concurrency:` line, add a sibling `workflow_call:` key (2-space indent, same level as `workflow_dispatch:`):

```yaml
workflow_call:
  inputs:
    rc_tag:
      description: 'Custom image tag, e.g. pr-123. Must not be "release", "v<N>", or "v<N>.<N>.<N>".'
      required: true
      type: string
    ref:
      description: 'Git ref (branch/tag/SHA) to build. Leave empty to use the caller ref.'
      required: false
      default: ''
      type: string
    fork_version:
      description: 'Override the stamped fork version (e.g. 5.1.0). Leave empty to derive from the latest v<N>.<N>.<N> git tag.'
      required: false
      default: ''
      type: string
    build_ml:
      description: 'Also build the CPU machine-learning image under the same RC tag.'
      required: false
      default: false
      type: boolean
```

Do not change `workflow_dispatch:`, `concurrency:`, `permissions:`, or any job. `inputs.*` already resolves for both triggers, so the job bodies work unchanged.

- [ ] **Step 2: Confirm only the `on:` block changed**

Run:

```bash
git -C "$(git rev-parse --show-toplevel)" diff .github/workflows/gallery-rc-build.yml
```

Expected: the diff is **purely additive** — the only added lines are the `workflow_call:` block above. No deletions, no changes to `workflow_dispatch`, jobs, `concurrency`, or `permissions`.

- [ ] **Step 3: Static-validate with actionlint**

Run (downloads actionlint on first use; `go` is available):

```bash
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/gallery-rc-build.yml
```

Expected: no output, exit code 0. (actionlint validates the new `workflow_call` inputs and the whole file.)

- [ ] **Step 4: Static-validate with zizmor (matches CI security gate)**

Run:

```bash
uvx zizmor --offline .github/workflows/gallery-rc-build.yml
```

Expected: exit 0 with no new high/medium findings. The file already carries `# zizmor: ignore[template-injection]` on its digest steps; those pre-existing ignores stay.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/gallery-rc-build.yml
git commit -m "ci(rc): make gallery-rc-build reusable via workflow_call"
```

---

### Task 2: Add the PR orchestrator workflow

**Files:**

- Create: `.github/workflows/gallery-pr-rc-comment.yml`

**Interfaces:**

- Consumes: the reusable workflow from Task 1 (`./.github/workflows/gallery-rc-build.yml`, inputs `rc_tag`, `ref`, `build_ml`).
- Produces: nothing other tasks consume.

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/gallery-pr-rc-comment.yml` with exactly this content:

````yaml
name: PR Release Candidate

# When a PR carries the `rc` (or `rc-ml`) label, build a release-candidate server
# image (plus CPU ML when `rc-ml`) from the PR's head commit under the stable tag
# `pr-<number>`, and keep one sticky PR comment showing how to run the latest build.
# Server-only unless `rc-ml` is present. Same-repo PRs only (fork PRs can't push GHCR).

on:
  pull_request:
    types: [labeled, synchronize]

concurrency:
  group: pr-rc-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions: {}

jobs:
  build:
    name: Build RC image
    if: >
      github.event.pull_request.head.repo.full_name == github.repository &&
      (
        (github.event.action == 'labeled' &&
          (github.event.label.name == 'rc' || github.event.label.name == 'rc-ml')) ||
        (github.event.action == 'synchronize' &&
          (contains(github.event.pull_request.labels.*.name, 'rc') ||
           contains(github.event.pull_request.labels.*.name, 'rc-ml')))
      )
    permissions:
      contents: read
      packages: write
    uses: ./.github/workflows/gallery-rc-build.yml
    with:
      rc_tag: pr-${{ github.event.pull_request.number }}
      ref: ${{ github.event.pull_request.head.sha }}
      build_ml: ${{ contains(github.event.pull_request.labels.*.name, 'rc-ml') }}

  comment:
    name: Update RC comment
    needs: build
    if: ${{ always() && needs.build.result != 'skipped' }}
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - name: Post or update sticky RC comment
        uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
        env:
          BUILD_RESULT: ${{ needs.build.result }}
        with:
          script: |
            const marker = '<!-- gallery-rc-build-comment -->';
            const { owner, repo } = context.repo;
            const pr = context.payload.pull_request;
            const prNumber = pr.number;
            const headSha = pr.head.sha;
            const shortSha = headSha.substring(0, 7);
            const labels = pr.labels.map((l) => l.name);
            const mlBuilt = labels.includes('rc-ml');
            const buildResult = process.env.BUILD_RESULT;
            const tag = `pr-${prNumber}`;
            const serverImage = `ghcr.io/open-noodle/gallery-server:${tag}`;
            const mlImage = `ghcr.io/open-noodle/gallery-ml:${tag}`;
            const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
            const commitUrl = `${context.serverUrl}/${owner}/${repo}/commit/${headSha}`;
            const updated = new Date().toUTCString();

            let body;
            if (buildResult === 'success') {
              const overrideMl = mlBuilt
                ? `\n  immich-machine-learning:\n    image: ${mlImage}`
                : '';
              const pullTargets = mlBuilt
                ? 'immich-server immich-machine-learning'
                : 'immich-server';
              const mlLine = mlBuilt
                ? `\n- \`${mlImage}\` (CPU, linux/amd64 + linux/arm64)`
                : '';
              body = [
                marker,
                '### 🧪 Release candidate build',
                '',
                `Built from [\`${shortSha}\`](${commitUrl}) · [build run](${runUrl})`,
                '',
                '**Images published**',
                '',
                `- \`${serverImage}\` (linux/amd64 + linux/arm64)${mlLine}`,
                '',
                '<details><summary>How to run this RC</summary>',
                '',
                'In the directory containing your `docker-compose.yml`, create (or append to) a `docker-compose.override.yml`:',
                '',
                '```yaml',
                'services:',
                `  immich-server:\n    image: ${serverImage}${overrideMl}`,
                '```',
                '',
                'Then pull and restart:',
                '',
                '```bash',
                `docker compose pull ${pullTargets}`,
                'docker compose up -d',
                '```',
                '',
                'To roll back, delete the override (or the RC image block) and run `docker compose up -d` again.',
                '',
                '</details>',
                '',
                `_Last updated ${updated} — auto-updates on every push while the \`rc\` label is set._`,
              ].join('\n');
            } else {
              body = [
                marker,
                '### 🧪 Release candidate build — ❌ failed',
                '',
                `The RC build for [\`${shortSha}\`](${commitUrl}) did not complete (\`${buildResult}\`). See the [build logs](${runUrl}).`,
                '',
                `_Last updated ${updated}._`,
              ].join('\n');
            }

            const comments = await github.paginate(github.rest.issues.listComments, {
              owner,
              repo,
              issue_number: prNumber,
              per_page: 100,
            });
            const existing = comments.find((c) => c.body && c.body.includes(marker));
            if (existing) {
              await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
            } else {
              await github.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
            }
````

- [ ] **Step 2: Static-validate with actionlint (cross-checks the reusable call)**

Run:

```bash
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/gallery-pr-rc-comment.yml
```

Expected: no output, exit 0. actionlint resolves `./.github/workflows/gallery-rc-build.yml` and confirms `rc_tag`/`ref`/`build_ml` are valid inputs of the (now reusable) workflow from Task 1. If Task 1 wasn't applied, actionlint errors here — that dependency is intended.

- [ ] **Step 3: Static-validate with zizmor**

Run:

```bash
uvx zizmor --offline .github/workflows/gallery-pr-rc-comment.yml
```

Expected: exit 0 with no high/medium findings. In particular, no `template-injection` finding — the comment step reads PR data from `context`, not shell, and the only expressions in `run`-free jobs are `github.event.pull_request.number/head.sha` (safe integer/hex) and `needs.build.result`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/gallery-pr-rc-comment.yml
git commit -m "ci(rc): auto-build RC image and post sticky comment on labelled PRs"
```

---

### Task 3: Create labels + live end-to-end validation

This is the integration test. It requires the branch pushed and a PR open, because `pull_request` workflows only run in GitHub CI. Use the `Deeds67` GitHub account for any write/dispatch (repo policy).

**Files:** none (label + PR operations).

- [ ] **Step 1: Create the `rc` and `rc-ml` labels**

Run (idempotent — ignore "already exists"):

```bash
gh label create rc --repo open-noodle/gallery \
  --color 0e8a16 --description "Auto-build a release-candidate server image and post it on the PR" || true
gh label create rc-ml --repo open-noodle/gallery \
  --color 1d76db --description "Also build the CPU ML image for the RC (server + ML)" || true
```

Verify:

```bash
gh label list --repo open-noodle/gallery | grep -E '^rc(-ml)?\b'
```

Expected: both `rc` and `rc-ml` listed.

- [ ] **Step 2: Push the branch and open the PR**

```bash
git push -u origin HEAD
gh pr create --repo open-noodle/gallery --fill --base main
```

Expected: a PR is created. No RC build runs yet (opening a PR fires `opened`, which this workflow ignores).

- [ ] **Step 3: Trigger the first build via the `rc` label**

```bash
gh pr edit --repo open-noodle/gallery <PR_NUMBER> --add-label rc
```

Watch the run:

```bash
gh run list --repo open-noodle/gallery --workflow "PR Release Candidate" --limit 3
```

Expected: a `PR Release Candidate` run starts; its `build` job runs (not skipped) and `comment` job succeeds. When done, the PR has a comment headed "🧪 Release candidate build" pinning `ghcr.io/open-noodle/gallery-server:pr-<PR_NUMBER>`, with **no** ML image line.

- [ ] **Step 4: Confirm the image was pushed**

```bash
docker manifest inspect ghcr.io/open-noodle/gallery-server:pr-<PR_NUMBER> >/dev/null && echo OK
```

Expected: `OK` (multi-arch manifest exists). If GHCR auth is needed: `echo "$CR_PAT" | docker login ghcr.io -u Deeds67 --password-stdin` first, or verify the tag in the GitHub Packages UI instead.

- [ ] **Step 5: Push a new commit → confirm the SAME comment is edited**

Record the current comment id:

```bash
gh api "repos/open-noodle/gallery/issues/<PR_NUMBER>/comments" --jq '.[] | select(.body|contains("gallery-rc-build-comment")) | .id'
```

Make a trivial change and push:

```bash
git commit --allow-empty -m "chore: trigger RC rebuild"
git push
```

Expected: a new `PR Release Candidate` run fires on `synchronize` (label present), builds again, and the comment id above is **unchanged** (edited in place — not a second comment). Re-run the `gh api` query: exactly one matching comment, whose body now shows the new short SHA.

- [ ] **Step 6: Add `rc-ml` → confirm ML is also built and the snippet updates**

```bash
gh pr edit --repo open-noodle/gallery <PR_NUMBER> --add-label rc-ml
```

Expected: a run where the reusable build's `build-ml` / `merge-ml` jobs execute; the comment now lists both `gallery-server:pr-<n>` and `gallery-ml:pr-<n>`, and its compose snippet pins `immich-machine-learning` and pulls both services.

- [ ] **Step 7 (optional): Confirm the failure path**

Only if you want to see the failure branch: temporarily break the build (e.g., push a commit that fails `apply-branding` / the server build), and confirm the same sticky comment updates to the "❌ failed" state with a logs link. Revert immediately after. Skip if not exercising this path.

- [ ] **Step 8: Record outcome**

No commit here. Summarise in the PR description or a comment that Tasks 3.3–3.6 passed (build ran, image pushed, comment edited in place across pushes, ML opt-in worked). This is the acceptance evidence for the feature.

---

## Self-Review

**Spec coverage (checked against `2026-07-23-auto-rc-build-pr-comment-design.md`):**

- Trigger model (`labeled`/`synchronize`, `rc`/`rc-ml`, same-repo guard) → Task 2 Step 1 `build.if`. ✓
- Reusable `gallery-rc-build.yml` with the four inputs → Task 1. ✓
- Stable `pr-<number>` tag, `ref: head.sha` → Task 2 `with:`. ✓
- `build_ml` only on `rc-ml` → Task 2 `with.build_ml`. ✓
- Sticky comment, find-by-marker, edit-or-create, success + failure states, compose snippet, ML-aware → Task 2 `github-script`. ✓
- Least-privilege permissions, SHA-pinned action, no `pull_request_target`, no shell injection → Global Constraints + Task 2. ✓
- Concurrency per-PR cancel-in-progress → Task 2 `concurrency`. ✓
- Create `rc`/`rc-ml` labels → Task 3 Step 1. ✓
- Testable on its own PR → Task 3. ✓
- Out-of-scope items (tag cleanup, "building…" interim, green gate) correctly omitted. ✓

**Placeholder scan:** No TBD/TODO; `<PR_NUMBER>` in Task 3 is a runtime value the operator substitutes, not an unfinished spec. Full github-script provided.

**Type consistency:** Reusable inputs `rc_tag`/`ref`/`fork_version`/`build_ml` are named identically in Task 1 (definition) and Task 2 (call). `marker`, `serverImage`, `mlImage`, `buildResult` used consistently within the single script. Label names `rc`/`rc-ml` consistent across trigger, `build_ml` expression, and Task 3. Image path `ghcr.io/open-noodle/gallery-server` matches the reusable workflow's `merge-server` output.

## Live validation results (PR #837)

Run on 2026-07-23 against the real repo, exercising the workflow from the PR branch:

- Labels `rc` and `rc-ml` created in `open-noodle/gallery`.
- **Guard, negative case:** adding the unrelated `changelog:chore` label ran the workflow but skipped the `build` job (and therefore the `comment` job) — confirming unrelated label churn does not rebuild.
- **Guard, positive case:** adding `rc` triggered run `30043534178`; the `build-ml` / `merge-ml` jobs were skipped, confirming ML is never built without `rc-ml`.
- **Image published:** `ghcr.io/open-noodle/gallery-server:pr-837` exists in GHCR as a multi-arch manifest (`linux/amd64` + `linux/arm64`).
- **Comment created:** a single comment carrying the `<!-- gallery-rc-build-comment -->` marker, authored by `github-actions[bot]`, showing the built commit, the run link, and a server-only compose snippet.

## Post-review amendments

A whole-branch code review after this plan was executed surfaced four deviations, applied on top of the code above:

- `gallery-pr-rc-comment.yml`: `comment` job's `if:` also excludes `needs.build.result == 'cancelled'`, so a build superseded by `cancel-in-progress` can no longer overwrite a good comment with a "❌ failed (cancelled)" message.
- `gallery-pr-rc-comment.yml`: the success-comment footer now reads "auto-updates on every push while the `rc`/`rc-ml` label is set" (was `rc`-only), since an `rc-ml`-only PR also auto-updates.
- `gallery-pr-rc-comment.yml`: the sticky-comment lookup now also requires `c.user?.type === 'Bot'`, so a human "Quote reply" that copies the hidden marker can no longer be mistaken for the bot's own comment and edited.
- `gallery-rc-build.yml`: both the `build-server` and `build-ml` jobs' "Prepare platform pair" step (renamed "Prepare build metadata") now also emits `source-commit=$(git rev-parse HEAD)`, and `BUILD_SOURCE_COMMIT` in each job's "Build and push by digest" step reads that output instead of `${{ github.sha }}` — on a `pull_request`-triggered call, `github.sha` is the ephemeral merge commit, not the checked-out `inputs.ref` commit actually built.
