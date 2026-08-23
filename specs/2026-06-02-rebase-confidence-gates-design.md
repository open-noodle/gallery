# Rebase Confidence Gates Design

Status: draft
Date: 2026-06-02
Worktree: `/Users/pierre/dev/gallery/.worktrees/rebase-upstream-rolling-20260509-active`
Branch: `rebase/upstream-rolling-20260509-active`

## Problem

The rolling upstream rebase process now catches conflicts, generated artifact
drift, storage migration regressions, revert-to-Immich regressions, and broad
server/web/mobile test failures. The batch 141 quota regression showed that the
process is useful: the failing E2E surfaced a real integration bug.

The post-rebase feature review still found confidence gaps:

- Branding scripts are used by release and RC workflows, but the rebase gate
  does not explicitly run the branding verification scripts.
- Mobile is covered by local analysis and Flutter tests during careful manual
  rebases, but the seven dispatch workflows do not guarantee a mobile build or
  a risk-based mobile smoke.
- ML behavior is covered by unit/API tests, but the gate does not include a
  lightweight container or endpoint smoke that proves Gallery ML packaging still
  boots after Docker, base-image, or ML dependency changes.
- Release and RC workflows are checked indirectly by CI invariants, but there
  is no dry-run/lint check that the dispatchable Gallery release workflows keep
  their required inputs, image names, branding steps, and summary outputs.
- `docs/fork/ownership.yml` can pass while `last_verified_fork_head` is stale
  and while newer fork files are covered only by broad globs, leaving manifest
  maintenance easy to postpone.

The goal is to convert those review notes into repo-owned checks so future
upstream batches fail early when a fork feature or release path becomes unsafe.

## Goals

- Add a risk-based confidence gate that is cheap for ordinary batches and strict
  for batches touching mobile, ML, Docker, release, branding, CI, or fork-owned
  feature surfaces.
- Keep the existing seven dispatch workflows as the default remote gate, but
  make their expected coverage explicit and add required optional workflows for
  high-risk surfaces.
- Add local Make targets so an operator can run the same confidence checks
  before pushing a batch.
- Make ownership manifest staleness visible as a maintenance failure during the
  confidence gate, without breaking ordinary development PRs unnecessarily.
- Prefer TypeScript checks inside `tools/upstream-preflight` for workflow and
  manifest logic, because that package already has tests and is included in CI.

## Non-Goals

- Do not run every expensive mobile, ML, release, or Docker smoke after every
  upstream batch.
- Do not replace the existing `Test`, `Static Code Analysis`, `Docker`,
  `Gallery Rebase Smoke`, storage migration, or revert-to-Immich workflows.
- Do not attempt full production deployment, App Store/TestFlight validation, or
  GPU inference during the rebase gate.
- Do not migrate fork code into new namespaces as part of this work.

## Implementation Discipline

Implementation must use test-driven development for every behavior change:

- Write the focused failing test first.
- Run the focused test and confirm it fails for the expected reason.
- Implement the smallest code change that makes the test pass.
- Run the focused test again and confirm it passes.
- Only then refactor or move to the next behavior.

This applies to TypeScript audit logic, CLI wiring, workflow static assertions,
Make target wiring, and shell-script safety behavior. If a behavior is only
practical to verify as a command invocation, the implementation plan must still
start with a failing command-level test or a failing fixture-driven unit test.

## Risk Model

The confidence gate is risk-based:

- Every batch runs cheap local checks:
  - `make upstream-postrebase-audit BATCH=<id>`
  - `make fork-ownership-coverage-check`
  - `make ci-invariants-check`
  - `make fork-patches-check`
  - `make rebase-confidence-check BATCH=<id>`
- Every remote checkpoint still dispatches the seven existing workflows.
- Additional local or remote checks become mandatory when the batch touches
  matching surfaces:
  - mobile paths or mobile manifest entries: mobile analysis/tests and a mobile
    build smoke
  - ML paths, ML config, or ML Dockerfile/base image: ML unit tests and ML
    container boot smoke
  - branding paths, release workflows, RC workflows, Dockerfiles, or image name
    invariants: branding verification and release workflow dry-run checks
  - ownership manifest changes or fork files covered only by broad globs:
    strict ownership coverage maintenance check

## Architecture

### Upstream Preflight Checks

Add a new audit module under `tools/upstream-preflight/src/audits/` that reads:

- `docs/fork/ownership.yml`
- workflow YAML files under `.github/workflows`
- branding action metadata under `.github/actions/apply-branding`
- the current batch audit scope when `BATCH=<id>` is provided

The module returns structured audit results, following the same `AuditResult`
shape as existing CI invariant and post-rebase audits.

The CLI exposes:

```bash
pnpm --filter @gallery/upstream-preflight run rebase-confidence-check -- --batch <id>
```

The Makefile wraps that as:

```bash
make rebase-confidence-check BATCH=<id>
```

### Ownership Maintenance

The confidence gate treats ownership freshness more strictly than the existing
coverage check:

- `last_verified_fork_head` must be an ancestor of `origin/main`.
- If it is behind `origin/main`, the confidence gate reports the changed files
  since the baseline.
- Files changed since the baseline and covered only by broad optional globs are
  failures in `rebase-confidence-check`.

This keeps the regular coverage check useful as a warning tool while giving the
rebase operator a stronger gate before claiming the branch is ready.

### Branding Verification

Add a local target:

```bash
make gallery-branding-check
```

It runs:

```bash
.github/actions/apply-branding/dependencies_test.rb
branding/scripts/test-email-branding.sh
branding/scripts/test-app-download-branding.sh
branding/scripts/apply-branding.sh
branding/scripts/verify-branding.sh
```

The target must run in a temporary copy or restore all branding-applied files so
it leaves the worktree clean. The confidence gate requires this target when the
batch touches branding assets, branding scripts, Dockerfiles, release workflows,
mobile app metadata, web static branding, or email/app-download templates.

### Release And RC Workflow Dry-Run

The confidence gate adds static workflow assertions for:

- `gallery-rc-build.yml`
- `gallery-release-server-only.yml`
- `gallery-release-mobile.yml`
- `gallery-build-mobile.yml`

Assertions include:

- required `workflow_dispatch` inputs are present
- release and RC server jobs use `ghcr.io/open-noodle/gallery-server`
- release and RC ML jobs use `ghcr.io/open-noodle/gallery-ml`
- release and RC server/ML build jobs apply branding before Docker build
- RC summary prints the GHCR links for built images
- release/mobile workflows use the branding action before build/signing steps

These are static checks, not real publish runs.

### Mobile Build Smoke

Add a dispatchable workflow or reusable job named `Gallery Mobile Smoke` that:

- checks out the branch
- applies branding
- runs Flutter dependency setup
- runs code generation needed for mobile
- runs `dart analyze`
- runs Flutter tests
- builds one unsigned Android artifact in a non-release flavor

The confidence gate marks this workflow required when a batch touches mobile,
branding, mobile release signing, app metadata, deep links, or mobile generated
artifacts. Ordinary server/web-only batches do not require it.

The workflow must be `workflow_dispatch` capable so it can be required for a
single upstream batch branch without adding it to every pull request.

### ML Container Smoke

Add a local and dispatchable ML smoke that:

- builds the CPU ML image from `machine-learning/Dockerfile`
- starts the container
- waits for a health or docs endpoint
- verifies the package imports and Gallery-owned model modules are loadable
- tears the container down

This is intentionally lighter than real model inference. It catches packaging,
base-image, dependency, import, and entrypoint breakage. Full inference remains
outside the per-batch gate.

If Docker is unavailable locally, the local target must fail with a clear
operator message rather than silently skipping the smoke. The dispatchable
workflow remains the supported remote fallback.

### Operator Output

`make upstream-next-batch` and `make rebase-confidence-check` should print
risk-based recommendations in operator terms once the referenced target or
workflow exists:

```text
Required confidence checks for batch 176:
- make gallery-branding-check
- make gallery-ml-smoke
- gh workflow run gallery-mobile-smoke.yml --ref rebase/upstream-batch-176
```

The output should explain why each check is required by listing the matched
batch files or feature domains.

During incremental implementation, `rebase-confidence-check` must not print a
runnable command for a target or workflow file that does not exist yet. It
should instead print a planned-check line naming the missing target/workflow and
the later slice that will add it. Later slices replace those planned lines with
the exact command by adding the target/workflow.

`rebase-confidence-check` verifies local/static requirements and reports the
extra remote checks that are required for the batch. It does not claim those
remote workflows are green; the operator or CI babysitter must still dispatch
and wait for them when the output marks them required.

## Implementation Slices

### Slice 1: Core Confidence Audit And Workflow Assertions

Build the `rebase-confidence-check` audit module, CLI command, package script,
and Make target. This slice covers risk-surface classification, release/RC
workflow static assertions, operator output for required future mobile/ML remote
checks, and command wiring. It does not add the branding, mobile, or ML smoke
implementations yet; it reports those checks as required when the matched batch
surfaces demand them. If a required target or workflow is not available until a
later slice, the output marks it as planned instead of printing a runnable
command.

Slice 1 is complete when:

- low-risk batches pass the new command
- high-risk batches print required local and remote confidence checks with
  matched-file reasons
- release/RC workflow static assertions fail on malformed fixtures
- Makefile and CLI wiring tests cover the new command

### Slice 2: Strict Ownership Maintenance

Add strict ownership freshness and broad-only coverage failures to
`rebase-confidence-check`, reusing the existing ownership manifest parsing and
coverage logic where possible. Keep `make fork-ownership-coverage-check` as the
current warning-oriented check; strict behavior belongs to the confidence gate.

Slice 2 is complete when:

- exact manifest baselines pass
- ancestor baselines with narrow coverage pass with changed-file details
- ancestor baselines with broad-only coverage fail in the confidence gate
- missing, unknown, or non-ancestor baselines fail with actionable messages

### Slice 3: Branding Verification Target

Add `make gallery-branding-check` and a script wrapper that runs the existing
branding dependency and template verification scripts, applies branding, runs
`verify-branding.sh`, and leaves the worktree clean even when verification
fails.

Slice 3 is complete when:

- the Make target runs locally and exits with the branding scripts' status
- failure paths still restore or clean temporary files
- tests or command verification prove `git status --short` is clean afterward
- `rebase-confidence-check` includes `make gallery-branding-check` as a
  required local check for branding, release, Dockerfile, and mobile app
  metadata surfaces

### Slice 4: Mobile Smoke Workflow

Add the dispatchable `Gallery Mobile Smoke` workflow. It applies branding,
prepares Flutter dependencies, runs required mobile code generation, checks for
generated-file drift, runs analysis/tests, and builds one unsigned Android
artifact.

Slice 4 is complete when:

- workflow static assertions prove the workflow is `workflow_dispatch` capable
- it applies branding before mobile build work
- it runs mobile code generation, analysis, tests, and an unsigned Android build
- `rebase-confidence-check` prints the exact `gh workflow run` command when
  mobile or mobile-branding surfaces are touched

### Slice 5: ML Smoke And Process Integration

Add `make gallery-ml-smoke`, a dispatchable ML smoke workflow, and documentation
updates. The local and remote smoke build the CPU ML image, start it, wait for a
health/docs endpoint, verify Gallery-owned ML imports, and collect logs on
failure.

Slice 5 is complete when:

- Docker-unavailable paths fail with a clear operator message
- container health/import probe failures include logs
- the ML smoke workflow is dispatchable
- `rebase-confidence-check` prints the exact local and remote ML smoke commands
  when ML, ML Dockerfile, or base-image surfaces are touched
- upstream rebase docs reference the new risk-based confidence target

## Edge Case Coverage

The implementation plan must include tests for these cases where they apply:

- No batch id: the CLI uses the full current upstream range only when no
  persisted rolling state is needed; otherwise it prints the required `BATCH`
  usage and exits nonzero.
- Unknown batch id: the CLI fails with the persisted batch ids that are
  available.
- Missing or stale batch plan: the CLI fails before classifying risk so an
  operator cannot use outdated touched-file data.
- Missing `origin/main` or `upstream/main`: ownership and batch-scope checks
  fail with fetch instructions.
- Empty touched-file list: the check is treated as low risk but still runs
  workflow static assertions and ownership freshness checks.
- Invalid or missing workflow YAML: release/RC/mobile/ML workflow assertions
  fail with the file path and assertion name.
- Renamed release workflow: static assertions fail rather than silently passing
  against an empty file list.
- Missing branding action step before build/signing: workflow assertions fail.
- Wrong Gallery image names or upstream Immich image names in Gallery release
  workflows: workflow assertions fail.
- RC summary missing server or ML GHCR image links: workflow assertions fail.
- `last_verified_fork_head` absent, unknown, not an ancestor, or behind
  `origin/main`: tests cover each outcome.
- Files changed since the manifest baseline and covered only by broad optional
  globs: strict confidence check fails and names the broad glob.
- Branding check failure after `apply-branding.sh`: temporary worktree cleanup
  or file restoration still runs, and `git status --short` remains clean.
- Docker unavailable for local ML smoke: local target exits nonzero with an
  actionable message.
- ML container starts but health/import probe fails: local and workflow smoke
  fail and include container logs.
- Mobile code generation changes tracked files: mobile smoke fails and reports
  the changed generated files.
- Workflow dispatch-only checks required by a batch: operator output includes
  the exact `gh workflow run ... --ref rebase/upstream-batch-<id>` commands.

## Testing

The test suite must be broad enough to cover the risk model, but it should not
pretend to prove production deployment, store signing, GPU inference, or real
model accuracy.

Required test coverage:

- `tools/upstream-preflight` unit tests for risk-surface classification,
  including low-risk, mobile, ML, branding, release, Docker, ownership, and
  mixed-surface batches.
- Unit tests for workflow static assertions, including positive fixtures and
  negative fixtures for missing branding, wrong image names, missing dispatch
  inputs, and missing RC image summary output.
- Unit tests for strict ownership freshness, including exact baseline,
  ancestor baseline with narrow coverage, ancestor baseline with broad-only
  coverage, missing baseline commit, and non-ancestor baseline.
- CLI wiring tests for the new command, `--batch`, `BATCH` env fallback,
  unknown batch, stale plan, and missing refs.
- Makefile wiring tests in the existing upstream-preflight CLI wiring spec so
  `make rebase-confidence-check`, `make gallery-branding-check`, and
  `make gallery-ml-smoke` cannot drift from the CLI.
- Shell-command verification for `gallery-branding-check` proving it exits
  cleanly and leaves the worktree clean.
- ML smoke verification in an environment with Docker available, plus a
  fallback test or fixture for the no-Docker error path.
- Mobile smoke workflow static assertions proving it is dispatchable, applies
  branding, runs code generation, runs analysis/tests, and builds an unsigned
  Android artifact.

Shell targets should be verified locally and leave `git status --short` clean.

## Success Criteria

- `make rebase-confidence-check BATCH=<id>` exits nonzero when local/static
  confidence requirements fail, including missing required workflow structure,
  stale ownership data, broad-only ownership coverage, or invalid release/RC
  branding assertions.
- For batches that require extra remote workflows, the command prints the exact
  dispatch commands and exits according to local/static check health; the
  operator or CI babysitter is responsible for dispatching and waiting for
  those remote workflows.
- The command exits zero for low-risk batches that do not touch mobile, ML,
  branding, release, Docker, or ownership maintenance surfaces.
- Branding verification can be run locally without leaving a dirty worktree.
- Release/RC workflow drift is caught by TypeScript tests, not by manual review.
- The upstream rebase docs and memory playbook can point to a single
  risk-based confidence target.
