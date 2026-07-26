# Upstream Sync Report — 2026-07-26 (fork sync only)

## Summary

- **Upstream commits pulled**: 0 — `upstream/main` is still `409734e1db3` (verified against
  the live remote; the branch remains 0 behind, batches 51/51 complete)
- **Fork commits synced**: 9 (`b19653e2829..068d97a9e4c` on `origin/main`, PRs #845–#857)
- **Conflicts**: 0 — `make upstream-sync-fork-main` completed cleanly (no mid-flight abort
  this time); `integratedForkHead` auto-advanced to `068d97a9e4c`
- **Risk level**: LOW
- **Branch tip**: `d5ff14e569e` — test.yml + docker.yml green on it,
  gallery-mobile-smoke green on `bf9c9026bde` (no mobile/i18n input changed after)

## Incoming fork commits

| SHA (on branch) | Summary                                                                       | Area              |
| --------------- | ----------------------------------------------------------------------------- | ----------------- |
| `b86fbd8582d`   | ci(rc): publish an incrementing immutable tag per PR RC build (#845)          | CI                |
| `8a709fe5d38`   | fix(web): stop duplicate keys wedging People page infinite scroll (#847)      | web               |
| `7197ef59d71`   | ci(rc): run RC cleanup on pull_request_target so it survives the merge (#846) | CI                |
| `c12bef64c5b`   | fix(branding): rebrand localized strings instead of deleting them (#852)      | branding          |
| `c08e0444dc1`   | feat(web): space managers add non-owned selections to a space album (#853)    | web + server      |
| `71d04fbbf61`   | feat(web): let the space album picker browse the space's photos (#855)        | web               |
| `dc9105fb249`   | feat(spaces): let owners and editors rename a space (#856) (#857)             | web + server, e2e |
| `2351929991e`   | fix(s3): honor HTTP Range requests in proxy serve mode (#854)                 | server + e2e      |
| `002579393df`   | fix(i18n): complete fork-string coverage across all nine locales (#851)       | i18n              |

Risk scan of the incoming set: **no server migrations, no mobile Drift changes, no generated
OpenAPI/Dart artifacts, no lockfile/toolchain changes** — so no `revert-to-immich.sql` work,
no renumbering, no `merge: unset` wholesale conflicts.

## Toolchain drift — 4th and 5th occurrences of "clean on main, red on the rolling branch"

The commits were CI-green on `main` (eslint-plugin-unicorn v70, older bits-ui/vitest) and
failed here on the branch's newer toolchain, in two distinct ways.

### eslint-unicorn v72 (13 errors across server, e2e, web)

Fixed in `bf9c9026bde` (server + e2e, caught locally before dispatch) and `d5ff14e569e`
(web, caught by CI Lint Web):

| File                                                 | Rule                                   | Fix                                                                                                             |
| ---------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `server/src/dtos/shared-space.dto.spec.ts`           | `prefer-string-repeat`                 | `' '.repeat(3)`                                                                                                 |
| `server/src/utils/file.spec.ts`                      | `no-this-outside-of-class`             | self-reference in `Readable` mock (in-file idiom)                                                               |
| `server/src/backends/s3-storage.backend.spec.ts`     | `no-error-property-assignment`         | plain-object rejection mock (in-file `{ name: … }` idiom)                                                       |
| `e2e/src/specs/server/api/spaces-update.e2e-spec.ts` | `prefer-string-repeat`                 | `' '.repeat(3)`                                                                                                 |
| `e2e/src/storage-migration.ts` (×3)                  | `no-unnecessary-fetch-options`         | removed explicit-default `redirect: 'follow'`                                                                   |
| `web/src/lib/modals/SpaceEditModal.spec.ts`          | `prefer-string-repeat`                 | `' '.repeat(3)`                                                                                                 |
| `web/src/lib/modals/SpaceEditModal.svelte`           | `consistent-conditional-object-spread` | `...(description !== originalDescription && { description })` — payload-shape spec confirms identical semantics |
| `…spaces…/space-album-detail-page.spec.ts` (×2)      | `no-this-outside-of-class`             | `eslint-disable-next-line` on mock getter (download.controller.spec idiom)                                      |
| `…spaces…/space-person-detail-page.spec.ts` (×2)     | `no-this-outside-of-class`             | same                                                                                                            |

Note: CI Lint Web also printed 8 warnings (7× unused `unicorn/no-unnecessary-global-this`
disables + 1 unused var). These are **pre-existing and tolerated** — they appear verbatim in
the previous green run (job 89669490669); the web lint gate is `eslint . --concurrency 6`
with no `--max-warnings`, so only errors gate. Left untouched.

### bits-ui scroll-lock teardown race (Test Web)

Test Web failed with **3950/3950 tests passing**: one _unhandled_ `ReferenceError: document
is not defined` from bits-ui's `body-scroll-lock` `resetBodyStyle`, attributed to the new
`SpaceEditModal.spec.ts` (#856/#857). bits-ui schedules the body-style reset on a **24 ms
timer** after the last dialog unmounts (bits-ui#1639); when the file's happy-dom environment
tears down inside that window, the timer fires against a dead `document`. Green on `main`'s
older bits-ui/vitest; a timing race here — it does not reproduce in a local single-file run.

Root-cause fix (no retry-if-flaky): the spec's `afterEach` now calls `cleanup()` and waits
30 ms so the reset fires while `document` still exists. **Expect this class in any future
fork-synced spec that renders a real `@immich/ui` modal** — same fix applies.

## Local verification

| Check                                                                          | Status             |
| ------------------------------------------------------------------------------ | ------------------ |
| Full web eslint (`tscompat` rule disabled)                                     | PASS (after fixes) |
| Server + e2e eslint (changed files)                                            | PASS (after fixes) |
| Prettier (edited files)                                                        | PASS               |
| `server pnpm check` (tsc)                                                      | PASS               |
| `web check:typescript` + `check:svelte` (571 files)                            | PASS               |
| Edited server specs (`vitest --run`, 72 tests)                                 | PASS               |
| Edited web specs (`vitest --run`, 121 tests)                                   | PASS               |
| `fork-patches-check` / `ci-invariants-check` / `fork-ownership-coverage-check` | PASS               |

## Remote CI

| Workflow                   | Commit        | Run         | Status                                                                                                  |
| -------------------------- | ------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `test.yml`                 | `bf9c9026bde` | 30196377041 | RED — Lint Web (6 unicorn-v72 errors) + Test Web (scroll-lock teardown race)                            |
| `test.yml`                 | `d5ff14e569e` | 30197238264 | GREEN                                                                                                   |
| `docker.yml`               | `bf9c9026bde` | 30196378011 | GREEN                                                                                                   |
| `docker.yml`               | `d5ff14e569e` | 30197239168 | GREEN (re-run — the web fix touches shipped-bundle source)                                              |
| `gallery-mobile-smoke.yml` | `bf9c9026bde` | 30196378627 | GREEN (dispatched because #851 touches `i18n/`, which feeds mobile codegen; no mobile/i18n delta after) |

Per the fork-sync rule the full 10-workflow set was not re-dispatched: this cycle pulled
**zero upstream commits**, and the fork commits were fully CI-validated on `main` — the
re-validated surface is the toolchain-drift one (lint/tests/build), covered above.

## Fork sync — later the same day (#772)

While the report above was being written, `9230c433c87` — fix(editing): enable video trim on
S3-backed storage (#671) (#772) — landed on `origin/main`. Synced cleanly with
`make upstream-sync-fork-main` (no conflicts, 27 files, `integratedForkHead` → `9230c433c87`,
branch commit `82cc4470ada`). Risk scan: no migrations, no Drift, no generated artifacts, no
lockfile changes. It cherry-picked cleanly on top of this morning's
`s3-storage.backend.spec.ts` lint fix.

Toolchain drift, same v72 class, all in `e2e/src/storage-migration.ts` (fixed in
`f1d7f5b6c6c`): one `unicorn/no-duplicate-loops` (`.filter()` in a `for…of` header → `continue`
guard) and two more explicit-default `redirect: 'follow'` fetch options. Server-side lint was
clean; `pnpm check` clean; all five changed server spec files pass locally (512 tests);
the #772 plan/spec markdown passes the docs prettier gate.

| Workflow                      | Commit        | Run         | Status |
| ----------------------------- | ------------- | ----------- | ------ |
| `test.yml`                    | `f1d7f5b6c6c` | 30197988235 | GREEN  |
| `docker.yml`                  | `f1d7f5b6c6c` | 30197989075 | GREEN  |
| `storage-migration-tests.yml` | `f1d7f5b6c6c` | 30197989778 | GREEN  |
| `storage-migration-e2e.yml`   | `f1d7f5b6c6c` | 30197990549 | GREEN  |

The storage-migration suites were added to the dispatch set because #772 modifies their
workflow file, the e2e harness, and the disk/S3 backends they exercise.

## Not done — deliberately

No cutover to `main`: ruleset 13531204 (`non_fast_forward`, zero bypass actors) still blocks
the force-push — unchanged standing decision since 2026-07-22.
