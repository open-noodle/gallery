# Phase 2B Slice B2 — Albums Shelf (+ shared read infra) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Render the in-space **Albums shelf** as a combined top sliver on `SpaceDetailPage` — a horizontal strip of linked-album cover tiles (with the off-timeline dim+⊘ treatment, cover-not-synced fallback, and an editor-only Link tile) composed above the existing sync banner. Also adds the **shared read infrastructure** (a `SpaceAlbum` model + a `watchLinkedAlbums` Drift query + a Riverpod provider) that B3/B4/B5 reuse.

**Architecture:** A new `SpaceAlbumRepository.watchLinkedAlbums(spaceId)` joins `shared_space_album_link` (per-space, carries `showInTimeline`) with `shared_space_album` (metadata) and emits a reactive `Stream<List<SpaceAlbum>>`. `spaceAlbumsProvider` (`StreamProvider.family`) exposes it. `SpaceAlbumsShelf` renders the tiles; a combined `_SpaceTopSliver` stacks the sync banner above the shelf and replaces the bare `SyncStatusBannerSliver` passed to `Timeline` (D2 — Timeline takes a single `topSliverWidget`).

**Tech Stack:** Flutter, Drift, Riverpod, `flutter_test` widget tests via mise.

**Spec:** `docs/superpowers/specs/2026-06-16-space-albums-phase2b-mobile-impl-design.md` (§7 surface 1, §10.3 B2, D2/D4). Layout: **mobile design §Surface 1** (`docs/superpowers/specs/2026-06-15-space-albums-phase2-mobile-design.md`). **Depends on B0/B1.**

**Commands:** Tests: `cd mobile && mise exec -- flutter test <path>`. Analyze: `mise analyze`. (No codegen unless a new `@riverpod`/freezed model is used — prefer a plain class to avoid codegen.)

---

## Verified clone-source facts

- Role: `SpaceDetailPage._canEdit` / `_currentRole` / `_currentMember` (`space_detail.page.dart:95-117`); roles are `SharedSpaceRole.{owner,editor,viewer}`.
- Top sliver mount: `space_detail.page.dart:293-294` (`topSliverWidget: const SyncStatusBannerSliver(), topSliverWidgetHeight: SpaceDetailPage.syncBannerTopSliverHeight(...)`); banner height const `kSyncStatusBannerSliverHeight`.
- Cover fallback pattern: `mobile/lib/presentation/widgets/album/album_tile.dart:36-63` (`FutureBuilder` over the thumbnail asset → `Thumbnail.remote` when synced, else `Icons.photo_album_*` in a `surfaceContainer` tile).
- Provider style: `StreamProvider.family` (e.g. `timeline.provider.dart:39`); `SpaceAlbumRepository` provider goes in `mobile/lib/providers/infrastructure/` next to the others.
- Widget-test harness: clone `mobile/test/presentation/pages/drift_remote_album_page_test.dart` (pumps a page in a `ProviderScope` with overrides).

---

## Task 1: `SpaceAlbum` model + `watchLinkedAlbums` query (TDD)

**Files:**

- Create: `mobile/lib/domain/models/space_album.model.dart`
- Modify: `mobile/lib/infrastructure/repositories/space_album.repository.dart` (add `watchLinkedAlbums`)
- Test: `mobile/test/medium/repositories/space_album_repository_test.dart` (extend)

- [ ] **Step 1: Define the model** (plain immutable class — no codegen)

```dart
class SpaceAlbum {
  final String id;
  final String name;
  final String? thumbnailAssetId;
  final bool showInTimeline;
  const SpaceAlbum({required this.id, required this.name, this.thumbnailAssetId, required this.showInTimeline});
}
```

- [ ] **Step 2: Write the failing test** (in the B0 repo test file)

```dart
  test('watchLinkedAlbums emits the linked albums (metadata + showInTimeline) for a space', () async {
    final user = await ctx.newUser();
    final space = await ctx.newSharedSpace(createdById: user.id);
    final a1 = await ctx.newSharedSpaceAlbum(name: 'Hawaii');
    final a2 = await ctx.newSharedSpaceAlbum(name: 'Reef');
    await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: a1.id, showInTimeline: true);
    await ctx.insertSharedSpaceAlbumLink(spaceId: space.id, albumId: a2.id, showInTimeline: false);

    final albums = await repo.watchLinkedAlbums(space.id).first;
    expect(albums.map((a) => a.id), containsAll([a1.id, a2.id]));
    expect(albums.firstWhere((a) => a.id == a2.id).showInTimeline, isFalse);
    expect(albums.firstWhere((a) => a.id == a1.id).name, 'Hawaii');
  });

  test('watchLinkedAlbums excludes albums linked to a different space', () async {
    final user = await ctx.newUser();
    final s1 = await ctx.newSharedSpace(createdById: user.id);
    final s2 = await ctx.newSharedSpace(createdById: user.id);
    final album = await ctx.newSharedSpaceAlbum();
    await ctx.insertSharedSpaceAlbumLink(spaceId: s2.id, albumId: album.id);
    final albums = await repo.watchLinkedAlbums(s1.id).first;
    expect(albums, isEmpty);
  });
```

- [ ] **Step 3: Run; verify FAIL** — `cd mobile && mise exec -- flutter test test/medium/repositories/space_album_repository_test.dart 2>&1 | tail -10`. Expected: FAIL (`watchLinkedAlbums` undefined).

- [ ] **Step 4: Implement `watchLinkedAlbums`** in `space_album.repository.dart` (Drift join, reactive `.watch()`)

```dart
  Stream<List<SpaceAlbum>> watchLinkedAlbums(String spaceId) {
    final link = _db.sharedSpaceAlbumLinkEntity;
    final meta = _db.sharedSpaceAlbumEntity;
    final query = _db.select(link).join([
      innerJoin(meta, meta.id.equalsExp(link.albumId)),
    ])..where(link.spaceId.equals(spaceId))
      ..orderBy([OrderingTerm.asc(meta.name)]);
    return query.watch().map(
      (rows) => rows.map((row) {
        final m = row.readTable(meta);
        final l = row.readTable(link);
        return SpaceAlbum(id: m.id, name: m.name, thumbnailAssetId: m.thumbnailAssetId, showInTimeline: l.showInTimeline);
      }).toList(),
    );
  }
```

> Add the `SpaceAlbum` + drift imports. Confirm `innerJoin`/`OrderingTerm` import paths against the neighboring `timeline.repository.dart`.

- [ ] **Step 5: Run; verify PASS.** Commit: `git commit -am "feat(mobile): SpaceAlbum model + watchLinkedAlbums Drift query"`

---

## Task 2: `spaceAlbumsProvider`

**Files:** Create `mobile/lib/providers/infrastructure/space_album.provider.dart`

- [ ] **Step 1: Add the repository provider + the family stream provider** (confirm how `SpaceAlbumRepository` should be constructed — it takes a `Drift`; get it from the existing db provider used by the other infrastructure providers, e.g. `ref.watch(driftProvider)` — check `timeline.provider.dart`/`db.provider.dart` for the exact db provider name)

```dart
final spaceAlbumRepositoryProvider = Provider<SpaceAlbumRepository>(
  (ref) => SpaceAlbumRepository(ref.watch(driftProvider)),
);

final spaceAlbumsProvider = StreamProvider.family<List<SpaceAlbum>, String>(
  (ref, spaceId) => ref.watch(spaceAlbumRepositoryProvider).watchLinkedAlbums(spaceId),
);
```

- [ ] **Step 2: Analyze** — clean. Commit: `git commit -am "feat(mobile): spaceAlbumsProvider (watches linked albums)"`

---

## Task 3: `SpaceAlbumsShelf` widget (TDD)

**Files:**

- Create: `mobile/lib/presentation/widgets/spaces/space_albums_shelf.widget.dart`
- Test: `mobile/test/presentation/widgets/spaces/space_albums_shelf_test.dart`

The shelf takes `spaceId`, `canEdit` (bool), and an `onLinkTap` / `onAlbumTap` callback. It watches `spaceAlbumsProvider(spaceId)` and renders per **mobile design §Surface 1**:

- count>0: horizontal list of cover tiles + (if canEdit) a trailing dashed **Link** tile.
- count==0 & canEdit: a slim one-row shelf with just the Link tile + "Link an album" label.
- count==0 & !canEdit: render **nothing** (`SizedBox.shrink()`).
- A cover tile dims (~60% via `withValues(alpha: 0.6)`) and overlays `Icons.visibility_off` when `!showInTimeline`.
- Cover uses the `album_tile.dart` fallback (`Icons.photo_album_outlined` on `surfaceContainer` when the cover asset isn't synced).

- [ ] **Step 1: Write the failing widget tests** (clone the `ProviderScope` + `overrides` harness from `drift_remote_album_page_test.dart`; override `spaceAlbumsProvider` with a fixed list. Use `tester.pumpWidget` + `find.byType`/`find.text`/`find.byIcon`):
  - given 2 linked albums + `canEdit:true` → finds 2 cover tiles (by a `Key('space-album-tile-<id>')`) + 1 Link tile (`Key('space-album-link-tile')`).
  - an album with `showInTimeline:false` → finds `Icons.visibility_off` for it.
  - empty + `canEdit:true` → finds the Link tile, no cover tiles.
  - empty + `canEdit:false` → finds nothing (shelf renders `SizedBox.shrink`; assert no Link tile and no cover tiles).
  - a tile whose `thumbnailAssetId` is null/unsynced → finds `Icons.photo_album_outlined` (fallback).

  > Keys to add in the widget: `Key('space-album-tile-<albumId>')` per tile, `Key('space-album-link-tile')` for the Link tile, `Key('space-albums-shelf')` for the root. Tests assert via these keys (stable, avoids depending on image loading).

- [ ] **Step 2: Run; verify FAIL** (widget undefined).

- [ ] **Step 3: Implement `SpaceAlbumsShelf`** — a `ConsumerWidget` per the spec above. Use the design language (GoogleSans, radius 16, `surfaceContainer*`, `withValues(alpha:)` never `withOpacity`, `context.colorScheme`). For the cover, reuse the `album_tile.dart` `FutureBuilder` fallback pattern (extract a small `_SpaceAlbumCover` widget). Wrap the whole shelf in `SizedBox.shrink()` for the viewer-empty case.

- [ ] **Step 4: Run; verify PASS.** Commit: `git commit -am "feat(mobile): SpaceAlbumsShelf widget (covers, link tile, off-timeline dim, fallback)"`

---

## Task 4: Combined top sliver on `SpaceDetailPage` (TDD-lite)

**Files:**

- Create: `mobile/lib/presentation/widgets/spaces/space_top_sliver.widget.dart` (the combined banner+shelf sliver)
- Modify: `mobile/lib/pages/library/spaces/space_detail.page.dart:293-294`
- Test: `mobile/test/presentation/pages/space_detail_top_sliver_test.dart` (or extend an existing space-detail test if present)

- [ ] **Step 1: Write the failing test** — pump `SpaceDetailPage` (or the extracted `_SpaceTopSliver`) with `spaceAlbumsProvider` overridden to 1 album and a member role of editor; assert the shelf (`Key('space-albums-shelf')`) is present above the timeline. Also a viewer-role + empty case asserting the shelf is absent.

- [ ] **Step 2: Run; verify FAIL.**

- [ ] **Step 3: Build `SpaceTopSliver`** — a sliver that renders the `SyncStatusBannerSliver` content stacked above `SpaceAlbumsShelf` (e.g. a `SliverMainAxisGroup` or a single `SliverToBoxAdapter` column). Compute the combined `topSliverWidgetHeight` = banner height (when syncing) + shelf height (when the shelf is visible for this role/count). Replace lines 293-294:

```dart
        topSliverWidget: SpaceTopSliver(
          spaceId: widget.spaceId,
          canEdit: _canEdit,
          onLinkTap: _openLinkPicker,   // wired in B5; for B2 use a no-op / TODO stub that B5 replaces
          onAlbumTap: (albumId) {},      // wired in B4
        ),
        topSliverWidgetHeight: _topSliverHeight(isRemoteSyncing: isRemoteSyncing),
```

> For B2, `onLinkTap`/`onAlbumTap` may be empty closures (the routes land in B4/B5). Do NOT implement those routes here. Keep the shelf interactive shell only.
> `_topSliverHeight` sums the banner height (existing helper) + a shelf height constant (e.g. `kSpaceAlbumsShelfHeight`) when `_canEdit || hasLinkedAlbums`. Because the shelf height depends on async album data, prefer making the shelf itself size-stable (fixed height when visible, 0 when the viewer-empty case) and read a synchronous "has any linked albums or canEdit" hint — or accept a fixed reserved height when `_canEdit` (the common case) and document the viewer-empty trade-off. Confirm the cleanest approach against how `syncBannerTopSliverHeight` is consumed by `Timeline`'s scrubber-offset math.

- [ ] **Step 4: Run; verify PASS.** Commit: `git commit -am "feat(mobile): mount Albums shelf as a combined top sliver on SpaceDetailPage"`

---

## Task 5: Slice gate

- [ ] **Step 1:** `mise analyze 2>&1 | tail -20` — clean (watch `withOpacity`, unawaited futures, dead null-aware).
- [ ] **Step 2:** Run all B2 test files — all PASS.
- [ ] **Step 3:** Commit any fixes.

---

## Self-Review

**Spec coverage (§10.3 B2):** renders linked albums (Task 3) ✓; three visibility cases (Task 3 — count>0/editor-empty/viewer-empty) ✓; off-timeline dim+⊘ (Task 3) ✓; cover-not-synced fallback (Task 3) ✓; banner+shelf composition (Task 4) ✓.

**Placeholders:** the empty `onLinkTap`/`onAlbumTap` closures are deliberate inter-slice seams (B4 wires album tap, B5 wires the link picker) — explicitly scoped, not deferred B2 work. Everything else is concrete.

**Type consistency:** `SpaceAlbum` (id/name/thumbnailAssetId/showInTimeline), `spaceAlbumsProvider`, `SpaceAlbumsShelf`, `SpaceTopSliver` used consistently.

## Open items (confirm during execution)

- The exact `Drift` provider name to construct `SpaceAlbumRepository` (Task 2) — match the other infrastructure providers.
- Whether the repo already has a base-class/provider convention (B0 made `SpaceAlbumRepository` extend `DriftDatabaseRepository`) — reuse it.
- The combined top-sliver height strategy (Task 4 Step 3) vs `Timeline`'s scrubber-offset math — pick the size-stable approach and note any trade-off in a code comment.
- Widget-test image handling — assert via Keys/icons, not rendered image bytes.
