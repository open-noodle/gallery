# Phase 2B Slice B4 — Space Album Detail Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** A pushed `SpaceAlbumDetailPage` (`SpaceAlbumDetailRoute(spaceId, albumId, canEdit)`) showing one linked album's photos via the B0 `timelineFactoryProvider.spaceAlbum(spaceId, albumId)` query, with a **space-role-gated** kebab (editor: Add photos / Show-Hide in timeline / Unlink) and a **reduced** multiselect bottom sheet (editor: Download / Share / Remove-from-album). No Delete / Add-users / Shared-link / Set-cover / Favorite / Archive / Trash / Lock. Viewer: read-only (no kebab, no mutating bottom-sheet actions). Wires the shelf/list album tap → this page.

**Architecture:** Clone `drift_remote_album.page.dart`'s `TimelineRouteScope`+`Timeline` structure but swap the timeline builder to `spaceAlbum(...)`, gate affordances on **space role** (D3) not album ownership, and use a reduced kebab/bottom-sheet. If `RemoteAlbumSliverAppBar` / `currentRemoteAlbumScopedProvider` / `RemoteAlbumBottomSheet` are too coupled to `RemoteAlbum`, build minimal standalone equivalents (`_SpaceAlbumKebab`, `SpaceAlbumBottomSheet`). The mutation callbacks (add/toggle/unlink/remove) are B6 stubs.

**Spec:** §7 surface 3, §10.3 B4, D3. Layout: **mobile design §Surface 3**. **Depends on B0–B3.**

**Commands:** `mise codegen` (auto_route), `cd mobile && mise exec -- flutter test <path>`, `mise analyze`.

---

## Verified clone-source facts

- Detail page structure: `drift_remote_album.page.dart:171-201` (`TimelineRouteScope(timelineServiceBuilder: …remoteAlbum(...), overrides: [...], child: Timeline(appBar: RemoteAlbumSliverAppBar(kebabMenu: _AlbumKebabMenu(...)), bottomSheet: RemoteAlbumBottomSheet(album)))`).
- B0 added `timelineFactoryProvider.spaceAlbum(spaceId, albumId, groupBy, temporalScope)`.
- Bottom-sheet gating clone: `RemoteAlbumBottomSheet` gates on `ownsAlbum` (`remote_album_bottom_sheet.widget.dart`); B4 gates the same kind of action buttons on `canEdit` (space role).
- `RemoveFromAlbumActionButton` + `actionProvider.removeFromAlbum(source, albumId)` exist (the action layer does NOT client-gate on ownership — D3); they hit the Phase-1-permitted endpoint.
- Route registration: `mobile/lib/routing/router.dart` (after `SpaceAlbumsRoute`).
- Album metadata for the header: `spaceAlbumsProvider(spaceId)` (B2) → firstWhere(id==albumId) gives `SpaceAlbum{name, assetCount, showInTimeline}`; space name via `sharedSpaceProvider(spaceId)` (existing).

---

## Task 1: Reduced kebab + bottom sheet widgets (TDD)

**Files:**

- Create: `mobile/lib/presentation/widgets/spaces/space_album_kebab.widget.dart` (`SpaceAlbumKebab` — a `PopupMenuButton` with 3 items, shown only when `canEdit`).
- Create: `mobile/lib/presentation/widgets/spaces/space_album_bottom_sheet.widget.dart` (`SpaceAlbumBottomSheet` — Download / Share always; Remove-from-album only when `canEdit`).
- Test: `mobile/test/presentation/widgets/spaces/space_album_kebab_test.dart`, `..._bottom_sheet_test.dart`.

- [ ] **Step 1: Failing tests** (pump each widget directly — these don't need the full Timeline):
  - `SpaceAlbumKebab(canEdit:true)` → tapping it opens a menu with exactly: "Add photos", "Show in timeline"/"Hide from timeline", "Unlink from space" (Keys `space-album-kebab-{add,toggle,unlink}`). It must NOT contain Delete / Add users / Shared link / Set cover.
  - `SpaceAlbumKebab(canEdit:false)` → renders nothing (`SizedBox.shrink`) or no menu button (assert absent).
  - `SpaceAlbumBottomSheet(canEdit:true)` → has Download + Share + Remove-from-album buttons; canEdit:false → Download + Share only (no Remove); never Favorite/Archive/Trash/Lock/Set-cover.

- [ ] **Step 2: Run; verify FAIL.**

- [ ] **Step 3: Implement** both widgets. `SpaceAlbumKebab`: a `PopupMenuButton` (returns `SizedBox.shrink()` when `!canEdit`); the toggle item label flips on `showInTimeline`; `onSelected` calls `onAddPhotos`/`onToggleTimeline`/`onUnlink` stub callbacks. `SpaceAlbumBottomSheet`: model on `RemoteAlbumBottomSheet` but with only the reduced action set; gate Remove-from-album on `canEdit` (reuse `RemoveFromAlbumActionButton` if it composes, else a button calling an `onRemove` stub). Design language per §7.

- [ ] **Step 4: Run; verify PASS.** Commit: `feat(mobile): space-album detail kebab + reduced bottom sheet (role-gated)`

---

## Task 2: `SpaceAlbumDetailPage` + route (TDD-lite)

**Files:** Create `mobile/lib/pages/library/spaces/space_album_detail.page.dart`; Modify `router.dart`; Test: `mobile/test/presentation/pages/space_album_detail_page_test.dart`.

- [ ] **Step 1: Failing test** — a page-level role-gating test. Pumping the full `Timeline` is heavy; prefer asserting the page wires the kebab gated on role. Pump `SpaceAlbumDetailPage(spaceId, albumId, canEdit:true/false)` with `spaceAlbumsProvider` + `sharedSpaceProvider` overridden; assert `find.byType(SpaceAlbumKebab)` exists and receives `canEdit` correctly (editor → kebab present/enabled; viewer → `SpaceAlbumKebab` renders nothing). If the full Timeline can't pump in a widget test, extract the app-bar/kebab assembly into a testable sub-widget and test that, and keep the page a thin shell.

- [ ] **Step 2: Run; verify FAIL.**

- [ ] **Step 3: Implement `SpaceAlbumDetailPage`** — `@RoutePage()`, `ConsumerWidget` `{required String spaceId, required String albumId, required bool canEdit}`. Resolve the `SpaceAlbum` from `spaceAlbumsProvider(spaceId)` (firstWhere id==albumId; handle not-found gracefully) and the space name from `sharedSpaceProvider(spaceId)`. Build `TimelineRouteScope(timelineServiceBuilder: (ref, scope, groupBy) => ref.watch(timelineFactoryProvider).spaceAlbum(spaceId: spaceId, albumId: albumId, groupBy: groupBy, temporalScope: scope), child: Timeline(appBar: <sliver app bar with header "{assetCount} photos · in {space.name}" + SpaceAlbumKebab(canEdit, showInTimeline, on*: stubs)>, bottomSheet: SpaceAlbumBottomSheet(canEdit, albumId, on*: stubs)))`.

  > If `RemoteAlbumSliverAppBar` accepts an arbitrary `kebabMenu` widget and a title, reuse it (pass `SpaceAlbumKebab`, no `onEditTitle`/`onActivity`). If it hard-depends on `RemoteAlbum`/`currentRemoteAlbumScopedProvider`, build a minimal `SliverAppBar` instead. Resolve by reading `remote_album_sliver_app_bar` and whether the spaceAlbum timeline query needs the scoped-album override (it should NOT — it is keyed by albumId directly).
  > The `on*` mutation callbacks are no-op stubs here; B6 supplies the real REST calls + sync-nudge.

- [ ] **Step 4: Register route** in `router.dart` (after `SpaceAlbumsRoute`): `AutoRoute(page: SpaceAlbumDetailRoute.page, guards: [_authGuard, _duplicateGuard]),`. Run `mise codegen`; confirm `SpaceAlbumDetailRoute` exists.

- [ ] **Step 5: Run; verify PASS.** Commit: `feat(mobile): SpaceAlbumDetailPage + route (spaceAlbum timeline, role-gated)`

---

## Task 3: Wire album tap → detail page

**Files:** Modify the B2 shelf (`onAlbumTap`) + the B3 list page (`_AlbumCard` tap) + `space_detail.page.dart`.

- [ ] **Step 1:** Wire `onAlbumTap(albumId)` (shelf) and the list card tap to `context.pushRoute(SpaceAlbumDetailRoute(spaceId: spaceId, albumId: albumId, canEdit: canEdit))`. In `SpaceAlbumsPage`, the card tap pushes directly; in the shelf, thread `onAlbumTap` from `SpaceDetailPage`.
- [ ] **Step 2:** A nav/callback test asserting tapping a card/cover pushes `SpaceAlbumDetailRoute` (or invokes the callback). Commit: `feat(mobile): album tap opens the Space Album detail page`

---

## Task 4: Slice gate

- [ ] `mise analyze` clean for touched files; all B4 test files green; commit fixes.

---

## Self-Review

**§10.3 B4 coverage:** role-gated kebab (Task 1 — editor has the 3 items, viewer none) ✓; reduced bottom sheet, excluded actions absent (Task 1) ✓; the page wires role gating (Task 2) ✓; album tap opens detail (Task 3) ✓.

**Placeholders:** mutation `on*` callbacks are explicit B6 seams. Everything else concrete.

**Type consistency:** `SpaceAlbumKebab`, `SpaceAlbumBottomSheet`, `SpaceAlbumDetailPage`, `SpaceAlbumDetailRoute`, the `canEdit`/`showInTimeline` flags and `onAddPhotos`/`onToggleTimeline`/`onUnlink`/`onRemove` callbacks used consistently.

## Open items

- Reuse `RemoteAlbumSliverAppBar` vs a minimal `SliverAppBar` (Task 2) — decide by reading its coupling to `RemoteAlbum`.
- Whether the `spaceAlbum` Timeline needs any scoped-album provider override (it should not — keyed by albumId).
- Widget-testability of the full Timeline page — if untestable, extract a testable app-bar sub-widget and keep the page thin.
- `mise codegen` must regenerate `SpaceAlbumDetailRoute` before the route compiles.
