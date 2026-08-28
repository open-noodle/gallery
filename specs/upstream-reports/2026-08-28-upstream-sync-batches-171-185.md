# Upstream Sync Report — 2026-08-28 (batches 171–185)

## Summary

- **Upstream commits pulled**: 17 (`093f5c070ad..8178a01522f`)
- **Fork commits synced**: 2 (`bcb635ae28f..4b484696575` — #1029, #1030/#1032)
- **Conflicts resolved**: 24 stops (4 auto-resolved by a proven rename resolver, 20 by hand)
- **CI**: green on `fb66d3fe2dc`; the nine non-`Test` workflows green on `3a94ecfdc90`, which
  differs only by the two fixes below (neither touches their inputs)
- **Risk level**: MEDIUM-HIGH (a 92-file mobile mass rename + a cluster-groups extension)
- **Recommendation**: PROCEED — **10/10 gating workflows green** (`Test` 21/21)
- **Landing**: NOT a cutover cycle. Latest upstream tag is still `v3.1.0`, which
  `branding/config.json` already carries, so the branch stays off `main`.

Final state: `upstream/main` `8178a01522f`, **0 behind / 1372 ahead**.

## Incoming Upstream Changes

| SHA                                                     | Summary                                                  | Area       | Risk     | Outcome                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------- | ---------- | -------- | ---------------------------------------------------------------------------------- |
| `c04c81a979a`                                           | remove `Drift*` prefixes (immich-31038)                  | mobile     | **HIGH** | 82 classes + 9 providers + 41 file renames; 56 fork files propagated               |
| `c7d24321bf3`                                           | re-run facial recognition for their group (immich-30965) | server+web | **HIGH** | Kept inert under option M; web UI stays amputated                                  |
| `2c0f415a569`                                           | only move floating docker tags (immich-31030)            | CI         | MED-HIGH | Fork #218 keeps the Docker Hub mirror job deleted                                  |
| `a366db1494f`                                           | cut releases from release branches (immich-31033)        | CI         | MED-HIGH | `packages/scripts` stays dropped; migration-order keeps only the fork step         |
| `0179e612a10` `3be6b122922` `b22483de336` `2ba343e138b` | release-line workflows (immich-31024/31025/31035/31052)  | CI         | MED      | `draft-release.yml` + `backport.yml` deleted — they need Immich's PUSH_O_MATIC app |
| `293dd5889c8`                                           | openapi-generator → 7.25 (immich-30995)                  | codegen    | MED      | Broke the Dart template patch; guarded (see below)                                 |
| `05e84dd5db7`                                           | restore timeline scroll (immich-30916)                   | web        | MED      | Fork's temporal-anchor guard re-applied                                            |
| `f16fdafefc5` `6eb1c93882d`                             | slideshow pause, memory video visibility                 | web        | LOW      | Clean                                                                              |
| 5 dependency/digest bumps                               | base-server-dev, opentofu, prometheus, grafana, js-pdk   | infra      | LOW      | Clean                                                                              |

No new upstream migrations and no `server/src/schema/` changes, so the
revert-to-immich coverage gate had nothing new to cover (verified).

## Product-direction gate

**Fired on `c7d24321bf3`** (extends upstream's cluster-groups feature) and **cleared
on the standing decision**: Gallery does not adopt cluster groups
(`project_cluster_groups_30739_quarantine`; option M, `ClusterGroupController`
unmounted). No re-brainstorm was needed — the direction was already settled — but the
commit still had to be reconciled deliberately, because it ships a **live web button**
into a surface whose controller the fork does not mount:

- `SharingSettings.svelte` — the fork deletes upstream's whole cluster-group section.
  Upstream added a "Reset facial recognition" button _inside_ it plus a
  `handleRerunFacialRecognition` handler _outside_ it. Taking the deletion alone would
  have left the orphaned handler calling a removed import; both were removed.
- The medium spec's cluster-group tests stay deleted behind the fork's option-M comment.
- Server plumbing (`clusterGroupId` params, `IFacialRecognitionQueueAll`) was taken
  inertly — it is reachable only through the unmounted controller.

## Conflict resolutions worth recording

### The Drift\* rename (batch 171)

Resolved with a **rename map derived from the commit's own declaration diffs**, not by
stripping the prefix. That distinction mattered:

- `DriftMap` → **`MapView`**, not `Map`. The naive rule would have shadowed a Dart core type.
- `driftProvider` is **not** renamed — it survives upstream, and appears in the removed
  set only because it shares lines with renamed symbols. Excluded by testing whether the
  _old_ name still exists upstream.
- 33 `*Route`/`*RouteArgs` names come from the untracked generated `router.gr.dart`;
  they follow deterministically from the confirmed `*Page` renames.

A hunk was auto-resolved only when `rename(base) == ours` (optionally under a
whitespace/trailing-comma normalisation), i.e. only when upstream's change to that
region was provably the rename plus formatter reflow. The resolver was proven both
ways before use: it resolves rename-only and rename+reflow hunks, and refuses an
added argument, a removed line, and a both-sides-changed line.

### Three resurrections the replay let through

All the same shape — a fork commit deletes a path, upstream renames a file onto it, so
the deletion no longer reaches the content:

1. **`presentation/pages/search/search.page.dart`** — fork #654 removed the mobile search
   page. Came back with 11 imports pointing at deleted files and zero inbound references.
2. **`test/providers/backup/backup_provider_test.dart`** — fork #892 deleted the fork's own
   #627/#639/#658 backup tests; the rename carried them onto the new path where they no
   longer compiled against upstream's `BackupNotifier`. Restored upstream's test
   byte-identical and dropped the now-redundant `drift_backup_provider_test.dart`.
3. **`providers/backup/drift_backup.provider.dart`** — upstream merged this file into
   `backup.provider.dart`; the fork's copy survived as a duplicate definition of
   `BackupState`/`BackupNotifier`/`backupProvider`. Verified semantically identical
   before deleting.

A fourth was self-inflicted: the batch driver fell through to `--theirs` on a
delete/modify conflict and left a tracked **zero-byte `backport.yml`**, which Actions
reads as an invalid workflow. Removed.

### Fork behaviour that upstream's version would have dropped

- **`person.service.ts` force recognition.** Upstream passes
  `sourceType: clusterGroupId ? MachineLearning : undefined`. With no cluster group —
  the fork's only case — that is `undefined`, so a force re-run would also wipe
  **manually assigned** faces. Fork #600 exists precisely to prevent that. Resolved to
  the fork's unconditional `MachineLearning` scoping plus upstream's `clusterGroupId`.
- **`Timeline.svelte`.** immich-30916 replaced "scroll to top" with "restore
  `lastVisibleScrollTop`", which looked like it subsumed the fork's `!temporalAnchor`
  guard. It does not — `lastVisibleScrollTop` is 0 on a fresh mount. **The fork's own
  spec caught this after I had resolved it in upstream's favour**; the guard is back.
- **`person.repository.ts` left join.** The fork moved the predicates into the `ON`
  clause (a `WHERE` on a left-joined table turns it into an inner join and breaks the
  `count = 0` search). Kept the fork's structure with upstream's widened `isVisible`.
- **Medium-spec DI lists** (Shape J): `FaceIdentityRepository`, `SharedSpaceRepository`
  and `FacePersonVerdictRepository` each had to be unioned into upstream's enumerated
  `real:` list. Final set audited against the pre-batch list — identical.
  `SystemMetadataRepository` was additionally removed from `real:` because the fork
  mocks it.

### Upstream defects found

- **openapi-generator 7.25 (immich-30995) breaks upstream's own Dart template patch.**
  7.25 ships all three hunks of `native_class.mustache.patch` natively, so `patch`
  reports "previously applied" and exits non-zero under `set -e` — failing
  `mise //:open-api`, which is exactly what test.yml's "OpenAPI Clients" job runs.
  Proven upstream's: it fails identically against a clean 7.25 template extraction with
  no fork input, and all four `open-api/patch/` files are byte-identical to upstream.
  Guarded fork-side by skipping already-applied hunks while still failing on a genuine
  rejection. A full regeneration under 7.25 produces byte-identical output.
- **`console.log('unassigning faces')`** shipped in immich-30965 and is still on
  `upstream/main`. Dropped here.

## Verification

| Check                                               | Result                                               |
| --------------------------------------------------- | ---------------------------------------------------- |
| `server pnpm build` (+ postbuild migration sync)    | PASS — 62 migrations, 1 compatibility alias          |
| `server pnpm check` / `web check:typescript`        | PASS                                                 |
| `web check:svelte`                                  | PASS — 627 files, 0 errors                           |
| `server pnpm lint` + prettier                       | PASS                                                 |
| web eslint (`tscompat` off) + prettier              | PASS — 0 errors                                      |
| `.github` prettier (separate gate)                  | PASS                                                 |
| `e2e pnpm check`                                    | PASS                                                 |
| Server unit tests                                   | PASS — 6087                                          |
| Web unit tests                                      | PASS — 5961                                          |
| Mobile `dart analyze --fatal-infos` + `dart format` | PASS                                                 |
| Mobile tests                                        | PASS — 3479                                          |
| `drift_dev make-migrations`                         | PASS — every snapshot byte-identical (Shape L clear) |
| `mise //:open-api` full regen                       | PASS — no artifact drift                             |
| post-rebase audit (BATCH=185)                       | 7/7 OK                                               |
| fork-patches / ci-invariants / commit-autolink      | PASS                                                 |
| revert-to-immich coverage                           | PASS — no new migrations                             |
| i18n branding-override gate                         | PASS                                                 |

## Follow-ups

1. **Upstream's broken Dart patch** — the guard is a workaround. When upstream updates
   `native_class.mustache.patch` for 7.25, the guard becomes a no-op and can be dropped.
2. **`ClearPreOptionMFaceRepairScans`** was missing from `docs/fork/ownership.yml`
   (added here); it landed with the rolling-branch review fixes without a manifest row.
3. **Deleted upstream workflows are only partly gated.** `draft-release.yml` and
   `backport.yml` are caught by the `no-push-o-matic` invariant (verified by restoring
   one and watching the check go red, then green). `prepare-release.yml` and
   `docs-destroy.yml` carry no forbidden pattern, so nothing would catch their
   resurrection — worth a file-must-not-exist invariant.
4. **`test/providers/backup/` naming** — the fork now carries upstream's test at
   upstream's path, so the previous restoration commit's job is done.

## Remote CI

- **Test branch**: `rebase/upstream-batch-185`
- **Commit validated**: `fb66d3fe2dc` (`Test`); `3a94ecfdc90` for the other nine

| Workflow                                                                         | Status                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `test.yml`                                                                       | GREEN — 21/21 jobs                                     |
| `docker.yml`                                                                     | GREEN                                                  |
| `static_analysis.yml`                                                            | GREEN                                                  |
| `gallery-build-mobile.yml`                                                       | GREEN — iOS + Android compile after the 92-file rename |
| `gallery-mobile-smoke.yml` · `gallery-ml-smoke.yml` · `gallery-rebase-smoke.yml` | GREEN                                                  |
| `storage-migration-tests.yml` · `storage-migration-e2e.yml`                      | GREEN                                                  |
| `gallery-revert-to-immich-validation.yml`                                        | GREEN                                                  |

### Two defects CI caught that every local gate missed

Both came from conflict resolutions, and both were invisible to `tsc`, lint and the unit suites:

1. **SQL Schema Checks** — `server/src/queries/person.repository.sql` was stale. `@GenerateSql`
   documents a method's _emitted SQL_, so editing the **body** of an already-decorated method
   drifts the queries with no new method and no signature change. Three did:
   `unassignFaces` gained the fork's `face_identity_face` prologue plus upstream's
   `clusterGroupId`, `getAllFaces` inherited upstream's decorator, and the left join widened
   `isVisible`. The old skip rule ("no repository method changed") is wrong; the right one is
   _did any conflict touch `server/src/repositories/`?_
2. **Medium Tests (Server)** — the option-M comment resolution re-added an empty
   `describe('mergePerson')` beside the real block, and vitest fails a suite with no tests.

Both fixed in `fb66d3fe2dc`; both jobs green on the re-run.

### Local medium-suite note

Run locally against a single Postgres the suite reported 124, then 101, then 11 failures — a
_shifting_ set, i.e. contention (150 "too many clients" against 6 assertions), not regressions.
Capping concurrency (`--poolOptions.threads.maxThreads=3`) settled it at 11, all in `exif/*`,
`library.service` and `sync-partner`. Those five paths are **byte-identical** to the pre-batch tip
that was 10/10 green last cycle, so the cycle cannot be their cause — and CI's Medium Tests job
is green, which settles it.
