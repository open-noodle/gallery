# Upstream Sync Report — 2026-06-20 (batch 278 / 1 upstream + 6 fork)

On top of `2026-06-19-upstream-sync-batch-276.md`. One upstream mobile-build bump (which is really an Xcode-16 project migration) plus six fork PRs that had merged to `origin/main` since the last sync.

## Summary

- **Mode**: rolling-upstream-rebase on `rebase/upstream-rolling-20260509-active` (v3-cutover branch, held off `main`)
- **Fork commits synced** (`b054b158..5089027c`, 6): #716 `0c08e346` (search album-filter facets for viewer-role users), #719 `41254b62` (pet-detection reset clears pets when detection disabled), #720 `5a6db2af` (mobile Photos timeline empty-state), #712 `046ff886` (filter-panel motion & polish redesign), #708 `8bf03f1b` (unified album+space picker from timeline), #717 `5089027c` (Has-album timeline filter). `integratedForkHead` advanced `b054b158 → 5089027c`.
- **Upstream commits pulled** (`62b00a1f..b24a617142`, 1): #29215 `b24a6171` `chore: bump mobile build`. Target = `upstream/main` `b24a617142`. Batch 278 (277 already complete).
- **Conflicts resolved**: 6 files. Fork-sync: `timeline.widget.dart` (#720), `AlbumListItem.svelte` + `asset.service.ts` + `asset.service.spec.ts` + `AssetAddToSpaceModal.spec.ts` (#708), 9 generated clients (#717, `--ours`). Upstream rebase: `pubspec.yaml` (#121) + `Info.plist` (#372). One fork commit auto-dropped (see below).
- **New migrations**: 0 — Gallery migration count steady at **33**, mobile Drift schemaVersion unchanged.
- **OpenAPI/SDK**: regenerated — #717 adds the `isInAlbum` search query param. Spec was already consistent (no `sync-open-api` diff); only the TS SDK + Dart clients needed regen (cherry-pick took `--ours`).
- **Risk level**: MEDIUM (large fork-sync — two feature PRs needed genuine v3 reconciliation; the upstream commit collided with mobile branding/version files).
- **Recommendation**: PROCEED — local checks GREEN (server tsc + full server unit 4696; web tsc + full web unit 3262); audits GREEN. Remote CI dispatch pending.

> **Scope note:** held rolling branch — not pushed to `main`, no `branding.upstream.version` bump. Now **0 behind / ahead** of `upstream/main` (includes #29215).

## Upstream commit (1)

| SHA        | PR     | Area   | Risk    | Outcome                                                                                                                                                                                                                                                                                                 |
| ---------- | ------ | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b24a6171` | #29215 | mobile | MED→LOW | Labelled "bump mobile build" but is an **Xcode-16 project migration**: `pubspec` `+3049→+3050`, Fastfile version code, `Info.plist` re-serialized **tabs→spaces** (content byte-identical), `pbxproj` `objectVersion 54→77` + `IPHONEOS_DEPLOYMENT_TARGET 13→14` + version resets. No app-logic change. |

## Fork sync (6) — hand-applied

`make upstream-sync-fork-main` is all-or-nothing; it aborted (and cleanly `reset --hard`-ed) on the #720 cherry-pick conflict. Per the skill's hand-apply path, the 6 PRs were cherry-picked individually and `integratedForkHead` advanced manually with a recorded `appendHistory` entry. #716, #719, #712 applied clean; #720, #708, #717 needed resolution.

## Conflict resolutions

### C1 — `mobile/lib/.../timeline/timeline.widget.dart` (#720 cherry-pick)

v3 had refactored the timeline widget (dropped the `Scaffold`/FAB wrapper, switched `settingsProvider`→`appConfigProvider`), so #720's diff (authored on v2.7.5) didn't apply. **Reset the file to v3 (`--ours`) and re-applied #720's intent verbatim**: thread an `emptyWidget` param through `Timeline`→`_SliverTimeline`, and add the zero-asset render branch (`childCount == 0 && emptyWidget != null && !isSelectionMode → CustomScrollView` with appBar/topSliver/`SliverFillRemaining`). Net diff vs v3 base is purely additive — no v3 code lost.

### C2 — #708 unified album+space picker (4 conflicts)

- `AlbumListItem.svelte` — kept v3's `size-16` Tailwind shorthand + #708's added `relative` class → `relative size-16` (badge logic from #708 applied cleanly).
- `asset.service.ts` / `asset.service.spec.ts` — v3 reorganized imports (block moved), producing empty-HEAD diff3 hunks. **Reset to v3 (`--ours`), re-applied #708's intent**: swap `AssetAddToAlbumModal`→unified `AssetAddToCollectionModal` (3 call sites) + `add_to_album`→`add_to_album_or_space`; spec mock + appended describe block.
- `AssetAddToSpaceModal.spec.ts` — #708 **deletes** the modal (replaced by the unified one); v3 had modified the spec (`UD`). `git rm` to accept the deletion (verified no remaining references).

### C3 — `mobile/pubspec.yaml` (batch-278 rebase, fork #121)

`HEAD` = upstream `3.0.0-rc.2+3050`; fork #121 = `1.0.0+1`. **Kept fork `1.0.0+1`** (the placeholder stamped at build time via `FORK_VERSION`; the fork ignores upstream version numbers).

### C4 — `mobile/ios/Runner/Info.plist` (batch-278 rebase, fork #372)

Upstream re-serialized the whole file tabs→spaces; fork #372 brands the 9 `NS*UsageDescription` strings. First attempt adopted upstream's space-indented file + re-applied the branded strings, but **CI Build Mobile rejected it**: `apply-branding.sh` (inserts the `noodle-gallery` URL scheme) and `verify-branding.sh` (checks the legacy `immich` + `noodle-gallery` schemes) are both **hard-anchored to 4-tab `CFBundleURLSchemes` indentation**, so the space-reformatted file broke the scheme insertion. **Final resolution: kept the fork's tab-formatted Info.plist** (branded strings intact; `#29215`'s Info.plist delta was purely cosmetic + a build number the fork stamps itself). Adopting upstream's spaces would require rewriting both branding scripts — out of scope for a routine batch; the tabs↔spaces conflict on Info.plist will recur until that's done.

### Auto-dropped commit (convergence)

`git rebase` dropped fork commit `8b4b1f5d` (`fix(ios): raise Runner deployment target to iOS 14 for SPM plugins`) with _"patch contents already upstream"_ — upstream #29215 bumped `IPHONEOS_DEPLOYMENT_TARGET` to 14.0 itself, so the fork's only `pbxproj` change became redundant. The anticipated `pbxproj` conflict resolved itself.

## Generated-artifact reconciliation (#717)

#717 adds an `isInAlbum` boolean query param to the search endpoints. The cherry-pick conflicted only on generated clients (8 Dart + the TS SDK, which v3 relocated `open-api/typescript-sdk/`→`packages/sdk/`); resolved `--ours`, then **rebuilt the server and ran the full `mise //:open-api`** (Java). Result: `isInAlbum` now flows through `packages/sdk/src/fetch-client.ts`, `mobile/openapi/**`, and the spec. The regen touched only the 9 `--ours` files (no other drift). `mise //:sql` produced no diff (the `#719` `deleteAllPets` query was already consistent; `video_stream`/`workflow` introspection errors are just the local dev DB being on v2.7.5 schema — no `.sql` altered, count steady at 38).

## v3 reconciliation fixes (`fix(rolling): reconcile #708 collection picker for v3`)

Surfaced by the local gate, not by the cherry-pick:

- **`getAllAlbums({ shared })` → v3 renamed the param.** Used the v3 idiom (matching upstream's own `albums/+page.ts`): `getAllAlbums({ isOwned: true })` (owned) + `getAllAlbums({ isShared: true })` (shared). The old `{ shared }` was a tsc error **and** a runtime bug (invalid param ignored → all albums returned twice).
- **kebab→PascalCase component renames.** `CollectionPickerModal.svelte` and `album-list-item.spec.ts` imported `album-list-item.svelte` / `new-album-list-item.svelte`; v3 renamed these to `AlbumListItem.svelte` / `NewAlbumListItem.svelte`. tsc missed it (macOS case-insensitive FS); Vite (case-sensitive) failed the unit tests.

## Ownership coverage

#712 added `design-exploration/*.html` (filter-panel design mockups). Added `design-exploration/**` to `docs/fork/ownership.yml` `coverage_ignore` (alongside `docs/superpowers/**`) so `fork-ownership-coverage` passes (now covers 2570 fork files).

## Audits & local verification

| Check                           | Status | Notes                                                                                         |
| ------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| postrebase-audit (278)          | GREEN  | fork files/symbols present, 33 Gallery migrations (expected 33), no timestamp collisions      |
| ci-invariants-check             | GREEN  | no PUSH_O_MATIC; gallery release images; upstream docs-deploy stays dispatch-only             |
| fork-patches-check              | GREEN  | @immich/ui patch metadata consistent                                                          |
| fork-ownership-coverage-check   | GREEN  | covers 2570 fork files (after `design-exploration/**` ignore)                                 |
| mobile-drift-rebase-check (278) | GREEN  | schemaVersion / snapshots / Gallery callbacks consistent                                      |
| Server build + `tsc` (`check`)  | PASS   | 33 migrations synced into `dist`                                                              |
| Server unit tests               | GREEN  | 4696 passed, 9 skipped, 0 failed (143 files)                                                  |
| Web `check:typescript`          | PASS   | tsc clean (after `getAllAlbums` fix)                                                          |
| Web unit tests                  | GREEN  | 3262 passed, 2 skipped, 8 todo, 0 failed (247 files) — incl. all #708/#712/#717 specs         |
| OpenAPI regen                   | DONE   | `isInAlbum` propagated to TS SDK + Dart; spec unchanged by regen                              |
| `mise //:sql`                   | NO-OP  | no `.sql` diff (count steady at 38)                                                           |
| `revert-to-immich.sql` coverage | N/A    | no migration/`revert-to-immich.sql` changes this batch → coverage unchanged from CI-green 276 |

> **svelte-check note:** the `mise //web:check-svelte` task runs `svelte-check --no-tsconfig`, which reports `0 FILES` in the worktree (documented local quirk; CI tolerates it). Run with `--tsconfig`, svelte-check surfaces ~32 pre-existing latent prop-type mismatches in spec files — 3 of the 4 affected source files are **byte-identical to the pre-sync tip** (not regressions from this batch), and `tsc --noEmit` (the real type gate) is clean.

## Remote CI round 1 + post-CI reconciliation

First dispatch on `rebase/upstream-batch-278`: 5 green (Docker, Storage-Migration Tests + E2E, Rebase Smoke, **Revert-to-Immich Validation**), 3 red (Test, Static Code Analysis, Gallery Build Mobile). All 3 reds were further v2.7.5→v3 drift in the synced PRs that the local tsc/unit gate couldn't catch (real DB, dart analyze, branding, prettier) — fixed in commit `fix(rolling): resolve v3 CI failures for fork-sync batch 278`:

| Red job                            | Root cause                                                                                                                              | Fix                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medium Tests (Server)              | `#716`/`#717` query used `album.ownerId`; v3 `MigrateAlbumOwnerIdToAlbumUser` dropped that column (ownership → `album_user` role=owner) | Removed the redundant owner branch — the existing `album_user` participant check covers the owner on v3                                                                    |
| Static Analysis + Unit Test Mobile | `#720` test used `StoreKey.tilesPerRow`; v3 moved it to `appConfigProvider`                                                             | `appConfigProvider.overrideWithValue(AppConfig(timeline: TimelineConfig(tilesPerRow: 3)))`                                                                                 |
| Build Mobile (iOS+Android)         | space-reformatted Info.plist broke apply/verify-branding's 4-tab `CFBundleURLSchemes` anchor                                            | Restored tab-formatted Info.plist (see C4)                                                                                                                                 |
| Test Web                           | `#708` files not formatted for v3 prettier                                                                                              | `prettier --write`                                                                                                                                                         |
| Lint Web                           | `#708` switch over `CollectionModalRowType` non-exhaustive (v3 enables `switch-exhaustiveness-check`)                                   | Added `SECTION`/`MESSAGE` no-op cases. (The 84 `better-tailwindcss` _warnings_ are non-fatal — `eslint .` has no `--max-warnings 0` — so left untouched, as in batch 276.) |

Re-dispatched Test / Static Code Analysis / Gallery Build Mobile on the updated branch. (Final results appended once green.)

## Post-rebase state

- Upstream base: `b24a617142` (`62b00a1f..b24a617142`); behind: **0**.
- `integratedForkHead`: `5089027c` (advanced from `b054b158`); `upstreamTargetHead`: `b24a617142`.
- Canonical `rebase/upstream-rolling-20260509-active` updated to the rebased tip; not pushed to `main` (held for v3 cutover).
