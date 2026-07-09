# Upstream Sync Report — 2026-07-09 (Immich v3.0.1 → v3.0.2)

## Summary

- **Upstream commits pulled**: 55 (v3.0.1 `f77c8a4699` → v3.0.2 `443b856ac3`) — a patch release (34 `fix`, 17 `chore`, 4 `feat`)
- **Fork commits replayed**: 893 (squash base + individual PRs) + 5 new `origin/main` commits cherry-picked on top
- **Conflicts resolved**: ~30 stop points (server DTOs, mobile timeline, mobile Drift, CI/lockfiles, i18n, docs, iOS plist)
- **Risk level**: MEDIUM
- **Recommendation**: PROCEED (after full local + remote CI)

Method: fork `main` was cleanly based on upstream `v3.0.1`, so this was a linear
`git rebase --onto immich-v3.0.2 immich-v3.0.1`. Deferred-reconciliation files
(`system-config.dto.ts`, `config.ts`, `timeline.widget.dart`, `timeline.state.dart`)
were resolved once at the end via a 3-way `git merge-file` against the final fork
tip + the upstream v3.0.2 delta, rather than merged into every intermediate commit.

## Incoming Upstream Changes (high-interest)

| SHA                                           | Summary                                                                                                | Area   | Risk to Fork | Resolution                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| c7b4a798cb                                    | incorrect grouping of recently added assets (mobile Drift v31: `idx_remote_asset_uploaded` + `sortBy`) | mobile | HIGH         | **Renumbered v31 → v35** (collides with fork v31–v34); layered `sortBy`/`uploadedAt` onto fork's `temporalScope` in `timeline.repository.dart` |
| 0ebb723b39                                    | wrap migrations in transaction                                                                         | mobile | HIGH         | Adopted `try/transaction/finally` wrapper into the fork's migration executor; `migration_test` 598 pass                                        |
| 2ad554fc61                                    | update timeline args on layout constraint changes                                                      | mobile | MED          | `Timeline` → `ConsumerWidget` + `overrideWithValue` + `didUpdateWidget` refactor merged with fork grouping-pill                                |
| 99a8354145                                    | match iOS scroll-to-top / tabbar scroll                                                                | mobile | MED          | `WidgetsBindingObserver` + `handleStatusBarTap` + `_scrollToTop` extraction merged with fork scroll-drain (#643)                               |
| 69d568f289                                    | HLS variant configuration                                                                              | server | MED          | Additive `realtime` HLS config in `system-config.dto.ts` / `config.ts`; regenerated SDK (`HlsVideoResolution`)                                 |
| 0cbe07c4d4                                    | integrity checks dto validation                                                                        | server | MED          | `percentageLimit` `z.int()` → `z.float32().max(1)`; preserved through the reconstruction                                                       |
| f8e78792b8                                    | oauth account linking                                                                                  | server | LOW          | 1-line change, auto-merged; fork S3 profile branch intact                                                                                      |
| 655cd01d57                                    | search metadata for album shared links                                                                 | server | LOW          | +2 lines into fork-forked `search.service.ts`, resolved                                                                                        |
| 6da890ee37 / 427321a102                       | web search timeline visibility / clear selection                                                       | web    | LOW          | auto-merged                                                                                                                                    |
| deps: base-image, github-actions, mise, faker | dependency bumps                                                                                       | infra  | LOW–MED      | `mise.lock` kept fork's **pnpm 11.5.2 pin**; no `pnpm-lock.yaml` delta                                                                         |

**Notably clean:** no server migrations in the delta (no server renumbering); no `pnpm-lock.yaml` change.

## Conflict Resolutions (notable)

### `server/src/dtos/system-config.dto.ts` — reconstructed

The zod/class-validator **hybrid** file was mangled during replay (the giant squash's
class-validator-era diff met upstream's zod file; several fork "restore-zod" fix commits
partially healed it but left the OAuth/notification class-DTO region structurally broken —
fields floating outside `class SystemConfigDto`). **Resolution:** discarded the mid-replay
state and rebuilt via 3-way merge (base v3.0.1, ours `origin/main`, theirs v3.0.2). Result
verified: `export class SystemConfigDto extends createZodDto(SystemConfigSchema) {}` intact,
integrity schemas (float32), HLS realtime variant config, and fork classification +
`faceExclusion` all present. **Server build passes.**

### `mobile/.../timeline.widget.dart` / `timeline.state.dart` — reconstructed (3-way)

Upstream v3.0.2 refactored the whole `Timeline` widget while the fork carries the
grouping-pill (#681), route-local grouping (#625), and scroll-drain (#643) mechanics.
Reconciled once against the final fork tip: adopted `ConsumerWidget` + `overrideWithValue`

- `WidgetsBindingObserver` + `handleStatusBarTap` + `_scrollToTop` extraction; kept the
  grouping pill Stack, `emptyWidget`, and the `_requestScrollDrain`/`_attemptScrollDrain`
  machinery. `groupBy` reconciled to `groupByArg ?? ref.watch(timelineGroupingProvider)`
  (upstream's destructured var + fork's grouping source). `dart analyze`: no issues.

### Mobile Drift — upstream v31 renumbered to v35

Fork ships as a separate app; installed clients are at `schemaVersion=34` (shipped in the
v3.0.0-rc.0 → v3.0.1 builds), so the fork's v31–v34 must stay put. Upstream's own v31
(`idx_remote_asset_uploaded`) was renumbered to **v35** (`from34To35`), `schemaVersion 34→35`,
`@TableIndex.sql` added to `remote_asset.entity.dart`, and the v3.0.2 transaction wrapper
adopted. Regenerated `drift_schema_v35.json` + generated code; **`migration_test` 598 pass
(incl. every vN→v35 path).**

### `#749` + its revert netted out

`#749 (in-space album management)` was reverted by the next commit. Resolved both faithfully:
kept upstream v3.0.2's new live-photo `timeline_repository_test` group, dropped the
reverted space-album groups.

### Mechanical / policy resolutions

- `.github/workflows/prepare-release.yml` — kept the fork's **deletion** (modify/delete).
- `mise.lock` — took the fork's **pnpm 11.5.2** pin (11.6.0 breaks cold SDK builds).
- `mobile/ios/Runner/Info.plist` — kept the fork's tab-indented / placeholder-version form.
- `i18n/de.json` / `fr.json` — key-union merges (fork keys + upstream translation updates).
- Generated files (openapi, `.drift.dart`, `.steps.dart`, SQL, snapshots) — took a side during
  replay, then **regenerated** from source.

## Fork Feature Verification

| Feature                                           | Status | Notes                                                                       |
| ------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Shared Spaces (server/web/mobile)                 | OK     | services/controllers/schema intact; mobile Drift entities regenerated       |
| Storage Migration (S3)                            | OK     | no upstream overlap                                                         |
| Pet Detection                                     | OK     | config in `SystemConfigMachineLearning` intact                              |
| Auto-Classification (+ faceExclusion #453)        | OK     | reconstructed `system-config.dto.ts` retains classification + faceExclusion |
| Image Editing / Video Trim                        | OK     | media.service extensions unaffected by delta                                |
| Timeline grouping / filters (#625/#681/#722/#758) | OK     | reconciled with v3.0.2 timeline refactor; `dart analyze` clean              |
| Branding                                          | OK     | apply-branding untouched; iOS purpose strings intact                        |
| Smart search / filter panel                       | OK     | `search.service.ts` fork params intact after +2-line upstream change        |

## CI and Infrastructure Verification

| Check                                                            | Status | Notes                                                 |
| ---------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| `.github/workflows/` fork mods (github.token, gallery-\* images) | OK     | prepare-release deletion kept; no upstream collisions |
| `mise.lock` pnpm pin                                             | OK     | 11.5.2 preserved                                      |
| iOS `Info.plist` fork form                                       | OK     | tab-indented, build-time-stamped version              |
| revert-to-immich.sql coverage                                    | OK     | detector: **0 missing** (incl. new `#722` migration)  |

## Database Migration Analysis

- **Server**: delta added **no** upstream server migrations. Fork migrations-gallery unchanged
  (34) except the new `1782000000000-AddAssetExifDescriptionTrigramIndex` (from cherry-picked
  #722), which already carries its `revert-to-immich.sql` entry. Postbuild synced 34 migrations
  - 1 compat alias.
- **Mobile Drift**: upstream v31 → **v35** renumber (see above). Chain contiguous v1→v35;
  `schemaVersion` matches highest snapshot; `migration_test` green.

## New `origin/main` commits pulled in (cherry-picked on top)

`#758` mobile filter parity, `#722/#723` timeline description/filename/OCR filter (+ fork
migration), `#736` cross-owner people merge, `#748` add-filter-results-to-album, `#707`
config-driven memory types. All applied cleanly.

## Pattern Propagation

| Refactor                             | Old → New                             | Decision    | Notes                                                                     |
| ------------------------------------ | ------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| Migrations-in-transaction (`#29664`) | unwrapped → `try/transaction/finally` | **Bundled** | Adopted into fork's mobile migration executor; verified by migration_test |

_No broad cross-cutting refactor (e.g. class-validator→zod) landed in this patch delta._

## Regeneration

| Artifact                         | Result                                     |
| -------------------------------- | ------------------------------------------ |
| Drift (snapshot v35 + generated) | regenerated; committed                     |
| OpenAPI (TS SDK + Dart)          | regenerated; 3 files (HLS realtime config) |
| SQL query docs                   | regenerated; **no diff**                   |

## Local Verification

| Check                                        | Status           |
| -------------------------------------------- | ---------------- |
| SDK chain + `nest build` (server type-check) | PASS             |
| `dart analyze` (changed mobile files)        | PASS (no issues) |
| `flutter test` drift `migration_test`        | PASS (598)       |
| conflict markers in tree                     | none             |
| ahead / behind v3.0.2                        | 901 / 0          |

_Web unit tests, full mobile analyze/test, lint, and the full remote CI suite are run in the
push/CI phase._

## Post-Rebase Verification

- Fork commits ahead of upstream v3.0.2: 901
- Commits behind upstream: 0
- Fork diff looks clean: YES
