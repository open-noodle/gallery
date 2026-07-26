# Upstream Sync Report — 2026-07-26

This day has three cycles, in order: two fork-only syncs (below), then **upstream batch 51**
(the first upstream commit of the day — see the last section).

## Summary — fork sync #1

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

## Upstream batch 51 — `3606144190f`

The first upstream commits of the day landed after both fork syncs above. `upstream/main`
advanced `409734e1db3..3606144190f` — **one commit**.

### Summary

- **Upstream commits pulled**: 1
- **Fork commits synced**: 0 — `integratedForkHead` already equals `origin/main` (`9230c433c87`)
- **Conflicts resolved**: 0
- **Risk level**: LOW
- **Recommendation**: PROCEED
- **Branch tip**: `10afa6023aa` → `9ac72a21af4` (1009 fork commits ahead, **0 behind**)

### Incoming upstream change

| SHA           | Summary                                                 | Area   | Risk to Fork | Notes                                                             |
| ------------- | ------------------------------------------------------- | ------ | ------------ | ----------------------------------------------------------------- |
| `3606144190f` | chore: clarify MediaRepository extract logging (#30249) | server | LOW          | One `logger.debug` line inside the existing `extract()` try-block |

The whole diff is a single added line in `server/src/repositories/media.repository.ts`:

```
+        this.logger.debug(`Successfully extracted ${tag} buffer from image`);
```

### Product-direction gate: CLEAR

A debug log string changes no feature direction, data model, access/sync contract or API
shape. Nothing touching sharing/Shared Spaces, faces & people, albums, timeline, library,
storage, memories, search or RBAC. No new entity, no reworked model.

### Fork-surface analysis

`media.repository.ts` **is** fork-extended, so it was checked rather than assumed:

- Fork additions are `extractVideoFrames()` (video dedup) and `trim()` (video trimming),
  plus a `node:path` import — all far from `extract()`.
- Post-rebase `git diff upstream/main..HEAD` for the file is **+61 / −0** — purely additive,
  so no upstream content was displaced (the "lost upstream content" check, step 7a).
- The upstream line is present at line 85 of the rebased tree.

Not applicable this cycle: no migrations (server or mobile Drift), no DTO/controller/enum
changes, no generated OpenAPI/Dart artifacts, no lockfile or toolchain changes, no CI or
workflow changes, no dependency bumps, no broad refactor (so no pattern-propagation work).
`make sql` was deliberately **not** run — no database was up, and that combination deletes
every query file.

### Gate checks

| Check                                     | Status | Notes                                                                   |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `upstream-postrebase-audit BATCH=51`      | PASS   | All 7 sub-checks OK, incl. Generated Artifact Review (no review needed) |
| `fork-patches-check`                      | PASS   | `@immich/ui` patch metadata consistent                                  |
| `ci-invariants-check`                     | PASS   | no-PUSH_O_MATIC, gallery image names, docs-deploy stays dispatch-only   |
| `mobile-drift-rebase-check BATCH=51`      | PASS   | schemaVersion 36, snapshots + Gallery callbacks consistent              |
| Gallery migration count                   | PASS   | 49 (expected 49)                                                        |
| `revert-to-immich.sql` coverage (step 7i) | PASS   | 0 missing across 49 fork + post-v3.0.3 upstream migrations              |

### Fork invariant spot-checks

| Invariant                                  | Status | Evidence                                                                                                                                                                  |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S3 profile-image branch                    | OK     | `DiskStorageBackend` guard live at `auth.service.ts:409`, `user.service.ts:129`                                                                                           |
| Search V3 stays dormant                    | OK     | All fork call-sites on `searchAssetBuilderLegacy`; the only bare `searchAssetBuilder(` uses are the V3 definition + the two unwired V3 methods; 3 dormancy banners intact |
| No upstream image leak in workflows        | OK     | Only 2 `ghcr.io/immich-app/immich-server` refs, both the intentional boot of tagged upstream in `gallery-revert-to-immich-validation.yml`                                 |
| Lockfile workspace linking                 | OK     | 9 `version: link:` entries, 0 `version: file:` (injected-copy trap absent)                                                                                                |
| `mise.lock` / `mobile/mise.lock` untouched | OK     | `git status` clean for both                                                                                                                                               |
| Postbuild migration merge                  | OK     | Build synced 49 migrations + 1 compatibility alias (`ChangeDurationToInteger`)                                                                                            |

### Local verification

| Check                                       | Status | Notes                                       |
| ------------------------------------------- | ------ | ------------------------------------------- |
| `server pnpm build` (nest + postbuild sync) | PASS   |                                             |
| `server pnpm check` (tsc)                   | PASS   |                                             |
| `web check:typescript`                      | PASS   |                                             |
| `web check:svelte`                          | PASS   | 571 files, 0 errors, 0 warnings             |
| Server unit tests                           | PASS   | 153 files, 5206 passed / 14 skipped         |
| Web unit tests                              | PASS   | 293 files, 3950 passed / 2 skipped / 8 todo |
| `gallery-branding-check`                    | PASS   | branding + mobile image assets verified     |

Lint was left to CI this cycle: no fork-side edit was made — the tree is the previous
CI-green tip plus one upstream log line — and the local web lint gate still crashes in
`tscompat` unless the rule is disabled.

### Remote CI — full 10-workflow set, all GREEN first try

Test branch `rebase/upstream-rolling-2026-07-26` @ `4e613bbf150` — the branch tip moved to
`3d3b564743c` afterwards purely to fold these CI results into this report; the source tree is
byte-identical to the validated commit. (Not the batch-plan's
suggested `rebase/upstream-batch-51`: that ref already exists from the pre-restart batch
numbering, and clobbering it would corrupt an older audit trail.)

| Workflow                                  | Run         | Status                           |
| ----------------------------------------- | ----------- | -------------------------------- |
| `test.yml`                                | 30217262255 | GREEN (21/21 jobs, none skipped) |
| `docker.yml`                              | 30217263366 | GREEN                            |
| `static_analysis.yml`                     | 30217264116 | GREEN                            |
| `gallery-rebase-smoke.yml`                | 30217264874 | GREEN                            |
| `storage-migration-tests.yml`             | 30217269351 | GREEN                            |
| `gallery-revert-to-immich-validation.yml` | 30217270233 | GREEN                            |
| `gallery-ml-smoke.yml`                    | 30217271000 | GREEN                            |
| `gallery-mobile-smoke.yml`                | 30217271877 | GREEN                            |
| `storage-migration-e2e.yml`               | 30217272669 | GREEN                            |
| `gallery-build-mobile.yml`                | 30217273574 | GREEN                            |

No retries, no flakes, no fixes. The full set was dispatched (rather than the reduced
fork-sync set) because this cycle pulled a real upstream commit.

### Code review

Step 7g was not run: there were **zero conflict resolutions and zero fork-side edits** this
cycle, so no new code exists to review. Fork-file and fork-symbol survival were verified
mechanically by the post-rebase audit instead.

## Not done — deliberately

No cutover to `main`: ruleset 13531204 (`non_fast_forward`, zero bypass actors) still blocks
the force-push — unchanged standing decision since 2026-07-22.
