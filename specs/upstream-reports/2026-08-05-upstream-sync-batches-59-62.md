# Upstream Sync Report — 2026-08-05 (batches 59–62)

## Summary

- **Upstream commits pulled**: 5 (`db2033a4b02..0687c0d3f76`)
- **Fork commits synced**: 0 (`origin/main` unchanged at `1d4a447ecde`, #921)
- **Conflicts resolved**: 8 (all mobile, all from the freezed migration)
- **Risk level**: MEDIUM — contains a broad architectural refactor (freezed) landing in five fork-extended files
- **Recommendation**: PROCEED

This was an **upstream-only** cycle. All five commits are mobile-only; the whole-session delta
outside `mobile/` is empty (verified by `git diff backup/rolling-pre-b59-freezed-20260805 HEAD --
. ':(exclude)mobile'` → no output), so server / web / e2e / ML / CI / migrations are untouched.

## Incoming Upstream Changes

| SHA           | Summary                                                                  | Area   | Risk to Fork | Notes                                                                      |
| ------------- | ------------------------------------------------------------------------ | ------ | ------------ | -------------------------------------------------------------------------- |
| `f0386ce0897` | fix(mobile): handle asset websocket events (#30499)                      | mobile | MEDIUM       | +5 socket registrations; fork diverges in this file (+13/−2)               |
| `f11d8b6a5ad` | fix(mobile): stop disabling androidx.startup initializers (#30559)       | mobile | LOW          | Removes the `androidx.startup` provider block and `WorkManager.initialize` |
| `18d4a796bb3` | **chore(mobile): simple freezed implementation on some models (#30168)** | mobile | **HIGH**     | Broad architectural refactor — 34 files, −1997 lines                       |
| `4be8e1a9fc0` | fix: asset viewer bottom bar action colors (#30582)                      | mobile | LOW          | `bottom_bar.widget.dart`, no fork divergence                               |
| `0687c0d3f76` | fix: wire secondary action for bottom bar actions (#30583)               | mobile | LOW          | same file, no fork divergence                                              |

### High-risk change: #30168 freezed migration

**What upstream changed.** Converted a subset of hand-written Dart models to `freezed` —
`@freezed abstract class X with _$X` + a `const factory` — deleting the hand-written
constructor / `copyWith` / `==` / `hashCode` / `toString` boilerplate. Added
`freezed_annotation: ^3.1.0` (dependency) and `freezed: ^3.2.5` (dev dependency), and
gitignored `lib/**/*.freezed.dart` — consistent with the fork's own build-time-codegen
adoption (#888), so no committed-artifact conflict.

**Which fork surfaces it affects.** Of the 39 files the batch touches, the fork had diverged
on only 11, and five needed real work:

| File                        | Fork delta | How it was ported                                                                                                                                                                                                                                                              |
| --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `person.model.dart`         | +56/−6     | `PersonDto` stays hand-written **upstream** (`// TODO: Remove PersonDto once Isar is removed`), so the fork's `numberOfAssets` boilerplate was re-applied verbatim. `DriftPerson` became freezed → `spaceId` + `numberOfAssets` moved into the factory with their doc comments |
| `app_config.dart`           | +34/−1     | Fork's `people`, `spaceAlbums`, `spaces` sub-configs became `@Default(XConfig()) X field`; the 3 imports and 6 `read`/`write` switch cases carried over unchanged                                                                                                              |
| `album.model.dart`          | +19/−2     | `currentUserRole` moved into the `RemoteAlbum` factory                                                                                                                                                                                                                         |
| `sync_status.provider.dart` | +20/−2     | `remoteContentChangedCount` → `@Default(0)`; `markRemoteContentChanged()` and the fork's `completeRemoteSync()` kept                                                                                                                                                           |
| `websocket.provider.dart`   | +13/−2     | Union with upstream's 5 new event registrations                                                                                                                                                                                                                                |

**Why it is safe.** Every fork delta in these files was an _additive field restated across
boilerplate_ — exactly what freezed deletes — so the port is mechanical. The verification that
matters is that the entire fork Dart surface still compiles and behaves:
`dart analyze --fatal-infos lib test` → **No issues found!**, `flutter test` → **3164 passed,
1 skipped** (identical to the previous cycle's count).

### Pattern propagation — DEFERRED

Upstream's migration is explicitly partial ("**some** models"): it left `PersonDto` and others
hand-written. The fork's 8 fork-only models under `mobile/lib/domain/models/`
(`collection_target`, `space_album`, `timeline_grouping`, `timeline_temporal_scope`,
`timeline_zoom_anchor`) and its 3 fork-only config classes (`people_config`, `spaces_config`,
`space_albums_config`) therefore remain **consistent with upstream's own state**, not the odd
ones out. No fork-side conversion is required; revisit if upstream completes the migration.

| Refactor         | Old → New                                               | Fork files affected                                              | Decision                                           |
| ---------------- | ------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| freezed (#30168) | hand-written boilerplate → `@freezed` + `const factory` | 8 fork-only models, 3 fork-only configs (all still hand-written) | **Deferred** — upstream's own migration is partial |

## Conflict Resolutions

### Conflict: `mobile/pubspec.yaml` (at fork #373)

- **Fork side**: adds `diacritic: ^0.1.6`
- **Upstream side**: adds `freezed_annotation: ^3.1.0` at the same insertion point
- **Resolution**: union, alphabetically ordered
- **Risk**: LOW
- **Verification**: `flutter pub get --enforce-lockfile` exits 0

### Conflict: `mobile/pubspec.yaml` (at fork `eea0c9bd2f8`, the diacritic dedupe)

- **Fork side**: a pre-existing rebase fixup that removes a duplicated `diacritic` entry
- **Upstream side**: `freezed_annotation` in the same block
- **Resolution**: kept only `freezed_annotation` — upstream now carries `diacritic` in its own
  sorted position, which is exactly what this fixup commit exists to reconcile. The per-commit
  resolution at #373 was correct for _that_ point in history; this commit then dedupes it.
- **Risk**: LOW
- **Verification**: `grep -c 'diacritic:'` → 1, `grep -c 'freezed_annotation:'` → 1

### Conflict: `mobile/lib/providers/sync_status.provider.dart` (at fork `2df070bf5cf`)

- **Fork side**: adds `remoteContentChangedCount`, `markRemoteContentChanged()`, and a
  `completeRemoteSync()` that bypasses `setRemoteSyncStatus`
- **Upstream side**: converts `SyncStatusState` to freezed
- **Resolution**: `@Default(0) int remoteContentChangedCount` on the factory; both notifier
  methods kept verbatim
- **Risk**: MEDIUM — see the behaviour note below
- **Verification**: `dart analyze` clean; `flutter test` green

**★ Deliberate behaviour change, approved by the maintainer before the rebase.** The fork's
`completeRemoteSync()` passes `errorMessage: null`. Under the _hand-written_ `copyWith`
(`errorMessage ?? this.errorMessage`) that argument was silently a **no-op**, so a stale error
message survived a successful sync. Under freezed's sentinel-based `copyWith`, an explicit
`null` **clears** the field. The maintainer chose to let it clear — which also matches
upstream's own stated intent, since `setRemoteSyncStatus` carries
`// TODO(agg23): These error messages probably should be cleared, not preserved on null`.
A comment recording this was added at the call site.

**Blast radius: none today.** No consumer reads `errorMessage` off `syncStatusProvider` — the
only references in `lib/` are inside the generated `sync_status.provider.freezed.dart` itself.
Every real consumer watches `remoteContentChangedCount` (`folder.provider.dart`,
`infrastructure/asset.provider.dart`) or `isRemoteSyncing` (`space_detail.page.dart`). The
change is therefore latent-correctness only, not user-visible. The generated `copyWith`
confirms the mechanism: `{Object? errorMessage = freezed}` with
`freezed == errorMessage ? _self.errorMessage : errorMessage`.

### Conflict: `mobile/lib/providers/backup/drift_backup.provider.dart` (at fork #627)

- **Fork side**: adds background-download progress/status handlers and iOS `startBackup` /
  `stopBackup`, plus a `background_downloader` import
- **Upstream side**: freezed conversion; also **drops** the `package:collection` import
- **Resolution**: union of upstream's two freezed imports + fork's `background_downloader`;
  `collection` dropped
- **Risk**: LOW
- **Verification**: `DeepCollectionEquality` is still used at line 107, but upstream's _own_
  freezed version uses it at line 105 with no `collection` import — `freezed_annotation`
  re-exports it. Confirmed by reading upstream's file rather than assuming.

### Conflict: `mobile/lib/domain/models/config/app_config.dart` (at fork #683, then #752)

- **Fork side**: #683 adds the `people` sub-config; #752 adds `spaceAlbums` + `spaces`
- **Upstream side**: freezed conversion of `AppConfig`
- **Resolution**: reconstructed from upstream's freezed file, re-applying each commit's own
  semantic delta (imports, `@Default(...)` factory fields, `read`/`write` switch cases). All
  boilerplate restatements dropped — freezed generates them.
- **Risk**: LOW
- **Verification**: every insertion anchor asserted unique before applying; `dart analyze` clean

### Conflict: `mobile/lib/domain/models/person.model.dart` (at fork #737, then #758)

- **Fork side**: #737 adds `DriftPerson.spaceId`; #758 adds `numberOfAssets` to **both**
  `PersonDto` and `DriftPerson`
- **Upstream side**: `DriftPerson` freezed, `PersonDto` deliberately left hand-written
- **Resolution**: `spaceId` / `numberOfAssets` moved onto the `DriftPerson` factory with their
  doc comments intact; `PersonDto`'s full boilerplate delta (ctor, field, `toString`,
  `copyWith` ×2, `toMap`, `fromMap`, `==`, `hashCode`) re-applied verbatim
- **Risk**: MEDIUM — this is the #727/#737 shared-space people contract
- **Verification**: `getPersonThumbnailUrl` still routes a non-null `spaceId` to the
  membership-gated space endpoint; `dart analyze` clean; `flutter test` green

### Conflict: `mobile/lib/domain/models/album/album.model.dart` (at fork #749, revert, #752)

- **Fork side**: #749 adds `RemoteAlbum.currentUserRole`; a later commit reverts #749; #752
  re-applies it
- **Upstream side**: `RemoteAlbum` freezed
- **Resolution**: resolved **per commit** — added to the factory at #749, removed at the revert
  (target proved to be byte-identical to upstream's freezed file), re-added at #752 (rerere
  replayed the #749 resolution; the replay was inspected and confirmed correct rather than
  trusted)
- **Risk**: LOW

### Conflict: `mobile/lib/providers/backup/drift_backup.provider.dart` (at fork #892 + reconcile)

- **Fork side**: #892 reverts #627 to match upstream's background-backup implementation
- **Upstream side**: freezed conversion
- **Resolution**: set to upstream's freezed file wholesale, then kept the freezed `part`
  directive against the follow-up lint-fix commit (whose delta here was purely import
  reordering that upstream already satisfies)
- **Risk**: LOW
- **Verification**: **objectively confirmed** that before this batch the fork's copy was
  byte-identical to `db2033a4b02`'s, so "match upstream" is exactly upstream's file; the result
  diffs clean against `0687c0d3f76`

## Fork Feature Verification

| Feature                                | Status | Notes                                                                              |
| -------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| Shared Spaces                          | OK     | Space configs ported to the freezed `AppConfig`; `removeFromSpace` untouched       |
| Storage Migration                      | OK     | Not touched — batch is mobile-only                                                 |
| Pet Detection                          | OK     | Not touched                                                                        |
| Image Editing                          | OK     | Not touched                                                                        |
| Branding                               | OK     | 5 `Noodle Gallery` labels survive in `AndroidManifest.xml`; literal detector clean |
| Google Photos Import                   | OK     | Not touched                                                                        |
| Mobile shared-space people (#727/#737) | OK     | `spaceId` on the freezed `DriftPerson`; thumbnail routing intact                   |
| Mobile filter parity (#473/#758)       | OK     | `numberOfAssets` on both `PersonDto` and `DriftPerson`                             |
| Timeline grouping (#911)               | OK     | Fork's grouping spec coexists with upstream's freezed `TimelineState`              |

### Standing mobile divergences re-verified

1. `similar_photos.action.dart` — fork routing (`photosFilterProvider.setSimilarTo` +
   `MainTimelineRoute`), no `DriftSearchRoute` reference. **Intact.**
2. `ActionNotifier.removeFromSpace` — resolves ids via `_getRemoteIdsForSource`, never the
   owner-scoped variant, guard comment present. **Intact.**
3. `viewAssetInTimeline` (#929) — fork-only module present and wired at all three call sites
   (`action_button.utils.dart`, `drift_backup_asset_detail.page.dart`,
   `memory_bottom_info.widget.dart`). **Intact.**

## CI and Infrastructure Verification

| Check                                   | Status | Notes                                        |
| --------------------------------------- | ------ | -------------------------------------------- |
| Workflow files (no upstream collisions) | OK     | Batch touches no workflow                    |
| Docker image references                 | OK     | Unchanged                                    |
| Branding (no Immich leaks)              | OK     | Silent-noop literal detector printed nothing |
| Fork CI modifications intact            | OK     | `make ci-invariants-check` — 3/3 pass        |
| `@immich/ui` patch                      | OK     | `make fork-patches-check` pass               |
| New upstream workflows reviewed         | OK     | None added                                   |

### Zero-conflict semantic break gate

- **Branding literal detector** (URL literals upstream deletes, grepped against fork
  literal-matching tooling): **no output** — no silent no-op risk this batch.
- **Signature widening / hand-written fakes**: the freezed conversion changes constructors,
  which is precisely the class that only hand-written fakes break on. Covered deterministically
  by `dart analyze --fatal-infos lib test` (clean) plus the full `flutter test` run.
- **Zero-conflict auto-merge in a diverged file**: `websocket.provider.dart` merged with no
  conflict at batch 59 despite fork divergence. Verified rather than assumed — upstream's five
  new events (`on_asset_delete/trash/restore/hidden/update`) all route to `_handleRemoteChange`
  → `syncRemote()` → `background_sync.provider.dart:19` → `completeRemoteSync()`, which in the
  fork's version increments `remoteContentChangedCount`. **No fork gap**; the counter fires for
  the new events via the sync-completion path.

## Database Migration Analysis

No server migrations in this batch — all five commits are mobile-only.

- Gallery migration count: **49** (expected 49) — `upstream-postrebase-audit` OK
- Timestamp collisions: **NONE**
- `postbuild` script and `CompositeMigrationProvider`: intact (unchanged)
- `revert-to-immich.sql` coverage detector: **zero MISSING**

## Mobile Drift Migration Analysis

`make mobile-drift-rebase-check BATCH=62` → OK: schemaVersion, snapshots and Gallery callbacks
consistent. Upstream added no Drift migration in this batch; no renumbering required.

## Inconsistencies Found

None beyond the deliberate `completeRemoteSync()` behaviour change documented above.

## Local CI Verification

Server and web suites were **deliberately skipped** — the whole-session delta outside `mobile/`
is empty, proven by `git diff --stat backup/rolling-pre-b59-freezed-20260805 HEAD -- .
':(exclude)mobile'` returning no output.

| Check                                                            | Status  | Notes                                                                        |
| ---------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `flutter pub get --enforce-lockfile`                             | PASS    | CI-exact form; auto-merged `pubspec.lock` is consistent                      |
| mobile codegen (translation, pigeon, build_runner, drift schema) | PASS    | freezed produced 32 outputs; 222 total                                       |
| `dart analyze --fatal-infos lib test`                            | PASS    | **No issues found!**                                                         |
| `dart format` (CI-exact, `lib` only)                             | PASS    | 827 files, **0 changed** — freezed output is format-safe                     |
| `flutter test`                                                   | PASS    | **3164 passed, 1 skipped**                                                   |
| `make upstream-postrebase-audit BATCH=62`                        | PASS    | 7/7 checks OK                                                                |
| `make ci-invariants-check`                                       | PASS    | 3/3                                                                          |
| `make fork-patches-check`                                        | PASS    |                                                                              |
| `make mobile-drift-rebase-check BATCH=62`                        | PASS    |                                                                              |
| `make sql` / `make open-api`                                     | SKIPPED | No controller/DTO/repository change; audit's Generated Artifact Review clean |

`git status` is completely clean — no `mise.lock` churn, no stray `pubspec.yaml` edits, and no
untracked generated output (freezed artifacts are correctly gitignored).

## Post-Rebase Verification

- Fork commits ahead of upstream: **1105** (identical to the 1105 before the batch)
- Commits behind upstream: **0** (`0687c0d3f76` is an ancestor of HEAD)
- Residual conflict markers anywhere in the tree: **none**
- Fork diff looks clean: **YES**

## Version References

`branding/config.json` `upstream.version` stays at **3.1.0** and the README is unchanged —
upstream has still not tagged v3.1.1 (`git ls-remote --tags upstream 'v3*'` → newest is
`v3.1.0`). Per the standing rule, the rolling branch stays off `main`.
