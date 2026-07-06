# Phase 2B Slice B6 — Editor Mutations + Gating — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Make the B2–B5 affordances actually mutate: link / unlink / toggle-`showInTimeline` / add-photos / remove-photos call the Phase-1 endpoints and fire the sync-nudge (`backgroundSyncProvider.syncRemote()`), replacing every stub callback. Viewer stays read-only end-to-end (the affordances are already role-gated; this slice keeps them gated and adds the real calls behind them).

**Architecture:** Add album wrapper methods to `SharedSpaceApiRepository` (clone its existing method shape). A testable `SpaceAlbumActions` (a small Riverpod-provided class, or methods on a Notifier) centralizes link/unlink/toggle: each calls the API repo, then the sync-nudge, then a toast. The pages' stub callbacks (`onLink`/`onAlbumsPicked`, `onToggle`/`onToggleTimeline`, `onUnlink`, `onAddPhotos`, `onRemove`) now call these actions. Add-photos pushes `DriftAssetSelectionTimelineRoute` → `addToAlbum` → nudge; remove uses the already-wired `RemoveFromAlbumActionButton` + nudge.

**Spec:** §7, §10.4, decision D3. **Depends on B0–B5.**

**Commands:** `cd mobile && mise exec -- flutter test <path>`, `mise analyze`.

---

## Verified clone-source facts

- SDK methods (in `mobile/openapi/lib/api/shared_spaces_api.dart`): `updateSharedSpaceAlbum(albumId, id, SharedSpaceAlbumLinkUpdateDto)` (PATCH toggle, line 2369); the link (PUT) + unlink (DELETE) methods at `/shared-spaces/{id}/albums/{albumId}` (lines ~1530, ~1966) — **confirm their exact method names** by reading those lines (likely `linkSharedSpaceAlbum`/`unlinkSharedSpaceAlbum` or `add…`/`remove…`).
- API-repo clone shape: `SharedSpaceApiRepository` (`shared_space_api.repository.dart`) — `_api`, `checkNull`, e.g. `Future<void> removeMember(spaceId, userId) async { await _api.removeMember(spaceId, userId); }`.
- Sync-nudge: `SpaceDetailPage._triggerSpaceSync()` → `ref.read(backgroundSyncProvider).syncRemote()` (line 156-158).
- Add/remove asset actions: `addToAlbum`/`removeFromAlbum` action providers (do NOT client-gate on ownership — D3); `DriftAssetSelectionTimelineRoute` for the add-photos picker (see `SpaceDetailPage._addPhotos` line 119).

---

## Task 1: API-repo album methods

**Files:** Modify `mobile/lib/repositories/shared_space_api.repository.dart`.

- [ ] **Step 1: Add three methods** (clone the existing shape; use the confirmed SDK method names):

```dart
  Future<void> linkAlbum(String spaceId, String albumId) async {
    await _api.<linkSharedSpaceAlbum>(albumId, spaceId);
  }

  Future<void> unlinkAlbum(String spaceId, String albumId) async {
    await _api.<unlinkSharedSpaceAlbum>(albumId, spaceId);
  }

  Future<void> updateAlbumLink(String spaceId, String albumId, {required bool showInTimeline}) async {
    await _api.updateSharedSpaceAlbum(albumId, spaceId, SharedSpaceAlbumLinkUpdateDto(showInTimeline: showInTimeline));
  }
```

> Confirm the SDK method names + argument order (the SDK uses `(albumId, id)` order — note `id` is the spaceId).

- [ ] **Step 2: Analyze clean. Commit** `feat(mobile): album link/unlink/updateLink in SharedSpaceApiRepository`

---

## Task 2: `SpaceAlbumActions` (TDD)

**Files:** Create `mobile/lib/providers/infrastructure/space_album_actions.dart`; Test `mobile/test/providers/space_album_actions_test.dart`.

- [ ] **Step 1: Failing tests** — mock `SharedSpaceApiRepository` + `BackgroundSyncManager` (override the providers). Assert:
  - `link(spaceId, [a,b])` calls `repo.linkAlbum(spaceId, a)` AND `linkAlbum(spaceId, b)` then `syncRemote()` once (or per call — match the chosen design).
  - `unlink(spaceId, albumId)` calls `repo.unlinkAlbum(...)` then `syncRemote()`.
  - `toggleTimeline(spaceId, albumId, current: true)` calls `repo.updateAlbumLink(..., showInTimeline: false)` then `syncRemote()`.
  - on a repo error, `syncRemote()` is still attempted OR the error surfaces as a toast (pick one; assert it).

- [ ] **Step 2: Run; verify FAIL.**

- [ ] **Step 3: Implement `SpaceAlbumActions`** — a class taking the api repo + a sync-nudge callback (or reading them from `ref`). Each method: `await repo.<op>(...)`, then `await syncRemote()`, then a success `ImmichToast`. Wrap in try/catch → error toast. Expose via a `spaceAlbumActionsProvider`.

- [ ] **Step 4: Run; verify PASS. Commit** `feat(mobile): SpaceAlbumActions (link/unlink/toggle + sync-nudge)`

---

## Task 3: Wire the page stubs to the actions

**Files:** Modify `space_detail.page.dart`, `space_albums.page.dart` (B3), `space_album_detail.page.dart` (B4), the shelf (B2).

- [ ] **Step 1:** Replace the stubs:
  - `SpaceDetailPage._onAlbumsPicked(ids)` → `ref.read(spaceAlbumActionsProvider).link(spaceId, ids)`.
  - List/detail `onToggle`/`onToggleTimeline(albumId)` → `actions.toggleTimeline(spaceId, albumId, current: <album.showInTimeline>)`.
  - List/detail `onUnlink(albumId)` → confirm `AlertDialog` → `actions.unlink(spaceId, albumId)`.
  - Detail kebab `onAddPhotos` → push `DriftAssetSelectionTimelineRoute`, then `addToAlbum(albumId, selected)` (the existing action) → `syncRemote()`.
  - Detail bottom-sheet remove (B4 `RemoveFromAlbumActionButton`) → ensure it triggers `syncRemote()` after (add an `onRemoved` nudge if needed).
    All gated on `canEdit` (already true from B2–B5; keep it).

- [ ] **Step 2: Tests** — for each wired entry point, a widget/callback test asserting the action method is invoked with the right args (mock `spaceAlbumActionsProvider`). Plus a **viewer-denied** test per surface: with `canEdit:false`, the affordance is absent (re-assert the B2–B5 gating end-to-end so a regression that ungated them fails here).

- [ ] **Step 3: Run; verify PASS. Commit** `feat(mobile): wire space-album mutations (link/unlink/toggle/add/remove + nudge)`

---

## Task 4: Reactive toggle flip (TDD)

**Files:** Test `mobile/test/medium/repositories/space_album_repository_test.dart` (or a focused integration test).

- [ ] **Step 1: Failing/È pinning test** — the toggle's effect is local-Drift-driven (the PATCH + sync delivers a new `SharedSpaceAlbumLinkV1` flipping `showInTimeline`, which the B0 union query already honors). Add a test that: link an album with `showInTimeline:true` + an asset → assert it appears in `sharedSpace(...).assetSource`; then update the `shared_space_album_link` row to `showInTimeline:false` (simulating the synced toggle); assert the asset is now **excluded**. This pins that the toggle's data change flips the timeline (the reactive `.watch()` re-emit is the B0 query's job; this confirms the end-to-end data contract).

- [ ] **Step 2: Run; implement if needed (likely already green from B0 — if so, this is a regression pin; note it explicitly).** Commit if new.

---

## Task 5: Slice gate

- [ ] `mise analyze` clean; all B6 test files green; commit fixes.

---

## Self-Review

**§10.4 coverage:** each mutation hits the endpoint + fires the nudge (Task 2 + Task 3 tests) ✓; reactive toggle flip (Task 4) ✓; role matrix viewer-denied per surface (Task 3 Step 2) ✓; add/remove via the existing actions + nudge (Task 3) ✓.

**Placeholders:** none — this slice removes the B2–B5 stubs.

**Type consistency:** `SpaceAlbumActions.{link,unlink,toggleTimeline}`, `spaceAlbumActionsProvider`, the api-repo `linkAlbum`/`unlinkAlbum`/`updateAlbumLink` used consistently.

## Open items

- Confirm the SDK link/unlink method names + arg order (Task 1).
- The `BackgroundSyncManager`/`backgroundSyncProvider` type to mock (Task 2) — read how `SpaceDetailPage` reads it.
- Whether `addToAlbum`/`removeFromAlbum` already nudge sync (they may not — add the nudge in the wiring if absent).
