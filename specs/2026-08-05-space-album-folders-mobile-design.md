# Space Album Folders — Mobile Design

**Date:** 2026-08-05
**Status:** Approved, ready for planning
**Scope:** Server sync entity + Flutter mobile app. Feature parity with the web implementation on PR #931.
**Predecessor:** `docs/superpowers/specs/2026-08-04-space-album-folders-design.md` (server + web)

## 1. Summary

Bring nestable album folders to the mobile app at full capability parity with web: browse, create,
rename, move, and delete folders inside a Shared Space, and move albums between them.

Folders remain purely visual — no permissions of their own, no effect on the space timeline, asset
visibility, or album membership. Everything RBAC-related is already enforced server-side by the
existing endpoints; mobile adds no new authority.

### The one architectural decision everything follows from

The mobile space albums page is **local-first**: `SpaceAlbumRepository.watchLinkedAlbums(spaceId)`
builds a Drift join and emits a reactive stream, fed by the version-gated `SharedSpaceAlbumLinkV1`
sync stream. Folders therefore arrive **by sync**, not by API fetch, so the page stays local-first,
reactive, and usable offline.

The alternative — API-backed, as the People page does — was rejected because the People page went
that way only to work around owner-scoped person sync. No such constraint exists here, and splitting
one screen across two data models would let the folder tree and the albums beneath it disagree.

### Non-goals

Listed in full in §11. Notably: no drag-and-drop (the picker sheet is the path web already treats as
primary), no album multi-select, and no offline mutation queue.

## 2. Server: the folder sync entity

### 2.1 New sync types

In `server/src/enum.ts`, following the existing three-entry `SharedSpaceAlbumLink*` block:

```
SyncRequestType.SharedSpaceAlbumFoldersV1
SyncEntityType.SharedSpaceAlbumFolderV1
SyncEntityType.SharedSpaceAlbumFolderDeleteV1
SyncEntityType.SharedSpaceAlbumFolderBackfillV1
```

### 2.2 `SharedSpaceAlbumFolderSync`

A `BaseSync` subclass in `sync.repository.ts`, structurally a clone of `SharedSpaceAlbumLinkSync`:
`getUpserts`, `getBackfill`, `getDeletes`, `cleanupAuditTable`.

**Membership scoping is the load-bearing part.** Both `getUpserts` and `getDeletes` gate on
`accessibleSpaces(eb, options.userId)`, exactly as the link sync does. A folder name is member-only
information — the same privacy rule the web spec's R-06 enforces on the REST listing — so a
non-member must never receive a folder row through sync either. This is the one place where a
copy-paste slip would open a real leak.

Unlike the link sync, there is no soft-delete join to exclude: folders have no `deletedAt` and no
album to check.

### 2.3 Deletes need a tombstone table

`shared_space_album_folder` carries `createId`/`updateId` (added as a hedge in the web work) but has
no audit table. Without one, a deleted folder simply stops being emitted and a client that already
synced it has no way to learn it is gone — it would linger in the local tree indefinitely.

A fork migration in `migrations-gallery/` adds `shared_space_album_folder_audit` plus an
after-delete trigger, mirroring `shared_space_album_audit` / `shared_space_album_delete_audit`.
Round timestamp per fork convention, above the current fork high-water mark.

The audit row carries `id` and `spaceId` — `spaceId` because `getDeletes` must gate on
`accessibleSpaces`, and the folder row is gone by the time the tombstone is read.

### 2.4 `folderId` joins the album-link payload

Added to `SHARED_SPACE_ALBUM_SYNC_COLUMNS`.

**This deliberately inverts the web spec's S-01.** That regression test currently asserts `folderId` is ABSENT from
the link payload, with the stated reason that adding it is a mobile-facing decision requiring its own
spec. This is that spec. S-01 is inverted rather than deleted, so that a future change _removing_ the
field fails just as loudly as adding it once did.

No new sync churn results: writing `folderId` already bumps the link row's `updateId` via the table's
updatedAt trigger, so reorganising already re-emits those rows. They simply stop being no-op upserts.

## 3. Mobile data layer

### 3.1 Drift schema

New table `SharedSpaceAlbumFolderEntity`
(`mobile/lib/infrastructure/entities/shared_space_album_folder.entity.dart`):

| Column      | Notes                                   |
| ----------- | --------------------------------------- |
| `id`        | text, primary key                       |
| `spaceId`   | text, cascade FK to `SharedSpaceEntity` |
| `parentId`  | text, nullable, **no FK** — see §3.2    |
| `name`      | text                                    |
| `createdAt` | dateTime, defaults to now               |
| `updatedAt` | dateTime, defaults to now               |

Index on `spaceId`, matching the link entity's `idx_shared_space_album_link_space`.

`SharedSpaceAlbumLinkEntity` gains `folderId` — text, nullable, no FK.

`schemaVersion` 36 → 37, with the migration step.

### 3.2 Why `parentId` has no foreign key

The link entity already sets this precedent for `albumId`, commented _"No FK — the album metadata row
may not be synced yet."_ The same applies harder to folders: sync makes no ordering guarantee, so a
child folder can arrive before its parent.

A self-referencing cascade FK would be actively **wrong**, not merely awkward. Deleting a parent
locally would destroy its children, while the server's actual semantics _promote_ them one level and
emit updated rows — a local cascade would race those updates and destroy data the server intended to
keep.

Tolerating a dangling `parentId` is therefore the normal mid-sync state, not a defensive edge case,
and §3.4's tree module is built for it.

### 3.3 Repository

`SpaceAlbumRepository` gains:

```dart
Stream<List<SpaceAlbumFolder>> watchFolders(String spaceId);
```

and `watchLinkedAlbums` adds `folderId` to its projection. Level filtering happens in Dart (§3.4),
not in SQL, so one stream serves every level of the tree.

### 3.4 The pure tree module

`mobile/lib/utils/space_album_folders.dart` — a Dart port of the web module
`web/src/lib/utils/space-album-folders.ts`:

| Function                                         | Returns                                       |
| ------------------------------------------------ | --------------------------------------------- |
| `buildFolderTree(folders)`                       | root nodes with children                      |
| `folderPath(folders, folderId)`                  | ancestor chain, root-first                    |
| `folderContents(folders, albums, folderId)`      | `(folders, albums)` at this level             |
| `recursiveAlbumCount(folders, albums, folderId)` | albums anywhere in the subtree                |
| `folderPreviewAlbums(folders, albums, folderId)` | up to 4 albums from the subtree, newest first |
| `isDescendant(folders, candidateId, ancestorId)` | guards the picker and the move                |
| `flattenForSearch(folders, albums, query)`       | space-wide hits, each with its path           |

Pure functions over two lists — no Drift, no widgets, no I/O. Every function must be **total**: never
throw and never loop, on a dangling `parentId`, a self-reference, or a cycle. The web module's test
suite ports across almost case-for-case.

Kept in Dart rather than SQL recursive CTEs: the tree is small, Drift's CTE ergonomics are poor, and a
pure module is far easier to test than a query.

### 3.5 Sync handlers

`sync_stream.repository.dart` gains `updateSharedSpaceAlbumFoldersV1` and
`deleteSharedSpaceAlbumFoldersV1`, both batch operations cloned from the album-link pair.
`updateSharedSpaceAlbumLinksV1`'s companion gains `folderId`.

### 3.6 Version gate and degradation

The sync service must not request `SharedSpaceAlbumFoldersV1` from a server that predates it — the
same `serverVersion` gate that already guards the space-album streams.

Degradation is free and needs no UI branch: no folder stream means no folder rows, and no `folderId`
on links means every album reads as root, which renders exactly today's flat list.

## 4. Mobile UI

### 4.1 Navigation

`SpaceAlbumsRoute` gains an optional `folderId`; tapping a folder pushes the same page one level
deeper. App-bar title is the folder name at depth, the space name at root. Back is the system back
button, so iOS edge-swipe-back keeps working — restoring that on the Spaces page was itself a recent
fix (#899), so an in-page navigation model that intercepts back is specifically avoided.

### 4.2 The grid

Folder cards render above album cards in the existing 2-column grid, mirroring the album card: cover
area, name, count. The cover is a collage of up to four album covers from the folder's subtree,
falling back to a folder glyph when empty. The count is **recursive**, so a folder holding only
subfolders never reads "0 albums".

### 4.3 Affordances, all gated on the existing `canEdit`

| Where         | Action                                                   |
| ------------- | -------------------------------------------------------- |
| App bar `＋`  | New folder (alongside the existing Link album)           |
| Folder card ⋮ | Rename · Move to folder… · Delete                        |
| Album card ⋮  | Move to folder… (added to Show/Hide in timeline, Unlink) |

One folder-picker sheet serves all three move paths: an indented tree with the moved folder and its
descendants **disabled**, so an illegal destination is never tappable. Same `isDescendant` guard as
web, from §3.4.

### 4.4 Search, sort, empty states

Search flattens tree-wide: a query hides folders and lists every matching album in the space, each
card carrying its folder path. Matches web, so "where did I put that album" behaves the same on both
platforms. When the path is too long for the card, show the immediate parent rather than the full
chain.

Sort is unchanged for albums. Folders sort by name, honouring the current direction but ignoring the
sort key — `assetCount` and `mostRecentPhoto` do not map onto a folder.

An empty folder gets its own empty state, distinct from the existing space-level "no albums linked"
one, which would otherwise wrongly claim the space is empty.

### 4.5 Mutations

Exactly the established pattern in `SpaceAlbumActions`: call the API, fire
`BackgroundSyncManager.syncRemote()`, let exceptions propagate to the page for a toast. No optimistic
local writes, no offline queue — the sync round-trip is the source of truth, as it already is for
link/unlink/toggle.

## 5. Behaviour specification

Every scenario is a test. §9 maps each ID to exactly one owning layer.

### 5.1 Pure tree module — `T-*`

| ID   | Given                                            | Then                                                              |
| ---- | ------------------------------------------------ | ----------------------------------------------------------------- |
| T-01 | a flat folder list                               | `buildFolderTree` nests correctly, roots first                    |
| T-02 | a folder whose `parentId` is absent              | treated as a root, does not throw                                 |
| T-03 | a self-referencing folder                        | treated as a root, does not loop                                  |
| T-04 | a mutual A↔B parent cycle                        | both folders still appear; no loop                                |
| T-05 | a 3-deep chain                                   | `folderPath` returns the chain root-first                         |
| T-06 | the space root (`null`) or an unknown id         | `folderPath` returns empty                                        |
| T-07 | folders and albums at mixed levels               | `folderContents` returns only this level                          |
| T-08 | an album whose `folderId` names a MISSING folder | it appears at the ROOT, never hidden — see §6                     |
| T-09 | a subtree with albums at several depths          | `recursiveAlbumCount` counts the whole subtree                    |
| T-10 | a subtree with >4 albums                         | `folderPreviewAlbums` returns 4, newest first                     |
| T-11 | an empty folder                                  | `folderPreviewAlbums` returns empty                               |
| T-12 | a 3-deep chain                                   | `isDescendant` true for descendants, false for ancestors and self |
| T-13 | albums across several folders                    | `flattenForSearch` matches space-wide, each with its path         |
| T-14 | a blank or whitespace-only query                 | `flattenForSearch` returns nothing, not everything                |

### 5.2 Repository — `R-*`

| ID   | Given                         | Then                                                    |
| ---- | ----------------------------- | ------------------------------------------------------- |
| R-01 | folders in two spaces         | `watchFolders` emits only the requested space's folders |
| R-02 | a folder row inserted         | the stream re-emits (reactive)                          |
| R-03 | a folder row deleted          | the stream re-emits without it                          |
| R-04 | linked albums with placements | `watchLinkedAlbums` projects `folderId`                 |
| R-05 | an album with `folderId` null | projected as null, not dropped                          |
| R-06 | a space deleted               | its folders cascade away via the `spaceId` FK           |

### 5.3 Mobile sync handlers — `H-*`

| ID   | Given                                     | Then                                                      |
| ---- | ----------------------------------------- | --------------------------------------------------------- |
| H-01 | a batch of folder upserts                 | rows inserted; re-delivery updates rather than duplicates |
| H-02 | a folder delete batch                     | the rows are removed                                      |
| H-03 | a child folder arriving before its parent | it persists and reads as a root until the parent lands    |
| H-04 | a link upsert carrying `folderId`         | the column is written                                     |
| H-05 | a server without folder support           | no folder stream requested; albums still sync             |

### 5.4 Server sync — `V-*`

| ID   | Actor                    | Then                                                         |
| ---- | ------------------------ | ------------------------------------------------------------ |
| V-01 | a member of the space    | receives that space's folders through `getUpserts`           |
| V-02 | a **non-member**         | receives **none** of that space's folders — the privacy gate |
| V-03 | a member, folder deleted | receives the tombstone through `getDeletes`                  |
| V-04 | a **non-member**         | receives **no** tombstones for that space                    |
| V-05 | a member, backfill       | receives the space's folders through `getBackfill`           |
| V-06 | any client               | the link payload now carries `folderId` (web S-01, inverted) |

### 5.5 Actions — `A-*`

| ID   | When                   | Then                                                    |
| ---- | ---------------------- | ------------------------------------------------------- |
| A-01 | create a folder        | POST called, then one sync-nudge                        |
| A-02 | rename a folder        | PATCH called with the name, then one sync-nudge         |
| A-03 | move a folder          | PATCH called with `parentId`, then one sync-nudge       |
| A-04 | delete a folder        | DELETE called, then one sync-nudge                      |
| A-05 | move an album          | PUT `…/albums/:id/folder` called, then one sync-nudge   |
| A-06 | any of the above fails | the exception propagates and **no** sync-nudge is fired |

A-06 matters: the established comment in `SpaceAlbumActions` states the nudge is deliberately not
fired on failure, so the next regular cycle reconciles instead.

### 5.6 UI — `U-*`

| ID   | Given                                | When                | Then                                                 |
| ---- | ------------------------------------ | ------------------- | ---------------------------------------------------- |
| U-01 | folders and root albums              | the page renders    | folders render before albums                         |
| U-02 | a folder card                        | tapped              | pushes the route one level deeper                    |
| U-03 | inside a folder                      | system back         | returns to the parent level                          |
| U-04 | a space with no folders              | the page renders    | identical to today's flat list                       |
| U-05 | an empty folder                      | the page renders    | folder-specific empty state, not the space-level one |
| U-06 | a viewer (`canEdit` false)           | the page renders    | no ⋮ on folder cards, no New folder action           |
| U-07 | the picker for folder X              | it opens            | X and its descendants are disabled                   |
| U-08 | the picker for an album              | it opens            | every folder is selectable                           |
| U-09 | a search query                       | typed               | folders hidden; space-wide hits with path lines      |
| U-10 | a search query                       | cleared             | returns to the current folder's contents             |
| U-11 | the folder you are inside is deleted | the stream re-emits | the route pops to the parent — see §6                |
| U-12 | a folder with only subfolders        | the card renders    | the count is recursive, never "0 albums"             |

## 6. Two edge cases that behave differently from web

**An album whose `folderId` names a folder that is not present must render at the ROOT, never
hidden** (T-08). On web this case needs a fetch race between two requests, and the review there
deferred it as rare. On mobile, sync makes no ordering guarantee, so an album row arriving before its
folder row is **routine** — leaving it hidden would make albums silently vanish from the grid
mid-sync and reappear later. This is the same tolerance the tree module already applies to a folder
with a dangling parent.

The web implementation should be corrected to match, so the behaviour does not differ by platform.
Filed as a follow-up against the web code rather than folded into this spec.

**Deleting the folder you are standing in pops the route** (U-11). Web's analogue is stripping a
stale `?folder=` and falling back to the root. Mobile's screen can be invalidated underneath the user
at any moment by an incoming sync — not only on navigation — so this is driven by the folder stream
re-emitting without the current folder, not by a navigation event.

## 7. TDD implementation order

Each slice is RED → GREEN → refactor: write the listed tests first, watch them fail for the right
reason, then implement.

| Slice | Deliverable                                                                       | Tests first                 |
| ----- | --------------------------------------------------------------------------------- | --------------------------- |
| 1     | Server: sync types, `SharedSpaceAlbumFolderSync`, audit table + trigger migration | V-01–V-05                   |
| 2     | Server: `folderId` in the link payload; invert S-01                               | V-06                        |
| 3     | Mobile: Drift table, `folderId` column, migration to 37                           | R-01–R-06                   |
| 4     | Mobile: sync handlers                                                             | H-01–H-05                   |
| 5     | Mobile: pure tree module                                                          | T-01–T-14                   |
| 6     | Mobile: folder actions                                                            | A-01–A-06                   |
| 7     | Mobile: folder card, picker sheet                                                 | U-06, U-07, U-08, U-12      |
| 8     | Mobile: page integration, navigation, search                                      | U-01–U-05, U-09, U-10, U-11 |

Slices 1–2 are server and independently shippable. Slice 5 depends only on the model types, so it can
run in parallel with 3–4.

## 8. Files touched

**Server**

- `src/enum.ts` — one `SyncRequestType`, three `SyncEntityType` values
- `src/repositories/sync.repository.ts` — `SharedSpaceAlbumFolderSync`; `folderId` in `SHARED_SPACE_ALBUM_SYNC_COLUMNS`
- `src/schema/tables/shared-space-album-folder-audit.table.ts` _(new)_
- `src/schema/functions.ts` — the after-delete trigger function
- `src/schema/migrations-gallery/<timestamp>-SharedSpaceAlbumFolderAuditTable.ts` _(new)_
- `src/dtos/sync.dto.ts` — the folder sync DTOs
- `test/medium/specs/sync/shared-space-album-folder-sync.spec.ts` _(new)_
- `test/medium/specs/sync/shared-space-album-link-sync.spec.ts` — S-01 inverted

**Mobile**

- `lib/infrastructure/entities/shared_space_album_folder.entity.dart` _(new)_
- `lib/infrastructure/entities/shared_space_album_link.entity.dart` — `folderId`
- `lib/infrastructure/repositories/db.repository.dart` — schema 37 + migration
- `lib/infrastructure/repositories/sync_stream.repository.dart` — two handlers + companion field
- `lib/infrastructure/repositories/space_album.repository.dart` — `watchFolders`, `folderId` projection
- `lib/domain/models/space_album_folder.model.dart` _(new)_
- `lib/utils/space_album_folders.dart` _(new)_
- `lib/providers/infrastructure/space_album_actions.dart` — five operations
- `lib/repositories/shared_space_api.repository.dart` — five endpoint calls
- `lib/pages/library/spaces/space_albums.page.dart` — `folderId`, folder grid, search, empty state
- `lib/presentation/widgets/spaces/space_album_folder_card.widget.dart` _(new)_
- `lib/presentation/widgets/spaces/space_album_folder_picker.widget.dart` _(new)_
- `lib/routing/router.dart` — optional `folderId` on the route
- `i18n/en.json` — folder strings (shared with web; several keys already exist)

## 9. Test plan

Each scenario ID has exactly one owning layer.

| Layer                 | Location                                                                                  | Owns                               |
| --------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| Server medium (sync)  | `server/test/medium/specs/sync/shared-space-album-folder-sync.spec.ts` _(new)_            | V-01–V-05                          |
| Server medium (sync)  | `server/test/medium/specs/sync/shared-space-album-link-sync.spec.ts` — web S-01, inverted | V-06                               |
| Mobile pure Dart      | `mobile/test/utils/space_album_folders_test.dart` _(new)_                                 | T-01–T-14                          |
| Mobile medium (Drift) | `mobile/test/medium/repositories/space_album_repository_test.dart`                        | R-01–R-06                          |
| Mobile medium (Drift) | `mobile/test/medium/repositories/sync_stream_folder_test.dart` _(new)_                    | H-01–H-04                          |
| Mobile unit           | `mobile/test/providers/infrastructure/space_album_actions_test.dart`                      | A-01–A-06, H-05                    |
| Mobile widget         | `mobile/test/widgets/spaces/space_album_folder_card_test.dart` _(new)_ and siblings       | U-01, U-05–U-08, U-12              |
| Mobile widget         | `mobile/test/widgets/spaces/space_albums_page_test.dart` _(new)_                          | U-02, U-03, U-04, U-09, U-10, U-11 |

### 9.1 Traps this repo has already been bitten by

- **Two separate CI gates:** `dart analyze --fatal-infos lib test` AND `dart format`. Analyzer
  _infos_ fail the build, not just warnings.
- **`dart analyze` is not a substitute for `flutter test`.** Generated-code compile errors — a
  generator bump turning a class into a real enum, so `.value` no longer exists — surface only when
  the test actually compiles.
- **Flutter is exact-pinned.** Read the pin from `mobile/mise.toml` rather than trusting any
  documented version; it has gone stale before. A local `mise install` can symlink a patch that
  self-reports the wrong version, so if in doubt invoke the binary directly from the install path.
- **Generated localisation and Drift code:** `lib/generated/*.g.dart` is gitignored and must be
  generated once before running tests. Drift and OpenAPI generated code IS committed, so
  `build_runner` is not needed for tests.
- **Three-state DTOs from Dart codegen:** `.value` throws when a field is absent — use `.isPresent`.
  Relevant if any new sync DTO field lands as optional.

## 10. Verification gates

```
cd mobile
flutter pub get
dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart
flutter test
dart analyze --fatal-infos lib test
dart format --set-exit-if-changed lib test

cd ../server
pnpm check && pnpm lint && pnpm vitest --run --config test/vitest.config.mjs
pnpm exec vitest run --config test/vitest.config.medium.mjs shared-space-album-folder-sync.spec.ts

make open-api    # after the sync DTO changes
```

Prettier must be run over this spec — CI Docs Build is strict and covers `docs/superpowers/specs/`.

## 11. Out of scope

- **Drag-and-drop.** The picker sheet is the path web already treats as primary, since HTML5 drag
  works on neither touch nor keyboard. Drag inside a scrolling grid on a small screen would need
  edge auto-scroll and a long-press delay tuned against the existing multi-select gesture.
- **Album multi-select for bulk moves.** Beyond parity — web has no album multi-select either — and
  it would need a selection mode this page does not have.
- **Offline mutation queue.** Mutations require the network, matching link/unlink/toggle today.
- **A breadcrumb.** The nav stack is the mobile idiom; a breadcrumb would need to intercept back.
- **Folder colours, icons, or manual ordering.** Folders sort by name; the collage is derived.
- **Folders for linked libraries**, and folders for personal albums — the latter is excluded by the
  same structural reason as on web.
