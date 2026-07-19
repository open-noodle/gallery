# Space Albums Phase 1.6 — Linked-Album Live Sync + In-Space Photo Viewer

**Date:** 2026-06-14
**Status:** Design — ready for implementation
**Feature area:** Shared Spaces → Space Albums
**Lineage:** Follows `2026-06-09-space-albums-design.md` (Phase 1), `2026-06-12-space-albums-phase-1.5-in-space-experience-design.md` (Phase 1.5 web). Predates and is independent of Phase 2 (mobile / offline sync delivery).

---

## 1. Summary

Linking an album to a shared space works in Phase 1, but two lifecycle holes were never specced — they fall between Phase 1 (link / unlink) and Phase 2 (mobile offline sync):

- **Bug 1 — people don't sync when a linked album's contents change.** Phase 1 syncs faces/people only at two moments: _link time_ (`SharedSpaceAlbumFaceSync` fired from `linkAlbum`) and _unlink time_ (orphan cleanup). Adding or removing individual photos in an _already-linked_ album does nothing — the people from added photos never appear in the space, and people from removed photos linger.
- **Bug 2 — opening a photo inside a space album 404s.** The in-space album grid navigates to `/spaces/:spaceId/albums/:albumId/photos/:assetId`, but that route was never built. Phase 1.5 said only "opening photos in the standard asset viewer" without specifying the route.

This design completes the in-space album experience in **three independently-implementable slices**:

- **Slice 1 (Section A) — Immediate add/remove sync.** When photos are added to or removed from a linked album, fan out face/people sync (add) and orphan cleanup (remove) across every face-recognition-enabled space the album is linked to. Event-driven: `album.service` emits, `shared-space.service` handles.
- **Slice 2 (Section B) — In-space album photo viewer.** Relocate the album detail page into the optional `[[photos=photos]]/[[assetId=id]]` route (mirroring the space-root and global-album trees) so the existing `TimelineAssetViewer` opens in place. No new viewer code.
- **Slice 3 (Section C) — Late-detection backfill covers the album path.** Extend `getSpaceIdsForAsset` with an album-linked branch so that photos added _before_ their faces are detected still sync once detection lands. One query change fixes every backfill consumer.

Slices A and C are complementary halves of the add lifecycle: **A** covers already-processed photos (immediate match), **C** covers not-yet-detected photos (deferred match via the existing post-detection backfill). Both converge on the same idempotent `processSpaceFaceMatch`, so there is no double-sync hazard.

The three slices are independent and may be implemented in any order or in parallel by `/impl-loop` (Slice 1 = Section A, Slice 2 = Section B, Slice 3 = Section C). Slices 1 and 3 are both backend people-sync and share test files, so grouping them is natural; Slice 2 is self-contained frontend.

---

## 2. Method & conventions (applies to every slice)

### 2.1 TDD is mandatory

Every slice follows strict red-green-refactor using the `superpowers:test-driven-development` discipline:

1. **RED** — write the failing test(s) listed in the slice's "Test plan" _first_. Run them; confirm they fail for the right reason (assertion failure / 404 / missing rows — not a typo or import error).
2. **GREEN** — write the minimum implementation to make them pass.
3. **REFACTOR** — clean up while keeping tests green.
4. **Verify** — run the slice's full command set (below) and confirm green before claiming the slice done (`superpowers:verification-before-completion`).

Do not write implementation code for a behavior before its failing test exists. Each slice lists its tests explicitly so the RED step is unambiguous.

### 2.2 Commands

```bash
# Server unit tests (vitest, auto-mocked repos)
cd server && pnpm test -- --run src/services/album.service.spec.ts
cd server && pnpm test -- --run src/services/shared-space.service.spec.ts

# Server medium tests (real Postgres via testcontainers)
cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-album.service.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts   # if present; else fold into the service medium spec

# SQL docs (only if a @GenerateSql-decorated repository method changes)
cd server && pnpm sql

# Type check
make check-server      # and make check-web for Slice 2

# Web unit / route tests (Slice 2)
cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts"

# E2E (real API + Playwright)
cd e2e && pnpm test       -- --run src/specs/<area>.e2e-spec.ts     # API-level
cd e2e && pnpm test:web   -- spaces-albums.e2e-spec.ts             # Playwright
```

Defer the full per-package `lint` to a single final gate; keep `make check-server` / `make check-web` in the loop (see `feedback_defer_lint_to_end`).

### 2.3 What this work does NOT touch

- **No schema migrations.** All logic reuses existing tables (`shared_space_album`, `album_asset`, `shared_space_asset`, `shared_space_library`, `shared_space_person`, `shared_space_person_face`).
- **No API surface / DTO changes**, therefore **no OpenAPI/SDK regeneration** and no Dart client changes.
- **No mobile changes.** Phase 2 mobile/offline-sync delivery of linked-album edits is explicitly out of scope and unchanged.

### 2.4 Rebase posture

`album.service.ts` and `event.repository.ts` are upstream files. The fork already diverges in `album.service.ts` (it calls `this.sharedSpaceRepository.getSpaceIdsForTimeline`, ~line 128). Slice 1 keeps the upstream footprint minimal and append-only — three `emit` lines in `album.service.ts` and two event-type entries in `event.repository.ts` — with all real sync logic living in the fork-only `shared-space.service.ts`. This is deliberately the smallest, most conflict-resistant seam.

---

## 3. Current-state reference (verified against the tree)

| Concern                                             | Location                                                                                                                                                                      | Note                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Add assets to one album                             | `server/src/services/album.service.ts` `addAssets` (~L207)                                                                                                                    | emits `AlbumUpdate`; no space sync                                                                                                     |
| Add assets to many albums                           | `server/src/services/album.service.ts` `addAssetsToAlbums` (~L239)                                                                                                            | bulk insert at ~L289; no space sync                                                                                                    |
| Remove assets from album                            | `server/src/services/album.service.ts` `removeAssets` (~L299)                                                                                                                 | `removedIds` computed ~L309; no space sync                                                                                             |
| Link album (works)                                  | `server/src/services/shared-space.service.ts` `linkAlbum` (~L634)                                                                                                             | queues `SharedSpaceAlbumFaceSync`                                                                                                      |
| Unlink album (orphan cleanup, works)                | `shared-space.service.ts` `unlinkAlbum` (~L658)                                                                                                                               | `getAlbumAssetIdsWithoutOtherSpacePath` → `removePersonFacesByAssetIds` → `deleteOrphanedPersons` → `queueSpacePersonMetadataBackfill` |
| Direct add-to-space (works)                         | `shared-space.service.ts` `addAssets` (~L568)                                                                                                                                 | `queueAll(SharedSpaceFaceMatch per asset)` for face-enabled space                                                                      |
| Per-asset face match handler                        | `shared-space.service.ts` `handleSharedSpaceFaceMatch` (~L1631)                                                                                                               | calls `processSpaceFaceMatch(spaceId, assetId)`; idempotent                                                                            |
| Spaces linked to album (exists, unused)             | `shared-space.repository.ts` `getSpacesLinkedToAlbum` (~L434)                                                                                                                 | returns `spaceId` + `faceRecognitionEnabled`                                                                                           |
| Album-wide orphan query                             | `shared-space.repository.ts` `getAlbumAssetIdsWithoutOtherSpacePath` (~L1926)                                                                                                 | 3 NOT-EXISTS branches: direct / other-linked-album / library                                                                           |
| Remove faces / orphans / backfill                   | `shared-space.repository.ts` `removePersonFacesByAssetIds` (~L1863), `deleteOrphanedPersons` (~L1969); `shared-space.service.ts` `queueSpacePersonMetadataBackfill` (private) | reused by Slice 1 remove                                                                                                               |
| Spaces-for-asset (backfill fan-out)                 | `shared-space.repository.ts` `getSpaceIdsForAsset` (~L2364)                                                                                                                   | **only direct + library branches — no album branch**                                                                                   |
| Backfill producers (both via `getSpaceIdsForAsset`) | `metadata.service.ts` (~L1105), `person.service.ts` `queueSharedSpaceFaceMatchesForAsset` (~L1088)                                                                            | inherit the Slice 3 fix automatically                                                                                                  |
| In-space album detail page                          | `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/+page.svelte` + `+page.ts`                                                                                        | `<Timeline enableRouting={false}>`; **no `[[photos=photos]]/[[assetId=id]]` child**                                                    |
| Space-root viewer (works, pattern to mirror)        | `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/`                                                                                                    | page sits at the optional-param leaf; `TimelineAssetViewer` renders in `Timeline`                                                      |
| Global-album viewer (works, pattern to mirror)      | `web/src/routes/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/`                                                                                                 | page + `page.route.spec.ts`                                                                                                            |
| Click → URL build                                   | `web/src/lib/components/timeline/Timeline.svelte` `_onClick` (~L653) → `navigate({targetRoute:'current', assetId})`                                                           | builds `<pathname>/photos/<assetId>`                                                                                                   |
| Viewer route detection (generic)                    | `web/src/lib/utils/navigation.ts` `isAssetViewerRoute` (L24)                                                                                                                  | matches any route id ending `/[[assetId=id]]` with an `assetId` param — no whitelist                                                   |
| Space layout data                                   | `web/src/routes/(user)/spaces/[spaceId]/+layout.ts`                                                                                                                           | already loads `space`, `members`, `linkedAlbums`                                                                                       |

Line numbers are indicative and will drift; locate by symbol.

---

## 4. Slice 1 (Section A) — Immediate add/remove people sync

### 4.1 Goal

When assets are added to or removed from an album that is linked to one or more shared spaces, keep each space's people in sync:

- **Add:** for every linked space with `faceRecognitionEnabled = true`, queue a per-asset `SharedSpaceFaceMatch` for each newly-added asset (identical semantics to the direct add-to-space path). People with already-detected faces appear in the space.
- **Remove:** for every linked face-enabled space, remove space-person face assignments for removed assets that retain **no other path** into the space, delete any now-orphaned space-people, and queue the metadata backfill — mirroring `unlinkAlbum` at per-asset granularity.

### 4.2 Approach — event-driven seam

`album.service` (upstream) emits thin events after successful DB mutation; `shared-space.service` (fork) handles them with `@OnEvent`, reusing its existing helpers. Rationale: keeps all space-sync logic (including `queueSpacePersonMetadataBackfill`) cohesive in the fork file, and limits the upstream diff to append-only emit lines.

### 4.3 Changes

**1. New events** — `server/src/repositories/event.repository.ts` (append to the album/asset event block):

```ts
AlbumAssetsAdd: [{ albumId: string; assetIds: string[] }];
AlbumAssetsRemove: [{ albumId: string; assetIds: string[] }];
```

**2. Emit on mutation** — `server/src/services/album.service.ts`:

- `addAssets` (single album): compute the full set of successfully-added asset IDs (`results.filter(r => r.success).map(r => r.id)` — not just `firstNewAssetId`). If non-empty, `await this.eventRepository.emit('AlbumAssetsAdd', { albumId: id, assetIds })`.
- `addAssetsToAlbums` (multi-album): after the bulk insert, group the inserted `albumAssetValues` by `albumId` and emit one `AlbumAssetsAdd` per album with that album's added asset IDs.
- `removeAssets`: after `removedIds` is computed and non-empty, `await this.eventRepository.emit('AlbumAssetsRemove', { albumId: id, assetIds: removedIds })`.

Emit only when there is at least one affected asset (avoid empty-payload events).

**3. New repository method** — `server/src/repositories/shared-space.repository.ts`:

```ts
// Per-asset analogue of getAlbumAssetIdsWithoutOtherSpacePath.
// Called AFTER the album_asset rows for the removed assets have been deleted,
// so "any linked album" already excludes the album they were removed from.
// Returns the subset of assetIds that now have NO path into the space.
@GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
async getAssetIdsWithoutOtherSpacePath(spaceId: string, assetIds: string[]): Promise<string[]>
```

Implementation mirrors `getAlbumAssetIdsWithoutOtherSpacePath` but drives off the passed `assetIds` and keeps three NOT-EXISTS branches scoped to `spaceId`:

- direct: no `shared_space_asset (spaceId, assetId)`;
- album: no `shared_space_album` for `spaceId` joined to `album_asset` on that `assetId` (no album-id exclusion needed — the removed rows are already gone);
- library: no `shared_space_library` for `spaceId` whose library owns the asset.

Return `[]` immediately when `assetIds` is empty.

**4. Event handlers** — `server/src/services/shared-space.service.ts`:

```ts
@OnEvent({ name: 'AlbumAssetsAdd' })
async onAlbumAssetsAdd({ albumId, assetIds }: ArgOf<'AlbumAssetsAdd'>): Promise<void> {
  if (assetIds.length === 0) return;
  const spaces = await this.sharedSpaceRepository.getSpacesLinkedToAlbum(albumId);
  const targets = spaces
    .filter((s) => s.faceRecognitionEnabled)
    .flatMap((s) => assetIds.map((assetId) => ({
      name: JobName.SharedSpaceFaceMatch as const,
      data: { spaceId: s.spaceId, assetId },
    })));
  if (targets.length > 0) await this.jobRepository.queueAll(targets);
}

@OnEvent({ name: 'AlbumAssetsRemove' })
async onAlbumAssetsRemove({ albumId, assetIds }: ArgOf<'AlbumAssetsRemove'>): Promise<void> {
  if (assetIds.length === 0) return;
  const spaces = await this.sharedSpaceRepository.getSpacesLinkedToAlbum(albumId);
  let anyOrphanWork = false;
  for (const s of spaces) {
    if (!s.faceRecognitionEnabled) continue;
    const orphaned = await this.sharedSpaceRepository.getAssetIdsWithoutOtherSpacePath(s.spaceId, assetIds);
    if (orphaned.length === 0) continue;
    await this.sharedSpaceRepository.removePersonFacesByAssetIds(s.spaceId, orphaned);
    await this.sharedSpaceRepository.deleteOrphanedPersons(s.spaceId);
    anyOrphanWork = true;
  }
  if (anyOrphanWork) await this.queueSpacePersonMetadataBackfill();
}
```

(Type each handler's payload to match its event definition — follow the existing `@OnEvent` handlers in the file that consume payloads.)

**Worker routing:** the emit happens on the API worker (HTTP request). Handlers do only DB reads + job enqueues + small deletes — fast enough to run in-process on the API worker; the heavy face matching is offloaded to the `FacialRecognition` queue via the enqueued `SharedSpaceFaceMatch` jobs. Confirm during implementation that the handler actually fires in the emitting process (the medium/e2e tests in 4.5 will prove this end-to-end); only add a `workers:` constraint if routing requires it.

### 4.4 Edge cases (must be covered)

Add:

1. Album linked to a face-enabled space → one `SharedSpaceFaceMatch` per added asset.
2. Album linked to multiple spaces (mixed face on/off) → jobs only for face-enabled spaces.
3. Album linked to a face-**disabled** space only → no jobs.
4. Album linked to **no** space → no jobs (`getSpacesLinkedToAlbum` empty).
5. `addAssetsToAlbums` across multiple albums → correct per-album fan-out; an asset added to two linked albums of the same space yields a job per (space, asset) (deduped harmlessly by the queue / idempotent handler).
6. Re-adding assets already present in the album → only newly-inserted IDs trigger (respect the existing `notPresentAssetIds` filter).
7. Asset already in the space directly → still queued; `processSpaceFaceMatch` is idempotent (skips already-assigned faces) → no duplicate people.
8. Add call with no successful inserts (permission / all duplicates) → no event emitted.

Remove:

9. Removed asset still reachable via a direct `shared_space_asset` row → **not** orphaned, faces retained.
10. Removed asset still in **another** linked album of the same space → retained.
11. Removed asset in a linked **library** of the same space → retained.
12. Removed asset with no remaining path → faces removed; person deleted iff it has no other faces.
13. Removing the album thumbnail asset → existing `updateThumbnails` path still runs; sync is additive.
14. Remove from an album linked to no space, or to face-disabled spaces only → no cleanup.
15. Removed asset that had no faces → cleanup is a no-op (empty `orphaned` / empty face set).
16. Ordering: cleanup runs **after** `album_asset` rows are deleted, so the "any linked album" branch correctly excludes the removed membership.
17. Multiple spaces → each evaluated independently; metadata backfill queued once if any space had orphan work.

Concurrency & visibility (handled by the core guard — documented so implementation does not add redundant guards or regress them):

18. **Stale match after concurrent unlink / removal.** A `SharedSpaceFaceMatch` queued for an added asset may run after the album is unlinked or the asset removed. `processSpaceFaceMatch` early-returns via `isAssetInSpace(spaceId, assetId)` (verified to include the album-link union branch), so no ghost space-person is created once the asset has no remaining space path. The add handler needs **no** extra album-link re-check.
19. **Hidden / archived / deleted / offline assets.** `isAssetInSpace` filters on `deletedAt IS NULL`, `isOffline = false`, and `visibility IN visibleSpaceAssetVisibilities`. Adding such an asset to a linked album therefore surfaces no people (correct — it matches space-timeline visibility); no special handling required.

> **Correctness linchpin:** Slice 1's queued `SharedSpaceFaceMatch` only does work because `processSpaceFaceMatch → isAssetInSpace` already recognises the album path (`shared-space.repository.ts`, third union branch). This is verified present today. Slice 3 fixes the one sibling method (`getSpaceIdsForAsset`) that still lacks the same branch. The Slice 1 medium test below pins this dependency so a future change to `isAssetInSpace` cannot silently no-op album sync.

### 4.5 Test plan (RED first)

**Unit — `server/src/services/album.service.spec.ts`** (auto-mocked repos/event):

- `addAssets` with ≥1 successful insert emits `AlbumAssetsAdd` with `{ albumId, assetIds: <all successful ids> }`.
- `addAssets` with zero successful inserts emits nothing.
- `addAssetsToAlbums` across two albums emits one `AlbumAssetsAdd` per album with the correct per-album asset IDs.
- `removeAssets` with ≥1 removed emits `AlbumAssetsRemove` with `removedIds`; zero removed → no emit.

**Unit — `server/src/services/shared-space.service.spec.ts`**:

- `onAlbumAssetsAdd`: face-enabled space → `queueAll` called with one `SharedSpaceFaceMatch` per (space, asset); face-disabled space filtered out; empty `assetIds` → no call; no linked spaces → no call.
- `onAlbumAssetsRemove`: for a face-enabled space where `getAssetIdsWithoutOtherSpacePath` returns a subset → `removePersonFacesByAssetIds` called with that subset, then `deleteOrphanedPersons`, then `queueSpacePersonMetadataBackfill` once; when it returns `[]` → none of those called; face-disabled space skipped.

**Medium (real DB) — `server/test/medium/specs/services/shared-space-album.service.spec.ts`** (extend the existing file):

- `getAssetIdsWithoutOtherSpacePath` correctness against real rows for each retention branch (direct / other-album / library) and the true-orphan case.
- End-to-end remove: seed space-people for album assets, remove a subset via the handler, assert orphaned faces/people removed and multi-path assets retained.
- **Linchpin regression guard:** `isAssetInSpace(spaceId, assetId)` returns `true` for an asset reachable **only** via a linked album (no direct row, no library). Edge 18 — `processSpaceFaceMatch` returns `[]` (no ghost) for an album asset whose album was unlinked and that has no other space path.

**E2E (real API, truest wiring) — `e2e/src/specs/` (API) and/or `e2e/src/specs/web/spaces-albums.e2e-spec.ts`**:

- Create a face-recognition-enabled space, link an album, add (via the real album add-assets API) a photo whose face is already detected → assert the space's people list includes that person (proves the event → handler → job → match chain).
- Remove that photo from the album → assert the person is gone from the space (no other path).

### 4.6 Acceptance criteria

- Adding already-processed photos to a linked, face-enabled album makes their people appear in the space (across all such linked spaces).
- Removing photos cleans up people that lose their only path, while retaining multi-path people.
- Face-disabled spaces and unlinked albums are unaffected.
- All unit + medium + e2e tests above pass; `make check-server` clean; `pnpm sql` run if `getAssetIdsWithoutOtherSpacePath` carries `@GenerateSql`.

---

## 5. Slice 2 (Section B) — In-space album photo viewer

### 5.1 Goal

Clicking a photo in the in-space album grid opens the asset viewer at `/spaces/:spaceId/albums/:albumId/photos/:assetId` (no more 404), with next/prev scoped to the album and close returning to the album grid. Deep-linking / refresh on that URL works too.

### 5.2 Approach — route relocation only (no new viewer code)

The viewer is already wired: `Timeline._onClick` navigates to `<pathname>/photos/<assetId>`; `isAssetViewerRoute` (navigation.ts:24) matches **any** route id ending `/[[assetId=id]]` generically; and `TimelineAssetViewer` already renders inside `Timeline` when viewing. The only missing piece is the route. Mirror the space-root and global-album trees by moving the album detail page to the optional-param leaf.

### 5.3 Changes — `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/`

1. **Relocate** `+page.svelte` and `+page.ts` into a new `[[photos=photos]]/[[assetId=id]]/` subfolder:
   `…/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte` and `…/+page.ts`.
2. **Simplify the load** (`+page.ts`): drop the redundant `getSpace` / `getMembers` / `getSharedSpaceAlbums` calls — the `[spaceId]` layout already provides `space`, `members`, and `linkedAlbums`. Keep only: validate `params.albumId` against `linkedAlbums` from `parent()` (redirect to `/spaces/:spaceId/albums` if not linked), then `getAlbumInfo`. The extra `[[assetId=id]]` param is ignored by the load (the viewer reads it).
3. **Leave `<Timeline enableRouting={false}>` as-is** to match the proven space-root configuration. `_onClick` navigates regardless of `enableRouting`; the flag only governs scroll-restoration nuances. Revisit only if scroll-to-asset on viewer close is visibly wrong.
4. **Authorization:** rely on the Phase 1 access-predicate album branch — space members can already read linked-album assets (that is why `getAlbumInfo` succeeds for members and the regular global-album viewer authorizes album members). Do **not** pre-thread `spaceId` into the viewer; only add it if the e2e non-owner test (below) shows an asset fetch (detail/original/thumbnail) being denied.

### 5.4 Edge cases (must be covered)

1. Owner clicks a photo → viewer opens, image renders, next/prev cycles within the album, close/Escape/back → album grid.
2. Non-owner member (editor and viewer roles) opens a photo → image renders (authorized via Phase 1 predicate).
3. Direct navigation / refresh on `/spaces/:id/albums/:albumId/photos/:assetId` → grid loads with the viewer open.
4. `assetId` not in the album / invalid → existing viewer not-found behavior (no crash).
5. Album not linked / no access → existing load guard redirects to `/spaces/:id/albums`.
6. Browse mode vs select mode: clicking in browse opens the viewer; clicking while in selection mode toggles selection (preserve current `_onClick`/`onSelect` behavior).
7. Active browse filter → opening then closing a photo preserves the filtered grid (existing Timeline behavior; assert no regression).
8. Back navigation from the viewer returns to the album grid, not the albums list.

### 5.5 Test plan (RED first)

**Web route test — `…/[[photos=photos]]/[[assetId=id]]/page.route.spec.ts`** (mirror the global-album `page.route.spec.ts`):

- Route resolves for both `/spaces/:id/albums/:albumId` and `/spaces/:id/albums/:albumId/photos/:assetId`.
- Load returns `album` (+ inherited `space`/`members` from parent) and redirects when the album is not in `linkedAlbums`.

**Playwright — `e2e/src/specs/web/spaces-albums.e2e-spec.ts`** (extend):

- Open a space album, click a photo → URL becomes `/spaces/:id/albums/:albumId/photos/:assetId` and the asset viewer is visible (no 404).
- Next/prev navigates within the album; the URL's `assetId` updates.
- Close returns to `/spaces/:id/albums/:albumId`.
- A non-owner member can open and see a photo (authorization check; if this fails on an asset fetch, thread `spaceId` and re-test).

### 5.6 Acceptance criteria

- No 404 on the photo URL; the viewer opens in-place from the album grid and via deep link.
- Next/prev stays within the album; close returns to the album grid.
- Owners and non-owner members can both view photos.
- `make check-web` clean; route + Playwright tests pass; existing `spaces-albums.e2e-spec.ts` tests still pass.

---

## 6. Slice 3 (Section C) — Late-detection backfill covers the album path

### 6.1 Goal

Photos added to a linked album **before** their faces are detected must still sync into the space once detection completes. Today they never do, because the post-detection backfill cannot see the album path.

### 6.2 Root cause

`getSpaceIdsForAsset(assetId)` (`shared-space.repository.ts` ~L2364) unions only two branches — direct `shared_space_asset` and linked `shared_space_library` — both filtered to `faceRecognitionEnabled = true`. There is **no album branch**. Both post-detection producers depend on it:

- `metadata.service.ts` (~L1105): queues `SharedSpaceFaceMatchFromBackfill` per returned space when faces are added.
- `person.service.ts` `queueSharedSpaceFaceMatchesForAsset` (~L1088): queues `SharedSpaceFaceMatch` per returned space on identity assignment.

So a fix to this one method propagates to every consumer.

### 6.3 Change

Add a third `union` branch to `getSpaceIdsForAsset` for the album path:

```ts
.union(
  this.db
    .selectFrom('shared_space_album')
    .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
    .innerJoin('shared_space', 'shared_space.id', 'shared_space_album.spaceId')
    .select('shared_space_album.spaceId')
    .where('album_asset.assetId', '=', assetId)
    .where('shared_space.faceRecognitionEnabled', '=', true),
)
```

`union` (not `unionAll`) keeps results de-duplicated when an asset is reachable by more than one path. Run `pnpm sql` afterward (the method is `@GenerateSql`-decorated).

Mirror the existing direct/library branches exactly: they filter only on `faceRecognitionEnabled` (no `deletedAt`/`visibility` predicates — that fine filtering lives in `processSpaceFaceMatch`'s `isAssetInSpace` guard), so the album branch must not add them either.

**Corroboration:** album-path-as-space-membership is already the established norm — `isAssetInSpace` (`shared-space.repository.ts`) and `getAlbumAssetIdsWithoutOtherSpacePath` both carry the album union/branch. `getSpaceIdsForAsset` is the lone sibling that was missed; adding the branch makes the family consistent rather than introducing a new policy.

**Verify-item (do during implementation, record the result):** audit every caller of `getSpaceIdsForAsset` and confirm "include album-linked assets" is the correct semantics for each. Expected yes — the method already filters to `faceRecognitionEnabled` spaces, i.e. it exists solely for face-match fan-out, and an album-linked asset genuinely _is_ in the space.

### 6.4 Edge cases (must be covered)

1. Asset reachable **only** via a linked album (no direct row, no library) → returned.
2. Asset reachable via album **and** direct → returned exactly once.
3. Asset reachable via album **and** library → returned once.
4. Album linked to a face-**disabled** space → **not** returned.
5. Asset in an album that is **not** linked to any space → not returned.
6. Asset with multiple linked albums into the same space → single row for that space.
7. Late face detection on an album-only asset → producer queues a backfill match → people appear in the space (the behavioral payoff).

### 6.5 Test plan (RED first)

**Medium (real DB)** — repository test for `getSpaceIdsForAsset` covering edge cases 1–6 (a face-disabled linked album returns nothing; an album-only asset returns the space; dedup across direct+album).

**Service-level** — extend the existing backfill specs:

- `server/src/services/metadata.service.spec.ts`: an album-only asset in a face-enabled space → `SharedSpaceFaceMatchFromBackfill` queued for that space when faces are added (mirror the existing direct/library cases at ~L1800+).
- `server/src/services/person.service.spec.ts`: identity assignment on an album-only asset → `SharedSpaceFaceMatch` queued for that space (mirror existing cases).

(These two `.spec` files already assert the direct/library fan-out; add the album case alongside, which is the cleanest RED.)

### 6.6 Acceptance criteria

- `getSpaceIdsForAsset` returns face-enabled spaces reachable via the album path, de-duplicated, excluding face-disabled spaces.
- Both backfill producers fan out to album-linked spaces.
- A photo added to a linked album before face detection has its people appear after detection completes.
- Medium + service tests pass; `pnpm sql` run and committed; `make check-server` clean.

---

## 7. Cross-cutting verification

After all three slices:

- `make check-server` and `make check-web` clean.
- `cd server && pnpm sql` produces no uncommitted diff.
- Manual smoke against `make dev`: face-enabled space + linked album → add already-processed photos (people appear), add a fresh photo then let detection run (people appear), remove a photo unique to the album (person leaves), open a photo (viewer works for owner and a non-owner member).
- Single final `lint` gate across touched packages.

## 8. Open questions / explicit deferrals

- **Worker routing for the Slice 1 events** — resolved by test (the e2e proves the chain fires); constrain `workers:` only if needed.
- **Threading `spaceId` into the Slice 2 viewer** — deferred unless the non-owner e2e shows a denied asset fetch.
- **Phase 2 mobile/offline-sync delivery** of linked-album edits — out of scope; unchanged.
- **Bulk-add overload** — large multi-asset adds already flow through `queueAll`; if a future album-link targets very large albums, reuse the existing paged `SharedSpaceFaceMatchAll`/`Page` machinery. Not required here.
