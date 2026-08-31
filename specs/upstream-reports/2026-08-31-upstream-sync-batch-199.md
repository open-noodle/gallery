# Upstream Sync Report — 2026-08-31 (batch 199)

## Summary

- **Upstream commits pulled**: 1 (`1fd3d874921`)
- **Fork commits synced from `origin/main`**: 0 (`integratedForkHead` already at `9c31bc01655`)
- **Conflicts resolved**: 0
- **Risk level**: LOW
- **Recommendation**: PROCEED

The rebase is **byte-exact**: the complete tree diff from the pre-rebase tip to the new HEAD is the
three base-image `FROM` lines and nothing else. No fork content moved, and no fork content was lost.

## Incoming Upstream Changes

| SHA           | Summary                                                          | Area        | Risk to Fork | Notes                                                                                                                                  |
| ------------- | ---------------------------------------------------------------- | ----------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `1fd3d874921` | `chore(deps): update base-image to v202608300913` (immich-31128) | CI / Docker | LOW          | renovate bot. Bumps `base-server-dev` and `base-server-prod` tag + digest in `server/Dockerfile` and `server/Dockerfile.dev`. 3 lines. |

### Per-batch product-direction gate

**Did not fire.** A renovate base-image digest bump introduces no feature, reshapes no data model or
architecture, and sets no product direction. It touches no fork feature surface (sharing / Shared
Spaces, sync contracts, faces & people, timeline, albums, library, storage, memories, search,
permissions/RBAC).

### Zero-conflict semantic break gate

The fork diverges substantially in `server/Dockerfile` (the plugins-stage rewrite, `COPY patches`,
`SHARP_IGNORE_GLOBAL_LIBVIPS`, `plugin-gallery`), so the three upstream lines land next to fork
content. Checks run:

- **Silent-no-op detector** (literals upstream removes, grepped against fork literal-matching
  tooling under `branding/scripts`, `tools`, `.github/actions`): **no hits**. A repo-wide grep for
  the old tag `202608251107` and both old digests found them **only** on the three lines upstream
  replaces — nothing else in the fork pins them.
- **Shape D (stage relocation)**: the plugins stage still inherits `WORKDIR /usr/src/app` from
  `builder`, and all four `COPY --from=plugins` lines still read `/usr/src/app/packages/...`. The
  anchored `^COPY --from=plugins /app/` check is clean.
- **Shape I / K / L**: not applicable and structurally excluded — the batch adds, deletes and
  renames no files, and the whole-tree diff is two files.
- **Zero-byte tracked files**: only the three long-standing intentional ones (`CODEOWNERS`,
  `docs/static/.nojekyll`, `docs/static/CNAME`), unchanged from the green tip.
- **i18n branding-override detector**: not applicable, `i18n/` tree is byte-identical.

## Conflict Resolutions

None — the rebase replayed all 1395 fork commits with zero conflicts.

## Fork Feature Verification

Every fork feature surface is **byte-identical** to the tree that went 10/10 CI-green, so
verification is by tree identity rather than by inspection:

| Area                                              | `backup/rolling-pre-b199-20260831` vs `HEAD`                |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `server/`                                         | CHANGED — `server/Dockerfile`, `server/Dockerfile.dev` only |
| `web/`, `mobile/`, `machine-learning/`, `e2e/`    | IDENTICAL                                                   |
| `open-api/`, `packages/`, `i18n/`                 | IDENTICAL                                                   |
| `.github/`, `docker/`, `deployment/`, `branding/` | IDENTICAL                                                   |
| `docs/`, `scripts/`, `specs/`                     | IDENTICAL                                                   |

Fork content asserted present in `server/Dockerfile` after the rebase: `COPY patches ./patches/`
(1), `SHARP_IGNORE_GLOBAL_LIBVIPS=true` (1), `plugin-gallery` (5), `binaryen` (2), `js-pdk` (2).

| Feature                           | Status | Notes                                                      |
| --------------------------------- | ------ | ---------------------------------------------------------- |
| Shared Spaces                     | OK     | tree identical                                             |
| Storage Migration                 | OK     | tree identical                                             |
| Pet Detection                     | OK     | tree identical                                             |
| Image Editing                     | OK     | tree identical                                             |
| Branding                          | OK     | tree identical                                             |
| Google Photos Import              | OK     | tree identical                                             |
| Gallery plugin (`plugin-gallery`) | OK     | Dockerfile stage + both `COPY --from=plugins` lines intact |

## CI and Infrastructure Verification

| Check                                                 | Status | Notes                                                        |
| ----------------------------------------------------- | ------ | ------------------------------------------------------------ |
| Workflow files (no upstream collisions)               | OK     | `.github/` tree identical                                    |
| Docker image references (`gallery-*`, not `immich-*`) | OK     | `ci-invariants-check` → `gallery-release-image-names` passed |
| Branding (no upstream-name leaks)                     | OK     | `branding/` + `i18n/` trees identical                        |
| Fork CI modifications intact                          | OK     | `.github/` tree identical                                    |
| New upstream workflows reviewed                       | OK     | none added                                                   |
| Action/tool versions compatible                       | OK     | none changed                                                 |

## Database Migration Analysis

No migrations in this batch. `server/src/schema/` is byte-identical to the green tip.

- New upstream migrations: **none**
- Gallery migration count: **62** (expected 62) — `upstream-postrebase-audit` OK
- Timestamp collisions: **none** — audit OK
- `postbuild` script + `CompositeMigrationProvider`: intact (tree identical)
- `scripts/revert-to-immich.sql` coverage: unchanged; no migration added or removed on either side

## Mobile Drift Migration Analysis

No mobile changes. `mobile/` tree is byte-identical.

`make mobile-drift-rebase-check BATCH=199` → OK: schemaVersion, snapshots and Gallery callbacks
consistent.

## Inconsistencies Found

None.

## Pattern Propagation

No broad upstream refactor in this batch.

## Gate Checks

| Gate                                       | Result                                                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make upstream-postrebase-audit BATCH=199` | OK — 7/7 checks (fork-owned files, extension symbols, migration count/filenames/manifest, timestamp collisions, generated artifacts)                                |
| `make ci-invariants-check`                 | OK — 5/5 (`no-push-o-matic`, `gallery-release-image-names`, `gallery-docs-deploy-disabled-upstream`, `person-join-not-viewer-filtered`, `search-v3-not-dispatched`) |
| `make fork-patches-check`                  | OK — `@immich/ui` patch metadata consistent                                                                                                                         |
| `make commit-autolink-check`               | OK — 1395 messages scanned, fork PR ceiling 1037, no cross-repo autolink                                                                                            |
| `make mobile-drift-rebase-check BATCH=199` | OK                                                                                                                                                                  |

## Local CI Verification

Scoped by tree identity against the last 10/10-green commit `089302bceef` (whose only delta to the
pre-rebase tip `dfc066e2811` was the previous cycle's report markdown). Every source area is
byte-identical to that green state, so source-level local gates are redundant this cycle and were
deliberately skipped rather than silently omitted:

| Check                                            | Status              | Notes                                    |
| ------------------------------------------------ | ------------------- | ---------------------------------------- |
| `server pnpm build` / `pnpm check`               | SKIPPED (redundant) | no `server/src` change; only Dockerfiles |
| `web check:typescript` / `check:svelte` / eslint | SKIPPED (redundant) | `web/` tree identical to green           |
| Server + web unit tests                          | SKIPPED (redundant) | trees identical to green                 |
| Mobile analyze / format / test                   | SKIPPED (redundant) | `mobile/` tree identical to green        |
| OpenAPI + SQL regeneration                       | SKIPPED (redundant) | no controller/DTO/repository change      |
| Fork gate checks (above)                         | PASS                | run in full regardless                   |

The two changed files are Dockerfiles, which no local type/lint/test gate exercises. They are
validated remotely by `docker.yml`, which is where the real risk of a base-image bump lives.

## Remote CI Verification

- **Test branch**: `rebase/upstream-batch-199`
- **Commit validated**: (filled in below)

| Workflow                                  | Status  | Notes                                |
| ----------------------------------------- | ------- | ------------------------------------ |
| `test.yml`                                | pending |                                      |
| `docker.yml`                              | pending | the load-bearing gate for this batch |
| `static_analysis.yml`                     | pending |                                      |
| `gallery-build-mobile.yml`                | pending |                                      |
| `gallery-rebase-smoke.yml`                | pending |                                      |
| `storage-migration-tests.yml`             | pending |                                      |
| `storage-migration-e2e.yml`               | pending |                                      |
| `gallery-revert-to-immich-validation.yml` | pending |                                      |
| `gallery-ml-smoke.yml`                    | pending |                                      |
| `gallery-mobile-smoke.yml`                | pending |                                      |

## Post-Rebase Verification

- Fork commits ahead of upstream: **1395**
- Commits behind upstream: **0**
- Fork diff clean: **YES** — whole-tree delta vs the pre-rebase tip is 2 files / 3 lines
- Backup branch: `backup/rolling-pre-b199-20260831` (`dfc066e2811`)

## Landing

**Stays off `main`.** The latest upstream stable tag is still `v3.1.0`, which `branding/config.json`
already carries; `v3.2.0-rc.0` / `v3.2.0-rc.1` are release candidates, not a tag to cut over to.
Rule 1 of the standing landing rule is unmet, so there is nothing to decide.

## Skill Sync Anchor

`origin/main` has not moved since the previous cycle — the anchor scan
`git log 9c31bc01655..origin/main` is empty. Anchor stays at `9c31bc01655`; `fork-surface.md` needs
no new rows.
