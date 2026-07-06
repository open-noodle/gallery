# Space Albums — Review-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Slices are independent — implement in any order; the numbering is by risk.

**Goal:** Fix the verified defects from the space-albums review (spec: `docs/superpowers/specs/2026-06-25-space-albums-review-fixes-design.md`) — trashed-album read leak, multi-path face cleanup, in-space read surfaces for people/tags/folders/memories/search, summary-count consistency, the web stale-timeline bug, the mobile double-link bug, plus test backfills. (Slice 5, a Phase-2 grant backfill migration, was dropped as unnecessary — see that section.)

**Architecture:** Each slice pins behavior with a failing test, then makes the minimal change. The server fixes are SQL-predicate and service-method edits mirroring the existing `shared_space_library` branch / `unlinkAlbum` cleanup. One new server-internal event (`AlbumDelete`) and one new fork migration. No API/DTO/endpoint/OpenAPI/SDK changes.

**Tech Stack:** NestJS 11 + Kysely (server), SvelteKit/Svelte 5 (web), Flutter/Riverpod/Drift (mobile), Vitest (server/web), Playwright (e2e).

## Global Constraints

- **Toolchain:** `make check-server` / `make lint-server` (tsc + eslint, `--max-warnings 0`); server unit `cd server && pnpm test -- --run <path>`; server medium (real DB via testcontainers, needs Docker) `cd server && pnpm test:medium -- --run <path>`; web `cd web && pnpm test -- --run <path>`; mobile `mise analyze` + (CI-verified) `cd mobile && mise exec -- flutter test <path>`. Do **not** invoke bare `vitest`.
- **NO OpenAPI regen.** No slice changes the API surface — do not run `mise //:open-api`.
- **Server imports:** no relative imports — use the `src/` alias. Strict TS. `no-floating-promises` / `no-misused-promises` enforced (`await` or `void` every promise).
- **Every album read/timeline/count/count-suggestion SQL branch MUST filter `album.deletedAt is null`** (the A1 invariant). New branches added in Slices 2/6 include it from the start.
- **Clone source for every predicate change:** the adjacent `shared_space_library` branch in the same method. For face cleanup: `unlinkAlbum` (`shared-space.service.ts:667-683`) and `onAlbumAssetsRemove` (`:2801-2827`).
- Local mobile verification is unreliable in this worktree (toolchain version skew) — rely on CI `static_analysis` / `Unit-Test-Mobile` for Slice 8; still run `mise analyze` on touched files.

---

## Slice 1: Trashed album fully excluded from read / timeline / count (A1)

**Files:**

- Modify: `server/src/repositories/access.repository.ts:305`, `:375`
- Modify: `server/src/repositories/asset.repository.ts:320`, `:360`, `:1385`, `:1423`
- Modify: `server/src/repositories/map.repository.ts:129`, `:175`
- Modify: `server/src/utils/database.ts:630`, `:657`
- Modify: `server/src/repositories/shared-space.repository.ts:262` (getAssetCount)
- Test: `server/test/medium/specs/shared-space-album-permissions.spec.ts` (extend) and `server/src/repositories/shared-space-album.repository.spec.ts` (extend, for the count)

**Interfaces:**

- Consumes: existing album read branches (each innerJoins `shared_space_album` → `album_asset` → `asset`).
- Produces: no signature changes — same methods, stricter predicate.

**The canonical patch** (apply to each occurrence): the branch currently looks like

```ts
.selectFrom('shared_space_album')
.innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
.innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
.innerJoin('asset', (join) => join.onRef('asset.id', '=', 'album_asset.assetId').on('asset.deletedAt', 'is', null))
```

Add a non-deleted `album` join immediately after the `shared_space_album` selectFrom:

```ts
.innerJoin('album', (join) =>
  join.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
)
```

For `getAssetCount` (`shared-space.repository.ts:262`) the album union has no member join; add the same `album` join there too.

- [ ] **Step 1: Write the failing medium test** in `shared-space-album-permissions.spec.ts`. Using the existing fixture-world helpers (space `S` links album `A`, member `spaceViewer`): soft-delete `A` (`UPDATE album SET "deletedAt" = now() WHERE id = A`), then assert `access.asset.checkSpaceAccess(spaceViewer, {assetInA})` returns an **empty** set, and `access.asset.checkSpaceAccessForSpace(spaceViewer, S, {assetInA})` returns empty. Add a second assertion: `sharedSpaceRepository.getAssetCount(S)` excludes `A`'s assets after soft-delete.
- [ ] **Step 2: Run; verify FAIL** (member still reads / count still includes). Run: `cd server && pnpm test:medium -- --run test/medium/specs/shared-space-album-permissions.spec.ts`
- [ ] **Step 3: Apply the canonical `album` join** to all 11 occurrences listed in Files. Grep to confirm none missed: `grep -rn "selectFrom('shared_space_album')" server/src/repositories server/src/utils/database.ts` — every hit that further joins `album_asset` for a **read/timeline/count** must carry the non-deleted `album` join. **Exclude** link-CRUD (`shared-space.repository.ts:427,448,459`), the orphan-path helpers (`:1957,2006`), face/person queries (`:2289,2332,2444`), and `sync.repository.ts:1114` (already filters `album.deletedAt` — verify and leave).
- [ ] **Step 4: Run; verify PASS.** Then run the full existing album permission + access suites to confirm no regression: `cd server && pnpm test:medium -- --run test/medium/specs/shared-space-album-permissions.spec.ts` and `pnpm test -- --run src/repositories/shared-space-album.repository.spec.ts`.
- [ ] **Step 5: `make check-server`; commit.** `fix(spaces): exclude soft-deleted albums from space asset read/timeline/count`

---

## Slice 2: In-space read surfaces for people / tags / folders / memories / search (B1, B2)

**Files:**

- Modify: `server/src/repositories/access.repository.ts:677-721` (person, member-scoped)
- Modify: `server/src/repositories/tag.repository.ts:104` (member-scoped)
- Modify: `server/src/repositories/view-repository.ts:69` (member-scoped)
- Modify: `server/src/repositories/memory.repository.ts:86` (member-scoped)
- Modify: `server/src/repositories/search.repository.ts:1110,1129,1210,1234,1253` (space-scoped)
- Test: the matching `*.spec.ts` for each repository (extend); add an album-linked case to each.

**Interfaces:**

- Consumes: each method's existing `shared_space_library` EXISTS branch.
- Produces: an additional album EXISTS branch in the same `eb.or([...])` / boolean position. No signature changes.

**Two branch shapes** (mirror whichever the adjacent library branch uses in that file):

_Member-scoped_ (person/tag/view/memory — the library branch joins `shared_space_member` and filters `userId`):

```ts
eb.exists(
  eb
    .selectFrom('shared_space_album')
    .innerJoin('album', (j) => j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null))
    .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
    .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
    .whereRef('album_asset.assetId', '=', 'asset.id')
    .where('shared_space_member.userId', '=', userId),
);
```

_Space-scoped_ (search — the library branch filters `shared_space_library.spaceId`):

```ts
eb.exists(
  eb
    .selectFrom('shared_space_album')
    .innerJoin('album', (j) => j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null))
    .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
    .whereRef('album_asset.assetId', '=', 'asset.id')
    .where('shared_space_album.spaceId', '=', asUuid(options!.spaceId!)), // or anyUuid(options!.timelineSpaceIds!) — match the sibling library branch
);
```

Do one task per surface so each ships with its own test:

### Task 2a: Person read (`access.repository.ts:677-721`)

- [ ] **Step 1: Failing test** — in `access.repository.spec.ts` (or the person-access medium spec), seed a person whose only visible face is on an asset that is _only_ in album `A` linked to space `S`; assert `access.person.checkSharedSpaceAccess(spaceMember, {personId})` returns the person. (RED: empty set.)
- [ ] **Step 2: Run; verify FAIL.**
- [ ] **Step 3:** add the member-scoped album branch into the `eb.or([...])` at `:699-716`, alongside the existing `shared_space_asset` / `shared_space_library` branches (join `album_asset.assetId = asset.id`).
- [ ] **Step 4: Run; verify PASS.** Commit `fix(spaces): album-linked faces readable by space members (PersonRead)`

### Task 2b: Tag explorer (`tag.repository.ts:104`)

- [ ] **Step 1: Failing test** in `tag.repository.spec.ts`: a tag present only on an album-linked asset appears in a space member's `ownedOrSpaceAccessible` tag set. RED.
- [ ] **Step 2: FAIL.** **Step 3:** add the member-scoped album branch. **Step 4: PASS;** commit `fix(spaces): album-linked tags visible in space`.

### Task 2c: Folder/view explorer (`view-repository.ts:69`)

- [ ] **Step 1: Failing test** in the view-repository spec: a folder for an album-only asset shows for a space member. **Steps 2-4** as above; commit `fix(spaces): album-linked folders visible in space`.

### Task 2d: Memory (`memory.repository.ts:86`)

- [ ] **Step 1: Failing test** in `memory.service.spec.ts` / repo spec: a memory built from an album-only asset is visible to a space member. **Steps 2-4;** commit `fix(spaces): album-linked memories visible in space`.

### Task 2e: Search suggestions (`search.repository.ts:1110,1129,1210,1234,1253`)

- [ ] **Step 1: Failing test** in `search.repository.spec.ts`: a space-scoped suggestion query (e.g. `getAccessibleTags` / `applySuggestionScope`) surfaces a tag/city/camera that exists only on an album-linked asset. RED.
- [ ] **Step 2: FAIL. Step 3:** add the **space-scoped** album branch to **all 5** occurrences (match each sibling's `spaceId` vs `timelineSpaceIds` scoping). **Step 4: PASS;** commit `fix(spaces): album-linked assets feed in-space search filters`.

- [ ] **Slice gate:** `make check-server`; run all five touched specs green.

---

## Slice 3: Multi-path face cleanup on direct-asset removal (A2)

**Files:**

- Modify: `server/src/services/shared-space.service.ts:780-782` (`removeAssets`)
- Test: `server/test/medium/specs/shared-space-album.service.spec.ts` (extend; multi-path harness already present ~`:138-245`)

**Interfaces:**

- Consumes: `sharedSpaceRepository.getAssetIdsWithoutOtherSpacePath(spaceId, assetIds): Promise<string[]>` (`:1984`, already called by `onAlbumAssetsRemove`).
- Produces: no signature change to `removeAssets`.

- [ ] **Step 1: Write the failing medium test.** Recognition-enabled space `S`; asset `X` is **both** direct-added to `S` **and** in linked album `A`; a space person has a face on `X`. Call `service.removeAssets(editorAuth, S, { assetIds: [X] })`. Assert the space person's face on `X` is **retained** (still has the album path). Add a control: asset `Y` direct-only → its face **is** removed.
- [ ] **Step 2: Run; verify FAIL** (face on `X` wrongly removed). Run: `cd server && pnpm test:medium -- --run test/medium/specs/shared-space-album.service.spec.ts`
- [ ] **Step 3: Implement.** Replace the unconditional tail at `:780-782`:

```ts
const orphanedAssetIds = await this.sharedSpaceRepository.getAssetIdsWithoutOtherSpacePath(spaceId, dto.assetIds);
if (orphanedAssetIds.length > 0) {
  await this.sharedSpaceRepository.removePersonFacesByAssetIds(spaceId, orphanedAssetIds);
  await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
  await this.queueSpacePersonMetadataBackfill();
}
```

(The `shared_space_asset` row was already deleted at `:760`, so `getAssetIdsWithoutOtherSpacePath` correctly sees the direct path gone — same precondition the `:1980` comment documents.)

- [ ] **Step 4: Run; verify PASS.** **Step 5:** `make check-server`; commit `fix(spaces): keep faces for direct-removed assets that survive via a linked album/library`.

---

## Slice 4: Album delete → space face cleanup (A3)

**Files:**

- Modify: `server/src/repositories/event.repository.ts:44` (add `AlbumDelete` to the event map)
- Modify: `server/src/services/album.service.ts:192-195` (`delete()` emits the event)
- Modify: `server/src/services/shared-space.service.ts` (new `onAlbumDelete` handler, next to `onAlbumAssetsRemove` ~`:2801`)
- Test: `server/test/medium/specs/shared-space-album.service.spec.ts` (extend)

**Interfaces:**

- Consumes: `sharedSpaceRepository.getSpacesLinkedToAlbum(albumId)` (`:446`), `getAlbumAssetIdsWithoutOtherSpacePath(spaceId, albumId)` (`:1938` — the album-excluding helper `unlinkAlbum` uses), `removePersonFacesByAssetIds`, `deleteOrphanedPersons`, `queueSpacePersonMetadataBackfill`.
- Produces: server-internal event `AlbumDelete: [{ albumId: string }]`. No API/OpenAPI impact.

- [ ] **Step 1: Confirm emit is synchronous.** Verify `eventRepository.emit` awaits its handlers in-process (it does for `AlbumAssetsAdd/Remove`). The handler must run **before** `albumRepository.delete()` so `album_asset` rows still exist for `getAlbumAssetIdsWithoutOtherSpacePath`. If emit is _not_ synchronous, instead compute the orphan set in `album.service.delete` before the delete and pass it on the event payload.
- [ ] **Step 2: Write the failing medium test.** Recognition-enabled space `S` links album `A`; asset `X` is album-only in `A` with a space-person face; asset `Z` is in `A` **and** direct-added to `S`. Call `albumService.delete(albumOwnerAuth, A)`. Assert: the face on `X` is **removed** (album path gone, no other path) and `deleteOrphanedPersons` ran; the face on `Z` is **retained** (direct path survives). Drive the real `albumService.delete()` (not raw SQL).
- [ ] **Step 3: Run; verify FAIL** (no cleanup today). Run: `cd server && pnpm test:medium -- --run test/medium/specs/shared-space-album.service.spec.ts`
- [ ] **Step 4: Add the event.** In `event.repository.ts` near `:44`:

```ts
AlbumDelete: [{ albumId: string }];
```

- [ ] **Step 5: Emit from `album.service.delete()`** (`:192-195`):

```ts
async delete(auth: AuthDto, id: string): Promise<void> {
  await this.requireAccess({ auth, permission: Permission.AlbumDelete, ids: [id] });
  await this.eventRepository.emit('AlbumDelete', { albumId: id });
  await this.albumRepository.delete(id);
}
```

- [ ] **Step 6: Add the handler** in `shared-space.service.ts` beside `onAlbumAssetsRemove`:

```ts
@OnEvent({ name: 'AlbumDelete' })
async onAlbumDelete({ albumId }: ArgOf<'AlbumDelete'>): Promise<void> {
  try {
    const spaces = await this.sharedSpaceRepository.getSpacesLinkedToAlbum(albumId);
    let anyOrphanWork = false;
    for (const space of spaces) {
      if (!space.faceRecognitionEnabled) {
        continue;
      }
      const orphaned = await this.sharedSpaceRepository.getAlbumAssetIdsWithoutOtherSpacePath(space.spaceId, albumId);
      if (orphaned.length === 0) {
        continue;
      }
      await this.sharedSpaceRepository.removePersonFacesByAssetIds(space.spaceId, orphaned);
      await this.sharedSpaceRepository.deleteOrphanedPersons(space.spaceId);
      anyOrphanWork = true;
    }
    if (anyOrphanWork) {
      await this.queueSpacePersonMetadataBackfill();
    }
  } catch (error) {
    this.logger.error(`Failed to sync space people after deleting album ${albumId}: ${error}`);
  }
}
```

- [ ] **Step 7: Run; verify PASS.** **Step 8:** `make check-server` (watch `no-floating-promises` on the emit); commit `fix(spaces): clean up space faces when a linked album is deleted`.

---

## Slice 5: Phase-2 grant backfill migration (C1) — DROPPED (not needed)

**Not implemented.** Orphan `shared_space_album_user` grants can only exist if `shared_space_album`
rows were created on a database **before** the `1779100000000` create-side triggers were applied to
it — i.e. a staged Phase-1-then-Phase-2 deploy. This feature ships as one unit (table + triggers in
the same release, never released at a Phase-1-only state), so the triggers always exist before any
album can be linked → every link/join is granted → no orphans, and a backfill migration would always
insert 0 rows. The library blueprint's backfill exists only because `library_user` was added to an
already-deployed library feature with pre-existing rows; albums have no such history. C1 is a non-issue;
no migration is shipped.

---

## Slice 6: Space summary-count consistency (C2)

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts:490` (`getRecentAssets`), `:538` (`getNewAssetCount`)
- Test: `server/src/repositories/shared-space-album.repository.spec.ts` (extend)

**Interfaces:** no signature changes — both gain a `.union(...)` album branch matching `getAssetCount`.

- [ ] **Step 1: Write the failing test.** Space `S` links album `A` with 3 image assets and **no** direct/library assets. Assert `getRecentAssets(S)` returns up to 3 album assets (currently empty) and `getNewAssetCount(S, epoch)` returns 3 (currently 0). Add the consistency assertion: `getAssetCount(S) === getNewAssetCount(S, epoch)` for this album-only fixture.
- [ ] **Step 2: Run; verify FAIL.** Run: `cd server && pnpm test -- --run src/repositories/shared-space-album.repository.spec.ts`
- [ ] **Step 3: Add the album union to `getRecentAssets`** after the library union (`:514`), selecting `['asset.id', 'asset.thumbhash', 'asset.fileCreatedAt']`, filtering `album.deletedAt is null`, `asset.deletedAt is null`, `isOffline = false`, `type = Image`, `visibility in visibleSpaceAssetVisibilities`, `thumbhash is not null`:

```ts
.union(
  this.db
    .selectFrom('shared_space_album')
    .innerJoin('album', (j) => j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null))
    .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
    .innerJoin('asset', 'asset.id', 'album_asset.assetId')
    .select(['asset.id', 'asset.thumbhash', 'asset.fileCreatedAt'])
    .where('shared_space_album.spaceId', '=', spaceId)
    .where('asset.deletedAt', 'is', null)
    .where('asset.isOffline', '=', false)
    .where('asset.type', '=', AssetType.Image)
    .where('asset.visibility', 'in', visibleSpaceAssetVisibilities)
    .where('asset.thumbhash', 'is not', null),
)
```

- [ ] **Step 4: Add the album union to `getNewAssetCount`** after the library union (`:559`), selecting `'asset.id'` and keying recency off `asset.createdAt > since` (match the library branch at `:556`), with the same `album.deletedAt` + visibility filters.
- [ ] **Step 5: Run; verify PASS.** **Step 6:** `make check-server`; commit `fix(spaces): include linked-album assets in space recent-assets and new-count`.

> Note for reviewers: `getAssetCount`/`getRecentAssets`/`getNewAssetCount` now all include album assets regardless of `showInTimeline` (consistent). Gating the headline count on `showInTimeline` is a deferred product decision (see spec "Decisions").

---

## Slice 7: Web — refresh in-space album detail timeline after add/remove (D1)

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte:130-159`
- Test: `web/.../mock-timeline.test-wrapper.svelte` is a mock; add a real-timeline assertion to the existing `space-album-detail-page.spec.ts` **or** extend the Playwright journey `e2e/src/specs/web/spaces-albums-journey.e2e-spec.ts` (the unit test mocks `Timeline`, so the regression is only observable with a real timeline manager / browser).

**Interfaces:**

- Consumes: `timelineManager.removeAssets(ids: string[])` and `timelineManager.upsertAssets(assets)` — the same calls the global album page makes at `web/src/routes/(user)/albums/[albumId]/+page.svelte:191,196`.

- [ ] **Step 1: Write the failing test.** In the Playwright journey (real browser), as an Editor: open an in-space linked album, remove a selected photo → assert the grid no longer shows it **without a reload**; add a photo via the picker → assert it appears. (RED: stale grid until hard navigation.)
- [ ] **Step 2: Run; verify FAIL.** Run: `make e2e-web-dev` (against a running `make dev` stack) or the journey spec directly.
- [ ] **Step 3: Implement.** In `handleRemoveAssets`, call `timelineManager?.removeAssets(assetIds)` before clearing selection. In `handleAddAssetsSuccess`, either `timelineManager?.upsertAssets(addedAssets)` (if the added asset objects are available) or trigger a real reload (the global page uses `navigate(..., { forceNavigate: true })` — `updateOptions` alone no-ops on deep-equal). Mirror `albums/[albumId]/+page.svelte:170-178,191,196,423-431`.
- [ ] **Step 4: Run; verify PASS.** **Step 5:** `make check-web` + `make lint-web`; commit `fix(spaces/web): refresh in-space album timeline after add/remove`.

---

## Slice 8: Mobile — stop the link picker double-firing (D2)

**Files:**

- Modify: `mobile/lib/pages/library/spaces/space_detail.page.dart:241-257` (`_openLinkPicker`) **or** `mobile/lib/pages/library/spaces/space_link_album.page.dart:75-85` (`confirm`)
- Test: `mobile/test/.../space_albums_link_wiring_test.dart` (extend to count link invocations end-to-end)

**Interfaces:** `SpaceAlbumActions.link(...)` must run **once** per selected album per confirm.

- [ ] **Step 1: Write the failing widget test.** Drive `_openLinkPicker` → confirm with 2 selected albums; assert `SpaceAlbumActions.link` (or the underlying `linkAlbum` repo call) is invoked **exactly twice total** (once per album), not four times, and the success toast shows once. (RED: double.)
- [ ] **Step 2: Run; verify FAIL** (CI or `cd mobile && mise exec -- flutter test test/.../space_albums_link_wiring_test.dart`).
- [ ] **Step 3: Implement — pick one path.** Either (a) in the picker `confirm()`, drop the `onAlbumsPicked(ids)` call and rely solely on `context.maybePop(ids)` + the awaited result in `_openLinkPicker`; **or** (b) keep `onAlbumsPicked` as the sole handler and remove the `await _onAlbumsPicked(picked)` after the await in `_openLinkPicker`. Prefer (a) (single return-value path); ensure the list-page entry (`SpaceAlbumsRoute(onLink: _openLinkPicker)`) goes through the same single path.
- [ ] **Step 4: Run; verify PASS.** **Step 5:** `mise analyze` clean on touched files; commit `fix(spaces/mobile): link album once from the picker (no double-link/toast)`.

---

## Slice 9: Test backfill — trigger/sync invariants (E1, E2, E3)

**Files:**

- Modify: `server/test/medium/specs/sync/shared-space-album-delete-triggers.spec.ts` (E1)
- Modify: `server/test/medium/specs/sync/shared-space-album-create-triggers.spec.ts` or the delete spec (E2)
- Modify: `server/test/medium/specs/sync/sync-shared-space-album.spec.ts` (E3)

**No production change** — these pin already-correct behavior the review found untested.

- [ ] **Step 1 (E1): member-leave preserves a manual `album_user` share.** Add a case: member `M` of space `S` (links `A`) **also** holds an `album_user` row on `A`. `M` leaves `S`. Assert the `shared_space_album_user` grant is removed **but** the `album_user` row is untouched (mirror the existing unlink-path test at `delete-triggers.spec.ts:85-113`). Run; expect PASS (behavior is correct) — this guards the separate-table invariant for the leave path.
- [ ] **Step 2 (E2): concurrency-race documentation test.** Add an annotated test pinning the member-insert + album-link race (the same low-probability hazard the library suite documents). Annotate it as documentation (not a fix). Run; PASS.
- [ ] **Step 3 (E3): `getUpserts` post-grant re-delivery, asserted independently.** After a link bumps `album.updateId`, assert `SharedSpaceAlbumSync.getUpserts` returns the album metadata for the newly-granted member **directly** (not via the `getCreatedAfter` stream), so the re-delivery can't be masked.
- [ ] **Step 4:** Run the three specs green: `cd server && pnpm test:medium -- --run test/medium/specs/sync/`. Commit `test(spaces): pin member-leave album_user invariant, link race, getUpserts re-delivery`.

> Also reconcile the **album hard-delete "no audit emitted"** discrepancy noted in review (`shared-space-album-delete-triggers.spec.ts:240` asserts `linkAudit.length >= 1`, the design says "no audit"). Confirm the actual trigger behavior against the spec wording and make the assertion match reality (one-line fix, fold into Step 1's commit).

---

## Deferred (flagged, not scheduled)

- `albumId` route params unvalidated → malformed id 500s (`shared-space.controller.ts:609,624,637`) — add a UUID pipe.
- Mobile: hardcoded English strings (route through `.t(context:)`); icon-only album covers (wire the real thumbnail); detail query filters `visibility==timeline` (decide "all photos" vs timeline).
- Web polish: picker empty-state, sequential per-album link calls, `gray-*` vs `@immich/ui` tokens.
- `AssetUpdate` has no album branch (`access.repository.ts:408-460`) — likely intentional; confirm as a product decision.

---

## Self-Review

**Spec coverage:** A1→S1, A2→S3, A3→S4, B1→S2a, B2→S2b-e, C1→dropped (not needed), C2→S6, D1→S7, D2→S8, E1/E2/E3→S9. (Slice 10, added later, folds in the face-pipeline album leg — `getSharedSpaceFaceMatchBackfillTargets` + the `timeline_spaces` face projections.)

**Placeholder scan:** production code shown for S1 (canonical join), S3, S4 (event + handler), S5 (full migration), S6 (full union). S2 gives both branch shapes + per-surface tasks. S7/S8 reference exact clone-source lines (web global-album page; mobile picker) — client changes are described against verified line refs per house style.

**Type consistency:** `AlbumDelete` event payload `{ albumId: string }` is consistent across `event.repository.ts`, the `emit` call, and `ArgOf<'AlbumDelete'>` in the handler. `getAlbumAssetIdsWithoutOtherSpacePath(spaceId, albumId)` (S4, album-delete, excludes the album) vs `getAssetIdsWithoutOtherSpacePath(spaceId, assetIds)` (S3, direct-removal, post-delete) are used in their correct contexts.

## Open items

- S4 Step 1: confirm `eventRepository.emit` awaits handlers synchronously; if not, capture the orphan set in `album.service.delete` before the row delete and carry it on the payload.
- S7: whether `addedAssets` objects are available in `handleAddAssetsSuccess` for `upsertAssets`, else use the `forceNavigate` reload path.
