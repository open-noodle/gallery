# Phase 2B Slice B5 — Space Link-Album Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** A pushed, searchable multi-select `SpaceLinkAlbumPage` (`SpaceLinkAlbumRoute(spaceId, linkedAlbumIds)`) listing the albums the current user **owns or can edit**, **excluding** already-linked ids, returning the chosen album ids via `context.maybePop(List<String>)`. Wires the shelf/list "＋ Link" affordance to push it.

**Architecture:** Clone `SpaceMemberSelectionPage`'s pushed-route + multi-select shape. Candidate albums come from the user's personal `RemoteAlbum` list (the existing albums provider), filtered to own/editable and minus `linkedAlbumIds`. The picker only **returns** the selection — the actual `PUT /shared-spaces/:id/albums/:albumId` loop + sync-nudge is B6 (the caller).

**Spec:** §7 surface 4, §10.3 B5. Layout: **mobile design §Surface 4**. **Depends on B0–B4.**

**Commands:** `mise codegen` (auto_route), `cd mobile && mise exec -- flutter test <path>`, `mise analyze`.

---

## Verified clone-source facts

- Route clone: `mobile/lib/pages/library/spaces/space_member_selection.page.dart` (`@RoutePage()` `HookConsumerWidget`, `existingMemberIds`, close via `context.maybePop()` — returns the selection). Route registered in `router.dart:161` (`SpaceMemberSelectionRoute`).
- Candidate source: the user's albums provider (`mobile/lib/providers/infrastructure/remote_album.provider.dart`) + `mobile/lib/utils/album_filter.utils.dart` (`AlbumFilter`, `QuickFilterMode`) + `getUserRole`/`ownerId` for own/edit. `AlbumSelector` (`album_selector.widget.dart`) is the searchable-list reference.
- "own or edit" = the user is the album owner OR an editor `album_user` on it (the same rule the server enforces for linking).

---

## Task 1: Candidate filter — own/editable, exclude linked (TDD)

**Files:** Create `mobile/lib/utils/space_link_album_candidates.dart` (a pure function) + Test `mobile/test/utils/space_link_album_candidates_test.dart`.

- [ ] **Step 1: Failing test** for a pure function `linkableAlbumCandidates({required List<RemoteAlbum> albums, required String currentUserId, required Set<String> linkedAlbumIds, String query = ''})`:
  - includes an album owned by `currentUserId`; includes one the user can edit; **excludes** one the user is only a viewer on; **excludes** any id in `linkedAlbumIds`; filters by `query` (case-insensitive name contains).
  - Build `RemoteAlbum` fixtures via the existing test helper/builder (find how other tests construct `RemoteAlbum` — e.g. a fixture in `test/fixtures` or a `.copyWith` on a builder).

- [ ] **Step 2: Run; verify FAIL.**

- [ ] **Step 3: Implement** the pure function. Determine own/edit from the `RemoteAlbum`'s owner/role data (confirm the field — `ownerId == currentUserId` for owner; the editable check via whatever role/`getUserRole` the model exposes; if the model lacks a role, reuse `album_filter.utils`/`QuickFilterMode.owned`+shared-editor logic). Exclude `linkedAlbumIds`; apply the query filter.

- [ ] **Step 4: Run; verify PASS.** Commit: `feat(mobile): linkableAlbumCandidates filter (own/edit, exclude linked)`

---

## Task 2: `SpaceLinkAlbumPage` + route (TDD)

**Files:** Create `mobile/lib/pages/library/spaces/space_link_album.page.dart`; Modify `router.dart`; Test `mobile/test/presentation/pages/space_link_album_page_test.dart`.

- [ ] **Step 1: Failing widget tests** (clone the `space_member_selection.page.dart` test harness if one exists, else `drift_remote_album_page_test.dart`; override the albums provider with a fixed list):
  - given 3 candidate albums (1 already linked) → 2 selectable rows (`Key('link-album-row-<id>')`); the linked one is absent.
  - search filters the rows by name.
  - selecting 2 rows enables the "Link (2)" action (`Key('link-album-confirm')`); tapping it returns/pops `[id1, id2]` (assert via a captured pop result or an `onLink` callback).
  - empty candidates → "No albums to link" empty state (`Key('link-album-empty')`).

- [ ] **Step 2: Run; verify FAIL.**

- [ ] **Step 3: Implement `SpaceLinkAlbumPage`** — `@RoutePage()` `{required String spaceId, required List<String> linkedAlbumIds}`. Watch the albums provider; run `linkableAlbumCandidates(...)`; render a searchable list of checkbox rows (leading checkbox + cover thumbnail + name + "{count} photos" — reuse the cover fallback). App bar: close (`Icons.close_rounded`) + "Link (N)" action (enabled when N>0) that `context.maybePop(selectedIds)`. Empty state when no candidates. Use `HookConsumerWidget` + a selection set, mirroring `SpaceMemberSelectionPage`.

- [ ] **Step 4: Register route** in `router.dart` (near `SpaceMemberSelectionRoute`, line ~161): `AutoRoute(page: SpaceLinkAlbumRoute.page, guards: [_authGuard, _duplicateGuard]),`. Run `mise codegen`; confirm `SpaceLinkAlbumRoute` + its arg names.

- [ ] **Step 5: Run; verify PASS.** Commit: `feat(mobile): SpaceLinkAlbumPage searchable multi-select picker + route`

---

## Task 3: Wire "＋ Link" → the picker (returns ids; linking is B6)

**Files:** Modify `space_albums.page.dart` (B3 `onLink`), the shelf Link tile (B2 `onLinkTap`), `space_detail.page.dart`.

- [ ] **Step 1:** Wire both "＋ Link" entry points to push `SpaceLinkAlbumRoute(spaceId: ..., linkedAlbumIds: <current linked ids>)` and capture the returned `List<String>?`. For B5, on a non-null result, call a stub `onAlbumsPicked(ids)` (a no-op / `TODO(B6)` that B6 replaces with the PUT loop + sync-nudge). The point of B5 is the picker returns the ids; B6 does the linking.
- [ ] **Step 2:** A nav/callback test asserting "＋ Link" pushes `SpaceLinkAlbumRoute` with the correct `linkedAlbumIds`. Commit: `feat(mobile): ＋Link opens the album link picker`

---

## Task 4: Slice gate

- [ ] `mise analyze` clean for touched files; all B5 test files green; commit fixes.

---

## Self-Review

**§10.3 B5 coverage:** candidate filter own/edit + exclude-linked (Task 1) ✓; search filter (Task 2) ✓; multi-link returns N (Task 2) ✓; empty state (Task 2) ✓.

**Placeholders:** the `onAlbumsPicked` stub is the explicit B6 seam (the actual PUT loop + sync-nudge). Everything else concrete.

**Type consistency:** `linkableAlbumCandidates`, `SpaceLinkAlbumPage`, `SpaceLinkAlbumRoute`, the row/confirm/empty Keys consistent.

## Open items

- The exact albums provider + the `RemoteAlbum` own/edit-role field (Task 1/3) — read the provider and model.
- How `SpaceMemberSelectionPage` returns its result (`context.maybePop(<list>)`) — mirror it.
- `RemoteAlbum` test-fixture construction for the filter test.
- `mise codegen` must regenerate `SpaceLinkAlbumRoute`.
