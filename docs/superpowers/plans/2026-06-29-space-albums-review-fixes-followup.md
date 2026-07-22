# Space Albums — Review-Fix Follow-up Implementation Plan

> **For `/impl-loop` (and agentic workers):** This is the brainstormed spec with **numbered,
> TDD-first, ordered, self-contained slices**. Design rationale + edge-case catalogue live in
> `docs/superpowers/specs/2026-06-29-space-albums-review-fixes-followup-design.md`. Each slice: write
> the named failing test(s) FIRST (RED), then the minimal implementation (GREEN), then the slice
> gate. Steps use checkbox (`- [ ]`) syntax. Slices are sequenced by dependency/risk; implement in
> order. `REQUIRED SUB-SKILL`: `superpowers:test-driven-development` for every slice;
> `superpowers:subagent-driven-development` to execute.

**Goal:** Fix every finding from the three post-#726 reviews of `feat/space-albums` @ `5f0076cd6e`
(RBAC `sa-rbac-k7`, server-faces `sa-faces-m3`, mobile `sa-mobile-p2`) — the people-projection
ship-blocker, owner-account/soft-delete/asset-delete face cleanup, sync-stream + `user_has_album_path`

- route-param consistency, and the mobile add-photos/link-picker/polish gaps. Product-only items
  (faces F6, RBAC F4/F5) are noted, not implemented.

**Architecture:** Server fixes are Kysely SQL-predicate edits mirroring the existing
`shared_space_library` branch / the `onAlbumDelete` cleanup sequence, one new fork migration
(`user_has_album_path`), and small service-handler additions. Mobile fixes add one server-only action,
a mapper field, and three UI polish edits. No new event types are required for the album path
(`AlbumDelete` already exists from #726); owner-account/asset-delete cleanup reuse it or call the repo
sequence directly.

**Tech Stack:** NestJS 11 + Kysely (server), zod DTOs, SvelteKit/Svelte 5 (web — none in scope this
round), Flutter/Riverpod/Drift (mobile), Vitest (server unit + medium via testcontainers), Playwright

- Vitest (e2e), `flutter test` (mobile).

## Global Constraints

- **Toolchain:** server type-check/lint `make check-server` / `make lint-server` (`tsc` + eslint,
  `--max-warnings 0`); server unit `cd server && pnpm test -- --run <path>`; server medium (real DB,
  needs Docker) `cd server && pnpm test:medium -- --run <path>`; e2e per `e2e/` README; mobile
  `mise //mobile:analyze` + `cd mobile && flutter test <path>` (CI `Static Code Analysis` /
  `Unit Test Mobile` are authoritative — local mobile runs are version-skew-prone). Do **not** invoke
  bare `vitest`.
- **Line numbers are anchors @ `5f0076cd6e`** — `shared-space.repository.ts` is ~2647 lines and
  shifts. **Re-grep by symbol name + scoping construct before editing.** Every cited method name and
  signature was verified at this commit.
- **The A1 invariant:** every album read/stat/face/count/sync SQL branch MUST filter `album.deletedAt
is null` via a non-deleted `album` join. New branches include it from the start.
- **Clone source for every predicate change:** the adjacent `shared_space_library` branch in the same
  method. For face cleanup: the `onAlbumDelete` handler sequence in `shared-space.service.ts`.
- **Server imports:** no relative imports — use the `src/` alias. Strict TS.
  `no-floating-promises` / `no-misused-promises` enforced (`await` or `void` every promise).
- **No OpenAPI regen** for any slice **except possibly Slice 9** (R-F3 param validation) — see that
  slice's gate.
- **`recountPersons` takes `personIds: string[]`** (not a `spaceId`), with an optional
  `db`/transaction arg. There is **no** singular `recountPerson`.

---

## Slice 1: Album branch in the space people-projection read/stat/face queries (faces F1) — HIGH, ship-blocker

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` — the 7 people-projection queries (see
  table). Each currently scopes via an `eb.or([...])` / `asset_scope` CTE listing only
  `shared_space_asset` + `shared_space_library`.
- Test: `server/test/medium/specs/repositories/shared-space.repository.spec.ts` (extend — reuse its
  `addAlbum(...)` helper, already used ~`:3294+`).

**Interfaces:** no signature changes — same methods, additional album branch in each scoping site.

**The 7 queries and their scoping site** (anchor by method name; verify line by grep):

| #   | Method                                                                  | Scoping construct to extend                                                           |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `getSpaceRepresentativeFaces` (called by `getSpacePersonFaces`)         | `eb.or([...])` (asset + library EXISTS)                                               |
| 2   | `getSpacePersonStatistics`                                              | `asset_scope` CTE (asset UNION library)                                               |
| 3   | `countPersonsBySpaceId` (svc `getSpacePeopleStatistics`)                | `asset_scope` CTE **and** the `detectedFaceCount` subquery **and** `datePersonFilter` |
| 4   | `getPeopleFaceStatisticsBySpaceId` (svc `getSpacePeopleFaceStatistics`) | `asset_scope` CTE                                                                     |
| 5   | `getPersonsBySpaceId`                                                   | in-space EXISTS `eb.or([...])` (carries date filter)                                  |
| 6   | `getSpaceRepresentativeFaceForUpdate`                                   | `eb.or([...])`                                                                        |
| 7   | `getIdentityEvidenceForSpacePerson`                                     | `eb.or([...])`                                                                        |

**Canonical album branch** (member-/space-scoped `EXISTS` form, mirrors the library branch + A1 join):

```ts
eb.exists(
  eb
    .selectFrom('shared_space_album')
    .innerJoin('album', (j) =>
      j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null),
    )
    .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
    .whereRef('album_asset.assetId', '=', 'asset.id') // or 'asset_face.assetId' — match the sibling library branch's join column
    .where('shared_space_album.spaceId', '=', spaceId),
),
```

For the `asset_scope` CTE form (queries 2/3/4), add a third `UNION` arm mirroring the library arm,
including the **same** `asset.deletedAt is null`, `asset.isOffline = false`, `visibilityFilter`, and
the `takenAfter`/`takenBefore` date filters:

```ts
.union(
  eb
    .selectFrom('shared_space_album')
    .innerJoin('album', (j) => j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null))
    .innerJoin('album_asset', 'album_asset.albumId', 'shared_space_album.albumId')
    .innerJoin('asset', 'asset.id', 'album_asset.assetId')
    .select('asset.id as assetId')
    .where('shared_space_album.spaceId', '=', spaceId)
    .where('asset.deletedAt', 'is', null)
    .where('asset.isOffline', '=', false)
    // + the same visibility + takenAfter/takenBefore predicates the library arm uses
)
```

- [ ] **Step 1 (RED): comprehensive medium test** in `shared-space.repository.spec.ts`, a new
      `describe('people projection — album-linked space', …)`. Seed a face-recognition-enabled space `S`;
      link album `A` (via `addAlbum`) with image assets that are **not** direct-added and **not** in any
      linked library; run/seed the projection so a space person `P` has `shared_space_person_face` rows on
      `A`'s assets (mirror the existing direct/library projection seeding). Assert, **before** the fix
      (RED):
  - `getSpaceRepresentativeFaces(S, [P])` (via `getSpacePersonFaces`) returns a **non-empty** face
    list for `P` (RED: empty).
  - `getSpacePersonStatistics(S, P)` returns `assets > 0 && faces > 0` matching the projection's
    `assetCount`/`faceCount` (RED: 0/0).
  - `countPersonsBySpaceId(S)` includes `P` and its `detectedFaceCount` includes `A`'s faces (RED:
    undercount / `P` absent).
  - `getPeopleFaceStatisticsBySpaceId(S)` detected/assigned/unassigned counts include `A`'s faces
    (RED: exclude).
  - `getPersonsBySpaceId(S)` lists `P`; **with a date filter** spanning `A`'s `takenAt`, `P` is still
    listed; with an out-of-range filter `P` is excluded (RED: `P` absent even in-range).
  - `getSpaceRepresentativeFaceForUpdate(S, P)` can return an album face id (RED: none).
  - `getIdentityEvidenceForSpacePerson(S, P)` evidence includes `A`'s faces (RED: empty).
  - **Multi-path control:** a person `Q` whose faces are on an asset that is **both** in `A` **and**
    direct-added → counts are **not doubled** (assert `getSpacePersonStatistics(S, Q).faces` equals
    the distinct face count, and `getPersonsBySpaceId` lists `Q` once).
  - **Trashed-album control:** soft-delete `A` (`UPDATE album SET "deletedAt" = now()`), then assert
    an album-only person disappears from `getPersonsBySpaceId` and `getSpacePersonStatistics` returns
    0 (this also pins F3's read behavior).
- [ ] **Step 2: Run; verify FAIL.** `cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts`
- [ ] **Step 3 (GREEN): add the album branch** to all 7 scoping sites (and the two extra sites inside
      `countPersonsBySpaceId`: the `detectedFaceCount` subquery and `datePersonFilter`). Match each
      sibling's join column (`asset.id` vs `asset_face.assetId`) and scope key (`spaceId` literal vs
      `shared_space_person.spaceId` ref). Do **not** modify `recountPersons` or `getPersonAssetIds` (they
      read the projection directly by design). Grep to confirm none missed: `grep -n
"shared_space_library" server/src/repositories/shared-space.repository.ts` within the people block —
      every people-projection hit must now have a paired `shared_space_album` branch.
- [ ] **Step 4: Run; verify PASS.** Re-run the spec; then run the broader recognition specs to confirm
      no regression on direct/library spaces:
      `cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space-face-matching.spec.ts`
- [ ] **Step 5: slice gate.** `make check-server`; commit
      `fix(spaces): album-linked faces appear in space people read/stats/faces (faces F1)`.

---

## Slice 2: Face-pipeline gates honor `album.deletedAt` (faces F3a)

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` — `isAssetInSpace` (album branch
  ~`:2321`) and `getSpaceIdsForAsset` (album branch ~`:2476`).
- Test: `server/test/medium/specs/repositories/shared-space-album.repository.spec.ts` (extend — has
  album fixtures + `isFaceInSpace`/path tests already).

**Interfaces:** no signature changes.

Both album branches `innerJoin('album_asset', …)` directly without joining `album`, so they resolve a
**soft-deleted** album's assets as in-space. Add the non-deleted `album` join (A1 invariant):

```ts
.innerJoin('album', (j) => j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null))
```

- [ ] **Step 1 (RED):** in `shared-space-album.repository.spec.ts`, link album `A` (with asset `X`)
      into face-enabled space `S`. Assert `isAssetInSpace(S, X) === true` and `getSpaceIdsForAsset(X)`
      includes `S`. Then soft-delete `A` and assert `isAssetInSpace(S, X) === false` and
      `getSpaceIdsForAsset(X)` **excludes** `S` (RED: both still true/included).
- [ ] **Step 2: Run; verify FAIL.** `cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space-album.repository.spec.ts`
- [ ] **Step 3 (GREEN):** add the non-deleted `album` join to both album branches.
- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: slice gate.** `make check-server`; commit
      `fix(spaces): face-pipeline gates exclude soft-deleted albums (faces F3a)`.

---

## Slice 3: Owner-account HARD delete cleans space faces (faces F2)

**Files:**

- Modify: `server/src/services/user.service.ts` — `handleUserDelete` (~~`:274`), **before**
  `albumRepository.deleteAll(user.id)` (~~`:326`).
- Possibly add: a `albumRepository` query to enumerate a user's album ids (if none exists, reuse the
  owner predicate `isAlbumOwned`).
- Test: `server/test/medium/specs/services/shared-space-album.service.spec.ts` (extend);
  `server/src/services/user.service.spec.ts` (unit — assert the emit/sweep is invoked before delete).

**Interfaces:**

- Consumes (already present, reused from `onAlbumDelete`): `eventRepository.emit('AlbumDelete', {
albumId })` (awaited in-process), or directly `sharedSpaceRepository.getSpacesLinkedToAlbum`,
  `getAlbumAssetIdsWithoutOtherSpacePath`, `removePersonFacesByAssetIds`, `deleteOrphanedPersons`,
  `queueSpacePersonMetadataBackfill`.

- [ ] **Step 1: Confirm emit ordering.** `handleUserDelete` emits only `UserDelete` today; verify
      `eventRepository.emit` awaits handlers in-process (it does for `AlbumAssetsAdd/Remove`/`AlbumDelete`).
      The cleanup must run while `album_asset` rows still exist (i.e. **before** `deleteAll` and before the
      user/asset cascade).
- [ ] **Step 2 (RED): medium test** in `shared-space-album.service.spec.ts`. Alice owns album `A` with
      photos from **Alice and Bob**; Bob's face-enabled space `S` links `A`; the projection has space
      persons derived from `A`'s faces (assert `assetCount > 0` pre-delete). A second asset `Z` in `A` is
      **also** direct-added to `S`. Hard-delete Alice via `userService.handleUserDelete({ id: alice })`.
      Assert:
  - `shared_space_person_face` rows for `A`'s assets that are now path-less are **removed** and
    zero-face `shared_space_person` rows are gone (`deleteOrphanedPersons` ran).
  - the face on `Z` is **retained** (survives via the direct path).
  - control: a face-enabled space that did **not** link `A` is untouched.
    (RED: faces stranded, orphan persons remain.)
- [ ] **Step 3: Run; verify FAIL.** `cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-album.service.spec.ts`
- [ ] **Step 4 (GREEN):** in `handleUserDelete`, before `albumRepository.deleteAll(user.id)`,
      enumerate the user's album ids and `await this.eventRepository.emit('AlbumDelete', { albumId })` for
      each (reusing the tested `onAlbumDelete` cleanup). If a bulk sweep is preferred for large accounts,
      call the `getSpacesLinkedToAlbum → … → deleteOrphanedPersons` sequence directly per album. Mind
      `no-floating-promises`.
- [ ] **Step 5: Run; verify PASS.** Add/confirm the `user.service.spec.ts` unit assertion that the
      emit/sweep happens before `deleteAll`.
- [ ] **Step 6: slice gate.** `make check-server`; commit
      `fix(spaces): clean space faces when an album owner's account is hard-deleted (faces F2)`.

> Edge note: a deleted user's **direct-added / library** assets in other spaces (not via an album)
> can still leave stale faces — that is the F5 class (Slice 6), not this slice.

---

## Slice 4: Owner-account SOFT delete cleanup + restore re-projection (faces F3b)

**Files:**

- Modify: `server/src/services/user-admin.service.ts` — `delete()` soft-delete path (~`:98–117`,
  `softDeleteAll(id)` ~~`:105`) and `restore()` (~~`:119–125`, `restoreAll(id)` ~`:121`).
- Modify: `server/src/services/shared-space.service.ts` — add the cleanup + re-projection entry
  points (reuse `onAlbumDelete`'s sequence; for restore, re-queue face matching per linking
  face-enabled space).
- Test: `server/test/medium/specs/services/shared-space-album.service.spec.ts` (extend).

**Interfaces:** reuse `getSpacesLinkedToAlbum`, `getAlbumAssetIdsWithoutOtherSpacePath`,
`removePersonFacesByAssetIds`, `deleteOrphanedPersons`, `queueSpacePersonMetadataBackfill`; for
restore, the existing per-(space,asset) face-match queue (`SharedSpaceFaceMatch` /
`SharedSpaceFaceMatchAll`) used by `addMember`/`onAlbumAssetsAdd`.

**Depends on:** Slice 2 (gates) so no new faces are added during the window while we clean.

- [ ] **Step 1 (RED): medium test** — owner-account soft-delete. Bob's face-enabled space `S` links
      Alice's album `A`; projection has album-sourced people with `assetCount > 0`. Soft-delete Alice's
      account (drive `userAdminService.delete(auth, alice, {})` — non-force, the soft path). Assert the
      album-sourced `shared_space_person_face` rows are **removed**, zero-face persons gone, and (with
      Slice 1 in place) the people read surfaces return empty for `A`-only people. (RED: faces persist.)
- [ ] **Step 2 (RED): medium test** — restore. After the soft-delete above, restore Alice
      (`userAdminService.restore(auth, alice)`); assert a face re-match is queued per linking face-enabled
      space (assert the job enqueue, or — if the test runs the worker — that the album-sourced people
      re-appear). (RED: nothing re-queued.)
- [ ] **Step 3: Run; verify FAIL.** `cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-album.service.spec.ts`
- [ ] **Step 4 (GREEN): cleanup on soft-delete.** From the soft-delete path, for each of the user's
      albums run the `onAlbumDelete` cleanup sequence per face-enabled linking space (the `album_asset`
      rows still exist on soft-delete). Wire it via a small shared-space method invoked from
      `user-admin.service.delete()` (inject `SharedSpaceService`/repo as the codebase already does) — do
      **not** invent a public API/event surface beyond an internal call.
- [ ] **Step 5 (GREEN): re-projection on restore.** From the restore path, for each restored album,
      for each linking face-enabled space, queue face matching (mirror `addMember`'s
      `queueSpacePersonMetadataBackfill` + per-space `SharedSpaceFaceMatchAll`).
- [ ] **Step 6: Run; verify PASS.**
- [ ] **Step 7: slice gate.** `make check-server`; commit
      `fix(spaces): clean/re-project space faces on owner-account soft-delete and restore (faces F3b)`.

> Decision baked in: this implements the **eager** cleanup the report recommends (consistency with A1
>
> - clears `getSpacePersonThumbnail` exposure). The lazy alternative is noted in the design's Product
>   decisions; do not switch without a captain decision.

---

## Slice 5: Album-adder branch in metadata inheritance (faces F4)

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` — `getSpacePersonAssetAdderIds`
  (~`:1494`).
- Test: `server/test/medium/specs/repositories/shared-space.repository.spec.ts` (extend).

**Interfaces:** no signature change — add a third unioned subquery.

`getSpacePersonAssetAdderIds` collects from `shared_space_asset.addedById` + `shared_space_library.addedById`
but omits `shared_space_album.addedById`. Mirror the **library** subquery's person linkage
(`shared_space_person_face → asset_face → asset`) but join the album path and select
`shared_space_album.addedById`:

```ts
const albumRows = await this.db
  .selectFrom('shared_space_person_face')
  .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
  .innerJoin('asset', 'asset.id', 'asset_face.assetId')
  .innerJoin('album_asset', 'album_asset.assetId', 'asset.id')
  .innerJoin('shared_space_album', (join) =>
    join.onRef('shared_space_album.albumId', '=', 'album_asset.albumId').on('shared_space_album.spaceId', '=', spaceId),
  )
  .innerJoin('album', (j) => j.onRef('album.id', '=', 'shared_space_album.albumId').on('album.deletedAt', 'is', null))
  .select('shared_space_album.addedById as userId')
  .distinct()
  .where('shared_space_person_face.personId', '=', personId)
  .where('asset.deletedAt', 'is', null)
  .where('asset.isOffline', '=', false)
  .where('shared_space_album.addedById', 'is not', null)
  .execute();
```

Union its `userId`s with the existing direct + library rows.

- [ ] **Step 1 (RED): medium test** in `shared-space.repository.spec.ts`: a space person whose faces
      are only on an album-linked asset → `getSpacePersonAssetAdderIds(S, P)` includes the album's
      `addedById` (RED: omitted).
- [ ] **Step 2: Run; verify FAIL.** `cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts`
- [ ] **Step 3 (GREEN):** add the album-adder subquery + union.
- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: slice gate.** `make check-server`; commit
      `fix(spaces): include album-linker as asset adder for metadata inheritance (faces F4)`.

---

## Slice 6: Asset-delete orphan cleanup handler (faces F5)

**Files:**

- Modify: `server/src/services/shared-space.service.ts` — add an `@OnEvent({ name: 'AssetDelete' })`
  handler (beside the existing `onAlbum*` handlers).
- Possibly modify: `server/src/services/asset.service.ts` — enrich the `AssetDelete` payload **only
  if** Step 1 shows the event fires after the `asset_face` cascade (so affected persons can't be read
  post-hoc).
- Test: `server/test/medium/specs/services/shared-space-album.service.spec.ts` (extend) +
  `server/src/services/shared-space.service.spec.ts` (unit — handler dispatch).

**Interfaces:** consumes `recountPersons(personIds: string[], db?)` + `deleteOrphanedPersons(spaceId)`;
needs the set of affected spaces (`getSpaceIdsForAsset`) and affected person ids.

- [ ] **Step 1: Confirm timing (open item).** Determine whether `AssetDelete` (`asset.service.ts:485`)
      fires **before or after** the `asset → asset_face → shared_space_person_face` cascade. If **before**:
      the handler can query affected `(spaceId, personId)` from `shared_space_person_face` then recount
      after. If **after**: the rows are already gone — capture affected spaces/persons in the payload
      (enrich the event) or recount all persons for the spaces the asset belonged to. Document the chosen
      path in the slice plan.
- [ ] **Step 2 (RED): medium test** — face-enabled space `S` (album- or direct-sourced); a person `P`
      has faces on assets `X` and `Y`. Hard-delete `X`. Assert `P`'s `assetCount`/`faceCount` are
      recounted (decremented) and, if `X` was `P`'s only asset, `P` is removed as a zero-face orphan.
      Control: a person in a space not containing `X` is untouched. (RED: counts stale, orphan remains.)
- [ ] **Step 3: Run; verify FAIL.** `cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-album.service.spec.ts`
- [ ] **Step 4 (GREEN):** add `onAssetDelete` — for each affected face-enabled space, `recountPersons`
      the affected person ids and `deleteOrphanedPersons(spaceId)`. Keep it idempotent and guarded
      (`try/catch` + logger, like `onAlbumDelete`).
- [ ] **Step 5: Run; verify PASS.** Add the unit dispatch assertion in `shared-space.service.spec.ts`.
- [ ] **Step 6: slice gate.** `make check-server`; commit
      `fix(spaces): recount space people and drop orphans on asset delete (faces F5)`.

> Pre-existing/broad: this also covers direct/library spaces. Lowest-priority engineering slice; the
> timing question in Step 1 is the only real risk.

---

## Slice 7: Album-asset sync streams exclude soft-deleted albums (RBAC F1)

**Files:**

- Modify: `server/src/repositories/sync.repository.ts` — `SharedSpaceAlbumAssetSync.getBackfill`
  (~~`:1508`), `getUpdates` (~~`:1527`), `getCreates` (~~`:1549`); `SharedSpaceAlbumAssetExifSync`
  backfill/updates/creates (~~`:1574/:1585/:1598`); `SharedSpaceAlbumToAssetSync.getUpserts` (~~`:1489`);
  `SharedSpaceAlbumSync.getCreatedAfter` (~~`:1367`).
- Test: `server/test/medium/specs/sync/shared-space-album-asset-sync.spec.ts`,
  `…-album-asset-exif-sync.spec.ts`, `…-album-to-asset-sync.spec.ts`,
  `shared-space-album-sync.spec.ts` (extend — the metadata stream's soft-delete test at ~`:103/:176`
  is the template).

**Interfaces:** reuse the existing `accessibleSpaceAlbums(eb, userId)` helper (~`:1112`, already joins
`album` + filters `album.deletedAt is null`), or add an `INNER JOIN album … AND album.deletedAt is
null` to each stream — match whichever the sibling `getUpserts`/`getDeletes` streams use.

The grant-gated streams currently filter on `shared_space_album_user` only:

```ts
.innerJoin('shared_space_album_user', 'shared_space_album_user.albumId', 'album_asset.albumId')
.where('shared_space_album_user.userId', '=', userId)
```

Add the non-deleted-album scope (mirror `SharedSpaceAlbumSync.getUpserts` ~`:1399`):

```ts
.where('album_asset.albumId', 'in', (eb) => accessibleSpaceAlbums(eb, userId))
```

(For `getBackfill`, which is keyed by `albumId` param with no grant join, add an `album.deletedAt is
null` guard so a backfill for a soft-deleted album returns nothing.)

- [ ] **Step 1 (RED): medium tests** in each asset/exif/to-asset spec: grant member `M` access to
      album `A` (linked to face-enabled space `S`), confirm the stream returns `A`'s asset/exif/to-asset
      rows; soft-delete `A`; assert the stream now returns **none** for `M` (RED: still streamed). Also
      assert `SharedSpaceAlbumSync.getCreatedAfter` no longer creates the album for `M` after soft-delete.
- [ ] **Step 2: Run; verify FAIL.** `cd server && pnpm test:medium -- --run test/medium/specs/sync/shared-space-album-asset-sync.spec.ts test/medium/specs/sync/shared-space-album-asset-exif-sync.spec.ts test/medium/specs/sync/shared-space-album-to-asset-sync.spec.ts`
- [ ] **Step 3 (GREEN):** add `accessibleSpaceAlbums` / `album.deletedAt` scope to the eight stream
      methods.
- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: slice gate.** `make check-server`; commit
      `fix(spaces): stop syncing soft-deleted album assets to space members (RBAC F1)`.

---

## Slice 8: `user_has_album_path` honors `album.deletedAt` on all branches (RBAC F2)

**Files:**

- Modify: `server/src/schema/functions.ts` — `user_has_album_path` (~`:520`, body `:526-551`): add a
  non-deleted `album` join + `a.deletedAt IS NULL` to branch 2 (other-space member) and branch 3
  (other-space creator), matching branch 1.
- Add: a new fork migration
  `server/src/schema/migrations-gallery/1779300000000-FixUserHasAlbumPathSoftDeleted.ts` (round
  timestamp **after** `1779200000000` — verify no collision) that `CREATE OR REPLACE FUNCTION
user_has_album_path(...)` with the corrected body.
- Test: `server/test/medium/specs/sync/user-has-album-path.spec.ts` (extend) and/or
  `shared-space-album-delete-triggers.spec.ts`.

**Interfaces:** SQL function only; no TS signature change. Per CLAUDE.md, fork migrations live in
`migrations-gallery/` (never touched by rebases) and `postbuild` merges them into `dist`.

- [ ] **Step 1 (RED): medium test** in `user-has-album-path.spec.ts`: album `A` linked to two spaces
      `S1`, `S2`; user `M` is a member of `S2` only. `user_has_album_path(A, M, S1)` returns `true`
      (branch 2). Soft-delete `A`; assert it now returns `false` (RED: still `true` — under-revocation).
      Add a branch-3 (other-space creator) variant. Confirm branch 1 (`album_user`) already returns
      `false` for a soft-deleted album (regression guard).
- [ ] **Step 2: Run; verify FAIL.** `cd server && pnpm test:medium -- --run test/medium/specs/sync/user-has-album-path.spec.ts`
- [ ] **Step 3 (GREEN):** edit `functions.ts` (so the schema source matches), then write the fork
      migration with `CREATE OR REPLACE FUNCTION user_has_album_path` adding the `album.deletedAt` guard to
      branches 2 & 3. Keep both copies byte-identical to avoid drift.
- [ ] **Step 4: Run; verify PASS.** Also run `shared-space-album-delete-triggers.spec.ts` to confirm
      the grant-revocation gating still behaves (a leave where the only other path is a now-soft-deleted
      album should revoke the grant).
- [ ] **Step 5: slice gate.** `make check-server` (and confirm `pnpm build` postbuild copies the new
      migration); commit
      `fix(spaces): exclude soft-deleted albums from user_has_album_path grant retention (RBAC F2)`.

---

## Slice 9: Validate the `albumId` route param → 400, not 500 (RBAC F3)

**Files:**

- Modify: `server/src/controllers/shared-space.controller.ts` — `linkAlbum` (~~`:609`),
  `updateSharedSpaceAlbum` (~~`:623`), `unlinkAlbum` (~`:637`).
- Add: a zod param DTO in `server/src/dtos/shared-space.dto.ts` (e.g.
  `SharedSpaceAlbumParamDto = z.object({ id: z.uuidv4(), albumId: z.uuidv4() })`) mirroring
  `UUIDParamDto` (`validation.ts:112`).
- Test: `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts` (extend).

**Interfaces:** replace `@Param() { id }: UUIDParamDto, @Param('albumId') albumId: string` with
`@Param() { id, albumId }: SharedSpaceAlbumParamDto` on all three endpoints.

- [ ] **Step 1 (RED): e2e test** in `shared-space-album.e2e-spec.ts`: as an authorized space
      Owner/Editor, call `PUT /shared-spaces/:id/albums/not-a-uuid` and assert status **400** (RED:
      currently 500). Add the same for `PATCH` and `DELETE`.
- [ ] **Step 2: Run; verify FAIL.** Run the e2e API suite for the spec.
- [ ] **Step 3 (GREEN):** add the DTO and switch the three handlers to it.
- [ ] **Step 4: OpenAPI gate (decision point).** Build the server and check whether the generated spec
      changes (`cd server && pnpm build && pnpm sync:open-api`, then `git diff` the spec). **If it
      changes**, this is the one slice that runs the regen workflow: `make open-api` (TS SDK + Dart),
      commit the regenerated clients. **If it does not change**, no regen. If the team prefers strictly
      no-regen, instead use a runtime-only UUID guard that emits no param format metadata — resolve at
      plan-review.
- [ ] **Step 5: Run; verify PASS.**
- [ ] **Step 6: slice gate.** `make check-server`; commit
      `fix(spaces): validate albumId route param (400 not 500) (RBAC F3)`.

---

## Slice 10: Mobile — server-only add path for absorbed albums (mobile F1) — HIGH

**Files:**

- Modify: `mobile/lib/providers/infrastructure/space_album_actions.dart` — add `addAssets` (mirror
  `link`/`unlink`); add the `DriftAlbumApiRepository` dependency to the class + provider.
- Modify: `mobile/lib/pages/library/spaces/space_album_detail.page.dart` — `_addPhotos` (~`:45-67`,
  call at `:55`) routes through `SpaceAlbumActions.addAssets` instead of
  `remoteAlbumProvider.notifier.addAssetsToAlbum`.
- Test: `mobile/test/providers/infrastructure/space_album_actions_test.dart` (extend),
  `mobile/test/medium/repositories/space_album_repository_test.dart` (regression, real Drift DB).

**Interfaces:** new `Future<int> SpaceAlbumActions.addAssets(String albumId, List<String> assetIds)`
calling `driftAlbumApiRepository.addAssets(albumId, assetIds)` (`drift_album_api_repository.dart:51-69`,
provider `:10`) then `_syncManager.syncRemote()`. **No** local `remote_album_asset_entity` write.

```dart
Future<int> addAssets(String albumId, List<String> assetIds) async {
  if (assetIds.isEmpty) return 0;
  final result = await _albumApiRepo.addAssets(albumId, assetIds); // server is source of truth
  await _syncManager.syncRemote();                                  // surfaces via spaceAlbum() watch
  return result.added.length;
}
```

- [ ] **Step 1 (RED): unit test** in `space_album_actions_test.dart` (mocktail): `addAssets` calls
      `DriftAlbumApiRepository.addAssets` then `syncRemote()`, returns the added count, and **never**
      touches the local album repository. Assert it does **not** call `RemoteAlbumRepository.addAssets`.
- [ ] **Step 2 (RED): regression test** in `space_album_repository_test.dart` (real Drift DB, FK ON):
      pin that the old path fails — `DriftRemoteAlbumRepository.addAssets('absorbed-album', [assetId])`
      (no `remote_album` row) throws FK 787 — then assert the new server-only path performs no local
      junction insert (no FK violation). (Mirrors the empirical repro in the report.)
- [ ] **Step 3: Run; verify FAIL/repro.** `cd mobile && flutter test test/providers/infrastructure/space_album_actions_test.dart test/medium/repositories/space_album_repository_test.dart`
- [ ] **Step 4 (GREEN):** implement `SpaceAlbumActions.addAssets`; point `_addPhotos` at it; on
      success show the success toast, on real failure show the error toast (the false-failure is gone).
- [ ] **Step 5: Run; verify PASS.** `mise //mobile:analyze` clean on touched files.
- [ ] **Step 6: slice gate.** Commit
      `fix(spaces/mobile): add photos to absorbed linked albums without false failure (mobile F1)`.

> Edge: owner case (album in `remote_album`) still works via the server-only path (no double insert);
> remove path is already a safe no-op and is unchanged.

---

## Slice 11: Mobile — populate `currentUserRole` so editor-owned albums are linkable (mobile F2)

**Files:**

- Modify: `mobile/lib/infrastructure/repositories/remote_album.repository.dart` — the album queries
  (`getAll` ~`:22-82`, `get` ~`:84-131`, and the `toDto` mapper ~`:570-587`) to read the current
  user's `remote_album_user.role` and pass `currentUserRole` into `RemoteAlbum`.
- Test: `mobile/test/medium/repositories/space_album_repository_test.dart` or
  `mobile/test/.../remote_album_repository_test.dart` (real Drift DB — assert mapping);
  `mobile/test/utils/space_link_album_candidates_test.dart` already proves the gate once populated.

**Interfaces:** the queries already `leftOuterJoin remoteAlbumUserEntity` (for `isShared`); add a
current-user-keyed read of `.role`. `toDto` gains a `currentUserRole` param.

- [ ] **Step 1 (RED): medium repo test** — seed an album shared with the current user as **editor**
      (a `remote_album_user` row, role=editor) that the user does **not** own; assert the mapped
      `RemoteAlbum.currentUserRole == AlbumUserRole.editor` (RED: `null`). Add owner and viewer variants.
- [ ] **Step 2: Run; verify FAIL.** `cd mobile && flutter test test/medium/repositories/space_album_repository_test.dart`
- [ ] **Step 3 (GREEN):** read the current user's role in the album query and thread it through
      `toDto(... currentUserRole: ...)`. The current user id is already available to these queries (used
      for owner/shared computation) — reuse it.
- [ ] **Step 4: Run; verify PASS.** Confirm `space_link_album_candidates_test.dart` still passes (the
      editor branch is now reachable with real data).
- [ ] **Step 5: slice gate.** `mise //mobile:analyze` clean; commit
      `fix(spaces/mobile): offer editable (not just owned) albums in the link picker (mobile F2)`.

> Alternative (product): if editor-linking is out of scope for mobile v1, instead drop the `isEditor`
> branch + "or can edit" wording. The design grants the capability, so this slice implements it; do
> not switch without a captain decision.

---

## Slice 12: Mobile — detail header subtitle "{count} photos · in {space.name}" (mobile F3)

**Files:**

- Modify: `mobile/lib/pages/library/spaces/space_album_detail.page.dart` — `SpaceAlbumAppBar`
  (~`:191-208`, title at `:196`) to add a subtitle; source the space name (watch the space-metadata
  provider used by `space_detail.page.dart`, or pass it as a route param).
- Test: `mobile/test/presentation/pages/space_album_detail_page_test.dart` (extend — it pumps
  `SpaceAlbumAppBar` directly).

**Interfaces:** `assetCount` from `SpaceAlbum.assetCount` (already resolved via `spaceAlbumsProvider`);
space name from the space-metadata source.

- [ ] **Step 1 (RED): widget test** — pump `SpaceAlbumDetailPage`/`SpaceAlbumAppBar` with a known
      `assetCount` and space name; assert the subtitle text `"{count} photos · in {space.name}"` renders
      (RED: absent).
- [ ] **Step 2: Run; verify FAIL.** `cd mobile && flutter test test/presentation/pages/space_album_detail_page_test.dart`
- [ ] **Step 3 (GREEN):** add the subtitle (e.g. an app-bar `bottom`/two-line title) using the count +
      space name; guard for the loading state (no subtitle until resolved — see Slice 14).
- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: slice gate.** `mise //mobile:analyze` clean; commit
      `fix(spaces/mobile): show photo count + space on album detail header (mobile F3)`.

---

## Slice 13: Mobile — real album covers (mobile F4)

**Files:**

- Modify: `mobile/lib/presentation/widgets/spaces/space_albums_shelf.widget.dart` (~~`:168-222`, icon
  `:198`), `mobile/lib/pages/library/spaces/space_albums.page.dart` (~~`:154-247`, icon `:176`),
  `mobile/lib/pages/library/spaces/space_link_album.page.dart` (`_AlbumCover` ~`:202-219`, icon
  `:217`).
- Reuse: `mobile/lib/presentation/widgets/album/album_tile.dart:20,36-64`
  (`assetServiceProvider.getRemoteAsset(thumbnailAssetId)` + `Thumbnail.remote` in a `FutureBuilder`,
  icon as fallback).
- Test: `mobile/test/presentation/widgets/spaces/space_albums_shelf_test.dart` (+ list/link page
  tests) (extend).

**Interfaces:** `thumbnailAssetId` is on `SpaceAlbum`/`RemoteAlbum`; the cover widgets need a `ref`
(make them `ConsumerWidget` where they aren't already).

- [ ] **Step 1 (RED): widget test** — render a cover for an album with a `thumbnailAssetId`; assert a
      `Thumbnail`/image renders (not the placeholder icon). With a null `thumbnailAssetId`, assert the
      placeholder icon still renders. (RED: always the icon.)
- [ ] **Step 2: Run; verify FAIL.** `cd mobile && flutter test test/presentation/widgets/spaces/space_albums_shelf_test.dart`
- [ ] **Step 3 (GREEN):** port the `album_tile.dart` `FutureBuilder` cover pattern into the three
      cover sites, keeping the icon as the no-thumbnail / loading / error fallback.
- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: slice gate.** `mise //mobile:analyze` clean; commit
      `fix(spaces/mobile): render real album cover thumbnails (mobile F4)`.

---

## Slice 14: Mobile — guard the timeline toggle before album metadata loads (mobile F5)

**Files:**

- Modify: `mobile/lib/pages/library/spaces/space_album_detail.page.dart` — `_toggleTimeline`
  (~`:69-72`) and the kebab render (`SpaceAlbumAppBar`/`SpaceAlbumKebab` ~`:198-204`).
- Test: `mobile/test/presentation/pages/space_album_detail_page_test.dart` /
  `space_b6_mutations_test.dart` (extend).

**Interfaces:** the kebab currently renders as soon as `canEdit` is known; the toggle no-ops when the
album stream is still `null`.

- [ ] **Step 1 (RED): widget test** — render the detail page with `canEdit == true` but the
      `spaceAlbumsProvider` stream **unresolved**; assert the timeline toggle is **disabled** (or tapping
      it surfaces a "still loading" affordance) rather than silently no-opping. Once the album resolves,
      assert the toggle is enabled and fires `toggleTimeline`. (RED: toggle enabled + silent no-op while
      loading.)
- [ ] **Step 2: Run; verify FAIL.** `cd mobile && flutter test test/presentation/pages/space_album_detail_page_test.dart`
- [ ] **Step 3 (GREEN):** disable the toggle entry until `album != null` (gate on the album stream,
      not just `canEdit`), or show a transient "still loading" toast on early tap.
- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: slice gate.** `mise //mobile:analyze` clean; commit
      `fix(spaces/mobile): disable timeline toggle until album metadata loads (mobile F5)`.

---

## Product decisions (noted, NOT scheduled)

These need a captain decision before any code; the slices above do not touch them.

- **faces F6** — should the space headline count / recent strip / "N new" badge gate on
  `showInTimeline` (today they include album assets regardless, consistent with each other but
  exceeding the timeline). Cheap either way; it's a "what does the space's photo count mean" call.
- **RBAC F4** — confirm the transitive-write model is intended (album-editor who is a space Editor can
  re-share the album's write surface to that space's Editors).
- **RBAC F5** — whether a space _creator_ can be membership-removed at all, and whether sync should
  then follow membership (pre-existing shared-space infra, broader than albums).
- **F3b eagerness** — eager cleanup-on-soft-delete (implemented in Slice 4) vs lazy reliance on Slice
  1 read-scoping + Slice 2 gates (leaves `getSpacePersonThumbnail` exposure). Slice 4 proceeds with
  eager per the report's recommendation; flip only on a captain decision.

## Deferred (flagged, not scheduled — pre-existing or out of scope)

- Mobile: hardcoded English strings (route through `.t(context:)`); detail query `visibility==timeline`
  vs "all photos" nuance.
- Web: in-space picker empty-state, sequential per-album link calls, `gray-*` vs `@immich/ui` tokens
  (no web work in this round).
- `AssetUpdate` has no album branch (`access.repository.ts`) — RBAC + faces both call it likely
  intentional; confirm as a product decision if revisited.

## Self-Review

**Finding coverage:** faces F1→S1, faces F3a→S2, faces F2→S3, faces F3b→S4, faces F4→S5, faces
F5→S6, faces F6→noted; RBAC F1→S7, RBAC F2→S8, RBAC F3→S9, RBAC F4/F5→noted; mobile F1→S10, mobile
F2→S11, mobile F3→S12, mobile F4→S13, mobile F5→S14. Every engineering finding maps to exactly one
slice; every product/informational finding is in [Product decisions](#product-decisions-noted-not-scheduled).

**TDD:** each slice names the exact failing test file + assertions FIRST, the RED command, the GREEN
implementation, and a slice gate. Edge cases are enumerated inline (S1 multi-path/trashed/date/repr;
S3/S4 surviving-others/own-orphans/multi-space/direct-also/restore; S10 owner/non-owner/remove/empty).

**Ordering/independence:** ship-blockers first (S1, S10). S2 (gates) precedes S4 (soft-delete cleanup)
so no faces are added mid-clean; S1's `album.deletedAt` join makes the soft-delete read behavior in
S2/S4/S8 observable. Otherwise slices are independent and individually committable.

**Type/symbol consistency:** `recountPersons(personIds: string[], db?)` (S6 — not `spaceId`, no
singular variant). `getAlbumAssetIdsWithoutOtherSpacePath(spaceId, albumId)` (album-excluding — S3/S4)
vs `getAssetIdsWithoutOtherSpacePath(spaceId, assetIds)` (direct-removal). `AlbumDelete` event already
exists (#726) and is reused by S3; no new album event type. R-F2 edits **both** `functions.ts` and a
new `migrations-gallery/` file. R-F3 is the only slice that may need OpenAPI regen.

**No-placeholder scan:** canonical patches shown for S1 (EXISTS + asset_scope), S2, S5 (full album
subquery), S7 (grant→accessibleSpaceAlbums), S10 (`addAssets`). S3/S4/S6 reuse the verified
`onAlbumDelete` sequence; S8 is a `CREATE OR REPLACE FUNCTION`; S9 a zod DTO; S11–S14 reference exact
clone-source lines.

## Open items (resolve at plan-review / first touch)

- **S6** — confirm `AssetDelete` emit ordering vs the `asset_face` cascade; choose read-before-delete
  vs enriched-payload accordingly.
- **S8** — confirm `1779300000000` doesn't collide with any existing fork migration timestamp; confirm
  `postbuild` copies the new file into `dist/schema/migrations`.
- **S9** — confirm whether the zod param DTO changes the generated OpenAPI spec; regen iff it does.
- **S4** — confirm the injection path for shared-space cleanup from `user-admin.service` (mirror how
  the codebase already cross-injects services); keep it an internal call, not a new public surface.
- **S12** — confirm the cleanest space-name source for the detail page (space-metadata provider vs
  route param).
