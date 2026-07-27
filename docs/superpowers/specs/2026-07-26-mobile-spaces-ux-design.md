# Mobile Spaces UX — edit a space, and add selections to spaces and space albums

**Date:** 2026-07-26
**Branch:** `worktree-feat+mobile-spaces-ux`
**Follows on from:** `2026-07-25-rename-spaces-design.md` (web rename/edit) and
`2026-07-25-space-add-to-collection-design.md` (web contribution mode).
**Review status:** revised 2026-07-26 after two adversarial reviews; every code claim below was verified
against the tree.

## Problem

Two gaps make Spaces awkward to use from the phone.

1. **A space cannot be renamed on mobile.** `SharedSpaceApiRepository` has `create` and `delete` but no
   `update`, so there is no client path at all. The space detail kebab is wrapped in `if (_isOwner)` and
   holds exactly one item, "Delete Space" (`space_detail.page.dart:458-464`) — which also means **editors
   see no kebab whatsoever**, even though the server has permitted editors to rename since the server half
   of the web rename design shipped.
2. **Photos can only be added to a space from inside that space.** The flow today is inside-out: open the
   space → tap the 🖼️+ icon → pick assets (`space_detail.page.dart:123`). Space albums have the same
   shape via their kebab's "Add photos". The outside-in flow — select photos anywhere in the library, then
   send them to a space — does not exist. The main timeline's multi-select sheet mounts only `AlbumSelector`
   (`general_bottom_sheet.widget.dart:118-121`), so albums are the sole possible destination.

This spec is the mobile counterpart, and it is the follow-up PR that `2026-07-25-rename-spaces-design.md`
explicitly deferred:

> **Mobile.** `mobile/lib/repositories/shared_space_api.repository.dart` has no `updateSpace` call at all.
> Adding one means a repository method, a bottom-sheet action, a dialog, and a local Drift write — its own PR.

## Goals

1. Space owners and editors can edit a space's name, description, and colour from mobile.
2. From a multi-select on the main timeline or a space timeline, a user can add the selection to a personal
   album, a space, or an album linked to a space.
3. No server changes, no DTO changes, no OpenAPI regeneration.

## Non-goals

- **Server work of any kind.** `PATCH /shared-spaces/:id` already accepts `name` / `description` / `color`
  and already gates naming at Editor (`shared-space.service.ts:274-282`, shipped with the web rename design).
- **Cross-owner contribution mode.** Deferred deliberately — see R1.
- **Cover photo editing on mobile.** Mobile has no asset-picker-plus-crop surface; that is its own slice.
- **Target multi-select in the picker.** Tapping a row adds immediately, matching today's album behaviour.
- **A full i18n sweep of mobile Spaces.** Only strings on surfaces this work already modifies get keyed.

## What already exists

| Piece                                       | Where                                                                        | Why it matters                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `PATCH /shared-spaces/:id`, Editor for name | `shared-space.service.ts:274-282`                                            | No server work; editors may already rename                                   |
| `updateSpace`                               | `mobile/openapi/lib/api/shared_spaces_api.dart:2499`                         | Returns `SharedSpaceResponseDto?` — **nullable**                             |
| `SharedSpaceUpdateDto`                      | `mobile/openapi/lib/model/shared_space_update_dto.dart`                      | All seven fields are `Optional<T?>`                                          |
| `sharedSpacesProvider`                      | `mobile/lib/providers/shared_space.provider.dart:6`                          | Network `getAll()`; carries `members` and `albumCount`                       |
| `spaceAlbumsProvider(spaceId)`              | `mobile/lib/providers/infrastructure/space_album.provider.dart`              | **Local Drift stream** per space — lazy expansion is cheap and works offline |
| `SpaceAlbumActions.addAssets`               | `mobile/lib/providers/infrastructure/space_album_actions.dart:67`            | `Future<int>`; routes around the absorbed-album FK trap; nudges sync         |
| `actionProvider.addToAlbum`                 | `mobile/lib/providers/infrastructure/action.provider.dart:384`               | Existing remote+local dispatch, incl. upload-then-link                       |
| `RemoteAlbumService.categorizeCandidates`   | called from `action.provider.dart:390`                                       | Splits a selection into remote ids and local assets needing upload           |
| `AssetVisibility.locked`                    | `mobile/lib/domain/models/asset/base_asset.model.dart`                       | Locked-folder assets, which must never be pushed into a shared space         |
| `SpaceAlbumKebab`                           | `mobile/lib/presentation/widgets/spaces/space_album_kebab.widget.dart`       | The repo's precedent for extracting a kebab so it can be widget-tested       |
| `SpaceLinkPickerSheet.show`                 | `mobile/lib/presentation/widgets/remote_album/space_link_picker.widget.dart` | Precedent for a static-`show` bottom sheet instead of an `auto_route` page   |
| `spaceGradientColors`                       | `mobile/lib/widgets/spaces/space_collage.dart:7`                             | The ten space colours mobile already renders                                 |

### Five corrections that shape the design

Each of these overturned an earlier assumption and is load-bearing.

1. **`addAssets` returns nothing.** `POST /shared-spaces/:id/assets` is `@HttpCode(NO_CONTENT)` returning
   `Promise<void>`; the Dart repository is `Future<void>` (`shared_space_api.repository.dart:114`). There is
   **no server count** for a space-pool add. Web itself falls back to the request length
   (`web/src/lib/services/space.service.ts:20`). Only the space-**album** path yields a true count
   (`space_album_actions.dart:71`, `result.added.length`).
2. **`sharedSpaceProvider` has zero consumers** anywhere in `mobile/lib`, so invalidating it after a rename
   is a no-op. The space detail app bar renders `_space!.name` (`space_detail.page.dart:440`) from local
   `State` populated by a network `get()`. The Drift `shared_space_entity.name` column is written by sync
   (`sync_stream.repository.dart:643-658`) but **never read for display**, so a sync nudge does not refresh
   the title either. Only re-fetching the page's own metadata does.
3. **`Optional.present(null)` is a 400, not a clear.** `name`, `description` and `color` are `.optional()`
   but **not** `.nullable()` in `SharedSpaceUpdateSchema` (`shared-space.dto.ts:16-32`), so an explicit
   `null` is rejected by the zod pipe before reaching `updatePayload`. Only absent-vs-present matters.
4. **`Optional.value` throws on an absent value** (`mobile/openapi/lib/optional.dart:66`,
   `StateError('No value present')`). Any predicate reading `space.members` must go through `isPresent` /
   `orElse`, never bare `.value`.
5. **`AddToAlbumHeader` lives inside the upstream `album_selector.widget.dart`** (`:742`) and hardcodes
   `"add_to_album"` (`:768`). The picker therefore cannot reuse it and still say "Add to album or space".

## Design

### 1. Structure — compose, do not modify

`album_selector.widget.dart` and `general_bottom_sheet.widget.dart` are **pure upstream** (every commit
touching them is an upstream PR; neither appears in the squashed fork commit `e0950535c36`).
`space_bottom_sheet.widget.dart` is **fork-only** (it exists solely in `e0950535c36`) and may be edited
freely.

`AlbumSelector` is not touched at all. It is composed:

```
CollectionPicker (MultiSliver)
├── CollectionPickerHeader   ← new; renders `add_to_album_or_space` (see correction 5)
├── AlbumSelector            ← upstream, byte-identical
└── SpaceCollectionSection   ← new
```

`general_bottom_sheet.widget.dart` takes a **two-line** diff: drop `const AddToAlbumHeader()` and swap
`AlbumSelector` for `CollectionPicker` (`:119-120`). That is the only upstream edit in this work.

The cost is two search affordances in one sheet — album search inside `AlbumSelector`, and the spaces
section below it. Accepted: the spaces list is short, grouped, and under its own header.

### 2. `CollectionTarget` and the dispatch table

New sealed class in `mobile/lib/domain/models/collection_target.dart`.

| Variant            | Payload                  | Dispatch                                   |
| ------------------ | ------------------------ | ------------------------------------------ |
| `AlbumTarget`      | `RemoteAlbum`            | `actionProvider.addToAlbum` (existing)     |
| `SpacePoolTarget`  | `SharedSpaceResponseDto` | `actionProvider.addToSpace` (**new**)      |
| `SpaceAlbumTarget` | `spaceId` + `SpaceAlbum` | `actionProvider.addToSpaceAlbum` (**new**) |

Both new methods live on `ActionNotifier` and return the usual `ActionResult(count, success, error)`,
because upload, `multiSelectProvider` reset and `ActionSource` all live there.
`SpaceAlbumActions.addAssets` stays the low-level call underneath `addToSpaceAlbum` — it takes only
`(albumId, assetIds)`, returns `Future<int>`, and knows nothing about selection state.

**`SpaceAlbumTarget` must never route through `addToAlbum`.** A linked album may be _absorbed_ — present
only in `shared_space_album` with no local `remote_album` row — and `addToAlbum` also writes the local
`remote_album_asset` junction, which would hit a foreign-key violation. `SpaceAlbumActions.addAssets`
exists precisely to avoid this (`space_album_actions.dart:57-62`). A test pins it.

`SpaceAlbumTarget` carries `spaceId` even though `addAssets` does not need it: it is used to invalidate
`spaceAlbumsProvider(spaceId)` after the add, and to exclude the current space in the space sheet (§3).

### 3. `SpaceCollectionSection`

New `mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart`.

Watches `sharedSpacesProvider`, filters to writable spaces, renders one row per space under a header.

**Expandable vs plain.** Whether a row is expandable is decided by `SharedSpaceResponseDto.albumCount`,
because the local Drift stream cannot be consulted without subscribing to it. The server does populate it on
this exact path (`shared-space.service.ts:143` and `:190`, inside `getAll`), which is what
`sharedSpacesProvider` calls.

Two traps: it is typed `Optional<num?>` (`shared_space_response_dto.dart:48`), so it must be read through
`isPresent` / `orElse` like `members` (correction 4), and it is a `num`, not an `int`. It is also used
**nowhere in `mobile/lib` today**, so this is its first consumer and it carries no existing coverage. An
absent `albumCount` is treated as 0 — a plain row, which still reaches the pool.

The count can disagree with the Drift stream, and both directions are handled explicitly:

- `albumCount > 0` but the Drift stream is empty (not yet synced) → the expanded row shows an empty-albums
  hint, and the pool child still works.
- `albumCount == 0` but an album was just linked → the row is plain; the pool child still works and the
  album becomes reachable after the next sync. Accepted staleness.

**Row behaviour.**

- Expandable row: tapping toggles expansion. Children are the pool child, then each linked album.
- Plain row: a single tap emits `SpacePoolTarget`.
- Only one row is expanded at a time (accordion), which bounds concurrent Drift subscriptions to one.

The pool child is labelled `add_to_space` ("Add to space"). It needs no space name — the parent row it is
nested under already carries it — which is what lets the existing key be reused verbatim.

Linked albums come from `spaceAlbumsProvider(spaceId)`, watched **only while a row is expanded**.

**Row ordering** is by space name, case-insensitive, matching `SpaceLinkPickerSheet`. Names render with
`maxLines: 1, overflow: ellipsis` for long and RTL names, matching `space_link_picker.widget.dart:72`.

**Gating.** The section renders in exactly one of six states:

| Condition                                                                                     | Rendering                                                     |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `sharedSpacesProvider` loading                                                                | Header + skeleton rows (reserves height, avoids layout shift) |
| `sharedSpacesProvider` error (offline)                                                        | Section omitted — the album half of the picker still works    |
| No writable space                                                                             | Section omitted entirely                                      |
| Selection contains an asset the user does not own                                             | Header + `spaces_hidden_non_owned_selection` notice, no rows  |
| Selection contains a locked-folder asset, **or** exceeds `kMaxSpaceAssetsPerRequest` (50 000) | Header + the matching notice, no rows                         |
| Otherwise                                                                                     | Header + one row per writable space                           |

- **Locked-folder assets are excluded** from every space target. Sending an asset the user deliberately
  placed in the locked folder into a shared space would be a privacy leak.
- Local-only assets do **not** count as non-owned: they will be uploaded as the current user's.
- The **non-owned predicate** is a new derived selector over `multiSelectProvider`, comparing
  `RemoteAsset.ownerId` against `currentUserProvider`. When `currentUserProvider` is null it returns
  "contains non-owned" (fail-closed), so a logged-out edge never offers space targets.
- `kMaxSpaceAssetsPerRequest = 50000` is a **new Dart constant** in
  `mobile/lib/constants/collection.dart`, mirroring `shared-space.dto.ts:176` and `web/src/lib/constants.ts:85`.
  The cap is inclusive: 50 000 is allowed, 50 001 is not. It gates only the pool path server-side, but the
  section hides wholesale for simplicity, and that over-broadness is noted in R7.
- **In the space sheet, the space being viewed is excluded** from its own list — adding a space's assets
  back into itself is a no-op that would still fire an activity entry.

**Re-entrancy.** Rows are disabled while an add is in flight, so a double-tap cannot dispatch twice.

### 4. `space_permissions.dart`

The predicate exists in **four** places today: `SpaceLinkPickerSheet._canWrite`, `space_detail.page.dart`'s
`_canEdit` and `_isOwner`, and `space_bottom_sheet.widget.dart:38`'s `_canEdit`. New
`mobile/lib/utils/space_permissions.dart`:

```dart
bool spaceIsWritable(SharedSpaceResponseDto space, String? currentUserId);
bool spaceIsOwned(SharedSpaceResponseDto space, String? currentUserId);
bool roleIsWritable(SharedSpaceRole? role); // for space_bottom_sheet, which holds a role, not a DTO
```

`members` is read via `isPresent` / `orElse`, never bare `.value` (correction 4).

**This is a deliberate behaviour change, not a pure refactor.** `space_detail.page.dart:100-121` derives
both predicates _only_ from the separately-fetched `_members` list, with no creator short-circuit, and
returns `false` while `_members == null`. Adopting the helper means a creator absent from the members list
becomes an owner. That is the correct reading — `getAll` does not guarantee the creator appears as a member
— but it changes who sees "Delete Space", so Slice 1 tests it as a change rather than claiming parity. The
loading default stays fail-closed: while members are unknown, nothing is editable.

### 5. Dispatch semantics

**Counts.** `addToSpace` reports the **request length**, because the endpoint returns no body (correction 1);
this matches web. `addToSpaceAlbum` reports the **server's** `added.length`, which correctly excludes
duplicates — so re-adding 20 assets already in an album truthfully says 0.

**Local assets.** Both new methods upload first, then issue **one** add call with all resulting remote ids —
not one per asset, which would fire `SpaceAlbumActions`' `syncRemote()` nudge once per photo.

**Partial upload.** `upload()` reports `successCount` and `success == successCount == total`
(`action.provider.dart:565-640`). When some assets upload and others fail, the successful ids **are** added
and the result is a partial: `count = uploaded + remote`, `success = false`. Dropping the successful ones
would strand photos in the library that the user asked to file.

**Selection reset.** Reset happens **only on full success**. This is a **deliberate divergence** from
`addToAlbum`, which resets after the remote add and _before_ the upload (`action.provider.dart:404-406`) and
so clears the selection even when the upload later fails. Retrying is the point of keeping it.

**Failure.** A space-pool add is all-or-nothing server-side — `requireAccess(AssetShare)` throws unless the
allowed set equals the requested set — so `scaffold_body_error_occurred` and no count. The space-**album**
path is per-asset on the server and does not throw on individual denials, so it reports its true count and
never claims more than landed.

### 6. `SpaceEditSheet`

New `mobile/lib/presentation/widgets/spaces/space_edit_sheet.widget.dart` with a static
`SpaceEditSheet.show(context, space) → Future<bool?>`, following `SpaceLinkPickerSheet.show`.

Fields mirror web's `SpaceEditModal`: **name** (required, `maxLength` 100), **description**
(`maxLength` 500), **colour** (the ten `spaceGradientColors` swatches).

- **Empty-name guard.** Save is disabled when `name.trim().isEmpty`, catching both empty and
  whitespace-only before a request that `z.string().trim().min(1)` would reject.
- **In-flight guard.** Save is disabled while a save is running, so a double-tap cannot send two PATCHes.
- **Autofocus and select-once.** The name autofocuses with its text selected; only on the **first** focus,
  so tapping to place the caret mid-word does not re-select.
- **Prefill longer than the cap.** A name created via API can exceed 100 chars. The field renders it in
  full rather than truncating silently, and Save stays enabled — truncating a user's existing name because
  they opened a sheet would be data loss. The server rejects it only if they save it unchanged, which is
  surfaced as the normal error.
- **Grapheme mismatch is accepted.** Flutter's `maxLength` counts UTF-16 code units while the server's
  `z.string().max(100)` counts code points, so an emoji-heavy name can hit the client cap early. Noted, not
  worked around — the failure mode is a stricter client, which is safe.
- **Colour with no value.** `space.color` may be absent; the sheet defaults to `primary`, matching web's
  `space.color ?? UserAvatarColor.Primary`. Colour cannot be unset.
- **Dismissal mid-save.** Every post-await use of `context` is `mounted`-guarded.

### 7. `SharedSpaceApiRepository.update`

```dart
Future<SharedSpaceResponseDto> update(
  String id, {
  String? name,
  String? description,
  UserAvatarColor? color,
});
```

- `updateSpace` returns `SharedSpaceResponseDto?`; the repository uses the existing `checkNull` helper, as
  every sibling method does, so a null body throws rather than propagating.
- Unchanged fields are `Optional.absent()`. `Optional.present(null)` must never be sent — it is a **400**,
  not a clear (correction 3).
- The four fields this design never touches — `faceRecognitionEnabled`, `petsEnabled`, `thumbnailAssetId`,
  `thumbnailCropY` — must stay `Optional.absent()`. A stray `present(null)` on `faceRecognitionEnabled`
  would 400; a stray `present(false)` would silently disable face recognition for the whole space on every
  rename. Tested explicitly.
- **Description is sent only when it changed.** The caller decides "changed"; the repository sends verbatim.
  `''` clears it server-side; absent leaves it.
- `name` is trimmed before sending. `description` is **not** trimmed — a user may legitimately want
  trailing structure, and the server does not trim it either.

### 8. Entry points and RBAC

|              | Viewer | Editor | Owner |
| ------------ | ------ | ------ | ----- |
| Edit space   | —      | ✅     | ✅    |
| Delete space | —      | —      | ✅    |

**Extraction first.** `space_detail.page.dart` is 480 lines, is an `@RoutePage()` `ConsumerStatefulWidget`
that loads network metadata and members, mounts a Drift-backed `Timeline` and a `SpaceBottomSheet`, and has
**no test at all** today. Its kebab is therefore extracted into
`mobile/lib/presentation/widgets/spaces/space_detail_kebab.widget.dart` as
`SpaceDetailKebab({required bool canEdit, required bool canDelete, required onEdit, required onDelete})`,
exactly mirroring the existing `SpaceAlbumKebab`. This is what makes the RBAC table testable without
pumping the page.

- **Space detail kebab** — gate flips from `_isOwner` to `canEdit`; "Delete Space" stays owner-only inside
  the menu. While `_space` or `_members` is still loading, no kebab renders.
- **Space card long-press** — `SpaceCard` gains `onLongPress` alongside its existing
  `GestureDetector(onTap:)` (`space_card.dart:16`); the long-press must **not** also fire `onTap` and
  navigate into the space behind the sheet. A viewer's long-press opens nothing.
- Delete from the card sheet reuses `spaces_delete_confirmation`, like the kebab path.

**After a successful save** (correction 2): invalidate `sharedSpacesProvider` so the grid re-renders, and
call the page's existing `_refreshSpaceMetadata()` so the app bar title updates. **No sync nudge** — nothing
reads the Drift name column for display, so it would be cargo cult.

### 9. Surfaces

- **`general_bottom_sheet.widget.dart`** (upstream) — two-line diff, per §1.
- **`space_bottom_sheet.widget.dart`** (fork-only) — gains a `slivers:` argument. Its
  `maxChildSize` is **0.55** today (`:49`), which would leave the spaces section permanently below the fold;
  it is raised to 0.85 to match `GeneralBottomSheet`, and a test pins that the section is reachable.

## Implementation slices

Test-first throughout: write the failing test, confirm it fails for the right reason, then implement.

**Standing rule for every slice:** the slice is not done until the **whole** mobile suite is green
(`flutter test`), plus `dart analyze --fatal-infos lib test` and `dart format --set-exit-if-changed`. This
is what "leaves the tree green" means.

**Test locations follow the repo's actual convention**, verified against the tree: widgets under
`lib/presentation/widgets/**` are tested under `mobile/test/presentation/widgets/**` (e.g.
`mobile/test/presentation/widgets/spaces/space_album_bottom_sheet_test.dart`); providers under
`mobile/test/providers/infrastructure/`; repositories under `mobile/test/repositories/`; pure helpers under
`mobile/test/utils/` (**not** `utils_legacy/`). `mobile/test/widgets/` holds only `backup/`, `common/` and
`settings/` and is **not** used here.

Where a widget shows a still-running spinner, use `pumpConsumerWidgetRaw` — the fork added it precisely
because `pumpConsumerWidget` calls `pumpAndSettle()` and would hang.

Dependency order: 1 → {2 → 3 → 4} and 1 → {5 → 6 → 7} → 8.

---

### Slice 1 — `space_permissions.dart`

**Goal.** One implementation of the role predicates; four call sites repointed.

**Files.** New `mobile/lib/utils/space_permissions.dart`, new `mobile/test/utils/space_permissions_test.dart`.
Edit `space_link_picker.widget.dart`, `space_detail.page.dart`, `space_bottom_sheet.widget.dart`.

**Tests first (BDD).**

- Given a space whose `createdById` is me and whose members list omits me, then it is writable and owned.
- Given I am a member with role `owner` but am **not** the creator, then it is writable **and owned** — the
  Delete gating in Slice 4 depends on this.
- Given I am a member with role `editor`, then writable is true and owned is false.
- Given I am a member with role `viewer`, then both are false.
- Given I am neither member nor creator, then both are false.
- Given `members` is `Optional.absent()`, then the creator check still decides and **nothing throws** —
  `Optional.value` raises `StateError` on absent, so this pins the `isPresent`/`orElse` access.
- Given `members` is `Optional.present(null)`, then it behaves as an empty list.
- Given duplicate membership rows for my user id, then the first is used deterministically.
- Given `currentUserId` is null, then both are false even when `createdById` is also null.
- Given I created the space but my member row says `viewer` (ownership transferred), then the creator
  short-circuit wins — pinned so the precedence is a decision, not an accident.
- Given `roleIsWritable`, then owner and editor are true, viewer and null are false.

**Done when.** All four call sites delegate; the two behaviour changes at `space_detail.page.dart`
(creator-implies-owner, and fail-closed while members load) each have a test asserting the **new** result.

---

### Slice 2 — `SharedSpaceApiRepository.update`

**Goal.** The rename call, with correct `Optional` semantics.

**Files.** Edit `mobile/lib/repositories/shared_space_api.repository.dart`. **Extend the existing
`mobile/test/modules/spaces/shared_space_api_repository_test.dart`** — a 512-line suite already covering
`getAll` / `get` / `create` / `delete` / `getMembers` / `isSpaceEditor` / `updateSpacePerson` / member CRUD,
with `MockSharedSpacesApi` + `MockApiService` and `registerFallbackValue` already set up. Add an `update`
group alongside them; do **not** create a file under `test/repositories/`.

**Tests first (BDD).**

- Given only a new name, then the DTO carries `Optional.present(name)` and `absent()` for the rest.
- Given a description changed from text to `''`, then `Optional.present('')` — the clobber regression.
- Given a description changed from `null` to text, then `Optional.present(text)`.
- Given description is not passed, then `Optional.absent()` — **never** `Optional.present(null)`, which the
  non-nullable zod schema rejects with a 400.
- Given any call, then `faceRecognitionEnabled`, `petsEnabled`, `thumbnailAssetId` and `thumbnailCropY` are
  all `Optional.absent()` — the silent-disable guard.
- Given a name with surrounding whitespace, then it is trimmed; given a description with whitespace, then it
  is **not**.
- Given the API returns `null` (empty body), then it throws, matching the existing
  `getAll`/`updateSpacePerson` "throws when API returns null" cases in the same file.
- Given the API throws, then the exception propagates unchanged.

Lazy `_api` resolution is **already covered** by the existing `lazy SharedSpacesApi resolution` group at the
top of that file and needs no new scenario.

---

### Slice 3 — `SpaceEditSheet`

**Goal.** The three-field form, with validation, in isolation from its entry points.

**Files.** New `mobile/lib/presentation/widgets/spaces/space_edit_sheet.widget.dart`. New
`mobile/test/presentation/widgets/spaces/space_edit_sheet_test.dart`.

**Tests first (BDD).**

- Given a space, then name, description and colour are prefilled.
- Given a space whose `color` is absent, then `primary` is preselected.
- Given an empty name, then Save is disabled; given `"   "`, then Save is disabled.
- Given the sheet just opened, then the name is focused with its text selected; and given the user taps the
  field again (via `tester.tapAt` with an offset, not `tester.tap`), then the selection is not reapplied.
- Given 150 characters are pasted into the name, then only 100 remain in the field; likewise 500 for the
  description.
- Given a prefilled name of 120 characters, then it renders in full and Save stays enabled — no silent
  truncation of existing data.
- Given only the name was edited, then `update` is called **without** a description.
- Given the description was cleared, then `update` is called with `''`.
- Given nothing was edited and Save is tapped, then `update` is called with all fields absent and the sheet
  closes — a no-op save is not an error.
- Given Save is tapped twice in quick succession, then `update` is called **exactly once**.
- Given the sheet is dismissed while a save is in flight, then no pop or toast is attempted and nothing
  throws — the `context.mounted` guard.
- Given the save fails with a 403 (role revoked mid-edit), then the sheet stays open and shows
  `errors.unable_to_update_space`.
- Given the save succeeds, then it resolves `true`; given cancel, then `null` and no call.
- Given the colour swatches, then each carries a `Semantics` label naming its colour — ten unlabelled
  colour-only targets are unusable by a screen reader — and each meets the minimum tap target, asserted with
  the existing `expectTapTargetMin` helper in `mobile/test/widget_tester_extensions.dart`.

---

### Slice 4 — `SpaceDetailKebab` extraction and entry points

**Goal.** Make the sheet reachable and fix the editors-see-no-kebab bug, with the RBAC testable.

**Files.** New `mobile/lib/presentation/widgets/spaces/space_detail_kebab.widget.dart` (extraction). Edit
`space_detail.page.dart` to use it; edit `mobile/lib/widgets/spaces/space_card.dart` for `onLongPress` plus
its role-gated sheet. New `mobile/test/presentation/widgets/spaces/space_detail_kebab_test.dart` and
`mobile/test/widgets/spaces/space_card_test.dart`.

**Tests first (BDD).**

- Given `canEdit && canDelete`, then the kebab shows `spaces_edit` and `spaces_delete`.
- Given `canEdit && !canDelete` (editor), then it shows `spaces_edit` only — the regression fix.
- Given `!canEdit`, then no kebab renders at all.
- Given metadata is still loading, then no kebab renders (fail-closed).
- Given a long-press on a space card as owner, then a sheet offers Edit and Delete **and no navigation
  occurs** — the `onTap`-must-not-also-fire guard.
- Given a long-press as editor, then Edit only; as viewer, then no sheet opens.
- Given Delete is chosen from the card sheet, then `spaces_delete_confirmation` is shown first.
- Given a save resolves `true`, then `sharedSpacesProvider` is invalidated and the space metadata is
  re-fetched, and the observable outcome is that **the app bar shows the new name**.
- Given a save resolves `null`, then nothing is invalidated and no re-fetch occurs.
- Given the space was deleted by another member mid-flow, then the edit surfaces the error and does not
  crash on the missing space.

---

### Slice 5 — `CollectionTarget` and dispatch

**Goal.** The routing table, tested at the provider level.

**Files.** New `mobile/lib/domain/models/collection_target.dart`, new
`mobile/lib/constants/collection.dart` (`kMaxSpaceAssetsPerRequest`). Edit `action.provider.dart` to add
`addToSpace` and `addToSpaceAlbum`. New `mobile/test/providers/infrastructure/collection_dispatch_test.dart`,
following the `ProviderContainer` + `overrideWithValue` pattern of
`test/providers/infrastructure/space_album_actions_test.dart`.

**Tests first (BDD).**

- Given an `AlbumTarget`, then `addToAlbum` runs and neither space path is touched.
- Given a `SpacePoolTarget` with remote-only assets, then `addAssets` is called **once** with every id.
- Given a `SpaceAlbumTarget`, then `SpaceAlbumActions.addAssets` runs and **`addToAlbum` is never called** —
  the absorbed-album FK guard (R4).
- Given a `SpacePoolTarget`, then the reported count is the **request length**, because the endpoint returns
  no body; given a `SpaceAlbumTarget`, then it is the **server's** `added.length`.
- Given a space-album add where every asset is already present, then the count is 0 and the result is a
  success — no "added 20" lie.
- Given a space target with local assets, then upload runs first and the add call is made **exactly once**
  with all resulting remote ids.
- Given an upload where 3 of 5 assets succeed, then those 3 **are** added and the result is
  `count == 3, success == false` — successful uploads are never stranded.
- Given the upload is cancelled, then no add call is made.
- Given an empty selection, then no API call and a success with count 0.
- Given the add throws, then the result is a failure **and the selection is not reset**.
- Given full success, then the selection is reset for `ActionSource.timeline`, and the reset is asserted for
  both the main and space sheets since both pass `timeline`.
- Given a `SpaceAlbumTarget` add succeeds, then `spaceAlbumsProvider(spaceId)` is invalidated — which is
  what `SpaceAlbumTarget.spaceId` is for.
- Given a second target is tapped while the first add is in flight, then the second is ignored.

---

### Slice 6 — `SpaceCollectionSection`

**Goal.** The spaces half of the picker, in isolation.

**Files.** New `mobile/lib/presentation/widgets/collection/space_collection_section.widget.dart`, plus the
non-owned selector. New `mobile/test/presentation/widgets/collection/space_collection_section_test.dart`.
**Also adds the new i18n key `spaces_hidden_non_owned_selection` to `i18n/en.json` and all nine locale
files** — the full translation table is in Slice 8, but the key must land _here_, in the slice that first
renders it. `easy_localization` renders a missing key as the raw key name, so deferring it to Slice 8 would
let this slice's notice test pass trivially against the literal string `spaces_hidden_non_owned_selection`
while the shipped app displayed that same gibberish for two slices.

**Tests first (BDD).** One per row of the §3 gating table, plus:

- Given no writable spaces, then nothing renders — not an empty header.
- Given writable and viewer-only spaces, then only the writable ones list, ordered by name.
- Given `sharedSpacesProvider` is loading, then skeleton rows render (pumped with `pumpConsumerWidgetRaw`).
- Given `sharedSpacesProvider` errors, then the section hides and the album half still renders.
- Given `albumCount > 0`, when I tap the row, then it expands to the pool child followed by each album;
  tapping again collapses it.
- Given `albumCount == 0`, then the row is plain and one tap emits `SpacePoolTarget`.
- Given `albumCount > 0` but the Drift stream is empty, then the empty-albums hint shows and the pool child
  still works.
- Given a collapsed row, then no Drift query is issued for it.
- Given a second row is expanded, then the first collapses and its subscription is released.
- Given a double-tap on a plain row, then exactly one `SpacePoolTarget` is emitted.
- Given an add is in flight, then rows are disabled.
- Given a tap on an album child, then a `SpaceAlbumTarget` carrying the owning space's id is emitted.
- Given a selection containing a non-owned asset, then the `spaces_hidden_non_owned_selection` notice shows
  and no rows render.
- Given `currentUserProvider` is null, then the section behaves as "contains non-owned" (fail-closed).
- Given a selection containing a locked-folder asset, then no rows render.
- Given a selection of exactly 50 000, then rows render; given 50 001, then the
  `spaces_hidden_too_many_assets` notice shows — both boundaries.
- Given the space sheet for space X, then X is absent from its own list.
- Given a very long or RTL space name, then it ellipsises on one line.
- Given a space row, then it exposes `Semantics(button: true)` with its expanded/collapsed state announced,
  and children meet the minimum tap target.

---

### Slice 7 — `CollectionPicker`, header, and the two sheets

**Goal.** Compose and mount, without regressing the album flow.

**Files.** New `collection_picker.widget.dart` and `collection_picker_header.widget.dart`. Two-line diff to
the upstream `general_bottom_sheet.widget.dart`; `slivers:` plus `maxChildSize` 0.55 → 0.85 in the fork-only
`space_bottom_sheet.widget.dart`. New
`mobile/test/presentation/widgets/collection/collection_picker_test.dart` plus additions to the two sheet
tests.

**Tests first (BDD).**

- Given the picker, then the header reads `add_to_album_or_space`, above the album selector, above the
  spaces section — the header being new is what makes that string reachable at all (correction 5).
- Given an album row is tapped, then the existing add-to-album behaviour runs unchanged.
- Given the album search, sort, quick-filter and grid/list controls, then they all still work.
- Given the keyboard-expand callback, then it is still threaded to the album selector, and the spaces
  section is not left behind the IME.
- Given the space sheet at its default extent, then the spaces section is reachable by dragging to
  `maxChildSize` — the 0.55 regression guard.
- Given the space sheet, then the picker sits alongside share / download / favourite / remove-from-space.
- Given a viewer on the space sheet, then the album half renders and the spaces section does not.
- Given `AlbumSelector`, then `git diff` reports its file unchanged — a `Done when` command, not a test.

---

### Slice 8 — i18n, toasts and gates

**Goal.** Ship-quality strings, fully translated, and a green CI.

**One new key is required, and it is added in Slice 6, not here** — Slice 6 is its first consumer, and a key
must exist in the slice that renders it. This table is the authoritative wording for that Slice 6 change; no
i18n edit happens in Slice 8.

The reused `add_to_collection_restricted_to_space` reads "…so only albums in this space can accept them",
which is **web's contribution-mode message**: it promises a destination that mobile deliberately does not
offer (R1). Using it would tell the user to look for something that is not on screen. So a new key is
added — and, per the fork rule that a new key must not ship untranslated, **with all nine translations in the
same commit**:

| Locale    | `spaces_hidden_non_owned_selection`                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| `en`      | Your selection includes photos owned by other members, so it can't be added to a space.                         |
| `de`      | Deine Auswahl enthält Fotos anderer Mitglieder und kann daher nicht zu einem Space hinzugefügt werden.          |
| `fr`      | Votre sélection contient des photos appartenant à d'autres membres ; elle ne peut pas être ajoutée à un espace. |
| `it`      | La tua selezione include foto di altri membri, quindi non può essere aggiunta a uno Space.                      |
| `es`      | Tu selección incluye fotos de otros miembros, por lo que no se puede añadir a un Space.                         |
| `nl`      | Je selectie bevat foto's van andere leden en kan daarom niet aan een Space worden toegevoegd.                   |
| `pl`      | Twój wybór zawiera zdjęcia należące do innych członków, więc nie można go dodać do Space.                       |
| `ru`      | Ваш выбор содержит фотографии других участников, поэтому его нельзя добавить в Space.                           |
| `zh_Hans` | 您的选择包含其他成员的照片，因此无法添加到 Space。                                                              |
| `zh_Hant` | 您的選擇包含其他成員的照片，因此無法新增至 Space。                                                              |

Terminology matches each locale's existing Spaces strings: "Space" stays untranslated everywhere except
French, which uses "espace" (cf. the existing `add_to_space` values).

**Every other key already exists and is already translated** in all nine locales, verified by value on
2026-07-26: `add_to_album_or_space`, `add_to_space`, `spaces_hidden_too_many_assets`, `added_to_space_count`,
`space_album_add_photos_success`, `spaces_edit`, `spaces_edit_success`, `errors.unable_to_update_space`,
`spaces_delete`, `spaces_delete_confirmation`, `name`, `description`, `color`.

`spaces_no_writable_spaces` is deliberately **not** used: web shows it as an empty state, whereas this design
omits the whole section when there is nothing writable (§3).

**Files.** No `i18n/` edit in this slice — the one new key landed in Slice 6. This slice only keys the
hardcoded English on the two surfaces this work touches: the space detail kebab and the space card sheet,
both of which use keys that already exist.

**Tests first (BDD).**

- Given a successful pool add of N photos, then `added_to_space_count` shows with N (the request length).
- Given a successful space-album add, then `space_album_add_photos_success` shows the server's count.
- Given a count of 1, then the singular plural form renders; and given `ru` and `pl` — both of which have
  three plural forms and are both in the committed locale set — then the correct form is selected.
- Given a failed add, then `scaffold_body_error_occurred` shows and no count is claimed.
- Given the space detail kebab and card sheet, then delete renders `spaces_delete` /
  `spaces_delete_confirmation` rather than hardcoded English.

**Done when.** All of these commands pass:

```bash
dart analyze --fatal-infos lib test
dart format --set-exit-if-changed .
flutter test
# exactly one key added, in exactly ten files, and nothing else under i18n/ changed:
git diff --stat origin/main -- ../i18n/ | tail -1
git diff origin/main -- ../lib/presentation/widgets/album/album_selector.widget.dart   # must be empty
```

Strings left hardcoded elsewhere in mobile Spaces — "Create Space", "Add Photos", "Remove from space",
"Members", "Space deleted", the spaces empty state — are **out of scope** and recorded as a follow-up.

### Follow-up found during implementation (not fixed here)

`SpaceCard.build` reads **seven** `Optional` fields via bare `.value` — `newAssetCount`,
`recentAssetIds`, `recentAssetThumbhashes`, `color`, `members`, `assetCount`, `memberCount`
(`space_card.dart:14` onwards). `Absent.value` throws `StateError`, so any one of them being absent
crashes the whole Spaces grid render. `spaces_page_test.dart:27-32` documents this explicitly and
works around it by always populating them in the fixture, which means the test suite cannot catch a
regression here. This is the same defect class as the `space.members.value ?? const []` crash that
Slice 1 removed from `SpaceLinkPickerSheet`. Hardening it is a small, self-contained follow-up:
swap each to `.orElse(null) ?? <default>` and add a "renders with every optional absent" test.
Deliberately **not** bundled into Slice 4 — it is a separate defect on a separate surface, and
folding it in would widen a slice that already changes RBAC gating.

**Convention note.** Sibling widget tests in this repo assert English literals
(`find.text('Show in timeline')`, `space_album_kebab_test.dart:79`). New tests follow that convention and
assert the rendered English; the "no hardcoded English" requirement is about `lib/`, not `test/`.

## Running the tests

Flutter **3.41.7** (the pinned SDK — `mise.toml` may symlink an older patch). From `mobile/`:

```bash
flutter pub get
dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart
flutter test
```

Drift and OpenAPI generated code is committed, so `build_runner` is not needed. CI runs **two** Dart gates:
`dart analyze --fatal-infos lib test` (local `flutter analyze lib` misses test-only lints) and
`dart format --set-exit-if-changed`.

## Risks

**R1 — Contribution-mode parity gap with web.** `2026-07-25-space-add-to-collection-design.md` lets a space
Owner/Editor contribute other members' photos into albums linked to that space. Mobile deliberately does
not: when the selection contains a non-owned asset, space targets are hidden behind a notice. This is an
informed deferral — mobile has zero contribution plumbing, and the honest notice beats the alternative, where
`POST /shared-spaces/:id/assets` rejects the entire batch over one non-owned id and the user gets nothing
plus a vague error. It is also why Slice 8 mints a new string rather than reusing web's, which describes a
capability mobile does not have.

**R2 — The spaces section is network-backed while albums are local-first.** `sharedSpacesProvider` calls
`getAll()`, so offline the section hides while the album half keeps working. Acceptable because the section
is additive, but the picker's contents differ online and offline. Expansion is unaffected — linked albums
come from Drift.

**R3 — One upstream file is touched.** `general_bottom_sheet.widget.dart`, two lines.
`album_selector.widget.dart` is upstream and untouched — pinned by a `git diff` check in Slice 8's Done-when.
`space_bottom_sheet.widget.dart` is fork-only and unconstrained.

**R4 — The absorbed-album foreign-key trap.** Routing a `SpaceAlbumTarget` through `addToAlbum` throws on an
absorbed album. Exactly what a well-meaning "unify the two add paths" refactor would reintroduce, so Slice 5
pins it with an explicit never-called assertion rather than relying on the comment at
`space_album_actions.dart:57`.

**R5 — Rename freshness depends on a re-fetch, not on sync.** The obvious-looking fix (invalidate
`sharedSpaceProvider`, nudge `syncRemote()`) is a **no-op**: that provider has no consumers, and no display
code reads the Drift name column. Slice 4 asserts the observable — the app bar shows the new name — rather
than the mechanism, so a future refactor of how the page loads metadata cannot silently break it.

**R6 — `space_permissions` changes gating on an untested page.** Adopting the shared helper makes a
creator-not-in-members an owner on `space_detail.page.dart`, where today they are not. That is the correct
reading, but it changes who sees "Delete Space" on a page with no test coverage. Slice 1 pins the new
behaviour and Slice 4's extraction gives the page its first tests.

**R7 — The 50 000 cap is applied more broadly than the server requires.** The cap is real only for the pool
endpoint; `PUT /albums/{id}/assets` has no such max. Hiding the whole section — including album children —
above 50 000 is therefore over-broad. Accepted for simplicity: a >50 000 selection is already pathological
on a phone, and the alternative is a per-row gate whose rules the user cannot see.

**R8 — One extra tap to reach a space pool.** Spaces with linked albums need expand-then-tap. Chosen for
safety on a shared surface (§3). If it proves annoying, the fix is a trailing "add here" affordance on the
row, not making the whole row tap-to-add.
