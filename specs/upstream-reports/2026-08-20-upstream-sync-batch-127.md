# Upstream Sync Report — 2026-08-20 (batches 125–127)

## Summary

- **Upstream commits pulled**: 3 (`7cd0a7d30c1..47dccf72834`)
- **Fork commits synced**: 0 (`integratedForkHead` already equalled `origin/main` at `690fd44e12c`)
- **Conflicts resolved**: 12 across 8 replay steps, all in 3 files
- **Zero-conflict semantic breaks found**: 1
- **Risk level**: MEDIUM (build infrastructure)
- **Recommendation**: PROCEED (stay off `main` — newest upstream tag is still `v3.1.0`)

A small batch with an unusually dense fork surface: **11 of 12 touched files (92%)** carry fork
divergence. The whole cycle is a build-infrastructure reconciliation — upstream restructured the
Dockerfile in exactly the regions the fork patches (Shape D), while a sharp major bump moved through
the same files.

## Incoming Upstream Changes

Divergence measured against the branch's **own** base (`7cd0a7d30c1..HEAD`).

| SHA           | Summary                                        | Area           | Risk to Fork       | Notes                                              |
| ------------- | ---------------------------------------------- | -------------- | ------------------ | -------------------------------------------------- |
| `bd2cbb751bd` | fix(deps): update sharp to ^0.35.3 (#29132)    | deps/server/CI | **HIGH**           | 298-line lockfile delta; new `OutputInfo.hasAlpha` |
| `7165eb61ebc` | fix(server): unicode email validation (#30871) | server         | LOW                | localized to `toEmail`; auto-merged                |
| `47dccf72834` | refactor: dockerfile caching (#30874)          | build/CI       | **HIGH — Shape D** | deletes the anchors 3 fork patches ride on         |

Per-file divergence: only `server/src/validation.spec.ts` was fork-clean. The heaviest were
`.github/workflows/test.yml` (+184/−204), `server/Dockerfile` (+25/−14), `mise.toml` (+24/−24) and
`pnpm-workspace.yaml` (+20/−17).

**Product-direction gate: did NOT fire.** A dependency bump, a validation fix and build caching — no
feature surface overlapping Spaces, search, sync, people or albums.

## Shape D — three fork Dockerfile patches whose anchors upstream deleted

#30874 hoists `WORKDIR /usr/src/app` and `COPY package.json pnpm-lock.yaml pnpm-workspace.yaml
.pnpmfile.cjs ./` into the `builder` base stage and **removes the per-stage
`--mount=type=bind,source=…` blocks** from every stage. Three fork intents lived in those blocks and
had to be re-expressed against the new structure rather than merged hunk-by-hunk.

### 1. `patches/` availability — anchor deleted, re-expressed as a COPY

Fork #349 added `--mount=type=bind,source=patches,target=patches` to four stages. Those mounts are now
meaningless. This is **load-bearing, not cosmetic**: the fork tip ships
`patches/@immich__ui@0.85.0.patch` and declares it in `pnpm-workspace.yaml` `patchedDependencies`, so
every `pnpm install --frozen-lockfile` in the file fails without it. Re-expressed once in `builder`:

```dockerfile
COPY patches ./patches/
```

which all four stages inherit via `FROM builder`. Verified the patch file and the
`patchedDependencies` entry both exist at the fork tip before relying on this.

### 2. The cold-SDK build-before-inject reorder — preserved in all four stages

Fork commits `e7da36aa044`, `4722640a08c` and `75aa51b231f` established: install `@immich/sdk` alone →
build it → then install consumers. Upstream's rewrite collapses those back to single-line builds. The
fork ordering was re-applied on top in **server, web, cli and plugins**, keeping the fork's `--force`
on the web consumer install and the "non-pruning" first install
(`--filter @immich/sdk --filter immich-web`) that `75aa51b231f` specifically fixed.

`--force` and the non-pruning form were kept deliberately rather than adopting upstream's simpler
lines: they are the fork's own fix for a cold-build failure it verified locally, and silently dropping
a fix whose failure mode only appears on a cold Docker build is exactly what `docker.yml` would not
catch until a release.

### 3. The plugins stage — no `mise install --locked`

The fork replaced upstream's `mise install --locked` + `mise //:plugins` with apt `binaryen` plus
`mise exec --no-deps --jobs=1 github:extism/js-pdk@1.6.0`. That is the fork's mitigation for the
GitHub-API rate-limit failure that has now hit this workflow **three cycles running** (including
batch 124's own e2e run). Preserved, with one correction upstream's rewrite forced:

**Upstream moved the plugins stage from `WORKDIR /app` to the inherited `/usr/src/app`, and changed
the final stage to `COPY --from=plugins /usr/src/app/packages/plugin-core/…`.** The fork's version
still set `WORKDIR /app`. Keeping the fork's line while taking upstream's final-stage COPY would have
built plugin-core at `/app` and copied from `/usr/src/app` — a silent empty-plugin image. Resolved to
upstream's path throughout; verified the build location and both `COPY --from=plugins` paths agree.

### Verified end state

| Invariant                              | Result                                        |
| -------------------------------------- | --------------------------------------------- |
| `COPY patches ./patches/` in `builder` | present                                       |
| SDK built before consumers             | 4 stages                                      |
| `mise install --locked` absent         | absent (only named in an explanatory comment) |
| binaryen apt step                      | present                                       |
| `mise exec … js-pdk`                   | present                                       |
| no stray `WORKDIR /app`                | clean                                         |
| upstream's post-deploy sharp rebuild   | present                                       |

## Zero-conflict semantic break (1) — Shape H, from the sharp bump

`sharp` 0.35 adds a required `hasAlpha` to `OutputInfo`. The only literal of that shape tsc actually
checks sits in **fork-only** code — `person.service.spec.ts:1164`, added by fork #542 — so upstream is
unaffected and the bump merged with zero conflicts. Caught by `server pnpm check`.

Two sibling literals in `face-repair.service.spec.ts` are cast `as any` and therefore neither broke nor
were fixed. **That cast is hiding the same drift** and is worth removing at some point; left alone here
as out of scope.

The rest of the sharp bump needed no fork work, and this was checked rather than assumed: there are
exactly **two** `sharp()` pipelines in `server/src`, both upstream-owned in `media.repository.ts`, so
upstream's new `limitInputChannels: false` covers every pipeline the fork has. The fork's +61 lines in
that file are ffmpeg (video trim / frame extraction), not sharp.

**The lockfile trap did not fire.** No regeneration was needed: the replayed `pnpm-lock.yaml` already
resolves `sharp@0.35.3` (single resolution) and `pnpm install --frozen-lockfile` succeeds. The
workspace-linking invariant is intact at **9 `version: link:` / 0 `version: file:`**.

## Conflict Resolutions

12 conflicts across 8 steps, in three files.

### `server/Dockerfile` (×7, steps 2, 5, 6, 7, 8)

Covered in full above. Resolution rule throughout: **take upstream's restructured file, then re-derive
each fork intent against it** — never merge the hunks, because the fork's lines attach to blocks
upstream deleted.

### `.github/workflows/test.yml` (×5, steps 3, 4, 8)

- **`GITHUB_TOKEN` env on the two docker steps** (fork #504) — union with upstream's new
  `E2E_CACHE_FROM` / `E2E_CACHE_TO`. Both are additive entries in the same `env:` block.
- **`if: ${{ !cancelled() }}` removal** (fork "harden e2e readiness diagnostics") — applied on top of
  upstream's three new steps (Setup Buildx / Login to GHCR / Resolve build cache).
- **"Free disk space"** (fork #752) — kept, and deliberately ordered **before** the new buildx/cache
  steps, since it runs `docker image prune --all --force`.
- **★ Deliberate fork adaptation**: upstream's new cache step hardcodes
  `ghcr.io/immich-app/immich-server-build-cache`. Repointed to
  `ghcr.io/${{ github.repository }}-build-cache`. Left as-is, the fork's `push` builds would try to
  write cache into **Immich's** GHCR namespace (permission denied) and reads would never hit. Same
  class as fork rule #218 (never publish into upstream's registry namespace).

### `e2e/docker-compose.yml` (×3, steps 1, 3, 4)

Fork #171 had deleted upstream's hardcoded `immich-app` cache refs and build args. #30874 replaces
them with env-driven `${E2E_CACHE_FROM:-}` / `${E2E_CACHE_TO:-}`, which **satisfies the fork's original
intent** (no hardcoded upstream registry; empty when unset), so upstream's form was taken. Fork #504's
`secrets:` block was then added and #508's revert of it applied, matching the fork tip: no
`github_token` secret in either the build block or the top level. Both YAML files were parsed to
confirm validity after each edit.

## Fork Feature Verification

| Feature                        | Status | Notes                                                |
| ------------------------------ | ------ | ---------------------------------------------------- |
| Docker build (server/web/cli)  | OK     | cold-SDK ordering preserved in all four stages       |
| Plugin build (extism/js-pdk)   | OK     | mise-avoidance + binaryen preserved; paths corrected |
| `@immich/ui` patch             | OK     | `patches/` re-plumbed; `fork-patches-check` green    |
| e2e CI (disk + token plumbing) | OK     | free-disk step kept and correctly ordered            |
| Face identity / face repair    | OK     | sharp `OutputInfo` fixed; full server suite green    |
| Shared Spaces / migrations     | OK     | audit 7/7; 58 Gallery migrations                     |

## Justified Skips

Proven empty rather than assumed:

- **Mobile / Drift**: no `mobile/` path in the batch; `mobile-drift-rebase-check BATCH=127` OK anyway.
- **Machine learning**: no `machine-learning/` path.
- **Migrations**: no `server/src/schema/migrations/` path; `revert-to-immich.sql` coverage therefore
  unchanged.
- **OpenAPI / `make sql`**: #30871 edits `open-api/immich-openapi-specs.json` directly and it replayed
  with the fork's spec intact; the audit's Generated Artifact Review reports nothing needing review, and
  no controller/DTO/repository changed. (`make sql` also requires a running DB and **deletes every file
  under `server/src/queries/` without one**.)

## Local CI Verification

| Check                                   | Status | Notes                                              |
| --------------------------------------- | ------ | -------------------------------------------------- |
| `pnpm install --frozen-lockfile`        | PASS   | lockfile satisfies the sharp bump; no regen needed |
| `server pnpm build`                     | PASS   | 58 Gallery migrations, 1 compatibility alias       |
| `server pnpm check` (tsc)               | PASS   | after the `hasAlpha` fix                           |
| `web check:typescript`                  | PASS   |                                                    |
| `web check:svelte`                      | PASS   | 622 files, 0 errors, 0 warnings                    |
| **`e2e pnpm check` (tsc)**              | PASS   | last cycle's blind spot, run explicitly this time  |
| `server pnpm lint` + `prettier --check` | PASS   |                                                    |
| `e2e pnpm lint` + `pnpm format`         | PASS   |                                                    |
| Server unit tests                       | PASS   | 5737 passed (`--no-file-parallelism`)              |
| Web unit tests                          | PASS   | 363 files, 5694 passed                             |
| `upstream-postrebase-audit BATCH=127`   | PASS   | 7/7 OK                                             |
| `ci-invariants-check`                   | PASS   | 3/3 OK                                             |
| `fork-patches-check`                    | PASS   | `@immich/ui` patch metadata consistent             |
| `mobile-drift-rebase-check BATCH=127`   | PASS   |                                                    |

`mise.lock` and `mobile/mise.lock` were checked and are untouched (no local `mise run` this cycle).

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-127`
- **Final commit**: `3a734f41d1f`

**10 of 10 green.**

**`docker.yml` was the load-bearing gate this cycle** — the only thing that exercises the reconciled
Dockerfile, where a wrong resolution ships a broken or empty-plugin server image rather than failing a
unit test. It passed **first try on `d6c22c81dce`**, which validates all three re-derived fork intents:
the `patches/` COPY, the cold-SDK ordering in four stages, and the relocated plugins stage.

| Workflow                                  | Status | Run         | Notes                                   |
| ----------------------------------------- | ------ | ----------- | --------------------------------------- |
| `docker.yml`                              | GREEN  | 32341724416 | validates the Dockerfile reconciliation |
| `test.yml`                                | GREEN  | 32343572420 | after the two fixes below               |
| `static_analysis.yml`                     | GREEN  | 32341726172 |                                         |
| `gallery-build-mobile.yml`                | GREEN  | 32341738904 | iOS + Android                           |
| `gallery-rebase-smoke.yml`                | GREEN  | 32341728001 |                                         |
| `storage-migration-tests.yml`             | GREEN  | 32341729546 |                                         |
| `storage-migration-e2e.yml`               | GREEN  | 32341736943 |                                         |
| `gallery-revert-to-immich-validation.yml` | GREEN  | 32341731493 |                                         |
| `gallery-ml-smoke.yml`                    | GREEN  | 32341733348 |                                         |
| `gallery-mobile-smoke.yml`                | GREEN  | 32341734972 |                                         |

The nine non-`test.yml` workflows were green on `d6c22c81dce`; the two later commits changed only
`.github/workflows/test.yml` formatting and this report, neither of which those workflows consume.

### What the first `test.yml` run caught

- **`.github Files Formatting` — a real defect of mine.** The hand-resolved `test.yml` carried two
  stray double blank lines. `.github/` has its **own** prettier config and package, and CI checks it as
  a separate job — so neither `server prettier --check .` nor the web/e2e format gates would ever see
  it. **Add `cd .github && npx prettier --check .` to the local gate list after any workflow edit.**
- **`Medium Tests (Server)` — infrastructure.** testcontainers failed to pull
  `ghcr.io/immich-app/postgres:14-vectorchord0.4.3@sha256:…` with `statusCode: 404, 'no such container'`.
  Checked before classifying: the "Free disk space" step (with its `docker image prune --all --force`)
  that this cycle reordered exists **only in the e2e jobs**, while Medium Tests runs just
  `mise run //server:ci-medium` — so the reordering is not implicated. Green on re-dispatch.

## Post-Rebase Verification

- Fork commits ahead of `upstream/main`: **1206** (unchanged; commit-subject diff vs the pre-rebase tip
  is empty, so nothing was dropped or emptied)
- Commits behind `upstream/main`: **0**
- Pre-rebase backup ref: `rolling-backup-2026-08-20-pre-b127` (`249bbfed6d7`)
- Fork diff looks clean: YES

## Landing

**Not landing.** Newest upstream tag is still `v3.1.0`, which `branding/config.json` already declares.

## Follow-up work

1. **Remove the `as any` casts on the two `face-repair.service.spec.ts` `OutputInfo` literals** — they
   hid the sharp 0.35 drift that broke the checked sibling.
2. **Add `.github` to the local format gate.** `cd .github && npx prettier --check .` — it has its own
   prettier config and its own CI job, so the server/web/e2e format gates cannot see workflow-file drift.
3. **Consider a `timeout-minutes` on `apply-branding`'s dependency install** (carried from batch 124) —
   a stalled `apt-get` holds a job slot for the 6-hour default.
