# Phase 2B Slice B3 — Space Albums List / Manage Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** A pushed `SpaceAlbumsPage` (`SpaceAlbumsRoute(spaceId, canEdit)`) — a 2-column grid of the space's linked albums (cover, name, "{count} photos · Hidden"), with an editor-only card ⋮ (Show/Hide-in-timeline, Unlink) and an app-bar "＋ Link" action, plus a centered empty state. Wires the B2 shelf's "See all ▸" to push it.

**Architecture:** Reuses B2's `spaceAlbumsProvider` / `SpaceAlbum`; extends both with an `assetCount` (a `COUNT` over `shared_space_album_asset`). The page is a `@RoutePage()` registered with auto_route (`mise codegen` regenerates `router.gr.dart`). The ⋮/＋Link affordances call stub callbacks (the real REST mutations + sync-nudge land in B6).

**Spec:** §7 surface 2, §10.3 B3. Layout: **mobile design §Surface 2**. **Depends on B0–B2.**

**Commands:** `mise codegen` (auto_route), `cd mobile && mise exec -- flutter test <path>`, `mise analyze`.

---

## Verified clone-source facts

- Route registration: `mobile/lib/routing/router.dart:159` (`AutoRoute(page: SpaceMembersRoute.page, guards: [_authGuard, _duplicateGuard])`) — add `SpaceAlbumsRoute.page` right after.
- Page annotation `@RoutePage()` — see `space_members.page.dart` / `space_detail.page.dart:27`.
- Page shell + role clone source: `mobile/lib/pages/library/spaces/space_members.page.dart` (a pushed space subpage).
- Cover fallback + tile: reuse B2's `_SpaceAlbumCover` (in `space_albums_shelf.widget.dart`) or the `album_tile.dart` pattern.
- Widget-test harness: `mobile/test/presentation/pages/drift_remote_album_page_test.dart`.

---

## Task 1: Add `assetCount` to the read infra (TDD)

**Files:** Modify `space_album.model.dart` (+`assetCount`), `space_album.repository.dart` (`watchLinkedAlbums` count subquery); Test: extend `space_album_repository_test.dart`.

- [ ] **Step 1: Add `final int assetCount;`** to `SpaceAlbum` (default 0 in the constructor: `this.assetCount = 0`).
- [ ] **Step 2: Failing test** — link an album, insert 2 `shared_space_album_asset` rows, assert `watchLinkedAlbums(...).first` returns that album with `assetCount == 2`, and an album with no assets has `assetCount == 0`.
- [ ] **Step 3: Run; verify FAIL.**
- [ ] **Step 4: Implement** — add a correlated count to `watchLinkedAlbums`. Use a Drift `subqueryExpression`/`countAll` over `shared_space_album_asset WHERE album_id = link.album_id`, read it into `assetCount`. (Confirm the exact Drift count-subquery idiom against existing repo queries; a `customSelect` join with `groupBy` + `count()` is acceptable if cleaner.)
- [ ] **Step 5: Run; verify PASS.** Commit: `feat(mobile): add assetCount to SpaceAlbum read infra`

---

## Task 2: `SpaceAlbumsPage` + route (TDD)

**Files:** Create `mobile/lib/pages/library/spaces/space_albums.page.dart`; Modify `mobile/lib/routing/router.dart`; Test: `mobile/test/presentation/pages/space_albums_page_test.dart`.

- [ ] **Step 1: Write the failing widget tests** (clone the `drift_remote_album_page_test.dart` harness; override `spaceAlbumsProvider`). Cover §10.3 B3:
  - editor + 2 albums → 2 grid cards (`Key('space-album-card-<id>')`), each card has a ⋮ menu (`Key('space-album-card-menu-<id>')`), app-bar shows "＋ Link" (`Key('space-albums-link-action')`).
  - viewer + 2 albums → 2 cards but **no** ⋮ menu and **no** ＋Link action.
  - empty + editor → empty state (`Key('space-albums-empty')`) with a "Link album" CTA.
  - an album with `showInTimeline:false` → its card shows the "Hidden" label / dimmed cover (`find.byIcon(Icons.visibility_off)`).

- [ ] **Step 2: Run; verify FAIL.**

- [ ] **Step 3: Implement `SpaceAlbumsPage`** — `@RoutePage()`, a `ConsumerWidget` taking `{required String spaceId, required bool canEdit}`. Watches `spaceAlbumsProvider(spaceId)`; renders a 2-col `GridView` of cards (cover via the reused `_SpaceAlbumCover`, name 2-line clamp, "{assetCount} photos" + " · Hidden" when `!showInTimeline`). Editor: card `PopupMenuButton` ⋮ (items "Show/Hide in timeline", "Unlink" — `onSelected` calls passed-in stub callbacks `onToggle(albumId)` / `onUnlink(albumId)`) + an app-bar `TextButton.icon` "＋ Link" (`onPressed: onLink` stub). Empty state centered (`Icons.photo_album_outlined` + editor CTA). Design language per §7 (radius 16, `surfaceContainer*`, `withValues(alpha:)`).

  > The `onToggle`/`onUnlink`/`onLink` callbacks are constructor params with no-op defaults for B3; B5 supplies the link picker, B6 supplies the real mutations. The page reads `canEdit` to gate the affordances.

- [ ] **Step 4: Register the route** in `router.dart` after line 159:

```dart
    AutoRoute(page: SpaceAlbumsRoute.page, guards: [_authGuard, _duplicateGuard]),
```

- [ ] **Step 5: Run `mise codegen`** to regenerate `router.gr.dart` (creates `SpaceAlbumsRoute`). Verify it exits 0 and `SpaceAlbumsRoute` exists.

- [ ] **Step 6: Run the widget tests; verify PASS.** Commit: `feat(mobile): SpaceAlbumsPage list/manage grid + route`

---

## Task 3: Wire the shelf "See all ▸" → the list page

**Files:** Modify `space_albums_shelf.widget.dart` (B2) + `space_top_sliver.widget.dart` / `space_detail.page.dart`.

- [ ] **Step 1:** Add an `onSeeAll` callback to the shelf (header row "See all ▸", shown when count>0). In `SpaceDetailPage`, wire `onSeeAll: () => context.pushRoute(SpaceAlbumsRoute(spaceId: widget.spaceId, canEdit: _canEdit))`.
- [ ] **Step 2:** A widget/nav test asserting tapping "See all" pushes `SpaceAlbumsRoute` (use a mock navigator or `find` the route push). If nav-mocking is heavy, assert the callback is invoked.
- [ ] **Step 3: Commit** `feat(mobile): shelf "See all" pushes the Space Albums list page`

---

## Task 4: Slice gate

- [ ] `mise analyze` clean for touched files; run all B3 test files green; commit fixes.

---

## Self-Review

**§10.3 B3 coverage:** editor-vs-viewer affordances (Task 2 tests) ✓; empty state (Task 2) ✓; the count/Hidden label (Task 1 + Task 2 off-timeline test) ✓. Inter-slice seams (`onToggle`/`onUnlink`/`onLink` stubs) are explicit B5/B6 work, not deferred B3 scope.

**Type consistency:** `SpaceAlbum.assetCount`, `SpaceAlbumsPage`, `SpaceAlbumsRoute`, card Keys consistent.

## Open items

- The Drift count-subquery idiom for `assetCount` (Task 1 Step 4) — match an existing repo pattern.
- `mise codegen` must succeed and regenerate `SpaceAlbumsRoute` before the route compiles.
- `context.pushRoute(SpaceAlbumsRoute(...))` arg names match the generated route constructor.
